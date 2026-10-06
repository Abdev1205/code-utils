# Production Incident Playbook

**Topic:** System design
**Covers:** Security Fundamentals; Back-of-the-Envelope Estimation; Failure Handling and Health Checks; Scheduled Jobs; CI Pipelines; CD Pipelines and Progressive Delivery; Sandboxes; Hosting a Website; ML System Fundamentals; Training, Serving and Monitoring ML (MLOps); Recommendation Systems; LLMs for System Designers; Inside an LLM; Fine-Tuning LLMs; Training an LLM from Scratch
**Source:** [Claude artifact](https://claude.ai/artifact/7xxGdVxPGbUiPY13z4MdZ2) — written by a colleague, mirrored here for study.

This tab continues the production incident deep dives for Chapters 26-62; Chapters 1-25 carry theirs inside each chapter of the main book. Each entry gives a realistic incident timeline, a failure catalog (detection signal, why it happens, blast radius, how to stop it now, permanent fix) and a production readiness checklist.

## Chapter 26: Security Fundamentals

**Incident: a cloud key leaked in a public repository.** A developer pushed a config file with an access key to a public GitHub repo; automated scanners found it within minutes.

| Time | What happened | Why |
| --- | --- | --- |
| 22:10 | Commit with an access key pushed publicly | Key stored in a config file, not a secrets manager |
| 22:14 | Attackers start GPU instances in several regions | Bots scan public repos continuously |
| 22:30 | Attackers list storage buckets | The key's role had broad permissions |
| 06:00 | Billing anomaly alert; key revoked | No secret scanning on push |
| After | Instances terminated, access logs reviewed, all keys rotated | Assume compromise |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Leaked secret | Secret-scanning alert; unusual API calls | Secrets in code or config | Everything the key can do | Revoke and rotate; review logs | Secrets manager, push protection, short-lived credentials |
| Over-privileged role | Attackers reach unrelated data | Broad "admin" permissions | Whole account | Restrict the role | Least privilege per service; permission reviews |
| IDOR | Users fetching other users' records | Ownership not checked per request | User data | Patch the endpoint | Authorization checks in a shared layer; tests for it |
| SSRF to metadata | Calls to `169.254.169.254` from app servers | User-supplied URLs fetched server-side | Cloud credentials | Block the address | URL allowlists; metadata service with session tokens |
| Vulnerable dependency | Exploit attempts in WAF logs | Unpatched library | Exposed services | Patch or block with a WAF rule | Automated dependency updates and scanning |
| Public bucket | Unexpected public access logs | Misconfigured permissions | Stored files | Block public access | Account-level public access block; audits |

**Production readiness checklist**

- Secret scanning with push protection on every repo
- No long-lived cloud keys; workload identity instead
- Least-privilege roles reviewed quarterly
- Ownership checks enforced and tested on every endpoint
- Billing and API-usage anomaly alerts

## Chapter 27: Back-of-the-Envelope Estimation

**Incident: the database disk fills four months early.** The storage estimate counted only raw rows; it forgot replication, indexes, logs and growth.

| Time | What happened | Why |
| --- | --- | --- |
| Planning | Estimated 2 TB for the year | 5M rows/day × 1 KB × 365 |
| Month 8 | Disk at 95% | Indexes doubled the size; WAL and backups added more |
| Month 8 | Writes fail during peak | No room for new data |
| Mitigation | Emergency volume expansion and archiving | Hours of degraded service |
| Fix | Estimates include all overheads plus headroom; capacity alerts | Prevent recurrence |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Forgotten overheads | Disk growth faster than plan | Replication, indexes, logs, backups not counted | Storage-bound systems | Expand volumes | Multiply raw size by overhead factors (often 2-4x) |
| Missing peak factor | Saturation only at peaks | Average used instead of peak | Peak-hour users | Shed load | Plan for 2-3x average, more for events |
| Unit mistakes | Bandwidth 8x off | Bits and bytes mixed | Network capacity | Recalculate | Units on every line of the estimate |
| Growth not modeled | Fine at launch, exhausted in months | Static estimate | Whole system | Emergency scaling | Forecast with growth rate; review monthly |
| Hidden fan-out | One request costs 50 backend calls | Per-request estimates ignored fan-out | Backends | Cache or batch | Count calls per user action |

**Production readiness checklist**

- Estimates written with units, peak factor and overheads
- Capacity alerts at 70% and 85%
- Monthly forecast vs actual review
- Fan-out per user action measured
- Archiving and retention policies in place

## Chapter 28: Failure Handling and Health Checks

**Incident: a gray failure in one zone.** One availability zone's network dropped 5% of packets; health checks still passed, but user requests timed out.

| Time | What happened | Why |
| --- | --- | --- |
| 11:00 | Packet loss starts in zone B | Faulty network device |
| 11:00 | Health checks still pass | Tiny probes usually succeed; failures are partial |
| 11:05 | p99 latency triples; 3% of requests time out | Retransmissions on large responses |
| 11:40 | Errors found to concentrate in zone B | Per-zone dashboards |
| 11:45 | Zone B drained from the load balancer | Mitigation |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Gray failure | Errors or latency skewed to one zone or host | Partial faults invisible to simple probes | Users routed there | Drain the zone or host | Passive outlier detection; per-zone SLIs; automatic zone evacuation |
| Fleet removed by deep checks | All targets unhealthy at once | Health tied to a shared dependency | Everything | Make checks shallow | Shallow liveness, scoped readiness |
| Restart loops | Pods restarting repeatedly | Strict liveness during slow startup | Capacity | Relax probes | Startup probes; realistic timeouts |
| Silent job failure | Missing reports or payouts | Nothing alerts when a job does not run | Business processes | Run the job manually | Dead man's switch alerts |
| False failover | Healthy primary demoted | Detector too sensitive to a short pause | Writes interrupted | Tune thresholds | Multi-signal detection with quorum |
| Users detect it first | Social media reports before alerts | No synthetic or real-user monitoring | Reputation | Investigate reports | Synthetic checks and real-user monitoring |

**Production readiness checklist**

- SLIs broken down by zone and host
- Passive outlier ejection enabled
- Liveness, readiness and startup probes tuned separately
- Dead man's switches for scheduled work
- Zone evacuation runbook tested

## Chapter 29: Scheduled Jobs

**Incident: monthly billing runs twice.** The scheduler leader paused for 40 seconds in garbage collection; its lease expired, a second node became leader, and the old leader woke up still believing it was in charge.

| Time | What happened | Why |
| --- | --- | --- |
| 00:00:00 | Leader A starts the billing run | Normal schedule |
| 00:00:10 | A pauses for 40 s | Long garbage-collection pause |
| 00:00:30 | Lease expires; node B becomes leader and starts billing | Correct election |
| 00:00:50 | A resumes and keeps charging | A never rechecked its lease |
| After | 12,000 duplicate charges refunded | No idempotency key per customer per month |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Two leaders | Duplicate side effects | Old leader acts after its lease expired | All jobs it runs | Stop the old leader | Fencing tokens checked by the resource; idempotency keys |
| Duplicate charges | Two charges for one period | No unique key per customer and period | Customers' money | Refund duplicates | `bill:{customer}:{period}` with a unique constraint |
| DST skip or double run | Jobs missing or doubled on DST days | Schedules in local time | Time-based jobs | Run manually | Schedules in UTC; explicit DST rules |
| Overlapping runs | Two instances of the same job | Job longer than its interval | Data corruption | Kill one | Forbid-overlap policy and locks |
| Midnight stampede | Load spike at 00:00 | Everyone schedules at midnight | Shared databases | Shift some jobs | Jitter and staggered schedules |
| Silent failure | Nothing happens, nothing alerts | No success check | Business process | Run manually | Dead man's switch on expected completion |

**Production readiness checklist**

- Fencing tokens or idempotency on every leader-driven job
- Unique keys per entity and period for money jobs
- All schedules in UTC with jitter
- Overlap policy configured
- Completion alerts for every critical job

## Chapter 30: CI Pipelines

**Incident: a compromised CI step steals secrets.** A popular third-party CI step was modified upstream to print environment variables; pipelines that referenced it by a moving tag ran the new code.

| Time | What happened | Why |
| --- | --- | --- |
| Day 0 | Third-party step's tag moved to a malicious version | Upstream maintainer account compromised |
| Day 0 | Every pipeline run prints secrets into logs | Step referenced by tag, not by commit hash |
| Day 1 | Security team spots tokens in build logs | Logs readable outside the team |
| Day 1 | All exposed secrets rotated | Assume compromise |
| Fix | Pin steps to commit hashes; short-lived OIDC credentials | Reduce exposure |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Supply-chain compromise | Unexpected network calls or log output in builds | Unpinned third-party steps | Every secret in CI | Rotate secrets; block the step | Pin by commit hash; allowlist steps |
| Long-lived secrets in CI | Leaked tokens still valid weeks later | Static credentials stored in CI | Production access | Rotate | OIDC short-lived credentials scoped per job |
| Untested artifact deployed | Production differs from staging | Rebuilt per environment | Releases | Roll back | Build once; promote the same signed image |
| Flaky tests normalized | Reruns until green | Ignored flakiness | Real bugs slip through | Quarantine flaky tests | Track flake rate; fix or delete |
| Slow pipeline | Large risky merges | 60+ minute feedback | Change safety | Parallelize | Caching, sharding, affected-only builds |
| Migration breaks rollback | Rollback fails after deploy | Destructive schema change shipped with the code | Recovery | Roll forward | Expand-migrate-contract |

**Production readiness checklist**

- Third-party CI steps pinned by commit hash
- OIDC credentials instead of stored secrets
- Artifacts signed and promoted, never rebuilt
- Flaky-test tracking
- Migrations reviewed for rollback safety

## Chapter 31: CD Pipelines and Progressive Delivery

**Incident: a config change takes down every region at once.** A rate-limit config with a typo (limit `0` instead of `1000`) was pushed globally in one step, bypassing the canary used for code.

| Time | What happened | Why |
| --- | --- | --- |
| 17:00 | Config pushed to all regions together | Config treated as "not code" |
| 17:00 | Every request rejected with 429 | Limit of zero |
| 17:03 | Global outage declared | No staged rollout to limit blast radius |
| 17:09 | Previous config restored | Manual revert |
| Fix | Config goes through the same canary and waves as code | Prevent recurrence |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Global config push | Errors everywhere at once | No staged rollout for config | Every region | Revert | Config as code: validation, canary, waves |
| Silent business regression | Orders down, errors flat | Canary checks only technical metrics | Revenue | Roll back | Business metrics in canary analysis |
| Inconclusive canary | Pass with too little data | Small traffic slice, short bake | Bad releases slip through | Extend the bake | Minimum sample sizes; matched baseline |
| Rollback blocked | Old version fails on new schema | Schema change not backward compatible | Recovery | Roll forward with a fix | N-1 compatibility; expand-migrate-contract |
| Feature flag outage | Features flip unexpectedly | Flag service unreachable, unsafe defaults | Users of flagged features | Pin flags locally | Cached flags with safe defaults |
| Stale flag debt | Unexpected code paths in production | Old flags never removed | Maintainability | Remove flags | Flag expiry dates and cleanup tasks |

**Production readiness checklist**

- Config and code share one staged pipeline
- Canary analysis includes business metrics
- Every release is N-1 compatible
- Flags have safe defaults and expiry dates
- Rollback tested regularly

## Chapter 32: Sandboxes

**Incident: free-tier sandboxes mine cryptocurrency.** Attackers signed up thousands of free accounts and ran miners inside the code-execution sandboxes.

| Time | What happened | Why |
| --- | --- | --- |
| Week 1 | CPU usage across sandbox hosts climbs | Long-running processes in many sandboxes |
| Week 2 | Compute bill triples | No CPU-time limits per account |
| Week 2 | Miners reach mining pools on the internet | Egress open by default |
| Response | Egress blocked, CPU quotas set, accounts banned | Mitigation |
| Fix | Deny-by-default egress, per-run time limits, signup abuse checks | Prevent recurrence |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Resource abuse | CPU and bill spikes, long-running jobs | No time or CPU quotas | Cost, other tenants | Kill jobs, ban accounts | Per-run time limits, CPU quotas, abuse detection |
| Open egress | Connections to unknown hosts | Network allowed by default | Data exfiltration, attacks from your IPs | Block egress | Deny by default; allowlist |
| Sandbox escape | Unexpected host processes | Kernel exploit through a shared kernel | The host and all tenants | Isolate and rebuild hosts | MicroVMs or gVisor; fast kernel patching |
| Cross-user data leak | User sees another user's files | Sandbox reused between users | Privacy | Stop reuse | One sandbox per user session; destroy after use |
| Cold-start latency | Slow first run | Booting fresh environments | User experience | Warm pools | Snapshots and pre-warmed pools |
| Metadata access | Calls to cloud metadata addresses | Address not blocked | Cloud credentials | Block it | Network policy blocking metadata endpoints |

**Production readiness checklist**

- Egress denied by default
- CPU, memory, PID, disk and time limits per run
- Strong isolation for untrusted code
- No sandbox reuse across users
- Abuse detection on signups and usage

## Chapter 33: Hosting a Website

**Incident: a VPS site goes down from a full disk.** Application logs grew unrotated for eight months until the disk filled and the database crashed.

| Time | What happened | Why |
| --- | --- | --- |
| Month 1-8 | Logs grow by 1 GB a day | No log rotation |
| Day X 03:00 | Disk reaches 100% | Nobody monitored disk |
| 03:00 | Database fails to write and stops | No space for its files |
| 09:00 | Owner notices from customer emails | No uptime monitoring |
| Fix | Log rotation, disk alerts, uptime checks, tested backups | Prevent recurrence |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Disk full | Write errors, crashes | Logs or uploads grow unchecked | Whole site | Delete old logs | Log rotation; disk alerts at 80% |
| No backups when needed | Restore fails | Backups never tested or stored on the same server | All data | Recover what you can | Off-server backups with restore tests |
| Certificate expired | Browser warnings | Renewal job broke silently | All visitors | Renew manually | Renewal timer plus expiry monitoring |
| Exposed database | Ransom note in the database | Port open to the internet with a weak password | All data | Firewall the port | Private networking, firewall, strong credentials |
| Unpatched server | Compromise via an old package | No automatic security updates | The server | Patch and rebuild | Unattended security upgrades; rebuild from scripts |
| Single server dies | Hours of downtime | No redundancy | Whole site | Restore elsewhere | Scripted rebuilds, or a managed platform |

**Production readiness checklist**

- Uptime and disk monitoring with alerts
- Log rotation configured
- Off-server backups restored successfully at least monthly
- Database and admin ports closed to the internet
- Automatic security updates

## Chapter 34: ML System Fundamentals

**Incident: a fraud model that looked great offline fails in production.** Offline recall was 92%; in production it caught under half the fraud.

| Time | What happened | Why |
| --- | --- | --- |
| Training | Feature "number of chargebacks on this card" included | Computed with data from after each transaction (leakage) |
| Launch | Recall drops sharply in production | That feature is always zero at decision time |
| Week 2 | Fraud losses rise | Model relied on the leaked feature |
| Fix | Point-in-time feature computation; time-based validation split | Prevent leakage |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Data leakage | Offline far better than online | Features use future information | Every prediction | Roll back to previous model | Point-in-time joins via a feature store; time-based splits |
| Wrong metric | High accuracy, no business gain | Class imbalance hides failure | Business outcome | Re-evaluate with precision and recall | Choose metrics from business costs |
| Biased labels | Unfair outcomes for some groups | Historical decisions were biased | Affected users, legal risk | Human review for affected cases | Fairness audits; label review |
| Proxy objective | Clicks up, satisfaction down | Optimizing a convenient proxy | Product quality | Add guardrail metrics | Multi-objective goals with long-term metrics |
| No baseline | Cannot tell if the model helps | Skipped simple heuristic | Wasted effort | Build a baseline | Always compare with a simple rule first |

**Production readiness checklist**

- Features computed point-in-time
- Time-based validation split
- Metrics chosen from business costs
- Baseline and A/B test plan
- Fairness checks on key groups

## Chapter 35: Training, Serving and Monitoring ML (MLOps)

**Incident: training-serving skew from a time zone.** The training pipeline computed "hour of day" in UTC; the serving code used local time (IST), so every prediction used a time 5.5 hours off.

| Time | What happened | Why |
| --- | --- | --- |
| Launch | ETA model goes live | Offline error looked good |
| Day 1 | ETA errors 2x higher than offline | Hour-of-day feature mismatched |
| Day 5 | Found by comparing logged serving features with training features | Feature logging existed |
| Fix | One shared feature definition used by both training and serving | Remove skew |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Training-serving skew | Online error far above offline | Features computed differently in two codebases | All predictions | Roll back | Feature store with shared definitions; log serving features |
| Silent drift | Slowly rising error | Data or behavior changed | Prediction quality | Retrain | Drift monitors on inputs and outputs; scheduled retraining |
| Null features in production | Predictions collapse to a default | Upstream pipeline broke | All predictions | Fallback model | Feature validation at serving with alerts |
| Model timeout | Checkout blocked or slow | Model latency above budget | Critical path | Serve fallback rules | Timeouts with rule-based fallback |
| Bad retrain promoted | New model worse | No automatic comparison with the current model | Users | Roll back | Champion-challenger gates on held-out data |
| GPU out of memory | Serving errors at peak | Batch or model too large for the GPU | Inference capacity | Smaller batches | Right-size hardware; quantization |

**Production readiness checklist**

- Shared feature definitions for training and serving
- Serving features logged and compared
- Drift and accuracy monitoring with alerts
- Fallback for model failures
- Promotion gates comparing against the current model

## Chapter 36: Recommendation Systems

**Incident: closed restaurants fill the home screen.** During a city-wide rain closure, 40% of top recommendations were restaurants that had stopped accepting orders.

| Time | What happened | Why |
| --- | --- | --- |
| 19:00 | Many restaurants pause due to rain | Real-world event |
| 19:00 | Recommendations still show them | Candidate lists precomputed hourly; open-status filter used a 1-hour cache |
| 19:15 | Click-to-order conversion halves | Users tap closed restaurants |
| 19:30 | Filter cache TTL dropped to 30 s | Mitigation |
| Fix | Real-time availability filter after retrieval | Prevent recurrence |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Stale availability | Conversion drops, clicks on closed items | Filters use stale data | All users in the area | Shorten cache TTL | Real-time filter stage on live availability |
| Popularity feedback loop | Same items everywhere; long tail starves | Model learns from its own exposure | Catalog diversity, partners | Boost exploration | Exploration slots, diversity re-ranking, position-bias correction |
| Cold start | New items never shown | No interaction history | New restaurants | Manual boost | Content features and exploration budgets |
| Recommendation service down | Empty home screen | No fallback | Everyone | Serve cached popular lists | Fallback to popularity by area |
| Training on biased logs | Model favors top positions | Position bias not corrected | Ranking quality | Retrain with corrections | Log impressions with position; debias |

**Production readiness checklist**

- Real-time filters for availability and eligibility
- Fallback lists for recommendation outages
- Exploration budget and diversity rules
- Impressions logged with positions
- Conversion monitored per surface

## Chapter 37: LLMs for System Designers

**Incident: a silent model update breaks JSON parsing.** The app called a model alias that the provider moved to a newer version; the new model wrapped JSON in Markdown fences, and 18% of responses failed to parse.

| Time | What happened | Why |
| --- | --- | --- |
| Day 0 | Provider updates the alias to a new version | App used an alias, not a pinned version |
| Day 0 | Parse errors jump from 0.1% to 18% | Output format changed slightly |
| Day 0 | Orders stuck waiting for structured extraction | No retry or repair path |
| Day 1 | Pinned the old version; parser strips fences | Mitigation |
| Fix | Pinned versions, structured outputs, schema validation and evals before upgrades | Prevent recurrence |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Model or prompt change | Quality or parse-rate shift without a deploy | Floating model alias or edited prompt | Every request | Pin the previous version | Pinned versions; eval gate before any model or prompt change |
| Context overflow | Errors on long conversations | History grows past the window | Long sessions | Truncate | Summaries, sliding windows, retrieval |
| Latency spike | TTFT rises | Provider load, longer prompts | User experience | Route to a faster model | Streaming, caching, routing, timeouts with fallback |
| Cost spike | Spend jumps | Prompt grew or caching broke | Budget | Revert the prompt | Cost per request dashboards and alerts |
| Hallucinated facts | Wrong answers reported | No grounding | Trust | Add disclaimers, route to humans | RAG or tools for facts |

**Production readiness checklist**

- Model versions pinned; upgrades go through evals
- Structured outputs validated with retry
- TTFT, error and parse-rate dashboards
- Cost per request tracked
- Fallback model or provider

## Chapter 38: Inside an LLM

**Incident: a safety instruction is ignored in long prompts.** A policy line placed in the middle of a 60,000-token prompt was followed only part of the time.

| Time | What happened | Why |
| --- | --- | --- |
| Launch | Long prompts stuffed with documents | "More context is better" |
| Week 1 | Bot sometimes promises refunds against policy | Key instruction buried in the middle |
| Analysis | Compliance worse as prompts grow | Attention spreads across many tokens; middle content is used less reliably |
| Fix | Instructions at the start and repeated near the question; fewer, better chunks | Prompt structure |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Lost in the middle | Instruction compliance falls with prompt length | Middle content used less reliably | Long-context requests | Shorten prompts | Key instructions first; rerank to fewer chunks |
| KV cache exhaustion | Out-of-memory under many long sessions | KV memory grows with tokens and users | Serving capacity | Cap context length | Paged KV cache; quantized KV; admission control |
| Tokenization surprises | Costs higher for Indian languages; odd errors on spelling | Subword tokens | Cost, accuracy | Measure tokens per language | Choose tokenizer-efficient models; tools for character tasks |
| Repetition loops | Model repeats phrases | Sampling settings | Output quality | Stop sequences | Tuned sampling, max tokens |

**Production readiness checklist**

- Prompt structure: instructions first, data in tags, question last
- Compliance tested at maximum prompt length
- Token cost measured per language
- Context length limits enforced

## Chapter 39: Fine-Tuning LLMs

**Incident: the fine-tuned model replies with garbage.** The model was trained with one chat template and served with another, so its learned turn markers never appeared.

| Time | What happened | Why |
| --- | --- | --- |
| Training | LoRA trained with template A | Training script default |
| Deploy | Serving engine applies template B | Engine default |
| Day 1 | Responses ramble and include stray role names | Model never saw template B during training |
| Fix | Same template in training, evaluation and serving; end-to-end test on the serving stack | Prevent recurrence |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Template mismatch | Garbled output only in production | Different chat formatting in training and serving | All requests | Roll back | One shared template; evals run on the serving stack |
| Catastrophic forgetting | General questions get worse | Narrow training data overwrote abilities | Off-task use | Roll back | LoRA, mixed general data, fewer epochs, regression evals |
| Safety regression | More harmful completions | Fine-tuning weakened refusals | Users, legal risk | Roll back | Safety evals in every release gate |
| Overfitting | Great on validation, poor on real traffic | Small or unrepresentative dataset | Task quality | Roll back | Real-traffic test sets; more diverse data |
| Facts go stale | Wrong prices or policies | Knowledge baked into weights | Correctness | Add retrieval | RAG for changing facts; fine-tune only behavior |

**Production readiness checklist**

- Identical chat template everywhere
- Task, regression and safety evals before release
- Real-traffic test set
- Changing facts served by retrieval, not weights

## Chapter 40: Training an LLM from Scratch

**Incident: a faulty GPU silently corrupts training.** One GPU produced wrong results without crashing; loss spiked two days later and the last clean checkpoint was 36 hours old.

| Time | What happened | Why |
| --- | --- | --- |
| Day 10 | A GPU starts producing bad values | Hardware fault (silent data corruption) |
| Day 12 | Loss spikes, then NaNs | Corrupted gradients spread through all-reduce |
| Day 12 | Roll back to a checkpoint 36 hours earlier | Checkpoints too infrequent; recent ones also affected |
| Fix | Per-node health checks, frequent async checkpoints, automatic loss-spike rollback | Limit lost compute |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Silent data corruption | Loss anomalies, NaNs | Faulty GPU or memory | Whole training run | Roll back; remove the node | Hardware health checks; ECC monitoring; deterministic spot checks |
| Loss spike | Sudden loss jump | Bad data batch or unstable learning rate | Training progress | Roll back and skip the batch | Data filtering; gradient clipping; learning-rate tuning |
| Node failure | Job crashes | Hardware or network fault at scale | Hours of compute | Restart from checkpoint | Frequent async checkpoints; automatic restart |
| Low utilization | MFU far below target | Data loading or communication bottlenecks | Cost and time | Profile | Prefetching, overlap communication, better parallelism layout |
| Benchmark contamination | Scores too good to be true | Test data in training data | Credibility | Re-evaluate on private sets | Decontamination before training |

**Production readiness checklist**

- Checkpoints frequent and verified
- Node health checks and automatic eviction
- Loss-spike detection with automatic rollback
- MFU and throughput dashboards
- Decontaminated evaluation sets
