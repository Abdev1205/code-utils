# The LangChain Stack

**Topic:** Frameworks
**Covers:** LangChain, LangGraph, LangSmith - company, licensing, criticism, alternatives
**Source:** [Claude artifact](https://claude.ai/artifact/FyM4Vc75kKDZcowbQG4mkD) — written by a colleague, mirrored here for study.

*Framework · orchestration · observability*

Three products from one company, two of them open source and one not. What each actually does, why the framework is controversial, and how to talk about all of it without sounding like the marketing page.

> **A note on freshness**
>
> This ecosystem changes faster than almost anything else in software — APIs, package layout and licensing have all moved more than once. The *concepts* here are stable; specific class names, version numbers and licence terms should be checked against the current docs before you rely on them.
>
> Where I'm describing something that has churned historically, I say so rather than presenting it as settled.

## The three products

*Orientation · 01*

People say "LangChain" to mean all three, which causes endless confusion. They do genuinely different jobs.

| | What it is | The job |
|---|---|---|
| **LangChain** | A library of building blocks | Standard interfaces over models, prompts, retrievers, tools — so you can swap providers without rewriting |
| **LangGraph** | An orchestration library | Build agents as an explicit graph with durable state, human approval points and resumability |
| **LangSmith** | A hosted platform | See what your LLM app actually did; run evaluations against datasets |

```
LangSmith     ← watches everything below (optional, works standalone)
─────────────────────────────────────────────
LangGraph     ← control flow, state, durability
─────────────────────────────────────────────
LangChain     ← components: models, prompts, retrievers, tools
─────────────────────────────────────────────
provider SDKs ← openai, anthropic, google-genai …
```

> **They are genuinely independent — this is the point most people miss**
>
> You can use LangGraph without a single LangChain component. You can use LangSmith to trace a plain OpenAI SDK script with no LangChain anywhere. And you can use LangChain with no graph and no tracing.
>
> Saying this in an interview signals you've actually used them rather than adopted the bundle because it was the default.

## Who makes it

*Orientation · 02*

> **LangChain, Inc.**
>
> The open-source project began in **late 2022**, started by **Harrison Chase**. It arrived within weeks of ChatGPT and grew explosively — for most of 2023 it was, effectively, how people built LLM applications, largely because nothing else existed.
>
> The company was incorporated in early 2023 with Harrison Chase and Ankush Gola as co-founders, and has raised venture funding across several rounds — seed led by Benchmark, a Series A led by Sequoia, and a later round at a reported valuation in the billion-plus range. *Treat specific amounts and dates as approximate; verify before quoting them.*

> **The business model — worth understanding, because it explains the product boundaries**
>
> Classic **open core**. The libraries are free and MIT-licensed, which drives adoption and makes them the default choice. Revenue comes from the hosted layer: LangSmith subscriptions and the LangGraph Platform.
>
> The strategic logic is sound. Once your agents are written against LangGraph, LangSmith is the path of least resistance for observability, and the Platform is the path of least resistance for deployment. The libraries are the funnel.
>
> What that means for you as an adopter: **the open-source pieces are genuinely usable standalone** — they're not crippled — but the polished experience points at the paid products, and you should decide deliberately whether to follow it.

## Open source or not

*Orientation · 03*

| Component | Licence | Self-host? |
|---|---|---|
| **LangChain** (Python, JS) | MIT — fully open | It's a library; there's nothing to host |
| **LangGraph** (library) | MIT — fully open | Same — runs in your process |
| **LangGraph Platform** | Commercial | Paid tiers offer self-hosted deployment |
| **LangSmith** | Proprietary SaaS | Free developer tier; self-hosting is an enterprise plan |

> **The distinction that matters most**
>
> **LangGraph the library is MIT and runs entirely in your own process.** Your agent runs on your infrastructure with no dependency on LangChain Inc. — no phoning home, no vendor availability risk, no bill.
>
> **LangGraph Platform is a separate commercial product** that hosts and operates those graphs for you: task queues, persistence, horizontal scaling, a visual debugger, an API for managing runs.
>
> Licensing on the Platform's server components has shifted over time and is not simply MIT. If licensing matters to your organisation, *check the current terms* rather than assuming.

> **Where the lock-in actually is**
>
> Not where people expect. LangGraph is MIT, so you can always keep running it.
>
> The real switching costs are: **LangSmith traces** — years of production history that don't export cleanly into a competitor; and **LangSmith datasets and evaluators** — your golden sets and grading logic, which are the genuinely valuable asset.
>
> Mitigation, if you care: instrument with **OpenTelemetry** so traces can be fanned out to more than one backend, and keep your evaluation datasets in version control as files rather than only in the platform.

## What LangChain is

*LangChain · 04*

> **The problem it set out to solve**
>
> In 2023, wiring an LLM app together meant a pile of glue: one API shape for OpenAI, a different one for Anthropic, your own retry logic, your own prompt templating, your own conversation history, your own parsing of the model's text into structured data, your own integration with each vector store.
>
> LangChain provided **standard interfaces** for all of it. Write against `ChatModel` and swapping OpenAI for Anthropic is a constructor change. Write against `VectorStore` and swapping Chroma for pgvector is a constructor change.

```
without:                      with:

openai.chat.completions       model = ChatOpenAI()
  .create(...)                model = ChatAnthropic()   ← same interface
anthropic.messages
  .create(...)   ← different  chain = prompt | model | parser
```

> **The honest assessment of its value in 2026**
>
> The gap it filled has narrowed considerably. Provider SDKs converged on similar shapes, several now offer OpenAI-compatible endpoints, and structured output is a first-class API feature rather than something you parse out of text.
>
> What genuinely remains valuable: **the integration surface** — hundreds of loaders, splitters, vector stores and tools already written and maintained — and **the interface discipline** that makes provider swaps cheap. What's less compelling than it was: the core abstractions themselves, which are now thin over SDKs that don't need much wrapping.
>
> Both halves of that assessment are worth saying out loud. It reads as judgement rather than allegiance.

## The abstractions

*LangChain · 05*

> **The pieces, and what each replaces**
>
> **ChatModel** — A model, behind one interface. `invoke`, `stream`, `batch`, plus async variants. Handles message formatting, tool-call parsing and token counting per provider.
>
> **Messages** — `SystemMessage`, `HumanMessage`, `AIMessage`, `ToolMessage`. A provider-neutral conversation format, which is what makes swapping providers actually work.
>
> **PromptTemplate** — A prompt with variables. Modest value on its own; useful for keeping prompts out of code and versioning them.
>
> **Output parsers / structured output** — Get a Pydantic object back rather than a string. Modern models support this natively via tool calling; LangChain gives it a uniform surface across providers.
>
> **DocumentLoader** — Read PDFs, HTML, Notion, S3, Confluence — a few hundred of them. Probably the single most practically valuable part of the library.
>
> **TextSplitter** — Chunking, including the recursive-character splitter that's the sensible default. See the RAG document.
>
> **Embeddings** — One interface over embedding providers.
>
> **VectorStore** — One interface over pgvector, Qdrant, Pinecone, Chroma and the rest.
>
> **Retriever** — Anything that turns a query into documents. Deliberately broader than a vector store — a web search or a SQL query is also a retriever.
>
> **Tools** — A function the model can call, with a schema derived from its type hints.
>
> **Memory** — Conversation history management. Historically the most confused part of the library; largely superseded by LangGraph's persisted state.

> **The 1.0 reshaping**
>
> LangChain reached **1.0** in late 2025, and the direction is worth knowing because it's essentially the project agreeing with its critics.
>
> The surface was substantially narrowed: fewer abstractions, a single well-supported way to build an agent — `create_agent`, built on top of LangGraph — and much of the older accumulated API moved into a separate legacy package rather than sitting in the main namespace.
>
> The interesting structural point: **LangGraph became the foundation and LangChain the component layer above it.** That inverts how most people first learnt the relationship.

## LCEL and the Runnable interface

*LangChain · 06*

> **What it is**
>
> **LCEL** — LangChain Expression Language — lets you compose components with the `|` operator, like a Unix pipe.
>
> ```python
> chain = prompt | model | output_parser
> result = chain.invoke({"question": "why is my site down?"})
> ```
>
> Everything composable implements **Runnable**, which is a small interface: `invoke`, `batch`, `stream`, and async versions of each.

> **Why this is more than syntactic sugar**
>
> Because every piece implements the same interface, composing them **gives you four things for free** that you'd otherwise write by hand:
> - **Streaming** propagates through the whole chain automatically — tokens stream out of the parser as the model produces them.
> - **Batching** — `chain.batch([...])` parallelises across inputs.
> - **Async** — every component has an async form, so the chain does too.
> - **Tracing** — each step reports itself to LangSmith with no extra code.
>
> That's the actual argument for LCEL. If you write the same pipeline as plain Python function calls, you get none of it without doing the work yourself.

```python
from langchain_core.runnables import RunnableParallel, RunnablePassthrough

chain = (
    RunnableParallel(
        context=retriever,                 # runs concurrently
        question=RunnablePassthrough(),    # with this
    )
    | prompt
    | model
    | StrOutputParser()
)
```

> **The trade, stated fairly**
>
> Pipe syntax reads beautifully for linear flows. It reads *badly* for branching, loops and error handling — the moment you want an `if`, you're writing `RunnableBranch` and wishing you'd written Python.
>
> The reasonable position: LCEL for straight-line data transformation, LangGraph for control flow. Trying to express a stateful agent in pipe syntax is how you get code nobody can debug.

## The package split

*LangChain · 07*

Worth knowing because the split is the response to a specific historical problem, and because getting it wrong makes your dependency tree enormous.

| Package | Contains | Maintained by |
|---|---|---|
| `langchain-core` | Base abstractions, Runnable, messages. Almost no dependencies. | LangChain, carefully |
| `langchain` | Chains, agents, retrieval logic | LangChain |
| `langchain-openai`, `-anthropic`, … | Provider integrations | Jointly with the provider |
| `langchain-community` | Hundreds of third-party integrations | Community — quality varies widely |
| `langchain-text-splitters` | Chunking | LangChain |

> **Why it was split**
>
> Originally everything was one package, so installing LangChain pulled in a vast dependency tree and any integration's breakage was your breakage. The split isolates the stable, carefully-maintained core from the long tail.
>
> **Practical advice:** depend on `langchain-core` plus the specific provider packages you use. Reach into `langchain-community` deliberately, and read the source of anything from it that sits on a critical path — the quality genuinely varies.

## The criticism, honestly

*LangChain · 08*

> **Why you must be able to discuss this**
>
> LangChain is one of the most divisive libraries in the field, and "LangChain is bloated" is a real opinion held by many senior engineers. If it's on your CV, an interviewer may well probe it — sometimes as a genuine question, sometimes to see whether you can evaluate your own tools.
>
> The wrong answers are defending it uncritically and dismissing it uncritically. Engage with the substance.

### The complaints, and what's true in each

> **"Too many layers of abstraction"**
>
> **Substantially true, historically.** Simple operations could pass through several classes, each adding indirection over an API call that was already simple. It made stack traces long and behaviour hard to predict.
>
> 1.0 narrowed this considerably. But the criticism was fair and the project's own response is the strongest evidence for it.

> **"You can't tell what prompt was actually sent"**
>
> **True, and it's the most serious one.** The prompt is the single most important artefact in an LLM application, and abstraction that hides it is abstraction in the wrong place.
>
> This is precisely the gap LangSmith fills — which is either a good ecosystem answer or a slightly circular one, depending on your view. Either way: if you use LangChain without tracing, you're flying blind, and that's a genuine cost.

> **"Breaking changes constantly"**
>
> **True for 2023–2024.** The API moved fast, documentation lagged, and tutorials went stale within weeks. Real pain for teams.
>
> It has stabilised — the package split and the 1.0 release were both aimed at this. But teams burnt during that period have long memories and their scepticism isn't unreasonable.

> **"It's a wrapper around a wrapper"**
>
> **Partly true, and increasingly so.** Provider SDKs are much better than they were. For a single-provider application making straightforward calls, LangChain's core abstractions now add little.
>
> Where the value survives: the integration breadth, and the swap-a-provider-in-one-line property — which is worth a lot if you actually do that. If you never will, you're paying for optionality you won't use.

> **The balanced position to hold**
>
> **LangChain is at its most valuable when you're integrating many things and least valuable when you're doing one thing well.**
>
> Loading twelve document formats into three vector stores across two model providers: genuinely saves weeks. One prompt to one provider: use the SDK.
>
> And separately — **LangGraph is a stronger product than LangChain**, and stands on its own merits. Judging them as one thing is the mistake both fans and critics tend to make.

## What LangGraph is

*LangGraph · 09*

> **The problem**
>
> The simplest agent is a loop: ask the model, run whatever tool it requested, feed the result back, repeat. Fifty lines.
>
> Then production arrives and you need: a human to approve certain actions; the run to survive a process restart; to know why it took the path it took; to stop it improvising into somewhere dangerous; to stream progress to a UI; and to test it in pieces.
>
> Those requirements bolted onto a while-loop produce something unmaintainable. **LangGraph is that set of requirements taken seriously from the start.**

```
       ┌──────────┐
   ────►  agent   │◄──────────┐
       └────┬─────┘           │
      needs a tool?           │
       ┌────┴─────┐           │
      no          yes         │
       │           ▼          │
       │      ┌─────────┐     │
       │      │  tools  │─────┘
       │      └─────────┘
       ▼
      END
```

Nodes are functions. Edges are the allowed transitions. A shared state object flows through and each node returns an update to it.

```python
from langgraph.graph import StateGraph, START, END

builder = StateGraph(AgentState)
builder.add_node("agent", call_model)
builder.add_node("tools", run_tools)

builder.add_edge(START, "agent")
builder.add_conditional_edges("agent", should_continue, {
    "continue": "tools",
    "end": END,
})
builder.add_edge("tools", "agent")

graph = builder.compile(checkpointer=checkpointer)
```

## State and reducers

*LangGraph · 10*

> **State is explicit — the central design decision**
>
> You declare what the agent knows as a typed structure. Every node receives it and returns a partial update.
>
> ```python
> from typing import Annotated, TypedDict
> from operator import add
>
> class AgentState(TypedDict):
>     messages:  Annotated[list, add]   # ← accumulates
>     ticket_id: str                    # ← replaced
>     findings:  Annotated[list, add]   # ← accumulates
>     escalate:  bool                   # ← replaced
> ```

> **Reducers — the bit people find confusing**
>
> When a node returns `{"messages": [new_msg]}`, what should happen to the existing messages? Replace them, or append?
>
> The `Annotated[list, add]` answers that: this field is **reduced** with `add`, so updates append. A field without a reducer is simply overwritten.
>
> Why it matters beyond convenience: reducers make **parallel nodes** safe. If two branches run concurrently and both append findings, the reducer defines how their results merge deterministically, instead of one silently clobbering the other.

> **Why explicit state is the whole argument for LangGraph**
>
> In a free-form agent loop, "what does the agent know?" is buried in an ever-growing message list you have to read to understand.
>
> Here it's a typed object you can print, assert on in a test, persist to a database, resume from, and show in a debugger. **Most agent misbehaviour is visible as wrong state** — and this makes state something you can actually look at.

## Nodes and edges

*LangGraph · 11*

> **Nodes are plain functions**
>
> ```python
> def diagnose_disk(state: AgentState) -> dict:
>     usage = check_disk_usage(state["domain"])
>     return {"findings": [f"disk at {usage}%"]}
> ```
>
> State in, partial update out. No framework types in the signature, nothing to mock, **directly unit-testable** — call it with a dict, assert on the dict it returns. That testability is a real and often-undersold benefit.

> **Three kinds of edge**
>
> **Normal** — `add_edge("a", "b")` — always go from a to b.
>
> **Conditional** — `add_conditional_edges("a", router)` — a function inspects state and returns the name of the next node. This is your branching, and it's ordinary Python you can unit-test in isolation.
>
> **Fan-out** — Several edges from one node run in parallel; results merge via the reducers. A barrier by default — the graph waits for all branches before continuing.

> **The safety property, stated precisely**
>
> **A node can only be reached by an edge you drew.**
>
> An agent handling production systems cannot be allowed to improvise its way to a destructive action. A prompt saying "never delete without approval" is a request the model may decline. An edge that doesn't exist is a structural guarantee.
>
> This is the sentence to have ready — it's the strongest single argument for graph-based agents and it generalises well.

## Checkpointers

*LangGraph · 12*

> **What they do**
>
> A **checkpointer** saves the state after every node. Attach one and the graph becomes durable.
>
> ```python
> from langgraph.checkpoint.postgres import PostgresSaver
>
> graph = builder.compile(checkpointer=PostgresSaver(conn))
>
> config = {"configurable": {"thread_id": "ticket-4821"}}
> graph.invoke({"messages": [msg]}, config)
> ```
>
> The `thread_id` identifies a conversation or run. Invoke again with the same one and it picks up exactly where it left off.

> **What you get for one line**
>
> - **Memory across turns** — history is state, persisted. This is what replaced LangChain's old memory classes, and it's a much cleaner model.
> - **Crash resumption** — the process dies mid-run; restart and continue from the last completed node rather than from the beginning. For an agent that has already performed side effects, this is the difference between resumable and dangerous.
> - **Pausing** — a run can stop for hours awaiting human approval without holding a process open.
> - **History** — every checkpoint is retained, so you can inspect exactly what the state was at step four.
>
> Options range from an in-memory saver for tests to SQLite for single-node deployments to Postgres for production.

## Human in the loop

*LangGraph · 13*

> **Interrupts**
>
> Because state is checkpointed, the graph can genuinely stop — not block a thread, but persist and exit — then resume later from a different process.
>
> ```python
> def confirm_destructive(state):
>     approval = interrupt({
>         "action": state["pending_action"],
>         "reason": state["reasoning"],
>     })
>     return {"approved": approval["ok"]}
> ```
>
> Execution halts. The pending action surfaces to your UI. A human approves or rejects, possibly the next day. You resume with their answer and the graph continues as though nothing happened.

> **Why this is the feature that justifies the framework**
>
> Try building it yourself. You need to serialise arbitrary mid-execution state, store it, expose it, accept a response, restore the state and continue at exactly the right point — across a process boundary.
>
> That's genuinely hard, and it's the difference between an agent that can be trusted with consequential actions and one that can only be trusted with read-only ones. If you take one thing from LangGraph, take this.

## Streaming, subgraphs, time travel

*LangGraph · 14*

> **Streaming modes**
>
> More than token streaming — you choose what to emit:
>
> | Mode | Emits | Use for |
> |---|---|---|
> | `values` | Full state after each node | Debugging |
> | `updates` | Just the delta each node returned | Progress UI — "checking disk…" |
> | `messages` | LLM tokens as generated | Chat UI |
> | `debug` | Everything | Development |
>
> The `updates` mode is underrated: it's how you show a user "diagnosing… found the problem… applying the fix" instead of a spinner for forty seconds.

> **Subgraphs**
>
> A compiled graph can be a node in another graph. Build a diagnosis subgraph, an escalation subgraph, compose them. Keeps large agents comprehensible and lets you test each piece independently.

> **Time travel**
>
> Because every checkpoint is kept, you can rewind to any earlier state and re-run from there — optionally after editing the state.
>
> Enormously useful in development: the agent went wrong at step six, so rewind to step five, change one field, and see whether it recovers. It turns debugging a non-deterministic system into something closer to a normal debugger.

## When to use it

*LangGraph · 15*

> **The alternatives, compared fairly**
>
> | Option | Strength | Weakness |
> |---|---|---|
> | **LangGraph** | Explicit control flow, durable state, interrupts, resumability | Concepts to learn; overkill for simple flows |
> | **Plain ReAct loop** | Fifty lines, no dependency, total clarity | No durability, no approval points, cannot be constrained |
> | **Plain Python state machine** | No framework risk; you control everything | You build persistence, resumption and streaming yourself |
> | **CrewAI / AutoGen** | Multi-agent conversation, quick to demo | Hard to make deterministic or debug |
> | **Temporal** | Best-in-class durable execution; battle-tested at scale | Heavy infrastructure; not LLM-aware |
> | **Provider agent SDKs** | Tight integration, minimal code | Provider lock-in; fewer control-flow guarantees |
>
> **The comparison worth being able to make is LangGraph vs Temporal**, because it shows you understand what problem is actually being solved. Both do durable execution. Temporal is more mature and more general, and knows nothing about LLMs. LangGraph is lighter and purpose-built — streaming, message state, interrupts shaped for approval flows. If you already run Temporal, using it is defensible. If you don't, standing it up to run an agent is a lot of infrastructure.

> **The decision rule**
>
> **The more consequential the actions and the longer-running the process, the more LangGraph earns its place.**
>
> Read-only Q&A that completes in five seconds: use a loop. An agent that restarts customer services, needs human approval for destructive operations, and must survive a deploy mid-run: use the graph.

## What LangSmith is

*LangSmith · 16*

> **The problem**
>
> An LLM application fails in ways normal software doesn't. Nothing throws. There's no stack trace. The output is just… wrong. And because it's non-deterministic, it may not be wrong the next time you try.
>
> Your logs say a request was made and a response returned. They don't tell you what prompt was actually assembled, what the retriever returned, which tool was called with what arguments, or where in a nine-step chain it went off.

**LangSmith** records all of that. Four capabilities:

| Capability | What it gives you |
|---|---|
| **Tracing** | Every step of every run, nested, with full inputs and outputs, latency, tokens and cost |
| **Datasets** | Saved examples — often promoted directly from real traces — to test against |
| **Evaluation** | Run a version against a dataset and score it, with code or LLM judges |
| **Monitoring** | Production dashboards: latency, cost, error rate, user feedback |

> **It works without LangChain**
>
> Two lines of environment config and LangChain/LangGraph trace automatically. But for arbitrary code there's a decorator:
>
> ```python
> from langsmith import traceable
>
> @traceable
> def answer_ticket(question: str) -> str:
>     chunks = my_retriever(question)      # nested span
>     return my_openai_call(question, chunks)
> ```
>
> Wrap any function and it appears as a span. So you can adopt the observability without adopting the framework — a genuinely reasonable thing to do, and worth knowing since people assume otherwise.

## Reading a trace

*LangSmith · 17*

```
▼ answer_ticket                              4.21s   $0.0083
  ├─ ▼ contextualise_query                   0.62s   $0.0002
  │    in:  "and why is it still queuing?"
  │    out: "why are SMTP messages still queuing after
  │          configuring port 587 with STARTTLS?"
  ├─ ▼ hybrid_retrieve                       0.31s
  │    ├─ dense_search      0.18s   → 50 chunks
  │    └─ bm25_search       0.09s   → 50 chunks
  │    out: 60 unique after RRF
  ├─ ▼ rerank                                0.44s
  │    out: [c_0087 0.94, c_1042 0.88]
  └─ ▼ generate                              2.84s   $0.0081
       prompt:  [full assembled text — 3,142 tokens]
       output:  "Messages queue when the relay rejects…"
       model:   gpt-4o    tokens: 3142 in / 186 out
```

> **The line that matters most**
>
> `prompt: [full assembled text]`.
>
> Being able to see *exactly* what was sent to the model, for any request, including one from three weeks ago that a customer just complained about, is most of the value. Templates, truncated history and retrieved context combine in ways that surprise you, and what you think you sent is regularly not what you sent.

> **The other things you get from the tree shape**
>
> - **Latency attribution** — 2.84 of 4.21 seconds is the final generation. Optimising the retriever would be wasted effort; that's visible at a glance and invisible in a single timing number.
> - **Cost attribution** — per run, per step, per user.
> - **Where it went wrong** — walk down until the output stops making sense. Usually retrieval, not the model.
> - **Promote to dataset** — a trace that went wrong becomes a test case with one click. This is the loop that makes evaluation sets grow from real usage instead of imagination.

## Datasets and evaluation

*LangSmith · 18*

> **The workflow**
>
> 1. Collect examples — real traces, edge cases, known failures.
> 2. Define evaluators — code assertions, or LLM judges, or both.
> 3. Run a version of your system against the dataset.
> 4. Compare versions side by side, example by example.
>
> ```python
> from langsmith.evaluation import evaluate
>
> def is_grounded(run, example):
>     return {"key": "grounded",
>             "score": all_claims_supported(run.outputs, run.inputs["context"])}
>
> evaluate(my_chain, data="support-golden-v3",
>          evaluators=[is_grounded, answers_question])
> ```

> **Why this matters more than the tracing**
>
> Without it, "did my prompt change make things better?" is answered by trying three examples and forming an impression. That is not engineering, and it's how LLM applications quietly get worse over months of well-intentioned edits.
>
> With a dataset, it's a number. And crucially you can see *which specific examples regressed*, which is what tells you whether the change is worth its cost.

> **The dataset is the asset — keep it portable**
>
> Evaluation datasets and evaluator logic are the genuinely valuable thing you build here, and they're where switching costs concentrate.
>
> Keep them in version control as files, synced to the platform rather than living only in it. Costs almost nothing and preserves your freedom to move.

## Versus Phoenix and Langfuse

*LangSmith · 19*

> **The observability landscape**
>
> | Tool | Model | Notes |
> |---|---|---|
> | **LangSmith** | Proprietary SaaS; enterprise self-host | Deepest LangChain/LangGraph integration. Strong evaluation. Free dev tier. |
> | **Arize Phoenix** | Open source, self-hostable | OpenTelemetry-native, OpenInference conventions. Runs locally with no account. Strong on RAG-specific analysis and embedding visualisation. |
> | **Langfuse** | Open source + hosted | The usual OSS alternative to LangSmith. Tracing, prompt management, evaluation. |
> | **W&B Weave** | Commercial | Natural if you already run Weights & Biases for training. |
> | **Braintrust** | Commercial | Evaluation-first rather than tracing-first. |
> | **Plain OpenTelemetry** | Open standard | Emit spans, send them anywhere. Most portable, least LLM-specific tooling. |

> **If you already use Phoenix — the comparison you'll be asked to make**
>
> Say it like this:
>
> "Phoenix is OpenTelemetry-native and self-hosted, which matters when you're already running an OTel pipeline and want LLM spans in the same trace as everything else — the ASR call, the database query, the downstream service. Traces stay in your infrastructure, which for call data is often a requirement rather than a preference. And you can run it locally with no account, which is genuinely useful in development.
>
> LangSmith's advantage is depth of integration with LangChain and LangGraph — nested spans appear automatically with no instrumentation — and a more mature evaluation product.
>
> The way I'd frame the choice: if your LLM calls are one part of a larger distributed system you already trace, OTel-native wins on coherence. If your application *is* the LLM pipeline and you're on the LangChain stack, LangSmith's integration depth is worth more."

## Should you use it?

*Deciding · 20*

> **Component by component**
>
> | Piece | Use it when | Skip it when |
> |---|---|---|
> | **LangChain** | Many integrations; multiple providers; you value the swap-in-one-line property | One provider, few integrations — the SDK is fine and clearer |
> | **LangGraph** | Multi-step agents, consequential actions, human approval, long-running or resumable work | Single-call or simple linear flows |
> | **LangSmith** | Almost always — you need to see prompts and run evaluations | You already run Phoenix or Langfuse and they cover it |

> **The recommendation I'd actually give**
>
> **Adopt observability first, orchestration second, the component library last.**
>
> That inverts how most people adopt the stack, and it's the right order. Tracing pays for itself on day one, whichever tool you pick. Orchestration pays for itself the first time an agent needs to pause for approval or survive a restart. The component library pays for itself only if you're integrating broadly — and if you're not, it's abstraction you'll spend time reading through.

## The whole landscape

*Deciding · 21*

> **Frameworks**
>
> **LlamaIndex** — The main peer. RAG-first heritage — stronger opinions and better defaults for indexing and retrieval. LangChain is broader; LlamaIndex is deeper on retrieval. Both have grown toward each other.
>
> **Haystack** — From deepset. Pipeline-oriented, production-minded, popular in Europe. Less hype, solid engineering.
>
> **DSPy** — Genuinely different idea: declare what you want, and it *optimises the prompts for you* against a metric. Compelling when you have good evaluation data; a research-flavoured mental model.
>
> **Semantic Kernel** — Microsoft's. Natural if you're in .NET or Azure.
>
> **Pydantic AI** — Newer, from the Pydantic team. Type-safe, deliberately minimal — appealing if LangChain's abstraction weight is your objection.
>
> **Plain SDK** — Always a legitimate answer. For focused applications it's often the clearest code you can write.

> **Orchestration and durability**
>
> **Temporal** — The serious durable-execution engine. Mature, scales, not LLM-aware.
>
> **Prefect / Dagster / Airflow** — Data pipeline orchestrators. Right for batch document processing; wrong for interactive agents.
>
> **Inngest / Restate** — Newer durable-function platforms, lighter than Temporal.

## How to test, and where to breakpoint

*Reference · 22*

> **1 · Unit-test nodes as plain functions**
>
> The main practical payoff of the graph model. A node takes a dict and returns a dict — call it directly, assert on the result. No framework, no mocks beyond the model client.
>
> ```python
> def test_diagnose_flags_full_disk():
>     out = diagnose_disk({"domain": "x.com"})
>     assert "disk at 98%" in out["findings"][0]
> ```

> **2 · Test routers separately from nodes**
>
> A conditional edge's function is pure logic. Feed it states, assert on the node name it returns. Fast, deterministic, and it covers your control flow without invoking a model at all.

> **3 · Test the graph with a scripted fake model**
>
> Replace the model with something that returns a fixed sequence of responses. Now you can assert the whole path deterministically — that a tool call leads to the tools node, that a destructive action reaches the approval interrupt.

> **4 · Test the interrupt path explicitly**
>
> Invoke until it interrupts, assert on the pending state, resume with an approval and with a rejection, assert both outcomes. **This is your safety property** — if approval can be bypassed, that's the bug that matters most, and it belongs in CI.

> **5 · Evaluate end to end against a dataset**
>
> Real historical inputs with known-good outcomes. Run on every change. Accept that scores move rather than pass/fail, and alert on regressions.

> **Where to breakpoint**
>
> **The state between nodes** — The highest-value one. Stream with `updates` mode or read the checkpoint history. Wrong behaviour is usually visible as wrong state one node earlier than where you noticed.
>
> **The assembled prompt** — Second-highest. In LangSmith it's on the generation span; without it, log it yourself before every call.
>
> **The router's return value** — Which edge was taken, and what state produced that decision.
>
> **Tool call arguments, before execution** — What did the model want to do, with what inputs? Log this whether or not you execute it.
>
> **Checkpoint history for a thread** — Replay the whole run state by state. This is what makes a non-deterministic failure debuggable after the fact.

## Interview answers

*Reference · 23*

**Q: What's the difference between LangChain, LangGraph and LangSmith?**

"Three separate products from the same company, and they're independent — you can use any one without the others.

LangChain is a component library: standard interfaces over models, prompts, retrievers, vector stores and tools, so swapping providers is a constructor change rather than a rewrite.

LangGraph is orchestration: build an agent as an explicit graph of nodes and edges with typed shared state, checkpointed after every step, so it can pause for human approval and resume after a crash.

LangSmith is observability and evaluation — a hosted platform showing every step of every run with the full prompts, plus datasets and evaluators for testing changes.

The libraries are MIT-licensed open source; LangSmith is proprietary SaaS. Classic open core."

**Q: Isn't LangChain bloated? Why not just use the SDK?**

Engage with it — don't get defensive.

"A lot of the criticism was fair. Too many abstraction layers, hard to see what prompt was actually sent, and constant breaking changes through 2023 and 2024. The 1.0 release narrowed the surface considerably, which is essentially the project agreeing with its critics.

Where I think it still earns its place is integration breadth — hundreds of loaders, splitters and vector store adapters already written — and the provider-swap property, if you actually swap providers.

Where I'd skip it: one provider, a handful of integrations, straightforward calls. The SDK is clearer and you're not reading through layers to understand a request.

I'd also separate LangGraph from this. It's a stronger product solving a harder problem, and judging them as one thing is a mistake."

**Q: Why LangGraph over a simple agent loop?**

"A loop is fine until you need production properties, and then it isn't.

Four things LangGraph gives me that a loop doesn't. State is explicit and typed rather than buried in a message list, so I can print it, assert on it in tests, and persist it. Control flow is structural — a node is only reachable by an edge I drew, so 'never delete without approval' is a guarantee rather than a prompt instruction the model might ignore. Checkpointing after every node means a run survives a process restart, which matters enormously when the agent has already taken side effects. And interrupts let it genuinely pause for human approval — persist and exit, not block a thread — then resume from a different process hours later.

My rule: the more consequential the actions, the more structure is worth. Read-only Q&A can be a loop. Anything writing to a customer's production system should be a graph."

**Q: Explain LangGraph state reducers.**

Specific enough to separate readers from users.

"Each node returns a partial state update, and the reducer defines how that merges with what's there. A field annotated with `add` appends — that's how message history accumulates. A field with no reducer is overwritten.

The reason it's not just convenience is parallel nodes. If two branches run concurrently and both write to the same field, the reducer defines the merge deterministically. Without it one would clobber the other depending on timing, and you'd have a race that only shows up under load."

**Q: How do you debug an agent that gave a wrong answer?**

Answer as a procedure.

"I'd pull the trace and walk down it until the output stops making sense — that localises the failing step, which is usually not the step where I noticed the problem.

The two things I look at first are the retrieved context and the fully assembled prompt. Most 'the model got it wrong' turns out to be 'the model was given the wrong thing', and the assembled prompt is regularly not what you think it is once templates, truncated history and retrieved chunks combine.

With LangGraph I'd also read the checkpoint history for that thread — the state after each node — because wrong behaviour is usually visible as wrong state one node earlier. And if it's reproducible I'd use time travel: rewind to just before the failure, adjust the state, and re-run from there.

Then I'd promote that run to the evaluation dataset so the fix is protected by a regression test."

**Q: LangSmith or Phoenix?**

"Depends on what else you're tracing.

Phoenix is OpenTelemetry-native and self-hosted. That matters when LLM calls are one part of a larger distributed system you already trace — you want the model span in the same trace as the transcription, the database query and the downstream service, not in a separate tool. Data stays in your infrastructure, which for call recordings is often a compliance requirement rather than a preference.

LangSmith's edge is integration depth with LangChain and LangGraph — the nested spans appear with no instrumentation — and a more mature evaluation product.

Either way, I'd keep evaluation datasets in version control rather than only in the platform. That's the asset, and it's where switching costs concentrate."

**Q: Is there vendor lock-in?**

"Less than people assume on the libraries, more than they assume on the platform.

LangChain and LangGraph are MIT and run in your own process — no phoning home, no availability risk. Worst case you keep running the version you have.

The real switching cost is LangSmith: years of production traces that don't export cleanly, and your evaluation datasets and evaluators. I'd mitigate by instrumenting with OpenTelemetry so traces can go to more than one backend, and by keeping datasets as files in the repo."

## Glossary

*Reference · 24*

**LangChain** — MIT-licensed component library: models, prompts, retrievers, tools.

**LangGraph** — MIT-licensed orchestration library: agents as stateful graphs.

**LangGraph Platform** — Commercial hosting and tooling for LangGraph applications.

**LangSmith** — Proprietary SaaS for tracing, datasets, evaluation and monitoring.

**Open core** — Free open-source libraries, paid hosted layer. The business model here.

**Runnable** — LangChain's core interface: invoke, batch, stream, plus async.

**LCEL** — Composing Runnables with `|`; brings streaming, batching, async and tracing along.

**langchain-core** — Base abstractions, minimal dependencies.

**langchain-community** — Community-maintained integrations; quality varies.

**StateGraph** — LangGraph's builder — add nodes and edges, then compile.

**Node** — A function taking state and returning a partial update.

**Conditional edge** — A function that inspects state and names the next node.

**Reducer** — Defines how a state field merges across updates — append vs replace.

**Checkpointer** — Persists state after each node. Enables memory, resumption and pausing.

**Thread** — An identified run or conversation; the key for resuming.

**Interrupt** — Pause execution, surface to a human, resume later with their answer.

**Subgraph** — A compiled graph used as a node inside another.

**Time travel** — Rewind to an earlier checkpoint and re-run, optionally after editing state.

**Trace / span** — A recorded run and its nested steps, with inputs, outputs, latency and cost.

**traceable** — A decorator that traces arbitrary functions without LangChain.

**Dataset** — Saved examples to evaluate against; often promoted from real traces.

**Evaluator** — A scoring function — code assertion or LLM judge.

**OpenTelemetry** — The vendor-neutral tracing standard. Portability insurance.

---

Companion documents: inside a language model · retrieval end to end · Vasco stack · voice runtime · pipecat upgrade · telephony · CI/CD and containers · distributed systems.
Version numbers, package layout and licence terms in this ecosystem move quickly — verify specifics against current documentation.
