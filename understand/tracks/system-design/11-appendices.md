# Appendices

**Topic:** System design
**Covers:** Cheat Sheets; Scenario Workbook for Chapters 1-33; Quiz Answer Key; Glossary
**Source:** [Claude artifact](https://claude.ai/artifact/7xxGdVxPGbUiPY13z4MdZ2) — written by a colleague, mirrored here for study.

## Appendix A: Cheat Sheets

### A.1 Numbers to remember

| Quantity | Value |
| --- | --- |
| Seconds per day | 86,400 ≈ 10^5 |
| 1M requests/day | ≈ 12 per second |
| RAM vs SSD | RAM \~1,000x faster |
| Same data center round trip | \~0.5 ms |
| India to US round trip | \~150-250 ms |
| 99.9% / 99.99% / 99.999% downtime per year | 8.76 h / 52.6 min / 5.26 min |
| Base62 7-character codes | \~3.5 trillion |
| 1 English token | \~4 characters, \~¾ word |
| FP16 parameter | 2 bytes (70B model ≈ 140 GB) |
| Full fine-tuning memory | \~16 bytes per parameter |
| Telephone voice | 8,000 samples/s × 8 bits = 64 kbps |
| CUDA warp | 32 threads |

### A.2 Formulas

```latex
\text{QPS} \approx \frac{\text{requests per day}}{10^5}, \qquad \text{peak} \approx 2\text{-}3 \times \text{average}
```

```latex
\text{Concurrency (Little's Law)} = \text{arrival rate} \times \text{average duration}
```

```latex
A_{series} = \prod A_i, \qquad A_{parallel} = 1 - \prod (1 - A_i)
```

```latex
W + R > N \;\Rightarrow\; \text{every quorum read sees the latest write}
```

```latex
\text{Training FLOPs} \approx 6 N D, \qquad \text{KV bytes/token} \approx 2 \times L \times H_{kv} \times d_{head} \times \text{bytes}
```

### A.3 Decision guides

| Question | Default answer |
| --- | --- |
| Monolith or microservices? | Modular monolith first |
| SQL or NoSQL? | By access pattern; SQL for money |
| Strong or eventual consistency? | Per feature: strong for money and bookings |
| Cache what? | Hot, read-heavy, tolerably stale data |
| Queue or sync call? | Queue unless the user needs the result now |
| Polling, SSE, WebSockets, webhooks? | Rare / server push / two-way / server-to-server |
| Rate limit algorithm? | Token bucket or sliding window counter |
| RAG or fine-tune? | RAG for knowledge, fine-tune for behavior |
| Workflow or agent? | Least autonomy that solves the task |
| Container or microVM for strangers' code? | MicroVM (or gVisor) plus layers |

## Appendix B: Scenario Workbook for Chapters 1-33

Each row is a realistic scenario with its root cause, fix and the lasting challenge. Use them as practice: cover the right columns and diagnose.

### B.1 Foundations (Chapters 1-5)

| Chapter | Scenario | Root cause | Fix | Challenge |
| --- | --- | --- | --- | --- |
| 1 | Team builds for "millions" with no numbers | No non-functional requirements | Write NFRs with numbers; estimate | Requirements change as products grow |
| 2 | Like button shows red, then reverts | Optimistic update failed server-side | Reconcile on error; show failure state | Balancing speed with honesty |
| 2 | Whole app down when one server dies | Single point of failure | Redundant servers + load balancer | Finding hidden SPOFs |
| 3 | Site moved IP but users still hit old server | DNS TTL caching | Lower TTL before migrations; keep old server briefly | Global caches you do not control |
| 3 | Payments stall on lossy network | Wrong protocol assumption | TCP for payments; retries with idempotency | Mobile network variability |
| 4 | Mobile home screen needs 7 REST calls | Under-fetching | Aggregation endpoint, BFF or GraphQL | Keeping APIs simple |
| 4 | Old app versions crash after API change | Field renamed in place | Additive changes; `/v2` for breaking ones | Supporting old clients for years |
| 4 | Infinite scroll shows duplicates | Offset pagination with inserts | Cursor pagination | Stable sort keys |
| 5 | Browser warns "connection not private" | Expired certificate | Automated renewal + expiry alerts | Certificates across many services |
| 5 | Fired employee's JWT still works | Long-lived tokens | Short expiry + refresh + revocation list | Revocation in stateless auth |
| 5 | Customer charged twice on retry | No idempotency key | Keys with unique constraint | Concurrent duplicate requests |

### B.2 Scaling (Chapters 6-9)

```
Symptom: everything slow after adding servers
   web tier ✓ (scaled)  →  cache ✓  →  DATABASE ✗ (single hot primary)
   fix: read replicas + caching + indexes → later sharding
```

| Chapter | Scenario | Root cause | Fix | Challenge |
| --- | --- | --- | --- | --- |
| 6 | Carts vanish on refresh | State in server memory | Shared Redis/DB | Migrating legacy stateful code |
| 6 | Auto-scaling too late for a 7:30 PM spike | Boot and warm-up time | Pre-scale; warm pools | Predicting spikes |
| 7 | One server overloaded by long uploads | Round robin with mixed durations | Least connections | Measuring real load |
| 7 | Users bounce between servers, sessions lost | Sticky cookie expired | Stateless servers | Third-party stateful components |
| 8 | Database melts when popular key expires | Cache stampede | Locking, early refresh, serve stale | Hot keys on IPL night |
| 8 | Wrong dosa price shown | Stale cache | Invalidate on write + short TTL | Invalidation across layers |
| 8 | DB flooded hourly at :00 | Synchronized TTLs (avalanche) | TTL jitter | Bulk-loaded caches |
| 9 | Old JavaScript after deploy | CDN caching unversioned file | Content-hashed filenames | Purge propagation delays |
| 9 | User sees another user's page | Personal page cached publicly | `Cache-Control: private/no-store` | Misconfigured headers |

### B.3 Data (Chapters 10-14)

| Chapter | Scenario | Root cause | Fix | Challenge |
| --- | --- | --- | --- | --- |
| 10 | Money vanishes after crash mid-transfer | No transaction | ACID transaction (atomicity) | Transactions across services |
| 11 | History page takes 40 s | Full table scan | Composite index `(user_id, created_at)` | Index write overhead |
| 11 | Index exists but query still scans | Leftmost prefix violated | Index matching the filter column | Many query shapes |
| 12 | Edited address reverts on refresh | Replication lag | Read-your-own-writes | Lag spikes under load |
| 12 | Two leaders accept writes | Split brain | Quorum + fencing | Partial network failures |
| 12 | Accidental `DELETE` replicated everywhere | Replication is not backup | Point-in-time recovery | Testing restores |
| 13 | Adding a shard moves 80% of data | `hash % N` | Consistent hashing + virtual nodes | Live rebalancing |
| 13 | Celebrity shard overloaded | Hot partition | Split key, dedicated shard, caching | Predicting hot keys |
| 13 | Duplicate order IDs across shards | Auto-increment | Snowflake IDs or ranges | Clock skew in IDs |
| 14 | Last seat sold twice during partition | AP choice for bookings | CP for inventory | Availability cost of CP |

### B.4 Communication (Chapters 15-20)

```
Producer ──► Queue (depth ↑↑↑) ──► Consumers (too few)
warning sign: steadily growing depth → scale consumers, apply backpressure, alert
```

| Chapter | Scenario | Root cause | Fix | Challenge |
| --- | --- | --- | --- | --- |
| 15 | Cashback credited twice | At-least-once + non-idempotent consumer | Message-ID dedupe with unique constraint | Dedupe store growth |
| 15 | One bad message blocks a queue | Poison message | Retry limit + DLQ | Replaying safely |
| 16 | Paid order never reaches restaurant | Dual write failed | Transactional outbox or CDC | Outbox relay lag |
| 16 | Extra consumers do nothing | Partitions < consumers | More partitions | Repartitioning live topics |
| 16 | Consumer breaks after event change | Field removed | Schema registry, additive changes | Many consumer teams |
| 17 | Chat messages lost across servers | No cross-server routing | Pub/sub or connection registry | Global fan-out |
| 17 | Deploy causes reconnect storm | All clients reconnect at once | Draining + backoff with jitter | Mobile reconnect behavior |
| 18-19 | Group call collapses at 6 people | Mesh topology | SFU | Downstream bandwidth per viewer |
| 19 | Voice agent feels laggy | Waiting for full STT/LLM/TTS outputs | Stream every stage; semantic turn detection | Interruptions (barge-in) |
| 20 | "All lines busy" at peak | Undersized for busy hour | Erlang-based sizing, callbacks, admission control | Outage-driven surges |

### B.5 Architecture (Chapters 21-23)

| Chapter | Scenario | Root cause | Fix | Challenge |
| --- | --- | --- | --- | --- |
| 21 | Ten services must deploy together | Distributed monolith | Database per service, async events | Untangling shared tables |
| 21 | Payment charged, restaurant rejected | No compensation | Saga with refund step | Visibility of long flows |
| 22 | 200 requests pass a 100/min limit | Fixed window boundary | Sliding window or token bucket | Distributed counters |
| 22 | Rate limiter down blocks all logins | Fail closed everywhere | Fail open for general APIs, closed for logins | Choosing per endpoint |
| 23 | Adding EV fares edits tested code | Open/closed violated | Strategy pattern + factory | Over-engineering small code |
| 23 | Two drivers assigned one trip | Race condition | Conditional update with version | Concurrency testing |

### B.6 Reliability and delivery (Chapters 24-33)

```
Incident flow:  detect ─► mitigate (rollback/flag/failover) ─► communicate ─► resolve ─► blameless postmortem
                  ▲                                                                       │
                  └──────────────── action items make the next failure automatic ◄────────┘
```

| Chapter | Scenario | Root cause | Fix | Challenge |
| --- | --- | --- | --- | --- |
| 24 | One dead dependency slows everything | No timeouts or breakers | Timeout + circuit breaker + fallback + bulkhead | Tuning thresholds |
| 24 | Retry storm amplifies outage | Retries at every layer | Retry at one layer, budgets, jitter | Client libraries' defaults |
| 25 | Average latency fine, users angry | Tail latency hidden | p95/p99 dashboards | Tail amplification in fan-out |
| 25 | Pager fatigue, real alert missed | Cause-based noisy alerts | Symptom/SLO burn alerts | Alert hygiene |
| 26 | User sees others' orders | IDOR | Server-side ownership checks | Every new endpoint |
| 26 | Cloud keys stolen via "import URL" | SSRF | Allowlists, block metadata IPs | Indirect fetch paths |
| 27 | Design collapses at launch | No estimation | Back-of-envelope math first | Unknown growth |
| 28 | Site down from health checks | Deep checks on shared DB | Shallow liveness, scoped readiness | Gray failures |
| 29 | Restaurants paid three times | Cron on three servers | Leader election + idempotent payouts | Exactly-once effects |
| 29 | Nightly job silently stopped | No dead man's switch | Expected-success alerts | Silent failures |
| 30 | Staging passes, production breaks | Rebuilt artifact | Build once, promote same image | Reproducible builds |
| 31 | Canary has no errors but fewer orders | Silent business bug | Business metrics in canary analysis | Low-traffic services |
| 31 | Config push takes down all regions | Config not staged | Waves + validation + instant revert | Treating config as code |
| 32 | Container escape on a code judge | Shared kernel | MicroVMs/gVisor + layers | Patch cadence |
| 33 | App dies when SSH closes | Process tied to session | systemd/pm2/Docker restart policy | Production hardening |

### B.7 The AI realm (Chapters 34-43)

```
ML failure triage
  quality dropped?  ─► data changed? (data drift) ─► relationship changed? (concept drift)
                    ─► features differ train vs serve? (skew) ─► model regression? (eval gate missed)
  fix path: monitor distributions + labels → retrain/rollback → add test cases
```

| Chapter | Scenario | Root cause | Fix | Challenge |
| --- | --- | --- | --- | --- |
| 34 | 99.9% accurate fraud model catches nothing | Class imbalance, wrong metric | Precision, recall, PR-AUC; threshold by business cost | Delayed fraud labels |
| 34 | Great offline, bad in production | Data leakage | Point-in-time features; time-based splits | Hidden leakage paths |
| 35 | Model worse online than offline | Training-serving skew | Feature store; log serving features | Two codebases |
| 35 | ETA wrong in monsoon, no errors | Data and concept drift | Drift monitors, predicted vs actual alerts, retrain | Rare seasonal events |
| 35 | Fraud model timeout blocks checkout | No fallback | Rules fallback within latency budget | Keeping rules current |
| 36 | New restaurants never shown | Rich-get-richer loop, cold start | Exploration, content features, fairness boosts | Measuring long-term effects |
| 36 | Clickbait thumbnails win | Proxy metric | Multi-objective ranking, satisfaction signals | Defining "good" |
| 37 | Chat gets slower and pricier each turn | Full history resent | Summarize, sliding window, prompt caching | Losing details |
| 37 | 8 s blank screen | High TTFT, no streaming | SSE streaming, shorter prompts | Long contexts |
| 38 | Model cannot count letters in "strawberry" | Tokenization | Code tool | Explaining quirks to users |
| 39 | Fine-tuned bot invents prices | Fine-tuning used for facts | RAG or live lookup | Choosing the right lever |
| 39 | Fine-tuned model refuses less safely | Safety degradation | Safety evals each release | Evaluating broad behavior |
| 40 | Loss spike at day 6 | Bad batch or instability | Roll back checkpoint, skip data, lower LR | Detection at scale |
| 40 | Training stalls with idle GPUs | Network or data loader bottleneck | Faster interconnect, prefetching | Cluster tuning |
| 41 | Validation loss rises while training falls | Overfitting | Dropout, more data, early stop | Small datasets |
| 42 | Prompt "improvement" from 90% to 92% | Within noise (±6% on 100 cases) | More cases, repeated runs, confidence intervals | Eval cost |
| 43 | Bot explains a shutdown that never happened | False-premise hallucination | Premise checks, retrieval, polite correction | Sycophancy |
| 43 | Five different refund amounts | Guessing | Ground with tools/RAG, low temperature, validation | Calibration |

Chapters 44-61 include their own failure tables.

## Appendix C: Quiz Answer Key

| Chapter | Answer |
| --- | --- |
| 1 | Functional: upload photos, send messages. Non-functional: upload under 2 s, 99.99% uptime. Instagram trades strict consistency for speed and availability (eventual consistency). |
| 2 | Request → server → DB update → server → response → display. One server crashing is a SPOF; add servers behind a load balancer. |
| 3 | Zoom uses UDP (old frames useless); UPI uses TCP (ordered, confirmed). Deleted post 4xx (404), DB crash 5xx, too many requests 4xx (429). DNS caches to cut latency and root load. |
| 4 | `GET /restaurants`, `GET /restaurants/15/menu`, `POST /orders`, `PATCH /orders/88`. Retries can double charge; use idempotency keys. Cursor pagination. `GET /users/42/orders`, `DELETE /orders/88`. |
| 5 | Certificate check: CAs will not sign for non-owners and copied certificates fail the private-key proof. JWT needs no shared session store; hard to revoke early. gRPC, REST, GraphQL. |
| 6 | Hardware ceiling, cost, SPOF, downtime. State in server memory; use shared Redis. Database bottleneck. Boot time; pre-scale. |
| 7 | Round robin; least connections; weighted round robin. Health checks fail, server removed, alert, replacement, re-added. L7. Active-passive/active-active or managed LB. Fault tolerance and even scaling. |
| 8 | 21.8 ms (\~22 ms). Write-back; write to DB (write-through if cached); write-around. Stampede: locks, early refresh, serve stale. Cache photo long; never wallet; menu short TTL + invalidation. Jitter prevents avalanches. |
| 9 | Push. Versioned filenames. No: personal, low hit ratio, leak risk. |
| 10 | SQL; atomicity (with durability). |
| 11 | No: leftmost prefix rule; add an index on `rating`. |
| 12 | Replication lag; read-your-own-writes. |
| 13 | \~80% of keys remap; consistent hashing. |
| 14 | CP: double-selling is worse than "try again." |
| 15 | Idempotent consumer with a unique message ID constraint. |
| 16 | Four consumers work; two idle; add partitions. |
| 17 | SSE, WebSockets, webhook. |
| 18 | Nyquist: twice \~4 kHz; digital regenerates without accumulating noise. |
| 19 | SFU uploads once instead of N−1 times; forwards without decoding and mixing. |
| 20 | 36 × 300 ≈ 10,800 concurrent calls. |
| 21 | Modular monolith first. |
| 22 | Boundary burst of 200 in 2 s; sliding window counter or token bucket. |
| 23 | Open/closed; Strategy (+ factory). |
| 24 | Timeout, circuit breaker, fallback, bulkhead. |
| 25 | p95/p99 percentiles. |
| 26 | IDOR; server-side ownership checks. |
| 27 | \~20-23K messages/s; 200 GB/day (\~600 GB replicated). |
| 28 | Shared-dependency checks removed every server; shallow liveness, scoped readiness, metrics plus breakers. |
| 29 | Leader election or `SKIP LOCKED`; idempotent payout keys. |
| 30 | Build once, deploy many. |
| 31 | No: business metric regression; roll back. |
| 32 | Shared kernel escape; microVMs or gVisor. |
| 33 | Process tied to the terminal; systemd, pm2 or Docker restart policies (Nginx in front). |
| 34 | Always "not fraud" scores 99.9%; precision, recall, F1, PR-AUC. |
| 35 | Data and concept drift; monitor features and predicted vs actual ETA. |
| 36 | Latency and cost; cheap recall then precise ranking. |
| 37 | TTFT; streaming. |
| 38 | Self-attention; feed-forward layers. |
| 39 | No; RAG or lookup. Fine-tune for tone, format, classification. |
| 40 | 6 × 10^20 FLOPs; cheaper inference for a smaller, longer-trained model. |
| 41 | ln(65) ≈ 4.17 for uniform guessing. |
| 42 | Guessing; ground with tools/RAG, low temperature, structured output, human routing. |
| 43 | False-premise; check and correct the premise. |
| 44 | Vectors weak at exact IDs; hybrid BM25 or direct DB lookup. |
| 45 | Filter at retrieval with ACL metadata; LLMs cannot keep secrets. Generation problem: quote-then-answer, fewer ordered chunks, verifier. |
| 46 | Answer spans many related facts; graphs traverse exact relationships. |
| 47 | Continuous batching. |
| 48 | Impersonation/IDOR; take `user_id` from the session. |
| 49 | Tool poisoning; trusted pinned servers, approvals, no secrets in context, data-flow policies. |
| 50 | Tests failed; code enforces what prompts only suggest. |
| 51 | Trifecta of private data, untrusted content and outbound email; require approval for sends or disable sending while browsing. |
| 52 | Over-refusal; measure benign-but-scary sets, tune. Code is deterministic. Caching and reranking first; evals catch silent quality loss. |
| 53 | Privacy and stateless backend. Data-not-instructions, approvals, sandbox egress. Caching, context trimming, routing, targeted edits. |
| 54 | Unknown outcome: PENDING, status polling, reconciliation. Floats round. Debit 1,000; credit 980 + 20. |
| 55 | 75K writes/s; ephemeral latest-only data. Batching beats greedy globally. Degrade recs and reviews; protect ordering/payments and dispatch/tracking. |
| 56 | Riders care about time. Locations self-heal; trips and money cannot. Server-controlled prices. |
| 57 | Bottleneck and SPOF; blocks per server. Hot-row write storm; async aggregation. 302 enables analytics, edits, takedowns. |
| 58 | Avoid silent loss. Bounded vs unbounded fan-out. On-device search; metadata abuse signals; client backups. |
| 59 | Parallelism and cheap retries; deterministic outputs. Savings scale with views. Hot row; per-user likes + sharded counters. |
| 60 | Admission control/priorities, model routing/degradation, maximize GPU efficiency. Prefix cache cuts cost and TTFT. See section 60.5 list. |
| 61 | One token per weight read; batching raises intensity. Tiles in SRAM, no full score matrix in HBM. Smaller batch + accumulation, activation checkpointing, mixed precision/FSDP. |

## Appendix D: Glossary

| Term | Meaning |
| --- | --- |
| ACID | Atomicity, consistency, isolation, durability |
| ANN | Approximate nearest neighbor search |
| BFF | Backend for frontend: a gateway per client type |
| CAP | Consistency vs availability during partitions |
| CDC | Change data capture from database logs |
| CDN | Edge cache network near users |
| Circuit breaker | Fails fast when a dependency is unhealthy |
| Consistent hashing | Ring mapping that moves \~1/N keys on resize |
| CQRS | Separate write and read models |
| CUDA | NVIDIA's GPU programming platform |
| DLQ | Dead letter queue for failing messages |
| Embedding | Vector representing meaning |
| Error budget | Allowed failure under an SLO |
| Idempotency | Same result whether done once or many times |
| KV cache | Stored attention keys/values for generated tokens |
| LoRA | Low-rank adapters for efficient fine-tuning |
| MCP | Model Context Protocol for tools and data |
| MFU | Model FLOPs utilization |
| Outbox | Table written with business data, relayed as events |
| PACELC | Latency vs consistency even without partitions |
| RAG | Retrieval-augmented generation |
| RPO / RTO | Acceptable data loss / downtime |
| Saga | Local transactions with compensations |
| SFU | Selective forwarding unit for media |
| SLI / SLO / SLA | Measurement / target / contract |
| SPOF | Single point of failure |
| TTFT | Time to first token |
| Warp | 32 GPU threads executing in lockstep |
