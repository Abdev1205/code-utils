# Part II: Scaling Up

**Topic:** System design
**Covers:** Vertical vs Horizontal Scaling; Load Balancers; Caching; Content Delivery Networks
**Source:** [Claude artifact](https://claude.ai/artifact/7xxGdVxPGbUiPY13z4MdZ2) — written by a colleague, mirrored here for study.

## Chapter 6: Vertical vs Horizontal Scaling

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Traffic grows from thousands to millions of users and one server can no longer keep up. |
| Why it is hard | Bigger machines hit a ceiling and stay a single point of failure; many machines need statelessness, coordination and a load balancer. |
| How we solve it | Scale vertically while cheap, then horizontally with stateless servers, shared state stores, auto-scaling and pre-scaling for known peaks. |
| What fails, and why | Lost carts (state in memory), database collapse (bottleneck moves downstream), late scaling during spikes (boot time), and connection storms (each new server opens its own database connections). |

When one server cannot keep up, there are exactly two ways to get more capacity: a bigger machine or more machines. Real systems use both, and scaling never removes bottlenecks; it moves them.

### 6.1 The IPL-night problem

A food app runs fine with 1,000 users on day one. On IPL final night, 2 million people order at once; CPU hits 100%, requests pile up, pages take 30 seconds and the server crashes.

### 6.2 Vertical scaling (scale up)

Upgrade the machine: 4 cores to 64, 16 GB RAM to 512 GB, faster disks. It is the superhuman chef.

Advantages: no code changes, no distributed-system headaches, and all data in one place, which makes it a good early choice for databases. Disadvantages: a hard hardware ceiling, cost that grows much faster than power, the machine is still a single point of failure, and upgrades usually need downtime.

### 6.3 Horizontal scaling (scale out)

Run many ordinary servers side by side. It is twenty normal cooks: if one is sick, nineteen keep cooking.

Advantages: nearly unlimited growth, fault tolerance, cheap commodity hardware, and elasticity (add servers at dinner time, remove them at 4 AM). Disadvantages: you need a load balancer to split traffic, servers must be stateless, data consistency across machines becomes hard, and network calls are slower and can fail.

The stateless requirement in practice: with ten servers, a user adds biryani to their cart, refreshes, and finds the cart empty. The cart lived in server A's memory and the refresh went to server B. The fix is to move state to a shared store such as Redis or a database (Chapter 8). Sticky sessions are a weaker alternative (Chapter 7).

|  | Vertical | Horizontal |
| --- | --- | --- |
| Method | Bigger machine | More machines |
| Limit | Hardware ceiling | Almost none |
| Failure | Single point of failure | Survives failures |
| Complexity | Low | High |
| Needs stateless app | No | Yes |
| Typical use | Early-stage databases | Web and application servers |

### 6.4 Auto-scaling and pre-scaling

Cloud providers add and remove servers automatically from rules such as "CPU above 70% for 5 minutes: add 3 servers; below 20% for 15 minutes: remove 2." You pay only for what you use.

Auto-scaling is not instant: new servers take a minute or more to boot and warm up, while a spike arrives in seconds. For predictable spikes (IPL final at 7:30 PM, a festival sale), pre-scale ahead of time.

### 6.5 What real companies do

Stateless web and application tiers scale horizontally. Databases often scale vertically first, then horizontally with replication and sharding (Chapters 12 and 13).

The key insight: add 100 web servers and the app may still be slow, because all 100 now hammer one database. Scaling moved the bottleneck. System design is a continuous search for the next bottleneck.

### 6.6 Practitioner's guide

Worked example: a ticketing site for a cricket final.

> *Diagram in the original artifact: Ticket sale preparation · waiting room, scaled app tier, replicas*

| Aspect | Vertical | Horizontal |
| --- | --- | --- |
| Benefits | No code change, simple data | Near-unlimited, fault tolerant, elastic |
| Constraints | Hardware ceiling, downtime to resize | Stateless app, load balancer, distributed data |
| Trade-off | Simplicity vs ceiling and SPOF | Scale vs complexity |
| Use when | Databases early, legacy apps, modest growth | Web/API tiers, spiky traffic |
| Avoid when | You need 99.99% from one box | Workloads that cannot be split or made stateless |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Scale-out storms DB connections | "Too many connections" | Connection pooling (PgBouncer), limits per instance |
| Scale-in kills in-flight requests | Errors during scale-down | Connection draining, graceful shutdown |
| Autoscaler flaps up and down | Cost and instability | Cooldowns, hysteresis, step policies |
| Cache cold after scale-out | Latency spike | Warm-up, shared distributed cache |

### 6.7 Production incident deep dive

**Incident: auto-scaling takes the database down.** Traffic doubled; the app tier scaled from 20 to 200 pods, and each pod opened 50 database connections.

| Time | What happened | Why |
| --- | --- | --- |
| 20:00 | Traffic doubles during a match | Expected peak |
| 20:03 | Autoscaler adds 180 pods | CPU above target |
| 20:05 | Database refuses connections ("too many clients") | 200 pods × 50 connections = 10,000, limit 2,000 |
| 20:06 | Every pod fails health checks and restarts | Health check depended on the database |
| 20:25 | Connection pooler deployed, pods capped at 60 | Mitigation |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Connection exhaustion | "Too many connections" errors | Connections scale with pod count, the database does not | Whole service | Cap pod count, lower pool size | Central pooler (PgBouncer), per-pod pool sized from the database limit |
| Scaling too slow | Latency rises for minutes before capacity arrives | Boot, image pull and warm-up time | Users during the spike | Manual scale-up | Pre-scaling for known events, warm pools, smaller images |
| Cloud quota reached | Autoscaler cannot create instances | Account or zone instance limits | All further scaling | Request quota, use another zone | Quota reviews before peaks; multi-zone capacity |
| Scale-in kills requests | Errors during scale-down | Pods removed with requests in flight | In-flight users | Slow the scale-down | Graceful shutdown and connection draining |
| Flapping | Pod count oscillates | Thresholds too tight, metric lag | Cost and instability | Freeze autoscaling | Cooldowns, stabilization windows |
| Bottleneck moves | App healthy, database or cache saturated | Only one tier scaled | Downstream tiers | Shed load | Capacity plan per tier; load test the whole path |

**Production readiness checklist**

- Database connection budget divided across maximum pod count
- Pre-scaling schedule for known events
- Cloud quotas checked before peaks
- Graceful shutdown tested
- Load test covers every tier, not just the app

### Review questions

1. Give two reasons why "buy the biggest server" eventually fails.
2. Ten servers lose users' carts on refresh. Why, and what fixes it?
3. After adding 100 web servers the app is still slow. What is the likely bottleneck?
4. Why is relying only on auto-scaling risky for a known 7:30 PM spike?

#### Answers

1. Any two: a hard hardware ceiling eventually stops growth; cost rises much faster than capacity; one big machine is still a single point of failure; resizing usually needs downtime.
2. Carts live in each server's memory, so a refresh routed to another server finds nothing. Move carts to a shared store such as Redis (or the database) so servers are stateless; sticky sessions are a weaker fallback.
3. The database: all 100 servers now send it queries. Add indexes, caching and read replicas, then shard if needed.
4. New servers take minutes to boot and warm up, while the spike arrives in seconds. Pre-scale before 7:30 PM and keep auto-scaling as a safety net.

## Chapter 7: Load Balancers

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Spread requests across many servers so none is overloaded and dead ones receive no traffic. |
| Why it is hard | Requests and servers differ in cost and size, servers fail silently, connections can last hours, and the balancer itself can fail. |
| How we solve it | Choose an algorithm (round robin, least connections, power of two choices, consistent hashing), health-check backends, run balancers redundantly, and drain servers before removal. |
| What fails, and why | Overloaded servers (algorithm ignores request cost), total outages (all health checks depend on one shared database), random disconnects (idle timeouts), and site-wide failure (a single balancer). |

A load balancer sits in front of a group of servers and spreads incoming requests among them, so users see one address while servers can be added, removed or replaced invisibly. It is the traffic police officer at a busy junction.

```
                    ┌──► Server 1
Users ──► Load  ────┼──► Server 2
          Balancer  ├──► Server 3
                    └──► Server 4
```

### 7.1 Algorithms

| Algorithm | How it chooses | Best when |
| --- | --- | --- |
| Round robin | Takes turns 1, 2, 3, 4, 1... | Identical servers, similar requests |
| Weighted round robin | Bigger servers get more turns | Mixed server sizes (e.g. new servers 4x more powerful) |
| Least connections | Fewest active requests now | Mixed request durations (2 ms comment loads vs 5-minute uploads) |
| Least response time | Fastest responder | Varying server performance; needs constant measuring |
| IP hash | Hash of client IP picks the server | Same client to same server; reshuffles badly when servers change |
| Random | Random pick | Surprisingly decent at very large scale |

The reshuffle problem of IP hash is solved by consistent hashing (Chapter 13).

### 7.2 Health checks

Every few seconds the load balancer calls `GET /health` on each server. A 200 keeps it in rotation; after a threshold of failures (e.g. three in a row) it is marked unhealthy and receives no new traffic; when it passes again it rejoins. If server 3 crashes at 2 AM: the checks fail, it is removed, traffic spreads across the rest, an alert fires, auto-scaling may replace it, and it is re-added when healthy. Users notice nothing except the few requests in flight at the moment of failure, which clients can retry. Chapter 28 covers health checks in depth.

### 7.3 Sticky sessions

Sticky sessions route a user to the same server every time, via cookie or IP hash. They patch the empty-cart problem but cause three new ones: if that server dies the user's state dies with it; load becomes uneven; and auto-scaling gets messy because new servers do not receive existing users. Prefer stateless servers with shared state; reserve stickiness for cases with no alternative, such as some WebSocket setups.

### 7.4 Layer 4 vs Layer 7

|  | Layer 4 (transport) | Layer 7 (application) |
| --- | --- | --- |
| Sees | IP addresses and ports only | Full HTTP: URL, headers, cookies |
| Speed | Extremely fast, millions of connections | Slightly slower |
| Can route by path | No | Yes: `/payments/*` to secure servers |
| Extras | Minimal | TLS termination, header rewriting, blocking bad requests |
| Examples | AWS Network Load Balancer | AWS Application Load Balancer, Nginx, HAProxy |

An L4 balancer is a mail sorter reading only the PIN code; an L7 balancer is a secretary who opens the letter and walks it to the right department. Routing payment requests to a special secure server group requires L7.

### 7.5 TLS termination

The L7 balancer decrypts HTTPS once at the entrance and forwards plain or re-encrypted traffic inside the private network. Servers save CPU and certificates are managed in one place.

### 7.6 Is the load balancer a single point of failure?

Yes, unless designed otherwise. Options: an active-passive pair where the standby watches a heartbeat and takes over the shared IP within seconds; active-active balancers sharing traffic behind DNS; or a managed cloud balancer that is already distributed across zones.

### 7.7 Global load balancing

With data centers in Mumbai and Chennai, GeoDNS returns different IP addresses depending on the user's location (Global Server Load Balancing). If one region fails, DNS sends everyone to the other. Large systems stack layers: GeoDNS picks a region, an L4 balancer spreads connections, an L7 balancer routes by URL, servers do the work.

### 7.8 Reverse proxies

A reverse proxy sits in front of servers and forwards requests to them. A load balancer is a reverse proxy that spreads load; reverse proxies can also cache, compress and hide server addresses. Nginx can play both roles.

### 7.9 Practitioner's guide

Worked example: layered balancing for a national app.

> *Diagram in the original artifact: Layered load balancing · GeoDNS, L4, L7, three pools*

| Aspect | Details |
| --- | --- |
| Benefits | Hides servers, enables zero-downtime deploys, removes failed instances, central TLS |
| Constraints | Extra hop, its own capacity limits, connection limits, cost |
| Trade-offs | L4 speed vs L7 intelligence; sticky convenience vs stateless resilience |
| Use L4 when | Raw TCP/UDP, extreme throughput, TLS passthrough |
| Use L7 when | Path/header routing, auth offload, canary splits |
| Avoid sticky sessions when | You can externalize state |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Idle timeout shorter than WebSocket idle | Random disconnects | Raise idle timeout; heartbeats |
| All targets unhealthy from shared dependency | Total outage | Shallow health checks; fail-open behavior |
| Uneven load with long connections | One server hot | Least connections; periodic rebalancing |
| LB not in multiple zones | Zone outage takes site down | Multi-AZ load balancers |

### 7.10 Load-Balancing Algorithms in Depth

A load-balancing algorithm answers one question per request or connection: which backend gets it? Algorithms fall into three families: static (ignore current load), dynamic (react to measured load), and hash-based (send the same key to the same backend). Choosing well depends on how similar your servers and requests are, and whether requests must stick to a backend.

> *Diagram in the original artifact: Load-balancing algorithm families*

#### Static algorithms

Round robin hands requests out in turn. With servers A, B, C: A, B, C, A, B, C. It costs O(1) per decision and needs no measurements, but it ignores how busy each server actually is.

Weighted round robin gives bigger servers more turns. Nginx uses a "smooth" variant that spreads a heavy server's turns out instead of bunching them:

```
weights A=5, B=1, C=1 (total 7); each round: current += weight; pick max; picked -= total
round 1: A5 B1 C1 → pick A → A−2
round 2: A3 B2 C2 → pick A → A−4
round 3: A1 B3 C3 → pick B → B−4
round 4: A6 B−3 C4 → pick A → A−1
... sequence over 7 requests: A A B A C A A (A gets 5, spread out)
```

Random picks a backend uniformly at random. It is surprisingly even at very large scale and needs no shared state between multiple load balancers, but small fleets can see uneven bursts.

#### Dynamic algorithms

Least connections sends each new request to the backend with the fewest active connections. It adapts to mixed request durations (2 ms comment loads vs 5-minute uploads) and long-lived WebSockets. Weighted least connections divides active connections by weight (pick min of connections ÷ weight) for mixed server sizes.

Least response time (or least outstanding requests) favors backends that are answering fastest or have the fewest requests in flight. It routes around slow servers quickly but needs continuous measurement.

Power of two random choices (P2C) picks two backends at random and sends the request to the less loaded of the two:

```
backends with active requests: A=12 B=3 C=9 D=15 E=4
request 1: random pair (A, E) → E (4 < 12)
request 2: random pair (C, D) → C (9 < 15)
```

Research on "balls into bins" shows that checking just two choices instead of one dramatically reduces the worst-case load imbalance. It is nearly as good as checking every server, avoids the herd effect where many load balancers all pick the same "least loaded" server at once, and is used by proxies such as Envoy and in many service meshes.

EWMA latency keeps an exponentially weighted moving average of each backend's latency (recent samples count more) and multiplies by outstanding requests to score backends. Linkerd and Finagle popularized a "peak EWMA" variant that reacts quickly to latency spikes.

```
ewma = α × latest_latency + (1 − α) × ewma        (e.g. α = 0.3)
score = ewma × (outstanding_requests + 1)  → pick lowest score
```

Resource-based balancing asks backends (via agents) for CPU, memory or queue depth and routes to the least loaded. It is precise but adds reporting overhead and lag.

#### Hash-based algorithms

IP or source hash computes `hash(client_ip) % N`, so a client keeps hitting the same server. It gives affinity without cookies, but changing N remaps most clients and large NATs (a college Wi-Fi) skew load. URL or header hash (`hash(path)` or `hash(user_id)`) improves cache locality, since the same product page always lands on the same cache node.

Consistent hashing places servers and keys on a ring; a key goes to the next server clockwise, so adding or removing a server moves only about 1/N of keys. Virtual nodes even out the load (Chapter 13). Bounded-load consistent hashing caps how many keys any server takes, spilling the overflow to the next server, which handles hot keys better.

Rendezvous (highest random weight) hashing scores every server for a key with `hash(key, server)` and picks the highest score. When a server leaves, only its keys move; there is no ring to maintain, though each lookup costs O(N).

```
key = user_42
score(A)=0.81  score(B)=0.33  score(C)=0.95  → C
C fails → next highest is A; keys owned by A and B are unaffected
```

Maglev hashing, described by Google for its network load balancers, builds a fixed lookup table from server permutations. It gives near-perfect evenness and minimal disruption when servers change, with O(1) lookups at very high packet rates.

#### Supporting mechanics

Slow start ramps traffic to a newly added server gradually, so a cold cache or JIT-compiling process is not flooded. Health checks remove unhealthy backends before any algorithm runs (Chapter 28). Connection draining lets a server finish in-flight requests before removal. Outlier detection temporarily ejects backends with repeated errors.

#### Comparison

| Algorithm | Needs live load data | Affinity | Cost per pick | Best for | Weak when |
| --- | --- | --- | --- | --- | --- |
| Round robin | No | No | O(1) | Identical servers and requests | Mixed request durations |
| Weighted RR | No | No | O(N) or O(1) smooth | Mixed server sizes | Variable request cost |
| Random | No | No | O(1) | Huge fleets, many LBs | Small fleets |
| Least connections | Yes | No | O(log N) with heap | Long or mixed requests, WebSockets | Short identical requests (no gain) |
| Least response time | Yes | No | O(N) | Performance-varying servers | Measurement noise |
| Power of two choices | Yes (2 servers) | No | O(1) | Large fleets, many LBs | Very small fleets (just check all) |
| EWMA latency | Yes | No | O(1) with P2C | Latency-sensitive RPC | Bursty measurement |
| IP / header hash | No | Yes | O(1) | Simple affinity, cache locality | Fleet changes, skewed keys |
| Consistent hashing | No | Yes | O(log N) | Caches, sharded state, chat rooms | Hot keys (use bounded load) |
| Rendezvous | No | Yes | O(N) | Small-medium pools needing affinity | Very large pools |
| Maglev | No | Yes | O(1) | Very high-throughput L4 balancing | Table rebuild complexity |

#### Choosing an algorithm

> *Diagram in the original artifact: Choosing a load-balancing algorithm · decision tree*

#### Worked example: one fleet, three workloads

| Workload | Choice | Why |
| --- | --- | --- |
| Stateless REST API, 20 identical pods | Round robin or P2C | Even, cheap; P2C adapts to a slow pod |
| Chat gateway with WebSockets | Least connections | Connections last hours |
| Product-page cache tier | Consistent hashing by URL | Same page hits the same cache node, high hit ratio |
| LLM inference replicas | Least outstanding work + prefix affinity | Requests vary 100x in cost; cached prefixes save GPU work |

#### Failure cases and fixes

| Failure | Symptom | Fix |
| --- | --- | --- |
| Round robin with mixed request sizes | One server overloaded by long jobs | Least connections or P2C |
| Every LB picks the same "least loaded" server | Thundering herd on one backend | Power of two random choices |
| New server flooded at full weight | Latency spike after scale-out | Slow start ramp |
| `hash % N` after adding a server | Cache hit ratio collapses | Consistent or rendezvous hashing |
| Hot key on consistent hashing | One node overloaded | Bounded-load hashing, key splitting, replication |
| Stale load data | Traffic piles onto a dying server | Shorter reporting intervals, outlier ejection |
| Big NAT behind IP hash | One server gets a whole campus | Hash by user ID or session token instead |
| Weights not updated after resize | Small server overloaded | Automate weights from instance size |

#### Benefits, constraints and trade-offs

| Aspect | Details |
| --- | --- |
| Benefits | Even load, better latency, fault tolerance, cache locality (hashing) |
| Constraints | Measurement overhead (dynamic), remapping on change (naive hashing), state sharing across many LBs |
| Trade-offs | Simplicity (static) vs adaptiveness (dynamic); affinity (hashing) vs perfect balance |
| Use static when | Fleets and requests are uniform |
| Use dynamic when | Request cost or server speed varies |
| Use hashing when | State or cache locality matters |

### 7.11 Production incident deep dive

**Incident: a steady trickle of 502 errors nobody could reproduce.** About 0.3% of requests failed with 502 at random times.

| Time | What happened | Why |
| --- | --- | --- |
| Week 1 | Random 502s, no pattern by endpoint | Looked like flaky network |
| Week 2 | Correlated with idle periods between requests | Clue: connection reuse |
| Root cause | The load balancer idle timeout was 60 s, the backend keep-alive 5 s | The balancer reused connections the backend had already closed |
| Fix | Backend keep-alive raised to 75 s | Backend must outlive the balancer's idle timeout |
| Result | 502s dropped to near zero | Configuration, not code |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Keep-alive race 502s | Low steady 502 rate | Backend closes idle connections before the balancer does | Random requests | Raise backend keep-alive | Backend keep-alive longer than the balancer idle timeout |
| All targets unhealthy | 503 everywhere | Health checks depend on a shared database | Everything | Make checks shallow | Shallow liveness, scoped readiness, fail-open behavior |
| Uneven load after deploy | One instance hot | Long-lived connections stay on old instances | Some users slow | Recycle connections gradually | Least connections; periodic connection rebalancing |
| Balancer not warmed | Errors at a sudden spike | Managed balancers scale up gradually | Launch traffic | Spread traffic over more balancers | Pre-warm with the provider; ramp traffic |
| Cross-zone imbalance | One zone overloaded | Cross-zone balancing off with uneven instances | That zone's users | Turn on cross-zone balancing | Even instance counts per zone |
| Slow-start missing | New instance latency spikes | Full traffic sent to a cold instance | Users routed there | Lower its weight | Slow-start ramp for new targets |

**Production readiness checklist**

- Timeouts aligned: client > balancer > backend processing; backend keep-alive > balancer idle
- Health checks are shallow and tested with a dependency outage
- Balancers in several zones with cross-zone balancing
- Slow start and connection draining enabled
- 5xx alerts split by balancer and by target

### Review questions

1. Pick algorithms for identical servers with equal requests, for 2 ms vs 5-minute requests, and for mixed server sizes.
2. Explain step by step how a crashed server is detected and removed.
3. L4 or L7 for routing `/payments/*`?
4. Answer: "your load balancer is a single point of failure."
5. Give two reasons stateless servers beat sticky sessions.

#### Answers

1. Identical servers and similar requests: round robin. 2 ms vs 5-minute requests: least connections (or power of two choices). Servers of different sizes: weighted round robin or weighted least connections.
2. Health checks hit `/health` every few seconds; after a threshold of failures (e.g. three) the server is marked unhealthy and receives no new traffic; remaining servers absorb it; an alert fires and auto-scaling may replace it; when checks pass again (e.g. two successes) it rejoins.
3. Layer 7, because routing by URL path requires reading the HTTP request; Layer 4 sees only IPs and ports.
4. Run load balancers redundantly: an active-passive pair with heartbeat failover, active-active balancers behind DNS, or a managed cloud balancer already spread across availability zones.
5. With stateless servers, a crash loses no user state, and load spreads evenly so servers can be added or removed freely; sticky sessions lose state with the server and create uneven, hard-to-rebalance load.

## Chapter 8: Caching

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | The database is too slow or too loaded to answer the same popular questions millions of times. |
| Why it is hard | Cached copies go stale, memory is limited, and caches can fail or expire all at once. |
| How we solve it | Keep hot data in RAM (Redis, CDN, browser) using cache-aside, choose TTLs and eviction policies, invalidate on writes, and protect against stampedes. |
| What fails, and why | Wrong prices (stale data after writes), database meltdown when a hot key expires (stampede), hourly spikes (synchronized TTLs), and memory pressure (no TTLs or unbounded keys). |

A cache is a small, fast store that keeps copies of frequently used data so expensive work is not repeated. When 10 million users ask "top restaurants in Koramangala," the database should answer once, not 10 million times. It is the water bottle on your desk instead of a walk to the kitchen.

### 8.1 Why caches are fast

| Storage | Approximate access time |
| --- | --- |
| RAM | \~100 nanoseconds |
| SSD | \~100 microseconds (about 1,000x slower) |
| Network call to a database plus disk query | Several milliseconds |

Caches live in RAM, which is expensive, limited and lost on restart, so you cache only hot data.

### 8.2 Vocabulary

A cache hit finds the data; a miss falls back to the database and usually stores the result. Hit ratio is hits divided by total requests; good systems aim above 90%. TTL (time to live) sets how long an entry survives, e.g. "cache this menu for 10 minutes."

Worked example: database 200 ms, cache 2 ms, hit ratio 90%. Average = 0.9 × 2 + 0.1 × 200 = 21.8 ms, about 9x faster than no cache. Strictly, a miss checks the cache first (202 ms), giving about 22 ms.

### 8.3 Where caching happens

From closest to the user: the client or browser cache; the CDN (Chapter 9); a load balancer or reverse proxy cache; an in-memory cache inside each application server (fast but each server holds its own, possibly different, copy); a distributed cache such as Redis or Memcached shared by all servers (what most designs use); and the database's internal cache.

Memcached is a simple, fast, multi-threaded key-value store of strings. Redis adds rich data structures (lists, sets, sorted sets for leaderboards, hashes, counters), optional persistence, replication and pub/sub, and is the more popular choice.

### 8.4 Read and write patterns

| Pattern | How it works | Pros | Cons | Use for |
| --- | --- | --- | --- | --- |
| Cache-aside (lazy loading) | App checks cache; on miss reads DB and fills cache; writes go to DB and invalidate the key | Caches only what is used; app survives cache failure | First read is slow; data can be stale until TTL | Most read-heavy data |
| Read-through | Cache itself loads from DB on a miss | Cleaner app code | Same staleness | Same as above |
| Write-through | Writes go to cache and DB together | Cache always fresh | Slower writes; may cache unread data | Data read right after writing |
| Write-back (write-behind) | Write to cache; flush to DB later in batches | Very fast writes | Data loss if cache crashes first | View counters, likes; never payments |
| Write-around | Writes skip the cache | Cache not polluted | First read is a miss | Logs written often, read rarely |

For a bank transfer, write directly to the database (the source of truth) and use write-through if cached at all.

### 8.5 Eviction policies

LRU (least recently used) removes whatever has gone unused longest, like a phone closing old apps; it is the common default. LFU (least frequently used) removes the least popular overall. FIFO removes the oldest inserted. TTL expiry removes entries when time runs out.

### 8.6 Cache invalidation

"There are only two hard things in computer science: cache invalidation and naming things." If a dosa's price changes from ₹80 to ₹100 and the cache still says ₹80, users see wrong data. Strategies: TTL expiry, deleting the key on write, or overwriting it on write. The guiding question for each piece of data is how bad slight staleness would be: restaurant photos can be a day stale, menu prices a few minutes with invalidation on change, and wallet balances during checkout should not be cached at all.

### 8.7 Famous cache disasters

Cache stampede (thundering herd): a hot key such as the IPL live score expires and 100,000 requests miss at once, flooding the database. Fixes: a lock so only the first request rebuilds the entry while others wait or get the old value; refreshing before expiry; serving stale data while one worker refreshes.

Cache penetration: attackers request keys that do not exist, so every request misses. Fixes: cache "not found" results briefly, or use a Bloom filter, a compact structure that can say "this definitely does not exist."

Cache avalanche: many keys expire at the same moment (all loaded at 9:00 with a one-hour TTL). Fix: add random jitter to TTLs, such as 60 ± 5 minutes, and replicate the cache so a crash does not cause the same flood.

Hot key: one key, such as a celebrity's profile during a match, overloads its cache node. Fixes: replicate that key across nodes or keep a small local cache on each app server.

### 8.8 When not to cache

Data that changes every second and must be exact, data that is rarely read, and highly personalized data with low reuse.

### 8.9 Practitioner's guide

Worked example: product page caching in three layers.

> *Diagram in the original artifact: Three cache layers and the invalidation path*

| Aspect | Details |
| --- | --- |
| Benefits | Lower latency, lower DB load and cost, absorbs spikes |
| Constraints | RAM cost, invalidation complexity, cold starts, consistency |
| Trade-offs | Freshness vs hit ratio (TTL length); memory vs coverage |
| Use when | Read-heavy, repeated, tolerably stale data |
| Avoid when | Exact-money values, write-heavy rarely-read data, low-reuse personalized data |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Redis cluster down | DB overwhelmed | Replicas, circuit breaker, serve degraded |
| Caching errors or empty results | Users see blank pages for TTL | Do not cache failures (or very short TTL) |
| Unbounded keys | Memory eviction of hot data | TTLs on everything, key design, maxmemory policy |
| Serialization version change | Decode errors after deploy | Versioned cache keys |

### 8.10 Production incident deep dive

**Incident: a cache failover melts the database.** The Redis primary failed over to a replica during peak; the application also restarted its cache clients, and hit ratio fell from 95% to 10%.

| Time | What happened | Why |
| --- | --- | --- |
| 21:00 | Redis primary host fails; replica promoted in 15 s | Automatic failover worked |
| 21:01 | Clients reconnect; many keys missing | Async replication lost recent writes |
| 21:01 | Database QPS rises 10x | Every miss goes to the database at once (stampede) |
| 21:03 | Database latency 50 ms → 3 s; app timeouts | Database sized for 5% of reads |
| 21:20 | Request coalescing switched on; cache refilled | Mitigation |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Cold cache stampede | Hit ratio drops, database QPS spikes | Many misses rebuild the same keys | Database and everything behind it | Coalesce requests, shed load | Single-flight rebuilds, serve stale, warm caches before failover |
| Hot key | One Redis shard at 100% CPU | One key read by everyone | That shard | Local in-process cache | Replicate hot keys, local caches with short TTL |
| Big key blocks Redis | Latency spikes for all commands | A huge value or a slow command blocks the single thread | Whole Redis node | Find and split the key | Size limits on values, ban slow commands in production |
| Eviction of important data | Users logged out at random | `maxmemory` reached; sessions evicted with cache data | Users whose keys were evicted | Add memory | Separate session store from cache; TTLs on cache keys |
| Stale data after failover | Old prices reappear | Invalidations written to the old primary were lost | Correctness | Flush affected keys | Short TTLs on correctness-sensitive keys; versioned values |
| Serialization change | Decode errors after deploy | New code cannot read old cached format | All reads of those keys | Flush or roll back | Version in cache keys |

**Production readiness checklist**

- Database can survive a cold cache at peak, or load shedding is ready
- Single-flight rebuild and stale-while-revalidate implemented
- Hot-key and big-key monitoring
- Sessions not stored in an evicting cache
- Cache key versioning for format changes

### Review questions

1. Compute average latency for 200 ms DB, 2 ms cache, 90% hit ratio.
2. Pick write patterns for view counters, bank transfers and logs.
3. A five-minute TTL key expires on IPL night and crashes the database. Name the problem and two fixes.
4. Cache or not: a cover photo, a wallet balance at checkout, a popular menu?
5. Why add jitter to TTLs?

#### Answers

1. 0.9 × 2 ms + 0.1 × 200 ms = 1.8 + 20 = 21.8 ms (about 22 ms if each miss also pays the 2 ms cache check), roughly 9x faster than no cache.
2. View counters: write-back (fast, a few lost counts acceptable). Bank transfers: write to the database as the source of truth, write-through if cached at all, never write-back. Logs: write-around (written often, read rarely).
3. A cache stampede (thundering herd). Fixes: a lock so only one request rebuilds the key while others wait or get the stale value; refreshing the key before it expires; serving stale data during the refresh.
4. Cover photo: cache with a long TTL (days) and a CDN. Wallet balance at checkout: do not cache; read from the database. Popular menu: cache with a short TTL (5-10 minutes) plus invalidation when the menu changes.
5. Jitter spreads expiry times so many keys loaded together do not expire at the same instant, preventing a cache avalanche onto the database.

## Chapter 9: Content Delivery Networks

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Users far from the data center see slow images and video, and the origin cannot send the same bytes to millions of users. |
| Why it is hard | The speed of light adds latency over distance, popular content creates traffic spikes, and cached copies must update when content changes. |
| How we solve it | Serve static content and media from edge servers near users, control caching with headers, version filenames for updates, and stream video adaptively. |
| What fails, and why | Old JavaScript after deploys (unversioned files cached), private pages leaked (wrong Cache-Control headers), origin overload at launch (cache misses all at once), and global outages (single CDN provider). |

A CDN is a network of servers spread around the world that keeps copies of your content close to users, because distance is delay. Amazon keeps small warehouses in every city instead of shipping from one; a CDN does the same for data.

### 9.1 Terms

The origin server is your source of truth (servers in Mumbai or an S3 bucket). Edge servers hold cached copies near users. A PoP (Point of Presence) is a location with edge servers; large CDNs have hundreds. Examples: Cloudflare, Akamai, AWS CloudFront, Fastly, Google Cloud CDN.

### 9.2 How a request flows

1. A user in Guwahati requests `cdn.swiggy.com/images/biryani.jpg`.
2. DNS or Anycast routes them to the nearest PoP, say Kolkata. Anycast means many servers share one IP address and internet routing delivers you to the closest.
3. On a hit, the edge serves immediately. On a miss, it fetches from the origin, stores a copy and serves it.
4. The next nearby user gets the cached copy.

### 9.3 Pull vs push CDNs

A pull CDN fetches from the origin only when someone asks; it is easy to set up but the first user in each region gets a slow miss. It suits most sites. A push CDN has you upload content ahead of time; there is no first-request delay but you manage uploads. It suits big files you know will be popular, such as a new film or a game update, or a stream starting at a known time.

### 9.4 What belongs on a CDN

Static content: images, video, audio, JavaScript, CSS, fonts, downloads. Dynamic, personalized content (your order history) is not cached at the edge, though CDNs still accelerate it through optimized routes and warm connections, and some run code at the edge (edge computing). Never put personal pages in a public CDN cache: hit ratio would be near zero and one user's data could leak to another.

### 9.5 Cache-control headers

| Header | Meaning |
| --- | --- |
| `Cache-Control: public, max-age=86400` | Anyone may cache it for one day |
| `Cache-Control: private` | Only the user's browser may cache it |
| `Cache-Control: no-store` | Never cache (sensitive data) |
| `ETag` | Fingerprint; unchanged files return `304 Not Modified` without resending |

### 9.6 Updating content

Purging tells the CDN to delete a file everywhere; it works but takes time to propagate and can cost money at scale. Cache busting is the professional approach: never change a file, give each version a new name (`app.3f9a2c.js`, then `app.8b71de.js`). The HTML points to the new name, the CDN treats it as new, and files can be cached for a year. When users see an old `app.js` for hours after a release, versioned filenames are the fix.

### 9.7 Video streaming

Videos are cut into small chunks of a few seconds, each stored in several qualities (240p to 4K). The player downloads chunk by chunk and switches quality as the network changes. This is adaptive bitrate streaming, using formats such as HLS and DASH, and it is why video gets blurry instead of freezing. Netflix places its own cache boxes inside internet providers' buildings (Open Connect). Chapter 59 builds on this for YouTube.

### 9.8 Benefits and costs

Benefits: lower latency, far less origin load, cheaper bandwidth at scale, higher availability (failed PoPs reroute; some CDNs serve cached content when the origin is down) and security (absorbing DDoS floods, web application firewalls). Costs: per-transfer fees, stale content when TTLs and invalidation are mismanaged, and another system to configure.

### 9.9 Practitioner's guide

Worked example: launching a mobile game update worldwide.

> *Diagram in the original artifact: CDN push for a game launch · origin to edges to players*

| Aspect | Details |
| --- | --- |
| Benefits | Latency, origin offload, bandwidth cost, DDoS absorption, availability |
| Constraints | Cost per GB, cache rules complexity, purge delay, edge limits on dynamic content |
| Trade-offs | Long TTL (cheap, fast) vs fast updates; push (no misses) vs pull (no management) |
| Use when | Static assets, media, downloads, global users |
| Avoid when | Highly personalized or sensitive responses; single-city internal apps |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Origin overload on cache miss storm | Origin 5xx during launch | Origin shield tier, request collapsing, push |
| Cookies vary cache key | Hit ratio near zero | Strip cookies for static paths |
| CDN provider outage | Assets fail globally | Multi-CDN with DNS failover |
| Wrong `Cache-Control` on API | Users see others' data | Default `private`/`no-store` for APIs |

### 9.10 Production incident deep dive

**Incident: the CDN caches an error page.** The origin returned a 500 for 30 seconds; the CDN cached it for 10 minutes because the error response carried a long cache header.

| Time | What happened | Why |
| --- | --- | --- |
| 09:00 | Origin deploy causes 30 seconds of 500s | Bad release, quickly rolled back |
| 09:01 | Users still see the error page | CDN cached the 500 with `max-age=600` |
| 09:05 | Origin healthy, error rate at the edge still high | Edge serves the cached error |
| 09:08 | Full purge issued | Origin floods with cache misses |
| 09:15 | Recovered | Purge storm absorbed by origin shield |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Cached errors | Edge error rate higher than origin | Errors served with cacheable headers | Everyone in affected regions | Purge the paths | Never cache 5xx (or cache for seconds); separate error headers |
| Personal data cached | User sees someone else's page | Missing `private` or `Vary`; cookies ignored in the cache key | Privacy breach | Purge and disable caching on that path | Default `no-store` for authenticated responses; review cache keys |
| Purge storm | Origin overload after a purge | Everything misses at once | Origin and users | Purge narrower paths | Versioned filenames instead of purges; origin shield |
| Wrong cache key | Low hit ratio | Query strings or cookies vary the key | Origin cost and latency | Normalize keys | Strip irrelevant parameters and cookies |
| CDN certificate or config error | Edge TLS errors in one region | Config pushed without staging | That region | Roll back config | Staged config rollout per region |
| Provider outage | Global asset failures | Single CDN | Everything static | Fail over DNS to the origin or a backup | Multi-CDN with health-based DNS |

**Production readiness checklist**

- Error responses are not cacheable
- Authenticated responses default to `private` or `no-store`
- Static assets use content-hashed filenames
- Edge vs origin error rates compared on dashboards
- Backup CDN or origin failover plan

### Review questions

1. Pull or push for tonight's IPL final stream?
2. Users see an old `app.js` for hours. Best fix?
3. Should an order history page be cached on the CDN?

#### Answers

1. Push: demand at the start time is certain and huge, so preload content (and push live segments as they are produced) to avoid first-request misses at the worst moment.
2. Versioned (content-hashed) filenames such as `app.8b71de.js`: the HTML references the new name, so every user gets the new file immediately, and old files can stay cached safely.
3. No: it is personalized, so the hit ratio would be near zero, and a public cache could serve one user's orders to another. Use `Cache-Control: private` or `no-store`.
