# The OSV Field Guide

**Topic:** This repo
**Covers:** How frames work, how the runtime works, every file in app/runtime/voice
**Source:** [Claude artifact](https://claude.ai/artifact/QFC1X25qCZpcjtHp1MBtXP) — written by a colleague, mirrored here for study.

*app/runtime/voice · file by file*

The voice runtime's process model, its frame system, and a reference entry for every file in `app/runtime/voice/` — what it holds, what it's for, and the one thing worth knowing about it.

### How to use this

The first five sections explain the *model* — how the runtime is structured and how frames move through it. Everything after is **reference**: skim it once to build a map, then come back when you need a specific file.

The companion document *Anatomy of a Call* covers the same system as a *narrative* — one call, stage by stage. This one is the index.

## How the runtime works

### What "the runtime" means here

**OSV** is the voice runtime — one of three long-lived server processes in this service (the others being the interface API and the text runtime). It answers phone calls.

It runs in two modes, chosen by transport, and they differ in *who starts the conversation*:

```
python main.py --mode voice --port 8080 --transport grpc
python main.py --mode voice --port 8080 --transport livekit
```

### The two process models

| | gRPC | LiveKit |
|---|---|---|
| Server | `servers/grpc_server.py` | `servers/livekit_agent_server.py` |
| Model | Carrier opens a stream to us | We're dispatched into a room |
| Concurrency | `start_multiprocess_server()` — several worker processes on different ports behind nginx | Agent SDK dispatches a job per call into one process |
| Call entry | `CCAService.HandleCall()` | `entrypoint()` → `LiveKitSession.run()` |

Both converge on `PipelineConfigManager` in `pipeline/pipecat_bots.py`. **Everything from that point is transport-agnostic** — which is the single most important structural fact about this codebase.

### The life of one call

```
1  server accepts the call          grpc_server / livekit_agent_server
2  resolve the assistant            from virtual number or job metadata
3  load config from Postgres        LLMConfigManager
4  resolve provider capacity        utils/capacity.py → Redis
5  build the pipeline               PipelineConfigManager.create_pipeline()
6  create the PipelineTask          + observers, + params
7  queue the first frames           static prompt or LLMRunFrame
8  ── the call happens ──           frames flow
9  terminal frame                   hangup or transfer
10 cleanup                          release capacity FIRST, then the rest
11 upload recording to S3
12 publish to SQS                   post-call pipeline takes over
```

Two ordering constraints inside that are load-bearing and commented as such: **capacity release runs first and unconditionally** in cleanup, because a leaked counter turns away future calls forever; and the **recording upload happens before the post-call event is published**, so the worker sees a committed audio URL.

### Per-call isolation

Everything above is per call: its own transport, its own vendor connections, its own `LLMContext`, its own recorder, its own metrics observer. Pods are interchangeable and hold no cross-call state — which is what makes the fleet horizontally scalable.

The only shared state is in Redis: capacity counters, the TTS cache index, the prompt cache handle.

## How frames work

### Definition

A **frame** is a typed message. A **processor** receives frames, may act on them, and pushes them onward. A **pipeline** is an ordered list of processors.

That's the entire architecture. Everything in this runtime is one of those three things.

```
transport.input()  →  [P1]  →  [P2]  →  [P3]  →  transport.output()
                        │        │        │
                    each one receives a frame,
                    may transform / absorb / emit,
                    and pushes it on
```

### Direction

Frames travel two ways, and the distinction matters constantly:

- **DOWNSTREAM** — Toward the caller's ear. Audio in → transcription → LLM text → TTS audio → out.
- **UPSTREAM** — Back toward the microphone. Control signals, settings updates, and cues to earlier processors.

The clearest example is in `ModLLMUserAggregator.push_aggregation()`:

```
await self.push_frame(LLMRequestStartFrame(), FrameDirection.UPSTREAM)    # STT mute cue
await self.push_frame(LLMRequestStartFrame(), FrameDirection.DOWNSTREAM)  # filler cue
await self.push_context_frame()                                            # blocking
```

The same frame type, both directions, for two different listeners. Upstream tells the mute filter (which sits *before* the aggregator) to stop listening; downstream tells the filler processor (which sits *after*) to start its timer. And both go out before the blocking call — so everyone is notified before the pipeline stalls on the LLM.

### The rule that explains most of the code: order is behaviour

A processor can only see frames that reach it. So **where a processor sits determines what it can do**, and several positions in this pipeline are load-bearing:

- **Gender identification is first** — it needs raw audio and VAD boundaries before the mute filter can suppress them.
- **The recorder is after `transport.output()`** — so it records what was *sent*, not what was generated. Those differ on a barge-in.
- **The tag processor is immediately before TTS** — any later and the caller hears the words "transfer" in angle brackets.
- **The assistant aggregator is last** — it must run after TTS to receive `BargeInSpokenTextFrame`.

When reading this codebase, *always check where a processor sits in `create_pipeline()`* before reasoning about what it does.

## Frame categories

### Three base types, with very different rules

| Type | Carries | Queueing |
|---|---|---|
| **DataFrame** | Content — audio, text, transcription | Queued in order |
| **ControlFrame** | Ordered signals — start, end, settings | Queued in order, *behind* data |
| **SystemFrame** | Urgent signals — interruption, cancel | **Jumps the queue** |

### Why SystemFrame bypassing the queue is essential

When a caller interrupts, there may be several seconds of audio frames queued ahead. If the interruption signal waited its turn behind them, it would arrive after the audio it was supposed to cancel — useless.

`InterruptionFrame` is a SystemFrame precisely so it overtakes the queue and reaches every processor immediately. Same for `CancelFrame`, `UserHangupFrame` and `TerminalFrame`.

This is also why gates in this codebase pass SystemFrames through unconditionally — blocking one could deadlock the pipeline.

### EndFrame versus CancelFrame — a real trap

`EndFrame` is an *ordered* shutdown: it queues behind everything else, so all pending work completes first. Graceful, and it can block indefinitely if something upstream is stuck.

`CancelFrame` is a SystemFrame: immediate, drops pending work.

Using EndFrame where you needed CancelFrame produces a hang that looks like a deadlock. Worth knowing before you debug one.

### The pipecat frames you'll see constantly

```
audio      InputAudioRawFrame, TTSAudioRawFrame, OutputAudioRawFrame
speech     VADUserStartedSpeakingFrame / VADUserStoppedSpeakingFrame  ← raw VAD
           UserStartedSpeakingFrame / UserStoppedSpeakingFrame        ← turn decisions
           BotStartedSpeakingFrame / BotStoppedSpeakingFrame
text       InterimTranscriptionFrame, TranscriptionFrame, LLMTextFrame, TTSTextFrame
llm        LLMContextFrame, LLMRunFrame,
           LLMFullResponseStartFrame / LLMFullResponseEndFrame
tools      FunctionCallInProgressFrame, FunctionCallResultFrame
control    StartFrame, EndFrame, CancelFrame, InterruptionFrame
settings   STTUpdateSettingsFrame, VADParamsUpdateFrame
metrics    MetricsFrame, TTFBMetricsData
```

**The VAD-prefixed pair versus the plain pair is the distinction that confuses everyone.** `VADUserStoppedSpeakingFrame` means "the acoustics went quiet". `UserStoppedSpeakingFrame` means "the turn controller decided the turn is over". They are different events at different times, and endpointing lives in the gap between them.

## The custom frames

`frames/frames.py` defines 27 frames specific to this product. Reading this file is the fastest way to understand what the system does that plain pipecat doesn't.

### Call control

| Frame | Base | Meaning |
|---|---|---|
| `StateFrame` | Control | Tells the output transport the "state" of the next turn |
| `TransferFrame` | State | Transfer, carrying transfer attributes |
| `HangupFrame` | State | End the call |
| `TerminalFrame` | **System** | A terminal action has been initiated — gates everything downstream |
| `UserHangupFrame` | **System** | The caller hung up |
| `CallStatusUpdateFrame` | System | Call duration / status update |

### `TerminalFrame` is the one to understand

Once a hangup or transfer is queued, several processors must go quiet — otherwise a late LLM request flushes the queue and the caller hears a reply *after* the goodbye. The user aggregator checks `_terminal_frame_received` and silences all pushes; the STT mute filter mutes on it.

It's a SystemFrame so it overtakes whatever is queued, which is the whole point.

### Turn and interruption

| Frame | Meaning |
|---|---|
| `LLMRequestStartFrame` | An LLM request is being dispatched. Sent both directions — STT mute cue upstream, filler cue downstream |
| `TranscriptionFinalizedFrame` | Transcription is final. Used as the unmute cue when smart turn is off |
| `BargeInSpokenTextFrame` | **The estimated portion actually spoken** before an interruption |
| `DisableBargeInFrame` | Temporarily disable barge-in for this turn |
| `EnterAwaitActionFrame` | The user is doing something on their device — extend the idle timeout |

### `BargeInSpokenTextFrame` — the most conceptually important custom frame

The bot generated thirty words; the caller interrupted after six. If the context records all thirty, the model believes it said things the caller never heard, and every later turn is built on that false premise.

Each TTS service estimates how much was played — from a vendor completion signal where available, otherwise elapsed time × characters-per-second — and emits this frame. The assistant aggregator records *that*.

Almost nobody thinks of this when describing barge-in. It's the difference between stopping the audio and staying correct.

### DTMF, redaction and database

| Frame | Meaning |
|---|---|
| `StartDTMFFrame` / `StopDTMFFrame` | A keypad-entry turn began / ended |
| `DTMFCollectedFrame` | Collected digits, typed as a `TranscriptionFrame` so downstream treats it like speech |
| `StartRedactedTurnFrame` / `StopRedactedTurnFrame` | Pause and resume recording — sensitive data is *never captured* |
| `DBUserInputFrame` | User input for the DB writer |
| `DBBotMessageFrame` | Record a bot message explicitly — used by filler words, which bypass the normal text path |
| `ReasoningTraceFrame` | LLM reasoning trace, for storage |
| `TagFrame` | A parsed tag |

### Outbound and metrics

| Frame | Meaning |
|---|---|
| `OutboundCallWaitingFrame` | Still ringing — pauses idle detection so ringback doesn't trip it |
| `OutboundCallAnsweredFrame` | Answered |
| `VendorRequestMetricsData` | Emitted at the start of each vendor API call |
| `VendorErrorMetricsData` | A vendor call failed |
| `STTStreamMetricsData` | An STT stream connected — drives the streams counter |
| `TTSTTFBMetricsData` | TTFB, **plus whether it was a cache hit** |

### Why `DTMFCollectedFrame` subclasses `TranscriptionFrame`

A neat piece of design. Pressing "1" and saying "one" should reach the LLM identically. By typing collected digits as a transcription, every downstream processor — aggregator, DB writer, idle detector — handles keypad input with no special-casing at all.

## The processor contract

### Every processor looks like this

```
class MyProcessor(FrameProcessor):
    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)   # ← always first

        if isinstance(frame, SomethingICareAbout):
            ...                                          # act

        await self.push_frame(frame, direction)          # ← pass it on
```

Three rules that are easy to break and produce confusing bugs:

1. **Call `super().process_frame()` first.** The base class maintains internal state — interruption handling, task management. Skip it and things break in ways that don't point back here.
2. **Push the frame on, unless you deliberately absorb it.** A processor that forgets to push silently breaks everything downstream, and nothing errors.
3. **Never block for long.** The pipeline is a single async chain; a slow processor stalls every frame behind it — and on a live call that is audible.

### The four things a processor can do

- **Observe** — Watch and push on unchanged. `DebugObserver`-style behaviour.
- **Transform** — Modify and push. `TagsFrameProcessor` strips tags from text.
- **Absorb** — Consume without pushing. Gates drop frames for the wrong language; `FrameSinkProcessor` absorbs everything.
- **Emit** — Push frames it wasn't given. `FillerWordsProcessor` emits a `TTSSpeakFrame` from a timer.

### Observers — the fifth option, outside the pipeline

A `BaseObserver` gets `on_push_frame()` for every frame push in the pipeline, without sitting in the chain. It can see everything and affect nothing.

That's exactly right for measurement, and it's why `MetricsObserver` is an observer rather than a processor: it can't accidentally add latency or drop a frame.

## The tree

```
app/runtime/voice/
├── servers/       process entry points          3 files
├── handlers/      per-call session management   2 files
├── transport/     audio in and out               2 files
├── pipeline/      assembly and turn logic        5 files
├── processors/    the pipeline stages           12 files
│   └── filters/   audio-level filters            2 files
├── services/      vendor integrations           22 files
├── observers/     measurement                    3 files
├── frames/        custom frame definitions       1 file
├── types/         typed config and state         1 file
├── utils/         shared helpers                 8 files
├── compliance/    post-call auditing              1 file
└── evaluation/    post-call scoring                1 file
```

### The dependency direction

```
servers  →  handlers  →  pipeline  →  processors
                             │            │
                             └──────→ services  →  utils
                                          │
                                       frames
```

`frames/` and `utils/` are leaves — imported by everything, importing almost nothing. `servers/` is the root. Nothing imports upward, which is why the transport-agnostic split holds.

## servers/

**`grpc_server.py`** · 448 lines

gRPC transport entry point. Starts worker processes, serves the CCA gRPC service, and exposes health and metrics endpoints.

- `start_multiprocess_server()` — several workers on different ports behind nginx. This is how gRPC mode gets concurrency.
- `serve()` / `serve_worker()` — one worker.
- `start_metrics_server()`, `metrics_handler()`, `health_handler()` — Prometheus and liveness.
- `task_monitor()` — **detects leaked asyncio tasks after calls end**. A task that outlives its call is a slow memory leak and a source of ghost behaviour; this catches it.
- `shutdown()` — graceful, cancelling pending tasks.

**`livekit_agent_server.py`** · 613 lines

LiveKit entry point, built on the Agent SDK. Receives a job per call and works out what kind of call it is.

- `prewarm()` — loads heavy imports before jobs arrive, so the first call doesn't pay for them.
- `entrypoint()` — the per-job handler.
- `_get_call_details()` → `_handle_inbound_call()` / `_handle_outbound_call()` / `_handle_web_call()` — three call types, three ways of learning who is calling.
- `_dial_outbound()` — creates the SIP participant and waits for an answer.
- `_run_session()` — hands off to `LiveKitSession`.

**`livekit_preload.py`** · 30 lines

Forkserver preload. Imports the expensive modules once in a parent process so each forked worker inherits them rather than importing again — startup time and memory, both.

## handlers/

**`livekit_session.py`** · 1,349 lines

One class, `LiveKitSession`, managing a single call end to end. The largest and most consequential file in the runtime.

**Lifecycle:** `run()` → `_setup()` → `_run_pipeline()` → `_cleanup()` → `_finalize_call()`

**Events:** `_on_audio_track_subscribed()`, `_on_first_participant_joined()`, `_on_participant_left()`, `_on_call_end_requested()`, `_on_vm_detection_complete()`

**Transfer** — the hard part, and most of the file:

- `_handle_transfer()` — SIP-level transfer.
- `_handle_bridge_transfer()` — dial a human into the room, then remove the bot.
- `_dial_bridge_agent()`, `_resolve_call_id_b()`, `_rollback_agent()` — and rollback matters: a failed transfer must return the caller to the bot, not drop them.
- Timeouts from env: `BRIDGE_TRANSFER_AGENT_TIMEOUT` (60 s), `BRIDGE_TRANSFER_SWAP_TIMEOUT` (5 s).

**Reporting:** `_resolve_dial_result()`, `_report_dial_result()`, `_send_to_kinesis()` — outbound campaign outcomes onto the event stream.

Also `_send_initial_greeting()`, gated on `CallState.STARTING` so it can't fire twice.

**`rpc_handler.py`** · 608 lines

`CCAService`, the gRPC servicer. `HandleCall()` is the bidirectional streaming method that *is* the call.

- `_create_llm_context()` — builds the initial context.
- `_get_transport_config()` — transport parameters.
- `_process_terminal_state()` — hangup and transfer, the gRPC equivalent of the LiveKit path.

Sets `call_uuid_var` and `client_uuid_var` early, so every subsequent log line carries them.

## transport/

**`livekit.py`** · 490 lines

Four subclasses of pipecat's LiveKit transport, each adding something specific.

- `ModLiveKitTransportClient` — `_subscribe_to_audio_tracks()`, `_on_track_published()`. Uses the room the agent server already joined rather than connecting itself.
- `ModLiveKitInputTransport` — `_on_sip_dtmf_received()`. Keypad presses arrive as SIP events, not audio, so they need their own path.
- `ModLiveKitOutputTransport` — `_clear_audio_buffer()` on interruption and `_wait_for_audio_playout()` before hangup. **Opposite operations on the same buffer, for opposite reasons** — see the note below.
- `ModLiveKitTransport` — `request_call_end()`, `get_sip_call_status()`, `setup_sip_call_status_listener()`. SIP status arrives as participant attribute changes.

### The buffer you don't control

LiveKit's `AudioSource` queues up to about a second of audio. TTS generates faster than real time, so by the time you decide to stop, seconds may already be inside LiveKit.

**On interruption** you must `clear_queue()` or the bot keeps talking after being told to stop. **On hangup** you must `wait_for_playout()` or the goodbye is clipped. Both problems, one buffer, opposite fixes.

**`grpc.py`** · 442 lines

The gRPC transport: `GRPCTransportParams`, `GRPCInputTransport`, `GRPCOutputTransport`, `GRPCTransport`.

- Input: `process_audio_message()`, `process_dtmf_message()`, `push_audio_frame()`.
- Output: `write_audio_frame()`, `set_bot_speaking()`, `get_pending_terminal_message()`, `send_terminal_message()`.

Note `set_bot_speaking()` / `is_bot_speaking()` — the gRPC side tracks this explicitly, where LiveKit infers it.

## pipeline/

**`pipecat_bots.py`** · 1,211 lines

**The spine.** `PipelineConfigManager` turns database config into a running pipeline. If you read one file, read this one.

- `create_pipeline()` — assembles the processor list. The order here *is* the system.
- `setup_asr_processors()` / `setup_tts_processors()` — parallel branches with language gates; TTS additionally aggregates vendors that can serve many languages on one connection.
- `setup_llm_and_context()`, `setup_vad()`, `setup_audio_filter()`, `create_transport()`.
- `create_stt_mute_processor()` — strategies chosen by whether barge-in is enabled.
- `create_user_idle_processor()` — the escalation callback, including the per-vendor message role.
- `generate_initial_frames()` — static prompt or `LLMRunFrame`.
- `start()`, `cleanup()`, `_enforce_max_call_timeout()`.
- `_detect_multimodal_mode()` — routes to a different pipeline entirely for audio-native models.

**`context.py`** · 373 lines

The two context aggregators that bracket the LLM.

- `ModLLMUserAggregator` — builds the user turn and commits it. Owns interim-based barge-in (`_maybe_interrupt_from_interim`), a final-transcript safety net (`_maybe_interrupt_from_final`), dynamic VAD delegation, the terminal gate, and the sub-threshold drop gate.
- `ModLLMAssistantAggregator` — records what the bot said, applies tags and sensitive-data templating, merges burst TTS.
- `get_llm_context_aggregator_pair()` — the factory.

**`endpointing.py`** · 323 lines

Turn-boundary logic. Small file, disproportionate impact on how the bot feels.

- `DynamicVadController` — adjusts VAD `stop_secs` from the *last character* of the interim transcript. Punctuation shortens it, a digit lengthens it. Pure state transitions; it returns params and never pushes frames.
- `ModUserTurnStartStrategy` — fires on VAD start or transcription. `enable_interruptions` controls whether turn start auto-interrupts.
- `ModUserTurnStopStrategy` — a polling loop, deliberately, so there is exactly one commit path for the gender gate to hook.
- `ModTurnAnalyzerUserTurnStopStrategy` — smart-turn wrapper, plus a re-check on non-finalized transcripts to close a late-final race.
- `build_user_turn_stop_strategy()` — picks between them.

**`latency_switcher.py`** · 353 lines

Automatic LLM failover.

- `LatencyBasedSwitcherStrategy` — counts strikes when TTFB exceeds a threshold; switches after `max_strikes`. One switch per session by default, to prevent flapping.
- `switch_due_to_error()` — takes the next candidate *unconditionally*; a broken service is worse than a slow one.
- `LatencyAwareLLMSwitcher` — feeds TTFB in from metrics frames and handles pre-stream errors.

**`multimodal.py`** · 251 lines

A separate pipeline for models that consume audio directly. `setup_multimodal_llm()`, `create_multimodal_pipeline()`. No separate ASR or TTS — the model does all three, so the whole shape changes.

**`vm_detection.py`** · 254 lines

Voicemail detection for outbound calls. Runs as a *second, never-muted* ASR plus its own LLM in a parallel branch.

- `VMDetectionLLMService` — ignores `InterruptionFrame`, because a voicemail greeting shouldn't interrupt detection.
- `create_vm_detection_asr()` — bypasses muting.
- `create_vm_detection_llm()` — with a `FrameSinkProcessor` after it, so its output can never reach TTS.

## processors/

**`audio_recorder.py`** · 348 lines

Two-channel WAV recording, redaction, S3 upload.

- `BaseModAudioBufferProcessor` — shared WAV writing, redaction on `Start/StopRedactedTurnFrame`, and `cleanup()` which flushes, closes, uploads and deletes locally only on success.
- `ModAudioBufferProcessor` — time-based sync, for barge-in disabled.
- `ModAudioLengthBufferProcessor` — **position-based sync, the primary recorder**. Uses the mic sample count as the clock, because wall-clock drifts on GC pauses and the other track's length drifts on bursty delivery.
- `_align_track_buffers()` — pads both tracks level before merging, because `interleave_stereo_audio` truncates to the shorter one.

**`tags.py`** · 647 lines

The largest processor. A **streaming parser** that extracts tags from LLM text as it arrives and strips them before TTS.

- `_ParserState` — an explicit state machine, because tags arrive split across streaming chunks. `_process_chunk()`, `_flush_parser()`.
- `_render_jinja()` — templating inside tags.
- Handlers: `_handle_dtmf_tag`, `_handle_language_tag`, `_handle_transfer_tag`, `_handle_hangup_tag`, `_handle_opt_out_tag`, `_handle_low_signal_tag`, `_handle_human_in_the_loop_tag`, `_handle_redaction_tag`.
- `_is_transfer_blocked()` / `_handle_blocked_transfer()` — the operational override that speaks a message instead of transferring.

Sits immediately before TTS. Any later and the caller hears the markup.

**`db_writer.py`** · 483 lines

Persistence during the call.

- `DBWriterFrameProcessor` — writes transcriptions, bot responses and tool calls; publishes call-status and conversation events.
- `UserInputTransformer` — `_convert_spoken_numbers()` (inverse text normalisation) and `_store_sensitive_info()`.

**`user_idle.py`** · 353 lines

Silence detection and escalation.

- `UserIdleProcessor` — the timer loop, started on first conversation activity.
- `ModUserIdleProcessor` — four overrides, each with a stated reason: **bare VAD does not reset the retry count** (background noise would prevent hangup forever); pauses while an outbound call rings; goes inert after termination; extends to `action_timeout` on `EnterAwaitActionFrame`.

**`dtmf.py`** · 246 lines

Keypad input. Collects digits with a max count and an inter-digit timeout, then emits a `DTMFCollectedFrame`.

- `_digit_timeout_handler()` — finalise after a pause.
- `_no_digit_when_voice_detected_handler()` — if they start speaking instead, abandon digit collection.
- `reset_state()` — called by the idle handler between attempts.

**`filler_words.py`** · 188 lines

Covers dead air. Three modes — `GLOBAL` and `MODULE` watch LLM timing, `INTEGRATION` watches function-call timing. Tiered thresholds escalate.

Two details worth knowing: it pushes `TTSSpeakFrame` to **bypass the TTS sentence aggregator** (a lone sentence would otherwise wait for lookahead that never comes), and it pushes a separate `DBBotMessageFrame` because that bypass also skips persistence.

**`gates.py`** · 174 lines

Language routing.

- `LanguageBasedASRGate` — passes transcriptions only when the current language matches. Drops `MetricsFrame` so idle branches don't pollute metrics; forwards `STTUpdateSettingsFrame` upstream only if the language is supported.
- `LanguageBasedTTSGate` — same idea, plus `_apply_language_config()` for vendors serving many languages on one connection.

**`gender_identification.py`** · 175 lines

Single-shot pitch-based classification on the first turn. Feeds audio in `_feed_audio()`, classifies in `_on_user_stopped_speaking()`, stores the result as a prompt variable. Placed first in the pipeline so it sees raw audio before the mute filter.

**`vad.py`** · 51 lines

`ModSileroVADAnalyzer`. One added method — `set_params()` — which preserves internal state across a parameter change. That is what makes dynamic endpointing possible.

**`audio_resampler.py`** · 28 lines

Sample-rate conversion between pipeline stages. Small and necessary — a mismatch produces audio that is wrong rather than absent.

**`frame_sink.py`** · 35 lines

Absorbs everything except SystemFrames and `EndFrame`. Used to terminate the VM-detection branch so its output can't reach TTS. The SystemFrame exception matters — swallowing those would deadlock the branch.

## processors/filters/

**`stt_mute_filter.py`** · 329 lines

Suppresses audio before it reaches ASR. `STTMuteStrategy` enumerates the modes (`ALWAYS`, `MUTE_UNTIL_FIRST_BOT_COMPLETE`, `FUNCTION_CALL`, `CUSTOM`); `ModSTTMuteFilter` adds the terminal-frame strategy and smart-turn awareness.

**The detail that connects to the recorder:** when barge-in is disabled, suppressed `InputAudioRawFrame`s are still fed to the recorder — because the recorder's clock *is* the mic frame count, and stopping it would desynchronise the tracks by the length of every bot utterance.

**`krisp.py`** · 143 lines

Vendored Krisp noise suppression, applied to inbound audio before anything else. `_load_krisp()` loads the native library; toggled by `ENABLE_KRISP` with the model at `KRISP_MODEL_PATH`.

## services/ — LLM

### The pattern

`ModOpenAILLMService` is the base; almost every other LLM service subclasses it, because most vendors expose an OpenAI-compatible endpoint. A new provider is usually a constructor override setting a base URL and a key.

**`openai.py`** · 545 lines

The base class, and the busiest LLM file.

- `_coalesce_openai_tool_calls()` — merges streamed tool-call fragments.
- `run_function_calls()`, `_run_function_call()`, `_sequential_runner_handler()` — tool execution, including sequential ordering where required.
- `_turn_disables_barge_in()` — some turns must not be interruptible.
- `ModOpenAIRealtimeLLMService` — the realtime audio variant, which mirrors pipeline-injected speech into the session.

**`gemini.py`** · 807 lines

Google, three ways — and the home of prompt caching.

- `split_cached_system_message()` — splits the prompt on `!SESSION_VARIABLES!` into an invariant static half and a per-call block. Strict: exactly three parts or it returns `None` and the request goes uncached.
- `compute_cache_key()` — hashes static text, tools, model, project and location.
- `_resolve_prompt_cache()` — three-level lookup: in-process memo, Redis, then create. Memoises failures so a too-short prompt isn't retried every turn.
- `_create_prompt_cache()` — POSTs a Vertex `cachedContents` resource. Tools must be inside it, because Vertex rejects requests carrying tools alongside a cache.
- `openai_tools_to_gemini_declarations()`, `_gemini_schema()` — schema translation.
- `ModGoogleVertexLLMService` (native SDK) and `ModGeminiMultimodalLiveLLMService` (audio-native).

**`livekit.py`** · 268 lines

`LivekitLLMService` — LLMs via LiveKit's inference gateway, with `create_livekit_access_token()` for JWT auth. This is the vendor whose idle-nudge message role had to be `assistant` to avoid a greedy-decoding loop.

**`groq.py` · `cerebras.py` · `openrouter.py` · `deepinfra.py` · `aws.py` · `modal.py`** · 55–177 each

Thin subclasses over OpenAI-compatible endpoints. The interesting bits are per-vendor quirks:

- `groq.py` — `_is_reasoning_model()`, `_get_valid_reasoning_efforts()`.
- `cerebras.py` — `_is_hybrid_reasoning_model()`.
- `openrouter.py` — preset-based routing, explicit or embedded in the model string.
- `aws.py` — Bedrock's OpenAI-compatible endpoint.
- `modal.py` — Modal Flash.

## services/ — TTS

### The four concerns every TTS service here handles

Reading any two of these files, the same four problems recur — which is a good sign the abstraction is right and the vendors are the variable:

1. **Blocking `run_tts`** — send one sentence, wait for playout, so text frames stay ordered behind their audio.
2. **`_estimate_spoken_text()`** — how much was heard at barge-in, for `BargeInSpokenTextFrame`. Uses a vendor completion signal where one exists, otherwise elapsed × `_effective_cps()`.
3. **Caching** — `_make_cache_key()` and `_replay_cached_audio()`.
4. **Metrics** — vendor request and error frames.

**`smallestai.py`** · 1,045 lines

The most complete implementation, and the best one to read to understand the pattern. Backported from upstream pipecat and heavily extended.

- `_InflightRequest` — receive-side bookkeeping for the one sentence currently in flight.
- `update_language_config()` — **implementing this method is what marks a service as aggregatable**, i.e. able to serve every language over one connection.
- `_maybe_store_cache()` — stores only on a rid-matched complete, fired as a background task during the playback wait so the S3 write costs nothing.
- `_keepalive_task_handler()`, `_connect_websocket()`, `_finish_inflight_playback()`.

**`xai.py`** · 763 lines

xAI streaming TTS. Same shape: `_estimate_spoken_text()`, cache methods, `flush_audio()`, `_clear_pending_cache()`. The service whose uneven delivery exposed the recorder's clock bug.

**`cartesia.py`** · 690 lines

Blocking `run_tts` with CPS-based barge-in estimation. `_process_messages()`, `_handle_audio_chunk()`, `_handle_done()`, `_send_cancel()`.

**The receive-loop rule lives here:** handlers must return promptly. Sleeping inside `_handle_done()` parks the socket's read task — the bug that produced multi-second dead air after a barge-in.

**`sarvam.py`** · 723 lines

Both Sarvam TTS and STT. `ModSarvamTTSService` has the full pattern; `ModSarvamSTTService` is a thinner wrapper with `_on_utterance_end()`. Important for Indic languages.

**`azure.py`** · 958 lines

All three Azure services in one file — STT, TTS and LLM.

- `ModAzureSTTService` — language switching, `_apply_phrase_list()` for keyword boosting.
- `ModAzureTTSService` — `_construct_ssml()`, `_effective_rate_token()`, caching, barge-in estimation.
- `_to_speech_ws_endpoint()` — normalises a configured endpoint to a base `wss://` URL.

**`google.py`** · 670 lines

Google STT and TTS. `preprocess_for_google_tts()`, `_get_google_stt_location()` (regional endpoint by cluster), `chunk_size()`, `_stream_tts()`.

**`baseten.py`** · 301 lines

Self-hosted Orpheus. **One persistent WebSocket for the whole call**, config sent once on connect, and a background `_receiver_loop()` so `run_tts()` returns immediately.

Its docstring quantifies the win: eliminates ~850 ms of per-request connection overhead and ~2 s of end-of-stream dead time.

**`elevenlabs.py` · `hume.py` · `rime.py` · `magpie.py`** · 64–217 each

- `elevenlabs.py` — `calculate_word_times()` from character alignment.
- `hume.py` — observability wrapper.
- `rime.py` — HTTP variant.
- `magpie.py` — **local Riva gRPC**, no API key. Self-hosted, like Baseten but on-cluster.

## services/ — ASR

**`deepgram.py`** · 551 lines

Two implementations. `ModDeepgramSTTService` carries substantial endpointing logic of its own:

- `TranscriptionState` — an explicit state machine.
- `_should_endpoint()`, `_check_pause_based_endpoint()`, `has_sufficient_silence()`, `calculate_time_silent()` — vendor-side turn detection.
- `_extract_word_times()`, `_extract_language()`, `_flush_before_disconnect()`.

`Mod2DeepgramSTTService` is a simpler alternative implementation.

**`parakeet.py`** · 296 lines

Self-hosted ASR over local Riva gRPC — no API key, no per-minute bill. `_decrement_active_stream()` and `_handle_stream_drop()` track capacity, because a self-hosted service still has finite concurrency.

**`soniox.py`** · 306 lines

Soniox wrapper: connection management, `_handle_transcription()`, `push_error()`.

## services/ — factory and manager

**`factory.py`** · 981 lines

**The reason no vendor name appears in the pipeline code.** `ServiceFactory.create_from_config(config, ProviderType.X)` takes a database row and returns a service.

- One `_create_*_service()` per vendor.
- `filter_configs_by_language()`, `group_languages_by_vendor_and_model()` — how the parallel branches get grouped.
- `filter_llm_configs_by_priority()` — fallback ordering.

Adding a provider is a method plus a row. Switching one is a row.

**`manager.py`** · 34 lines

`ConnectionManager` — `initialize_stt()`, `initialize_tts()`, `initialize()`. Warms vendor connections before the call starts, so the first utterance doesn't pay for a handshake.

## observers/

**`metrics_observer.py`** · 704 lines

All call metrics. Sits outside the pipeline, so it can see everything and break nothing.

- `get_vendor_type_and_name()` — maps a processor class name to (stage, vendor). This is how TTFB gets labelled per vendor.
- `_get_best_user_stop_timing()` — picks the best available timestamp for "the user stopped". **The class docstring enumerates ten distinct frame orderings** — late VAD, VAD bypass, failed attempts, retries — and session tracking is what stops a stale timestamp from a failed attempt corrupting the next turn's latency.
- Tracks user-perceived latency, *adjusted* latency excluding external API time, active call counts, and the initial greeting separately.

**`debug_observer.py` · `rtvi_observer.py`** · 50 / 17 lines

`DebugObserver` logs interruptions and bot-speaking events. `ModRTVIObserver` sends bot transcript text immediately rather than queuing it — for real-time UI clients.

## utils/

**`capacity.py`** · 413 lines

Provider concurrency, shared by ASR and TTS. The most carefully documented file in the runtime.

- `resolve_configs_by_capacity()` — walks configs in priority order, admitting per language.
- `_try_admit()` + `_get_admit_script()` — **a Lua script making read-check-increment atomic across all pods**, because otherwise concurrent admissions each read an under-limit count and all increment.
- Two cap layers: per-assistant and global. A provider with no threshold is unlimited and never touches Redis — and every language is expected to have one, so **a live call is never dropped**.
- `release_capacity_once()` — called first in cleanup, unconditionally.
- `_resolve_without_redis()` — graceful degradation.

**`asr_capacity.py` · `tts_capacity.py`** · 45 / 59 lines

Thin service-specific entry points over `capacity.py`. Deliberately thin — the docstring notes that two copies of the Lua script drifting is exactly the cross-pod cap breach the script prevents.

**`gender_from_pitch.py`** · 308 lines

YIN F0 estimation and reject-option classification. No ML, deliberately.

- `identify_gender()` — the entry point, returning gender, median F0, voiced-frame evidence and a human-readable reason.
- `_yin_frame()` and the four YIN steps: `_cumulative_mean_normalized_difference()`, `_pick_lag()`, `_parabolic_interpolation()`.
- Guards: an RMS gate (silence otherwise reads as perfect periodicity), minimum voiced frames and ratio, and a median rather than a mean to survive octave errors.

**`tts_cache.py`** · 182 lines

Two-tier cache: Redis holds an index (key → S3 URL) with a 7-day TTL; S3 holds the audio. Blocking calls run in `asyncio.to_thread` so the event loop stays free. Self-heals stale index entries on `NoSuchKey`, and every failure path returns a miss rather than raising.

**`service_keys.py`** · 255 lines

Per-client vendor credentials. `get_service_keys()` and `get_client_service_keys()` read from Secrets Manager with a Redis cache and an environment-variable fallback. `invalidate_service_keys()` for rotation.

**`sip.py`** · 311 lines

SIP helpers for LiveKit. `extract_call_details_from_participant()`, `get_dial_result_from_error()`, `build_history_info_header()` (RFC 7044), `build_user_to_user_header()` (carries the interaction UUID to Avaya), `bridge_agent_swap()`.

**`tracing.py`** · 82 lines

`traced_tts_with_request_id()` — pipecat's `@traced_tts` plus the vendor request id and **cache-hit status** on the span. That last attribute is how TTS cache hit rate is measured in production.

## frames, types, and the rest

**`frames/frames.py`** · 246 lines

All 27 custom frames — §04. The fastest way to see what this product does beyond stock pipecat.

**`types/livekit.py`** · 140 lines

`LiveKitSessionConfig`, `SessionContext` (mutable per-call state), `CallState` (the lifecycle state machine), and `DialResult` (the outbound outcome reported to Kinesis).

**`compliance/audit.py`** · 387 lines

`CallComplianceAuditor` — rule-based, no external calls. Three checks: business hours, unauthenticated debt reveals (reasoned over the *disposition trace*, not the transcript), and blocking dispositions.

Returns `completed`, `disabled` or `error` — three states, because "we didn't check" must never be recorded as "we checked and it was clean".

**`evaluation/evaluation.py`** · 458 lines

`CallEvaluation` — post-call scoring with an LLM against configured boolean and score metrics. Builds a transcript, builds a rubric prompt, requests structured output.

## Task → file map

| You want to… | Go to |
|---|---|
| Understand the pipeline order | `pipeline/pipecat_bots.py` → `create_pipeline()` |
| Change when a turn ends | `pipeline/endpointing.py` |
| Change barge-in behaviour | `pipeline/context.py` → `_maybe_interrupt_from_*` |
| Add a vendor | `services/factory.py` + a new `services/*.py` |
| Debug wrong transcription | `processors/gates.py`, then the ASR service |
| Debug the bot talking over the caller | `transport/livekit.py` → `_clear_audio_buffer()` |
| Debug a clipped goodbye | `transport/livekit.py` → `_wait_for_audio_playout()` |
| Debug a wrong or missing recording | `processors/audio_recorder.py` → `cleanup()` |
| Change idle behaviour | `processors/user_idle.py` + `create_user_idle_processor()` |
| Add a control tag | `processors/tags.py` |
| Change what's persisted | `processors/db_writer.py` |
| Add a metric | `observers/metrics_observer.py` + `app/instruments/metrics.py` |
| Change vendor concurrency limits | `utils/capacity.py` |
| Change transfer behaviour | `handlers/livekit_session.py` → `_handle_bridge_transfer()` |
| Add a custom frame | `frames/frames.py` |
| Change prompt caching | `services/gemini.py` |
| Change TTS caching | `utils/tts_cache.py` + the service's `_make_cache_key()` |

## Interview answers

#### Q — How is the voice runtime structured?

"Two transports, one pipeline. gRPC mode runs several worker processes behind nginx and the carrier streams to us; LiveKit mode runs one process where the Agent SDK dispatches a job per call and we join a room. Both converge on a single `PipelineConfigManager`, and everything after that is transport-agnostic.

The pipeline itself is pipecat's model — typed frames flowing through an ordered list of processors. Everything is either a frame, a processor, or the pipeline.

Vendors are built by a factory from database config, so no vendor name appears anywhere in the pipeline code. Switching an LLM or a TTS provider is a config row, not a deploy.

State is per call — its own transport, connections, context and recorder. The only shared state is in Redis: capacity counters, the TTS cache index, the prompt cache handle. That's what makes the fleet horizontally scalable."

#### Q — Explain the frame system.

"A frame is a typed message; a processor receives frames, may act, and pushes them on; a pipeline is an ordered list of processors. Frames travel downstream toward the caller's ear or upstream back toward the microphone.

There are three base types with different queueing. DataFrames carry content and queue in order. ControlFrames are ordered signals. **SystemFrames jump the queue** — and that's essential, because when a caller interrupts there may be seconds of audio queued ahead, and an interruption signal that waited its turn would arrive after the audio it was meant to cancel.

The related trap is EndFrame versus CancelFrame. EndFrame is ordered, so it waits for everything pending and can block indefinitely. CancelFrame is a SystemFrame and is immediate. Using the wrong one produces a hang that looks like a deadlock.

And the thing I'd emphasise: **order is behaviour**. A processor only sees frames that reach it, so several positions in our pipeline are load-bearing and commented as such — the recorder sits after the transport output so it records what was sent rather than what was generated, and the tag processor sits immediately before TTS so the caller never hears the markup."

#### Q — What's the most interesting file in there?

Pick one and go deep. Two good options.

"`utils/capacity.py`. Vendor connections are metered and shared across 64 pods, so the counters live in Redis. Admission is read-check-increment, which races — three pods reading a counter of 9 against a limit of 10 all see themselves as under it and all increment. The fix is a Lua script, because Redis runs one as a single indivisible command. There's a nice detail in the docstring too: ASR and TTS share one copy of that script deliberately, because two copies drifting would reintroduce exactly the bug it prevents. And every language is expected to have an unlimited provider as a floor, so hitting a cap degrades the vendor choice rather than dropping a live call.

Or `observers/metrics_observer.py`, whose docstring enumerates ten distinct frame orderings for 'the user stopped speaking' — late VAD, VAD bypass, failed attempts, retries. It uses session tracking so a stale timestamp from a failed attempt can't corrupt the next turn's latency. That's the kind of thing you only write after being burnt by wrong metrics."

## Glossary

- **OSV** — The voice runtime — `app/runtime/voice/`.
- **Frame** — A typed message flowing through the pipeline.
- **Processor** — A pipeline stage receiving and pushing frames.
- **Pipeline** — An ordered list of processors.
- **Upstream / downstream** — Toward the microphone / toward the caller's ear.
- **DataFrame / ControlFrame / SystemFrame** — Content / ordered signal / queue-jumping urgent signal.
- **EndFrame vs CancelFrame** — Ordered graceful stop vs immediate stop.
- **ParallelPipeline** — Several sub-pipelines over the same frames.
- **Gate** — A processor that drops frames unless a condition holds.
- **Observer** — Watches frame pushes without being in the pipeline.
- **Aggregator** — Builds a conversational turn and commits it to context.
- **Turn strategy** — Pluggable start/stop decision for a user turn.
- **Dynamic VAD** — Adjusting `stop_secs` from the transcript's last character.
- **Smart turn** — An ONNX model classifying turn completeness.
- **BargeInSpokenTextFrame** — What was actually heard before an interruption.
- **TerminalFrame** — A hangup or transfer has begun; downstream goes quiet.
- **Aggregatable TTS** — Implements `update_language_config`; one connection, many languages.
- **ServiceFactory** — Builds vendor services from database config.
- **Capacity keys** — Redis-tracked vendor concurrency reservations.
- **Mod prefix** — Convention for a subclassed pipecat service.

---

*Generated from the source tree of `app/runtime/voice/`. Line counts are a snapshot; class and method names are the durable handle.*
*Companion documents: anatomy of a call · beyond one process · the shape of a voice · the cost of a token · pipecat upgrade · telephony.*
