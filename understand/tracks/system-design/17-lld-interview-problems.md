# LLD Interview Problems

**Topic:** System design
**Covers:** How to Approach an LLD Round; Parking Lot; Elevator System; Splitwise (Expense Sharing); Movie Ticket Booking (BookMyShow-style); LRU Cache; Rate Limiter; Vending Machine; Tic-Tac-Toe and Snake and Ladder; In-Memory Key-Value Store with TTL; Meeting Room Scheduler; Quick Reference: 15 More LLD Problems
**Source:** [Claude artifact](https://claude.ai/artifact/7xxGdVxPGbUiPY13z4MdZ2) — written by a colleague, mirrored here for study.

The low-level design questions that come up most often in interviews, each solved end to end with the approach an interviewer expects. Patterns and principles used here are taught in the Design Patterns in Depth tab.

## How to Approach an LLD Round

Interviewers grade how you think, not just the final classes: do you clarify scope, model the domain cleanly, apply the right patterns, handle concurrency, and write working code for the core path? Follow the same six steps every time.

> *Diagram in the original artifact: LLD round approach · six steps with a time budget*

1. **Clarify (about 5 minutes).** Ask about scope, actors, scale, and what must be supported now versus later. Write the agreed requirements down.
2. **Identify entities (about 5 minutes).** Nouns become classes (Spot, Ticket, Vehicle); verbs become methods (park, unpark, pay). Note relationships (a floor has many spots).
3. **Define interfaces and classes (about 10 minutes).** Keep classes small; put variation behind interfaces (pricing, allocation, notifications).
4. **Walk the core flows (about 10 minutes).** Narrate the main use cases step by step and name the patterns where they appear.
5. **Code the heart of it (about 10 minutes).** Working code for the critical path, not every getter. Use enums, clear names, and validation.
6. **Harden and extend (about 5 minutes).** Concurrency, edge cases, failure handling, and how new requirements fit without rewrites.

| What interviewers look for | What it looks like |
| --- | --- |
| Requirement clarity | Questions asked before drawing; scope written down |
| Clean modeling | Right entities, single responsibilities, no god class |
| Extensibility | New vehicle types or pricing rules added without editing existing logic |
| Correctness under concurrency | Atomic allocation, locks or conditional updates, idempotency |
| Working code | Runs for the main flow, handles invalid input |
| Communication | Explains trade-offs and alternatives |

Common mistakes: jumping into code, one huge class, using patterns that solve no problem, ignoring concurrency, hard-coding prices and types, and running out of time before the core flow works.

## Problem 1: Parking Lot

**Clarifying questions.** How many floors? Which vehicle types (bike, car, truck) and spot sizes? Several entry and exit gates? How is pricing calculated? Do we need reservations, EV charging, or a display of free spots?

**Agreed requirements.** Multiple floors; spots for bikes, cars and trucks; several gates operating at once; a ticket issued at entry; hourly pricing per vehicle type; payment at exit; a live free-spot count per floor.

### Entities and patterns

| Entity | Responsibility | Pattern |
| --- | --- | --- |
| ParkingLot | Entry point: park and unpark | Facade |
| Floor | Holds spots; tracks free counts | Composite of spots |
| Spot | Type, status, current vehicle | State (FREE / OCCUPIED) |
| Vehicle | Plate and type | Enum for type |
| Ticket | Vehicle, spot, entry time | Value object |
| SpotAllocator | Chooses a spot (nearest, by floor) | Strategy |
| PricingStrategy | Computes the fee | Strategy |
| DisplayBoard | Shows free spots | Observer |

### Core code

```python
import math, threading, uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

class VehicleType(Enum): BIKE = 1; CAR = 2; TRUCK = 3

@dataclass
class Spot:
    id: str
    floor: int
    type: VehicleType
    vehicle_plate: str | None = None
    def free(self): return self.vehicle_plate is None

@dataclass
class Ticket:
    id: str
    plate: str
    spot: Spot
    entry: datetime = field(default_factory=datetime.now)

class HourlyPricing:
    RATES = {VehicleType.BIKE: (2_000, 1_000), VehicleType.CAR: (4_000, 3_000),
             VehicleType.TRUCK: (10_000, 8_000)}          # (first hour, each extra hour) in paise
    def fee(self, vtype, hours):
        first, extra = self.RATES[vtype]
        return first + max(0, hours - 1) * extra

class NearestFirstAllocator:
    def pick(self, spots, vtype):
        return next((s for s in spots if s.type == vtype and s.free()), None)

class ParkingLot:
    def __init__(self, spots, allocator, pricing):
        self.spots, self.allocator, self.pricing = spots, allocator, pricing
        self.tickets, self.lock, self.observers = {}, threading.Lock(), []

    def park(self, plate, vtype):
        with self.lock:                                   # two gates cannot take the same spot
            spot = self.allocator.pick(self.spots, vtype)
            if spot is None:
                raise RuntimeError("lot full for this vehicle type")
            spot.vehicle_plate = plate
            ticket = Ticket(str(uuid.uuid4()), plate, spot)
            self.tickets[ticket.id] = ticket
        self._notify(spot)
        return ticket

    def unpark(self, ticket_id, now=None):
        with self.lock:
            ticket = self.tickets.pop(ticket_id)          # KeyError: invalid or already used ticket
            ticket.spot.vehicle_plate = None
        hours = max(1, math.ceil(((now or datetime.now()) - ticket.entry).total_seconds() / 3600))
        self._notify(ticket.spot)
        return self.pricing.fee(ticket.spot.type, hours)

    def _notify(self, spot):
        for obs in self.observers:
            obs.spot_changed(spot)
```

Worked fee: a car parked 3 hours 10 minutes is billed 4 hours: ₹40 + 3 × ₹30 = ₹130.

### Concurrency and scale

In one process a lock prevents two gates from assigning the same spot. With several servers and a database, allocate with a conditional update: `UPDATE spots SET plate=? WHERE id=? AND plate IS NULL`, and retry with another spot if zero rows change. Per-floor locks or queues reduce contention in large lots.

### Follow-ups and how the design absorbs them

| New requirement | Change |
| --- | --- |
| EV charging spots | New spot type plus an allocator that prefers charging spots for EVs |
| Weekend or flat pricing | New pricing strategy class |
| Reservations | Spot state RESERVED with expiry; allocator skips reserved spots |
| Lost ticket | Look up by plate; charge a maximum daily fee |
| Large vehicle takes several spots | Allocate a run of adjacent spots atomically |

**Common mistakes.** One `ParkingLot` class doing everything; pricing hard-coded in `unpark`; no handling of two gates racing for one spot; using floats for money.

### Detailed answer walkthrough: parking lot

**What to say first.** "I'll design a multi-floor lot for bikes, cars and trucks with several gates. Entry issues a ticket and assigns the nearest suitable spot; exit computes an hourly fee and frees the spot. I'll keep pricing and spot selection pluggable, and make sure two gates can never assign the same spot."

**Design decisions and why.**

1. Spot is its own class, not a field on Floor, because spots carry state (free or occupied, which vehicle) and are the unit we lock and allocate.
2. Vehicle type is an enum rather than subclasses (Car, Bike), because the types do not behave differently; only their size matters. Subclasses would add classes without adding behavior.
3. Spot selection is a strategy (`NearestFirstAllocator`), because operators will want different policies: nearest to the lift, fill the top floor first, keep EV spots for EVs.
4. Pricing is a strategy, because pricing changes more often than any other rule (weekends, events, monthly passes) and must not touch parking logic.
5. The ticket is the only thing the exit gate needs; it links vehicle, spot and entry time, so exit does not search all spots.
6. Money is integer paise to avoid rounding errors.
7. Rejected alternative: making ParkingLot a Singleton. One instance per process is enough, but injecting it keeps tests simple and allows several lots in one service.

**Main flow, step by step.**

1. Car arrives at gate 2 → `park("KA01AB1234", CAR)`.
2. Acquire the lock (or start a database transaction).
3. Allocator returns the nearest free car spot, say F1-S07.
4. Mark the spot occupied and create a ticket with the entry time; release the lock.
5. Notify observers (display boards decrement the free count for floor 1).
6. At exit, `unpark(ticket_id)`: remove the ticket, free the spot, compute hours (rounded up, minimum 1) and the fee.
7. Payment succeeds → barrier opens; notify observers again.

**Edge cases.**

| Edge case | Handling |
| --- | --- |
| Lot full for that vehicle type | Reject at the entry gate; display shows FULL |
| Same plate already inside | Reject (likely a cloned plate or a missed exit); alert staff |
| Invalid or reused ticket | `KeyError` → reject; tickets are removed on use |
| Payment fails at exit | Keep the ticket active; do not free the spot until paid |
| Gate crashes after issuing a ticket but before the barrier opens | Ticket exists with no entry event; a timeout job frees the spot if the car never passes the entry sensor |
| Bike allowed in a car spot when bike spots are full | Compatibility table per vehicle type, tried in order of preference |
| Clock changes (daylight saving) | Store UTC timestamps |

**Complexity and a faster allocator.** The simple allocator scans all spots: O(S) per entry, fine for a few hundred spots. For thousands, keep one min-heap of free spots per vehicle type keyed by distance, giving O(log S) for both park and unpark:

```python
import heapq

class HeapAllocator:
    def __init__(self, spots):
        self.free = {}                                   # vehicle type -> heap of (distance, spot_id)
        self.by_id = {s.id: s for s in spots}
        for s in spots:
            heapq.heappush(self.free.setdefault(s.type, []), (s.distance, s.id))
    def pick(self, vtype):
        heap = self.free.get(vtype, [])
        return self.by_id[heapq.heappop(heap)[1]] if heap else None
    def release(self, spot):
        heapq.heappush(self.free[spot.type], (spot.distance, spot.id))
```

**Unit tests.**

```python
from datetime import datetime, timedelta

def test_parks_and_charges():
    spots = [Spot("F1-S1", 1, VehicleType.CAR)]
    lot = ParkingLot(spots, NearestFirstAllocator(), HourlyPricing())
    t = lot.park("KA01", VehicleType.CAR)
    fee = lot.unpark(t.id, now=t.entry + timedelta(hours=3, minutes=10))
    assert fee == 13_000                                  # ₹40 + 3 × ₹30

def test_full_lot_rejects():
    lot = ParkingLot([Spot("F1-S1", 1, VehicleType.CAR)], NearestFirstAllocator(), HourlyPricing())
    lot.park("KA01", VehicleType.CAR)
    try:
        lot.park("KA02", VehicleType.CAR); assert False
    except RuntimeError:
        pass

def test_concurrent_gates_never_share_a_spot():
    import threading
    spots = [Spot(f"S{i}", 1, VehicleType.CAR) for i in range(50)]
    lot = ParkingLot(spots, NearestFirstAllocator(), HourlyPricing())
    tickets = []
    def gate(i): tickets.append(lot.park(f"KA{i}", VehicleType.CAR))
    threads = [threading.Thread(target=gate, args=(i,)) for i in range(50)]
    [t.start() for t in threads]; [t.join() for t in threads]
    assert len({t.spot.id for t in tickets}) == 50       # all spots distinct
```

**Follow-up dialogue.**

- *Interviewer: The gates run on different servers. Does your lock still work?* No: a process lock only protects one server. I would move allocation into the database: pick a candidate spot and run `UPDATE spots SET plate=? WHERE id=? AND plate IS NULL`; if zero rows change, another gate took it and I try the next candidate. A unique constraint on (plate) for active tickets also prevents duplicates.
- *Interviewer: How do display boards stay accurate?* Each park and unpark publishes an event; boards subscribe (Observer). Boards also reconcile from the database every minute in case an event was missed.
- *Interviewer: Add monthly passes.* A pass is a pricing rule: a new `PassAwarePricing` strategy that checks the plate against active passes and returns zero, falling back to hourly pricing. Parking logic is unchanged.

## Problem 2: Elevator System

**Clarifying questions.** How many elevators and floors? Is the goal shortest wait, least energy, or both? Are there capacity limits, maintenance mode, emergency or fire mode? Do riders choose the destination outside (destination dispatch) or inside the car?

**Agreed requirements.** N elevators, M floors; hall calls (floor + direction) and car calls (destination inside); assign each hall call to the best elevator; each elevator serves stops efficiently; maintenance mode.

### Entities and patterns

| Entity | Responsibility | Pattern |
| --- | --- | --- |
| ElevatorController | Receives requests, assigns elevators | Mediator / Facade |
| Elevator | Position, direction, stop sets, state | State (IDLE, UP, DOWN, MAINTENANCE) |
| Dispatcher | Chooses which elevator gets a hall call | Strategy |
| Request | Floor and direction | Value object |

### Scheduling: the LOOK algorithm

An elevator keeps moving in its current direction while there are stops ahead, serving them in order, then reverses. This avoids the zig-zagging of first-come-first-served.

### Dispatch cost, worked

Elevator A is at floor 2 moving up to floor 8; elevator B is idle at floor 9. A hall call comes from floor 5 going up.

| Elevator | Situation | Cost |
| --- | --- | --- |
| A | Moving up and 5 is ahead in the same direction | 5 − 2 = 3 floors |
| B | Idle | 9 − 5 = 4 floors |

A wins. If the call were from floor 5 going down, A would pass 5 going up, so its cost would include finishing the upward trip (to 8, then back to 5: 6 + 3 = 9), and B (4) would win.

### Core code

```python
from enum import Enum

class Dir(Enum): UP = 1; DOWN = -1; IDLE = 0

class Elevator:
    def __init__(self, eid, floor=0):
        self.id, self.floor, self.dir = eid, floor, Dir.IDLE
        self.stops, self.in_service = set(), True

    def cost(self, floor, direction):
        if not self.in_service:
            return float("inf")
        if self.dir == Dir.IDLE:
            return abs(self.floor - floor)
        ahead = (floor - self.floor) * self.dir.value >= 0
        if ahead and direction == self.dir:
            return abs(floor - self.floor)
        far = max(self.stops) if self.dir == Dir.UP else min(self.stops)
        return abs(far - self.floor) + abs(far - floor)          # finish this sweep first

    def step(self):                                              # called every tick
        if not self.stops:
            self.dir = Dir.IDLE; return
        if self.dir == Dir.IDLE:
            self.dir = Dir.UP if min(self.stops, key=lambda s: abs(s - self.floor)) > self.floor else Dir.DOWN
        if self.floor in self.stops:
            self.stops.discard(self.floor)                       # open doors here
            return
        if not any((s - self.floor) * self.dir.value > 0 for s in self.stops):
            self.dir = Dir.DOWN if self.dir == Dir.UP else Dir.UP  # LOOK: reverse
        self.floor += self.dir.value

class Controller:
    def __init__(self, elevators): self.elevators = elevators
    def hall_call(self, floor, direction):
        best = min(self.elevators, key=lambda e: e.cost(floor, direction))
        best.stops.add(floor)
        return best.id
    def car_call(self, elevator_id, floor):
        self.elevators[elevator_id].stops.add(floor)
```

### Concurrency

Requests arrive from many buttons at once. Funnel them into a queue processed by one controller thread (or lock each elevator's stop set), so two calls never corrupt state. The physical motion loop runs per elevator.

### Follow-ups

| New requirement | Change |
| --- | --- |
| Fire mode | New state: all cars go to the ground floor and ignore calls |
| Capacity | Skip hall calls when the car is full (weight sensor) |
| Destination dispatch | Riders enter destination in the lobby; dispatcher groups riders by destination |
| Peak morning traffic | Different dispatch strategy (park idle cars at the lobby) |

**Common mistakes.** First-come-first-served scheduling; no distinction between hall and car calls; elevator logic and dispatch logic mixed in one class.

### Detailed answer walkthrough: elevator system

**What to say first.** "I'll separate two problems: which elevator answers a hall call (dispatch), and in what order one elevator serves its stops (scheduling). Dispatch uses a cost function; scheduling uses the LOOK algorithm. Each elevator is a small state machine."

**Design decisions and why.**

1. Hall calls (floor + direction, pressed outside) and car calls (destination, pressed inside) are different: hall calls need dispatch, car calls belong to one elevator already.
2. Dispatch is a strategy, because buildings tune it: shortest wait at lunch, park cars at the lobby in the morning, energy saving at night.
3. Each elevator owns its stop set and direction; the controller never moves cars directly. This keeps elevator behavior testable in isolation.
4. LOOK scheduling instead of first-come-first-served, because serving stops in the current direction avoids zig-zagging.

**Why LOOK beats first-come-first-served, worked.** The car is at floor 4 moving up. Requests arrive in this order: 2, 9, 3, 8.

| Policy | Path | Floors travelled |
| --- | --- | --- |
| First-come-first-served | 4 → 2 → 9 → 3 → 8 | 2 + 7 + 6 + 5 = 20 |
| LOOK (finish upward stops, then reverse) | 4 → 8 → 9 → 3 → 2 | 4 + 1 + 6 + 1 = 12 |

LOOK travels 40% fewer floors here, and riders above are served sooner.

**Main flow, step by step.**

1. Someone on floor 5 presses UP → `hall_call(5, UP)`.
2. Controller asks each elevator for its cost; elevators in maintenance return infinity.
3. The cheapest elevator adds floor 5 to its stops; the hall button light stays on until it arrives.
4. Every tick, each elevator steps: if the current floor is a stop, it opens doors and removes the stop; if no stops remain ahead, it reverses; if no stops at all, it becomes idle.
5. Inside, the rider presses 12 → `car_call(elevator, 12)` adds the stop to that elevator only.

**Edge cases.**

| Edge case | Handling |
| --- | --- |
| Call from the floor the car is already on, doors open | Reopen doors; no movement |
| All elevators in maintenance | Reject calls and show "out of service" |
| Up and down calls on the same floor | Two separate requests; may be served by different cars |
| Car full (weight sensor) | Skip new hall pickups until load drops; dispatcher reassigns |
| Car call for a floor behind the current direction | Kept; served after the reversal |
| Elevator fails mid-trip | Mark out of service; its pending hall calls go back to the dispatcher |

**Complexity.** Dispatch is O(E) per hall call (E elevators). Each step checks whether stops lie ahead, O(k) for k stops; sorted structures (two heaps for up and down stops) make it O(log k).

**Unit tests.**

```python
def test_dispatch_prefers_car_moving_toward_call():
    a, b = Elevator(0, floor=2), Elevator(1, floor=9)
    a.dir, a.stops = Dir.UP, {8}
    ctrl = Controller([a, b])
    assert ctrl.hall_call(5, Dir.UP) == 0                # A is on the way (cost 3 vs 4)

def test_look_serves_upward_stops_before_reversing():
    e = Elevator(0, floor=4); e.dir = Dir.UP; e.stops = {2, 9, 3, 8}
    visited = []
    for _ in range(30):
        before = set(e.stops); e.step()
        if before - e.stops: visited.append(e.floor)
    assert visited == [8, 9, 3, 2]
```

**Follow-up dialogue.**

- *Interviewer: How do you add fire mode?* A building-wide mode: the controller switches every elevator into a FIRE state that clears stops, travels to the ground floor and ignores calls until reset by staff. Because elevators are state machines, this is a new state, not scattered if-statements.
- *Interviewer: How would you minimize waiting at 9 a.m.?* Swap the dispatch strategy for an up-peak one: send idle cars back to the lobby and group riders by destination.
- *Interviewer: Requests come from hundreds of buttons concurrently. Is your code safe?* Calls go into a queue consumed by a single controller thread, so dispatch decisions never interleave; elevator stop sets are only modified by that thread or under a per-elevator lock.

## Problem 3: Splitwise (Expense Sharing)

**Clarifying questions.** Split types (equal, exact amounts, percentages, shares)? Groups as well as one-to-one? Multiple currencies? Should debts be simplified to fewer payments? Settlements and history?

**Agreed requirements.** Users and groups; add expenses with equal, exact or percentage splits; show who owes whom; record settlements; simplify debts within a group.

### Entities and patterns

| Entity | Responsibility | Pattern |
| --- | --- | --- |
| User, Group | People and membership | Plain entities |
| Expense | Payer, amount, participants, split type | Immutable record |
| SplitStrategy | Computes each person's share | Strategy (+ Factory by type) |
| Ledger / BalanceSheet | Net balance per user | Aggregate updated per expense |
| DebtSimplifier | Minimizes number of payments | Algorithm (greedy with heaps) |

### Splitting rules, with rounding

Use integer paise. An equal split of ₹100 among 3 people gives 3,334 + 3,333 + 3,333 paise: hand out the remainder one paisa at a time so the total always matches. Exact splits must sum to the amount; percentages must sum to 100.

```python
import heapq
from collections import defaultdict

class EqualSplit:
    def shares(self, amount, users, _=None):
        base, rem = divmod(amount, len(users))
        return {u: base + (1 if i < rem else 0) for i, u in enumerate(users)}

class ExactSplit:
    def shares(self, amount, users, exact):
        if sum(exact.values()) != amount:
            raise ValueError("exact shares must sum to the amount")
        return dict(exact)

class PercentSplit:
    def shares(self, amount, users, pct):
        if sum(pct.values()) != 100:
            raise ValueError("percentages must sum to 100")
        out = {u: amount * p // 100 for u, p in pct.items()}
        first = next(iter(out)); out[first] += amount - sum(out.values())   # fix rounding
        return out

class Ledger:
    def __init__(self): self.net = defaultdict(int)          # positive = is owed money
    def add_expense(self, payer, amount, users, strategy, extra=None):
        for user, share in strategy.shares(amount, users, extra).items():
            self.net[user] -= share
        self.net[payer] += amount

    def simplify(self):
        creditors = [(-v, u) for u, v in self.net.items() if v > 0]
        debtors = [(v, u) for u, v in self.net.items() if v < 0]
        heapq.heapify(creditors); heapq.heapify(debtors)
        payments = []
        while creditors and debtors:
            c_amt, c = heapq.heappop(creditors); d_amt, d = heapq.heappop(debtors)
            pay = min(-c_amt, -d_amt)
            payments.append((d, c, pay))
            if -c_amt > pay: heapq.heappush(creditors, (c_amt + pay, c))
            if -d_amt > pay: heapq.heappush(debtors, (d_amt + pay, d))
        return payments
```

### Worked example

A pays ₹900 for dinner split equally among A, B and C. B pays ₹600 for a cab split equally between A and B.

| Person | Dinner | Cab | Net |
| --- | --- | --- | --- |
| A | +900 − 300 = +600 | −300 | +300 |
| B | −300 | +600 − 300 = +300 | 0 |
| C | −300 | 0 | −300 |

Simplified: one payment, C pays A ₹300, instead of three separate debts. Nets always sum to zero, which is a good invariant to assert.

### Concurrency and storage

Store expenses as append-only records and update balances in the same transaction (or recompute balances from expenses). Two people adding expenses at once must not lose updates: use row-level updates (`net = net + ?`) or a per-group lock.

### Follow-ups

| New requirement | Change |
| --- | --- |
| Multiple currencies | Store currency per expense; convert at a recorded rate when settling |
| Edit or delete expense | Reverse the old entries and apply new ones (never edit balances directly) |
| Recurring expenses | Scheduler creates expenses from a template |
| Share-based splits | New strategy class |

**Common mistakes.** Floats for money; splits that do not sum exactly; storing pairwise debts instead of net balances; editing balances without an audit trail.

### Detailed answer walkthrough: Splitwise

**What to say first.** "Expenses are immutable records. Each expense updates a net balance per user: positive means others owe them, negative means they owe. Split rules are strategies. For settling up, I simplify net balances into a small set of payments."

**Design decisions and why.**

1. Net balance per user instead of a matrix of who-owes-whom: with n users a matrix has n² entries and is hard to keep consistent; net balances are n numbers that always sum to zero.
2. Expenses are append-only: edits are a reversal plus a new expense, so history is auditable and balances can be rebuilt from scratch.
3. Split types are strategies with validation inside each one (exact must sum to the amount, percentages to 100), so adding "shares" or "adjustments" never touches the ledger.
4. Integer paise with deterministic remainder distribution, so every expense balances to the last paisa.
5. Rejected alternative: storing balances only in a cache. Money data needs a durable source of truth.

**Main flow, step by step.**

1. User adds "Dinner ₹900, paid by A, equal among A, B, C".
2. Validate: amount > 0, payer and participants are group members.
3. EqualSplit returns {A: 30,000, B: 30,000, C: 30,000} paise.
4. In one transaction: insert the expense row and update balances (A +90,000 − 30,000; B −30,000; C −30,000).
5. Assert the group's balances still sum to zero.
6. On "Settle up", run the simplifier and show the suggested payments.

**Debt simplification, worked with four people.** Net balances: A +300, B +100, C −250, D −150 (rupees).

| Step | Largest creditor | Largest debtor | Payment | Remaining |
| --- | --- | --- | --- | --- |
| 1 | A 300 | C 250 | C pays A ₹250 | A 50 |
| 2 | B 100 | D 150 | D pays B ₹100 | D 50 |
| 3 | A 50 | D 50 | D pays A ₹50 | all zero |

Three payments. Each step zeroes at least one person, so the greedy method needs at most n − 1 payments; finding the absolute minimum in every case is a much harder combinatorial problem, so production apps use this greedy approach.

**Edge cases.**

| Edge case | Handling |
| --- | --- |
| Payer not among participants (paid for others) | Allowed: payer gets +amount, participants get their shares |
| Zero or negative amount | Reject |
| ₹100 among 3 | 3,334 + 3,333 + 3,333 paise |
| Percentages 33/33/33 | Reject (sum 99) or ask for an adjustment |
| Removing a member with a non-zero balance | Block until settled |
| Editing an old expense | Reverse it and add the corrected one |

**Complexity.** Adding an expense is O(p) for p participants. Simplification is O(n log n) for n users with balances.

**Unit tests.**

```python
def test_equal_split_rounds_exactly():
    shares = EqualSplit().shares(10_000, ["A", "B", "C"])
    assert sum(shares.values()) == 10_000 and max(shares.values()) - min(shares.values()) == 1

def test_balances_sum_to_zero_and_simplify():
    ledger = Ledger()
    ledger.add_expense("A", 90_000, ["A", "B", "C"], EqualSplit())
    ledger.add_expense("B", 60_000, ["A", "B"], EqualSplit())
    assert sum(ledger.net.values()) == 0
    assert ledger.simplify() == [("C", "A", 30_000)]

def test_percent_must_total_100():
    try:
        PercentSplit().shares(10_000, None, {"A": 50, "B": 40}); assert False
    except ValueError:
        pass
```

**Follow-up dialogue.**

- *Interviewer: Users want to see "you owe Ravi ₹200" per person, not just net totals.* Keep a pairwise view computed from expenses (who paid for whom) for display, but settle using net balances; both come from the same expense log.
- *Interviewer: Two people add expenses at the same moment. Can balances go wrong?* Not if each expense updates balances with atomic increments (`net = net + ?`) inside one transaction with the expense insert. Read-modify-write in application code would lose updates.
- *Interviewer: Partial settlement?* A settlement is just a special expense: the payer gives money to one person, updating both balances.

## Problem 4: Movie Ticket Booking (BookMyShow-style)

**Clarifying questions.** Cities, theatres, screens and shows? Seat types and prices? How long can a user hold seats while paying? Cancellations and refunds? Many users booking the same show at once?

**Agreed requirements.** Browse shows by city and movie; see a seat map; select seats, which are held for 10 minutes; pay; confirm; release seats on timeout or payment failure; no seat ever sold twice.

### Entities and patterns

| Entity | Responsibility | Pattern |
| --- | --- | --- |
| Movie, Theatre, Screen, Seat | Catalog and layout | Plain entities |
| Show | A movie on a screen at a time | Aggregate |
| ShowSeat | A seat for one show: status, hold owner, hold expiry | State (AVAILABLE, HELD, BOOKED) |
| SeatLockProvider | Holds and releases seats | Strategy (in-memory or database) |
| BookingService | Hold → pay → confirm | Facade over the flow |
| PaymentGateway | Charges the user | Adapter around a vendor |
| PricingStrategy | Seat-type and time-based prices | Strategy |

### Core code

```python
import threading, time, uuid

class SeatLockProvider:
    def __init__(self, hold_seconds=600):
        self.holds, self.hold_seconds, self.lock = {}, hold_seconds, threading.Lock()
    def _active(self, key):
        h = self.holds.get(key)
        return h if h and h["expires"] > time.time() else None
    def hold(self, show_id, seat_ids, user_id):
        with self.lock:                                  # all-or-nothing
            taken = [s for s in seat_ids if self._active((show_id, s)) and
                     self._active((show_id, s))["user"] != user_id]
            if taken:
                raise ValueError(f"seats already held: {taken}")
            expiry = time.time() + self.hold_seconds
            for s in seat_ids:
                self.holds[(show_id, s)] = {"user": user_id, "expires": expiry}
    def owns(self, show_id, seat_ids, user_id):
        return all((h := self._active((show_id, s))) and h["user"] == user_id for s in seat_ids)
    def release(self, show_id, seat_ids):
        with self.lock:
            for s in seat_ids: self.holds.pop((show_id, s), None)

class BookingService:
    def __init__(self, locks, booked, payments, pricing):
        self.locks, self.booked, self.payments, self.pricing = locks, booked, payments, pricing
    def select(self, show_id, seat_ids, user_id):
        if any((show_id, s) in self.booked for s in seat_ids):
            raise ValueError("some seats are already booked")
        self.locks.hold(show_id, seat_ids, user_id)
    def confirm(self, show_id, seat_ids, user_id, idem_key):
        if not self.locks.owns(show_id, seat_ids, user_id):
            raise ValueError("hold expired; please select seats again")
        amount = self.pricing.total(show_id, seat_ids)
        self.payments.charge(user_id, amount, key=idem_key)
        booking_id = str(uuid.uuid4())
        for s in seat_ids: self.booked[(show_id, s)] = booking_id
        self.locks.release(show_id, seat_ids)
        return booking_id
```

### Worked race

Priya and Arjun both tap seats F7 and F8 at the same moment. Priya's hold acquires the lock first and holds both seats; Arjun's hold finds them held by someone else and fails for both (all-or-nothing), so he never ends up with one of two seats he wanted. If Priya's payment takes longer than 10 minutes, her confirm fails on the ownership check; if money was taken anyway, a refund is issued.

### Production version

With many servers, holds live in the database (`UPDATE show_seats SET status='HELD', held_by=?, hold_expires=? WHERE show_id=? AND seat_id IN (...) AND (status='AVAILABLE' OR hold_expires < now())`, checking the row count) or in Redis with expiry plus a database check at confirmation. A unique constraint on booked (show, seat) is the last line of defense.

### Follow-ups

| New requirement | Change |
| --- | --- |
| Dynamic pricing | New pricing strategy |
| Mega sales | Waiting room before seat selection (Case Studies tab, ticket booking) |
| Cancellations | Booking state CANCELLED; seats return to AVAILABLE; refund policy strategy |
| Group seats together | Allocator that finds adjacent free seats |

**Common mistakes.** Checking availability and booking in separate steps (race); holds that never expire; partial holds of a seat group.

### Detailed answer walkthrough: movie ticket booking

**What to say first.** "The hard part is seat contention. I model a seat per show (ShowSeat) with a status and a time-limited hold. Holding is all-or-nothing for the requested seats, payment happens outside any lock, and confirmation re-checks that the hold is still mine."

**Design decisions and why.**

1. ShowSeat, not Seat, carries status: the same physical seat is free for the 7 p.m. show and booked for the 10 p.m. show.
2. Holds expire (10 minutes) so abandoned carts return seats automatically; no cleanup job is needed for correctness because an expired hold counts as free.
3. Holding several seats is all-or-nothing: a family wanting F7-F8 should never end up with only F7.
4. Payment runs outside the lock: payments take seconds, and holding a lock that long would block every other buyer.
5. Confirmation checks hold ownership and expiry again, because payment might finish after the hold expired.
6. Seat locking is behind an interface, so the in-memory version used in the interview can be swapped for a database or Redis implementation.
7. Rejected alternative: locking the whole show during checkout, which serializes every buyer and collapses at big releases.

**Main flow, step by step.**

1. User opens the seat map: layout from cache, live statuses from ShowSeat.
2. User selects F7 and F8 → `select(show, [F7, F8], user)`.
3. Under the lock: if either seat is booked or held by someone else, fail both; otherwise hold both until now + 10 minutes.
4. User pays with an idempotency key (retries never charge twice).
5. `confirm`: verify the user still holds both seats; create the booking; mark seats booked; release holds.
6. Ticket and QR code are sent; seat map viewers see the seats turn grey.

**Edge cases.**

| Edge case | Handling |
| --- | --- |
| Hold expires during payment, seats resold | Confirmation fails; captured money refunded automatically |
| User taps "pay" twice | Same idempotency key → one charge, one booking |
| User reselects seats they already hold | Allowed (own holds are not conflicts); expiry refreshed |
| Box-office sale of the same seat | Uses the same SeatLockProvider and booking path |
| Payment gateway down | Holds remain until expiry; user can retry with another method |
| Very popular show | Waiting room before seat selection |

**Complexity.** Hold and confirm are O(k) for k seats requested. The seat map read is O(seats in the screen), typically a few hundred.

**Unit tests.**

```python
class FakePayments:
    def __init__(self): self.charges = {}
    def charge(self, user, amount, key): self.charges.setdefault(key, (user, amount))

class FlatPricing:
    def total(self, show, seats): return 25_000 * len(seats)

def make_service(hold_seconds=600):
    return BookingService(SeatLockProvider(hold_seconds), {}, FakePayments(), FlatPricing())

def test_second_user_cannot_hold_same_seats():
    svc = make_service()
    svc.select("show1", ["F7", "F8"], "priya")
    try:
        svc.select("show1", ["F8", "F9"], "arjun"); assert False
    except ValueError:
        pass

def test_confirm_after_expiry_fails():
    svc = make_service(hold_seconds=0)
    svc.select("show1", ["F7"], "priya")
    try:
        svc.confirm("show1", ["F7"], "priya", "idem-1"); assert False
    except ValueError:
        pass

def test_double_pay_charges_once():
    svc = make_service()
    svc.select("show1", ["F7"], "priya")
    svc.confirm("show1", ["F7"], "priya", "idem-1")
    assert len(svc.payments.charges) == 1
```

**Follow-up dialogue.**

- *Interviewer: Your lock is in memory. What about 20 app servers?* Holds move to the database with a conditional update that only succeeds if every requested seat is available or its hold has expired (checking the affected row count equals the seat count), all in one transaction. Redis with expiry is a faster alternative, but the database stays the final authority, with a unique constraint on booked (show, seat).
- *Interviewer: How do other viewers see seats disappear?* Hold and booking events go to pub/sub; seat-map connections receive small diffs.
- *Interviewer: Payment succeeded but confirmation crashed.* Reconciliation finds payments without bookings: if the seats are still held or free, complete the booking; otherwise refund.

## Problem 5: LRU Cache

**Clarifying questions.** Fixed capacity by number of items? O(1) get and put required? Thread-safe? TTL per key?

**Agreed requirements.** `get(key)` and `put(key, value)` in O(1); when full, evict the least recently used item; safe for concurrent use.

### Design

A hash map gives O(1) lookup; a doubly linked list keeps items in recency order (most recent at the head). On every get or put, move the node to the head; when over capacity, remove the tail. Interviewers usually want this built by hand rather than with a library ordered dictionary.

```python
import threading

class Node:
    __slots__ = ("key", "val", "prev", "next")
    def __init__(self, key=None, val=None):
        self.key, self.val, self.prev, self.next = key, val, None, None

class LRUCache:
    def __init__(self, capacity):
        self.cap, self.map, self.lock = capacity, {}, threading.Lock()
        self.head, self.tail = Node(), Node()            # sentinels
        self.head.next, self.tail.prev = self.tail, self.head

    def _remove(self, n):
        n.prev.next, n.next.prev = n.next, n.prev

    def _add_front(self, n):
        n.prev, n.next = self.head, self.head.next
        self.head.next.prev = n
        self.head.next = n

    def get(self, key):
        with self.lock:
            n = self.map.get(key)
            if n is None:
                return None
            self._remove(n); self._add_front(n)
            return n.val

    def put(self, key, val):
        with self.lock:
            if key in self.map:
                n = self.map[key]; n.val = val
                self._remove(n); self._add_front(n)
                return
            n = Node(key, val); self.map[key] = n; self._add_front(n)
            if len(self.map) > self.cap:
                lru = self.tail.prev
                self._remove(lru); del self.map[lru.key]
```

### Worked trace (capacity 2)

| Operation | List (most recent first) | Result |
| --- | --- | --- |
| put(1, A) | 1 |  |
| put(2, B) | 2, 1 |  |
| get(1) | 1, 2 | A |
| put(3, C) | 3, 1 | evicts 2 |
| get(2) | 3, 1 | None |

### Follow-ups

| New requirement | Change |
| --- | --- |
| High concurrency | Shard into N caches by key hash, each with its own lock |
| TTL | Store expiry per node; treat expired as missing; background sweeper |
| LFU instead | Frequency buckets, each a linked list, plus a min-frequency pointer |
| Size in bytes | Track total bytes and evict until under the limit |
| Distributed | Consistent hashing across nodes (Redis Cluster-like) |

**Common mistakes.** Forgetting to move a node on `get`; not updating the map on eviction; a singly linked list making removal O(n); no lock in a multi-threaded server.

### Detailed answer walkthrough: LRU cache

**What to say first.** "I need O(1) lookup and O(1) reordering. A hash map alone can't track recency; a list alone can't find keys fast. Together, a hash map pointing into a doubly linked list gives both."

**Design decisions and why.**

1. Doubly linked, not singly: removing a node from the middle needs its predecessor; with a `prev` pointer that is O(1).
2. Sentinel head and tail nodes remove every empty-list and one-element special case, which is where most interview bugs hide.
3. The map stores nodes, not values, so a lookup jumps straight to the node to move it.
4. The node stores its key, because on eviction we must also delete the key from the map; without the key we could not find it.
5. A single lock keeps it correct under threads; sharding by key hash is the scaling step if contention appears.
6. Rejected alternative in the interview: a library ordered dictionary. It is fine in production, but interviewers want to see the mechanism; mention it as the practical choice.

**Pointer changes, step by step.** Moving node X to the front when the list is head ⇄ A ⇄ X ⇄ B ⇄ tail:

1. Remove X: A.next = B; B.prev = A.
2. Insert after head: X.prev = head; X.next = A; A.prev = X; head.next = X.
3. Result: head ⇄ X ⇄ A ⇄ B ⇄ tail.

**Edge cases.**

| Edge case | Handling |
| --- | --- |
| Capacity 0 | Reject in the constructor, or make every put a no-op |
| put on an existing key | Update the value and move it to the front; size unchanged |
| get on a missing key | Return None without changing order |
| Values of very different sizes | Evict by total bytes, not item count |
| Concurrent get and put | Lock around the whole operation (both map and list change) |

**Complexity.** get and put are O(1) time; memory is O(capacity) nodes plus map entries.

**Unit tests.**

```python
def test_evicts_least_recently_used():
    c = LRUCache(2)
    c.put(1, "A"); c.put(2, "B")
    assert c.get(1) == "A"              # 1 becomes most recent
    c.put(3, "C")                       # evicts 2
    assert c.get(2) is None and c.get(1) == "A" and c.get(3) == "C"

def test_update_existing_key_does_not_grow():
    c = LRUCache(2)
    c.put(1, "A"); c.put(1, "A2"); c.put(2, "B")
    assert c.get(1) == "A2" and len(c.map) == 2
```

**Follow-up dialogue.**

- *Interviewer: Make it LFU.* Keep a map from frequency to a doubly linked list of keys and track the minimum frequency. On access, move the key from list f to list f + 1; on eviction, remove the least recent key from the minimum-frequency list. Still O(1).
- *Interviewer: 32 threads hammer it and latency rises.* Contention on one lock. Split into 16 shards by key hash, each with its own lock and capacity / 16.
- *Interviewer: Why do Redis and others use approximate LRU?* Maintaining an exact global list costs memory and locking; sampling a few keys and evicting the oldest among them is nearly as good and much cheaper.

## Problem 6: Rate Limiter

**Clarifying questions.** Limit by user, API key, IP or endpoint? Different limits per plan? Burst allowance? Single server or many? What happens when limited (reject, queue)?

**Agreed requirements.** Per-key limits configurable per plan; several algorithms pluggable; thread-safe; reject with 429 and a retry hint; works across servers later.

### Entities and patterns

| Entity | Responsibility | Pattern |
| --- | --- | --- |
| RateLimiter (interface) | `allow(key) -> (bool, retry_after)` | Strategy |
| TokenBucketLimiter, SlidingWindowCounterLimiter | Algorithms | Strategy implementations |
| LimiterRegistry | Picks limits by plan and endpoint | Factory |
| Middleware | Applies limits to requests | Chain of Responsibility |
| Store | Where counters live (memory or Redis) | Strategy / Adapter |

### Sliding window counter, worked

Limit 100 requests per minute. The previous minute had 80 requests; the current minute has 30 so far, and we are 15 seconds into it. Estimate = 30 + 80 × (45 ÷ 60) = 30 + 60 = 90 < 100, so allow. It smooths the burst problem of fixed windows using only two counters per key.

```python
import threading, time
from collections import defaultdict

class SlidingWindowCounterLimiter:
    def __init__(self, limit, window=60):
        self.limit, self.window = limit, window
        self.counts = defaultdict(int)                   # (key, window_start) -> count
        self.lock = threading.Lock()

    def allow(self, key, now=None):
        now = time.time() if now is None else now
        start = int(now // self.window) * self.window
        elapsed = now - start
        with self.lock:
            prev = self.counts[(key, start - self.window)]
            curr = self.counts[(key, start)]
            estimate = curr + prev * (self.window - elapsed) / self.window
            if estimate >= self.limit:
                return False, round(self.window - elapsed, 1)
            self.counts[(key, start)] += 1
            return True, 0

class TokenBucketLimiter:
    def __init__(self, rate, capacity):
        self.rate, self.capacity = rate, capacity
        self.state, self.lock = {}, threading.Lock()     # key -> (tokens, last_time)
    def allow(self, key, now=None):
        now = time.monotonic() if now is None else now
        with self.lock:
            tokens, last = self.state.get(key, (self.capacity, now))
            tokens = min(self.capacity, tokens + (now - last) * self.rate)
            if tokens < 1:
                self.state[key] = (tokens, now)
                return False, round((1 - tokens) / self.rate, 2)
            self.state[key] = (tokens - 1, now)
            return True, 0

LIMITS = {"free": lambda: TokenBucketLimiter(rate=2, capacity=10),
          "pro": lambda: TokenBucketLimiter(rate=20, capacity=100)}
```

### Distributed version

Across many servers, keep counters in Redis and update them atomically with a Lua script (read, compute, write in one step). Decide fail-open or fail-closed if Redis is down (open for general APIs, closed for login and payments). Old window keys expire automatically.

### Follow-ups

| New requirement | Change |
| --- | --- |
| Per-endpoint limits | Registry keyed by (plan, endpoint) |
| Cost-based limits (LLM tokens) | Spend N tokens per request instead of 1 |
| Queue instead of reject | Leaky bucket that delays requests |
| Memory growth | Expire idle keys; clean old windows |

**Common mistakes.** Fixed windows that allow double bursts at boundaries; non-atomic read-then-write across servers; limiting only by IP (shared networks).

### Detailed answer walkthrough: rate limiter

**What to say first.** "A limiter answers one question per request: allow or reject, and if rejected, when to retry. I'll define that interface, implement token bucket and sliding window counter behind it, choose limits per plan through a registry, and apply it as middleware."

**Design decisions and why.**

1. One interface, several algorithms (Strategy), because products need different behavior: token bucket for burst-friendly APIs, sliding window for strict per-minute quotas.
2. Limits come from configuration per plan and endpoint (Factory/registry), so sales can change limits without code changes.
3. The limiter returns a retry-after hint, so clients back off intelligently instead of hammering.
4. State lives behind a store abstraction: memory for one server, Redis for many.
5. Rejected alternative: a fixed window counter, because it allows up to double the limit across a window boundary (100 requests at 0:59 and 100 at 1:00).

**Token bucket, step by step.** Rate 2 tokens per second, capacity 10 (free plan).

| Time (s) | Event | Tokens before | Decision | Tokens after |
| --- | --- | --- | --- | --- |
| 0.0 | 10 requests in a burst | 10 | all allowed | 0 |
| 0.1 | 1 request | 0 + 0.1 × 2 = 0.2 | rejected, retry in 0.4 s | 0.2 |
| 0.5 | 1 request | 0.2 + 0.4 × 2 = 1.0 | allowed | 0 |
| 5.5 | 1 request | 0 + 5 × 2 = 10 (capped) | allowed | 9 |

**Edge cases.**

| Edge case | Handling |
| --- | --- |
| Clock moves backward | Use a monotonic clock |
| Millions of keys | Expire idle keys; store compact state |
| Store (Redis) unavailable | Fail open for general APIs, fail closed for login and payments |
| Users behind one office IP | Limit by user or API key, IP only for anonymous traffic |
| Expensive endpoints | Spend more tokens per request (cost-based limits) |

**Complexity.** O(1) time per request for both algorithms; memory O(active keys).

**Unit tests (deterministic time).**

```python
def test_token_bucket_burst_then_refill():
    lim = TokenBucketLimiter(rate=2, capacity=10)
    assert all(lim.allow("u1", now=0.0)[0] for _ in range(10))
    allowed, retry = lim.allow("u1", now=0.1)
    assert not allowed and abs(retry - 0.4) < 0.01
    assert lim.allow("u1", now=0.5)[0]

def test_sliding_window_counter_estimate():
    lim = SlidingWindowCounterLimiter(limit=100, window=60)
    for _ in range(80): lim.allow("k", now=10)        # previous window
    for _ in range(30): lim.allow("k", now=75)        # current window, 15 s in
    assert lim.allow("k", now=75)[0]                  # 30 + 80 × 45/60 = 90 < 100
```

**Follow-up dialogue.**

- *Interviewer: Ten servers each running your limiter allow ten times the limit. Fix it.* Move state to Redis and do read-compute-write atomically in a Lua script per request; alternatively give each server 1/10 of the limit if approximate limits are acceptable.
- *Interviewer: How do you rate-limit LLM usage fairly?* Count tokens rather than requests: each call spends its estimated input plus output tokens from the user's bucket, and the bucket refills per minute.
- *Interviewer: What should the client do on 429?* Wait for Retry-After with jitter, then retry; never retry immediately in a loop.

## Problem 7: Vending Machine

**Clarifying questions.** Payment by coins, notes, UPI or card? Return change? What if the item is out of stock or change cannot be made? Admin restocking?

**Agreed requirements.** Select a product; insert money; dispense the product and change; cancel and refund; handle out-of-stock and "exact change only" cases; admin restock.

### Why the State pattern fits

The same button means different things in different states: "Cancel" refunds money in HAS\_MONEY but does nothing in IDLE. Encoding the state explicitly removes tangled if-statements and illegal actions.

| State | Allowed actions | Next state |
| --- | --- | --- |
| IDLE | Select product | PRODUCT\_SELECTED (or stay if out of stock) |
| PRODUCT\_SELECTED | Insert money, cancel | HAS\_MONEY or IDLE |
| HAS\_MONEY | Insert more, cancel | DISPENSING when paid enough |
| DISPENSING | (automatic) | IDLE |

### Core code

```python
from enum import Enum

class State(Enum):
    IDLE = 1; SELECTED = 2; HAS_MONEY = 3

class VendingMachine:
    COINS = [100, 50, 20, 10, 5, 2, 1]                   # rupee denominations, largest first

    def __init__(self, products, coin_stock):
        self.products = products                         # code -> {"price": int, "qty": int}
        self.coin_stock = coin_stock                     # denomination -> count
        self.state, self.selected, self.paid = State.IDLE, None, 0

    def select(self, code):
        if self.state != State.IDLE:
            raise RuntimeError("finish or cancel the current purchase")
        if self.products.get(code, {}).get("qty", 0) == 0:
            raise RuntimeError("out of stock")
        self.selected, self.state = code, State.SELECTED

    def insert(self, amount):
        if self.state not in (State.SELECTED, State.HAS_MONEY):
            raise RuntimeError("select a product first")
        self.paid += amount
        self.coin_stock[amount] = self.coin_stock.get(amount, 0) + 1
        self.state = State.HAS_MONEY
        price = self.products[self.selected]["price"]
        if self.paid >= price:
            return self._dispense(self.paid - price)

    def _make_change(self, amount):
        change, stock = {}, dict(self.coin_stock)
        for c in self.COINS:
            n = min(amount // c, stock.get(c, 0))
            if n:
                change[c] = n; amount -= n * c; stock[c] -= n
        if amount:
            return None                                  # cannot make exact change
        return change

    def _dispense(self, change_due):
        change = self._make_change(change_due)
        if change is None:
            return self.cancel(reason="cannot make change")
        for c, n in change.items(): self.coin_stock[c] -= n
        self.products[self.selected]["qty"] -= 1
        item = self.selected
        self.state, self.selected, self.paid = State.IDLE, None, 0
        return {"item": item, "change": change}

    def cancel(self, reason="cancelled"):
        refund = self.paid                               # simplified: refund amount, not exact coins
        self.state, self.selected, self.paid = State.IDLE, None, 0
        return {"refund": refund, "reason": reason}
```

Worked: a ₹35 drink, the customer inserts ₹50. Change due ₹15 → greedy gives one ₹10 and one ₹5 if those coins are in stock; if the machine has no ₹5 or ₹1 coins, it cannot make ₹15 and refunds instead of keeping the money. Greedy change is optimal for standard coin systems like rupees; for unusual denominations use dynamic programming.

### Follow-ups

| New requirement | Change |
| --- | --- |
| UPI or card payment | New payment method behind an interface; the state machine waits for a payment-confirmed event |
| Multiple items per purchase | Cart object in the SELECTED state |
| Remote monitoring | Observer publishes stock and fault events |
| Hardware fault while dispensing | Fault state; refund and alert |

**Common mistakes.** Boolean flags instead of explicit states; dispensing before confirming change is possible; not handling cancel in every state.

### Detailed answer walkthrough: vending machine

**What to say first.** "The machine's behavior depends on where it is in a purchase, so I'll model it as a state machine. Inventory and coin stock are separate concerns. Before dispensing, I'll prove I can return exact change; otherwise I refund."

**Design decisions and why.**

1. Explicit states (IDLE, SELECTED, HAS\_MONEY) instead of booleans like `has_money` and `is_selected`, which allow impossible combinations.
2. Change is computed on a copy of the coin stock first; coins are only removed if exact change is possible. This avoids a half-dispensed state.
3. Inventory and coin stock are plain data the state machine reads, so restocking does not interact with purchase logic.
4. Payment methods (coins, UPI, card) can sit behind one interface that reports "amount received", so the state machine does not care how money arrived.
5. Rejected alternative: one big `if` chain in each button handler, which grows with every new state and hides illegal transitions.

**Main flow, step by step (₹35 drink, ₹50 note).**

1. IDLE → `select("A1")`: product exists and quantity > 0 → SELECTED.
2. `insert(50)`: paid = 50; coin stock records the note → HAS\_MONEY.
3. Paid ≥ price: change due = 15.
4. Greedy change on a copy of stock: 10 + 5 → possible.
5. Remove those coins from stock, decrement A1, dispense, reset to IDLE.

If the machine had no ₹5, ₹2 or ₹1 coins, step 4 fails and the machine refunds ₹50 instead of keeping the customer's money.

**Edge cases.**

| Edge case | Handling |
| --- | --- |
| Cancel before paying enough | Refund what was inserted; back to IDLE |
| Select while a purchase is in progress | Reject until finished or cancelled |
| Product sells out between selection and payment (two-screen machines) | Re-check quantity before dispensing; refund if gone |
| Coin jam or dispense motor failure | FAULT state, refund, alert operator |
| Power loss mid-transaction | Persist the transaction state; on restart, refund pending payments |

**Complexity.** Making change is O(d) for d denominations with the greedy method; everything else is O(1).

**Unit tests.**

```python
def test_dispenses_with_change():
    vm = VendingMachine({"A1": {"price": 35, "qty": 2}}, {10: 5, 5: 5})
    vm.select("A1")
    result = vm.insert(50)
    assert result == {"item": "A1", "change": {10: 1, 5: 1}}

def test_refunds_when_change_impossible():
    vm = VendingMachine({"A1": {"price": 35, "qty": 2}}, {})
    vm.select("A1")
    assert vm.insert(50)["refund"] == 50 and vm.state == State.IDLE

def test_cannot_insert_before_selecting():
    vm = VendingMachine({"A1": {"price": 35, "qty": 2}}, {})
    try:
        vm.insert(10); assert False
    except RuntimeError:
        pass
```

Note for the second test: the inserted ₹50 note itself is in the coin stock, but it cannot make ₹15 of change, so the machine refunds.

**Follow-up dialogue.**

- *Interviewer: Add UPI.* The machine shows a QR code for the price in the SELECTED state and waits for a payment-confirmed event from the payment service (with a timeout back to IDLE). The rest of the state machine is unchanged.
- *Interviewer: The owner wants alerts when stock is low.* Publish an event when quantity drops below a threshold (Observer); a remote service notifies the owner.
- *Interviewer: Why not always give change greedily?* For standard coin systems like the rupee's, greedy is optimal; for unusual denominations (for example 1, 3, 4 making 6) greedy gives 4 + 1 + 1 instead of 3 + 3, so use dynamic programming.

## Problem 8: Tic-Tac-Toe and Snake and Ladder

Board games test clean modeling, turn management and an efficient rule check. Interviewers often ask for an N × N board and a winner check better than scanning the whole board.

### Tic-tac-toe: O(1) winner check

Keep a running sum per row, column and both diagonals: player X adds +1, player O adds −1. A player wins when any sum reaches +N or −N. Each move updates at most four counters, so the check is O(1) instead of O(N²).

```python
class TicTacToe:
    def __init__(self, n=3):
        self.n, self.rows, self.cols = n, [0] * n, [0] * n
        self.diag = self.anti = 0
        self.board = [[None] * n for _ in range(n)]
        self.moves = 0

    def move(self, r, c, player):                    # player is "X" or "O"
        if not (0 <= r < self.n and 0 <= c < self.n) or self.board[r][c]:
            raise ValueError("invalid move")
        self.board[r][c] = player
        v = 1 if player == "X" else -1
        self.rows[r] += v; self.cols[c] += v
        if r == c: self.diag += v
        if r + c == self.n - 1: self.anti += v
        self.moves += 1
        if self.n in (abs(self.rows[r]), abs(self.cols[c]), abs(self.diag), abs(self.anti)):
            return player                            # winner
        return "DRAW" if self.moves == self.n * self.n else None
```

Worked: X plays (0,0), (1,1), (2,2) on a 3 × 3 board; the main diagonal sum becomes 3, so X wins on the third move without scanning the board.

### Snake and ladder: entities

| Entity | Responsibility | Pattern |
| --- | --- | --- |
| Board | Size and jumps (snake heads and ladder bottoms map to destinations) | Simple map |
| Dice | Roll value | Strategy (fair, loaded for tests, two dice) |
| Player | Name and position | Entity |
| Game | Turn order, moves, winner | Facade; queue for turns |

```python
from collections import deque
import random

class Game:
    def __init__(self, players, jumps, size=100, dice=lambda: random.randint(1, 6)):
        self.turns = deque(players)
        self.pos = {p: 0 for p in players}
        self.jumps, self.size, self.dice = jumps, size, dice

    def play_turn(self):
        player = self.turns.popleft()
        roll = self.dice()
        target = self.pos[player] + roll
        if target <= self.size:                       # overshooting 100 wastes the turn
            target = self.jumps.get(target, target)   # snake or ladder
            self.pos[player] = target
        if self.pos[player] == self.size:
            return player                             # winner
        self.turns.append(player)
        return None

game = Game(["Asha", "Ravi"], jumps={4: 25, 21: 39, 43: 76, 27: 5, 54: 31, 99: 41})
```

Worked: Asha at 18 rolls 3 → 21, a ladder to 39. Ravi at 24 rolls 3 → 27, a snake down to 5.

Testing tip: inject a deterministic dice function so tests are reproducible.

**Follow-ups.** More players (the queue handles it), bonus turn on rolling 6, special cells, multiple boards, saving and resuming games. **Common mistakes.** Board logic inside the player class; hard-coded randomness that makes testing impossible; checking the whole board for a win.

### Detailed answer walkthrough: tic-tac-toe and snake and ladder

**What to say first.** "I'll separate the board, the players and the game controller. For tic-tac-toe I'll avoid scanning the board after every move by keeping running sums per line. For snake and ladder, jumps are a map and turns are a queue, and I'll inject the dice so the game is testable."

**Design decisions and why.**

1. Game state lives in a Game class; Player is a small entity; rules sit in the game, not in players.
2. Running line sums make the winner check O(1) per move instead of O(N²); this is the insight interviewers look for on N × N boards.
3. A turn queue (deque) handles any number of players and makes "extra turn on six" a one-line change (append the player to the front instead of the back).
4. Dice is injected as a function or strategy: tests use fixed sequences; production uses random rolls.
5. Snakes and ladders are both just jumps (from → to), so one map handles both.

**Edge cases.**

| Edge case | Handling |
| --- | --- |
| Move on an occupied or out-of-range cell | Reject with an error |
| Move after the game is over | Track the result and reject further moves (add a `finished` flag) |
| Same player moving twice | Track whose turn it is; reject out-of-turn moves |
| Overshooting 100 in snake and ladder | Stay in place (or bounce back, by house rule) |
| A jump that lands on another jump's start | Decide the rule (usually no chaining); validate the board at setup |
| Board with a cycle of jumps | Validate at setup and reject |

**Complexity.** Tic-tac-toe moves are O(1); memory O(N) for line sums plus O(N²) for the board display. Snake and ladder turns are O(1).

**Unit tests.**

```python
def test_diagonal_win_detected_in_constant_time():
    g = TicTacToe(3)
    g.move(0, 0, "X"); g.move(0, 1, "O"); g.move(1, 1, "X"); g.move(0, 2, "O")
    assert g.move(2, 2, "X") == "X"

def test_ladder_and_snake_with_fixed_dice():
    rolls = iter([3, 3])
    game = Game(["Asha", "Ravi"], jumps={3: 22, 25: 5}, dice=lambda: next(rolls))
    game.pos["Ravi"] = 22
    game.play_turn()                       # Asha 0 → 3 → ladder to 22
    game.play_turn()                       # Ravi 22 → 25 → snake to 5
    assert game.pos == {"Asha": 22, "Ravi": 5}
```

**Follow-up dialogue.**

- *Interviewer: Add undo.* Store each move as a Command with an `undo` that reverses the board cell and the line sums; keep a history stack.
- *Interviewer: Add a computer player.* A `Player` with a move strategy: random, rule-based, or minimax for tic-tac-toe; the game loop calls `player.next_move(board)` without knowing which.
- *Interviewer: Play online between two phones.* The game state moves to a server; clients send moves; the server validates turn order and broadcasts the new state over WebSockets.

## Problem 9: In-Memory Key-Value Store with TTL

**Clarifying questions.** Operations needed (get, set, delete)? Expiry per key? Transactions (begin, commit, rollback)? Thread-safe? Persistence across restarts? Memory limit and eviction?

**Agreed requirements.** `set(key, value, ttl=None)`, `get`, `delete`; keys expire after their TTL; nested transactions with rollback; thread-safe.

### Design decisions

| Concern | Choice | Why |
| --- | --- | --- |
| Storage | Dictionary key → (value, expiry) | O(1) operations |
| Expiry | Lazy (check on read) + active sweep using a min-heap of expiries | Lazy alone leaks memory for keys never read again |
| Transactions | Stack of change logs (old values) | Rollback restores previous values; nesting is natural |
| Concurrency | One lock (or sharded locks) | Simple correctness first |

```python
import heapq, threading, time

_MISSING = object()

class KVStore:
    def __init__(self):
        self.data, self.expiry_heap = {}, []          # key -> (value, expires_at or None)
        self.tx_stack, self.lock = [], threading.RLock()

    def _alive(self, key, now):
        item = self.data.get(key)
        if item and item[1] is not None and item[1] <= now:
            del self.data[key]                        # lazy expiry
            return None
        return item

    def _record(self, key):
        if self.tx_stack and key not in self.tx_stack[-1]:
            self.tx_stack[-1][key] = self.data.get(key, _MISSING)   # remember old value once

    def set(self, key, value, ttl=None):
        with self.lock:
            self._record(key)
            expires = time.time() + ttl if ttl else None
            self.data[key] = (value, expires)
            if expires:
                heapq.heappush(self.expiry_heap, (expires, key))

    def get(self, key):
        with self.lock:
            item = self._alive(key, time.time())
            return item[0] if item else None

    def delete(self, key):
        with self.lock:
            self._record(key)
            self.data.pop(key, None)

    def begin(self):
        with self.lock: self.tx_stack.append({})

    def rollback(self):
        with self.lock:
            changes = self.tx_stack.pop()
            for key, old in changes.items():
                if old is _MISSING: self.data.pop(key, None)
                else: self.data[key] = old

    def commit(self):
        with self.lock:
            changes = self.tx_stack.pop()
            if self.tx_stack:                         # merge into the parent transaction
                for k, old in changes.items():
                    self.tx_stack[-1].setdefault(k, old)

    def sweep(self, max_items=100):                   # run periodically in a background thread
        now = time.time()
        with self.lock:
            while self.expiry_heap and self.expiry_heap[0][0] <= now and max_items:
                _, key = heapq.heappop(self.expiry_heap)
                self._alive(key, now); max_items -= 1
```

Worked: `set("otp:98", "482910", ttl=300)`; a `get` 200 s later returns the code; at 301 s it returns None and the key is removed. In a transaction: begin → set a=1 → begin → set a=2 → rollback (a back to 1) → commit (a stays 1).

### Follow-ups

| New requirement | Change |
| --- | --- |
| Persistence | Append-only log of writes replayed at startup; periodic snapshots |
| Memory limit | LRU eviction (Problem 5) |
| Higher concurrency | Shard keys across N stores with separate locks |
| Pub/sub on key changes | Observer callbacks per key prefix |
| Distribution | Consistent hashing and replication (Chapters 12-13) |

**Common mistakes.** Only lazy expiry (memory leak); transactions that copy the whole store; heap entries for keys that were re-set with a new TTL not ignored (check the current expiry before deleting).

### Detailed answer walkthrough: key-value store with TTL

**What to say first.** "A dictionary gives O(1) get and set. TTL needs two mechanisms: lazy expiry on reads for correctness, and an active sweep for memory. Transactions are a stack of undo logs, which makes nesting natural."

**Design decisions and why.**

1. Store (value, expires\_at) together, so a read can decide expiry without another lookup.
2. Lazy expiry alone is correct but leaks memory for keys nobody reads again; a min-heap ordered by expiry lets a sweeper find expired keys cheaply.
3. Heap entries can be stale (a key re-set with a new TTL); the sweeper re-checks the current expiry before deleting, so stale entries are harmless.
4. Transactions record each key's old value the first time it changes inside that transaction (an undo log). Rollback restores; commit merges the log into the parent so an outer rollback can still undo inner changes.
5. A re-entrant lock lets public methods call each other safely.
6. Rejected alternative: copying the whole store on `begin`, which costs O(n) memory and time per transaction.

**Transactions, worked.**

| Step | Operation | Store | Undo logs |
| --- | --- | --- | --- |
| 1 | set a = 1 | a=1 | none |
| 2 | begin | a=1 | \[{}\] |
| 3 | set a = 2 | a=2 | \[{a: 1}\] |
| 4 | begin | a=2 | \[{a: 1}, {}\] |
| 5 | set a = 3; set b = 9 | a=3, b=9 | \[{a: 1}, {a: 2, b: missing}\] |
| 6 | rollback | a=2 (b removed) | \[{a: 1}\] |
| 7 | commit | a=2 | \[\] |

**Edge cases.**

| Edge case | Handling |
| --- | --- |
| TTL of zero or negative | Reject, or treat as immediately expired |
| Re-setting a key without TTL | Clears the expiry (stale heap entry ignored) |
| rollback or commit with no open transaction | Raise a clear error |
| Expired key inside a transaction | Expiry still applies; rollback restores the old value with its old expiry |
| Huge number of keys expiring at once | Sweep in bounded batches so other requests are not blocked |

**Complexity.** get, set and delete are O(1) on average (set with TTL is O(log n) for the heap push). Rollback is O(changes in that transaction).

**Unit tests.**

```python
import time

def test_ttl_expires():
    kv = KVStore()
    kv.set("otp", "482910", ttl=0.05)
    assert kv.get("otp") == "482910"
    time.sleep(0.06)
    assert kv.get("otp") is None

def test_nested_transactions():
    kv = KVStore()
    kv.set("a", 1)
    kv.begin(); kv.set("a", 2)
    kv.begin(); kv.set("a", 3); kv.set("b", 9)
    kv.rollback()
    assert kv.get("a") == 2 and kv.get("b") is None
    kv.commit()
    assert kv.get("a") == 2
```

**Follow-up dialogue.**

- *Interviewer: Survive restarts.* Append every write to a log file before applying it; replay the log at startup; periodically write a snapshot and truncate the log.
- *Interviewer: Memory is capped at 1 GB.* Track approximate size and evict with LRU (Problem 5), preferring keys that already have a TTL.
- *Interviewer: Many threads, one lock is slow.* Shard keys into N stores by hash, each with its own lock; transactions spanning shards then need a coordinator, so keep them single-shard or lock shards in a fixed order.

## Problem 10: Meeting Room Scheduler

**Clarifying questions.** Book a specific room, or any free room that fits? Room capacity and equipment? Recurring meetings? Time zones? Cancellations and notifications?

**Agreed requirements.** Rooms with capacity; book a room for \[start, end); reject overlaps; find any free room with enough capacity; cancel; safe when two people book the same slot at once.

### The key rule: interval overlap

Two half-open intervals \[s1, e1) and \[s2, e2) overlap exactly when s1 < e2 and s2 < e1. A meeting 10:00-11:00 and one 11:00-12:00 do not overlap; 10:00-11:00 and 10:30-11:30 do.

### Core code

```python
import bisect, threading, uuid
from dataclasses import dataclass

@dataclass
class Room:
    id: str
    capacity: int

class RoomCalendar:
    def __init__(self): self.starts, self.bookings, self.lock = [], [], threading.Lock()
    def is_free(self, start, end):
        i = bisect.bisect_left(self.starts, start)
        if i > 0 and self.bookings[i - 1][1] > start:    # previous booking runs past our start
            return False
        if i < len(self.starts) and self.starts[i] < end:  # next booking starts before our end
            return False
        return True
    def add(self, start, end, booking_id):
        i = bisect.bisect_left(self.starts, start)
        self.starts.insert(i, start); self.bookings.insert(i, (start, end, booking_id))

class Scheduler:
    def __init__(self, rooms):
        self.rooms = {r.id: r for r in rooms}
        self.calendars = {r.id: RoomCalendar() for r in rooms}

    def book(self, room_id, start, end):
        if start >= end:
            raise ValueError("end must be after start")
        cal = self.calendars[room_id]
        with cal.lock:                                   # per-room lock: other rooms unaffected
            if not cal.is_free(start, end):
                raise ValueError("slot taken")
            booking_id = str(uuid.uuid4())
            cal.add(start, end, booking_id)
            return booking_id

    def book_any(self, start, end, attendees):
        for room in sorted(self.rooms.values(), key=lambda r: r.capacity):   # smallest room that fits
            if room.capacity >= attendees:
                try:
                    return room.id, self.book(room.id, start, end)
                except ValueError:
                    continue
        raise ValueError("no room available")
```

The lists stay sorted by start time, so each check is a binary search: O(log n) per room, with insertion O(n) (fine for daily calendars; use a balanced tree or interval tree for very large ones).

Worked: room "Cubbon" (capacity 6) has 10:00-11:00. A request for 10:30-11:30 finds the previous booking ends at 11:00 > 10:30, so it is rejected; 11:00-12:00 is accepted. `book_any` for 4 people tries the smallest suitable room first, saving large rooms for large meetings.

### Production version

In a database, PostgreSQL can enforce no overlaps per room with an exclusion constraint on a time range (`EXCLUDE USING gist (room_id WITH =, during WITH &&)`), so two concurrent inserts cannot both succeed, regardless of application bugs.

### Follow-ups

| New requirement | Change |
| --- | --- |
| Recurring meetings | Store a rule; expand occurrences for a window; check each for conflicts |
| Time zones | Store UTC; convert for display |
| Minimum number of rooms for a set of meetings | Sort starts and ends, sweep with a counter (or a min-heap of end times) |
| Notifications | Observer sends invites and reminders |

**Common mistakes.** Treating back-to-back meetings as overlapping (closed intervals); scanning every booking for each request; one global lock for all rooms; storing local times.

### Detailed answer walkthrough: meeting room scheduler

**What to say first.** "The core is the overlap rule for half-open intervals: \[s1, e1) and \[s2, e2) overlap when s1 < e2 and s2 < e1. Each room keeps bookings sorted by start, so checking a new booking only compares its two neighbors, found by binary search. Each room has its own lock."

**Design decisions and why.**

1. Half-open intervals, so a meeting ending at 11:00 and one starting at 11:00 do not conflict.
2. Bookings sorted per room: with non-overlapping bookings, a new interval can only clash with the booking just before it or just after it, so two comparisons suffice after a binary search.
3. Per-room locks, so bookings in different rooms never wait on each other.
4. `book_any` tries the smallest room that fits first, keeping big rooms free for big meetings (a best-fit policy you could swap via Strategy).
5. Times stored in UTC; display converts to each attendee's time zone.
6. Rejected alternative: scanning every booking for each request (O(n)) or a global lock (one booking at a time across the office).

**Overlap check, worked.** Room bookings: \[09:00, 10:00), \[11:00, 12:00). A request for \[10:00, 11:00):

1. Binary search for 10:00 among starts \[09:00, 11:00\] gives index 1.
2. Previous booking ends 10:00, which is not after 10:00 → no clash.
3. Next booking starts 11:00, which is not before 11:00 → no clash.
4. Accepted: it fits exactly in the gap.

A request for \[10:30, 11:30) clashes with the next booking (starts 11:00 < 11:30) and is rejected.

**Edge cases.**

| Edge case | Handling |
| --- | --- |
| End before or equal to start | Reject |
| Back-to-back meetings | Allowed by half-open intervals |
| Booking across midnight or days | Works with full timestamps |
| Room removed or under maintenance | Mark unavailable; reject or reassign existing bookings |
| Two people book the same slot at once | Per-room lock (or a database exclusion constraint) lets only one succeed |
| Recurring meeting with one conflicting week | Report the conflicting dates; book the rest or none, per user choice |

**Complexity.** Checking is O(log n) per room; inserting into a Python list is O(n) because of shifting, which is fine for daily calendars; a balanced tree makes insertion O(log n). `book_any` is O(R log n) for R rooms.

**Unit tests.**

```python
from datetime import datetime as dt

def t(h, m=0): return dt(2026, 10, 6, h, m)

def test_back_to_back_allowed_overlap_rejected():
    s = Scheduler([Room("cubbon", 6)])
    s.book("cubbon", t(9), t(10))
    s.book("cubbon", t(10), t(11))                       # back-to-back is fine
    try:
        s.book("cubbon", t(10, 30), t(11, 30)); assert False
    except ValueError:
        pass

def test_book_any_prefers_smallest_room():
    s = Scheduler([Room("big", 20), Room("small", 4)])
    room, _ = s.book_any(t(14), t(15), attendees=3)
    assert room == "small"
```

**Follow-up dialogue.**

- *Interviewer: What is the minimum number of rooms needed for a day's meetings?* Sort all start and end times; sweep through them, adding one at each start and subtracting one at each end (process ends before starts at the same time); the peak count is the answer.
- *Interviewer: Store this in a database safely.* Use a range column per booking and an exclusion constraint per room so the database rejects overlaps even under concurrent inserts.
- *Interviewer: Suggest the next free slot for five people.* For each suitable room, walk the sorted bookings and return the first gap at least as long as the meeting, then pick the earliest across rooms.

## Quick Reference: 15 More LLD Problems

Use the same six-step approach; the table gives the insight interviewers usually look for in each.

| Problem | Key insight | Patterns |
| --- | --- | --- |
| Library management | Separate a book (title) from its physical copies; loans with due dates and fines | Repository, Strategy for fines, Observer for due reminders |
| Hotel booking | Room inventory per date; holds with expiry; overlap checks like Problem 10 | State, Strategy for pricing |
| Car rental | Vehicle availability over date ranges; pickup and drop locations | State, Strategy, Factory |
| ATM | Card and PIN authentication, cash dispensing by denomination, atomic debit | State, Chain of Responsibility for note dispensing |
| Chess | Piece movement rules per piece type; move validation; check and checkmate | Strategy or polymorphism per piece, Command for move history and undo |
| Logger framework | Levels, formatters and multiple outputs; asynchronous writing | Chain of Responsibility, Singleton (or injected), Strategy |
| Notification service | Channels, templates, preferences, retries | Strategy, Factory, Observer, Bridge |
| Pub/sub message queue | Topics, subscribers, offsets per consumer, delivery guarantees | Observer, Iterator |
| Live cricket score (Cricbuzz-style) | Ball-by-ball events update match state; many viewers | Observer, State, Command for events |
| Stack Overflow | Questions, answers, votes, reputation rules, tags | Strategy for reputation, Observer |
| Food delivery (Swiggy-style) | Order state machine, rider assignment, pricing | State, Strategy, Observer (see Case Studies tab) |
| Ride-hailing (Uber-style) | Trip state machine, atomic driver claim, fare strategy | State, Strategy (main book, Chapter 23) |
| Shopping cart and inventory | Server-side price recompute, stock reservations, coupons | Strategy, State, Decorator for pricing rules |
| Job scheduler | Delayed and recurring jobs, workers, retries, idempotency | Command, Strategy, priority queue |
| In-memory file system | Directories and files as a tree; path resolution | Composite, Iterator |

### Final checklist for any LLD answer

- Requirements clarified and written down
- Entities with single responsibilities
- Variation behind interfaces (Strategy, Factory)
- Lifecycles as explicit state machines
- Concurrency handled on shared state
- Money as integers, times in UTC
- Working code for the main flow
- Extensions explained without rewrites
