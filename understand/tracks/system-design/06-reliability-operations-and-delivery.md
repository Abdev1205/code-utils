# Part VI: Reliability, Operations and Delivery

**Topic:** System design
**Covers:** Fault Tolerance and Resilience; Observability; Security Fundamentals; Back-of-the-Envelope Estimation; Failure Handling Across a Whole System; Scheduled Jobs; CI Pipelines; CD Pipelines and Progressive Delivery; Sandboxes; Hosting a Website
**Source:** [Claude artifact](https://claude.ai/artifact/7xxGdVxPGbUiPY13z4MdZ2) — written by a colleague, mirrored here for study.

## Chapter 24: Fault Tolerance and Resilience

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Parts of the system will fail; the service as a whole must stay up and recover quickly. |
| Why it is hard | Failures cascade through dependencies, retries amplify outages, and availability multiplies down across components in series. |
| How we solve it | Redundancy across zones and regions, timeouts, retries with backoff and budgets, circuit breakers, bulkheads, fallbacks, safe deployments, chaos testing and tested disaster recovery. |
| What fails, and why | One slow dependency freezes everything (no timeouts or breakers), retry storms (retries at every layer), failed failovers (never rehearsed), and hidden degradation (fallbacks without alerts). |

At scale, something is always broken: disks, networks, servers, whole data centers, and especially recent deploys. The goal is not preventing every failure but keeping the system working despite them.

### 24.1 The nines

| Availability | Downtime per year | Per month |
| --- | --- | --- |
| 99% | 3.65 days | \~7.3 hours |
| 99.9% | 8.76 hours | \~43.8 minutes |
| 99.99% | 52.6 minutes | \~4.4 minutes |
| 99.999% | 5.26 minutes | \~26 seconds |

Each extra nine is ten times less downtime and usually much more effort and cost; not every feature needs five nines.

### 24.2 Availability math

Components in series multiply: a load balancer at 99.99%, app at 99.9% and database at 99.9% give 0.9999 × 0.999 × 0.999 ≈ 99.79%. More dependencies in a chain lower availability. Components in parallel (either can serve) fail together only when both fail: two servers at 99% each give 1 − 0.01 × 0.01 = 99.99%. Two cheap servers beat one expensive one.

### 24.3 SLI, SLO, SLA and error budgets

An SLI is a measurement ("99.95% of requests succeeded this month"). An SLO is the internal target ("99.9% success, p99 under 500 ms"). An SLA is a customer contract with penalties, usually looser than the SLO. The error budget is the allowed failure (0.1% for a 99.9% SLO, about 43 minutes a month): budget left means ship features; budget burned means freeze risky releases and fix reliability.

### 24.4 Patterns

Redundancy: multiple instances behind load balancers, database replicas with failover, paired load balancers, multiple availability zones (separate buildings with separate power in one region), and for the highest availability multiple regions. Active-active uses all copies with instant failover but harder consistency; active-passive is simpler but the standby idles and failover takes seconds to minutes.

Timeouts: never wait forever. A hung dependency otherwise piles up threads until the caller dies too. Set timeouts slightly above normal p99.

Retries with exponential backoff and jitter: 100, 200, 400, 800 ms with randomness and a maximum attempt count. Retry only idempotent operations. Beware retry storms: five layers each retrying three times turns one request into 3^5 = 243; retry at one layer and cap retries with a budget (e.g. at most 10% of traffic).

Circuit breaker, like an electrical fuse:

```
CLOSED (normal, count failures) --too many failures--> OPEN (fail instantly, return fallback)
OPEN --after cool-down--> HALF-OPEN (let a few test requests through)
HALF-OPEN --success--> CLOSED;  HALF-OPEN --failure--> OPEN
```

It fails fast, stops cascades and gives the struggling service room to recover. Tools: Resilience4j, Polly, Hystrix (retired), Istio/Envoy.

Bulkheads, like a ship's watertight compartments: separate thread or connection pools per dependency, so a hanging recommendation service exhausts only its own 10 threads while payments keep theirs.

Fallbacks and graceful degradation: show "popular near you" when recommendations fail, restaurants without ratings when ratings fail, the last known ETA when live location fails. Protect critical paths (browse, order, pay); let extras degrade. Netflix shows generic rows when personalization fails.

Feature flags and kill switches: turn features off in seconds without deploying, and roll out gradually.

When an order service waits 5 seconds per call on a dead recommendation service and slows down itself, the combined fix is a timeout, a circuit breaker and a fallback, plus a bulkhead.

### 24.5 Safe deployments

Many outages come from changes, so deploy carefully: rolling updates (a few servers at a time), blue-green (switch traffic between two full environments, with instant switch-back), canaries (1% first, then 10%, 50%, 100%, named after miners' canaries) and automatic rollback on error spikes. Chapter 31 goes deeper.

### 24.6 Chaos engineering

Deliberately break things in production, carefully, to find weaknesses first. Netflix's Chaos Monkey kills servers during business hours. Bigger experiments kill zones, inject latency or fill disks; game days rehearse disasters.

### 24.7 Disaster recovery

RPO (recovery point objective) is how much data you can afford to lose; RTO (recovery time objective) is how long you can be down.

| Strategy | Description | Typical RTO |
| --- | --- | --- |
| Backup and restore | Backups in another region | Hours |
| Pilot light | Core pieces (a DB replica) running minimally | Tens of minutes |
| Warm standby | Scaled-down full copy | Minutes |
| Multi-site active-active | Full systems serving everywhere | Near zero |

Pick per system: payments may need active-active; an internal HR tool can use backup and restore. Test backups: an unrestored backup is only a hope.

### 24.8 Practitioner's guide

Worked example: a payment call protected end to end.

> *Diagram in the original artifact: Protecting a payment call · bulkhead, timeout, retry, breaker, fallback*

| Pattern | Benefit | Constraint / trade-off | Use when | Avoid when |
| --- | --- | --- | --- | --- |
| Timeouts | Stop resource exhaustion | Too short cancels healthy work | Every network call | Never skip |
| Retries | Hide transient blips | Amplify overload | Idempotent operations | Non-idempotent writes without keys |
| Circuit breaker | Fail fast, allow recovery | Tuning thresholds | Unreliable dependencies | In-process calls |
| Bulkhead | Contain failures | Resource fragmentation | Several dependencies share pools | Tiny services |
| Fallback | Keep users served | Degraded experience | Non-critical features | Correctness-critical paths needing real data |
| Multi-region | Survive region loss | Cost, data sync | Tier-1 services | Internal low-impact tools |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Breaker never closes | Feature permanently degraded | Half-open probing, alerts |
| Fallback hides outage | Nobody notices for days | Alert when fallbacks fire |
| DR plan untested | Failover fails in real disaster | Game days, scheduled failover drills |

### 24.9 Production incident deep dive

**Incident: retries turn a blip into an outage.** A database hiccup lasted 5 seconds, but three layers each retried 3 times.

| Time | What happened | Why |
| --- | --- | --- |
| 14:00:00 | Database pauses for 5 s | Failover of a replica |
| 14:00:05 | Database back, but load is 27x normal | 3 retries × 3 layers = up to 27 calls per user request |
| 14:01 | Database overloaded again; timeouts trigger more retries | Positive feedback loop |
| 14:15 | Retries disabled at the edge; load falls | Mitigation |
| Fix | Retry at one layer with budgets and jitter | Bounded amplification |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Retry amplification | Request rate far above user traffic | Retries at several layers | Dependency and callers | Turn off retries at outer layers | Retry once at one layer; retry budgets; jitter |
| Metastable failure | System stays down after the trigger ends | Retries and queues keep load above capacity | Whole service | Shed load hard, then ramp | Load shedding, admission control, circuit breakers |
| Failover never tested | Failover fails in a real outage | Runbooks never exercised | Region or service | Manual recovery | Regular game days and failover drills |
| Correlated failures | Redundant copies fail together | Same zone, deploy or config | Supposedly redundant systems | Fail over to an independent copy | Spread across zones; stagger deploys |
| Fallback hides failure | Degraded for days without anyone noticing | No alert when fallbacks run | Quality | Alert on fallback rate | Fallback metrics and alerts |
| Error budget ignored | Repeated incidents | No consequence for burning the budget | Reliability | Freeze risky launches | Error-budget policy agreed with product |

**Production readiness checklist**

- Retries in exactly one layer, with budgets and jitter
- Load shedding and admission control on critical services
- Failover drills on a schedule
- Redundancy across independent failure domains
- Alerts when fallbacks or breakers activate

### Review questions

1. A dead recommendation service makes every call wait 5 seconds and slows the order service. Name two patterns that fix it.

#### Answers

1. Any two of: a short timeout (fail in \~300 ms instead of 5 s); a circuit breaker that opens after repeated failures and fails instantly; a fallback such as cached "popular near you"; a bulkhead giving recommendation calls their own small thread pool. The best answer combines timeout, circuit breaker and fallback.

## Chapter 25: Observability

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Know quickly when users are hurting, and find out why across dozens of services. |
| Why it is hard | Averages hide slow users, one request crosses many services, data volume is enormous, and too many alerts get ignored. |
| How we solve it | Metrics (golden signals, percentiles), structured logs with trace IDs, distributed tracing, SLO-based alerts on symptoms, and blameless incident reviews. |
| What fails, and why | Unnoticed slowness (watching averages), broken traces (context not propagated through queues), alert fatigue (cause-based noisy alerts), and blind outages (monitoring in the same failure domain). |

Monitoring tells you that something is wrong; observability lets you find out why, even for problems you never predicted. It stands on three pillars: metrics tell you what, traces tell you where, logs tell you why.

### 25.1 Metrics

Metrics are numbers over time: cheap to store, fast to query, ideal for dashboards and alerts. Counters only go up (total requests, errors); gauges go up and down (CPU, queue length, connections); histograms capture distributions and enable percentiles.

The four golden signals (Google SRE): latency (separating successful and failed requests, since fast errors can hide slowness), traffic (requests per second), errors, and saturation (CPU, memory, disk, queue depth, connection pools; rising saturation predicts trouble). Related frameworks: RED for services (rate, errors, duration) and USE for resources (utilization, saturation, errors). Tools: Prometheus and Grafana, Datadog, New Relic, CloudWatch.

### 25.2 Why averages lie

If 99 requests take 50 ms and one takes 10,000 ms, the average is about 150 ms and looks fine, but one user waited 10 seconds. Percentiles show reality: p50 is the typical experience, p95 and p99 the slow tail. At a million requests an hour, 1% is 10,000 unhappy users an hour; the slowest requests often belong to the best customers with the most data; and when a page calls ten services, the chance that at least one is slow is much higher, so one service's p99 becomes many users' normal. A checkout with a 120 ms average can still feel slow; check p95 and p99.

### 25.3 Logs

Logs are timestamped event records. Prefer structured JSON so you can query "all CARD\_DECLINED errors from HDFC in the last 10 minutes":

```json
{"timestamp": "2026-10-05T21:47:12Z", "level": "ERROR", "service": "payment-service",
 "trace_id": "abc123xyz", "user_id": 42, "order_id": 88, "error": "CARD_DECLINED",
 "bank": "HDFC", "latency_ms": 1840}
```

Levels: DEBUG (usually off in production), INFO, WARN, ERROR, FATAL. Ship logs centrally (the ELK stack of Elasticsearch, Logstash and Kibana; Grafana Loki; Splunk; Datadog). Rules: never log secrets (passwords, card numbers, OTPs, tokens, Aadhaar), mask sensitive values (`****4242`), sample routine success logs while keeping all errors, set retention, and always include trace ID, user ID and service.

### 25.4 Distributed tracing

A request entering the system gets a trace ID passed along every hop, including Kafka headers. Each service records a span (start, end, parent), and the tracing system stitches spans into a timeline:

```
Trace abc123xyz — 4,020 ms
├─ API Gateway              20 ms
├─ Order Service            80 ms
│  └─ Payment Service    3,600 ms  ← slow
│     └─ HDFC bank API   3,550 ms  ← root cause
├─ Restaurant Service       60 ms
└─ Notification (async)     40 ms
```

Putting the trace ID in every log line (a correlation ID) pulls up every log for one request. At scale, sample traces and use tail-based sampling to keep all slow or failed ones. Tools: OpenTelemetry (the vendor-neutral standard), Jaeger, Zipkin, Grafana Tempo, Datadog APM, AWS X-Ray.

### 25.5 Alerting

Alert on symptoms users feel ("error rate above 2% for 5 minutes," "checkout p99 above 2 seconds"), not causes ("CPU 85% on server 7"). Every alert must be actionable; noisy alerts cause fatigue, the boy who cried wolf. Separate pages (wake someone now) from tickets (fix during work hours). Use SLO burn-rate alerts ("at this rate the monthly budget is gone in six hours"). Link every alert to a runbook.

### 25.6 Incidents and postmortems

During an incident: detect, respond with an incident commander, mitigate first (roll back, flip a flag, fail over) before finding the root cause, resolve, and communicate on a status page. Track MTTD (mean time to detect) and MTTR (mean time to recover).

Afterwards, write a blameless postmortem: timeline, root cause (ask "why?" five times), what went well and badly, and action items. If one engineer's typo can take down production, the system allowed it; blame makes people hide mistakes, blamelessness makes them share lessons.

### 25.7 Worked example

IPL night: an alert fires for checkout p99 above 3 seconds; dashboards show payment latency rising at 9:45 PM; traces show the HDFC bank API taking 3.5 seconds; logs show `HDFC_GATEWAY_TIMEOUT`; mitigation routes HDFC payments to a backup gateway and trips the circuit breaker; the postmortem adds per-bank alerts and automated failover.

### 25.8 Practitioner's guide

Worked example: a minimal observability setup for a new service.

```
Code instrumented with OpenTelemetry
  metrics  → Prometheus → Grafana dashboard (RED: rate, errors, p50/p95/p99)
  traces   → Tempo/Jaeger (10% sampled, 100% of errors and slow requests)
  logs     → Loki/ELK (JSON, trace_id in every line, PII masked)
Alerts: SLO burn rate (fast + slow windows) → PagerDuty → runbook link
```

| Aspect | Details |
| --- | --- |
| Benefits | Faster detection and recovery, root-cause speed, capacity planning |
| Constraints | Storage cost, high-cardinality metrics, sampling gaps, PII risk |
| Trade-offs | More data (insight) vs cost; sampling (cheap) vs completeness |
| Use traces when | Requests cross services |
| Avoid | Metrics labeled by user\_id (cardinality explosion); logging secrets |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Monitoring in same failure domain | Dashboards down during outage | External/synthetic monitoring |
| Missing trace propagation through Kafka | Broken traces | Propagate context in message headers |
| Log volume explodes cost | Bills spike | Sampling, retention tiers, drop debug logs |
| Alert on CPU only | Users suffer unseen | Symptom/SLO alerts |

### 25.9 Production incident deep dive

**Incident: the outage nobody was paged for.** Checkout failed for 2 hours in one region; the on-call engineer had muted a noisy channel that carried the real alert.

| Time | What happened | Why |
| --- | --- | --- |
| Week before | 300 alerts per day, mostly CPU and disk warnings | Cause-based alerts with no clear action |
| 21:00 | Payment calls fail in one region | Expired credential for a provider |
| 21:00 | Alert fires in the muted channel | Alert fatigue |
| 23:00 | Customers report on social media | Users detected it first |
| Fix | SLO burn-rate alerts on symptoms; noisy alerts deleted | Fewer, actionable pages |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Alert fatigue | Many pages, few actions | Alerts on causes, not user symptoms | Real incidents missed | Silence noisy alerts | SLO burn-rate alerts; every page has a runbook |
| Blind spot by region | Global averages look fine | Metrics not broken down by region | Affected region | Add region dashboards | Per-region and per-tenant SLIs |
| Monitoring down with the system | Dashboards empty during outage | Monitoring in the same failure domain | Incident response | Use provider status and external probes | External synthetic monitoring |
| Cardinality explosion | Metrics bill and query latency soar | Labels with user IDs | Observability itself | Drop the label | Cardinality limits; IDs in traces and logs, not metrics |
| Broken traces | Spans stop at queues | Trace context not propagated through messages | Debugging speed | Correlate by request ID | Propagate context in message headers |
| Secrets in logs | Tokens found in log search | Logging full requests | Security | Purge and rotate | Structured logging with redaction |

**Production readiness checklist**

- Pages only on user-facing symptoms with runbooks
- SLIs broken down by region and key customers
- External synthetic checks
- Trace context propagated through queues
- Log redaction tested

### Review questions

1. A checkout API averages 120 ms and the team says performance is great, yet users complain. What should you check and why?

#### Answers

1. Check percentiles, especially p95 and p99. The average hides the slow tail: if 2% of requests take 8 seconds, the average still looks fine while thousands of users suffer. Break percentiles down by endpoint, region and instance to find the cause.

## Chapter 26: Security Fundamentals

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Keep attackers from stealing data, money or control, while legitimate users still get in easily. |
| Why it is hard | Attackers need one hole, defenders must close them all; secrets leak, dependencies carry vulnerabilities, and people make mistakes. |
| How we solve it | Defense in depth: strong authentication and least-privilege authorization, encryption in transit and at rest, secrets managers, input handling against SQLi, XSS, CSRF and SSRF, network segmentation, audits and privacy controls. |
| What fails, and why | Users reading others' data (missing ownership checks), stolen cloud keys (secrets in code or SSRF), cracked passwords (fast hashes), and breaches spreading (over-privileged accounts). |

A fast, scalable, reliable system can be destroyed in one night by a breach. Security is designed in from the start, in layers, so that one failed wall is never the last one.

### 26.1 Defense in depth and the CIA triad

A castle has a moat, outer walls, gate guards, inner walls and a vault. A system has a CDN with DDoS protection and a WAF, a gateway with auth and rate limits, a private network with firewalls, services with authorization checks and mTLS, and an encrypted database with least-privilege access. Security protects confidentiality (only authorized people see data), integrity (data is not tampered with) and availability (the system stays usable under attack). Do not confuse these letters with CAP's.

### 26.2 Authentication and authorization

Stronger authentication: MFA combining something you know (password), have (phone, authenticator, security key) or are (fingerprint, face); passkeys (WebAuthn), passwordless and phishing-resistant via public-key cryptography; and SSO using OAuth 2.0/OpenID Connect or SAML.

Authorization models: RBAC attaches permissions to roles (customer, restaurant owner, support agent with refunds up to ₹500, admin). ABAC uses attributes ("refund if amount below ₹500, same region, working hours"). ReBAC uses relationships ("you may edit because you own this doc").

Least privilege: every user, service and employee gets only the minimum access needed. The notification service reads phone numbers but not payment data; interns do not touch production databases; a compromised service yields only its own limited powers.

IDOR (insecure direct object reference): Priya opens `/orders/88` (hers), changes it to `/orders/89` and sees Arjun's address. The server checked authentication but not ownership. Always verify on the server that the resource belongs to the requester and return 403 or 404 otherwise; random IDs add a layer but the ownership check is the fix.

### 26.3 Encryption and keys

Encrypt in transit (TLS everywhere, mTLS between services), at rest (AES-256 on disks, databases, backups) and, for especially sensitive fields such as Aadhaar or card data, at the application level so even database admins see ciphertext.

Keys belong in a KMS (AWS KMS, Google Cloud KMS, HashiCorp Vault) or HSMs, never in code. Envelope encryption encrypts data with a data key and the data key with a master key that never leaves the KMS. Rotate keys regularly.

Passwords are hashed, never encrypted (encryption is reversible). Add a unique salt per password so identical passwords hash differently, defeating rainbow tables, and use slow password hashes: bcrypt, scrypt or Argon2, never plain MD5 or SHA-256.

Secrets (API keys, database passwords, tokens) live in secrets managers and are injected at runtime; bots scan public repositories for leaked keys within minutes.

### 26.4 Common attacks

| Attack | Example | Defense |
| --- | --- | --- |
| SQL injection | Input `' OR '1'='1` turns a query into "return all users" | Parameterized queries; least-privilege DB accounts |
| XSS | `<script>` in a review runs in every viewer's browser | Escape output; Content Security Policy; HttpOnly cookies |
| CSRF | An evil site submits a transfer using your bank cookies | CSRF tokens; SameSite cookies; re-auth for sensitive actions |
| SSRF | "Import from URL" fetches `169.254.169.254` cloud metadata | Allowlist domains; block private IPs; isolate fetchers |
| Brute force / credential stuffing | Millions of guesses or reused leaked passwords | Login rate limits, lockouts, CAPTCHAs, MFA, breached-password checks |
| DDoS | Botnet floods | CDN/DDoS protection, WAF, rate limits, auto-scaling |
| Supply chain | Compromised dependency | Dependency scanning, updates, pinned versions |

The golden rule: never trust user input. Validate type, length, format and range on the server; client checks are for convenience only.

### 26.5 Network security

A VPC is your private cloud network. Only internet-facing pieces (load balancers, gateways) sit in public subnets; app servers and databases sit in private subnets unreachable from the internet. Security groups allow, for example, database connections only from app servers on port 5432. Engineers reach private servers through controlled, logged access paths. Zero trust replaces "trust everything inside" with "never trust, always verify" for every request, internal or not.

### 26.6 Privacy and compliance

PII (names, phones, addresses, Aadhaar, location history) needs extra protection. Minimize collection, because data never stored can never leak. Know the laws: GDPR in Europe, India's DPDP Act 2023, and PCI-DSS for card data (which is why most companies let payment providers hold card numbers). Support access and deletion requests across services, caches, logs and backups, and data-residency requirements. Keep append-only audit logs of who accessed what. Tokenization replaces sensitive values with tokens such as `card_tok_8x7f` that are useless if stolen.

### 26.7 Interview checklist

TLS everywhere and mTLS inside; authentication plus authorization on every request (watch for IDOR); gateway rate limiting; encryption at rest with KMS; bcrypt or Argon2 with salts; databases in private subnets with least privilege; CDN and WAF; secrets in a manager; PII minimized, masked in logs, with audit logs.

### 26.8 Practitioner's guide

Worked example: threat-modeling the "refund" endpoint (STRIDE-style).

```
Spoofing     → JWT auth + MFA for agents
Tampering    → server recomputes amount; signed requests between services
Repudiation  → append-only audit log (who refunded what)
Info leak    → ownership check (no IDOR), masked PII in responses
DoS          → per-agent rate limits
Elevation    → RBAC: agents ≤ ₹500, supervisors above; two-person approval > ₹10K
```

| Aspect | Details |
| --- | --- |
| Benefits | Fewer breaches, compliance, customer trust |
| Constraints | Friction (MFA, approvals), performance (encryption), cost, legacy systems |
| Trade-offs | Security vs usability; central control vs team speed |
| Use zero trust when | Distributed teams, cloud, many services |
| Avoid | Security through obscurity; client-only validation |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Secrets in Git history | Keys abused | Rotate immediately; secret scanning; vault |
| Over-privileged service account | Breach spreads | Least privilege, scoped roles |
| Public S3 bucket | Data exposed | Block public access by default, audits |
| Unpatched dependency | Exploited CVE | Automated dependency updates and scanning |

### Review questions

1. Changing `/orders/88` to `/orders/89` shows another user's order. Name the vulnerability and the fix.

#### Answers

1. IDOR (insecure direct object reference), a form of broken access control: the server checked that Priya is logged in but not that order 89 belongs to her. On every request, verify server-side that `order.user_id` equals the authenticated user (or that their role permits access) and return 403 or 404 otherwise; unguessable IDs add a layer but the ownership check is the fix.

## Chapter 27: Back-of-the-Envelope Estimation

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Decide how big each part of the system must be before building it. |
| Why it is hard | Inputs are guesses, units are easy to mix up, and numbers are useless unless they change the design. |
| How we solve it | Users → requests per second (÷ 10^5 per day) → peak × 2-3 → storage with replication → bandwidth → cache size, then turn each number into a decision. |
| What fails, and why | Outages at dinner rush (forgot the peak factor), storage running out (forgot replication and metadata), and 8x bandwidth errors (bits vs bytes). |

The numbers decide the design: 1,000 requests per second fit one database, while 1,000,000 need sharding, caching and CDNs. Estimation finds the order of magnitude in three to five minutes, then translates each number into a decision.

### 27.1 Cheat sheets

| Unit | Bytes | Example |
| --- | --- | --- |
| 1 KB | 10^3 | A chat message or tweet with metadata |
| 1 MB | 10^6 | A high-quality photo (\~2 MB) |
| 1 GB | 10^9 | An HD movie (1-4 GB) |
| 1 TB | 10^12 | A large laptop disk |
| 1 PB | 10^15 | A big company's photo storage |

Typical sizes: a character is 1 byte (2-4 for emoji or Indic scripts); an ID 8 bytes; a message 100 bytes to 1 KB; a profile row \~1 KB; a photo 200 KB (thumbnail) to 2 MB; a minute of HD video 50-100 MB.

Time: 1 day = 86,400 s ≈ 10^5 s; 1 month ≈ 2.5 million s; 1 year ≈ 3 × 10^7 s. So 1 million requests per day ≈ 12 per second.

| Operation | Approximate time |
| --- | --- |
| CPU cache read | \~1 ns |
| RAM read | \~100 ns |
| SSD random 1 KB read | \~20-100 µs |
| Round trip in a data center | \~0.5 ms |
| Spinning-disk seek | \~10 ms |
| Bengaluru to Mumbai round trip | \~20-30 ms |
| India to US round trip | \~150-250 ms |

Lessons: RAM is about 1,000x faster than SSD (why caches work); cross-continent calls are slow (why CDNs and regions exist); in-data-center calls are fast but add up across microservice hops.

Rough single-machine capacity: a web server handles \~1,000-10,000 simple requests/s; a well-indexed SQL database \~5,000-20,000 simple queries/s; Redis 100,000+ operations/s; a Kafka cluster millions of messages/s; a server holds \~100K-1M WebSocket connections.

### 27.2 The recipe

1. Daily active users.
2. Read and write QPS, then peak (2-3x average).
3. Storage: item size × items per day × retention × replication factor (usually 3).
4. Bandwidth: QPS × size.
5. Cache: the 80/20 rule, caching the hot 20%.

### 27.3 Worked example: Instagram

Assume 500M DAU, 0.2 uploads per user per day, 50 photo views per user per day, 2 MB photos, 5 years.

```
Uploads:   500M × 0.2 = 100M/day → ~1,000/s, peak ~2,000-3,000/s
Views:     500M × 50 = 25B/day → ~250,000/s, peak ~500,000-750,000/s
Ratio:     ~250:1 read-heavy
Storage:   100M × 2 MB = 200 TB/day → ~73 PB/year → ~365 PB in 5 years → ~1 EB with 3 copies
Metadata:  ~1 KB × 100M = 100 GB/day
Bandwidth: 250,000/s × ~200 KB ≈ 50 GB/s
Cache:     ~1B unique photos viewed/day × 1 KB ≈ 1 TB; hot 20% ≈ 200 GB of RAM
Servers:   750,000 peak QPS ÷ ~5,000 per server ≈ 150 (+ buffer)
```

| Number | Decision |
| --- | --- |
| 250:1 read-heavy | Caching, read replicas, CDN |
| \~1 EB of photos | Object storage, not a database |
| 50 GB/s | CDN is mandatory |
| 200 GB hot metadata | A Redis cluster fits easily |
| 1,000 uploads/s | Asynchronous processing via queues |

### 27.4 Second example: chat

100M DAU × 20 messages = 2B messages/day ≈ 20,000/s (exactly \~23K), peak \~50,000-70,000/s. At 100 bytes each, 200 GB/day, \~600 GB/day with replication, \~200 TB/year: write-heavy, time-ordered data suited to Cassandra.

### 27.5 Tips

State assumptions aloud; round aggressively (86,400 → 100,000); use powers of ten; always compute peak; remember replication and metadata; turn every number into "so we need X"; sanity-check (WhatsApp does not run on three servers); and keep it to a few minutes.

### 27.6 Practitioner's guide

Worked example: estimating a food-photo feature in four minutes.

```
10M DAU × 2 photo views/order-screen × 5 screens = 100M views/day → ~1,000/s (peak ~3,000/s)
200K restaurants × 50 photos × 300 KB = 3 TB (×3 renditions ≈ 9 TB) → object storage
Bandwidth at peak: 3,000/s × 100 KB thumbnails ≈ 300 MB/s → CDN
Decision: S3 + CDN, no database blobs, async thumbnailing via queue
```

| Aspect | Details |
| --- | --- |
| Benefits | Finds the real bottleneck early; justifies each component |
| Constraints | Unknown inputs; assumptions can be wrong |
| Trade-offs | Speed (rough numbers) vs precision; state assumptions to keep both |
| Use when | Every design; capacity planning; cost forecasts |
| Avoid | Spending 20 minutes on exact arithmetic in an interview |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Forgetting peak factor | Outage at dinner rush | Multiply by 2-3x (more for events) |
| Forgetting replication and metadata | Storage runs out early | ×3 and add indexes/metadata |
| Unit slips (Mb vs MB) | 8x bandwidth error | Write units on every line |
| Numbers never turned into decisions | Math with no design impact | End each line with "so we need..." |

### Review questions

1. 100M DAU each send 20 messages of 100 bytes. Estimate messages per second and storage per day.

#### Answers

1. 100M × 20 = 2 billion messages/day ÷ \~10^5 s ≈ 20,000 messages/s (exactly \~23,000), peaking at \~50,000-70,000/s. Storage: 2B × 100 bytes = 200 GB/day, \~600 GB/day with 3x replication, \~200 TB/year: write-heavy, time-ordered data suited to a wide-column store such as Cassandra.

## Chapter 28: Failure Handling Across a Whole System

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Detect that something is broken (fully, partly or silently) and react automatically before users notice. |
| Why it is hard | Slow and dead look the same from outside, health checks can cause outages, and the worst failures are partial or silent. |
| How we solve it | Shallow liveness and scoped readiness probes, passive outlier detection, heartbeats and gossip, layered detection from health checks to business metrics and synthetic tests, and automatic responses. |
| What fails, and why | Whole fleets removed (deep checks tied to a shared database), restart loops (strict probes during slow startup), unnoticed gray failures (only active checks), and silent job failures (no dead man's switch). |

Every architect must answer three questions: what can fail, how do we find out, and what happens next. Crashes are the easy failures; slow, partial, wrong and silent failures are the dangerous ones, because naive checks report "all fine" while users suffer.

### 28.1 Types of failure

| Type | Looks like | Example |
| --- | --- | --- |
| Crash | Component dies | Out of memory |
| Slow | Works but takes forever | Database lock pile-up, GC pauses |
| Partial (gray) | Some requests fail | One of 20 servers has a bad disk |
| Wrong answers | Success with bad data | Stale prices, model drift |
| Partition | Alive but cannot talk | Zone link cut |
| Dependency | Something you call fails | Payment gateway down |
| Overload | Demand exceeds capacity | IPL spike, retry storm |
| Change | A deploy or config breaks things | Bad release, expired TLS certificate |
| Silent | Something that should happen does not | Nightly job stopped |

Walk the failure map layer by layer (client, DNS, CDN, load balancer, gateway, services, cache, database, queues, third parties, zone and region) and answer for each: what happens to users, and how do we know?

### 28.2 Health checks

A health check is an automated "are you OK?" that removes or restarts components that say no. Active checks send probes on a schedule (`GET /health` every 5 seconds) and detect dead servers even without traffic. Passive checks (outlier detection) watch real traffic and eject servers after, say, five consecutive 5xx errors; they catch gray failures. Use both.

Typical load-balancer settings: path `/health`, interval 10 s, timeout 2 s, unhealthy after 3 consecutive failures, healthy after 2 successes. A crash at 00:12 is detected and removed by about 00:40, and the server rejoins after two successful checks. Thresholds add hysteresis, preventing flapping. Aggressive settings detect faster but risk false positives; conservative settings are stable but slower. Client retries and passive checks cover the detection window.

Kubernetes separates three probes:

| Probe | Question | On failure |
| --- | --- | --- |
| Liveness | Is the process stuck or dead? | Restart the container |
| Readiness | Can it serve traffic now? | Remove from load balancing, no restart |
| Startup | Has it finished starting? | Delay liveness checks until ready |

A server loading a large ML model is alive but not ready; an overloaded server can mark itself not ready to shed load; a deadlocked one fails liveness and restarts.

### 28.3 The deep health check trap

A deep check verifies dependencies (database, cache, payment API). When a shared database hiccups for 20 seconds, all 50 servers fail their checks together, the balancer removes every server, and even cache-only pages go down: a total outage caused by your own health checks. Some load balancers fail open when every target looks unhealthy for exactly this reason.

Best practice: liveness is shallow (restarting will not fix a database); readiness checks only what the instance itself owns (startup complete, own pool working, not overloaded); dependency health is reported as metrics and alerts; circuit breakers and fallbacks handle dependency failures gracefully.

A good design exposes `/health/live` (cheap), `/health/ready`, and an authenticated internal `/health/details` with per-dependency status. Keep checks fast (a heavy query in `/health` can itself overload the database), use internal timeouts, and never expose versions or dependencies publicly.

### 28.4 Heartbeats and failure detectors

Cluster nodes send heartbeats; missing several triggers failover. You cannot perfectly distinguish dead from slow or partitioned, so every detector trades speed against false alarms. Leases and fencing tokens stop a presumed-dead node from causing damage. The phi accrual detector (Cassandra, Akka) learns each node's normal timing and computes a suspicion level. Gossip protocols such as SWIM let nodes probe each other and ask others to confirm before declaring a node dead, scaling to thousands of nodes.

### 28.5 The detection stack

From components outward: health checks and heartbeats; dead man's switches for things that should happen (jobs, backups, certificate renewals); golden-signal metrics; SLO burn-rate alerts; business-metric anomalies (orders per minute versus the same time last week, often the best catch-all, since a hidden Android button breaks revenue with zero errors); synthetic monitoring (robots running real journeys every minute from several regions); real user monitoring and crash reporting by app version, device and region; and finally user reports, which mean detection has already failed. Measure from the user's point of view. For gray failures, compare per-instance percentiles, use passive outlier detection, trust the callers' view when it disagrees with a service's own, and use canary analysis.

### 28.6 Responses

Automatic responses: health checks plus auto-scaling replace dead servers; liveness restarts frozen processes; idempotent retries handle blips; timeouts, circuit breakers and fallbacks contain dependency failures; database failover via heartbeats; auto-scaling, rate limits and load shedding for spikes; automatic rollback of bad canaries; zone and region failover; dead letter queues for poison messages; cache replicas with stampede protection. Human response follows Chapter 25: alert, mitigate first, communicate, resolve, blameless postmortem.

### 28.7 Principles

Assume everything fails; remove single points of failure; limit blast radius with bulkheads, cell-based architecture (independent copies of the system each serving a slice of users) and gradual rollouts; fail fast; degrade gracefully; keep static stability (pre-provisioned spare capacity so failover does not depend on launching servers mid-crisis); make everything idempotent; make failure visible; practice failure with chaos engineering and fault injection; and test recovery paths.

### 28.8 Worked example

Friday 8:05 PM, an HDFC payment route times out for 30% of requests. Two-second timeouts fire fast; one idempotent retry runs; the circuit breaker opens and routes HDFC card payments to a backup gateway with a "UPI recommended" banner; shallow liveness correctly keeps pods running; latency and error metrics turn red; an SLO burn alert and an 18% drop in orders versus last Friday page on-call; traces pinpoint the external call; the breaker closes when HDFC recovers; the postmortem adds per-bank alerts, faster failover and synthetic payment probes.

### 28.9 Practitioner's guide

Worked example: a gray failure caught by passive checks.

```
20 API pods, all pass /health/live ✓
Pod 13: disk latency 2 s → 30% of its requests time out (gray failure)
Envoy outlier detection: 5 consecutive 5xx → eject pod 13 for 30 s
Alert: per-pod p99 outlier → node drained and replaced
```

| Aspect | Details |
| --- | --- |
| Benefits | Automatic removal of bad instances; faster detection; smaller blast radius |
| Constraints | Cannot perfectly tell dead from slow; false positives; probe cost |
| Trade-offs | Aggressive checks (fast detection, flapping) vs conservative (stable, slower) |
| Shallow liveness when | Always |
| Deep checks when | Diagnostics endpoints and alerts, not load-balancer eviction |
| Avoid | Restarting pods because a shared dependency is down |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Liveness probe too strict during GC pause | Restart loops | Longer timeouts, startup probes |
| Health endpoint queries DB heavily | DB overload from probes | Cheap checks, cached results |
| Monitoring only internal metrics | Users broken, dashboards green | Synthetic + RUM + business metrics |
| No dead man's switch | Silent job failures | Expected-heartbeat alerts |

### Review questions

1. A deep health check fails all 50 servers during a 20-second database hiccup. Why, and how should checks be designed?

#### Answers

1. The deep check tied every server's health to one shared database, so a 20-second hiccup failed all 50 checks at once and the load balancer removed every server, even for cache-only pages. Keep liveness shallow (process responds), make readiness check only what the instance owns, report database health as metrics and alerts, and let circuit breakers and fallbacks handle a slow database.

## Chapter 29: Scheduled Jobs

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Run work at the right time (nightly payouts, reminders, renewals) exactly once, even when machines fail. |
| Why it is hard | Several schedulers may fire the same job, jobs crash midway, clocks and time zones shift, and everyone schedules at midnight. |
| How we solve it | Separate triggering from execution, elect one leader or claim rows with SKIP LOCKED, make jobs idempotent, add timeouts, retries and DLQs, schedule in UTC with jitter, and monitor with dead man's switches. |
| What fails, and why | Restaurants paid three times (cron on several servers), skipped or doubled runs on DST days (local-time schedules), overlapping runs (no overlap policy), and midnight spikes (no jitter). |

Much work happens because of time, not user action: nightly recommendations, weekly restaurant payouts, "rate your order" an hour after delivery, monthly renewals, hourly cleanup of expired OTPs, weekly model retraining. At scale, scheduling is a distributed systems problem.

### 29.1 Three kinds

Recurring jobs follow a cron schedule ("every day at 2 AM"). Delayed one-off jobs run once at a future time ("one hour after this delivery"). Workflows are chains or graphs of dependent steps (extract, train, evaluate, deploy).

### 29.2 Cron and its limits

```
┌ minute ┌ hour ┌ day of month ┌ month ┌ day of week
0 2 * * *       every day at 2:00 AM
*/15 * * * *    every 15 minutes
0 9 * * 1       every Monday at 9:00 AM
```

Cron on one machine is a single point of failure that fails silently. Putting it on three servers for redundancy runs the job three times, paying restaurants thrice. There are no retries, no visibility, and long jobs overlap the next run.

### 29.3 A distributed scheduler

Separate deciding when from doing the work:

```
Job API → Job store (schedule, next_run_at, payload, retries, owner)
        → Scheduler (finds due jobs, enqueues) → Queue → Worker pool → results + monitoring
```

The scheduler stays small; workers scale independently; slow jobs cannot delay triggers; the queue provides buffering, retries and dead letter queues. A job record holds the cron expression, time zone, next run in UTC, payload, maximum retries, timeout, concurrency policy and owner; after each trigger the next run is computed.

### 29.4 Finding due jobs

Database polling every few seconds for `next_run_at <= now`, with an index on `next_run_at`, is simple and durable. A Redis sorted set scores job IDs by run timestamp (`ZADD delayed_jobs <ts> rate_order_88`, then `ZRANGEBYSCORE delayed_jobs 0 <now>`), the approach behind Sidekiq and BullMQ. Timing wheels, clock faces of slots ticked by a pointer, arranged hierarchically for long delays, make huge numbers of in-memory timers cheap, as in Kafka's delayed operations.

### 29.5 Avoiding duplicate runs

Leader election: one scheduler holds a renewable lease in etcd, ZooKeeper or Consul; if it dies, another takes over; fencing tokens stop an old leader that wakes up. Row locking lets many schedulers share work safely:

```sql
SELECT * FROM jobs WHERE next_run_at <= NOW() AND status = 'active'
ORDER BY next_run_at LIMIT 100 FOR UPDATE SKIP LOCKED;
```

Partitioning assigns jobs to schedulers via consistent hashing. Even so, crashes can cause reruns, so treat execution as at-least-once and make jobs idempotent with keys such as `payout-weekly:2026-10-12` and a unique constraint.

### 29.6 Execution details

Leases and heartbeats return jobs from silently dead workers. Retries use exponential backoff and jitter, then a dead letter queue and an alert. Overlap policies: forbid or skip (common for heavy jobs), allow, or replace; Kubernetes CronJobs offer exactly `Allow`, `Forbid` and `Replace`. Misfire policies decide whether to run once to catch up, run every missed occurrence, or skip, with a starting deadline. Long jobs are split into chunks (5,000 batches of 10,000 users), fanned out and retried per chunk.

### 29.7 Time is tricky

Store times in UTC with the time zone separately. Daylight saving time makes a local 2:30 AM vanish one day and occur twice another; India has no DST but global users do. "9 AM local" means different UTC times per zone. Keep clocks synced with NTP and do not rely on split-second precision. Define rules for "the 31st" in February.

### 29.8 The midnight stampede

Everyone schedules `0 0 * * *` or `0 * * * *`, so systems spike at the top of the hour. Add jitter, spread per-user jobs by `hash(user_id) % 60`, rate limit execution with priorities, and give teams quotas.

### 29.9 Workflows

DAG orchestrators (Airflow, Dagster, Prefect, Kubeflow) schedule dependent steps, retry individual steps and support backfills over past dates. Durable workflow engines (Temporal, AWS Step Functions) let code "sleep 7 days" while persisting state across restarts, ideal for trials, reminders and sagas.

### 29.10 Monitoring

The scariest failure is silence. A dead man's switch alerts when a job does not report success by its deadline. Also track schedule lag, duration trends, success and failure rates, retries, DLQ size, last successful run, and logs keyed by job and run IDs.

### 29.11 Worked example: rating reminders

3M orders/day means \~35 delayed jobs/s, \~150/s at dinner. On `OrderDelivered` from Kafka, add a job one hour ahead in a replicated Redis sorted set or an indexed jobs table. Schedulers claim due items atomically and enqueue them. Workers check at execution time whether the order was already rated, refunded or opted out (solving cancellation without hunting for the job), send with idempotency key `rate_reminder:order_88`, respect quiet hours, and are monitored for backlog and lag. The weekly payout uses leader election, forbid-overlap, per-restaurant-per-week idempotency keys, chunking, a DLQ, an audit trail and a "did not run by 10 AM Monday" alert.

Tools: cron and systemd timers; Kubernetes CronJobs; EventBridge Scheduler and Cloud Scheduler; Celery, Sidekiq, BullMQ, Quartz; Airflow and Dagster; Temporal and Step Functions.

### 29.12 Practitioner's guide

Worked example: monthly subscription renewal for 5M users.

```
1st of month 00:00 IST ─► scheduler (leader, lease in etcd)
  ─► splits into 5,000 chunks of 1,000 users, jitter spread over 4 hours
  ─► queue ─► 50 workers ─► charge with key renew:{user}:{2026-11}
  ─► failures retry 1h, 6h, 24h ─► then mark past_due + email
Dead man's switch: "renewal batch complete" by 06:00 or page on-call
```

| Aspect | Details |
| --- | --- |
| Benefits | Reliable time-based work, retries, visibility, horizontal scale |
| Constraints | Clock and time-zone complexity, duplicate risk, misfires |
| Trade-offs | Precision timing vs load spreading (jitter); single leader simplicity vs throughput |
| Cron when | Single non-critical machine task |
| Distributed scheduler when | Money, many jobs, high availability |
| Durable workflows when | Multi-step business processes with long waits |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Job runs at 2:30 AM on DST day | Skipped or doubled | UTC scheduling; DST-aware rules |
| Overlapping long runs | Double processing | Forbid-overlap policy, locks |
| Scheduler leader stuck but lease held | No jobs fire | Lease expiry + fencing |
| All teams at midnight | Load spike | Jitter, quotas |

### Review questions

1. A payout cron on three servers pays restaurants three times. Give one fix ensuring a single trigger and one making duplicates harmless.

#### Answers

1. One trigger: leader election with a lease (etcd, ZooKeeper, Consul) or database row claiming with `FOR UPDATE SKIP LOCKED`, or a single distributed scheduler. Harmless duplicates: an idempotent payout keyed like `payout:restaurant_15:2026-W41` with a unique constraint, so a second run sees "already paid" and skips.

## Chapter 30: CI Pipelines

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Many engineers merge code daily; every change must be proven safe and packaged identically for every environment. |
| Why it is hard | Tests are slow or flaky, builds are not reproducible, and pipelines hold secrets attackers want. |
| How we solve it | Fast automated stages (lint, unit, security, build, integration), build one immutable artifact per commit, trunk-based development with feature flags, caching and parallelism, and short-lived credentials. |
| What fails, and why | Production differs from staging (rebuilt per environment), reruns until green (flaky tests), big risky merges (slow pipelines), and leaked secrets (forked PRs with access to credentials). |

Because most outages come from changes, every change should travel the same automated path: build, test, scan, package once, deploy gradually, verify. Continuous Integration merges small changes into the main branch many times a day, each automatically built and tested, avoiding the "integration hell" of month-long branches merging at once. Continuous Delivery keeps every passing change releasable at the push of a button; Continuous Deployment ships every passing change automatically.

### 30.1 The stages

```
Push / Pull Request → webhook trigger
 1. Fast checks: formatting, linting, type checks, build
 2. Unit tests
 3. Security scans: code, vulnerable dependencies, leaked secrets, licenses
 4. Build artifact: Docker image tagged with commit ID, signed, stored in a registry
 5. Integration and contract tests: real DB/Redis/Kafka in temporary containers; API contracts
 6. Code review + merge with required green checks
 7. Staging deploy → end-to-end and smoke tests
 8. Production deploy: canary / blue-green / rolling
 9. Automated verification → full rollout or automatic rollback
```

### 30.2 The testing pyramid

Many fast unit tests at the base, some integration tests in the middle, few slow end-to-end tests covering critical journeys (login, order, pay) at the top. Contract tests verify service A's expectations of service B's API without running the whole system, catching "payments renamed a field and broke orders." Flaky tests teach people to ignore red builds; track, quarantine and fix them.

### 30.3 Branching and merging

Trunk-based development works best with CI: short-lived branches lasting hours to a day or two, frequent merges, unfinished work hidden behind feature flags, and `main` always releasable. Long-lived branches such as GitFlow add process and bigger conflicts. Guardrails: branch protection, required status checks, required reviews (two for payment code), and merge queues that test each PR against the latest `main` so changes green separately cannot break together.

### 30.4 Artifact and environment rules

Build once, deploy many: build `orders:3f9a2c1` once and promote that exact artifact from staging to production. Rebuilding for production can pull different dependencies and ship untested code; when staging passes but production breaks after a rebuild, this rule was violated. Artifacts are immutable and versioned by commit ID or semantic version, so rollback means redeploying the previous tag. Configuration is separate from code and secrets are injected at runtime. Ephemeral preview environments per PR let reviewers click through changes; staging mirrors production as closely as possible.

### 30.5 Infrastructure as Code and GitOps

Infrastructure as Code defines servers, databases, networks, load balancers and DNS in reviewed, versioned files (Terraform, Pulumi, CloudFormation); `plan` shows changes before `apply`. GitOps makes Git the source of truth for what runs: a controller such as Argo CD or Flux continuously syncs the cluster to the repo. Deploy is merging a PR that changes an image tag; rollback is reverting it; the cluster pulls changes, so CI never needs powerful push credentials.

### 30.6 Database migrations

During rolling deploys old and new code run against the same database, and schema changes are hard to undo. Expand, migrate, contract: add the new column and write to both; backfill in batches; read from the new column; stop writing the old one and later drop it. Every step works with both code versions. Run migrations as a controlled pipeline step, not on every pod startup; use online schema-change tools for huge tables; never combine a destructive schema change with the code that depends on it.

### 30.7 Securing the pipeline

CI holds the keys to production. Use OIDC workload identity for short-lived, least-privilege credentials per run; pull secrets from a manager and mask them in logs; deny secrets and deploy rights to PRs from forks; scan dependencies, pin third-party actions to exact versions or commit hashes, produce an SBOM, sign artifacts (e.g. Sigstore/cosign) and verify signatures before running; use ephemeral isolated runners; keep audit logs. SLSA describes levels of build integrity.

### 30.8 Speed

Aim for main checks under about 10 minutes: dependency and Docker layer caching, remote build caches, parallel jobs, sharded tests, building only affected projects in monorepos (Bazel, Nx, Turborepo), fail-fast ordering and prebuilt base images.

```yaml
on: [pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run lint
      - run: npm test
```

### 30.9 DORA metrics

Deployment frequency, lead time for changes, change failure rate and time to restore service. DORA's research found that speed and stability go together: teams shipping small changes often fail less and recover faster.

### 30.10 Special cases

Mobile apps cannot be rolled back instantly: use staged store rollouts, feature flags, server-driven configuration and backward-compatible APIs. ML pipelines add data validation, training and evaluation gates (CI/CD/CT). LLM apps run eval suites on every prompt, model, retrieval or tool change as required checks.

### 30.11 Designing a CI platform

Git webhooks (signature-verified) feed an event queue; an orchestrator parses pipeline config into a DAG; a scheduler enforces priorities and per-org quotas; ephemeral isolated runners autoscale on queue depth with warm pools for the Monday-morning burst; caches and artifacts live in object storage; logs stream live to browsers via WebSocket or SSE; secrets arrive via OIDC; status flows back to PRs. Key concerns: isolating untrusted code, fair scheduling, cost, cache hit rates, runner health, and the reliability of CI itself.

### 30.12 Practitioner's guide

Worked example: a 9-minute PR pipeline.

```
0:00 checkout (cached deps)  ─┬─ lint + typecheck (1 min)
                              ├─ unit tests, 8 shards (4 min)
                              └─ security scans (3 min)
4:30 build image app:3f9a2c1, sign, SBOM
5:00 integration tests with Testcontainers (Postgres, Redis, Kafka) (4 min)
9:00 ✓ required checks green → merge queue → main
```

| Aspect | Details |
| --- | --- |
| Benefits | Fast feedback, fewer regressions, small safe changes, audit trail |
| Constraints | Runner cost, flaky tests, pipeline maintenance, secret handling |
| Trade-offs | Thoroughness (more tests) vs speed; monorepo efficiency vs tooling complexity |
| Trunk-based when | Teams can merge small changes daily with flags |
| Release branches when | Regulated or mobile release trains |
| Avoid | Rebuilding per environment; long-lived feature branches |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Flaky E2E test | People rerun until green | Quarantine, fix, track flake rate |
| Pipeline 90 minutes | Big batched merges | Caching, sharding, affected-only builds |
| Malicious PR steals secrets | Leaked keys | No secrets for forks; OIDC short-lived creds |
| Migration in same deploy as code | Rollback impossible | Expand-migrate-contract |

### Review questions

1. A team rebuilds images separately for staging and production. Production breaks though staging passed. What rule was violated?

#### Answers

1. Build once, deploy many. Rebuilding for production can pull different dependencies, base images or build flags, so production runs an artifact that was never tested. Build one immutable image tagged by commit ID, test it in staging, and promote that exact image.

## Chapter 31: CD Pipelines and Progressive Delivery

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Ship new versions to production often without hurting users when a version is bad. |
| Why it is hard | Some bugs show only under real traffic, some fail silently, and database changes can block rollback. |
| How we solve it | Gradual exposure (rolling, blue-green, canary, waves), automated canary analysis including business metrics, feature flags separating deploy from release, N-1 compatibility and expand-migrate-contract migrations. |
| What fails, and why | Global outages (config pushed everywhere at once), silent revenue loss (canaries checked only for errors), stuck bad versions (schema changes without backward compatibility), and inconclusive canaries (too little traffic). |

CI asks whether a change is correct; CD asks how to get it to millions of users without breaking anything, and how to undo it instantly if it does. The two foundations are exposing changes gradually and separating deploy (code is running) from release (users see the feature).

### 31.1 The flow

```
Signed artifact from CI
 → Staging: smoke + E2E tests, bake time
 → Gates: automated checks, change freezes, approvals for risky services
 → Production waves: one box in one zone → rest of zone/region → more regions → all
 → Automated verification at each step (canary vs baseline)
     healthy → next wave;  worse → stop, roll back, alert
 → Release separately with feature flags
```

### 31.2 Deployment strategies

Recreate: stop everything, start the new version. Simple, never two versions together, but downtime and a bad version hits everyone; only for internal tools.

Rolling update: replace a few servers at a time. In Kubernetes, `maxSurge` sets how many extra pods may start and `maxUnavailable` how many may be down. New pods get traffic only after passing readiness probes, so a broken version stalls the rollout rather than replacing healthy pods. Old and new versions coexist, and rollback is another rolling update.

Blue-green: two full environments; test green, switch all traffic, switch back instantly on trouble. Costs double infrastructure, exposes 100% of users at the switch, shares databases, and needs draining for long-lived connections.

Canary: send 1% of real traffic to the new version, measure, then grow (1% → 5% → 25% → 50% → 100%). Small risk, real traffic, but needs good metrics and enough traffic to judge. Route by user-ID hash so users do not flip between versions.

Shadow (dark launch): copy real requests to the new version and discard its responses. Zero user risk, ideal for rewrites and ML models, but shadow traffic must never charge cards, send SMS or write real orders.

Feature flags: deploy code to 100% with the feature off, then release to employees, 1% of a city, 10%, the whole country. Instant kill switches, safe merging of unfinished code, targeting, and A/B tests. Manage flag debt with owners and expiry dates, and give apps safe cached defaults if the flag service is down.

| Strategy | Downtime | Rollback speed | Extra cost | Blast radius |
| --- | --- | --- | --- | --- |
| Recreate | Yes | Slow | None | 100% |
| Rolling | No | Medium | Low | Grows gradually |
| Blue-green | No | Instant | 2x during deploy | 100% at switch |
| Canary | No | Fast | Low | Tiny at first |
| Shadow | No | N/A | Extra compute | 0% |
| Feature flags | No | Instant | None | You choose |

### 31.3 Automated canary analysis

Do not compare the canary with the old fleet, whose caches are warm and uptimes long. Start a baseline group running the old version at the same time and size as the canary, so code is the only difference; Kayenta, the canary analysis system from Netflix and Google used with Spinnaker, takes this approach. Compare errors, latency (p50, p99), saturation (CPU, memory leaks, thread pools), business metrics (orders, payment success, add-to-cart) and downstream load, then pass, pause or fail. If the canary shows no new errors but 15% fewer orders than baseline, stop and roll back: many bugs fail silently. Bake time catches slow problems such as leaks; deploy markers on dashboards link incidents to releases.

```yaml
strategy:
  canary:
    steps:
      - setWeight: 5
      - pause: {duration: 10m}
      - analysis: {templates: [{templateName: error-rate-and-latency}]}
      - setWeight: 25
      - pause: {duration: 30m}
      - setWeight: 100
```

### 31.4 Waves

Never deploy everywhere at once: one box, then one zone, then a region, then low-traffic regions, then the rest a few at a time, deploying cell by cell where cells exist. Emergency security fixes get a faster but still staged lane.

### 31.5 Rollback vs roll-forward and compatibility

Roll back to the previous immutable artifact by default (mitigate first); roll forward only when a migration changed data or the old version is unsafe. Make rollback always possible with N−1 compatibility. Because old and new versions run together and microservices deploy independently: only add API fields; use a schema registry for events; expand-migrate-contract for databases; version cache keys when formats change (`menu:v2:15`); support old mobile app versions.

### 31.6 Config is code

Many large outages came from configuration pushed everywhere at once. Version config, review it, validate it automatically, roll it out in waves with canary analysis, and make reverts instant. The same applies to flags, infrastructure changes and secret rotations.

### 31.7 Gates, freezes and stateful systems

Automated gates always; lightweight human approval for payments or core databases (DORA found heavy approval boards add little safety); change freezes for IPL finals and festival sales; daytime deployment windows; error-budget policies. Drain connections before removal; use Pod Disruption Budgets; upgrade stateful systems one replica at a time, followers first; let workers finish jobs; give model servers startup probes and warm pools.

Tools: Argo CD and Flux (GitOps), Argo Rollouts and Flagger (progressive delivery), Spinnaker with Kayenta, Harness, GitHub Actions environments, GitLab, Jenkins, cloud deploy services, and flag tools such as LaunchDarkly, Unleash, Flagsmith and the OpenFeature standard.

### 31.8 Practitioner's guide

Worked example: a canary with automatic rollback.

```
v2 canary 5% + baseline v1 5% (same size, fresh pods)
metrics (10 min): 5xx 0.3% vs 0.3% ✓ · p99 410 ms vs 400 ms ✓ · orders/min −14% ✗
verdict FAIL → rollout aborted → traffic back to v1 → page owner with diff of metrics
root cause: coupon field renamed; checkout silently skipped discounts
```

| Strategy | Benefit | Cost | Use when | Avoid when |
| --- | --- | --- | --- | --- |
| Rolling | Cheap, no downtime | Mixed versions | Most stateless services | Breaking schema changes |
| Blue-green | Instant switch back | 2x infra | Big releases, easy rollback needed | Very large fleets on budget |
| Canary | Smallest blast radius | Needs metrics and traffic | High-traffic critical services | Tiny services with little traffic |
| Shadow | Zero user risk | Extra compute; side-effect care | Rewrites, ML models | Write-heavy paths without stubs |
| Feature flags | Instant on/off | Flag debt | Releases decoupled from deploys | Permanent forks of logic |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Canary too small to measure | Inconclusive results | Longer bake or larger slice |
| Rollback blocked by migration | Stuck on bad version | N−1 compatibility |
| Flag service outage | Features flip unexpectedly | Cached safe defaults |
| Global config push | Worldwide outage | Waves + validation |

### Review questions

1. A canary shows no error or latency increase but 15% fewer orders than baseline. Continue the rollout?

#### Answers

1. No: stop and roll back. A 15% drop in orders versus the baseline means the release harms the business even without errors (a hidden button, a broken coupon). Canary analysis must include business metrics such as orders, payment success and add-to-cart, because many bugs fail silently.

## Chapter 32: Sandboxes

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Run code you do not trust (user submissions, AI agents, CI jobs) without letting it harm the host, other users or your network. |
| Why it is hard | Hostile code probes every door (files, network, processes, kernel), and stronger isolation costs startup time and money. |
| How we solve it | Choose isolation by risk (process, container, gVisor, microVM), deny network egress by default, set CPU, memory, PID, disk and time limits, keep secrets out, and destroy sandboxes after use. |
| What fails, and why | Host takeover (container escape via the shared kernel), hung hosts (fork bombs without PID limits), crypto-mining bills (no CPU or egress limits), and data leaks between users (reused sandboxes). |

A sandbox is an isolated environment where code can run without harming anything outside it, like a bomb-disposal chamber that absorbs the blast. The word also means a test-mode copy of a service, covered at the end.

### 32.1 Why sandbox

Untrusted code is everywhere: AI agents running shell commands (possibly tricked by prompt injection), user code on LeetCode-style judges and notebooks, CI jobs, website JavaScript, phone apps, and suspicious files. Unsandboxed, it could delete files, steal SSH keys and cloud credentials, exfiltrate data, exhaust resources with infinite loops or fork bombs, mine crypto or attack others from your IPs, or escape to the host. The goal is that even fully malicious code stays inside the box.

### 32.2 Every door to control

| Door | Control |
| --- | --- |
| Filesystem | One folder only; system files read-only; no host secrets |
| Network | Deny by default; allowlisted domains |
| Processes | Cannot see or signal other processes |
| System calls | Only a safe subset |
| Resources | CPU, memory, disk, process count, time, output size |
| Privileges | No root; no privilege escalation |
| Credentials | No long-lived secrets; short-lived scoped tokens if needed |
| Tenants | Nothing shared between users |
| Persistence | Destroyed after use |

### 32.3 The isolation spectrum

Language-level restrictions ("disable dangerous functions") are easily bypassed and never sufficient alone.

OS process sandboxing runs as an unprivileged user with seccomp syscall filters, AppArmor, SELinux or Landlock on Linux, or Seatbelt on macOS; tools such as bubblewrap combine them. Very fast; rule gaps are the risk. It suits local tools, such as an AI coding agent confined to a project folder.

Containers use namespaces (separate views of processes, filesystem, network, hostname and users) and cgroups (resource limits), plus dropped privileges and seccomp. They start in under a second but share the host kernel, so a kernel bug could let hostile code escape; fine for your own apps, not enough alone for strangers' code. Running `--privileged` or mounting the Docker socket effectively hands out root on the host.

gVisor (from Google) is a user-space kernel in a memory-safe language that handles system calls itself, shrinking the attack surface at some performance cost.

MicroVMs (Firecracker from AWS, Kata Containers) give each sandbox its own minimal kernel with hardware virtualization isolation and near-container speed; Firecracker powers AWS Lambda and Fargate and is designed to boot in around 125 ms. A popular choice for untrusted code at scale.

Full VMs suit full desktops for computer-use agents and malware analysis. WebAssembly runs code that can do nothing unless the host grants each capability, with microsecond startup, ideal for plugins and edge functions. Air-gapped hardware serves the most sensitive cases.

| Technology | Isolation | Startup | Typical use |
| --- | --- | --- | --- |
| Process sandbox | Low-medium | Instant | Local tools, agents on laptops |
| Containers | Medium | Sub-second | Trusted workloads |
| gVisor | Medium-high | Sub-second | Multi-tenant containers |
| MicroVMs | High | \~100s of ms | Untrusted code, serverless |
| Full VMs | High | Seconds-minutes | Desktops, computer-use agents |
| WebAssembly | Capability-based | Microseconds | Plugins, edge |

The less you trust the code and the more valuable what lies outside, the stronger the walls, always layered.

### 32.4 Network and resource limits

Deny outbound traffic by default, or route it through an egress proxy with an allowlist (for example only package registries). Block cloud metadata endpoints such as `169.254.169.254` (the SSRF danger) and internal networks; restrict DNS to stop data smuggled into lookups; rate limit outbound traffic. Limit CPU time and wall-clock time (infinite loops), memory (memory bombs), process count (fork bombs), disk quota, output size and connection counts, which also prevents noisy neighbors.

### 32.5 Designing a code-execution service

Requirements: run submitted code with strong isolation between users, sub-second start, high concurrency, fair limits, low cost. Estimation: 10M executions/day is \~115/s average and \~350/s peak; at 3 seconds each, about 1,050 concurrent sandboxes, more with interactive AI sessions.

```
Client → API gateway (auth, per-user rate limits) → job queue → scheduler
 → sandbox hosts running many microVMs (warm pool or memory snapshots)
     inside: non-root, read-only base image, small writable /tmp, seccomp,
             CPU/memory/PID/disk/time limits, no or allowlisted network, no secrets
 → output streamed live (SSE/WebSocket); files to object storage
 → sandbox destroyed after the job or session
```

Key decisions: warm pools and snapshot restores for millisecond starts; one sandbox per user or session, never reused across users; idle timeouts for stateful agent sessions; popular libraries pre-baked so most jobs need no network; hosts isolated from production networks; fast kernel and hypervisor patching with drain-and-rotate.

### 32.6 Sandboxes for AI agents

Coding agents write only inside the project and reach only approved domains, so a malicious README cannot steal SSH keys. Code-interpreter tools give each conversation its own container or VM. Computer-use agents run in dedicated VMs away from personal accounts. Cloud coding agents clone into disposable sandboxes with short-lived, repo-scoped credentials. Sandboxing limits what is possible, permissions decide what is allowed, and approvals keep humans in control.

### 32.7 Sandbox environments

Payment gateways offer test API keys, test card numbers that succeed or fail on purpose, and fake webhooks; SMS and email providers capture messages; bank APIs simulate accounts. Strictly separate test and live keys (often prefixed), remember sandboxes differ from production, and use them in CI integration tests and synthetic monitoring.

Common mistakes: language-only restrictions, plain containers for hostile code, privileged containers or a mounted Docker socket, open egress, reachable metadata endpoints, secrets inside the sandbox, sandbox reuse across users, no resource limits, raw outputs in logs, and slow patching.

### 32.8 Practitioner's guide

Worked example: a code interpreter session for an AI chat.

```
User asks for a chart ─► session sandbox (Firecracker microVM restored from snapshot, ~100s of ms)
  limits: 2 vCPU · 4 GB RAM · 512 PIDs · 60 s per run · 1 GB disk · egress allowlist (pypi only)
  runs code ─► chart.png to object storage ─► link returned
Idle 10 min ─► VM destroyed; never reused for another user
```

| Aspect | Details |
| --- | --- |
| Benefits | Run untrusted code safely; contain injection damage; tenant isolation |
| Constraints | Startup latency, overhead, compatibility, cost of pools, patch cadence |
| Trade-offs | Isolation strength vs speed and density |
| Process sandbox when | Trusted user on own machine (local agent) |
| MicroVM when | Strangers' code at scale |
| Wasm when | Plugins and edge functions needing microsecond startup |
| Avoid plain containers when | Code is hostile |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Fork bomb | Host unresponsive | PID limits, cgroups |
| Crypto mining in sandboxes | CPU bills spike | CPU quotas, egress blocks, anomaly detection |
| Leftover files from previous user | Data leak | Destroy after session |
| DNS exfiltration | Data leaves via lookups | Restricted resolvers |

### Review questions

1. A teammate proposes plain Docker containers for a LeetCode-style site running strangers' code. What is the risk and the stronger option?

#### Answers

1. Plain containers share the host kernel, so a kernel vulnerability can let hostile code escape to the host and other users' data. Use microVMs (e.g. Firecracker) or gVisor, layered with non-root users, seccomp, resource limits, no secrets inside, and blocked or allowlisted network egress, destroying each sandbox after use.

## Chapter 33: Hosting a Website

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Put a website online securely and keep it running, from a static page to a dynamic app. |
| Why it is hard | Many moving parts (domain, DNS, hosting, certificates, database), and on your own server you own patching, backups and monitoring. |
| How we solve it | Pick the lowest rung that fits (static host, PaaS, serverless, VPS, cloud), automate HTTPS, run apps under a process manager behind a reverse proxy, back up off-server, and monitor uptime and disk. |
| What fails, and why | App dies when SSH closes (process tied to the terminal), site down from a full disk (no log rotation), browser warnings (certificate renewal failed), and breaches (database port open to the internet). |

Hosting means putting your site on a computer that is always on, connected to the internet, and reachable by a name. Pick the highest-level option that meets your needs; every step down gives more control and more work.

### 33.1 The pieces

The domain name is the shop's signboard; DNS is the map; the server is the building; the HTTPS certificate is the license on the wall; the CDN is the branch counters.

| Piece | What it is | Where it comes from |
| --- | --- | --- |
| Website | Files or an app | You |
| Domain | `priyabakes.in` | A registrar (yearly fee) |
| DNS records | Point the domain to hosting | Registrar or DNS provider |
| Hosting | Where the site runs | Static host, PaaS, VPS or cloud |
| Certificate | TLS identity and encryption | Usually free and automatic (Let's Encrypt or the host) |
| CDN (optional) | Global speed, DDoS protection | Often built in |
| Database (optional) | Dynamic data | Managed database |

| Record | Meaning | Example |
| --- | --- | --- |
| A | Name to IPv4 | `priyabakes.in → 203.0.113.10` |
| AAAA | Name to IPv6 | `→ 2001:db8::10` |
| CNAME | Alias to another name | `www → priyabakes.netlify.app` |
| TXT | Verification, email security | Ownership proofs, SPF |
| MX | Mail servers | `mail.provider.com` |

DNS changes can take minutes to hours to spread because of TTL caching.

### 33.2 What kind of site?

Static sites (HTML, CSS, JS, images, many single-page apps) are easiest, cheapest, fastest and hardest to hack. Dynamic sites run server code per request, often with a database (logins, carts, dashboards). Hybrids combine a static frontend with serverless functions or an API; frameworks such as Next.js mix static pages, server rendering and API routes.

### 33.3 The hosting ladder

| Option | You manage | Best for | Examples |
| --- | --- | --- | --- |
| Static hosting | Almost nothing | Static sites, SPAs, blogs | GitHub Pages, Netlify, Vercel, Cloudflare Pages, S3 + CloudFront |
| PaaS | Your code | Dynamic apps without server work | Render, Railway, Fly.io, Heroku, App Engine, Elastic Beanstalk |
| Serverless / managed containers | Code or containers | Spiky traffic, pay per use | AWS Lambda, Cloud Run, Azure Container Apps |
| VPS | OS, security, runtime, updates | Learning, full control | DigitalOcean, Linode, Hetzner, Lightsail, EC2 |
| Full cloud architecture | Everything, with managed parts | Large-scale production | AWS, GCP, Azure, often Kubernetes |
| Your own hardware | Literally everything | Hobby and learning | A Raspberry Pi at home |

Many hosts have free tiers; check current pricing.

### 33.4 Walkthrough: a static site

Put the site in a GitHub repo; sign up with a static host and import the repo; set a build command and output folder for React or Vue (`npm run build`, `dist`); deploy to get a free URL with HTTPS and a CDN; add a custom domain with the CNAME and A or alias records the host shows; HTTPS is issued automatically; every `git push` redeploys and pull requests get preview URLs.

### 33.5 Walkthrough: a dynamic app on a VPS

```
Internet → DNS → VPS public IP
  → firewall (only 22, 80, 443 open)
  → Nginx (reverse proxy + HTTPS) → app on localhost:3000 (kept alive by systemd)
  → database (local, or better a managed database)
```

Create an Ubuntu VPS with your SSH public key. Secure it: create a day-to-day sudo user, set `PermitRootLogin no` and `PasswordAuthentication no`, update packages, and enable a firewall allowing only SSH and web traffic (`ufw allow OpenSSH`, `ufw allow 'Nginx Full'`, `ufw enable`); consider automatic security updates and fail2ban. Bots attack new servers within minutes.

Install the runtime, clone the app, install dependencies, keep secrets in environment variables. Running `node server.js` in an SSH terminal dies when the session closes, the app crashes or the server reboots; run it as a systemd service instead:

```ini
[Unit]
Description=My web app
[Service]
User=deploy
WorkingDirectory=/home/deploy/app
ExecStart=/usr/bin/node server.js
Restart=always
Environment=NODE_ENV=production
[Install]
WantedBy=multi-user.target
```

Then `sudo systemctl enable --now myapp`. Alternatives are pm2 or Docker with a restart policy.

Put Nginx in front as a reverse proxy, because it handles slow clients, TLS, compression, static files and rate limiting, and can load balance later:

```nginx
server {
    server_name priyabakes.in www.priyabakes.in;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Test with `nginx -t`, reload, point A records at the VPS, and run `certbot --nginx -d priyabakes.in -d www.priyabakes.in` for a free Let's Encrypt certificate with automatic renewal (expired certificates are a classic outage). Then add the parts people forget: off-server, tested database backups; uptime and disk monitoring (full disks kill small servers); log rotation; regular patching; and scripted or CI/CD deploys. Every PaaS performs exactly these steps on your behalf.

### 33.6 The PaaS path and growth

Connect a repo; the platform detects the language or uses your Dockerfile; add a managed database, environment variables and a custom domain; pushes to `main` deploy automatically. You trade some control and cost at scale for skipping OS, Nginx and certificate work.

As traffic grows, add the course's layers: GeoDNS, CDN with WAF, load balancers with health checks, stateless auto-scaled app servers, Redis, a managed primary-replica database, queues and workers, observability, and CI/CD with canaries. Start simple and add layers when traffic demands them.

Security checklist: HTTPS with redirects; SSH keys only, no root login, minimal ports; updates; secrets in environment or a manager; database never exposed publicly; tested off-server backups; CDN/WAF; rate-limited logins and forms; uptime and certificate-expiry monitoring; least-privilege cloud accounts with MFA.

| Situation | Pick |
| --- | --- |
| Portfolio, blog, docs | Static hosting |
| Frontend plus external APIs | Static hosting (+ serverless functions) |
| Small dynamic app, minimal ops | PaaS + managed DB |
| Spiky traffic | Serverless / managed containers |
| Learning Linux, full control | VPS + Nginx + systemd or Docker |
| Large company, high scale | Full cloud architecture |

### 33.7 Practitioner's guide

Worked example: growing a bakery site over three years.

```
Year 1: static site on a free host + Google Form for orders           (₹0/month)
Year 2: PaaS app + managed Postgres + payments integration             (low monthly cost)
Year 3: CDN + 2 app instances + Redis cache + daily backups + uptime alerts
```

| Option | Benefits | Constraints | Use when | Avoid when |
| --- | --- | --- | --- | --- |
| Static host | Free, fast, secure | No server code | Content sites | Logins, databases |
| PaaS | No ops | Cost at scale, less control | Small dynamic apps | Special hardware needs |
| Serverless | Pay per use, auto-scale | Cold starts, time limits | Spiky APIs | Long-running or stateful jobs |
| VPS | Full control, cheap | You patch and secure | Learning, steady small apps | No ops skills or time |
| Full cloud | Any scale | Complexity | Large production | Tiny projects |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Disk full on VPS | Site down | Log rotation, disk alerts |
| Certificate renewal failed | Browser warnings | Certbot timer + expiry alert |
| DB port open to internet | Breach | Firewall, private networking |
| Single VPS dies | Hours of downtime | Backups + a second instance or PaaS |

### Review questions

1. An app run with `node server.js` over SSH dies when the laptop closes. Why, and which tools fix it?

#### Answers

1. The process belongs to the SSH session, so closing the terminal (or a crash or reboot) kills it. Run it under a process manager that starts it at boot and restarts it on failure: systemd (or pm2, or Docker with a restart policy), with Nginx in front as a reverse proxy handling HTTPS.
