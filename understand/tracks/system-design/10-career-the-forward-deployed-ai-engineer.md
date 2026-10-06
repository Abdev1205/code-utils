# Part X: Career: The Forward Deployed AI Engineer

**Topic:** System design
**Covers:** Forward Deployed AI Engineer Interview Topics
**Source:** [Claude artifact](https://claude.ai/artifact/7xxGdVxPGbUiPY13z4MdZ2) — written by a colleague, mirrored here for study.

## Chapter 62: Forward Deployed AI Engineer Interview Topics

A forward deployed AI engineer (FDE) sits with a customer, finds where AI can create value in their real workflow, and ships a working system on their data, inside their security rules. Interviews therefore test four things at once: engineering, AI system design, customer judgment, and the ability to prove value.

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Turn a customer's vague wish ("use AI for our claims process") into a reliable system in production that measurably helps them. |
| Why it is hard | Requirements are fuzzy, data is messy and locked behind security reviews, models are non-deterministic, and demos impress long before production works. |
| How we solve it | Discover the real workflow, scope one measurable use case, prototype on real samples, evaluate against a baseline, pilot with users, then harden for production. |
| What fails, and why | Pilots that never ship (no success metric or owner), wrong answers in production (no evaluation set), stalled projects (data access and security review started late), and lost trust (overpromising). |

### 62.1 What the role is

The title was popularized by Palantir and is now used by many AI companies. The work mixes software engineering, applied AI and consulting: you write production code, but your success is measured by the customer's outcome.

| Role | Main focus | Measured by |
| --- | --- | --- |
| Software engineer | Building the company's product | Features shipped, quality |
| ML engineer | Training and serving models | Model quality, efficiency |
| Solutions engineer | Pre-sales demos and integration advice | Deals won |
| Forward deployed AI engineer | Building and shipping AI solutions inside a customer's environment | Customer outcomes in production, product feedback |

### 62.2 How interviews are usually structured

Exact loops differ by company; these rounds appear most often.

| Round | What it tests | Typical prompt |
| --- | --- | --- |
| Practical coding | Clean working code under ambiguity | Build a small RAG pipeline, a tool-calling loop, or a streaming endpoint |
| AI system design | Architecture for a customer scenario | "Design an assistant for a bank's support team" |
| LLM fundamentals | Depth beyond buzzwords | Tokens, context, RAG vs fine-tuning, hallucinations, evals |
| Debugging or evaluation exercise | Diagnosing a broken AI system | "Answers got worse after a document update. Why?" |
| Customer case or role-play | Discovery, scoping, communication | A stakeholder asks for "ChatGPT for our company" |
| Behavioral | Ownership, ambiguity, conflict | "Tell me about a project that almost failed" |

### 62.3 Topic map to this book

| Topic | What interviewers probe | Chapters |
| --- | --- | --- |
| LLM basics | Tokens, context windows, latency, streaming, cost | 37, 38 |
| RAG | Chunking, hybrid search, reranking, permissions, evaluation | 44, 45 |
| Agents and tools | Tool calling, identity, limits in code, MCP, harnesses | 48-51 |
| Evaluation and guardrails | Golden sets, LLM judges, safety, cost levers | 42, 43, 52 |
| Fine-tuning | When it helps, LoRA, data quality | 39 |
| Serving and scale | Batching, caching, rate limits, fallbacks | 47 |
| Enterprise integration | SSO, APIs, webhooks, queues, data pipelines | 4, 5, 15, 16, 22 |
| Security and privacy | PII, encryption, tenant isolation, audit logs | 26, 32 |
| Reliability and operations | Timeouts, retries, monitoring, deploys | 24, 25, 30, 31 |
| Estimation | Volumes, tokens, cost per request | 27 |

### 62.4 Running a customer engagement

Every stage ends with a gate the customer agrees to; skipping a gate is the most common reason AI projects stall.

> *Diagram in the original artifact: Customer engagement lifecycle · stages and gates*

Discovery questions that interviewers expect you to ask:

1. What decision or task is slow, expensive or error-prone today, and who does it?
2. How is it done now, step by step, and what does a good outcome look like?
3. What data exists, where does it live, who can grant access, and how sensitive is it?
4. What is the cost of a wrong answer, and who must review outputs?
5. What latency, volume and budget limits apply?
6. How will we measure success, and what is today's baseline number?
7. What security, compliance and deployment rules apply (cloud region, private network, approved model providers)?

Then choose the lightest approach that works: prompting, then RAG, then tools or agents, then fine-tuning; plain code or rules where AI is not needed.

### 62.5 Answering an AI system design question

A reliable structure for "design an AI system for customer X":

1. Clarify the users, the task, the volume and the cost of errors.
2. State a measurable success metric and the current baseline.
3. Sketch the data flow: sources, ingestion, permissions, storage.
4. Choose the model approach and explain why not the alternatives.
5. Design the runtime: retrieval, tools, prompts, structured outputs, guardrails, human review.
6. Plan evaluation: golden set, metrics, offline and online checks.
7. Cover production: latency, cost per request, monitoring, fallbacks, security, rollout.
8. Name the top risks and how you would detect and handle each.

### 62.6 Worked case: extracting fields from insurance claims

**Problem statement.** An insurer receives 20,000 claim PDFs a day. Staff spend 15 minutes each typing policy number, dates, amounts and damage type into the claims system.

**Why it is hard.** Scans are messy, layouts vary by hospital or garage, wrong amounts cost real money, and customer data must stay in the insurer's cloud region.

**How it is solved.** OCR and layout parsing, an LLM with a strict JSON schema per document type, validation rules in code (dates in range, amounts match totals, policy exists), confidence scores, and human review for low-confidence or high-value claims. Run in the customer's approved region with private networking; log every extraction for audit.

| Failure | Why it happens | Fix |
| --- | --- | --- |
| Amount read as 1,500 instead of 15,000 | OCR drops a digit on a low-quality scan | Cross-check with line-item totals; route mismatches to review |
| Invalid JSON in 2% of outputs | Model drifts from the format on unusual documents | Schema-constrained output, validation, one retry |
| Accuracy drops for a new hospital's form | Layout never seen in the evaluation set | Add samples to the golden set; monitor accuracy per document source |
| Pilot stalls for weeks | Security review started after the prototype | Start security and data-access approval during discovery |

### 62.7 Worked case: internal knowledge assistant for a bank

**Problem statement.** 5,000 employees search 40,000 policy documents to answer customer and compliance questions.

**Why it is hard.** Documents change weekly, some are restricted by role, answers must cite sources, and regulators need audit trails.

**How it is solved.** SSO login; a CDC-driven indexing pipeline with role metadata; hybrid search with reranking; permission filtering before ranking; grounded answers with citations and "I don't know"; per-query audit logs; deployment in the bank's private cloud with an approved model provider.

| Failure | Why it happens | Fix |
| --- | --- | --- |
| An intern sees a restricted policy | Permissions applied in the prompt, not at retrieval | Filter by role metadata before ranking |
| Quotes last year's policy | Old version still indexed | Delete superseded versions on update; freshness filter |
| Users stop trusting it | Confident answers with no citations | Mandatory citations and abstention when evidence is weak |
| Slow answers (8 s) | Too many chunks and a large model for every query | Rerank to fewer chunks; route simple questions to a smaller model; stream |

### 62.8 Worked case: support agent that takes actions

**Problem statement.** An e-commerce company wants an assistant that answers order questions and issues refunds up to ₹500 without a human.

**Why it is hard.** Real money moves, users can try to manipulate the agent, and backend APIs fail or time out.

**How it is solved.** Tool calling with identity taken from the session, ownership checks, refund limits and idempotency keys enforced in code, confirmation before actions, human handoff, and an evaluation suite with adversarial prompts (Chapters 48-52).

| Failure | Why it happens | Fix |
| --- | --- | --- |
| Refund issued for someone else's order | The model chose the user or order ID | Identity from the session; ownership check in the tool |
| Double refund | Retry after a timeout without an idempotency key | Idempotency key per refund |
| Refund above policy after a clever prompt | Limit lived only in the prompt | Enforce the limit in tool code |
| Agent stuck in a loop on API errors | Errors not surfaced clearly; no step limit | Clear error results, step budget, human fallback |

### 62.9 Enterprise deployment checklist

| Concern | What to design |
| --- | --- |
| Identity | SSO (SAML/OIDC), user provisioning (SCIM), role mapping |
| Data residency | Approved regions; no data leaving the customer boundary |
| Networking | Private endpoints or VPC peering; egress allowlists |
| Model choice | Approved providers and terms (no training on customer data); self-hosted open models when required |
| Privacy | PII detection and redaction, retention limits, deletion paths |
| Audit | Who asked what, which sources were used, which actions ran |
| Limits and cost | Quotas per team, budgets, alerts, cost per task |
| Operations | Monitoring, runbooks, on-call ownership, handover to the customer team |

### 62.10 Proving value

Build a golden set from real customer examples with expected outputs, agree the metric with the customer, measure the baseline (today's human accuracy and time), and report both quality and business impact. Example: claims extraction cut handling from 15 to 4 minutes per claim; across 20,000 claims a day that saves about 3,670 staff-hours daily, with extraction accuracy on the golden set at or above the manual baseline. Track quality after launch with sampled reviews, because accuracy drifts when documents change.

### 62.11 Debugging scenarios interviewers like

| Scenario | Likely cause | First checks | Fix |
| --- | --- | --- | --- |
| Answers got worse after a document update | Re-chunking or a new embedding model mixed vector spaces; stale index | Was the correct chunk retrieved? Index versions | Re-index fully; version embeddings; retrieval evals in CI |
| Latency rose from 2 s to 12 s | Larger context, more tool calls, provider throttling | Trace per step: retrieval, model, tools | Trim context, parallelize tools, cache prefixes, stream |
| 3% of JSON outputs fail | Unconstrained generation on edge cases | Collect failing inputs | Structured outputs, validation and retry |
| The bot invents a refund policy | No grounding or weak retrieval | Check retrieved context for that query | Ground in the policy; abstain when missing |
| Costs doubled overnight | Prompt change broke caching, or an agent loops | Cost per request by feature; prompt diff | Restore a stable prefix; step budgets; cost alerts |
| Works in the demo, fails for real users | Demo used clean examples | Compare real traffic with test data | Golden set from real samples; pilot with monitoring |

### 62.12 Coding round topics

Be ready to write, in about an hour: a RAG pipeline (chunking, embeddings or BM25, retrieval, grounded prompt); a tool-calling loop with schema validation and step limits; a streaming API endpoint over SSE; structured output with validation and retries; batch processing with rate-limit backoff and jitter; and a small evaluation harness that scores outputs against expected answers. The companion files `rag_from_scratch.py` and `mini_harness.py` cover the first two.

### 62.13 Customer and behavioral questions

| Question | What a strong answer shows |
| --- | --- |
| "The customer wants ChatGPT for the whole company. What do you do?" | Narrowing to one valuable, measurable use case |
| "The pilot works but leadership is unconvinced." | Baseline metrics, business impact, clear next step |
| "The customer's data team blocks access for weeks." | Early escalation, sample data, synthetic data, parallel work |
| "Your system made a costly mistake in production." | Ownership, fast mitigation, root cause, prevention, honest communication |
| "The customer asks for something the product cannot do." | Honest limits, workaround, feedback to the product team |

Use the STAR shape (situation, task, action, result) with numbers.

### 62.14 Why FDE projects fail

| Failure | Why it happens | Fix |
| --- | --- | --- |
| Pilot never reaches production | No agreed metric, owner or production plan | Gates with sign-off at each stage |
| Scope creep | Every stakeholder adds a use case | One use case at a time; a written scope |
| "It feels worse" with no evidence | No evaluation set or baseline | Golden set and baseline before building |
| Weeks lost waiting | Data access and security reviews started late | Start them during discovery |
| Demo-ware | Built on clean samples, not real data | Prototype on real, messy samples |
| Customer cannot maintain it | No documentation, runbooks or handover | Handover plan, training, ownership transfer |

### 62.15 Preparation checklist

- Explain RAG, tool calling, agents, fine-tuning and evals in two minutes each
- Design three customer cases end to end (extraction, knowledge assistant, action-taking agent)
- Build a RAG pipeline and a tool-calling loop from scratch
- Practice estimating tokens, latency and monthly cost for a use case
- Prepare five STAR stories with numbers
- Practice a discovery conversation with a friend playing a vague stakeholder

### Review questions

1. A customer asks for "an AI that answers everything about our company." What are your first three moves?
2. Name the four gates you would agree with a customer between discovery and production.
3. Accuracy drops after launch only for one region's documents. How do you investigate?

#### Answers

1. Interview the users to find one high-value, frequent task; agree a measurable success metric and baseline; and start data-access and security approval immediately, while prototyping on real samples.
2. Scope agreed (metric and data access), prototype works on real data, evaluation beats the baseline on the golden set, and the pilot meets adoption and service targets with a security sign-off.
3. Slice evaluation results by region; inspect failing examples for new layouts, languages or document versions; check ingestion and retrieval for those documents; add them to the golden set; then fix parsing, retrieval or prompts and monitor per-region accuracy.
