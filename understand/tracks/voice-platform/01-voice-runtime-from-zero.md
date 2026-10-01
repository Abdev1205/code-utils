# Voice Runtime From Zero

**Topic:** This repo
**Covers:** System design of orchestrator-service, explained from nothing
**Source:** [Claude artifact](https://claude.ai/artifact/48xZPNaZg9ChKYw79ANCPp) — written by a colleague, mirrored here for study.

*Explained from nothing · voice pipeline*

This assumes you know Python and nothing else. Every term is defined the first time it appears. Each concept gets: what it is, what problem it solves, how ours works, what the alternatives were, what an interviewer will ask, and where to put a breakpoint.

**How to read this**

Read foundations in order — sections 1 to 3 build on each other and nothing later makes sense without them. After that you can jump around.

The green boxes are how to test and debug. The blue boxes are alternatives — what else exists in the world and why we didn't use it. The Q boxes are interview questions with answers.

## What is this system?

*Foundations · 01*

A person picks up a phone and calls a bank. A computer answers. They have a conversation — the person speaks normally, the computer understands, answers, asks questions, looks up their account, and handles the whole call. No human involved.

That's it. That's the product. This repository is the computer's side of that.

### Why it's hard

Not because any single piece is hard. Speech recognition is a solved product you can buy. So is speech synthesis. So is the language model. You can wire all three together in an afternoon.

It's hard because of **time**.

In a real conversation, when you stop talking, the other person starts within about a fifth of a second. If they take longer than about half a second, you notice. If they take a second, you say "hello? are you there?"

So the computer has roughly **800 milliseconds** — 0.8 seconds — to do all of this:

1. Notice that you stopped talking
2. Turn your speech into text
3. Send that text to a language model and get a reply
4. Turn that reply into speech
5. Send the audio back down the phone line

Each of those steps involves a network call to a different company's servers. That is the entire engineering problem, and almost everything in this repository exists because of it.

**The three runtimes in this repo**

The same product also works over text, so the repo holds three programs that share the same brain:

- **Interface** — A REST API. This is where humans configure the bots — write prompts, pick voices, define conversation flows. No calls happen here. Runs on port 8000.
- **Text runtime** — SMS, email and web chat. Same LLM logic, no audio, no deadline. Port 8001.
- **Voice runtime** — Real-time phone calls. This is the complicated one and the subject of this document. Port 8080.

**Q: Why not just use ChatGPT's voice mode?**

Because a business voice agent needs things a general assistant doesn't: it has to connect to the actual phone network so real customers can dial a real number; it has to look up that specific caller's account mid-conversation; it has to be constrained so it can never promise something the business won't honour; it has to be recorded and auditable for compliance; and it has to hand over to a human when it fails.

The conversation is the easy 20%. The other 80% is telephony, integrations, guardrails, and compliance.

## What is digital sound?

*Foundations · 02*

You cannot understand any bug in this system without this section. It is short.

**Sound is a list of numbers**

A microphone measures air pressure. Many times per second, it writes down a number for how much the air is being pushed. That's all a recording is: a very long list of numbers.

**Sample rate** is how many numbers per second. Phone calls use **8,000** per second. Each number takes 2 bytes of memory.

So for phone audio:

```
1 second of sound  =  8,000 numbers  =  16,000 bytes
```

This gives you the single most important equation in the whole system:

```
position in the list  ⟷  time

the number at position 8,000   is what was heard at the 1-second mark
the number at position 80,000  is what was heard at the 10-second mark
```

The number `0` means silence — no air movement at all.

### Why this matters

Every audio bug in this system is a bug about **putting a number in the wrong position**. If audio that happened at second 3 gets written at position 80,000, it will play back at second 10. That's it. That's what "out of sync" means, and what "glitch" means (a run of zeros written where speech should be).

**Audio arrives in small packets**

The audio doesn't arrive one number at a time. It arrives in chunks of **20 milliseconds** — 160 numbers, 320 bytes. Fifty of these arrive every second, forever, for the whole call, whether the person is talking or silent.

That constant drumbeat is important later: **because the microphone always sends exactly 50 packets per second, counting packets is a way of telling the time.** Remember that.

**Alternatives: why 8,000 and not something better?**

8 kHz sounds bad. Music is 44,100. Modern voice apps use 16,000 or 48,000. So why?

Because the telephone network is old and standardised on it. A call from a landline is 8 kHz before it ever reaches us — we can't invent detail that was never captured. Upsampling to 16 kHz for a model that wants 16 kHz is possible (and this repo does resample), but it adds no real information.

Web calls through a browser *can* be higher quality, which is why you'll see 16000 and 22050 in the code too.

**Q: A recording is 8.2% longer than the call really was. What does that tell you?**

That something wrote numbers into the list that don't correspond to time that passed — almost always silence padding inserted by mistake. Since position equals time, extra numbers mean the recording claims more time elapsed than actually did, and everything after the insertion point is shifted late.

This is a real bug that was found and fixed in this repo. The recorder was inserting silence into the caller's track every time the bot's audio buffer got slightly ahead — 588 times in one call, 21 seconds of silence total.

## One second of a call

*Foundations · 03*

Here is everything that happens, in order, when a caller says "my account number is four seven two" and the bot replies.

```
THE CALLER SPEAKS
  │
  ├─ their phone turns their voice into audio packets
  ├─ the phone network carries them to a company called LiveKit
  ├─ LiveKit forwards them to our program, 50 packets per second
  │
OUR PROGRAM RECEIVES THEM
  │
  ├─ VAD asks "is this speech or background noise?"
  ├─ packets are streamed to Deepgram, which returns text as it goes
  │     "my" ... "my account" ... "my account number is four seven two"
  │
  ├─ ENDPOINTING decides: have they finished their sentence?
  │     ← this decision is the hardest one in the system
  │
  ├─ the finished text is added to the conversation history
  ├─ the whole history goes to the language model
  ├─ the model streams back words: "Thank" "you" "." "Let" "me" "check"
  │
  ├─ as soon as one full sentence exists, it is sent to the TTS vendor
  ├─ TTS returns audio numbers
  │
  ├─ those numbers go out to LiveKit → the phone network → the caller's ear
  └─ a copy is written into the recording file
```

Two details in that diagram do most of the work.

**Streaming.** Nothing waits for the previous step to finish completely. Deepgram gives partial text while the person is still talking. The model gives words as it thinks. TTS starts speaking sentence one while the model is still writing sentence two. Without this overlap the delays would add up to three seconds and the product wouldn't work.

**The recorder is last.** The copy for the recording is taken *after* the audio has been handed to the network — so the recording contains exactly what the caller heard, not what we intended to say.

**See this for yourself**

Run the voice server and make a call, then read the log. Every stage announces itself:

```bash
infisical run -- python main.py --mode voice --port 8080 --transport livekit
```

Grep for these to watch one turn go past:

```bash
grep -E "user started speaking|transcript|ttfb|generating .* tts|bot started speaking" voice.log
```

## What is Pipecat?

*The framework · 04*

**What it is**

Pipecat is an open-source Python framework for building real-time voice agents. It is the skeleton this repo hangs on. Think of it as providing the conveyor belt and the sockets; we provide the workers that stand along it and the business logic they run.

### What problem it solves

If you wired STT, an LLM and TTS together yourself, you'd write the easy version in a day. Then you'd spend six months discovering:

- the caller interrupts and you need to stop the TTS *and* throw away audio already queued *and* correct the conversation history
- audio must keep flowing at exactly 50 packets a second, so nothing anywhere may block
- every vendor has a different streaming API, and you want to swap them without rewriting
- shutting down cleanly mid-sentence is genuinely hard

Pipecat has already solved those. That's the value.

**Alternatives — what else could we have built on?**

| Option | What it is | Trade-off |
| --- | --- | --- |
| **Pipecat** (chosen) | Open-source Python framework, vendor-neutral | You own the plumbing; breaking releases are your problem. Full control. |
| **LiveKit Agents** | Similar framework from the company whose media layer we already use | Tighter LiveKit integration, but ties you to their stack. We actually use it *alongside* pipecat for the telephony side. |
| **Vapi / Retell / Bland** | Fully managed "voice agent as an API" products | Fastest to launch, but you can't control latency internals, can't self-host models, and per-minute pricing gets brutal at scale. Impossible for enterprise on-prem requirements. |
| **OpenAI Realtime API** | One model does speech-to-speech directly, no STT/LLM/TTS split | Lower latency and more natural, but one vendor, hard to constrain, hard to audit, and you lose the text transcript layer that compliance needs. This repo *does* support it as an option. |
| **Build from scratch** | Raw websockets and asyncio | Total control, six months of other people's solved problems. |

The deciding factor for a company selling to banks: **vendor neutrality and self-hosting**. A managed product can't be deployed inside a bank's private network, and can't swap in a cheaper model when the bill grows.

**Q: Why not use a single speech-to-speech model instead of three separate models?**

Speech-to-speech is genuinely lower latency and sounds more natural — no text bottleneck in the middle. But three things push against it for a business product:

- **Control.** With a text LLM in the middle you can inspect, constrain and rewrite what it's about to say. With speech-to-speech the decision and the voice are the same step.
- **Compliance.** You need a text transcript of every call. Deriving one after the fact from generated audio is worse than having it natively.
- **Vendor lock-in.** One provider, one price, no fallback if they have an outage.

The honest answer is it's a real trade and the industry hasn't settled it. This repo supports both.

## Frames

*The framework · 05*

**What it is**

A **frame** is a small box travelling along the conveyor belt. Inside is one thing: 20 ms of audio, or a piece of text, or an announcement like "the bot started speaking".

Everything moving through the system is a frame. There is nothing else.

The ones you'll meet constantly:

| Frame | What's inside |
| --- | --- |
| `InputAudioRawFrame` | 20 ms of the caller's voice |
| `OutputAudioRawFrame` | audio of the bot's voice, heading out |
| `TranscriptionFrame` | text that Deepgram produced |
| `LLMTextFrame` | a word or two the model just generated |
| `UserStartedSpeakingFrame` | an announcement — the caller began talking |
| `BotStartedSpeakingFrame` | an announcement — bot audio started playing |
| `CancelFrame` | an order — stop everything, the call is over |

### Two directions

Frames travel **downstream** (toward the caller's ear) or **upstream** (back toward the microphone).

Upstream exists for interruptions. A worker near the bottom of the belt notices the caller has started talking and shouts back up: *stop generating, stop speaking, throw it away.*

### Three classes of frame, and why it matters

| Class | Behaviour | Example |
| --- | --- | --- |
| **DataFrame** | waits its turn in the queue | audio, text |
| **ControlFrame** | waits its turn, but signals rather than carries | `EndFrame` |
| **SystemFrame** | **jumps the queue**, processed immediately | `CancelFrame`, `StartFrame` |

SystemFrames jump the queue because "stop now" is useless if it has to wait behind three seconds of queued audio.

**The consequence that bites people**

Because SystemFrames skip the queue, one can arrive *before* the `StartFrame` that says "the pipeline is now running". Code that assumes it's started will throw confusing errors. In this repo, custom processors inside a parallel pipeline return early for `MetricsFrame` before calling the parent, specifically to dodge this.

**How to see frames going past**

There's an observer built for exactly this: `app/runtime/voice/observers/debug_observer.py`. It logs every frame with its source, destination and timestamp:

```
⚡ cancelframe#0: parallelpipeline#1 → modlivekitoutputtransport#0 at 17.76s
```

**Breakpoint:** to catch one specific frame type, put a conditional breakpoint in your processor's `process_frame`:

```python
async def process_frame(self, frame, direction):
    if isinstance(frame, BotStartedSpeakingFrame):
        breakpoint()          # only stops on that frame type
    await super().process_frame(frame, direction)
```

**Warning:** a breakpoint in the audio path stops the world. Audio keeps arriving from the network and queues up; when you continue, everything is late and the call is ruined. Breakpoints are fine for *inspecting state*, useless for judging timing. For timing, log to memory and dump at the end — never log per frame during a call, which is itself enough to cause audible glitches.

**Q: Why a frame bus instead of just calling functions?**

Because every stage is streaming, concurrent, and cancellable at any instant. A function call stack can't express "the LLM is still generating while TTS is speaking sentence one and the user just interrupted". A queue of typed messages with an upstream cancel path can.

It also makes the system composable: adding a feature is adding a worker to the belt, not editing a central function.

## Processors

*The framework · 06*

**What it is**

A **processor** is a worker standing at one spot on the belt. Every frame passes through it. It can let the frame through, change it, throw it away, or create new frames.

All of them implement one method.

```python
class MyProcessor(FrameProcessor):
    async def process_frame(self, frame, direction):
        await super().process_frame(frame, direction)   # 1. always first

        if isinstance(frame, TranscriptionFrame):        # 2. do your thing
            print("caller said:", frame.text)

        await self.push_frame(frame, direction)          # 3. pass it along
```

Three rules, all learned the hard way:

- **Always call super() first** — It maintains the started/cancelled bookkeeping. Skipping it causes bugs that only appear during shutdown. In this repo, the audio recorder once overrode a parent method and accidentally disabled a safety check inside it — that single mistake caused every recording to be corrupted for months.
- **Not passing a frame on is a legitimate move** — That's how filters work. The mute filter swallows the caller's audio while the bot is talking, so it never reaches speech recognition.
- **Never block** — Audio arrives every 20 ms. If your processor awaits something slow, the whole belt stops and the caller hears a gap. Anything slow must be handed to a background task.

**How to test a processor**

In isolation, with hand-made frames. No network, no vendors:

```python
async def test_mute_filter_swallows_audio_while_bot_speaks():
    proc = ModSTTMuteFilter(...)
    await proc.process_frame(BotStartedSpeakingFrame(), DOWNSTREAM)
    await proc.process_frame(InputAudioRawFrame(audio=b"\x01\x02" * 160,
                                                sample_rate=8000, num_channels=1),
                             DOWNSTREAM)
    assert pushed == []      # the audio frame did not get through
```

The trick for anything timing-related: **express "time passing" by feeding microphone frames**, not by sleeping or faking a clock. 50 frames = 1 second. That's exactly what a real call does, and it makes the test instant and deterministic.

## The pipeline, step by step

*The framework · 07*

This is the actual list from `app/runtime/voice/pipeline/pipecat_bots.py`. Order is behaviour — moving a worker changes what it can see.

```
 1  transport.input()              audio arrives from the network
 2  gender_identification          guess caller gender from pitch
 3  stt_mute_filter                gate the mic while the bot talks
 4  asr_pipeline                   speech → text
 5  dtmf_processor                 keypad presses
 6  user_idle                      "are you still there?"
 7  user_input_transformer         clean up the text
 8  context_aggregator.user()      text → conversation history
 9  llm                            decide what to say
10  filler_words                   "let me check that for you…"
11  db_writer                      save the turn to the database
12  tag_processor                  strip <TRANSFER> etc. before speaking
13  tts_pipeline                   text → speech
14  transport.output()             audio goes to the network
15  audio_recorder                 write the recording
16  context_aggregator.assistant() save what the bot said
```

### Why two of these are where they are

**Gender identification is at position 2**, immediately after audio arrives. It has to be — it needs the raw, unfiltered voice. If it sat after the mute filter (position 3), the filter would have already swallowed the audio it needs.

**The recorder is at position 15**, after the audio has gone out. This means it records what the caller actually heard. If it sat before position 14, it would record audio that was generated but then cancelled by an interruption — words the caller never heard would appear in the recording.

**What "parallel pipeline" means (steps 4 and 13)**

Sometimes you want two workers to see the same frames at the same time. A `ParallelPipeline` splits the belt into branches that both receive every frame.

Used here for: multiple speech-recognition providers at once, multiple TTS providers, and voicemail detection — a second LLM that listens to the same audio purely to decide "is this an answering machine?", whose output is thrown away by a `FrameSinkProcessor` so it can never reach the speaker.

**Q: What happens if you move the recorder earlier in the pipeline?**

It records audio that was generated but never played. On an interruption, TTS produces a full sentence and the transport throws away the unplayed remainder. A recorder placed before the transport captures the whole sentence; the caller heard half of it.

You'd get recordings that disagree with reality — bad for compliance, and bad for debugging, because you'd be listening to something that never happened.

## STT — sound to words

*The three models · 08*

**What it is**

**STT** (speech to text), also called **ASR** (automatic speech recognition), turns audio into written words. We stream audio to a vendor's server and they stream text back.

Two kinds of result come back:

- **Interim** — A guess, produced while the person is still speaking. It changes as more audio arrives: "my" → "my a" → "my account". Fast but unreliable.
- **Final** — The vendor's committed answer for that stretch of speech. Slower, accurate.

We use interim results to react early (deciding whether an interruption is real) and final results to actually feed the model.

**Alternatives — the six we support and why**

| Provider | Why it's in the list |
| --- | --- |
| **Deepgram** | The default. Fast, good streaming, good on telephone-quality audio. |
| **Sarvam** | Indian languages. A US vendor will not do Hindi–English code-switching well. |
| **Azure** | Enterprise customers who already buy Microsoft and want data in their tenant. |
| **Google** | Language breadth. |
| **Soniox** | Accuracy on hard audio. |
| **Parakeet** | NVIDIA's model, self-hosted over gRPC — no per-minute fee, data never leaves. |

Not used: Whisper (excellent but not natively streaming — batch-oriented, so it adds latency), AssemblyAI (was supported, dropped in the pipecat 1.4.0 upgrade).

The reason there are six rather than one: **language coverage, price tiers, enterprise data-residency demands, and outage fallback.** No single vendor satisfies all four.

**Testing and breakpoints**

Tests exist per provider: `test_deepgram_asr.py`, `test_azure_asr.py`, `test_google_asr.py`, `test_parakeet_asr.py`. They feed fake vendor responses and assert the frames we emit.

```bash
pytest app/runtime/voice/tests/services/test_deepgram_asr.py -v
```

**Breakpoint:** `_on_message` in `services/deepgram.py` is where every vendor message lands. Put a conditional breakpoint there on `message.is_final` to catch only committed transcripts.

**Live check:** `grep -i transcript voice.log` shows what the vendor actually heard — usually the fastest way to prove "the bot misunderstood" is really "the STT misheard".

## LLM — the decision

*The three models · 09*

**What it is**

The language model gets the conversation so far plus a long instruction sheet (the **system prompt**) and produces the next thing to say. It can also decide to call a **tool** — a function that looks up a balance, books a slot, or transfers the call.

### What actually gets sent, every single turn

```
system prompt      the rules, persona, business logic — often thousands of words
tool definitions   what functions exist and their arguments
history            every turn so far
the new user text  what they just said
```

Notice that the first two never change during a call. Sending them again on every turn is pure waste — which is what **prompt caching** fixes: upload the unchanging part once, get a handle, send the handle plus the small changing part thereafter. The vendor charges much less for the cached portion.

**Alternatives — 11 LLM providers supported**

| Kind | Providers | Why you'd pick it |
| --- | --- | --- |
| Frontier, managed | OpenAI, Google Vertex, AWS Bedrock, Azure | Best quality, enterprise contracts, data residency |
| Speed-focused | Groq, Cerebras | Custom silicon — dramatically faster first token, which is what voice actually needs |
| Open-weight hosts | DeepInfra, OpenRouter, Modal | Cheap, model choice, self-host escape hatch |
| Media-adjacent | LiveKit | Inference next to the media layer, so fewer network hops |

For voice, the metric that matters is **time to first token**, not tokens per second. You start speaking the first sentence while the rest generates — so a model that begins fast beats a model that finishes fast.

**Q: Why is streaming essential here?**

Total generation time is identical either way. What streaming buys is *overlap*: as soon as the first complete sentence exists you hand it to TTS, so the caller starts hearing a reply while the model is still writing the rest.

The cost is commitment. Once the first sentence is being spoken you cannot take it back — so any check or guardrail that needs the whole response has to run before you speak, which is why sentence-splitting and processor order matter so much.

**Testing and breakpoints**

`test_openai_llm.py`, `test_google_vertex_llm.py`, `test_base_llm.py`. Mock the vendor, assert the frames.

**Breakpoint:** `app/llm/context_manager.py` is where the conversation history is assembled — the place to inspect exactly what the model is about to be told. If a bot is behaving strangely, 90% of the time the answer is visible in the assembled context.

**Live check:** Phoenix (the LLM tracing tool) shows the full prompt and response per turn without you adding any logging.

## TTS — words to sound

*The three models · 10*

**What it is**

**TTS** (text to speech) turns the model's words into audio. We send text, the vendor sends back a stream of numbers, and those numbers go down the phone line.

### The number that governs everything: TTFB

**Time to first byte** is how long the vendor takes to send the first piece of audio after receiving text. Not how long the whole sentence takes — just the first piece, because we start playing immediately.

Since a reply is several sentences and each is a separate request, we ask for the next sentence *before* the current one finishes playing, to hide the delay:

```python
remaining = audio_duration - elapsed - 0.450
```

In English: release the next request when there's 450 ms of the current sentence still playing. If the vendor answers within 450 ms, the caller hears a seamless join. If it's slower, the audio runs dry and the caller hears a gap.

**A real finding from this codebase**

That 450 ms is hard-coded identically in four services. Measured on real calls:

```
Cartesia   median TTFB 0.14 s   → always inside budget, sounds smooth
xAI        median TTFB 0.68 s   → over budget on ~3 sentences in 4, audible seams
```

It's a constant tuned for fast vendors and inherited by a slow one. The right fix is to make it adaptive from the latency we already measure, per vendor.

**Alternatives — 12 TTS providers, in three groups**

| Group | Providers | Trade-off |
| --- | --- | --- |
| Fast, managed | Cartesia, ElevenLabs, Rime, Hume, xAI, SmallestAI | Best quality and speed; per-character pricing that hurts at volume |
| Enterprise clouds | Azure, Google | Breadth, compliance, contracts already in place |
| Self-hosted | Baseten (Orpheus), Magpie (NVIDIA Riva) | Pay for GPU time, not characters. Cheaper at steady volume; you own uptime and cold starts |
| Regional | Sarvam | Indian-language voices that global vendors do poorly |

The self-hosted route cut TTS spend to roughly 30% of the managed bill — but only because there's enough steady traffic to keep a GPU busy. At low volume a managed API is cheaper, because a GPU costs money while idle and an API doesn't.

**Testing and breakpoints**

`test_cartesia_tts.py`, `test_azure_tts.py`, `test_elevenlabs_tts.py`, `test_google_tts.py`, `test_base_tts.py`, plus a shared fake-vendor helper.

**Breakpoint:** `run_tts()` in any service file — entry shows the text about to be spoken; the audio-receive handler shows chunks arriving.

**The rule that will save you:** never put a `sleep` or a breakpoint inside the websocket receive loop. That task is not cancelled on interruption, so it parks and the *next* reply gets seconds of dead air. Cancellable waiting belongs in `run_tts`.

**Live check:** `grep -E "ttfb|generating .* tts" voice.log` gives you the per-sentence latency directly.

## The latency budget

*The hard parts · 11*

Memorise this table. It's the single most useful thing in the document, and every optimisation in the repo traces back to a row in it.

| Stage | Typical | How it's reduced |
| --- | --- | --- |
| Endpointing — noticing they stopped | 100–500 ms | Semantic turn detection instead of fixed silence |
| STT final transcript | 100–300 ms | Streaming; act on interim results |
| LLM first token | 300–800 ms | Prompt caching, smaller/faster model |
| TTS first byte | 100–700 ms | Vendor choice — this varies 5× between vendors |
| Network | 50–150 ms | Run servers in the caller's region |

Those add up to more than 800 ms — which is why **they must overlap**. TTS starts on sentence one while the LLM writes sentence two. The LLM starts on an interim transcript before the final arrives.

Overlapping is the entire trick, and its price is that everything must be cancellable, because you're now doing work that might turn out to be wrong.

**How to measure it — per stage, not in total**

A total tells you the turn was slow. The breakdown tells you who to blame:

```
turn 1.9 s  =  STT 0.31  +  LLM 0.62  +  TTS 0.71  +  net 0.26
```

The system emits this automatically as OpenTelemetry spans, viewable in Grafana Tempo (per-stage timing) and Arize Phoenix (prompts and responses). Nothing to add — just look.

## Knowing when to speak

*The hard parts · 12*

**The problem**

How does a computer know you've finished your sentence? It can't see your face. All it has is audio.

### The naive answer: silence

**VAD** (voice activity detection) tells you whether the current 20 ms contains speech. So: no speech for 500 ms → they're done.

This is wrong in a specific, maddening way. **People pause mid-sentence.**

```
"My account number is …… four seven two"
                        ↑
              silence — but they are NOT finished
```

The bot barges in, talks over them, and gets a truncated sentence to answer.

### The better answer: semantic endpointing

**Smart turn detection** uses a small model that looks at the audio and the partial words, and asks: does this *sound and read* like a finished thought? "My account number is" is obviously unfinished, so keep waiting even through a long pause.

**The two errors, and their different costs**

**Too early** → you cut the caller off. Rude, and you also answer a half-sentence, so the answer is wrong too.

**Too late** → dead air. The caller says "hello?", which becomes a new turn and confuses the state.

A fixed threshold forces one global bias. A semantic model lets the threshold depend on *what was said* — short after a complete sentence, long after a trailing "is".

**Alternatives**

- **Fixed silence timeout** — free, simple, wrong in the way described above.
- **Vendor endpointing** — Deepgram will tell you it thinks the utterance ended. Convenient, but ties turn-taking to your STT vendor.
- **Semantic / smart-turn** (used here) — a local ONNX model. Costs ~50 ms of inference per turn boundary, saves a ~700 ms false-barge-in recovery. Worth it, and measured rather than assumed.
- **Push-to-talk** — sidesteps the problem entirely, impossible on a phone call.

**Testing and breakpoints**

`test_endpointing.py`. Logic lives in `pipeline/endpointing.py`; VAD config in `processors/vad.py`.

**Breakpoint:** the endpointing decision function — inspect the interim text and the silence duration at the moment it decides.

**Live test:** make a call and deliberately pause for two seconds mid-sentence. If the bot interrupts, endpointing is too aggressive. This is a manual test and there is no substitute for it.

## Interruptions

*The hard parts · 13*

**What it is**

**Barge-in** is the caller talking while the bot is talking. A bot that can't be interrupted feels like an IVR menu; a bot that interrupts too eagerly is unusable. Getting this right is most of what makes an agent feel human.

Four things must happen, and most implementations get three:

1. **Detect it.** VAD on incoming audio. Debounce it, or a cough stops the bot.
2. **Stop talking.** Cancel TTS synthesis *and* flush audio already queued in the transport. Forget the queue and the bot keeps speaking for a second after it should have stopped.
3. **Fix the memory.** The model believes it said the whole sentence. It didn't. You must estimate how much was actually spoken and record only that — otherwise the next turn refers to things the caller never heard.
4. **Start listening cleanly**, without mistaking the bot's own tail for the caller's voice.

Step 3 is the one people miss. Here it's done by measuring elapsed playback time, multiplying by a characters-per-second estimate, and cutting at a word boundary.

**Two modes, per assistant**

**Barge-in enabled** — the caller can interrupt. Natural, but risky in noisy environments.

**Barge-in disabled** — the bot finishes its sentence regardless. Used where the bot must deliver a legally-required disclosure. This is implemented by the mute filter gating the microphone entirely.

**Testing and breakpoints**

Barge-in is **badly under-tested** in this repo and worth knowing as an honest gap. Most verification is manual: call in, talk over the bot, check it stops, then check the next reply doesn't reference unspoken words.

**Breakpoint:** `_estimate_spoken_text()` in `services/xai.py` — this is where the guess about "how much did we actually say" is made.

**Log check:** after a barge-in, grep for `interruption` and confirm TTS was cancelled rather than allowed to finish.

## Ending a call

*The hard parts · 14*

This has caused more production incidents than anything else in the framework, and the reason is a single missing timeout.

| | EndFrame — `stop_when_done()` | CancelFrame — `cancel()` |
| --- | --- | --- |
| Meaning | "finish what you're doing, then stop" | "stop now" |
| Timeout | **none — waits forever** | 20 seconds |
| Blocks the queue | yes | no |

Here's the failure. An `EndFrame` is queued. Some processor is stuck — a websocket reconnecting, say. The EndFrame waits, forever, because it has no timeout. And because it's blocking the queue, **nothing behind it can be processed either — including the `CancelFrame` you send to force the issue.** The pipeline hangs until the process is killed.

**So: on a live call, always `cancel()`.** Every official pipecat example does. The only one using `stop_when_done()` is an offline batch script.

**Two corollaries worth memorising**

**1.** If you override `stop()` with cleanup logic, you must override `cancel()` with the same logic — otherwise a cancel-based shutdown skips your cleanup silently.

**2.** Once a `CancelFrame` has passed a processor, every later frame is silently dropped. So if you need to send a final status update *and* cancel, send the status update first.

**Testing**

**Breakpoint:** the `finally` block in `handlers/rpc_handler.py` or `_cleanup()` in `handlers/livekit_session.py`. That's where shutdown is orchestrated.

**Symptom to recognise:** the process doesn't exit after a call, or you see "dangling tasks" in the logs, or websocket reconnect messages continuing after hangup. All three mean shutdown didn't complete.

**Live test:** hang up mid-sentence, while the bot is speaking. Confirm the process exits and the recording is still saved. Hanging up during silence is the easy case and proves less.

## Where everything lives

*The codebase · 15*

```
app/
├── interface/       REST API — configure assistants (no calls here)
├── runtime/
│   ├── voice/       real-time calls ← the complex one
│   │   ├── pipeline/     builds the pipeline
│   │   ├── processors/   our workers on the belt
│   │   ├── services/     one adapter per vendor (24 files)
│   │   ├── transport/    plugs into the network
│   │   ├── handlers/     per-call lifecycle
│   │   ├── servers/      program entry points
│   │   ├── observers/    watch frames go past
│   │   └── frames/       our own frame types
│   ├── text/        SMS, email, chat
│   └── cli/         terminal chat, for testing
├── background/
│   └── post_call/   work that happens after hangup
├── llm/             prompts, tools, conversation memory
├── models/          database tables
├── lib/             shared utilities
└── session/         connections to Postgres, Redis, S3, SQS…
```

**The rule for where new code goes**

Triggered by a person right now → `runtime/`. Triggered by a queue or a schedule → `background/`. Used by many callers → top level (`models/`, `lib/`, `llm/`).

Tests go in a `tests/` folder next to the code they test.

### The service adapter pattern

Every vendor gets one file in `services/`, and every class is named `Mod*` — `ModDeepgramSTTService`, `ModCartesiaTTSService`. They subclass pipecat's version and add only what differs: our metrics, our logging, vendor quirks.

A single registry maps a name to a class, so **choosing a vendor is data, not code**:

```python
ProviderType.TTS: {
    "CARTESIA": ModCartesiaTTSService,
    "XAI":      ModXAITTSService,
    ...
}
```

Switching a bot from xAI to Cartesia is a database change. Nothing is deployed.

## How a call is configured

*The codebase · 16*

An **assistant** is one bot. It has **versions**, and each version carries a JSON blob called `runtime_config` that decides everything about how a call behaves:

```
runtime_config
├── asr_config[]     which speech recogniser, which language
├── tts_config[]     which voice, plus a fallback
├── llm_config[]     which model, plus priority order
├── barge_in_config  can the caller interrupt?
├── user_idle_detection_config
├── dtmf_config      keypad handling
└── voicemail_config detect answering machines (outbound only)
```

When a call starts, this blob is read from the database and used to build the pipeline. That's why two bots on the same server can use completely different vendors.

**A trap that will cost you an afternoon**

Each config entry has a `provider_id` pointing at a row in the `runtime_providers` table. **Those IDs are not the same across environments.** Import an assistant from production into local and its `provider_id` points at a row that doesn't exist here.

The call still works, because the pipeline builds from the provider *name*. But saving the assistant from the UI fails with `400: LLM provider not found` — and because the whole config is validated together, one stale ID blocks edits to *every* field, including unrelated ones.

Fix: point it at the local ID.

```sql
update assistant_configs
set runtime_config = jsonb_set(runtime_config::jsonb,
      '{llm_config,0,provider_id}', '6'::jsonb)::json
where assistant_id = 1702;
```

## Debugging & breakpoints

*Working on it · 17*

**The golden rule of debugging real-time audio**

**Anything that pauses the program destroys the thing you're measuring.** Audio keeps arriving at 50 packets a second while you sit at a breakpoint. When you continue, everything is late and the call is broken.

So there are two different activities, and you must know which one you're doing.

### Inspecting state → breakpoints are fine

"What is in the conversation history at this point?" "What did the vendor actually send?" Stop the world, look, move on. The call is ruined but you got your answer.

```python
# conditional, so you stop on the case you care about
if frame.text and "account" in frame.text:
    breakpoint()
```

Useful places to stop:

| Question | Where to stop |
| --- | --- |
| What is the model being told? | `app/llm/context_manager.py` |
| What did STT hear? | `_on_message` in `services/deepgram.py` |
| What are we about to speak? | `run_tts()` in the TTS service |
| Why did the pipeline build like that? | `pipeline/pipecat_bots.py` |
| Why did the call end? | `_cleanup()` in `handlers/livekit_session.py` |
| Which vendor key was used? | `utils/service_keys.py` |

### Investigating timing → never breakpoints

"Why is there a gap?" "Why is the audio out of sync?" A breakpoint *creates* the symptom. Use logs — but carefully.

**A mistake worth learning from second-hand**

While debugging a recording bug in this repo, per-frame logging was added — about 30 log writes per second inside the audio path. The next call had audible glitches. The logging itself was causing them: writing to a file 30 times a second competes with the audio loop.

The fix is to **collect into a list in memory and write once when the call ends**. Same data, no cost during the call.

```python
self._trace.append(f"{direction} mic={mic:.3f} bot={bot:.3f}")
# ... at cleanup:
open(path, "w").write("\n".join(self._trace))
```

### The tools already built in

- **debug_observer.py** — Logs every frame with source, destination and timestamp. Turn it on to watch the belt.
- **Arize Phoenix** — Shows the full prompt and response for every LLM call. First stop when the bot says something strange.
- **Grafana Tempo** — Per-stage timing. First stop when the bot is slow.
- **The recording** — Stereo WAV — caller on the left channel, bot on the right. You can hear exactly what happened, and measure it too.

**Measuring a recording instead of listening to it**

Listening tells you something is wrong. Measuring tells you what. This finds silent gaps inside speech:

```python
import wave, numpy as np
w = wave.open("call.wav"); sr = w.getframerate()
a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).reshape(-1, 2)
bot = a[:, 1]                      # right channel

zeros = (bot == 0).view(np.int8)   # find runs of pure silence
edges = np.diff(np.concatenate(([0], zeros, [0])))
for s, e in zip(np.where(edges == 1)[0], np.where(edges == -1)[0]):
    ms = (e - s) / sr * 1000
    if 80 <= ms < 200:             # long enough to hear, short enough to be a bug
        print(f"gap at {s/sr:.2f}s — {ms:.0f} ms")
```

Gaps under 80 ms are inaudible; over 200 ms is usually a real pause between sentences. The 80–200 ms band is where the bugs live.

## Testing

*Working on it · 18*

```bash
pytest                                    # everything registered in pytest.ini
pytest app/runtime/voice/tests -q         # voice only — 677 tests
ruff format . && ruff check . --fix       # formatting and linting
```

### Four layers, and what each one cannot see

| Layer | Catches | Blind to |
| --- | --- | --- |
| **Import check** | Deleted or moved modules | everything else |
| **Signature compatibility** | Framework changed a method your mocks are hiding | behaviour changes at the same signature |
| **Unit tests** | Your logic, pinned regressions | anything mocked; ordering across processors |
| **Live calls** | Deadlocks, endpointing, audio quality, vendor timing | nothing — but slow and manual |

**The signature test is the clever one**

`test_pipecat_compatibility.py` uses Python's `inspect` to compare our overrides against the *real, installed* framework classes.

Why it must exist: when your tests mock the parent class, they keep passing after the parent's signature changes. The mock happily accepts the old arguments. Green suite, broken runtime. Introspection breaks that illusion.

**The manual checklist — no substitute exists**

1. Plain call — greeting, three turns, hang up
2. Barge-in — talk over the bot mid-sentence
3. Long pause — stop for two seconds mid-sentence; does it wait?
4. Repeat an utterance — exercises the TTS cache path
5. Switch language mid-call
6. Hang up while the bot is speaking
7. Afterwards: check the trace has all spans, and the recording length is within a second of the call

**Make tests discriminate, not just pass**

A test that passes against both the broken and the fixed code proves nothing. When the recorder was fixed, the new suite was run against three versions: 7 failed on the old code, 6 on an earlier wrong attempt, 0 on the fix. That check is what turns a test suite into evidence.

**Know this before you trust CI**

The voice test job is marked `allow_failure: true`, and the voice paths are commented out of `pytest.ini`. **A green pipeline does not mean the voice tests passed.** You have to open the job and read it.

## Glossary

*Reference · 19*

- **ASR / STT** — Automatic speech recognition / speech to text. Audio → words.
- **TTS** — Text to speech. Words → audio.
- **LLM** — Large language model. Decides what to say.
- **VAD** — Voice activity detection. Is this 20 ms speech or noise?
- **Endpointing** — Deciding the caller has finished their turn.
- **Barge-in** — The caller interrupting the bot.
- **Frame** — One small box on the conveyor belt — audio, text, or a signal.
- **Processor** — A worker on the belt. Sees every frame.
- **Pipeline** — The ordered list of processors.
- **Transport** — The plug into the network — audio in at the top, out at the bottom.
- **Sample rate** — Numbers per second. 8,000 on phone calls.
- **TTFB** — Time to first byte — how fast a vendor starts answering.
- **TTFT** — Time to first token — the LLM equivalent.
- **Turn** — One person's contribution before the other replies.
- **Interim / final** — A changing guess from STT vs its committed answer.
- **DTMF** — Keypad tones — "press 1 for sales".
- **Deflection** — A call or ticket resolved with no human involved.

---

Written from the code in orchestrator-service · pipecat-ai 1.4.0 · measurements from instrumented calls, Aug 2026
Companion documents: pipecat upgrade · telephony · CI/CD and containers · distributed systems · the Vasco stack
