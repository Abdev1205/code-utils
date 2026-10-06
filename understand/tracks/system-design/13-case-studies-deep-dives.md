# Case Studies: Deep Dives

**Topic:** System design
**Covers:** Payment Gateway (Razorpay/Stripe-style); Food Delivery (Swiggy-style); Ride-Hailing (Uber-style); Messaging (WhatsApp-style); Notification System for 100M Users; Ticket Booking with Seat Locking (BookMyShow-style)
**Source:** [Claude artifact](https://claude.ai/artifact/7xxGdVxPGbUiPY13z4MdZ2) — written by a colleague, mirrored here for study.

Fourteen complete system designs at interview and production depth: eight expanded from Part VIII of the main book and six new ones. Every case study follows the same twelve parts: problem, requirements, capacity estimation, APIs, data model, architecture, request flows, deep dives, failure scenarios, a production incident, scaling evolution, trade-offs, and interview follow-ups with answers.

## Case Study 1: Payment Gateway (Razorpay/Stripe-style)

**Problem statement.** Let thousands of merchants accept cards, UPI, net banking and wallets through one API, move the money to them correctly, and never charge a customer twice.

**Why it is hard.** Banks and card networks are slow, flaky and sometimes return no answer at all; retries can double-charge; card data is the most targeted data on the internet; every paisa must reconcile across three or more parties; and regulators audit everything.

### 1. Requirements

Functional: create orders and payments; card, UPI, net banking and wallet methods; authorize, capture, void, full and partial refund; webhooks and status APIs; daily settlement to merchants; dashboards and reports; disputes and chargebacks; fraud checks.

| Non-functional | Target | Why |
| --- | --- | --- |
| Correctness | Zero double charges, zero lost payments | Money and trust |
| Availability | 99.99% for the payment API | Every minute down = lost sales for every merchant |
| Added latency | p99 under 300 ms on top of bank time | Checkout conversion drops with delay |
| Durability | No loss of a committed ledger entry (RPO 0) | Money records are legal records |
| Security | PCI DSS scope kept minimal; encryption everywhere | Card data theft is catastrophic |
| Auditability | Every state change traceable for years | Regulators and disputes |

### 2. Capacity estimation

```
Payments:     50M/day ÷ 86,400 ≈ 580/s average; sale days 5x → ~3,000/s peak
Bank calls:   ~3 external calls per payment (auth, 3DS/OTP, capture) → ~9,000/s at peak
Storage:      payment row 2 KB + 5 events × 0.5 KB + 3 ledger rows × 0.3 KB ≈ 5.5 KB
              50M × 5.5 KB ≈ 275 GB/day ≈ 100 TB/year before replicas
Webhooks:     ~3 per payment → 150M/day ≈ 1,700/s average
Idempotency:  50M keys/day × 0.5 KB, kept 24 h → ~25 GB hot (database + Redis cache)
```

Throughput is modest; the design is driven by correctness under failure and by external dependencies.

### 3. APIs

| Endpoint | Purpose | Notes |
| --- | --- | --- |
| `POST /v1/orders` | Create an order with amount (paise) and currency | Merchant's server, secret key |
| `POST /v1/payments` | Start a payment for an order with a method token | Requires `Idempotency-Key` |
| `GET /v1/payments/{id}` | Current status | Source of truth for merchants |
| `POST /v1/payments/{id}/capture` | Capture an authorized amount | Idempotent |
| `POST /v1/payments/{id}/refunds` | Full or partial refund | Idempotent, cannot exceed captured amount |
| Webhooks `payment.captured`, `payment.failed`, `refund.processed` | Push status to merchants | HMAC-signed, retried for days |
| `GET /v1/settlements` | Payout reports | Matches merchant bank credits |

### 4. Data model

```sql
CREATE TABLE payments (
  id            TEXT PRIMARY KEY,          -- pay_...
  merchant_id   TEXT NOT NULL,
  order_id      TEXT NOT NULL,
  amount_paise  BIGINT NOT NULL CHECK (amount_paise > 0),
  currency      CHAR(3) NOT NULL,
  method        TEXT NOT NULL,             -- card, upi, netbanking, wallet
  status        TEXT NOT NULL,             -- state machine, see 7.1
  version       INT  NOT NULL DEFAULT 0,   -- optimistic locking
  acquirer      TEXT,
  acquirer_ref  TEXT UNIQUE,               -- our unique reference sent to the bank
  created_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL
);
CREATE TABLE payment_events (             -- append-only audit trail
  id BIGSERIAL PRIMARY KEY, payment_id TEXT, from_status TEXT, to_status TEXT,
  reason TEXT, created_at TIMESTAMPTZ
);
CREATE TABLE idempotency_keys (
  merchant_id TEXT, key TEXT, request_hash TEXT, status TEXT, response JSONB,
  created_at TIMESTAMPTZ, PRIMARY KEY (merchant_id, key)
);
CREATE TABLE ledger_entries (             -- double-entry, append-only
  id BIGSERIAL PRIMARY KEY, txn_id TEXT, account TEXT,
  direction CHAR(1) CHECK (direction IN ('D','C')), amount_paise BIGINT, created_at TIMESTAMPTZ
);
CREATE TABLE outbox (                     -- events published to Kafka
  id BIGSERIAL PRIMARY KEY, topic TEXT, payload JSONB, created_at TIMESTAMPTZ, published BOOLEAN
);
```

Card numbers never appear here: they live in a separate, isolated vault that returns tokens.

### 5. Architecture

| Component | Responsibility | Key technology | Scales by |
| --- | --- | --- | --- |
| Edge and API gateway | TLS, auth by API key, rate limits, WAF | Managed LB + gateway | Horizontal |
| Hosted checkout | Collects card data directly from the customer's browser | Static JS + vault API | CDN |
| Payment service | State machine, idempotency, orchestration | Stateless service + PostgreSQL | Horizontal; DB sharded by merchant |
| Token vault | Stores card data, issues tokens | Isolated network, HSM-backed keys | Small, separate cluster |
| Risk service | Rules + ML score in under 50 ms | Feature store + model server | Horizontal |
| Smart router | Picks acquirer per payment | Success-rate tables in Redis | Horizontal |
| Connectors | Talk to acquirers, UPI switch, banks | Per-bank adapters with breakers | Per connector |
| Ledger | Double-entry money records | Strongly consistent SQL | Sharded by account |
| Outbox relay + Kafka | Reliable events | Kafka | Partitions |
| Webhook dispatcher | Delivers signed events to merchants | Queue + workers | Workers |
| Settlement and reconciliation | Daily matching and payouts | Batch jobs, warehouse | Batch parallelism |

### 6. Request flows

Card payment:

1. Merchant server creates an order; the customer opens hosted checkout.
2. The browser sends card details directly to the vault; the vault returns a token. The merchant never sees the card number.
3. Checkout calls `POST /v1/payments` with the token and an idempotency key.
4. Payment service inserts the idempotency row (or returns the saved result for a retry), creates the payment in CREATED, writes an event and outbox row in one transaction.
5. Risk service scores the payment; high risk is blocked or stepped up.
6. Smart router picks an acquirer from live success rates for this card network, issuer and amount band.
7. The customer completes 3-D Secure or OTP with their bank.
8. The connector sends authorization with our unique `acquirer_ref`; the issuer approves and holds funds.
9. Payment moves to AUTHORIZED, then CAPTURED (immediately or later); ledger entries are written in the same transaction.
10. Outbox relay publishes `payment.captured`; the webhook dispatcher notifies the merchant.
11. Next day, settlement files from the acquirer are matched to the ledger and the merchant is paid out.

UPI collect or intent: the gateway creates a request through its partner bank to the UPI switch; the customer approves in their own UPI app with their PIN; the result returns by callback, with status polling as a safety net if the callback is late.

Refund: validate amount ≤ captured − already refunded; create a refund with its own idempotency key; call the acquirer or bank; ledger entries reverse the flow; webhook `refund.processed`.

### 7. Deep dives

#### 7.1 State machine

| From | Allowed to | Trigger |
| --- | --- | --- |
| CREATED | AUTHENTICATING, FAILED | Customer starts 3DS/OTP or risk blocks |
| AUTHENTICATING | AUTHORIZED, FAILED, PENDING | Bank response or timeout |
| PENDING | AUTHORIZED, FAILED | Status poll or reconciliation |
| AUTHORIZED | CAPTURED, VOIDED | Capture call or expiry |
| CAPTURED | PARTIALLY\_REFUNDED, REFUNDED, SETTLED | Refunds, settlement |

Every transition is a conditional update (`... WHERE id=? AND status=? AND version=?`) plus an event row, so two workers can never move the same payment in conflicting directions.

#### 7.2 Idempotency under concurrency

Two identical requests can arrive at the same millisecond. The first inserts the idempotency row with status IN\_PROGRESS; the second hits the primary-key conflict and returns 409 "request in progress" (the client retries later and then receives the saved response). A different request body with the same key is rejected, because the stored request hash differs. Keys expire after 24 hours.

#### 7.3 Unknown outcomes

A timeout from the bank does not mean failure. The payment moves to PENDING, never FAILED, and is never blindly retried. A poller queries the bank's status API using our unique reference at increasing intervals (for example 5 s, 30 s, 2 min, 10 min, 1 h). If still unknown, next-day reconciliation against the bank file decides. If money was debited but the payment cannot complete, it is refunded automatically within the regulator's turnaround rules (in India, RBI sets turnaround times for failed transactions).

#### 7.4 Ledger

For a ₹500 payment with a 2% fee: debit customer funds receivable ₹500; credit merchant payable ₹490; credit fee revenue ₹10. Entries are append-only; mistakes are fixed with new reversing entries; a nightly job proves debits equal credits per transaction and per account. Balances are derived from entries, never edited directly.

#### 7.5 Smart routing

For each payment the router scores candidate acquirers by recent success rate for that segment (network × issuer × method × amount band, over the last few minutes), latency and cost. A circuit breaker removes an acquirer whose success rate collapses. Only technical failures are rerouted; a genuine decline from the issuer is final, and a retry on another route happens only when the first attempt is known not to have authorized.

#### 7.6 Webhooks

Events are signed with HMAC and a timestamp, delivered at least once with exponential backoff for up to about three days, and parked in a DLQ for replay. Merchants must deduplicate by event ID and treat `GET /payments/{id}` as the truth because webhooks can arrive late or out of order.

#### 7.7 Settlement and reconciliation

Nightly: load acquirer, UPI and bank files; match each line to ledger entries by reference and amount; classify breaks (in ledger not file, file not ledger, amount mismatch, duplicate); auto-resolve known patterns; queue the rest for operations with ageing alerts; compute payouts (captured − refunds − fees − chargebacks − reserves) and send idempotent bank transfers.

### 8. Failure scenarios

| Scenario | Detection | Why it happens | Impact | Immediate mitigation | Prevention |
| --- | --- | --- | --- | --- | --- |
| Bank timeout during authorization | Rising PENDING count | Bank slow or network drop | "Money deducted, order failed" complaints | Status polling, communicate pending state | PENDING state, reconciliation, auto-refund |
| Duplicate request | Two payments for one order | Client retry after timeout | Double charge | Refund duplicate | Idempotency keys with unique constraint |
| Acquirer degraded | Success rate drop for one route | Acquirer incident | Lower conversion | Breaker reroutes traffic | Multiple acquirers, live success tables |
| Webhook endpoint down | Delivery failures for a merchant | Merchant outage | Merchant misses updates | Keep retrying; DLQ | Status API; replay tools |
| Ledger imbalance | Nightly check fails | Bug or partial write | Wrong balances | Freeze payouts for affected accounts | Single-transaction writes; invariant checks |
| Database primary fails | Write errors | Hardware failure | Payments stop briefly | Failover to synchronous replica | Synchronous replica in another zone; drills |
| Fraud model down | Model timeouts | Model service outage | Fraud or false declines | Fall back to rules | Rules engine always available |
| Card data in logs | Log scanner alert | Debug logging | PCI breach | Purge and rotate | Masking at the logging layer; vault isolation |
| Hot merchant | One shard saturated | Huge flash sale | Slow payments for co-located merchants | Move merchant to its own shard | Directory-based sharding for big merchants |
| Settlement file late | Reconciliation job waiting | Bank delay | Delayed payouts | Notify merchants | Retry and alert schedule |

### 9. Production incident walkthrough

| Time | Event | Response |
| --- | --- | --- |
| 20:00 | Sale starts; traffic 5x | Pre-scaled stateless tiers |
| 20:07 | Acquirer A success rate for one issuer drops from 92% to 40% | Breaker trips; router shifts that segment to acquirer B |
| 20:09 | 3,000 payments stuck in PENDING at acquirer A | Poller checks status; most resolve within 10 minutes |
| 20:30 | 120 payments still unknown | Marked for next-day reconciliation; customers shown "processing" |
| Next day | Reconciliation finds 80 debited, 40 not | 80 completed or auto-refunded; 40 closed as failed |
| Postmortem | Breaker reacted in 2 minutes | Shorter windows per issuer segment; alert on PENDING growth |

### 10. Scaling evolution

| Stage | Volume | Architecture |
| --- | --- | --- |
| Launch | Thousands/day | One service, PostgreSQL, one acquirer, hosted checkout from day one |
| Growth | Millions/day | Outbox + Kafka, webhooks service, second acquirer, risk rules |
| Scale | Tens of millions/day | Sharded payments DB by merchant, smart routing, ML risk, separate ledger service, automated reconciliation |
| Large scale | Hundreds of millions/day | Cells per merchant group, multi-region with regional data residency, dedicated shards for giant merchants |

### 11. Trade-offs

| Decision | Chosen | Alternative | Why |
| --- | --- | --- | --- |
| Consistency | Strong (CP) for payments and ledger | Eventual | Money cannot be "eventually right" |
| Amount type | Integer paise | Decimal or float | Exact arithmetic, no rounding drift |
| Card handling | Hosted fields + isolated vault | Merchant collects cards | Minimal PCI scope |
| Timeouts | PENDING + reconcile | Mark failed or retry | Avoid lost or double payments |
| Events | Transactional outbox | Publish after commit | No lost or phantom events |
| Routing | Live success-rate scoring | Static priority | Higher conversion, automatic failover |

### 12. Interview follow-ups

1. How do you guarantee no double charge across two data centers? One region owns each merchant's payment writes (or each payment ID); idempotency keys live with that owner; the bank also receives our unique reference so it rejects duplicates.
2. A merchant says a webhook never arrived. What do you check? Delivery logs and DLQ for that event ID, the merchant's response codes, signature failures; then replay, and remind them to reconcile with the status API.
3. How would you design partial refunds safely? Lock the payment row, check captured − refunded ≥ amount, insert the refund with its own idempotency key, write reversing ledger entries in the same transaction.
4. Why not call the bank directly from the merchant's server? The gateway provides routing, retries, PCI scope reduction, risk checks, reconciliation and one API across methods.
5. How do you test this safely? Sandbox mode with fake banks and test cards, fault injection for timeouts and duplicates, and reconciliation run against test files.

## Case Study 2: Food Delivery (Swiggy-style)

**Problem statement.** Let customers find nearby restaurants, order and pay, have the restaurant cook it, assign a rider who picks it up at the right moment, and show live tracking until delivery, at dinner-rush and IPL-night scale.

**Why it is hard.** It is a three-sided marketplace (customers, restaurants, riders) whose parts behave differently; rider GPS creates huge write volume; payments must be exact while browsing can be stale; prep times and traffic are uncertain; and demand spikes in minutes.

### 1. Requirements

Functional: restaurant discovery and search by location; menus with live availability; cart, offers and checkout; payment; order lifecycle with restaurant acceptance; rider assignment; live tracking and ETA; notifications; ratings; support.

| Non-functional | Target | Why |
| --- | --- | --- |
| Browse latency | p99 under 300 ms | Discovery drives conversion |
| Order placement | p99 under 1 s, no lost or duplicate orders | Money and trust |
| Availability | 99.95% for ordering, payment and tracking | Peak hours are most of the revenue |
| Tracking freshness | Rider position on screen within about 5 s | Customers watch the map |
| Consistency | Strong for payments, coupons, rider assignment; eventual for menus and ratings | Per-feature choice |

### 2. Capacity estimation

```
Browse:    10M daily users × 30 requests = 300M/day ≈ 3,500/s; dinner peak ~15,000-20,000/s
Orders:    3M/day; 20% in the busiest hour → ~170/s; IPL spike ~500/s
GPS:       300K active riders ÷ every 4 s ≈ 75,000 writes/s (~100 bytes each ≈ 650 GB/day raw)
Tracking:  ~170 orders/s × ~35 min ≈ 360,000 orders being tracked at once
Orders DB: 3M × 5 KB ≈ 15 GB/day ≈ 5.5 TB/year
Images:    menu photos served from CDN; origin traffic small
```

The highest-volume path (GPS) and the most correctness-critical path (orders and payments) must be separated.

### 3. APIs

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/restaurants?lat=&lng=&cuisine=` | Serviceable restaurants near a location |
| `GET /v1/restaurants/{id}/menu` | Menu with live availability |
| `PUT /v1/cart` | Update cart (server recomputes prices) |
| `POST /v1/orders` | Place order with `Idempotency-Key`; returns payment details |
| `GET /v1/orders/{id}` | Status and ETA |
| `WS /v1/orders/{id}/track` | Live rider position and ETA updates |
| `POST /v1/restaurant/orders/{id}/accept` | Restaurant accepts and gives prep time |
| `POST /v1/rider/location` | Batched GPS points from the rider app |
| `POST /v1/rider/orders/{id}/pickup`, `/deliver` | Rider milestones |

### 4. Data model

```sql
CREATE TABLE orders (
  id TEXT PRIMARY KEY, user_id TEXT, restaurant_id TEXT, rider_id TEXT,
  status TEXT, items JSONB, total_paise BIGINT, coupon_code TEXT,
  version INT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX one_active_order_per_rider
  ON orders (rider_id) WHERE status IN ('RIDER_ASSIGNED','PICKED_UP');
CREATE TABLE order_events (id BIGSERIAL, order_id TEXT, status TEXT, at TIMESTAMPTZ); -- append-only
CREATE TABLE coupon_usage (coupon_code TEXT, user_id TEXT, order_id TEXT,
  PRIMARY KEY (coupon_code, user_id));              -- one use per user
```

Other stores: Redis (carts, rider latest location and geo index, serviceability cache), Elasticsearch (restaurant and dish search with geo filters), Cassandra or object storage (rider location history), Kafka (order events, location stream, outbox).

### 5. Architecture

| Component | Responsibility | Store | Scales by |
| --- | --- | --- | --- |
| BFFs per app | Shape responses for customer, restaurant and rider apps | none | Horizontal |
| Discovery and search | Nearby restaurants, ranking, search | Elasticsearch, Redis cell cache | Read replicas, caching |
| Catalog | Menus, availability toggles | PostgreSQL + Redis | Caching, events |
| Cart and pricing | Cart state, fees, taxes, offers | Redis; coupon DB | Horizontal |
| Order service | State machine, saga orchestration | PostgreSQL sharded by order ID | Shards |
| Payment service | Gateway integration, pending handling | PostgreSQL | Horizontal |
| Restaurant service | Order alerts, acceptance, prep time | WebSocket + push + IVR | Connections |
| Dispatch | Rider matching per zone | In-memory per zone + Redis | Zone partitioning |
| Location service | GPS ingestion and latest position | Kafka → Redis, Cassandra | Kafka partitions |
| Tracking gateway | Push rider position to customers | WebSockets + pub/sub | Connections |
| ETA service | Predict delivery time | ML model + feature store | Horizontal |
| Notifications | Push, SMS, email | Queue + providers | Workers |

### 6. Request flows

Placing an order:

1. Customer taps "Place order"; the app sends cart ID and an idempotency key.
2. Pricing recomputes items, availability, fees, taxes and the coupon; client-sent totals are ignored.
3. Coupon use is reserved atomically (unique row per user, counter decrement for global limits).
4. Order service creates the order in PAYMENT\_PENDING with an outbox event, in one transaction.
5. Payment completes through the gateway; its webhook (verified) moves the order to CONFIRMED.
6. The restaurant tablet receives the order via WebSocket and push; the restaurant accepts and sets prep time (for example 18 minutes).
7. Dispatch plans rider assignment so the rider arrives near food-ready time.
8. Rider accepts; order becomes RIDER\_ASSIGNED; tracking starts.
9. Pickup and delivery events update status; ratings are requested after delivery.

Rider location update: the rider app batches points every 4 s → ingestion → Kafka (keyed by rider) → consumers update Redis latest position and geo index, push to customers watching that order, feed the ETA service, and write downsampled history.

### 7. Deep dives

#### 7.1 Discovery and serviceability

The city is divided into hexagonal cells. Each restaurant has a delivery area computed from travel time, shrunk dynamically when riders are scarce (rain, peak). Results for a cell are cached for 30-60 seconds; personalization re-ranks the cached candidates per user. Checkout re-validates, so stale browse data never produces a wrong order.

#### 7.2 Order saga

| Step | Action | Compensation if a later step fails |
| --- | --- | --- |
| 1 | Reserve coupon | Release coupon |
| 2 | Create order (PAYMENT\_PENDING) | Cancel order |
| 3 | Payment captured | Refund |
| 4 | Restaurant accepts within N minutes | Cancel, refund, notify |
| 5 | Rider assigned | Release rider, retry dispatch |

A durable workflow engine holds timers ("if not accepted in 3 minutes, escalate by IVR call; after 6 minutes, cancel and refund"), survives restarts, and makes every step idempotent.

#### 7.3 Dispatch

Greedy "nearest free rider now" sends riders too early and steals the only rider from another restaurant. Instead, each zone runs a matcher every few seconds: collect pending orders and available or soon-available riders, compute costs (travel time to restaurant, wait at restaurant, delivery time, rider fairness), and solve the assignment. Riders are claimed atomically (conditional update or lease); a rider who rejects or times out triggers reassignment. Two nearby orders from one restaurant may be batched to one rider.

#### 7.4 ETA

ETA = accept time + prep time + rider to restaurant + wait + travel + last-mile handover. Each part is predicted by ML with live features (restaurant queue length, weather, traffic, events) and updated at every milestone. If the model fails, a heuristic (historical averages per restaurant and distance) takes over. Error is monitored per city and hour.

#### 7.5 Peak handling

Pre-scale before dinner and matches; cache browse aggressively; shed in order of importance (recommendations, reviews, loyalty updates first; never order placement, payments, dispatch or tracking); shrink serviceability when riders are short; rate-limit bots.

### 8. Failure scenarios

| Scenario | Detection | Why it happens | Impact | Immediate mitigation | Prevention |
| --- | --- | --- | --- | --- | --- |
| Payment gateway degraded | Payment success rate drop | Provider incident | Orders cannot be placed | Breaker to backup gateway; UPI banner | Two or more gateways; pending handling |
| Restaurant tablet offline | No acceptance within 2 min | Device or Wi-Fi failure | Order stuck | IVR call, then auto-cancel and refund | Multi-channel alerts; restaurant health status |
| Zone dispatcher crash | Unassigned orders rise in one zone | Process failure | Late deliveries in that zone | Failover to standby | Stateless matcher rebuilt from Redis state |
| Rider app offline (tunnel) | Stale location | Network gap | Wrong ETA | Show last known position with estimate | Local buffering and resend |
| Coupon oversold | Usage above budget | Non-atomic counter | Financial loss | Disable coupon | Atomic counters and unique constraints |
| Kafka consumer lag | Lag alerts | Slow consumer, hot partition | Stale tracking | Scale consumers | Partition by rider; lag-based autoscaling |
| Duplicate order | Two orders same cart | Retry on timeout | Double charge | Cancel and refund | Idempotency keys |
| Search cluster slow | Browse latency rise | Heavy queries, node loss | Fewer orders | Serve cached cell results | Replicas, query limits, cache |

### 9. Production incident walkthrough

| Time | Event | Response |
| --- | --- | --- |
| 19:30 | Heavy rain; rider supply drops 30% | Serviceability radius shrinks automatically |
| 19:45 | Orders still rise; unassigned orders in 4 zones grow | Surge delivery fee on; promotions paused |
| 20:00 | ETA error doubles | Weather feature lagging; heuristic adjustment applied |
| 20:20 | Support chats triple | Support bot answers delay questions with live order data |
| Postmortem | Rain response took 15 minutes | Automated rain mode triggered by rider supply and weather feed |

### 10. Scaling evolution

| Stage | Architecture |
| --- | --- |
| One city | Modular monolith, PostgreSQL, Redis, one payment gateway, nearest-rider dispatch, polling for tracking |
| Several cities | Elasticsearch, CDN, Kafka, WebSockets, read replicas; location and dispatch split out first |
| National | Microservices, zone batch dispatch, ML ETAs, multi-gateway, city-level cells, load shedding |

### 11. Trade-offs

| Decision | Chosen | Alternative | Why |
| --- | --- | --- | --- |
| Rider GPS storage | Kafka + Redis + Cassandra | Orders database | Volume and access pattern differ completely |
| Dispatch | Batched per zone | Instant nearest | Better global outcomes; small delay acceptable |
| Order workflow | Orchestrated saga | Choreographed events | Clear timers and compensations |
| Browse consistency | Eventual, cached | Strong | Speed; checkout validates |
| Tracking transport | WebSockets | Polling | Freshness without waste |

### 12. Interview follow-ups

1. How do you prevent two riders on one order? Assignment is a conditional update on the order and a lease on the rider; a partial unique index allows one active order per rider.
2. How do you show live tracking to 360,000 customers? Tracking gateways hold WebSockets; a connection registry maps order to gateway; location consumers publish per order and the gateway forwards.
3. What if the restaurant never accepts? Saga timer escalates (push, IVR call), then cancels and refunds automatically.
4. How would you design "Instamart-style" 10-minute delivery differently? Dark stores with inventory systems, picking workflows, stricter serviceability and much smaller zones.
5. How do you measure ETA quality? Mean absolute error and the share of orders late by more than X minutes, by city, hour and restaurant.

## Case Study 3: Ride-Hailing (Uber-style)

**Problem statement.** Match a rider standing on a street with a nearby driver within seconds, show an upfront price, track both sides live, and complete payment and payout safely.

**Why it is hard.** Both sides move; location lookups sit on the critical path of every quote and match; demand spikes in small areas (airports, stadiums); prices must be fair yet balance supply and demand; and a failure can strand a person at night.

### 1. Requirements

Functional: set pickup and drop; fare and ETA per product; request ride; driver offer and accept; live tracking for both; PIN-verified start; trip completion, payment, tip, rating; driver online or offline, earnings and payouts; safety (share trip, SOS).

| Non-functional | Target | Why |
| --- | --- | --- |
| Match time | Driver assigned within about 10-30 s in dense areas | Riders abandon quickly |
| Location freshness | Driver position updated every \~4 s | Accurate matching and ETAs |
| Availability | 99.99% for request, match and active trips | Stranded riders are a safety issue |
| Consistency | Strong for driver-trip assignment, quotes and payments | One driver per trip; agreed fare |
| Latency | Quote under 500 ms | Interactive flow |

### 2. Capacity estimation

```
Trips:        20M/day; busiest hour 10% → ~555 requests/s; spikes ~1,700/s
Quotes:       ~3 per trip → ~1,700/s peak, ~5,000/s during spikes
GPS:          1.5M online drivers ÷ 4 s ≈ 375,000 updates/s (~3 TB/day raw)
Active trips: ~555/s × 20 min ≈ 670,000 concurrent trips
Trip records: 20M × 10 KB ≈ 200 GB/day
Connections:  1.5M drivers + active riders on persistent connections
```

### 3. APIs

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/quotes` | Pickup, drop, product → fare, ETA, `quote_id`, expiry |
| `POST /v1/trips` | Request with `quote_id` and `Idempotency-Key` |
| `GET /v1/trips/{id}` | Status, driver, ETA |
| `WS /v1/rider/stream` | Driver location, status changes |
| `POST /v1/driver/location` | Batched GPS points |
| `POST /v1/driver/offers/{id}/accept` | Accept a trip offer |
| `POST /v1/trips/{id}/start` | Start after rider PIN check |
| `POST /v1/trips/{id}/complete` | End trip, final fare |

### 4. Data model

```sql
CREATE TABLE trips (
  id TEXT PRIMARY KEY, rider_id TEXT, driver_id TEXT, city_id TEXT,
  status TEXT, quote_id TEXT, fare_paise BIGINT, surge NUMERIC(4,2),
  pickup GEOGRAPHY, dropoff GEOGRAPHY, version INT,
  requested_at TIMESTAMPTZ, completed_at TIMESTAMPTZ
);
CREATE TABLE quotes (id TEXT PRIMARY KEY, rider_id TEXT, product TEXT,
  fare_paise BIGINT, expires_at TIMESTAMPTZ);   -- or a signed token
CREATE TABLE drivers (id TEXT PRIMARY KEY, status TEXT, current_trip TEXT, version INT);
```

In memory (sharded by city or region): H3 cell → available drivers; driver → latest position, heading, status, last update time. History of GPS points goes to a wide-column store or object storage for disputes, safety and model training.

### 5. Architecture

| Component | Responsibility | Scales by |
| --- | --- | --- |
| Edge with GeoDNS | Route users to the nearest healthy region | Regions |
| Driver connection gateway | Holds persistent driver connections; receives GPS; pushes offers | Connections per node |
| Location service | In-memory geospatial index per city shard | Geographic sharding |
| Pricing and quotes | Fare calculation, surge multipliers, quote storage | Horizontal |
| Surge service | Per-cell demand vs supply every minute | Per city |
| Dispatch | Candidate search, ranking, offers, atomic claims | Consistent hashing by area |
| Maps, routing, ETA | Road graph, traffic, ML corrections | Horizontal, cached |
| Trip service | State machine and timers (durable workflows) | Sharded by trip |
| Payments and ledger | Hold, capture, tips, driver earnings | Strongly consistent stores |
| Safety and fraud | Anomaly detection, GPS spoofing, collusion | Streaming + batch |

### 6. Request flows

Requesting a ride:

1. Rider app asks for quotes; pricing uses route distance and time plus the surge multiplier for the pickup cell, stores the quote with a short expiry and returns `quote_id`.
2. Rider requests with `quote_id`; trip service creates REQUESTED, places a payment authorization hold, and starts the matching workflow.
3. Dispatch searches H3 rings around pickup for available drivers of that product, plus drivers about to finish nearby trips.
4. Candidates are ranked by road ETA to pickup (not straight-line distance), acceptance likelihood and fairness.
5. The best driver receives an offer with a \~15 s timeout; others are not offered simultaneously.
6. On accept, the driver is claimed atomically (`UPDATE drivers SET status='DISPATCHED' WHERE id=? AND status='AVAILABLE'`); the trip becomes DRIVER\_ASSIGNED.
7. Both apps receive live positions; at pickup the rider gives a PIN; the trip moves to IN\_PROGRESS.
8. At drop-off the final fare is computed (quote rules), captured, and split in the ledger between driver earnings, platform fee and taxes.

### 7. Deep dives

#### 7.1 Geospatial index

Uber open-sourced H3, a hexagonal grid. Hexagons have six equidistant neighbors, so expanding search rings (k-rings) around a cell is uniform at any resolution. The index maps cell → driver set and driver → state; entries expire if no update arrives within \~15 s. A lost shard is rebuilt within seconds from the next round of GPS updates, so location data needs no heavy durability. Hot cells (airports) use finer resolution and dedicated shards.

#### 7.2 Matching and offers

Sequential offers avoid two drivers accepting the same trip and avoid spamming drivers. In dense areas, requests are batched for a couple of seconds and matched together to minimize total pickup time. Rejections and timeouts move to the next candidate; after N failures the rider is told no drivers are available.

#### 7.3 Surge pricing

Every minute, each cell computes demand (requests, app opens) versus supply (available plus soon-available drivers). The multiplier is smoothed with neighboring cells and over time, capped by policy, and published to drivers as a heat map. Riders pay the price locked in their quote, never a recalculated one.

#### 7.4 ETA and routing

A road graph with preprocessing (such as contraction hierarchies) answers routes in milliseconds; live traffic comes from drivers' own GPS traces; an ML layer corrects for time of day, weather, events and pickup difficulty. Popular origin-destination pairs are cached; if routing fails, cached matrices or straight-line estimates keep quotes working.

#### 7.5 Trip lifecycle and durability

Trips follow REQUESTED → MATCHING → DRIVER\_ASSIGNED → DRIVER\_ARRIVING → DRIVER\_ARRIVED → IN\_PROGRESS → COMPLETED → PAID, with cancellation and no-show branches. Timers (offer timeout, no driver found, no-show fee, long-stationary safety check) live in a durable workflow engine; Uber created Cadence, from which Temporal later grew.

#### 7.6 Multi-region

Cities are served from their nearest region; trip state replicates to a standby region. If a region fails, apps reconnect elsewhere and help rebuild in-flight trips from what they hold locally (trip ID, driver, status).

### 8. Failure scenarios

| Scenario | Detection | Why it happens | Impact | Immediate mitigation | Prevention |
| --- | --- | --- | --- | --- | --- |
| Two drivers accept one trip | Conflicting assignments | Non-atomic claim or parallel offers | Confusion, wasted driver time | Cancel one, compensate | Sequential offers; conditional update |
| Location shard lost | Missing drivers in an area | Node failure | No matches briefly | Rebuild from incoming GPS | TTL-based, rebuildable state; replicas for hot cities |
| Routing service slow | Quote latency rise | Overload, map update | Slow or failed quotes | Cached ETA matrices | Caching, timeouts, fallbacks |
| Surge flicker | Prices jump across a street or minute | No smoothing | Rider distrust | Freeze multipliers | Spatial and temporal smoothing, caps |
| GPS spoofing | Impossible jumps or speeds | Fraudulent driver apps | Fake trips, fraud | Suspend accounts | Sensor consistency checks, device attestation |
| Payment authorization fails | Hold declined | Card issue | Trip cannot be guaranteed | Ask for another method | Pre-checks at request time |
| Region outage | Connection drops in many cities | Cloud region failure | Active trips at risk | Fail over; client-assisted rebuild | Standby capacity, drills |
| Offer storm to one driver | Driver flooded with offers | Many requests ranking the same driver | Driver annoyance | Cap offers per driver | Batch matching; one active offer per driver |

### 9. Production incident walkthrough

| Time | Event | Response |
| --- | --- | --- |
| 22:30 | Concert ends; 30,000 people request in one area | Batch matching on; surge rises with caps |
| 22:32 | Location shard for that area at 95% CPU | Cell split to finer resolution; extra replica |
| 22:35 | Pickups chaotic at the venue gate | Dedicated pickup zones pushed to apps |
| 23:10 | Demand normal | Surge decays smoothly |
| Postmortem | Event known in advance | Event calendar feeds pre-positioning and pre-scaling |

### 10. Scaling evolution

| Stage | Architecture |
| --- | --- |
| One city | Monolith, PostgreSQL with geospatial index, nearest-driver matching, polling |
| Many cities | Location service in memory, Kafka, WebSockets, separate dispatch and pricing |
| Global | H3 sharded by city, batch matching, ML ETAs, durable workflows, multi-region with failover |

### 11. Trade-offs

| Decision | Chosen | Alternative | Why |
| --- | --- | --- | --- |
| Location storage | In memory, rebuildable | Durable database | Speed; data refreshes every 4 s |
| Ranking | Road ETA | Straight-line distance | Riders care about time |
| Offers | Sequential with timeout | Broadcast to many drivers | No accept races, better driver experience |
| Pricing | Locked quote | Price at trip end | Rider trust |
| Grid | Hexagons (H3) | Squares or geohash | Uniform neighbor distances |

### 12. Interview follow-ups

1. How would you add shared rides? Matching becomes vehicle routing with detour limits; seats are a capacity; pricing splits by distance; ETA promises include pickups of other riders.
2. How do you keep driver location writes cheap? Batch on the phone, send deltas, keep only the latest in memory, downsample history asynchronously.
3. How do you handle airports? Virtual queues for drivers, geofenced pickup zones, finer cells and dedicated shards.
4. How do you detect a stopped car during a trip? Stream processing on trip GPS; long stationary periods or route deviation trigger safety check-ins.
5. What is consistent and what is eventual? Assignment, quotes and payments are strongly consistent; locations, surge maps and ratings are eventually consistent.

## Case Study 4: Messaging (WhatsApp-style)

**Problem statement.** Deliver every message exactly once (as users see it), in order, instantly when online and reliably when offline, across several devices per user, with end-to-end encryption so the server cannot read anything.

**Why it is hard.** Hundreds of millions of devices hold open connections over flaky mobile networks; retries create duplicates; encryption removes server-side features such as search and spam scanning; and groups multiply every message.

### 1. Requirements

Functional: one-to-one and group chats; text, media and voice notes; sent, delivered and read ticks; offline delivery; multiple devices per account; presence and typing; push notifications; voice and video calls.

| Non-functional | Target | Why |
| --- | --- | --- |
| Latency | Online delivery under \~300 ms in-region | Feels instant |
| Delivery guarantee | No lost messages; duplicates invisible | Trust |
| Ordering | Per-conversation order preserved | Replies must follow their parent |
| Privacy | End-to-end encrypted; minimal metadata | Core promise |
| Availability | 99.99% | Primary communication channel |

### 2. Capacity estimation

```
Messages:     2B daily users × 50 = 100B/day ≈ 1.2M/s average, ~3M/s peak
Deliveries:   ~3 devices per recipient → ~3-10M deliveries/s
Connections:  500M-1B devices online; ~1M connections per gateway → 500-1,000 gateways
Text:         ~300 bytes each → ~30 TB/day flowing, deleted after delivery
Media:        10B items/day × ~200 KB ≈ 2 PB/day → object storage + CDN, with expiry
```

### 3. APIs and protocol

Clients keep one persistent, encrypted connection with a compact binary protocol. Main frames:

| Frame | Direction | Content |
| --- | --- | --- |
| `SEND` | Client → server | `client_msg_id`, recipient, ciphertext per device |
| `ACK_SERVER` | Server → client | Message stored; shows one tick |
| `DELIVER` | Server → device | Ciphertext with server sequence number |
| `ACK_DEVICE` | Device → server | Delivered; second tick; mailbox copy deleted |
| `RECEIPT_READ` | Device → sender | Read receipt (also end-to-end encrypted) |
| `PRESENCE`, `TYPING` | Both | Ephemeral, best effort |
| Media upload | HTTPS | Encrypted blob to object storage, returns URL |

### 4. Data model

| Store | Key | Holds | Lifetime |
| --- | --- | --- | --- |
| Mailbox (write-optimized store) | device\_id → sequence | Undelivered ciphertext | Until device ACK (or expiry, e.g. \~30 days) |
| Session registry (Redis) | user/device → gateway | Where each device is connected | TTL refreshed by heartbeats |
| Key directory | user/device | Public identity keys, one-time prekeys | Long-lived |
| Groups | group\_id | Members, admins, sender-key metadata | Long-lived |
| Media | blob ID | Encrypted media | Expiry policy |
| Conversation sequence | conversation\_id | Next sequence number | Long-lived |

Chat history lives on devices and in user-controlled encrypted backups, not on the server.

### 5. Architecture

| Component | Responsibility | Scales by |
| --- | --- | --- |
| Edge (GeoDNS, L4 load balancers) | Route to nearest region, spread connections | Regions |
| Connection gateways | Hold sockets, heartbeats, frame parsing | \~1M connections per node |
| Message router | Persist, sequence, route to recipient devices | Stateless, horizontal |
| Mailbox store | Durable per-device queues | Partitioned by device |
| Session registry | Device → gateway lookup | Redis cluster |
| Group service | Membership and fan-out lists | Partitioned by group |
| Push service | APNs/FCM wake-ups for offline devices | Workers |
| Key service | Public keys and prekeys | Replicated store |
| Media service | Resumable encrypted uploads, CDN downloads | Object storage + CDN |
| Calling | Signaling via messages; TURN relays and SFUs for media | Relays per region |

### 6. Request flows

Sending a message:

1. The sender's app creates `client_msg_id`, encrypts the message separately for each recipient device, and sends it.
2. The gateway passes it to the router, which assigns the next sequence number for the conversation and writes it durably to each recipient device's mailbox.
3. Only after the write succeeds does the server ACK the sender: one tick.
4. The router looks up recipient devices in the session registry. Online devices receive it through their gateway; offline devices get a push notification.
5. Each receiving device ACKs; the mailbox copy is deleted; the sender sees two ticks.
6. When the recipient opens the chat, a read receipt flows back: blue ticks.

Offline device comes online: it connects, authenticates, and drains its mailbox in sequence order; duplicates (same `client_msg_id`) are dropped by the client.

### 7. Deep dives

#### 7.1 Exactly once, as the user sees it

The network can only offer at-least-once delivery. Senders retry until ACKed; the server deduplicates by `client_msg_id`; receivers deduplicate again. The tick is shown only after durable storage, so a crash never silently loses a message the sender believes was sent.

#### 7.2 Ordering

Phone clocks are unreliable. The server assigns monotonically increasing sequence numbers per conversation; clients display by sequence. Messages for one conversation are processed by one partition, which keeps order.

#### 7.3 Encryption

WhatsApp has publicly stated it uses the Signal Protocol. Each device publishes identity keys and one-time prekeys; senders can start encrypted sessions while the recipient is offline; keys ratchet with each message for forward secrecy. Groups use sender keys: each member encrypts once and the server fans out, and keys rotate when someone leaves.

#### 7.4 Groups and fan-out

Small and medium groups use fan-out on write: one mailbox entry per member device. Very large broadcast channels use fan-out on read: the post is stored once and followers pull it. The threshold is a capacity decision.

#### 7.5 Connection gateways

Gateways are stateful (they own sockets) but hold no message data. Heartbeats keep NAT mappings alive and detect dead clients. Deploys drain gradually; clients reconnect with jittered backoff; admission control protects the gateway tier during mass reconnects.

#### 7.6 Features under encryption

Search runs on the device; abuse detection uses metadata, behavior, forwarding limits and user reports; link previews are generated by the sender's device; backups are encrypted with keys the user controls.

### 8. Failure scenarios

| Scenario | Detection | Why it happens | Impact | Immediate mitigation | Prevention |
| --- | --- | --- | --- | --- | --- |
| Tick shown before persistence | Lost-message reports | ACK sent before durable write | Silent loss | Fix ordering | Persist first, then ACK |
| Duplicate messages | Same text twice in chat | Retries without dedupe | Confusion | Client-side dedupe | `client_msg_id` dedupe at server and client |
| Out-of-order messages | Replies above their parent | Ordering by client clocks or multiple partitions | Confusing chats | Reorder by sequence | Server sequence per conversation |
| Reconnect storm | Connection rate spike | Gateway restart or network blip | Overload | Admission control | Draining, jittered backoff |
| Mailbox growth | Storage rising | Devices offline for weeks | Cost | Expire old mailboxes | Retention limits |
| Registry stale | Messages routed to dead gateways | Missed heartbeat cleanup | Delivery delay | Fall back to push | TTL-based registry entries |
| Push provider delay | Offline users notified late | APNs/FCM issues | Late messages | None beyond retry | Multiple wake-up strategies |
| Removed member reads group | Security issue | Sender key not rotated | Privacy breach | Rotate keys | Automatic rotation on membership change |

### 9. Production incident walkthrough

| Time | Event | Response |
| --- | --- | --- |
| 23:59 | New Year: message rate 5x normal in minutes | Pre-scaled gateways and routers |
| 00:00 | Media uploads spike (photos, videos) | Media service queues uploads; text unaffected |
| 00:02 | Mailbox write latency rises in one region | Hot partitions on large family groups; extra capacity |
| 00:10 | Delivery delays up to 30 s for some groups | Accepted; tick semantics kept honest |
| Postmortem | Predictable peak | Annual pre-scaling playbook; group fan-out capacity tests |

### 10. Scaling evolution

| Stage | Architecture |
| --- | --- |
| Early | Single region, gateways + router + database for messages, push notifications |
| Growth | Mailboxes per device, session registry, media on object storage + CDN |
| Massive | Regions worldwide, end-to-end encryption, multi-device keys, broadcast channels with fan-out on read |

### 11. Trade-offs

| Decision | Chosen | Alternative | Why |
| --- | --- | --- | --- |
| Storage | Store until delivered | Full server history | Privacy, smaller storage |
| Delivery | At-least-once + dedupe | Exactly-once protocol | Achievable and simple |
| Group fan-out | On write for groups; on read for channels | One approach for all | Balance cost and latency |
| Ordering | Server sequence numbers | Client timestamps | Clocks are unreliable |
| Encryption | End to end | Server-side encryption | Server cannot read messages |

### 12. Interview follow-ups

1. How does a new device get old messages? Through an encrypted backup or a device-to-device transfer, since the server does not keep history.
2. How do you show "last seen" at scale? Presence in a TTL store updated by heartbeats, with privacy settings and only sent to subscribed contacts.
3. What breaks when a 1,024-member group sends a video? Fan-out of the small encrypted pointer is cheap; the large media is uploaded once and downloaded from the CDN.
4. How do you rate-limit spam without reading messages? Rates per account, new-account limits, forwarding limits, reports, metadata patterns.
5. Why separate gateways from routers? Gateways are stateful and hard to move; routers are stateless and can scale and deploy freely.

## Case Study 9: Notification System for 100M Users

**Problem statement.** Let every product team send push notifications, SMS, email and in-app messages to the right users, at the right time, without spamming them, duplicating messages, or losing urgent ones such as OTPs.

**Why it is hard.** Traffic is extremely bursty (a campaign to 50 million users vs one OTP); third-party providers have rate limits and outages; users have preferences, quiet hours and time zones; duplicates annoy users while lost OTPs block logins; and cost per SMS is real money.

### 1. Requirements

Functional: send to one user or segments; channels push, SMS, email, in-app, WhatsApp; templates with localization; scheduling and time-zone delivery; user preferences and opt-outs; priorities; delivery tracking (sent, delivered, opened); retries and fallbacks between channels.

| Non-functional | Target | Why |
| --- | --- | --- |
| Latency (critical) | OTP and security alerts sent within \~2 s | Users wait on them |
| Throughput (bulk) | 50M campaign pushes within \~30 minutes | Marketing windows |
| Delivery | No loss of critical messages; no visible duplicates | Trust |
| Compliance | Opt-outs honored, quiet hours, regulatory rules (e.g. DLT registration for SMS in India) | Legal and reputational |
| Isolation | Bulk campaigns never delay OTPs | Priority protection |

### 2. Capacity estimation

```
Users:        100M; transactional ~3/user/day → 300M/day ≈ 3,500/s average, ~15,000/s peak
Campaigns:    50M pushes in 30 min → ~28,000/s for the campaign window
OTPs:         5M/day; bursts of ~500/s; strict latency
Storage:      message log ~1 KB × ~400M/day ≈ 400 GB/day (keep 30-90 days hot)
Device tokens: ~150M devices × ~200 bytes ≈ 30 GB
```

### 3. APIs

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/notifications` | Send to a user: template, variables, channels, priority, `Idempotency-Key` |
| `POST /v1/campaigns` | Send to a segment at a time or per user's local time |
| `GET /v1/notifications/{id}` | Delivery status per channel |
| `PUT /v1/users/{id}/preferences` | Channel opt-ins, quiet hours, categories |
| `POST /v1/devices` | Register or refresh push tokens |
| Provider callbacks | Delivery reports from SMS, email and push providers |

### 4. Data model

| Table | Key | Fields |
| --- | --- | --- |
| notifications | id | user, template, category, priority, idempotency key, created\_at |
| deliveries | (notification\_id, channel) | provider, provider message ID, status, attempts, timestamps |
| preferences | user\_id | per category and channel opt-in, quiet hours, time zone, language |
| devices | (user\_id, device\_id) | platform, push token, last seen, valid flag |
| templates | (template\_id, version, locale) | content, approved flag (e.g. SMS registration) |
| rate\_counters (Redis) | user/category/day | counts for frequency caps |

### 5. Architecture

| Component | Responsibility | Scales by |
| --- | --- | --- |
| Notification API | Validate, dedupe by idempotency key, enqueue | Horizontal |
| Campaign service | Expand segments in batches; schedule by time zone | Batch workers |
| Priority queues (Kafka topics) | Separate critical, transactional and bulk streams | Partitions |
| Policy engine | Preferences, opt-outs, quiet hours, frequency caps, dedupe window | Redis-backed, horizontal |
| Renderer | Templates, localization, personalization | Horizontal |
| Channel workers | Push (APNs/FCM), SMS, email, WhatsApp adapters | Per channel, rate-limited |
| Provider router | Choose provider per channel by health and cost; failover | Live success tables |
| Delivery tracker | Ingest callbacks, update status, analytics events | Stream processing |
| In-app inbox | Store and serve in-app messages | Partitioned by user |

### 6. Request flows

OTP (critical):

1. Auth service calls the API with priority CRITICAL and an idempotency key.
2. API writes the notification and enqueues on the critical topic (separate consumers, never shared with bulk).
3. Policy engine skips marketing rules (OTPs ignore quiet hours) but enforces abuse limits per phone number.
4. SMS worker sends through the healthiest provider; if no delivery report within \~10 s, it retries through a second provider or falls back to a voice call or WhatsApp.
5. Delivery tracker records the result; the auth service can show "resend" options.

Campaign (bulk):

1. Marketing schedules "Diwali offer, 7 PM local time" for a segment of 50M users.
2. Campaign service expands the segment in batches of 10,000 users and enqueues on the bulk topic per time zone window.
3. Policy engine drops users who opted out, are in quiet hours, or hit frequency caps (for example, at most 3 marketing pushes per day).
4. Push workers send at a controlled rate within provider limits; invalid tokens are marked and cleaned.
5. Opens and conversions flow back for reporting.

### 7. Deep dives

#### 7.1 Priority isolation

Separate topics, consumer pools and provider quotas for critical, transactional and bulk traffic. A 50M campaign can fill the bulk queue for 30 minutes without adding a millisecond to OTPs. Reserve a share of each provider's rate limit for critical traffic.

#### 7.2 Deduplication

Two layers: idempotency keys at the API (retries from callers), and a short dedupe window per user + template + content hash in Redis (two services triggering the same "order delivered" message). Channel workers also pass a stable message ID to providers that support it.

#### 7.3 Respecting users

Preferences per category and channel, quiet hours in the user's time zone, frequency caps, digests (bundle 10 likes into one push), and channel fallback rules (push first, SMS only if push fails for important transactional messages).

#### 7.4 Provider management

Each channel has two or more providers. A router tracks success rate, latency and cost per provider and route (per country or carrier for SMS), opens circuit breakers on degradation and shifts traffic. Rate limits per provider are enforced with token buckets so the system never triggers provider throttling.

#### 7.5 Push token hygiene

Tokens expire or become invalid when apps are uninstalled. Provider responses marking tokens invalid trigger deletion; devices refresh tokens on app start. Without this, a growing share of pushes goes nowhere and costs capacity.

### 8. Failure scenarios

| Scenario | Detection | Why it happens | Impact | Immediate mitigation | Prevention |
| --- | --- | --- | --- | --- | --- |
| OTPs delayed by a campaign | OTP latency alert | Shared queue or provider quota | Users cannot log in | Pause campaign | Separate queues and reserved quotas |
| SMS provider outage | Delivery reports stop | Provider incident | OTPs fail | Failover to second provider | Multi-provider routing with breakers |
| Duplicate notifications | User complaints | Retries or two services sending | Annoyance, uninstalls | Dedupe window | Idempotency keys and content-hash dedupe |
| Campaign sent at 3 AM | Complaints | Time zone ignored | Brand damage | Stop campaign | Local-time scheduling and quiet hours |
| Provider throttling | 429s from provider | Sending above its limit | Delays, drops | Slow down | Token buckets per provider |
| Template variable missing | "Hi {name}" in messages | Bad data or template change | Embarrassment | Stop the send | Render-time validation; preview tests |
| Opt-out ignored | Regulatory complaint | Preference check skipped on a path | Legal risk | Halt sends | Policy engine mandatory for all non-critical sends |
| Invalid token buildup | Falling push delivery rate | Uninstalled apps | Wasted capacity | Clean tokens | Process provider feedback |

### 9. Production incident walkthrough

| Time | Event | Response |
| --- | --- | --- |
| 19:00 | 50M-user festival campaign starts | Bulk workers ramp |
| 19:02 | OTP latency rises from 2 s to 40 s | OTPs shared the same SMS provider quota as campaign SMS |
| 19:05 | Campaign SMS paused; OTP latency recovers | Mitigation |
| 19:30 | Campaign resumed at half rate | Reserved quota for OTPs configured |
| Postmortem | Isolation existed for queues but not provider quotas | Per-priority provider quotas and alerts |

### 10. Scaling evolution

| Stage | Architecture |
| --- | --- |
| Early | Each service calls providers directly |
| Growth | Central notification service, one queue, templates, preferences |
| Scale | Priority topics, policy engine, provider routing, campaign service, delivery analytics |

### 11. Trade-offs

| Decision | Chosen | Alternative | Why |
| --- | --- | --- | --- |
| Central service | Shared platform | Each team sends directly | Consistent preferences, dedupe and compliance |
| Delivery | At-least-once + dedupe | Exactly-once | Practical and safe |
| Campaign expansion | Batched, rate-controlled | Enqueue all at once | Protects providers and queues |
| Fallback channels | Only for important messages | Always fallback | Cost and annoyance |

### 12. Interview follow-ups

1. How do you send "9 AM local time" to users in 20 time zones? Bucket users by time zone and schedule each bucket separately.
2. How do you avoid spamming? Frequency caps, digests, preferences, quiet hours, and measuring uninstall and opt-out rates per campaign.
3. How do you know a push was delivered? Provider acknowledgements show acceptance; true delivery and opens come from the app reporting back.
4. How do you handle 1 million notifications that must not be lost? Durable queues, idempotent workers, DLQ, and delivery status reconciliation.
5. Why separate in-app inbox storage? It is a read-heavy per-user feed with its own retention, independent of channel delivery.

## Case Study 10: Ticket Booking with Seat Locking (BookMyShow-style)

**Problem statement.** Let users browse shows, pick exact seats on a seat map, hold them briefly while paying, and confirm a booking, without ever selling the same seat twice, even when 2 million fans arrive in the first minute of a concert sale.

**Why it is hard.** Inventory is tiny and contested (one seat, many buyers); payment takes minutes and can fail or hang; abandoned holds must release seats; bots grab seats; and demand at sale open is hundreds of times normal.

### 1. Requirements

Functional: browse cities, venues, shows; live seat map; select and hold seats for a few minutes; pay; confirm booking with tickets; cancel and refund per policy; waiting room for big sales.

| Non-functional | Target | Why |
| --- | --- | --- |
| Correctness | Zero double-booked seats | Core promise |
| Hold expiry | Seats released within seconds of expiry | Sell-through |
| Seat map freshness | Updates within \~1-2 s | Avoid picking taken seats |
| Peak handling | Millions of users at sale open without collapse | Big launches |
| Fairness | Bots limited; first-come order respected | Reputation |

### 2. Capacity estimation

```
Normal:     5M bookings/day ≈ 60/s; browse ~5,000/s
Mega sale:  2M users arrive in 60 s for a 60,000-seat stadium
            → admit ~5,000 users/min from the waiting room to seat selection
            → seat-hold attempts peak at a few thousand per second on ONE show
Seat rows:  60,000 seats × small row ≈ a few MB per show (fits one partition)
Bookings:   5M × 2 KB ≈ 10 GB/day
```

The bottleneck is contention on one show's seats, not total volume.

### 3. APIs

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/shows/{id}/seats` | Seat map with status (available, held, booked) |
| `POST /v1/shows/{id}/holds` | Hold seat IDs for the user; returns `hold_id` and expiry |
| `DELETE /v1/holds/{id}` | Release a hold |
| `POST /v1/bookings` | Confirm with `hold_id` and payment, `Idempotency-Key` |
| `GET /v1/bookings/{id}` | Booking and tickets |
| `POST /v1/bookings/{id}/cancel` | Cancel and refund per policy |
| `GET /v1/queue/{sale_id}` | Waiting-room position and admission token |

### 4. Data model

```sql
CREATE TABLE seats (
  show_id TEXT, seat_id TEXT, status TEXT CHECK (status IN ('AVAILABLE','HELD','BOOKED')),
  hold_id TEXT, hold_expires_at TIMESTAMPTZ, booking_id TEXT, version INT,
  PRIMARY KEY (show_id, seat_id)
);
CREATE TABLE holds (id TEXT PRIMARY KEY, show_id TEXT, user_id TEXT, seat_ids TEXT[],
  status TEXT, expires_at TIMESTAMPTZ);
CREATE TABLE bookings (id TEXT PRIMARY KEY, hold_id TEXT UNIQUE, user_id TEXT,
  show_id TEXT, amount_paise BIGINT, status TEXT, payment_id TEXT, created_at TIMESTAMPTZ);
```

`hold_id UNIQUE` on bookings means one hold can produce at most one booking, even under retries.

### 5. Architecture

| Component | Responsibility | Scales by |
| --- | --- | --- |
| CDN | Event pages, images, static seat layouts | Edge |
| Waiting room | Queue users at sale open, admit at a controlled rate with signed tokens | Stateless + Redis queue |
| Catalog and search | Cities, venues, shows | Caching |
| Seat inventory service | Holds, releases, bookings; the only writer of seat status | Partitioned by show |
| Seat map stream | Push seat status changes to viewers | WebSockets or SSE + pub/sub |
| Payment service | Gateway integration with pending handling | Horizontal |
| Booking workflow | Hold → pay → confirm or release, with timers | Durable workflow engine |
| Bot defense | Rate limits, device checks, challenges, purchase caps | Edge + service |
| Ticketing | QR codes, delivery, entry scanning | Horizontal |

### 6. Request flows

Booking:

1. At sale open, users enter the waiting room and receive a position; the room admits \~5,000 per minute with signed admission tokens.
2. An admitted user loads the seat map (layout from CDN, live status from the inventory service).
3. The user selects 4 seats; the app calls hold. The inventory service runs one transaction: `UPDATE seats SET status='HELD', hold_id=?, hold_expires_at=now()+interval '8 minutes' WHERE show_id=? AND seat_id IN (...) AND status='AVAILABLE'` and checks that exactly 4 rows changed; otherwise it rolls back and tells the user which seats were taken.
4. Seat status changes are published; other viewers see the seats turn grey within a second.
5. The user pays; the booking workflow waits for the payment result with a timer slightly longer than the hold.
6. On success: seats move HELD → BOOKED for that `hold_id`, the booking is created (unique per hold), tickets are issued.
7. On failure or timeout: seats are released, and if money was captured late, it is refunded automatically.

### 7. Deep dives

#### 7.1 Preventing double booking

All-or-nothing conditional updates on the seat rows are enough because one show's seats live in one partition. Alternatives: row locks with `SELECT ... FOR UPDATE` (simple, more lock contention) or Redis `SET NX` locks per seat with expiry (fast, but the database must still be the final source of truth). The conditional update with version checks avoids long-held locks.

#### 7.2 Hold expiry

Each hold has an expiry time stored on the seats. A sweeper releases expired holds every few seconds (`WHERE status='HELD' AND hold_expires_at < now()`), and the hold query itself treats expired holds as available, so a slow sweeper never blocks sales. Payment confirmation checks that the hold is still valid.

#### 7.3 Payment races

A payment can succeed after the hold expired and the seats were resold. The workflow detects this at confirmation (hold no longer valid), then refunds automatically and apologizes. Making the hold a bit longer than the payment timeout reduces this case.

#### 7.4 Waiting room

The waiting room protects every downstream system. Users get a position (randomized for those who arrived before opening, then first-come), a signed token to enter, and an expiry on that token. Admission rate is tuned to what the inventory and payment systems can handle.

#### 7.5 Hot show contention

One mega show concentrates writes on one partition. Keep that partition on strong hardware, keep transactions tiny, use batch holds per request, and prefer best-available seat assignment (server picks seats) during the first minutes, which reduces conflicts compared with everyone clicking the same front-row seats.

### 8. Failure scenarios

| Scenario | Detection | Why it happens | Impact | Immediate mitigation | Prevention |
| --- | --- | --- | --- | --- | --- |
| Same seat sold twice | Duplicate seat on two bookings | Non-atomic check-then-set | Angry customers at the venue | Rebook or refund one | Conditional updates; unique constraints |
| Seats stuck as HELD | Unsellable seats near show time | Sweeper down, workflow lost | Lost revenue | Manual release | Expiry treated as available; durable workflows |
| Paid but no booking | Payment without booking | Hold expired before confirmation | Customer charged | Automatic refund | Hold longer than payment timeout; reconciliation |
| Sale-open meltdown | 5xx at every tier | Millions arrive at once | Nobody can buy | Turn on waiting room | Waiting room from the start for big sales |
| Bots grab seats | Purchases from few devices or IPs | Automated scripts | Unfair sales, resale | Block patterns | Challenges, device checks, per-account caps |
| Seat map stale | Users repeatedly pick taken seats | Missing live updates | Frustration | Refresh on conflict | Push updates via pub/sub |
| Retry double booking | Two bookings for one hold | Client retried confirm | Double charge | Refund | `hold_id` unique on bookings; idempotency keys |

### 9. Production incident walkthrough

| Time | Event | Response |
| --- | --- | --- |
| 12:00 | Concert sale opens; 1.8M users | Waiting room admits 5,000/min |
| 12:01 | Payment gateway latency rises to 20 s | Holds extended from 8 to 12 min for active payments |
| 12:05 | Bot traffic detected from a few networks | Challenges and blocks applied at the edge |
| 12:40 | Sold out | Remaining queue told politely, waitlist offered |
| Postmortem | 300 payments succeeded after hold expiry | Hold length tied to payment timeout; automatic refunds worked |

### 10. Scaling evolution

| Stage | Architecture |
| --- | --- |
| Small cinema chain | Monolith, row locks, simple holds |
| National | Inventory service partitioned by show, cached catalog, push seat maps |
| Mega sales | Waiting room, bot defense, durable booking workflows, multi-gateway payments |

### 11. Trade-offs

| Decision | Chosen | Alternative | Why |
| --- | --- | --- | --- |
| Seat locking | Conditional updates in the database | Distributed locks only | One source of truth |
| Hold length | \~8-12 min | Very short or long | Balance abandonment and payment time |
| Peak control | Waiting room | Auto-scaling alone | Inventory contention cannot be scaled away |
| Seat choice at peak | Best-available assignment | Free choice only | Fewer conflicts |

### 12. Interview follow-ups

1. Why not lock seats in Redis only? Redis locks can expire or be lost on failover; the database row must decide the final state.
2. How do you show live seat maps to 100,000 viewers? Seat change events to pub/sub; gateways push diffs; the layout itself comes from the CDN.
3. How would you add a resale marketplace? Booked tickets move to a listing state; transfers re-issue tickets with new QR codes; payouts go through the ledger.
4. How do you stop one user buying 200 tickets? Per-account, per-payment-method and per-device caps, checked at hold time.
5. What happens if the inventory partition for a hot show fails? Fail over to its synchronous replica; the waiting room pauses admissions until writes resume.
