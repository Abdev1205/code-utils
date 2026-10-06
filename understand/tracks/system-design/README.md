# System Design Quest

**Topic:** System design
**Covers:** the book's preface and full table of contents
**Source:** [Claude artifact](https://claude.ai/artifact/7xxGdVxPGbUiPY13z4MdZ2) — written by a colleague, mirrored here for study.

The whole System Design Quest course as one track: ten parts of the book (one document each, chapters as sections), the appendices, and seven deep-dive companions. Read a part, then the matching deep dive.

## Preface

This book collects every lesson, deep dive, side quest and case study from the System Design Quest course, reorganized into 61 chapters across nine parts, with extra detail added throughout.

It starts from first principles (what a server is, how DNS works) and ends with complete designs of Swiggy, Uber, WhatsApp, YouTube, a payment gateway, an AI coding agent and a ChatGPT-style assistant. Part VII covers modern AI systems end to end: how LLMs work inside, how they are trained, fine-tuned, served, grounded with RAG and knowledge graphs, connected to tools through MCP, and turned into agents.

### How the book is organized

| Part | Theme | Chapters |
| --- | --- | --- |
| I | Foundations: requirements, client-server, the internet, APIs, TLS | 1-5 |
| II | Scaling: vertical and horizontal scaling, load balancers, caching, CDNs | 6-9 |
| III | Data: databases, indexing, replication, sharding, CAP and consistency | 10-14 |
| IV | Communication: queues, Kafka, real-time protocols, telephony, voice AI, call volumes | 15-20 |
| V | Architecture: microservices, sagas, gateways, rate limiting, HLD and LLD | 21-23 |
| VI | Reliability and delivery: resilience, observability, security, estimation, failure handling, scheduling, CI/CD, sandboxes, hosting | 24-33 |
| VII | The AI realm: ML, recommenders, LLMs, fine-tuning, training, RAG, knowledge graphs, serving, tools, MCP, agents, guardrails | 34-52 |
| VIII | Case studies: eight complete system designs with decision logs | 53-60 |
| IX | Under the hood: GPUs and CUDA | 61 |
| Appendices | Cheat sheets, scenario workbook, quiz answer key, glossary | A-D |

Part IX (Chapter 61) explains GPUs and CUDA, the layer underneath every AI system in the book. Chapters 44-61 each include example scenarios, failure scenarios with fixes, challenges and diagrams; Appendix B adds the same scenario treatment for Chapters 1-43. The appendices hold cheat sheets (numbers, formulas, decision guides), the scenario workbook, the full quiz answer key and a glossary.

### How to read it

Read Parts I to III in order; almost everything later depends on them. After that, chapters can be read in any order, and each one names the earlier chapters it builds on. Every chapter ends with review questions; answers are in Appendix B.

Three habits run through the whole book:

- Every design choice is a trade-off. When a chapter recommends something, it also says what you give up.
- Numbers decide designs. Estimate first (Chapter 27), then let the numbers drive the architecture.
- Choose consistency per feature. Payments need strong consistency; like counts do not (Chapter 14).

### The course as a game

The course was run as a game with worlds, levels, boss battles and ranks (Apprentice, Engineer, Senior, Architect, AI Architect). The book keeps that structure as parts, chapters and case studies. The companion code files written during the course (a mini GPT, an Uber low-level design and schema, a RAG pipeline and an agent harness) are described in the chapters where they appeared.

A note on facts: case studies describe designs built from first principles for learning. They are not the internal architectures of the companies named, except where a fact is stated as publicly shared.

## Contents

Click any chapter to jump straight to it.

### [Part I — Foundations](#m2d87n2wnss.60)

- [1 What Is System Design](#m2d87n2wnss.3066)
- [2 The Client-Server Model](#m2d87n2wnss.6504)
- [3 How the Internet Works](#m2d87n2wnss.9320)
- [4 APIs: REST, GraphQL and gRPC](#m2d87n2wnss.12829)
- [5 TLS, Authentication and API Design in Depth](#m2d87n2wnss.17647)

### [Part II — Scaling Up](#m2d87n2wnss.86)

- [6 Vertical vs Horizontal Scaling](#m2d87n2wnss.23807)
- [7 Load Balancers](#m2d87n2wnss.26884)
- [8 Caching](#m2d87n2wnss.31130)
- [9 Content Delivery Networks](#m2d87n2wnss.36060)

### [Part III — The Data Kingdom](#m2d87n2wnss.111)

- [10 Databases: SQL vs NoSQL](#m2d87n2wnss.39604)
- [11 Indexing](#m2d87n2wnss.43641)
- [12 Replication](#m2d87n2wnss.47773)
- [13 Sharding, Consistent Hashing and Unique IDs](#m2d87n2wnss.52491)
- [14 CAP, PACELC, Consistency Models and Consensus](#m2d87n2wnss.56711)

### [Part IV — Communication and Real-Time Systems](#m2d87n2wnss.144)

- [15 Message Queues](#m2d87n2wnss.61297)
- [16 Pub/Sub, Kafka and Event-Driven Architecture](#m2d87n2wnss.65428)
- [17 Real-Time Communication](#m2d87n2wnss.70413)
- [18 The Telephone Network](#m2d87n2wnss.74751)
- [19 Real-Time Media and Voice AI with LiveKit](#m2d87n2wnss.79317)
- [20 Handling Massive Call Volumes](#m2d87n2wnss.84240)

### [Part V — Architecture Patterns](#m2d87n2wnss.196)

- [21 Monoliths, Microservices and Sagas](#m2d87n2wnss.89178)
- [22 API Gateways, Service Discovery and Rate Limiting](#m2d87n2wnss.93593)
- [23 High-Level and Low-Level Design](#m2d87n2wnss.98446)

### [Part VI — Reliability, Operations and Delivery](#m2d87n2wnss.230)

- [24 Fault Tolerance and Resilience](#m2d87n2wnss.104544)
- [25 Observability](#m2d87n2wnss.109315)
- [26 Security Fundamentals](#m2d87n2wnss.113863)
- [27 Back-of-the-Envelope Estimation](#m2d87n2wnss.119233)
- [28 Failure Handling and Health Checks](#m2d87n2wnss.122536)
- [29 Scheduled Jobs](#m2d87n2wnss.129089)
- [30 CI Pipelines](#m2d87n2wnss.134432)
- [31 CD Pipelines and Progressive Delivery](#m2d87n2wnss.140325)
- [32 Sandboxes](#m2d87n2wnss.145799)
- [33 Hosting a Website](#m2d87n2wnss.152049)

### [Part VII — The AI Realm](#m2d87n2wnss.287)

- [34 ML System Fundamentals](#m2d87n2wnss.158302)
- [35 Training, Serving and Monitoring ML (MLOps)](#m2d87n2wnss.163538)
- [36 Recommendation Systems](#m2d87n2wnss.169359)
- [37 LLMs for System Designers](#m2d87n2wnss.174298)
- [38 Inside an LLM](#m2d87n2wnss.179332)
- [39 Fine-Tuning LLMs](#m2d87n2wnss.185161)
- [40 Training an LLM from Scratch](#m2d87n2wnss.191485)
- [41 Build Your Own Mini GPT](#m2d87n2wnss.197574)
- [42 Predicting LLM Behavior](#m2d87n2wnss.201045)
- [43 Why LLMs Hallucinate](#m2d87n2wnss.206680)
- [44 Embeddings and Vector Databases](#m2d87n2wnss.212724)
- [45 Retrieval-Augmented Generation (RAG)](#m2d87n2wnss.218450)
- [46 Knowledge Graphs](#m2d87n2wnss.225610)
- [47 Serving LLMs at Scale](#m2d87n2wnss.231476)
- [48 Tool Use](#m2d87n2wnss.237580)
- [49 MCP, the Model Context Protocol](#m2d87n2wnss.243476)
- [50 The Agent Harness](#m2d87n2wnss.249916)
- [51 AI Agents](#m2d87n2wnss.255585)
- [52 Evaluation, Guardrails and Cost](#m2d87n2wnss.262601)

### [Part VIII — Case Studies](#m2d87n2wnss.330)

- [53 AI Coding Agent](#m2d87n2wnss.268611)
- [54 Payment Gateway](#m2d87n2wnss.274792)
- [55 Swiggy](#m2d87n2wnss.281849)
- [56 Uber](#m2d87n2wnss.288445)
- [57 URL Shortener](#m2d87n2wnss.294557)
- [58 WhatsApp](#m2d87n2wnss.299023)
- [59 YouTube](#m2d87n2wnss.304049)
- [60 ChatGPT-Style Assistant](#m2d87n2wnss.309691)

### [Part IX — Under the Hood](#m2d87n2wnss.316816)

- [61 CUDA and GPU Computing](#m2d87n2wnss.316856)

### [Part X — Career: The Forward Deployed AI Engineer](#m2d87n2wnss.517517)

- [62 Forward Deployed AI Engineer Interview Topics](#m2d87n2wnss.517567)

### Appendices

- [A Cheat Sheets](#m2d87n2wnss.326535)
- [B Scenario Workbook](#m2d87n2wnss.328304)
- [C Quiz Answer Key](#m2d87n2wnss.339256)
- [D Glossary](#m2d87n2wnss.344728)

### How every chapter is laid out

1. The problem in one view: the problem statement, why it is hard, how we solve it, and what fails and why; then a short opening summary.
2. Numbered concept sections with tables, code and text diagrams.
3. Example scenario and failure scenarios with fixes (Chapters 44-61 inline; Chapters 1-43 also in Appendix B).
4. Practitioner's guide: a worked example, a table of benefits, constraints, trade-offs and when to use or avoid, and more failure cases.
5. Review questions with full answers directly below them (a short answer key is also in Appendix C).

Production incident deep dives sit inside Chapters 1-25; for Chapters 26 onward they continue in the Production Incident Playbook tab.

Detailed, production-depth versions of the case studies, plus six new ones, are in the Case Studies: Deep Dives tab.

In-depth AI topics, starting with a complete LoRA guide, are in the AI Deep Dives tab.

Networking taught lesson by lesson, beyond Chapter 3, is in the Networking in Depth tab.

Object-oriented and distributed design patterns, taught with code and examples, are in the Design Patterns in Depth tab.

Popular low-level design interview problems, solved with code and an approach guide, are in the LLD Interview Problems tab.

Synchronous, asynchronous and threaded programming, with timed examples and failure cases, is in the Concurrency: Sync, Async, Threads tab.

## Documents in this track

- `01-foundations.md` — 5 sections, 11,605 words
- `02-scaling-up.md` — 4 sections, 7,785 words
- `03-the-data-kingdom.md` — 5 sections, 7,471 words
- `04-communication-and-real-time-systems.md` — 6 sections, 9,017 words
- `05-architecture-patterns.md` — 3 sections, 4,736 words
- `06-reliability-operations-and-delivery.md` — 10 sections, 13,748 words
- `07-the-ai-realm.md` — 19 sections, 23,979 words
- `08-case-studies-boss-battles.md` — 8 sections, 10,456 words
- `09-under-the-hood-gpus-and-cuda.md` — 1 sections, 1,923 words
- `10-career-the-forward-deployed-ai-engineer.md` — 1 sections, 2,534 words
- `11-appendices.md` — 4 sections, 3,728 words
- `12-production-incident-playbook.md` — 15 sections, 5,467 words
- `13-case-studies-deep-dives.md` — 6 sections, 11,208 words
- `14-ai-deep-dives.md` — 4 sections, 14,570 words
- `15-networking-in-depth.md` — 12 sections, 7,570 words
- `16-design-patterns-in-depth.md` — 8 sections, 6,294 words
- `17-lld-interview-problems.md` — 12 sections, 12,124 words
- `18-concurrency-sync-async-and-threads.md` — 6 sections, 6,350 words
