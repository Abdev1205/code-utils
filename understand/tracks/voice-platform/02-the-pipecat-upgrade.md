# The Pipecat Upgrade

**Topic:** This repo
**Covers:** 0.0.104 to 1.4.0 migration: what broke, what changed, how to test
**Source:** [Claude artifact](https://claude.ai/artifact/4UmRf4URm73fSWwTTT4Fw4) — written by a colleague, mirrored here for study.

*Migration, explained from nothing*

A framework we depend on published a release that deliberately broke things. This is what broke, why, what we did about each one, how you test an upgrade like this — and the bugs that only showed up weeks later.

## What is a framework upgrade?

*Understand first · 01*

**Start here**

Our code doesn't do everything itself. It sits on top of **Pipecat**, an open-source library that provides the machinery for real-time voice — the conveyor belt that audio travels along, the plumbing to speech and language vendors, the handling of interruptions.

We don't control Pipecat. Another team writes it and publishes new versions. When we want their improvements, we upgrade — and their changes become our problem.

Most upgrades are boring. You change a version number, reinstall, everything works.

This one was not boring. We went from version `0.0.104` to `1.4.0`, and in between the authors did a deliberate spring-clean: they **deleted** pieces we were using, moved things to new locations, and changed how several functions are called.

**Why bother at all?**

You could stay on the old version forever. Teams do, and then they can't. Reasons we moved:

- **Security.** Old versions stop getting patches.
- **New features.** Smart turn detection — the thing that stops the bot interrupting mid-sentence — needed the new release.
- **Vendor SDKs.** Speech vendors ship new client libraries; old framework versions pin old ones.
- **Compounding.** The longer you wait, the bigger the jump. Skipping five releases means facing five releases' worth of breakage at once.

## Why "1.0" was the scary part

*Understand first · 02*

Software versions usually follow a convention called **semantic versioning**, written `MAJOR.MINOR.PATCH`:

```
1  .  4  .  0
│     │     └── PATCH — bug fixes, safe
│     └──────── MINOR — new features, still safe
└────────────── MAJOR — things may break
```

The promise is: if only the last two numbers change, your code keeps working.

Pipecat was on `0.0.104`. That leading zero is a signal in itself — it means "pre-1.0, we reserve the right to change anything". Going to `1.0.0` is the moment a project cleans up everything it wished it had done differently, *because after 1.0 it has promised not to*.

**So this was the one upgrade guaranteed to hurt**

All the accumulated awkwardness gets fixed at once. In exchange, every upgrade after this one should be easy — which is exactly why you take the pain rather than avoid it.

**Alternatives — what else could we have done?**

| Option | Consequence |
| --- | --- |
| **Upgrade** (chosen) | Weeks of work, but stays current and unlocks new features |
| **Stay on 0.0.104 forever** | Free today. No security patches, no new vendor SDKs, and the eventual jump gets worse every month |
| **Fork pipecat** | Total control, and you now maintain a voice framework as well as a product. Only sane if you have a team for it |
| **Drop pipecat, write our own** | Six months to rebuild solved problems |
| **Move to a different framework** | Same breakage, plus learning a new system, plus rewriting every vendor adapter |

Upgrading is nearly always right. The interesting question is only *when*, and the answer is "before the gap gets too wide".

## Four kinds of breakage

*Understand first · 03*

Understanding this classification is worth more than memorising any individual change, because it tells you where to spend your testing effort.

| Kind | How you find out | Danger |
| --- | --- | --- |
| **1. It's gone** — a function or class was deleted | Program refuses to start — `ImportError` | **Low.** Loud, immediate, unmissable |
| **2. It moved** — same thing, new location or name | `ImportError`, or nothing at all if it's a string | **Low–medium** |
| **3. It's called differently** — arguments changed | `TypeError` — but only if that line runs | **Medium.** Hides in error paths you rarely hit |
| **4. It behaves differently** — same name, same arguments, new behaviour | **Nothing.** It just does the wrong thing | **High** |

**Category 4 is the whole game**

Categories 1–3 cost hours. You run it, it fails, you fix it, you move on.

Category 4 costs weeks. The code imports. The tests pass. You ship. And then calls start going silent halfway through, or recordings drift out of sync, or the bot starts interrupting people — and none of it points back to the upgrade you did last month.

**In this migration, four of the ten changes were category 4.** Every single one was found by a human making a phone call. Not one was caught by automated tests.

## What actually happened

*Understand first · 04*

The git history tells the honest story better than any summary:

```
── the core migration, all on 1 July ──
38bd1018  bump pipecat-ai to 1.4.0
16afc1c0  vendor pipecat UserIdleProcessor (removed in 1.0.0)
6287a66a  vendor pipecat STTMuteFilter (removed in 1.0.0)
71c3abd0  fix removed code crashes
d5982332  update asr services with 1.4.0 contract

── the tail: found by running it, over the following weeks ──
fdbda745  adapted pipecats push_error signature
3942a587  azure and sarvam tts fix after pipecat upgrade
c2db82dc  min-words: reconcile with master after rebase
e34d436c  turns: restore user_aggregation_timeout endpointing latency
2c8c4fe4  turns: restore emulated-VAD turn handling from master
8193fdbe  tracing: resolve tts span from 1.4.0 registry
df783a97  test: add 1.4.0 audio-context attrs to the TTS test double
6ec9be87  pin 1.4.0 in lambda.requirements.txt too
99232129  cartesia: move playback wait out of the receive task
ba204165  cartesia: audit hardening
cafa94e8  recording: inherit pipecat's recorder sync
```

**The shape to notice**

**Five commits made it run. Eleven more made it correct.**

If you ever plan an upgrade like this, plan for the tail. The day it starts up successfully is roughly a third of the way through, not the end.

## The ten changes

*Every change · 05*

### 1 · The dependency knot — blocking

Before any code could change, the *libraries* had to agree with each other. They didn't.

**What a dependency conflict is**

Our project uses many libraries. Those libraries use libraries. Sometimes two of them demand different versions of the same third thing — and only one version can be installed. That's a conflict, and nothing works until it's resolved.

Here, three packages were fighting over `grpcio` (Google's networking library):

```
nvidia-riva-client  needs  grpcio == 1.67.1   (exactly)
pipecat 1.4.0       needs  grpcio ~= 1.78     (1.78 or later)
                           ↑ impossible — no version satisfies both
```

The upgrade was **not possible** until NVIDIA released version 2.25 of their client, which relaxed its demand to `>=1.67.1,<2`. Then both could be satisfied.

The final pins, with the reasoning kept next to them in `requirements.txt`:

```diff
- pipecat-ai[assemblyai,…,local-smart-turn-v3,…]==0.0.104
+ pipecat-ai[cartesia,deepgram,google,nvidia,openai,…]==1.4.0
- grpcio-tools==1.67.1
+ grpcio-tools~=1.78.0   # pipecat needs ~=1.78; riva 2.25+ now allows it
+ deepgram-sdk>=6.1.1,<7 # hold at 6.x; 7.x is a major we haven't validated
- onnxruntime~=1.23.2
+ onnxruntime~=1.24.3
```

Two extras were dropped, which is a real change and not tidying: `assemblyai` (a speech vendor we no longer support) and `local-smart-turn-v3`.

**Two traps**

**Multiple requirements files.** The pin was updated in `requirements.txt` and the AWS Lambda build was forgotten — fixed later in `6ec9be87`. Always grep for every requirements file.

**Write down why.** Every pin here carries a comment explaining what forces it. Without that, someone "tidies up" the pin in six months and re-breaks the build. The comments are the point.

**How to test this step**

```bash
pip install -r requirements.txt        # does it even resolve?
python -c "import pipecat; print(pipecat.__version__)"
```

Do this in a **fresh virtual environment**. An existing one may already have compatible versions installed and hide the conflict.

### 2 · Vendoring deleted code — loud

Two components we depended on were deleted in 1.0.0, with no replacement offered.

**What "vendoring" means**

Copying someone else's code into your own repository so you can keep using it. You now own it — you maintain it, and it no longer improves when they improve theirs.

| Deleted | What it did | Why we couldn't drop it |
| --- | --- | --- |
| `STTMuteFilter` | Blocks the caller's microphone from reaching speech recognition while the bot is talking | Without it the bot hears *itself* through the open phone line and transcribes its own voice as if the caller said it |
| `UserIdleProcessor` | Notices the caller has gone quiet for too long | "Are you still there?" and hanging up on abandoned calls |

**A detail inside the mute filter that everything else depends on**

When it blocks the caller's audio, it doesn't throw it away — it hands it straight to the audio recorder:

```python
if self._audio_recorder is not None and self._is_muted \
        and isinstance(frame, InputAudioRawFrame):
    await self._audio_recorder.feed_input_audio(frame)
```

Why: the recorder counts microphone packets to know what time it is. Stop feeding it and its clock stops, so every later piece of bot audio gets written at the wrong position. Delete this line and recordings break in a way that looks nothing like a mute-filter bug.

**Alternatives to vendoring**

- **Drop the feature** — not an option; both are load-bearing.
- **Find a replacement in 1.0** — there wasn't one.
- **Rewrite from scratch** — more work than copying, same maintenance burden.
- **Vendor it** (chosen) — fastest, and the code was already proven.
- **Pin to the old version** — that's just not upgrading.

The cost of vendoring is real: these files no longer track upstream, and nothing warns you when they drift. The mitigation is the signature test harness described later.

### 3 · A feature quietly lost — silent

A third component, `MinWordsInterruptionStrategy`, was also deleted — but this one was rewritten inline rather than vendored, and something was dropped in the process.

**What the feature does**

Stops a single stray word from interrupting the bot. A cough, an "mm-hm", background TV — you don't want any of those to cut the bot off. So: require at least N words before treating it as a real interruption.

```python
async def should_interrupt_from_interim(self, text: str) -> bool:
    if not text:
        return False
    word_count = len(text.split())
    return word_count >= self.barge_in_config.min_words_interruption_count
```

**The bit that got lost**

The old version also had **whitelisted words** — words that interrupt immediately regardless of count. Things like "stop", "agent", "hello". In the rewrite that check is commented out:

```python
# if any(word in text for word in self._whitelisted_words):
#     return True
```

The configuration field still exists and is still accepted. So an assistant configured with whitelisted words gets **no error and no effect**. A caller shouting "STOP" now has to say enough words to clear the threshold.

Config that silently does nothing is worse than config that was removed. Either restore the feature or delete the field.

**How you'd catch this class of bug**

A test that asserts configuration actually changes behaviour — not just that it parses. "Given whitelisted_words=['stop'], when the interim text is 'stop', then interrupt." That test would be red right now.

### 4 · Things that just moved — mechanical

Individually trivial. Collectively they're the first two hours of any upgrade.

| Before | After |
| --- | --- |
| `pipecat.services.google.llm_vertex` | `pipecat.services.google.vertex.llm` |
| `create_default_resampler()` | `create_stream_resampler()` |
| `TaskObserver` | `WorkerObserver` |
| `deepgram.clients.common.v1.…` | `deepgram.listen.v1.socket_client` |

**The last one is different, and worse**

That's not an import — it's a **string**, passed to a function that silences a noisy logger. Get an import wrong and Python stops. Get a string wrong and *nothing happens*: you just silently stop silencing the logger you meant to silence, or silence one that doesn't exist.

Renames that live in strings are the ones that survive a migration unnoticed. Grep for the old name across the whole repo, not just in imports.

The resampler rename isn't purely cosmetic either. A *stream* resampler keeps state between calls, which matters for continuous audio. Don't assume a like-for-like swap just because the new name is available.

### 5 · A frame changed shape — loud

The way you inject a message into the conversation changed.

```diff
- LLMMessagesFrame({"system": "Repeat the previous response in the new language"})

+ LLMMessagesAppendFrame(
+     messages=[{"role": "system",
+                "content": "Repeat the previous response in the new language"}],
+     run_llm=True,
+ )
```

The new shape is genuinely better: `role` is explicit, and `run_llm` separates *"add this to the conversation"* from *"and reply right now"*, which used to be implicitly bundled.

**Where this fires, and why that's dangerous**

Both places are on the **mid-call language switch** path — when a caller says "can we speak in Hindi?".

No ordinary test call reaches that code. You could break it completely and every smoke test would pass. The symptom in production would be a bot that goes silent at exactly the moment a caller switches language.

**Test it deliberately**

Add "switch language mid-call" to your manual checklist. It's one of those paths that only gets exercised on purpose.

### 6 · An error-reporting call changed — loud, but hides

```diff
- await self.push_error(ErrorFrame(f"{self}: {e}", fatal=True))
+ await self.push_error(error_msg=f"{self}: {e}", exception=e, fatal=True)
```

The old call wrapped an error object inside another error object. The new signature takes plain values.

**Why this one hides**

It's inside an `except` block. That code only runs *when something else has already gone wrong*. So the upgrade looks clean, and then the first time a vendor hiccups, the error handler itself crashes — and now you have a failure while reporting a failure, which is a miserable thing to debug.

Error paths are the least-tested code in almost every codebase. After an upgrade, deliberately break something to make sure the handling still works.

Worth knowing: this same mistake still exists in some of pipecat's own services. Don't copy error handling from upstream without checking it.

### 7 · The speech vendor's SDK changed — partly silent

The biggest change, and it came from Deepgram rather than pipecat.

Three mechanical parts, all loud:

```diff
- from deepgram import LiveResultResponse
+ from deepgram.listen.v1.types import ListenV1Results

- base_url = "wss://api.deepgram.com/v1/listen"
+ base_url = "wss://api.deepgram.com"        # host only now

- await self._connection.finalize()
+ await self._connection.send_finalize()
```

#### And one change of shape, which is the dangerous one

**What changed conceptually**

**Before:** we registered a handler for the "transcript" event specifically. It only ever received transcripts.

**After:** the SDK sends *every* kind of message — transcripts, metadata, "speech started", "utterance ended" — to a *single* handler.

Our handler assumed everything arriving was a transcript. Now it isn't.

```python
async def _on_message(self, message):
    # v6 delivers ALL message types here. Anything that isn't a transcript
    # must go to the base handler, which gates SpeechStarted/UtteranceEnd
    # on vad_enabled exactly as 0.0.104 did.
    if not isinstance(message, ListenV1Results):
        await super()._on_message(message)
        return
    result = message
```

**What happens without the `super()` line**

Our handler **swallows** the "speech started" and "utterance ended" events. Those are what drive turn detection.

The bot still transcribes perfectly. A test call sounds fine. But the sense of when you've finished speaking quietly degrades — the bot starts talking over people, or waiting too long. Weeks later someone says "the bot feels worse" and nobody connects it to a speech-SDK upgrade.

This is category 4 in its purest form.

**Testing this**

```bash
pytest app/runtime/voice/tests/services/test_deepgram_asr.py -v
```

**Breakpoint:** `_on_message` in `services/deepgram.py`. Print `type(message)` on the first few calls — you'll immediately see the variety of message types arriving, which is the whole change made visible.

### 8 · The silent deadlock — silent

Nothing failed to import. No signature changed. The bot simply went permanently silent halfway through some calls while the language model kept cheerfully generating replies into the void.

**What a deadlock is**

Two parts of a program each waiting for the other. Neither can move. Nothing crashes — it just stops, forever.

#### The mechanism

Pipecat's TTS base class has a feature: when the model finishes a response, **pause the input queue** until the bot has finished speaking. Sensible — it stops sentences overlapping. The resume signal is "bot stopped speaking".

But our code already handles that differently: our `run_tts` holds itself open for the whole playback duration.

On a cache hit — where audio is already stored and returns instantly — the order inverts:

```
1. cache hit, audio delivered immediately
2. the audio finishes playing
3. "bot stopped speaking" fires        ← the resume signal, arriving EARLY
4. our run_tts finally returns
5. the pause engages                   ← too late; resume already went past
6. nothing ever resumes it → silence for the rest of the call
```

The fix is one line per service:

```python
self._pause_frame_processing = False
```

Justified because our playback hold already does the job the pause was there to do. The pause adds nothing except a window in which to deadlock.

**This needed fixing in five separate services**

Azure and Sarvam in this commit; Cartesia, ElevenLabs and Smallest earlier. Add a sixth TTS vendor and you'll need it again.

When the same one-line fix appears in five files, that's the codebase telling you it belongs in a shared base class.

**How you find a deadlock**

You can't grep for it. Signs, in order of usefulness:

1. **The symptom:** the bot stops speaking but the logs show the LLM still producing replies. That gap — model working, no audio — points straight at TTS.
2. **Trigger it deliberately:** say the same thing twice so the second one is a cache hit. That's the exact path that deadlocks.
3. **Dump the stacks:** `faulthandler.dump_traceback()` shows every task and where it's stuck. A task parked on an `await` that will never complete is your deadlock.

### 9 · Tracing broke, quietly — silent

**What tracing is**

Every call emits a timeline of what happened and how long each stage took — speech recognition 0.31 s, model 0.62 s, speech synthesis 0.71 s. It's how you answer "why was that call slow?" without guessing.

1.4.0 changed how a service finds its own active timeline entry. Our lookup returned nothing, so TTS stages silently stopped being recorded.

**Why this is nastier than it sounds**

The tool you'd use to notice the problem *is* the tool that broke. Nothing errors. Dashboards still render. There's just a gap where TTS timings used to be, and nobody looks at a dashboard thinking "what's missing?"

**Add this to every upgrade checklist**

Make one call, then open the trace and confirm **every expected stage is present** — STT, LLM, TTS — and correctly nested under the call. Thirty seconds of checking that would have caught this immediately.

### 10 · Turn-taking drifted — silent

Two commits, both named *restore*: `e34d436c` restored endpointing latency, `2c8c4fe4` restored turn handling for the emulated-VAD path.

These come from the biggest architectural change in 1.0 — the replacement of per-vendor conversation objects with one universal system. The pieces that decide *"has this person finished talking?"* were rewritten, and their timing shifted.

Nothing errored. Conversations just got slightly worse: the bot waiting a beat too long, or cutting in a beat too early. On one path — the one used with Whisper-style recognisers — turn detection broke entirely.

**You cannot unit-test your way to catching this**

There's no assertion for "the conversation feels natural". It needs replayed real calls, or a human on a phone deliberately pausing mid-sentence. Budget time for it.

## How to test an upgrade

*Testing · 06*

Four layers. Each catches something the one before cannot, and the last one is the only one that catches category 4.

| Layer | Command | Catches | Blind to |
| --- | --- | --- | --- |
| **1. Does it start?** | `python -c "import app.runtime.voice.pipeline.pipecat_bots"` | deleted and moved things | everything else |
| **2. Signatures** | `pytest …/test_pipecat_compatibility.py` | changed arguments your mocks are hiding | behaviour at the same signature |
| **3. Unit tests** | `pytest app/runtime/voice/tests -q` | your own logic | anything mocked; cross-processor ordering |
| **4. Real calls** | a phone | **everything** | nothing — but slow and manual |

**The uncomfortable fact**

All four silent breakages in this migration — the deadlock, the tracing, and both turn-taking regressions — passed layers 1, 2 and 3. Every one was found at layer 4.

So layer 4 is not optional, and because it's manual it needs a *written list* or it gets skipped.

**The manual checklist**

1. **A plain call.** Greeting, three turns, hang up. Catches nothing subtle, catches everything catastrophic.
2. **Barge-in.** Talk over the bot. Does it stop? Does its next reply mention words you never heard?
3. **A long pause.** Stop for two seconds mid-sentence. Does it wait, or cut you off?
4. **A repeat.** Say something you already said, so TTS serves it from cache. *This is the path that deadlocked Azure and Sarvam.*
5. **Language switch.** The only path that exercises the changed frame type.
6. **Every TTS vendor you ship.** The deadlock was per-service.
7. **Hang up mid-sentence,** while the bot is speaking.
8. **Check the trace** — are all stages present?
9. **Check the recording** — length within a second of the call, no gaps mid-word?

## The signature harness

*Testing · 07*

The most valuable single file to come out of this migration is `app/runtime/voice/tests/services/test_pipecat_compatibility.py`.

**The problem it solves**

Our services subclass pipecat's. Our tests mock the parent so they run fast without hitting real vendors.

Here's the trap: **when the parent's signature changes, a mock doesn't care.** The mock accepts whatever arguments you give it. Your tests stay green. Your production code is broken.

The harness sidesteps mocks entirely by inspecting the *real, installed* classes:

```python
import inspect

def _get_param_names(method):
    return [n for n in inspect.signature(method).parameters if n != "self"]

def _assert_signature_compatible(child_cls, parent_cls, method_name):
    # compare our override against the parent that is actually installed
    ...
```

If pipecat changes an argument list, this fails on the next CI run instead of on a customer call. With 24 vendor adapters in this repo, it's the difference between an upgrade taking a day and taking a fortnight.

**Extend it when you add an override**

Any time you override a framework method, add a line here. It costs thirty seconds and it's the only automated protection against category 3.

## Where to put breakpoints

*Testing · 08*

**Read this before you set one**

A breakpoint stops the program. Audio keeps arriving from the network at 50 packets a second. When you continue, everything is late and the call is ruined.

So breakpoints are for **inspecting state**, never for **judging timing**. If you're chasing a gap or a sync problem, a breakpoint will invent the symptom you're hunting.

| Upgrade question | Where to stop |
| --- | --- |
| Is the new version even loaded? | `import pipecat; pipecat.__version__` |
| What message types is the SDK sending now? | `_on_message` in `services/deepgram.py` |
| What is being sent to the model? | `app/llm/context_manager.py` |
| What text is about to be spoken? | `run_tts()` in the TTS service |
| Did the pipeline build as expected? | `pipeline/pipecat_bots.py`, after the list is assembled |
| Why did the call end? | `_cleanup()` in `handlers/livekit_session.py` |

Prefer **conditional** breakpoints so you stop on the case you care about:

```python
if isinstance(frame, BotStartedSpeakingFrame):
    breakpoint()
```

**For a suspected deadlock, don't use a breakpoint at all**

Dump every task's stack and read where they're parked:

```python
import faulthandler, signal
faulthandler.register(signal.SIGUSR1)     # then: kill -USR1 <pid>
```

A task sitting on an `await` that will never complete is your deadlock, and this shows you exactly which one.

## What CI does and doesn't do

*Testing · 09*

**What CI is**

Continuous integration — a server that automatically runs checks on every change. Here it's GitLab CI, configured in `.gitlab-ci.yml`.

| Job | What it runs | Can it block a merge? |
| --- | --- | --- |
| `lint_python` | `ruff check .` | yes |
| `test_python` | interface, models, llm, text, lambda… | yes |
| `test_voice_runtime` | the 677 voice tests | **no** |
| `quality_sast` | security scan | yes |

**The voice tests cannot block a merge**

`test_voice_runtime` is marked `allow_failure: true` — "experimental, failures won't block pipeline" — and the voice paths are commented out of `pytest.ini`.

So **a green pipeline does not mean the voice tests passed.** During a framework upgrade this matters enormously: the tests covering the thing you just changed are advisory. You have to open the job and read the output yourself.

There's also a `skipTests` label that turns off both suites entirely.

## The long tail

*Close · 10*

Two bugs surfaced later that weren't upgrade commits but were upgrade consequences — the migration changed timing and inheritance, and these fell out.

### Sleeping in the wrong place

The Cartesia service waited for playback *inside its websocket receive loop*. That loop is not cancelled when a caller interrupts, so it stayed parked for the cancelled sentence's remaining duration. Symptom: after a barge-in, the next reply had seconds of dead air and then arrived all at once.

The rule that came out of it, now written into the project's guidance: **receive-loop handlers must return immediately.** Store or signal only. Any waiting belongs in `run_tts`, which *is* cancelled on interruption.

### A hand-copied override that rotted

The audio recorder had overridden a pipecat method with a copy of an older version of that method. In 1.4.0, the real method also sets a flag meaning "the bot is currently speaking" — and that flag is what stops the framework injecting silence into someone who's mid-word.

Our copy didn't set it. So the guard was permanently off, and the recorder wrote silence into the bot's track every time the caller spoke. Measured on one call: **588 padding events, 21 seconds of silence inserted, recordings 8–15% too long, 17 audible gaps mid-word.**

Deleting the override and inheriting the real method fixed all of it, and made the file smaller.

**The general lesson**

A hand-copied override of a framework method is **a time bomb with no timer**. It works against the version you copied from and silently diverges from every version after.

If you must override, override the smallest possible thing, leave everything else inherited, and write down which upstream version you copied from.

## Runbook for the next upgrade

*Close · 11*

1. **Read the changelog end to end.** Hunt specifically for removals and renames — those set the size of the job.
2. **Check it's even possible.** Resolve the dependency graph first. This upgrade was blocked for months waiting on NVIDIA.
3. **Bump the version alone, in its own commit.** Let it fail. The errors are your work list.
4. **Fix imports and signatures** until it starts.
5. **Run the signature harness.** It finds what your mocks are hiding.
6. **Grep every requirements file** — main, dev, lambda.
7. **Now make calls.** Work the nine-item checklist. This is where the real bugs are.
8. **Check the trace and a recording** before declaring victory.
9. **Write the reason next to every pin.** It's why the next person won't undo it.
10. **Append what you learned** to `docs/framework/pipecat.md`. It's append-only by design — each entry exists because someone lost hours.

## Interview answers

*Close · 12*

**Q: Walk me through the upgrade.**

Don't list commits. Give the shape, then one deep example.

"Pipecat went 0.0.104 to 1.4.0 — a deliberate breaking release. Four categories of work: components deleted upstream that we had to vendor, module paths moved, a couple of signatures changed, and native dependencies re-pinned.

The interesting part wasn't any of that — it was the fourth category, changes with no API change at all. The clearest example: pipecat's TTS base pauses its input queue after a response and resumes on 'bot stopped speaking'. Our code already serialised playback a different way, and on a TTS cache hit the resume signal fired *before* the pause engaged. The pause then latched with nothing left to release it and the bot went permanently silent for the rest of the call, while the LLM kept generating.

Nothing failed to import, nothing errored, tests were green. It was found by making a call."

**Q: How do you test a framework upgrade?**

Four layers, and be explicit that the last one is the one that matters.

Import check, signature compatibility, unit tests, real calls. Then the honest bit: "every silent breakage in our migration passed the first three. All four were found on layer four. So I keep a written manual checklist — plain call, barge-in, long pause, cache hit, language switch, every TTS vendor, hang up mid-sentence, then check the trace and the recording."

Mentioning the signature harness scores well: mocks keep passing after a parent's signature changes, so you need introspection against the real installed class to catch that.

**Q: Vendoring means you own that code forever. Was it the right call?**

Yes, with the cost named. The alternatives were: drop features that are load-bearing (no), rewrite from scratch (more work, same maintenance), or don't upgrade (compounds).

The cost is real — the vendored files no longer track upstream and nothing warns you when they drift. Two mitigations: keep them as thin as possible so the diff against upstream stays readable, and have the signature harness compare against the installed parent on every CI run.

Then add the counter-example, because it makes the point: we *also* had a hand-copied override in the audio recorder that nobody flagged as vendored, and it silently rotted across the upgrade and corrupted every recording. The difference between the two is that one was deliberate and marked, and the other was accidental.

**Q: You said a dependency conflict blocked you. Explain.**

"NVIDIA's Riva client pinned grpcio to exactly 1.67.1. Pipecat 1.4.0 needed 1.78 or later for the protobuf 6 toolchain. Those are mutually exclusive — no single version satisfies both, so the upgrade was impossible, not merely hard.

It unblocked when Riva 2.25 relaxed its own constraint to a range. Worth saying out loud because the lesson generalises: sometimes the correct engineering answer is 'we can't do this yet, and here's which third party has to move first' — and knowing that saves you a week of trying."

**Q: What would you do differently?**

Three honest answers:

- **Check telemetry immediately.** Tracing broke silently and stayed broken for a while. A thirty-second check after the first call would have caught it.
- **Test that config still does something.** The whitelisted-words interruption feature is commented out but still configurable — accepted, ignored, no error. A test asserting behaviour rather than parsing would have caught it.
- **Make the repeated fix shared.** The same one-line TTS fix is now copied into five services. That's the codebase asking for a base class.

---

Sources: git history `38bd1018…d5982332` and follow-ups · `requirements.txt` · `.gitlab-ci.yml` · `docs/framework/pipecat.md` · pipecat-ai 1.4.0 source

Two open items: whitelisted-words interruption is disabled but still configurable; the TTS pause fix is duplicated across five services.
