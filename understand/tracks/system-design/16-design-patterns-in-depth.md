# Design Patterns in Depth

**Topic:** System design
**Covers:** SOLID Principles in Depth; Creational Patterns; Structural Patterns; Behavioral Patterns, Part 1; Behavioral Patterns, Part 2; Distributed Resilience Patterns; Distributed Data and Integration Patterns; Choosing Patterns, Anti-Patterns and Interview Questions
**Source:** [Claude artifact](https://claude.ai/artifact/7xxGdVxPGbUiPY13z4MdZ2) — written by a colleague, mirrored here for study.

Design patterns are named, proven solutions to problems that recur in software. This tab expands Chapter 23 of the main book in two parts: the classic object-oriented patterns used in low-level design, and the distributed-system patterns used in high-level design. Every pattern is taught the same way: the problem, the solution, a worked example with code, when to use it and when not to, and the pitfalls.

## SOLID Principles in Depth

SOLID is five principles for code that is easy to change: Single responsibility, Open/closed, Liskov substitution, Interface segregation and Dependency inversion. They are the reasons behind most design patterns: patterns are how you apply SOLID in practice.

> *Diagram in the original artifact: SOLID principles mapped to the patterns that apply them*

### S: Single Responsibility Principle

**Definition.** A class (or module, or service) should have one reason to change: it serves one actor or one responsibility.

**Smell.** A class named `OrderManager` or `Utils` that grows every sprint; changes for the finance team break the notifications team's feature.

```python
# Before: four reasons to change in one class
class OrderService:
    def place(self, cart):
        total = sum(i.price for i in cart.items) * 1.05                 # pricing rules (finance)
        db.execute("INSERT INTO orders ...", (cart.user_id, total))     # storage (platform)
        smtp.send(cart.email, f"Order placed: ₹{total/100}")           # messaging (growth)
        pdf.render_invoice(cart, total)                                # invoices (finance)
```

```python
# After: each class has one reason to change
class PriceCalculator:
    def total(self, cart) -> int: ...

class OrderRepository:
    def save(self, order) -> None: ...

class OrderNotifier:
    def order_placed(self, order) -> None: ...

class OrderService:                       # coordinates, owns no details
    def __init__(self, pricing, repo, notifier):
        self.pricing, self.repo, self.notifier = pricing, repo, notifier
    def place(self, cart):
        order = Order(cart, self.pricing.total(cart))
        self.repo.save(order)
        self.notifier.order_placed(order)
        return order
```

**Benefit.** Smaller tests, fewer merge conflicts, safer changes. **Overdoing it.** Splitting into dozens of one-line classes makes code hard to follow; split along real reasons to change, not every function.

### O: Open/Closed Principle

**Definition.** Code should be open for extension but closed for modification: add new behavior by adding code, not by editing tested code.

**Smell.** Every new discount type means editing the same `if/elif` block.

```python
# Before
def discount(order, kind):
    if kind == "flat":   return 5_000
    elif kind == "pct":  return order.total * 20 // 100
    elif kind == "bogo": return cheapest_item(order).price
    # every new campaign edits this function
```

```python
# After: new discounts are new classes registered by name
class Discount:
    def amount(self, order) -> int: ...

class Flat(Discount):
    def __init__(self, paise): self.paise = paise
    def amount(self, order): return min(self.paise, order.total)

class Percent(Discount):
    def __init__(self, pct, cap): self.pct, self.cap = pct, cap
    def amount(self, order): return min(order.total * self.pct // 100, self.cap)

DISCOUNTS = {"FLAT50": Flat(5_000), "SAVE20": Percent(20, 10_000)}
```

Worked: on a ₹600 order (60,000 paise), SAVE20 gives min(12,000, 10,000) = 10,000 paise (₹100, capped).

**Overdoing it.** Building extension points for variations that never come; wait for the second or third case.

### L: Liskov Substitution Principle

**Definition.** Anywhere code uses a base type, any subtype must work correctly without the caller knowing which one it got. Subtypes must not demand more (stronger preconditions) or promise less (weaker results).

**Smell.** Code full of `isinstance` checks, or subclasses that raise "not supported".

```python
# Before: cash-on-delivery breaks the promise that every payment can be refunded
class Payment:
    def refund(self, amount): ...

class CashOnDelivery(Payment):
    def refund(self, amount):
        raise NotImplementedError("cannot refund cash online")   # surprises callers

def cancel_order(order):
    order.payment.refund(order.total)   # crashes for COD orders
```

```python
# After: only promise what every subtype can do
class Payment: ...
class RefundablePayment(Payment):
    def refund(self, amount): ...

class CardPayment(RefundablePayment): ...
class UpiPayment(RefundablePayment): ...
class CashOnDelivery(Payment): ...     # no refund method to break

def cancel_order(order):
    if isinstance(order.payment, RefundablePayment):
        order.payment.refund(order.total)
    else:
        wallet.credit(order.user_id, order.total)   # explicit alternative
```

At service level, Liskov means a new API version must keep the old contract: same fields, same meanings, no new required inputs.

### I: Interface Segregation Principle

**Definition.** Clients should not be forced to depend on methods they do not use. Prefer several small, focused interfaces to one large one.

**Smell.** Implementations full of empty methods or `pass`.

```python
# Before: cloud kitchens have no tables, but must implement table booking
class Restaurant:
    def accept_order(self, order): ...
    def update_menu(self, menu): ...
    def book_table(self, slot): ...

# After: small interfaces combined as needed
class OrderTaker:
    def accept_order(self, order): ...
class MenuOwner:
    def update_menu(self, menu): ...
class TableBooker:
    def book_table(self, slot): ...

class CloudKitchen(OrderTaker, MenuOwner): ...
class DineInRestaurant(OrderTaker, MenuOwner, TableBooker): ...
```

At system level, the same idea gives client-specific APIs (backends for frontends) instead of one huge API every client must understand.

### D: Dependency Inversion Principle

**Definition.** High-level policy should not depend on low-level details; both should depend on abstractions. In practice: depend on interfaces and receive implementations from outside (dependency injection).

**Smell.** Business logic that creates its own database client or HTTP client, so it cannot be tested without real infrastructure.

```python
# Before: hard-wired to MySQL and a real SMS vendor
class OtpService:
    def __init__(self):
        self.store = MySqlStore("prod-db:3306")
        self.sms = VendorXSms(api_key="...")
```

```python
# After: depends on abstractions, receives implementations
class OtpStore:
    def save(self, phone, code, ttl): ...
class SmsSender:
    def send(self, phone, text): ...

class OtpService:
    def __init__(self, store: OtpStore, sms: SmsSender):
        self.store, self.sms = store, sms
    def send_otp(self, phone):
        code = f"{secrets.randbelow(10**6):06d}"
        self.store.save(phone, code, ttl=300)
        self.sms.send(phone, f"Your OTP is {code}")

# production: OtpService(RedisOtpStore(redis), VendorXAdapter(client))
# tests:      OtpService(InMemoryOtpStore(), FakeSms())
```

**Benefit.** Swap vendors, databases or test fakes without touching business logic. **Overdoing it.** Interfaces for everything, including classes that will only ever have one implementation and need no fake.

### SOLID beyond classes: services and architecture

| Principle | In a microservice architecture |
| --- | --- |
| Single responsibility | One service per business capability, owning its data |
| Open/closed | New consumers subscribe to events instead of changing the producer |
| Liskov substitution | New API versions honor old contracts; contract tests enforce it |
| Interface segregation | Small, client-specific APIs and BFFs instead of one giant API |
| Dependency inversion | Services depend on contracts (APIs, schemas, queues), not on each other's internals |

### Related principles

| Principle | Meaning | Watch out for |
| --- | --- | --- |
| DRY (don't repeat yourself) | One authoritative place for each piece of knowledge | Merging code that only looks similar but changes for different reasons |
| KISS (keep it simple) | Prefer the simplest design that works | Simplicity that ignores real requirements |
| YAGNI (you aren't gonna need it) | Do not build for imagined futures | Skipping cheap preparation for near-certain needs (security, idempotency) |
| Composition over inheritance | Build behavior by combining objects | Inheritance is fine for true "is-a" relationships |
| Law of Demeter | Talk to direct collaborators, not their internals (`order.customer.address.city`) | Wrapper methods everywhere just to hide a chain |
| Separation of concerns | Keep different concerns (UI, business rules, storage) apart | Over-layering small apps |

### Interview questions

1. Give an example of an Open/Closed violation and its fix. A pricing `if/elif` edited for every rule; fix with Strategy classes chosen from a registry.
2. How does Dependency Inversion help testing? Business logic receives interfaces, so tests pass in-memory fakes instead of real databases and vendors.
3. Is raising "not supported" in a subclass a problem? Yes, it violates Liskov substitution; restructure the hierarchy so subtypes only promise what they can do.
4. Single Responsibility versus Interface Segregation? SRP is about why a class changes; ISP is about what clients are forced to depend on.
5. Can SOLID be overdone? Yes: excessive interfaces and tiny classes add indirection; apply principles where change actually happens.

## Part A1: Creational Patterns

Creational patterns control how objects are created, so calling code does not depend on concrete classes or complicated construction steps.

### Singleton

**Problem.** Some things must exist exactly once per process: a configuration object, a connection pool, a metrics registry. Creating several wastes resources or causes conflicts.

**Solution.** Create one instance lazily and hand out the same instance everywhere.

```python
import threading

class ConnectionPool:
    _instance = None
    _lock = threading.Lock()

    @classmethod
    def get(cls):
        if cls._instance is None:
            with cls._lock:                      # thread-safe first creation
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance
```

| Use when | Avoid when |
| --- | --- |
| A shared resource that truly must be unique per process | You only want convenient global access (pass dependencies instead) |

**Pitfalls.** Hidden global state makes testing hard (tests cannot swap the instance); unsafe lazy creation causes races; "one per process" is not "one per system" when you run 50 servers. Prefer dependency injection: create one instance at startup and pass it in.

### Factory Method

**Problem.** Code needs to create a family member (a payment processor for card, UPI or wallet) but should not hard-code which class.

**Solution.** A creation method decides the concrete class from input or configuration.

```python
class PaymentProcessor:
    def charge(self, amount_paise: int) -> str: ...

class CardProcessor(PaymentProcessor):
    def charge(self, amount_paise): return f"card charged {amount_paise}"

class UpiProcessor(PaymentProcessor):
    def charge(self, amount_paise): return f"upi collect {amount_paise}"

PROCESSORS = {"card": CardProcessor, "upi": UpiProcessor}

def processor_for(method: str) -> PaymentProcessor:
    try:
        return PROCESSORS[method]()
    except KeyError:
        raise ValueError(f"unsupported method {method}")

print(processor_for("upi").charge(45_000))
```

Adding wallets means adding a class and one registry line; callers do not change (open/closed principle).

| Use when | Avoid when |
| --- | --- |
| Several interchangeable implementations chosen at runtime | Only one implementation exists |

**Pitfalls.** A giant if-else factory that every team edits; prefer a registry. Silent fallbacks to a default class hide configuration errors.

### Abstract Factory

**Problem.** You need consistent families of objects that must match, such as all components for the "production" environment (real payment gateway, real SMS sender) versus "sandbox" (fake gateway, fake SMS).

**Solution.** One factory interface with a method per product; each concrete factory builds a matching family.

```python
class ProdFactory:
    def payments(self): return RealGateway()
    def sms(self): return RealSmsProvider()

class SandboxFactory:
    def payments(self): return FakeGateway()
    def sms(self): return FakeSmsProvider()

factory = SandboxFactory() if settings.sandbox else ProdFactory()
checkout = Checkout(factory.payments(), factory.sms())
```

**Pitfalls.** Adding a new product type means changing every factory; it is heavy for small systems.

### Builder

**Problem.** Objects with many optional parts (an HTTP request, a search query, a notification) lead to constructors with ten parameters that are easy to misuse.

**Solution.** Build step by step with named methods, validate at the end.

```python
class SearchQuery:
    def __init__(self): self.filters, self.sort, self.limit = {}, "relevance", 20

class SearchQueryBuilder:
    def __init__(self): self.q = SearchQuery()
    def cuisine(self, c): self.q.filters["cuisine"] = c; return self
    def veg_only(self): self.q.filters["veg"] = True; return self
    def sort_by(self, s): self.q.sort = s; return self
    def limit(self, n):
        if not 1 <= n <= 100: raise ValueError("limit 1-100")
        self.q.limit = n; return self
    def build(self): return self.q

q = SearchQueryBuilder().cuisine("south_indian").veg_only().sort_by("rating").limit(10).build()
```

**Pitfalls.** Builders for simple objects add noise; in Python, keyword arguments with defaults (or dataclasses) often suffice.

### Prototype

**Problem.** Creating an object from scratch is expensive or complex (a fully configured test order, a game unit), and you need many similar copies.

**Solution.** Clone a prepared template and change only what differs.

```python
import copy
template_order = Order(city="Bengaluru", items=[Item("Masala Dosa", 12_000)], coupon=None)
order2 = copy.deepcopy(template_order)
order2.items.append(Item("Filter Coffee", 4_000))
```

**Pitfalls.** Shallow copies share nested lists and objects, so changing one copy changes the template; use deep copies or immutable data.

### Creational patterns at a glance

| Pattern | One-line purpose | Typical system-design use |
| --- | --- | --- |
| Singleton | One instance per process | Connection pools, config, metrics registry |
| Factory Method | Choose a class at runtime | Payment methods, storage backends, notification channels |
| Abstract Factory | Consistent families of objects | Production vs sandbox components, per-cloud clients |
| Builder | Step-by-step construction with validation | Queries, requests, complex configs |
| Prototype | Clone instead of construct | Test fixtures, templates |

## Part A2: Structural Patterns

Structural patterns combine objects into larger structures while keeping interfaces simple and dependencies loose.

### Adapter

**Problem.** Your code expects one interface, but a third-party library or legacy system offers another. Example: your app calls `send(phone, text)`, but the new SMS vendor's SDK wants `dispatch({"to":..., "body":..., "dlt_template":...})`.

**Solution.** Wrap the foreign interface in a class that speaks yours.

```python
class SmsSender:
    def send(self, phone: str, text: str) -> None: ...

class VendorXAdapter(SmsSender):
    def __init__(self, client, template_id):
        self.client, self.template_id = client, template_id
    def send(self, phone, text):
        self.client.dispatch({"to": phone, "body": text, "dlt_template": self.template_id})
```

Switching vendors now means writing one adapter, not editing every caller.

**Pitfalls.** Adapters that leak vendor-specific errors or types back to callers defeat the purpose; translate errors too.

### Decorator

**Problem.** You want to add behavior (logging, caching, retries, metrics) to an object without changing its class or creating a subclass for every combination.

**Solution.** Wrap the object in another object with the same interface that adds behavior and delegates the rest.

```python
class MenuRepo:
    def get_menu(self, rid): ...

class CachedMenuRepo(MenuRepo):
    def __init__(self, inner, cache, ttl=60):
        self.inner, self.cache, self.ttl = inner, cache, ttl
    def get_menu(self, rid):
        key = f"menu:{rid}"
        hit = self.cache.get(key)
        if hit is not None:
            return hit
        menu = self.inner.get_menu(rid)
        self.cache.set(key, menu, self.ttl)
        return menu

repo = MetricsMenuRepo(CachedMenuRepo(DbMenuRepo(db), redis))   # stack behaviors
```

**Pitfalls.** Deep stacks of decorators become hard to debug; order matters (metrics outside the cache measures hits, inside it measures only misses).

### Facade

**Problem.** Placing an order touches cart, pricing, coupons, payments and notifications; every caller repeating that sequence is error-prone.

**Solution.** One simple entry point that coordinates the subsystem.

```python
class CheckoutFacade:
    def place_order(self, user_id, cart_id, idem_key):
        cart = self.carts.get(cart_id, user_id)
        price = self.pricing.quote(cart)             # server-side recompute
        self.coupons.reserve(user_id, cart.coupon)
        order = self.orders.create(user_id, cart, price, idem_key)
        return self.payments.start(order)
```

**Pitfalls.** A facade that grows into a "god service" holding business logic for everything; keep it thin and let subsystems own their rules.

### Proxy

**Problem.** You need to control access to an object: lazy loading, access checks, remote calls, rate limits.

**Solution.** A stand-in with the same interface that controls when and how the real object is used.

```python
class AuthorizedOrderService:
    def __init__(self, inner, user_id):
        self.inner, self.user_id = inner, user_id
    def get(self, order_id):
        order = self.inner.get(order_id)
        if order.user_id != self.user_id:
            raise PermissionError("not your order")   # blocks IDOR
        return order
```

Real-world proxies: API gateways, service-mesh sidecars and client stubs for remote services.

**Pitfalls.** Remote proxies that look like local calls hide latency and failure; callers must still use timeouts.

### Composite

**Problem.** Tree structures where single items and groups should be treated the same: a menu with categories containing sub-categories and dishes; permissions with groups containing users.

**Solution.** Leaves and containers share one interface; containers delegate to children.

```python
class MenuNode:
    def price_range(self): ...

class Dish(MenuNode):
    def __init__(self, price): self.price = price
    def price_range(self): return (self.price, self.price)

class Category(MenuNode):
    def __init__(self, children): self.children = children
    def price_range(self):
        ranges = [c.price_range() for c in self.children]
        return (min(r[0] for r in ranges), max(r[1] for r in ranges))
```

**Pitfalls.** Very deep or cyclic trees; protect against cycles and cap depth.

### Bridge

**Problem.** Two dimensions vary independently, such as notification type (OTP, promo, order update) and channel (SMS, push, email). Subclassing every combination gives 9 classes, then 12, then 20.

**Solution.** Separate the two hierarchies and connect them by composition: a notification holds a channel.

```python
class Channel:
    def deliver(self, user, text): ...

class Notification:
    def __init__(self, channel: Channel): self.channel = channel

class OtpNotification(Notification):
    def send(self, user, code): self.channel.deliver(user, f"Your OTP is {code}")

OtpNotification(SmsChannel()).send(user, "482910")
```

**Pitfalls.** Over-engineering when only one dimension really varies.

### Structural patterns at a glance

| Pattern | One-line purpose | Typical system-design use |
| --- | --- | --- |
| Adapter | Make incompatible interfaces fit | Vendor SDKs, legacy systems |
| Decorator | Add behavior by wrapping | Caching, retries, metrics, auth layers |
| Facade | One simple entry to a subsystem | Checkout, onboarding flows |
| Proxy | Control access to an object | Authorization, lazy loading, gateways, sidecars |
| Composite | Treat items and groups alike | Menus, file trees, permission groups |
| Bridge | Vary two dimensions independently | Notification types × channels |

## Part A3: Behavioral Patterns, Part 1

Behavioral patterns organize how objects make decisions and communicate. These four appear in almost every low-level design interview.

### Strategy

**Problem.** A ride app prices trips differently for standard rides, airport flat fares and EV discounts. An `if/elif` chain inside one function grows with every new rule and every change risks breaking the others.

**Solution.** Put each algorithm behind a common interface and choose one at runtime.

```python
from abc import ABC, abstractmethod

class PricingStrategy(ABC):
    @abstractmethod
    def fare(self, km: float, minutes: float, surge: float) -> int: ...

class StandardPricing(PricingStrategy):
    def fare(self, km, minutes, surge):
        return round((5_000 + 1_200 * km + 150 * minutes) * surge)   # paise

class AirportFlat(PricingStrategy):
    def fare(self, km, minutes, surge):
        return 75_000

class EvDiscount(PricingStrategy):
    def __init__(self, base): self.base = base
    def fare(self, km, minutes, surge):
        return round(self.base.fare(km, minutes, surge) * 0.9)

strategy = AirportFlat() if trip.to_airport else EvDiscount(StandardPricing())
print(strategy.fare(12.0, 30, 1.2))
```

Worked check: 12 km, 30 minutes, surge 1.2 → (5,000 + 14,400 + 4,500) × 1.2 = 28,680 paise; with EV discount, 25,812 paise (₹258.12).

| Use when | Avoid when |
| --- | --- |
| Several interchangeable algorithms that change independently | Only one algorithm and no expected variation |

**Pitfalls.** Strategy selection logic scattered everywhere; centralize it in a factory or configuration.

### Observer

**Problem.** When an order is delivered, many things must happen: notify the customer, request a rating, update analytics, release the rider. Hard-coding every call into the order code couples it to every team.

**Solution.** The subject publishes an event; observers subscribe and react independently.

```python
class EventBus:
    def __init__(self): self.handlers = {}
    def subscribe(self, event, fn): self.handlers.setdefault(event, []).append(fn)
    def publish(self, event, payload):
        for fn in self.handlers.get(event, []):
            try:
                fn(payload)
            except Exception as e:
                log.error("handler failed", event=event, error=str(e))   # one failure does not stop others

bus = EventBus()
bus.subscribe("order.delivered", notify_customer)
bus.subscribe("order.delivered", request_rating)
bus.publish("order.delivered", {"order_id": 88})
```

At system scale this becomes publish-subscribe over Kafka (Chapter 16).

**Pitfalls.** Hidden control flow (who reacts to what?), slow observers blocking the publisher (make them async), and lost events if publishing is not reliable (use the transactional outbox, Part B2).

### State

**Problem.** An order behaves differently in each state: it can be cancelled while PLACED but not after DELIVERED. Status checks sprinkled across the code allow illegal transitions.

**Solution.** Model states and allowed transitions explicitly; every change goes through one place.

```python
TRANSITIONS = {
    "PLACED":     {"ACCEPTED", "CANCELLED"},
    "ACCEPTED":   {"PREPARING", "CANCELLED"},
    "PREPARING":  {"READY"},
    "READY":      {"PICKED_UP"},
    "PICKED_UP":  {"DELIVERED"},
    "DELIVERED":  set(),
    "CANCELLED":  set(),
}

def transition(order, new_status):
    if new_status not in TRANSITIONS[order.status]:
        raise ValueError(f"illegal {order.status} -> {new_status}")
    # persist with optimistic locking: UPDATE ... WHERE id=? AND status=? AND version=?
    order.status = new_status
```

**Pitfalls.** Validating in memory but not in the database update; two concurrent requests can both pass the check. Always make the database write conditional on the old state.

### Command

**Problem.** You need to queue, retry, schedule, log or undo actions, such as "refund ₹450 for order 88" that might run later on a worker.

**Solution.** Package an action and its data as an object (or a message) with an `execute` method.

```python
from dataclasses import dataclass

@dataclass
class RefundCommand:
    order_id: int
    amount_paise: int
    idempotency_key: str
    def execute(self, payments):
        return payments.refund(self.order_id, self.amount_paise, key=self.idempotency_key)

queue.put(RefundCommand(88, 45_000, "refund:88"))   # a worker executes it later
```

Commands make actions serializable for queues, auditable in logs, and safe to retry when they carry idempotency keys.

**Pitfalls.** Commands without idempotency keys get executed twice on retries; commands that capture live objects cannot be serialized.

### Behavioral patterns (part 1) at a glance

| Pattern | One-line purpose | Typical system-design use |
| --- | --- | --- |
| Strategy | Swap algorithms at runtime | Pricing, ranking, routing, retry policies |
| Observer | React to events without coupling | Notifications, analytics, pub/sub |
| State | Explicit states and legal transitions | Orders, trips, payments, tickets |
| Command | Actions as objects or messages | Job queues, undo, audit logs, scheduled tasks |

## Part A4: Behavioral Patterns, Part 2

### Chain of Responsibility

**Problem.** Every API request must pass authentication, rate limiting, input validation and logging before the handler. Writing all of that inside each handler duplicates code and order mistakes creep in.

**Solution.** A chain of handlers; each one either handles the request, rejects it, or passes it to the next. Web middleware and gateway filters are this pattern.

```python
def authenticate(req, nxt):
    if not verify_jwt(req.headers.get("Authorization")):
        return Response(401)
    return nxt(req)

def rate_limit(req, nxt):
    if not bucket_for(req.user_id).take():
        return Response(429, headers={"Retry-After": "1"})
    return nxt(req)

def build_chain(middlewares, handler):
    for mw in reversed(middlewares):
        handler = (lambda m, h: lambda r: m(r, h))(mw, handler)
    return handler

app = build_chain([authenticate, rate_limit, validate], place_order)
```

Support escalation is the same idea: bot → tier-1 agent → specialist → manager.

**Pitfalls.** Order matters (rate limit before expensive work; authentication before anything that uses identity); a request that silently falls off the end of the chain needs a default response.

### Template Method

**Problem.** Several import jobs (restaurant menus, rider documents, partner catalogs) share the same steps: fetch, parse, validate, save, report. Only some steps differ.

**Solution.** A base class defines the fixed skeleton; subclasses fill in the variable steps.

```python
class ImportJob:
    def run(self):                          # the template: fixed order
        raw = self.fetch()
        rows = self.parse(raw)
        good, bad = self.validate(rows)
        self.save(good)
        self.report(len(good), len(bad))
    def validate(self, rows):               # shared default
        good = [r for r in rows if r.get("id")]
        return good, [r for r in rows if not r.get("id")]
    def report(self, ok, failed): log.info("import done", ok=ok, failed=failed)

class MenuImport(ImportJob):
    def fetch(self): return s3.read("menus/today.csv")
    def parse(self, raw): return parse_csv(raw)
    def save(self, rows): menu_repo.upsert_many(rows)
```

**Pitfalls.** Deep inheritance hierarchies become rigid; when steps vary a lot, compose strategies instead.

### Mediator

**Problem.** Many objects talking directly to each other creates a tangle: riders, orders, restaurants and customers all updating each other.

**Solution.** A central mediator coordinates; participants talk only to it. A dispatch coordinator or a chat room server is a mediator.

```python
class DispatchMediator:
    def order_ready(self, order):
        rider = self.matcher.best_rider(order)
        if rider and self.riders.claim(rider, order):     # atomic claim
            self.notify.rider(rider, order)
            self.notify.customer(order.user_id, f"{rider.name} is on the way")
        else:
            self.retry_queue.put(order)
```

**Pitfalls.** The mediator can become a bottleneck or a god object; split by domain and keep it stateless where possible.

### Iterator

**Problem.** Callers want to process every item from a paginated API or a huge table without loading everything into memory or knowing how pages work.

**Solution.** An iterator hides the paging and yields items one by one.

```python
def all_orders(client, since):
    cursor = None
    while True:
        page = client.list_orders(since=since, cursor=cursor, limit=500)
        yield from page.items
        if not page.next_cursor:
            return
        cursor = page.next_cursor

for order in all_orders(api, "2026-10-01"):
    reconcile(order)
```

**Pitfalls.** Offset-based paging skips or repeats items when data changes during iteration; use cursors.

### Repository

**Problem.** Business logic full of SQL is hard to test and tied to one database.

**Solution.** A repository exposes domain-level methods (`get`, `add`, `find_active_for_rider`) and hides storage details.

```python
class OrderRepository:
    def __init__(self, db): self.db = db
    def get(self, order_id):
        row = self.db.fetch_one("SELECT * FROM orders WHERE id = %s", (order_id,))
        return Order.from_row(row) if row else None
    def save_status(self, order, new_status):
        updated = self.db.execute(
            "UPDATE orders SET status=%s, version=version+1 WHERE id=%s AND version=%s",
            (new_status, order.id, order.version))
        if updated == 0:
            raise ConcurrentUpdateError(order.id)
```

Tests use an in-memory repository; production uses the SQL one.

**Pitfalls.** Generic repositories that expose every query defeat the purpose; repositories that hide expensive queries cause N+1 problems.

### Behavioral patterns (part 2) at a glance

| Pattern | One-line purpose | Typical system-design use |
| --- | --- | --- |
| Chain of Responsibility | Pass a request through ordered handlers | Middleware, gateway filters, escalation |
| Template Method | Fixed skeleton, variable steps | Batch jobs, importers, pipelines |
| Mediator | Central coordination | Dispatch, chat rooms, workflow coordinators |
| Iterator | Uniform traversal | Paginated APIs, streaming large tables |
| Repository | Domain-level data access | Testable services, swapping storage |

## Part B1: Distributed Resilience Patterns

In distributed systems, calls fail, hang or slow down. Resilience patterns stop one failing dependency from taking down everything else. They are usually combined in this order around every outbound call: bulkhead → timeout → retry (with backoff) → circuit breaker → fallback.

### Timeout

**Problem.** A call to a slow dependency waits forever, holding a thread or connection. Enough waiting calls exhaust the service.

**Solution.** Every network call gets a deadline shorter than the caller's own deadline.

```python
resp = http.get("https://pricing.example.com/quote", timeout=(0.2, 0.8))   # connect, read seconds
```

Worked budget: the API promises a response within 1 s; it calls pricing then inventory. Give pricing 300 ms, inventory 300 ms, and keep the rest for processing and network.

**Without it.** A dependency slowdown turns into a full outage as threads pile up.

### Retry with exponential backoff and jitter

**Problem.** Many failures are transient (a dropped connection, a brief overload), but immediate retries from thousands of clients hit the struggling service all at once.

**Solution.** Retry only safe operations, wait longer each time, and randomize the wait.

```python
import random, time

def call_with_retry(fn, attempts=4, base=0.1, cap=5.0):
    for i in range(attempts):
        try:
            return fn()
        except TransientError:
            if i == attempts - 1:
                raise
            delay = random.uniform(0, min(cap, base * 2 ** i))   # "full jitter"
            time.sleep(delay)
```

Worked delays: maximum waits of 0.1, 0.2, 0.4 s for attempts 2-4, each randomized between zero and that maximum, so clients spread out instead of retrying together.

**Pitfalls.** Retrying non-idempotent writes without idempotency keys (double charges); retries at several layers multiplying load (3 × 3 × 3 = 27 calls); retrying errors that will never succeed (400, 401).

### Circuit breaker

**Problem.** A dependency is down; every call still waits for a timeout, wasting time and keeping pressure on the failing service.

**Solution.** Track failures; after a threshold, stop calling for a cool-down period and fail fast; then let a few trial calls through.

```python
import time

class CircuitBreaker:
    def __init__(self, threshold=5, cooldown=30):
        self.failures, self.threshold, self.cooldown = 0, threshold, cooldown
        self.state, self.opened_at = "CLOSED", 0.0
    def call(self, fn, fallback):
        if self.state == "OPEN":
            if time.time() - self.opened_at < self.cooldown:
                return fallback()                      # fail fast
            self.state = "HALF_OPEN"                    # allow a trial call
        try:
            result = fn()
            self.failures, self.state = 0, "CLOSED"
            return result
        except Exception:
            self.failures += 1
            if self.state == "HALF_OPEN" or self.failures >= self.threshold:
                self.state, self.opened_at = "OPEN", time.time()
            return fallback()
```

States: CLOSED (normal) → OPEN (after repeated failures, fail fast) → HALF\_OPEN (after cool-down, test) → CLOSED if the test succeeds, OPEN again if it fails. Production breakers usually use failure rates over a sliding window rather than consecutive counts.

**Pitfalls.** One breaker for a whole dependency when only one endpoint is failing; no alert when breakers open, hiding degradation.

### Bulkhead

**Problem.** All outbound calls share one thread pool; a slow recommendation service uses every thread, so checkout calls cannot run.

**Solution.** Separate resource pools per dependency or per feature, like watertight compartments in a ship.

```python
from concurrent.futures import ThreadPoolExecutor
pools = {
    "payments": ThreadPoolExecutor(max_workers=20),
    "recommendations": ThreadPoolExecutor(max_workers=5),
}
future = pools["recommendations"].submit(get_recs, user_id)
```

At system level: separate queues for critical and bulk work, separate clusters per tenant tier, cells per region.

### Rate limiter

**Problem.** One client, bug or attacker floods the service and starves everyone else.

**Solution.** A token bucket per client: tokens refill at a steady rate; each request spends one; an empty bucket means 429.

```python
import time

class TokenBucket:
    def __init__(self, rate_per_s, capacity):
        self.rate, self.capacity = rate_per_s, capacity
        self.tokens, self.last = capacity, time.monotonic()
    def take(self):
        now = time.monotonic()
        self.tokens = min(self.capacity, self.tokens + (now - self.last) * self.rate)
        self.last = now
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False
```

Worked: rate 10 per second, capacity 20 allows a burst of 20 requests, then a steady 10 per second. Across many servers, the bucket lives in Redis with an atomic script (Chapter 22).

### Fallback, graceful degradation and load shedding

When a non-critical dependency fails, return something useful: cached popular restaurants instead of personalized ones, the last known price, or a smaller feature set. When overloaded, shed the least important work first (analytics, recommendations) to protect critical paths (login, checkout, payments). Always alert when fallbacks are active, or a degraded system can go unnoticed for days.

### Resilience patterns at a glance

| Pattern | Stops this failure | Key setting |
| --- | --- | --- |
| Timeout | Threads stuck forever | Per-call deadline within the overall budget |
| Retry + backoff + jitter | Giving up on brief blips; synchronized retry storms | Attempts, base delay, cap, idempotency |
| Circuit breaker | Hammering a dead dependency | Failure threshold, cool-down, trial calls |
| Bulkhead | One slow dependency starving others | Pool sizes per dependency |
| Rate limiter | One client overwhelming everyone | Rate and burst per key |
| Fallback and load shedding | Total outage from partial failure | What to serve or drop first |

## Part B2: Distributed Data and Integration Patterns

Once data lives in several services, you lose single-database transactions. These patterns keep data correct and services decoupled anyway.

### Saga

**Problem.** Placing an order spans services: reserve coupon, create order, charge payment, notify restaurant. No single transaction covers them all; if payment fails after the coupon was reserved, the coupon must be released.

**Solution.** A sequence of local transactions, each with a compensating action that undoes it if a later step fails. An orchestrator (often a durable workflow engine) runs the steps.

```python
def place_order_saga(ctx):
    done = []
    try:
        ctx.coupons.reserve(ctx.coupon);        done.append(lambda: ctx.coupons.release(ctx.coupon))
        order = ctx.orders.create(ctx.cart);    done.append(lambda: ctx.orders.cancel(order.id))
        ctx.payments.charge(order, key=f"pay:{order.id}")
        done.append(lambda: ctx.payments.refund(order, key=f"refund:{order.id}"))
        ctx.restaurants.notify(order)
    except Exception:
        for undo in reversed(done):
            undo()                               # compensate in reverse order
        raise
```

**Pitfalls.** Compensations must be idempotent and retried until they succeed; intermediate states are visible to users ("payment pending"); in-memory sagas lose progress on crashes, which is why durable workflow engines are used in production.

### Transactional outbox

**Problem.** A service saves an order and then publishes "order.created" to Kafka. If it crashes between the two, the database and the event stream disagree forever (the dual-write problem).

**Solution.** Write the business row and an outbox row in the same database transaction; a relay publishes outbox rows to Kafka and marks them sent.

```sql
BEGIN;
INSERT INTO orders (id, user_id, status) VALUES ('o88', 'u42', 'CREATED');
INSERT INTO outbox (topic, payload) VALUES ('order.created', '{"order_id":"o88"}');
COMMIT;
-- relay loop: SELECT unsent outbox rows → publish → mark sent (at-least-once)
```

Change data capture (reading the database log, for example with Debezium) is an alternative relay. Consumers must be idempotent because the relay may publish twice.

### Idempotent consumer

**Problem.** At-least-once delivery means the same message can arrive twice; crediting cashback twice costs money.

**Solution.** Record each processed message ID with a unique constraint in the same transaction as the side effect.

```sql
BEGIN;
INSERT INTO processed_messages (message_id) VALUES ('cashback:o88');  -- fails if seen before
UPDATE wallets SET balance_paise = balance_paise + 10000 WHERE user_id = 'u42';
COMMIT;
```

### CQRS (Command Query Responsibility Segregation)

**Problem.** One data model cannot serve both correct writes and very different fast reads (a customer's order list, a restaurant dashboard, a support search).

**Solution.** Write to a normalized model; publish events; build separate read models optimized per query (a denormalized table, a search index, a cache). Reads become fast and independent, at the cost of eventual consistency between write and read sides.

### Event sourcing

**Problem.** You need a complete history of how state changed (wallets, ledgers, audits), not just the current value.

**Solution.** Store events as the source of truth and compute state by replaying them.

```python
events = [("deposited", 50_000), ("spent", 12_000), ("refunded", 4_000), ("spent", 30_000)]
balance = 0
for kind, amount in events:
    balance += amount if kind in ("deposited", "refunded") else -amount
print(balance)   # 12,000 paise = ₹120
```

Snapshots avoid replaying millions of events. **Pitfalls.** Changing event schemas is hard; queries need projections (CQRS); it is overkill for simple CRUD.

### Strangler fig

**Problem.** Rewriting a monolith all at once is risky.

**Solution.** Put a router or gateway in front; move one route or capability at a time to a new service; retire the old code when traffic reaches zero (Chapter 21).

### Sidecar

**Problem.** Every service, in every language, needs the same mTLS, retries, metrics and log shipping.

**Solution.** Run a helper process next to each service instance that handles these concerns; service meshes use sidecar proxies such as Envoy. **Pitfalls.** Extra latency and resources per pod; debugging across the extra hop.

### API gateway and backend for frontend (BFF)

An API gateway is the single entry for clients: routing, authentication, rate limits, TLS. A BFF is a gateway per client type (mobile, web, partner) that shapes responses for that client, so the mobile home screen needs one call instead of seven. Keep business rules in services, not in gateways.

### Leader election with fencing

**Problem.** Exactly one instance must run the scheduler or own a shard, even when nodes pause or networks split.

**Solution.** Acquire a lease in a consensus store (etcd, ZooKeeper, or a database row) and renew it; every lease carries an increasing fencing token that the protected resource checks.

```python
lease = etcd.acquire_lease("billing-leader", ttl=15)   # returns token 41
db.execute("UPDATE jobs SET owner=%s, token=%s WHERE name='billing' AND token < %s",
           (node_id, lease.token, lease.token))         # older leaders' writes are rejected
```

Without fencing, a leader that paused (for example in garbage collection) can wake up and act after a new leader took over (Production Incident Playbook, Chapter 29).

### Data and integration patterns at a glance

| Pattern | Solves | Main cost |
| --- | --- | --- |
| Saga | Multi-service transactions | Compensation logic, visible intermediate states |
| Transactional outbox | Lost or phantom events | Relay process, duplicates possible |
| Idempotent consumer | Duplicate processing | Dedupe storage |
| CQRS | Conflicting read and write needs | Eventual consistency, more stores |
| Event sourcing | Full history and audit | Complexity, schema evolution |
| Strangler fig | Risky big-bang rewrites | Running two systems for a while |
| Sidecar | Cross-cutting concerns in every service | Extra hop and resources |
| API gateway / BFF | Many clients, many services | Another component to scale |
| Leader election + fencing | Exactly one active owner | Consensus infrastructure |

## Choosing Patterns, Anti-Patterns and Interview Questions

Pick a pattern from the problem you actually have, never because a pattern exists. Start with the simplest code that works, then introduce a pattern when the same pain appears a second time.

> *Diagram in the original artifact: Pattern picker · problem to pattern, colored by family*

### Anti-patterns to recognize

| Anti-pattern | What it looks like | Why it hurts | Better approach |
| --- | --- | --- | --- |
| God object | One class or service that knows and does everything | Every change touches it; hard to test | Split by responsibility (single responsibility principle) |
| Pattern overuse | Factories and interfaces with one implementation | Indirection with no benefit | Add patterns when variation appears |
| Distributed monolith | Microservices that must deploy together and share a database | All the costs of distribution, none of the benefits | Database per service, events, clear boundaries |
| Singleton as global variable | Hidden state used everywhere | Untestable, surprising coupling | Dependency injection |
| Chatty services | Dozens of synchronous calls per user request | Latency and cascading failures | Coarser APIs, caching, events |
| Retry everything everywhere | Retries in every layer without backoff | Retry storms during outages | Retry in one layer with budgets and jitter |
| Anemic domain model | Data classes with all logic in "manager" classes | Rules scattered and duplicated | Put behavior with the data it protects |

### How to use patterns in a low-level design interview

1. Clarify requirements and identify what is likely to change (pricing rules, channels, states).
2. Model the core entities and their relationships.
3. Apply patterns exactly where variation or lifecycle rules exist: Strategy for changing rules, State for lifecycles, Observer for side effects, Factory for choosing implementations.
4. Show concurrency safety on shared state (atomic updates, versions).
5. Explain the trade-off of each pattern you added in one sentence.

### Interview questions

1. Strategy versus State? Both swap behavior behind an interface; Strategy is chosen by the caller, while State changes itself as the object moves through its lifecycle.
2. Decorator versus Proxy? Decorator adds behavior; Proxy controls access (authorization, lazy loading, remoteness); the code shape is similar.
3. Why is Singleton often considered an anti-pattern? It hides global state and makes testing and parallelism harder; dependency injection gives the same single instance without the coupling.
4. How do the outbox and idempotent consumer patterns work together? The outbox guarantees events are published at least once; the idempotent consumer makes duplicates harmless.
5. When would you choose a saga over two-phase commit? Across services and databases that cannot share a coordinator, or when long-running steps would hold locks too long.
6. Which patterns protect a call to a flaky payment provider? Bulkhead, timeout, retries with backoff and idempotency keys, a circuit breaker and a fallback route.
