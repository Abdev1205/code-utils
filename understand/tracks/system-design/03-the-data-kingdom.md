# Part III: The Data Kingdom

**Topic:** System design
**Covers:** Databases: SQL vs NoSQL; Indexing; Replication; Sharding, Consistent Hashing and Unique IDs; CAP, PACELC, Consistency Models and Consensus
**Source:** [Claude artifact](https://claude.ai/artifact/7xxGdVxPGbUiPY13z4MdZ2) — written by a colleague, mirrored here for study.

## Chapter 10: Databases: SQL vs NoSQL

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Store data so it is correct, durable and fast to query for each feature's access pattern. |
| Why it is hard | Money needs strict correctness, feeds need massive scale, and no single database is best at everything. |
| How we solve it | Use SQL with ACID transactions for relational, correctness-critical data; key-value, document, wide-column, graph and specialized stores where their access patterns fit (polyglot persistence). |
| What fails, and why | Inconsistent balances (no transactions), slow queries on a NoSQL store (queried by fields it was not modeled for), and outages during schema changes (locking migrations on big tables). |

A database stores data permanently; choosing the right one is among the biggest decisions in any design. Choose by access pattern, not by fashion, and expect large systems to use several at once.

### 10.1 Relational (SQL) databases

Data lives in tables of rows and columns with a fixed schema. A primary key uniquely identifies each row; a foreign key points to another table's primary key, forming the relationship. A JOIN combines tables:

```sql
SELECT users.name, orders.restaurant, orders.amount
FROM orders JOIN users ON orders.user_id = users.user_id;
```

Normalization stores each fact once (Priya's city lives only in `users`), so updates touch one row. Denormalization deliberately copies data (a restaurant name inside each order) to avoid slow joins, at the price of keeping copies in sync.

### 10.2 ACID transactions

A transaction groups operations that must succeed or fail together, such as moving ₹500 from Priya to Arjun.

| Property | Meaning |
| --- | --- |
| Atomicity | All or nothing; a crash midway rolls back |
| Consistency | Rules (e.g. balance never below zero) always hold |
| Isolation | Concurrent transactions do not corrupt each other; only one buyer gets the last seat |
| Durability | Once confirmed, data survives power loss |

Atomicity is what stops money vanishing in a crash mid-transfer; durability ensures "payment successful" survives a reboot. Popular systems: PostgreSQL, MySQL, Oracle, SQL Server, and distributed SQL such as Google Spanner and CockroachDB. Strengths: consistency, powerful queries, maturity. Weaknesses: rigid schemas and harder horizontal scaling, since joins across machines are hard.

### 10.3 NoSQL families

Key-value stores (Redis, DynamoDB) map a key to a value with lightning-fast lookups but no searching inside values. Use for sessions, caches, carts, counters and OTPs.

Document databases (MongoDB, Couchbase, Firestore) store flexible JSON-like documents; related data lives together, so one read fetches a whole restaurant and its nested menu. Use for catalogs, profiles and content.

Wide-column stores (Cassandra, HBase, ScyllaDB, Bigtable) organize data by partition key, sorted within a partition, and handle millions of writes per second across hundreds of machines. Use for chat messages, activity logs, time series and IoT data. Discord has stored trillions of messages in a Cassandra-style database.

Graph databases (Neo4j, Neptune) store nodes and edges, making "friends of friends who like biryani" fast. Use for social networks, recommendations and fraud rings (Chapter 46).

Specialized stores complete the picture: Elasticsearch or OpenSearch for full-text search; InfluxDB or TimescaleDB for time series; object storage such as S3 for photos, videos and files (databases store only the URL); and vector databases for AI embeddings (Chapter 44).

### 10.4 ACID vs BASE

Many NoSQL systems follow BASE: basically available, soft state, eventually consistent. ACID means correct first; BASE means available and fast first. The line is blurring: MongoDB and DynamoDB support transactions and PostgreSQL stores JSON, so decide by access pattern.

### 10.5 Choosing

| Situation | Choice |
| --- | --- |
| Money, payments, orders, inventory | SQL |
| Complex relationships, reporting queries | SQL |
| Sessions, cache, carts, counters | Key-value |
| Flexible nested data such as catalogs and profiles | Document |
| Massive writes: chat, logs, time series | Wide-column |
| Relationships are the main thing | Graph |
| Text search | Search engine |
| Images, video, files | Object storage |

### 10.6 Polyglot persistence

Large systems use many databases, each for what it does best. A food-delivery app might use PostgreSQL for orders and payments, MongoDB for menus, Redis for carts and live ETAs, Cassandra for delivery-partner location history, Elasticsearch for dish search, and S3 with a CDN for food photos. In interviews, never say "MongoDB because it scales"; explain why it fits this data and this access pattern.

### 10.7 Practitioner's guide

Worked example: one order, four stores.

> *Diagram in the original artifact: One order, four stores*

| Store | Benefits | Constraints | Use when | Avoid when |
| --- | --- | --- | --- | --- |
| SQL | ACID, joins, constraints | Harder horizontal scale, schema migrations | Money, inventory, relational data | Massive append-only telemetry |
| Key-value | O(1) speed, simple scale | No rich queries | Sessions, carts, counters | Ad-hoc analytics |
| Document | Flexible nested data | Cross-document joins, duplication | Catalogs, profiles | Heavy many-to-many relations |
| Wide-column | Huge write throughput | Query patterns fixed by keys | Chat, logs, time series | Ad-hoc queries, transactions |
| Graph | Fast multi-hop traversal | Hard to shard, niche skills | Social, fraud rings | Simple CRUD |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Using MongoDB for wallet balances without transactions | Inconsistent balances | Transactions or SQL ledger |
| Wide-column table queried by non-key field | Full scans, timeouts | Model tables per query pattern |
| Long-running transaction | Lock waits, timeouts | Short transactions, batching |
| Schema migration locks big table | Outage | Online schema change, expand-contract |

### 10.8 Production incident deep dive

**Incident: a schema migration locks the orders table.** Adding a column with a default value rewrote a 400 GB table while holding a lock.

| Time | What happened | Why |
| --- | --- | --- |
| 15:00 | Migration starts during business hours | Looked like a small change |
| 15:00 | Every insert into `orders` waits | The migration holds an exclusive lock while rewriting |
| 15:02 | Connection pool exhausted; checkout fails | Waiting queries hold all connections |
| 15:09 | Migration cancelled | Lock released |
| Fix | Add a nullable column, backfill in batches, then add the default | Online, expand-migrate-contract |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Locking migration | Lock waits, pool exhaustion | DDL that rewrites or locks a big table | Every query on that table | Cancel the migration | Online schema change tools, lock timeouts, batched backfills |
| Disk full | Writes fail | Growth, logs, or a stuck replication slot keeping WAL files | Whole database | Free space, drop the stuck slot | Disk alerts at 70/85%; monitor replication slot lag |
| Table bloat | Queries slow down over weeks | Dead rows not cleaned (vacuum falling behind) | That table | Manual vacuum | Tune autovacuum; watch dead-tuple ratio |
| Deadlocks | Deadlock errors in logs | Two transactions lock rows in opposite order | Those requests | Retry the transaction | Consistent lock order; short transactions |
| Connection pool exhaustion | Timeouts acquiring connections | Slow queries or long transactions hold connections | Whole app | Kill long queries | Statement timeouts; pooler; query review |
| Wrong store for the data | Constant tuning and growing pain | Access pattern does not fit the database | Feature performance | Cache or index as a stopgap | Move the workload to a store that fits (see the store comparison in this chapter) |

**Production readiness checklist**

- Migrations reviewed for locks; lock timeout set
- Disk, replication-slot and bloat monitoring
- Statement timeouts on application queries
- Tested backups with point-in-time recovery
- Slow query log reviewed weekly

### Review questions

1. SQL or NoSQL for payments, and which ACID property stops money disappearing mid-transfer?

#### Answers

1. SQL, because payments need ACID transactions and constraints. Atomicity stops money disappearing: the debit and credit commit together or roll back together. Durability ensures a confirmed payment survives a crash.

## Chapter 11: Indexing

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Find a few rows among hundreds of millions without scanning them all. |
| Why it is hard | Every index speeds some reads but slows every write and uses storage; queries change over time. |
| How we solve it | Add B-tree, hash, composite, covering, inverted or geospatial indexes that match real query patterns, and verify with EXPLAIN. |
| What fails, and why | Slow pages (full table scans because no index matches), unused indexes (leftmost-prefix rule broken, functions on columns), and slow inserts (too many indexes). |

An index is a separate sorted structure that lets a database jump straight to matching rows instead of scanning everything, like a textbook's index pointing "photosynthesis" to page 214. It turns a minutes-long full table scan into milliseconds, at the cost of slower writes and extra storage.

### 11.1 Why indexes are fast

Without an index, `SELECT * FROM orders WHERE user_id = 42` checks all 500 million rows: O(n). A sorted tree finds the row in about 30 steps, because 2^30 is about a billion: O(log n). Doubling the data doubles the scan time but adds only one step to the tree.

```sql
CREATE INDEX idx_orders_user ON orders(user_id);
```

### 11.2 B-tree indexes (the default)

PostgreSQL and MySQL use B-trees or B+ trees: short, wide, balanced trees whose nodes hold many sorted keys. Finding `user_id = 75` takes about three hops from root to leaf, then a pointer to the row.

B-trees handle exact matches, range queries (`amount BETWEEN 200 AND 500`, `created_at > '2026-10-01'`), sorting (`ORDER BY created_at`) and prefix searches (`LIKE 'Megh%'`). They cannot help `LIKE '%biryani%'` with a leading wildcard; that is a job for an inverted index.

### 11.3 Hash indexes

A hash function maps the key to its location: O(1) for exact matches such as `session_id = 'abc123'`, useless for ranges or sorting because hashing scrambles order.

### 11.4 LSM trees

Write-heavy NoSQL databases (Cassandra, RocksDB, ScyllaDB) use log-structured merge trees. Writes go to a sorted in-memory buffer and an append-only log for safety; when full, the buffer is flushed to disk as an immutable sorted file (an SSTable); background compaction merges files. Writes are extremely fast; reads may check several files, which Bloom filters speed up by skipping files that definitely lack the key. B-trees are read-optimized; LSM trees are write-optimized.

### 11.5 Composite indexes and the leftmost prefix rule

`CREATE INDEX idx_user_date ON orders(user_id, created_at);` serves "Priya's orders, newest first." The index is sorted by `user_id` first, then `created_at`, like a phonebook sorted by surname then first name. Queries filtering on `user_id`, or `user_id` plus `created_at`, use it; a query filtering only on `created_at` cannot use it efficiently, just as you cannot find everyone named Rahul in a surname-sorted phonebook. Put the column you always filter by first. An index on `(restaurant_id, rating)` does not help `WHERE rating > 4.5`; create a separate index on `rating`.

### 11.6 Covering indexes

If an index contains every column a query needs, the database never touches the table. An index on `(user_id, created_at, amount)` fully serves `SELECT created_at, amount FROM orders WHERE user_id = 42`.

### 11.7 Inverted indexes

Search engines store "word → documents containing it": "biryani" → \[rest\_15, rest\_88, rest\_302\], "spicy" → \[rest\_88, rest\_302\]. A search for "spicy biryani" intersects the lists instantly, even over billions of documents. This is how Elasticsearch and web search work.

### 11.8 Geospatial indexes

"Restaurants within 3 km" involves two numbers, latitude and longitude, so special structures are needed. Geohash encodes a location as a string such as `tdr1y` where nearby places share prefixes, turning "nearby" into a prefix search. A quadtree recursively splits busy map squares into four, so dense cities get small cells. Google S2 and Uber's H3 divide the Earth into cells, H3 using hexagons (Chapter 56).

### 11.9 The costs of indexes

Every insert, update or delete must update every index on the table, so ten indexes mean ten extra writes. Indexes take disk space, sometimes as much as the table, and work best when they fit in RAM. A textbook indexing every word would be twice as thick and painful to edit.

Index columns used in frequent `WHERE`, `JOIN` and `ORDER BY` clauses, foreign keys, and high-cardinality columns such as email, user ID or phone. Avoid indexing low-cardinality columns such as `is_veg`, small tables, rarely queried columns on write-heavy tables, and "just in case" indexes. Run `EXPLAIN` to see whether a query uses an index or scans.

### 11.10 Practitioner's guide

Worked example: speeding up "my orders" from 40 s to 5 ms.

```
EXPLAIN SELECT * FROM orders WHERE user_id=42 ORDER BY created_at DESC LIMIT 20;
  Before: Seq Scan on orders (500M rows) + Sort        → 40 s
  CREATE INDEX idx_user_date ON orders(user_id, created_at DESC);
  After:  Index Scan using idx_user_date (20 rows)     → 5 ms
```

| Aspect | Details |
| --- | --- |
| Benefits | Orders-of-magnitude faster reads, efficient sorting and ranges |
| Constraints | Write amplification, storage, RAM for hot indexes, build time on huge tables |
| Trade-offs | Read speed vs write speed; more indexes vs storage and maintenance |
| Use when | Frequent filters/joins/sorts on high-cardinality columns |
| Avoid when | Low-cardinality flags, tiny tables, write-heavy columns rarely queried |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Function on indexed column (`WHERE LOWER(email)=...`) | Index ignored | Expression index or normalized column |
| Leading wildcard `LIKE '%x'` | Full scan | Full-text/trigram index or search engine |
| Too many indexes | Slow inserts | Drop unused indexes (check usage stats) |
| Index build locks table | Downtime | Concurrent index builds |

### 11.11 Production incident deep dive

**Incident: a 5 ms query becomes 30 s overnight.** Nothing was deployed; the order-history query suddenly scanned the whole table.

| Time | What happened | Why |
| --- | --- | --- |
| 02:00 | Nightly bulk import adds 50M rows | Normal batch job |
| 08:00 | Order history p99 rises from 5 ms to 30 s | Planner statistics stale; it now estimates a full scan is cheaper |
| 08:10 | Database CPU at 100%, other queries slow | Repeated full scans |
| 08:20 | `ANALYZE orders` run manually | Fresh statistics restore the index plan |
| Fix | Analyze after bulk loads; plan monitoring | Prevent recurrence |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Plan regression | Sudden latency jump without deploys | Stale statistics or data skew change the planner's choice | That query and the database | Refresh statistics | Analyze after bulk loads; plan regression tests on key queries |
| Implicit type cast | Index ignored for `WHERE phone = 98...` | Column is text, parameter is a number, so every row is cast | That query | Fix the parameter type | Typed query parameters; review EXPLAIN in code review |
| Missing index on a new filter | New feature is slow at scale | Feature tested on small data | That feature | Create the index concurrently | Load-size test data; slow query log alerts |
| Index bloat | Index far larger than data, slower reads | Heavy updates and deletes | That table | Reindex concurrently | Vacuum tuning; periodic reindex |
| Too many indexes | Insert latency climbs | Every write updates every index | Write-heavy paths | Drop unused indexes | Track index usage; review before adding |
| Long index build | Writes blocked during creation | Non-concurrent index build | The table | Cancel | `CREATE INDEX CONCURRENTLY` (or equivalent) |

**Production readiness checklist**

- Top queries have EXPLAIN plans captured and regression-tested
- Statistics refreshed after bulk loads
- Slow query log with alerting
- Index usage reviewed quarterly
- Indexes built concurrently in production

### Review questions

1. With an index on `(restaurant_id, rating)`, will `WHERE rating > 4.5` use it efficiently? Why?

#### Answers

1. No. The index is sorted by `restaurant_id` first, then `rating`, so a query filtering only on `rating` cannot use it efficiently (the leftmost prefix rule), just as a surname-sorted phonebook cannot find everyone named Rahul. Add a separate index on `rating`, or one whose first column is `rating`.

## Chapter 12: Replication

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Keep data available when a database machine dies, and serve more reads than one machine can. |
| Why it is hard | Copies drift apart (lag), failover can promote a stale copy or create two leaders, and concurrent writes in several places conflict. |
| How we solve it | Leader-follower replication (sync, async or semi-sync), consensus-based failover with fencing, read-your-own-writes routing, and quorums for leaderless systems. |
| What fails, and why | Edits that "revert" (reading a lagging replica), lost writes after failover (async replication), split brain (no quorum or fencing), and replicated mistakes (replication is not backup). |

Replication keeps copies of the same data on multiple machines. It delivers availability (one machine dies, another takes over), read scaling, lower latency through nearby copies, and durability. It is like photocopying exam notes for friends: lose yours and a friend still has one.

### 12.1 Leader-follower (primary-replica)

```
            Writes ──► LEADER ──copies changes──► Follower 1, 2, 3
                                                     ▲
                                    Reads ───────────┘
```

All writes go to the leader, which records each change in a log and ships it to followers that apply changes in the same order. Reads can go to followers (read replicas). Apps typically read 100 times more than they write, so one leader with ten followers gives roughly ten times the read capacity.

### 12.2 Synchronous, asynchronous, semi-synchronous

| Mode | Leader confirms after | Pros | Cons |
| --- | --- | --- | --- |
| Synchronous | Followers acknowledge | Followers always current; no loss on leader failure | Slow writes; a dead follower blocks writes |
| Asynchronous | Immediately | Fast writes | Lost writes if leader dies before shipping; replication lag |
| Semi-synchronous | At least one follower acknowledges | Guaranteed second copy without waiting for all | Middle ground in latency |

### 12.3 Replication lag and its bugs

With asynchronous replication, followers may be milliseconds to seconds behind. Two classic bugs follow.

Read-your-own-writes: Priya updates her address (write to the leader), refreshes, the read hits a lagging follower, and she sees the old address. Fix: for a short time after a user edits something, read that user's own data from the leader.

Monotonic reads: Priya sees a new comment, refreshes, and it vanishes because the second read hit a more-lagged follower. Fix: send each user's reads consistently to the same follower.

### 12.4 Failover

When the leader dies: followers detect missing heartbeats (often 10 to 30 seconds), elect the most up-to-date follower (using consensus algorithms such as Raft or Paxos, or coordinators such as ZooKeeper and etcd), and applications redirect writes.

Risks: asynchronous writes that never reached any follower are lost. Split brain occurs when an old leader that was only cut off keeps accepting writes, creating two leaders and diverging data. Fixes are fencing (forcibly shutting down the old leader, jokingly STONITH, "shoot the other node in the head") and requiring a majority quorum to lead, since only one side of a split can hold a majority. Timeout tuning is a trade-off: too short causes needless failovers, too long extends downtime.

### 12.5 Multi-leader

Several leaders accept writes, usually one per region, and sync with each other. Writes are fast everywhere and survive regional failure, but conflicts arise: Priya renames herself via Mumbai while her husband edits the same field via the US.

Conflict resolution options: last write wins by timestamp (simple, but silently loses data and depends on imperfect clocks); merging or asking the user; CRDTs (conflict-free replicated data types) that merge automatically, used in collaborative editors and counters; or avoiding conflicts by routing each record's writes to one leader. Multi-leader suits multi-region apps, offline-first apps (each phone acts as a leader) and collaborative editing.

### 12.6 Leaderless (Dynamo-style)

Clients write to and read from several replicas directly, as in Cassandra, DynamoDB and Riak. With N copies, W write confirmations and R replicas read, the quorum rule W + R > N guarantees every read overlaps at least one replica holding the latest write. With N = 3, W = 2, R = 2, a write to {A, B} and a read from {B, C} share B. Tune the dial: W = 1, R = 3 for fast writes; W = 3, R = 1 for fast reads; W = 2, R = 2 balanced.

Stale replicas are repaired by read repair (fixing old values discovered during reads), anti-entropy background comparison using Merkle trees, and hinted handoff (another node holds writes for a downed replica and hands them over later).

|  | Leader-follower | Multi-leader | Leaderless |
| --- | --- | --- | --- |
| Who accepts writes | One leader | Several leaders | Any replica |
| Write conflicts | None | Yes | Yes |
| Consistency | Strong if synchronous | Eventual | Tunable via quorums |
| Failover needed | Yes | Partly | No |
| Examples | PostgreSQL, MySQL, MongoDB | Multi-region setups, offline apps | Cassandra, DynamoDB |

### 12.7 Replication is not backup

If someone runs `DELETE FROM orders`, replication faithfully copies the delete to every follower within milliseconds. You also need backups: periodic snapshots stored separately plus logs enabling point-in-time recovery ("restore to 3:14 PM").

### 12.8 Practitioner's guide

Worked example: read replicas for a news app.

> *Diagram in the original artifact: Leader-follower replication for a news app*

| Aspect | Details |
| --- | --- |
| Benefits | Availability, read scaling, geographic latency, durability |
| Constraints | Lag, failover complexity, conflict handling, cost of copies |
| Trade-offs | Sync (no loss, slow) vs async (fast, possible loss); multi-leader speed vs conflicts |
| Leader-follower when | Most OLTP apps |
| Multi-leader when | Multi-region writes, offline-first apps |
| Leaderless when | Massive write availability with tunable consistency |
| Avoid multi-leader when | Data needs strict invariants (money) |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Replica lag spikes to minutes | Stale reads | Monitor lag; route away from lagging replicas |
| Failover promotes stale replica | Lost writes | Semi-sync replication; promote most current |
| Last-write-wins clobbers edits | Silent data loss | CRDTs or explicit conflict resolution |
| Backups never tested | Restore fails in disaster | Regular restore drills |

### 12.9 Production incident deep dive

**Incident: failover loses 40 seconds of orders.** The primary crashed; an asynchronous replica that was 40 seconds behind was promoted.

| Time | What happened | Why |
| --- | --- | --- |
| 18:00 | Replica lag grows to 40 s | A large analytics query on the replica slowed replay |
| 18:05 | Primary host fails | Hardware fault |
| 18:06 | Lagging replica promoted automatically | Failover picked a replica without checking lag |
| 18:10 | Customers report missing orders; payments exist without orders | 40 s of committed writes never reached the replica |
| After | Orders rebuilt from payment-provider records and event logs | Manual reconciliation |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Data loss on failover | Gap in sequence numbers, missing rows | Async replica promoted while behind | Recent writes | Recover from old primary's disk or event logs | Synchronous or semi-sync replica as failover target; promote the most current |
| Replica lag | Lag metric rising | Heavy queries or slow disks on replicas | Stale reads | Move heavy queries off | Dedicated analytics replica; lag alerts; route away from lagging replicas |
| Split brain | Two primaries accept writes | Old primary did not know it was demoted | Conflicting data | Fence the old primary | Quorum-based failover with fencing (STONITH, leases) |
| Replicated mistake | Bad `DELETE` everywhere | Replication copies errors instantly | All copies | Stop writes | Point-in-time recovery; delayed replica |
| Failover too slow | Minutes of write unavailability | Detection thresholds too conservative | All writes | Manual promotion | Tuned detection; tested automated failover |
| Read-your-writes broken | Users see old data after saving | Reads go to lagging replicas | Confused users | Route user's reads to the primary briefly | Session-level read-your-writes routing |

**Production readiness checklist**

- Failover target is synchronous or verified current
- Fencing prevents two primaries
- Replica lag alerts and routing
- Point-in-time recovery tested monthly
- Failover drill run at least quarterly

### Review questions

1. Priya updates her address and sees the old one on refresh. Cause and fix?

#### Answers

1. Replication lag: the write went to the leader, but the refresh read a follower that had not yet received it. The fix is read-your-own-writes consistency: for a short window after a user edits, read that user's data from the leader (or a replica confirmed to be caught up).

## Chapter 13: Sharding, Consistent Hashing and Unique IDs

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Data or write traffic outgrows the biggest single database leader. |
| Why it is hard | Splitting data breaks joins and transactions, some keys are far hotter than others, and adding machines must not reshuffle everything. |
| How we solve it | Pick a shard key matching the main query, use hash, range, directory or geo sharding with consistent hashing, generate global IDs (Snowflake), and replicate each shard. |
| What fails, and why | One overloaded shard (hot key or time-based key), mass data movement on resize (`hash % N`), slow cross-shard queries (wrong shard key), and duplicate IDs (per-shard auto-increment). |

Replication copies all data to every machine, so it cannot help when data no longer fits one machine or writes exceed one leader. Sharding splits the data itself into shards on different machines, like a library spreading books A to F, G to M and N to Z across rooms.

### 13.1 Vertical vs horizontal partitioning

Vertical partitioning moves whole tables to different databases (users on DB1, orders on DB2). Horizontal partitioning, or sharding, splits rows: users 1 to 1M on shard 1, 1M to 2M on shard 2. With four shards of a 50 TB, 100,000-writes-per-second table, writes spread across four leaders.

### 13.2 The shard key

The shard key decides which shard a row lives on. A good key has high cardinality, distributes data and traffic evenly, and matches queries so most queries hit one shard. Sharding orders by `user_id` keeps all of Priya's orders together.

### 13.3 Strategies

| Strategy | How | Pros | Cons |
| --- | --- | --- | --- |
| Range | Key ranges (IDs 1-1M, dates Jan-Mar) | Efficient range queries | Hot spots: today's data all on one shard |
| Hash | `hash(key) % N` | Even spread | Range queries scatter; changing N reshuffles almost everything |
| Directory | Lookup table key → shard | Total flexibility | Directory is a bottleneck and SPOF; must be cached and replicated |
| Geo | By region | Low latency; data residency laws | Uneven regions |

### 13.4 Consistent hashing

With `hash % 4`, adding a fifth shard changes the formula to `% 5`, remapping about 80% of keys. Consistent hashing fixes this:

1. Picture a ring of hash values from 0 to 2^32 that wraps around.
2. Hash each server to a position on the ring.
3. Hash each key to a position.
4. Each key belongs to the first server found moving clockwise.

Adding server E between C and D moves only the keys between C and E, roughly 1/N of the data. Removing server B moves only B's keys to its clockwise neighbor.

With few servers, random positions can leave one server owning a huge arc. Virtual nodes fix this: each physical server takes 100 to 200 positions, so arcs average out, powerful servers can take more virtual nodes, and a failed server's load spreads across many neighbors. Cassandra, DynamoDB, Discord, Akamai and distributed cache clients use this technique.

### 13.5 Problems sharding creates

Hot partitions (the celebrity problem): sharding posts by user ID gives a celebrity's shard enormous traffic. Fixes: dedicated shards, splitting a hot key with suffixes (`kohli_1`, `kohli_2`), heavy caching.

Cross-shard queries: "top 10 restaurants across India" must ask every shard and merge (scatter-gather). Choose shard keys that match common queries and precompute reports elsewhere.

Cross-shard joins: co-locate related data by sharding both tables on the same key, or denormalize.

Cross-shard transactions: two-phase commit (a coordinator asks all shards to prepare, then commit) is correct but slow and can block if the coordinator dies; the saga pattern uses local transactions with compensating undo steps (Chapter 21).

Resharding: moving data while live is a hard operational project, made smaller by consistent hashing. Operational complexity multiplies backups, monitoring and schema changes.

### 13.6 Unique IDs across shards

Auto-increment breaks because two shards would both create order 101.

| Approach | How | Trade-offs |
| --- | --- | --- |
| UUID | Random 128-bit ID | No coordination; long; not time-sortable, hurting B-tree locality |
| Snowflake ID | 64 bits = timestamp + machine ID + sequence | Unique, generated locally, roughly time-sorted; used by Twitter, Discord, Instagram |
| Ticket server / range allocation | Central service hands out ID ranges | Simple, compact; coordinator must be highly available |

### 13.7 Sharding plus replication

In production each shard is replicated: shard 1 has a leader and two followers, as does shard 2, and so on. Sharding gives scale; replication gives availability.

### 13.8 When to shard

Try these first, in order: indexes and query optimization, caching, read replicas, vertical scaling, vertical partitioning. Shard last, or choose a database with built-in sharding (Cassandra, DynamoDB, MongoDB, CockroachDB) when massive scale is certain.

### 13.9 Practitioner's guide

Worked example: sharding a chat message table.

> *Diagram in the original artifact: Sharding a chat message table by conversation*

| Aspect | Details |
| --- | --- |
| Benefits | Scale writes and storage beyond one machine; fault isolation per shard |
| Constraints | Shard key is hard to change; cross-shard queries and transactions |
| Trade-offs | Range (fast ranges, hot spots) vs hash (even, no ranges) vs directory (flexible, extra lookup) |
| Use when | Data or writes exceed one leader after indexing, caching, replicas, vertical scaling |
| Avoid when | You can still scale up or add replicas; early-stage products |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Shard key by created\_at | All writes hit newest shard | Hash or composite keys |
| Rebalancing saturates network | Latency spikes | Throttled background moves |
| Cross-shard join in hot path | Slow pages | Denormalize or co-locate |
| Uneven shard sizes | One shard full | Virtual nodes, split hot shards |

### 13.10 Production incident deep dive

**Incident: a celebrity melts one shard.** A film star with 30 million followers posted; every like and comment for that post landed on the shard that owns its ID.

| Time | What happened | Why |
| --- | --- | --- |
| 19:00 | Post goes viral | Expected behavior for a celebrity |
| 19:02 | Shard 17 at 100% CPU; others at 20% | All writes for one key go to one shard |
| 19:04 | Other users on shard 17 see timeouts | Shared shard, noisy neighbor |
| 19:10 | Like counts switched to sharded counters in Redis | Spread the hot key |
| Fix | Hot-key detection and key splitting | Prevent recurrence |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Hot key or shard | One shard's CPU and latency far above others | Skewed access to one key | Everyone on that shard | Cache reads, throttle writes | Split hot keys (counter sharding), dedicated shards for giants |
| Resharding inconsistency | Missing or duplicate rows after migration | Writes during copy not mirrored | Migrated data | Pause the move | Double-write + backfill + verify + cut over |
| Scatter-gather queries | Latency grows with shard count | Query lacks the shard key | That feature | Cache results | Secondary index tables keyed by the other field |
| Cross-shard transaction failure | Money debited, not credited | No atomic commit across shards | Transfers | Reconcile manually | Sagas with compensation, or keep related data on one shard |
| ID collisions | Duplicate key errors after merging data | Per-shard auto-increment | Merged datasets | Remap IDs | Snowflake-style global IDs |
| Uneven growth | One shard's disk fills first | Range sharding by time or popular tenants | That shard | Split it | Hash or directory sharding; capacity alerts per shard |

**Production readiness checklist**

- Per-shard dashboards for CPU, latency and size
- Hot-key detection with automatic mitigation
- Resharding runbook tested on a copy
- Global ID generation
- Every main query includes the shard key

### Review questions

1. With `hash(user_id) % 4` you add a fifth shard. What happens and what fixes it?

#### Answers

1. Changing `% 4` to `% 5` remaps about 80% of keys, forcing a huge, slow, risky data migration and cache misses. Consistent hashing with virtual nodes fixes it: adding a shard moves only about 1/N of the keys.

## Chapter 14: CAP, PACELC, Consistency Models and Consensus

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Replicas spread across machines and regions must agree on data, yet networks split and add latency. |
| Why it is hard | During a partition a system cannot be both fully consistent and fully available, and even without partitions consistency costs latency. |
| How we solve it | Choose per feature: CP (strong consistency via consensus such as Raft) for money, bookings and locks; AP (eventual or session consistency) for feeds, likes and presence. |
| What fails, and why | Double bookings (AP chosen for inventory), unavailable features during blips (CP chosen where staleness was fine), and confusing timelines (no read-your-writes or causal guarantees). |

When replicas cannot talk to each other, a distributed system must choose between answering correctly and answering at all. This chapter formalizes that choice and shows how to make it per feature.

### 14.1 The CAP theorem

Consistency (C): every read returns the latest write, as if there were one copy. This is not the C in ACID, which means rules are never broken. Availability (A): every request gets a non-error response, possibly stale. Partition tolerance (P): the system keeps working when the network between nodes breaks.

The theorem: during a network partition, you must choose consistency or availability. "Pick two of three" is misleading, because networks always fail eventually, so P is not optional. The real choice is C or A when a partition happens; without a partition you can have both.

### 14.2 The bank example

Mumbai and Chennai nodes both hold Priya's ₹1,000 balance. The link between them breaks. Priya withdraws ₹800 in Mumbai. Someone queries Chennai.

- Choosing consistency (CP): Chennai returns an error, "cannot confirm, try later." Data is never wrong; some users get errors.
- Choosing availability (AP): Chennai returns ₹1,000. It always answers, but may be wrong; if Chennai also allows an ₹800 withdrawal, ₹1,600 leaves a ₹1,000 account, and reconciliation is needed later.

Banks, seat booking (BookMyShow should show an error rather than sell the last seat twice), inventory and payments choose CP. Likes and feeds choose AP.

| Type | During a partition | Examples | Use for |
| --- | --- | --- | --- |
| CP | Refuses some requests to stay correct | ZooKeeper, etcd, HBase, Spanner, MongoDB default, synchronously replicated SQL | Payments, balances, inventory, bookings, leader election, locks |
| AP | Always answers, may be stale | Cassandra, DynamoDB default, CouchDB, DNS | Feeds, likes, views, catalogs, carts, presence |

Many databases are tunable: Cassandra with quorum reads and writes (W + R > N) behaves more like CP.

### 14.3 PACELC

Partitions are rare, but a trade-off exists even in normal operation. PACELC states: if Partition, choose Availability or Consistency; Else, choose Latency or Consistency. Strong consistency requires waiting for replicas, which is slower.

| System | Partition | Normal | Label |
| --- | --- | --- | --- |
| Cassandra, DynamoDB | Availability | Low latency | PA/EL |
| Spanner, traditional banking DB | Consistency | Consistency | PC/EC |
| MongoDB default | Consistency | Low latency | PC/EL |

### 14.4 Consistency models, strongest to weakest

Strong consistency (linearizability) behaves like a single copy: once a write completes, everyone sees it. Needed for bookings, payments and locks; it requires coordination and is slower.

Sequential consistency means everyone sees operations in the same order, though not necessarily instantly.

Causal consistency preserves cause and effect: nobody sees Arjun's "Congrats!" before Priya's "I got the job!" Unrelated events may appear in any order. It is a strong middle ground.

Session guarantees make an eventual system feel consistent to each user: read-your-own-writes, monotonic reads (never going back in time) and monotonic writes (your writes apply in your order).

Eventual consistency means replicas converge once writes stop. It is fastest and most available, but the app must tolerate stale reads; Instagram like counts and DNS are examples.

### 14.5 Consensus and Raft

CP systems need nodes to agree on facts such as "who is leader?" or "is this write committed?" despite failures. Raft, used in etcd, CockroachDB and Consul, works like this: nodes elect a leader by majority vote; the leader receives writes and replicates them; a write commits once a majority (e.g. 3 of 5) confirms; if the leader dies, a new election runs. Majorities prevent split brain, because only one side of a split can hold a majority. Clusters use odd sizes: five nodes survive two failures. Paxos is the older, more complex algorithm, used by Google in Spanner and Chubby.

### 14.6 Consistency per feature

| Feature | Choice | Why |
| --- | --- | --- |
| Payments and wallet | Strong (CP) | Money must be exact |
| Placing an order, restaurant capacity | Strong (CP) | Cannot oversell |
| Order status updates | Causal / read-your-writes | "Delivered" never before "Picked up" |
| Ratings and reviews | Eventual (AP) | Seconds of staleness are fine |
| Delivery partner location | Eventual (AP) | Availability matters more |
| Menus and photos | Eventual (AP) | Rarely change, heavily cached |

Never say "the whole system is CP" or "AP." Decide per feature and explain why.

### 14.7 Practitioner's guide

Worked example: an e-commerce flash sale during a network partition.

> *Diagram in the original artifact: Flash sale during a network partition · CP vs AP per feature*

| Aspect | Strong consistency | Eventual consistency |
| --- | --- | --- |
| Benefits | Simple reasoning, no anomalies | Low latency, high availability |
| Constraints | Coordination, quorum, cross-region latency | Stale reads, conflict handling |
| Use when | Money, inventory, bookings, locks, identity | Feeds, counters, presence, catalogs |
| Avoid when | Latency-critical global reads tolerant of staleness | Invariants that must never break |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| AP choice for seat booking | Double bookings | CP for inventory |
| CP choice for presence | Users appear offline during blips | AP with TTLs |
| Even-sized Raft cluster (4 nodes) | No gain in fault tolerance | Odd sizes (3, 5) |
| Clock-based ordering across regions | Out-of-order effects | Logical clocks or single-writer per key |

### 14.8 Production incident deep dive

**Incident: a wallet overdrawn during a partition.** Two regions both accepted spending from the same wallet while the link between them was down, because the wallet used an available-first (AP) store.

| Time | What happened | Why |
| --- | --- | --- |
| 13:00 | Network link between regions drops for 4 minutes | Provider fiber cut |
| 13:01 | Priya spends ₹800 in region A and ₹700 in region B from a ₹1,000 wallet | Each region saw ₹1,000 available |
| 13:04 | Link restored; replicas merge | Last-write-wins kept one balance, lost one debit |
| 13:30 | Reconciliation finds ₹500 overspent and a missing ledger entry | Money invariants broken |
| Fix | Wallet moved to a CP store with a single leader per wallet | Correctness over availability |

| Failure mode | Detection signal | Why it happens | Blast radius | Stop it now | Permanent fix |
| --- | --- | --- | --- | --- | --- |
| Invariant broken under partition | Reconciliation mismatches | AP storage for data needing a single truth | Money, inventory | Freeze affected accounts | CP storage (consensus, single leader per key) |
| Lost updates from last-write-wins | Edits silently vanish | Clock-based conflict resolution | Concurrent editors | Restore from history | CRDTs, version vectors, or explicit merge |
| CP feature unavailable | Errors during brief network blips | Quorum unreachable | That feature | Degrade gracefully with clear messages | Place quorums within a region where latency allows |
| Clock skew ordering | Events in wrong order | Wall clocks used to order distributed events | Ordering-sensitive features | Use server sequence numbers | Logical clocks or a single sequencer per key |
| Even-sized consensus cluster | Outage when one node fails | 4 nodes need 3 for quorum, no gain over 3 | The cluster | Add a node | Odd cluster sizes (3 or 5) |

**Production readiness checklist**

- Each data type labeled CP or AP with the reason
- Money and inventory never on last-write-wins storage
- Partition drills between zones and regions
- Consensus clusters sized 3 or 5 across zones
- Reconciliation jobs for invariants

### Review questions

1. During a partition, should BookMyShow choose CP or AP for the last seat? Why?

#### Answers

1. CP. Selling the same seat twice means refunds, angry customers and lost trust, while a brief "please try again" costs little. Bookings, inventory and payments need strong consistency.
