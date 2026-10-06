# Networking in Depth

**Topic:** System design
**Covers:** Layers and the Journey of One Request; IP Addressing and Subnetting; Routing; DNS in Depth; TCP in Depth; UDP and QUIC; HTTP/1.1, HTTP/2 and HTTP/3; TLS 1.3 in Depth; NAT, Firewalls and Proxies; Cloud and Data Center Networking; Performance Math; Debugging Tools, Failure Catalog and a Production Incident
**Source:** [Claude artifact](https://claude.ai/artifact/7xxGdVxPGbUiPY13z4MdZ2) — written by a colleague, mirrored here for study.

Twelve lessons that go beyond Chapter 3 of the main book: how packets actually travel, how addresses and routes work, what TCP, QUIC, HTTP and TLS do on the wire, how cloud networks are built, how to do the performance math, and how to debug real failures. Each lesson has worked examples, failure cases with why they happen, and interview questions.

## Lesson 1: Layers and the Journey of One Request

Networking is built in layers: each layer solves one problem and hands its result to the layer above. Knowing which layer a problem lives in is the fastest way to debug it.

### 1.1 The layers

| TCP/IP layer | OSI layers | Problem it solves | Address or unit | Examples |
| --- | --- | --- | --- | --- |
| Application | 5-7 | What the programs say | Messages | HTTP, DNS, TLS, gRPC |
| Transport | 4 | Which program, reliable or fast delivery | Ports; segments or datagrams | TCP, UDP, QUIC |
| Internet | 3 | Which machine anywhere in the world | IP addresses; packets | IPv4, IPv6, ICMP |
| Link | 1-2 | Which device on this local network | MAC addresses; frames | Ethernet, Wi-Fi |

### 1.2 Encapsulation

Each layer wraps the data from the layer above with its own header:

```
HTTP request ("GET /menu")
  └─ TCP segment:  [src port 54321 | dst port 443 | seq | ack | flags] + data
      └─ IP packet: [src 10.0.0.5 | dst 13.235.x.x | TTL | protocol=TCP] + segment
          └─ Ethernet frame: [src MAC | dst MAC of the router] + packet + checksum
```

Typical sizes: Ethernet allows 1,500 bytes per packet (the MTU). IPv4 and TCP headers take 20 bytes each, leaving 1,460 bytes of data per packet (the MSS). A 100 KB response therefore needs about 70 packets.

### 1.3 Worked journey: opening a food app's website

| Step | What happens | Layer | Typical time (illustrative, Bengaluru to a Mumbai region) |
| --- | --- | --- | --- |
| 1 | Browser checks its DNS cache, then asks the resolver for the site's IP | Application | 0 ms if cached, 20-50 ms if not |
| 2 | Laptop uses ARP to find the Wi-Fi router's MAC address | Link | under 1 ms, cached |
| 3 | TCP three-way handshake to port 443 | Transport | 1 round trip, \~20-30 ms |
| 4 | TLS 1.3 handshake: certificate check, key agreement | Application | 1 round trip, \~20-30 ms |
| 5 | HTTP request sent; routers forward packets hop by hop using IP | Internet | part of the next round trip |
| 6 | Server (often a CDN edge) responds; TCP acknowledges and reassembles | Transport | \~20-30 ms plus server time |
| 7 | Browser parses HTML and repeats for images, scripts, APIs (often over the same connection) | Application | Varies |

The lesson: before any useful byte arrives, a new connection costs DNS plus two to three round trips. That is why keep-alive, connection reuse, CDNs near users and HTTP/3 matter.

### 1.4 Failures by layer

| Symptom | Likely layer | Why it happens | First check |
| --- | --- | --- | --- |
| "Could not resolve host" | Application (DNS) | Bad record, resolver down | `dig name` |
| Connection timed out | Internet or transport | Firewall drop, wrong route, server down | `ping`, `traceroute`, security groups |
| Connection refused | Transport | Nothing listening on that port | Is the service running and bound to the right address? |
| Certificate error | Application (TLS) | Expired or wrong certificate | `openssl s_client` |
| HTTP 502 or 504 | Application | Proxy cannot reach or wait for the backend | Proxy logs, backend health |

### 1.5 Interview questions

1. Why does a new HTTPS connection take at least two round trips before the request? One for the TCP handshake and one for the TLS 1.3 handshake (HTTP/3 over QUIC combines them).
2. What is the difference between "refused" and "timed out"? Refused means the machine answered that no program is listening; timed out means no answer arrived, often a firewall drop.
3. What is MSS? The largest TCP data payload per packet, typically 1,460 bytes on a 1,500-byte MTU.

## Lesson 2: IP Addressing and Subnetting

An IPv4 address is 32 bits, written as four numbers from 0 to 255. CIDR notation such as 10.0.0.0/16 says how many leading bits identify the network; the remaining bits number the hosts inside it.

### 2.1 How many addresses?

```latex
\text{addresses in a /n block} = 2^{32 - n}
```

| Prefix | Addresses | Netmask | Typical use |
| --- | --- | --- | --- |
| /16 | 65,536 | 255.255.0.0 | A whole VPC |
| /20 | 4,096 | 255.255.240.0 | A large subnet (for example Kubernetes nodes and pods) |
| /24 | 256 | 255.255.255.0 | A typical subnet |
| /26 | 64 | 255.255.255.192 | A small subnet |
| /32 | 1 | 255.255.255.255 | A single host in a rule |

In a traditional network the first address is the network and the last is broadcast, so a /24 has 254 usable hosts. Cloud providers reserve a few more (AWS reserves 5 per subnet).

### 2.2 Worked subnetting

Split 192.168.1.0/24 into four /26 subnets (64 addresses each):

| Subnet | Range | First usable | Last usable |
| --- | --- | --- | --- |
| 192.168.1.0/26 | .0 - .63 | .1 | .62 |
| 192.168.1.64/26 | .64 - .127 | .65 | .126 |
| 192.168.1.128/26 | .128 - .191 | .129 | .190 |
| 192.168.1.192/26 | .192 - .255 | .193 | .254 |

Is 192.168.1.70 in 192.168.1.64/26? The block covers .64 to .127, so yes.

Cloud example: a VPC 10.0.0.0/16 split into /20 subnets gives 16 subnets of 4,096 addresses (10.0.0.0/20, 10.0.16.0/20, 10.0.32.0/20, and so on), for example three public and three private subnets across three availability zones with room to spare.

### 2.3 Special ranges

| Range | Meaning |
| --- | --- |
| 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 | Private networks (not routed on the internet) |
| 100.64.0.0/10 | Carrier-grade NAT space used by ISPs |
| 127.0.0.0/8 | Loopback (this machine) |
| 169.254.0.0/16 | Link-local; includes the cloud metadata address 169.254.169.254 (block it from untrusted code) |

### 2.4 IPv6

IPv6 uses 128-bit addresses written in hexadecimal groups, such as 2001:db8::1 ("::" compresses runs of zeros). Subnets are usually /64, which holds 2⁶⁴ addresses, so address exhaustion and most NAT disappear. Dual-stack networks run IPv4 and IPv6 together.

### 2.5 Code: checking addresses

```python
import ipaddress
net = ipaddress.ip_network("10.0.0.0/16")
subnets = list(net.subnets(new_prefix=20))
print(len(subnets), subnets[1])                                       # 16 10.0.16.0/20
print(ipaddress.ip_address("192.168.1.70") in ipaddress.ip_network("192.168.1.64/26"))  # True
```

### 2.6 Failures

| Failure | Why it happens | Fix |
| --- | --- | --- |
| VPC peering or VPN impossible | Two networks use overlapping ranges (both 10.0.0.0/16) | Plan non-overlapping ranges per environment and region from day one |
| New pods or servers cannot start | Subnet out of IP addresses; each pod may take one | Larger subnets for clusters; secondary ranges |
| Traffic goes to the wrong place | Wrong mask in a route or firewall rule (/16 instead of /24) | Review rules as code; test with real addresses |
| Code reaches cloud credentials | Metadata address reachable from user workloads | Block 169.254.169.254 for untrusted workloads |

### 2.7 Interview questions

1. How many addresses in a /22? 2^10 = 1,024.
2. Why plan IP ranges carefully at the start? Overlapping ranges block peering and VPNs later, and renumbering is painful.
3. What is the netmask of a /27? 255.255.255.224 (32 addresses).

## Lesson 3: Routing

Routing is how each router decides where to send a packet next. No router knows the full path; each one forwards toward the destination using its routing table, and the packet finds its way hop by hop.

### 3.1 Longest prefix match, worked

A cloud subnet's route table:

| Destination | Target |
| --- | --- |
| 0.0.0.0/0 | Internet gateway |
| 10.0.0.0/8 | VPN to the office |
| 10.1.0.0/16 | Peering to the analytics VPC |
| 10.1.2.0/24 | Local subnet |

A packet for 10.1.2.5 matches all four rows. The router picks the most specific match, the /24, so it stays local. A packet for 10.1.9.9 matches /16, /8 and /0, and goes to peering. A packet for 8.8.8.8 matches only /0 and goes to the internet.

### 3.2 Hop by hop, and TTL

Every IP packet carries a TTL (time to live), decremented by each router; at zero the packet is dropped and an error is sent back. This stops loops from circulating packets forever. Traceroute exploits it: it sends packets with TTL 1, 2, 3 and so on, and each router that drops one reveals itself.

```
$ traceroute example.com
 1  192.168.1.1     1.2 ms    home router
 2  100.64.0.1      6.8 ms    ISP (carrier-grade NAT range)
 3  ...             14 ms     ISP core
 6  ...             22 ms     exchange point
 9  93.184.x.x      24 ms     destination
```

A big jump in time between two hops points at a long link (often a city-to-city or undersea hop) or congestion.

### 3.3 Inside a network versus between networks

Inside one organization, interior protocols such as OSPF compute shortest paths automatically. Between organizations, the internet runs on BGP: each network (an autonomous system) announces which address ranges it can reach, and neighbors choose routes by policy and path length.

BGP mistakes have caused famous outages. In 2008 a Pakistani ISP's announcement of a YouTube prefix spread globally and black-holed YouTube traffic. In October 2021, Facebook's backbone routes were withdrawn during maintenance, and its DNS servers became unreachable, taking its services offline for hours.

### 3.4 Anycast and ECMP

Anycast announces the same IP address from many locations; routing delivers each user to the nearest one. DNS root servers and CDNs use it for speed and DDoS absorption. ECMP (equal-cost multipath) spreads flows across several equal paths, hashing each flow to one path so its packets stay in order.

### 3.5 Failures

| Failure | Symptom | Why it happens | Fix |
| --- | --- | --- | --- |
| Missing route | Timeouts to one network | Route table lacks an entry, or wrong target | Add the route; review route tables as code |
| Asymmetric routing | Connections break through firewalls | Replies take a different path than requests | Symmetric paths or stateless rules |
| Routing loop | TTL-exceeded errors | Two routers point at each other | Fix the routes |
| BGP hijack or leak | Traffic goes to the wrong network | Incorrect announcements accepted | Route filtering, RPKI validation |
| Route withdrawal | Whole service unreachable | Configuration change removed announcements | Staged changes, out-of-band access |

### 3.6 Interview questions

1. Which route wins for 10.1.2.5: 10.0.0.0/8 or 10.1.2.0/24? The /24, longest prefix.
2. How does traceroute work? It sends packets with increasing TTL and records which router returns each time-exceeded error.
3. Why do CDNs use anycast? Users reach the nearest edge automatically, and attack traffic spreads across many sites.

## Lesson 4: DNS in Depth

DNS is a distributed, cached directory that turns names into addresses and other records. It is fast because answers are cached at many levels, and fragile for the same reason: wrong or stale answers are cached too.

### 4.1 Record types

| Record | Maps | Example use |
| --- | --- | --- |
| A / AAAA | Name → IPv4 / IPv6 address | api.example.com → 203.0.113.20 |
| CNAME | Name → another name | www → example.cdn-provider.net |
| MX | Domain → mail servers | Email delivery |
| TXT | Name → text | Domain verification, SPF/DKIM email policies |
| NS | Domain → its authoritative servers | Delegation |
| SRV | Service → host and port | Some service discovery |
| CAA | Which CAs may issue certificates | Certificate security |
| PTR | IP → name | Reverse lookup |

### 4.2 A full lookup, step by step

1. The app asks the operating system's stub resolver for api.example.com.
2. The stub asks a recursive resolver (ISP, company, or a public one).
3. If not cached, the resolver asks a root server: "who handles .com?"
4. The .com servers reply with the NS records for example.com.
5. The example.com authoritative server returns the A record with a TTL, for example 300 seconds.
6. The resolver caches it for 300 seconds and answers; later users get the cached answer instantly.

```
$ dig api.example.com +short
203.0.113.20
$ dig api.example.com    # full answer shows: api.example.com.  300  IN  A  203.0.113.20
```

Negative answers ("name does not exist") are cached too, so a record created right after someone looked it up may stay invisible for a while.

### 4.3 TTL strategy, worked

You are moving api.example.com to a new load balancer. The record's TTL is 86,400 seconds (one day).

1. Two days before: lower the TTL to 60 seconds; wait for the old one-day caches to expire.
2. Migration day: change the record; most clients switch within minutes.
3. Keep the old target running for a day for stragglers that ignore TTLs.
4. After success, raise the TTL again (for example to 3,600 seconds) to cut lookup load.

### 4.4 DNS as traffic control

GeoDNS and latency-based routing answer each user with the nearest region; health-checked failover stops returning unhealthy endpoints. Limits: clients and resolvers cache answers for the TTL, so failover is never instant, and some clients cache longer than told. The apex of a domain (example.com) cannot be a CNAME, so providers offer ALIAS or ANAME-style records instead.

### 4.5 Security

DNSSEC signs records so resolvers can detect forged answers. DNS over HTTPS or TLS encrypts queries between clients and resolvers for privacy. Registrar account security matters: a hijacked domain redirects everything.

### 4.6 Failures

| Failure | Symptom | Why it happens | Fix |
| --- | --- | --- | --- |
| Bad record pushed | Site unreachable | Typo or wrong target | Review DNS changes as code; quick rollback |
| Slow migration | Some users hit the old server for a day | Long TTL still cached | Lower TTL days in advance |
| DNS provider outage | Many sites unreachable at once (as in the 2016 Dyn DDoS) | Single provider | Secondary DNS provider |
| Domain expired | Everything down | Missed renewal | Auto-renew; expiry alerts |
| New record invisible | NXDOMAIN for minutes | Negative caching | Create records before announcing them |

### 4.7 Interview questions

1. Why is DNS failover not instant? Resolvers and clients cache answers for the TTL, and some ignore it.
2. CNAME versus A? A gives an IP; CNAME points to another name that is then resolved.
3. What happens on a cache miss for a new domain? The resolver walks root → TLD → authoritative servers, then caches the answer.

## Lesson 5: TCP in Depth

TCP turns an unreliable packet network into a reliable, ordered byte stream. It does this with sequence numbers, acknowledgements, retransmission, flow control (do not overwhelm the receiver) and congestion control (do not overwhelm the network).

### 5.1 The handshake, with numbers

| Step | Sender | Flags | Sequence | Acknowledgement |
| --- | --- | --- | --- | --- |
| 1 | Client | SYN | 1000 (random start) | — |
| 2 | Server | SYN + ACK | 5000 (random start) | 1001 |
| 3 | Client | ACK | 1001 | 5001 |

Now the client sends 500 bytes with sequence 1001; the server replies with acknowledgement 1501, meaning "I have everything before byte 1501". Missing bytes are detected because the acknowledgement stops advancing.

### 5.2 Flow control

The receiver advertises a window: how many more bytes it can buffer. If an app reads slowly, the window shrinks to zero and the sender pauses. Window scaling lets windows grow beyond 64 KB, which long, fast links need.

### 5.3 Congestion control and slow start, worked

The sender also keeps a congestion window (cwnd) limiting data in flight. A new connection starts small (commonly 10 packets ≈ 14.6 KB) and doubles every round trip while no loss occurs.

| Round trip | cwnd (packets) | Sent so far |
| --- | --- | --- |
| 1 | 10 | 10 (≈ 15 KB) |
| 2 | 20 | 30 |
| 3 | 40 | 70 |
| 4 | 80 | 150 |
| 5 | 160 | 310 (≈ 450 KB) |
| 6 | 320 | 630 (≈ 920 KB) |

So a 1 MB download on a fresh connection needs about 7 round trips: with a 30 ms round trip, roughly 200 ms even on a fast link. Reusing warm connections avoids slow start repeatedly.

On loss, classic algorithms cut the window sharply (Reno halves it); CUBIC (the Linux default) regrows it along a cubic curve; BBR estimates bandwidth and round-trip time directly instead of treating loss as the main signal, which helps on lossy links.

### 5.4 Retransmission

If no acknowledgement arrives within the retransmission timeout, data is resent and the timeout doubles. If the receiver keeps acknowledging the same byte (three duplicate ACKs), the sender retransmits immediately (fast retransmit) without waiting.

### 5.5 Closing and TIME\_WAIT

Connections close with FIN packets in each direction. The side that closes first waits in TIME\_WAIT (often about a minute) so late packets from the old connection cannot confuse a new one using the same ports.

### 5.6 Latency traps

Nagle's algorithm delays small writes to batch them; combined with delayed acknowledgements on the other side, small request-response protocols can stall for tens of milliseconds. Latency-sensitive apps set TCP\_NODELAY. Head-of-line blocking: one lost packet holds back all later bytes on the connection, even if they belong to unrelated requests.

### 5.7 Failures

| Failure | Symptom | Why it happens | Fix |
| --- | --- | --- | --- |
| Ephemeral port exhaustion | "Cannot assign requested address" | New connection per request; thousands stuck in TIME\_WAIT (about 28,000 ports by default on Linux) | Connection pooling and keep-alive |
| SYN flood | Server stops accepting connections | Attackers send SYNs without completing handshakes | SYN cookies, DDoS protection |
| Slow downloads on long links | Throughput far below bandwidth | Receive window smaller than the bandwidth-delay product (Lesson 11) | Window scaling, tuned buffers |
| 40 ms stalls on small messages | Odd fixed delays | Nagle plus delayed ACK | TCP\_NODELAY |
| Throughput collapses on mobile | Many retransmissions | Packet loss treated as congestion | BBR, or QUIC with better loss recovery |

### 5.8 Interview questions

1. Why a three-way handshake? Both sides must agree on starting sequence numbers and confirm the other can receive.
2. What limits throughput on a high-latency link? The window: throughput ≤ window ÷ round-trip time.
3. What is TIME\_WAIT for? Absorbing delayed packets from a closed connection so they do not corrupt a new one.

## Lesson 6: UDP and QUIC

UDP sends independent datagrams with no handshake, ordering or retransmission; its header is only 8 bytes. QUIC builds a modern, encrypted, reliable transport on top of UDP, and HTTP/3 runs on QUIC.

### 6.1 When plain UDP fits

| Use | Why UDP |
| --- | --- |
| DNS queries | One small question, one small answer; retry if lost |
| Voice and video calls | Late audio is useless; skip and move on |
| Online games | Latest position matters more than old ones |
| Streaming telemetry | Losing a few samples is acceptable |

The application must handle loss, reordering and congestion itself (for example, WebRTC adds its own mechanisms).

### 6.2 What QUIC adds

| Feature | How | Benefit |
| --- | --- | --- |
| Faster setup | Transport and TLS 1.3 handshakes combined | 1 round trip for a new connection; 0 round trips when resuming |
| Independent streams | Loss on one stream does not block others | No TCP head-of-line blocking |
| Connection migration | Connections identified by IDs, not IP and port | Phone switches from Wi-Fi to 4G without reconnecting |
| Always encrypted | Encryption built in, including most headers | Privacy; middleboxes cannot ossify the protocol |
| User-space implementation | Lives in apps and libraries, not the OS kernel | Faster evolution of congestion control |

### 6.3 Head-of-line blocking, worked

A page loads 10 images over one HTTP/2 connection on TCP. One packet carrying part of image 2 is lost. TCP delivers bytes in order, so data for images 3-10 that already arrived waits until the lost packet is retransmitted, about one extra round trip. Over HTTP/3 on QUIC, only image 2's stream waits; the other nine continue. On lossy mobile networks this noticeably improves load times.

### 6.4 0-RTT caution

Resumed QUIC (and TLS 1.3) connections can send data in the very first packet, but an attacker can replay that first flight. Servers should accept 0-RTT only for safe, idempotent requests such as GETs.

### 6.5 Failures

| Failure | Symptom | Why it happens | Fix |
| --- | --- | --- | --- |
| HTTP/3 fails on some networks | Slow first loads, fallback delays | Corporate firewalls block or throttle UDP | Race QUIC and TCP; fall back quickly |
| Higher server CPU | More CPU per byte than TCP | User-space processing, encryption of every packet | Offloads, efficient libraries, capacity planning |
| Replay of 0-RTT requests | Duplicate actions | Early data accepted for non-idempotent requests | Limit 0-RTT to safe methods |
| UDP floods | Overloaded services | No handshake makes spoofing easy | Rate limits, DDoS protection, address validation |

### 6.6 Interview questions

1. Why build QUIC on UDP instead of changing TCP? TCP lives in operating systems and middleboxes that are slow to change; UDP passes through and QUIC can evolve in apps.
2. What problem of HTTP/2 does HTTP/3 fix? TCP-level head-of-line blocking across multiplexed streams.
3. Why is 0-RTT dangerous for payments? The early data can be replayed, repeating the action.

## Lesson 7: HTTP/1.1, HTTP/2 and HTTP/3

HTTP's meaning (methods, status codes, headers) has stayed the same for decades; what changed is how messages travel on the wire. Each version fixed the main performance problem of the one before.

### 7.1 Anatomy of a request and response

```
GET /v1/restaurants?lat=12.97&lng=77.59 HTTP/1.1
Host: api.example.com
Authorization: Bearer eyJ...
Accept-Encoding: br, gzip

HTTP/1.1 200 OK
Content-Type: application/json
Content-Encoding: br
Cache-Control: private, max-age=30
ETag: "v42"

{"restaurants": [...]}
```

### 7.2 The three versions

|  | HTTP/1.1 | HTTP/2 | HTTP/3 |
| --- | --- | --- | --- |
| Transport | TCP | TCP | QUIC over UDP |
| Format | Text | Binary frames | Binary frames |
| Concurrency | One request at a time per connection; browsers open \~6 connections per host | Many streams multiplexed on one connection | Many independent streams |
| Header compression | None | HPACK | QPACK |
| Main remaining problem | Many connections, slow starts | TCP head-of-line blocking on loss | UDP blocked on some networks |

Worked example: a page needs 60 small files. With HTTP/1.1 and 6 connections, the browser loads 6 at a time, about 10 waves of round trips. With HTTP/2 all 60 requests go out at once on one warm connection, finishing in a few round trips. With HTTP/3 the same, and one lost packet no longer stalls the others.

### 7.3 Headers that matter in system design

| Header | Purpose |
| --- | --- |
| Cache-Control, ETag, If-None-Match | Caching and revalidation (304 Not Modified) |
| Content-Encoding | Compression (Brotli, gzip) |
| Retry-After | How long to wait after 429 or 503 |
| Idempotency-Key (common convention) | Safe retries of writes |
| traceparent | Distributed tracing context |
| X-Forwarded-For / Forwarded | Original client IP behind proxies |

### 7.4 Status codes that cause confusion

| Code | Meaning | Typical cause |
| --- | --- | --- |
| 301 / 308 | Permanent redirect (308 keeps the method) | Moved resources |
| 302 / 307 | Temporary redirect (307 keeps the method) | Short links, login flows |
| 429 | Too many requests | Rate limit |
| 502 | Proxy got an invalid response from the backend | Backend crashed or closed the connection |
| 503 | Service unavailable | Overload, no healthy backends, maintenance |
| 504 | Proxy timed out waiting for the backend | Slow backend, timeout mismatch |

### 7.5 Failures

| Failure | Symptom | Why it happens | Fix |
| --- | --- | --- | --- |
| 431 or 400 on some users only | Requests rejected | Huge cookies make headers too large | Trim cookies; store state server-side |
| 413 Payload Too Large | Uploads fail | Proxy body-size limit | Raise limit or upload directly to object storage |
| 504 after exactly 60 s | Long requests cut off | Proxy timeout shorter than backend work | Align timeouts; make long work asynchronous |
| HTTP/2 slower than HTTP/1.1 on lossy mobile | Stalls | All streams share one TCP connection | HTTP/3 |
| Wrong client IP in logs | All requests from the load balancer IP | Not reading forwarded headers from trusted proxies | Use the forwarded header from trusted hops only |

### 7.6 Interview questions

1. Why did browsers open several connections per host with HTTP/1.1? Each connection carried one request at a time.
2. What is HTTP/2 multiplexing? Many request and response streams interleaved as frames on one connection.
3. 502 versus 504? 502: the backend's answer was invalid or the connection broke; 504: no answer in time.

## Lesson 8: TLS 1.3 in Depth

TLS gives three guarantees: confidentiality (nobody can read the traffic), integrity (nobody can change it unnoticed) and authentication (you are talking to the real server). TLS 1.3 does this in a single round trip on top of TCP.

### 8.1 The handshake

> *Diagram in the original artifact: TCP and TLS 1.3 handshakes before the first HTTP request*

1. ClientHello: the client sends supported cipher suites, a key share (its half of an elliptic-curve Diffie-Hellman exchange) and the server name it wants (SNI).
2. ServerHello: the server picks a cipher and sends its key share. Both sides now compute the same secret without ever sending it.
3. Still in the same flight, encrypted: the server's certificate, a signature proving it holds the certificate's private key, and Finished.
4. The client verifies the certificate chain and signature, sends its Finished, and immediately sends the HTTP request.

Because session keys come from fresh key shares (ephemeral Diffie-Hellman), stealing the server's long-term key later cannot decrypt past traffic: this is forward secrecy.

### 8.2 Certificate chain validation

```
Leaf:          api.example.com          signed by →
Intermediate:  Example CA R3            signed by →
Root:          Example Root CA          (pre-installed in the device's trust store)
```

The client checks: the name matches; the dates are valid; each signature verifies up to a trusted root; and the certificate is not revoked (servers can staple a fresh revocation status, OCSP stapling, to save the client a lookup).

### 8.3 Practical features

SNI lets one IP host many domains with different certificates. Session resumption reuses a previous secret for faster reconnects, optionally with 0-RTT early data (replayable, so only for safe requests). Mutual TLS (mTLS) also authenticates the client with its own certificate, common between internal services. TLS termination at a load balancer decrypts at the edge; traffic to backends is re-encrypted when the internal network is not trusted.

### 8.4 Worked failure: the missing intermediate

A team installs only the leaf certificate on a new server. Desktop browsers still work, because they can fetch missing intermediates on their own. Android apps, curl and backend services fail with "unable to get local issuer certificate". The fix is to serve the full chain (leaf plus intermediates). Test with `openssl s_client -connect api.example.com:443 -servername api.example.com -showcerts`.

### 8.5 Failures

| Failure | Symptom | Why it happens | Fix |
| --- | --- | --- | --- |
| Expired certificate | Errors everywhere at once | Manual renewal | Automated renewal, expiry alerts |
| Missing intermediate | Some clients fail | Incomplete chain served | Serve the full chain |
| Name mismatch | Certificate error on one hostname | Hostname not in the certificate | Add the name (SAN) or a correct wildcard |
| Old clients cannot connect | Handshake failures | Only modern protocol versions and ciphers enabled | Decide supported clients; keep a compatible profile if needed |
| Clock wrong on a device | "Certificate not yet valid" | Device time incorrect | Time sync |
| Pinned certificate rotated | App cannot connect after rotation | App pinned the old key | Pin to a backup key or CA; plan rotation |

### 8.6 Interview questions

1. How does TLS 1.3 achieve one round trip? Key shares are sent in the first messages, so keys are ready after ServerHello.
2. What is forward secrecy? Past sessions stay safe even if the server's long-term key is stolen later.
3. What does SNI solve? Hosting many HTTPS domains on one IP address.

## Lesson 9: NAT, Firewalls and Proxies

These are the middleboxes that rewrite, filter or relay traffic. Many "mysterious" production failures come from their hidden limits.

### 9.1 NAT, worked

Network address translation lets many private machines share one public IP. The NAT device rewrites the source address and port and remembers the mapping:

| Direction | Before NAT | After NAT |
| --- | --- | --- |
| Out | 10.0.1.5:54321 → 203.0.113.8:443 | 198.51.100.7:40001 → 203.0.113.8:443 |
| Back | 203.0.113.8:443 → 198.51.100.7:40001 | 203.0.113.8:443 → 10.0.1.5:54321 |

A limit follows: one public IP has about 64,000 source ports per destination IP and port. A fleet making many simultaneous connections to a single external API through one NAT IP can run out of ports, and new connections fail.

Carrier-grade NAT (CGNAT) puts many ISP customers behind shared addresses, which is why IP-based rate limits can block whole neighborhoods.

### 9.2 NAT traversal for peer-to-peer

Two phones behind different NATs cannot simply connect. WebRTC uses ICE: STUN servers tell each side its public address, both try direct paths, and if that fails, a TURN server relays the media (reliable but costly in bandwidth).

### 9.3 Firewalls: stateful versus stateless

|  | Stateful (e.g. cloud security groups) | Stateless (e.g. network ACLs) |
| --- | --- | --- |
| Tracks connections | Yes: replies are allowed automatically | No: every packet checked independently |
| Rules needed for replies | None | Must allow return traffic, including ephemeral ports |
| Typical use | Per-instance allow lists | Coarse subnet-level guards |

Stateful firewalls keep a connection-tracking table; if it fills up under heavy load, new connections are dropped silently.

### 9.4 Proxies

A forward proxy acts for clients (company egress control, allowlisted outbound domains). A reverse proxy acts for servers (Nginx, Envoy, cloud load balancers): TLS termination, routing, caching, compression, rate limits, retries. A transparent proxy intercepts traffic without client configuration. Behind proxies, the real client IP is carried in X-Forwarded-For or Forwarded headers, which must be trusted only from known proxy hops.

### 9.5 Failures

| Failure | Symptom | Why it happens | Fix |
| --- | --- | --- | --- |
| NAT port exhaustion | Intermittent connection failures to one external API | Too many concurrent connections through one NAT IP | Connection pooling, more NAT IPs, private endpoints |
| Connection-tracking table full | Random drops at peak | Stateful firewall table limit | Raise limits, shorter timeouts, reduce connection churn |
| Replies blocked | Outbound requests time out | Stateless ACL missing ephemeral return ports | Allow return port range |
| Idle connections dropped | Long-lived connections die silently | NAT or firewall idle timeout shorter than the app's | Keep-alives below the idle timeout |
| Spoofed client IP | Rate limits bypassed | Trusting X-Forwarded-For from anyone | Only trust headers set by your own proxies |
| WebRTC calls fail on strict networks | No media | No TURN fallback | Run TURN servers |

### 9.6 Interview questions

1. Why can a NAT run out of ports? Each outbound connection to the same destination needs a unique public source port, about 64,000 per public IP.
2. Security group versus network ACL? Stateful per-instance versus stateless per-subnet; ACLs need explicit return rules.
3. Forward versus reverse proxy? A forward proxy represents clients; a reverse proxy represents servers.

## Lesson 10: Cloud and Data Center Networking

A cloud network (VPC) is a private address space split into subnets per availability zone, with route tables deciding where traffic goes and firewalls deciding what is allowed. Underneath, data centers use a spine-leaf fabric so any server reaches any other in a few hops.

### 10.1 A standard three-tier VPC

> *Diagram in the original artifact: Three-tier VPC across three availability zones*

| Subnet tier | Route for 0.0.0.0/0 | What lives there | Reachable from internet? |
| --- | --- | --- | --- |
| Public | Internet gateway | Load balancer nodes, NAT gateways, bastion (if any) | Yes, through the load balancer |
| App (private) | NAT gateway (outbound only) | App servers, Kubernetes nodes and pods | No |
| Database (private) | None | Databases, caches | No |

The /20 subnets (4,096 addresses each) leave room for pods, which often take one IP each, and the /16 leaves space for more tiers later.

### 10.2 Connecting networks

VPC peering joins two VPCs privately, but it is not transitive: if A peers with B and B with C, A cannot reach C through B. Transit gateways act as a hub for many VPCs and VPNs. Private endpoints let services reach managed services (object storage, databases, partner APIs) without the internet or NAT, which also avoids NAT costs and port limits. Inside a VPC, private DNS names map to private IPs.

### 10.3 Costs and latency

Traffic within an availability zone is cheapest and fastest (well under a millisecond); traffic across zones adds latency (often around a millisecond) and usually costs money per GB; traffic to the internet costs the most. Chatty services placed in different zones can create surprising bills.

### 10.4 Inside the data center: spine-leaf

Each rack has a leaf switch; every leaf connects to every spine switch. Any two servers are at most leaf → spine → leaf apart, and ECMP spreads flows across all spines, giving predictable latency and plenty of east-west bandwidth for service-to-service and training traffic.

### 10.5 Kubernetes networking

Every pod gets its own IP. A Service gives a stable virtual IP and DNS name; kube-proxy (iptables or IPVS) or eBPF-based dataplanes forward that IP to healthy pods. Ingress or gateway controllers bring outside traffic in. Network policies restrict which pods may talk. Service meshes add sidecars or node proxies for mTLS, retries and telemetry.

### 10.6 Failures

| Failure | Symptom | Why it happens | Fix |
| --- | --- | --- | --- |
| Database reachable from the internet | Security finding or breach | Placed in a public subnet or open security group | Database tier with no internet route; least-privilege rules |
| Cannot reach a peered VPC's peer | Timeouts | Peering is not transitive | Transit gateway or direct peering |
| High NAT bill | Cost spike | Large outbound traffic (images, backups) through NAT | Private endpoints, same-zone placement |
| Pods cannot schedule | IP exhaustion | Small subnets, one IP per pod | Larger or secondary ranges |
| Cross-zone latency and cost | Slow chatty calls, bills | Services scattered across zones | Zone-aware routing; co-locate chatty services |
| Single NAT gateway | Outbound fails when its zone fails | One NAT for all zones | One NAT gateway per zone |

### 10.7 Interview questions

1. Why put app servers in private subnets? They should not be directly reachable; the load balancer is the only entry point, and outbound goes through NAT.
2. Is VPC peering transitive? No.
3. Why one NAT gateway per zone? A zone failure should not cut outbound access for the other zones.

## Lesson 11: Performance Math

A handful of formulas explain most network performance: where latency comes from, how much data must be in flight to fill a link, and why fan-out makes tail latency dominate.

### 11.1 Where latency comes from

| Component | What it is | Worked example |
| --- | --- | --- |
| Propagation | Signal travel time; light in fiber covers about 200 km per millisecond | Fiber paths between Bengaluru and Mumbai of roughly 1,000-1,400 km take about 5-7 ms one way |
| Transmission | Time to push bits onto the link: size ÷ bandwidth | 1 MB at 100 Mbps = 8 Mb ÷ 100 Mbps = 80 ms |
| Queuing | Waiting in buffers when links are busy | Spikes under congestion ("bufferbloat") |
| Processing | Routers, firewalls, TLS, servers | Usually small per hop; servers often dominate |

Propagation cannot be optimized away, only avoided by moving servers closer (CDNs, regional deployments).

### 11.2 Bandwidth-delay product

```latex
\text{BDP} = \text{bandwidth} \times \text{RTT}, \qquad \text{throughput} \le \frac{\text{window}}{\text{RTT}}
```

Example: a 1 Gbps link with 100 ms round trip has BDP = 1e9 × 0.1 = 100 Mb = 12.5 MB that must be in flight to use the link fully. A 64 KB window allows only 64 KB ÷ 0.1 s = 640 KB/s ≈ 5 Mbps, about 0.5% of the link.

Worked transfer: copying 1 GB from India to a US region (round trip ≈ 250 ms) on one TCP connection with a 4 MB window gives at most 4 MB ÷ 0.25 s = 16 MB/s, so about 64 seconds. Larger windows, parallel streams, or copying from a nearer region speed it up.

### 11.3 Tail latency and fan-out

If one backend call is slow 1% of the time, a request that waits for 100 such calls is fast only when all 100 are fast: 0.99^100 ≈ 0.37. So about 63% of user requests hit at least one slow call. That is why p99 of each dependency matters, and why hedged requests, timeouts and fewer fan-out calls help.

### 11.4 Sizing connection pools with Little's Law

```latex
\text{concurrent connections} = \text{request rate} \times \text{average latency}
```

Example: 2,000 requests per second to a database with 50 ms average latency needs about 2,000 × 0.05 = 100 connections in use; size the pool with headroom (for example 150) and check the database's connection limit across all app instances.

### 11.5 An API latency budget

| Step | Budget |
| --- | --- |
| DNS (cached) | 0-5 ms |
| TCP + TLS (reused connection) | 0 ms (new: 2 round trips) |
| Edge to region network | 10-30 ms |
| Load balancer and gateway | 1-3 ms |
| Service logic | 10-30 ms |
| Database query | 5-20 ms |
| Response transfer | 1-10 ms |
| Target p99 | 200 ms |

### 11.6 Interview questions

1. Why is a long-distance transfer slow on a fast link? The window limits data in flight; throughput ≤ window ÷ RTT.
2. How long to send 10 MB at 50 Mbps ignoring latency? 80 Mb ÷ 50 Mbps = 1.6 s.
3. Why does fan-out hurt p99? The chance that at least one of many calls is slow grows quickly with the number of calls.

## Lesson 12: Debugging Tools, Failure Catalog and a Production Incident

Network debugging is narrowing down which layer and which hop is wrong. The right tool for each question saves hours.

### 12.1 Tools

| Question | Tool | Example |
| --- | --- | --- |
| Does the name resolve, and to what? | dig | `dig api.example.com +short` |
| Is the host reachable at all? | ping | `ping -c 5 10.0.48.12` (ICMP may be blocked) |
| Where does the path break or slow down? | traceroute, mtr | `mtr api.example.com` |
| Can I open the port? | nc | `nc -vz db.example.com 5432` |
| Is the certificate right? | openssl | `openssl s_client -connect host:443 -servername host` |
| Which step of a request is slow? | curl timings | see below |
| What connections exist and in what state? | ss | `ss -tanp state time-wait \| wc -l` |
| What is actually on the wire? | tcpdump, Wireshark | `tcpdump -i eth0 port 443 -w capture.pcap` |
| Which route does this host use? | ip route | `ip route get 10.1.2.5` |

Curl timing breakdown:

```
$ curl -o /dev/null -s -w "dns %{time_namelookup} connect %{time_connect} tls %{time_appconnect} ttfb %{time_starttransfer} total %{time_total}\n" https://api.example.com/health
dns 0.004 connect 0.031 tls 0.062 ttfb 0.410 total 0.412
```

Reading it: DNS 4 ms, TCP about 27 ms, TLS about 31 ms, then about 348 ms waiting for the first byte. The network is fine; the server is slow.

### 12.2 Debugging by symptom

1. Name does not resolve → DNS records, resolver, negative caching.
2. Resolves but timeouts → routes, security groups, ACLs, firewall drops (try `nc` from the same subnet).
3. Connection refused → service not listening on that address or port.
4. TLS errors → certificate chain, name, dates, client trust store.
5. Slow first byte → server or dependency time (traces).
6. Intermittent failures → NAT ports, connection tracking, keep-alive mismatches, DNS rotation, one bad host or zone.

### 12.3 Failure catalog

| Failure | Symptom | Why it happens | Fix |
| --- | --- | --- | --- |
| Stale DNS after migration | Some users hit old servers | Long TTLs, clients caching | Lower TTL ahead; keep old target alive |
| Security group missing a rule | Timeouts to one port | Rule never added or removed | Rules as code with review and tests |
| Keep-alive mismatch | Low steady 502s | Backend closes idle connections before the proxy | Backend timeout longer than proxy idle timeout |
| NAT port exhaustion | Intermittent failures to one external host | Too many connections through one NAT IP | Pooling, more NAT IPs, private endpoints |
| MTU black hole | Small requests work, large hang | Fragmentation-needed messages blocked | Allow ICMP; MSS clamping |
| Cross-zone surprise | Latency and bill increase | Chatty services in different zones | Zone-aware routing |
| Expired or incomplete certificate | TLS failures for some clients | Renewal or chain issues | Automation and full chains |
| Conntrack table full | Random drops at peak | Stateful firewall limit | Raise limits, reduce churn |

### 12.4 Production incident walkthrough

**Incident: payment calls fail 2% of the time at peak.**

| Time | Observation | Reasoning | Action |
| --- | --- | --- | --- |
| 20:05 | 2% of calls to the payment provider time out at connect | Only one destination affected | Check NAT metrics |
| 20:10 | NAT gateway shows port allocation errors to that provider's IP | \~64,000 ports per destination per NAT IP exhausted | Scale out NAT IPs (mitigation) |
| 20:20 | App opens a new HTTPS connection per payment | No connection reuse | Enable keep-alive and pooling |
| Next day | Errors gone; connections per second to the provider down 95% | Root cause fixed | Alert on NAT port usage |

### 12.5 Interview questions

1. curl shows ttfb 2 s but connect 20 ms. Where is the problem? On the server side (application or dependencies), not the network.
2. A connection to port 5432 is refused. What do you check? Whether the database is listening on that interface and port, not firewalls (a firewall usually causes a timeout).
3. Intermittent timeouts to one third-party API only. First suspect? NAT port exhaustion or connection churn; check NAT metrics and connection reuse.
