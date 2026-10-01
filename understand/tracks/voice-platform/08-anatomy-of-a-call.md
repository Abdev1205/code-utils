# Anatomy of a Call

**Topic:** This repo
**Covers:** Every mechanism in a live call: barge-in, endpointing, switching, recording, channels
**Source:** [Claude artifact](https://claude.ai/artifact/BMmPYYHg3spr4uPVxxEVZE) — written by a colleague, mirrored here for study.

*orchestrator-service · every step of a live call*

One phone call through this codebase, stage by stage. Every mechanism gets a definition, how it actually works in the code, a worked example, and what breaks — grounded in the real files rather than in general theory.

**How to read this**

Each stage follows the same four boxes: **Definition** — what the thing is, in one paragraph. **How it works** — the actual mechanism in this repo, with file paths. **Example** — a concrete trace. **Watch out** — the failure modes.

File references point at real code. Line numbers drift; class and method names are the durable handle.

## The runtime

*Setting up · 01*

**Definition**

A **runtime** here is one of three long-lived server processes that handle live user interaction. The voice runtime is the one that answers phone calls.

**How it works**

One entry point, `main.py`, selects a mode:

```
python main.py --mode interface --port 8000            # REST API
python main.py --mode text      --port 8001            # SMS / email / chat
python main.py --mode voice     --port 8080 --transport livekit
python main.py --mode voice     --port 8080 --transport grpc
```

Voice has two transports, and they differ in *who initiates*:

| | gRPC | LiveKit |
|---|---|---|
| Entry | `servers/grpc_server.py` | `servers/livekit_agent_server.py` |
| Handler | `handlers/rpc_handler.py` | `handlers/livekit_session.py` |
| Model | Carrier streams audio to us over gRPC | We join a room the carrier's SIP leg is already in |
| Concurrency | Multiple worker processes | Agent SDK dispatches a job per call |

Both converge on the same place: `pipeline/pipecat_bots.py` builds one Pipecat pipeline per call. Everything after this document's next two sections is transport-agnostic.

**Example — what one process holds**

```
livekit_agent_server.py  (one process, N concurrent jobs)
   ├─ job: call A → LiveKitSession → PipelineTask → Pipeline
   ├─ job: call B → LiveKitSession → PipelineTask → Pipeline
   └─ job: call C → ...

each job gets its own: transport, ASR/TTS connections,
LLM context, recorder, metrics observer
```

Per-process identity is stamped into every log line via `worker_pid_var`, and per-call identity via `call_uuid_var` and `client_uuid_var` — contextvars read directly inside the slog formatter, which is why they survive across `await` points.

## How LiveKit works

*Setting up · 02*

**Definition**

**LiveKit** is a WebRTC media server. Participants join a **room** and publish **tracks** (audio streams); other participants subscribe to them. LiveKit's SIP service bridges a phone call into a room as a participant, so a PSTN caller and a software agent become two participants exchanging audio.

The key mental shift: **there is no direct connection between the bot and the caller.** Both connect to a room, and the room forwards audio.

**How it works here**

```
caller ──PSTN──► carrier ──SIP──► LiveKit SIP ──┐
                                                 ▼
                                         ┌─────────────┐
                                         │    room     │
                                         └─────────────┘
                                                 ▲
                            our agent ──WebRTC───┘
```

`transport/livekit.py` wraps Pipecat's LiveKit transport with four modifications that matter:

- **`ModLiveKitTransportClient._subscribe_to_audio_tracks`** — subscribes to the caller's audio track when it's published.
- **`ModLiveKitInputTransport._on_sip_dtmf_received`** — keypad presses arrive as SIP DTMF events, not as audio, so they need their own handler.
- **`ModLiveKitOutputTransport._clear_audio_buffer`** — barge-in. See §11.
- **`ModLiveKitOutputTransport._wait_for_audio_playout`** — hangup. See §21.

`setup_sip_call_status_listener` watches participant attributes for SIP call status, which is how an outbound call learns it was answered, rejected, or hit voicemail.

**Watch out — the buffer you don't control**

LiveKit's `AudioSource` is created with a queue (on the order of a second). TTS generates audio faster than real time, so by the time you decide to stop, *seconds of audio may already be queued inside LiveKit*. Stopping your generator does nothing — the caller keeps hearing the old sentence.

This single fact is why `_clear_audio_buffer()` and `_wait_for_audio_playout()` both exist, doing opposite things for opposite reasons.

## The audio channel

*Setting up · 03*

**Definition**

The **audio channel** is the format contract: how many samples per second, how many bits each, and how many streams. Every processor in the pipeline has to agree, and mismatches produce audio that is silently wrong rather than obviously broken.

**How it works**

| Property | Value | Why |
|---|---|---|
| Sample rate in | 8,000 Hz | Telephony. `setup_vad()` hard-codes it. |
| Sample width | 16-bit | `setsampwidth(2)` in the recorder |
| Encoding | PCM, little-endian | Raw amplitude values |
| Frame size | 10–40 ms | LiveKit uses `audio_out_10ms_chunks=4` → 40 ms |
| Recording | 2 channels | Caller left, bot right — `num_channels=2` |

**8 kHz means audio above 4 kHz does not exist**, and the phone band is roughly 300–3,400 Hz. That's why "S" and "F" get confused, and why an ASR model trained on clean laptop audio does measurably worse here.

Two processors sit on the channel:

- **`KrispAudioFilter`** (`processors/filters/krisp.py`) — vendored noise suppression, applied to inbound audio before anything else sees it. Toggled by `ENABLE_KRISP`, model path from `KRISP_MODEL_PATH`.
- **`AudioResamplerProcessor`** — converts between rates when a vendor wants something other than 8 kHz.

**Example — the two-channel recording**

```
track 0 (left)   caller's microphone audio
track 1 (right)  bot's TTS output

interleaved:  [L0 R0][L1 R1][L2 R2] ...  → one stereo WAV
```

Keeping them separate is what lets you listen to one side alone, and what makes overlap during a barge-in visible in the waveform.

## Why two audio channels

*Setting up · 03b*

**Definition**

The recording is **stereo**, but not for stereo's usual reason. There is no left and right in a phone call. The two channels are used as two *independent tracks*: channel 0 is everything the caller said, channel 1 is everything the bot said. Nothing is mixed.

The term for this in call-centre software is **dual-channel** or **stereo call recording**, as opposed to **mono**, where both sides are summed into one waveform.

**How it works**

Two buffers are filled from two different places in the pipeline:

```
transport.input()  ──► user buffer   (caller's mic audio)
transport.output() ──► bot buffer    (TTS audio being sent)

at write time:  interleave_stereo_audio(user, bot)
                [L0 R0][L1 R1][L2 R2] ...  → one WAV, 2 channels
```

`num_channels=2` is passed when the recorder is constructed, and `setnchannels(num_channels)` writes it into the WAV header. Any player then knows to split them.

**Five reasons this is worth the complexity**

- **Post-call ASR can transcribe each side separately** — The biggest one. Transcribing a mono mix means the recogniser must also work out *who is speaking* — speaker diarisation, which is error-prone and gets much worse when two people talk at once. With separate tracks, speaker attribution is free and exact: whatever is on channel 0 is the caller, always.
- **Overlap is preserved rather than destroyed** — In a mono mix, a barge-in is two voices summed into one waveform — the caller's words are corrupted by the bot's audio underneath, and no amount of post-processing separates them. In stereo both survive intact, which is the only way to audit what actually happened during an interruption.
- **Per-side quality analysis** — Measure the caller's audio level, noise floor and speech rate without the bot's clean studio-quality output skewing every statistic.
- **QA and dispute resolution** — "Did the agent say X before the customer agreed?" is answerable by listening to one channel. In a mix, it's an argument.
- **Training data** — Clean, correctly-labelled per-speaker audio is what you need to fine-tune ASR or evaluate a new vendor. Mono recordings need re-labelling before they're usable.

**The cost — and it's exactly the bug this codebase spent real effort on**

Two tracks means the tracks must **stay aligned**, and they do not fill at the same rate. The caller's mic delivers continuously, in real time, forever. The bot's track receives audio only while it's speaking, and in bursts — TTS synthesises faster than real time.

```
mic  ████████████████████████████████████  continuous
bot  ░░░░████░░░░░░░░████████░░░░░░░░░░░░  bursty, with gaps
```

So the silent track must be padded to keep the two in step. And **choosing what clock to pad against is the entire design problem**:

| Clock | Fails when |
|---|---|
| Wall clock (`time.monotonic()`) | A GC pause or scheduling delay makes it pad audio that never existed. Output length drifts from reality. |
| The other track's length | Bursty vendor delivery makes the bot track momentarily "ahead", so it over-pads the mic track. |
| **Mic sample count** | Nothing. Caller audio arrives in real time by definition, so counting its samples *is* counting real time. |

The mic clock is what `ModAudioLengthBufferProcessor` uses. And it's why §7's detail matters: when barge-in is disabled and the STT mute filter suppresses input audio, those frames are *still* fed to the recorder. Drop them and the clock stops advancing, and the tracks separate by exactly the duration of every bot utterance.

One more trap: `interleave_stereo_audio` **truncates to the shorter track**. If the two buffers aren't level at merge time, the tail of the longer one is silently discarded — which is why `_align_track_buffers` pads both to `max(len(user), len(bot))` immediately before writing.

**Example — what a barge-in looks like in each format**

```
mono:    "...your order has bee[CANCEL IT]celled and a refund..."
         one waveform, both voices summed, neither cleanly recoverable

stereo:  ch0  ................CANCEL IT..............   caller
         ch1  your order has been cancelled and a re..   bot
         both intact; overlap visible and measurable
```

## WebSocket, WebRTC and streaming

*Setting up · 03c*

**Definition — the three transport shapes**

- **HTTP request/response** — Client asks, server answers, connection closes. One exchange per connection. The web's default.
- **WebSocket** — A connection that *stays open* and lets **both sides send whenever they want**. Starts life as an HTTP request carrying `Upgrade: websocket`; the server agrees, and from then on it's a two-way message pipe over the same TCP connection.
- **WebRTC** — A peer-to-peer real-time media stack, running over **UDP** rather than TCP. Built for audio and video specifically. What LiveKit uses.

**Why a voice bot needs all three, and where each is used**

| Link | Protocol | Why that one |
|---|---|---|
| Caller ↔ LiveKit room | **WebRTC / RTP over UDP** | Live audio. Late audio is useless audio, so you want packets dropped rather than retransmitted. |
| Runtime ↔ ASR vendor | **WebSocket** | We push audio continuously; the vendor pushes back interim and final transcripts unprompted. Both directions, unpredictable timing. |
| Runtime ↔ TTS vendor | **WebSocket** | We push text; audio chunks stream back. Same shape. |
| Runtime ↔ LLM | **HTTP with a streamed body** (SSE-style) | One request, one long response arriving in pieces. We never need to send mid-response. |
| Runtime ↔ integrations | **Plain HTTP** | Ask, get an answer, done. |
| Carrier ↔ runtime (gRPC mode) | **gRPC bidirectional streaming** | HTTP/2 streams in both directions — WebSocket's job with a schema attached. |

**Why WebSocket and not repeated HTTP for ASR**

Three reasons, and the third is the one people miss.

1. **The server needs to initiate.** An interim transcript arrives when the vendor has one, not when you ask. Plain HTTP has no way for a server to speak first — you'd have to poll, which is both slower and more expensive.
2. **Connection setup is not free.** TCP handshake plus TLS handshake is one to two round trips. Paying that per 20 ms audio frame is absurd; the handshake would dwarf the payload.
3. **The vendor holds state.** Streaming ASR maintains a decoder state across the utterance — that's what lets it revise "I want to can" into "I want to cancel". A fresh connection per chunk throws that state away and the recognition gets much worse.

**Why WebRTC and not WebSocket for the call audio**

WebSocket runs over TCP, and TCP guarantees delivery *in order*. For live audio that guarantee is actively harmful:

```
packet 5 is lost
TCP:    holds 6, 7, 8, 9 in a buffer and retransmits 5
        → audio stalls, then plays late, and keeps drifting later
        → this is head-of-line blocking

WebRTC/UDP: packet 5 never arrives; play 6
        → a 20 ms glitch nobody notices, and no accumulating delay
```

For a phone call, **a small gap now beats a perfect copy later**. That inversion of the normal networking instinct is the whole reason a separate real-time stack exists.

WebRTC also brings jitter buffering, echo cancellation, adaptive bitrate and NAT traversal — a pile of things you would otherwise build.

**What goes wrong with vendor WebSockets in practice**

Reading the TTS services in `app/runtime/voice/services/`, the recurring hazards are all connection-lifecycle problems:

- **Connections drop mid-call.** Reconnect logic is mandatory, and reconnecting loses vendor-side state.
- **One connection per language per vendor** unless the vendor supports per-request settings — which is exactly what the `update_language_config` aggregation in §21 exists to avoid.
- **Vendor concurrency limits.** Open sockets are a metered resource, which is why `capacity.py` tracks them in Redis with an atomic Lua admission script.
- **Receive-loop discipline.** The handler for an incoming message must return promptly. Sleeping inside it parks the socket's read task — the exact bug documented in §20.
- **Cancellation semantics.** On barge-in the in-flight request must be abandoned without corrupting the connection for the next sentence.

**Example — one utterance across all the links**

```
caller speaks
  │ WebRTC/UDP ──► LiveKit room ──► our agent
  │
  │ WebSocket   ──► Deepgram
  │              ◄── "I want to"      (interim)
  │              ◄── "I want to cancel" (final)
  │
  │ HTTP stream ──► OpenAI
  │              ◄── "Sure," "I" "can" "help" ... (tokens)
  │
  │ WebSocket   ──► Cartesia  "Sure, I can help with that."
  │              ◄── audio chunks
  │
  └ WebRTC/UDP ◄── LiveKit room ◄── audio to caller

four protocols, one turn, ~900 ms
```

## Pipeline assembly

*Setting up · 04*

**Definition**

A **pipeline** is an ordered list of frame processors. A **frame** is a typed message — audio, text, transcription, control — and each processor receives frames, may act on them, and pushes them on. Frames travel **downstream** (toward the caller's ears) or **upstream** (back toward the microphone).

This is Pipecat's model, and it's the single most important thing to internalise about this codebase: **order is behaviour.** Moving a processor one position changes what it can see.

**How it works — the real list**

`PipelineConfigManager.create_pipeline()` builds this:

```
transport.input()              ← audio frames enter here
gender_processor               ← optional, must see raw audio + VAD
stt_mute_processor             ← can suppress audio going to ASR
asr_pipeline (parallel)        ← one branch per ASR vendor/language
dtmf_processor                 ← keypad digits
user_idle                      ← optional, watches for silence
user_input_transformer
context_aggregator.user()      ← builds the user turn
llm                            ← generates the reply
filler_words_processor         ← optional
db_writer_processor            ← persists turns
tag_processor                  ← strips <TRANSFER> etc. before TTS
tts_pipeline (parallel)        ← one branch per TTS vendor/language
transport.output()             ← audio frames leave here
audio_recorder                 ← AFTER output, so it sees what was sent
context_aggregator.assistant() ← records what the bot said
```

*app/runtime/voice/pipeline/pipecat_bots.py · create_pipeline()*

**Three placement decisions worth understanding — they're all load-bearing**

**Gender identification sits first**, before the STT mute filter, with an explicit comment saying why: it needs raw user audio and VAD boundaries, and the mute filter can suppress exactly those.

**The recorder sits after `transport.output()`**, not before. It records what was actually *sent*, not what was generated — those differ whenever a barge-in cancels mid-sentence.

**The assistant aggregator is last.** It has to run after TTS so it can incorporate `BargeInSpokenTextFrame` — what was actually spoken — rather than the full generated text.

**ParallelPipeline — the branching primitive**

`ParallelPipeline` runs several sub-pipelines side by side over the same frames. It's used twice: once for ASR (a branch per vendor/language) and once for TTS. Language gates inside each branch decide which one is live. §8 and §17.

It's also used for **voicemail detection** on outbound calls: a second, never-muted ASR plus its own LLM runs in parallel with the main conversation, with a `FrameSinkProcessor` at the end to stop its output ever reaching TTS.

## First turn configuration

*Setting up · 05*

**Definition**

The **first turn** is what the bot says before the caller has said anything. Two strategies: speak a fixed line, or ask the LLM to open.

**How it works**

`generate_initial_frames()` branches on whether a static prompt is configured:

```python
static_prompt = await self.config_manager.get_start_prompt(self.context)

if static_prompt:
    return [LLMFullResponseStartFrame(),
            LLMTextFrame(static_prompt),
            LLMFullResponseEndFrame()]
else:
    return [LLMRunFrame()]
```

*pipecat_bots.py · generate_initial_frames()*

The static path is clever: it *fabricates the frames an LLM would have emitted*. Everything downstream — TTS, the DB writer, the assistant aggregator — behaves identically whether the text came from a model or from config. No special-casing anywhere.

**The two transports queue it differently**

**LiveKit** — `_send_initial_greeting()` waits for the state to be `STARTING`, flips it to `ACTIVE`, sleeps 500 ms for audio setup, then queues. The state check is the guard against sending twice.

**gRPC** — queues in a *background task* (`_queue_initial_frames_async`), deliberately. The comment explains it: the request consumer must start listening for `USER_HANGUP` immediately, and a static prompt can involve a slow integration call. Blocking on it would mean missing a hangup that arrives during the greeting.

**Example — the two openings**

```
static:  "Hello, this is Riya from Acme Finance.
          Am I speaking with Rohit?"
         → identical every call, legally reviewable, zero LLM latency

LLMRunFrame: model opens from the system prompt
         → varied, adaptive, costs one LLM round trip before
           the caller hears anything
```

For a compliance-sensitive outbound call the static prompt is almost always right — it's the one utterance you can guarantee.

**Also started here**

`start()` kicks off `_enforce_max_call_timeout()` when `max_call_timeout_config.enabled` — a hard ceiling on call duration, independent of everything else.

## Voice activity detection

*Hearing · 06*

**Definition**

**VAD** answers one question continuously: *is there speech in this frame of audio?* It produces no words — only a boolean, many times a second.

**How it works**

`ModSileroVADAnalyzer` wraps Pipecat's Silero VAD — a small neural network, far more robust in noise than an energy threshold. Four parameters:

| Param | Meaning |
|---|---|
| `confidence` | How sure the model must be to call it speech |
| `start_secs` | How long speech must persist before firing "started" |
| `stop_secs` | **How long silence must persist before firing "stopped"** |
| `min_volume` | Amplitude floor |

`stop_secs` is the one that matters most — it is the raw silence threshold that endpointing is built on, and the whole of §9 is about not leaving it fixed.

The subclass exists for one reason: it adds `set_params()`, so VAD parameters can be changed *mid-call*. That's what makes dynamic endpointing possible.

**Example — the frames VAD produces**

```
silence...                    (nothing)
speech starts  → VADUserStartedSpeakingFrame
speech...
silence for stop_secs
               → VADUserStoppedSpeakingFrame
```

Note these are *VAD* frames, distinct from `UserStartedSpeakingFrame` / `UserStoppedSpeakingFrame`, which are emitted by the turn controller. Conflating the two is a common source of confusion when reading this code — the VAD ones are raw acoustics, the plain ones are turn decisions.

## The STT mute filter

*Hearing · 07*

**Definition**

A processor that **suppresses audio before it reaches ASR**, under configured conditions. Muting the input is how you make the bot deaf on purpose.

**How it works**

`create_stt_mute_processor()` picks a strategy set based on whether barge-in is enabled:

```
barge-in ENABLED:
    strategies = {CUSTOM}
    callback   = terminal_strategy      # mute only after hangup/transfer

barge-in DISABLED:
    strategies = {MUTE_UNTIL_FIRST_BOT_COMPLETE, ALWAYS, CUSTOM}
    callback   = llm_request_start  (smart turn on)
               | transcription_finalized  (smart turn off)
```

*pipecat_bots.py · create_stt_mute_processor()*

With barge-in off, the bot literally stops listening while it speaks — that's *how* barge-in is disabled. It isn't a flag checked later; the audio never reaches ASR.

**The detail that connects this to the recording**

When barge-in is disabled, the mute filter is handed the `audio_recorder`:

```python
audio_recorder=audio_recorder if not barge_in_enabled else None
```

Suppressed `InputAudioRawFrame`s are still fed to the recorder. Why: the recorder's position-based sync uses *the mic frame count as its clock*. Drop those frames and the clock stops, and the two tracks drift apart by exactly the length of every bot utterance.

This is a good example of the general shape of bugs in this system — a change in one place breaks a timing assumption three processors away.

## ASR and the ASR switch

*Hearing · 08*

**Definition**

**ASR** turns audio into text. The **ASR switch** is how a multilingual assistant routes audio to the right recogniser when the conversation changes language mid-call.

**How it works — parallel branches plus gates**

`setup_asr_processors()` builds one branch per vendor/language group. All branches receive all audio; a **gate** at the end of each decides whether its transcriptions continue downstream.

```
                    ┌─ Deepgram(en) ─ ASRGate[en]  ─┐
audio ─ Parallel ───┼─ Sarvam(hi)   ─ ASRGate[hi]  ─┼─► one transcript
                    └─ Sarvam(bn)   ─ ASRGate[bn]  ─┘
```

`LanguageBasedASRGate.process_frame` is the whole mechanism:

```python
current_language = self.config_manager.get_current_language()
if current_language in self.languages:
    await self.push_frame(frame, direction)
# else: dropped silently
```

*app/runtime/voice/processors/gates.py*

So switching language is not a reconnection — it's a change to `get_current_language()`, and a different gate starts passing frames on the next utterance. **No connection is torn down and none is established**, which is why the switch is instant.

**The two special cases in the gate**

- `MetricsFrame` is dropped outright — otherwise every parallel branch would report metrics for a call it isn't serving, and the numbers would be nonsense.
- `STTUpdateSettingsFrame` carrying a language is pushed **upstream**, and only if this gate's branch supports that language. That's how a language change reaches the ASR service itself rather than just the gate.

**Example — a mid-call language switch**

```
turn 1  current_language = EN
        Deepgram gate passes  → "I want to check my balance"
        Sarvam gate drops its (garbage) Hindi transcript

caller switches to Hindi; a flow rule or the LLM sets language = HI

turn 2  current_language = HI
        Deepgram gate now drops
        Sarvam gate passes    → "mera balance kitna hai"
```

**Watch out — you are paying for every branch**

All branches transcribe all audio, all call long. Three languages means three ASR bills and three websockets, of which two are producing output that is thrown away.

That's the price of an instant switch. `resolve_asr_configs_by_capacity` and the concurrency keys in `utils/asr_capacity.py` exist because those connections are a limited, tracked resource.

## Endpointing

*Hearing · 09*

**Definition**

**Endpointing** is deciding that the caller has finished their turn, so the bot may now reply. Too eager and you interrupt them; too patient and every exchange has a dead pause. It is the single largest lever on how a bot *feels*.

**Why a fixed silence threshold cannot work**

```
"my account number is... four four eight... uh... two one"
                     ↑ 900 ms pause — NOT finished

"cancel it."
              ↑ 300 ms pause — finished
```

One number cannot serve both. Set it long and simple turns feel sluggish; set it short and anyone reading a number aloud gets cut off. **Silence duration is not what distinguishes a finished thought from a pause.**

**Mechanism 1 — dynamic VAD, driven by the transcript's last character**

`DynamicVadController` (`pipeline/endpointing.py`) adjusts `stop_secs` on the fly, based on the *tail of the interim transcript*:

```python
def _dynamic_stop_secs(self, text):
    last_char = text.rstrip()[-1]
    if last_char in "?.!":   return config.on_punctuations   # shorter
    if last_char.isdigit():  return config.on_numbers        # longer
    return base_params.stop_secs                             # default
```

The reasoning is elegant and entirely local: a transcript ending in punctuation is a completed sentence, so wait less. A transcript ending in a digit is almost certainly mid-number, so wait more. Everything else, use the default.

The controller is deliberately pure — the `on_*` hooks return `VADParams` or `None`, and never push frames. `ModLLMUserAggregator` owns emission, pushing a `VADParamsUpdateFrame` upstream when the controller returns params. On the final transcript, `on_final_transcription()` resets to `config.default`.

**Example — the dial moving inside one utterance**

```
interim: "my number is 4"        → tail digit  → stop_secs = 2.0
interim: "my number is 4 4 8"    → tail digit  → stop_secs = 2.0  (no-op)
interim: "my number is 4 4 8 2"  → tail digit  → stop_secs = 2.0
final:   "my number is 4482."                  → reset to 1.0
```

The caller got two full seconds of thinking time while reading digits, and the very next turn is back to a snappy default. No model, no extra latency — just the last character of a string.

**Mechanism 2 — smart turn, a model deciding**

When `smart_turn_enabled`, `build_user_turn_stop_strategy()` instead returns `ModTurnAnalyzerUserTurnStopStrategy`, wrapping Pipecat's `LocalSmartTurnAnalyzerV3` — a bundled ONNX model that classifies the utterance as complete or incomplete from the audio itself.

```python
SmartTurnParams(
    stop_secs        = smart_turn_config.stop_secs,       # silence fallback
    pre_speech_ms    = smart_turn_config.pre_speech_ms,
    max_duration_secs= smart_turn_config.max_duration_secs,
)
```

The turn commits when the model says COMPLETE *and* a transcript is in — or when the silence fallback fires. The subclass adds verdict logging (`is_complete`, `probability`, `e2e_processing_time_ms`) so live calls show what the model decided, which is essential for tuning.

**Watch out — the late-final race, and how it's handled**

`_handle_transcription` carries a comment describing a real bug: our ASR services push finals **without `finalized=True`**. When `stop_secs` exceeds the ASR's p99, the parent's timeout fires at VAD stop, before a slow final lands. The parent only re-checks on *finalized* transcripts — so a late final would wait for the controller's full 5-second stop timeout.

The fix is a re-check on non-finalized frames:

```python
if not frame.finalized:
    await self._maybe_trigger_user_turn_stopped()
```

A no-op unless the model already said COMPLETE and the timeout already elapsed. This is the kind of bug that shows up as "sometimes the bot takes five seconds" and is invisible in aggregate metrics.

## Turn strategies

*Hearing · 10*

**Definition**

Pipecat 1.x models turn-taking as two pluggable strategies: one deciding when a user turn **starts**, one deciding when it **stops**. Everything about interruption and commit timing hangs off these.

**Start — `ModUserTurnStartStrategy`**

```python
if isinstance(frame, (VADUserStartedSpeakingFrame, TranscriptionFrame)):
    await self.trigger_user_turn_started()
```

Two triggers, because some ASR paths produce a transcription with no VAD onset at all (the "whisper case" the docstring names).

The important parameter is `enable_interruptions`, and the docstring is precise about why:

- **`True`** — any turn start broadcasts an `InterruptionFrame` immediately. Plain barge-in.
- **`False`** — turn start does not auto-interrupt. Used when min-words gating is on, so the decision moves to the word-count check in the aggregator. *The turn still starts and still commits* — only the mid-speech cut is gated. Without this, a bare VAD onset would cut the bot before any word count could be checked.

**Stop — `ModUserTurnStopStrategy`**

A polling loop rather than a frame handler:

```python
async def _loop(self):
    while True:
        try:
            await asyncio.wait_for(self._event.wait(), timeout=aggregation_timeout)
            self._event.clear()
        except asyncio.TimeoutError:
            if not self._user_speaking and self._has_text:
                await self.trigger_user_turn_stopped()
```

Frames only *wake* the loop; the loop alone commits. The comment explains the deliberate cost: "Costs at most one `aggregation_timeout` poll (10 ms by default) versus the old commit-on-frame shortcut."

Why pay it: **a single commit path.** First-turn gender identification needs exactly one place to gate the first LLM call, and frame ordering can't be relied on — the processor's stop frames arrive ~150 ms after the commit, and `UserStoppedSpeakingFrame` is emitted *by* the commit. One place, one shot.

**Example — the gender gate, one shot**

```
_loop times out, user not speaking, text present
   ├─ first turn?  → gender_processor._on_user_stopped_speaking()
   │                 (wrapped in try/except — "win or lose")
   └─ trigger_user_turn_stopped()
```

`_gender_detection_ongoing` is set `False` before the call, so a failure can never block a second turn.

## Context aggregation

*Hearing · 11*

**Definition**

**Context aggregation** is assembling the conversation into the message list the LLM sees. Transcription arrives in fragments; the aggregator collects them into one user message and appends it at the right moment. There are two — a user aggregator and an assistant aggregator — and they bracket the LLM in the pipeline.

**User side — `ModLLMUserAggregator`**

Four responsibilities, per its docstring:

1. **Interim content-gated interrupt** — barge-in by word count. §12.
2. **Dynamic VAD** — delegates to `DynamicVadController`, pushes `VADParamsUpdateFrame` upstream.
3. **Terminal gate** — after a `TerminalFrame`, silence all pushes.
4. **Custom commit signals** — the three-frame commit below.

The commit in `push_aggregation()`:

```python
self._context.add_message({"role": self.role, "content": aggregation})

await self.push_frame(LLMRequestStartFrame(), FrameDirection.UPSTREAM)    # STT mute cue
await self.push_frame(LLMRequestStartFrame(), FrameDirection.DOWNSTREAM)  # filler cue
await self.push_context_frame()                                           # blocking
```

The ordering is the point, and the comment says so: pushing the context frame is a blocking call into the LLM, so *notify everyone else first*. Upstream tells the mute filter to stop listening; downstream starts the filler-word timer. Both must happen before the pipeline blocks.

**The terminal gate — a small guard with a real purpose**

```python
if self._terminal_frame_received:
    self._reset_turn_state()
    return ""
```

Once a hangup or transfer is queued, committing a user turn would push a context frame, which would run the LLM, which would flush the queue — and the caller would hear a reply after the goodbye. The gate makes the aggregator go silent instead.

**Assistant side — `ModLLMAssistantAggregator`**

Three jobs: buffering tags until aggregation completes, applying sensitive-data templating (`_apply_tags_and_sensitive_data`), and merging burst-TTS output. Crucially it records **what was actually spoken**, not what was generated — which is what makes barge-in accounting correct. §12.

## Barge-in

*Hearing · 12*

**Definition**

**Barge-in** is the caller interrupting the bot mid-sentence, and the bot stopping. Simple to state, and it touches more of this system than any other feature — VAD, the aggregators, the transport, the recorder and the context all participate.

**The problem with naive barge-in**

Any VAD onset stops the bot. So a cough stops it. A TV stops it. An acknowledging "mm-hmm" stops it. The conversation stutters constantly.

The fix here is **min-words gating**: only interrupt once the caller has said enough words to mean it.

**Mechanism — three checks, all in `ModLLMUserAggregator`**

**1 · Interim check** — `_maybe_interrupt_from_interim()`, on every interim transcript:

```python
if not (min_words_enabled and text and self._bot_speaking):  return
if self._interrupted_this_turn or self._terminal_frame_received:  return
if await self.should_interrupt_from_interim(text):
    await self.broadcast_interruption()
    self._interrupted_this_turn = True
```

**2 · Final check** — `_maybe_interrupt_from_final()`, an explicit safety net "for ASR providers with unreliable interims". If the complete final crosses the threshold while the bot still speaks, interrupt at the final frame instead.

**3 · The drop gate** — at commit time, a sub-threshold utterance spoken while the bot was talking is *discarded entirely*:

```python
if (self._bot_speaking and not self._interrupted_this_turn
        and min_words_enabled
        and len(aggregation.split()) < min_words_count):
    await self.reset()
    return ""
```

This is the part people miss. It isn't enough to not-interrupt on "mm-hmm" — you must also not *reply* to it. Without the drop gate the bot finishes its sentence and then answers a back-channel.

**The whitelist escape hatch**

```python
if any(word in text for word in self._whitelisted_words):
    return True
```

Certain words interrupt regardless of length — "stop", "wait", "no". One word, and the word count is bypassed. Exactly right: those are the cases where making someone say five words first is unacceptable.

**What actually happens on interruption**

```
1. broadcast_interruption()  → InterruptionFrame across the pipeline
2. transport output: _clear_audio_buffer()  ← BEFORE super().process_frame
      audio_source.clear_queue()
3. TTS service: cancel in-flight synthesis
4. TTS emits BargeInSpokenTextFrame — the text actually heard
5. assistant aggregator appends THAT, not the full generated reply
6. recorder: interruption bookkeeping so the tracks stay aligned
```

Step 2's ordering is explicit in the code — clear the buffer *before* the frame is processed further, because otherwise LiveKit keeps playing what's already queued.

**Step 5 is the subtle one, and the most important**

The bot generated 30 words; the caller interrupted after 6. If the context records all 30, the model believes it said things the caller never heard, and *every subsequent turn is built on a false premise* — it will refer back to information it never delivered.

`BargeInSpokenTextFrame` exists so the assistant aggregator records the 6. The TTS services estimate how much was played — from a rid-matched completion where the vendor provides one, falling back to elapsed wall-clock × characters-per-second.

This is the single best thing to be able to explain about barge-in in an interview. Everyone describes stopping the audio; almost nobody mentions fixing the context.

## The LLM

*Thinking · 13*

**Definition**

The model that reads the conversation and produces the next reply — as streamed text, and as tool calls when it wants something done.

**How it works**

`setup_llm_and_context()` builds the service, the `LLMContext`, and the message list. The service is created through `ServiceFactory` from database config, so the vendor is a data decision rather than a code one.

Tools available to the model live in `app/llm/tools/`:

| Tool | Purpose |
|---|---|
| `integration.py` | Call an external HTTP API. §15 |
| `module_switch.py` | Move to a different flow module |
| `channel_switch_tool.py` | Move the conversation to another channel |
| `mcp.py` | MCP-provided tools |
| `set_variable` | Record a value — guardrail-checked. §16 |

Multimodal models (`MULTIMODAL_MODELS`) take a different path entirely — `pipeline/multimodal.py` — because they consume audio directly and collapse ASR, LLM and TTS into one service.

## The LLM switch

*Thinking · 14*

**Definition**

Automatically moving to a fallback LLM mid-call when the active one becomes slow or errors. Unlike the ASR and TTS switches — which are about *language* — this one is about *health*.

**How it works — strikes**

`LatencyBasedSwitcherStrategy` (`pipeline/latency_switcher.py`) counts consecutive slow turns:

```python
if ttfb_value > self._latency_threshold_secs:
    self._strike_counts[service] += 1

if strikes >= max_strikes and service is active:
    return await self._try_switch_away_from(service)
```

Defaults: `latency_threshold_secs=1.5`, `max_strikes=2`. TTFB is fed in by `LatencyAwareLLMSwitcher._handle_ttfb_metrics`, reading the same `TTFBMetricsData` the metrics observer uses.

**Two design decisions worth calling out**

**`allow_switch_back=False` by default.** One latency switch per session, full stop. Without it, a system under general load flaps between two equally-degraded vendors, and flapping is worse than being slow — you lose the warm connection each time.

**Errors and latency are treated differently.** `switch_due_to_error()` takes the next candidate *unconditionally*, and the docstring says why: "a broken service is strictly worse than a latency-degraded one for the user, so latency strikes do not disqualify a fallback here." Strike counts are left untouched — errors and latency are separate signals.

**Example — a switch playing out**

```
turn 1  OpenAI TTFB 0.9s   → under threshold
turn 2  OpenAI TTFB 2.1s   → strike 1
turn 3  OpenAI TTFB 1.8s   → strike 2  → SWITCH
        "Latency-based LLM switch  from=OpenAI to=Cerebras threshold=1.5"
turn 4  Cerebras TTFB 0.4s
turn 9  Cerebras TTFB 2.2s → strike 1
turn 10 Cerebras TTFB 2.4s → strike 2  → suppressed
        "Latency switch suppressed: already switched once this session"
```

**Watch out**

Strikes are *consecutive by construction* only in the sense that any sub-threshold turn should reset them — check that the reset path is exercised in your reading. And if every service is degraded, the code logs `"All LLM services degraded, staying on current"` and stays put, which is the right call: switching to something equally bad costs a connection for nothing.

## Filler words

*Thinking · 15*

**Definition**

Short utterances — "let me check", "one moment" — spoken while the caller would otherwise hear silence. They don't make anything faster; they make the wait *legible*, which is most of what people actually mind.

**How it works — three modes, one timer**

`FillerWordsProcessor` watches for a start frame, starts a timer, and cancels on the end frame. What those frames are depends on mode:

| Mode | Start frame | End frame | Covers |
|---|---|---|---|
| `GLOBAL` | `LLMRequestStartFrame` | `LLMTextFrame` | Slow LLM |
| `MODULE` | same | same | Slow LLM, per-module wording |
| `INTEGRATION` | `FunctionCallInProgressFrame` | `FunctionCallResultFrame` | Slow API |

Tiers escalate — say something at 800 ms, something else at 2 s, something else at 4 s:

```python
for delay, word in self._get_filler_tiers(start_frame):
    await asyncio.sleep(delay - elapsed)
    elapsed = delay
    if not self._response_received:
        await self.push_frame(TTSSpeakFrame(word), DOWNSTREAM)
        await self.push_frame(DBBotMessageFrame(text=word), DOWNSTREAM)
```

**Two comments in this file that are worth reading twice**

**Why `TTSSpeakFrame` and not `LLMTextFrame`:** "TTSSpeakFrame bypasses the TTS sentence aggregator, which would otherwise hold a lone sentence waiting for lookahead text that never comes (no `LLMFullResponseEndFrame` follows)."

The aggregator batches text into sentences and waits for more. A filler is one orphan sentence with nothing behind it — it would sit in the buffer until something flushed it, which is exactly the silence you were trying to fill. Directly relevant to §18.

**Why the extra `DBBotMessageFrame`:** "TTSSpeakFrame is invisible to the DB writer's `LLMTextFrame` buffer; record the filler as an assistant turn explicitly." Bypassing the aggregator also bypasses persistence, so the transcript would silently lose every filler.

**Example — the module_switch special case**

The most interesting branch in `_get_filler_tiers`. When the tool call is `module_switch`, the slow thing isn't the switch — it's the `static_start_action` integration that runs when the *next* module opens. So the code looks ahead:

```python
if function_name == "module_switch":
    next_module = find(flow_config_data.modules, name == next_module_name)
    if next_module.static_start_action:
        function_name = next_module.static_start_action   # use ITS filler config
    else:
        return []                                          # nothing slow, no filler
```

Config is read from the module the call is heading *to*, and if that module has no start action, no filler plays at all. A nice piece of not-guessing.

**Watch out — the `_filler_done` event**

On the end frame the processor `await self._filler_done.wait()` before cancelling. Without it you could cancel the task mid-push and get a half-emitted frame. It's set in the `CancelledError` handler too, so cancellation can't deadlock.

## API integration

*Thinking · 16*

**Definition**

An **integration** is a configured HTTP call the LLM can invoke as a tool — look up an account, post a payment, fetch a status. It's what turns the bot from a talker into a doer.

**How it works**

`IntegrationTool` exposes one function to the model, deliberately generic:

```json
{
  "name": "integration",
  "parameters": {
    "wait_prompt": "The prompt for the user to wait for...",
    "keys":   ["array of variable keys to set before the request"],
    "values": ["array of variable values"]
  },
  "required": ["wait_prompt"]
}
```

Note what the model does *not* get: no URL, no method, no headers. Those live in the `Integration` database row, referenced by `integration_id` in the request body template. **The model chooses to call an integration; it cannot choose what the integration does.** That's the security boundary.

Execution in `run()`:

```
1. integration_id present?         → else integration_error
2. db.get(Integration, id)         → else "Integration not found"
3. validate all required variables present
4. _execute_request_chain(...)     → a CHAIN, not one call
5. _process_output_template(output, {variables, steps})
6. return {output_variables, tool_response, raw_api_data, ...}
```

**Two things that make this more than an HTTP client**

**Request chains.** `_execute_request_chain` runs several steps, each able to reference earlier results through `{"steps": responses}`. Authenticate, then look up an ID, then fetch the record — three calls, one tool invocation, and the model never sees the intermediate mechanics.

**Templating both ways.** `_process_template` renders variables into the request; `_process_output_template` maps the response back onto flow variables. So a deeply nested JSON response becomes the two fields the flow cares about.

**Errors are values, not exceptions**

Every failure path returns `_create_error_message(interaction, error_type, error_msg, api_response_message)` — a *string the model can read*, with a typed error and an operator-authored message.

This is the right shape for a voice bot. An exception becomes silence on a live phone line; a returned error message becomes "I'm having trouble reaching that system — can I take a message?" The model handles the failure conversationally because the failure arrived as conversation.

**Example — one integration turn**

```
model: integration(wait_prompt="Let me pull that up",
                   keys=["account_id"], values=["A-4471"])
   │
   ├─ FunctionCallInProgressFrame  → filler timer starts (INTEGRATION mode)
   ├─ 900 ms elapse                → "One moment please" spoken
   ├─ chain: POST /auth → GET /accounts/A-4471
   ├─ output template: {"balance": "{{ steps[1].body.data.amount }}"}
   └─ FunctionCallResultFrame      → filler cancelled

model receives {"balance": "2500"} and speaks it
```

## Guardrails

*Thinking · 17*

**Definition**

A **guardrail** here is narrow and specific: a rule that **blocks a `set_variable` tool call** when a condition holds. The docstring states the purpose plainly — "prevents financial compliance issues from LLM hallucinations or misconfigured flows."

It is not a content filter and not a profanity blocklist. It guards the moment the model tries to *record a fact*.

**How it works**

The config shape (`app/models/configs.py`):

```
GuardrailRule:
    name:      str
    key:       str            # variable to watch
    value:     str | None     # value to match (None = any)
    condition: str            # Jinja2, evaluated against variables
    action:    GuardrailAction(type="hangup"|"transfer", message=str)
```

And the check, in `LLMConfigManager.check_guardrails`:

```python
jinja_context = {"context": {**self.variables}, **self.variables}

for rule in self.guardrail_config.rules:
    for k, v in zip(keys, values):
        if k != rule.key:                       continue
        if rule.value is not None and str(v) != rule.value:  continue
        rendered = Template(rule.condition).render(jinja_context)
        if rendered.strip().lower() == "true":
            return rule       # violation
```

Three-stage narrowing: key must match, value must match if specified, and only then is the Jinja condition evaluated against everything known about the call.

**Example — the class of bug this exists to stop**

```yaml
rule:
  name:      block_payment_without_verification
  key:       payment_confirmed
  value:     "true"
  condition: "{{ 'true' if not identity_verified else 'false' }}"
  action:    { type: hangup,
               message: "I'll need to verify your identity first." }
```

The model, mid-conversation, decides to record `payment_confirmed = true` before identity was verified. The rule fires, the variable is never set, the caller hears the message, the call ends.

Note what's being defended against: not a malicious caller, but *the model being wrong*. Which is the realistic threat.

**Watch out**

`Template(...).render()` failing is caught and logged, and the loop continues — a broken condition does *not* block the call. Fail-open. Defensible for availability; worth knowing, because a typo in a rule means it silently never fires.

Also: the guardrail acts at `set_variable`. Anything that changes state by another route is outside its reach.

## Tags

*Thinking · 18*

**Definition**

**Tags** are structured markers the LLM emits inside its text — `<TRANSFER>`, `<HANGUP>` and similar. `TagsFrameProcessor` intercepts them, converts them into control frames, and **removes them from the text before TTS**.

**How it works, and why the position matters**

```
llm → filler → db_writer → TAG PROCESSOR → tts → transport.output()
```

It sits immediately before TTS. If it sat after, the caller would hear the bot say the words "transfer" in angle brackets — a genuinely common bug in systems that do this the naive way.

It also carries `transfer_blocking_config`. When transfers are temporarily blocked (the config's docstring gives agency vacations as the example), a `<TRANSFER>` tag is *not executed*; instead the bot speaks a configured `hangup_message`. An operational override that needs no prompt change and no deploy.

## The DB writer

*Thinking · 19*

**Definition**

Persists conversation turns and metadata to Postgres as the call happens, so the transcript exists even if the process dies.

**How it works**

`DBWriterFrameProcessor` buffers `LLMTextFrame`s into complete turns and writes them. It sits *after* the LLM and *before* TTS, so it records what was generated.

Which is exactly why filler words need their explicit `DBBotMessageFrame` (§15) — a `TTSSpeakFrame` never passes through the `LLMTextFrame` buffer, so without the extra frame the filler would be spoken and never recorded.

## How the reply breaks into TTS chunks

*Speaking · 20*

**Definition**

The LLM emits text token by token. TTS needs *units*. **Sentence aggregation** is the step that decides where one TTS request ends and the next begins — and it is the single biggest determinant of perceived speed.

**Why the unit is a sentence and not a token**

Two constraints pull against each other.

**Start as early as possible** — every token you wait for is silence the caller hears.

**Don't start too early** — prosody is computed over a whole phrase. Synthesise "I want to" and "cancel your order" separately and you get two fragments with wrong intonation and an audible seam. The pitch contour of a sentence depends on knowing where the sentence ends.

The sentence is the smallest unit where prosody is correct. So: **not the first token, and not the last — the first complete sentence.**

**How it works**

```
LLM streams:  "Your"  " order"  " has"  " been"  " cancelled."  " You"  ...
                                                       │
                                        sentence boundary detected
                                                       ▼
                                    run_tts("Your order has been cancelled.")
                                    → audio starts flowing to the caller

              meanwhile the LLM is still generating sentence 2
```

Pipecat's base TTS service does the aggregation; the services in `app/runtime/voice/services/` implement `run_tts` per sentence. The overlap is the whole point — sentence one is audible while sentence three is still being written.

**What the services here add on top**

Reading `smallestai.py`, `cartesia.py`, `azure.py`, `google.py` and `sarvam.py`, four concerns recur:

- **One request in flight** — `run_tts` sends the sentence and *blocks until its audio has played out*. This keeps the base class's per-sentence `TTSTextFrame` ordered behind its own audio — text and audio stay in step.
- **Playback estimation** — On barge-in, how much of the sentence was heard? A rid-matched completion gives the exact duration where the vendor provides one; otherwise elapsed wall-clock × characters-per-second. Feeds `BargeInSpokenTextFrame`.
- **Caching** — A fully-received sentence's audio blob is stored and can be replayed, so a retry costs nothing.
- **Aggregatability** — Implementing `update_language_config` is what marks a service as able to serve multiple languages over one connection. §21.

**The hard-won rule in this code**

From the project's own lessons: **never sleep or pace playback inside a TTS websocket receive loop.** Do the waiting in `run_tts` — the task Pipecat cancels on barge-in.

Why: synthesis outruns playback, so the vendor's *done* message usually arrives *before* a barge-in. A sleep in the done-handler parks the receive task for the cancelled sentence's remaining duration, and its late completion signal spuriously unblocks the *next* sentence.

Symptom: after a barge-in, the next reply has multi-second dead air, then arrives all at once with its own blocking skipped. Receive-loop handlers must return promptly — store and signal only.

**Example — one reply, three TTS requests**

```
t=0.00  LLM first token
t=0.31  "Your order has been cancelled."   → TTS request 1
t=0.44  first audio byte → CALLER HEARS SOMETHING
t=0.62  "A refund will reach you in 3 days." → queued
t=0.95  "Is there anything else?"            → queued
t=1.10  LLM done

caller heard audio at 0.44s, not 1.10s
```

And the exception that proves the rule: a filler word is pushed as `TTSSpeakFrame` precisely to *skip* this aggregator, because a lone sentence with nothing behind it would sit in the buffer waiting for lookahead that never comes.

## TTS and the TTS switch

*Speaking · 21*

**Definition**

**TTS** turns text into audio. The **TTS switch** routes to the right voice when the conversation changes language — the mirror of the ASR switch, with one significant optimisation.

**How it works — and the aggregation trick**

`setup_tts_processors()` builds branches, but not blindly one per language. Its docstring:

> "A vendor that implements `update_language_config` can serve every one of its languages over a single connection (all of its per-language settings are per-request), so it gets ONE service and one multi-language gate instead of one branch — and one websocket — per language."

```python
if hasattr(tts_processor, "update_language_config"):
    aggregated_vendors[vendor] = {"processor": tts_processor,
                                  "languages": {language: tts_config}}
```

The capability check is `hasattr` on the method itself — the comment notes this deliberately: "Capability is the method itself, so it can never disagree with what the service actually supports." No registry to keep in sync.

**The gate applies config lazily**

```python
async def _apply_language_config(self, current_language):
    if not self.language_wise_config or current_language == self._applied_language:
        return
    self._applied_language = current_language
    await self.tts_service.update_language_config(
        self.language_wise_config[current_language])
```

Applied on the frame that *reveals* the change, so it always lands immediately before the text that needs it. `_applied_language` starts as `None` rather than a default, with a comment explaining why: the current language can already differ from the one that constructed the service, so the first frame must always apply.

**Example — three languages, two shapes**

```
Sarvam (aggregatable) serves hi, bn, ta:
    ONE service, ONE websocket, one gate holding all three configs
    language change → update_language_config(), no reconnect

Cartesia (not aggregatable) serves en:
    its own branch, its own websocket, single-language gate
```

**Capacity resolution runs first**

Before any of the grouping, `resolve_tts_configs_by_capacity()` decides which vendor each language actually lands on, given configured fallbacks and current concurrency. Redis keys are handed back to the config manager so the reservation can be released at cleanup — and `PipelineConfigManager.cleanup()` releases capacity **first and unconditionally**, before anything that could block or raise. Leaking a capacity slot means turning away a later call for no reason.

## Playout

*Speaking · 22*

**Definition**

Getting audio out of the pipeline and into the caller's ear — and knowing when it has actually arrived, which is not the same as having sent it.

**How it works — two opposite operations on the same buffer**

```
_clear_audio_buffer()      throw away queued audio    (barge-in)
_wait_for_audio_playout()  wait for queued audio      (hangup)
```

Both exist because LiveKit's `AudioSource` holds up to about a second of audio you have already handed over.

**On interruption** — clear it, or the bot keeps talking for a second after being told to stop. Called *before* `super().process_frame()`.

**On hangup or transfer** — wait for it, or the tail of the final sentence is clipped as the SIP participant is removed. Uses LiveKit's `wait_for_playout()`, with a 10-second timeout and warnings on timeout or cancellation.

**Example — why "goodbye" gets cut without the wait**

```
t=0.0  TTS generates "Thanks for calling, goodbye."  (2.1s of audio)
       → all of it handed to LiveKit in ~200 ms
t=0.2  HangupFrame reaches transport output
       → without the wait: remove SIP participant NOW
         caller heard 0.2s of a 2.1s sentence

with _wait_for_audio_playout():
t=2.1  queue drained → then remove participant
```

The log line `"Waiting for audio playout before hangup queued_duration=2.100s"` fires whenever more than 50 ms is queued.

## Idle detection

*Watching · 23*

**Definition**

Noticing the caller has gone quiet and doing something about it — nudge, nudge harder, then hang up. Without it, an abandoned call holds a line and a licence indefinitely.

**How it works — base and subclass**

`UserIdleProcessor` runs a timer that any activity frame resets:

```python
async def _idle_task_handler(self):
    while running:
        try:
            await asyncio.wait_for(self._idle_event.wait(), timeout=self._timeout)
        except asyncio.TimeoutError:
            if not self._interrupted:
                self._retry_count += 1
                running = await self._callback(self, self._retry_count)
        finally:
            self._idle_event.clear()
```

The callback returning `False` ends monitoring. Note it only starts on the *first* conversation activity — so ringing and setup don't trigger it.

`ModUserIdleProcessor` then changes four behaviours, each with a stated reason.

**The most interesting override: bare VAD does not count**

> "Resets retry count only on confirmed user activity: transcription or DTMF. Bare VAD (`UserStartedSpeakingFrame`) is intentionally ignored because transport VAD trips on background noise (breathing, handset rustle) and resetting retries on those phantom-speech events would prevent the idle hangup branch from ever firing."

A caller who set the phone down still produces VAD events. The base class would reset the escalation counter forever and the call would never end. **Requiring a transcript is the fix** — noise doesn't transcribe.

**The other three overrides**

- `_outbound_call_waiting` — Pauses everything while an outbound call is ringing. Ringback tones trip VAD.
- `_terminated` — Once hangup or transfer has happened, all frames pass through untouched. Prevents an idle nudge racing a goodbye.
- `_await_action` / `action_timeout` — When the LLM signals via `EnterAwaitActionFrame` that the caller is doing something on their device, the window extends to `action_timeout`. Someone opening an app should not be nudged at 8 seconds.

Function calls also suspend the timer — `FunctionCallInProgressFrame` sets `_interrupted = True` — because a slow integration is not an idle caller.

**The production bug preserved in this file's comments**

The idle nudge is a third-person instruction: *"The user has been quiet. Politely ask..."* Which role should it be injected as?

> "On the LiveKit gateway (Gemini) it was injected as a `user` turn, where it sits at the tail as a repeatable n-gram; greedy decoding (temperature=0) then loops on it verbatim — the production runaway where the bot reads the nudge text aloud forever instead of replying."

```python
if   llm_vendor_name == "OPENAI":  role = "system"
elif llm_vendor_name == "LIVEKIT": role = "assistant"
else:                              role = "user"
```

Framing it as an `assistant` turn makes it read as the model's own internal note, so the natural continuation is a spoken reply rather than a repetition. Verified by replay (`scripts/replay_haywire_llm.py`), deterministic across runs.

**This is one of the best stories in the codebase** — a user-visible catastrophe whose root cause was a single message role interacting with greedy decoding. Worth being able to tell.

**Example — the escalation**

```
bot stops speaking → timer starts
+8s   retry 1  "The user has been quiet. Politely ask if they're still there."
               → LLMMessagesUpdateFrame(run_llm=True)
               → plus LLMRequestStartFrame or TranscriptionFinalizedFrame
                 upstream, depending on smart_turn_enabled
+8s   retry 2  "The user is still inactive. Ask if they'd like to continue."
+8s   retry 3  → callback returns False → hang up

any transcription or DTMF at any point → retry_count = 0
```

The extra upstream frame matters: it's the cue that unmutes STT, and which frame to send depends on which mute strategy is active (§7).

## How the recording gets saved

*Watching · 24*

**Definition**

A two-channel WAV of the call — caller on one channel, bot on the other — written during the call and uploaded to S3 at the end.

**How it works — the write path**

```python
ModAudioLengthBufferProcessor(
    interaction_uuid = str(interaction.uuid),
    recording_dir    = <repo>/recordings,
    config_manager   = ...,
    num_channels     = 2,
)
→ filename = f"{interaction_uuid}.wav"
```

An `on_audio_data` event handler writes frames as they arrive:

```python
if self.wav_file is None:
    self.wav_file = wave.open(self.filepath, "wb")
    self.wav_file.setnchannels(num_channels)
    self.wav_file.setsampwidth(2)        # 16-bit
    self.wav_file.setframerate(sample_rate)
self.wav_file.writeframes(audio)
```

Lazy open, on the first audio — so a call that produces nothing leaves no empty file.

**Redaction — pausing the recording mid-call**

```
StartRedactedTurnFrame → self.stop_recording()
StopRedactedTurnFrame  → self.start_recording()
```

While a caller reads out a card number, recording stops entirely. Not bleeped afterwards — **never captured**. The only version of this that's actually safe, since a redaction step that runs later can fail.

**The cleanup path, in order**

```
1. stop_recording()
2. await super().cleanup()   ← flush pending on_audio_data handlers
3. wav_file.close()
4. upload_osv_audio_recording_to_s3()
5. if upload_success: os.remove(filepath)
```

Step 2 has a comment: `stop_recording()` *schedules* the flush but doesn't await it. Closing the file first would truncate the tail. It's wrapped in its own try/except so a flush failure still lets the file close.

Step 5 only deletes on success — a failed upload leaves the file on disk to be recovered rather than silently losing the call.

**Why cleanup ordering matters beyond this file**

> "Runs during pipeline cleanup, which the handlers invoke BEFORE dispatching post-call events — so `call_audio_url` is already set (and committed) by the time the post-call worker reads the interaction."

A cross-process ordering guarantee expressed as a comment. Move the upload later and the post-call worker reads a row with no audio URL — and it will not obviously fail, it will just quietly process a call with no recording.

**Why there are two recorder subclasses**

Both share `BaseModAudioBufferProcessor` for WAV writing, redaction and upload. They differ only in how the two tracks are kept aligned:

| Class | Sync | Used when |
|---|---|---|
| `ModAudioBufferProcessor` | Time-based | Barge-in disabled |
| `ModAudioLengthBufferProcessor` | Position-based | Barge-in enabled |

The problem being solved: the two tracks fill at different rates — the mic delivers continuously, the bot track only while speaking. Something must pad the silent track so they stay aligned, and the choice of *clock* for that padding is the entire design question.

**Wall-clock is wrong** — a GC pause makes it pad audio that never existed. **The other track's length is wrong** — bursty vendor delivery makes it over-pad. **The mic sample count is right**: it advances at exactly real time because the caller's audio arrives in real time, and it's what the position-based class uses. Which is also why §7's detail — feeding suppressed frames to the recorder — is load-bearing rather than incidental.

## Vendor metrics

*Watching · 25*

**Definition**

Per-vendor, per-stage latency measurement — how long ASR, LLM, TTS and API calls each took — plus the end-to-end number the caller actually experiences.

**How it works — an observer, not a processor**

`MetricsObserver` is a `BaseObserver`: it watches every frame push via `on_push_frame` without sitting in the pipeline. It can therefore see everything without being able to affect anything — the right shape for measurement.

Vendor attribution comes from a class-name lookup:

```python
def get_vendor_type_and_name(self, processor: str):
    if "#" in processor:
        processor = processor.split("#")[0]      # strip "#0" instance suffix
    return service_mappings.get(processor, (None, None))
```

```
"ModCartesiaTTSService"   → ("TTS", "CARTESIA")
"ModDeepgramSTTService"   → ("STT", "DEEPGRAM")
"ModCerebrasLLMService"   → ("LLM", "CEREBRAS")
"IntegrationToolService"  → ("API", "INTEGRATION_TOOL")
```

So a `TTFBMetricsData` frame from any service is labelled by vendor and stage automatically.

**The headline metric, and its refinement**

**User-perceived latency** — from the caller stopping to the bot starting. The only number that corresponds to the experience.

**Adjusted user-perceived latency** — the same, minus external API time. This exists because a 3-second CRM call is not a regression in *your* system, and mixing the two makes your own performance untrackable. `_turn_api_latencies` accumulates per turn and is subtracted.

**The hard part: which timestamp counts as "the user stopped"**

The class docstring enumerates **ten distinct frame orderings**, and this is the most valuable thing in the file. Three examples:

```
1.  USF → IF → IF → UStopF → IF → TF     normal: use VAD timing
2.  USF → IF → IF → TF → UStopF          late VAD: use interim timing
3.  IF → IF → TF                         VAD bypass: use interim timing
9.  USF → UStopF → [nothing]             failed attempt: close session
```

The solution is **session tracking**: a session opens on `UserStartedSpeaking` or the first interim, closes on a final transcription or on `UserStoppedSpeaking` if no interim arrived. `_get_best_user_stop_timing()` then picks the best available source and records `_user_stopped_timing_source` alongside it.

Without sessions, a failed speech attempt leaves a stale VAD timestamp that corrupts the *next* turn's latency — and the resulting metric is wrong in a way that looks plausible.

**Also tracked**

- Active call counts (gauge) — `_handle_call_start` / `_handle_call_end`.
- Initial greeting latency, tracked separately via `_initial_greeting_tracked` — it has no user turn before it, so including it would skew every average.
- OpenTelemetry trace ID and a Tempo search URL, logged once per call, so a log line leads straight to the distributed trace.

Prometheus metric definitions live centrally in `app/instruments/metrics.py`.

## Hangup and transfer

*Ending · 26*

**Definition**

Ending the call, or handing it to a human. Transfer comes in two shapes: **SIP-level** (tell the carrier to redirect) and **bridge** (dial a second agent into the same room, then remove the bot).

**How it works**

Both start as an LLM tag, converted by the tag processor into a `HangupFrame` or `TransferFrame`. At `ModLiveKitOutputTransport`:

```python
if isinstance(frame, (HangupFrame, TransferFrame)):
    await self._wait_for_audio_playout()          # don't clip the goodbye
    await self._transport.request_call_end(reason, transfer_attrs)
```

`LiveKitSession._handle_bridge_transfer` then runs the harder path: dial the agent, wait for them to join (`BRIDGE_TRANSFER_AGENT_TIMEOUT`, default 60 s), swap participants (`BRIDGE_TRANSFER_SWAP_TIMEOUT`, default 5 s), remove the bot — and `_rollback_agent` if it fails, so a failed transfer returns the caller to the bot rather than dropping them.

**Cleanup order in `PipelineConfigManager.cleanup()`**

```
1. release ASR + TTS capacity     ← FIRST, unconditionally
2. ... everything else
```

The comment: it must run before anything that can block or raise. A leaked capacity slot turns away a future call forever, which is a worse failure than anything else in the cleanup path.

`_finalize_call()` then writes the final status, and `_send_to_kinesis()` reports dial results for outbound campaigns.

## Compliance

*Ending · 27*

**Definition**

Checking, after the call, whether it broke any rules. In collections and financial services these rules are legal requirements with real penalties, which is why this is a first-class subsystem rather than a report.

**How it works**

`CallComplianceAuditor.audit_call_compliance()` is deliberately **rule-based with no external API calls** — the class docstring says so. Fast, deterministic, explainable, and defensible to a regulator in a way an LLM judgement is not.

Three checks, each independently toggleable:

| Check | Question |
|---|---|
| `business_hours_check` | Was the call placed inside permitted calling hours? |
| `check_unauthenticated_reveals` | Was debt information disclosed before identity was verified? |
| `check_blocking_disposition` | Did the call continue past a disposition that should have stopped it? |

Note the second check's method name: `_check_unauthenticated_reveals_via_dispositions`. It reasons over the **disposition trace** — the sequence of states the flow passed through — not over the transcript text. Far more reliable: dispositions are structured facts the flow recorded, whereas a transcript is ASR output with errors in it.

**Example — the response shape**

```json
{
  "audit_timestamp": "2026-08-23T09:14:02Z",
  "status": "completed",              // or "disabled" | "error"
  "total_violations": 1,
  "results": {
    "business_hours_compliance": {"violation_found": true,  ...},
    "unauthenticated_reveals":   {"violation_found": false, ...},
    "blocking_disposition":      {"violation_found": false, ...}
  },
  "processing_time_seconds": 0.003,
  "error": null
}
```

Three status values, not two. `"disabled"` is distinct from `"completed"` with zero violations — "we didn't check" must never be recorded as "we checked and it was clean". A small distinction that would matter enormously in an audit.

**Watch out — the whole thing is wrapped in try/except**

Any exception returns `status: "error"` with `total_violations: None`. Fail-open, and correctly so: a crashing auditor must not break post-call processing. But it means **`None` violations is not zero violations**, and anything consuming this has to distinguish them or it will report clean calls that were never audited.

## Providers wired in

*Reference · 28*

From `get_vendor_type_and_name` and `services/` — the real list.

| Stage | Providers |
|---|---|
| **ASR** | Deepgram, Azure, Google, Sarvam, Parakeet, Soniox |
| **TTS** | Cartesia, ElevenLabs, Azure, Google, SmallestAI, Rime, Sarvam, Hume, xAI, Baseten, Magpie |
| **LLM** | OpenAI, Azure, Google, Gemini Live, Cerebras, AWS Bedrock, Groq, OpenRouter, DeepInfra, Modal, LiveKit |
| **API** | IntegrationTool |

**The pattern behind all of them**

`ServiceFactory.create_from_config(config, ProviderType.X)` takes a database row and returns a service. There is **no vendor name in the pipeline code** — `create_pipeline()` never mentions Cartesia or Deepgram. Adding a provider means adding a `_create_*_service` method and a row; changing one means changing a row.

The `Mod` prefix is the convention for a subclassed Pipecat service. When you see `ModCartesiaTTSService`, expect an override with a comment explaining exactly which vendor behaviour it is working around.

## Where to breakpoint

*Reference · 29*

| Symptom | Look here first |
|---|---|
| Bot misunderstood | `TranscriptionFrame` at the ASR gate — before blaming the LLM |
| Bot cut me off | `DynamicVadController._commit()`, or the smart-turn verdict log |
| Long pause before reply | Endpointing decision, then TTFB metrics per vendor |
| Bot ignored my interruption | `_maybe_interrupt_from_interim` — did the word count pass? |
| Bot kept talking after interruption | `_clear_audio_buffer` — was it called, what was queued? |
| Bot referenced something it never said | `BargeInSpokenTextFrame` vs generated text in the assistant aggregator |
| Wrong language | `config_manager.get_current_language()` at the gates |
| Goodbye clipped | `_wait_for_audio_playout` — queued duration in the log |
| Recording out of sync | Pad events in the recorder, and whether the mic clock kept advancing |
| No recording at all | Cleanup order, and `upload_success` before the `os.remove` |
| Idle never fires | Whether bare VAD is resetting `retry_count` |
| Bot loops on the same line | Idle-nudge message role for this vendor |
| Filler never plays | Mode, and whether the tier lookup found config for this language |
| API tool failed silently | `_create_error_message` — the error is a string, so grep the transcript |

**The two universal starting points**

**Every log line carries `call_uuid`, `client_uuid` and `worker_pid`** via contextvars read inside the slog formatter. One call's whole story is one filter away.

**But slog lowercases messages and redacts numeric and hex values.** A grep for `RECSYNC` returns nothing because the message was lowercased, and UUIDs and floats come back as `****`. Match case-insensitively, and match on unredacted prefixes. This has broken more than one log parser, including mine.

## Interview answers

*Reference · 30*

**Q — Walk me through a call in your system.**

"A carrier bridges the PSTN call into a LiveKit room over SIP, and our agent joins as a participant — so there's no direct connection, the room forwards audio both ways. Audio arrives at 8 kHz, goes through Krisp noise suppression, and enters a Pipecat pipeline built per call.

Downstream: an STT mute filter that can suppress audio, then parallel ASR branches — one per vendor and language — with gates that only pass the branch matching the current language. Then DTMF, idle detection, and the user context aggregator, which decides when the turn is complete and commits it to LLM context.

The LLM generates, possibly calling tools — integrations are configured HTTP chains where the model picks *which* integration but never the URL. Then a DB writer persists the turn, a tag processor strips control tags before they can be spoken, and parallel TTS branches synthesise. TTS starts at the first complete sentence rather than the first token, so audio starts in a few hundred milliseconds.

Output goes to the transport, then to the recorder — deliberately after output, so it records what was actually sent — and finally the assistant aggregator records what was actually spoken, which matters on a barge-in.

The thing I'd emphasise is that order *is* behaviour. Several processor positions are load-bearing and commented as such."

**Q — How does barge-in work?**

Lead with the part nobody mentions.

"Three layers. Detection — VAD sees speech during bot playback. Gating — we don't interrupt on any speech, because coughs and background TV would stop the bot constantly. There's a minimum word count checked against the interim transcript, with a whitelist of words like 'stop' and 'wait' that bypass it, and a safety net that re-checks on the final transcript for ASR providers with unreliable interims.

Then there's a third piece people forget: if the utterance was sub-threshold, we don't just decline to interrupt, we *drop the turn entirely*. Otherwise the bot finishes its sentence and then replies to 'mm-hmm'.

On an actual interruption, the ordering matters. We clear LiveKit's audio buffer *before* processing the frame further — TTS runs ahead of real time so up to a second is already queued inside LiveKit, and stopping the generator does nothing.

And the part I think is most important: we truncate the context to what was actually *heard*. The TTS emits a frame carrying the spoken text, estimated from a vendor completion signal or from elapsed time times characters-per-second. If you record all thirty generated words when the caller heard six, the model believes it said things they never heard and every later turn is built on that."

**Q — How do you decide the user has finished speaking?**

"Two mechanisms, and one is unusually cheap.

Dynamic VAD adjusts the silence threshold based on the last character of the interim transcript. Ends in punctuation — completed sentence, shorten it. Ends in a digit — they're mid-number, lengthen it. Anything else, default. It costs nothing, needs no model, and it fixes the specific case that hurts most: someone reading an account number aloud getting cut off.

Then there's smart turn, which is a bundled ONNX model classifying the utterance as complete or incomplete from the audio. That gives you a much shorter silence timer without cutting people off, which is the biggest latency lever in the pipeline.

One real bug worth mentioning: our ASR services push finals without the finalized flag, and the parent strategy only re-checked on finalized transcripts. So when the VAD threshold exceeded the ASR's p99, a slow final would sit until a five-second stop timeout. The fix is a re-check on non-finalized frames — a no-op unless the model already said complete and the timeout elapsed. It presented as 'sometimes the bot takes five seconds', which averages hide completely."

**Q — How do you support multiple languages in one call?**

"Parallel branches with gates rather than reconnecting.

Every ASR vendor runs in its own branch and transcribes all the audio all the time. A gate at the end of each branch checks the current language and either passes the transcript or drops it. Switching language is a config change, not a connection change, so it takes effect on the next utterance with no reconnect latency.

The cost is honest: you pay every vendor for the whole call and throw most of it away. That's why there's capacity resolution and Redis concurrency keys around it — connections are a tracked resource.

TTS has the same shape plus one optimisation. A vendor whose per-language settings are per-request implements `update_language_config`, and then one service serves all its languages over a single websocket — the gate applies the right config lazily, on the frame that reveals the change. The capability check is `hasattr` on the method itself, so it can't drift out of sync with what the service actually supports."

**Q — What happens if a vendor gets slow mid-call?**

"For the LLM there's an automatic switch. TTFB above a threshold — 1.5 seconds by default — counts a strike, and two consecutive strikes switch to the next healthy service.

Two design choices I'd call out. Only one latency switch per session by default, because otherwise a system under general load flaps between two equally degraded vendors and you lose the warm connection every time. And errors are handled separately from latency: an error takes the next candidate unconditionally, because a broken service is strictly worse for the user than a slow one, so latency strikes shouldn't disqualify a fallback.

If everything is degraded it logs and stays put, which is right — switching to something equally bad costs a connection for nothing."

**Q — How is the call recording produced?**

"A stereo WAV — caller on one channel, bot on the other — written incrementally by a processor placed after the transport output, so it captures what was actually sent rather than what was generated.

At cleanup: stop recording, flush pending handlers, close the file, upload to S3, and delete locally only if the upload succeeded. The flush step matters because `stop_recording` schedules it without awaiting, so closing first truncates the tail.

Redaction pauses recording entirely between two frames, so card numbers are never captured rather than being removed afterwards.

The interesting part is track alignment. The two tracks fill at different rates — the mic continuously, the bot only while speaking — so the silent track has to be padded. The clock you pad against is the whole design question. Wall-clock is wrong because a GC pause invents audio. The other track's length is wrong because bursty vendor delivery over-pads. The mic sample count is right, because caller audio arrives in real time by definition. That's also why suppressed audio frames are still fed to the recorder when barge-in is off — drop them and the clock stops."

**Q — Tell me about a production bug you found.**

The idle-nudge one is the best story here.

"The bot would occasionally get stuck reading its own internal instruction aloud, over and over. The idle nudge is a third-person instruction — 'The user has been quiet, politely ask if they're still there' — and on one gateway it was being injected as a *user* turn.

Sitting at the tail of the context as a repeatable n-gram, with greedy decoding at temperature zero, the most likely continuation became repeating it verbatim. So the bot read the stage direction out loud, forever.

The fix was the message role. Injected as an assistant turn it reads as the model's own note, so the natural continuation is a real reply. We verified it by replaying the actual haywire transcript both ways — deterministic loop with the user role, clean reply with assistant.

What I took from it is that message role is a real parameter with behavioural consequences, not just metadata — and that replaying a real failing transcript is worth more than reasoning about what the model should do."

## Glossary

*Reference · 31*

- **Frame** — A typed message travelling through the pipeline.
- **Processor** — A pipeline stage that receives frames and pushes them on.
- **Upstream / downstream** — Toward the microphone / toward the caller's ear.
- **ParallelPipeline** — Runs several sub-pipelines over the same frames.
- **Gate** — A processor that drops frames unless a condition holds.
- **Transport** — The audio in/out boundary. LiveKit or gRPC.
- **Room / track / participant** — LiveKit's model: a space, a stream, a member.
- **VAD** — Is this frame speech? Nothing about words.
- **stop_secs** — Silence before VAD declares speech ended.
- **Endpointing** — Deciding the user's turn is over.
- **Dynamic VAD** — Adjusting `stop_secs` from the transcript's last character.
- **Smart turn** — An ONNX model classifying turn completeness.
- **Turn strategy** — Pluggable start/stop turn decision.
- **Aggregator** — Builds a turn from fragments and commits it to context.
- **Barge-in** — Caller interrupts the bot.
- **Min-words gating** — Only interrupt past a word count.
- **BargeInSpokenTextFrame** — What was actually heard, for context truncation.
- **STT mute filter** — Suppresses audio before ASR.
- **Interim / final** — Provisional vs settled transcript.
- **Sentence aggregation** — Batching LLM text into TTS-sized units.
- **TTSSpeakFrame** — Speak this now, bypassing aggregation.
- **Aggregatable TTS** — Implements `update_language_config`; one connection, many languages.
- **Filler word** — Short utterance covering a wait.
- **Tag** — LLM-emitted control marker, stripped before TTS.
- **Integration** — Configured HTTP call the model can invoke.
- **Guardrail** — Rule blocking a `set_variable` call.
- **Disposition** — A recorded outcome state; what compliance reasons over.
- **Module** — A node in the conversation flow.
- **Idle detection** — Nudge then hang up on a silent caller.
- **TTFB** — Time to first byte, per vendor.
- **Observer** — Watches frames without being in the pipeline.
- **Bridge transfer** — Dial a human into the room, remove the bot.
- **Capacity keys** — Redis-tracked vendor concurrency reservations.

---

*Written from the code in `app/runtime/voice/`, `app/llm/` and `app/models/configs.py`. Line numbers drift; class and method names are the durable handle.*

*Companion documents: voice runtime from zero · pipecat upgrade · telephony · NLP stack · inside a language model · retrieval end to end · the LangChain stack · CI/CD · distributed systems · Vasco stack.*
