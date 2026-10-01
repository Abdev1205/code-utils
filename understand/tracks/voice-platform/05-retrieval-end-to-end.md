# Retrieval, End to End

**Topic:** RAG
**Covers:** Parsing, chunking, embeddings, indexes, hybrid search, reranking, evaluation
**Source:** [Claude artifact](https://claude.ai/artifact/NVuGku3dAcfngBM5wnQs7M) — written by a colleague, mirrored here for study.

*Chunking · embeddings · hybrid search · evaluation*

Every stage of a RAG system, from a PDF on disk to a cited answer — with the chunking strategies compared properly, the index internals explained, and the evaluation maths worked out by hand.

> **The thing to hold on to**
>
> **RAG is a search problem wearing an AI hat.** Almost every RAG failure is a retrieval failure, and almost every retrieval failure was caused earlier — in parsing or chunking — than where you notice it.
>
> Teams spend weeks tuning prompts when the actual problem is that their PDF parser dropped the tables. Read this document with that in mind: the unglamorous early stages are where quality is won or lost.

## Why RAG exists

*Orientation · 01*

> **The gap it fills**
>
> A language model knows what was in its training data, frozen at its cutoff. It does not know your documentation, your ticket history, your customer's plan, or anything that happened last week. Ask anyway and it produces something fluent and possibly false.
>
> **RAG — retrieval-augmented generation** — closes the gap by searching your own material first and putting the results in the prompt. The model stops recalling and starts reading.

```
user question
     ↓
 SEARCH your documents
     ↓
 paste the best passages into the prompt
     ↓
 "answer using only the text above"
     ↓
 answer, with citations
```

> **Four properties that make it the default**
>
> - **Fresh.** Update a document, the answers update. No retraining.
> - **Attributable.** You know which passage produced the answer, so you can cite it and a human can check it.
> - **Access-controlled.** Retrieve only what this user is allowed to see. Impossible with fine-tuning, where knowledge is smeared across the weights.
> - **Cheap to change.** Adding a document costs nothing; fine-tuning costs a training run.

> **The alternatives, and when each actually wins**
>
> | Approach | Wins when | Loses because |
> |---|---|---|
> | **RAG** | Large or changing corpus; citations needed; per-user scoping | Machinery to build and maintain |
> | **Long context** — paste everything | Small fixed corpus, under ~100k tokens | Cost and latency per call; accuracy degrades with irrelevant material |
> | **Fine-tuning** | Teaching format, style, domain idiom | Bad at facts — goes stale, can't cite, expensive to update |
> | **Text-to-SQL** | The facts are already in a relational database | Only works on structured data |
> | **Tool use / search API** | An authoritative live API exists | Needs an API to exist |
>
> These compose. A serious system usually has RAG over documents *and* text-to-SQL over the database *and* a couple of live API tools, with a router choosing.

## The whole pipeline

*Orientation · 02*

Two halves. The first runs offline, when documents change. The second runs per query, in milliseconds.

```
═══ INDEXING (offline, on document change) ═══

 documents
     ↓  parse        PDF/HTML/DOCX → clean text + structure
     ↓  chunk        split into retrievable pieces
     ↓  enrich       attach metadata, context
     ↓  embed        each chunk → a vector
     ↓  index        store vectors + text + metadata
  ┌─────────┐
  │  store  │
  └─────────┘

═══ QUERYING (online, per request) ═══

 question
     ↓  transform    rewrite / expand / decompose
     ↓  retrieve     dense + sparse, top ~50
     ↓  filter       permissions, recency, source
     ↓  rerank       cross-encoder → top ~5
     ↓  assemble     build the prompt
     ↓  generate     answer grounded in those chunks
     ↓  cite         link back to sources
 answer
```

> **Build it in this order**
>
> Naive first: fixed-size chunks, one embedding model, top-5 dense retrieval. Measure it. *Then* add complexity where the measurement says you need it.
>
> Teams that build the sophisticated version first have no baseline, can't tell which piece is helping, and end up maintaining machinery that isn't earning its keep. The evaluation harness is not the last step — it's the second.

## Parsing

*Getting text in · 03*

> **The least glamorous stage, and the one that most often ruins everything**
>
> Garbage in, garbage retrieved. If your parser turns a pricing table into a soup of unlabelled numbers, no amount of embedding sophistication recovers the meaning.

### What breaks, by format

| Format | The trouble |
|---|---|
| **PDF** | A layout format, not a text format. Multi-column pages interleave into nonsense. Headers and footers repeat into every chunk. Tables lose their structure. Scanned pages have no text at all. |
| **HTML** | Navigation, cookie banners and footers outweigh the content. Needs boilerplate removal, and heading structure is worth preserving rather than flattening. |
| **DOCX / slides** | Text boxes come out in arbitrary order. Speaker notes may or may not matter. |
| **Tables** | The hard case everywhere. A row means nothing without its column headers, and flattening loses exactly that. |
| **Code** | Splitting mid-function destroys it. Parse by structure — function, class — not by character count. |

> **Three techniques worth knowing**
>
> **Markdown as the intermediate format** — Convert everything to Markdown first. It preserves headings, lists and tables in a form that's both human-readable and chunkable by structure, and it gives every downstream stage one format to handle instead of six.
>
> **Table serialisation** — Rather than flattening a table, emit each row as a self-contained sentence that repeats the headers: `"Plan: Business. Storage: 100GB. Price: $29/mo."` Now a single row retrieves meaningfully on its own.
>
> **Vision models for hard documents** — For scanned or heavily-laid-out PDFs, send the page image to a multimodal model and ask for structured Markdown. Slower and costlier per page, but it handles what text extraction cannot — and indexing is offline, so slow is acceptable.

> **The check nobody does and everybody should**
>
> **Read twenty of your parsed chunks with your own eyes.** Not the metrics — the actual text.
>
> You will find repeated page footers, tables reduced to number soup, sentences cut mid-word, and navigation menus indexed as content. Every one of those is silently poisoning retrieval, and none is visible in an aggregate score. This single hour of manual reading is the highest-value thing you can do to a RAG system.

## Chunking, in depth

*Getting text in · 04*

> **Why chunk at all**
>
> Three independent reasons, and they push in the same direction:
> - Embedding models have input limits — typically 512 to 8,192 tokens.
> - One vector per document averages everything together. A 50-page manual becomes a single blurry point that matches everything vaguely and nothing precisely.
> - You want to put only the relevant part into the prompt, not the whole document.
>
> The **chunk is the unit of retrieval**. Everything downstream inherits its quality.

### The strategies, weakest to strongest

> **1 · Fixed-size**
>
> Every N characters or tokens, with an overlap.
>
> ```
> chunk_size = 512 tokens,  overlap = 50 tokens
>
> [────── chunk 1 ──────]
>                  [────── chunk 2 ──────]
>                                   [────── chunk 3 ──────]
>                  └─ 50-token overlap ─┘
> ```
>
> **For:** trivial, fast, predictable, no assumptions about the document.
> **Against:** cuts mid-sentence and mid-idea. A definition split across a boundary is retrievable from neither half.
>
> The overlap exists precisely to soften that — a sentence spanning a boundary appears complete in one of the two chunks. 10–20% is the usual range. It's a mitigation, not a fix.

> **2 · Recursive character splitting**
>
> The sensible default, and what most frameworks use. Try to split on the biggest natural boundary; if the piece is still too large, fall back to the next boundary down.
>
> ```
> separators, in order of preference:
>   "\n\n"   paragraph
>   "\n"     line
>   ". "     sentence
>   " "      word
>   ""       character (last resort)
> ```
>
> So a document with clean paragraphs splits on paragraphs. A wall of unbroken text still gets split, just less gracefully. You get structure-awareness where structure exists and a guaranteed size bound regardless.
>
> **This is the right starting point for almost every project.**

> **3 · Document-structure-aware**
>
> Split on the document's own semantics: Markdown headings, HTML sections, code functions, legal clauses.
>
> ```
> # Email Configuration          ← chunk boundary
> ## SMTP Settings               ← chunk boundary
> Port 587 with STARTTLS...
>
> ## Troubleshooting Delivery    ← chunk boundary
> If messages are not arriving...
> ```
>
> Better than any size-based rule when the structure is real, because the author already decided where ideas begin and end. The strong version also **prepends the heading path** to each chunk — `"Email Configuration > Troubleshooting Delivery: If messages..."` — so a chunk carries its own context.
>
> **Against:** section sizes vary enormously. Cap the long ones with a recursive split inside.

> **4 · Semantic chunking**
>
> Embed each sentence, walk through comparing consecutive sentences, and cut where the similarity drops — the point where the topic changes.
>
> ```
> sentence 1 ─┐ 0.91
> sentence 2 ─┤ 0.88   same topic
> sentence 3 ─┤ 0.42   ← big drop: cut here
> sentence 4 ─┤ 0.87
> sentence 5 ─┘        new topic
> ```
>
> **For:** genuinely topic-coherent chunks; no arbitrary boundaries.
> **Against:** an embedding call per sentence at index time, a threshold to tune, unpredictable sizes — and in practice it often *doesn't beat* a good structure-aware split on well-formatted documents. Reach for it on unstructured prose (transcripts, notes) where there's no structure to exploit.

> **5 · Small-to-big (parent document)**
>
> The insight that resolves the central tension: **the best chunk to search is not the best chunk to read.**
>
> Small chunks match precisely. Large chunks give the model enough context to answer. So use both — index small, return large.
>
> ```
> index:   small chunks (1–2 sentences)  →  embedded, searched
> return:  the parent section they came from  →  sent to the LLM
> ```
>
> Search precision of a sentence, answer context of a section. **One of the highest-value upgrades available**, and cheap to implement: store a parent ID on every child chunk and dereference after retrieval.

> **6 · Sentence-window**
>
> The same idea, differently shaped. Index individual sentences; when one hits, return it plus the k sentences either side.
>
> Adapts to where the match landed rather than to fixed parent boundaries. Good for continuous prose; small-to-big is better where real sections exist.

> **7 · Contextual retrieval**
>
> The strongest recent technique and worth knowing by name. Before embedding, use a cheap LLM to write one or two sentences situating the chunk in its document, and prepend that.
>
> ```
> raw chunk:
>   "The limit is 50 per hour."
>
> contextualised chunk:
>   "From the Business plan section of the API rate limits
>    documentation, describing outbound email sending:
>    The limit is 50 per hour."
> ```
>
> It fixes the fundamental problem with chunking — that a chunk torn from its document loses the context that made it meaningful. Pronouns resolve, implicit subjects become explicit, and the chunk becomes retrievable by the terms someone would actually search for.
>
> **Cost:** one LLM call per chunk at index time. Real, but one-off and offline — and prompt caching over the source document makes it much cheaper than it first appears.

> **Also in the toolbox**
>
> **Propositions** — Decompose text into standalone atomic facts, each independently retrievable. Very high precision; expensive, and it loses narrative flow.
>
> **Multi-representation** — Index an LLM-written summary of each document, but return the full document. Useful when documents are long and internally coherent.
>
> **Hypothetical questions** — For each chunk, generate the questions it answers and index *those*. Closes the gap between how users ask and how documents are written.
>
> **Late chunking** — Embed the whole document with a long-context embedding model, then pool the token embeddings per chunk. Each chunk vector is informed by the whole document. Newer, promising.

## Choosing a chunk size

*Getting text in · 05*

| Size | Retrieval behaviour | Answer behaviour |
|---|---|---|
| **Small** (100–250 tok) | Precise — matches the exact fact | Often lacks the surrounding context needed to answer |
| **Medium** (400–800 tok) | The usual sweet spot | Usually enough |
| **Large** (1000+ tok) | Blurry — the vector averages several topics, so it matches everything weakly | Plenty of context, plus a lot of noise |

> **The single most useful principle here**
>
> **A chunk should contain one idea, and enough surrounding text that the idea makes sense alone.**
>
> Test it by reading a chunk cold, with no other information. If you can't tell what it's about, neither can the embedding model — and no retriever will find it for the right query.

> **How to actually pick**
>
> 1. Start at 512 tokens with 50 overlap, recursive splitting.
> 2. Build a labelled question set from real user questions (30–100 is enough to be informative).
> 3. Sweep: 256 / 512 / 1024. Measure recall@10 and precision@5 for each.
> 4. Take the winner, then try small-to-big on top — it usually beats every fixed size.
>
> The sweep takes an afternoon and settles an argument that otherwise runs for weeks. There is no universally correct chunk size; there is a correct one for your documents and your questions.

## Metadata

*Getting text in · 06*

Every chunk should carry structured fields alongside its text. This is cheap at index time and repeatedly valuable at query time.

```json
{
  "text":        "SMTP port 587 with STARTTLS is required...",
  "doc_id":      "kb-email-setup",
  "title":       "Email Configuration",
  "section":     "SMTP Settings",
  "heading_path":"Email Configuration > SMTP Settings",
  "source_url":  "https://docs.../email#smtp",
  "updated_at":  "2026-03-14",
  "product":     "cpanel",
  "audience":    "customer",
  "tenant_id":   "acme-corp",
  "parent_id":   "chunk-0091"
}
```

> **What each field buys you**
>
> - **Filtering** — search only this tenant's documents, only the current product version, only what this user may see. *This is a security control*, not a convenience.
> - **Recency weighting** — prefer the current document over the 2021 one when both match.
> - **Citation** — you can only cite a source if you stored where the chunk came from.
> - **Debugging** — when a bad chunk is retrieved, metadata tells you instantly which document and section produced it.
> - **Deletion** — when a document is removed or a customer exercises deletion rights, `doc_id` and `tenant_id` are how you find every affected vector.

> **Multi-tenancy: filter in the query, never after**
>
> Retrieving the global top 50 and then discarding other tenants' chunks in application code is a data-leak waiting for one bug — and it also silently degrades recall, because a tenant's own best chunks may not have made the global top 50 at all.
>
> Push `tenant_id` into the index query as a pre-filter. Both vector databases and pgvector support this.

## Embedding models

*Making it searchable · 07*

> **What they are**
>
> A model that turns text into a fixed-length list of numbers, trained so that texts with similar meaning land close together in that space. Search becomes geometry: embed the query, find the nearest chunks.
>
> Architecturally these are **encoder** models — bidirectional, so every token sees the whole passage — which is why they're a different family from the decoder models that generate text.

### How similarity is measured

| Measure | What it captures |
|---|---|
| **Cosine similarity** | The angle between vectors, ignoring length. The standard choice — text length shouldn't affect topical similarity. |
| **Dot product** | Angle *and* magnitude. Identical to cosine when vectors are normalised, which most models do. |
| **Euclidean (L2)** | Straight-line distance. Also equivalent to cosine on normalised vectors. Rarely the deliberate choice for text. |

In practice: normalise your vectors and use cosine. Then the three coincide and you stop having to think about it.

> **Symmetric vs asymmetric — a distinction that matters**
>
> **Symmetric**: both sides are the same kind of text. "Find documents similar to this document." Deduplication, clustering.
>
> **Asymmetric**: a short question against long passages. That's RAG, and it's harder — a question and its answer often share very few words.
>
> Many embedding models are trained for asymmetric search and want **prefixes** to tell them which side they're embedding:
>
> ```
> query:    "query: how do I fix SMTP errors"
> document: "passage: SMTP delivery failures are usually..."
> ```
>
> **Using the wrong prefix, or omitting them, measurably hurts retrieval.** It's in the model card, it's easy to miss, and it's a common silent bug. Check yours.

> **Choosing a model**
>
> **MTEB** (Massive Text Embedding Benchmark) is the standard leaderboard. Treat it as a shortlist generator, not an answer — models are tuned for it, and your domain isn't in it.
>
> | Consideration | What to weigh |
> |---|---|
> | **Dimensions** | 384 / 768 / 1024 / 1536 / 3072. Higher is usually slightly better and linearly more storage and RAM. *Matryoshka* models let you truncate the vector and lose surprisingly little — a genuine free lunch when memory is tight. |
> | **Max input** | 512 tokens is common and constrains your chunk size. Long-context embedding models (8k+) exist. |
> | **Multilingual** | If your content or questions aren't English, this dominates every other consideration. Test on your actual languages. |
> | **Hosted or self-hosted** | An API is simpler; a local model means no per-call cost, no data leaving, and no rate limit. Embedding models are small — self-hosting one is genuinely easy. |
> | **Domain fit** | General models handle jargon-heavy corpora poorly. Test before committing. |

> **Changing the embedding model means re-indexing everything**
>
> Vectors from different models are not comparable — different spaces, often different dimensions. Switching means re-embedding the entire corpus.
>
> So build for it: store the model name and version with every vector, and design the index so a rebuild is a routine operation rather than an outage. You *will* change models.

## The vector index

*Making it searchable · 08*

> **The problem**
>
> Finding the nearest vector to a query means comparing against every stored vector. At 10,000 chunks that's fine. At 10 million it's far too slow for an interactive query.
>
> So you use **ANN** — approximate nearest neighbour. Accept "almost always the right answers" in exchange for being orders of magnitude faster. The trade is explicit and tunable.

### The three index families

> **Flat — brute force**
>
> Compare against everything. Exact by definition, no build step, no tuning. Perfectly fine up to roughly 100k vectors, especially with modern SIMD. **Start here** — many systems never need more.

> **IVF — inverted file**
>
> Cluster the vectors with k-means into *lists*, each with a centroid. At query time, find the nearest few centroids and search only those lists.
>
> ```
> 1000 clusters, search the nearest 10  →  ~1% of the data scanned
> ```
>
> `nprobe` is the dial: more probes, better recall, slower. The weakness is boundary effects — a true neighbour sitting just across a cluster line gets missed. Needs a training pass, and degrades if the data distribution shifts after training.

> **HNSW — hierarchical navigable small world**
>
> The current default, and worth understanding rather than just naming.
>
> Build a graph where each vector links to its near neighbours, in **layers**. The top layer is sparse with long-range links; each layer down is denser and more local — like an express train network above a local one.
>
> ```
> layer 2:   A ─────────────── F          few nodes, long hops
> layer 1:   A ──── C ──── E ── F         more nodes
> layer 0:   A─B─C─D─E─F─G─H─I─J─K        every node
>
> search: enter at the top, greedily walk toward the query,
>         drop a layer, repeat, finish with a local search at the bottom
> ```
>
> Excellent recall at high speed. Two knobs:
> - `M` — links per node. Higher: better recall, more memory. 16–64 typical.
> - `ef_search` — how many candidates to keep during the walk. **The runtime recall/latency dial.** Raise it and recall improves at the cost of latency, with no rebuild.
>
> Costs: high memory (the graph lives in RAM), slow to build, and deletion is awkward — most implementations tombstone and require periodic rebuilds.

> **Compression, when memory is the constraint**
>
> **Scalar quantisation** — Store each dimension as int8 rather than float32. 4× smaller, negligible quality loss. Almost always worth turning on.
>
> **Product quantisation (PQ)** — Split the vector into sub-vectors, replace each with the nearest entry in a learnt codebook. 10–50× smaller, real quality loss. Usually paired with a re-scoring pass over full vectors for the top candidates.
>
> **Binary quantisation** — One bit per dimension. Enormous compression, big quality loss on its own — viable as a fast first pass followed by exact re-ranking.

> **Filtering and ANN fight each other**
>
> "Nearest neighbours *where tenant_id = X*" is harder than it looks. Two bad options and one good one:
>
> - **Post-filter** — retrieve top 100, then filter. If the tenant is small, you may filter down to zero results. Recall silently collapses.
> - **Pre-filter then brute force** — correct, but loses the index if the filtered set is large.
> - **Filtered ANN** — the index applies the predicate during traversal. What good implementations do, and what you should check your store supports before designing around filters.

## pgvector, and where Neo4j fits

*Making it searchable · 09*

> **pgvector**
>
> A Postgres extension adding a `vector` column type, distance operators, and ANN indexes. Your vectors live in the same database as everything else.
>
> ```sql
> CREATE EXTENSION vector;
>
> CREATE TABLE chunks (
>   id         bigserial PRIMARY KEY,
>   doc_id     text NOT NULL,
>   tenant_id  text NOT NULL,
>   content    text NOT NULL,
>   updated_at timestamptz,
>   embedding  vector(1024)
> );
>
> CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops);
> CREATE INDEX ON chunks (tenant_id);
>
> SELECT content, 1 - (embedding <=> $1) AS similarity
> FROM   chunks
> WHERE  tenant_id = $2
> ORDER  BY embedding <=> $1
> LIMIT  20;
> ```
>
> The operators: `<=>` cosine distance, `<->` L2, `<#>` negative inner product. Note `<=>` is a *distance* — smaller is closer — so similarity is `1 - distance`.

> **Why pgvector is the right default**
>
> - **One database.** No second system to run, back up, monitor, secure and pay for.
> - **Transactional.** Insert the document row and its vectors in one transaction. With a separate vector store, a crash between the two leaves you inconsistent, permanently.
> - **Real SQL filtering.** Joins, permissions, recency, arbitrary predicates — all the things standalone vector stores implement partially.
> - **Postgres operational knowledge transfers.** Your team already has it.
>
> The honest ceiling: at tens of millions of vectors with high query concurrency, a dedicated store will outperform it. Most systems never get there, and "we'd migrate if we hit that" is a perfectly good answer.

> **Dedicated vector stores**
>
> - **Pinecone** — fully managed, no ops. Simplest path, ongoing cost, your data is theirs to hold.
> - **Qdrant** — open source, Rust, strong filtered search. The usual self-hosted pick.
> - **Weaviate** — open source, hybrid search built in, more opinionated.
> - **Milvus** — built for very large scale; heavier to operate.
> - **FAISS** — a library, not a service. Excellent in-process; persistence and serving are yours.
> - **Elasticsearch / OpenSearch** — mature BM25 plus vectors in one system. Compelling if you want hybrid search and already run it.

> **Neo4j — a different job entirely**
>
> A graph database: nodes, relationships, and Cypher to traverse them. It is *not* a competitor to pgvector — it answers a different question.
>
> ```
> vector search answers:   "what text is similar to this?"
> graph traversal answers: "what is connected to this, and how?"
> ```
>
> ```cypher
> MATCH (d:Domain {name:"example.com"})-[:HOSTED_ON]->(s:Server)-[:RUNS]->(p:PHPVersion)
> WHERE p.eol = true
> RETURN d.name, s.hostname, p.version
> ```
>
> Use it when the answer requires **multi-hop** reasoning across relationships that no single passage contains. Graph RAG is covered properly in the Vasco document; the summary is that it's powerful, and it's an ongoing extraction-and-freshness pipeline rather than an index you build once.

## Dense retrieval

*Finding things · 10*

The default: embed the query, find the nearest chunk vectors, return the top k.

> **What it's good at**
>
> **Meaning without shared words.** "My emails aren't arriving" finds "SMTP delivery failure" despite zero overlapping terms. Handles paraphrase, synonyms, and different registers between how users write and how documentation is written.

> **What it's reliably bad at — and this is why you need more than dense**
>
> - **Exact identifiers.** Error code `SMTP-421`, ticket `#48210`, an account number. Rare strings are poorly represented in embedding space and dense search will happily return semantically-similar-but-wrong codes.
> - **Rare proper nouns.** A product or person the embedding model has effectively never seen.
> - **Negation.** "Plans *without* email hosting" embeds close to "plans with email hosting" — the words dominate the logic.
> - **Acronyms and jargon** outside the model's training distribution.
>
> All four are cases where *literal matching* is exactly what you want. Which is the argument for the next section.

## BM25 and sparse retrieval

*Finding things · 11*

> **The classical approach, still excellent**
>
> Score documents by the query terms they contain. **BM25** is the refined form of that idea and has been the search baseline for thirty years — it is not a legacy technique, it's a strong one.

Three ingredients, each fixing a flaw in naive word counting:

| Ingredient | What it corrects |
|---|---|
| **Term frequency, saturating** | A term appearing more times means more — but with diminishing returns. Ten mentions is not ten times as relevant as one. Raw counting gets gamed by repetition; BM25 flattens out. |
| **Inverse document frequency** | Rare terms are informative, common ones aren't. Matching "STARTTLS" tells you far more than matching "the". IDF weights by rarity across the corpus. |
| **Length normalisation** | Long documents contain more words and would otherwise win everything. BM25 discounts by length, tunably. |

> **Where it beats dense outright**
>
> Every case dense retrieval fails: exact codes, identifiers, rare names, precise jargon. If the user typed `SMTP-421` and a document contains `SMTP-421`, BM25 finds it with certainty. No embedding model gives you that guarantee.
>
> It's also cheap, interpretable — you can see exactly which terms matched and how much each contributed — and needs no model.

> **Learnt sparse — the hybrid of the hybrid**
>
> **SPLADE** and similar models produce sparse term weights like BM25, but learnt by a neural model, and they *expand* the query with related terms. So you get literal matching plus some semantic reach in one index.
>
> An elegant middle ground. Fewer moving parts than running two retrievers, at the cost of a model in the indexing path.

## Hybrid search and RRF

*Finding things · 12*

> **Run both. This is the single highest-value upgrade in most RAG systems.**
>
> Dense and sparse fail on *different* queries. Dense misses exact identifiers; sparse misses paraphrase. Running both and merging covers each other's blind spots, and it is far cheaper to implement than most of the sophisticated techniques people try first.

### The merging problem

You have two ranked lists with incomparable scores — a cosine similarity of 0.83 and a BM25 score of 14.2 mean nothing relative to each other, and the scales shift per query. Normalising them is fragile.

> **Reciprocal Rank Fusion — throw the scores away**
>
> Use only the *ranks*.
>
> ```
> RRF(d) = Σ  1 / (k + rank_r(d))          k ≈ 60
>        over each retriever r
> ```
>
> Worked example, with k = 60:
>
> ```
> document  dense rank  sparse rank   RRF score
> ────────────────────────────────────────────────────
>    A          1           7      1/61 + 1/67 = 0.0313
>    B          2           2      1/62 + 1/62 = 0.0323  ← wins
>    C         50           1      1/110 + 1/61 = 0.0255
> ```
>
> **B wins** — not top of either list, but strong in both. Exactly the behaviour you want: agreement across independent methods is powerful evidence.
>
> The `k` constant damps the influence of the very top ranks so one retriever's confident-but-wrong first result can't dominate. 60 is the conventional value and rarely needs tuning.

> **Why RRF rather than weighted score blending**
>
> It's robust and it's parameter-free. Score scales differ per query, per retriever and per corpus, so any weighting you tune will drift. Ranks are always comparable.
>
> Weighted blending can beat RRF *if* you tune it on real labelled data and keep re-tuning it. Most teams don't, so RRF is the better default.

## Reranking

*Finding things · 13*

> **The bi-encoder / cross-encoder distinction**
>
> **Bi-encoder** — what your embedding model is. Query and document are encoded *separately*, then compared by cosine. Documents can be embedded ahead of time, which is what makes search over millions of chunks possible at all.
>
> **Cross-encoder** — query and document go through the model *together*, so attention runs across both, and it outputs a single relevance score.
>
> ```
> bi-encoder:     embed(query) · embed(doc)        pre-computable, fast, coarse
> cross-encoder:  score(query + doc together)      not pre-computable, slow, accurate
> ```
>
> The cross-encoder is substantially more accurate because it can model interaction between the query's words and the document's. It's also far too slow to run over your whole corpus — every pair needs a fresh forward pass.

> **So: retrieve wide and cheap, rerank narrow and expensive**
>
> ```
> hybrid retrieval  →  top 50    (fast, approximate)
> cross-encoder     →  top 5     (slow, accurate — but only 50 pairs)
>                      ↓
>                   the LLM
> ```
>
> Typically 50–100 candidates in, 3–10 out, adding tens to a couple of hundred milliseconds. **Usually a large precision gain for modest effort** — the second-highest-value upgrade after hybrid search.

> **Options**
>
> - **Hosted rerankers** (Cohere and others) — a single API call, strong quality, per-call cost and an extra network hop.
> - **Open cross-encoders** (BGE, Jina and similar) — small enough to self-host on CPU for modest volumes.
> - **ColBERT / late interaction** — stores a vector per *token* and matches token-to-token. Much of a cross-encoder's accuracy while remaining pre-computable, at a large storage cost.
> - **LLM-as-reranker** — ask a model to score relevance. Flexible, and slow and expensive enough that it's rarely the production answer.

> **The other thing reranking gives you: a usable threshold**
>
> Cosine similarities are not calibrated — 0.7 means different things for different queries, so you can't threshold on them reliably. Cross-encoder scores are much better behaved, which lets you say *"if nothing scores above X, we found nothing"* and refuse honestly instead of answering from the best of a bad set.
>
> That refusal path is worth a lot in a production support system.

## Query transformation

*Finding things · 14*

Real questions make poor search queries. These techniques fix the query before it reaches the retriever.

> **Rewriting and expansion**
>
> ```
> "my site is down"
>   ↓
> "website not loading, HTTP 500, apache nginx service down,
>  DNS resolution failure, server unreachable"
> ```
>
> Adds the technical vocabulary the documents actually use. Cheap and effective.

> **Contextualisation — the one that makes follow-ups work**
>
> ```
> turn 1: "how do I set up SMTP?"
> turn 2: "what about the port?"          ← useless as a query
>         ↓ rewritten using history
>         "what port is required for SMTP setup?"
> ```
>
> **If you build a conversational RAG system, you need this.** Without it, every follow-up retrieves garbage, and it's the most common reason a demo works and the product doesn't.

> **Decomposition**
>
> ```
> "how do I set up email and what are the storage limits?"
>    ↓
>    sub-query 1: "email setup"
>    sub-query 2: "storage limits"
>    ↓ retrieve for each, merge
> ```
>
> A single vector for a compound question sits between the two topics and may retrieve neither well.

> **HyDE — hypothetical document embeddings**
>
> Have the LLM write a *fake answer* to the question, then embed that instead of the question.
>
> The reasoning: a question and its answer are written in different registers, so they don't embed as close as you'd hope. A hypothetical answer looks like the documents you're searching, so it lands nearer them in the space.
>
> Works surprisingly well, and even a factually wrong hypothetical answer helps — it only has to be the right *shape*. Costs an extra LLM call and can mislead on topics the model knows nothing about.

> **Step-back prompting**
>
> ```
> "why did my SSL renewal fail with error 4402 on cPanel 118?"
>    ↓ step back
> "how does SSL certificate renewal work in cPanel?"
> ```
>
> Retrieve for both. The specific query finds the exact case if it's documented; the general one finds the background needed to reason when it isn't.

> **Routing and self-querying**
>
> **Routing** — classify the question and send it to the right index or tool. Billing questions to the billing corpus, live status questions to the API, not everything to one vector store.
>
> **Self-querying** — extract structured filters from natural language:
>
> ```
> "what changed in the docs since January about email?"
>    ↓
>    text filter:  "email"
>    metadata:     updated_at > 2026-01-01
> ```
>
> Turns half the question into a database predicate, which is both more accurate and cheaper than hoping the embedding captures "since January".

> **Every transformation adds latency and a failure mode**
>
> Each one is another LLM call before you've retrieved anything, and a bad rewrite retrieves confidently wrong material.
>
> Two mitigations: **search with the original query as well** and merge with RRF, so a bad rewrite can't lose you the right answer; and add transformations one at a time, measuring each. Several of these are individually useful and collectively slower than they're worth.

## Advanced patterns

*Finding things · 15*

> **Named patterns worth recognising**
>
> **Parent-document retrieval** — Search small chunks, return their parents. Covered under chunking; listed again because it's the one to reach for first.
>
> **Graph RAG** — Retrieve over entities and relationships for multi-hop questions. See the Vasco document.
>
> **Agentic RAG** — Give the model search as a *tool* and let it decide what and when to search, iterating until satisfied. Handles questions needing several rounds; unpredictable latency and cost, and it can loop.
>
> **Corrective RAG (CRAG)** — Grade the retrieved chunks; if they're poor, fall back to a web search or a broader query rather than answering from bad context.
>
> **Self-RAG** — The model decides whether retrieval is needed at all, then critiques its own output for groundedness. Avoids retrieving for "hello".
>
> **Contextual compression** — After retrieving, strip each chunk down to the sentences that actually bear on the question before building the prompt. Fits more relevant material in less context.
>
> **Adopt in this order:** hybrid search → reranking → small-to-big → query contextualisation → everything else. The first four deliver most of the available gain; the rest are situational.

## The generation step

*Answering · 16*

You have five good chunks. The remaining work is prompt construction, and it's less obvious than it looks.

```
SYSTEM
You answer questions using only the provided context.
If the context does not contain the answer, say so — do not
use outside knowledge. Cite sources as [1], [2].

CONTEXT
[1] (Email Configuration > SMTP, updated 2026-03-14)
    SMTP port 587 with STARTTLS is required for...

[2] (Troubleshooting > Delivery, updated 2026-02-02)
    If messages are queued but not delivered, check...

QUESTION
Why are my emails not being delivered?
```

> **Five decisions inside that template**
>
> **Order the chunks deliberately** — Because of "lost in the middle", material at the start and end of the context gets attended to most reliably. Put the strongest chunks at the edges, weaker ones in the middle — a free accuracy gain that costs one `sort`.
>
> **Label every chunk with its source** — Numbered, with title and date. Citation is impossible otherwise, and the model uses recency signals when documents conflict.
>
> **Make refusal explicitly available** — "If the context doesn't contain the answer, say so." Without this the model will confabulate from whatever it was given. It is the cheapest hallucination reduction there is.
>
> **Question last** — Immediately before generation, so it sits in the most-attended position.
>
> **Ask for citations, then verify them** — Check the cited chunk IDs exist and, where you quote, that the quoted string actually appears. Models cite plausibly-wrong sources; a two-line check catches it.

> **Conflicting sources**
>
> Two retrieved chunks disagree — an old document and a new one, or two products' documentation. The model will usually pick one silently and sound certain.
>
> Handle it explicitly: include the dates, instruct the model to prefer the most recent and to *say* when sources conflict. Better still, fix it upstream — deduplicate and retire stale documents at index time rather than asking the model to arbitrate.

## Retrieval metrics, worked out

*Knowing if it works · 17*

> **The setup**
>
> A **golden set**: real questions, and for each, human labels for which chunks are genuinely relevant. Fifty to a few hundred questions is enough to be useful. This labelling is the expensive part and there is no substitute for it.

One query. Five chunks retrieved. Relevance of each, in rank order, and three relevant chunks exist in the corpus overall:

```
rank:      1     2     3     4     5
relevant:  ✓     ✗     ✓     ✗     ✗
total relevant in corpus: 3
```

| Metric | Definition | Here |
|---|---|---|
| **Precision@5** | relevant in top k ÷ k | 2/5 = 0.40 |
| **Recall@5** | relevant in top k ÷ all relevant | 2/3 = 0.67 |
| **MRR** | 1 ÷ rank of the first relevant result | 1/1 = 1.00 |
| **NDCG@5** | rank-weighted gain ÷ ideal gain | 0.70 |

> **NDCG, since it's the one people can't explain**
>
> It rewards putting relevant results *higher*, not merely including them. Each hit contributes gain discounted by its position:
>
> ```
> DCG@5  = 1/log₂(1+1) + 0 + 1/log₂(3+1) + 0 + 0
>        = 1/1 + 1/2  =  1.500
>
> ideal ordering would be ✓ ✓ ✓ ✗ ✗:
> IDCG@5 = 1/log₂(2) + 1/log₂(3) + 1/log₂(4)
>        = 1 + 0.631 + 0.5  =  2.131
>
> NDCG@5 = 1.500 / 2.131 = 0.704
> ```
>
> Normalising by the ideal makes it comparable across queries with different numbers of relevant documents — which precision and recall are not.

> **Which metric to optimise, and why it isn't obvious**
>
> **Recall@k at your retrieval stage** is what matters most for the *retriever*. If the right chunk isn't in the top 50, no reranker and no prompt can recover it — that failure is terminal.
>
> **Precision@k after reranking** is what matters for the *generator*. Irrelevant context is actively harmful, not merely wasteful: it distracts the model into confident wrong answers.
>
> So the target is: *high recall going into the reranker, high precision coming out of it.* A team reporting one number without saying which stage it's from hasn't thought about this.

## Evaluating the answer

*Knowing if it works · 18*

> **The three questions worth asking**
>
> **Faithfulness / groundedness** — Is every claim in the answer supported by the retrieved context? This catches hallucination. *The most important one.*
>
> **Answer relevance** — Does it address what was asked? A faithful answer to a different question is still a failure.
>
> **Context relevance** — Was the retrieved context actually about the question? Diagnoses whether a bad answer is retrieval's fault or generation's.
>
> Together these *localise* failures. Bad answer + good context = generation problem. Bad answer + bad context = retrieval problem. Without the split you're guessing.

> **LLM-as-judge, and its real limitations**
>
> The practical way to score these at scale: give a model the question, context and answer, and ask it to grade.
>
> It works reasonably. But know the failure modes, because interviewers ask:
> - **Position bias** — when comparing two answers, judges favour the first. Randomise order, or run both orders.
> - **Length bias** — longer answers score higher regardless of quality.
> - **Self-preference** — models rate their own family's output more favourably. Use a different model as judge where you can.
> - **It's not ground truth** — validate the judge against human labels on a sample before trusting it, then re-check periodically.
>
> Use it for *relative* comparisons between system versions, where biases largely cancel. Be sceptical of absolute scores.

> **Frameworks**
>
> **RAGAS** is the best-known open toolkit for these metrics. **TruLens**, **DeepEval**, **Phoenix** and **LangSmith** all offer evaluation harnesses.
>
> They're a convenience, not a strategy — the golden set is the asset, and it's yours regardless of framework. Build that first; the tooling around it is swappable.

## Failure catalogue

*Knowing if it works · 19*

Symptom to cause, in roughly the order to check them.

| Symptom | Likely cause | Fix |
|---|---|---|
| Answer invents facts | Nothing relevant retrieved; model filled the gap | Make refusal explicit; add a reranker score threshold |
| Right document, wrong section | Chunks too large — the vector is blurred | Smaller chunks, or small-to-big |
| Answer is incomplete | Chunks too small — context was cut off | Small-to-big, or sentence-window |
| Exact code or ID not found | Dense-only retrieval | Add BM25, merge with RRF |
| Follow-up questions retrieve nonsense | No query contextualisation | Rewrite the query using conversation history |
| Good chunks retrieved, ignored in the answer | Buried mid-context | Reorder — strongest chunks at the edges |
| Works in dev, fails in prod | Real questions are messier than test ones | Build the golden set from real logs, not imagination |
| Quality drifts down over weeks | Index stale, or documents changed | Re-index on change; monitor index age |
| Answers cite the wrong source | Model fabricated the citation | Verify cited IDs and quoted strings in code |
| Some tenants get poor results | Post-filtering collapsed their recall | Pre-filter inside the index query |
| Tables answered wrongly | Parser destroyed the table | Row-wise serialisation with repeated headers |
| Non-English much worse | Monolingual embedding model | Multilingual model; re-measure per language |

## One query, end to end

*Reference · 20*

```
USER (turn 3):  "and why is it still queuing?"

1 · CONTEXTUALISE using history
    → "why are outbound SMTP messages still queuing after
       configuring port 587 with STARTTLS?"

2 · RETRIEVE, both ways, filtered to this tenant
    dense  → [c_1042, c_0087, c_2210, ... 50 total]
    bm25   → [c_0087, c_3311, c_1042, ... 50 total]
              ("queuing", "STARTTLS" are strong literal terms)

3 · MERGE with RRF
    → c_0087 (both lists high), c_1042, c_3311, ... 60 unique

4 · RERANK with a cross-encoder
    c_0087  0.94   "Messages queue when the relay rejects auth..."
    c_1042  0.88   "STARTTLS on 587 requires SMTP authentication..."
    c_3311  0.31   ← below threshold, dropped
    → keep 2

5 · EXPAND small→big
    → return the parent sections of c_0087 and c_1042

6 · ASSEMBLE
    strongest at the edges, sources labelled with dates,
    refusal instruction in the system prompt

7 · GENERATE
    "Messages queue when the relay rejects authentication [1].
     Port 587 with STARTTLS requires SMTP AUTH to be enabled —
     check that the account has it turned on [2]."

8 · VERIFY
    [1] and [2] resolve to real retrieved chunks  ✓
    log: query, rewrite, both rank lists, rerank scores, final prompt
```

Every stage in that trace is independently measurable and independently replaceable. That's the point of building it as a pipeline rather than a single call.

## How to test, and where to breakpoint

*Reference · 21*

> **1 · Read your chunks**
>
> Print twenty at random and read them. Highest value per minute of anything in this document.

> **2 · Golden set, from real logs**
>
> 50–200 real questions with labelled relevant chunks. Run on every change to chunking, embedding, retrieval or reranking. This is your regression suite; without it every change is a guess.

> **3 · Retrieval-only tests, no LLM**
>
> Assert that a known question retrieves a known chunk ID in its top k. Fast, deterministic, cheap — run them in CI. Most RAG regressions are retrieval regressions and this catches them before an LLM is involved.

> **4 · Ablations**
>
> Turn one thing off and re-measure: no reranker, dense-only, no query rewriting. This is the only way to know what each component is actually contributing. Frequently something is contributing nothing and can be deleted.

> **5 · Adversarial questions**
>
> - Answerable from the corpus → must be answered correctly.
> - Not in the corpus → must be *refused*, not answered. Test this deliberately.
> - Another tenant's data → must return nothing.
> - Injection in the question → must not change behaviour.

> **Where to breakpoint**
>
> **The chunks, right after chunking** — Before embedding. Most quality problems are visible here and invisible later.
>
> **Both rank lists, before merging** — Tells you immediately whether dense or sparse found it — and therefore which one to fix.
>
> **Reranker scores** — All low means retrieval failed. High scores on wrong chunks means your labels or your reranker disagree with you.
>
> **The assembled prompt, verbatim** — The single most valuable breakpoint. What you think you sent is regularly not what you sent — truncation, ordering and template bugs all surface here.
>
> **Retrieved chunk IDs, logged with every answer** — In production. When a user reports a bad answer, you can reconstruct exactly what the model was given. Without this, production debugging is impossible.

## Interview answers

*Reference · 22*

**Q: Walk me through a RAG pipeline.**

"Two halves. Offline: parse documents into clean text, chunk them, attach metadata, embed each chunk, store the vectors with the text.

Online: take the question — rewriting it first if it's a follow-up, using conversation history. Retrieve two ways, dense for meaning and BM25 for exact terms, filtered by tenant and permissions inside the query rather than after. Merge the two ranked lists with reciprocal rank fusion. Rerank the top fifty with a cross-encoder down to about five. Assemble a prompt with the strongest chunks at the beginning and end because of lost-in-the-middle, source labels for citation, and an explicit instruction to refuse if the answer isn't there. Generate, then verify the citations resolve.

The part I'd emphasise is that almost every RAG failure is a retrieval failure, and most retrieval failures were caused in parsing or chunking — much earlier than where you notice them."

**Q: How do you choose a chunking strategy?**

"Start with recursive character splitting around 512 tokens with 10% overlap — it respects paragraph and sentence boundaries where they exist and still bounds the size where they don't.

Then improve based on measurement. If the documents have real structure — headings, sections — split on that and prepend the heading path so each chunk carries its context. If answers come back incomplete, move to small-to-big: index small chunks for precise matching but return their parent section for context. That's usually the biggest single win, because the best chunk to *search* isn't the best chunk to *read*.

The principle I use: a chunk should hold one idea plus enough context to make sense alone. I test it by reading a chunk cold — if I can't tell what it's about, the embedding model can't either."

**Q: Why hybrid search? Isn't semantic search strictly better?**

"No — they fail on different queries, which is exactly why you want both.

Dense retrieval handles paraphrase: 'my emails aren't arriving' finds 'SMTP delivery failure' with no shared words. But it's unreliable on exact strings — error codes, ticket numbers, rare product names — because rare tokens are poorly represented in embedding space. It also struggles with negation.

BM25 nails all of those. If the user typed SMTP-421 and a document contains SMTP-421, BM25 finds it with certainty.

I merge with reciprocal rank fusion rather than blending scores, because cosine and BM25 scores aren't on comparable scales and the scales shift per query. RRF uses only ranks, so it's parameter-free and robust. A document ranked second by both beats one ranked first by only one — agreement across independent methods is strong evidence."

**Q: What's a cross-encoder and why not use it for everything?**

"A bi-encoder — your embedding model — encodes query and document separately and compares the vectors. That separation is what makes search possible: documents are embedded once, offline.

A cross-encoder puts query and document through the model together, so attention runs across both. Much more accurate because it models the interaction, but nothing can be precomputed — every query-document pair needs its own forward pass. Over a million chunks that's impossible.

So the standard shape is retrieve wide and cheap, rerank narrow and expensive: fifty candidates from hybrid search, cross-encoder down to five. Tens to a couple of hundred milliseconds for a large precision gain.

There's a second benefit people miss — cross-encoder scores are much better calibrated than cosine similarities, so you can actually threshold on them and say 'we found nothing' honestly instead of answering from the best of a bad set."

**Q: How do you evaluate a RAG system?**

"Separately at each stage, otherwise you can't tell what's broken.

Retrieval: a golden set of real questions with human-labelled relevant chunks. Recall@k at the retrieval stage — if the right chunk isn't in the top fifty, nothing downstream can recover it. Precision@k after reranking, because irrelevant context actively harms the answer rather than just wasting tokens. NDCG when rank order matters.

Generation: faithfulness — is every claim supported by the context — plus answer relevance and context relevance. Splitting those localises failures: bad answer with good context is a generation problem, bad answer with bad context is retrieval.

I'd use LLM-as-judge to scale it, but validated against human labels on a sample first, and I'd trust it for comparing versions rather than for absolute scores — it has position bias, length bias and self-preference."

**Q: Where would you store the vectors?**

"pgvector, unless there's a specific reason not to.

One database instead of two — no extra system to run, back up, monitor and secure. It's transactional, so the document row and its vectors commit together; with a separate store a crash between the two leaves you permanently inconsistent. And you get real SQL filtering for tenancy, permissions and recency, which standalone vector stores implement partially.

It has a ceiling — tens of millions of vectors with heavy concurrency, and a dedicated store like Qdrant will outperform it. Most systems never get there, and 'we'd migrate at that point' is a reasonable plan rather than a gap.

Whichever store, I'd use HNSW and push tenant filters into the query rather than filtering after — post-filtering silently collapses recall for small tenants, and it's a leak waiting for one bug."

**Q: Your context window is 200k now. Why still chunk?**

"Three reasons, and none of them is going away.

Cost and latency scale with what you send — a 200k prompt on every query is enormously more expensive and slower than a well-retrieved 2k one. Accuracy actually degrades with irrelevant context; lost-in-the-middle shows material buried mid-context is attended to less reliably, so more context can mean worse answers. And most corpora are far bigger than any window, so you still have to choose — which is retrieval whatever you call it.

What long context genuinely changes is that you can be more generous: bigger chunks, more of them, less pressure on precision. It makes RAG easier, not unnecessary."

**Q: Retrieval is returning nothing useful. How do you debug it?**

Answer as a procedure, top down — this is really a debugging question.

"First I'd read the chunks. Not the metrics — the actual parsed text. Most of the time the parser mangled something and it's obvious on sight.

Then I'd check whether the right chunk is in the index at all, by fetching it by ID. If it isn't, it's an ingestion problem, not a retrieval one.

If it is, I'd look at the dense and sparse rank lists separately — which one found it, and where. That tells me whether it's a semantic-match problem or a term-match problem, and they have different fixes.

Then the reranker scores, then the assembled prompt verbatim — I've lost count of the times the chunk was retrieved fine and got truncated out of the prompt.

And I'd check the embedding prefixes. If the model expects query/passage prefixes and you're not sending them, retrieval quietly degrades and nothing errors."

## Glossary

*Reference · 23*

**RAG** — Retrieval-augmented generation. Search first, then answer from what you found.

**Chunk** — The unit of retrieval — a piece of a document, indexed and returned.

**Overlap** — Shared text between adjacent chunks so boundary-spanning sentences survive.

**Recursive splitting** — Split on the largest natural boundary that fits, falling back to smaller ones.

**Semantic chunking** — Cut where consecutive-sentence similarity drops.

**Small-to-big** — Index small chunks, return their larger parents.

**Contextual retrieval** — Prepend LLM-written context to each chunk before embedding.

**Embedding** — Text as a vector; similar meanings land close together.

**Bi-encoder** — Encodes query and document separately. Precomputable, fast.

**Cross-encoder** — Encodes them together. Accurate, not precomputable.

**Cosine similarity** — Angle between vectors, ignoring length.

**MTEB** — The standard embedding benchmark. A shortlist, not an answer.

**Matryoshka** — Embeddings that can be truncated with little quality loss.

**ANN** — Approximate nearest neighbour — trade exactness for speed.

**HNSW** — Layered proximity graph. The default ANN index.

**ef_search** — HNSW's runtime recall/latency dial.

**IVF** — Cluster vectors, search only the nearest clusters.

**Product quantisation** — Compress vectors via learnt codebooks.

**pgvector** — Postgres extension for vector columns and ANN indexes.

**BM25** — Keyword ranking with saturating term frequency, IDF and length normalisation.

**Sparse retrieval** — Term-based matching. Exact, interpretable.

**Hybrid search** — Dense plus sparse, merged.

**RRF** — Reciprocal rank fusion — merge ranked lists using ranks, not scores.

**Reranking** — Re-score retrieved candidates with a stronger, slower model.

**ColBERT** — Late interaction — per-token vectors, token-level matching.

**HyDE** — Embed a hypothetical answer instead of the question.

**Step-back** — Also retrieve for a more general version of the question.

**Self-query** — Extract metadata filters from natural language.

**Agentic RAG** — Search as a tool the model calls iteratively.

**Precision@k / Recall@k** — Was what I got good / did I find everything.

**MRR** — Reciprocal rank of the first relevant result.

**NDCG** — Rank-weighted gain, normalised by the ideal ordering.

**Faithfulness** — Every claim supported by the retrieved context.

**Golden set** — Labelled questions and relevant chunks. Your regression suite.

**Lost in the middle** — Mid-context material is attended to less reliably.

---

Companion documents: inside a language model · the LangChain stack · Vasco stack (graph RAG) · voice runtime · pipecat upgrade · telephony · CI/CD and containers · distributed systems.
Build naive, measure, then add complexity where the measurement asks for it.
