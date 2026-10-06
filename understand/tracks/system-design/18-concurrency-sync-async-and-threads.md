# Concurrency: Sync, Async and Threads

**Topic:** System design
**Covers:** 1. Core Ideas; 2. The Three Models on One Timeline; 3. Threading in Depth; 4. Async in Depth; 5. Processes and Other Languages; 6. System Design View, Choosing a Model, Failures and Interview Questions
**Source:** [Claude artifact](https://claude.ai/artifact/7xxGdVxPGbUiPY13z4MdZ2) — written by a colleague, mirrored here for study.

How a program does several things at once decides its speed, its server costs and many of its hardest bugs. This tab explains synchronous, asynchronous and threaded execution from first principles, with timed examples, code, failure cases and how each model shows up in system design.

## 1. Core Ideas

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Programs spend most of their time waiting (for networks, disks, databases) or computing; doing one thing at a time wastes either the wait or the CPU cores. |
| Why it is hard | Running things at the same time introduces shared-state bugs, ordering problems, deadlocks and harder debugging. |
| How we solve it | Pick the model by workload: async or threads for waiting-heavy work, processes or native threads for computing-heavy work, with locks, queues and limits to stay correct. |
| What fails, and why | Lost updates (unprotected shared data), deadlocks (locks taken in different orders), frozen servers (blocking calls inside an event loop), and overload (unbounded concurrency). |

### The kitchen analogy

| Model | Kitchen version | Program version |
| --- | --- | --- |
| Synchronous | One chef finishes each dish before starting the next, standing idle while rice boils | One task at a time; each call blocks until it finishes |
| Threads | Several chefs share one kitchen and must not grab the same knife | Several threads share memory; need locks for shared data |
| Async | One chef starts the rice, then chops onions, then stirs curry, switching whenever something is cooking | One thread runs many tasks, switching at every wait |
| Processes | Several separate kitchens | Separate memory; true parallel computing on several cores |

### Definitions

| Term | Meaning |
| --- | --- |
| Synchronous (blocking) | The caller waits until the operation completes |
| Asynchronous (non-blocking) | The caller starts the operation and continues; it is notified or resumes when the result is ready |
| Concurrency | Several tasks make progress during the same period (may interleave on one core) |
| Parallelism | Several tasks run at the exact same instant on different cores |
| Thread | An execution path inside a process; threads share the process's memory |
| Process | An isolated program instance with its own memory |
| I/O-bound | Mostly waiting on network or disk |
| CPU-bound | Mostly computing |

Concurrency is about structure (dealing with many things); parallelism is about execution (doing many things simultaneously). Async gives concurrency without parallelism; multiple processes give parallelism.

### Worked timing: I/O-bound work

Call a partner API 100 times; each call takes 200 ms, almost all of it waiting on the network.

| Approach | How it runs | Total time (approximate) |
| --- | --- | --- |
| Synchronous | 100 × 0.2 s one after another | 20 s |
| 20 threads | 5 waves of 20 calls × 0.2 s | 1 s |
| Async, all 100 at once | All waits overlap on one thread | about 0.2-0.3 s |

### Worked timing: CPU-bound work

Resize 4 large images; each takes 2 s of pure computation on a 4-core machine.

| Approach | Total time (approximate) | Why |
| --- | --- | --- |
| Synchronous | 8 s | One after another |
| 4 threads in standard CPython | about 8 s | The global interpreter lock lets one thread run Python code at a time |
| Async | 8 s | Async only helps while waiting; computing never waits |
| 4 processes | about 2 s | Each process uses its own core |

Rule of thumb: waiting-heavy work → async or threads; computing-heavy work → processes (or languages and libraries that run native threads in parallel).

### The same task three ways (Python)

```python
import time, requests, asyncio, httpx
from concurrent.futures import ThreadPoolExecutor

URLS = [f"https://api.example.com/items/{i}" for i in range(100)]

# 1. Synchronous: about 20 s
def sync_fetch():
    return [requests.get(u, timeout=2).status_code for u in URLS]

# 2. Threads: about 1 s with 20 workers
def threaded_fetch():
    with ThreadPoolExecutor(max_workers=20) as pool:
        return list(pool.map(lambda u: requests.get(u, timeout=2).status_code, URLS))

# 3. Async: about 0.2-0.3 s
async def async_fetch():
    async with httpx.AsyncClient(timeout=2) as client:
        responses = await asyncio.gather(*(client.get(u) for u in URLS))
        return [r.status_code for r in responses]
```

## 2. The Three Models on One Timeline

> *Diagram in the original artifact: Same three calls: synchronous, threaded and async timelines*

Threads and async both finish in about 1 second because the waiting overlaps; threads do it with three threads, async with one thread switching at each wait.

## 3. Threading in Depth

Threads let one process do several things at once while sharing memory. Sharing is both the benefit (cheap communication) and the danger (two threads changing the same data).

### 3.1 Race condition, worked

`balance += 100` looks like one step but is three: read balance, add 100, write balance. Two threads crediting the same wallet:

| Time | Thread A | Thread B | Balance in memory |
| --- | --- | --- | --- |
| 1 | reads 500 |  | 500 |
| 2 |  | reads 500 | 500 |
| 3 | writes 600 |  | 600 |
| 4 |  | writes 600 | 600 |

Two credits of ₹100 should give ₹700; one update was lost. This is a race condition: the result depends on timing.

```python
import threading

balance = 0
lock = threading.Lock()

def credit_unsafe(n):
    global balance
    for _ in range(n):
        balance += 1                 # read-modify-write: not atomic

def credit_safe(n):
    global balance
    for _ in range(n):
        with lock:                   # only one thread inside at a time
            balance += 1

threads = [threading.Thread(target=credit_safe, args=(100_000,)) for _ in range(4)]
[t.start() for t in threads]; [t.join() for t in threads]
print(balance)                       # always 400,000 with the lock
```

With `credit_unsafe`, the final number can come out below 400,000 on some runs; such bugs appear rarely, under load, and are hard to reproduce. In databases the same bug is fixed with atomic updates (`UPDATE wallets SET balance = balance + 100`) or optimistic locking.

### 3.2 Deadlock, worked

Thread 1 locks account A then tries to lock B (transfer A → B). Thread 2 locks B then tries to lock A (transfer B → A). Each holds one lock and waits forever for the other.

A deadlock needs four conditions at once: mutual exclusion, holding while waiting, no forced release, and a circular wait. Break any one. The usual fix is a global lock order: always lock the account with the smaller ID first.

```python
def transfer(a, b, amount):
    first, second = (a, b) if a.id < b.id else (b, a)   # same order for everyone
    with first.lock, second.lock:
        a.balance -= amount
        b.balance += amount
```

Other tools: lock timeouts (give up and retry), and avoiding nested locks entirely.

### 3.3 Coordination tools

| Tool | What it does | Example use |
| --- | --- | --- |
| Lock (mutex) | One thread at a time in a critical section | Updating a shared counter or cache |
| Read-write lock | Many readers or one writer | Rarely-changing configuration |
| Semaphore | At most N threads at once | Limit to 10 concurrent database connections |
| Condition variable | Wait until a condition becomes true | Wait until a queue has items |
| Queue | Thread-safe handoff between producers and consumers | Request handlers enqueue jobs; workers process them |
| Event | One-time signal | Start all workers together; signal shutdown |
| Atomic operations | Hardware-level indivisible updates | Counters in Java, Go, C++ |

Producer-consumer with a bounded queue:

```python
import queue, threading

jobs = queue.Queue(maxsize=100)          # bounded: producers block when full (backpressure)

def producer():
    for order_id in range(1_000):
        jobs.put(order_id)
    for _ in range(4): jobs.put(None)    # one stop signal per worker

def worker():
    while (order_id := jobs.get()) is not None:
        send_receipt(order_id)

workers = [threading.Thread(target=worker) for _ in range(4)]
```

### 3.4 Thread pools and sizing

Creating a thread per task is costly; pools reuse a fixed set. A common sizing estimate:

```latex
\text{threads} \approx \text{cores} \times \left(1 + \frac{\text{wait time}}{\text{compute time}}\right)
```

Example: 8 cores, each request waits 90 ms on a database and computes 10 ms → 8 × (1 + 9) = 80 threads. For pure computation (no waiting), about one thread per core.

### 3.5 Python's global interpreter lock (GIL)

In standard CPython, only one thread executes Python bytecode at a time. Threads still help for I/O, because waiting on a socket or file releases the lock, but they do not speed up pure-Python computation. Libraries such as NumPy release the lock inside heavy native code. Python 3.13 introduced an experimental free-threaded build without the GIL; check library support before relying on it.

### 3.6 Costs of threads

Each thread reserves its own stack memory and costs a context switch when the operating system swaps it in and out. Tens of thousands of OS threads become expensive, which is why high-connection servers use async event loops or lightweight threads instead.

### 3.7 Interview questions

#### Q1. Why is `count += 1` unsafe across threads?

**Short answer.** It is not one operation but three (read, add, write), and another thread can run between them, so updates get lost.

**Detailed explanation.** In Python, `count += 1` compiles to separate bytecode steps: load the current value, add one, store the result. The operating system (or the interpreter) can pause a thread after any step and run another thread. If two threads both load the value 41 before either stores, both compute 42 and both store 42. Two increments happened, but the counter grew by one.

The bug depends on timing, so it may never appear in a quick test with two threads and a hundred increments, then appear in production under heavy load, when threads are interrupted more often. That makes it a classic "works on my machine" bug.

Worked example: four threads each add 1 a hundred thousand times. The correct total is 400,000. Without a lock, results such as 278,312 or 391,045 can appear on different runs (exact numbers vary by machine and Python version). With a lock around the increment, it is always 400,000.

**Fixes, from simplest to most scalable.**

1. A lock around the read-modify-write (`with lock: count += 1`).
2. Avoid sharing: give each thread its own counter and add them up at the end.
3. Atomic primitives where the language offers them (`AtomicInteger` in Java, `sync/atomic` in Go).
4. Across servers, in-process locks do not help: use an atomic database update (`UPDATE counters SET n = n + 1`) or Redis `INCR`.

**If the interviewer pushes.** "Isn't the GIL enough?" No. The global interpreter lock makes individual bytecode steps safe, but a thread can still be switched out between the load and the store.

#### Q2. How do you prevent deadlock in money transfers?

**Short answer.** Always acquire the two account locks in the same global order, for example lower account ID first.

**Detailed explanation.** A transfer must lock both accounts so money is never created or destroyed mid-update. Suppose transfer 1 moves money from account 7 to account 3 and transfer 2 moves money from account 3 to account 7 at the same moment. Transfer 1 locks 7 and waits for 3; transfer 2 locks 3 and waits for 7. Neither can continue: a deadlock.

Deadlock needs four conditions at the same time: exclusive locks, holding one lock while waiting for another, no way to forcibly take a lock away, and a circular wait. Remove any one and deadlock is impossible. A fixed lock order removes the circular wait: both transfers lock account 3 first, so one of them waits before holding anything, and the other finishes.

```python
def transfer(src, dst, amount):
    first, second = sorted([src, dst], key=lambda a: a.id)   # same order for every transfer
    with first.lock:
        with second.lock:
            if src.balance < amount:
                raise ValueError("insufficient funds")
            src.balance -= amount
            dst.balance += amount
```

**Other approaches.** Lock timeouts with retry (break "wait forever"); a single lock per ledger shard (simpler but less concurrency); or, in databases, letting the database detect deadlocks and retrying the aborted transaction. Real payment systems often avoid in-memory locks entirely and write double-entry ledger rows in one database transaction.

**If the interviewer pushes.** "What if you transfer to the same account?" Detect `src == dst` and reject or no-op, otherwise you would try to take the same lock twice (a self-deadlock with non-reentrant locks).

#### Q3. Why do threads not speed up CPU-bound Python code?

**Short answer.** In standard CPython, the global interpreter lock (GIL) lets only one thread execute Python bytecode at a time, so threads take turns rather than running in parallel.

**Detailed explanation.** The GIL protects the interpreter's internal data, such as reference counts on objects. A thread doing pure-Python computation holds it most of the time, so four threads on four cores still run one at a time, plus switching overhead. Threads still help for I/O, because a thread waiting on a socket or disk releases the GIL and another thread can run.

Worked example: four image-resizing tasks of 2 seconds each take about 8 seconds sequentially, about 8 seconds (sometimes slightly more) with four threads, and about 2 seconds with four processes, because each process has its own interpreter and its own GIL.

**Options for CPU-bound work in Python.**

| Option | When it fits |
| --- | --- |
| `ProcessPoolExecutor` / multiprocessing | General CPU work split into independent tasks |
| Native libraries (NumPy, image libraries) | They release the GIL inside C code and run in parallel |
| Free-threaded Python build (3.13+, experimental) | When your libraries support it |
| Moving the hot path to Rust, C or Go | Performance-critical services |

**If the interviewer pushes.** "Then why use threads in Python at all?" For I/O-bound work with blocking libraries (database drivers, HTTP clients without async versions), threads overlap the waiting just as async does.

## 4. Async in Depth

Async code runs many tasks on one thread by switching between them whenever one is waiting. It is ideal for servers holding thousands of connections that mostly wait on networks.

### 4.1 The event loop, step by step

Three tasks each call an API that takes 1 second:

| Time | Event loop does | Task A | Task B | Task C |
| --- | --- | --- | --- | --- |
| 0.000 s | Runs A until its first `await` | sends request, waits |  |  |
| 0.001 s | Runs B until its `await` | waiting | sends request, waits |  |
| 0.002 s | Runs C until its `await` | waiting | waiting | sends request, waits |
| 0.002-1.000 s | Nothing ready; sleeps until a socket has data | waiting | waiting | waiting |
| 1.000 s | A's response arrived; resumes A | finishes | waiting | waiting |
| 1.001 s | Resumes B, then C |  | finishes | finishes |

Total about 1 second instead of 3. The key rule: tasks only switch at `await`. Between awaits, a task has the thread to itself, so async code avoids many races but must never block.

### 4.2 Coroutines, tasks and gather

```python
import asyncio, httpx

async def fetch_menu(client, rid):
    r = await client.get(f"https://api.example.com/restaurants/{rid}/menu")   # yields while waiting
    r.raise_for_status()
    return r.json()

async def main():
    async with httpx.AsyncClient(timeout=2) as client:
        menus = await asyncio.gather(*(fetch_menu(client, rid) for rid in range(50)),
                                     return_exceptions=True)   # one failure does not cancel others
        ok = [m for m in menus if not isinstance(m, Exception)]
        print(len(ok), "menus fetched")

asyncio.run(main())
```

Calling `fetch_menu(...)` only creates a coroutine object; nothing runs until it is awaited or scheduled as a task.

### 4.3 Limiting concurrency and adding timeouts

Firing 10,000 requests at once overwhelms the partner API (429s) and your own memory. A semaphore caps in-flight work:

```python
sem = asyncio.Semaphore(20)                     # at most 20 calls in flight

async def fetch_limited(client, rid):
    async with sem:
        return await asyncio.wait_for(fetch_menu(client, rid), timeout=3)   # cancel if too slow
```

### 4.4 Pitfalls

| Pitfall | What happens | Why | Fix |
| --- | --- | --- | --- |
| Blocking call inside async code (`time.sleep`, `requests.get`, heavy loops) | Every task freezes | One thread: nothing else runs until the block ends | Use async libraries; `await asyncio.sleep`; run blocking work in `asyncio.to_thread` or a process pool |
| Forgetting `await` | Code silently does nothing ("coroutine was never awaited") | Coroutine created but never run | Await it or create a task; enable warnings |
| Unbounded `gather` | Overload, rate-limit errors, memory spikes | All requests start at once | Semaphores or bounded queues |
| One exception cancels others | Partial results lost | Default `gather` behavior | `return_exceptions=True` or task groups with explicit handling |
| Fire-and-forget tasks | Tasks vanish, errors unseen | No reference kept, never awaited | Keep references; await or use task groups |
| CPU-heavy work in the loop | High latency for all requests | Computation never yields | Offload to processes |

### 4.5 Interview questions

#### Q1. Why can one async thread handle 10,000 connections?

**Short answer.** At any instant almost all connections are idle or waiting; the event loop only spends CPU on the few that have data ready, and each waiting connection costs a little memory rather than a whole thread.

**Detailed explanation.** Consider a chat server with 10,000 connected users. Most of the time each connection is silent. A thread-per-connection server would need 10,000 threads, each with its own stack and scheduling overhead, mostly sleeping. An async server registers all 10,000 sockets with the operating system's readiness mechanism (epoll on Linux, kqueue on BSD and macOS) and asks, in one call, "which sockets have data now?" The OS returns, say, 12 ready sockets; the loop runs the 12 corresponding coroutines until each awaits again, then asks again.

The cost per idle connection is a socket, a small buffer, and a suspended coroutine object (kilobytes), instead of a thread stack (often megabytes reserved). Throughput is limited by how much work the ready connections need, not by how many are idle.

Worked numbers: if each message needs 0.1 ms of CPU and users send one message every 10 seconds on average, 10,000 users produce 1,000 messages per second, which needs 100 ms of CPU per second, 10% of one core. The connections themselves are nearly free.

**If the interviewer pushes.** "What limits it then?" CPU per message, memory per connection, file-descriptor limits (raise `ulimit -n`), and any blocking call in the loop, which stalls all 10,000 users at once. For more, run one event loop per core with several processes behind a load balancer.

#### Q2. What happens if you call `time.sleep(2)` in an async handler?

**Short answer.** The whole event loop stops for 2 seconds, so every other request on that server stalls too, not just the one handler.

**Detailed explanation.** Async switching only happens at `await`. `time.sleep` does not await; it blocks the operating-system thread. Since one thread runs the entire event loop, nothing else can run: no other requests progress, no timers fire, health checks may time out, and the load balancer may mark the server unhealthy.

Worked example: a server handles 500 requests per second. One handler accidentally calls `time.sleep(2)` (or `requests.get` to a slow service). For those 2 seconds, about 1,000 requests queue up; p99 latency jumps by 2 seconds for everyone; if this happens often, the server effectively serves one request at a time.

```python
async def bad(request):
    time.sleep(2)                  # blocks the event loop
    return "done"

async def good(request):
    await asyncio.sleep(2)         # yields; other tasks keep running
    return "done"

async def wrapping_blocking_library(request):
    data = await asyncio.to_thread(legacy_client.fetch, request.id)   # run blocking code in a thread
    return data
```

**How to catch it.** Enable asyncio debug mode (it warns about slow callbacks), watch event-loop lag metrics, and lint for blocking libraries in async code.

**If the interviewer pushes.** "What about CPU-heavy work like parsing a 50 MB JSON?" Same problem: it never awaits. Move it to a process pool (`loop.run_in_executor` with a `ProcessPoolExecutor`) or a background worker.

#### Q3. Does async make CPU-bound code faster?

**Short answer.** No. Async overlaps waiting; it does not add CPU power. CPU-bound work runs at the same speed or slightly slower because of task overhead.

**Detailed explanation.** Async's benefit comes from filling idle time: while one task waits for the network, another uses the CPU. A CPU-bound task never waits, so there is no idle time to fill. Running three CPU-bound coroutines on one event loop still takes the sum of their times, and while one runs, the others (and all I/O) are blocked.

Worked example: compressing three files at 1 second of CPU each takes 3 seconds sequentially and still about 3 seconds as three coroutines, with network handling frozen the whole time. Three processes on three cores take about 1 second.

**The right combination.** Use async for coordinating I/O and offload CPU-heavy steps to a process pool:

```python
from concurrent.futures import ProcessPoolExecutor
pool = ProcessPoolExecutor(max_workers=4)

async def handle_upload(path):
    loop = asyncio.get_running_loop()
    thumbnail = await loop.run_in_executor(pool, make_thumbnail, path)   # CPU work elsewhere
    await storage.save(thumbnail)                                          # I/O stays async
```

**If the interviewer pushes.** "So when is async the wrong choice?" Mostly-CPU services (video encoding, ML inference on CPU) and teams relying on blocking libraries without async versions.

## 5. Processes and Other Languages

### 5.1 Processes for CPU-bound work

Separate processes have separate memory and their own interpreter, so they run truly in parallel on multiple cores.

```python
from concurrent.futures import ProcessPoolExecutor

def resize(path):                       # pure computation
    ...
    return path

if __name__ == "__main__":
    with ProcessPoolExecutor(max_workers=4) as pool:
        done = list(pool.map(resize, ["a.jpg", "b.jpg", "c.jpg", "d.jpg"]))   # ~4x faster on 4 cores
```

Costs: process startup time, more memory, and arguments and results must be serialized between processes, so send file paths or IDs rather than huge objects.

### 5.2 How other platforms do it

| Platform | Main model | Notes |
| --- | --- | --- |
| Java | OS threads, thread pools, `CompletableFuture`; virtual threads since Java 21 | Virtual threads are cheap, so blocking-style code can scale to very many concurrent tasks |
| Go | Goroutines (lightweight, scheduled onto OS threads) and channels | Blocking-style code with cheap concurrency; "share memory by communicating" via channels |
| Node.js | Single-threaded event loop; a background pool for some I/O | Excellent for I/O; CPU-heavy work needs worker threads or separate services |
| Python | asyncio for I/O, threads for blocking I/O libraries, processes for CPU | GIL in standard builds; experimental free-threaded builds exist |
| Rust | async/await with runtimes such as Tokio, plus native threads | Compiler prevents many data races |

Go example of goroutines and a channel:

```go
results := make(chan int, len(urls))
for _, u := range urls {
    go func(url string) { results <- fetchStatus(url) }(u)   // one goroutine per call
}
for range urls {
    fmt.Println(<-results)
}
```

### 5.3 Interview questions

#### Q1. Threads or processes for image resizing in Python?

**Short answer.** Processes, because resizing is CPU-bound and the GIL stops threads from computing in parallel; unless the resizing library itself releases the GIL in native code, in which case threads also work.

**Detailed explanation.** Resizing an image means decoding pixels, interpolating and re-encoding: almost pure computation with little waiting. With threads in standard CPython, only one thread runs Python bytecode at a time, so four threads on four cores finish in about the same time as one. Processes each have their own interpreter, memory and GIL, so four processes really use four cores.

The nuance: popular imaging and numeric libraries do their heavy work in C and may release the GIL during it. In that case threads can run the C parts in parallel. The safe interview answer is "measure": run the same batch with 1, 2 and 4 workers of each kind and compare wall-clock time.

Worked plan for a photo service resizing 10,000 uploads per hour (about 2.8 per second, each taking \~0.5 s of CPU):

1. CPU needed ≈ 2.8 × 0.5 = 1.4 cores on average; plan for 3x peaks → about 4-5 cores.
2. Run a worker service with a process pool of 4 per machine, fed by a queue.
3. Pass file paths or object-storage keys to workers, not the image bytes, to avoid copying megabytes between processes.
4. Scale machines on queue depth.

**Costs of processes to mention.** Slower start-up, more memory (each process loads libraries), and data passed between processes must be serialized.

**If the interviewer pushes.** "What if this were Go or Java?" Goroutines or Java threads run on all cores in parallel, so a worker pool of threads is enough.

#### Q2. What makes goroutines and virtual threads different from OS threads?

**Short answer.** They are scheduled by the language runtime, not the operating system: many lightweight tasks are multiplexed onto a few OS threads, so creating hundreds of thousands is affordable and blocking-style code still scales.

**Detailed explanation.** An OS thread is managed by the kernel: it reserves its own stack (commonly megabytes of address space), and switching between threads requires the kernel. Ten thousand OS threads strain memory and scheduling.

Goroutines (Go) and virtual threads (Java 21+) start with small stacks that grow as needed and are switched by the runtime in user space. When a goroutine or virtual thread blocks on network I/O, the runtime parks it and runs another on the same OS thread, much like an async event loop, but you write ordinary blocking-style code without `await`.

|  | OS thread | Goroutine / virtual thread | Async coroutine |
| --- | --- | --- | --- |
| Scheduled by | Kernel | Language runtime | Event loop |
| Memory each | Large reserved stack | Small, growing stack | Small object |
| Code style | Blocking | Blocking | `async` / `await` everywhere |
| Parallel on many cores | Yes | Yes (runtime spreads them) | Not by itself |
| Practical count | Thousands | Hundreds of thousands or more | Hundreds of thousands |

Example: a Go service handling 50,000 concurrent slow HTTP requests can simply start a goroutine per request; the equivalent Python service would use asyncio.

**If the interviewer pushes.** "Any pitfalls?" Shared data still needs locks or channels; very CPU-heavy loops can delay other tasks; and in Java, some blocking operations (for example inside certain synchronized sections in early versions) can pin a virtual thread to its OS thread, reducing scalability.

## 6. System Design View, Choosing a Model, Failures and Interview Questions

### 6.1 Server models

| Model | How it handles requests | Strength | Weakness |
| --- | --- | --- | --- |
| Thread per request | Each request gets a thread from a pool | Simple blocking code | Many idle connections exhaust threads and memory |
| Event-driven (async) | One or few threads multiplex all connections | Huge connection counts (chat, streaming, gateways) | One blocking call stalls everyone; harder debugging |
| Lightweight threads | Runtime schedules many cheap threads | Simple code and high concurrency | Requires runtime support (Go, Java virtual threads) |
| Multi-process workers | Several processes each with their own loop or pool | Uses all cores; isolates crashes | More memory |

The classic "C10K" problem (10,000 concurrent connections per server) was solved largely by event-driven designs such as Nginx; today chat gateways hold far more per machine the same way.

### 6.2 Sync versus async between services

|  | Synchronous call (HTTP/gRPC request-response) | Asynchronous messaging (queue or event) |
| --- | --- | --- |
| Caller waits | Yes | No |
| Coupling | Caller depends on callee being up now | Producer works even if consumer is down |
| Latency | Immediate result | Result later (seconds or more) |
| Failure handling | Timeouts, retries, circuit breakers | Retries, dead letter queues, idempotent consumers |
| Use when | The user needs the answer now (price quote, login) | Work can finish later (emails, invoices, analytics, video processing) |

A common pattern for slow work over HTTP: return `202 Accepted` with a job ID, process asynchronously, and let the client poll a status endpoint or receive a webhook.

### 6.3 Choosing a model

| Workload | Choose | Why |
| --- | --- | --- |
| Many slow network calls | Async, or a thread pool | Overlap waiting |
| Thousands of long-lived connections | Async event loop or lightweight threads | Cheap per connection |
| Heavy computation | Processes or native parallel code | Use all cores |
| Simple scripts and low traffic | Synchronous | Simplest correct code |
| Work the user need not wait for | Queue + background workers | Fast responses, retries, load leveling |

### 6.4 Failure scenarios

| Failure | Symptom | Why it happens | Fix |
| --- | --- | --- | --- |
| Lost updates | Wrong balances or counts under load | Unsynchronized read-modify-write | Locks, atomic operations, database atomic updates |
| Deadlock | Requests hang forever | Locks acquired in different orders | Global lock order, timeouts |
| Event loop blocked | All requests on a server stall together | Blocking call or CPU work in async code | Async libraries; offload blocking work |
| Thread pool exhaustion | Timeouts while CPU is idle | All threads waiting on a slow dependency | Timeouts, bulkheads, async or bigger pools |
| Unbounded concurrency | Memory spikes, partner rate limits | Starting every task at once | Semaphores, bounded queues, backpressure |
| Connection pool exhaustion | "Cannot get connection" errors | More concurrent tasks than database connections | Size pools; cap concurrency to match |
| Heisenbugs | Failures that vanish when debugging | Timing-dependent races | Stress tests, race detectors (for example Go's `-race`), immutable data |

### 6.5 Production incident walkthrough

**Incident: an async API gateway freezes for 3 seconds at a time.**

| Time | Observation | Cause | Action |
| --- | --- | --- | --- |
| 18:00 | p99 latency jumps from 80 ms to 3 s on all routes at once | Shared stall across unrelated requests | Suspect the event loop |
| 18:10 | Profiling shows `requests.get` inside an async handler for a new feature-flag check | Synchronous HTTP call blocks the loop | Roll back the feature |
| Next day | Flag client switched to an async library with a cached value and timeout | Root cause fixed | Lint rule bans blocking libraries in async code |

### 6.6 Interview questions

#### Q1. Concurrency versus parallelism?

**Short answer.** Concurrency is structuring a program to deal with many tasks at once (they may take turns); parallelism is actually executing several tasks at the same instant on different cores.

**Detailed explanation.** A single cashier serving a queue while also answering the phone between customers is concurrent: tasks interleave, but only one thing happens at any instant. Four cashiers serving four customers simultaneously is parallel. An async web server on one core is concurrent but not parallel; four processes each crunching numbers on four cores are parallel.

The distinction matters for choosing tools: concurrency helps when tasks wait (I/O), because waiting can overlap; parallelism helps when tasks compute, because computation needs more cores. A program can be both: four processes, each running an async event loop.

**If the interviewer pushes.** "Can you have parallelism without concurrency?" Yes: one big computation split into identical chunks running on several cores (data parallelism, as in GPU training) has no interleaving of different tasks, just simultaneous execution.

#### Q2. When would you use threads instead of async?

**Short answer.** When the libraries you need are blocking (no async versions), when concurrency needs are moderate, or when the team values simple sequential-looking code; use async when you need very high connection counts and have async libraries end to end.

**Detailed explanation.** Async only works if every waiting call in the path is async: one blocking database driver or SDK call freezes the event loop. Many enterprise SDKs, older database drivers and file-handling libraries are blocking. A thread pool lets that code overlap waits with no rewrite.

| Situation | Better choice | Reason |
| --- | --- | --- |
| 50 concurrent calls through a blocking vendor SDK | Thread pool | No async SDK; threads overlap the waits |
| 20,000 WebSocket connections | Async (or lightweight threads) | Threads per connection would be too heavy |
| Mixed: async web framework calling one blocking library | Async + `asyncio.to_thread` for that call | Keep the loop free |
| Small internal tool | Threads or even synchronous | Simplicity wins |

**If the interviewer pushes.** "Are threads easier to get right?" Code reads more simply, but shared-memory races are easier to create with threads; async avoids preemption between awaits, so some races disappear, while blocking-the-loop bugs appear instead.

#### Q3. How do you protect a shared counter across 50 servers?

**Short answer.** In-process locks cannot help across machines; make the update atomic in a shared store (an atomic database update or Redis `INCR`), or route each key to a single owner.

**Detailed explanation.** A lock in server A's memory means nothing to server B. If each server reads the counter, adds one and writes it back, two servers can interleave exactly like two threads and lose updates. The fix moves the read-modify-write into one atomic operation executed by the store itself:

```sql
UPDATE coupon_budgets SET used = used + 1
WHERE coupon = 'DIWALI50' AND used < max_uses;     -- 0 rows changed means the budget is exhausted
```

Redis offers `INCR` and Lua scripts for check-and-increment. For very hot counters (likes on a viral post), split the counter into N shards (`likes:post42:shard7`) and sum them when reading; or send increments to a stream and aggregate them.

| Option | Strength | Weakness |
| --- | --- | --- |
| Atomic SQL update | Strongly consistent, durable | Hot rows limit throughput |
| Redis INCR or script | Very fast | Needs persistence and failover planning |
| Sharded counters | Scales writes | Reads sum several keys |
| Single owner per key (consistent hashing) | Simple local logic | Rebalancing on node changes |

**If the interviewer pushes.** "What about distributed locks?" Possible (for example a lease in etcd or Redis with fencing tokens), but slower and easy to get wrong; prefer atomic operations whenever the update fits in one.

#### Q4. Your service makes 1,000 outbound calls in a burst and the partner returns 429. How do you fix it?

**Short answer.** Cap concurrency (semaphore or bounded queue), respect the partner's rate limit with a token bucket, retry 429s with exponential backoff and jitter honoring Retry-After, and cache or batch where possible.

**Detailed explanation.** A 429 means you exceeded the partner's limit. Firing all 1,000 calls at once (for example with an unbounded `gather`) guarantees it; retrying them all immediately makes it worse, because every retry arrives at the same moment.

Step by step:

1. Find the limit (say 50 requests per second) from the partner's documentation or response headers.
2. Pace calls with a token bucket at about 45 per second (a margin below the limit) and cap in-flight calls with a semaphore (say 20).
3. On 429, wait for Retry-After if given, otherwise exponential backoff with jitter (for example random 0-0.5 s, then 0-1 s, then 0-2 s), with a maximum number of attempts.
4. Reduce calls: cache responses, use batch endpoints, and deduplicate identical requests.
5. Move bulk work to a queue so user requests are not blocked by the partner's limit.

Worked: 1,000 calls at 45 per second take about 22 seconds, steady, with no 429s, instead of a spike of failures and retries that may take longer and risk being blocked.

**If the interviewer pushes.** "Many of our servers share the partner limit." Then the token bucket must be shared (in Redis) or each server gets a fixed share of the limit.

#### Q5. Why return 202 for video uploads?

**Short answer.** Processing takes minutes, so the server acknowledges acceptance immediately with a job ID, processes in the background, and lets the client check status or receive a notification, instead of holding a connection open and risking timeouts.

**Detailed explanation.** `202 Accepted` means "received, not yet done". Transcoding a 10-minute video can take minutes. Keeping an HTTP request open that long ties up connections, hits load-balancer and proxy timeouts (often 60 seconds), and fails if the user's phone changes networks.

The asynchronous flow:

1. Client uploads the file directly to object storage using a pre-signed URL.
2. Client calls `POST /videos` with the storage key; the server creates a job and returns `202 Accepted` with `{"job_id": "j_91", "status_url": "/videos/j_91"}`.
3. A worker picks the job from a queue and transcodes it, updating status (queued → processing → ready or failed).
4. The client polls the status URL every few seconds, or the server pushes a notification or webhook when ready.

**Benefits.** Fast responses, retries without re-uploading, work spread across workers, and graceful handling of spikes (the queue absorbs them).

**If the interviewer pushes.** "What if the client retries the POST?" Use an idempotency key so a retry returns the same job instead of creating a duplicate.
