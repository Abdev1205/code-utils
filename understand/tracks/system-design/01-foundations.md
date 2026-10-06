# Part I: Foundations

**Topic:** System design
**Covers:** What Is System Design; The Client-Server Model; How the Internet Works; APIs: REST, GraphQL and gRPC; TLS, Authentication and API Design in Depth
**Source:** [Claude artifact](https://claude.ai/artifact/7xxGdVxPGbUiPY13z4MdZ2) — written by a colleague, mirrored here for study.

## Chapter 1: What Is System Design

System design is deciding how the parts of a software system (clients, servers, databases, caches, queues) fit together so it meets its goals for users, scale, reliability and cost. Every design is a set of trade-offs, and good designers make them deliberately, with numbers.

##### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Turn a vague idea ("build a food delivery app") into a system that works for millions of users, within budget and deadlines. |
| Why it is hard | Goals conflict: faster usually costs more, stronger consistency is usually slower, more flexibility adds complexity, and requirements change as the product grows. |
| How we solve it | Write requirements with numbers, estimate load, design the simplest architecture that meets them, then deepen the bottlenecks and state each trade-off. |
| What fails, and why | Over-engineering (designing for imagined scale), under-engineering (no numbers, so the first spike breaks it), and ignored constraints (cost, team size, regulation). All three come from skipping requirements and estimation. |

### 1.1 Why system design matters

A single program on one laptop can serve a few users. When thousands or millions of people use it at once, new problems appear: one machine is not powerful enough, machines fail, users are far apart, data grows without limit, and some operations (payments) must never be wrong while others (like counts) can be slightly stale. System design is the discipline of handling these problems on purpose instead of discovering them in production.

Example: a canteen ordering app for 500 students runs happily on one small server. If the same app is opened to a city festival with 50,000 visitors, the database, the server and the payment provider all hit limits within minutes. Nothing in the code is "wrong"; the design simply never considered that load.

### 1.2 The six qualities every design balances

| Quality | Meaning | How it is measured | Example target |
| --- | --- | --- | --- |
| Scalability | Handling more load by adding resources | Requests per second served as machines are added | 10x traffic with roughly 10x servers |
| Availability | Being up and reachable | Percentage of time working ("nines") | 99.9% = about 8.8 hours of downtime per year |
| Reliability | Producing correct results consistently | Error rates, data-loss incidents | No lost orders, no double charges |
| Latency | How fast a single request completes | Percentiles: p50, p95, p99 | p99 page load under 500 ms |
| Maintainability | How easily people can change and operate it | Deploy frequency, time to fix bugs | Ship daily without fear |
| Cost | Money spent on infrastructure and people | Cost per request or per user | Under ₹2 per order in infrastructure |

These pull against each other. More replicas raise availability and cost. Stronger consistency raises reliability and latency. More abstraction raises flexibility and complexity.

### 1.3 Trade-offs in practice

| Decision | Option A | Option B | How to choose |
| --- | --- | --- | --- |
| Consistency | Strong: everyone sees the latest data | Eventual: copies catch up later | Strong for money and bookings; eventual for feeds and likes |
| Architecture | Monolith: one deployable unit | Microservices: many services | Monolith for small teams; split when teams and scale demand it |
| Database | SQL with transactions | NoSQL with flexible scale | By access pattern and correctness needs |
| Processing | Synchronous (answer now) | Asynchronous (queue, answer later) | Async for work the user need not wait for |
| Caching | Fresh data, slower | Cached data, faster but may be stale | Cache what can tolerate staleness |

Instagram, for example, accepts that followers may see a new post a few seconds apart, in exchange for low latency and high availability; a bank transfer accepts slower confirmation in exchange for never being wrong.

### 1.4 Functional and non-functional requirements

Functional requirements say what the system does; non-functional requirements say how well.

| Food delivery example | Functional | Non-functional |
| --- | --- | --- |
| Ordering | Users can browse restaurants, add items, pay and track orders | Order placement p99 under 1 s; no duplicate orders |
| Scale | Restaurants manage menus | 10M daily users; dinner peak 3x average |
| Reliability | Riders accept deliveries | 99.95% availability for ordering and payment |
| Data | Users see order history | Payments strongly consistent; menus may be 60 s stale |

Writing non-functional requirements with numbers is what turns opinions into decisions: "fast" cannot be designed for, "p99 under 300 ms" can.

### 1.5 A repeatable design framework

1. Clarify requirements: users, core features, what is out of scope.
2. Write non-functional targets with numbers: scale, latency, availability, consistency.
3. Estimate load: requests per second, storage, bandwidth (Chapter 27).
4. Define APIs: the main endpoints and their inputs and outputs.
5. Design the data model: entities, keys, access patterns.
6. Draw the high-level architecture: clients, load balancers, services, stores, caches, queues.
7. Deep dive into the hardest parts: the bottlenecks your estimates revealed.
8. Address failures: what breaks, how it is detected, how the system degrades.
9. State trade-offs and how the design would evolve with growth.

### 1.6 Worked example: a canteen app grows into a festival app

**Version 1 (500 students).** One server runs the app and a PostgreSQL database. About 1 request per second at lunch. Simple, cheap, and correct.

**The new requirement.** A city festival will use the app: 50,000 visitors, most ordering in a 2-hour window.

```
Requests:   50,000 users × 20 requests each ÷ 7,200 s ≈ 140 requests/s average
Peak:       ×3 in the busiest 15 minutes ≈ 400 requests/s
Orders:     50,000 × 1.5 orders ÷ 7,200 s ≈ 10 orders/s; peak ≈ 30/s
Payments:   provider allows 20 requests/s on the current plan  ← constraint found by estimation
```

**Design decisions.**

| Need | Decision | Trade-off accepted |
| --- | --- | --- |
| 400 requests/s | 4 stateless app servers behind a load balancer | More cost and moving parts |
| Menu reads dominate | Cache menus for 10 s | Sold-out items may show for 10 s; checkout re-validates |
| Payment limit 20/s | Queue payments and upgrade the provider plan | Some users wait a few seconds for confirmation |
| Must not lose orders | Database transactions and idempotency keys | Slightly more complex code |
| Budget ₹20,000 | Rent capacity only for the festival week | Manual scale-down afterwards |

### 1.7 Practitioner's guide

| Aspect | Details |
| --- | --- |
| Benefits of designing deliberately | Shared vocabulary, decisions backed by numbers, fewer surprises in production |
| Constraints to list first | Budget, team size and skills, deadlines, regulation, existing systems |
| Typical trade-offs | Speed vs cost, consistency vs availability, simplicity vs flexibility |
| Use formal design when | Many users, money or safety involved, several teams, long-lived systems |
| Keep it light when | Prototypes, hackathons, internal tools for a few people |

### 1.8 Production incident deep dive

**Incident: a festival app collapses on launch night.** The team designed for "lots of users" without numbers; the festival brought 40x normal traffic in 10 minutes.

| Time | What happened | Why |
| --- | --- | --- |
| 19:00 | Ticket sale opens; requests jump from 50/s to 2,000/s | Marketing push nobody shared with engineering |
| 19:02 | p99 latency goes from 400 ms to 9 s | One database, no read replicas, no cache |
| 19:05 | Payment provider rate-limits the app (HTTP 429) | Provider quota never checked against expected peak |
| 19:08 | Retries from phones triple the load | Clients retried instantly with no backoff |
| 19:40 | Recovered after a waiting room and extra capacity | Mitigation, not design |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| No capacity numbers | Latency and error alerts at peak | Requirements had no QPS or peak factor | Whole product | Waiting room; shed non-critical features | Estimate peaks; load test at 2-3x |
| Hidden dependency limits | 429s from a third party | Provider quotas not part of the design | Features using it | Queue and pace calls | List every dependency's limits; negotiate quotas |
| No SLO | Arguments about whether it is "down" | Nobody defined good enough | Slow decisions | Use user-facing error rate as the signal | Write SLOs with error budgets |
| Cost surprise | Bill spikes after the event | Auto-scaling without budgets | Finance | Scale-down policies | Cost estimates per design option; budget alerts |
| Gold-plating | Months spent on infrastructure for 500 users | Designing for imagined scale | Delivery speed | Cut scope | Design for about 10x current scale, not 1,000x |

**Production readiness checklist**

- Peak requests per second, storage and growth written down, with a peak factor
- SLOs for the critical user journeys
- Every external dependency listed with its limits and failure behavior
- Load test passed at 2-3x the expected peak
- Known risks and trade-offs recorded in a decision log

### Review questions with detailed answers

##### Q1. Give two functional and two non-functional requirements for Instagram.

**Short answer.** Functional: users can upload photos; users can follow others and see a feed. Non-functional: a photo upload completes in under 2 seconds; the feed loads in under 1 second at p99 with 99.99% availability.

**Detailed explanation.** Functional requirements are features a user can point to: upload, follow, like, comment, message. Non-functional requirements describe qualities across all features: speed (latency targets as percentiles), scale (daily users, uploads per day), availability (nines), durability (photos never lost), and consistency (how quickly a new post appears to followers). Interviewers look for numbers: "the feed should be fast" is not designable; "p99 feed load under 1 s for 500M daily users" is, because it implies caching, precomputed feeds and CDNs.

**If the interviewer pushes.** "Which non-functional requirement drives the architecture most?" The read-heavy feed at huge scale: reads outnumber writes by hundreds to one, which pushes the design toward caching, CDNs and precomputation.

##### Q2. What does Instagram trade away, and what does it gain?

**Short answer.** It gives up strict consistency (followers may see a new post seconds apart or in slightly different order) to gain low latency and high availability.

**Detailed explanation.** With strong consistency, every read would need to see the latest write everywhere, which means coordinating replicas across regions before answering, adding latency, and refusing requests during network problems. For a social feed, a few seconds of staleness hurts nobody, so the system writes to one place and lets copies, caches and feeds catch up asynchronously (eventual consistency, Chapter 14). The same app treats other data differently: account settings and payments need stronger guarantees.

**If the interviewer pushes.** "Where would eventual consistency be unacceptable?" Wallet balances, ticket and seat inventory, and anything where two people acting on stale data causes real harm.

##### Q3. Why write non-functional requirements with numbers?

**Short answer.** Numbers turn opinions into design decisions and make success testable.

**Detailed explanation.** "Fast and scalable" leads to endless debate. "400 requests per second at peak, p99 under 300 ms, 99.9% availability" tells you how many servers you need, whether a cache is required, whether one database suffices, and what to load test. It also tells you when to stop: if the design meets the numbers, extra complexity is waste.

**If the interviewer pushes.** "What if you don't know the numbers?" Estimate from comparable products and state your assumptions out loud; adjust the design if the interviewer changes them.

## Chapter 2: The Client-Server Model

Almost every app is a conversation between clients (phones, browsers) that ask and servers that answer. Understanding that conversation, and where the system remembers things between requests, explains why modern servers are built to be stateless and replaceable.

##### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Millions of phones must share the same data and logic safely, without each phone holding everything. |
| Why it is hard | Clients are untrusted, often offline and on slow networks; servers must recognize users across requests while staying replaceable. |
| How we solve it | Thin clients talk to servers over a request-response protocol; servers are stateless and keep state in shared stores; several servers sit behind a load balancer. |
| What fails, and why | Single-server outages (one point of failure), lost sessions (state kept in server memory), and wrong UI after optimistic updates (the server rejected the change). |

### 2.1 The request-response cycle, step by step

When Priya taps the heart on a photo:

1. The app builds a request: `POST /v1/posts/77/likes` with her login token.
2. The request travels over HTTPS to the server (Chapter 3 explains the network path).
3. The server authenticates the token and checks she is allowed to like the post.
4. The server writes the like to the database, ignoring a duplicate if she already liked it (idempotency).
5. The server returns `201 Created` with the new like count.
6. The app updates the screen.

Every feature, from login to payment, follows this same shape: request, validate, work, respond.

### 2.2 Three layers

| Layer | Lives in | Responsibility | Example |
| --- | --- | --- | --- |
| Presentation | App or browser | Show data, collect input | The like button and counter |
| Application (logic) | Servers | Rules, validation, orchestration | "A user may like a post once" |
| Data | Databases, caches, storage | Durable truth | The likes table |

Keeping rules on the server matters because clients are untrusted: anyone can modify an app or send requests directly. A price, a discount or a permission check computed only on the phone can be faked.

### 2.3 Optimistic updates

To feel instant, many apps update the screen before the server confirms (the heart turns red immediately). If the server rejects the request, the app must undo the change and tell the user. Use optimistic updates for low-risk actions (likes, bookmarks) and never for money: showing "Paid" for a payment that failed causes real harm.

### 2.4 Stateful versus stateless servers

State is anything the system must remember between requests: who is logged in, what is in the cart, which connection belongs to which user. The design question is not whether state exists but where it lives.

A stateless server keeps nothing in its own memory between requests. Each request carries proof of identity (a signed token) and the server reads everything else from shared stores. Any server can answer any request.

> *Diagram in the original artifact: Stateless servers · two requests, two servers, one shared cart*

A stateful server keeps information in memory, so the next request must return to the same server. If it lands elsewhere, the user's cart or session is missing.

> *Diagram in the original artifact: Stateful server · the problem and two fixes*

Where state can live instead of server memory:

> *Diagram in the original artifact: Where state lives · client, app tier, four shared stores*

| Kind of state | Example | Typical home |
| --- | --- | --- |
| Session state | Logged-in user, cart, form step | Signed token, Redis, database |
| Connection state | An open WebSocket or live call | The server holding the connection |
| Application state | Rate-limit counters, feature flags | Redis, configuration service |
| Persistent data | Orders, payments, profiles | Database |

Some things are inherently stateful (WebSocket connections, databases, game rooms). For those, the goal is to make state recoverable and routable: connection registries, consistent hashing, replication and checkpoints.

| Aspect | Stateless | Stateful |
| --- | --- | --- |
| Benefits | Add or remove servers freely; crashes lose nothing; simple load balancing | Fast local access; natural for live connections |
| Constraints | Every request needs identity and lookups; shared stores become critical | Sticky routing; harder scaling; draining on deploys |
| Use when | Web and API tiers, microservices, serverless | WebSockets, game servers, databases, stream processors |

### 2.5 Single points of failure

If one server does everything, its failure is everyone's outage. The first step of almost every design is to run at least two stateless servers behind a load balancer (Chapter 7) and to replicate the database (Chapter 12), so no single machine can take the product down.

### 2.6 Worked example: a stateless banking login

**Problem statement.** Priya logs in once, then checks her balance and transfers money. Each request lands on whichever server the load balancer picks. Every server must recognize her, and no server may act on a request it cannot verify.

**Why it is hard.** If Server A remembers the login in memory, a request routed to Server C finds nothing. A shared session database works, but every request pays a lookup. Anything the phone sends can be forged, so identity must be provable.

> *Diagram in the original artifact: Stateless banking login · three requests across three servers*

**How the design solves it, step by step.**

1. Login: the app sends email and password over TLS. Server A checks the bcrypt hash and signs a JWT containing `sub: 42` and an expiry 15 minutes ahead (Chapter 5).
2. The app stores the token in the phone's secure storage.
3. Balance: the request reaches Server C with `Authorization: Bearer <token>`. Server C verifies the signature and expiry with no session lookup, then reads the balance.
4. Transfer: Server B verifies the same token, checks that account 42 owns the source account, and debits and credits in one database transaction with an idempotency key.
5. After 15 minutes the app silently exchanges its refresh token for a new access token.

| Failure | What the user sees | Why it happens | Fix |
| --- | --- | --- | --- |
| Session kept in server memory | Random logouts | The next request lands on a server that never saw the login | Signed tokens or a shared session store |
| Stolen token | Attacker acts as the user | Bearer tokens are trusted until they expire | Short expiry, refresh rotation, secure storage |
| Server clocks drift | Valid tokens rejected | Each server compares expiry with its own clock | Time sync with a small skew allowance |
| Transfer retried after a timeout | Money moved twice | The app cannot tell if the first attempt succeeded | Idempotency key with a unique constraint |
| Optimistic update on payment | "Paid" shown for a failed payment | Screen updated before confirmation | Wait for confirmation on money |
| Phone offline mid-action | Action disappears | Request failed and nothing retried | Local queue replayed with idempotency keys |

### 2.7 Practitioner's guide

| Aspect | Details |
| --- | --- |
| Benefits | Central data and rules, security, upgrades without app updates |
| Constraints | Network latency, offline phones, server capacity |
| Trade-offs | Thin client (simple, needs network) vs thick client (offline-capable, complex sync) |
| Stateless when | Web and API tiers that must scale horizontally |
| Stateful when | Long-lived connections, with state replicated or rebuildable |
| Optimistic UI when | Low-risk actions; never for payments |

### 2.8 Production incident deep dive

**Incident: a routine deploy logs out 2 million users.** Sessions lived in each server's memory; a rolling restart wiped them.

| Time | What happened | Why |
| --- | --- | --- |
| 14:00 | Rolling deploy starts, 10% of servers at a time | Normal release |
| 14:01 | Login requests rise 20x | Restarted servers forgot their users' sessions |
| 14:03 | Auth database CPU at 100% | Millions of re-logins run deliberately slow password hashing |
| 14:05 | Apps retry login in tight loops | No backoff or jitter in the client |
| 14:30 | Deploy paused, auth capacity raised, retries throttled | Mitigation |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Session loss on restart | Login spike after deploys | State in process memory | Users on restarted servers | Pause deploy | Stateless servers with tokens or Redis sessions |
| Client retry storm | Requests far above user count | Retries without backoff | Every backend | Rate limit per device | Exponential backoff with jitter in the client SDK |
| API and app version skew | Errors only on old app versions | Old apps call changed endpoints | Users who have not updated | Roll back the API | Backward-compatible APIs; minimum supported version |
| Half-open connections | Requests hang then time out | Mobile networks drop silently | Affected users | Lower client timeouts | Timeouts on every call; heartbeats on long connections |

**Production readiness checklist**

- No user state kept in server memory between requests
- Client SDK has timeouts, backoff and jitter
- Deploys tested for session survival
- Old app versions tested against the new API
- Login path load-tested at many times normal rate

### Review questions with detailed answers

##### Q1. Walk through what happens when a user likes a photo.

**Short answer.** The app sends an authenticated request; the server validates it, records the like idempotently in the database, and returns the new count; the app updates the screen.

**Detailed explanation.** The app sends `POST /v1/posts/77/likes` with the user's token over HTTPS. The server verifies the token (who is this?), checks permissions (can this user see this post?), and inserts a row into a likes table with a unique constraint on (user, post), so a double tap or retry does not create two likes. It increments or recomputes the count, then responds `201 Created` with the count. Many apps show the red heart immediately (optimistic update) and revert it if the request fails.

**If the interviewer pushes.** "How would you scale like counts for a viral post?" Store per-user like rows for correctness and keep the count in sharded counters or a cache updated asynchronously, because millions of updates to one row would become a hot spot.

##### Q2. One server runs your whole app and it crashes. What is the problem and the first fix?

**Short answer.** It is a single point of failure: everyone is down. Run at least two stateless servers behind a load balancer, and replicate the database.

**Detailed explanation.** Hardware fails, deploys go wrong, and operating systems need restarts. With one server, each of these is a full outage. Two or more servers behind a load balancer that health-checks them let one fail while others serve traffic. This only works if servers are stateless; otherwise users lose sessions when a server dies. The database is the next single point of failure, solved with a standby replica and automatic failover.

**If the interviewer pushes.** "Is the load balancer itself a single point of failure?" It can be; managed cloud load balancers run redundantly across zones, and self-hosted ones run as active-passive pairs.

##### Q3. Why should prices and discounts be computed on the server, not the app?

**Short answer.** Clients are untrusted: anyone can modify an app or send crafted requests, so business rules must be enforced where the attacker cannot change them.

**Detailed explanation.** If the app sends "total: ₹10" and the server trusts it, a modified app can buy a ₹900 order for ₹10. The server must recompute the total from item IDs, current prices, offers and taxes, and use its own result. The app can still show an estimate for speed, but the server's number is the only one charged.

**If the interviewer pushes.** "What else must never be trusted from the client?" User IDs in request bodies (take identity from the token), permissions, and any limits such as coupon usage.

## Chapter 3: How the Internet Works

Every request crosses the internet using a small set of ideas: addresses (IP), names (DNS), programs (ports), delivery styles (TCP and UDP), a request language (HTTP) and encryption (TLS). Knowing them lets you reason about latency, failures and security in any design. The Networking in Depth tab goes further on each.

##### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Deliver a request from a phone in Bengaluru to the right program on the right server anywhere in the world, reliably and privately. |
| Why it is hard | Billions of machines, changing addresses, lossy networks, long distances and attackers listening in. |
| How we solve it | IP routes packets, DNS turns names into addresses, ports pick programs, TCP or UDP trade reliability for speed, HTTP structures requests, TLS encrypts them. |
| What fails, and why | Stale DNS after migrations (long caching), slow pages (several round trips before data), wrong status codes (errors returned as 200), expired certificates (manual renewal). |

### 3.1 IP addresses and packets

Every device on the internet has an IP address (IPv4 such as 203.0.113.20, or IPv6 such as 2001:db8::1). Data travels in packets of up to about 1,500 bytes, each carrying a source and destination address. Routers forward each packet one hop closer to its destination; no router knows the whole path. A 100 KB web page becomes about 70 packets.

### 3.2 DNS: names to addresses

Humans use names (api.example.com); networks use addresses. DNS resolves names through a hierarchy, with caching at every level.

1. The app asks the operating system, which asks a recursive resolver (your ISP's or a public one).
2. On a cache miss, the resolver asks a root server for the .com servers.
3. The .com servers point to example.com's authoritative servers.
4. The authoritative server returns the address and a TTL, for example 300 seconds.
5. The resolver caches it; later users get the answer instantly.

Caching makes DNS fast but slow to change: if the TTL is a day, some users keep using the old address for a day after you change it. Lower TTLs before migrations.

### 3.3 Ports

An IP address finds the machine; a port number finds the program on it. HTTPS servers listen on 443, plain HTTP on 80, PostgreSQL on 5432, Redis on 6379. A connection is identified by source IP, source port, destination IP and destination port.

### 3.4 TCP versus UDP

|  | TCP | UDP |
| --- | --- | --- |
| Delivery | Reliable, ordered, retransmits lost packets | Best effort: may lose or reorder |
| Setup | Three-way handshake (one round trip) | None |
| Overhead | Higher | Minimal (8-byte header) |
| Use for | Payments, APIs, web pages, file transfer, messaging | Video calls, games, live streams, DNS queries |

For a video call, a frame that arrives late is useless, so UDP skips it and moves on. For a UPI payment, every message must arrive in order, so TCP's reliability is worth the extra milliseconds.

### 3.5 HTTP: methods and status codes

| Method | Meaning | Safe to retry? |
| --- | --- | --- |
| GET | Read | Yes |
| POST | Create or trigger an action | Only with an idempotency key |
| PUT | Replace | Yes (idempotent) |
| PATCH | Partly update | Depends |
| DELETE | Remove | Yes (idempotent) |

| Class | Meaning | Examples |
| --- | --- | --- |
| 2xx | Success | 200 OK, 201 Created, 202 Accepted, 204 No Content |
| 3xx | Redirect or cached | 301/308 permanent, 302/307 temporary, 304 Not Modified |
| 4xx | Client's fault | 400 bad input, 401 not logged in, 403 not allowed, 404 not found, 409 conflict, 429 too many requests |
| 5xx | Server's fault | 500 error, 502 bad gateway, 503 unavailable, 504 gateway timeout |

Correct codes matter: clients decide whether to retry by them (retry 503, never 400), and monitoring counts errors by them.

### 3.6 HTTPS and TLS

HTTPS is HTTP inside TLS, which gives confidentiality (nobody can read it), integrity (nobody can change it unnoticed) and authentication (you are talking to the real site, proven by its certificate). Chapter 5 and the Networking tab walk through the handshake.

### 3.7 Worked journey: opening a website

| Step | What happens | Typical time (illustrative) |
| --- | --- | --- |
| 1 | DNS lookup (often cached) | 0-50 ms |
| 2 | TCP handshake | 1 round trip, \~20-30 ms in-country |
| 3 | TLS handshake | 1 round trip, \~20-30 ms |
| 4 | HTTP request and server work | Round trip plus server time |
| 5 | More requests for images, scripts, APIs, often over the same connection | Varies |

A new connection costs DNS plus two or three round trips before the first useful byte, which is why connection reuse, CDNs near users and HTTP/3 matter.

### 3.8 Practitioner's guide

| Aspect | Details |
| --- | --- |
| DNS trade-off | Long TTL: fast and cheap but slow to change; short TTL: agile but more lookups |
| TCP or UDP | TCP for anything that must arrive; UDP when late data is worthless |
| Connections | Reuse with keep-alive and pools; avoid a new TCP+TLS handshake per request |
| Status codes | 4xx for client mistakes, 5xx for server faults, never errors with 200 |

### 3.9 Production incident deep dive

**Incident: a TLS certificate expires at midnight.** Renewal was manual and the reminder went to an engineer who had left.

| Time | What happened | Why |
| --- | --- | --- |
| 00:00 | Every HTTPS request fails with a certificate error | Certificate expired |
| 00:04 | Apps show "cannot connect"; browsers show a warning | Clients correctly refuse expired certificates |
| 00:20 | On-call paged by synthetic monitoring | No expiry alert existed |
| 00:55 | New certificate deployed | Manual process, credentials hard to find |

| Failure mode | Detection | Why it happens | Fix |
| --- | --- | --- | --- |
| Certificate expiry | Synthetic HTTPS checks fail | Manual renewal | Automated renewal and alerts at 30, 14 and 7 days |
| Stale DNS | Some users hit the old server | Long TTL cached | Lower TTL before changes; keep the old target alive |
| Port exhaustion | "Cannot assign address" errors | New connection per request | Connection pooling and keep-alive |
| Intermittent 502s | Low steady 502 rate | Backend closes idle connections before the proxy does | Backend keep-alive longer than proxy idle timeout |
| Errors hidden as 200 | Monitors green, users failing | Wrong status codes | Correct 4xx and 5xx semantics |

### Review questions with detailed answers

##### Q1. Should a video call use TCP or UDP? A UPI payment?

**Short answer.** Video calls use UDP because late frames are useless; payments use TCP because every message must arrive, in order, confirmed.

**Detailed explanation.** TCP retransmits a lost packet and holds back everything after it until the gap is filled. In a call, that means freezing to deliver a frame from 200 ms ago, which nobody wants; better to skip it and show the next frame. Video and voice stacks such as WebRTC run over UDP and handle loss themselves. A payment message, by contrast, must never be lost or reordered, and a few extra milliseconds are irrelevant, so it runs over TCP (inside HTTPS), with idempotency keys on top for safe retries.

**If the interviewer pushes.** "HTTP/3 runs over UDP. Is it unreliable?" No: QUIC adds reliability and ordering per stream on top of UDP, avoiding TCP's whole-connection blocking.

##### Q2. Which status codes for: a deleted post, a crashed database, and too many requests?

**Short answer.** 404 (or 410) for the deleted post, 500 or 503 for the crashed database, 429 for too many requests.

**Detailed explanation.** The deleted post is the client asking for something that no longer exists: a 4xx. The database crash is the server's failure: a 5xx; 503 signals temporary unavailability, so clients may retry later. Too many requests is a client exceeding a limit: 429, ideally with a Retry-After header. Getting these right lets clients retry only what is retryable and lets dashboards separate user mistakes from outages.

**If the interviewer pushes.** "401 versus 403?" 401: not authenticated (no or invalid credentials). 403: authenticated, but not allowed.

##### Q3. Why does DNS caching exist, and what does it cost?

**Short answer.** Caching makes lookups nearly instant and protects DNS servers from billions of repeated queries; the cost is that changes take up to the TTL to reach everyone.

**Detailed explanation.** Without caching, every page load would walk root, TLD and authoritative servers, adding tens of milliseconds and overwhelming the system. With caching at the browser, operating system and resolver, most lookups are answered locally. When you move a service to a new IP, though, users with cached answers keep going to the old address until the TTL expires. Plan migrations by lowering the TTL a day or two in advance.

## Chapter 4: APIs: REST, GraphQL and gRPC

An API is the contract between a client and a server: which requests exist, what they accept and what they return. Good APIs are predictable, versioned, paginated, authenticated and safe to retry.

##### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Let apps and services ask each other for data and actions through a stable contract. |
| Why it is hard | Many clients with different needs, old app versions that never update, network retries, and huge result lists. |
| How we solve it | Choose a style per use (REST, GraphQL, gRPC), version APIs, paginate with cursors, authenticate every call, and make writes idempotent. |
| What fails, and why | Duplicate charges (retries without idempotency keys), crashing old apps (breaking changes), slow screens (too many calls or over-fetching), database overload from GraphQL N+1 queries. |

### 4.1 REST

REST models resources as nouns in URLs and uses HTTP methods as verbs.

| Action | Request |
| --- | --- |
| List restaurants near a location | `GET /v1/restaurants?lat=12.97&lng=77.59&cuisine=south_indian` |
| One restaurant's menu | `GET /v1/restaurants/15/menu` |
| Place an order | `POST /v1/orders` with `Idempotency-Key` |
| Cancel an order | `PATCH /v1/orders/88` with `{"status": "cancelled"}` |
| A user's orders | `GET /v1/users/42/orders?cursor=...&limit=20` |

Rules: plural nouns, path parameters identify a resource, query parameters filter or sort, methods carry the action (never `/getOrders` or `/deleteOrder`), correct status codes.

### 4.2 GraphQL

The client asks for exactly the fields it needs, in one request:

```graphql
query {
  restaurant(id: 15) {
    name
    rating
    menu(first: 5) { name price }
    offers { code }
  }
}
```

It shines when many screens need different shapes of data (mobile apps). Costs: HTTP caching is harder (everything is one POST endpoint), and naive resolvers cause the N+1 problem: fetching 20 restaurants, then one query per restaurant for its menu = 21 queries. A batching layer (DataLoader) turns those into 2. Query depth and cost limits stop abusive queries.

### 4.3 gRPC

gRPC uses binary Protocol Buffers over HTTP/2: compact, fast, strongly typed, with streaming. It is the usual choice for internal service-to-service calls. Browsers need a proxy to use it, so public APIs usually stay REST or GraphQL.

|  | REST | GraphQL | gRPC |
| --- | --- | --- | --- |
| Strength | Simple, cacheable, universal | Exact data in one round trip | Fast, typed, streaming |
| Weakness | Over- or under-fetching | Complex server, weak HTTP caching | Poor browser support, binary debugging |
| Best for | Public APIs, CRUD | Varied client screens | Internal high-volume calls |

### 4.4 Versioning

Old app versions stay installed for years. Never rename or remove fields in place. Add new fields alongside old ones; introduce `/v2` only for truly breaking changes and keep `/v1` running until usage drops. Contract tests against the oldest supported client catch accidental breaks.

### 4.5 Pagination

| Style | How | Problem |
| --- | --- | --- |
| Offset | `?page=50&size=20` → `OFFSET 980` | Slow on deep pages; duplicates or gaps when rows are inserted while scrolling |
| Cursor | `?after=<last id or timestamp>&limit=20` | Stable and fast; cannot jump to page 50 |

Use cursors for feeds and infinite scroll.

### 4.6 Authentication

Every request carries credentials: user tokens (JWT or session cookies) for apps, API keys or OAuth client credentials for machines (Chapter 5). The server takes identity from the credential, never from a `user_id` field in the request body.

### 4.7 Idempotency

Networks fail after the server finished but before the client heard back. The client retries; without protection, the order is placed twice. The fix: the client sends a unique `Idempotency-Key`; the server stores the key with the result under a unique constraint and returns the saved result for any repeat.

```
POST /v1/orders   Idempotency-Key: 7f3c...   → 201 Created {order_id: 88}
(timeout, client retries with the same key)
POST /v1/orders   Idempotency-Key: 7f3c...   → 201 Created {order_id: 88}   (no second order)
```

### 4.8 Practitioner's guide

| Aspect | Details |
| --- | --- |
| Benefits of a good contract | Independent teams, safe evolution, clear errors |
| Constraints | Old clients, network failures, payload sizes |
| Trade-offs | REST simplicity vs GraphQL flexibility vs gRPC speed |
| Always | Version, paginate, authenticate, rate-limit, idempotency on writes |
| Avoid | Breaking changes in place, unbounded lists, identity from request bodies |

### 4.9 Production incident deep dive

**Incident: a renamed field crashes 30% of Android users.** The API renamed `delivery_eta` to `eta_minutes`; older app versions treated the missing field as fatal.

| Time | What happened | Why |
| --- | --- | --- |
| 11:00 | API release with the rename | Reviewed as "cleanup" |
| 11:10 | Crash rate on older app versions reaches 30% | Old clients expect the old field |
| 11:35 | API rolled back | Fastest mitigation |
| Next week | Both fields served until old versions retire | Expand-contract |

| Failure mode | Detection | Why it happens | Fix |
| --- | --- | --- | --- |
| Breaking change | Errors by app version | Field renamed or removed in place | Additive changes; contract tests |
| Duplicate orders | Two orders for one cart | Retry after timeout | Idempotency keys |
| Unbounded responses | Memory spikes | Lists without limits | Mandatory pagination with maximum page size |
| GraphQL N+1 | Query count per request spikes | Per-item resolvers | DataLoader batching; cost limits |
| Timeout mismatch | Duplicate work | Client timeout shorter than server work | Server deadlines below client timeouts |

### Review questions with detailed answers

##### Q1. Design REST endpoints to list restaurants, show a menu, place and cancel an order.

**Short answer.** `GET /v1/restaurants`, `GET /v1/restaurants/15/menu`, `POST /v1/orders` (with an idempotency key), `PATCH /v1/orders/88` with status cancelled.

**Detailed explanation.** Restaurants and orders are resources, so they are plural nouns; the menu belongs to a restaurant, so it nests under it. Placing an order creates a resource (POST, 201 Created, Location header to the new order). Cancelling is usually a state change rather than a delete, because the order must remain for refunds, history and support; so PATCH the status (or POST to a `/cancel` action if cancellation has rules). Filters like location and cuisine are query parameters.

**If the interviewer pushes.** "Why not DELETE the order?" Deleting loses the record needed for refunds and audits; cancellation is a transition in the order's state machine.

##### Q2. A client retries "pay ₹500" after a timeout. What can go wrong and how do you prevent it?

**Short answer.** The first request may have succeeded, so the retry charges twice. Require an idempotency key and return the stored result for repeats.

**Detailed explanation.** The client cannot distinguish "the server never got it" from "the server did it but the reply was lost". The server records each key (merchant + key) with a hash of the request and the response, inserted under a unique constraint before doing the work. A retry with the same key finds the record and returns the same response; a different body with the same key is rejected. Two simultaneous identical requests: the second hits the constraint and waits or receives "in progress".

**If the interviewer pushes.** "How long do you keep keys?" Long enough to cover client retries, typically 24 hours.

##### Q3. Offset or cursor pagination for an infinite-scroll feed?

**Short answer.** Cursor: it stays fast at any depth and does not duplicate or skip items when new ones arrive.

**Detailed explanation.** With offsets, page 2 means "skip 20". If 3 new posts arrive while you read page 1, page 2 starts 3 items later in the shifted list, so you see 3 posts twice. The database also has to walk and discard every skipped row, which gets slower on deep pages. A cursor says "items older than post 9812", which uses an index directly and is unaffected by inserts above.

**If the interviewer pushes.** "When is offset fine?" Small admin tables where users jump to page numbers and data changes rarely.

## Chapter 5: TLS, Authentication and API Design in Depth

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Prove who is talking (users and servers), keep traffic private, and let thousands of servers trust a user without asking a database every time. |
| Why it is hard | Networks are hostile, passwords leak and get reused, tokens get stolen, and revocation conflicts with stateless scaling. |
| How we solve it | TLS with certificates for the channel; passwords plus MFA, OAuth/OIDC or passkeys for login; sessions or short-lived JWTs with refresh tokens to remember users. |
| What fails, and why | Account takeover (password reuse, phishing, SIM swaps), forged tokens (weak algorithm checks), long-lived stolen tokens (no revocation), and expired certificates (manual renewal). |

This chapter opens the boxes from Chapters 3 and 4: how TLS keeps traffic private and authentic, how requests and responses are built, how users are authenticated, and how idempotency, pagination and versioning work in detail.

### 5.1 What TLS guarantees

Plain HTTP is a postcard that anyone handling it can read. TLS turns it into a locked safe with three guarantees: encryption (nobody in between can read), authentication (you are talking to the real site) and integrity (nobody can modify data unnoticed). HTTPS is HTTP inside a TLS tunnel.

### 5.2 Two kinds of encryption

Symmetric encryption uses one key to lock and unlock. It is very fast, but sharing the key safely over the internet is the problem. Asymmetric encryption uses a public key (an open padlock anyone can snap shut) and a private key (the only key that opens it). It is secure between strangers but slow. TLS uses asymmetric cryptography once, to agree on a symmetric session key, and then uses fast symmetric encryption for all data.

### 5.3 The handshake

1. Client Hello: supported TLS versions, cipher options and random data.
2. Server Hello and certificate: the chosen method plus a certificate proving the server's identity.
3. Certificate check: the browser verifies the certificate is signed by a trusted Certificate Authority (CA) such as DigiCert or Let's Encrypt, using the list of CAs built into the device. A fake or expired certificate produces the "connection is not private" warning.
4. Key exchange: using an algorithm such as ECDHE, both sides compute the same session key without ever sending it.
5. Encrypted communication with the symmetric session key.

TLS 1.3 completes this in one round trip. A certificate is like a passport: anyone can claim to be Instagram, but a passport is issued by a trusted government.

Why a hacker on café Wi-Fi cannot impersonate your bank: a fake certificate fails because no CA will sign `yourbank.com` for someone who does not control the domain. Copying the bank's real (public) certificate also fails, because during the key exchange the server must prove it holds the matching private key, which only the bank has.

Decrypting TLS costs CPU, so large systems decrypt once at the load balancer (TLS termination, Chapter 7) and manage certificates in one place.

### 5.4 Anatomy of requests and responses

```
POST /v1/orders?source=app
Host: api.swiggy.com
Authorization: Bearer eyJhbGci...
Content-Type: application/json
Idempotency-Key: 7f3a-91bc

{"restaurant_id": 15, "items": [{"id": 3, "qty": 2}]}
```

```
201 Created
Content-Type: application/json
{"order_id": 88, "status": "placed", "eta_minutes": 30}
```

REST's core principles are resources with URLs, statelessness (every request carries its token), cacheability through headers such as `Cache-Control`, and a uniform interface. Status codes per endpoint: a found resource returns 200 and a missing one 404; a created order 201; missing fields 400; no token 401 (who are you?); a valid token for someone else's order 403 (you are not allowed); a restaurant that closed mid-checkout 409 Conflict.

### 5.5 GraphQL and gRPC details

GraphQL defines a schema of types (`type Restaurant { id: ID!, name: String!, menu: [Item] }`). A restaurant screen needing name, rating and three menu items takes one GraphQL query instead of two REST calls that return all 200 items. The N+1 problem, query cost limits and caching difficulties are the main operational concerns.

gRPC's speed comes from binary protobuf (often several times smaller than JSON), HTTP/2 multiplexing, and native streaming. A typical use is an order service calling a payment service thousands of times per second.

### 5.6 Authentication and authorization

Authentication answers "who are you?"; authorization answers "what may you do?"

| Method | How it works | Strength | Weakness |
| --- | --- | --- | --- |
| API keys | Long secret string per client | Simple server-to-server access | Anyone with a leaked key can use it |
| Sessions | Server stores a session; client holds a session ID cookie | Easy revocation | Server-side state shared by all servers |
| JWT | Signed token `header.payload.signature` | Stateless: any server verifies the signature | Hard to revoke before expiry |
| OAuth 2.0 | "Login with Google": a provider issues limited access tokens | No password sharing | More moving parts |

A JWT payload such as `{"user_id": 42, "role": "customer", "exp": 1735689600}` is signed with a server secret; editing the role breaks the signature. With 200 servers, JWT scales easily because no shared session store is needed. Its weakness, early revocation, is handled with short expiry (e.g. 15 minutes) plus refresh tokens. OAuth is like giving a hotel valet a key that starts the car but cannot open the trunk.

### 5.7 Idempotency in detail

1. The app generates a key, `Idempotency-Key: abc-123`, and sends "pay ₹500."
2. The server checks its store. Unseen: it processes the payment and saves `abc-123 → {success, txn_789}`.
3. The network drops the response; the app retries with the same key.
4. The server finds the key and returns the saved result without charging again.

If two identical requests arrive at the same instant, a lock or a unique database constraint ensures only one wins. Keys are kept for a period such as 24 hours. Payment providers such as Stripe and Razorpay work this way.

### 5.8 Pagination and versioning in detail

Offset pagination makes the database skip rows; at `offset=1,000,000` it reads and discards a million rows, and inserts shift pages so users see duplicates. Cursor pagination asks for "20 items after id 9981," which an index answers directly. Responses carry the next cursor: `{"data": [...], "next_cursor": "rest_10001", "has_more": true}`. Use offsets for admin pages with page numbers and cursors for feeds.

Versioning in the URL (`/v1/`) is the most common and most visible; header versioning (`Accept-Version: 2`) keeps URLs clean.

### 5.9 Practitioner's guide

Worked example: access and refresh tokens for a mobile app.

```
Login ─► access token (JWT, 15 min) + refresh token (30 days, stored hashed server-side)
API call ─► any server verifies JWT signature (no DB)
Access expired ─► POST /token/refresh ─► check refresh token in DB (revocable) ─► new pair
Logout / stolen phone ─► revoke refresh token ─► access dies within 15 min
```

| Aspect | Details |
| --- | --- |
| Benefits | Stateless verification at scale, revocation via refresh tokens, TLS privacy and identity |
| Constraints | Clock sync for expiry, key rotation, certificate renewal, mobile secure storage |
| Trade-offs | Short tokens (safer, more refreshes) vs long tokens (fewer calls, larger blast radius) |
| JWT when | Many stateless servers, microservices, mobile APIs |
| Sessions when | Single web app needing instant revocation and simple setup |
| OAuth when | Third-party login or delegated access to another service's data |
| mTLS when | Service-to-service identity inside your network |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| JWT signing key leaked | Attackers mint tokens | Key rotation with key IDs; short expiry |
| `alg: none` or weak validation | Forged tokens accepted | Strict algorithm allowlist in libraries |
| Token in URL | Leaks via logs and referrers | Authorization header only |
| Idempotency key reused with different body | Wrong result returned | Store request hash; reject mismatches |

### 5.10 How Authentication Works, and How the Methods Differ

Authentication answers "are you really who you claim to be?" It sits between identification and authorization, and every request after login still needs authorization, or the system has an IDOR hole (Chapter 26).

| Concept | Question | Example |
| --- | --- | --- |
| Identification | Who do you claim to be? | Typing `priya@gmail.com` |
| Authentication | Can you prove it? | Correct password + OTP |
| Authorization | What may you do? | Priya views her own orders, not others' |
| Auditing | What did you do? | "Priya refunded order 88 at 10:42" |

#### The universal pattern

```
1 CLAIM    "I am Priya"                 (username, email, phone, device)
2 PROVE    secret or proof              (password, OTP, signed challenge, certificate)
3 VERIFY   server checks the proof      (hash compare, signature check, OTP match)
4 REMEMBER issue a credential           (session cookie, JWT, API key, certificate)
           later requests present the credential instead of the password
```

Proof comes in three factors: something you know (password, PIN), something you have (phone, authenticator app, security key) and something you are (fingerprint, face, usually checked on the device). Multi-factor authentication combines different factors so a stolen password alone is not enough.

#### The methods

Password plus server session (classic web): the server checks `bcrypt(password + salt)` against the stored hash, creates a session record in Redis or the database, and sets an `HttpOnly; Secure; SameSite` cookie. Later requests send the cookie; logout deletes the session instantly. It is stateful, simple and instantly revocable, but needs a shared session store and CSRF protection.

> *Diagram in the original artifact: Session login · login, each request, logout*

Every request costs one session lookup, but logout is instant: deleting the record ends the session everywhere.

Token-based (JWT): the auth server issues a short-lived signed token plus a refresh token; any server verifies the signature locally. It is stateless and scales across services, but revocation needs short expiry, refresh tokens or denylists (section 5.11).

API keys: a dashboard issues a key such as `sk_live_abc123`, stored hashed; requests send it in a header. Simple for scripts and integrations, but it identifies an app rather than a person, is long-lived, and must be scoped and rotated.

OAuth 2.0 with OpenID Connect ("Login with Google"): OAuth delegates authorization; OIDC adds authentication by returning a signed ID token.

> *Diagram in the original artifact: OAuth 2.0 + OpenID Connect · authorization code flow with PKCE*

It enables SSO and provider-grade MFA, at the cost of redirects, state handling and provider dependency; PKCE protects mobile and single-page apps from stolen codes.

SAML: enterprise SSO with signed XML assertions from identity providers such as Okta or Azure AD; widespread but heavy, so new apps prefer OIDC.

Passkeys (WebAuthn): the device creates a key pair at registration and the site stores only the public key. At login the site sends a random challenge, the device signs it after a fingerprint or face check, and the site verifies with the public key. There is no password to steal, signatures are bound to the real domain so phishing sites get nothing usable, and biometrics never leave the device; recovery needs planning.

> *Diagram in the original artifact: Passkeys (WebAuthn) · register, login, phishing attempt*

OTP and magic links: SMS or email codes are easy and common for phone-number login but vulnerable to interception, SIM swaps and social engineering; authenticator apps (TOTP) generate codes from a shared secret every 30 seconds and are safer; magic links are only as secure as the email account.

Certificates and mTLS: both sides present TLS certificates, giving strong machine identity for service-to-service calls and IoT, with certificate issuance and rotation to manage.

HTTP Basic: sends `username:password` encoded (not encrypted) on every request; acceptable only over HTTPS for internal tools.

#### Comparison

| Method | Proves | Stateful | Revocation | Phishing resistance | Typical use |
| --- | --- | --- | --- | --- | --- |
| Password + session | Knowledge | Yes | Instant | Low | Classic web apps |
| JWT | Signed token | No | Hard | Depends on login | Mobile, microservices |
| API key | Secret key | Lookup | Easy | Low | Developer APIs |
| OAuth 2.0 / OIDC | Provider-verified identity | Mixed | Provider + session | Provider's | Social login, SSO |
| SAML | IdP assertion | Mixed | Provider | Provider's | Enterprise SSO |
| Passkeys | Device key + biometric | Session after login | Remove key | Very high | Modern logins |
| SMS/email OTP | Phone or email possession | Session after login | Session | Low-medium | Phone login, recovery |
| TOTP | Device secret | Session after login | Session | Medium | MFA |
| mTLS | Private key | No | Revocation, short-lived certs | High | Services, IoT |
| HTTP Basic | Knowledge | No | Change password | Low | Internal tools |

Key differences: sessions keep state on the server (easy logout, harder scaling) while tokens keep a signed state on the client (easy scaling, harder logout); first-party methods verify users yourself while federated methods (OIDC, SAML) trust an identity provider; passwords, OTPs and passkeys authenticate people while API keys and mTLS authenticate machines; shared secrets (passwords, OTPs, API keys) can leak from either side, while key pairs (passkeys, certificates) keep the private key with its owner so a server breach leaks nothing reusable.

#### Choosing

```
Person?
 ├─ consumer app  → phone OTP or passkeys, "Login with Google" (OIDC) → session or JWT
 ├─ employees     → SSO via OIDC/SAML through the company IdP + MFA
 └─ high-value actions → step-up MFA
Machine?
 ├─ third-party developer → scoped, rotatable API keys or OAuth client credentials
 └─ internal service      → mTLS or short-lived workload tokens
After login: web → HttpOnly session cookie · mobile/microservices → short JWT + refresh token
```

| Failure | Fix |
| --- | --- |
| Plain-text or fast-hashed passwords | bcrypt, scrypt or Argon2 with salt |
| Credential stuffing | Rate limits, MFA, breached-password checks |
| Session hijacking via XSS | HttpOnly cookies, Content Security Policy |
| CSRF on cookie sessions | SameSite cookies, CSRF tokens |
| SIM swap on SMS OTP | Authenticator apps or passkeys for high-value accounts |
| Authenticated without ownership checks | Authorization on every request |
| Leaked API key in a repo | Secret scanning, scoped keys, rotation |

### 5.11 How JWT Works

A JWT is a small signed token that proves identity on every request; any server verifies it without a database lookup because the token carries its own proof.

#### Structure

> *Diagram in the original artifact: JWT anatomy · encoded token, decoded parts, verification*

| Part | Decoded | Purpose |
| --- | --- | --- |
| Header | `{"alg": "HS256", "typ": "JWT"}` | Signing algorithm |
| Payload (claims) | `{"sub": "42", "role": "customer", "iat": 1759996400, "exp": 1760000000}` | Who, what they may do, when it expires |
| Signature | `HMAC_SHA256(header + "." + payload, secret)` | Proof the first two parts are unchanged |

The parts are Base64URL-encoded, not encrypted: anyone can read the payload, so never put secrets in it. Standard claims: `sub` (user ID), `exp` (expiry), `iat` (issued at), `iss` (issuer), `aud` (intended audience), `jti` (unique token ID for revocation), plus custom claims such as `role`.

#### The flow

> *Diagram in the original artifact: JWT lifecycle · login, each request, refresh*

Only login and refresh touch the database; every ordinary request is verified locally by whichever API server receives it.

If an attacker edits `"role": "customer"` to `"admin"`, the recomputed signature no longer matches and the request is rejected; producing a valid signature requires the key.

#### Signing options

|  | HS256 (shared secret) | RS256 / ES256 (key pair) |
| --- | --- | --- |
| Sign with | Secret | Private key (auth server only) |
| Verify with | Same secret | Public key (shareable) |
| Benefit | Simple, fast | Many verifiers, one issuer |
| Risk | Every verifier could mint tokens | Key rotation and `kid` management |
| Use when | One app or small trusted backend | Microservices, third parties (JWKS endpoints) |

#### Revocation and pitfalls

The weakness is revocation: a stolen or logged-out token works until `exp`. Use short access tokens (5-15 minutes) with server-stored refresh tokens, a Redis denylist of revoked `jti` values until expiry, and refresh-token rotation where reuse of an old token signals theft.

| Mistake | Risk | Fix |
| --- | --- | --- |
| Accepting `alg: none` or token-chosen algorithms | Forged tokens | Hard-coded algorithm allowlist |
| Long expiry | Long-lived theft | Short tokens + refresh |
| Secrets in payload | Readable by anyone | IDs and roles only |
| Token in URL | Leaks via logs and history | Authorization header |
| Stored in localStorage | XSS theft | HttpOnly, Secure, SameSite cookies on web; secure storage on mobile |
| Skipping exp/aud/iss checks | Expired or misdirected tokens accepted | Validate all standard claims |
| Never rotating keys | Permanent forgery after a leak | Rotation with `kid` |

Use JWTs for many stateless servers, microservices, mobile APIs and SSO; use server sessions for a single web app needing instant revocation.

#### Three kinds of tokens

| Token | Purpose | Audience | Format | Lifetime | Rule |
| --- | --- | --- | --- | --- | --- |
| ID token (OIDC) | Who the user is | Your app | JWT | Minutes | Read it once at login; never send it to APIs |
| Access token | Permission to call an API | The API (resource server) | Often JWT | 5-15 minutes | Sent as `Authorization: Bearer`; checked on every request |
| Refresh token | Get new access tokens | Only the auth server | Usually opaque random string | Days to months | Stored server-side, revocable, rotated on use |

#### OAuth 2.0 grant types

| Grant | Who uses it | Status |
| --- | --- | --- |
| Authorization code + PKCE | Users in web, mobile and single-page apps | Recommended default |
| Client credentials | Machine-to-machine, no user involved | Recommended for services |
| Device authorization | TVs, consoles, CLIs without a keyboard browser ("enter this code at...") | Recommended for those devices |
| Refresh token | Renewing access without re-login | Standard, with rotation |
| Implicit | Old browser apps receiving tokens in the URL | Avoid: tokens leak via URLs; OAuth 2.1 drops it |
| Resource owner password | App collects the user's password directly | Avoid: defeats delegation; OAuth 2.1 drops it |

#### Where to store tokens

| Client | Store in | Avoid | Why |
| --- | --- | --- | --- |
| Web app | `HttpOnly; Secure; SameSite` cookies, or keep tokens on a backend-for-frontend server | `localStorage`, `sessionStorage` | Injected scripts (XSS) can read web storage but not HttpOnly cookies |
| Mobile app | iOS Keychain, Android Keystore | Plain files, shared preferences | OS-protected, hardware-backed storage |
| Backend service | Memory, secrets manager | Code, logs, config in Git | Secrets in repos are scraped within minutes |

Cookies bring CSRF risk, handled with SameSite and CSRF tokens; bearer tokens in headers avoid CSRF but must be protected from XSS.

#### Signing keys, `kid` and JWKS

With RS256 or ES256 the auth server publishes its public keys at a JWKS (JSON Web Key Set) URL, typically `/.well-known/jwks.json`, discovered through `/.well-known/openid-configuration`. Each token header carries `kid`, naming which key signed it, so verifiers cache the key set and pick the right key. Rotation without downtime: publish the new key alongside the old, start signing with the new `kid`, keep the old key published until every token it signed has expired, then remove it. Emergency rotation after a leak removes the old key immediately, invalidating its tokens.

#### Refresh token rotation

Each refresh returns a new refresh token and marks the old one used. If a used token appears again, either the app or an attacker holds a copy, so the server revokes the whole token family and forces a fresh login.

> *Diagram in the original artifact: Refresh token rotation with reuse detection*

#### Validation checklist for every request

1. Read the `Authorization: Bearer` header; reject missing or malformed tokens with 401.
2. Parse the header; accept only the expected algorithms from a fixed allowlist, never `none`.
3. Find the verification key by `kid` in the cached JWKS (refresh the cache when an unknown `kid` appears).
4. Verify the signature over `header.payload`.
5. Check `exp` and `nbf` with a small clock-skew allowance (e.g. 30-60 seconds).
6. Check `iss` is your auth server and `aud` is this API.
7. If you keep a denylist or token version, check `jti` or the user's token version (cached in Redis).
8. Then authorize: does `sub` own this resource, and does `role` or `scope` permit this action? A valid token is not permission (no IDOR).

#### Logout and revocation across devices

Sessions: delete the session record; for "log out everywhere," delete all of the user's sessions. JWTs: revoke the device's refresh token so no new access tokens are issued; the current access token dies within its short lifetime, or immediately via a `jti` denylist. For "log out everywhere," increment a `token_version` stored on the user and embedded in tokens, so tokens with an older version are rejected; cache the version to avoid a database hit per request. Password changes and detected theft should trigger the same revocation.

#### Sessions vs JWT side by side

| Aspect | Server sessions | JWT access + refresh tokens |
| --- | --- | --- |
| Where state lives | Server (Redis/DB) | Signed token on client + refresh token on server |
| Per-request cost | One session lookup | Signature check, no lookup |
| Revocation | Instant | Up to access-token lifetime, unless denylisted |
| Horizontal scaling | Needs shared session store | Any server verifies locally |
| Cross-service use | Awkward | Natural (microservices, mobile, SSO) |
| Main web risk | CSRF | XSS if stored in web storage |
| Payload size | Tiny cookie | Larger token on every request |
| Best fit | Single web app, instant logout needs | Many services, mobile APIs, federated identity |

### 5.12 Production incident deep dive

**Incident: a signing-key rotation logs out half the users.** The auth service started signing with a new key, but half the API servers still cached only the old public key.

| Time | What happened | Why |
| --- | --- | --- |
| 10:00 | Auth service switches to key `k2` | Scheduled rotation |
| 10:01 | 50% of API requests return 401 | Servers with a stale JWKS cache know only `k1` |
| 10:06 | Apps force re-login; login traffic spikes | Clients treat 401 as "session ended" |
| 10:15 | Rollback to signing with `k1` | Mitigation |
| Fix | Publish `k2` first, wait for caches, then sign with it | Overlapping keys with `kid` |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Key rotation mismatch | 401 spike right after rotation | Verifiers lack the new key | Requests to stale servers | Sign with the old key again | Publish new key first; refetch JWKS on unknown `kid` |
| Refresh token "theft" false alarm | Users logged out after opening two tabs | Two tabs refresh at once; reuse detection fires | Multi-tab users | Short grace window for the just-rotated token | Single-flight refresh in the client; small reuse grace period |
| Identity provider outage | Logins fail everywhere | Single IdP dependency | All new logins | Extend existing sessions | Longer session lifetimes during outages; fallback login for admins |
| Token in logs | Tokens visible in log search | Logging full headers or URLs | Anyone with log access | Purge logs, revoke tokens | Redact authorization headers and tokens in logging |
| Clock skew | Valid tokens rejected on some servers | Server clocks drifted | Requests to those servers | Fix NTP | NTP everywhere; 30-60 s skew allowance |
| OAuth redirect misconfig | Login loops or "redirect\_uri mismatch" | Redirect URL changed in one place only | All social logins | Revert config | Config managed as code, tested in staging |

**Production readiness checklist**

- Key rotation runbook with overlapping keys and `kid`
- Authorization headers redacted in all logs
- Refresh logic is single-flight on clients
- Alerts on 401 rate and login rate
- Plan for identity provider outages

### Review questions

1. Which handshake step stops a fake bank server, and why can it not be faked?
2. Why does JWT scale better than sessions across 200 servers, and what is its weakness?
3. Pick REST, GraphQL or gRPC for an internal location stream, a public weather API, and a mobile app with varied screens.

#### Answers

1. The certificate check (with the key exchange). A fake certificate fails because no trusted CA signs `yourbank.com` for someone who does not control that domain. A copied real certificate fails because the server must prove it holds the matching private key during the handshake, which only the bank has.
2. Any of the 200 servers verifies a JWT's signature locally, with no shared session store to scale or to become a bottleneck. The weakness is revocation: a stolen or logged-out token stays valid until it expires, handled with short expiry, refresh tokens and revocation lists.
3. Internal location stream: gRPC (binary, fast, streaming, service-to-service). Public weather API: REST (universal, simple, cacheable). Mobile app with varied screens: GraphQL (one request fetches exactly each screen's data).
