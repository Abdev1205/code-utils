# Part IV: Communication and Real-Time Systems

**Topic:** System design
**Covers:** Message Queues; Pub/Sub, Kafka and Event-Driven Architecture; Real-Time Communication; The Telephone Network and Its Lessons; Real-Time Media and Voice AI with LiveKit; Handling Massive Call Volumes
**Source:** [Claude artifact](https://claude.ai/artifact/7xxGdVxPGbUiPY13z4MdZ2) — written by a colleague, mirrored here for study.

## Chapter 15: Message Queues

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Slow or failure-prone work (emails, image processing, payouts) blocks user requests and breaks during traffic spikes. |
| Why it is hard | Work must not be lost, must not run twice with real effects, and must survive crashes mid-task. |
| How we solve it | Put tasks on a queue, return immediately, process with scalable workers, acknowledge after success, retry with backoff, and park failures in a dead letter queue. |
| What fails, and why | Duplicate effects (at-least-once delivery without idempotent consumers), stuck queues (poison messages without retry limits), growing delays (too few consumers), and retry storms (no backoff or jitter). |

A message queue lets a service hand off work to be done later, so users get fast responses and failures in one component do not break the whole flow. It is the order-ticket rail in a restaurant kitchen: the waiter pins a ticket and moves on; cooks pick tickets at their own pace.

### 15.1 The problem

Placing an order triggers saving it, charging payment, notifying the restaurant, sending SMS and push, finding a rider, updating analytics and awarding loyalty points. Doing all seven synchronously makes the user wait for every step, makes the order fail if SMS is down, and couples every service to every other. With a queue, the API saves the order and payment, returns "Order placed" in under a second, and publishes "Order 88 created" for background workers. If SMS is down, the message waits safely.

### 15.2 Terms

A producer sends messages; a consumer (worker) processes them; a broker (RabbitMQ, Amazon SQS, Kafka) stores them in between; a message is a small description of a task or event, e.g. `{"event": "order_created", "order_id": 88}`.

### 15.3 Five benefits

Decoupling (producers neither know nor care who consumes). Asynchronous processing of slow work such as emails, image resizing and PDFs. Load leveling: half a million orders in a minute after the IPL final are absorbed like water behind a dam. Reliability: crashed consumers do not lose messages. Easy scaling: add consumers when the queue grows (the competing consumers pattern, where each message goes to exactly one worker).

### 15.4 Acknowledgments

A consumer takes a message, which becomes hidden but not deleted; processes it; and sends an ACK, upon which the queue deletes it. If no ACK arrives within the visibility timeout (e.g. 30 seconds), the message becomes visible again for another worker.

### 15.5 Delivery guarantees

| Guarantee | Behavior | How | Use for |
| --- | --- | --- | --- |
| At-most-once | Delivered 0 or 1 times; may be lost | Delete before processing | Metrics, logs |
| At-least-once | Delivered 1+ times; never lost, may duplicate | Delete after processing and ACK | Almost everything (default in SQS, RabbitMQ, Kafka) |
| Exactly-once | Processed exactly once | Practically: at-least-once plus idempotent consumers | The goal for money and side effects |

True exactly-once delivery across networks is practically impossible; "effectively exactly-once" comes from idempotent consumers. Each message carries a unique ID; the consumer records processed IDs (ideally with a unique constraint written in the same transaction as the effect) and skips repeats. If a "₹100 cashback" message arrives twice, the second is ignored.

### 15.6 Dead letter queues and retries

A message that keeps failing (bad data, such as a missing phone number) would retry forever as a poison message. After N attempts it moves to a dead letter queue for engineers to inspect, fix and replay. Retries should use exponential backoff (1, 2, 4, 8, 16 seconds) plus random jitter so thousands of retries do not land together.

### 15.7 Ordering

Standard queues (default SQS) give high throughput without order guarantees. FIFO queues give strict order with lower throughput. Partitioned ordering guarantees order per key: all messages for order 88 stay in sequence while different orders run in parallel. Kafka does this (Chapter 16).

### 15.8 Backpressure

If producers outpace consumers indefinitely, the queue grows until it runs out of space. Remedies: auto-scale consumers on queue depth, slow producers (return 429), drop low-priority messages, and set size limits and message TTLs. A steadily growing queue is an early warning signal worth alerting on.

### 15.9 Tools and when to use queues

RabbitMQ (flexible routing), Amazon SQS (fully managed), Kafka (distributed log), Redis lists and streams (lightweight), and job frameworks such as Celery, Sidekiq and BullMQ. Use queues for emails, SMS, media processing, notifications, order pipelines and spike smoothing. Do not use them when the user needs the result right now, such as verifying a password or confirming stock before payment.

### 15.10 Practitioner's guide

Worked example: image upload processing.

> *Diagram in the original artifact: Photo upload through a queue · fast response, async work, DLQ*

| Aspect | Details |
| --- | --- |
| Benefits | Fast responses, spike absorption, retries, decoupling, independent scaling |
| Constraints | Eventual completion, duplicates, ordering limits, extra infrastructure |
| Trade-offs | Latency of result vs responsiveness; at-least-once simplicity vs dedupe effort |
| Use when | Slow or retryable work, side effects, fan-out of tasks, smoothing load |
| Avoid when | The user needs the result now (auth, stock checks before pay) |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Visibility timeout shorter than job time | Jobs processed twice | Extend timeout or heartbeat to extend |
| Consumer crashes after side effect, before ACK | Duplicate emails | Idempotency keys |
| Queue backlog grows for hours | Delayed notifications | Autoscale on depth; shed low priority |
| Retries without backoff | Downstream overload | Exponential backoff + jitter |

### 15.11 Production incident deep dive

**Incident: 200,000 customers get the same email five times.** The email worker took 45 seconds per batch, but the queue's visibility timeout was 30 seconds.

| Time | What happened | Why |
| --- | --- | --- |
| 10:00 | Promotional campaign enqueued | Normal job |
| 10:00 | Workers start sending | Each batch takes 45 s |
| 10:01 | Messages reappear and other workers pick them up | Visibility timeout (30 s) expired before acknowledgement |
| 10:05 | Duplicates multiply; complaints arrive | No idempotency check per recipient |
| Fix | Longer timeout with heartbeats, plus per-recipient dedupe keys | Prevent recurrence |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Duplicate processing | Same message ID processed twice | Visibility timeout shorter than processing; redelivery after crashes | Side effects (emails, payments) | Pause consumers | Idempotent consumers; heartbeat to extend visibility |
| Poison message | One message retried forever, queue stalls | A message that always fails | The queue | Move it to the DLQ | Retry limits and DLQ for every queue |
| Silent DLQ growth | DLQ count rises, nobody looks | No alert on the DLQ | Lost work | Inspect and replay | DLQ size alerts and an owner |
| Backlog grows | Queue age rising | Consumers too few or downstream slow | Delayed work | Add consumers | Autoscale on queue age; backpressure |
| Retry storm | Downstream overloaded | Immediate retries from many consumers | Downstream service | Pause retries | Exponential backoff with jitter; retry budgets |
| Lost messages | Producer says sent, consumer never sees it | Fire-and-forget publish without confirmation | Missing work | Reconcile from source | Publisher confirms; transactional outbox |

**Production readiness checklist**

- Every consumer is idempotent
- Visibility timeout exceeds worst-case processing, with heartbeats
- DLQ with alert and replay tooling
- Autoscaling on queue age
- Producer confirmations or outbox

### Review questions

1. A "₹100 cashback" message is delivered twice under at-least-once delivery. How do you prevent ₹200?

#### Answers

1. Make the consumer idempotent. Each message carries a unique ID (e.g. `cashback_order_88`); in the same database transaction as the credit, insert that ID into a processed-messages table with a unique constraint. A duplicate fails the constraint and is skipped, so Priya gets ₹100 once.

## Chapter 16: Pub/Sub, Kafka and Event-Driven Architecture

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | One event ("order placed") must reach many independent services, reliably, in order, and be replayable later. |
| Why it is hard | Services evolve separately, consumers fail and lag, ordering matters per entity, and saving data plus publishing an event can half-fail. |
| How we solve it | Publish events to Kafka topics partitioned by key, consume in groups, evolve schemas compatibly, and use a transactional outbox or CDC to publish reliably. |
| What fails, and why | Lost events (dual write with no outbox), lagging consumers (hot partitions or too few partitions), broken consumers (incompatible schema changes), and wrong state (out-of-order events across partitions). |

When many services care about the same event, the producer should publish it once and let any number of subscribers react. Kafka makes this durable, ordered and replayable at millions of events per second.

### 16.1 Publish/subscribe

A publisher sends a message to a topic such as `order-events`; every subscriber gets its own copy. When a fraud team wants order data, they subscribe and the order service changes nothing. This is fan-out and decoupling, like a YouTube channel notifying every subscriber.

|  | Message queue | Pub/sub |
| --- | --- | --- |
| Each message goes to | One consumer | All subscribers |
| Purpose | Distribute work | Broadcast events |
| Example | "Resize this image" | "Order was created" |

### 16.2 Kafka: a log, not a queue

Normal queues delete consumed messages. Kafka appends messages to a log and keeps them for a configured retention (days or forever). Each consumer tracks its own position, the offset, so consumers read at different speeds without blocking each other, like readers keeping bookmarks in a newspaper archive.

Terms: a topic is a named stream; each topic is split into partitions spread across brokers (Kafka servers), which is how Kafka scales; an offset is a message's position in a partition; consumer groups share the work of reading a topic.

### 16.3 Partitions, keys and ordering

Producers attach a key such as `order_id`; Kafka hashes it to choose a partition, so all events for order 88 (created, paid, picked up, delivered) land in one partition, in order. Different orders run in parallel. Global ordering across partitions is not guaranteed and rarely needed.

### 16.4 Consumer groups

Within one group, each partition is read by exactly one consumer, so work is split like a queue. Across groups, each group receives every message, like pub/sub. The maximum number of useful consumers in a group equals the number of partitions: with 4 partitions and 6 consumers, two sit idle. Plan partition counts for future scale.

### 16.5 Replay

Because messages are retained, a consumer can rewind its offset: after fixing an analytics bug, reprocess yesterday; a new service can read the entire history from offset zero.

### 16.6 Reliability

Each partition is replicated across brokers with a leader and followers. In-sync replicas (ISR) are fully caught-up followers. A producer setting of `acks=all` confirms a write only when all in-sync replicas have it; `acks=1` is faster but riskier. Kafka also offers idempotent producers and transactions for exactly-once processing within Kafka.

|  | Kafka | RabbitMQ / SQS |
| --- | --- | --- |
| Model | Distributed log | Traditional queue |
| After reading | Kept (replay possible) | Deleted |
| Throughput | Extremely high | High |
| Ordering | Per partition | FIFO queues or none |
| Best for | Event streaming, analytics, many subscribers | Task queues, background jobs, routing |

### 16.7 Event-driven architecture

Services announce what happened instead of calling each other. A command ("SendSMS for order 88") is directed and expects action; an event ("OrderCreated 88") is past tense, broadcast, and the sender does not care who reacts.

Three event styles: event notification (tiny events; consumers fetch details), event-carried state transfer (full data inside the event; consumers are more independent), and event sourcing (store every change as an event forever; current state is a replay, like a bank passbook or Git). Event sourcing gives full audit history and point-in-time rebuilds but is complex; periodic snapshots keep rebuilds fast.

CQRS (Command Query Responsibility Segregation) separates the write model (normalized SQL for correct updates) from read models (denormalized views in Elasticsearch or Redis), kept in sync by events. It often pairs with event sourcing and introduces eventual consistency between the sides.

### 16.8 The dual-write problem

An order service must save an order and publish an event. If it saves and then crashes before publishing, the restaurant never hears about a paid order; reversing the order risks publishing an event for an order never saved. A database and Kafka cannot share one simple transaction.

Transactional outbox: in one database transaction, save the order and insert the event into an `outbox` table. A relay process publishes outbox rows to Kafka and marks them sent, resuming after crashes with at-least-once delivery, so consumers stay idempotent.

Change data capture (CDC): a tool such as Debezium reads the database's internal change log and emits each insert or update to Kafka, removing dual writes from application code.

### 16.9 Trade-offs

Event-driven systems give loose coupling, easy new consumers, spike absorption and natural audit trails. They are harder to debug (distributed tracing is needed), eventually consistent, sensitive to event schema changes (use a schema registry; add fields, never remove them in place), and must tolerate duplicates and out-of-order events.

### 16.10 Practitioner's guide

Worked example: order events fanned out with Kafka.

> *Diagram in the original artifact: Order events through an outbox and Kafka to four consumer groups*

| Aspect | Details |
| --- | --- |
| Benefits | Fan-out, replay, ordering per key, high throughput, decoupled teams |
| Constraints | Partition count planning, consumer lag, schema evolution, ops expertise |
| Trade-offs | Kafka power vs operational cost; event-carried state (independence) vs notification (smaller events) |
| Kafka when | Many subscribers, streaming, analytics, audit trails, replay needs |
| Simple queue when | Task distribution without replay |
| Event sourcing when | Full audit history matters (ledgers) |
| Avoid event sourcing when | Simple CRUD apps |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Hot partition (one huge merchant key) | One consumer lags | Better keys, key salting, more partitions |
| Consumer rebalance storms | Processing pauses | Static membership, cooperative rebalancing |
| Retention too short | Replay impossible after bug | Longer retention or archive to S3 |
| Out-of-order across partitions | Wrong state | Key by entity; version events |

### 16.11 Production incident deep dive

**Incident: one schema change stalls three teams.** The order team removed a field from `order-events`; the notification consumer crashed on every event and its lag grew to 2 hours.

| Time | What happened | Why |
| --- | --- | --- |
| 12:00 | Producer deploys without `customer_phone` | Field "no longer used" by the order team |
| 12:01 | Notification consumer crash-loops | It required the field |
| 12:05 | Consumer lag rises; no SMS for new orders | Same failing event retried forever |
| 14:00 | Field restored; consumer catches up by replaying | Kafka retention allowed recovery |
| Fix | Schema registry with compatibility checks | Prevent breaking changes |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Breaking schema change | Consumer errors right after a producer deploy | No compatibility rules | Every consumer of the topic | Roll back the producer | Schema registry enforcing backward compatibility |
| Consumer lag | Lag metric rising | Slow consumer, too few partitions, or a stuck event | Freshness of downstream data | Scale consumers; skip to DLQ | Lag alerts per group; enough partitions |
| Poison event | Same offset retried forever | Event that always fails | That partition | Skip to a DLQ topic | Retry limit and DLQ for events |
| Rebalance storm | Processing pauses repeatedly | Consumers time out and rejoin | Whole group | Raise session timeouts | Cooperative rebalancing; static membership |
| Lost events | Downstream missing records | Dual write failed between DB and Kafka | Correctness | Reconcile from the database | Transactional outbox or CDC |
| Retention too short | Replay impossible | Topic retention shorter than recovery time | Recovery | Restore from archive | Retention sized for worst-case recovery; S3 archive |

**Production readiness checklist**

- Schema registry with compatibility enforced in CI
- Lag alerts per consumer group
- DLQ topics and replay tooling
- Outbox or CDC for every database-to-Kafka path
- Retention covers your recovery time

### Review questions

1. A topic has 4 partitions and you start 6 consumers in one group. What happens?

#### Answers

1. Only four consumers do work, one per partition; the other two sit idle, because within a group each partition is read by one consumer. To use six, increase the topic to six or more partitions (planned ahead, since repartitioning changes key placement).

## Chapter 17: Real-Time Communication

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Push updates (chat messages, live scores, AI tokens, payment confirmations) to clients the moment they happen. |
| Why it is hard | HTTP is request-response, connections drop on mobile, and millions of open connections must be routed and scaled. |
| How we solve it | Choose per need: SSE for one-way streams, WebSockets for two-way, webhooks between servers, WebRTC for media; track connections in a registry and use pub/sub across servers. |
| What fails, and why | Wasted load (polling), missed messages across servers (no pub/sub routing), reconnect storms after deploys (no draining or jitter), fake events (unsigned webhooks), and silent disconnects (NAT timeouts without heartbeats). |

Plain HTTP lets a server only respond, never start a conversation. Chat messages, moving riders on a map, live scores and stock prices all need the server to push. Five techniques solve this, each fitting a different situation.

### 17.1 The five techniques

Short polling: the client asks "anything new?" every few seconds. It is simple and works everywhere, but wasteful (10 million users polling every 2 seconds is 5 million mostly empty requests per second) and delayed by the polling interval. It fits slow-changing status checks, like a kid asking "are we there yet?"

Long polling: the server holds the request open until there is news or a timeout (e.g. 30 seconds), then the client immediately asks again. It is near real-time over plain HTTP but holds a connection per waiting client and repeats headers per message. It is a good fallback.

Server-Sent Events (SSE): one long-lived HTTP connection over which the server pushes updates, one direction only. It is simple, built into browsers (`EventSource`), auto-reconnects, and carries text. It suits live scores, feeds, notifications, dashboards and streaming LLM answers token by token (Chapter 37), like a radio station.

WebSockets: a persistent, full-duplex connection; both sides send at any time. It starts as an HTTP request asking to upgrade (`101 Switching Protocols`) and then carries tiny framed messages. It suits chat, multiplayer games, collaborative editing, live tracking and trading. Downsides: stateful connections, harder scaling, and some proxies block them, so clients need reconnection logic. It is a phone call.

Webhooks: server-to-server callbacks. You give a provider a URL and it calls you when something happens, for example a payment gateway POSTing `{"order": 88, "status": "success"}`. Rules: verify the signature (anyone could call your URL), process idempotently (providers retry), and respond `200` fast, then process in the background via a queue.

WebRTC (bonus) connects browsers peer to peer for audio and video over UDP. Servers help peers find each other (signaling) and relay traffic when direct paths are blocked (TURN servers).

| Technique | Direction | Real-time | Overhead | Best for |
| --- | --- | --- | --- | --- |
| Short polling | Client asks | Delayed | Very high | Slow-changing status |
| Long polling | Client asks, server waits | Near | Medium | Fallback |
| SSE | Server to client | Yes | Low | Feeds, notifications, AI streaming |
| WebSockets | Both ways | Yes | Very low | Chat, games, tracking |
| Webhooks | Server to server | Yes | Low | Payments, integrations |

Decision rule: server-only push uses SSE; constant two-way talk uses WebSockets; another company notifying you uses webhooks; rare updates where delay is fine use polling. ChatGPT-style streaming uses SSE, multiplayer chess uses WebSockets, and a payment provider confirming a payment uses a webhook.

### 17.2 Scaling WebSockets

Stateful connections: Priya is on server 3 and Arjun on server 7. Arjun's message reaches server 7, which must deliver to server 3. Solutions: a pub/sub layer (Redis pub/sub or Kafka) between servers, or a connection registry in Redis (`Priya → server 3`) so server 7 forwards directly.

Load balancing long connections: use least connections. New servers only receive new connections, so load rebalances slowly. Deploys disconnect everyone on a server at once, causing a reconnect thundering herd; drain gradually and have clients reconnect with exponential backoff plus jitter.

Dead connections: phones vanish into tunnels without saying goodbye. Heartbeats (ping/pong every \~30 seconds) detect them; no pong means closing the connection and marking the user offline.

Offline users: messages are stored and delivered on reconnect, with a push notification via Apple's APNs or Google's FCM to wake the device.

Presence ("online", "last seen"): high write volume, so store it in Redis with a TTL refreshed by heartbeats; a missing heartbeat expires the status automatically. It is eventually consistent, and nobody minds a few seconds' lag.

Memory per connection: dedicated connection (gateway) servers hold hundreds of thousands to over a million connections each, while separate services run business logic. Chapter 58 applies all of this to WhatsApp.

### 17.3 Practitioner's guide

Worked example: live cricket scores to 5M viewers.

> *Diagram in the original artifact: Live cricket scores over SSE · Kafka to 200 edge servers*

| Technique | Benefits | Constraints | Use when | Avoid when |
| --- | --- | --- | --- | --- |
| Polling | Trivial | Waste, delay | Rare updates | Real-time needs |
| SSE | Simple push, auto-reconnect | One-way, text | Feeds, AI streaming | Bidirectional chat |
| WebSockets | Full duplex, low overhead | Stateful scaling | Chat, games, tracking | Simple one-way feeds |
| Webhooks | Server push across companies | Security, retries | Payment callbacks | Browser clients |
| WebRTC | P2P low latency media | NAT traversal, TURN cost | Calls, video | Text messaging |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Proxy buffers SSE | Updates arrive in bursts | Disable buffering, flush per event |
| Webhook endpoint slow | Provider retries pile up | Return 200 fast; queue processing |
| Forged webhook | Fake "payment success" | Verify HMAC signatures |
| Mobile NAT drops idle sockets | Silent disconnects | Heartbeats tuned to NAT timeouts |

### 17.4 Production incident deep dive

**Incident: a deploy causes a reconnect storm.** All 400,000 WebSocket clients on one gateway pool reconnected within seconds of a restart.

| Time | What happened | Why |
| --- | --- | --- |
| 16:00 | Gateway pool restarted all at once | Deploy without draining |
| 16:00 | 400,000 clients reconnect immediately | Client retry with no jitter |
| 16:01 | Auth service overloaded verifying tokens; TLS handshakes saturate CPU | Every reconnect re-authenticates and re-handshakes |
| 16:03 | Chat messages delayed; presence flickers | Gateways busy reconnecting |
| Fix | Drain gradually, jittered client backoff, admission control | Prevent recurrence |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Reconnect storm | Connection rate spike | Clients reconnect at the same instant | Gateways, auth | Admission control, reject with retry-after | Jittered backoff; gradual draining on deploys |
| Messages lost across servers | User sees message only after refresh | Sender and receiver on different gateways, no routing | Chat correctness | Force refresh from the server | Connection registry + pub/sub; resync from server on reconnect |
| Silent dead connections | Users stop receiving without errors | Mobile NAT drops idle sockets | Affected users | Shorter heartbeats | Heartbeats tuned below NAT timeouts; reconnect on missed pings |
| SSE buffered by a proxy | Updates arrive in bursts | Proxy buffering responses | All SSE clients | Disable buffering | Flush per event; proxy config tests |
| Forged webhooks | Fake "payment succeeded" events | No signature check | Money | Block the source | Verify HMAC signatures and timestamps |
| Webhook endpoint slow | Provider retries pile up, duplicates | Processing inside the request | Duplicated work | Respond 200 fast | Queue then process; idempotent handling |

**Production readiness checklist**

- Gateways drain gradually on deploy
- Clients reconnect with jitter and resync missed events
- Heartbeats tuned for mobile networks
- Webhooks verified, queued and idempotent
- Connection count and reconnect rate dashboards

### Review questions

1. Pick the technique for ChatGPT-style streaming, multiplayer chess and a payment provider's success notice.

#### Answers

1. ChatGPT-style streaming: SSE (one-way token stream over HTTP with reconnect). Multiplayer chess: WebSockets (both players send moves instantly). Payment provider confirming a payment: a webhook (server-to-server callback, signature-verified and handled idempotently).

## Chapter 18: The Telephone Network and Its Lessons

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Connect any phone to any other phone in the world, with clear voice, for billions of people. |
| Why it is hard | Direct wires between everyone are impossible, analog signals degrade over distance, and capacity must handle the busiest hour. |
| How we solve it | Hierarchical exchanges and numbering (like IP and DNS), digital sampling and multiplexing, cells with handoff, and location registries for mobile users. |
| What fails, and why | Busy signals (capacity sized for averages, not peaks), noisy calls (analog amplification of noise), and dropped calls (failed handoff between cells), the same failure shapes as modern networks. |

The telephone's core idea is to turn sound into electricity, send it down a wire, and turn it back into sound. The network built around that idea was humanity's first giant distributed system, and it solved addressing, routing, overload and resource sharing a century before the internet.

### 18.1 Sound as an electrical copy

Speech creates air-pressure waves: big pushes are loud, fast pushes are high-pitched. If an electric current rises and falls in exactly the same pattern, it captures the voice. The current is an analog, a copy, of the wave. The earlier telegraph sent on/off pulses (Morse code); the telephone's leap was a continuously varying "undulating" current.

Alexander Graham Bell received the famous patent in 1876, and his first call was "Mr. Watson, come here, I want to see you." The invention is historically contested: Elisha Gray filed related paperwork the same day, and Antonio Meucci built earlier voice devices, recognized by a US House of Representatives resolution in 2002.

### 18.2 Transmitter and receiver

The carbon microphone: sound vibrates a diaphragm that presses carbon granules; tighter granules lower resistance and raise current, so the current follows the voice. The receiver: the varying current drives an electromagnet that pulls a thin metal diaphragm, which vibrates and recreates the sound. One end converts vibration to electricity, the other back again; earphones and phone mics still do this.

### 18.3 Connecting everyone

Wiring every pair of N people needs N × (N − 1) / 2 wires: 45 for 10 people, 499,500 for 1,000, about 500 billion for a million. Late-1800s streets were darkened by overhead wires. The fix was the exchange: everyone runs one wire to a central hub that connects any two lines on demand, the same idea as a load balancer or gateway. Human operators plugged cables ("Number please?"); in the 1890s the Strowger switch automated routing, with rotary-dial pulses stepping mechanical switches.

Phone numbers are hierarchical addresses (+91 country, 80 Bengaluru, then the local line). Each exchange only needs to know which direction to send the next part, exactly like internet routing with IP blocks and hierarchical DNS.

### 18.4 Circuit switching vs packet switching

Classic telephony reserved a dedicated end-to-end path for each call. Quality was guaranteed, but silence wasted capacity, and when all circuits were busy you heard "all lines are busy," a CP-style refusal. The internet uses packet switching: data chopped into packets sharing links, efficient but without guarantees, which is why TCP and UDP exist. Today most calls are packets too: mobile voice and apps like WhatsApp send voice over UDP.

### 18.5 Analog to digital

Analog signals weaken and gather noise over distance, and amplifiers boost noise too. Digital telephony samples the wave and stores numbers. Phone speech mostly lies below about 4,000 Hz, and the Nyquist-Shannon sampling theorem says you must sample at least twice the highest frequency, so telephone systems sample 8,000 times per second. With 8 bits per sample that is 64,000 bits per second per call (PCM). Numbers regenerate perfectly at each hop, so noise does not accumulate. Multiplexing fits many calls on one line using time slots (TDM) or frequencies (FDM), like batching on GPUs.

### 18.6 Mobile phones

Radio replaces wires, and limited spectrum is shared by dividing cities into cells, each with a tower; distant cells reuse the same frequencies. Handoff passes a live call from tower to tower as you move. The SIM card is identity and authentication. Location registers track which tower you are near so calls can find you: service discovery for humans.

| Telephone network | Modern system design | Chapter |
| --- | --- | --- |
| Central exchange | Load balancer, gateway | 7, 22 |
| Hierarchical numbers | IP addresses, DNS | 3 |
| Operators to automatic switches | Manual ops to automation | 24 |
| "All lines busy" | Rejecting under overload (429/503) | 22 |
| Digital regeneration | Error-free digital transmission | 3 |
| Multiplexing | Batching, connection sharing | 17, 47 |
| Cells and frequency reuse | Partitioning a shared resource | 13 |
| Tower handoff | Session migration, failover | 12, 17 |
| Location registry | Service discovery | 22 |
| Voice over packets | UDP for real-time media, WebRTC | 3, 17 |

The problems of connecting people at scale are timeless; 1890s telephone engineers and today's AI engineers solve cousins of the same puzzle.

### 18.7 Practitioner's guide

Worked example: applying exchange thinking to an internal microservice mesh.

```
Mesh (every service calls every service): 30 services → 435 links to secure and monitor
Hub (API gateway / service mesh control plane): 30 links, central auth, routing, metrics
```

| Aspect | Circuit switching | Packet switching |
| --- | --- | --- |
| Benefits | Guaranteed quality | Efficient sharing, resilient routing |
| Constraints | Wasted idle capacity, busy signals | No guarantees: loss, jitter, reordering |
| Use when | Strict quality guarantees needed | Bursty data, most modern traffic |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Hub becomes single point of failure | Everything down | Redundant hubs (like redundant exchanges) |
| Analog-style noise accumulation in multi-hop systems | Errors compound per hop | Validate and regenerate at boundaries (checksums) |
| Busy-hour undersizing | Blocked calls/requests | Capacity planning for peak, not average |

### 18.8 Production incident deep dive

**Incident pattern: a disaster triggers a mass-calling event.** After a flood or earthquake, everyone calls family at once; exchanges sized for a normal busy hour block most calls. The same pattern hits modern systems during outages and viral moments.

| Phase | What happens | Why |
| --- | --- | --- |
| Minute 0 | Call attempts jump 10x | Everyone acts at once |
| Minute 1 | Most calls get busy signals | Circuits sized for normal peaks |
| Minute 2 | Redial attempts add more load | Immediate retries |
| Response | Operators prioritize emergency services and encourage SMS | Shed load, shift to a cheaper channel |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Peak far above design | Blocking rate rises | Capacity sized for average busy hour | Everyone in the region | Priority for emergency traffic | Surge plans, overload controls, cheaper channels (SMS, data) |
| Retry amplification | Attempts far above unique callers | Immediate redial | Network-wide | Rate-limit repeat attempts | Backoff behavior; status messages |
| Single exchange or hub failure | Whole area isolated | Hub-and-spoke without redundancy | Area served | Reroute through neighbors | Redundant links and hubs |
| Location registry failure | Mobile calls cannot find users | Central lookup unavailable | All mobile calls | Failover registry | Replicated registries |

Modern lessons: plan for surges, prioritize critical traffic, push users to cheaper channels, avoid retry amplification, and replicate central lookups.

### Review questions

1. Why do phone systems sample voice 8,000 times per second, and why is digital better over long distances?

#### Answers

1. Telephone speech mostly lies below about 4,000 Hz, and the Nyquist-Shannon theorem requires sampling at least twice the highest frequency, so 8,000 samples per second. Digital wins over distance because numbers can be regenerated perfectly at each hop, so noise does not accumulate as it does when amplifying an analog wave.

## Chapter 19: Real-Time Media and Voice AI with LiveKit

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Run group video calls and real-time voice AI agents with low latency for many participants. |
| Why it is hard | Uploads grow with each participant in a mesh, networks vary per user, and voice AI must listen, think and speak within about a second. |
| How we solve it | An SFU forwards streams without re-encoding, simulcast adapts quality per viewer, and agents stream every stage (STT, LLM, TTS) with turn detection and barge-in. |
| What fails, and why | Calls collapse beyond a few people (mesh topology), frozen video on weak networks (no simulcast), laggy agents (waiting for complete outputs), and agents talking over users (no interruption handling). |

LiveKit is an open-source (Apache 2.0) real-time platform built on WebRTC: a horizontally scaling Selective Forwarding Unit (SFU) for audio, video and data, plus an Agents framework that lets AI programs join calls as participants. It can be self-hosted or used as the managed LiveKit Cloud. Sources: [LiveKit SFU docs](https://docs.livekit.io/reference/internals/livekit-sfu), [Intro to LiveKit](https://docs.livekit.io/home/get-started/intro-to-livekit/), [LiveKit Agents docs](https://docs.livekit.io/agents).

### 19.1 Why plain WebRTC is not enough

WebRTC is peer to peer, which works for two or three people. Larger groups need a client-server model, for the same reason the telephone needed exchanges.

| Topology | How | Upload per person (6 people) | Server cost | Trade-off |
| --- | --- | --- | --- | --- |
| Mesh | Everyone sends to everyone | 5 streams | None | Collapses beyond a few people |
| MCU | Server decodes, mixes, re-encodes one stream | 1 | Very high CPU | Latency, fixed layout |
| SFU | Server forwards each stream to subscribers without decoding | 1 | Low (forwarding) | Each viewer downloads several streams |

An SFU is a post office that receives each letter once and photocopies it for subscribers. It trades downstream bandwidth for flexibility and scalability.

### 19.2 Core concepts

A room is a session. Participants are users, AI agents, phone (SIP) callers or services, each with an identity, publishing and subscribing to tracks (individual audio or video streams): pub/sub applied to live media. A signaling channel (often WebSocket) carries room state while media flows separately, typically over UDP. Backends issue signed access tokens (JWTs) granting rights such as "join room X, publish audio." The SFU measures each subscriber's bandwidth and adjusts quality, commonly via simulcast, where senders upload several qualities and the SFU forwards the right one.

### 19.3 Scaling

LiveKit is written in Go on the Pion WebRTC library and scales horizontally with identical node configuration. A single node needs no external dependencies; multi-node setups use Redis to share routing, so all participants in a room land on the same node. Each room must fit within one node, so rooms are effectively sharded by room ID with Redis as the registry. Node load depends on tracks published, subscribers and data per subscriber. Egress records or streams rooms; Ingress brings in RTMP and WHIP streams; SIP integration bridges phone calls into rooms as audio tracks, where telephony and AI meet.

### 19.4 LiveKit Agents

Agents join rooms as full participants, subscribe to user audio, and publish their own audio back. The framework handles the hard parts of voice AI: a speech-to-text, LLM, text-to-speech pipeline; voice activity detection (VAD); turn detection; and LLM orchestration. Agents define instructions and tools; AgentSessions orchestrate STT, LLM, TTS and VAD. It is provider-agnostic, and each process can host many concurrent agent sessions. An alternative is a speech-to-speech realtime model, more natural but with less control per stage.

```
User speaks → VAD → STT (streaming) → turn detection → LLM (tools, RAG) → TTS (streaming) → user hears reply
```

### 19.5 The latency battle

People reply to each other within a fraction of a second, so a three-second pause feels broken. An illustrative budget: network in 50-100 ms, waiting to confirm the user finished 200-500 ms, final transcript 100-300 ms, LLM time to first token 200-600 ms, first audio 100-300 ms, network out 50-100 ms: roughly 0.7 to 2 seconds. Tactics: stream every stage (start speaking the first sentence while the LLM writes the rest); semantic turn detection, since "my order number is... uh..." pauses without finishing; instant barge-in, stopping speech when the user interrupts; deploying near users; fast models and prompt caching; and filler phrases ("let me check that") during slow tool calls.

### 19.6 Design: an AI voice support line

A customer dials; a SIP trunk bridges the call into a room; a dispatcher assigns an agent worker from an autoscaled pool; the agent runs streaming STT, turn detection, an LLM with tools (`get_order_status`, `issue_coupon`, `transfer_to_human`) and RAG over policies with guardrails, and streaming TTS in Hindi, Kannada or English; Egress records calls with consent; transcripts and traces feed observability; escalation transfers the call to a human in the same room.

Interview concerns: rooms shard across SFU nodes and workers scale on concurrent calls; LLM, STT and TTS providers need peak capacity and rate limits; fallback to a backup model or a human; confirming spoken order IDs back to the caller; authenticating the caller and fetching only their orders; masking PII; following recording-consent rules; and per-minute cost.

Alternatives: open-source media servers (Janus, mediasoup, Jitsi), managed real-time APIs (Daily, Agora, Twilio), orchestration frameworks such as Pipecat, and fully managed voice-agent platforms.

### 19.7 Practitioner's guide

Worked example: a 1,000-viewer webinar on an SFU.

```
1 presenter uploads 3 simulcast layers (1080p / 540p / 180p)
SFU node forwards: strong Wi-Fi viewers ← 1080p, 4G viewers ← 540p, weak 3G ← 180p
Room too big for one node? → cascade: origin SFU relays to edge SFUs near viewers
```

| Aspect | Details |
| --- | --- |
| Benefits | Scales group calls, per-viewer quality, AI agents as participants, open source |
| Constraints | Downstream bandwidth, room fits one node, TURN relay cost, voice latency budget |
| Trade-offs | SFU flexibility vs MCU single-stream simplicity; STT-LLM-TTS control vs speech-to-speech naturalness |
| Use when | Group video/voice, voice AI agents, telephony bridging |
| Avoid when | Simple 1:1 calls (plain WebRTC), no-code phone bots (managed platforms) |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Agent talks over user | Users annoyed | Barge-in detection, stop TTS instantly |
| Agent waits too long | Awkward silence | Semantic turn detection, streaming |
| STT mishears order ID | Wrong order fetched | Confirm digits back; validate tool input |
| Node failure mid-call | Call drops | Fast reconnect; resume from transcript |

### 19.8 Production incident deep dive

**Incident: voice agents go silent for 4 seconds.** The LLM provider's time to first token rose from 400 ms to 3.5 s at peak; callers thought the line was dead and hung up.

| Time | What happened | Why |
| --- | --- | --- |
| 18:00 | Peak call volume | Normal evening load |
| 18:05 | LLM first-token latency 400 ms → 3.5 s | Provider capacity pressure |
| 18:06 | Agent pauses 4 s before speaking; hang-ups triple | No filler or fallback |
| 18:20 | Traffic routed to a backup model; filler phrases enabled | Mitigation |
| Fix | Latency-based routing and acknowledgement phrases | Prevent recurrence |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| LLM latency spike | Turn latency p95 rises | Provider load or long prompts | All calls | Route to a faster backup model | Latency-aware routing, short prompts, prompt caching, filler phrases |
| Agent interrupts callers | Overlapping speech in recordings | Silence-based turn detection fires mid-sentence | Caller experience | Raise silence threshold | Semantic turn detection |
| Agent ignores interruptions | Callers repeat themselves | No barge-in handling | Caller experience | Shorter TTS chunks | Stop TTS instantly on caller speech |
| TURN relay overload | Calls fail to connect on strict networks | Too few relays for traffic | Users behind strict NAT | Add relays | Autoscale TURN; monitor relay bandwidth |
| SFU node failure | Room drops mid-call | Room pinned to one node | Participants in that room | Reconnect clients | Fast room migration; health-based routing |
| Transcription errors on IDs | Wrong order fetched | Speech recognition mishears digits | Wrong actions | Read digits back to confirm | Confirmation step; validate tool inputs |

**Production readiness checklist**

- Turn-latency budget per stage (STT, LLM, TTS) with alerts
- Backup model and latency-based routing
- Barge-in and semantic turn detection tested
- TURN capacity monitored
- Confirmation for spoken IDs and amounts

### Review questions

1. Why does an SFU scale better than mesh for each participant's upload, and why is it cheaper than an MCU?

#### Answers

1. In a mesh, each of six participants uploads five copies of their stream; with an SFU each uploads once and the server forwards copies. An SFU is cheaper than an MCU because it only forwards packets, while an MCU must decode, mix and re-encode every stream, which is very CPU-intensive.

## Chapter 20: Handling Massive Call Volumes

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Answer huge, spiky volumes of phone calls (sales, outages, festivals) without dropping callers. |
| Why it is hard | Every call holds a line and an agent (human or AI) for minutes, outages multiply demand instantly, and telephony capacity is costly. |
| How we solve it | Size capacity with Little's Law and Erlang models, separate signaling from media, deflect with IVR, queue with callbacks, scale AI handlers, and apply admission control and priorities. |
| What fails, and why | "All lines busy" (sized for averages), lost inbound calls (single carrier), dropped calls during deploys (no draining), and AI failures mid-call (provider limits without fallback). |

Calls are not requests: they last minutes, hold live two-way streams, are stateful, and cannot be silently retried without annoying a human. Capacity is therefore measured in concurrent calls, not calls per second.

|  | Web request | Phone/voice call |
| --- | --- | --- |
| Duration | \~100 ms | \~2-10 minutes |
| State | Stateless | Stateful, tied to servers |
| Capacity measure | Requests per second | Concurrent calls |
| Failure | Retry silently | Dropped call, angry human |

### 20.1 Little's Law

```latex
\text{Concurrent calls} = \text{arrival rate} \times \text{average duration}
```

1 million calls/day with 10% in the busiest hour is 100,000 calls/hour, about 28 per second. At 4 minutes (240 s) each, concurrency is about 28 × 240 ≈ 6,700 simultaneous calls. At 36 calls/s and 5 minutes, it is 36 × 300 = 10,800. Little's Law also gives queue length: people waiting = arrival rate × average wait.

### 20.2 Erlang traffic engineering

One Erlang is one line busy for an hour. Capacity is planned for the busy hour with an accepted blocking probability (grade of service), e.g. 1%. Calls arrive randomly, so extra lines are needed beyond the average. Erlang B gives the count: about 18 lines for 10 Erlangs at 1% blocking (1.8x), but about 117 for 100 Erlangs (1.17x). Bigger pools need proportionally less spare capacity because bursts average out, the same economics that make cloud and shared GPU pools efficient. Erlang C models queues instead of rejection and drives staffing to service levels such as the classic 80/20 (80% of calls answered within 20 seconds).

### 20.3 Architecture layers

```
Callers (mobile, landline, WebRTC)
  → Entry: carriers, numbers, SIP trunks, GeoDNS/Anycast for app calls
  → Edge: Session Border Controllers (security, NAT, rate limits)
  → Signaling: SIP proxies route call setup
  → Media: media servers / SFUs carry audio packets
  → Routing & queuing: IVR, ACD, skills routing, queues, callbacks
  → Handlers: AI voice agent workers + human agents
  → Support: call state, recordings, transcripts, CRM, analytics
```

Entry: SIP trunks carry many calls at once from carriers; use multiple carriers so one outage does not stop calls. Edge: Session Border Controllers block attacks and toll fraud, rate limit call attempts, handle NAT and codecs, and hide internals.

Signaling vs media: signaling (SIP or WebSocket) carries small messages such as ringing, answered and transfer, handled by SIP proxies like Kamailio or OpenSIPS. Media carries continuous RTP packets over UDP, handled by media servers (FreeSWITCH, Asterisk) or SFUs. Separating them lets each scale independently: signaling with setups per second, media with concurrent calls and bandwidth.

Media layer: each call lives on one node; new calls go to the least-loaded node; nodes are placed near callers. Bandwidth: 6,700 calls × 2 directions × \~64 kbps ≈ 860 Mbps before overhead; modern codecs like Opus use less, and video multiplies everything.

Routing and queuing: an IVR ("press 1", or today an AI that understands "my biryani is cold") resolves simple cases. The ACD (Automatic Call Distributor) is a load balancer for humans, with skills-based routing by language and issue type, priority queues, overflow to other sites, and callbacks ("press 1 and we will call you back"), which flatten peaks like a message queue.

AI handlers: worker processes host many call sessions; a load-aware dispatcher assigns calls; autoscale on active sessions with warm pools; every call holds an STT stream, an LLM conversation and a TTS stream, so provider concurrency and rate limits must cover peak; complex or emotional cases are warm-transferred to humans with an AI summary. Call state lives in Redis; recordings in S3; events in Kafka.

### 20.4 Surviving overload

An outage can multiply call volume tenfold in minutes. Use admission control (a clear message beats choppy calls for everyone), honest wait times with callbacks, proactive deflection ("we know about the payment outage; refunds are automatic"), priority for urgent and VIP calls, shedding non-critical work such as analytics, circuit breakers with fallbacks (faster model, simple menu IVR, human queue), and rate limiting robocalls at the SBC.

### 20.5 Reliability

Redundancy at every layer and region; connection draining for deploys (mark a node "no new calls," wait for calls to end, then upgrade); fast reconnection and AI agents resuming from stored transcripts after a media node failure; health checks removing sick nodes from routing.

### 20.6 What to monitor

Concurrent calls versus capacity, call setup success and time, blocking rate, trunk health; audio quality (packet loss, jitter, latency, MOS score); customer experience (wait time, service level, abandonment, first-call resolution, AI containment and transfer rates, CSAT); and AI pipeline latency, transcription accuracy on key details and cost per call.

### 20.7 Practitioner's guide

Worked example: payment outage drives calls 10x.

```
Normal: 28 calls/s × 240 s = 6,700 concurrent (capacity 9,000)
Outage: 280 calls/s → would need 67,000
Response: IVR announcement deflects 60% → callbacks queue 25% → AI handles common refund questions
          → humans take remaining priority cases; concurrent kept under capacity
```

| Aspect | Details |
| --- | --- |
| Benefits | Predictable capacity, graceful peaks, fewer abandoned calls |
| Constraints | Telephony costs, carrier limits, human staffing, per-minute AI cost |
| Trade-offs | Admission control (some refused) vs degraded quality for all |
| Use callbacks when | Waits exceed a few minutes |
| Avoid AI-first when | Emotional or high-risk cases (fraud, safety); route to humans |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Single carrier outage | No inbound calls | Multi-carrier trunks |
| Deploy drops live calls | Customers cut off | Connection draining |
| AI provider rate limit hit | Agents fail mid-call | Reserved capacity, fallback model or human queue |
| Robocall flood | Lines saturated | SBC rate limits, caller reputation |

### 20.8 Production incident deep dive

**Incident: the main phone carrier fails during a payment outage.** A payment outage tripled support calls just as the primary SIP trunk provider went down.

| Time | What happened | Why |
| --- | --- | --- |
| 20:00 | Payment outage starts; calls rise 3x | Customers want refunds |
| 20:10 | Primary carrier stops delivering calls | Carrier incident |
| 20:11 | Inbound calls fail with busy tones | All numbers routed through one carrier |
| 20:25 | Numbers rerouted to the second carrier | Manual failover |
| Fix | Active-active carriers, IVR outage announcement, callbacks | Prevent recurrence |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Carrier outage | Call setup success rate drops | Single carrier | All inbound calls | Reroute numbers | Multiple carriers, automatic failover |
| Queue overflow | Wait time and abandonment rise | Demand above capacity | Callers | Outage announcement, callbacks | Erlang-based staffing; deflection; AI handlers for common cases |
| AI provider rate limits | Agents fail mid-call | Quota exceeded at peak | AI-handled calls | Route to human queue | Reserved capacity, backup provider |
| Media server overload | Choppy audio, low MOS | CPU saturation | Call quality | Add media servers | Separate signaling and media; autoscale media |
| Deploy drops calls | Calls end during releases | No draining | Active calls | Pause deploy | Drain calls before restart |
| Robocall flood | Line saturation from few sources | No inbound filtering | Real callers | Block sources | Rate limits and reputation checks at the SBC |

**Production readiness checklist**

- Two or more carriers with automatic failover
- Outage announcement and callback flow ready
- Capacity plan for 3-5x surges
- Call setup success, MOS and wait time alerts
- Call draining on every deploy

### Review questions

1. 36 new calls per second, 5 minutes each. How many concurrent calls?

#### Answers

1. Little's Law: 36 calls/s × 300 s = 10,800 concurrent calls on average at peak; add headroom for random bursts and outage surges (Erlang sizing).
