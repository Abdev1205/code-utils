# Beyond One Process

**Topic:** Distributed systems
**Covers:** EC2, Kubernetes, Postgres, Redis, Celery, SQS, Kinesis, S3 - grounded in the code
**Source:** [Claude artifact](https://claude.ai/artifact/LwcBGMEyCPrVbyk8YjAF5y) — written by a colleague, mirrored here for study.

*from zero · grounded in orchestrator-service*

What a distributed system is, and every piece of infrastructure this codebase actually uses — EC2, Kubernetes, Postgres, Redis, Celery, SQS, Kinesis, S3 — each with a definition, why it exists, where it's used here, and what goes wrong.

**One correction up front, because you asked about Kafka**

**This system does not use Kafka.** There is no Kafka anywhere in the repository — zero files reference it. What it uses instead is **Amazon SQS** for work queues and **Amazon Kinesis** for event streams, which are the managed AWS services that fill those two roles.

Kafka still gets a full section (§15), because it's the thing interviewers ask about and you should be able to compare it against what you actually run. But don't claim it on your CV.

## Why distribute at all
*Foundations · 01*

**Definition**

A **distributed system** is one where the work is spread across multiple machines that coordinate over a network. The defining property is not "lots of computers" — it's that **parts of it can fail independently while the rest keeps running**, and that no single part has the complete picture.

Start with the simplest thing that could work: one program on one machine holding everything in memory.

```
┌────────────────────────────┐
│   one process               │
│   handles calls             │
│   stores data in memory     │
│   runs background jobs      │
└────────────────────────────┘
```

Four forces break it, and each one forces a specific piece of infrastructure into existence:

| Force | What breaks | What you add |
|---|---|---|
| **Volume** | One machine can't handle the load | Many machines → a scheduler (Kubernetes) |
| **Durability** | Restart loses everything in memory | A database (Postgres), object storage (S3) |
| **Availability** | One machine dying takes you down | Replicas, health checks, load balancing |
| **Different shapes of work** | Slow background jobs starve fast requests | Queues and workers (Celery, SQS) |

**The trade you are making, stated honestly**

Every one of those additions buys capacity or resilience and **pays for it in complexity**. A function call becomes a network call that can time out. A variable becomes a database row two processes might write at once. A crash stops being total and starts being partial — which is harder, because now half the system believes something the other half doesn't.

The whole discipline is about managing that trade deliberately rather than accidentally.

## What breaks
*Foundations · 02*

There's a famous list — the **fallacies of distributed computing** — of assumptions that are true within one process and false across a network. Four matter most here:

| Assumption | Reality | Consequence in this system |
|---|---|---|
| The network is reliable | It isn't | Every vendor WebSocket needs reconnect logic |
| Latency is zero | It isn't | A CRM call is 3 seconds of dead air on a phone line — hence filler words |
| Messages arrive once | They arrive *at least* once | Post-call processing must be idempotent |
| There's one clock | Every machine's clock differs | Never order events by wall-clock timestamps across machines |

**The one that causes the most real bugs**

**You cannot distinguish "slow" from "dead".**

You call a service. Nothing comes back. Did it crash before doing the work, crash after doing the work, or is it just slow and about to reply?

There is no way to tell from the outside. Ever. That single fact is why retries exist, why retries force idempotency, and why idempotency markers are scattered through this codebase. Everything downstream in this document follows from it.

## The map
*Foundations · 03*

Every moving part in this system, in one picture.

```
                        ┌──────────────┐
   phone network ──SIP──►  OpenSIPS    │  EC2, {{env:TELEPHONY_CUSTOMER|Customer}} VPC
                        │  RTPEngine   │
                        └──────┬───────┘
                               │ SIP
                        ┌──────▼───────┐
                        │ LiveKit Cloud│  rooms, SIP bridge
                        └──────┬───────┘
                               │ WebRTC
   ┌───────────────────────────▼──────────────────────────┐
   │  Kubernetes cluster (EKS)                            │
   │                                                       │
   │  ns: dm         OSV-LiveKit    64 replicas (India)   │
   │                 interface      REST API              │
   │                 text runtime   SMS / chat            │
   │                 celery worker  background tasks      │
   │                 post-call      SQS consumer          │
   │                 reconciler     hourly CronJob        │
   │                                                       │
   │  ns: telephony  OpenSIPS / RTPEngine (LiveKit side)  │
   └───────┬───────────────┬───────────────┬──────────────┘
           │               │               │
      ┌────▼────┐    ┌─────▼─────┐   ┌─────▼──────┐
      │Postgres │    │   Redis   │   │ SQS/Kinesis│
      │ RDS     │    │           │   │ S3/Secrets │
      └─────────┘    └───────────┘   └────────────┘
```

**The real deployment numbers**

From `docs/architecture/sip-ingress-architecture.md`:

| Component | Kind | Replicas | Node |
|---|---|---|---|
| OSV-LiveKit (India) | Deployment | 64 | `m7i.4xlarge` |
| OSV-LiveKit (US) | Deployment | 9 | `m7i.4xlarge` |
| OSV-LiveKit (Canada) | Deployment | 9 | `m7i.4xlarge` |
| RTPEngine-LiveKit | StatefulSet | 2 | `sip-connect` |
| {{env:TELEPHONY_CUSTOMER|Customer}} OpenSIPS | Raw EC2 | 2 | `c6i.xlarge` (Keepalived HA) |
| {{env:TELEPHONY_CUSTOMER|Customer}} Outbound | Raw EC2 | 4 | `c6i.2xlarge` |
| Post-call reconciler | CronJob | 1 | `concurrencyPolicy: Forbid` |

Plus a **downscaler**: 64 replicas during business hours (07:45–19:25 IST), **4 replicas overnight**. That ratio tells you something important — traffic is heavily peaked, and the fleet is sized for the peak, not the average.

## EC2
*Where code runs · 04*

**Definition**

**EC2** — Elastic Compute Cloud — is AWS's virtual machine service. You rent a machine by the hour: a CPU count, an amount of RAM, a disk, an IP address. It boots an operating system and you install whatever you like on it.

The instance name encodes what you're getting: `m7i.4xlarge` is the *m* family (general purpose), generation *7*, *i* for Intel, at the *4xlarge* size — 16 vCPUs and 64 GB of RAM. `c6i` is the *c* family, compute-optimised: more CPU per gigabyte.

**What it's for**

Total control. You choose the kernel, the network stack, the disk layout. That matters when software needs things a container platform doesn't easily give — kernel modules, specific network configuration, a fixed public IP, or raw packet handling.

**Where it's used here — and the distinction that matters**

**Two different things are both "EC2", and conflating them is a common mistake.**

**1 · Raw EC2, managed directly.** The {{env:TELEPHONY_CUSTOMER|Customer}} telephony servers: 2 OpenSIPS instances in Keepalived HA, 2 RTPEngine instances, 4 outbound servers. These are hand-managed VMs.

Why not containers? Because SIP and RTP want **stable IPs** (carriers whitelist them), **huge UDP port ranges** (RTPEngine uses 10000–60000), and **host networking** for media performance. Kubernetes makes all three awkward. This is the honest, specific answer to "why isn't everything containerised".

**2 · EC2 underneath Kubernetes.** The 64 OSV replicas run in pods, but those pods run on nodes, and the nodes are EC2 instances — `m7i.4xlarge`, provisioned by Karpenter. Nobody logs into them; they're cattle.

**Drawbacks**

- **You own the maintenance.** Patching, monitoring, replacing a failed instance — all yours.
- **Scaling is manual or scripted.** No pod autoscaler will help you.
- **Instances fail.** AWS retires hardware. Anything on raw EC2 needs an HA story — which is precisely why those OpenSIPS boxes run Keepalived.
- **You pay for idle.** An on-demand instance bills whether or not it's doing anything.

## Kubernetes and EKS
*Where code runs · 05*

**Definition**

**Kubernetes** is a scheduler for containers. You declare *what should be running* — "64 copies of this image, each needing 2 CPUs" — and it decides which machines run them, restarts them when they die, and reschedules them when a machine disappears.

The mental shift: you stop saying "run this program on that server" and start saying "this many should exist somewhere". **EKS** is AWS running the Kubernetes control plane for you.

**The vocabulary, from zero**

- **Container** — An application plus its dependencies, packaged so it runs identically anywhere. Not a VM — it shares the host kernel, which is why it starts in milliseconds.
- **Pod** — The unit Kubernetes schedules. Usually one container. Pods are disposable and get a new IP every time.
- **Node** — A machine that runs pods. Here, an EC2 instance.
- **Deployment** — "Keep N identical pods running." Handles rolling updates and restarts. Pods are interchangeable.
- **StatefulSet** — Like a Deployment, but pods have *stable identities* — `pod-0`, `pod-1` — and keep them across restarts. Used for RTPEngine, which needs a fixed identity for media routing.
- **CronJob** — Runs a pod on a schedule.
- **Namespace** — A logical partition. Here: `dm` for the application, `telephony` for SIP.
- **Service** — A stable name and address in front of a changing set of pods. `redis-orch.cache.svc.cluster.local` in the config is one of these.
- **Taint / toleration** — A taint marks a node "don't schedule here unless you're allowed". OSV nodes carry `orchestrator-service-voice-livekit=true:NoSchedule`, so voice pods get dedicated machines and no batch job can land beside them and steal CPU mid-call.

**Where it's used here**

Everything except the SIP EC2s. The interesting choices:

- **Deployment vs StatefulSet** — OSV pods are interchangeable (any pod can take any call), so Deployment. RTPEngine needs stable identity, so StatefulSet.
- **Dedicated tainted nodes for voice** — real-time audio cannot share a machine with anything that might spike CPU.
- **CronJob with `concurrencyPolicy: Forbid`** for the post-call reconciler — if the previous run is still going, skip this tick rather than starting a second one. Single-pod by design, which sidesteps a whole class of coordination problems.

**Drawbacks**

- **Genuine complexity.** Many concepts, and debugging spans pods, services, ingresses and node pools.
- **Pods are killed without warning** — evictions, node replacement, deploys. Anything holding a live call must handle a `SIGTERM` gracefully, which is why §19 exists.
- **Networking is indirect.** Every hop is another place a packet can be dropped or a policy can block.
- **Resource requests are guesses** until you measure. Set them too low and pods get throttled or OOM-killed mid-call.

## Karpenter and scaling
*Where code runs · 06*

**Definition**

**Karpenter** provisions nodes on demand. When pods can't be scheduled because no node has room, it launches an EC2 instance sized to fit them — and terminates nodes that empty out.

The older approach, Cluster Autoscaler, picks from pre-defined node groups. Karpenter chooses the instance type itself, which packs better and provisions faster.

**Two layers of scaling, and people mix them up**

```
pod autoscaling   (HPA)        how many copies of the app
node autoscaling  (Karpenter)  how many machines to run them on
```

They work together: the HPA asks for more pods, they don't fit, Karpenter adds a node, the pods schedule. Scaling down runs in reverse.

**Where it's used here — and the scheduled downscaler**

OSV nodes come from a Karpenter NodePool on `m7i.4xlarge`, on-demand.

On top of that sits a **time-based downscaler**: 64 replicas from 07:45 to 19:25 IST, 4 outside those hours. Not reactive — *scheduled*.

Why schedule rather than autoscale on load? Because a voice pod cannot be scaled up *reactively* fast enough. A new node takes a minute or two to launch and join; a call arriving now needs capacity now. So you pre-provision for known business hours and accept paying for some idle capacity.

That's a genuinely good thing to be able to explain — it shows you understand that autoscaling has a response time, and that real-time workloads often can't wait for it.

**Why on-demand and not spot instances**

Spot instances are far cheaper and can be reclaimed with about two minutes' notice. Two minutes is fine for a batch job. It is **not** fine for a pod holding thirty live phone calls, all of which would drop.

This is the general principle: *stateful, long-lived, user-facing work pays for reliability; stateless batch work takes the discount.*

## PostgreSQL
*State · 07*

**Definition**

A relational database — tables, rows, SQL, and **ACID transactions**: a group of writes either all happen or none do, and concurrent transactions don't see each other's half-finished work.

It's the **source of truth**. Everything else in this document is a cache, a queue, or a copy.

**Where it's used here**

Configured in `app/session/database.py`, accessed through SQLAlchemy, migrated with Alembic. It holds assistants and their versioned configs, flows, interactions and turns, integrations, users, clients — and the `interaction_metadata` JSON blob that carries the post-call execution markers.

Two properties the codebase relies on heavily:

- **Multi-tenancy via `client_id`.** Every query filters on it. Tenant isolation is enforced in the query layer, so a missing filter is a data leak — which is why it's called out in the project instructions.
- **Soft deletes via `deleted_at`.** Rows are marked, not removed, so a deletion is recoverable and history survives.

**Drawbacks**

- **One writer.** You scale reads with replicas; writes go to one primary. Eventually that's your ceiling.
- **Connections are expensive** — each is a server-side process. See the next section, because at 64 replicas this stops being theoretical.
- **Locks.** Two transactions touching the same rows in different orders can deadlock.
- **Schema changes on a large table can block writes** unless done carefully. Which is why committed migrations are never edited.

## Connection pooling
*State · 08*

**Definition**

Opening a database connection costs a TCP handshake, authentication, and a new backend process on the server — tens of milliseconds and real memory. A **pool** opens a set of connections once and lends them out, so a query borrows and returns rather than connecting.

**The real settings**

```
DB_POOL_SIZE     = 10     # kept open per process
DB_POOL_OVERFLOW = 30     # extra allowed under burst
DB_POOL_TIMEOUT  = 30     # seconds to wait for a free one
DB_POOL_RECYCLE  = 1800   # recycle a connection after 30 min
```

*app/session/database.py*

`DB_POOL_RECYCLE` is the one people don't understand. Network middleboxes and Postgres itself silently drop connections that have been idle a long time, and the client doesn't find out until it tries to use one — producing a confusing "server closed the connection unexpectedly". Recycling proactively closes and reopens before that happens.

**Do the multiplication — this is the interview point**

```
64 pods × (10 + 30 overflow) = up to 2,560 connections
                                 from the voice fleet alone

plus interface pods, text runtime, celery workers,
     the post-call worker, the reconciler...
```

Postgres commonly defaults to a `max_connections` in the low hundreds. **Pool sizes are per process, and a horizontally scaled fleet multiplies them.** Get this wrong and the database starts refusing connections under exactly the load where you need it most.

The standard fix is an external pooler like **PgBouncer** sitting between the fleet and Postgres, multiplexing thousands of client connections onto a small number of real ones. If asked "how would you scale the database layer", this is the first answer — before read replicas, before sharding.

## Redis — six different jobs
*State · 09*

**Definition**

**Redis** is an in-memory data store. Because everything lives in RAM it's extremely fast — microseconds — and because it's a *server*, many processes share the same data. That combination is what makes it the coordination point for a distributed system.

It's single-threaded for command execution, which sounds like a limitation and is actually a feature: **commands can't interleave**, so operations are naturally atomic.

**Where it's used here — and it's used for six genuinely different things**

`app/session/redis.py` exposes a singleton `RedisClient`. Default host `redis-orch.cache.svc.cluster.local` — a Kubernetes service name, so it's an in-cluster Redis.

### 1 · Celery broker and result backend

```python
REDIS_URL = f"redis://{REDIS_HOST}:{REDIS_PORT}"
celery_app = Celery("orchestrator",
                    broker=f"{REDIS_URL}/0",
                    backend=f"{REDIS_URL}/0")
```

Redis holds the task queues and the task results. §13.

### 2 · Cache

`set`/`get`/`set_json`/`get_json`, all with a TTL. The post-call pipeline has a whole step for it — `steps/redis_cache.py`.

### 3 · Pub/sub for cross-process events

```python
redis_channel = f"sms_events:{interaction_uuid}"
self.redis_client.publish(redis_channel, message)
```

The problem being solved: an SMS reply arrives at whichever pod the webhook happened to hit, but the conversation is being handled by a *different* pod. Pub/sub is the message bus that gets the event to the right one.

### 4 · A presence registry, using sets with TTL

```python
register_active_listener(channel, interaction_uuid)
has_active_listeners(channel, interaction_uuid)
refresh_listener_ttl(channel, interaction_uuid)
publish_event_if_listeners_exist(...)
```

Publishing to a channel nobody is listening on is wasted work, and worse, it hides the fact that the conversation has no live handler. So listeners register themselves with a TTL and refresh it — a **heartbeat**. If a pod dies, its registration expires by itself. No cleanup code, no orphan detection: the TTL *is* the failure detector.

### 5 · Distributed counters for provider concurrency

```
reliability:{service}:{assistant_uuid}:{PROVIDER}      per-assistant
reliability:{service}:global_counter:{PROVIDER}        global
reliability:{service}:global_limit:{PROVIDER}          the cap
```

Vendor connections are a metered resource. 64 pods have to share one budget, and no pod can see the others — so the count lives in Redis. §10 covers the atomicity problem this creates.

### 6 · Sharing an LLM prompt cache across pods

The Vertex `cachedContents` resource ID is stored in Redis so every pod handling calls for the same assistant reuses one cached prompt prefix rather than each creating its own. The cache is created once and shared; without Redis, 64 pods would create 64 caches and the saving would evaporate.

**Drawbacks**

- **Memory is the limit**, and it's expensive per gigabyte. Redis is not where bulk data goes.
- **Durability is weak by default.** Treat anything in Redis as losable. Note the capacity module says so explicitly: a call killed by SIGKILL leaves its counter increment stranded.
- **Single-threaded** — one slow command (a `KEYS *` on a large database) blocks every other client.
- **It becomes a single point of failure** the moment coordination depends on it. Note `RedisClient` degrades gracefully — `is_connected` is checked and operations return `False` rather than raising.

## Atomic admission — the Lua script
*State · 10*

**The problem, precisely**

Admitting a call to a capped provider is three operations:

```
1. read the counter
2. is it under the limit?
3. increment it
```

Between step 1 and step 3 another pod can do the same thing. With 64 pods this isn't a theoretical race — it happens whenever traffic spikes, which is exactly when the cap matters.

**The failure it produces**

```
limit = 10, counter = 9

pod A: reads 9  → under limit ✓
pod B: reads 9  → under limit ✓      (A hasn't written yet)
pod C: reads 9  → under limit ✓
   all three increment → counter = 12

the cap was 10. You breached it by the number of racing pods.
```

Then the vendor starts rejecting connections and calls fail — during your busiest minute.

**The fix in this codebase**

From `app/runtime/voice/utils/capacity.py`:

> "Admission runs a single **Lua script** so the 'read counter → check under limit → increment' sequence is atomic across all pods sharing one Redis. Without this, concurrent admissions could each read an under-limit count and all increment, breaching the cap by up to the number of racing pods."

Redis executes a Lua script as **one indivisible command**. No other client's commands interleave with it. Read-check-increment becomes a single atomic operation, and the race is structurally impossible rather than unlikely.

The module docstring makes a second point worth stealing: *"One copy of the Lua admission script matters: two copies drifting is exactly the cross-pod cap breach the script exists to prevent."* ASR and TTS share one implementation with a service discriminator, rather than having a copy each.

**Two more design decisions in that module**

**Two layers of cap.** Per-assistant (from the config's `concurrency_threshold`) *and* global (from `runtime_providers.quota_limit`). One customer can't consume the whole company's vendor quota.

**An unlimited provider is the safety net.** "Every language is expected to have at least one unlimited provider... so a language whose limited providers are all full simply falls through to that unlimited provider. This is the safety net — no explicit 'force' pass is needed, and **a live call is never dropped**."

That's the right priority ordering: capacity limits protect cost and vendor relationships, but they must never be the reason a customer's call fails.

## S3
*State · 11*

**Definition**

**S3** is object storage: you put a blob under a key in a bucket and get it back later. Not a filesystem — there are no real directories, no partial writes, no appending. Effectively unlimited, very cheap, and extremely durable.

**Where it's used here**

`app/session/s3.py`. Primarily **call recordings**: the recorder writes a WAV to local disk during the call and uploads it at cleanup, deleting the local copy only if the upload succeeded.

Also SFTP reports, exports, and evaluation artefacts.

The useful method to know is `generate_presigned_url(bucket, key, expiration=3600)` — a temporary URL granting access to one object for one hour. It's how a recording gets played in the dashboard without the bucket being public and without proxying the bytes through your API.

**Drawbacks**

- **Slow relative to a disk** — tens of milliseconds per request. Fine for a file at end of call; wrong for anything in a hot path.
- **No partial updates.** Changing a byte means rewriting the object.
- **Listing is expensive** at scale, and paginated.
- **Eventual consistency for some operations** historically; strong read-after-write now, but old assumptions linger in code you'll read.

## Secrets Manager
*State · 12*

**Definition**

AWS **Secrets Manager** stores credentials encrypted, controls access with IAM, versions them, and audits every read. The point is that secrets stop living in environment variables and config files where they get committed, logged and leaked.

**Where it's used here — per-client vendor keys**

`app/session/secrets_manager.py`, with a structured naming scheme:

```python
_build_secret_name(client_uuid, service_name, service_type)
    → "orchestrator/{client_uuid}/{service_type}/{service_name}"
```

This is **bring-your-own-key** multi-tenancy: each client can supply their own Deepgram or Cartesia credentials, billed to them, isolated from every other tenant. `get_key`, `add_key`, `update_key`, `list_keys`, `delete_key` — a full lifecycle, exposed through the admin API.

Shared secrets that aren't per-client are injected at runtime by **Infisical** (`infisical run -- python main.py ...`), with machine-specific values in a local `.env`.

**Drawbacks and the thing to watch**

- **An API call per fetch** — cache, or you add latency and cost to every call setup.
- **Availability dependency** — if Secrets Manager is unreachable you can't start a call.
- **Rotation is a workflow, not a feature.** Storing a secret safely doesn't help if it's never rotated.

Worth stating plainly: a secret that has ever been committed to git is compromised permanently, because git history is forever and repositories get cloned. Rotation is the only remedy — removing the line does nothing.

## Queues versus streams
*Messaging · 13*

**The distinction everything else hangs on**

These look similar and behave very differently.

| | Queue | Stream |
|---|---|---|
| Question it answers | "Who will do this work?" | "Who wants to know this happened?" |
| Consumers | One consumer gets each message | Every consumer sees every message |
| After reading | Message is deleted | Message stays for a retention period |
| Ordering | Usually not guaranteed | Ordered within a partition |
| Replay | No | Yes — rewind and re-read |
| Here | **SQS**, **Celery** | **Kinesis** |

**The rule:** a queue distributes *work*. A stream broadcasts *facts*. "Process this call's post-call pipeline" is work — exactly one worker should do it. "This call ended with status X" is a fact — analytics, the dialer and the CRM may all want it independently.

**Why use either instead of just calling the service?**

- **Decoupling** — The producer doesn't need the consumer to be up. Post-call processing can be down for ten minutes and no call fails.
- **Buffering** — A traffic spike queues up instead of overwhelming a downstream service.
- **Retries** — A failed message is redelivered automatically.
- **Fan-out** — One event, many consumers, added without touching the producer.
- **Latency isolation** — The voice runtime returns immediately; slow work happens elsewhere. This is why the *call* doesn't wait for the summary LLM.

## Celery
*Messaging · 14*

**Definition**

**Celery** is a Python task queue. You decorate a function; calling `.delay()` puts a message on a broker instead of running it; a separate worker process picks it up and runs it.

```python
@celery_app.task
def generate_report(interaction_id): ...

generate_report.delay(123)   # returns immediately
```

**The real configuration, annotated**

```python
broker  = redis://.../0
backend = redis://.../0

task_routes = {
    "datasync.*": {"queue": "datasync"},
    "*":          {"queue": "orchestrator-queue"},
}

broker_transport_options = {"visibility_timeout": 60}
task_time_limit          = 8 * 60 * 60      # 8 hours
worker_prefetch_multiplier = 1
broker_connection_max_retries = None        # retry forever

beat_schedule = {
    "check-last-file-modified-every-20-minutes": {...every 1200s},
    "transient-cleanup-daily": {...crontab(hour=4, minute=30)},
}
```

*app/session/celery.py*

Four of those are worth understanding rather than skimming:

- **Two queues, and the order matters** — The config even says so: *"the first one is the one that will be used"*. Datasync jobs are long and heavy; conversation-adjacent tasks are short. Separate queues mean **a datasync backlog cannot starve everything else** — the head-of-line-blocking fix from the Vasco document, applied here.
- **`worker_prefetch_multiplier = 1`** — By default a Celery worker grabs several tasks at once. With long tasks that's terrible: one worker sits on four jobs it hasn't started while another worker is idle. Setting it to 1 means take one, finish it, take another. **The single most impactful Celery setting for long tasks.**
- **`task_time_limit = 8 hours`** — A hard ceiling. Very long, because datasync legitimately runs for hours — but bounded, so a hung task can't hold a worker forever.
- **`broker_connection_max_retries = None`** — Retry the broker connection indefinitely. A Redis blip should pause the workers, not kill them.

**Celery Beat** is the scheduler — cron inside Celery. It emits the datasync check every 20 minutes and a cleanup at 04:30 UTC (10:00 IST, chosen to be off-peak).

**Drawbacks**

- **Redis as a broker is not durable** the way a real message broker is. Acceptable for retryable work, not for anything that must never be lost.
- **Beat is a single point of failure** — two Beat instances means every scheduled task fires twice.
- **Visibility timeout is a redelivery trap.** At 60 seconds, a task running longer than that gets *redelivered while still running*, so it executes twice. The mitigation is idempotency, and it's a genuinely common production surprise.
- **Failures are silent** unless you monitor. A task that raises just… doesn't happen.

## SQS
*Messaging · 15*

**Definition**

**Amazon SQS** — Simple Queue Service — is a managed queue. Producers send messages, consumers receive them, and the queue holds them in between. Nothing to run, nothing to scale, effectively unlimited throughput.

**The three concepts that define its behaviour**

- **Visibility timeout** — When a consumer receives a message, it becomes *invisible* to other consumers for a period — but it is **not deleted**. The consumer must explicitly delete it after succeeding. If it crashes, the timeout expires and another consumer gets it. This is the whole reliability mechanism, and it's why crashes don't lose work.
- **Long polling** — Instead of asking "anything?" every second, the consumer holds the request open for up to 20 seconds and the queue replies as soon as something arrives. Fewer API calls, lower cost, lower latency.
- **Dead-letter queue** — After N failed deliveries a message is moved to a separate queue instead of retrying forever. Poison messages get quarantined rather than blocking the pipeline, and the DLQ becomes an alertable signal.

**Where it's used here — the post-call worker**

`app/background/post_call/worker.py`. Message body: `{"interaction_uuid": "..."}`. Five consumer coroutines by default (`POST_CALL_WORKER_CONCURRENCY`), long-polling at 20 seconds.

The docstring lays out the handling per message, and every branch is a deliberate decision:

```
1. malformed JSON      → log + DELETE   (retrying won't help)
2. interaction missing → log + DELETE   (won't appear later)
3. runtime facts not committed yet
                       → LEAVE IN FLIGHT (redelivery will find it)
4. start a tracing span
5. run the idempotent pipeline
6. success → DELETE   |   failure → LEAVE IN FLIGHT
```

**Step 3 is the most interesting.** The voice runtime published the message before it finished writing the call's facts to the database — a genuine cross-service race. The worker doesn't retry in a loop and doesn't error: it simply *declines to delete the message*. SQS redelivers after the visibility timeout, by which point the write has landed.

Using the queue's own redelivery as a retry mechanism, with zero retry code. That's the pattern worth taking away.

**Drawbacks**

- **At-least-once, not exactly-once.** Duplicates will happen. §17.
- **No ordering** in a standard queue. FIFO queues exist with lower throughput.
- **Visibility timeout must exceed processing time**, or you get concurrent duplicate processing. `change_message_visibility` exists for extending it mid-work.
- **No replay.** Deleted is gone. If you need to reprocess history, you need a separate backfill path — which is exactly why the markers carry a `source` field distinguishing `realtime` from `backfill`.

## Kinesis
*Messaging · 16*

**Definition**

**Amazon Kinesis Data Streams** is a managed event stream. Records are appended to a stream, kept for a retention period (24 hours by default, extendable), and *any number of consumers* can read them independently, each tracking its own position.

**Shards and partition keys — the two concepts that matter**

A stream is divided into **shards**. Each shard is an ordered sequence with fixed throughput (roughly 1 MB/s or 1,000 records/s in). Total capacity is shards × that.

Every record carries a **partition key**, hashed to choose a shard:

```python
send_event(stream_name, partition_key, payload)
```

**Ordering is guaranteed within a shard, not across shards.** So the partition key is how you control ordering: use the same key for records that must stay in order relative to each other.

**Where it's used here**

`app/session/kinesis.py`, a thin wrapper over `put_record`. The visible use is **call status events** — `KINESIS_CALL_STATUS_STREAM` in `livekit_session.py`, with `_send_to_kinesis(result)` publishing outbound dial results.

Why a stream rather than a queue for this: dial results are *facts* that several systems care about. The dialer needs them to decide whether to retry, analytics needs them for reporting, and the customer's CRM may want them too. Each consumer reads independently at its own pace, and adding a fourth consumer requires no change to the producer.

The right partition key here is the call or campaign identifier, so all events for one call land on one shard and stay ordered.

**Drawbacks**

- **You manage shard count.** Under-provision and you get throttled; over-provision and you pay for idle shards. Resharding is an operation, not a setting.
- **A hot partition key** sends everything to one shard and you hit that shard's limit while the rest sit idle. Classic Kinesis failure.
- **Consumers track their own position**, which means checkpoint state you have to manage.
- **Retention costs money** beyond 24 hours.

## Kafka — and why it isn't here
*Messaging · 17*

**Definition**

**Apache Kafka** is a distributed, durable, append-only log. Producers append to **topics**, topics are split into **partitions**, and consumers read at their own position. It's the same conceptual model as Kinesis — because Kinesis was built as the managed answer to it.

Kafka's distinctive properties: enormous throughput (millions of messages/sec), configurable retention up to forever, exactly-once semantics within its own ecosystem, and a rich surrounding stack — Kafka Connect, Kafka Streams, Schema Registry.

| | Kafka | Kinesis |
|---|---|---|
| Operations | You run it (or pay MSK/Confluent) | Fully managed |
| Unit | Partition | Shard |
| Retention | Configurable, up to unlimited | 24 h default, up to 365 days |
| Throughput | Higher ceiling | Per-shard limits |
| Ecosystem | Large — Connect, Streams, ksqlDB | Smaller; leans on Lambda/Firehose |
| Cost model | Cluster you size and run | Per shard-hour and per record |
| Cloud portability | Runs anywhere | AWS only |

**Why this system uses Kinesis instead — the honest reasoning**

**Because the volume doesn't justify the operational cost.** Kafka is superb at scales this system doesn't reach: this is call status events, not clickstream telemetry. A Kafka cluster means brokers, coordination, partition rebalancing, retention tuning and someone on call for it.

The rest of the stack is already AWS — SQS, S3, Secrets Manager, EKS — so Kinesis inherits the same IAM, the same VPC endpoints, the same monitoring, and the same boto3 client. Adding a second, self-operated messaging system for one use case would be a poor trade.

**When you'd flip that decision:** you need retention measured in months rather than days; you need throughput beyond comfortable shard management; you want Kafka Connect's ready-made sinks; you're multi-cloud; or you already run Kafka for something else, in which case the marginal cost is near zero.

## At-least-once delivery
*Correctness · 18*

**The three delivery guarantees**

- **At most once** — Send and forget. Fast; messages can be lost.
- **At least once** — Retry until acknowledged. Nothing lost; **duplicates happen**. What SQS, Celery and Kinesis all give you.
- **Exactly once** — What everyone wants. **Not achievable** across a network in the general case.

**Why exactly-once is impossible — the argument in four lines**

```
consumer processes the message
consumer crashes before acknowledging
queue never hears the ack
queue redelivers  → processed twice
```

Move the acknowledgement before the processing and you get the opposite failure: crash after ack, before work, and the message is lost forever. There is no ordering of those two steps that is safe, because the crash can land between them wherever you put them.

What systems marketed as "exactly once" actually do is **at-least-once delivery plus deduplication**. Which is the next section, and which is your job.

## Idempotency
*Correctness · 19*

**Definition**

An operation is **idempotent** if doing it twice has the same effect as doing it once.

```
set balance = 100        idempotent
add 100 to balance       NOT idempotent
send email               NOT idempotent
send email if not sent   idempotent
```

Given that redelivery is guaranteed, idempotency is not a nice property — it is the **requirement** that makes at-least-once delivery survivable.

**How this codebase does it — markers**

`app/background/post_call/markers.py`. Each step writes a timestamp into `interaction_metadata.post_call_execution` when it finishes:

```json
"post_call_execution": {
    "source":                     "realtime",
    "runtime_facts_committed_at": "2026-04-20T11:50:00+00:00",
    "call_summary_completed_at":  "2026-04-20T11:50:02+00:00",
    "metadata_committed_at":      "2026-04-20T11:50:05+00:00",
    "compliance_event_sent_at":   "2026-04-20T11:50:06+00:00",
    "post_call_apis": {
        "638": "2026-04-20T11:50:07+00:00"    ← keyed by integration_id
    },
    "sftp_report_uploaded_at":    "2026-04-20T11:50:09+00:00",
    "redis_cache_updated_at":     "2026-04-20T11:50:10+00:00",
    "completed_at":               "2026-04-20T11:50:10+00:00"
}
```

On redelivery, each step checks `is_step_completed()` and short-circuits.

**Five things this design gets right**

- **Per-step, not per-message.** A crash after step 3 means steps 1–3 are skipped and step 4 runs. Nothing is redone and nothing is skipped — *partial progress survives*.
- **Per-integration granularity.** `post_call_apis` is keyed by `integration_id`, so if you fire three post-call webhooks and the second fails, the first is not re-sent on retry.
- **Markers live with the data.** They're in the same Postgres row as the interaction, so they're transactional with it. No separate store to fall out of sync.
- **Timestamps, not booleans.** A boolean says "done". A timestamp says *when* — which turns the marker set into a free per-step latency trace when you're debugging.
- **`completed_at` as the terminal signal.** The reconciler uses it to find calls whose pipeline never finished — which is the safety net for messages lost entirely.

Note the docstring's precision: *"Optional / disabled steps do NOT write markers — they are skipped entirely."* Same distinction as the compliance auditor's `"disabled"` status. **"We didn't do it" and "we did it and there was nothing to do" must never be recorded the same way.**

## Races
*Correctness · 20*

**Definition**

A **race condition** is when the outcome depends on the relative timing of concurrent operations. Distributed systems are full of them because there is no shared clock and no shared memory.

**The three in this codebase, and their three different fixes**

- **Race 1 — concurrent capacity admission** — Many pods read-check-increment the same counter. **Fix: atomicity.** A Lua script makes the sequence indivisible. §10.
- **Race 2 — post-call publish beats the runtime's write** — The message arrives before the facts are committed. **Fix: a precondition plus redelivery.** Require the `runtime_facts_committed_at` marker; if it's absent, leave the message in flight. §15.
- **Race 3 — ordering inside the voice pipeline** — Gender identification versus the first LLM call: "the processor's own stop frames reach it ~150 ms after this commit... so frame order can't be relied on." **Fix: a single commit path.** Route all commits through one place and gate there. One shot, win or lose.

**The general lesson**

Three races, three different fixes: **make it atomic**, **make it retryable**, or **make it single-threaded**. Recognising which one applies is most of the skill.

And note the reconciler is a fourth strategy — **reconcile after the fact**. An hourly CronJob with `concurrencyPolicy: Forbid` that finds interactions without `completed_at` and republishes them. Accepting that some messages will be lost and building a sweeper is often cheaper and more robust than trying to make delivery perfect.

## Graceful shutdown
*Correctness · 21*

**Definition**

Kubernetes stops a pod by sending `SIGTERM`, waiting a grace period, then sending `SIGKILL`, which cannot be caught. **Graceful shutdown** is what you do in that window.

**Where it matters here**

**The post-call worker**: *"On SIGTERM/SIGINT, consumers finish their in-flight message (if any) and exit cleanly."* Note it doesn't abandon work — an abandoned message would be redelivered anyway, but finishing avoids the duplicate.

**Pipeline cleanup**: capacity release runs *first and unconditionally*, before anything that can block or raise. A leaked capacity counter turns away future calls forever, so it is the highest-priority cleanup action.

**Voice pods** are the hard case. A pod may hold dozens of live calls. You cannot finish them — some run for ten minutes. The real strategy is to stop accepting *new* calls, let existing ones drain, and only then exit. Deploys therefore roll slowly, and the off-hours downscale exists partly so scale-down happens when few calls are live.

**The stranded-counter case, stated honestly**

From `capacity.py`: *"counters have no per-call identity, so a call whose cleanup never runs (SIGKILL/OOM) leaves its increment stranded."*

A known, documented limitation rather than a hidden bug. Over time stranded increments accumulate and the effective cap shrinks. The proper fix is per-call identity with a TTL — a set of call IDs rather than a bare counter, so entries expire on their own. Worth mentioning if asked how you'd improve it.

## Sandbox and environments
*Operating · 22*

**Definition**

A **sandbox** is an isolated environment where you can run the real system without real consequences — no live customers, no real charges, no production data.

**Four separate mechanisms in this system**

### 1 · Endpoint overrides — point AWS clients at a local fake

```
SQS_ENDPOINT_URL      → app/session/sqs.py
KINESIS_ENDPOINT_URL  → app/session/kinesis.py
S3_ENDPOINT_URL       → app/session/s3.py
LOGS_ENDPOINT_URL     → app/session/transfer_logs.py
```

Every AWS client takes `endpoint_url` from an environment variable. Unset, it talks to real AWS. Set to a local address, it talks to **LocalStack** or similar — a local emulation of AWS services.

So the same code runs against a fake queue on your laptop and a real one in production, with no branching. A tiny amount of plumbing that removes an entire category of "works locally, breaks in prod".

The `transfer_logs.py` docstring notes a second use for the same hook: *"when set, `LOGS_ENDPOINT_URL` routes the client through the VPC (PrivateLink)"* — traffic that never leaves AWS's network.

### 2 · Configuration split

**Infisical** holds shared secrets, injected at runtime with `infisical run --`. The target environment comes from `.infisical.json`'s `defaultEnvironment` (`dev` by default). A local `.env` holds machine-specific values. Nothing sensitive is ever committed.

### 3 · The `is_test` flag

On `Interaction`. When true, **post-call events, compliance checks and analytics are skipped**. Set by the Imposter simulator and the CLI runtime. This is sandboxing *within* production: a real call through real infrastructure that doesn't pollute reporting or fire external webhooks.

### 4 · A dedicated sandbox deployment

The topology table lists `livekit-sip (self-hosted) — 1 replica — sandbox only`. A real, separate deployment for testing telephony changes without touching production SIP.

**Why four mechanisms rather than one**

They isolate different things. Endpoint overrides isolate *infrastructure*. Infisical isolates *credentials*. `is_test` isolates *side effects*. The sandbox deployment isolates *network topology*.

You need all four because the failure modes are independent: a test call that hits the real CRM is a problem even if it used a fake queue, and a test that uses production credentials is a problem even if nothing was written.

## Handling millions of calls a day
*Operating · 23*

**Start with the arithmetic, because the intuition is usually wrong**

Daily volume is not the number that sizes a system. **Peak concurrency** is.

```
concurrent_calls = calls_per_hour × avg_call_minutes / 60

1,000,000 calls/day, 3-minute average
if evenly spread:  41,667/hour → ~2,080 concurrent
but traffic peaks — assume 3× at the busy hour
                              → ~6,250 concurrent at peak
```

You size for 6,250, not for a million. And the downscaler in this system — 64 replicas by day, 4 at night — is direct evidence that traffic here is heavily peaked.

**Working the numbers with what's actually deployed**

```
64 pods (India) on m7i.4xlarge = 16 vCPU, 64 GB each

calls_per_day = pods × concurrent_per_pod
                × (86400 / avg_call_seconds)
                × utilisation

with 3-minute calls and 50% utilisation:
    pods × concurrent_per_pod × 480 × 0.5
    = pods × concurrent_per_pod × 240
```

**`concurrent_per_pod` is the number that decides everything**, and it is a measurement, not a guess. It's bounded by CPU (ASR, VAD, resampling, Krisp per call), memory, file descriptors, and vendor connection limits.

The honest answer in an interview is: *"I'd measure concurrent-calls-per-pod under load, then work backwards. Everything else follows from that one number."* Naming the formula and the measurement is worth far more than quoting a figure.

**The seven things that make the volume possible**

- **1 · Stateless, horizontally scalable pods** — Any pod handles any call. No sticky sessions. So capacity is a number you change.
- **2 · Async I/O** — A call is almost entirely waiting — on the caller, on ASR, on the LLM. `asyncio` means one process handles many concurrent calls, because waiting costs no CPU. With threads, concurrency would be capped by thread count and memory.
- **3 · Work pushed off the hot path** — Summaries, compliance, reports, webhooks — all post-call, via SQS. The call never waits for a summary LLM.
- **4 · Connection reuse** — Database pools, one WebSocket per vendor per call, and the TTS aggregation that serves many languages over one connection instead of one each.
- **5 · Shared caches** — The Vertex prompt cache lives in Redis so 64 pods share one cached prefix. Without that the saving is divided by 64.
- **6 · Capacity limits with graceful fallback** — Vendor concurrency is capped per assistant and globally, with an unlimited provider as the floor — so hitting a limit degrades the vendor choice rather than dropping the call.
- **7 · Regional isolation** — India, US and Canada run separate fleets. A regional failure is regional, and each is sized to its own traffic.

**What actually breaks first — in the order it will happen**

1. **Database connections.** 64 pods × 40 = 2,560, against a `max_connections` in the hundreds. This is the first wall, and PgBouncer is the answer.
2. **Vendor rate limits.** Your ASR provider caps concurrent streams before your pods run out of CPU. Hence the capacity module.
3. **Redis as a hotspot.** Every pod hits it for capacity, caching and pub/sub. Single-threaded, so one slow command blocks everyone.
4. **Node provisioning latency.** Karpenter takes a minute or two. A traffic spike arriving faster than that gets no capacity — which is why the downscaler is scheduled rather than reactive.
5. **The post-call backlog.** Volume arrives in a burst at end of day. If workers can't keep up, SQS depth grows — visible, recoverable, and worth alerting on.

## Interview answers
*Reference · 24*

**Q: Walk me through your infrastructure.**

"Calls come in over SIP through OpenSIPS and RTPEngine — those run on raw EC2 because SIP wants stable IPs and a wide UDP port range, which Kubernetes makes awkward. They bridge into LiveKit, which puts the call in a room.

Our voice agents run on EKS — 64 replicas in India on m7i.4xlarge nodes provisioned by Karpenter, on dedicated tainted nodes so nothing else can steal CPU mid-call. There's a scheduled downscaler to 4 replicas overnight.

State: Postgres is the source of truth, Redis does coordination, S3 holds recordings, Secrets Manager holds per-client vendor keys.

Async work: Celery over Redis for scheduled and background jobs, SQS for post-call processing, Kinesis for call status events that several systems consume independently.

I'd flag one thing — we don't use Kafka. Kinesis fills that role, because the volume doesn't justify running a cluster and the rest of the stack is already AWS."

**Q: Queue or stream — how do you choose?**

"A queue distributes work; a stream broadcasts facts.

Post-call processing goes on SQS because exactly one worker should do it, and once it's done the message should disappear. Call status events go on Kinesis because they're facts several consumers care about independently — the dialer for retry logic, analytics for reporting, potentially the customer's CRM. Each reads at its own pace, and adding a fourth consumer doesn't touch the producer.

The practical tell is: if two consumers both reading it would be a bug, it's a queue. If two consumers both reading it is the point, it's a stream."

**Q: How do you handle duplicate messages?**

"You can't prevent them — SQS is at-least-once, and exactly-once isn't achievable across a network. If you acknowledge before processing you can lose messages; if you acknowledge after, you can duplicate them. The crash can land between the two wherever you put them.

So we make processing idempotent. Each post-call step writes a timestamp marker into the interaction's metadata when it finishes, and on redelivery each step checks its own marker and short-circuits.

Three things I'd point out about that design. It's per-step, so a crash after step three means steps one to three are skipped and step four runs — partial progress survives. Post-call API calls are keyed by integration ID, so if you fire three webhooks and the second fails, the first isn't re-sent. And the markers live in the same Postgres row as the interaction, so they're transactional with it rather than in a separate store that could fall out of sync.

Then a `completed_at` marker gives an hourly reconciler a way to find calls whose pipeline never finished at all."

**Q: Tell me about a race condition you've dealt with.**

Use the capacity one — it's concrete and the fix is precise.

"Vendor connections are a metered resource shared across 64 pods, so the count lives in Redis. Admission is read the counter, check it's under the limit, increment. Between the read and the increment another pod can do the same thing — so with three pods racing at a counter of 9 against a limit of 10, all three read 9, all three see themselves as under the limit, and all three increment. You breach the cap by the number of racing pods, and it happens precisely during a traffic spike, when the cap matters most.

The fix is a Lua script. Redis runs a script as one indivisible command, so read-check-increment becomes atomic and the race is structurally impossible.

Two related details. ASR and TTS share one copy of that script with a service discriminator, because two copies drifting apart would reintroduce exactly the bug. And there's a known limitation documented in the code — counters have no per-call identity, so a pod killed by SIGKILL leaves its increment stranded. I'd fix that with a set of call IDs carrying TTLs instead of a bare counter."

**Q: How would you scale this to a million calls a day?**

"First I'd reframe the number — daily volume doesn't size a system, peak concurrency does. A million calls a day at a three-minute average is about 2,000 concurrent if evenly spread, but traffic peaks, so maybe three times that at the busy hour. You size for the peak.

Then the only number that matters is concurrent calls per pod, and that's a measurement rather than a guess — bounded by CPU for ASR and audio processing, by memory, and by vendor connection limits. Everything else is arithmetic from there.

On what would break first: database connections. Sixty-four pods times a pool of forty is 2,560 connections against a Postgres `max_connections` in the hundreds. PgBouncer before anything else. Then vendor rate limits, which is what the capacity module already handles. Then Redis becoming a hotspot, since it's single-threaded and every pod depends on it.

And I'd note that node provisioning takes a minute or two, which is why scaling here is scheduled rather than reactive — a call arriving now can't wait for a node to boot."

**Q: Why isn't everything on Kubernetes?**

"The SIP layer isn't, deliberately. OpenSIPS and RTPEngine need stable IPs because carriers whitelist them, a huge UDP port range — RTPEngine uses 10000 to 60000 — and host networking for media performance. Kubernetes makes all three awkward, and there's no benefit to fighting it for two servers that rarely change.

They get HA a different way: Keepalived across a pair of EC2 instances, with a floating IP.

Everything that *is* a good fit for containers — stateless, horizontally scalable, frequently deployed — runs on EKS. It's not dogma either way; it's matching the platform to what the workload actually needs."

## Glossary
*Reference · 25*

- **Distributed system** — Work spread across machines that coordinate over a network and fail independently.
- **EC2** — AWS virtual machines.
- **Instance type** — `m7i.4xlarge` — family, generation, processor, size.
- **Container** — App plus dependencies, sharing the host kernel.
- **Pod** — Kubernetes' scheduling unit, usually one container.
- **Node** — A machine running pods. Here an EC2 instance.
- **Deployment** — Keep N interchangeable pods running.
- **StatefulSet** — Pods with stable identities across restarts.
- **CronJob** — Scheduled pod. `Forbid` prevents overlapping runs.
- **Taint / toleration** — Reserve nodes for specific workloads.
- **EKS** — AWS-managed Kubernetes control plane.
- **Karpenter** — Provisions right-sized nodes on demand.
- **HPA** — Scales pod count; distinct from node scaling.
- **Spot instance** — Cheap, reclaimable. Wrong for live calls.
- **ACID** — Transaction guarantees: all-or-nothing, isolated, durable.
- **Connection pool** — Reused database connections. Per process — multiply by replicas.
- **PgBouncer** — External pooler multiplexing many clients onto few connections.
- **Redis** — In-memory store; single-threaded, hence naturally atomic.
- **Lua script** — Runs atomically in Redis. Fixes read-modify-write races.
- **Pub/sub** — Publish to a channel; live subscribers receive it.
- **TTL** — Expiry. Used as a failure detector for dead pods.
- **S3** — Object storage. Cheap, durable, no partial writes.
- **Presigned URL** — Temporary access to one object.
- **Secrets Manager** — Encrypted, IAM-controlled credential storage.
- **Queue** — Distributes work; one consumer per message.
- **Stream** — Broadcasts facts; many independent consumers, replayable.
- **Celery** — Python task queue. Broker here is Redis.
- **Celery Beat** — Scheduler. Single point of failure by design.
- **Prefetch multiplier** — Tasks a worker grabs at once. Set to 1 for long tasks.
- **SQS** — Managed queue. At-least-once.
- **Visibility timeout** — Invisible-but-not-deleted window. The reliability mechanism.
- **Long polling** — Hold the request open rather than polling.
- **Dead-letter queue** — Quarantine for repeatedly failing messages.
- **Kinesis** — Managed event stream. Sharded, ordered per shard.
- **Shard / partition key** — Throughput unit; the key that chooses it and fixes ordering.
- **Kafka** — Self-run distributed log. Not used here.
- **At-least-once** — Nothing lost, duplicates possible. What you actually get.
- **Idempotent** — Safe to do twice.
- **Marker** — A recorded timestamp proving a step already ran.
- **Reconciler** — Periodic sweep for work that never completed.
- **Race condition** — Outcome depends on timing. Fix by atomicity, retry, or single-threading.
- **Graceful shutdown** — What you do between SIGTERM and SIGKILL.
- **LocalStack** — Local AWS emulation, reached via endpoint overrides.
- **Infisical** — Runtime secret injection.
- **is_test** — Flag suppressing post-call side effects for simulated calls.

---

*Written from `app/session/`, `app/background/`, `app/runtime/voice/utils/capacity.py` and `docs/architecture/sip-ingress-architecture.md`. Replica counts and instance types are from that document and change over time.*
*Companion documents: anatomy of a call · voice runtime from zero · telephony · CI/CD and containers · NLP stack · inside a language model · retrieval end to end · the LangChain stack · Vasco stack.*
