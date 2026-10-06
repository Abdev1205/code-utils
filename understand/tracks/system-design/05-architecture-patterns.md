# Part V: Architecture Patterns

**Topic:** System design
**Covers:** Monoliths, Microservices and Sagas; API Gateways, Service Discovery and Rate Limiting; High-Level and Low-Level Design
**Source:** [Claude artifact](https://claude.ai/artifact/7xxGdVxPGbUiPY13z4MdZ2) — written by a colleague, mirrored here for study.

## Chapter 21: Monoliths, Microservices and Sagas

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Organize code and teams so the system can grow without everyone blocking everyone. |
| Why it is hard | Splitting into services adds network failures and distributed data; one business transaction now spans several databases. |
| How we solve it | Start with a modular monolith, split by business capability with a database per service, communicate with APIs and events, and coordinate multi-step flows with sagas and compensations. |
| What fails, and why | A distributed monolith (services sharing databases or deploying together), cascading failures (chatty synchronous calls), and money charged without an order (saga steps without compensations). |

Start with a monolith, ideally a modular one, and split into microservices only when team size or scaling pain demands it. When you do split, transactions that spanned one database become sagas.

### 21.1 The monolith

All features live in one codebase, one deployment and usually one database, calling each other through function calls: a joint family in one house. Advantages: simple to build, test, deploy and debug; nanosecond function calls; easy ACID transactions; ideal for startups. Disadvantages at scale: all-or-nothing scaling, one bug (a memory leak in reviews) can crash payments, slow deployments, hundreds of engineers colliding in one codebase, and one technology stack.

### 21.2 Microservices

The app splits into small services, each owning one business capability and its own database, deployed independently and communicating over the network (REST or gRPC synchronously, Kafka events asynchronously): a housing society of separate flats.

Advantages: scale only what is hot (search on IPL night), fault isolation, independent deployments, autonomous "two-pizza" teams, and the right tool per service (polyglot languages and databases). Hidden costs: slow and failure-prone network calls, hard distributed transactions, eventual consistency, debugging across 15 hops (distributed tracing), and heavy operational overhead (containers, Kubernetes, CI/CD, a platform team).

|  | Monolith | Microservices |
| --- | --- | --- |
| Codebase | One | Many |
| Deployment | All together | Independent |
| Scaling | Whole app | Per service |
| Failure | Can take everything down | Isolated if designed well |
| Communication | Function calls | Network calls |
| Transactions | Easy ACID | Sagas |
| Best for | Startups, small teams | Large orgs, large scale |

### 21.3 The modular monolith

One deployment with strict internal modules: Orders cannot touch Payments' tables and must use its public interface. You get monolith simplicity now and clean seams to split later. Shopify runs a large, successful modular monolith. A two-person startup asking for 20 microservices should be told to start with a modular monolith, find product-market fit, and split later.

### 21.4 Service boundaries

Split by business capability (Order, Payment, Delivery), not technical layer (a "Database Service" or "Validation Service" that every feature must touch). Domain-Driven Design calls each a bounded context, a part of the business with its own language. Rules: database per service (others use your API or events, never your tables), high cohesion, loose coupling.

The distributed monolith anti-pattern: services share one database, need ten synchronous calls per request, or must deploy together. You get every microservice pain and none of the benefits. Long synchronous chains also multiply failure: five services each at 99.9% availability yield about 99.5% for the chain, and latencies add.

### 21.5 The saga pattern

Placing an order touches Order, Payment and Restaurant services, each with its own database. If the restaurant rejects after payment succeeds, there is no cross-service rollback. A saga is a sequence of local transactions, each with a compensating action.

| Step | Action | Compensation |
| --- | --- | --- |
| 1 | Create order (pending) | Cancel order |
| 2 | Charge ₹450 | Refund ₹450 |
| 3 | Restaurant confirms | (last step) |

If step 3 fails, refund, then cancel. Compensation is a new action, not erasing history: the customer may briefly see the charge before the refund.

Choreography: no central coordinator; services react to each other's events (OrderCreated → payment charges → PaymentDone → restaurant rejects → payment refunds → order cancels). Loosely coupled with no single point of failure, but the flow is hard to see as steps grow.

Orchestration: a central orchestrator tells each service what to do and handles failures. Clear, monitorable and debuggable in one place, at the cost of extra logic that must not become a bottleneck. Tools include Temporal, AWS Step Functions, Netflix Conductor and Camunda. Use choreography for a few simple steps and orchestration for complex, multi-step flows.

Sagas vs two-phase commit: 2PC locks participants until all agree, strongly consistent but slow and blocking; sagas never lock across services, fast and available but eventually consistent. Microservices almost always choose sagas.

### 21.6 Practitioner's guide

Worked example: splitting a monolith with the strangler fig pattern.

> *Diagram in the original artifact: Strangler fig migration over three years*

| Aspect | Monolith | Microservices |
| --- | --- | --- |
| Benefits | Fast to build, easy transactions, simple ops | Independent deploy and scale, fault isolation, team autonomy |
| Constraints | Coupled releases, shared scaling | Network failures, distributed data, platform investment |
| Use when | Small team, unclear domain, early product | Many teams, divergent scaling, clear boundaries |
| Avoid when | Hundreds of engineers block each other | Under \~10 engineers, no CI/CD or observability |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Chatty synchronous calls | Latency adds up, cascading failures | Coarser APIs, async events, caching |
| Shared database across services | Schema change breaks others | Database per service, APIs/events |
| Saga compensation missing | Charged but no order | Orchestrator with explicit compensations |
| Saga step retried twice | Double refund | Idempotent steps |

### 21.7 Production incident deep dive

**Incident: a slow profile service takes down checkout.** Checkout called cart, which called pricing, which called profile, all synchronously; profile slowed to 8 s.

| Time | What happened | Why |
| --- | --- | --- |
| 19:30 | Profile service latency 50 ms → 8 s | Expensive query after a deploy |
| 19:31 | Pricing threads all waiting on profile | No timeout on the call |
| 19:32 | Cart, then checkout, run out of threads | Synchronous chain: each service waits on the next |
| 19:45 | Profile rolled back; services recover slowly | Queued requests drain |
| Fix | Timeouts, circuit breakers, cached profile data, fewer synchronous hops | Contain failures |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Cascading failure | Latency rising service by service up the chain | Deep synchronous call chains without timeouts | Everything upstream | Roll back; open breakers | Timeouts, breakers, bulkheads; async events where possible |
| Distributed monolith | Releases need several teams at once | Shared database or tightly coupled APIs | Delivery speed | Coordinate releases | Database per service; versioned contracts |
| Stuck saga | Orders in PAYMENT\_PENDING for hours | Orchestrator lost state or a step never answered | Affected orders | Manual compensation | Durable workflows with timers and compensations |
| Version incompatibility | Errors after one service deploys | Breaking API change between services | Callers | Roll back | Contract tests; backward-compatible changes |
| Untraceable failures | Hours to find the failing service | No distributed tracing | Recovery time | Correlate logs manually | Trace IDs propagated everywhere |

**Production readiness checklist**

- No synchronous chains deeper than about three hops on critical paths
- Timeouts and breakers on every service call
- Contract tests between services
- Durable workflows for multi-step business processes
- Distributed tracing on all services

### Review questions

1. A two-person startup wants 20 microservices to be ready to scale. What do you advise and why?

#### Answers

1. Start with a monolith, ideally a modular monolith with clean internal boundaries. Twenty microservices for two people means twenty deployments, network failures, distributed transactions and heavy operations before product-market fit. Split later when team size or scaling pain demands it.

## Chapter 22: API Gateways, Service Discovery and Rate Limiting

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Many clients call many services: who handles auth, routing, discovery and abuse protection consistently? |
| Why it is hard | Service instances change constantly, every team would re-implement cross-cutting concerns, and abusive or buggy clients can overwhelm everything. |
| How we solve it | An API gateway (and BFFs) for edge concerns, a service registry or Kubernetes DNS for discovery, a service mesh for mTLS and retries, and token-bucket or sliding-window rate limits backed by Redis. |
| What fails, and why | Limits bypassed at window boundaries (fixed windows), whole offices blocked (limits by IP), calls to dead instances (stale registries), and slow gateways (business logic creeping in). |

With 50 microservices, clients need one front door, services need a live phonebook of each other, and everyone needs protection from abusive traffic. These three tools provide exactly that.

### 22.1 The API gateway

A single entry point in front of all services, like a hotel reception desk. Its jobs: routing (`/orders/*` to the order service), authentication once at the edge, rate limiting, TLS termination, request aggregation (one home-screen call fans out to user, restaurant and offer services and returns a combined response), protocol translation (REST outside, gRPC inside), caching, logging and request IDs, and hiding internal structure so services can be split or renamed freely.

Dangers: it is a single point of failure (run several instances behind a load balancer), it adds a hop, and the "god gateway" anti-pattern puts business logic inside it; keep it thin.

Backend for Frontend (BFF): one gateway per client type (mobile, web, partner) so each team tailors responses; popularized by Netflix and SoundCloud. Tools: Kong, AWS API Gateway, Nginx, Envoy, Apigee, Spring Cloud Gateway.

A load balancer spreads traffic across copies of the same service; a gateway routes to different services and adds cross-cutting features. Real systems use both: client → load balancer → gateway → load balancer → service instances.

### 22.2 Service discovery

With auto-scaling, instance counts and IPs change constantly. A service registry is a live phonebook: instances register on start, send heartbeats, and are removed when heartbeats stop. Tools: Consul, etcd, ZooKeeper, Eureka, which are CP systems using consensus.

Client-side discovery: the caller fetches the instance list and load-balances itself, saving a hop but embedding logic everywhere. Server-side discovery: the caller targets a load balancer or stable name. Kubernetes does this: call `http://order-service` and internal DNS routes to a healthy pod.

A service mesh places a sidecar proxy (usually Envoy) next to each service to handle discovery, load balancing, retries, mutual TLS and metrics uniformly across languages. Istio and Linkerd are examples; worthwhile with many services, operationally heavy otherwise.

### 22.3 Why rate limit

To stop abuse (bots, scrapers, brute-force logins, DDoS), protect servers from runaway clients, enforce fairness, and implement business tiers (free plan 1,000 calls/day, paid 1,000,000). Over the limit, respond `429 Too Many Requests` with `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `Retry-After` headers.

### 22.4 Five algorithms

Token bucket: a bucket holds up to N tokens refilled at a fixed rate; each request takes one. It allows short bursts while enforcing an average rate and stores only a count and a timestamp; AWS, Stripe and most gateways use it.

Leaky bucket: requests queue and leak out at a constant rate; overflow is rejected. It produces perfectly smooth output; the token bucket allows bursts, the leaky bucket smooths them.

Fixed window counter: count per clock minute, reset at the boundary. Simple (`INCR` in Redis) but has a boundary flaw: 100 requests at 10:00:59 and 100 at 10:01:00 put 200 through in two seconds.

Sliding window log: store every request timestamp, discard those older than the window, count the rest. Perfectly accurate, memory-hungry.

Sliding window counter: weight the previous window's count by how much of it still overlaps. At 30% into a minute with 80 requests last minute and 20 so far: 20 + 80 × 0.7 = 76, under a limit of 100. Tiny memory, slightly approximate; Cloudflare uses this approach.

| Algorithm | Allows bursts | Memory | Accuracy |
| --- | --- | --- | --- |
| Token bucket | Yes | Low | Good |
| Leaky bucket | No (smooths) | Low | Good |
| Fixed window | Boundary bursts | Very low | Weak |
| Sliding log | No | High | Perfect |
| Sliding counter | Limited | Low | Very good |

### 22.5 Distributed rate limiting

With 20 gateway servers keeping local counters, a user could send 100 requests to each. Use a shared counter in Redis with atomic operations (`INCR` or a Lua script that checks and updates in one step) to prevent races where two servers both read 99. Checking Redis adds latency, so some systems keep local counters and sync periodically. If Redis fails: fail open (allow traffic) for general APIs, fail closed for sensitive endpoints such as logins.

Limit by user ID, API key, IP (careful: a college Wi-Fi shares one IP) or endpoint (login 5/min, search 60/min). Enforce at the CDN edge (DDoS floods), at the gateway (per user and key), and inside services (expensive operations). Related ideas: throttling slows requests instead of rejecting them; load shedding drops low-priority work (analytics) to keep critical paths (payments) alive.

### 22.6 Practitioner's guide

Worked example: tiered API limits for a developer platform.

```
Request ─► CDN (IP flood protection) ─► Gateway: API key → plan lookup (cached)
  free:  token bucket 10 req/s, burst 20, 1,000/day
  pro:   100 req/s, burst 200
  login endpoint: 5/min per account + per IP
 Redis Lua script: atomic check-and-decrement ─► allow, or 429 + Retry-After
```

| Aspect | Details |
| --- | --- |
| Benefits | Single entry, central auth, abuse protection, fairness, monetizable tiers |
| Constraints | Extra hop, gateway capacity, shared counter latency, config sprawl |
| Trade-offs | Exact limits (central Redis, latency) vs approximate (local counters, speed); fail open vs closed |
| Gateway when | Many services or client types |
| Service mesh when | Dozens of services needing uniform mTLS, retries, telemetry |
| Avoid mesh when | A handful of services; operational overhead outweighs value |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Shared office IP rate limited | Whole company blocked | Limit by user or API key, not only IP |
| Gateway business logic creep | Slow, risky deploys | Keep gateway thin |
| Stale service registry | Calls to dead instances | Heartbeat TTLs, health-aware discovery |
| Clients ignore 429 | Hammering continues | Retry-After headers, client SDK backoff |

### 22.7 Production incident deep dive

**Incident: the rate limiter blocks every login.** The Redis cluster behind the rate limiter failed; the gateway was configured to fail closed, so it rejected all requests.

| Time | What happened | Why |
| --- | --- | --- |
| 09:00 | Rate-limit Redis loses its primary | Node failure |
| 09:00 | Gateway returns 429 for every request | Fail-closed when limits cannot be checked |
| 09:05 | Whole site unusable | The limiter became a single point of failure |
| 09:12 | Switched to fail-open for general APIs | Mitigation |
| Fix | Local fallback limits; fail-closed only for login and payments | Balance safety and availability |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Limiter outage blocks traffic | 429 rate jumps to near 100% | Fail-closed with a single backing store | All APIs | Fail open | Local in-memory fallback limits; replicated store |
| Gateway config error | 404 or 5xx on many routes after a change | Bad route pushed globally | Many services | Revert config | Staged config rollout, validation, canary |
| Service discovery stale | Requests to dead instances | Registry not updated on crash | That service | Remove instances manually | Health-checked registration with TTLs |
| Mesh certificate expiry | Service-to-service calls fail | mTLS certificates not rotated | Everything in the mesh | Rotate certificates | Automatic rotation and expiry alerts |
| Legitimate users throttled | Complaints from one office or carrier | Limit keyed by IP behind NAT | That group | Raise limits for the range | Limit by user or API key |
| Gateway overloaded | Latency added at the edge | Heavy logic in the gateway | All traffic | Scale out | Keep gateway thin; move logic to services |

**Production readiness checklist**

- Fail-open or fail-closed decided per endpoint
- Gateway config validated and rolled out in stages
- mTLS certificate rotation automated
- Rate-limit keys use user or API key, not only IP
- Gateway latency budget monitored

### Review questions

1. With a fixed window of 100/minute, a bot sends 100 at 10:00:59 and 100 at 10:01:00. What went wrong and which algorithm fixes it?

#### Answers

1. The fixed-window boundary problem: the counter reset at 10:01:00, so 200 requests passed in two seconds, double the limit. A sliding window counter (or sliding log, or token bucket) evaluates the last 60 seconds continuously instead of resetting on clock boundaries.

## Chapter 23: High-Level and Low-Level Design

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Translate an architecture into classes, state machines, APIs and schemas that are correct and easy to change. |
| Why it is hard | Requirements keep changing, concurrent requests race, and a design that is too abstract is as harmful as one that is too rigid. |
| How we solve it | SOLID principles, patterns where real variation exists (Strategy, State, Observer, Factory), explicit state machines, atomic conditional updates, and well-designed schemas. |
| What fails, and why | God classes (no separation of responsibilities), illegal states (status set directly anywhere), double assignments (check-then-act races), and fragile code (deep inheritance instead of composition). |

High-level design (HLD) is the architect's blueprint: services, databases, queues, scaling and failure handling. Low-level design (LLD) is the carpenter's drawing: classes, interfaces, schemas, state machines, algorithms and concurrency inside one service. Interviews usually test both in separate rounds.

### 23.1 Side by side

|  | HLD | LLD |
| --- | --- | --- |
| Question | What are the big pieces and how do they talk? | How is each piece built inside? |
| Zoom | Whole system | One service or module |
| Artifacts | Architecture diagrams, data flow, estimates | Class diagrams, schemas, sequence diagrams, state machines, code |
| Concerns | Scale, availability, consistency, latency, cost | Correctness, extensibility, readability, testability, concurrency |
| Example decision | "Kafka between Order and Dispatch" | "A `PricingStrategy` interface; index on `(rider_id, created_at)`" |
| Interview prompt | Design Uber, WhatsApp, YouTube | Design a parking lot, elevator, Splitwise, BookMyShow, LRU cache |

HLD decides "a trip service with a state machine on a strongly consistent database"; LLD decides exactly what its classes, tables and states look like.

### 23.2 Object-oriented basics

Classes are blueprints and objects are instances. Encapsulation keeps data private behind rule-enforcing methods (`trip.transition_to(IN_PROGRESS)` rather than setting a status field). Abstraction exposes what, hides how. Inheritance models "is-a" and should be used sparingly. Polymorphism lets many implementations share one interface. Prefer composition over inheritance: a `TripService` has a `PricingStrategy`.

### 23.3 SOLID

| Principle | Meaning | Ride-hailing example |
| --- | --- | --- |
| Single responsibility | One reason to change | `QuoteService` only creates quotes |
| Open/closed | Extend without modifying | Add `AirportFlatPricing` without editing existing code |
| Liskov substitution | Subtypes work wherever parents do | Every `MatchingStrategy` returns a ranked list |
| Interface segregation | Small, focused interfaces | `DriverLocator` separate from `DriverRepository` |
| Dependency inversion | Depend on abstractions; inject implementations | `DispatchService` receives a `MatchingStrategy` |

A fare calculator built from `if vehicle == "auto" ... elif "go" ...` breaks open/closed: every new type or rule edits tested code. The Strategy pattern, with a small factory, turns new types into new classes.

### 23.4 Design patterns

| Pattern | Idea | Where it fits |
| --- | --- | --- |
| Strategy | Swap algorithms behind an interface | Pricing, matching |
| State machine | Only legal transitions | Trip, order, payment lifecycles |
| Observer / pub-sub | Notify listeners | `TripCompleted` triggers payment and ratings |
| Factory | Centralize creation | Fare calculator per product |
| Repository | Hide storage behind an interface | In-memory for tests, SQL in production |
| Builder | Step-by-step construction | Complex orders or queries |
| Decorator | Wrap to add behavior | Caching or logging around a repository |
| Adapter | Make interfaces compatible | One interface over several payment gateways |
| Chain of responsibility | Pass requests through handlers | Validation, fraud checks, middleware |
| Command | Actions as objects | Undoable operations, queued jobs |
| Singleton | One shared instance | Use carefully; prefer dependency injection |

### 23.5 LLD artifacts and interview approach

Artifacts: entities and relationships, a class diagram, a database schema with indexes and reasons, detailed API contracts and error codes, sequence diagrams, state machines, algorithms, concurrency control, error handling and tests.

Approach: clarify requirements and scope; identify entities (nouns) and behaviors (verbs); draw relationships and classes; apply patterns where they fit naturally; walk key flows; handle concurrency and edge cases (double booking, retries, expired quotes, invalid transitions); write core code; discuss extensibility ("add an EV type with no existing code changes"). Classic practice problems: parking lot, elevator, BookMyShow seat booking, Splitwise, LRU cache, rate limiter, logger, vending machine, chess, snake and ladder, library management, notification service, pub-sub.

### 23.6 Worked example: an Uber-like ride-booking core

Entities: Rider, Driver, Vehicle (one active per driver), Quote (a rider's server-issued price), Trip (from at most one quote), TripEvent (history), Payment and Rating.

The trip state machine lives in one transition table:

```
REQUESTED → MATCHING → DRIVER_ASSIGNED → DRIVER_ARRIVED → IN_PROGRESS → COMPLETED
MATCHING → NO_DRIVERS_FOUND;  MATCHING / DRIVER_ASSIGNED / DRIVER_ARRIVED → CANCELLED
```

The request-ride sequence: idempotency check; validate the quote (owner and expiry); create a trip in MATCHING; rank candidates; offer to the best driver; on accept, atomically claim; transition to DRIVER\_ASSIGNED; publish an event.

Concurrency: claiming a driver uses a per-driver lock in process, or in production a conditional update: `UPDATE drivers SET status='dispatched', version=version+1 WHERE id=? AND status='available' AND version=?`; zero rows updated means someone else won.

The API contract returns 201 with trip, driver and PIN; 400 for a missing quote, 401 without a token, 403 for another rider's quote, 410 for an expired quote, 409 for an existing active trip, and the original response for a retried idempotency key.

Schema highlights: money as `BIGINT` paise; timestamps in UTC; `version` columns for optimistic locking; a partial unique index ensuring one active trip per rider and per driver; an index on `(rider_id, created_at DESC)` for ride history; an append-only `trip_events` table; an outbox table; one payment per trip with a unique provider reference.

The companion files `uber_lld.py` and `uber_lld_schema.sql` implement this. Running the Python file simulates a ride in which the nearest driver declines, a retried request returns the same trip, completing before starting is blocked, a wrong PIN is rejected, and completion triggers payment capture and a rating request through the event bus.

### 23.7 Practitioner's guide

Worked example: LLD of a parking lot in ten minutes.

```
Entities: ParkingLot 1─* Floor 1─* Spot(type: BIKE|CAR|TRUCK, status)
          Ticket(spot, vehicle, entry_time) · Payment
Patterns: Strategy (PricingStrategy: hourly, flat, weekend)
          State (Spot: FREE → RESERVED → OCCUPIED → FREE)
          Factory (Spot by vehicle type)
Concurrency: allocate spot with conditional update WHERE status='FREE'
```

| Aspect | Details |
| --- | --- |
| Benefits of good LLD | Easy extension, testability, fewer bugs, shared understanding |
| Constraints | Time, team skill, language features, existing codebase |
| Trade-offs | Abstraction (flexible) vs directness (readable); patterns vs simplicity |
| Use patterns when | Real variation exists (multiple pricing rules) or lifecycles need guarding |
| Avoid when | Single implementation and no foreseeable change; patterns for show |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| God class | One file changes for every feature | Split by responsibility |
| Deep inheritance trees | Fragile changes | Composition, interfaces |
| Status set directly everywhere | Illegal states | Encapsulated transition table |
| Check-then-act race | Double allocation | Atomic conditional updates or locks |

### 23.8 Production incident deep dive

**Incident: two drivers assigned to one trip.** The matching code read the driver's status, then updated it in a second step; two requests interleaved.

| Time | What happened | Why |
| --- | --- | --- |
| 08:00 | Rush hour; 50 requests per second in one area | High concurrency |
| 08:00 | Two trips read Ravi as AVAILABLE at the same moment | Check-then-act in separate statements |
| 08:00 | Both assign Ravi | No atomic claim |
| 08:05 | One rider waits for a driver who never comes | Silent conflict |
| Fix | `UPDATE drivers SET status='DISPATCHED' WHERE id=? AND status='AVAILABLE'` and check rows affected | Atomic conditional update |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Race condition | Duplicate assignments, oversold stock | Check-then-act without locking | Concurrent requests | Manual reassignment | Atomic conditional updates, optimistic locking with versions |
| Illegal state transition | Orders cancelled after delivery | Status set directly anywhere in code | Data integrity | Fix data | Central state machine with allowed transitions |
| Money rounding errors | Totals off by paise | Floats for money | Ledgers, invoices | Recalculate | Integers in the smallest unit |
| Time-zone bugs | Bookings shift by hours | Local times stored without zone | Scheduling | Correct data | Store UTC, convert at the edges |
| Retry duplicates | Two identical trips | Client retried a create | Duplicated work | Merge duplicates | Idempotency keys on create endpoints |
| God class change risk | Small change breaks unrelated features | Too many responsibilities in one class | Releases | Revert | Split by responsibility; tests per component |

**Production readiness checklist**

- Every check-then-act on shared state is atomic
- State machines own all status changes
- Money stored as integers
- Times stored in UTC
- Concurrency tests for critical flows

### Review questions

1. A fare calculator is a long `if/elif` chain and product wants EV and airport fares. Which SOLID principle breaks and which pattern fixes it?

#### Answers

1. It violates the open/closed principle: every new vehicle type or fare rule requires editing tested code. The Strategy pattern fixes it: a `PricingStrategy` interface with `StandardPricing`, `EvPricing` and `AirportFlatPricing` classes, selected by a small factory or configuration, so new rules are new classes.
