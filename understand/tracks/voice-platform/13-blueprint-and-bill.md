# Blueprint and Bill

**Topic:** System design
**Covers:** What system design is, a six-step method, and cost optimisation
**Source:** [Claude artifact](https://claude.ai/artifact/2owxhpXyLBdYS4K3vQS6SS) — written by a colleague, mirrored here for study.

definitions · method · this system · the bill

What system design actually means, a repeatable method for doing it, that method applied step by step to this voice platform — and then cost optimisation as a discipline, with the arithmetic worked out.

#### Why these two topics belong together

A design that ignores cost isn't a design, it's a diagram. Every architectural choice in this system — self-hosting TTS, caching prompts, capping vendor concurrency, downscaling overnight — is simultaneously a *design* decision and a *cost* decision.

Interviewers ask them together too. "How would you scale this?" and "how would you make it cheaper?" have the same shape: find the dominant term, then change it.

## What system design is

#### Definition

**System design** is deciding how the parts of a software system are arranged: what components exist, what each is responsible for, how they communicate, where data lives, and how the whole thing behaves when something fails or when load increases tenfold.

It sits above code and below product. Product decides *what* to build; system design decides *the shape* of what gets built; code fills the shape in.

#### The thing that makes it hard: there is no correct answer

Unlike an algorithm question, a design question has **no optimum**. Every choice buys something and pays for it somewhere else.

```
add a cache        →  faster reads, but now data can be stale
add a queue        →  survives spikes, but now processing is async
add a replica      →  survives failure, but now you need consensus
split into two     →  independent scaling, but a network hop appears
```

**System design is therefore the practice of choosing trade-offs deliberately, and being able to say why.** An interviewer is not checking whether you produced the right diagram. They're checking whether you know what each line on it costs.

#### What a design must actually answer

1. **What are the components**, and what is each one responsible for?
2. **How do they talk** — synchronous call, queue, stream, shared database?
3. **Where does state live**, and who is allowed to write it?
4. **What happens when a part fails?** Does the system degrade or stop?
5. **What happens at 10× load?** What breaks first?
6. **What does it cost**, and what does the cost scale with?

A design that answers all six is a real design. One that answers only the first two is a boxes-and-arrows drawing.

## The vocabulary

#### Requirements — two kinds, and the second is where design happens

**Functional requirements**
What the system *does*. "Answer inbound calls." "Transfer to a human." These determine the components.

**Non-functional requirements**
How well it must do it. Latency, availability, throughput, cost, compliance. **These determine the architecture.**

Example: "answer phone calls" tells you almost nothing. "Answer phone calls with under 1.5 seconds of response latency, at 99.9% availability, in three regions, for 500 concurrent callers" tells you nearly everything — that's the design, expressed as constraints.

**In an interview, the non-functional requirements are what you must elicit.** Candidates who start drawing before asking about scale and latency are designing for imaginary constraints.

#### Latency and throughput — different things, often confused

**Latency**
How long one operation takes. Measured in time.

**Throughput**
How many operations per unit time. Measured in rate.

They are not inverses. Batching *increases* throughput and *increases* latency simultaneously — you wait to fill the batch. Every GPU serving decision is a point on that trade.

**Always quote latency as percentiles, never as a mean.** A p50 of 900 ms with a p95 of 4 seconds is a bad experience that an average of 1.1 s hides completely. p95 and p99 are where the users who churn live.

#### Availability, SLI, SLO, SLA

**SLI**
Service Level *Indicator* — a thing you measure. "Fraction of calls answered within 2 seconds."

**SLO**
Service Level *Objective* — your internal target for that indicator. "99.5%."

**SLA**
Service Level *Agreement* — a contractual promise, with a penalty. Always looser than your SLO, because you want warning before you owe money.

```
availability   downtime per year   per month
99%     "two nines"    3.65 days        7.2 hours
99.9%   "three nines"  8.77 hours       43 minutes
99.99%  "four nines"   52 minutes       4.3 minutes
```

Each extra nine costs roughly an order of magnitude more. **Knowing which nine you actually need is a design decision**, and over-specifying it is a common and expensive mistake.

#### Scaling — two directions

**Vertical**
A bigger machine. Simple, no code changes, and it hits a ceiling. Also a single point of failure.

**Horizontal**
More machines. Effectively unbounded, and it requires the work to be *partitionable* and the components *stateless*.

**"Stateless" is the enabler.** If any pod can handle any call, capacity is a number you change. If a pod holds state a specific caller needs, you need sticky routing, and scaling gets much harder. That's why per-call state in this system lives entirely inside the call, and shared state lives in Redis.

#### Consistency and the CAP framing

When data is replicated across machines and the network between them breaks, you must choose: keep serving with possibly-stale data (**availability**), or refuse to serve (**consistency**). You cannot have both during a partition — that's CAP.

In practice it's a spectrum, and different data in the same system sits at different points:

```
payment recorded     → must be consistent. Refuse rather than guess.
call transcript      → eventual is fine. A second late is invisible.
capacity counter     → must be atomic, hence the Lua script.
cached TTS audio     → stale is fine; it's regenerable.
```

**Recognising that different data needs different guarantees is the mature version of this answer**, and much better than reciting the theorem.

#### Coupling

**Tight coupling**: A calls B directly and waits. If B is down, A is down. Simple and fragile.

**Loose coupling**: A puts a message on a queue; B reads it whenever. B can be down for ten minutes and nothing user-facing fails. More resilient, harder to reason about, and now you have delivery semantics to worry about.

The rule this system follows: **tight coupling on the live path, loose coupling everywhere else.** The call can't wait for a queue; post-call processing absolutely can.

## The six-step method

#### A repeatable order — use it for real design and for interviews

```
1  Requirements       what must it do, and how well?
2  Estimation         how big is this, numerically?
3  High-level design   the boxes and the arrows
4  Deep dive           the two or three genuinely hard parts
5  Bottlenecks         what breaks first, and at what load?
6  Trade-offs          what did I give up, and why?
```

Most candidates jump straight to step 3 and stay there. **Steps 1, 2 and 6 are what separate a senior answer from a junior one**, because they're where judgement lives — anyone can draw boxes.

#### Why estimation before design

Because the numbers choose the architecture. A system serving 10 requests a second and one serving 100,000 are not the same system, and you cannot know which you're designing until you multiply something out.

It also stops over-engineering. If the estimate says one database handles it comfortably, proposing sharding is a mistake — and doing the arithmetic is how you know.

## Step 1 — Requirements

**FUNCTIONAL** — What it must do

- Answer inbound phone calls and place outbound ones.
- Hold a spoken conversation: listen, understand, decide, speak.
- Follow a configured conversation flow with required steps in required order.
- Call external APIs mid-conversation and act on the results.
- Transfer to a human, or hang up.
- Record the call and persist the transcript.
- Support multiple languages, including switching mid-call.
- Serve many tenants from one deployment, isolated from each other.
- Let non-engineers configure assistants without a deploy.
- Run post-call work: summary, compliance audit, webhooks, reports.

**NON-FUNCTIONAL** — How well — this is where the architecture is decided

| Requirement | Target | What it forces |
|---|---|---|
| **Response latency** | < 1.5 s p95, caller stops → bot starts | Streaming everywhere; no stage may wait for the previous to finish |
| **Availability** | Very high — a dropped call is a lost customer | Multiple providers per stage, automatic failover, graceful degradation |
| **Concurrency** | Hundreds to thousands of simultaneous calls at peak | Horizontal scale; stateless pods; async I/O |
| **Traffic shape** | Heavily peaked to business hours | Scheduled scaling, because reactive scaling is too slow |
| **Compliance** | Required disclosures; auditable | Flow-based control, not free-form agents; disposition tracking |
| **Tenant isolation** | Strict | `client_id` on everything; per-client credentials |
| **Cost per call** | Must beat a human agent by a wide margin | Caching, self-hosting, capacity caps |
| **Configurability** | Change behaviour without deploying | Config in the database, resolved at call time |

#### The one requirement that dominates everything else

**Sub-1.5-second response latency on a live phone call.**

Every other choice bends around it. It's why the pipeline streams rather than batches, why TTS starts at the first sentence rather than the last token, why endpointing gets a dedicated model, why filler words exist, why post-call work is on a queue, why scaling is scheduled rather than reactive, and why voice pods get dedicated untainted nodes.

**Being able to name the dominant constraint and trace decisions back to it is the strongest thing you can do in a design discussion.**

## Step 2 — Capacity estimation

#### The method: work in the unit the system is sized by

For a voice system that unit is **peak concurrent calls**, not calls per day. Daily volume is a business number; concurrency is an engineering one.

```
concurrent = (calls_per_hour × avg_call_minutes) / 60
```

#### Worked from a target of one million calls a day

```
1,000,000 calls/day, 3-minute average

evenly spread:   1,000,000 / 24        = 41,667 calls/hour
                 41,667 × 3 / 60       = ~2,080 concurrent

but traffic is peaked. assume 3× at the busy hour:
                                       = ~6,250 concurrent at peak
```

**You size for 6,250, not for a million.** That single reframing is most of the value of the estimation step.

And the peak assumption isn't invented here — the fleet downscales from 64 replicas to 4 overnight, which is direct evidence that daytime traffic is many times the overnight baseline.

#### From concurrency to fleet size

```
pods_needed = peak_concurrent / concurrent_per_pod

concurrent_per_pod is bounded by:
   CPU        ASR, VAD, resampling, noise suppression per call
   memory     per-call buffers and context
   file descriptors / sockets   several vendor connections per call
   vendor concurrency limits    often the real ceiling
```

**`concurrent_per_pod` is a measurement, not a guess.** Load-test it. Everything else in the sizing is arithmetic once you have it.

#### The other quantities worth estimating

```
audio storage
  3 min × 8 kHz × 16-bit × 2 channels
  = 180 s × 8000 × 2 bytes × 2  ≈ 5.8 MB/call raw
  1M calls/day → several TB/day raw, so compress and set a retention policy

database writes
  ~20 turns/call × 1M calls = 20M row inserts/day  ≈ 230/s average,
  and several times that at peak

LLM tokens
  4,000-token prompt × 20 turns = 80,000 input tokens/call uncached
  1M calls → 80 billion input tokens/day
  ← this number is why prompt caching exists

database connections
  64 pods × 40 pool  = 2,560 from the voice fleet alone
  ← against a max_connections in the low hundreds. First wall.
```

#### Two of those estimates directly produced features

The token number is the entire justification for prompt caching. The connection number is the entire justification for putting PgBouncer on the roadmap.

**That's what estimation is for** — not to be precise, but to reveal which quantity is about to become the problem. Being an order of magnitude out is fine; not doing it at all is not.

## Step 3 — High-level design

```
  PSTN ──SIP──►  OpenSIPS + RTPEngine        raw EC2, stable IPs
                        │                     wide UDP range
                        ▼
                 LiveKit (rooms, SIP bridge)
                        │ WebRTC
   ┌────────────────────▼──────────────────────────────┐
   │  EKS cluster                                       │
   │                                                    │
   │   voice runtime  ×64   ← dedicated tainted nodes   │
   │   interface API        ← REST, config              │
   │   text runtime         ← SMS / chat                │
   │   celery workers       ← scheduled + background    │
   │   post-call worker     ← SQS consumer              │
   │   reconciler CronJob   ← hourly sweep              │
   └───┬──────────┬───────────┬─────────────┬───────────┘
       │          │           │             │
   Postgres    Redis      SQS/Kinesis    S3 / Secrets
   (truth)  (coordination) (async)      (blobs/creds)
       │
   external vendors: ASR · LLM · TTS · customer APIs
```

#### Why each boundary is where it is

**SIP on raw EC2, not Kubernetes**
Carriers whitelist IPs, RTPEngine needs ports 10000–60000, media wants host networking. Kubernetes fights all three. HA comes from Keepalived instead.

**LiveKit as the media layer**
WebRTC, jitter buffering, NAT traversal and SIP bridging are a large amount of undifferentiated work. Buying it is the right call.

**Voice runtime separate from the API**
Completely different profiles — long-lived stateful sessions versus short stateless requests. Separate deployments scale independently, and a traffic spike on one can't starve the other.

**Post-call work behind SQS**
Summaries and webhooks are slow and must not be on the call's critical path. Loose coupling exactly where latency doesn't matter.

**Redis for coordination, Postgres for truth**
Capacity counters and caches need microsecond shared access; durable facts need transactions. Different jobs, different stores.

**Config in the database**
The whole product depends on non-engineers changing behaviour without a deploy. It's why `ServiceFactory` exists and why no vendor name appears in pipeline code.

## Step 4 — Deep dives

Four parts are genuinely hard. In an interview, these are what you'd go deep on.

#### A — Real-time media is not request/response

**The problem.** Normal backend thinking — receive request, process, respond — doesn't apply. Audio arrives continuously at 8 kHz whether you're ready or not, and late audio is worse than missing audio.

**The design.** A frame pipeline. Typed messages flow through ordered processors; urgent signals are a frame class that jumps the queue. Every stage streams, so stage *n+1* starts on partial output from stage *n*.

**The consequence.** Anything that blocks the pipeline is audible. A slow processor isn't a performance issue, it's a stutter on someone's phone call — which is why the recorder's S3 upload runs at cleanup, why the TTS cache put is a background task during playback, and why blocking clients are wrapped in `asyncio.to_thread`.

#### B — Calls are stateful and long-lived

**The problem.** A pod holding thirty live calls cannot be killed like a stateless web pod. There's no retry — the caller is on the line.

**The design.** Dedicated tainted nodes so nothing else can steal CPU. On-demand instances rather than spot, because two minutes' reclamation notice would drop every call on the node. Deploys roll slowly. Downscaling is scheduled for off-peak. Graceful shutdown stops accepting new calls and drains.

**The trade-off, stated plainly.** You pay for idle capacity and give up spot pricing. That's the cost of not dropping calls, and it's the right purchase.

#### C — Every critical path depends on a third party

**The problem.** ASR, LLM and TTS are all external. Any of them can be slow, error, rate-limit, or change behaviour without warning — and there is no local fallback that produces speech.

**The design** — four layers:

- **Abstraction.** `ServiceFactory` builds services from config, so no vendor name is in the pipeline. Swapping is a database row.
- **Multiple providers configured per language**, with priority ordering.
- **Automatic failover.** The latency switcher moves off a degraded LLM mid-call after consecutive slow turns; an errored service is swapped unconditionally.
- **Capacity limits with a floor.** Concurrency is capped per assistant and globally, but every language must have an unlimited provider — so hitting a cap degrades the vendor choice rather than dropping the call.

**The principle:** degrade the quality of service before you degrade the availability of service.

#### D — Multi-tenancy with per-tenant everything

**The problem.** One deployment serves many clients, each with their own assistants, prompts, voices, integrations — and sometimes their own vendor accounts. A leak between tenants is a serious incident.

**The design.** `client_id` on every model and every query. Per-client credentials in Secrets Manager under a structured name. Capacity counters keyed per assistant so one tenant can't consume the shared quota. The TTS cache key is prefixed `{client}/{assistant}/` so audio can never cross tenants and can be invalidated per assistant.

**The failure mode to design against:** a missing filter. Isolation enforced only in the query layer means one forgotten `WHERE` is a data leak — which is why it's a stated codebase rule rather than a convention.

## Step 5 — Bottlenecks

#### What breaks first, in order

1. **Database connections.** 64 pods × 40 = 2,560 against a `max_connections` in the hundreds. Fix: PgBouncer.
2. **Vendor rate limits.** Your ASR provider caps concurrent streams before your CPUs saturate. Fix: the capacity module, already built.
3. **Redis as a hotspot.** Every pod hits it for capacity, caching and pub/sub, and it's single-threaded — one slow command blocks everyone. Fix: separate instances by purpose, avoid expensive commands.
4. **Node provisioning latency.** Karpenter takes minutes; a spike arriving faster gets nothing. Fix: scheduled pre-scaling, which is what's already done.
5. **Post-call backlog.** Volume arrives in an end-of-day burst. Visible as SQS depth, recoverable, alertable.
6. **Postgres write throughput** on turn inserts. Later, but real. Fix: batch inserts, then partition by date.

#### Failure modes and how the system responds

| Failure | Blast radius | Response |
|---|---|---|
| One pod dies | Its live calls drop | Kubernetes reschedules; new calls unaffected |
| An LLM vendor slows | Latency on affected calls | Automatic switch after consecutive strikes |
| A TTS vendor errors | That language | Fallback provider from capacity resolution |
| Redis down | Degraded, not broken | Capacity resolves without Redis; caches miss |
| Postgres down | **Severe** | No config load, no new calls. The real SPOF |
| SQS backed up | Post-call delayed | Nothing user-facing; reconciler catches stragglers |
| LiveKit outage | **Total for that region** | Vendor dependency; regional isolation limits it |

**Naming your own single points of failure is a strength, not an admission.** Postgres and the media layer are the two here, and both are conscious choices with known mitigations.

## Step 6 — Trade-offs

#### Every choice, and what it cost

| Chose | Gained | Gave up |
|---|---|---|
| Flow engine over a free-form agent | Auditability, compliance guarantees, predictable cost | Naturalness; unanticipated cases fall to fallbacks |
| Managed media (LiveKit) | Enormous amount of undifferentiated work avoided | A hard vendor dependency on the critical path |
| Raw EC2 for SIP | Stable IPs, port ranges, host networking | Manual ops; separate HA story |
| Parallel ASR branches with gates | Instant language switching, no reconnect | Paying every vendor for the whole call |
| Config in the database | Non-engineers change behaviour; no deploy | Runtime failure modes from bad config |
| Self-hosted TTS | Large cost reduction, control, more languages | Operational burden; cold starts to design around |
| Scheduled scaling | Capacity exists before the traffic does | Paying for idle outside the peak |
| At-least-once post-call | Nothing lost on crash | Every step must be idempotent |
| One Postgres as truth | Transactions, simplicity, one system | A single point of failure and a write ceiling |

#### The one worth defending out loud

**Parallel ASR branches** looks wasteful — you transcribe every language for the whole call and throw most of it away.

The alternative is reconnecting on a language switch, which costs a handshake plus the vendor's decoder warm-up mid-conversation. On a live call that's a visible stall at exactly the moment the caller has just switched language and is least tolerant of one.

**The trade is money for latency, and latency is the dominant constraint.** That's the answer — and note it also names the mitigation that already exists: capacity limits keep the wasted spend bounded.

## What cost optimisation is

#### Definition

**Cost optimisation** is reducing what the system costs to run *per unit of value it delivers*, without breaking the requirements it was built for.

Note both halves. Reducing spend by degrading the product is not optimisation, it's a cut. And reducing *total* spend while volume falls isn't optimisation either — which is why the unit matters.

#### Why it's a design discipline, not a finance one

You cannot optimise a cost you don't understand structurally. "The AWS bill is too high" is not actionable. "TTS is 40% of variable cost and 80% of our TTS characters are fixed phrases" is a plan.

Every real cost reduction in this system came from an architectural insight:

- *The system prompt is re-sent every turn* → prompt caching.
- *The bot says the same sentences all day* → TTS caching.
- *Managed TTS is priced per character, GPUs are priced per hour* → self-hosting above a break-even.
- *Traffic is peaked* → scheduled downscaling.

Each is an observation about *structure* first and a saving second.

## Unit economics

#### Definition

**Unit economics** is the cost and revenue of one unit of the thing you sell. Here the unit is **one call**.

```
contribution per call = price per call − variable cost per call
```

If that's negative, growth makes things worse — every additional call loses money. If it's positive, fixed costs are amortised as volume grows and the business improves with scale.

#### Fixed versus variable — and why the distinction drives everything

| | Fixed | Variable |
|---|---|---|
| Definition | Doesn't change with volume | Scales with usage |
| Examples here | Baseline pods, Postgres, Redis, warm GPU floor | ASR minutes, LLM tokens, TTS characters, telephony |
| Reduce by | Right-sizing, downscaling, consolidating | Caching, cheaper vendors, sending less |
| Matters when | Volume is low — fixed cost dominates | Volume is high — variable cost dominates |

**Self-hosting converts variable cost into fixed cost.** That's the whole trade, and it's why it only pays above a break-even volume:

```
break-even = fixed_self_hosted_cost / variable_unit_price

below it → you pay for idle GPUs
above it → every extra call is essentially free
```

## The cost model

#### What one call costs

```
cost_per_call =
      telephony      per minute
    + ASR            per audio minute        ← includes silence
    + LLM input      per token × turns       ← the multiplication
    + LLM output     per token (dearer)
    + TTS            per character or second
    + compute        pods × hourly / calls handled
    + storage        recording + transcript + retention
    + post-call      summary LLM, webhooks
    + platform       Redis, Postgres, queues, amortised
```

#### The two multiplications that surprise people

**1 · The prompt is re-sent every turn.** There's no server-side memory, so a 4,000-token system prompt on a 20-turn call is 80,000 input tokens — for text that never changed. Across a million calls a day that's 80 billion tokens of pure repetition.

**2 · ASR bills silence.** It's priced per audio *minute*, and a three-minute call contains a lot of pauses, thinking time and hold music. VAD gating is a direct cost lever, not just a quality one.

#### Where compute cost actually comes from

```
pod-hours are fixed; cost per call depends on UTILISATION

64 pods × 24 h × hourly rate = fixed daily compute
÷ calls handled that day     = compute cost per call
```

So compute cost per call falls as volume rises — until you add pods. And the overnight downscale from 64 to 4 exists precisely because those hours would otherwise be fixed cost divided by almost no calls.

## The levers, ranked

#### Ranked by saving per unit of effort and risk

| # | Lever | Target | Risk |
|---|---|---|---|
| 1 | **TTS caching** | Repeated phrases | Very low — audio is regenerable |
| 2 | **Prompt caching** | The invariant prompt half | Low — behaviour unchanged |
| 3 | **Scheduled downscaling** | Off-peak compute | Low, if the schedule matches traffic |
| 4 | **VAD gating of ASR** | Billed silence | Low |
| 5 | **Hybrid NLU** — classifier first, LLM for the tail | LLM calls per turn | Medium — needs measurement |
| 6 | **Model migration** after benchmarking | Token price | Medium — quality must be verified |
| 7 | **Self-hosting** | Vendor unit price | Higher — permanent ops burden |
| 8 | **Prompt trimming** | Tokens per turn | Medium — the prompt has a job |
| 9 | **Shorter calls** | Everything at once | Product decision, biggest lever of all |

#### Why caching ranks above everything

Caching is the only lever that **changes nothing about behaviour**. The audio is identical, the model's input is identical, the caller's experience is identical or better. There is no quality trade to evaluate and no rollback risk.

Every other lever requires you to verify you haven't broken something. Do the free ones first.

#### And the honest #9

**Shortening the average call reduces every cost line simultaneously** — telephony minutes, ASR minutes, LLM turns, TTS characters, and pod-seconds. Nothing in the infrastructure comes close.

A flow that resolves in 6 turns instead of 9 is a ~33% cut across the board. That's a conversation-design change, not an engineering one — which is exactly why engineers forget it.

Raising it in an interview is a strong move, because it shows you're optimising the *system* rather than defending your layer of it.

## Finding the money

#### The procedure

1. **Attribute cost per call, per stage.** Not a monthly total — a per-call breakdown. Vendor invoices plus usage metrics; the metrics observer already labels TTFB and requests by vendor, which is the hook.
2. **Rank the stages.** One or two will dominate. Optimising anything else is wasted effort.
3. **Find the structure inside the dominant one.** Not "TTS is expensive" but "80% of TTS characters come from 20 fixed phrases" — that's what points at caching.
4. **Estimate the saving before building.** Multiply out. If the ceiling is 3%, don't.
5. **Change one thing and measure.** Two at once and you learn nothing about either.
6. **Watch for the cost moving rather than falling.** Cutting LLM tokens by making the bot terser can lengthen calls, and lengthen every other line.

#### Three traps

- **Optimising the small term.** A 50% cut in something that's 3% of the bill is 1.5%. Rank first.
- **Ignoring engineering cost.** Two engineer-weeks is real money. A saving that takes six months to repay may not be worth the opportunity cost.
- **Cutting into a requirement.** Saving on TTS by choosing a vendor with 700 ms TTFB breaks the latency budget. The cheapest system that fails its requirements costs infinity.

## Cost, latency, quality

#### You can usually have two

```
              QUALITY
                 ╱╲
                ╱  ╲
               ╱    ╲
              ╱      ╲
        COST ╱────────╲ LATENCY
```

| Move | Cost | Latency | Quality |
|---|---|---|---|
| Smaller LLM | ↓↓ | ↓ | ↓ |
| Prompt caching | ↓↓ | ↓ | = |
| TTS caching | ↓↓ | ↓↓ | = |
| Trim the prompt | ↓ | ↓ | ↓ maybe |
| Self-host | ↓↓ | = or ↓ | = |
| Fewer TTS vendors warm | ↓ | ↑ | = |
| Scale to zero overnight | ↓↓ | ↑↑ | = |
| Bigger LLM | ↑↑ | ↑ | ↑ |

#### The two rows that break the triangle

**Caching improves cost and latency with no quality cost.** Both rows. That is genuinely rare, and it's why caching is always the first thing to do — it isn't a trade at all.

Everything else on that table is a real choice, and the right one depends on which constraint is binding. Here latency is dominant, so anything with an ↑ in the latency column needs a strong justification.

## A worked example

#### The setup — illustrative numbers, real structure

These figures are made up to show the *method*; the shape is what matters, not the values.

```
one call:  3 minutes, 20 turns, 4,000-token system prompt

                              per call     share
  telephony                    ₹0.90        12%
  ASR (3 min)                  ₹1.20        16%
  LLM input  (80k tokens)      ₹2.40        32%   ← biggest
  LLM output (3k tokens)       ₹0.60         8%
  TTS (4,500 chars)            ₹1.80        24%   ← second
  compute                      ₹0.45         6%
  storage + post-call          ₹0.15         2%
  ────────────────────────────────────────────
  TOTAL                        ₹7.50       100%
```

**Ranking says: work on LLM input and TTS. Together they're 56%.** Optimising storage would be pointless.

#### Applying the top three levers

```
1 · PROMPT CACHING
    80,000 input tokens/call, of which the 4,000-token prompt
    repeated 20 times = 80,000 — nearly all of it.
    Cache the static half; suppose 85% of input tokens become
    cached at a large discount.
        LLM input  ₹2.40 → ₹0.70          saves ₹1.70

2 · TTS CACHING
    Suppose 55% of characters are fixed phrases and hit cache.
        TTS        ₹1.80 → ₹0.81          saves ₹0.99

3 · SELF-HOSTED TTS on the remaining 45%
    Suppose the self-hosted path runs at ~30% of managed price.
        TTS        ₹0.81 → ₹0.24          saves ₹0.57
    ──────────────────────────────────────────────────
    NEW TOTAL      ₹7.50 → ₹4.24          −43%
```

#### Three things to say about that number

**The order was chosen deliberately.** Caching first, because it has no quality risk and no ongoing cost. Self-hosting last, because it adds a permanent operational burden — and note it's applied to the *residual* after caching, so the GPU serves 45% of the volume it otherwise would. *Caching first also shrinks the self-hosting case*, and that's a real interaction worth noticing.

**The figure excludes engineering time.** Building the prompt split, the two-tier cache and the persistent-socket TTS client is real work with an ongoing maintenance tail. At high volume it repays quickly; at low volume it wouldn't.

**Latency improved too.** Cached prompts skip most of prefill; cached TTS skips synthesis entirely. This is the rare case where the cost work makes the product better rather than worse — which is exactly why it ranks first.

## Running a system design interview

#### The structure, with timings for a 45-minute round

```
 0–5    REQUIREMENTS      ask, don't assume. Scale? Latency? Users?
 5–10   ESTIMATION        multiply something out loud
10–20   HIGH-LEVEL        boxes and arrows, explain each one
20–35   DEEP DIVE         let them pick, or offer the hard part
35–42   BOTTLENECKS       what breaks first, at what load
42–45   TRADE-OFFS        what you gave up and why
```

#### The five things that separate strong candidates

1. **They ask before drawing.** Scale, latency, consistency, users. Designing without constraints is designing for imaginary ones.
2. **They do arithmetic out loud.** Even rough. It shows the design is grounded and it directs everything after.
3. **They name trade-offs unprompted.** "I'm choosing X, which costs me Y — here's why that's the right trade."
4. **They start simple and add.** Simplest thing that meets the requirements, *then* address bottlenecks. Leading with microservices and sharding for 100 users is a red flag.
5. **They say what they don't know.** "I'd need to measure concurrent calls per pod" is far stronger than an invented number.

#### The five failure modes

- Drawing immediately, with no requirements.
- Buzzword architecture — Kafka, microservices, sharding — with no justification.
- Never mentioning failure. Every component you draw will fail.
- Refusing to commit. "It depends" without then choosing is not an answer.
- Ignoring cost entirely. It is a first-class constraint.

## Interview answers

**Q: Design a voice AI platform.**

Run the method out loud. Don't draw first.

"Before I design anything — what scale? Calls per day and expected concurrency at peak. What's the latency target for a response? Is this regulated, so certain steps must be guaranteed? Single tenant or many?

Assuming a million calls a day at three minutes: evenly spread that's about 2,000 concurrent, but traffic peaks, so call it 6,000 at the busy hour. I'd size for 6,000, not for a million — and the number I'd actually need to measure is concurrent calls per pod.

The dominant constraint is sub-1.5-second response on a live call, and almost every decision follows from it. The pipeline has to stream at every stage rather than batch. TTS starts at the first complete sentence, not the last token. Endpointing needs its own model, because a fixed silence threshold either cuts people off or adds a second to every turn.

High level: telephony bridges into a managed media layer; stateless voice pods on Kubernetes with dedicated nodes; Postgres as truth, Redis for coordination, a queue for post-call work so summaries never sit on the critical path.

The hard parts I'd go deep on are real-time media not being request/response, the fact that pods hold long-lived state so they can't be killed casually, and total dependency on third-party ASR, LLM and TTS — which is why every stage needs multiple providers and automatic failover."

**Q: How would you reduce the cost of this system?**

"First I'd attribute cost per call by stage rather than looking at a monthly total, and rank. Typically LLM input tokens and TTS dominate; whatever's third isn't worth touching yet.

Then I'd look for structure inside the dominant term. For LLM input, the structure is that the system prompt is re-sent every turn — a 4,000-token prompt over 20 turns is 80,000 input tokens for text that never changed. That points at prompt caching. For TTS, the structure is that a bot says the same greetings and disclosures thousands of times a day, which points at caching the audio.

I'd do the caching first, deliberately, because it's the only lever that changes nothing about behaviour — same audio, same model input, so there's no quality risk to evaluate. It also improves latency, which is rare; most cost work makes the product worse.

Self-hosting comes last, because it converts variable cost to fixed and adds a permanent operational burden. And note the interaction: doing caching first shrinks the volume the self-hosted path has to serve, which changes the break-even.

The lever I'd raise that isn't engineering: shortening the average call cuts every line at once. A flow resolving in six turns instead of nine is a third off everything."

**Q: What's the difference between cost optimisation and just cutting spend?**

"Optimisation reduces cost per unit of value without breaking the requirements. Cutting reduces spend and hopes nothing important was attached to it.

The concrete version here: switching to a TTS vendor that's 40% cheaper but has 700 milliseconds of time-to-first-byte would reduce the bill and break the latency budget. That's not an optimisation — the cheapest system that fails its requirements costs infinity, because it doesn't do the job.

The test I'd apply is whether the requirement still holds afterwards. Caching passes trivially, because behaviour is identical. Switching to a smaller model doesn't pass automatically — you'd need to benchmark instruction-following, not just token price."

**Q: What's the biggest trade-off in your architecture?**

"Flow engine versus free-form agent.

An LLM deciding every turn is far more natural, handles digressions gracefully, and needs no flow maintenance. We use an explicit flow instead, and the reason is that in a regulated call you have to *guarantee* certain things — a disclosure read before a payment is taken. 'The model usually does it' isn't an acceptable answer to a compliance team. A prompt instruction is a request; a graph edge is a guarantee.

What we give up is real: anything the designer didn't anticipate falls through to a fallback, and large flows get hard to maintain.

The resolution is a flow for the spine and an LLM for the flesh — the flow enforces the required steps in the required order, and within a node the model handles phrasing and digression. You get the auditability of a state machine and most of the naturalness of an agent.

The secondary reasons are latency and cost, since an LLM deciding every turn adds hundreds of milliseconds to a budget that's already tight."

**Q: What breaks first at 10× load?**

"Database connections, and it's arithmetic rather than a guess. Sixty-four pods with a pool of forty is 2,560 connections; Postgres defaults to a `max_connections` in the low hundreds. Pool sizes are per process, and horizontal scaling multiplies them. PgBouncer before anything else — before read replicas, before sharding.

Second is vendor rate limits. Your ASR provider caps concurrent streams before your CPUs saturate, which is why concurrency is tracked in Redis with an atomic admission script and every language has an unlimited provider as a floor.

Third is Redis becoming a hotspot — it's single-threaded and every pod depends on it, so one expensive command blocks everyone.

And a structural one: node provisioning takes minutes, so you can't scale reactively into a spike. That's why scaling here is scheduled — capacity has to exist before the traffic does."

## Glossary

**System design** — Deciding components, communication, state and failure behaviour.

**Functional requirement** — What the system does. Determines components.

**Non-functional requirement** — How well. Determines architecture.

**Latency** — Time for one operation. Quote percentiles.

**Throughput** — Operations per unit time. Not the inverse of latency.

**p50 / p95 / p99** — Percentiles. p95 is where unhappy users live.

**SLI / SLO / SLA** — Measured / targeted / promised.

**Availability nines** — 99.9% ≈ 43 min downtime per month.

**Vertical / horizontal scaling** — Bigger machine / more machines.

**Stateless** — Any instance can serve any request. The enabler for horizontal scale.

**CAP** — During a partition, choose consistency or availability.

**Eventual consistency** — Converges later. Fine for transcripts, not for payments.

**Coupling** — How much one component depends on another being up.

**Back-of-envelope estimation** — Rough arithmetic that reveals the dominant term.

**Peak concurrency** — The number a real-time system is actually sized by.

**Bottleneck** — The component that saturates first.

**Single point of failure** — One component whose loss stops the system.

**Graceful degradation** — Reduced quality instead of total failure.

**Blast radius** — How much breaks when one thing fails.

**Cost optimisation** — Lower cost per unit of value, requirements intact.

**Unit economics** — Cost and revenue of one unit — here, one call.

**Fixed / variable cost** — Independent of volume / scales with it.

**Break-even volume** — Where fixed self-hosted cost equals variable managed cost.

**Utilisation** — Fraction of paid capacity actually used. Dominates fixed-cost efficiency.

**Amortisation** — Spreading a fixed cost across the units it serves.

**Opportunity cost** — What the engineering time could have built instead.

---

Cost figures in §16 are illustrative and chosen to demonstrate the method; the structure and the ranking are what transfer.
Companion documents: the cost of a token · beyond one process · anatomy of a call · the OSV field guide · CI/CD and containers.
