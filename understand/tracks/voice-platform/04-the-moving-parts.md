# The Moving Parts

**Topic:** Distributed systems
**Covers:** First pass at the distributed pieces (superseded by 13)
**Source:** [Claude artifact](https://claude.ai/artifact/VHnAKZydV5ZJaunh3QqEoB) — written by a colleague, mirrored here for study.

*Every piece of infrastructure, explained*

Postgres, Redis, Celery, SQS, Kinesis, S3 and the rest. What each one is, the problem it solves, why we chose it over the alternatives, and what breaks when it's down.

## Why more than one machine

*Foundations · 01*

The simplest possible version of this product is one Python program on one computer, holding everything in memory.

It works, right up until any of these:

| What happens | Why one machine fails |
|---|---|
| The machine restarts | Everything in memory is gone. Every call, every record. |
| You need 500 concurrent calls | One machine runs out of CPU |
| Two copies of the program | They can't see each other's memory, so they disagree |
| Post-call work takes 30 seconds | It blocks the next call |
| The machine dies | The product is down |

> **So you split it up**
>
> State that must survive restarts goes in a **database**. State that's shared between copies goes in a **cache**. Slow work goes on a **queue**. Big files go in **object storage**.
>
> Each of those is a separate machine, and now you have a **distributed system** — which solves all five problems above and introduces a new category of problem that only exists because there is a network in the middle.

## What gets hard

*Foundations · 02*

The entire difficulty of distributed systems reduces to one sentence:

> **When you ask another machine to do something and get no reply, you cannot tell what happened**
>
> Three possibilities, and they are **indistinguishable** from where you're standing:
> - Your request never arrived. Nothing happened.
> - It arrived and worked. The *reply* got lost.
> - It arrived, and it's still running, slowly.
>
> If you retry: in case 1 you fix it. In case 2 you do it **twice**. If that action was "charge the customer", you've just charged them twice.

Everything else — idempotency, delivery guarantees, timeouts, retries, the CAP theorem — is a response to that one sentence. Keep it in mind and the rest of this document is obvious rather than arbitrary.

> **The other three surprises**
>
> **Partial failure** — On one machine, things work or crash. Across many, *some parts work while others don't*. The database is fine, the cache is down. Your code must handle every combination.
>
> **The network is not free** — A function call is nanoseconds. A network call is milliseconds — a million times slower — and it can fail. Turning a function into a service is not a free refactor.
>
> **Clocks disagree** — Two machines never quite agree on the time. Ordering events by timestamp across machines is unreliable.

## Our map

*Foundations · 03*

```
                         ┌──────────────┐
   phone call ──────────►│    VOICE     │
                         │   RUNTIME    │
                         └──────┬───────┘
        ┌───────────────────────┼────────────────────────┐
        ▼                       ▼                        ▼
  ┌───────────┐          ┌────────────┐           ┌────────────┐
  │ POSTGRES  │          │   REDIS    │           │     S3     │
  │  the      │          │  fast      │           │  recordings│
  │  truth    │          │  shared    │           │  and files │
  └───────────┘          │  scratch   │           └────────────┘
                         └─────┬──────┘
                               │ also the Celery broker
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
  ┌───────────┐          ┌───────────┐          ┌───────────┐
  │  CELERY   │          │    SQS    │          │  KINESIS  │
  │ scheduled │          │ post-call │          │ analytics │
  │   work    │          │   work    │          │  events   │
  └───────────┘          └───────────┘          └───────────┘
```

| System | One-line job | If it's down |
|---|---|---|
| **Postgres** | The permanent record | Calls can't start. Total outage. |
| **Redis** | Fast shared scratch space | Degraded — slower, cache misses. Not fatal. |
| **S3** | Recordings and large files | Calls work, recordings fail to upload. |
| **Celery** | Scheduled and background jobs | Background work stops. Calls unaffected. |
| **SQS** | Post-call processing queue | Post-call work backs up, then catches up. |
| **Kinesis** | Analytics event stream | Analytics gap. Nobody on a call notices. |
| **Secrets Manager** | Vendor API keys | Cached keys keep working for an hour, then calls fail. |

> **Read that last column again**
>
> It's the most valuable thing on this page. Knowing *the blast radius of each dependency* is what lets you triage an incident in seconds instead of minutes — and it's exactly what a good interviewer probes for.

## Postgres

*Storage · 04*

> **What it is**
>
> A **relational database**. Data in tables with defined columns, related to each other by IDs, queried with SQL. Postgres is the open-source one that most teams reach for by default.

It holds everything that must be true and must survive: assistants and their versions, conversation flows, interactions (one row per call), users and permissions, phone numbers, client configuration.

> **ACID — the promise you're paying for**
>
> **Atomic** — A transaction happens completely or not at all. No half-updates.
>
> **Consistent** — Constraints always hold. You can't reference a client that doesn't exist.
>
> **Isolated** — Concurrent transactions don't see each other's half-finished work.
>
> **Durable** — Once committed, it survives a power cut.
>
> These sound obvious until you use something that doesn't offer them, and discover which of your assumptions were load-bearing.

### How we use it

Through **SQLAlchemy**, an ORM — you write Python classes, it writes SQL. And **Alembic** for migrations: versioned scripts that change the schema, so every environment's database evolves identically.

```
alembic revision --autogenerate -m "add gender column"
alembic upgrade head
```

> **Never edit a committed migration**
>
> Once a migration has run anywhere, it's history. Someone's database has already applied it. Changing it means their database and the script disagree forever. Write a new migration instead.

### Connection pooling

Opening a database connection is expensive, so a **pool** keeps some open and hands them out:

```
pool_size=DB_POOL_SIZE, max_overflow=DB_POOL_OVERFLOW
```

The trap at scale: `pool_size × pods × workers-per-pod` must stay under Postgres's connection limit. Twenty pods with a pool of twenty each is four hundred connections, and Postgres will refuse.

> **Multi-tenancy**
>
> Many client companies share one database, separated by a `client_id` column. Every query must filter on it. Forget it once and one customer sees another's data — which is a breach, not a bug. This is why the project rules state it explicitly.

> **Alternatives**
>
> | Option | Trade-off |
> |---|---|
> | **Postgres** (used) | Reliable, huge feature set, JSON support, excellent tooling. Vertical scaling has a ceiling. |
> | **MySQL** | Comparable. Postgres generally wins on JSON, extensions and correctness edge cases. |
> | **MongoDB** | Schemaless — fast to start. You end up enforcing schema in code anyway, and joins are painful. |
> | **DynamoDB** | Effectively infinite scale, predictable latency. You must know your access patterns up front; ad-hoc queries are impossible. |
> | **CockroachDB / Spanner** | Postgres-like with horizontal scale. More expensive, more operationally complex. |
>
> Postgres is right here because the data is genuinely relational, the volume is moderate, and being able to ask arbitrary questions matters.

## Redis

*Storage · 05*

> **What it is**
>
> An **in-memory data store**. Everything lives in RAM, which makes it roughly a thousand times faster than a disk-backed database — and means it can lose data if it restarts. That trade is the entire point.

The rule of thumb: **Postgres for what must be true, Redis for what must be fast.**

### Five distinct jobs in this codebase

| Job | What it looks like |
|---|---|
| **Caching** | Vendor API keys, 1-hour TTL, so every call doesn't hit Secrets Manager |
| **Shared pointers** | The LLM prompt-cache handle, so all processes reuse one cached prompt instead of each creating their own |
| **Coordination** | Who is listening to which channel, with TTLs so a dead process's claim expires |
| **Pub/sub** | Publishing events between processes — `publish_channel_event` |
| **Celery's broker** | The task queue itself lives in Redis |

> **TTL — the feature that does the most work**
>
> Every key can have an expiry. Redis deletes it automatically. That single feature gives you caching with automatic invalidation, locks that release themselves if the holder dies, and presence tracking that self-heals.
>
> Choosing the TTL is where the thinking is. Our prompt cache expires **slightly earlier than the vendor's** — 55 minutes against 60. Never the other way round, or you hand out a pointer to something that no longer exists and every request errors.

> **Two real traps we've hit**
>
> **It caches wrong answers too.** The key lookup caches whatever it resolves — including an invalid API key. Fix the key and the bad one still serves for up to an hour. You must delete it: `redis-cli DEL "service_keys:default:xai:tts"`.
>
> **The default host is the cluster's.** If `REDIS_HOST` isn't set, the app tries `redis-orch.cache.svc.cluster.local` — meaningless on a laptop. Because the code degrades rather than crashing, you get slow weirdness instead of a clear error.

> **Alternatives**
>
> - **Redis** (used) — fast, versatile, universally supported. Single-threaded per instance; memory is the limit.
> - **Memcached** — simpler and slightly faster for pure caching. No pub/sub, no data structures, no persistence.
> - **Valkey** — an open-source Redis fork created after Redis changed its licence. Drop-in.
> - **In-process cache** — a Python dict. Fastest possible, but every pod has a different one, which is wrong the moment you have two pods.
> - **DynamoDB / Postgres as cache** — durable but far slower. Only if you can't run Redis.

## S3

*Storage · 06*

> **What object storage is**
>
> Not a filesystem and not a database. You `put` a blob under a key and later `get` it. No folders (the slashes are cosmetic), no partial edits, no querying by content.
>
> In exchange: effectively unlimited, extremely cheap, and famously durable.

We keep call recordings there — WAV files, minutes long, megabytes each. Putting those in Postgres would be a serious mistake: it would bloat backups, slow every query, and cost far more per gigabyte.

> **The rule**
>
> **Big blobs in object storage; a pointer to them in the database.** The interaction row holds a URL, not the audio.

> **The upload is the risky moment**
>
> Recording upload happens during pipeline cleanup — after the call, before post-call processing, so the URL is committed by the time the post-call worker reads the interaction.
>
> If the upload fails, the local file is deleted anyway in the current code. That is a data-loss path worth knowing about: the recording is gone and the interaction points at nothing.

> **Alternatives**
>
> - **S3** (used) — the standard. Lifecycle rules can move old recordings to cheaper tiers automatically.
> - **Google Cloud Storage / Azure Blob** — equivalents.
> - **MinIO** — S3-compatible, self-hosted. The answer when a customer requires on-premise.
> - **A network filesystem** — familiar, but doesn't scale the same way and needs managing.

## Queues vs streams

*Messaging · 07*

We use three messaging systems, and they're genuinely different tools. Understanding the split makes the choices obvious.

> **Why any of them**
>
> Some work is slow — generating a call summary, running compliance checks, writing a report. You cannot do it while a caller waits. So you write down "this needs doing" and let another process pick it up. That note is a **message**; the place it waits is a **queue**.
>
> This also gives you a buffer: a traffic spike lengthens the queue rather than crashing anything.

| | Queue | Stream |
|---|---|---|
| Question it answers | "who will do this job?" | "this happened, whoever cares" |
| Consumers | one gets each message | many can read the same message |
| After reading | message is deleted | stays for a retention window |
| Ordering | usually not guaranteed | guaranteed within a partition |
| Ours | Celery, SQS | Kinesis |

The mental test: *does exactly one thing need to happen, or does something need to be recorded for many consumers?* Summary generation is a job — one worker, once. "A call ended" is an event — analytics, billing and the data warehouse may all want it.

## Celery

*Messaging · 08*

> **What it is**
>
> A Python task queue. You mark a function as a task; calling it puts a message on a broker instead of running it; a separate worker process picks it up and runs it.

```
celery_app = Celery(
    broker=f"{REDIS_URL}/0",     # where tasks queue up
    backend=f"{REDIS_URL}/0",    # where results are stored
    task_routes={...},           # which tasks go to which queue
    broker_connection_retry_on_startup=True,
    broker_connection_max_retries=None,   # retry forever
)
```

Both broker and backend are Redis here — one fewer system to run. The retry settings mean a worker that starts before Redis is ready keeps trying instead of dying, which matters in Kubernetes where start order isn't guaranteed.

`task_routes` sends different tasks to different queues, so slow work can't starve fast work — the same isolation idea as separating workloads in Kubernetes.

> **Celery Beat — the scheduler**
>
> The other half: cron-like scheduling. "Run this every hour." Used here for the `cronjobs/` work — purging old interaction history, downloading agent recordings.

> **Alternatives**
>
> - **Celery** (used) — the Python standard. Mature, featureful, and heavier than most people need.
> - **RQ** — much simpler, Redis-only. Good when you don't need Celery's complexity.
> - **Dramatiq** — cleaner API, saner defaults, smaller ecosystem.
> - **Cloud-native queues** (SQS + Lambda) — no workers to run. We use this too, for post-call.
> - **Temporal / Airflow** — for multi-step workflows with state and retries per step. Different problem.
>
> Note the honest position: this repo uses Celery *and* SQS. That's two task systems. Defensible — Celery for scheduled internal work, SQS for event-driven cross-service work — but it's real complexity, and worth being able to justify.

## SQS

*Messaging · 09*

> **What it is**
>
> Amazon's managed queue. You send messages; consumers receive them; you delete them when done. No servers to run, effectively unlimited scale.

Here it drives post-call processing: a call ends, a message goes on the queue, a worker picks it up and runs summary, disposition, compliance, webhooks, reports.

> **The visibility timeout — the concept that makes SQS work**
>
> When a consumer receives a message, SQS doesn't delete it. It *hides* it for a while.
>
> ```
> receive_messages()          → message hidden from other consumers
>    ... you process it ...
> delete_message()            → now it's really gone
>
> but if you crash before deleting:
>    the timeout expires      → the message reappears → someone else tries
> ```
>
> This is what makes the queue survive a worker dying mid-job. Nothing is lost.
>
> The consequence you must design for: **a message can be delivered more than once**. If your job takes longer than the timeout, it reappears while you're still working on it and a second worker starts the same job. Hence `change_message_visibility`, to extend the lease on long jobs — and hence idempotency, below.

> **Dead letter queues**
>
> A message that fails repeatedly would retry forever, burning resources. After N attempts SQS moves it to a **dead letter queue** — a holding pen for messages that can't be processed. Somebody looks at it later. Without one, a single poison message can consume a worker indefinitely.

> **Alternatives**
>
> - **SQS** (used) — managed, cheap, reliable. AWS-only, at-least-once, no ordering unless you use FIFO queues.
> - **RabbitMQ** — richer routing, you run it.
> - **Kafka** — a stream, not a queue. Different tool.
> - **Google Pub/Sub** — the GCP equivalent.
> - **Postgres as a queue** — genuinely viable at low volume with `SELECT … FOR UPDATE SKIP LOCKED`, and one fewer system.

## Kinesis

*Messaging · 10*

> **What it is**
>
> Amazon's managed **stream**. Events are appended to an ordered log and kept for a retention window. Many independent consumers can read the same events at their own pace.

Our client is small — essentially `send_event`. Events fan out to analytics and downstream systems.

> **Why not just use the queue?**
>
> Because a queue deletes a message once someone handles it. If analytics reads "call ended", billing never sees it.
>
> A stream keeps the event and lets every consumer track its own position. Add a new consumer next year and it can replay history — impossible with a queue.

### Shards and ordering

A stream is split into **shards** for throughput. Order is guaranteed *within* a shard, not across them. Events are assigned by a partition key, so using `interaction_id` as the key keeps all events for one call in order — which is usually the ordering you actually need.

> **Alternatives**
>
> - **Kinesis** (used) — managed, AWS-native. Pay per shard whether busy or not.
> - **Kafka** — the industry standard. More powerful, much more to operate. MSK is the managed version.
> - **Redpanda** — Kafka-compatible, simpler to run.
> - **Google Pub/Sub** — GCP's equivalent, blurs queue and stream.
> - **EventBridge** — AWS event bus with routing rules. Good for fan-out to AWS services.

## gRPC and REST

*Talking · 11*

Two ways services talk directly, and this repo uses both.

| | REST / HTTP + JSON | gRPC |
|---|---|---|
| Format | JSON — human-readable text | Protocol Buffers — compact binary |
| Contract | convention, maybe OpenAPI | a `.proto` file, code generated from it |
| Streaming | awkward | native, bidirectional |
| Debuggability | curl it, read it | needs tooling |
| Used here for | the interface API | a voice transport, and NVIDIA Riva speech |

> **Why gRPC for audio**
>
> Streaming and size. Audio is a continuous flow, not request-and-response, and gRPC does bidirectional streaming natively. Binary encoding also matters when you're sending fifty messages a second per call.
>
> Why REST for the management API: humans use it, browsers call it, and being able to `curl` an endpoint is worth a lot.

## Secrets Manager

*Talking · 12*

> **What it is**
>
> An AWS service that stores credentials encrypted, controls who can read them via IAM, and logs every access.

The lookup chain, in order:

```
Redis cache (1 hour)  →  AWS Secrets Manager  →  environment variable
```

> **Why three layers**
>
> **Redis first** — Speed. Hitting Secrets Manager on every call would add latency and cost to a hot path.
>
> **Secrets Manager second** — The real source of truth, with per-client keys and audit logs.
>
> **Environment last** — Local development, where you have no AWS access.

> **The failure mode to remember**
>
> It caches whatever it resolves. If a bad key is cached, the fix doesn't take effect for an hour unless you delete the key. This has genuinely cost debugging time — "I updated the key and it still says unauthorized".

## Idempotency

*The hard parts · 13*

> **What it means**
>
> An operation is **idempotent** if doing it twice has the same effect as doing it once.
>
> "Set the status to complete" is idempotent. "Add £10 to the balance" is not. "Send an email" is very much not.

This matters because — from section 2 — you can never be sure whether your first attempt worked, so you must be able to retry safely. And SQS explicitly guarantees at-least-once delivery, meaning duplicates *will* happen.

### How this repo does it

`app/background/post_call/markers.py` — described in the project's own notes as "the idempotency primitive". The pattern:

```
for each step:
    if marker_exists(interaction_id, step_name):
        skip                       # already done
    run the step
    write_marker(interaction_id, step_name)
```

Now the whole post-call run can be retried freely. Completed steps are skipped; only the unfinished ones execute. A worker dying halfway through is no longer a problem.

> **The general techniques**
>
> - **Markers** — record that a step completed. What we use.
> - **Idempotency keys** — the caller supplies a unique ID; the server remembers it and returns the original result on a repeat. How payment APIs work.
> - **Natural idempotency** — design the operation so repeating is harmless. "Set to X" instead of "add X".
> - **Database constraints** — a unique index makes a duplicate insert fail loudly instead of silently duplicating.

## Delivery guarantees

*The hard parts · 14*

| Guarantee | Means | You must handle |
|---|---|---|
| **At most once** | Never duplicated, may be lost | Lost work |
| **At least once** | Never lost, may be duplicated | Duplicates → idempotency |
| **Exactly once** | The dream | — |

> **Exactly-once delivery does not exist**
>
> Not as a network property. The three-way ambiguity from section 2 makes it impossible — you cannot distinguish a lost request from a lost reply, so you must either risk losing work or risk repeating it.
>
> What systems that advertise "exactly once" actually provide is **at-least-once delivery plus deduplication**, which produces exactly-once *processing*. Same outcome, different mechanism — and the deduplication is the part you can't skip.
>
> Saying this in an interview reliably signals that you've operated these systems rather than read about them.

SQS is at-least-once. Kinesis is at-least-once. Celery depends on configuration. So: **everything in this system must tolerate duplicates**, which is why the marker system exists.

## CAP, plainly

*The hard parts · 15*

Frequently asked, frequently mangled.

> **The actual claim**
>
> Three properties: **C**onsistency (everyone sees the same data), **A**vailability (every request gets an answer), **P**artition tolerance (it works when the network splits in two).
>
> The theorem: **when a partition happens, you must choose between C and A.**

The common misreading is "pick two of three". You don't get to pick P — networks partition whether you like it or not. So the real choice is what to do *during* a partition:

- **Choose consistency:** refuse to answer rather than risk being wrong. A bank balance should do this.
- **Choose availability:** answer with possibly-stale data. A social feed should do this.

> **How our stack sits**
>
> **Postgres — consistency.** It's the record of truth; a wrong answer is worse than no answer.
>
> **Redis — availability.** A stale cached value is fine, and the code is written to survive Redis being unreachable.
>
> That's the split, and it's deliberate: put the things that must be right in the consistent store, and the things that must be fast in the available one.

## How it fails here

*The hard parts · 16*

| Down | Effect | Severity |
|---|---|---|
| Postgres | No config, no interaction records. Calls can't start | **Total outage** |
| Redis | Cache misses, no Celery, slower key lookups | Degraded |
| S3 | Calls fine; recordings fail to upload | Data loss risk |
| SQS | Post-call work queues up, then catches up | Delayed |
| Kinesis | Analytics gap | Invisible to callers |
| Secrets Manager | Cached keys work ~1 hour, then vendors fail | Delayed outage |
| A vendor (TTS/STT/LLM) | Fallback provider, or calls fail | Depends on fallback |
| LiveKit | No calls at all | **Total outage** |

> **The pattern worth noticing**
>
> The systems in the live path — Postgres, LiveKit — take everything down. The systems in the background path — SQS, Kinesis, Celery — cause delay, not outage.
>
> That separation is a design property, not luck. It's why post-call work is on a queue rather than inline: it moves an entire class of failure out of the caller's experience.
>
> And the one case that breaks the pattern is worth knowing: post-call processing currently runs *synchronously inside the pipeline*, so a slow post-call step delays call teardown. A missing API key there added 3.5 seconds to every hangup.

## Debugging

*Practical · 17*

> **Is each dependency actually reachable?**
>
> ```
> redis-cli -h localhost -p 6379 PING              # expect PONG
> psql -h localhost -U postgres -d orchestrator -c "select 1"
> aws sts get-caller-identity                       # are AWS creds working?
> aws sqs get-queue-attributes --queue-url ... \
>     --attribute-names ApproximateNumberOfMessages
> ```

> **Queue-specific checks**
>
> - **Backlog growing?** Consumers are down or too slow. Check `ApproximateNumberOfMessages` over time, not once.
> - **Dead letter queue filling?** Something fails consistently. Read one of the messages — it'll tell you what.
> - **Same message processed repeatedly?** The job takes longer than the visibility timeout. Extend it, or make the job faster.
> - **Celery idle?** `celery -A app.session.celery:celery_app inspect active`

> **Redis inspection**
>
> ```
> redis-cli --scan --pattern "service_keys:*"    # what's cached
> redis-cli TTL "service_keys:default:xai:tts"   # how long until it expires
> redis-cli DEL "service_keys:default:xai:tts"   # force a refresh
> redis-cli INFO memory                          # near the limit?
> ```
>
> **Never run `KEYS *` on a production Redis.** It's single-threaded and that command blocks everything until it finishes. Use `--scan`.

> **The question to ask first**
>
> When something is broken, don't start reading code. Ask: **which of these systems is involved, and is it healthy?**
>
> Most "the application is broken" incidents are one dependency being unreachable, and the map in section 3 gets you there faster than any stack trace.

## Interview answers

*Practical · 18*

**Q: Why Redis and Postgres? Why not just one?**

"Different jobs. Postgres is the record of truth — durable, transactional, queryable. Redis is in-memory, so about a thousand times faster, and it can lose data on restart. That trade is the point.

So: anything that must survive and must be correct goes in Postgres. Anything that must be fast and can be recomputed goes in Redis — cached vendor keys, shared pointers, coordination between processes.

The test I use is: *if this vanished, would we lose data or just get slower?* If the answer is 'lose data', it doesn't belong in Redis."

**Q: Explain idempotency and why it matters here.**

"Doing it twice has the same effect as doing it once.

It matters because SQS guarantees at-least-once delivery — if a worker dies mid-job, the message reappears and someone else runs it. So every post-call step must tolerate running twice. Sending a customer two summary emails because a pod restarted is a real bug.

We handle it with completion markers: before each step, check whether a marker exists for that interaction and step; run it; write the marker. The whole run becomes safely retryable, and only the unfinished steps execute."

**Q: Can you achieve exactly-once delivery?**

"Not as a network guarantee. When you send a request and get no reply, you can't distinguish 'it never arrived' from 'it worked and the reply was lost'. So you either risk losing the work or risk repeating it — there's no third option.

What systems advertising exactly-once actually do is at-least-once delivery plus deduplication, which gives exactly-once *processing*. Same outcome, but the deduplication is on you, and that's the part people skip."

**Q: Why both a queue and a stream?**

"They answer different questions. A queue asks 'who will do this job?' — one consumer takes it and it's deleted. A stream says 'this happened' — many consumers read the same event and it stays for a retention window.

Generating a call summary is a job: exactly one worker, exactly once, on SQS. 'A call ended' is an event: analytics, billing and the warehouse may all want it, and a new consumer next year should be able to replay history. That's Kinesis.

Use a queue and analytics reading the event means billing never sees it."

**Q: What happens if Redis goes down?**

This is really "do you know your blast radius". Answer concretely:

"Degraded, not down. Cache misses mean key lookups fall through to Secrets Manager, so calls get slower but still work. Celery stops entirely, because Redis is its broker — so scheduled background work halts. Cross-process coordination and pub/sub stop.

Calls themselves keep working. Compare that with Postgres, where we can't read assistant config at all and no call can start — that's a total outage.

Knowing which is which is what lets you triage in seconds."

**Q: Explain CAP.**

"Consistency, availability, partition tolerance — and the common misstatement is 'pick two'. You don't get to pick partition tolerance; networks split whether you want them to or not. The real theorem is that *during* a partition you must choose between consistency and availability.

Our stack splits deliberately. Postgres chooses consistency — it's the record of truth and a wrong answer is worse than no answer. Redis chooses availability — a stale cached value is fine, and the code is written to survive it being unreachable."

**Q: You run Celery and SQS. Isn't that redundant?**

Don't be defensive; it's a fair challenge.

"Partly. The justification is that they serve different shapes of work — Celery for scheduled, internal, Python-native jobs with Beat for cron; SQS for event-driven work that crosses service boundaries and needs to survive a worker dying.

But it is two task systems, two failure modes and two things to learn. If I were designing it fresh I'd want a strong reason to keep both, and 'we grew into it' isn't one."

## Glossary

*Reference · 19*

**Distributed system** — Several machines cooperating over a network.

**Partial failure** — Some parts working while others don't. The defining difficulty.

**ACID** — Atomic, consistent, isolated, durable — a real database's promises.

**ORM** — Write Python classes, get SQL. SQLAlchemy here.

**Migration** — A versioned schema change script. Alembic here.

**Connection pool** — Reused open database connections.

**Cache** — A fast copy of something slow to fetch.

**TTL** — Time to live — automatic expiry.

**Pub/sub** — Publish an event; whoever subscribed receives it.

**Broker** — Where queued messages wait. Redis, for Celery.

**Worker** — A process that takes jobs off a queue.

**Visibility timeout** — How long SQS hides a message before making it available again.

**Dead letter queue** — Where repeatedly-failing messages go.

**Shard / partition** — A slice of a stream. Ordering holds within one.

**At-least-once** — Never lost, possibly duplicated.

**Idempotent** — Safe to do twice.

**Object storage** — Put and get blobs by key. S3.

**CAP** — During a network partition, choose consistency or availability.

**Blast radius** — What breaks when a given component fails.

**Multi-tenancy** — Many customers in one system, separated by an ID on every row.

---

Sources: `app/session/*` · `app/background/post_call/` · `CLAUDE.md`
Companion documents: voice runtime · pipecat upgrade · telephony · CI/CD and containers · the Vasco stack
