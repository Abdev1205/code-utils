# How Telephony Works

**Topic:** Telephony
**Covers:** PSTN, SIP, SDP, RTP, codecs, SFU vs MCU, DTMF, transfer
**Source:** [Claude artifact](https://claude.ai/artifact/GcwiraCu1UmwqmX88LM1pJ) — written by a colleague, mirrored here for study.

*From the copper wire to the bot*

A customer dials a number on an ordinary phone and a Python program answers. Between those two facts sit about sixty years of infrastructure. This explains all of it from nothing — what each piece is, why it exists, what we use, and what the alternatives were.

## What is a phone call?

*The old world · 01*

Start with the physical thing, because every abstraction later is a copy of it.

Originally: two telephones joined by a copper wire. You speak, a membrane vibrates, that vibration becomes a varying electrical current, the current travels the wire, and at the far end it pushes another membrane which pushes air into the other person's ear.

A continuous electrical copy of your voice, travelling down a wire. That's a phone call.

**Two things had to be solved, and they stayed separate forever**

**1. Connecting.** How does the network know which of a billion phones you want, and how does it make that phone ring? Originally a human operator physically plugging a cable into a socket.

**2. Carrying.** Once connected, how does the sound get across?

These are still two separate systems today, with different names and different protocols. **Signalling** sets up the call. **Media** carries the audio. Keep them apart in your head and everything else makes sense.

Modern networks digitised both. The sound became numbers (see the voice runtime document for what that means), and the human operator became software. But the two-part structure never changed.

## The PSTN

*The old world · 02*

**What it is**

**PSTN** — Public Switched Telephone Network. The global phone system: every landline, every mobile network, every telephone exchange, all interconnected. It is the biggest machine humans have built and it has been running continuously for over a century.

What matters for us is what it implies:

- **It is old and it does not change.** Its constraints were fixed in the 1960s and you inherit them. That is why phone audio is 8,000 samples per second and sounds worse than a podcast.
- **You cannot plug into it directly.** A Python program cannot dial a number. You must go through a licensed carrier.
- **It is regulated.** Phone numbers are allocated by governments. Which is why "get a phone number for the bot" is a procurement task, not a coding task.

So the first question for any voice-bot company is: *how do we get our software connected to this thing?* The answer is a **SIP trunk**, which we'll come to.

## SIP — the signalling

*The old world · 03*

**What it is**

**SIP** — Session Initiation Protocol. The language phones use to *set up, change and end* calls. It carries no audio at all. It is the modern replacement for the human operator with the plug.

SIP looks startlingly like HTTP — plain text, verbs, numeric status codes. If you know web requests, you already half know SIP:

```
INVITE sip:+919876543210@carrier.example SIP/2.0
From: <sip:+911140001234@ourcompany.example>
To:   <sip:+919876543210@carrier.example>
Call-ID: a84b4c76e66710
Contact: <sip:10.0.1.5:5060>
Content-Type: application/sdp

v=0
m=audio 30000 RTP/AVP 0        ← "send audio to port 30000, using codec 0"
a=rtpmap:0 PCMU/8000
```

The main verbs:

| Verb | Meaning |
| --- | --- |
| `INVITE` | please start a call with me |
| `ACK` | confirmed, we're connected |
| `BYE` | hang up |
| `CANCEL` | stop ringing, I've changed my mind |
| `REFER` | transfer this call to someone else |

And the responses, which will look familiar:

```
100 Trying        the network is working on it
180 Ringing       their phone is ringing
200 OK            they answered
486 Busy Here     they're on another call
404 Not Found     no such number
```

**SDP — the part that matters most**

Inside the INVITE is a block called **SDP** (Session Description Protocol). This is where the two sides negotiate *how* the audio will flow: which IP address, which port, which codecs each side can handle.

Think of SIP as the phone call between two receptionists arranging a meeting, and SDP as the part where they agree the room number. **When audio doesn't flow but the call "connects", the bug is almost always in SDP.**

**Alternatives to SIP**

- **H.323** — the older standard. More complex, binary, largely dead outside legacy video conferencing.
- **Proprietary carrier protocols** — exist, but nobody chooses them.
- **WebRTC signalling** — deliberately unspecified; you use whatever you like (usually websockets). Fine on the internet, useless for reaching a telephone.

There is effectively no alternative. If you want to touch the phone network, you speak SIP — or you pay someone who does.

## RTP — the audio

*The old world · 04*

**What it is**

**RTP** — Real-time Transport Protocol. Once SIP has agreed where to send audio, RTP is what actually carries it. Small packets of sound, roughly 50 per second, each carrying 20 milliseconds of voice.

The design decision that defines RTP: **it runs over UDP, not TCP.**

| | TCP | UDP |
| --- | --- | --- |
| Lost packet | retransmitted | gone forever |
| Guarantees | everything arrives, in order | none |
| Cost of that | waiting | — |

TCP sounds obviously better until you think about a live conversation. If a packet of audio is lost, retransmitting it takes time — and by the time the replacement arrives, that moment has already passed. You'd be inserting stale audio into a live conversation, and everything behind it would be delayed too.

**For live audio, late is worse than missing.** A single lost 20 ms packet is a tiny click nobody notices. A 300 ms stall to recover it is a stutter everybody notices.

**The vocabulary you'll hear**

- **Jitter** — Packets arriving unevenly — some early, some late. Fixed with a *jitter buffer*: hold a little audio in reserve and play it out smoothly. Costs latency, buys smoothness.
- **Packet loss** — Packets that never arrive. Under about 1% is inaudible; above 5% is unusable.
- **One-way audio** — The classic telephony bug — you can hear them, they can't hear you. Almost always SDP or firewall: audio is being sent to an address that can't be reached.

## Codecs, and why phones sound bad

*The old world · 05*

**What a codec is**

Short for **co**der–**dec**oder. It decides how sound is turned into bytes and back. Different codecs trade quality against bandwidth.

| Codec | Rate | Bandwidth | Where |
| --- | --- | --- | --- |
| **G.711** (PCMU/PCMA) | 8 kHz | 64 kbps | The telephone network. Ancient, universal, uncompressed |
| **Opus** | up to 48 kHz | ~32 kbps | WebRTC and the internet. Modern, better quality at half the bandwidth |
| **G.729** | 8 kHz | 8 kbps | Old bandwidth-constrained links. Compressed, worse quality |

Notice: Opus is better quality *and* uses less bandwidth. So why is the phone network still on G.711?

Because it works everywhere, needs almost no CPU, and replacing it means replacing every switch on Earth. Inertia at planetary scale.

**What this costs us**

8 kHz can only represent frequencies up to 4 kHz. Human speech has useful information above that — the difference between "s" and "f" lives up there. That information is *gone* before the audio reaches us. We cannot recover it.

This is why speech recognition is measurably harder on phone calls than on a laptop microphone, and why some vendors are much better at telephone audio than others. When you compare STT accuracy, always compare on 8 kHz.

### Transcoding

Our bot lives on the internet side, speaking Opus. The caller is on the phone network, speaking G.711. Something must translate, in both directions, in real time:

```
caller speaks   G.711 8 kHz  ──►  [transcode]  ──►  Opus 48 kHz   bot hears
bot speaks      Opus 48 kHz  ──►  [transcode]  ──►  G.711 8 kHz   caller hears
```

LiveKit does this for us. It costs a little CPU and a little latency, and upsampling to 48 kHz doesn't add real information — it just makes the format match.

## SIP trunks

*The old world · 06*

**What it is**

A **SIP trunk** is a commercial connection between your software and a licensed carrier. They have the legal right and physical connection to the phone network; you rent access. They give you phone numbers, and they translate between SIP-on-the-internet and the real PSTN.

Concretely: you sign up with Twilio or Telnyx, buy a number, point it at your server's address, and now calls to that number arrive as SIP INVITEs.

**Alternatives — who you can buy this from**

| Option | Character |
| --- | --- |
| **Twilio** | The default. Excellent docs and tooling, global, most expensive. |
| **Telnyx** | Cheaper, own network, good quality. Common Twilio alternative. |
| **Plivo / Vonage / Bandwidth** | Similar tier, differ by region and pricing. |
| **Exotel / Knowlarity / Ozonetel** | India-focused. Matter enormously if your customers are Indian — local numbers, local regulation, local support. |
| **Direct carrier interconnect** | Contract straight with a telco. Cheapest per minute at very high volume, months of procurement, and you build the SIP infrastructure yourself. This is Path B below. |

The trade is the usual one: managed providers cost more per minute and give you a working system today; direct interconnect costs less per minute and requires you to become a telephony company.

## WebRTC

*The new world · 07*

**What it is**

**WebRTC** — Web Real-Time Communication. The standard that lets browsers and apps do live audio and video without a plugin. It's what powers Google Meet, Discord, and the "try it in your browser" button on our own product.

It solves the same two problems as the phone network — connect, then carry — but for the modern internet, where both parties are usually behind home routers and firewalls that block incoming connections.

**The vocabulary**

- **ICE** — The process of discovering a path between two machines behind routers. Both sides gather every address they might be reachable on and try them all.
- **STUN** — A tiny server that tells you your own public address, which you can't otherwise know from behind a router.
- **TURN** — A relay for when no direct path exists. Costs bandwidth, always works. The fallback of last resort.
- **SRTP** — Encrypted RTP. WebRTC mandates encryption; the old phone network usually doesn't.

### SFU — the piece our architecture depends on

When more than two parties are in a call, someone must route the audio. Three approaches:

| Approach | How | Trade-off |
| --- | --- | --- |
| **Mesh** | everyone sends to everyone | Simple; collapses past 3–4 people |
| **MCU** | a server mixes everything into one stream | Cheap for clients, expensive server CPU, and **you can't separate the speakers again** |
| **SFU** (used here) | a server forwards packets without mixing | Scales well, and every participant stays separate |

**Why SFU matters specifically for a voice bot**

Because the caller's audio and the bot's audio stay **separate streams**. That's what makes it possible to record them on separate channels, run speech recognition on only the caller, and detect barge-in. An MCU would mix them into one stream and all three become much harder or impossible.

## LiveKit, the bridge

*The new world · 08*

**What it is**

**LiveKit** is the piece in the middle. It speaks SIP and RTP to the phone network on one side, and WebRTC to our bot on the other, and translates between them — including transcoding G.711 to Opus.

It also organises calls into **rooms**: a room contains participants, and both the human caller and our bot are just participants in the same room.

```
☎ caller  ──SIP/RTP──►  LiveKit Cloud  ──WebRTC──►  our agent
              G.711        (SFU +           Opus       (Python)
                        transcoding)
```

That room abstraction is what makes transfers and supervisor listen-in conceptually easy: add another participant.

### How our bot gets summoned

Our voice runtime doesn't listen on a port waiting for calls. It **registers as a worker** with LiveKit and waits to be given a job:

```
1. our process starts, connects out to LiveKit, says "I am entrypoint-bridge, I'm available"
2. a call arrives, LiveKit creates a room
3. LiveKit offers the job to a registered worker
4. the worker accepts, gets a token, joins the room over WebRTC
5. audio flows; the pipeline runs
```

This is why the log line `registered worker` matters — no registration, no calls, no matter how healthy the process looks.

**Alternatives to LiveKit**

| Option | Trade-off |
| --- | --- |
| **LiveKit Cloud** (used) | Managed SFU with built-in SIP. Fast to build on; a dependency and a per-minute cost. |
| **LiveKit self-hosted** | Same software, your servers. Needed for on-premise enterprise deals. |
| **Twilio Media Streams** | Twilio sends raw audio to your websocket. Simpler, but no SFU and no room model — harder to add participants or do transfers. |
| **Daily / Agora / Janus / mediasoup** | Other SFUs. Janus and mediasoup are open source, so you run and scale them yourself. |
| **Asterisk / FreeSWITCH** | The classic open-source phone platforms. Enormously capable, decades of features, and a different world to operate — you'd be running a PBX. |

LiveKit is the right pick when you want WebRTC-native, want the room model, and want SIP handled for you without becoming a telephony shop.

## Path A — the simple one

*Our two paths · 09*

Most customers. A commercial SIP trunk points straight at LiveKit.

```
Phone ──PSTN──► SIP Trunk ──SIP/RTP──► LiveKit Cloud ──WebRTC──► our agent
                (Telnyx/Twilio)         (livekit-sip)
```

| Piece | Job |
| --- | --- |
| SIP trunk provider | Bridges the real phone network to SIP. Sends INVITE to LiveKit on port 5060 |
| LiveKit Cloud | Accepts SIP, creates a room, bridges SIP ↔ WebRTC |
| Our agent | Joins the room, runs the pipeline |

Three moving parts, one vendor relationship, nothing to operate. This is the default and it should be, because every box you add is a box that can break at 3am.

## Path B — the enterprise one

*Our two paths · 10*

For a large bank, Path A is not acceptable. Their requirements force extra machinery:

| They require | So we add |
| --- | --- |
| Call traffic must never touch the public internet | AWS Direct Connect — a dedicated private 200 Mbps circuit |
| Encryption on the carrier leg | OpenSIPS terminates TLS; RTPEngine handles SRTP |
| Transfers via SIP REFER | OpenSIPS passes REFER through |
| Failover in under 5 seconds | Two OpenSIPS servers sharing a floating IP via Keepalived/VRRP |
| Their SIP dialect is non-standard | OpenSIPS config normalises the quirks |

```
Avaya (their IVR)
   │
   ▼
TP OpenSIPS + RTPEngine        ← their side: terminates TLS/SRTP
   │  TLS + SRTP
   ▼
AWS Direct Connect (private)
   │
   ▼
{{env:TELEPHONY_CUSTOMER|Customer}}-VPC OpenSIPS + RTPEngine   ← our side, inside their VPC
   │  SIP/RTP
   ▼
LiveKit Cloud
   │  WebRTC
   ▼
our agent
```

**The two new pieces**

- **OpenSIPS** — A SIP proxy. Routes and rewrites *signalling*. Touches no audio. Think of it as a programmable receptionist that speaks the carrier's dialect.
- **RTPEngine** — A media proxy. Relays and re-encrypts the *audio*. Handles SRTP so the SIP layer doesn't have to.

Note how they split along the same signalling/media line from the very first section. That division survives every layer of this stack.

**The honest cost of Path B**

Four extra pieces of infrastructure that you own, monitor and get paged for. A private circuit that takes months to procure. Failover to test. Carrier quirks to reverse-engineer.

It exists because the deal requires it, not because it is better. If a customer doesn't demand private connectivity, do not build this.

## Inbound, step by step

*Call lifecycles · 11*

```
caller dials our number
   │
   ├─ PSTN routes to whichever carrier owns that number
   ├─ carrier sends  INVITE  to LiveKit
   │
   ├─ LiveKit answers 100 Trying, then 200 OK
   ├─ LiveKit creates a room for this call
   ├─ RTP audio starts flowing, carrier ↔ LiveKit
   │
   ├─ LiveKit offers the job to a registered worker
   ├─ our worker accepts, receives a token
   ├─ our agent joins the room over WebRTC
   │
   ├─ the agent looks up which assistant owns that number
   ├─ builds the pipeline from that assistant's config
   └─ says the greeting → conversation begins
```

**The race that matters**

The caller is connected from the moment LiveKit answers — but the bot isn't there yet. It has to be offered the job, accept, join, load config, and build a pipeline.

Every millisecond of that is **silence on a live call**. It's why our process pre-warms a worker in advance (60 s allowance for the heavy imports) and why "no worker available" produces a caller listening to nothing.

### Timeouts worth knowing

| Stage | Timeout |
| --- | --- |
| Room creation | 10 s |
| Job assignment | 7.5 s |
| Process prewarm | 60 s (ours — heavy imports) |
| SIP answer wait | ~27 s observed |
| Dispatch pickup | **none** — a known gap |

That last row is a real operational risk: if no worker picks the job up, nothing times out and nothing alerts. The caller just hears silence.

## Outbound, step by step

*Call lifecycles · 12*

Reversed, and the order is the interesting part — **the bot joins before the phone even rings.**

```
 1. our campaign service asks LiveKit to create a room
 2. it dispatches a job for that room
 3. LiveKit offers the job → our worker accepts
 4. our agent joins the room over WebRTC          ← bot is ready and waiting
 5. the agent asks LiveKit to add a SIP participant (the customer's number)
 6. LiveKit sends INVITE to the trunk
 7. the trunk rings the phone
 8. 180 Ringing …
 9. the person answers → 200 OK
10. the SIP participant joins the room
11. audio flows both ways; the greeting plays
```

**Why the bot goes first**

Because if the human answers and the bot isn't ready, they hear silence and hang up. Getting the bot in place before ringing means the greeting can start the instant they say "hello".

### Voicemail detection

Roughly half of outbound calls reach an answering machine. Talking to one wastes money and produces useless call records.

So the pipeline runs a second branch in parallel: a small model listening to the same audio, deciding only "is this a human or a machine?" Its output is deliberately discarded before reaching the speaker — it exists purely to make that one decision. Enabled per assistant, outbound only.

## Transfers

*Call lifecycles · 13*

The bot decides it needs a human. There are two ways to do that, and they differ in who stays involved.

| | SIP REFER | Bridge transfer |
| --- | --- | --- |
| What happens | "Please go and talk to this other number instead" | We dial the agent ourselves and join the two calls together |
| Are we still in the call? | No — we drop out entirely | Yes — both legs run through us |
| Can we still record it? | No | Yes |
| Complexity | Low | High |
| Needs carrier support? | Yes | No |

**Why bridge transfer exists despite being harder**

Because of what it keeps. Once you REFER, you're gone — no recording, no compliance monitoring, no analytics on the human part of the conversation. For a regulated customer, the ability to record the whole interaction can be a contractual requirement.

The cost is real complexity. There are now two separate SIP calls that must be stitched, each with its own Call-ID, and hang-up messages from one leg must be absorbed rather than blindly forwarded — otherwise one party leaving tears down both. There's a whole document in this repo on the dual Call-ID problem alone.

## Keypad presses

*Call lifecycles · 14*

**What DTMF is**

**Dual-Tone Multi-Frequency**. When you press 5, the phone plays two tones at once. Each key has a unique pair, which is how the network knows which key it was. It's the sound of pressing a button on a phone.

Voice bots need it for anything the caller shouldn't say out loud — card numbers, PINs, OTPs — and for menus in noisy environments.

The complication: there are **three** ways a keypress can travel.

| Method | How | Problem |
| --- | --- | --- |
| **In-band** | The actual tones inside the audio | Compression can distort them; you have to detect them from audio |
| **RFC 2833** | Special RTP packets alongside the audio | The common modern way |
| **SIP INFO** | A signalling message | Supported inconsistently |

Different carriers do different things, which is why DTMF has its own processor with digit collection, maximum counts and timeouts.

**And it interacts with recording**

If a caller keys in a card number, those tones are in the recording — and a recording of DTMF tones can be decoded straight back into the digits. That's why the pipeline has redaction frames that pause recording around sensitive turns.

## Phone numbers

*Call lifecycles · 15*

Numbers are inventory, and inventory needs management. This repo has a whole subsystem for it — Virtual Number Management.

What it has to track:

- Which numbers we own, from which provider
- Which assistant answers each number
- Which service handles it — this codebase (`OSV`) or the older finite-state-machine bot (`FSM`)
- Environment: is this a production number or a test one?

**Why "which service" is a column in the database**

Because a company migrating from an older bot platform runs both at once. Some numbers point at the new system, some at the old, and they move over gradually. That migration state has to live somewhere, and it lives here.

## How calls fail

*Practical · 16*

Telephony failures cluster into a few shapes. Recognising the shape gets you to the layer immediately.

| Symptom | Almost always | Look at |
| --- | --- | --- |
| Call connects, total silence both ways | Media never established | SDP, firewall, RTP ports |
| One-way audio | One side sending to an unreachable address | SDP, NAT, RTPEngine |
| Connects then drops after ~30 s | Session timer not being refreshed | SIP session timers |
| Caller hears silence at the start | Bot hasn't joined yet | Worker registration, prewarm, dispatch |
| Choppy audio | Packet loss or jitter | Network path, jitter buffer |
| Bot hears itself | Echo, or mute filter not working | Echo cancellation, STT mute filter |
| Number rings forever | No worker took the job | Worker registration — and note there's no timeout here |

## Debugging telephony

*Practical · 17*

**Start here, in this order**

1. **Is a worker registered?** Nothing works without it.
   ```bash
   grep -c "registered worker" voice.log
   ```
   If that's 0, stop — nothing else matters.
2. **Did the job arrive?** Look for a `call_uuid` in the logs. No job means the problem is upstream of us — LiveKit or the carrier.
3. **Did audio flow?** Check the recording afterwards. If the caller's channel is empty, audio never reached us — a media problem, not a bot problem.
4. **Was it a SIP problem or a media problem?** The single most useful question. SIP problems mean the call never properly connects; media problems mean it connects and nobody can hear anything. They live in different systems.

**The tools**

- **SIP traces** — The raw INVITE/200 OK/BYE exchange. Your provider's dashboard will show these. This is where you see *why* a call was rejected — `486 Busy`, `404 Not Found`, `503`.
- **Wireshark / sngrep** — Packet-level inspection. `sngrep` is purpose-built for SIP and shows call flows as ladder diagrams — far more readable than raw Wireshark for this.
- **The recording** — Two channels, caller and bot separate. Tells you what each side actually received.
- **LiveKit's dashboard** — Room state, participants, connection quality per participant.

**You cannot breakpoint telephony**

Pausing your program does not pause the phone network. The carrier keeps sending RTP, the far end keeps waiting, session timers keep counting, and by the time you continue the call has usually been torn down.

Debug telephony with **logs and packet captures**, after the fact. Breakpoints are only useful once the audio is already inside your Python process and you're inspecting state rather than timing.

## Interview answers

*Practical · 18*

**Q: Walk me through what happens when someone calls your bot.**

Structure it by the two-part split — signalling then media — and it stays clear:

"The caller dials a number. The PSTN routes it to whichever carrier owns that number, and the carrier sends a SIP INVITE to LiveKit. LiveKit answers, creates a room, and RTP audio starts flowing between the carrier and LiveKit in G.711.

Separately, our voice runtime has already registered itself as a worker with LiveKit. LiveKit offers it the job; the worker accepts, gets a token and joins the room over WebRTC. LiveKit transcodes between G.711 and Opus in both directions.

Our agent then looks up which assistant owns that number, builds the pipeline from its config, and speaks the greeting."

Add the sharp bit: "The important detail is that the caller is connected before the bot is. Everything between LiveKit answering and the agent joining is silence on a live call, which is why we pre-warm workers."

**Q: Why is phone audio 8 kHz, and does it matter?**

"It's a 1960s decision baked into the global network — G.711 at 8 kHz. It's uncompressed, needs no CPU, and works on every switch on Earth. Changing it would mean changing all of them.

It matters a lot for us. 8 kHz can only carry frequencies up to 4 kHz, and speech has useful information above that — it's part of how you distinguish 's' from 'f'. That information is gone before it reaches us. So speech recognition is genuinely harder on telephone audio, and vendors differ a lot in how well they cope. Any STT benchmark has to be run on 8 kHz audio or it's measuring the wrong thing."

**Q: Why UDP for audio? Isn't TCP more reliable?**

"TCP guarantees delivery by retransmitting lost packets. For a live conversation that guarantee is worthless — by the time the replacement arrives, that moment has passed, and everything behind it is delayed too.

For real-time audio, late is worse than missing. One lost 20 ms packet is a click nobody notices. A 300 ms stall to recover it is a stutter everybody notices. So RTP runs on UDP and accepts loss, and you manage jitter with a small buffer instead."

**Q: What's the difference between SIP and RTP?**

One sentence: "SIP sets up the call, RTP carries the audio. SIP is the receptionist arranging the meeting; RTP is the conversation."

Then the useful consequence: "They're separate systems on separate ports, and that's why 'the call connects but there's no audio' is such a common bug — signalling succeeded, media didn't. The negotiation between them lives in the SDP block inside the INVITE, which is where you look first."

**Q: Why an SFU rather than mixing the audio?**

"Because an SFU keeps every participant's audio as a separate stream, and we need that separation for three things: recording the caller and bot on separate channels, running speech recognition on only the caller, and detecting barge-in. An MCU mixes everything into one stream and all three become much harder or impossible."

**Q: Why do you support two completely different call paths?**

"Path A — a commercial SIP trunk straight into LiveKit — is three moving parts and no infrastructure to run. That's the default and it should be.

Path B exists because a large bank required that call traffic never touch the public internet. That forces a private AWS Direct Connect circuit, TLS and SRTP on the carrier leg, and their own non-standard SIP dialect — which means OpenSIPS as a SIP proxy and RTPEngine as a media proxy, in two layers, with VRRP failover.

It's four extra pieces of infrastructure that we own and get paged for. It exists because the contract requires it, not because it's better."

**Q: How would you debug "the call connected but I couldn't hear anything"?**

"That symptom localises it immediately: signalling worked, media didn't. So I'd skip the bot entirely at first and look at the media path.

First the SDP in the INVITE and the answer — what address and port did each side advertise, and are they reachable? One-way audio is nearly always one side sending to an address it can't reach, which means NAT or firewall. Then whether RTP packets are actually arriving, with a capture or sngrep.

Only once I'd confirmed audio reaching our process would I look at the pipeline. And the recording tells me that in seconds — if the caller's channel is empty, the problem was never in our code."

## Glossary

*Reference · 19*

- **PSTN** — The global public telephone network.
- **SIP** — Protocol that sets up, changes and ends calls. Carries no audio.
- **SDP** — The block inside SIP that negotiates addresses, ports and codecs.
- **RTP** — Protocol that carries the audio, over UDP.
- **SRTP** — Encrypted RTP.
- **Codec** — How sound becomes bytes. G.711 on phones, Opus on the internet.
- **G.711** — 8 kHz, 64 kbps, uncompressed. The telephone codec.
- **Opus** — Modern codec. Better quality, less bandwidth. WebRTC's default.
- **SIP trunk** — Commercial connection between your software and a carrier.
- **Carrier** — A licensed telecoms company. Twilio, Telnyx, Exotel.
- **WebRTC** — Standard for real-time audio/video on the internet.
- **ICE / STUN / TURN** — Finding a network path between machines behind routers, and relaying when there isn't one.
- **SFU** — Forwards media without mixing, keeping participants separate.
- **MCU** — Mixes media into one stream. Cheaper for clients, loses separation.
- **Jitter** — Uneven packet arrival.
- **DTMF** — Keypad tones.
- **SIP REFER** — Transfer a call and drop out.
- **Bridge transfer** — Join two calls together and stay in the middle.
- **OpenSIPS** — A SIP proxy. Routes signalling.
- **RTPEngine** — A media proxy. Relays and encrypts audio.
- **IVR** — The "press 1 for sales" menu system.
- **Inbound / outbound** — They call us / we call them.

---

Sources: `docs/architecture/livekit.md` · `sip-ingress-architecture.md` · `bridge-transfer.md` · `app/models/virtual_number_mgmt.py`
Companion documents: voice runtime · pipecat upgrade · CI/CD and containers · distributed systems · the Vasco stack
