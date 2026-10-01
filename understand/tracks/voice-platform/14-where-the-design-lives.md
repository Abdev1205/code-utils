# Where the Design Lives

**Topic:** Design in your code
**Covers:** 31 design patterns, the file each lives in, what breaks without it
**Source:** [Claude artifact](https://claude.ai/artifact/AdR6aN1JFJo6QWAjexbPPx) — written by a colleague, mirrored here for study.

31 patterns · each one, in your code

Thirty-one system design patterns that are already in this codebase — what each one is, why it exists, the exact file it lives in, and what would break without it.

#### The point of this document

You have been asked to describe your system design. The honest, powerful answer is not an abstract diagram — it's **"here is a named pattern, and here is the line of code where I applied it, and here is what happens if you remove it."**

Almost every pattern below was written by someone solving a specific problem, usually with a comment explaining why. This document names them so you can talk about them as design rather than as code.

## How to use this

#### Each entry has five parts

**Definition**
What the pattern is, in general terms.

**Why it exists**
The problem it solves.

**In your code**
The file, and the actual implementation.

**Without it**
What specifically breaks — this is the part that proves you understand it.

**How to say it**
The sentence to use in an interview.

#### The three companion documents

**Blueprint and Bill** is the *method* — how to design a system and how to run a design interview. **The OSV Field Guide** is the *index* — every file and what's in it. **Anatomy of a Call** is the *narrative* — one call, stage by stage.

This one is the *vocabulary*: names for the things you already built.

## Pipeline

### 01 · Pipeline / Chain of Responsibility

**Definition**

Data flows through an ordered series of independent stages. Each stage does one thing and passes the result on, without knowing what comes before or after it.

**Why it exists**

A voice call has a dozen distinct concerns — muting, recognition, endpointing, aggregation, generation, tagging, synthesis, recording. Written as one function it would be unreadable and untestable. As stages, each is independently replaceable.

**In your code**

```python
pipeline_processors = [
    self.transport.input(),
    self.gender_processor,
    stt_mute_processor,
    asr_pipeline,
    self.dtmf_processor,
    user_idle,
    user_input_transformer,
    self.context_aggregator.user(),
    llm,
    filler_processor,
    db_writer_processor_bot,
    tag_processor,
    tts_pipeline,
    self.transport.output(),
    self.audio_recorder,
    self.context_aggregator.assistant(),
]
return Pipeline(pipeline_processors)
```
`pipeline/pipecat_bots.py · create_pipeline()`

Every stage implements the same contract: `process_frame(frame, direction)`, act, then `push_frame()`.

**Without it**

One thousand-line function. Adding filler words would mean editing the generation path. Testing endpointing would require a full call. And you could not reorder anything — which matters, because in this pipeline *order is behaviour*.

**How to say it**

"The voice runtime is a frame pipeline — typed messages flowing through ordered, independent processors. Each one has a single responsibility and a uniform interface, so stages can be added, reordered or tested in isolation. And the ordering is itself a design decision: the recorder sits after the transport output specifically so it records what was sent rather than what was generated."

## Factory

### 02 · Abstract Factory / provider abstraction

**Definition**

Object creation is centralised behind one call that takes configuration and returns a concrete implementation. Callers depend on the *interface*, never on a specific class.

**Why it exists**

Eleven LLM vendors, eleven TTS vendors, six ASR vendors. Business requirements demand switching between them per client, per language, without a deploy.

**In your code**

```python
tts_processor = ServiceFactory.create_from_config(tts_config, ProviderType.TTS)
llm           = ServiceFactory.create_from_config(llm_config, ProviderType.LLM)
```
`services/factory.py` — one `_create_*_service()` per vendor

**Search `create_pipeline()` for the word "Cartesia" or "Deepgram" and you will not find it.** The pipeline knows there is a TTS service; it does not know which.

**Without it**

Vendor names hard-coded through the pipeline. Switching TTS becomes a code change, a review, a deploy and a rollback plan — instead of a database row. The Gemini → Qwen migration would have been a rewrite rather than a config change.

**How to say it**

"Services are built by a factory from database config, so no vendor name appears anywhere in the pipeline code. That's what made switching the LLM layer a per-assistant config change rather than a deploy — I could roll it out to one low-risk customer, watch the vendor-labelled metrics, and expand."

## Strategy

### 03 · Strategy

**Definition**

An algorithm is encapsulated behind an interface so it can be swapped at runtime without changing the code that uses it.

**Why it exists**

Some decisions have several valid algorithms and the right one depends on configuration. Endpointing can be silence-based or model-based. STT muting depends on whether barge-in is on. Failover can be manual or latency-driven.

**In your code**

```python
def build_user_turn_stop_strategy(*, smart_turn_enabled, endpointing_config, gender_processor):
    if not smart_turn_enabled:
        return ModUserTurnStopStrategy(
            aggregation_timeout=endpointing_config.user_aggregation_timeout,
            gender_processor=gender_processor,
        )
    return ModTurnAnalyzerUserTurnStopStrategy(
        turn_analyzer=LocalSmartTurnAnalyzerV3(params=SmartTurnParams(...)),
    )
```
`pipeline/endpointing.py`

Also: `STTMuteStrategy` as an enum plus a callback, and `LatencyBasedSwitcherStrategy` extending `ServiceSwitcherStrategyManual`.

**Without it**

Conditionals scattered through the turn-handling code — `if smart_turn_enabled` in five places, drifting out of sync. Adding a third endpointing approach would mean touching all five.

**How to say it**

"Turn detection is a strategy chosen at pipeline build time. Silence-based and smart-turn are two implementations of the same interface, so the pipeline never branches on which one is active — and adding a third is a new class, not an edit to the caller."

## Adapter by subclass

### 04 · Adapter / extension by subclassing

**Definition**

Rather than forking a third-party library or wrapping it entirely, subclass its components and override only the specific methods whose behaviour you need to change.

**Why it exists**

Pipecat gets you 80% of the way. The remaining 20% is product-specific — barge-in accounting, TTS caching, vendor quirks — and you must be able to upgrade pipecat without re-applying a patch set.

**In your code**

```python
class ModCartesiaTTSService(CartesiaTTSService): ...
class ModLiveKitOutputTransport(LiveKitOutputTransport): ...
class ModUserIdleProcessor(UserIdleProcessor): ...
class ModSileroVADAnalyzer(SileroVADAnalyzer): ...
```

The **`Mod` prefix is a convention**: it means "pipecat's class, with our changes". `ModSileroVADAnalyzer` adds exactly one method, `set_params()`, and that one method is what makes dynamic endpointing possible.

**Without it**

Either a forked pipecat — and every upstream release becomes a merge conflict — or full reimplementation, which is thousands of lines you now own. The 0.0.104 → 1.4.0 upgrade was survivable *because* the surface area of your changes was small and named.

**How to say it**

"We extend pipecat by subclassing rather than forking. Every customised class carries a `Mod` prefix and overrides the minimum necessary, usually with a comment naming the vendor behaviour it works around. That kept the 1.4.0 upgrade tractable — I could enumerate exactly what we'd changed."

## Gate

### 05 · Gate / conditional filter

**Definition**

A stage that passes frames through only when a condition holds, and silently drops them otherwise. Routing by dropping rather than by branching.

**Why it exists**

Multiple ASR and TTS vendors run simultaneously for different languages. Something has to decide whose output counts — and it has to be instant, because a language switch mid-call cannot pay for a reconnection.

**In your code**

```python
async def process_frame(self, frame, direction):
    if isinstance(frame, MetricsFrame):
        return                          # never pollute metrics from an idle branch
    ...
    current_language = self.config_manager.get_current_language()
    if current_language in self.languages:
        await self.push_frame(frame, direction)
    # else: dropped
```
`processors/gates.py · LanguageBasedASRGate`

Note the two exceptions: `MetricsFrame` is dropped outright so idle branches don't report, and `SystemFrame`s pass unconditionally — blocking one could deadlock the branch.

**Without it**

Either reconnect ASR on every language switch — a handshake plus decoder warm-up mid-conversation, exactly when the caller is least tolerant — or merge three languages' transcripts and let something downstream guess.

**How to say it**

"Language routing is done with gates rather than reconnection. Every vendor branch runs continuously and a gate decides whose transcript passes, so switching language takes effect on the next utterance with zero connection latency. The trade is that you pay every vendor for the whole call — which is why there's capacity tracking to bound it."

## Fan-out

### 06 · Fan-out / parallel branches

**Definition**

The same input is delivered to several independent sub-pipelines that run concurrently.

**Why it exists**

Two reasons here. Multiple vendors for the same job (language routing), and a genuinely separate concern that needs the same input — voicemail detection needs the caller's audio but must never influence the conversation.

**In your code**

```python
asr_pipeline = ParallelPipeline(*asr_parallel_pipeline)
tts_pipeline = ParallelPipeline(*tts_parallel_pipeline)

sub_pipelines = ParallelPipeline(main_conversation_pipeline, vm_detection_pipeline)
```
`pipeline/pipecat_bots.py`

The VM detection branch ends in a `FrameSinkProcessor` — an explicit dead end so its LLM output can never reach TTS.

**Without it**

Voicemail detection would have to share the conversation's LLM context, and its analysis would leak into what the bot says. The sink is the isolation boundary, and it's a deliberate one.

**How to say it**

"Voicemail detection runs as a parallel branch with its own never-muted ASR and its own LLM, terminated by a sink processor so its output physically cannot reach the caller. Isolating it structurally was cheaper and safer than trying to filter its output later."

## State machine

### 07 · Explicit state machine

**Definition**

Legal states are enumerated and transitions between them are explicit, rather than being implied by a scatter of booleans.

**Why it exists**

Several things here have real lifecycles with illegal states — a call, a streaming tag parser, a transcription session. Booleans allow combinations that should be impossible.

**In your code**

```python
class CallState(Enum):        # types/livekit.py
class _ParserState(Enum):     # processors/tags.py — streaming tag/Jinja parser
class TranscriptionState(Enum)# services/deepgram.py
```

And used as a guard:

```python
async def _send_initial_greeting(self):
    if self.session_context.state != CallState.STARTING:
        logger.debug("Greeting already sent, skipping")
        return
    self.session_context.state = CallState.ACTIVE
```
`handlers/livekit_session.py`

**Without it**

Two events race and the greeting is sent twice. With `is_started` and `is_active` as separate booleans, "started but not active" and "active but not started" both exist and neither is meaningful.

**How to say it**

"Call lifecycle is an explicit enum rather than a set of flags, which makes illegal states unrepresentable and gives every guard one thing to check. The greeting is idempotent because it's gated on a state transition, not on a boolean someone might forget to set."

## Observer

### 08 · Observer

**Definition**

A component that is notified of events without participating in the flow that produces them. It can see everything and change nothing.

**Why it exists**

Metrics need visibility into every stage. Putting a metrics processor *in* the pipeline would mean it could add latency, drop a frame, or throw — a measurement tool taking the system down is unacceptable.

**In your code**

```python
class MetricsObserver(BaseObserver):
    async def on_push_frame(self, data: FramePushed):
        ...
```
`observers/metrics_observer.py`

It sees every frame push in the pipeline while sitting outside the chain. Same for `DebugObserver`.

**Without it**

Either metrics code threaded through every processor — repeated, drifting, impossible to remove — or a metrics processor in the chain that can break the call.

**How to say it**

"Metrics are collected by an observer rather than a pipeline stage, so instrumentation can't add latency or drop frames. That separation matters on a real-time path — I want measurement to be structurally incapable of causing an incident."

## Fail-open

### 09 · Graceful degradation / fail-open

**Definition**

When a non-essential dependency fails, continue with reduced capability rather than failing the whole operation.

**Why it exists**

A caller is on the line. There is no retry, no error page, no "please refresh". Any component that can fail must have a defined degraded mode, or it becomes a way to drop calls.

**In your code — the same decision, made five times**

```
Redis down          → RedisClient logs a warning, is_connected() False,
                       every operation returns False
capacity, no Redis  → _resolve_without_redis() picks unlimited providers
TTS cache error     → returns None, i.e. a miss; the call synthesises normally
prompt cache fails  → logs, returns None, sends an uncached request
malformed prompt    → split returns None, sends uncached
compliance crashes  → status "error", post-call processing continues
```

And in the cache, every exception path is a miss:

```python
except Exception as e:
    logger.warning(f"TTS cache get failed: {e}", key=key)
    return None
```
`utils/tts_cache.py`

**Without it**

A Redis blip drops every live call. A stale S3 object breaks one assistant permanently. A prompt typo takes a customer offline. Each of those is a small failure amplified into an outage by an unhandled exception.

**How to say it**

"Every optional dependency fails open. Redis unavailable degrades capacity resolution to unlimited providers rather than blocking; a cache error is treated as a miss; a malformed prompt sends an uncached request. The rule is that nothing which merely makes the call *cheaper or faster* is allowed to make it *fail*."

## Circuit breaking

### 10 · Circuit breaker / automatic failover

**Definition**

Detect that a dependency is unhealthy and stop sending traffic to it, routing elsewhere instead of continuing to fail.

**Why it exists**

Vendors degrade. When your LLM's TTFB doubles, every subsequent turn on every call is slow — and you cannot wait for a human to notice.

**In your code**

```python
if ttfb_value > self._latency_threshold_secs:
    self._strike_counts[service] += 1

if self._strike_counts[service] >= self._max_strikes and service is self._active_service:
    return await self._try_switch_away_from(service)
```
`pipeline/latency_switcher.py` — defaults: threshold 1.5 s, max_strikes 2

Two refinements worth knowing:

- **`allow_switch_back=False` by default** — one switch per session, to prevent flapping between two equally degraded vendors.
- **Errors are treated differently from latency.** `switch_due_to_error()` takes the next candidate unconditionally, because "a broken service is strictly worse than a latency-degraded one for the user".

**Without it**

A slow vendor degrades every call until someone pages. And a naive implementation that switches on every slow turn would oscillate under general load, losing a warm connection each time.

**How to say it**

"There's automatic failover on TTFB — consecutive slow turns trip a switch to the next healthy provider, mid-call. Two things I'd highlight: it's capped at one switch per session by default, because flapping between two degraded vendors is worse than staying put; and errors bypass the strike count entirely, since a broken service is unambiguously worse than a slow one."

## Bounded fallback

### 11 · Guaranteed floor

**Definition**

A fallback chain that is guaranteed to terminate in something that always succeeds — so the chain can never run out of options.

**Why it exists**

Capacity limits protect cost and vendor relationships. But a limit that can be exhausted becomes a way to drop calls, which is a far worse outcome than an overspend.

**In your code**

> "Every language is expected to have at least one **unlimited provider** (a config with no `concurrency_threshold`), so a language whose limited providers are all full simply falls through to that unlimited provider. This is the safety net — no explicit 'force' pass is needed, and **a live call is never dropped**."

`utils/capacity.py` — module docstring

Note the elegance: the floor isn't special-cased code, it's a property of the configuration. A provider without a threshold is admitted without touching Redis at all.

**Without it**

A traffic spike exhausts every capped provider and calls start failing at exactly the busiest moment — the worst possible time for a limit to bite.

**How to say it**

"Capacity caps are bounded by design — every language must have an unlimited provider configured as a floor, so hitting a limit degrades your vendor choice rather than dropping the call. It's expressed as a configuration invariant rather than a code path, which means there's no 'force admit' branch that could be wrong."

## Timeouts

### 12 · Timeouts and deadlines

**Definition**

Every wait has a bound. Nothing blocks forever.

**Why it exists**

You cannot distinguish "slow" from "dead" over a network. An unbounded wait means a hung dependency holds a resource — a worker, a pod slot, a phone line — indefinitely.

**In your code**

| Timeout | Where | Bounds |
|---|---|---|
| `max_call_timeout_config` | `_enforce_max_call_timeout()` | Total call duration |
| `BRIDGE_TRANSFER_AGENT_TIMEOUT` = 60 s | `livekit_session.py` | Waiting for a human to join |
| `BRIDGE_TRANSFER_SWAP_TIMEOUT` = 5 s | `livekit_session.py` | The participant swap |
| 10 s | `_wait_for_audio_playout()` | Draining the audio queue |
| `DB_POOL_TIMEOUT` = 30 s | `session/database.py` | Waiting for a connection |
| `task_time_limit` = 8 h | Celery | A hung background task |
| `digit_timeout` | DTMF processor | Waiting for the next keypress |
| `visibility_timeout` = 60 s | Celery broker | Unacked task redelivery |

And they fail loudly, not silently:

```python
except asyncio.TimeoutError:
    logger.warning("Audio playout wait timed out after 10s, proceeding with hangup")
```

**Without it**

A vendor that accepts a connection and never replies holds a call open forever. A transfer to an agent who never answers strands the caller in silence. A hung Celery task occupies a worker permanently.

**How to say it**

"Every wait in the system has an explicit bound, including ones that look like they can't hang — draining the audio queue before hangup has a ten-second timeout with a warning log. The reasoning is that you can never distinguish slow from dead over a network, so an unbounded wait is a resource leak waiting for a bad day."

## Idempotency

### 13 · Idempotency via markers

**Definition**

An operation can be performed twice with the same result as performing it once. Achieved here by recording completion and checking before acting.

**Why it exists**

SQS is at-least-once. Duplicates are guaranteed, not hypothetical. Without idempotency, a redelivered message re-sends webhooks, re-uploads reports and re-charges integrations.

**In your code**

```python
"post_call_execution": {
    "runtime_facts_committed_at": "2026-04-20T11:50:00+00:00",
    "call_summary_completed_at":  "2026-04-20T11:50:02+00:00",
    "metadata_committed_at":      "2026-04-20T11:50:05+00:00",
    "post_call_apis": {
        "638": "2026-04-20T11:50:07+00:00"    ← per integration
    },
    "completed_at":               "2026-04-20T11:50:10+00:00"
}
```
`background/post_call/markers.py`

Four design choices inside that:

- **Per step, not per message** — a crash after step 3 skips 1–3 and runs 4. Partial progress survives.
- **Per integration** — fire three webhooks, second fails, only the second retries.
- **Stored with the data**, in the same Postgres row, so markers are transactional with the interaction.
- **Timestamps, not booleans** — the marker set doubles as a per-step latency trace.

**Without it**

A worker crash after sending a webhook means the customer receives it twice on redelivery. For a payment integration that is not a bug report, it's an incident.

**How to say it**

"Post-call processing is idempotent per step. Each step writes a timestamp marker into the interaction's metadata and short-circuits on retry if its own marker is present. Markers are per-integration too, so if you fire three webhooks and the second fails, only the second is retried. And they're in the same database row as the interaction, so they're transactional with it rather than in a store that could drift."

## Retry by redelivery

### 14 · Delegated retry

**Definition**

Instead of writing retry logic, use the infrastructure's own redelivery: decline to acknowledge, and let the queue bring the work back.

**Why it exists**

There's a genuine cross-service race — the voice runtime publishes to SQS before it finishes committing the call's facts to Postgres. The post-call worker may arrive first.

**In your code**

> "Require the `runtime_facts_committed_at` marker on the interaction. Its absence means the voice runtime published before it finished writing runtime-known facts — the runner has no durable call facts to process. **Leave the message in-flight so SQS redelivers after the visibility timeout**; the voice-side commit usually races its way to persistence within seconds."

`background/post_call/worker.py` — module docstring

And the distinction it draws elsewhere:

```
malformed JSON      → log + DELETE      (retrying can't help)
interaction missing → log + DELETE      (won't appear later)
facts not committed → LEAVE IN FLIGHT   (will resolve)
processing failed   → LEAVE IN FLIGHT   (may resolve)
```

**Without it**

An in-process retry loop with sleeps and backoff — code you own, that holds a worker while it waits, and that dies with the process. The queue already does this correctly and durably.

**How to say it**

"There's a race where the voice runtime publishes the post-call event before its database write lands. Rather than writing retry logic, the worker just declines to delete the message — SQS redelivers after the visibility timeout, by which point the write has committed. Zero retry code, and it survives the worker crashing. The important part is distinguishing that from failures that will never resolve, like malformed JSON, which get deleted immediately."

## Reconciler

### 15 · Reconciliation sweep

**Definition**

A periodic job that compares desired state against actual state and fixes the difference — rather than trying to make the primary path perfect.

**Why it exists**

Messages get lost. Workers die between steps. Publishes fail. You can spend enormous effort making delivery near-perfect, or accept imperfection and build a sweeper.

**In your code**

```
app/background/post_call/reconciler.py
  hourly Kubernetes CronJob, concurrencyPolicy: Forbid
```

The `completed_at` marker is what makes it possible — it's the single signal for "this pipeline finished". Anything without it, past a threshold, gets republished.

**Without it**

A call whose SQS message was lost is silently never processed. No summary, no compliance audit, no webhook — and *nothing errors*. Silent data loss is the worst failure mode because you find out from a customer.

**How to say it**

"Rather than trying to guarantee delivery, we accept that some messages will be lost and run an hourly reconciler that finds interactions without a `completed_at` marker and republishes them. It's a much cheaper and more robust answer than chasing exactly-once, and it turns silent data loss into a bounded delay."

## Cleanup ordering

### 16 · Ordered teardown by blast radius

**Definition**

Cleanup steps are ordered so the ones with the largest consequence-if-skipped run first, before anything that could block or raise.

**Why it exists**

Cleanup runs during shutdown, when things are already going wrong. If step 2 raises, steps 3 onward never run — so *which step is first* is a real decision.

**In your code**

> "Provider capacity release (ASR + TTS) runs **FIRST and unconditionally** — it must run before anything that can block or raise, because the LiveKit …"

`pipeline/pipecat_bots.py · cleanup()`

The reasoning: a leaked capacity counter has **unbounded future cost** — it turns away later calls forever. A failed recording upload costs one recording. Order by blast radius.

The recorder's cleanup has its own ordering, for a different reason:

```
1. stop_recording()
2. await super().cleanup()   ← flush pending handlers; stop_recording only schedules
3. wav_file.close()          ← closing before the flush would truncate the tail
4. upload to S3
5. delete locally, only if upload_success
```

**Without it**

An exception during recording upload leaks a capacity slot permanently, and the effective cap shrinks with every such failure until the provider is unusable.

**How to say it**

"Cleanup is ordered by blast radius. Capacity release runs first and unconditionally, because a leaked counter turns away future calls forever, whereas a failed recording upload costs one recording. Anything that can raise goes after the things that must not be skipped."

## Statelessness

### 17 · Stateless workers, shared state externalised

**Definition**

Instances hold no state that another instance would need. Anything shared lives in an external store.

**Why it exists**

It's the precondition for horizontal scaling. If any pod can serve any call, capacity is a number you change.

**In your code**

```
per call (in the pod, dies with it):
    transport, vendor connections, LLMContext, recorder, metrics observer

shared (in Redis, survives the pod):
    provider capacity counters
    TTS cache index
    Vertex prompt cache handle
    channel listener registry
    Celery task queues
```

Nothing in a pod is needed by another pod. Pods are interchangeable, and the 64-replica deployment is a `Deployment` rather than a `StatefulSet` for exactly that reason.

**Without it**

Sticky routing — a caller must reach the specific pod holding their state. Now deploys drop calls, load balancing is hard, and scaling requires rebalancing.

**How to say it**

"Pods are stateless with respect to each other. Everything a call needs lives inside the call; everything shared — capacity counters, cache handles — is in Redis. That's what lets it be a Deployment with interchangeable replicas rather than a StatefulSet with sticky routing, and it's why scaling is just a replica count."

## Admission control

### 18 · Admission control / distributed rate limiting

**Definition**

Before consuming a limited resource, check whether you're allowed to and reserve it. Enforced across all instances, not per instance.

**Why it exists**

Vendor connections are metered and billed. 64 pods share one quota and no pod can see the others.

**In your code**

```
reliability:{service}:{assistant_uuid}:{PROVIDER}      per-assistant cap
reliability:{service}:global_counter:{PROVIDER}        global count
reliability:{service}:global_limit:{PROVIDER}          global cap
```
`utils/capacity.py`

**Two layers, deliberately.** The per-assistant cap stops one tenant consuming the company's whole quota. The global cap stops the fleet as a whole exceeding what the vendor sold you. Either alone is insufficient.

**Without it**

A traffic spike opens more connections than the vendor permits, and the vendor starts rejecting — so instead of some calls using a fallback provider, all calls start failing.

**How to say it**

"Vendor concurrency is admission-controlled through Redis, with two layers — per-assistant so one tenant can't consume the shared quota, and global so the fleet can't exceed what we've bought. It's a distributed rate limiter, and the counters have to be shared because no pod can see the others."

## Atomic compare-and-set

### 19 · Atomic read-modify-write

**Definition**

A read, a check and a write executed as one indivisible operation, so no other actor can interleave between them.

**Why it exists**

Admission control is inherently read-check-increment. Across 64 pods that's a race, and it fires precisely during a spike — when the cap matters most.

**In your code**

> "Admission runs a single **Lua script** so the 'read counter → check under limit → increment' sequence is atomic across all pods sharing one Redis. Without this, concurrent admissions could each read an under-limit count and all increment, **breaching the cap by up to the number of racing pods**."

`utils/capacity.py` — module docstring

The mechanism: Redis executes commands single-threaded, and a Lua script runs as one command. And a second-order design note from the same docstring — ASR and TTS share *one copy* of the script, because "two copies drifting is exactly the cross-pod cap breach the script exists to prevent."

**Without it**

```
limit = 10, counter = 9
pod A reads 9 → under ✓
pod B reads 9 → under ✓      (A hasn't written yet)
pod C reads 9 → under ✓
all increment → 12. Cap breached by the number of racers.
```

**How to say it**

"Concurrency admission is a Lua script rather than a get-then-set, because read-check-increment across 64 pods is a race that breaches the cap by however many pods are racing. Redis runs a script as a single indivisible command, so the race is structurally impossible rather than unlikely. And ASR and TTS deliberately share one copy of that script — two copies drifting would reintroduce the exact bug it prevents."

## Bulkhead

### 20 · Bulkhead / resource isolation

**Definition**

Partition resources so a failure or overload in one workload cannot exhaust the resources another depends on. Named after ship compartments.

**Why it exists**

Workloads here have wildly different shapes. A datasync job runs for hours; a conversation turn must complete in milliseconds. Sharing a pool means the slow one starves the fast one.

**In your code — three bulkheads**

```
1 · Celery queues
    task_routes = {
        "datasync.*": {"queue": "datasync"},
        "*":          {"queue": "orchestrator-queue"},
    }
    → a datasync backlog cannot starve conversation-adjacent tasks

2 · Dedicated Kubernetes nodes
    taint: orchestrator-service-voice-livekit=true:NoSchedule
    → nothing else can land beside a voice pod and spike CPU mid-call

3 · Separate deployments
    voice runtime / interface API / text runtime / workers
    → a traffic spike on one cannot consume another's capacity
```

Plus `worker_prefetch_multiplier = 1` — one worker doesn't hoard four long tasks while another sits idle.

**Without it**

An hours-long datasync job occupies every Celery worker and short tasks queue behind it. A batch job scheduled onto a voice node causes audible stutter on live calls.

**How to say it**

"Workloads with different shapes get separate resource pools. Long datasync jobs have their own Celery queue so a backlog can't starve short conversation tasks; voice pods run on tainted nodes so nothing else can steal CPU mid-call. It's the bulkhead pattern — and it's the same head-of-line blocking problem in both cases."

## Async offload

### 21 · Async offload / queue decoupling

**Definition**

Work that doesn't need to complete before responding is pushed onto a queue and handled by a separate consumer.

**Why it exists**

Post-call work — summarisation, compliance, webhooks, SFTP reports — takes seconds to minutes. None of it can sit on the call's critical path.

**In your code**

```
call ends
  → recording uploaded
  → publish {"interaction_uuid": ...} to SQS
  → call teardown completes            ← the caller is already gone

separately, whenever:
  post-call worker consumes, runs summary / compliance / webhooks / reports
```

Five consumer coroutines by default (`POST_CALL_WORKER_CONCURRENCY`), long-polling at 20 seconds.

**Without it**

Call teardown blocks on a summarisation LLM call. The pod is held, the caller may still be connected, and a slow webhook endpoint becomes *your* latency problem.

**How to say it**

"Anything that doesn't need to happen while the caller is on the line goes on a queue — summaries, compliance audits, customer webhooks. It decouples the runtime from slow downstream systems entirely: the post-call consumer can be down for ten minutes and not a single call fails, because SQS buffers and the reconciler catches anything lost."

## Connection reuse

### 22 · Pooling and persistent connections

**Definition**

Expensive connections are established once and reused, rather than created per operation.

**Why it exists**

TCP plus TLS is one to two round trips. Paying that per sentence, or per query, dwarfs the actual work.

**In your code — four places**

| Where | Reused | Saves |
|---|---|---|
| Database | `DB_POOL_SIZE=10`, overflow 30, recycle 1800 s | Handshake + a server-side process per query |
| Baseten TTS | One WebSocket for the whole call | **~850 ms per request**, per its docstring |
| Aggregatable TTS | One connection serving many languages | A socket per language |
| Singletons | `RedisClient`, `S3Service`, `SQSService`, `KinesisService` | Client construction per call site |

`DB_POOL_RECYCLE = 1800` is the subtle one: middleboxes silently drop long-idle connections and you only find out when you use one. Recycling proactively avoids the confusing "server closed the connection unexpectedly".

**Without it**

The Baseten docstring quantifies it — 850 ms of connection overhead per TTS request. On a phone call that alone would make the self-hosted model unusable regardless of audio quality.

**How to say it**

"Connections are established once per call, not per request. On the self-hosted TTS that was worth about 850 milliseconds per request — a naive connect-send-close client would have made the whole thing unusable no matter how good the model was. The cost is that you now own reconnection, in-flight request tracking, and clean cancellation on barge-in."

## Cache-aside

### 23 · Cache-aside (lazy loading)

**Definition**

Check the cache; on a miss, compute the value and write it back. The application owns the cache logic, not the data store.

**Why it exists**

A voice bot repeats itself constantly — greetings, disclosures, confirmations, hold phrases, thousands of times a day, byte-identical.

**In your code**

```python
if self._enable_caching and self._tts_cache:
    cache_key = self._make_cache_key(text)
    cached_data = await self._tts_cache.get(cache_key)
    if cached_data:
        self._is_cache_hit = True
        async for frame in self._replay_cached_audio(...):
            yield frame
        return                      # no vendor request at all
```
`services/smallestai.py`

Two refinements worth naming:

- **Only complete audio is stored** — the put fires from the rid-matched complete, so a sentence cut short by barge-in can never be cached.
- **The put is a background task fired during the playback wait**, so writing to S3 costs zero added latency.

The same pattern appears for the Vertex prompt cache, with three levels: in-process memo → Redis → create.

**Without it**

You pay a vendor to synthesise the same greeting on every call, and pay its full TTFB every time. This is the highest-leverage cache in the system precisely because the repetition is so extreme.

**How to say it**

"TTS is cache-aside — check first, synthesise on a miss, store the result. It works because a bot says the same fixed phrases thousands of times a day. Two details I'd call out: only fully-received audio is stored, so a barge-in can never cache a truncated greeting; and the write is fired as a background task during the playback wait, so caching costs nothing at write time."

## Index and blob

### 24 · Two-tier storage — metadata fast, payload cheap

**Definition**

Keep small lookup metadata in a fast expensive store and the bulk payload in a slow cheap one.

**Why it exists**

Redis is memory — fast and expensive per gigabyte. Audio blobs are tens of kilobytes each, across thousands of phrases, many assistants and many clients. Putting them in Redis would consume gigabytes of RAM and evict constantly.

**In your code**

> "Redis stores S3 object locations (key → S3 path) with TTL. S3 stores the actual audio blobs."

`utils/tts_cache.py`

```
Redis   key → "s3://bucket/prefix/{client}/{assistant}/{sha256}"   tiny, µs lookup
S3      the actual audio bytes                                     unlimited, cheap
```

**Redis memory scales with the *number* of cached phrases, not their size.** That's the whole win.

**Without it**

Audio in Redis: gigabytes of RAM and constant eviction, so the hit rate collapses. Audio in S3 with no index: you'd have to attempt a fetch to know whether an entry exists, paying tens of milliseconds on every miss.

**How to say it**

"The TTS cache is two-tier — Redis holds a tiny string per entry, an S3 URL, and S3 holds the bytes. You get Redis's microsecond 'does this exist' and S3's unlimited cheap capacity, and Redis memory stays proportional to the number of entries rather than their size. It's a general pattern: metadata in the fast store, payload in the cheap one."

## Content-addressed keys

### 25 · Hash-based cache keys

**Definition**

The key is a hash of everything the cached value depends on. Identical inputs produce an identical key; any change produces a different one.

**Why it exists**

You need a compact key, and you need it to change whenever the output would change. Automatic invalidation without an invalidation mechanism.

**In your code**

```python
canonical = "|".join(f"{k}={v}" for k, v in sorted(kwargs.items()))
digest    = hashlib.sha256(canonical.encode()).hexdigest()
return f"{client_uuid}/{assistant_uuid}/{digest}"
```
`utils/tts_cache.py · make_key()`

Hashed in: text, voice, model, language, sample rate, speed, and number-pronunciation language when set. `sorted()` makes the canonical form order-independent — omit it and identical settings in a different order produce different keys, silently halving your hit rate.

The Vertex cache key does the same over static prompt text, tools, model, project and location.

**Without it — the failure is not a miss, it's a wrong hit**

Omit `sample_rate` and 8 kHz audio gets replayed into a 16 kHz pipeline: chipmunk voices. Omit `voice` and switching to a male voice still plays the female recording. **Nothing errors.**

**How to say it**

"Cache keys are a SHA-256 over a canonical, sorted representation of every input that can change the output — text, voice, model, language, sample rate, speed. The rule is that missing an input doesn't give you a cache miss, it gives you a *wrong hit*, which is far worse because nothing errors. There's a nice example in ours: a newer key is added conditionally, only when set, so existing entries stay valid on deploy rather than cold-starting the whole cache."

## Lazy init and warmup

### 26 · Deferred and eager initialisation — used deliberately, in opposite directions

**Definition**

**Lazy**: create something the first time it's needed. **Warmup**: create it before it's needed, so the first real use doesn't pay.

**Why it exists**

Both, in different places, and the choice depends on whether the cost lands on a user-visible path.

**In your code — lazy**

```python
if self.wav_file is None:            # opened on first audio, not at construction
    self.wav_file = wave.open(...)   # a silent call leaves no empty file

# Lazy import: instantiation loads the bundled ONNX model.
from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3
```

The prompt cache is created on first use too, not eagerly for every assistant.

**In your code — warmup**

```python
def prewarm():   # livekit_agent_server.py
    """Prewarm process with heavy imports."""

class ConnectionManager:
    async def initialize(self):
        await asyncio.gather(self.initialize_tts())   # connect before the call needs it
```

Plus `livekit_preload.py`, a forkserver preload so each worker inherits heavy imports rather than repeating them.

**Without it**

Without lazy: every process loads the smart-turn ONNX model whether or not it's enabled. Without warmup: the first utterance of every call pays a TTS handshake — a user-visible cost.

**How to say it**

"Both, chosen by where the cost lands. Heavy optional things are lazy — the smart-turn model is a lazy import so processes that don't use it never load it. Things on the critical path are warmed — vendor connections are established at call setup, and the LiveKit worker prewarms heavy imports before jobs arrive, so nobody's first turn pays for them."

## Streaming

### 27 · Incremental processing / pipeline parallelism

**Definition**

Downstream stages begin on partial output from upstream stages, so work overlaps instead of queueing.

**Why it exists**

The dominant constraint is sub-1.5-second response. If each stage waited for the previous to finish, you'd sum every latency and the pause would be unbearable.

**In your code — at every stage**

```
ASR    emits interim transcripts before the utterance ends
LLM    streams tokens
TTS    starts at the FIRST COMPLETE SENTENCE, not the first token
       — a sentence is the smallest unit with correct prosody
audio  streams out while later sentences are still being generated
```

The filler-word processor documents the boundary case: it uses `TTSSpeakFrame` to *bypass* the sentence aggregator, because a lone filler with no following text would otherwise sit in the buffer waiting for lookahead that never arrives.

**Without it**

```
sequential:  ASR 1.2s → LLM 2.0s → TTS 1.5s  =  4.7s before any sound
streamed:    first audio at ~0.4s, everything else overlapping
```

**How to say it**

"Every stage streams, so they overlap rather than queue. The specific choice I'd highlight is that TTS starts at the first complete *sentence*, not the first token — TTS needs a coherent phrase to get prosody right, and a sentence is the smallest unit where that holds. It's the difference between audio at 400 milliseconds and audio at four seconds."

## Single writer

### 28 · Single-writer / single commit path

**Definition**

Route all mutations of a thing through exactly one place, so there is one location to reason about, guard and test.

**Why it exists**

Concurrency bugs come from multiple writers. The cheapest fix is often not locking — it's ensuring there's only one writer.

**In your code — two instances**

**1 · The reconciler.** A Kubernetes CronJob with `concurrencyPolicy: Forbid` — single-pod by design. No distributed locking needed, because two instances can never run.

**2 · The turn commit path.** The stop strategy uses a polling loop rather than committing on a frame, and pays for it:

> "Wake the timer rather than committing here: `_loop` is the **sole commit path** so first-turn gender identification has exactly one place to gate. Costs at most one `aggregation_timeout` poll (10 ms by default) versus the old commit-on-frame shortcut."

`pipeline/endpointing.py`

**Without it**

The comment explains the alternative: the gender processor's stop frames arrive ~150 ms after the commit, and `UserStoppedSpeakingFrame` is emitted *by* the commit — so frame ordering can't be relied on. With multiple commit sites you'd need the gate in all of them, and they'd drift.

**How to say it**

"Where I need a guarantee, I route everything through one writer. The turn controller uses a polling loop instead of committing on a frame, which costs about ten milliseconds, because it makes `_loop` the sole commit path — so first-turn gating has exactly one place to hook rather than four. And the reconciler is a CronJob with `concurrencyPolicy: Forbid`, which gives single-writer semantics without any distributed locking."

## Write ordering

### 29 · Safe ordering of dependent writes

**Definition**

When two writes must both happen and a crash can land between them, order them so the intermediate state is harmless.

**Why it exists**

You cannot make two writes to different systems atomic. So you choose which inconsistency you're willing to have.

**In your code**

```python
def _put_sync(self, key, s3_key, s3_url, value, ttl):
    self._s3.put_object(bucket=self._bucket, key=s3_key, body=value)   # DATA first
    self.redis_client.set(key, s3_url.encode(), ex=ttl)                # INDEX second
```
`utils/tts_cache.py`

| Crash between them | Result |
|---|---|
| Data written, index not | Orphaned S3 object. Wastes a little storage. Harmless. |
| Index written, data not | Every reader hits `NoSuchKey`. Broken entry. |

**Write the data before you advertise it.** And there's a second defence anyway — on `NoSuchKey` the reader deletes the stale index entry, so the cache self-heals.

The same reasoning appears cross-service: the recording is uploaded *before* the post-call event is published, so the worker never reads an interaction whose audio URL isn't committed.

**Without it**

An index pointing at nothing. Every request for that phrase fails the fetch — and without the self-heal, permanently.

**How to say it**

"Where two writes can't be atomic, I order them so the intermediate state is the harmless one. The cache writes the S3 object before the Redis index, because an orphaned object wastes a little storage while a dangling index breaks every read. Same reasoning across services — the recording is uploaded before the post-call event is published, so the worker never sees an interaction missing its audio URL."

## Tenant scoping

### 30 · Multi-tenant isolation by construction

**Definition**

Every piece of data carries a tenant identifier, and isolation is enforced at every access — ideally in a way that's visible rather than implicit.

**Why it exists**

One deployment serves many clients. A leak between them is a serious incident, not a bug.

**In your code — four layers**

```
database     client_id on every model; every query filters on it
secrets      orchestrator/{client_uuid}/{service_type}/{service_name}
cache        {client_uuid}/{assistant_uuid}/{sha256}      ← visible prefix
capacity     reliability:{service}:{assistant_uuid}:{PROVIDER}
```

The cache key prefix is a deliberate choice: client and assistant UUIDs could have been folded into the hash. Keeping them as a visible path prefix buys **bulk invalidation** — change an assistant's voice and you can delete `{client}/{assistant}/*` in one operation — and makes isolation legible rather than trusted to a hash.

**Without it**

One customer's cached audio plays on another's call. One tenant's spike consumes the shared vendor quota. One forgotten `WHERE` clause exposes another client's transcripts.

**How to say it**

"Tenant isolation runs through every layer — `client_id` on every model, per-client credentials in Secrets Manager under a structured name, cache keys prefixed by client and assistant, and capacity counters keyed per assistant so one tenant can't consume the shared quota. The cache prefix is deliberately a visible path rather than hashed in, so isolation is legible and you can invalidate a whole assistant in one operation.

The honest weakness is that database isolation is enforced in the query layer, so a missing filter is a leak. That's why it's a stated codebase rule rather than a convention — and row-level security would be the stronger answer."

## Context propagation

### 31 · Ambient request context

**Definition**

Identifiers relevant to the whole operation are carried implicitly, so every log line and trace is attributable without threading parameters through every function.

**Why it exists**

Sixty-four pods, each handling many concurrent calls, all logging to the same stream. Without correlation IDs, production logs are unusable.

**In your code**

```
call_uuid_var        set in rpc_handler / livekit_session at call start
client_uuid_var      set once the assistant is resolved
worker_pid_var       set once per worker process
interaction_uuid_var set in the post-call SQS handler, reset in finally
```

These are `contextvars`, read *inside the slog formatter*. Nothing passes them explicitly, and **they survive across `await` points** — which a thread-local would not, since many coroutines share a thread.

The post-call worker resets its var in a `finally` block, so context can't leak into an unrelated message on the same worker.

**Without it**

Either a `call_uuid` parameter threaded through hundreds of functions, or logs you cannot correlate. And with plain thread-locals in an async runtime, you'd get the *wrong* call's ID attached — worse than none.

**How to say it**

"Call and client identifiers are contextvars read inside the log formatter, so every line is attributable without threading parameters anywhere. Contextvars specifically, not thread-locals — in an async runtime many coroutines share a thread, so a thread-local would attach the wrong call's ID. And the post-call worker resets its context in a finally block so it can't leak into the next message."

## What's missing

#### Naming your own gaps is a strength

"What would you improve?" is a standard question. Having specific, technically-grounded answers is far better than "more tests".

| Gap | Why it matters | What you'd add |
|---|---|---|
| **No connection pooler** | 64 pods × 40 = 2,560 connections against a `max_connections` in the hundreds. First wall at scale. | PgBouncer in transaction mode |
| **Capacity counters have no identity** | Documented: a SIGKILL leaves a stranded increment, so the effective cap shrinks over time | A Redis set of call IDs with TTL instead of a bare counter — entries expire themselves |
| **No single-flight on cache miss** | After a deploy, many pods miss the same key and all synthesise it | A short lock or request coalescing per key |
| **One Redis for everything** | Single-threaded; capacity, caching and pub/sub contend. One slow command blocks all | Separate instances by purpose |
| **Postgres is a SPOF** | No config load means no new calls | Read replicas, and a short-lived config cache so a blip doesn't stop call setup |
| **Query-layer tenant isolation** | A missing `WHERE` is a data leak | Row-level security, or a session that can't be constructed without a tenant |
| **Barge-in is untested** | The most intricate concurrency path has no automated coverage | Scripted-model tests asserting playback stopped and history truncated |
| **No load shedding** | At saturation, everything degrades equally rather than shedding low-priority work | Priority-aware admission at the session layer |

## Interview answers

**Q: What design patterns did you actually use?**

Don't recite Gang of Four. Name three and tie each to a problem.

"The three that carry the most weight:

**A factory over providers.** Services are built from database config, so no vendor name appears in the pipeline. That's what made migrating the LLM layer a per-assistant config change rather than a deploy.

**A frame pipeline** — typed messages through ordered independent processors. Order is itself a design decision there: the recorder sits after the transport output specifically so it records what was sent, not what was generated, and those differ on a barge-in.

**Admission control with atomic compare-and-set.** Vendor concurrency is capped across 64 pods via Redis, and admission is a Lua script because read-check-increment is a race that breaches the cap by however many pods are racing.

Underneath all of it is one principle applied consistently: *fail open*. Nothing that merely makes a call cheaper or faster is allowed to make it fail."

**Q: How does your system handle failure?**

"Four layers, in increasing scope.

**Degrade, don't fail.** Every optional dependency fails open — Redis down degrades capacity resolution to unlimited providers, a cache error is a miss, a malformed prompt sends an uncached request.

**Route around it.** Multiple providers per stage with automatic failover on consecutive slow turns, and an unconditional switch on error since a broken service is unambiguously worse than a slow one.

**Bound every wait.** Timeouts on transfers, playout, database checkout, background tasks. You can't distinguish slow from dead over a network, so an unbounded wait is a resource leak.

**Recover afterwards.** Post-call work is idempotent per step with timestamp markers, and an hourly reconciler finds anything whose pipeline never completed and republishes it. We accept that messages get lost rather than chasing exactly-once, which isn't achievable anyway."

**Q: Show me a design decision you'd defend.**

"Parallel ASR branches with language gates instead of reconnecting on a language switch.

It looks wasteful — you transcribe every configured language for the whole call and throw most of it away, paying every vendor.

The alternative is a reconnection mid-conversation: a handshake plus the vendor's decoder warm-up, at exactly the moment the caller has just switched language and is least tolerant of a stall. Since sub-1.5-second response is the dominant constraint, that's the wrong trade.

So we spend money to protect latency — and then bound the money with capacity limits, which is why the admission control exists at all. I'd defend it because the cost is bounded and measurable while the latency cost would be user-visible on every switch."

**Q: What would you change?**

"Three specific things.

**A connection pooler.** 64 pods times a pool of 40 is 2,560 connections against a `max_connections` in the hundreds. That's the first wall at scale, and PgBouncer comes before read replicas or anything cleverer.

**Give capacity counters per-call identity.** It's a documented limitation — a pod killed by SIGKILL leaves a stranded increment, so the effective cap shrinks over time. A Redis set of call IDs with TTLs would self-heal, where a bare counter can't.

**Test barge-in.** It's the most intricate concurrency path in the system — clearing a buffer we don't own, cancelling in-flight work, truncating context to what was actually heard — and it has no automated coverage. Specifically I'd assert that the conversation history records only the spoken portion, because that bug is silent and corrupts every subsequent turn."

## Glossary

**Pipeline** — Ordered independent stages, each with one responsibility.

**Factory** — Centralised creation returning an interface, not a class.

**Strategy** — Swappable algorithm behind a common interface.

**Adapter** — Extending a third-party class by overriding the minimum.

**Gate** — Routing by dropping rather than branching.

**Fan-out** — Same input to several concurrent sub-pipelines.

**State machine** — Enumerated states and explicit transitions.

**Observer** — Sees events without participating in them.

**Fail-open** — Degrade rather than fail when an optional dependency breaks.

**Circuit breaker** — Stop sending traffic to an unhealthy dependency.

**Guaranteed floor** — A fallback chain that always terminates in something that succeeds.

**Idempotency** — Doing it twice equals doing it once.

**Marker** — A recorded timestamp proving a step already ran.

**Reconciler** — Periodic sweep fixing what the primary path missed.

**Blast radius** — How much breaks when one thing fails. Orders cleanup.

**Stateless** — No instance holds state another would need.

**Admission control** — Reserve before consuming a limited resource.

**Atomic CAS** — Read-check-write as one indivisible operation.

**Bulkhead** — Partitioned resources so one workload can't starve another.

**Head-of-line blocking** — Slow work occupying capacity fast work needs.

**Async offload** — Queue work that needn't finish before responding.

**Connection pool** — Reused connections. Per process — multiply by replicas.

**Cache-aside** — Check, miss, compute, store. Application-owned.

**Two-tier cache** — Metadata in the fast store, payload in the cheap one.

**Content-addressed key** — Hash of every input that affects the output.

**Wrong hit** — A cache returning a valid-looking but incorrect value. Worse than a miss.

**Warmup** — Paying setup cost before it lands on a user.

**Streaming** — Downstream starts on partial upstream output.

**Single writer** — One place mutates a thing, so one place to guard.

**Write ordering** — Sequence non-atomic writes so the intermediate state is harmless.

**Context propagation** — Ambient identifiers carried without explicit threading.

**Load shedding** — Dropping low-priority work at saturation instead of degrading everything.

---

Every pattern here is in `app/runtime/voice/`, `app/background/`, `app/session/` or `app/llm/`. Quoted comments are verbatim from the source.
Companion documents: blueprint and bill (the method) · the OSV field guide (the index) · anatomy of a call (the narrative) · beyond one process (the infrastructure).
