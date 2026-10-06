# Part VII: The AI Realm

**Topic:** System design
**Covers:** ML System Fundamentals; Training, Serving and Monitoring ML Models (MLOps); Recommendation Systems; LLMs for System Designers; Inside an LLM; Fine-Tuning LLMs; Training an LLM from Scratch; Build Your Own Mini GPT; Predicting LLM Behavior; Why LLMs Hallucinate; Embeddings and Vector Databases; Retrieval-Augmented Generation (RAG); Knowledge Graphs; Serving LLMs at Scale; Tool Use: How an LLM Bot Triggers APIs; MCP, the Model Context Protocol; The Agent Harness; AI Agents; Evaluation, Guardrails and Cost
**Source:** [Claude artifact](https://claude.ai/artifact/7xxGdVxPGbUiPY13z4MdZ2) — written by a colleague, mirrored here for study.

## Chapter 34: ML System Fundamentals

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Some decisions (fraud, ETAs, ranking) follow patterns too complex for hand-written rules. |
| Why it is hard | Models are only as good as their data and labels, offline accuracy can mislead, and data leaks from the future inflate scores. |
| How we solve it | Frame the right target, build labels and features carefully, use a feature store with point-in-time joins, start with a baseline, and judge with the right metrics and online A/B tests. |
| What fails, and why | 99.9% accurate but useless models (class imbalance with the wrong metric), great offline but bad online (data leakage), unfair outcomes (biased historical labels), and wasted effort (no baseline to beat). |

Traditional software has humans write the rules; machine learning learns the rules from examples. In ML systems the model code is a small box surrounded by large infrastructure (data collection, features, serving, monitoring), as Google's paper "Hidden Technical Debt in ML Systems" showed, so ML system design is mostly data engineering plus infrastructure.

### 34.1 Vocabulary

A model is a learned function with millions or billions of parameters. Training learns parameters from data; slow, expensive and occasional. Inference uses the model to predict on new data; fast and constant. Features are input signals (for fraud: amount, account age, time of day, distance from usual location, orders today). A label is the correct answer in training data. Teaching a child to recognize dogs works by showing examples, not by writing a rulebook.

| Problem type | Output | Example |
| --- | --- | --- |
| Classification | A category | Fraud or not, spam or not |
| Regression | A number | Delivery ETA, house price |
| Ranking | An ordered list | Which 10 restaurants to show first |
| Recommendation | Personalized items | "You might like" |
| Clustering | Groups without labels | Customer segments |
| Generation | New content | LLM text, images |

### 34.2 Should you use ML at all?

Use it when patterns are too complex for rules, data is plentiful, the problem keeps changing (fraud tactics evolve), and some mistakes are acceptable. Avoid it when simple rules work, data is scarce, mistakes are unacceptable or must be explainable, or determinism is required. Always build a simple baseline (e.g. "most popular restaurants") that ML must beat.

### 34.3 The lifecycle

Problem framing → data collection → preparation and features → training → evaluation → model registry → deployment and serving → monitoring and retraining, in a loop, because models decay.

Framing turns "increase orders" into "predict the probability a user orders from each restaurant, then rank." Define inputs and outputs, a business metric, an ML metric and constraints (latency, cost, fairness, privacy). Beware the proxy trap: optimizing clicks produces clickbait; YouTube shifted toward watch time and satisfaction.

Data: logs, databases, Kafka events, third parties and human labeling. Natural labels come free (did the user click, order, dispute the charge; actual delivery time). Human labels are slow and costly. Feedback delay means fraud labels may take weeks. Watch class imbalance (0.1% fraud means a model always saying "not fraud" is 99.9% accurate and useless), bias inherited from history, and privacy.

Features: user features (orders in 30 days, cuisine, order value), restaurant features (rating, prep time, price, distance), context (time, weekday, weather, an IPL match) and cross features (has this user ordered here?). Batch features are computed periodically with tools such as Spark; real-time features (orders in the last 10 minutes, a fraud signal) come from stream processors such as Flink or Kafka Streams.

### 34.4 The feature store

When data scientists compute features in Python for training and engineers rewrite them in Java for serving, small differences cause training-serving skew and worse production performance. A feature store defines features once: an offline store (warehouse or lake with full history) for training and an online store (Redis or DynamoDB with latest values) for millisecond serving lookups. It provides point-in-time-correct joins, so a March 5 training example uses feature values as of March 5; using later values is data leakage, making models look great in tests and fail in reality. Tools: Feast, Tecton, Databricks, Vertex AI and SageMaker feature stores.

### 34.5 Training and evaluation

Split data into training, validation and an untouched test set; for time-dependent data, split by time (train January to September, test October). Start simple: logistic regression or gradient-boosted trees (XGBoost, LightGBM) for tabular data; deep learning for huge or unstructured data. Overfitting (memorizing) shows as high training and poor validation accuracy.

Offline metrics: precision (of flagged items, how many were truly fraud) and recall (of all fraud, how much was caught), traded off by threshold according to business cost; high recall matters most for cancer screening. Regression uses MAE ("ETA off by 4 minutes on average"); ranking uses NDCG and precision@K. With heavy imbalance, use precision, recall, F1 or PR-AUC instead of accuracy. Online evaluation through A/B tests on business metrics is the final judge, because offline winners can lose online.

A model registry versions models with their data, code, metrics and approver, enabling reproducibility and instant rollback.

### 34.6 The ML platform

```
App events → Kafka → stream processor → online feature store ─┐
           → data lake → batch jobs (Spark) ──────────────────┤
           → training pipeline (GPUs) → model registry → deploy → model serving API
           ← monitoring (drift, accuracy) ← prediction logs ←─────────────┘
```

Much of this is classic system design: Kafka, Redis, object storage, batch processing, APIs and monitoring.

### 34.7 Practitioner's guide

Worked example: framing "reduce late deliveries" as ML.

```
Business goal: fewer late deliveries
ML task:       regression → predict prep time per order (minutes)
Label:         actual "food ready" timestamp − accept time (natural label, arrives in ~30 min)
Features:      restaurant queue now, dish types, time, weather, historical prep p50/p90
Baseline:      restaurant's average prep time
Success:       MAE ↓ 20% vs baseline offline; late deliveries ↓ in A/B
```

| Aspect | Details |
| --- | --- |
| Benefits | Learns complex patterns, adapts with data, personalizes |
| Constraints | Data quality and volume, labels, latency budgets, explainability, privacy |
| Trade-offs | Accuracy vs interpretability; complex models vs simple baselines |
| Use ML when | Rules fail, data is rich, mistakes tolerable, patterns shift |
| Avoid when | Deterministic rules suffice, data scarce, every error is unacceptable |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| No baseline | Cannot prove ML helps | Always compare to a simple heuristic |
| Labels arrive weeks late | Slow iteration | Proxy labels + drift signals meanwhile |
| Biased historical labels | Unfair outcomes | Audit data, fairness metrics, reweighting |

### Review questions

1. A fraud model is 99.9% accurate with 0.1% fraud. Why might it be useless, and what metrics should you use?

#### Answers

1. A model that always predicts "not fraud" is also 99.9% accurate while catching zero fraud, so accuracy is meaningless with heavy class imbalance. Use precision (of flagged transactions, how many are fraud), recall (of all fraud, how much is caught), F1 or PR-AUC, and set the threshold by business cost.

## Chapter 35: Training, Serving and Monitoring ML Models (MLOps)

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Train models at scale, serve predictions fast, and keep them accurate as the world changes. |
| Why it is hard | GPUs are scarce, latency budgets are tight, serving code differs from training code, and data and behavior drift silently. |
| How we solve it | Distributed training with checkpoints, the right inference mode (batch, real-time, on-device, hybrid), latency optimizations, staged rollouts (shadow, canary, A/B), drift monitoring and retraining. |
| What fails, and why | Worse online than offline (training-serving skew), silently degrading predictions (drift without monitoring), checkout blocked (model timeouts without fallback), and narrowing recommendations (feedback loops without exploration). |

A model in a notebook earns nothing; value comes from reliable predictions for real users that stay accurate over time. ML models also fail silently, returning valid-looking wrong answers, so they need monitoring beyond normal software.

### 35.1 Training infrastructure

GPUs have thousands of simple cores doing the same math in parallel, ideal for the matrix multiplications behind training: a stadium of 10,000 students each doing one addition versus a few professors. TPUs and other accelerators exist too. GPUs are expensive, so utilization and cost are first-class concerns.

Data parallelism copies the model to many GPUs, each training on different data, then averages updates. Model parallelism splits a model too big for one GPU: pipeline parallelism gives each GPU a group of layers like an assembly line; tensor parallelism splits each layer's math. Large LLM training combines them across thousands of GPUs, where inter-GPU communication often becomes the bottleneck.

Checkpoint long training runs regularly to storage so failures resume rather than restart. Orchestrate the workflow (fetch, validate, features, train, evaluate, register) with Airflow, Kubeflow, Vertex AI or SageMaker Pipelines; track experiments (MLflow, Weights & Biases); tune hyperparameters automatically; and validate data before training, because bad data silently creates bad models.

### 35.2 Inference modes

Batch inference runs on a schedule and stores results ("top 20 restaurants for all 50M users at 2 AM"). It is cheap with instant lookups, but stale and wasteful for inactive users; good for daily recommendations, campaigns and churn scores.

Real-time inference computes on demand via an API ("score this checkout for fraud in under 50 ms"). Fresh and contextual, but latency-critical and costlier; used for fraud, search ranking, ETAs, ad bidding and chat.

On-device inference runs on the phone: offline, near-zero latency and private, but limited by memory and battery; used for face unlock, keyboard suggestions, photo filters and wake words.

Hybrids are common: batch-precomputed candidates re-ranked in real time with fresh context ("it is raining and she just searched for soup").

### 35.3 Serving architecture

```
App → gateway → prediction service
   1. fetch features from the online feature store (~5 ms)
   2. call the model server on CPU or GPU (~20 ms)
   3. apply business rules or fallbacks (~2 ms)
   → response; log prediction and features for monitoring and retraining
```

Model servers include NVIDIA Triton, TorchServe, TensorFlow Serving, BentoML, KServe and Ray Serve. Within a latency budget (e.g. 50 ms for fraud inside a 200 ms checkout), speed comes from dynamic batching (waiting milliseconds to group requests for GPU efficiency), quantization (32-bit to 8- or 4-bit numbers, about 4x smaller with small accuracy loss), distillation (a small student imitating a large teacher), pruning, prediction caching for repeated inputs, and right-sized hardware (gradient-boosted trees often run fine on CPUs).

Fallbacks: if the fraud model times out, apply rules ("block over ₹50K from a new device"); if recommendations fail, show popular items. The model must never be a single point of failure for the core business.

### 35.4 Deploying models safely

Shadow mode logs a new model's predictions on real traffic without using them; canaries send 1-5%; A/B tests compare business metrics with statistical rigor; multi-armed bandits shift traffic toward the winner during the test; champion and challenger models compete continuously; the registry enables instant rollback.

### 35.5 Monitoring and drift

Training-serving skew arises when production features differ from training (different code paths, a live pipeline bug sending nulls). Fix with a feature store and by logging serving-time features for future training.

Data drift (covariate shift): inputs change, as with new cities, app version changes or COVID lockdowns. Concept drift: the relationship changes, as when fraudsters adapt or trends shift. Prediction drift: outputs shift (5% flagged instead of 0.5%), often the first visible symptom.

Monitor system metrics, data quality, feature distributions against training (PSI, KL divergence), prediction distributions, true performance once labels arrive (using drift as early warning during feedback delay), business metrics and fairness across groups.

Retrain on a schedule, when drift triggers it, or continuously (most adaptive, riskiest). Mature MLOps automates data, training, evaluation against the champion and deployment.

Feedback loops: a recommender showing only popular restaurants makes them more popular and starves new ones. Counter with exploration (occasionally show newer items, as bandits do) and log what was shown versus chosen.

Example: an ETA model fine for a year goes badly wrong in monsoon season with no errors. That is drift: data drift (rain, flooded roads) and concept drift (the same 4 km takes twice as long). Monitoring weather and traffic feature ranges and, above all, predicted versus actual delivery time (labels arrive within an hour) would have caught it; retrain with weather features and past monsoons, with a fallback adjustment for extreme conditions.

### 35.6 ML design interview checklist

Frame the problem with business and ML metrics; data, labels, imbalance, privacy and feedback delay; batch versus real-time features, a feature store, no leakage; a simple baseline first; offline metrics plus online A/B; serving mode, latency budget, optimizations and fallbacks; shadow, canary and A/B deployment with rollback; drift, skew, performance and business monitoring with a retraining loop.

### 35.7 Practitioner's guide

Worked example: shipping a new fraud model.

```
Train v15 → offline: recall 0.82 (v14: 0.78) at same precision ✓
Shadow 7 days: v15 scores logged, v14 decides → compare flags on real traffic ✓
Canary 5% → chargeback rate and false-decline complaints watched ✓
A/B 50/50 for 2 weeks → promote v15; v14 kept for instant rollback
```

| Aspect | Batch | Real-time | On-device |
| --- | --- | --- | --- |
| Benefits | Cheap, simple | Fresh context | Private, offline, instant |
| Constraints | Stale | Latency, cost, availability | Small models, update cadence |
| Use when | Daily recs, scores | Fraud, ETA, ranking | Keyboard, camera, wake words |
| Avoid when | Context changes per minute | Results can wait hours | Large models or central data needed |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Feature null in production | Predictions collapse to default | Data validation at serving, alerts |
| Model server GPU OOM | Timeouts | Smaller batch, quantize, right-size hardware |
| Retrain on corrupted data | New model worse | Data validation gate + champion comparison |
| Feedback loop narrows recommendations | Diversity drops | Exploration and logging impressions |

### Review questions

1. An ETA model fails during the monsoon without errors. Name the problem and how the system should have caught it.

#### Answers

1. Drift: data drift (rain, flooded roads, unusual traffic) and concept drift (the same 4 km takes twice as long). Monitoring feature distributions and especially predicted versus actual delivery time (labels arrive within an hour) would have triggered an alert on rising error; retrain with weather features and past monsoon data, with a fallback adjustment for extreme conditions.

## Chapter 36: Recommendation Systems

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Show each user the few items, out of hundreds of thousands, they are most likely to want, within about 100 ms. |
| Why it is hard | Catalogs are huge, new users and items have no history, feedback is mostly implicit, and recommendations change what users see and learn from. |
| How we solve it | A multi-stage funnel: fast retrieval (two-tower embeddings, ANN), filtering, heavy ranking, re-ranking for diversity and fairness, with exploration and careful logging. |
| What fails, and why | Same 50 restaurants everywhere (popularity feedback loops), closed restaurants shown (no real-time filter), new items never surfaced (cold start without exploration), and clickbait winning (proxy metrics). |

Recommendations drive much of the internet's engagement. The core problem: with 200,000 restaurants and 20 slots on a screen, which 20? The answer at scale is a multi-stage funnel that uses cheap methods on everything and expensive models on a shortlist.

### 36.1 Approaches

Popularity baseline: most popular in the user's city now. Simple, works for new users, surprisingly strong, and the fallback.

Content-based filtering: items similar in attributes to what the user liked (spicy Andhra biryani places after three biryani orders). Works for new items and is explainable, but repetitive.

Collaborative filtering: "people like you liked this," needing no attributes. User-user finds similar users; item-item (Amazon's "customers who bought this also bought") is more stable and precomputable. It discovers surprising links but suffers cold start for new items and users.

Matrix factorization learns a short vector, an embedding, per user and item from the sparse user × item interaction table so that similar tastes have similar vectors; prediction is vector closeness. Embedding dimensions act like hidden taste axes (spicy, budget, South Indian), though real ones are rarely so clean. Embeddings underpin vector databases and RAG (Chapters 44-45).

Two-tower models: one neural network turns user features into a user embedding, another turns item features into an item embedding, and a dot product scores the match. They use any features (helping cold start), and item embeddings can be precomputed so a request computes only the user embedding and runs fast nearest-neighbor search. Hybrids combine all of these.

### 36.2 The multi-stage funnel

```
200,000 restaurants
  → 1. Candidate generation (fast, high recall)        ~10-20 ms  → ~1,000
  → 2. Filtering (closed, out of range, diet, hidden)  ~2 ms      → ~800
  → 3. Ranking (heavy model, rich features)            ~30-50 ms  → ~100 scored
  → 4. Re-ranking (diversity, freshness, rules)        ~5 ms      → 20 shown
```

Candidate sources run in parallel: two-tower plus ANN vector search, item-item similarity, order-again history, trending nearby, geospatial nearby restaurants, and new restaurants for exploration; results are merged and deduplicated. Ranking uses user, restaurant, user-restaurant cross and context features (time, weather, delivery estimate, device) plus real-time features from the feature store. It predicts multiple objectives and combines them, e.g. score = w1 · P(order) + w2 · P(good rating) + w3 · value − w4 · delay risk, avoiding the clickbait proxy trap. Re-ranking optimizes the list as a whole: cuisine diversity, freshness boosts, clearly marked sponsored placements, fairness for small restaurants, and deduplicating chains.

The funnel exists because running an accurate model on 200,000 items for millions of users within \~100 ms would be far too slow and expensive; cheap retrieval optimizes recall and the heavy model optimizes precision on about 1,000 items. YouTube, Instagram, TikTok, Amazon and LinkedIn use this shape.

### 36.3 Cold start

New users: onboarding questions, context (location, time, device, the ad they clicked), popular-nearby, then fast learning from first clicks. New restaurants: content features through the item tower, an exploration boost and "new on the app" sections.

### 36.4 Feedback and evaluation

Explicit feedback (ratings, likes, "not interested") is high quality but rare; implicit feedback (clicks, orders, dwell time, re-orders, scroll-pasts) is abundant but noisy. Log impressions, including what was shown and ignored, or the model cannot learn negatives. Position bias makes top slots get clicks for being on top; include position as a training feature or occasionally shuffle.

Offline: Recall@K for retrieval; NDCG and MAP for ranking; AUC or log loss for click prediction. Online A/B: CTR, conversion, order value, repeat orders, retention, diversity and coverage, plus guardrail metrics (cancellations, complaints, delivery time) that must not worsen.

### 36.5 Dangers

Filter bubbles (add diversity and exploration); rich-get-richer feedback loops (exploration, fairness rules, debiasing); engagement versus wellbeing (include satisfaction signals and surveys); staleness (hybrid batch and real-time ranking); and manipulation through fake orders or reviews (fraud detection on signals).

### 36.6 Architecture

```
OFFLINE: order + impression logs (Kafka → lake) → train two-tower + ranker on GPUs
         → item embeddings into a vector DB; item-item and popular-per-area lists into Redis
         → batch features into the feature store
ONLINE (<~150 ms): gateway → recommendation service
   user features → user embedding → parallel retrieval (ANN | item-item | popular | nearby | new)
   → filter → rank → re-rank → top 20 → log impressions to Kafka
   fallback: "popular near you" from cache
```

### 36.7 Practitioner's guide

Worked example: "order again" plus discovery on the home screen.

```
Row 1 "Order again":   user's last 30-day restaurants, ranked by recency × frequency (rules)
Row 2 "For you":       two-tower ANN 500 → filter open/deliverable → ranker → top 20
Row 3 "New near you":  restaurants < 30 days old, quality-gated (exploration)
Diversity rule:        max 3 of the same cuisine in a row
```

| Approach | Benefits | Constraints | Use when | Avoid when |
| --- | --- | --- | --- | --- |
| Popularity | Robust, simple | Not personal | New users, fallback | Mature personalization goals |
| Content-based | Cold-start items | Repetitive | Rich item metadata | Sparse attributes |
| Collaborative | Serendipity | Cold start | Lots of interactions | New platforms |
| Two-tower + ANN | Scales, any features | Training infra | Large catalogs | Tiny catalogs (just rank all) |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Recommending closed restaurants | Bad clicks | Real-time filter stage |
| Popularity bias | Same 50 places everywhere | Exploration, diversity re-ranking |
| Position bias in training | Top slots self-reinforce | Position feature, randomization |
| Embedding index stale | New items missing | Incremental index updates |

### Review questions

1. Why use a funnel instead of the most accurate model on all 200,000 restaurants?

#### Answers

1. Latency and cost: scoring 200,000 restaurants with a heavy model for millions of users within \~100 ms is far too slow and expensive. Cheap retrieval narrows to \~1,000 candidates optimizing recall, then the expensive ranker spends compute only on those, optimizing precision.

## Chapter 37: LLMs for System Designers

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Build products on LLMs that are fast, affordable, correct enough and safe. |
| Why it is hard | Models generate one token at a time, are stateless, cost per token, hallucinate, and behave non-deterministically. |
| How we solve it | Stream responses, manage context and history, cache prompt prefixes, use structured outputs with validation, ground with RAG and tools, and climb the customization ladder only as needed. |
| What fails, and why | 8-second blank screens (no streaming), slower and pricier chats (full history resent), broken integrations (unvalidated JSON), and invented facts (no grounding). |

An LLM predicts the next token, appends it, and repeats. That single fact explains its latency, cost and memory behavior, and drives every LLM system design decision.

### 37.1 Next-token prediction

Given "The capital of Karnataka is," the model assigns high probability to "Bengaluru," then predicts "." and then an end token. This autoregressive generation is sequential, so long answers take longer. It is a super-powered autocomplete trained on vast text.

### 37.2 Tokens

Models read tokens, chunks of text: "Unbelievable biryani!" might be `[Un][believ][able][ bir][yani][!]`. In English, 1 token ≈ 4 characters ≈ ¾ word; 100 tokens ≈ 75 words; a page ≈ 500-700 tokens. Hindi, Kannada and Tamil often need more tokens for the same meaning, raising cost and latency for Indian-language products. Tokens matter for pricing (APIs charge separately for input and output tokens, with output typically several times pricier), latency and limits.

### 37.3 The context window and statelessness

The context window is the maximum tokens the model sees at once, input plus output: system prompt, retrieved documents, conversation history, the new message and room for the answer.

LLMs are stateless; each call starts from zero. Chat apps resend the whole history every turn, so long conversations cost more per message, slow down and eventually overflow. Solutions: a sliding window of recent messages, periodic summarization, and external memory retrieved when relevant. Bigger contexts are not free: attention cost grows with length (quadratically in the classic version), and models use information at the start and end better than the middle ("lost in the middle"). Put only relevant information in context.

### 37.4 Transformers and model size

Almost all LLMs are Transformers ("Attention Is All You Need," 2017), where each token attends to others to gather context (Chapter 38). Small models of a few billion parameters are fast, cheap and run on one GPU, laptop or phone; large ones reason better but need many GPUs. At 16-bit precision each parameter is 2 bytes, so a 70B model is \~140 GB of weights, more than one typical GPU, which is why quantization and multi-GPU serving matter.

### 37.5 Training stages

Pretraining on massive text produces a base model that continues text. Instruction tuning (SFT) on instruction-answer pairs creates an assistant. Preference tuning (RLHF and similar) makes it more helpful, honest and safe. Companies typically customize with prompting, RAG, or efficient fine-tuning such as LoRA (Chapter 39).

### 37.6 Inference phases

Prefill processes the whole prompt in parallel (compute-bound) and yields the first token. Decode generates the rest one token at a time, rereading the weights each step (memory-bandwidth-bound). The KV cache stores attention keys and values for previous tokens so each step computes only the new token; it is fast but consumes GPU memory that grows with context and concurrent users, often limiting users per GPU (Chapter 47).

Key latency metrics: TTFT (time to first token, dominated by prefill, what users feel most), time per output token, total latency ≈ TTFT + output tokens × TPOT, and throughput. Streaming via SSE makes a 20-second answer feel fast when the first words appear in half a second. If users wait 8 seconds and then see the whole answer at once, the problem is TTFT; stream the response, shorten prompts, use a faster model for simple questions, and cache prompts.

### 37.7 Controlling generation

Temperature near 0 is focused and consistent (extraction, classification, code, facts); near 1 is creative. Top-p samples from the smallest set covering p probability. Max tokens caps cost and latency. Stop sequences end output. Even at temperature 0, outputs may not be perfectly identical because of GPU math and batching. For structured output (`{"intent": "refund_request", "order_id": 88}`), give a schema, use the provider's structured-output or tool-calling features, and always validate with retries or fallbacks.

### 37.8 Limitations and the customization ladder

Hallucinations, knowledge cutoffs, statelessness, no private data, weak exact math and counting, non-determinism, prompt injection, and cost and latency. Climb from the bottom: prompt engineering (clear instructions, system prompts, few-shot examples, room to reason, delimited inputs, versioned and tested prompts), then RAG, then tools, then fine-tuning, and almost never training your own model. RAG is for knowledge; fine-tuning is for behavior.

### 37.9 API vs self-hosted

Closed models via API give top quality and no GPU management at per-token cost, with data leaving your systems (check terms) and vendor dependency. Open-weight models self-hosted give control, data locality and deep fine-tuning, but you run GPUs, scaling and optimization. Many teams use both with routing: small models for simple tasks, big models for complex ones.

### 37.10 Practitioner's guide

Worked example: choosing models for a support product.

```
Intent classification  → small model, temperature 0, JSON schema   (fast, cheap)
Policy answers (RAG)   → mid model, streaming, citations           (balanced)
Complex disputes       → large reasoning model, human review        (accurate, slow)
Long chats             → summarize every 10 turns; cache system prompt prefix
```

| Aspect | Details |
| --- | --- |
| Benefits | Natural language interface, broad knowledge, flexible tasks |
| Constraints | Context window, token cost, latency, hallucination, statelessness |
| Trade-offs | Model size (quality) vs cost and speed; temperature (creativity) vs consistency |
| Use API models when | Speed to market, top quality, variable volume |
| Self-host when | Data must stay in-house, steady high volume, deep customization |
| Avoid LLMs when | Exact deterministic computation, strict real-time control loops |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Context overflow | Errors on long chats | Summarize, truncate, retrieve |
| JSON parse failures | Broken integrations | Schemas, validation, retries |
| Prompt changed silently breaks behavior | Quality drop | Versioned prompts, eval gate |
| Model version auto-upgraded | Different outputs | Pin model versions |

### Review questions

1. Users wait 8 seconds and then see the whole answer at once. Which metric hurts, and what one technique fixes the feel?

#### Answers

1. Time to first token (TTFT). Stream the response token by token over SSE so the first words appear in under a second; also shorten prompts (faster prefill), route simple questions to a faster model, and use prompt caching.

## Chapter 38: Inside an LLM

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Understand what actually happens inside an LLM so its costs, limits and quirks make sense. |
| Why it is hard | Billions of parameters, abstract math (attention, embeddings, gradients), and behavior that emerges from training rather than explicit rules. |
| How we solve it | Follow one token's journey: tokenize, embed, add positions, pass through attention and feed-forward blocks, predict probabilities, sample; then see how training shapes the weights. |
| What fails, and why | Miscounted letters (tokenization), ignored mid-context facts (attention dilution), memory exhaustion on long chats (KV cache growth), and confident falsehoods (trained for plausibility, not truth). |

Following "The capital of Karnataka is" through the model: text is tokenized, embedded, given positions, refined by dozens of transformer blocks, turned into a score for every vocabulary token, converted to probabilities, and sampled, one token at a time. Every parameter that makes this work was learned by predicting next tokens.

### 38.1 The journey

```
1. Tokenize: text → IDs [464, 3139, 286, 22948, 318]
2. Embed: IDs → vectors of thousands of numbers
3. Add position information
4. Transformer blocks × N (32-100+): self-attention, then feed-forward
5. Output layer: last vector → a score (logit) for every vocabulary token
6. Softmax: scores → probabilities ("Bengaluru" 92%, "Mysuru" 3%)
7. Sample one token, append it, repeat
```

### 38.2 Tokenization

A fixed vocabulary of tens of thousands to \~200,000 pieces is built with BPE (byte-pair encoding): start from characters or bytes and repeatedly merge the most frequent pairs. Common words become one token; rare words split (`[Kar][nat][aka]`). This explains quirks: counting letters is hard because the model sees `[straw][berry]`, not letters; arithmetic is shaky when "12345" becomes `[123][45]`; Indian languages cost more tokens when less common in training data.

### 38.3 Embeddings and position

Each token ID looks up a learned vector in the embedding matrix, so related tokens (Bengaluru, Mysuru) sit close and unrelated ones (biryani) far. Initially each vector knows only its own word, so "bank" is identical in "river bank" and "bank account." Because word order matters ("dog bites man" vs "man bites dog") and attention alone is order-blind, position information is injected, commonly with RoPE (rotary position embeddings), which rotates vectors by position.

### 38.4 Self-attention

Each token looks at earlier tokens to gather context. In "The delivery partner dropped the phone because it was slippery," attention lets "it" connect to "phone." Each token produces a query (what am I looking for?), a key (what do I contain?) and a value (what do I give?), like a library visitor comparing a question with spine labels and then reading the best-matching books.

For "it": dot products of its query with each key give scores (phone 3.5, partner 1.2, ...); softmax turns them into weights (phone 78%, partner 9%, ...); the new meaning of "it" is the weighted mix of values, now carrying "the phone." All tokens do this simultaneously, ideal for GPUs. A causal mask lets tokens see only earlier positions, matching generation, where the future does not exist yet. Multi-head attention runs many attention computations per layer, each free to track different relationships (grammar, references, topics), then combines them. Keys and values never change once computed, which is exactly why the KV cache works.

### 38.5 Feed-forward layers and the glue

After attention (talking to the group), each token passes through a feed-forward network (thinking privately): expand, apply a non-linearity, shrink back. Research suggests much stored factual knowledge ("Karnataka's capital is Bengaluru") lives largely in these layers, which hold a large share of parameters. Residual connections add each block's output to its input so information flows through many layers, like adding sticky notes to original notes; layer normalization keeps numbers stable. Early layers handle low-level patterns, middle layers meaning and facts, late layers prepare the specific prediction. In "Priya gave Arjun her phone because she was leaving," self-attention links "she" to Priya.

### 38.6 Output, softmax, temperature, sampling

The final vector of the last token is projected to a score per vocabulary token. Softmax exponentiates and normalizes: scores \[2.0, 1.0, 0.1\] become e^2 = 7.39, e^1 = 2.72, e^0.1 = 1.11, total 11.22, so 66%, 24%, 10%. Temperature divides scores before softmax: low sharpens toward the top token; high flattens toward randomness. Greedy decoding takes the top token; sampling uses temperature, top-k or top-p. Each new token requires another pass through all layers, which is why generation is sequential and output tokens cost more.

### 38.7 How the model learns

Parameters start random. The training loop shows text, hides the next token, measures the error with cross-entropy loss, and adjusts every parameter slightly. If the correct token got 66%, loss = −ln(0.66) ≈ 0.42; if 1%, −ln(0.01) ≈ 4.6, a big correction. Backpropagation computes each parameter's gradient (how nudging it changes the loss); gradient descent steps downhill, like a blindfolded walker feeling the slope across billions of dimensions. Nobody programs grammar or facts; predicting text well across the internet forces the model to learn them. Training uses trillions of tokens, billions of parameters and thousands of GPUs for weeks to months. Scaling laws show loss improves predictably with model size, data and compute, and larger models showed abilities smaller ones lacked.

### 38.8 From autocomplete to assistant

A base model asked "What's the capital of Karnataka?" may continue with more quiz questions. SFT on high-quality conversations teaches the assistant format; preference training (RLHF and related methods, including Anthropic's Constitutional AI, which trains against written principles with AI feedback) makes answers more helpful, honest and harmless; reasoning training rewards correct, checkable results so models learn to think step by step, at a cost in latency and tokens.

### 38.9 The root of hallucination

The model produces likely-sounding text with no built-in fact lookup, so for something it never saw, the most plausible continuation may be invented. RAG and tools exist to put real information in context so the likely continuation is also correct (Chapter 43).

### 38.10 Practitioner's guide

Worked example: tracing one attention step numerically.

```
Query("it") · Key("phone") = 3.5   · Key("partner") = 1.2   · Key("dropped") = 0.4
softmax → phone 0.78 · partner 0.09 · dropped 0.04 · others 0.09
new "it" = 0.78·V(phone) + 0.09·V(partner) + ...  → meaning ≈ "the phone"
```

| Design choice | Benefit | Constraint / trade-off |
| --- | --- | --- |
| Larger vocabulary | Fewer tokens per text | Bigger embedding table |
| More layers | Richer reasoning | Latency, memory |
| Longer context | More information | Quadratic attention cost, KV memory |
| Grouped-query attention | Smaller KV cache | Slight quality trade-off |
| Higher temperature | Diverse outputs | Less consistency |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Repetition loops | Model repeats phrases | Repetition penalties, sampling settings |
| Lost in the middle | Ignores buried facts | Reorder context, fewer chunks |
| Tokenization surprises | Odd costs for Hindi text | Measure tokens per language; choose tokenizer-efficient models |

### Review questions

1. Which mechanism links "she" to Priya, and which layers are thought to store facts?

#### Answers

1. Self-attention: the query of "she" matches the key of "Priya" most strongly, so the value of "Priya" dominates the new meaning. Facts like "Bengaluru is the capital of Karnataka" are thought to be stored largely in the feed-forward (MLP) layers.

## Chapter 39: Fine-Tuning LLMs

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | A general model does not behave the way your product needs (format, tone, narrow task accuracy), and prompting alone is not enough or too costly. |
| Why it is hard | Full fine-tuning needs huge GPU memory, small datasets overfit, and specializing can erase general or safety behavior. |
| How we solve it | Evaluate first, curate high-quality examples, use parameter-efficient methods (LoRA, QLoRA), keep the same chat template, and test task quality, regressions and safety before deploying. |
| What fails, and why | Invented prices (fine-tuning used for changing facts instead of RAG), garbled replies (template mismatch), worse general answers (catastrophic forgetting), and unsafe behavior (no safety evals). |

Fine-tuning trains a pretrained model further on your own examples so it learns a behavior: format, tone, a narrow task or domain style. It is on-the-job training for a brilliant graduate who already knows language and reasoning.

### 39.1 When to fine-tune

Fine-tune for consistent format or style (a JSON schema, brand tone), a narrow repeated task done very well (classifying tickets into 40 categories, invoice extraction), distilling a big model into a small cheap one, baking in behavior that otherwise needs a 3,000-token prompt, and domain language. Do not fine-tune to add facts such as product prices or policies: models still hallucinate details and go stale; use RAG or a live lookup. Do not fine-tune when prompting works or good examples number fewer than a few hundred. RAG for knowledge, fine-tuning for behavior.

### 39.2 Types

By data: supervised fine-tuning (input → ideal output); preference tuning on better-versus-worse pairs, either RLHF (reward model plus reinforcement learning) or DPO (direct preference optimization, learning directly from chosen and rejected pairs, simpler and popular); and continued pretraining on raw domain text, needing far more data.

By parameters: full fine-tuning updates all weights, with the highest ceiling but huge memory, catastrophic-forgetting risk and a full model copy per task; parameter-efficient fine-tuning (PEFT) freezes the model and trains a small set of new parameters, most often LoRA.

### 39.3 LoRA

Instead of changing a 4,096 × 4,096 matrix W (16,777,216 numbers), LoRA freezes W and learns two small matrices A (4,096 × r) and B (r × 4,096), computing W + BA. With r = 8 that is 2 × 4,096 × 8 = 65,536 trainable numbers, about 0.4%: a thin booklet of sticky notes rather than a rewritten textbook. Benefits: far less GPU memory, adapters of tens of megabytes, many adapters served on one base model, less forgetting, and quality often close to full fine-tuning. Settings: rank r (commonly 8-64), alpha (often r or 2r), target modules (attention projections and often feed-forward layers; all linear layers usually works well), and small dropout.

QLoRA loads the frozen base in 4-bit and trains LoRA adapters on top; the original research fine-tuned a 65B model on a single 48 GB GPU.

Memory math: full fine-tuning needs roughly 16 bytes per parameter (weights, gradients, Adam's two optimizer states) plus activations, so a 7B model needs \~112 GB and a 70B model \~1.1 TB, while QLoRA on 7B fits on one modest GPU.

### 39.4 The pipeline

1. Define the goal and build the evaluation first, e.g. 92% accuracy on 40 categories or tone scores of 4/5 with no refunds above ₹500, using a held-out test set never trained on.
2. Measure a prompting baseline that fine-tuning must beat.
3. Prepare data (80% of the work): chat-style JSONL matching real use, or prompt/chosen/rejected pairs for DPO. Quality beats quantity: hundreds to a few thousand excellent, consistent, diverse examples (including Hinglish, angry users, refusals, handoffs). Remove duplicates and PII, since fine-tuned models can memorize and leak data. Sources: your best agents' replies, expert-written examples, reviewed synthetic data (check provider terms). Split train, validation and test without contamination.
4. Choose the base model: usually the instruct version, small first (1-8B), with a license allowing commercial use and support for your languages; hosted fine-tuning APIs are an option.
5. Choose the method: LoRA or QLoRA for most cases; full fine-tuning for big budgets and domain shifts; SFT then DPO for style polish.
6. Set hyperparameters: learning rate \~1e-4 to 2e-4 for LoRA (\~1e-5 for full), 1-3 epochs, effective batch 16-64 via gradient accumulation, rank 8-32, sequence length fit to data, warmup plus cosine decay. Mask loss to train only on assistant replies, and use the model's exact chat template in training and serving.
7. Train with Hugging Face Transformers, PEFT and TRL, Unsloth, Axolotl, LLaMA-Factory or managed services.
8. Evaluate task metrics against the baseline, general abilities (catastrophic forgetting), safety (fine-tuning can weaken refusals), human samples and edge cases.
9. Deploy by merging the adapter or using multi-LoRA serving; quantize; register; roll out through shadow, canary and A/B.
10. Monitor and iterate: production failures become new examples, the data flywheel.

```python
from datasets import load_dataset
from peft import LoraConfig
from trl import SFTTrainer, SFTConfig

data = load_dataset("json", data_files={"train": "train.jsonl", "test": "val.jsonl"})
lora = LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, target_modules="all-linear", task_type="CAUSAL_LM")
args = SFTConfig(output_dir="support-lora", num_train_epochs=2, learning_rate=2e-4, per_device_train_batch_size=4, gradient_accumulation_steps=4, bf16=True, eval_strategy="epoch")
trainer = SFTTrainer(model="Qwen/Qwen2.5-7B-Instruct", args=args, train_dataset=data["train"], eval_dataset=data["test"], peft_config=lora)
trainer.train()
```

Library APIs change between versions; check current docs.

Loss curves: both falling then flattening is healthy; training falling while validation rises is overfitting; both flat means the rate is too low or the data is broken; spikes or NaN mean the rate is too high.

### 39.5 Mistakes and platforms

| Mistake | Effect | Fix |
| --- | --- | --- |
| Fine-tuning facts | Hallucination, staleness | RAG |
| No baseline or test set | Cannot tell if it helped | Build eval first |
| Messy data | Model learns the mess | Fewer, better examples |
| Too many epochs or high LR | Overfitting, forgetting | 1-3 epochs, watch validation |
| Wrong chat template | Weak output | Same template in training and serving |
| Training on user turns | Odd behavior | Loss masking |
| PII in data | Leaks | Scrub first |
| Skipping safety tests | Weakened refusals | Safety eval every release |
| Test leakage | Fake results | Strict splits |

A fine-tuning platform validates uploads (format, PII, dedupe), stores versioned datasets, queues GPU jobs with per-team quotas, checkpoints, runs automatic quality, safety and regression evaluation as a release gate, registers adapters, and deploys with multi-LoRA serving, canaries and monitoring, while isolating each customer's data.

### 39.6 Practitioner's guide

Worked example: a ticket classifier distilled from a big model.

```
Big model labels 20K historical tickets (spot-checked by humans: 96% agree)
LoRA fine-tune 3B model on 18K, validate 1K, test 1K
Result: 94% accuracy vs 95% big model · 15x cheaper · 5x faster → route 90% of tickets to it
```

| Aspect | Details |
| --- | --- |
| Benefits | Consistent behavior, shorter prompts, cheaper smaller models, domain style |
| Constraints | Quality data, GPU access, eval effort, license terms, retraining on base upgrades |
| Trade-offs | LoRA (cheap, portable) vs full (max quality); specialization vs general ability |
| Use when | Stable narrow tasks, style/format consistency, distillation |
| Avoid when | Adding fast-changing facts, few examples, prompting already works |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Catastrophic forgetting | General answers degrade | LoRA, mixed general data, fewer epochs |
| Train/serve template mismatch | Garbled replies | Same chat template everywhere |
| Overfit to tiny dataset | Great validation, bad production | More diverse data, held-out real traffic test |

### Review questions

1. A team wants to fine-tune so the model knows the latest prices. Right tool? What would fine-tuning be good for?

#### Answers

1. No: prices change often, and fine-tuned facts go stale and get hallucinated. Use RAG or a live tool call to the pricing API or product database at request time. Fine-tuning would help with behavior: brand tone, consistent answer format, or accurate classification of customer questions.

## Chapter 40: Training an LLM from Scratch

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Create a language model from nothing: data, tokenizer, architecture, thousands of GPUs and weeks of training. |
| Why it is hard | Compute costs millions, data quality decides quality, runs fail mid-way, and GPUs must stay busy across a cluster. |
| How we solve it | Scaling laws to size model and data, a filtered and deduplicated data pipeline, a proven Transformer recipe, 3D parallelism, frequent checkpoints and automated recovery. |
| What fails, and why | Lost weeks (no checkpoints when nodes fail), loss spikes (bad batches or unstable learning rates), inflated benchmarks (test data leaked into training), and idle GPUs (data or network bottlenecks). |

Training from scratch is raising a mind from birth rather than on-the-job training. Frontier models need thousands of GPUs for weeks to months and large research teams, but the process is the same at every scale: plan, collect and clean data, train a tokenizer, design the architecture, set up training, distribute it, run and babysit it, post-train, evaluate, and serve.

### 40.1 Planning: scaling laws and compute

Model quality improves predictably with parameters (N), training tokens (D) and compute, so large runs are planned from small ones. DeepMind's Chinchilla finding (2022) suggests about 20 tokens per parameter for the best model at a fixed training budget (140B tokens for 7B parameters). Many models train on far more, because a smaller model trained longer is cheaper to serve for millions of users: you pay more once in training to save on inference forever.

```latex
\text{Training FLOPs} \approx 6 \times N \times D
```

For 7B parameters on 2T tokens: 6 × 7×10^9 × 2×10^12 = 8.4×10^22 FLOPs. At an effective \~4×10^14 FLOP/s per GPU (real training reaches only a fraction of peak, measured as MFU, model FLOPs utilization), that is \~2.1×10^8 GPU-seconds ≈ 58,000 GPU-hours ≈ 5 days on 512 GPUs, roughly $100K-$200K of compute for one final run, very approximately. For 1B parameters on 100B tokens: 6 × 10^9 × 10^11 = 6×10^20 FLOPs.

### 40.2 Data: the most important ingredient

Sources: web crawls (public datasets built from Common Crawl), code, books, Wikipedia, papers, math, and multilingual text (a model good at Indian languages needs plenty of them), all respecting copyright, terms, opt-outs and privacy law. The cleaning pipeline: extract text from HTML; identify language; apply heuristic filters for short, repetitive or gibberish pages; score quality with a classifier; deduplicate exact and near-duplicate pages (MinHash), since duplicates waste compute and cause memorization; remove toxic content and PII; decontaminate benchmark questions; and mix sources in tuned proportions found through small ablations. Output: trillions of clean tokens stored as binary shards in object storage, produced by Spark-scale distributed processing.

### 40.3 Tokenizer

Train BPE on a data sample to a target vocabulary (\~32K to \~200K). Bigger vocabularies mean fewer tokens per sentence but a larger embedding table. Ensure target languages are well represented. The tokenizer is frozen; changing it means retraining.

### 40.4 Architecture

Most LLMs are decoder-only Transformers with upgrades: RoPE positions (extendable to long contexts), RMSNorm, SwiGLU feed-forward activations, grouped-query attention (shared key/value heads that shrink the KV cache), and optionally mixture of experts. A 7B-class model might have \~32 layers, hidden size \~4,096, \~32 heads, 4K-8K context during main training, and a 32K-150K vocabulary. Design for inference: these choices affect serving cost for years.

### 40.5 Training setup

The objective is next-token prediction with cross-entropy, every position a training example. AdamW is the usual optimizer. The learning rate warms up from tiny values, then decays (cosine or warmup-stable-decay). Batches hold millions of tokens per step. BF16 mixed precision halves memory; gradient clipping prevents blowups; careful initialization matters.

### 40.6 Distributed training

A 7B model's training state (\~16 bytes per parameter) is \~112 GB plus activations. Data parallelism splits batches; sharded data parallelism (FSDP or ZeRO) splits weights, gradients and optimizer states across GPUs, gathering them as needed; tensor parallelism splits layer math within a server; pipeline parallelism splits layer groups across servers; sequence or context parallelism splits long sequences. Big runs combine them (3D parallelism). Fast links inside servers (NVLink) and between them (InfiniBand or specialized Ethernet) keep expensive GPUs from idling. Frameworks: PyTorch FSDP, Megatron-LM, DeepSpeed, torchtitan and JAX stacks such as MaxText.

### 40.7 Running the job

With thousands of GPUs, something breaks constantly, sometimes several times a day. Checkpoint frequently (asynchronously to avoid stalls), health-check every node, evict bad machines and resume automatically. Loss spikes from bad batches or instability are handled by rolling back, skipping data and lowering the learning rate. Monitor loss, gradient norm, tokens per second, MFU, GPU health and periodic benchmark evals. Near the end, anneal on the highest-quality data while the learning rate decays ("mid-training"), and extend context in a short final phase (e.g. 4K to 128K). The result is a base model.

### 40.8 Post-training, evaluation and release

SFT for the assistant format; preference tuning (RLHF, DPO, or approaches such as Anthropic's Constitutional AI using written principles and AI feedback); reinforcement learning on checkable problems (math with answers, code with tests) for reasoning; and safety training with red-teaming. Evaluate with benchmarks (MMLU-style knowledge, GSM8K/MATH, HumanEval/SWE-bench-style coding, reasoning, multilingual, long-context), contamination checks, human side-by-side ratings, safety and dangerous-capability evals, and product-specific golden sets. Then quantize, optimize and serve (Chapter 47).

### 40.9 Training infrastructure as a system design

A data platform (crawlers and licensed sources into object storage; Spark or Ray processing; versioned token shards); a compute platform (Slurm or Kubernetes scheduling; thousands of GPUs with fast networking; data loaders fast enough to keep GPUs busy); reliability (node health checks, automatic restart, frequent async checkpoints, spike rollback); observability (loss, gradients, throughput, MFU, GPU health, eval jobs, experiment tracking); and output through post-training and eval gates into a model registry. Bottlenecks: GPU availability and cost, network bandwidth, storage throughput, recovery speed and data quality.

### 40.10 Practitioner's guide

Worked example: planning a small domain model.

```
Goal: 1B-parameter Indic-language assistant
Data: 200B tokens (Hindi, Kannada, Tamil web + books + English), deduped, PII-scrubbed
Compute: 6 × 1e9 × 2e11 = 1.2e21 FLOPs → ~830 GPU-hours at 4e14 effective FLOP/s
Run: 64 GPUs × ~13 hours, FSDP, checkpoints every 30 min
Then: SFT on 50K instructions → DPO → safety evals → quantize → serve
```

| Aspect | Details |
| --- | --- |
| Benefits | Full control of data, tokenizer, languages, licensing |
| Constraints | Compute cost, data rights, expertise, months of iteration |
| Trade-offs | Bigger model (quality) vs inference cost; more tokens per parameter (cheaper serving) vs training cost |
| Use when | Unique data or languages, sovereignty needs, research |
| Avoid when | An existing model + fine-tuning or RAG meets the need |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Benchmark contamination | Inflated scores | Decontaminate, private evals |
| Duplicate-heavy data | Memorization, wasted compute | MinHash dedup |
| GPU failures daily | Lost progress | Frequent async checkpoints, auto-resume |

### Review questions

1. Estimate FLOPs for 1B parameters on 100B tokens. Why might a company train a small model on far more than \~20 tokens per parameter?

#### Answers

1. 6 × 10^9 × 10^11 = 6 × 10^20 FLOPs. Training happens once but inference happens billions of times: a smaller model trained on more tokens is cheaper and faster to serve, even if its training run cost more than the compute-optimal recipe.

## Chapter 41: Build Your Own Mini GPT

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Turn the theory of LLMs into code you can run, read and break on a laptop. |
| Why it is hard | Real models hide the core ideas behind scale, optimizations and engineering. |
| How we solve it | A small, heavily commented GPT trained on Shakespeare: tokenizer, attention, blocks, training loop and sampling, all in one file. |
| What fails, and why | NaN loss (learning rate too high), loss stuck at 4.17 (targets not shifted, so nothing is learned), and rising validation loss (overfitting a small dataset). |

"Build an LLM" can mean three things: build one from scratch to understand it (this chapter), build a production-scale model (Chapter 40), or build an LLM-powered product with an existing model (Chapters 37-52). The companion file `mini_gpt.py` is a complete, heavily commented GPT in about 380 lines of PyTorch with the same architecture as real LLMs, small enough to train on a laptop.

### 41.1 How the code maps to the concepts

| Code piece | Concept | Chapter |
| --- | --- | --- |
| `CharTokenizer` | Text to token IDs | 38.2 |
| `tok_emb` + `pos_emb` | Embeddings and positions | 38.3 |
| `CausalSelfAttention` | Q, K, V, causal mask, multi-head | 38.4 |
| `MLP` | Feed-forward layer | 38.5 |
| `Block` | Residuals and LayerNorm | 38.5 |
| `lm_head` + `generate()` | Scores, softmax, temperature, top-k sampling | 38.6 |
| Training loop | Cross-entropy, backprop, AdamW, warmup + cosine, clipping, checkpoints | 40.5 |

The model ties input and output embedding weights, initializes weights with small normal values, registers a lower-triangular causal mask, and generates by cropping to the context window, scaling the last position's logits by temperature, keeping the top-k, sampling, and appending.

### 41.2 The heart of every training loop

```python
for step in range(num_steps):
    x, y = get_batch()                # inputs and the same tokens shifted by one
    logits = model(x)                 # predict next-token scores
    loss = cross_entropy(logits, y)   # how wrong were we?
    loss.backward()                   # compute gradients
    optimizer.step()                  # nudge parameters downhill
    optimizer.zero_grad()
```

Everything in Chapter 40 is about running this loop on trillions of tokens across thousands of GPUs without falling over.

### 41.3 Running it

`pip install torch` then `python mini_gpt.py`. It downloads about 1 MB of Shakespeare, trains a roughly 0.8M-parameter model, saves the best checkpoint, and writes Shakespeare-style text. For slow laptops: `python mini_gpt.py --steps 500 --n_layer 2 --n_embd 64 --block_size 64`. Generate later with `--generate_only --prompt "ROMEO:"`; train on your own text with `--data yourfile.txt`. (The script was syntax-checked during the course; the training environment lacked space for PyTorch, so report any error you hit.)

What you will see: step-0 loss near 4.2, which is ln(65) ≈ 4.17, the cross-entropy of guessing uniformly among 65 characters, so any lower value means learning. Loss falls fast, then slowly, typically ending around 1.5-1.8 for this size. Output evolves from random symbols to words to speaker names and Shakespeare-ish nonsense. Training loss falling while validation loss rises is overfitting, visible live.

### 41.4 Experiments

Change `--n_layer` from 1 to 6 to see depth and scaling; `--block_size` from 16 to 256 to see context; `--temperature` from 0.2 to 1.5 to see sampling; `--lr 1e-2` to see instability; `--dropout 0.0` on a small file to see overfitting.

### 41.5 From toy to real

Use a BPE tokenizer such as `tiktoken`; train on billions of cleaned tokens; replace manual attention with `F.scaled_dot_product_attention(..., is_causal=True)` for fused, FlashAttention-style kernels; adopt RoPE, RMSNorm, SwiGLU and grouped-query attention; train on GPUs with BF16, then DDP or FSDP; add a KV cache to generation; and post-train with SFT and DPO to turn it into a chatbot. Andrej Karpathy's "Let's build GPT" video and nanoGPT repository follow the same path.

### 41.6 Practitioner's guide

Worked example: reading a training log.

```
step     0 | train 4.17 | val 4.17   ← uniform guessing over 65 chars
step   500 | train 2.10 | val 2.15   ← learned common letters and spaces
step  2000 | train 1.55 | val 1.68   ← words and speaker names
step  3000 | train 1.40 | val 1.72   ← val rising: overfitting begins → stop at best checkpoint
```

| Aspect | Details |
| --- | --- |
| Benefits | Real intuition for every LLM component; safe place to experiment |
| Constraints | Toy scale, character tokens, CPU speed |
| Trade-offs | Bigger model (better text) vs training time; longer context vs memory |
| Use when | Learning, teaching, testing ideas |
| Avoid when | Production needs (use pretrained models) |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Loss NaN | Training explodes | Lower LR, gradient clipping |
| Loss stuck at 4.17 | Not learning | Check targets shifted by one, LR too low |
| Gibberish at any step | Sampling bug | Verify temperature, top-k, decode mapping |

### Review questions

1. Why is step-0 loss about 4.2 with a 65-character vocabulary?

#### Answers

1. With random weights the model assigns roughly 1/65 probability to each character, so cross-entropy is −ln(1/65) = ln(65) ≈ 4.17, the uniform-guessing baseline. Any lower loss means the model has learned something.

## Chapter 42: Predicting LLM Behavior

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Know in advance how an LLM will behave on your task before users find out. |
| Why it is hard | Outputs vary run to run, small prompt changes shift behavior, and evaluating quality is itself noisy. |
| How we solve it | Logprobs and self-consistency for single answers, golden sets with repeated runs and confidence intervals for tasks, CI eval gates, and interpretability research for the inside view. |
| What fails, and why | Shipping noise as improvement (too few eval cases), offline green but online red (eval set unlike real traffic), and biased judges (LLM graders favoring longer answers or first positions). |

LLMs are probabilistic, sensitive to wording, opaque and changing between versions, so predicting them is less like reading code and more like predicting a person: combine known tendencies, systematic testing, statistics and, increasingly, looking inside. Five levels of prediction exist, from one answer to the model's internals.

### 42.1 One response: confidence

Token probabilities (logprobs): if " negative" gets 97% for a sentiment label, the answer is stable; 52% versus 48% predicts flipping. Use logprobs for confidence scores and routing low-confidence cases to humans or bigger models, but verify calibration, since "90% confident" is not always right 90% of the time, especially after preference training.

Self-consistency: sample several times. Five identical answers suggest reliability; five different refund amounts suggest guessing (hallucination). Majority votes improve reasoning accuracy at N times the cost.

```python
answers = [ask_llm(question, temperature=0.8) for _ in range(5)]
best, count = Counter(answers).most_common(1)[0]
confidence = count / len(answers)
if confidence < 0.6:
    escalate_to_human_or_bigger_model()
```

Self-reported confidence ("how sure are you?") helps but can be unreliable; combine it with logprobs, consistency and grounding.

### 42.2 One prompt: tendencies

| Tendency | Expect | Handle |
| --- | --- | --- |
| Examples dominate | Copies style, length, even mistakes of few-shot examples | Choose and vary examples carefully |
| Specific instructions win | Vague prompts give generic output | Specify format, length, audience, constraints |
| Sycophancy | Agrees with wrong claims; caves to pushback | Neutral questions; instruct correction; test pushback |
| Verbosity | Longer than needed | Length limits, max tokens |
| Lost in the middle | Uses start and end of long context better | Key info first or last; fewer, better chunks |
| Hallucination hot spots | Obscure facts, numbers, dates, citations, URLs, quotes | Ground with RAG and tools; verify |
| Tokenization weak spots | Letter counting, exact arithmetic | Calculator or code tools |
| Reasoning helps | Better multi-step answers with thinking | Enable where accuracy matters |
| Mirrors the user | Matches tone and language | Set tone in the system prompt |
| Position bias | Favors first or last option | Randomize and test both orders |
| Follows instructions in data | Prompt injection | Data, not instructions; approvals |
| Surface-pattern refusals | Refuses harmless scary-sounding requests | Test borderline cases both ways |

Sensitivity testing perturbs prompts with paraphrases, formatting changes, typos, Hinglish, shuffled examples and irrelevant sentences; if small changes flip outputs, the prompt is fragile.

### 42.3 One task: evaluation and statistics

The most practical prediction is measuring how often the system succeeds. Build golden sets of real inputs, edge cases, adversarial cases and should-refuse or should-say-don't-know cases. Score with exact or regex matches, schema validation, code tests, LLM-as-judge with rubrics (calibrated against humans, since judges favor longer answers, certain positions and their own style) and human review. Behavioral tests include invariance (changing "Priya" to "Arjun" must not change a refund decision) and directional tests (a 45-minute delay must move compensation from none to eligible).

Statistics matter: 90 passes of 100 has a 95% margin of about 1.96 × √(0.9 × 0.1 / 100) ≈ ±6%, so 92% versus 90% on 100 cases is noise. pass@k measures success within k attempts. Run the suite in CI on every prompt, model or retrieval change, then canary and A/B.

### 42.4 One model: scaling laws

Loss is predictable from small runs, which is how large training runs are planned. Specific abilities are harder; some appear to jump on benchmarks ("emergent abilities"), though how much is real versus an artifact of pass/fail scoring is debated. Labs run dangerous-capability evaluations before release.

### 42.5 Inside the model: interpretability

Probing trains small classifiers on internal vectors ("does layer 20 encode truthfulness?"). The logit lens reads what the model would predict at middle layers. Attention visualization shows where tokens look but not fully why. Sparse autoencoders decompose activity into interpretable features; in public Anthropic research, amplifying a Golden Gate Bridge feature made the model mention the bridge constantly, showing features causally drive behavior. Circuit tracing maps how features connect across layers, including evidence of planning ahead such as choosing a rhyme before writing a line. Steering nudges features to change behavior. It is a fast-moving complement; behavioral evals remain the main production tool.

### 42.6 Making behavior predictable

Low temperature for factual work; structured outputs with schemas and constrained decoding, always validated; clear prompts with edge-case examples; grounding with RAG and tools; fine-tuning for narrow tasks; pinned model versions with evals before upgrades; versioned prompts logged with outputs; guardrails; fallbacks on validation failure or low confidence; and production monitoring of output distributions for behavioral drift.

A behavior-testing platform stores versioned test cases, runs experiments (prompt × model) through a job queue and an LLM gateway with N samples per case, scores with exact, schema, code, judge and human scorers, reports pass rates with confidence intervals and diffs, gates releases in CI, and samples production traffic so every failure becomes a new test.

### 42.7 Practitioner's guide

Worked example: deciding whether a prompt change ships.

```
Golden set: 400 cases × 3 samples
Old prompt: 88.0% ± 1.8%   New prompt: 91.5% ± 1.6%   → difference beyond noise ✓
Safety set: refusals on harmful 99% (same) · false refusals 4% → 2% ✓
Cost: +6% tokens (acceptable) → canary 5% → A/B → ship
```

| Aspect | Details |
| --- | --- |
| Benefits | Confident releases, early detection of regressions, measurable progress |
| Constraints | Eval cost, judge bias, coverage gaps, non-determinism |
| Trade-offs | Larger eval sets (confidence) vs speed and cost; LLM judges (scale) vs humans (accuracy) |
| Use logprobs when | Classification confidence and routing |
| Use self-consistency when | High-stakes answers where extra cost is acceptable |
| Avoid | Decisions from a handful of examples |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Judge favors longer answers | Verbose model "wins" | Rubrics, length-controlled comparisons |
| Eval set unlike production | Offline green, online red | Sample real traffic into the golden set |
| Order bias in pairwise judging | Inconsistent winners | Randomize and test both orders |

### Review questions

1. A support bot gives five different refund amounts to the same question. What does this predict, and name two fixes.

#### Answers

1. Low self-consistency predicts low reliability: the model is guessing the policy. Make it predictable by grounding (RAG on the real policy or a tool that computes the amount), lowering temperature, using structured output with validation, and routing low-confidence cases to a human.

## Chapter 43: Why LLMs Hallucinate

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | LLMs sometimes state false things confidently: fake citations, wrong numbers, invented events. |
| Why it is hard | Models are trained to produce plausible text, not to know what they do not know, and guessing is often rewarded. |
| How we solve it | Ground answers with RAG and tools, check premises, use low temperature and structured outputs, verify claims and citations, allow "I don't know," and keep humans in the loop for high stakes. |
| What fails, and why | Explaining events that never happened (false premises accepted), 404 citations (references generated, not retrieved), wrong refund amounts (no grounding), and over-correction to "I don't know" (thresholds too strict). |

A hallucination is fluent, confident content that is false or unsupported, such as an invented "₹150 for delays over 40 minutes, per the 2024 Delivery Promise policy." The danger is that wrong answers look exactly like right ones. There is no single bug; hallucination arises from how LLMs are built, so it is reduced by architecture and process, not eliminated.

### 43.1 Types

| Type | What happens | Example |
| --- | --- | --- |
| Factual fabrication | Invents facts | Wrong dates, fake statistics |
| Fake references | Invents sources | Nonexistent papers, URLs, court cases |
| Unfaithful to context | Contradicts the given document | Policy says 30 minutes, answer says 40 |
| Unsupported additions | Adds details not in context | Invents a ₹150 amount |
| False premise acceptance | Goes along with a wrong assumption | "Why did Einstein win the Nobel for relativity?" (it was the photoelectric effect) |
| Reasoning errors | Logical-sounding steps, wrong result | Early arithmetic slip |
| Self-knowledge errors | Claims abilities it lacks | "I've emailed your manager" with no email tool |

### 43.2 Root causes

The objective rewards plausibility, not truth: text about policies usually contains specific amounts, so for an unseen policy the likely continuation is a specific-sounding amount, like a student who knows what good answers look like inventing one.

Knowledge is lossy compression: billions of parameters cannot store trillions of tokens verbatim. Famous facts are stored sharply; rare long-tail facts blurrily or not at all, and the model fills gaps with patterns, blending similar real people's details. The knowledge cutoff leaves recent events missing.

There is no native "I don't know": softmax always yields a distribution and generation must pick a token. Abstaining is a learned behavior, and knowing when one does not know is hard.

Training and evaluation can reward guessing: on exams scoring +1 for right and 0 for both wrong and "I don't know," guessing always wins. A widely discussed 2025 analysis from OpenAI argued that pipelines and leaderboards graded this way encourage confident guessing; fixing it means penalizing confident errors more than abstentions.

Post-training pressures: fine-tuning on confident answers the model does not actually know trains fabrication; raters often prefer complete, confident answers they cannot verify; sycophancy makes models accept false premises.

Autoregressive snowballing: models cannot erase earlier tokens, so a wrong year chosen early leads to invented history and a fake source to stay consistent. Reasoning models that check and revise before answering often hallucinate less on hard problems.

Sampling randomness: with temperature above zero, "₹75" at 40% and "₹100" at 35% produce different facts on different runs.

Context problems even with RAG: missing, wrong, contradictory or buried context.

Computation limits: arithmetic, counting and dates are estimated.

Inside the model: Anthropic's published circuit-tracing research found, in the models studied, a default "can't answer" pathway that recognized, familiar entities suppress; hallucinations can occur when familiarity misfires and the model recognizes a name without knowing the facts, like greeting a familiar face by the wrong name.

Fluency and accuracy are separate skills: the model learned how confident expert text sounds and applies that style regardless of truth. Never treat confident tone as evidence.

### 43.3 Hot spots

Higher risk: citations, URLs, paper titles, quotes, legal cases; specific numbers; obscure people, small businesses, niche topics; recent events; private company information; false-premise questions; long math and reasoning chains; low-resource languages. Lower risk: famous facts, general explanations, common code patterns, and rewriting or summarizing text given in the prompt.

### 43.4 Detection

Self-consistency across samples (SelfCheckGPT builds on this); token uncertainty around key facts; faithfulness checking that labels each claim supported, contradicted or not mentioned by sources, via LLM judges or natural language inference models; citation verification, including having the model quote supporting sentences and string-matching them against documents; cross-checking with tools (numbers against databases, URLs by fetching, code by running); and human review plus user feedback.

### 43.5 Reduction

Model builders improve data, train abstention and calibrated uncertainty, penalize confident errors in evals and rewards, use RL with verifiable rewards and honesty-focused preference training, and add reasoning.

System designers: ground knowledge with RAG; use tools for facts and math (query the orders database for amounts; never let the model remember prices); prompt for honesty (answer only from context, say you do not know and offer a human, quote then answer, explicitly allow uncertainty); use low temperature; constrain outputs with schemas and validate; add a verification pass (chain-of-verification style); instruct the model to check premises; keep humans in the loop for high stakes; show citations; and measure faithfulness continuously.

The trade-off: more abstention means fewer hallucinations but less helpfulness; the goal is calibration.

```
Question → router
  ├─ this user's facts (order status, amounts) → tools / database, never model memory
  ├─ policy / knowledge → RAG (hybrid search + rerank, permission-filtered)
  └─ general chat → LLM directly
→ LLM (low temperature; answer only from context; quote sources; say if unsure)
→ verifier (claims supported? numbers match tools? citations real?)
   pass → stream with citations;  fail → regenerate stricter or hand off to a human
→ log, score faithfulness, turn failures into tests
```

For "Why did Swiggy shut down in Bengaluru last year?" (it did not), the risk is false-premise hallucination; the system should check the premise with search or records and politely correct it.

### 43.6 Practitioner's guide

Worked example: quote-then-answer catching a fabrication.

```
Prompt: "Quote the exact policy sentence, then answer."
Model:  Quote: "Orders delayed beyond 45 minutes receive ₹150."
Verifier: string-match quote in retrieved chunks → NOT FOUND → reject
Retry (stricter): Quote: "...more than 30 minutes ... coupon worth 20% ... up to Rs 100" → FOUND ✓
```

| Aspect | Details |
| --- | --- |
| Benefits of mitigation | Trust, fewer refunds/legal risks, verifiable answers |
| Constraints | Extra latency and cost for verification, coverage of sources |
| Trade-offs | Abstaining more (safer) vs helpfulness; verification depth vs speed |
| Strong mitigation when | Money, health, legal, policies, citations |
| Lighter touch when | Brainstorming, creative writing |

| Failure case | Symptom | Fix |
| --- | --- | --- |
| Fake citations | Links 404 | Fetch and verify every URL |
| Confident wrong numbers | Wrong refunds quoted | Pull numbers from tools/DB only |
| Overcorrection | "I don't know" to everything | Calibrate thresholds; measure helpfulness too |

### Review questions

1. A user asks why a service shut down when it did not. Which hallucination type is at risk, and what should the system do?

#### Answers

1. False-premise hallucination: the bot may invent reasons for an event that never happened. The system should check the premise against real data (search or records) and correct it politely, e.g. "I don't have any information that Swiggy shut down in Bengaluru; were you thinking of a specific outage?"

## Chapter 44: Embeddings and Vector Databases

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Find content by meaning ("money back" finds "refund policy") across millions of items in milliseconds. |
| Why it is hard | Keyword search misses synonyms, exact nearest-neighbor search is too slow at scale, and vectors are large in memory. |
| How we solve it | Embedding models map text and images to vectors; ANN indexes (HNSW, IVF, PQ) search fast; hybrid search with BM25 handles exact terms; filters and reranking refine results. |
| What fails, and why | Missed order IDs (vectors weak at exact tokens), nonsense after model upgrades (mixed vector spaces), deleted content still found (index not synced), and memory exhaustion (full-precision vectors in RAM). |

An embedding is a vector of numbers representing meaning; similar meanings land close together. Vector databases store embeddings and find nearest neighbors fast, which powers semantic search, RAG, recommendations and deduplication.

### 44.1 Why keyword search is not enough

Priya types "I want my money back"; the article is titled "Refund Policy." Keyword search finds nothing, because the words differ. Embeddings place both near each other on a map of meanings:

```
            meaning space (2D sketch of ~1,000 dimensions)

   "refund" •  • "money back"            • "biryani"
   "return my payment" •                    • "pulao"
                                  • "late delivery"
                                    • "order delayed"
```

Embedding models (OpenAI, Cohere, Voyage, Google, or open-source BGE, E5, sentence-transformers) produce vectors of a few hundred to a few thousand dimensions. Multilingual models place "refund," "रिफंड चाहिए" and "ಹಣ ವಾಪಸ್" together; multimodal models such as CLIP-style encoders put images and text in one space, so "spicy red curry" finds food photos.

### 44.2 Measuring closeness

Cosine similarity measures the angle (−1 to 1) and is the usual choice for text; dot product equals cosine for normalized vectors and is fastest; Euclidean distance measures straight-line distance. Use the metric the embedding model was trained with.

### 44.3 The scale problem and ANN

Exact k-nearest-neighbor search over 100M vectors of 1,536 dimensions costs about 150 billion multiplications per query. Approximate nearest neighbor (ANN) search finds very likely neighbors much faster, trading among recall, speed and memory.

HNSW (hierarchical navigable small world) builds a multi-layer graph: sparse top layers for long jumps, dense bottom layers for local steps, like expressway to highway to local road.

```
Layer 2:  A ────────────────────── K
Layer 1:  A ───── E ───── H ────── K
Layer 0:  A─B─C─D─E─F─G─H─I─J─K─L      (search: enter top, descend, refine)
```

It is fast with high recall and easy inserts, but memory-hungry. IVF (inverted file) clusters vectors with k-means and searches only the nearest clusters (`nprobe` tunes recall versus speed), like searching only the cooking section of a library. PQ (product quantization) compresses vectors 50-100x by replacing chunks with codebook IDs, often followed by re-scoring the top results with full vectors. Combinations include IVF-PQ and quantized HNSW; disk-based indexes such as DiskANN cut RAM; LSH is an older technique.

| Algorithm | Speed | Recall | Memory | Best for |
| --- | --- | --- | --- | --- |
| Exact kNN | Slow | Perfect | Medium | Under \~100K vectors |
| HNSW | Very fast | Very high | High | Most use cases |
| IVF | Fast | Tunable | Medium | Large datasets |
| IVF-PQ / quantized | Fast | Lower, tunable | Very low | Billions of vectors |

Memory math: 100M × 1,536 × 4 bytes ≈ 614 GB of RAM plus graph overhead. Options: shard, quantize to 8-bit (\~150 GB), use PQ, shorten embeddings where models allow it, or use disk-based indexes.

### 44.4 Vector database features

Metadata filtering: post-filtering runs ANN then drops non-matching results and can leave too few; pre-filtering or filtered search applies the filter during search. Hybrid search combines vector search (meaning) with BM25 keyword search (exact terms such as `ORD-88213`, product codes, names), merged with Reciprocal Rank Fusion. Re-ranking with a cross-encoder re-scores the top 50 to pick the best 5. Plus inserts, deletes, sharding, replication, backups, access control and multi-tenant namespaces.

Options: add-ons (pgvector for PostgreSQL, Elasticsearch/OpenSearch, MongoDB Atlas Vector Search, Redis); dedicated databases (Pinecone, Milvus, Weaviate, Qdrant, Chroma); libraries (FAISS, ScaNN, HNSWlib). With PostgreSQL and a few million vectors, start with pgvector.

### 44.5 Example scenario: semantic help-center search

```
Authoring: article edited → CDC event → chunk → embed (model v3) → upsert to vector index + BM25 index
Query:     "money back for cold food" → embed query (~30 ms)
           → hybrid search: vector top 50 + BM25 top 50 → RRF merge → filter (region=IN, status=active)
           → cross-encoder rerank → top 5 → show results / feed RAG
```

### 44.6 Failure scenarios and fixes

| Scenario | Symptom | Root cause | Fix |
| --- | --- | --- | --- |
| Order ID search | "ORD-88213" returns the refund policy but not the order | Vectors are weak at exact tokens | Hybrid BM25 + vector; route IDs to the database |
| Model upgrade | Results become nonsense after switching embedding model | Mixed vector spaces | Store model version; re-embed into a new index; blue-green switch |
| Deleted article still found | Users see retired content | Index not synced with source | CDC-driven deletes; periodic reconciliation |
| Filter starves results | Asking for top 10 Bengaluru docs returns 1 | Post-filtering | Pre-filtered ANN or larger candidate sets |
| Memory exhaustion | Vector nodes OOM at 200M vectors | Full-precision HNSW in RAM | Quantize, shard, disk-based index |
| Similar but wrong | "How do I cancel?" matches "How do I order?" | Structural similarity ≠ answer | Rerank; evaluate with golden queries |
| Tenant leak | Company A sees Company B docs | Missing namespace filter | Per-tenant namespaces or mandatory tenant filter |

### 44.7 Challenges

Embedding versioning and re-embedding cost; freshness via CDC; chunking (Chapter 45); query embedding latency; the gap between similar and correct; and embeddings leaking information about source text, so protect them like the data. Uses: semantic search, RAG, two-tower retrieval, visual search, deduplication, classification and clustering, anomaly detection, and agent memory.

### 44.8 Practitioner's guide

```
Choosing an index:
  < 100K vectors        → exact search (simple, perfect recall)
  100K – 50M, RAM ok    → HNSW (pgvector / dedicated DB)
  50M – billions        → IVF-PQ or quantized HNSW, sharded; disk-based if RAM tight
```

| Aspect | Details |
| --- | --- |
| Benefits | Meaning-based search, multilingual matching, cross-modal search |
| Constraints | RAM, re-embedding cost on model change, weak exact-token matching |
| Trade-offs | Recall vs latency vs memory; dimensions vs cost |
| Use when | Semantic search, RAG, recommendations, dedup |
| Avoid when | Exact lookups by ID, structured filters only (use SQL) |

| Additional failure case | Symptom | Fix |
| --- | --- | --- |
| Query and document use different prefixes/modes | Recall drops | Use model's query vs document modes |
| Normalization missing with dot product | Long docs dominate | Normalize vectors |

### Review questions

1. Pure vector search for "refund for order ORD-88213" misses the order. Why, and what fixes it?

#### Answers

1. Embeddings capture meaning, not exact tokens; an ID like `ORD-88213` has no semantic neighbors to match. Use hybrid search (BM25 keyword plus vectors, merged with reciprocal rank fusion), and better still detect the order ID and look it up directly in the orders database.

## Chapter 45: Retrieval-Augmented Generation (RAG)

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Let an LLM answer from your own private, changing documents with citations, without retraining it. |
| Why it is hard | Parsing documents is messy, retrieval can miss or return stale content, access rules must hold, and the model may still ignore its sources. |
| How we solve it | An indexing pipeline (parse, chunk, contextualize, embed) and a query pipeline (rewrite, permission filter, hybrid search, rerank, grounded prompt), evaluated separately for retrieval and generation. |
| What fails, and why | "I don't know" when the answer exists (poor chunks or vocabulary gaps), outdated answers (old versions indexed), confidential leaks (no ACL filter at retrieval), and wrong answers from right chunks (weak grounding). |

RAG finds the relevant information in your own data and puts it in the prompt before the LLM answers: an open-book exam instead of a closed-book guess. It uses private data without retraining, stays fresh, reduces hallucinations, enables citations, and respects per-user access.

### 45.1 Two pipelines

```
INDEXING (offline, continuous)
Sources ─► parse ─► clean ─► chunk ─► add context ─► embed ─► vector index
(PDFs, wiki,                                           └────► BM25 index
 tickets, DB)                metadata: title, section, date, region, ACL

QUERY (online, per question)
Question ─► rewrite ─► FILTER (permissions, freshness) ─► hybrid search ─► RRF
         ─► rerank ─► "don't know" threshold ─► assemble context (token budget)
         ─► grounded prompt + citations ─► LLM ─► guardrails ─► answer
```

### 45.2 Indexing

Parsing is harder than it looks: tables, multi-column PDFs, headers, scans needing OCR. Clean boilerplate. Chunk: too small loses context ("it is processed within 5 days"), too large blurs embeddings and wastes tokens; start at a few hundred tokens and tune. Strategies: fixed-size with 10-20% overlap, structure-aware (headings, then paragraphs, then sentences), semantic (split where topics change), and special handling that keeps tables, code functions and FAQ pairs intact. Attach metadata (source, section, updated date, region, access roles, URL). Add a contextual prefix ("\[Compensation Policy > Late Deliveries\]"). Re-index on every create, update or delete via events or CDC, deleting old versions.

### 45.3 Query pipeline

Rewrite follow-ups into standalone questions ("Can I get something for it?" becomes "Is a customer eligible for compensation for a late order?"); use multi-query, decomposition, HyDE (search with a hypothetical answer) and routing (order status to the orders API, policies to search, small talk to nothing). Retrieve with hybrid search. Filter by permissions at retrieval time: if it is never retrieved, it can never leak; telling the LLM "do not reveal" fails under clever questions or injection. Rerank the top 20-50 to 3-10. Assemble within a token budget, best first, deduplicated, with source labels and dates, and instructions separated from data by tags. Generate with streaming, citations, guardrails and a human-handoff option.

```
SYSTEM: Answer ONLY from <context>. If absent, say you don't know and offer an agent.
        Cite [1], [2]. Never promise compensation beyond the policy.
<context>
[1] (Compensation Policy > Late Deliveries, updated 2026-09-01) Orders delivered more than 30
    minutes late are eligible for a coupon worth 20% of order value, up to Rs 100...
</context>
USER: My order was 45 minutes late. Am I eligible?
```

### 45.4 Advanced techniques

Small-to-big (match small chunks, send the parent section); hierarchical retrieval (find the document by summary, then chunks); text-to-SQL for structured questions with read-only, user-restricted access; GraphRAG (Chapter 46); agentic RAG where retrieval is a tool called repeatedly; and semantic caching of similar questions, invalidated when documents change.

Contextual Retrieval, published by Anthropic, prepends LLM-written chunk-specific context before embedding and BM25 indexing. In Anthropic's experiments, contextual embeddings cut the top-20 retrieval failure rate by 35% (5.7% to 3.7%), adding contextual BM25 by 49% (to 2.9%), and adding reranking by 67% (to 1.9%). Part of the 49% comes from adding lexical search, and the metric checks a single golden chunk, so re-test on your own golden set. Prompt caching makes per-chunk context generation cheaper ([summary source](https://plushcap.com/analysis/anthropic/anthropic-contextual-retrieval)).

Other techniques: late chunking (embed the whole document with a long-context model, then pool per chunk), proposition chunking, learned sparse retrieval (SPLADE-style), late interaction (ColBERT-style, one vector per token), tuned hybrid weights, and rich metadata filters. Choose embedding models by testing on your data, multilingual support, dimension cost, query versus document modes, and versioning.

### 45.5 Example scenario: the companion pipeline

The companion file `rag_from_scratch.py` is a dependency-free pipeline with structure-aware chunking, contextual prefixes, BM25, a stand-in vector index, RRF, an IDF-weighted reranker, permission and freshness filters before ranking, a "don't know" threshold, grounded prompts and an evaluation harness. Run results: the late-delivery question retrieved the current policy and never the archived 2024 one; a customer asking about internal goodwill credits got "I don't have information," while a support agent found it; "Do you deliver to Antarctica?" first matched the common word "deliver" until IDF weighting fixed it; and query rewriting alone dropped MRR from 1.00 to 0.92 until reranking restored it.

### 45.6 Failure scenarios and fixes

| Scenario | Symptom | Root cause | Fix |
| --- | --- | --- | --- |
| Answer exists, bot says "don't know" | Missed retrieval | Poor chunks, vocabulary gap | Hybrid search, contextual chunks, query rewriting |
| Quotes the 2024 policy | Outdated answer | Old version still indexed | Freshness filter, delete superseded docs, prefer newest |
| Intern sees salary data | Confidential leak | No ACL filter at retrieval | Permission metadata at indexing, filter before ranking |
| Right chunk retrieved, wrong answer | Generation failure | Weak prompt, distraction | Quote-then-answer, fewer ordered chunks, low temperature, verifier |
| Contradictory answer | Two docs disagree | Old and new both retrieved | Source priority, dates, conflict flags |
| Malicious PDF hijacks bot | Injected instructions followed | Content treated as commands | Data-not-instructions, guardrails, approvals |
| Slow and costly | 6-second answers | Too many chunks, big model | Rerank to fewer chunks, cache, route to smaller model |
| Irrelevant answer to off-topic query | Common words matched | No relevance threshold | IDF-weighted rerank + minimum score |

Diagnosis rule: if the correct chunk was in the top K, it is a generation problem; if not, a retrieval problem.

### 45.7 Evaluation

Retrieval: Recall@K, MRR, context precision. Generation: faithfulness (every claim supported), answer relevance, correctness. Build golden sets from real questions including must-say-don't-know and permission cases; score with LLM-as-judge rubrics calibrated to humans (frameworks such as RAGAS help); run in CI on every chunking, embedding, prompt or model change; watch thumbs, escalations and "that's wrong" follow-ups in production.

### 45.8 Challenges and choices

Parsing quality, chunk tuning, freshness SLAs, multi-tenancy, permission modeling, latency (\~0.5-1.5 s to first token: rewrite 100-300 ms, embed 20-50 ms, search 20-80 ms, rerank 50-200 ms, TTFT 300-800 ms) and cost. Use long context for a few documents, RAG for large changing corpora, tools for live data, agentic RAG for multi-hop questions, and fine-tuning for behavior.

### 45.9 Practitioner's guide

```
RAG maturity ladder
 L1 naive: chunk → embed → top-5 → prompt
 L2 hybrid search + metadata filters + reranker
 L3 contextual chunks + query rewriting + permission filters + citations
 L4 evaluation in CI + freshness pipeline + semantic cache
 L5 agentic retrieval / GraphRAG for multi-hop and global questions
```

| Aspect | Details |
| --- | --- |
| Benefits | Private, fresh, citable, access-controlled knowledge without retraining |
| Constraints | Parsing quality, index freshness, latency, context budget |
| Trade-offs | More chunks (recall) vs distraction and cost; agentic (power) vs latency |
| Use when | Large or changing document collections |
| Avoid when | Few docs (long context), live transactional data (tools), behavior changes (fine-tune) |

| Additional failure case | Symptom | Fix |
| --- | --- | --- |
| Tables parsed into soup | Wrong numbers | Table-aware parsing; keep tables as chunks |
| Semantic cache serves outdated answer | Old policy after update | Invalidate cache on document change |

### Review questions

1. An internal assistant answers an intern from a confidential HR document. Where should this be prevented, and why is telling the LLM not enough?
2. The correct chunk is always in the top 3, yet answers are wrong. Retrieval or generation problem, and two fixes?

#### Answers

1. At retrieval: attach access permissions to every chunk at indexing time and filter by the user's permissions before ranking, so the document is never retrieved. Instructions to the LLM are not enough because a clever question or prompt injection can make it reveal anything in its context. If it is never retrieved, it can never leak.
2. A generation problem. Fixes: a stricter grounded prompt (quote the supporting sentence, then answer); fewer, better-ordered chunks with the best first; lower temperature; a stronger model; a verification step checking each claim against sources, confirmed with faithfulness scores.

## Chapter 46: Knowledge Graphs

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Answer questions that depend on relationships across many facts (dishes, ingredients, diets, restaurants, areas). |
| Why it is hard | SQL needs a join per hop, text search cannot combine facts, and building a correct graph means resolving duplicate entities. |
| How we solve it | Model entities and typed relationships with an ontology, extract and resolve entities with provenance, store them in a graph database, and use graph traversals to ground LLM answers. |
| What fails, and why | Wrong menus (two restaurants merged by over-eager resolution), timeouts (supernodes with millions of edges), false allergy-safe answers (incomplete source data), and stale facts (no update pipeline). |

A knowledge graph stores facts as entities connected by typed relationships, so multi-hop questions become walks along edges. Google popularized the term in 2012 with "things, not strings."

```
  (Paneer Tikka) ──CONTAINS──► (Paneer) ──IS_A──► (Dairy) ◄──AVOIDED_BY── (Vegan diet)
        │
    SERVED_AT
        ▼
  (Punjab Grill) ──LOCATED_IN──► (Koramangala)
        │
    RATED_BY
        ▼
     (Priya) ──FOLLOWS_DIET──► (Jain diet)
```

### 46.1 The model

Nodes are entities (dishes, ingredients, restaurants, people, places, diets); edges are typed, directed relationships; properties sit on both. The atomic unit is the triple (subject, predicate, object): (Paneer Tikka, CONTAINS, Paneer). SQL needs a JOIN per hop and slows on deep queries; graphs store edges directly, and many graph databases keep pointers to neighbors (index-free adjacency), so each hop is a quick lookup. Use both: graphs for connections, SQL for transactions and aggregates.

### 46.2 Two flavors

Property graphs (Neo4j, Amazon Neptune, TigerGraph, Memgraph, JanusGraph) use labels and properties, queried with Cypher, Gremlin or the ISO GQL standard (2024). RDF (a W3C standard) uses URI-identified triples, SPARQL, and RDFS/OWL ontologies with inference, as in Wikidata.

```cypher
MATCH (d:Dish)-[:SERVED_AT]->(r:Restaurant)-[:LOCATED_IN]->(:Area {name: "Koramangala"})
WHERE NOT EXISTS { MATCH (d)-[:CONTAINS]->(:Ingredient)-[:AVOIDED_BY]->(:Diet {name: "Jain"}) }
RETURN d.name, r.name, d.price ORDER BY d.price
```

### 46.3 Ontology

The ontology defines allowed node and edge types and rules (IS\_A is transitive: Paneer IS\_A Dairy IS\_A AnimalProduct). Without it, teams invent CONTAINS, HAS\_INGREDIENT and includes, and the graph becomes unqueryable. Start small and practical.

### 46.4 Building one

```
Sources (DBs, menus, catalogs, docs, activity)
 → extract entities → ENTITY RESOLUTION (hardest) → extract relationships
 → validate against ontology → provenance + confidence → load, keep fresh via CDC
```

LLMs are good at extracting entities and relations from messy text, but can hallucinate relationships, so validate, keep confidence scores, review high-impact facts, and use rules or small models for easy cases. Entity resolution decides that "Panner Tika" is Paneer Tikka while Punjab Grill Koramangala and Indiranagar are different restaurants, using normalization, attribute comparison, embedding similarity and human review. Provenance ("source: menu v12, extracted 2026-09-01, confidence 0.94") lets you trace and fix errors.

### 46.5 Uses and algorithms

Search knowledge panels, recommendations, fraud rings (shared devices, cards, addresses), dietary and safety reasoning, supply chains, drug discovery, enterprise knowledge ("who owns this service?"), and AI grounding. Algorithms: shortest path, centrality and PageRank, community detection, similarity; graph embeddings and GNNs support link prediction.

### 46.6 KGs with LLMs

KG-grounded answers retrieve the relevant subgraph so the LLM answers from verified paths; text-to-Cypher or SPARQL translates questions into queries with read-only credentials, validation, depth limits, timeouts and permission filters; Microsoft Research's GraphRAG builds an entity graph from documents, detects communities and summarizes them, answering global questions ("main complaint themes this quarter") that chunk retrieval cannot, at high build cost and with staleness risk; KGs serve as structured agent memory; LLMs help build and maintain KGs. Choose a KG over vector RAG when answers depend on relationships, multiple hops or exact, explainable facts.

### 46.7 Scale

Partitioning is hard because traversals cross machines; keep dense neighborhoods together and scale reads with replicas first. Supernodes ("Bengaluru," "Biryani" with millions of edges) explode queries; filter edges by type or time, split supernodes, cap fan-out. Enforce depth limits, timeouts and result limits. Precompute similarities, communities and PageRank offline and cache them.

```
Source DBs ─CDC─► Kafka ─► graph builder (resolve, validate)
   ├─► graph DB (online, shallow traversals)
   ├─► offline graph analytics (communities, PageRank)
   └─► graph embeddings → vector DB
 APIs: recommendations · dietary checks · fraud scoring · LLM grounding
```

### 46.8 Example scenario: a food knowledge graph

Ontology: Dish, Ingredient, IngredientCategory, Cuisine, Restaurant, Area, Diet, Allergen, User (privacy-controlled). Built from restaurant menus plus LLM extraction, resolved and validated with provenance. Serves "Jain-friendly, nut-free dishes near me," similar dishes, support-bot answers about ingredients (with an allergy disclaimer and confidence check, since restaurant data may be incomplete), and coupon-abuse ring detection.

### 46.9 Failure scenarios and fixes

| Scenario | Symptom | Root cause | Fix |
| --- | --- | --- | --- |
| Two restaurants merged | Wrong menu shown | Over-eager entity resolution | Stricter attributes (address, phone), human review |
| Same dish five times | Duplicated results | Under-merging | Fuzzy matching, embeddings, canonical IDs |
| Query times out | "All paths" through "Biryani" | Supernode explosion | Depth limits, edge filters, split supernodes |
| False allergy-safe answer | "Nut-free" dish contains cashews | Incomplete source menu | Provenance, confidence, disclaimer, confirm with restaurant |
| Invented relationships | LLM-extracted edge is false | Extraction hallucination | Ontology validation, confidence thresholds |
| Stale facts | Removed dish still recommended | No update pipeline | CDC-driven upserts and quality checks |

### 46.10 Challenges

Entity resolution quality, ontology governance, freshness, partitioning, supernodes, extraction cost, provenance, privacy of user nodes, and the cost of being wrong in health-critical answers.

### 46.11 Practitioner's guide

| Aspect | Details |
| --- | --- |
| Benefits | Explainable multi-hop answers, exact relationships, fraud ring detection |
| Constraints | Ontology design, entity resolution, freshness, scaling traversals |
| Trade-offs | Precision and structure vs build cost; online traversal vs offline precompute |
| Use when | Questions depend on relationships; compliance needs explanations |
| Avoid when | Simple "find the paragraph" questions (vector/hybrid RAG is cheaper) |

```
Hybrid answer path: question → entity linking ("Punjab Grill", "Jain")
   → graph: dishes without Jain-avoided ingredients → vector search: reviews about spice
   → LLM composes answer with graph path + review citations
```

### Review questions

1. "Restaurants near me with dairy-free dishes rated 4+ by spicy-food lovers." Why does vector RAG struggle and a KG succeed?

#### Answers

1. No single text chunk contains the answer; it requires combining location, ingredients (excluding anything that IS\_A dairy), ratings and the preferences of the users who rated. Vector search finds similar text, not joined facts. A knowledge graph traverses those relationships with exact filters and returns an explainable path.

## Chapter 47: Serving LLMs at Scale

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Serve an LLM to many users at once with fast streaming and low cost per token. |
| Why it is hard | Models are enormous, generation is sequential and memory-bound, the KV cache grows with every user, GPUs are scarce, and requests vary 100x in size. |
| How we solve it | Continuous batching, paged KV cache, prefix caching, quantization, speculative decoding, tensor parallelism, load-aware and prefix-aware routing, warm pools, and an LLM gateway with quotas and fallbacks. |
| What fails, and why | Short questions waiting for essays (static batching), out-of-memory at peak (KV cache not managed), near-zero cache hits (changing content at the prompt start), and outages (single provider without fallback). |

LLM serving is a fight to serve many users, fast, at the lowest cost per token, with enormous models, sequential generation, unpredictable request sizes and scarce GPUs. Most of the tricks are really about managing GPU memory, especially the KV cache. Chapter 61 explains the GPU and CUDA layer underneath.

### 47.1 Where GPU memory goes

```
GPU memory (e.g. 80 GB)
┌──────────────────────────────────┬──────────────────────────────┐
│ Model weights (fixed)            │ KV cache (grows with users)  │
│ 70B × 2 bytes ≈ 140 GB → split   │ per token ≈ 2 × layers ×     │
│ across GPUs or quantize          │ KV heads × head size × bytes │
└──────────────────────────────────┴──────────────────────────────┘
```

For a 70B-class model with 80 layers, 8 KV heads, head size 128 and 16-bit values: 2 × 80 × 8 × 128 × 2 ≈ 0.33 MB per token, so a 4,000-token conversation is \~1.3 GB and 100 concurrent users \~130 GB, more than the weights. The KV cache often limits users per GPU.

### 47.2 Batching

Each decode step reads all weights; generating for 64 users reuses the same read. Static batching waits for the longest request, like a bus that will not leave until the last passenger arrives. Continuous (iteration-level) batching removes finished requests and admits waiting ones at every token step, like a metro, giving several times higher throughput.

```
Step 1: [A][B][C][D]
Step 3: [A][E][C][D]   ← B finished, E joined
Step 4: [F][E][C][G]   ← A, D finished; F, G joined
```

Bigger batches lower cost per token but slow per-user speed; tune per product (chat favors latency, overnight jobs favor throughput).

### 47.3 KV cache management

PagedAttention (popularized by vLLM) splits the KV cache into small pages allocated as requests grow, like OS virtual memory or a hotel renting rooms nightly, so far more requests fit. Prefix caching computes shared prefixes (system prompt, tools, documents) once and reuses them, cutting TTFT and cost, and needs cache-aware routing. Disaggregated serving runs compute-heavy prefill and bandwidth-heavy decode on separate GPU pools so a giant prompt cannot stall everyone's streaming.

### 47.4 Smaller and faster models

| Precision | Bytes per parameter | 70B size |
| --- | --- | --- |
| FP16/BF16 | 2 | \~140 GB |
| FP8/INT8 | 1 | \~70 GB |
| INT4 | 0.5 | \~35 GB |

Quantization (GPTQ, AWQ; KV cache too) shrinks weights and speeds decode; always evaluate quality. Distillation trains small students. Speculative decoding lets a small draft model guess several tokens that the big model verifies in one parallel pass, keeping big-model quality with lower latency. Mixture of experts activates only a few experts per token, though all must sit in memory.

### 47.5 Multi-GPU serving and engines

Tensor parallelism splits layers within a server; pipeline parallelism splits layer groups; replicas scale users horizontally. Engines: vLLM, SGLang, TensorRT-LLM (often with Triton Inference Server) and Hugging Face TGI.

### 47.6 Load balancing and autoscaling

Round robin fails when one request is 50 tokens and another 100,000. Route by least outstanding work or most free KV memory, by prefix affinity (consistent hashing on conversation or prompt prefix, balanced against hot replicas), and by model or LoRA adapter. Autoscaling is hard: cold starts take minutes to fetch and load \~140 GB; idle GPUs cost money; GPUs can be unavailable during demand spikes. Scale on queue depth, tokens/s, KV usage and TTFT; keep warm pools; pre-scale for known peaks; cache weights locally; reserve baseline capacity; span regions; run discounted batch work off-peak.

### 47.7 Rate limits, overload and the LLM gateway

Limit requests per minute and input and output tokens per minute per user, key and org with token buckets; prioritize paid and interactive traffic; queue briefly, then reject with `429` and `Retry-After`; shed load; cap `max_tokens`; require client backoff with jitter.

```
Team apps ─► INTERNAL LLM GATEWAY
   auth & budgets · routing (cheap vs smart) · fallbacks across providers · retries,
   timeouts, circuit breakers · exact + semantic cache · PII redaction · guardrails ·
   cost tagging · logging & tracing
        ├─► Provider A   ├─► Provider B   └─► self-hosted open model (vLLM)
```

Routers and cascades send easy requests to small models and escalate low-confidence ones, evaluated to avoid silent quality loss.

### 47.8 Example scenario and cost

A support bot handles 1M conversations/day × 5 calls × (3,000 input + 300 output tokens) = 15B input and 1.5B output tokens/day. Because output is priced several times higher, it is a large share of cost despite being 10x fewer tokens, so keep answers concise. Levers: shorter prompts, prefix caching, response caching, small-model routing, `max_tokens`, batch APIs, summarized histories, and self-hosting with quantization only at high steady volume.

### 47.9 Failure scenarios and fixes

| Scenario | Symptom | Root cause | Fix |
| --- | --- | --- | --- |
| Short questions wait for essays | High latency for simple prompts | Static batching | Continuous batching |
| OOM at peak concurrency | Requests fail or evict | KV cache exhaustion, fragmentation | PagedAttention, KV quantization, admission control |
| TTFT spikes for everyone | Streams stall | Giant prefills interfere with decode | Chunked prefill or disaggregated prefill/decode |
| Cache hit rate near zero | High cost, slow TTFT | Changing content at prompt start; random routing | Stable prefix first; prefix-aware routing |
| Spike causes timeouts | 5xx storm | Cold starts too slow | Warm pools, pre-scaling, queue + 429 |
| Provider outage | Bot down | Single provider | Gateway fallbacks, circuit breakers |
| Quantized model worse | Quality complaints | Precision loss on your tasks | Evaluate per task; mixed precision |
| Retry storm | Load multiplies | Clients retry without jitter | Backoff + jitter, retry budgets |

### 47.10 Metrics

TTFT p50/p95/p99, inter-token latency, throughput per GPU, GPU utilization and KV usage, queue depth and wait, cache hit rates, error, rate-limit and timeout rates, and cost per request and per million tokens.

### 47.11 Practitioner's guide

```
Capacity planning example (illustrative)
Peak 2,000 concurrent streams × 2,000-token contexts × 0.33 MB/token ≈ 1.3 TB KV cache
Per 8-GPU node: ~640 GB HBM − 140 GB weights ≈ ~500 GB for KV → ~3 nodes for KV alone
Add headroom (2x) and prefill load → plan ~6-8 nodes; INT8 KV halves that
```

| Aspect | Details |
| --- | --- |
| Benefits | Lower cost per token, predictable latency, higher utilization |
| Constraints | GPU memory, scarcity, cold starts, engine maturity |
| Trade-offs | Throughput (big batches) vs per-user latency; quantization speed vs quality |
| Self-host when | Steady high volume, data control, custom models |
| Use APIs when | Spiky or modest volume, frontier quality needed |
| Avoid | Round-robin LLM routing; ignoring KV memory in capacity plans |

### Review questions

1. With static batching, short questions wait as long as 2,000-word essays. Which technique fixes it and how?

#### Answers

1. Continuous (iteration-level) batching: at every token step the server removes finished requests and admits waiting ones into the free slots, so short questions finish and return immediately instead of waiting for the longest request, and GPUs stay full.

## Chapter 48: Tool Use: How an LLM Bot Triggers APIs

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Let an LLM look up live data and take real actions (order status, refunds), even though it can only produce text. |
| Why it is hard | The model may choose the wrong tool or arguments, users can manipulate it, and actions have real side effects. |
| How we solve it | The model emits structured tool requests; your executor validates them, takes identity from the session, enforces permissions and limits in code, calls APIs with timeouts and idempotency, and returns trimmed results. |
| What fails, and why | Users reading others' orders (model-supplied user IDs), double refunds (retries without idempotency), policy-breaking refunds (limits only in prompts), and endless loops (no step limits). |

The LLM never calls an API itself; it only produces text. It asks for a call by writing a structured request, and your code makes the call. The manager in a closed room slides a note under the door; the assistant outside makes the phone call and slides the answer back.

### 48.1 The lifecycle

Anthropic's documentation describes the loop: provide tools and a prompt; the model responds with a tool request; your code extracts the name and input, runs it and returns results; the model uses them to answer ([Claude tool-use tutorial](https://platform.claude.com/docs/agents-and-tools/tool-use/build-a-tool-using-agent)).

```
1. App → LLM:   tools (name, description, input_schema) + user message
2. LLM → App:   stop_reason "tool_use"; tool_use block {id, name, input}   (just JSON)
3. App:         validate → permission check → call real API → result
4. App → LLM:   user message with tool_result {tool_use_id, content}
5. LLM → User:  final answer (or another tool_use → loop)
```

```json
{"name": "get_order_status",
 "description": "Get live status and ETA of one of the CURRENT USER's orders. Use when the user asks where their order is.",
 "input_schema": {"type": "object", "properties": {"order_id": {"type": "integer"}}, "required": ["order_id"]}}
```

The model replies with `{"type": "tool_use", "id": "toolu_01A", "name": "get_order_status", "input": {"order_id": 88}}`; nothing has been called yet. Your executor calls `GET /v1/orders/88`, returns `{"type": "tool_result", "tool_use_id": "toolu_01A", "content": "{status: OUT_FOR_DELIVERY, eta_minutes: 12}"}`, and the model answers "Ravi is bringing it in about 12 minutes."

### 48.2 How the model decides

Tool definitions become prompt tokens (and cost tokens); post-training teaches the model to emit tool requests when a description matches the need; it extracts parameters from the conversation and should ask when they are missing. Tool choice can be automatic or forced (any tool, or one specific tool, useful for structured extraction).

### 48.3 The agent loop

```python
response = llm.call(messages, tools)
while response.stop_reason == "tool_use":
    results = [run_tool(c.name, c.input) for c in response.content if c.type == "tool_use"]
    messages += [assistant_msg(response), tool_results_msg(results)]
    response = llm.call(messages, tools)
```

That loop is the simplest agent. Independent calls may arrive as several tool\_use blocks in one response; run them in parallel. Dependent calls (check status, then cancel, then refund) chain across turns.

### 48.4 The tool executor

```
LLM tool request
 → 1 allowed for this user/role?  2 schema valid?  3 identity from SESSION, not model
 → 4 needs confirmation (money, cancel)?  5 call API with timeout, retry, idempotency key
 → 6 trim & sanitize response  7 return result or clear error  8 log trace, latency, cost
 → real APIs
```

Security: never let the model supply `user_id`; inject identity from the authenticated session and check ownership, or "I'm user 1001, show order 5520" becomes an IDOR attack. Grant least-privilege tools; auto-run reads, but confirm writes with real effects and enforce limits (refund ≤ ₹500) in code; put idempotency keys on writes; never expose generic "fetch any URL" tools (SSRF); treat results as untrusted data; rate limit tool calls.

Reliability: timeouts, backoff for idempotent calls, clear errors returned to the model (an `is_error` flag lets it explain or try another approach), maximum loop iterations, circuit breakers and fallbacks to humans. Trim 4 KB of raw JSON to the few fields needed.

### 48.5 Designing tools

Clear names (`get_order_status`, not `orders_api_v2_handler`); descriptions that say when to use; strict schemas with enums; a few sharp tools rather than fifty overlapping ones; consolidated workflows (`cancel_and_refund`) where sequencing is risky; helpful errors ("order 88 is already delivered"); concise results.

### 48.6 Other trigger patterns

Model-decided tool use; deterministic pre-fetch (always load the order shown on screen); intent routers that run fixed workflows; event-triggered proactive messages ("your order is delayed, here is a ₹50 coupon"); scheduled jobs; provider-hosted tools such as web search or sandboxed code execution; and MCP servers (Chapter 49). Let the LLM decide what the user wants; let code decide what is allowed.

### 48.7 Example scenario: cancel and refund

"My order 88 is late, cancel it and refund me": the gateway authenticates user 42; the orchestrator pre-fetches active orders; the model calls `get_order_status(88)` (owner check passes, status PREPARING) and `search_policies` (free cancellation before pickup); it asks "Cancel and refund ₹450 to Swiggy Money?"; on Yes, `cancel_order` and `issue_refund` run with a code-enforced limit, idempotency key `refund:88` and a 2-second timeout; the answer streams; every step is traced; an API outage falls back to a human agent.

### 48.8 Failure scenarios and fixes

| Scenario | Symptom | Root cause | Fix |
| --- | --- | --- | --- |
| User reads others' orders | Data leak | Model supplies `user_id` | Identity from session; ownership checks |
| Double refund | Customer refunded twice | Retry without idempotency | Idempotency keys on writes |
| Refund of ₹5,000 | Policy violated | Limit only in prompt | Enforce in code |
| Agent loops forever | Cost spikes | No iteration cap; repeated errors | Max steps, loop detection |
| Wrong tool chosen | Odd actions | Vague descriptions, overlapping tools | Sharper names, descriptions, fewer tools |
| Injection via results | Bot follows text from a review | Results treated as instructions | Data-not-instructions, approvals |
| Bot crashes on API error | Conversation dies | Exceptions not returned | Clear error results; fallbacks |

### 48.9 Challenges

Latency of extra round trips (parallelize, prefetch, filler messages), token cost of tool definitions, ambiguous parameters, safe write actions, and testing non-deterministic tool choice.

### 48.10 Practitioner's guide

```
Read tool (auto):    get_order_status, search_policies, list_recent_orders
Write tool (confirm): cancel_order, issue_refund(≤ ₹500 enforced in code)
Never exposed:        delete_user, raw_sql, http_get(any_url)
```

| Aspect | Details |
| --- | --- |
| Benefits | Live data, real actions, exact math, fewer hallucinations |
| Constraints | Extra round trips, token cost of definitions, security surface |
| Trade-offs | Model-decided flexibility vs deterministic predictability |
| Model-decided tools when | Open-ended conversations |
| Deterministic prefetch/routers when | Predictable, high-volume or high-stakes flows |
| Avoid | Generic "do anything" tools; identity in model parameters |

### Review questions

1. A tool `get_order(user_id, order_id)` takes both from the LLM. What is the security problem and the redesign?

#### Answers

1. Letting the model supply `user_id` allows impersonation by typing another ID: an IDOR attack through the bot. Redesign as `get_order(order_id)`; the tool executor takes `user_id` from the authenticated session and verifies the order belongs to that user before returning data.

## Chapter 49: MCP, the Model Context Protocol

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Every AI app needs the same integrations (files, GitHub, Slack, databases); building each one per app does not scale. |
| Why it is hard | Integrations differ in auth and data shape, third-party servers may be malicious, and too many tools bloat the model's context. |
| How we solve it | A standard protocol: hosts run clients that connect to servers exposing tools, resources and prompts over JSON-RPC, with OAuth for remote servers and annotations for risky actions. |
| What fails, and why | Hidden instructions in tool descriptions (tool poisoning), changed tools after approval (rug pulls), deleted repos (over-broad scopes), and data leaks between servers (no outbound approvals). |

MCP is an open, vendor-neutral protocol that standardizes how AI applications connect to external tools and data: the USB-C port for AI apps. Instead of 5 apps × 20 services = 100 custom integrations, each service builds one MCP server and each app one MCP client: N × M becomes N + M.

Anthropic introduced MCP in November 2024 and in December 2025 donated it to the Agentic AI Foundation, a directed fund under the Linux Foundation co-founded by Anthropic, Block and OpenAI with support from Google, Microsoft, AWS, Cloudflare and Bloomberg, keeping its governance model unchanged ([Anthropic announcement](https://anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation)). It was reported to have over 97 million monthly SDK downloads and 10,000 active servers at the time, with client support across ChatGPT, Claude, Cursor, Gemini, Microsoft Copilot and Visual Studio Code ([report](https://feedbagel.com/post/anthropic-donates-model-context-protocol-to-agentic-ai-foundation-under-linux-fo-24780)).

### 49.1 Architecture

```
┌──────────────── HOST (AI app: chat app, IDE, support bot) ────────────────┐
│  LLM ◄──► host logic (permissions, UI, which tools the model sees)          │
│               │                   │                    │                    │
│          MCP client          MCP client           MCP client  (1 per server)│
└───────────────┼───────────────────┼────────────────────┼────────────────────┘
           Files server       GitHub server       Orders server
           (local, stdio)     (remote, HTTP)      (remote, HTTP)
```

The host runs the conversation and consent; each client keeps an isolated connection to one server; servers expose capabilities. The LLM still never talks to servers: the host converts MCP tools into tool definitions (Chapter 48) and its client calls the server when the model requests a tool.

### 49.2 Primitives

| Primitive | What | Controlled by | Example |
| --- | --- | --- | --- |
| Tools | Actions with input schemas | The model (with approval) | `get_order_status`, `create_issue` |
| Resources | Data identified by URI | The app or user | `file:///README.md`, `menu://restaurant/15` |
| Prompts | Reusable templates | The user | `/summarize_ticket` |

Tool annotations hint read-only, destructive and idempotent behavior so hosts auto-run reads and confirm destructive actions; output schemas declare return types. Clients offer servers sampling (ask the host's LLM to generate), elicitation (ask the user mid-task), roots (allowed folders) and, in the newer specification, tasks for long-running operations, alongside OAuth 2.1 ([SDK notes on spec 2025-11-25](https://docs.rs/crate/mcpkit/latest)).

### 49.3 Protocol and transports

Messages are JSON-RPC 2.0. Lifecycle: initialize (version and capability negotiation), initialized notification, operation (`tools/list`, `tools/call`, `resources/read`, `prompts/get`, change notifications), shutdown. Versions are dated, such as 2025-11-25.

```json
{"jsonrpc":"2.0","method":"tools/call","id":1,"params":{"name":"getTeaNames","arguments":{}}}
```

The example comes from an open-source Go server ([source](https://pkg.go.dev/github.com/cbrgm/go-mcp-server@v1.0.1)). stdio runs local servers as child processes over standard input and output: simple and private, but the server runs with your permissions. Streamable HTTP serves remote, multi-user servers and streams responses; SDK guidance recommends migrating from the older SSE transport.

Remote auth uses OAuth 2.1: the user signs in and approves scopes, the app receives a scoped token, every request carries it, and the server returns only that user's data. Use least-privilege scopes, short-lived revocable tokens, no token passthrough to other services, and identity from the token, never model parameters.

### 49.4 A tiny server

```python
from mcp.server.fastmcp import FastMCP
mcp = FastMCP("swiggy-orders")

@mcp.tool()
def get_order_status(order_id: int) -> dict:
    """Get live status and ETA for one of the current user's orders."""
    return {"order_id": order_id, "status": "OUT_FOR_DELIVERY", "eta_minutes": 12}

if __name__ == "__main__":
    mcp.run()
```

The decorator turns name, docstring and type hints into the tool definition. Hosts register servers in configuration such as `{"mcpServers": {"swiggy-orders": {"command": "python", "args": ["server.py"]}}}` (formats vary by host).

### 49.5 Example scenario

"Where's my Swiggy order 88?" At startup the client initializes and lists tools. The host offers them to the LLM, which requests `get_order_status(88)`. The read-only annotation allows auto-run; the client calls `tools/call` with Priya's OAuth token; the server verifies ownership and calls the Orders API; the result returns to the model, which answers.

### 49.6 Scaling remote servers and context bloat

A remote server is a web service: stateless where possible behind load balancers; sessions via an `Mcp-Session-Id` header with sticky routing or shared Redis state; a gateway for auth and per-tool rate limits; timeouts and circuit breakers on backend APIs; tracing of every `tools/call`; strict tenant isolation; and a registry for discovery. Fifteen servers with twenty tools each put 300 definitions into every prompt; load tools on demand through tool search, expose fewer higher-level tools, and enable only relevant servers.

### 49.7 Failure and attack scenarios

| Scenario | What happens | Defense |
| --- | --- | --- |
| Prompt injection via results | A GitHub issue tells the AI to leak secrets | Results are data; approval for sensitive actions |
| Tool poisoning | Hidden instructions in a tool description | Trusted servers only; review; host filtering |
| Rug pull | Server changes tools after approval | Pin versions; alert and re-approve on changes |
| Over-broad permissions | Server can delete repos | Least-privilege scopes; read-only defaults |
| Malicious local server | Code runs with your permissions | Trusted sources; containers or sandboxes |
| Cross-server leak | Private data read by A, sent out by B | Approvals for outbound actions; data-flow policies |
| Confused deputy | Server reuses user token elsewhere | Audience checks; server's own scoped credentials |
| Destructive action without consent | Files deleted, messages sent | Honor destructive annotations; confirmations; audit |
| Session lost on scale-out | Errors after load balancer change | Shared session state or sticky routing |

The model proposes; the host and user decide; the server enforces.

|  | Function calling | MCP |
| --- | --- | --- |
| Who defines tools | Each app | The service, once |
| Reuse | Rewrite per app | Any MCP host |
| Discovery | Hard-coded | Dynamic `tools/list` |
| Beyond tools | Tools only | Resources, prompts, sampling, elicitation |

### 49.8 Practitioner's guide

| Aspect | Details |
| --- | --- |
| Benefits | Build once, use in any MCP host; dynamic discovery; standard auth |
| Constraints | Context bloat from many tools, trust in third-party servers, session handling at scale |
| Trade-offs | Ecosystem reuse vs control over each integration; local stdio (private) vs remote HTTP (shared) |
| Use MCP when | Multiple AI apps need the same integrations; third-party ecosystems |
| Plain function calling when | One app, a few internal tools |
| Avoid | Installing unreviewed servers; giving servers broad OAuth scopes |

```
Adopting MCP safely
 1 inventory servers + owners   2 pin versions   3 least-privilege scopes
 4 annotate read-only/destructive   5 approvals for outbound/destructive
 6 trace every tools/call   7 alert on tool-definition changes
```

### Review questions

1. A third-party server's `search_docs` description secretly tells the model to email your API keys. Name the attack and two defenses.

#### Answers

1. Tool poisoning: malicious instructions hidden in a tool description. Defenses: install only trusted, reviewed, version-pinned servers; require human approval for sensitive actions like sending email; never place secrets in the model's context; and enforce host-side data-flow policies that block private data from reaching outbound tools.

## Chapter 50: The Agent Harness

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | A model alone cannot reliably do multi-step work; something must run the loop, provide context and keep it safe. |
| Why it is hard | Models loop, claim false success, overflow context, misuse tools and can be hijacked by content they read. |
| How we solve it | A harness: a budgeted control loop, a context engine, a validated tool layer, allow/ask/deny permissions with sandboxing, verification hooks, checkpoints and per-step traces. |
| What fails, and why | Runaway cost (no budgets or loop detection), "done" without proof (no verification), lost context (no compaction), and destructive actions (no permission policy or sandbox). |

Agent = model + harness. The model is the engine; the harness is the rest of the car: steering (the loop), wheels (tools), mirrors (context), dashboard (observability), brakes and seatbelts (permissions, sandbox, budgets) and GPS (planning). The same model in different harnesses performs very differently.

### 50.1 Anatomy

```
                         User / task
┌──────────────────────── AGENT HARNESS ────────────────────────┐
│ 1 CONTROL LOOP    call model → run tools → feed results → repeat │
│                   stop conditions · budgets · interrupts         │
│ 2 CONTEXT ENGINE  system prompt · tool defs · history · memory   │
│                   files · retrieval · compaction · sub-agents    │
│ 3 TOOL LAYER      registry · validation · timeouts · truncation  │
│ 4 SAFETY LAYER    allow/ask/deny · sandbox · approvals · secrets │
│ 5 PLAN & VERIFY   task lists · plan mode · prove it's done       │
│ 6 STATE           transcripts · checkpoints/undo · resume        │
│ 7 EXTENSIBILITY   hooks · skills · commands · MCP                │
│ 8 OBSERVABILITY   per-step traces · tokens · cost · errors       │
└───────────────┬───────────────────────────────┬────────────────┘
            LLM (API)                     Environment (files, shell, browser, APIs)
```

### 50.2 The parts

Control loop: stop when the model is done, steps or budget (tokens, cost, time) run out, or the user interrupts instantly; detect loops (same tool, arguments and error three times) and escalate; run independent calls in parallel. Control logic belongs in reliable code, not the model.

Context engine (context engineering, often the biggest quality lever): versioned system prompts; tool definitions loaded on demand; truncated tool output; memory files with project rules (an `AGENTS.md`-style convention now under the same foundation as MCP); retrieval; compaction that summarizes old turns; sub-agents with fresh context returning summaries. Prefer just-in-time context fetched with tools; irrelevant context makes models worse.

Tool layer: registry with risk levels and timeouts, schema validation before execution, errors returned to the model to enable self-correction, head-and-tail truncation of huge outputs, MCP clients. Invest in tool design as much as prompts.

Safety layer: allow (reads), ask (edits, commands), deny (deleting outside the project, reading secrets); modes with org policies overriding users; sandboxing (Chapter 32), because permissions decide what is allowed and the sandbox limits what is possible; secrets never in context; content treated as data; checkpoints for undo; audit logs.

Planning and verification: task lists show progress; plan mode proposes without changing anything; verification makes success provable by running tests, linters or builds, sometimes enforced by a stop hook that rejects "done" until checks pass.

### 50.3 Workflows vs agents and multi-agent patterns

Anthropic's guide "Building effective agents" distinguishes workflows (predefined code paths) from agents (the model decides its steps) and advises the simplest thing that works. Patterns: prompt chaining, routing, parallelization, orchestrator-workers and evaluator-optimizer. Multi-agent harnesses give fresh contexts and parallelism at much higher token cost and coordination overhead; use them for independent sub-tasks.

### 50.4 The evaluation harness

```
Task suite (realistic tasks + checks) → fresh sandbox per task → run agent N times
 → graders: outcome checks (hidden tests, final state) · LLM judge · trajectory checks
 → report: pass rate ± CI, pass@k, cost, latency, safety violations → CI gate
```

Grade outcomes rather than exact steps, run multiple trials, include adversarial tasks, and unit-test the harness with a scripted fake model emitting fixed tool calls.

### 50.5 Example scenario: the companion harness

The file `mini_harness.py` is a dependency-free harness with a step-budgeted loop, schema-validating registry, allow/ask/deny policy, workspace sandbox, truncation, compaction, a verification stop hook and tracing. A scripted model tried to fix `calc.py`:

| Step | Model did | Harness did |
| --- | --- | --- |
| 1-2 | Listed and read files | Allowed silently |
| 3 | Claimed "Done!" without a fix | Verifier ran tests, rejected the claim |
| 4 | Obeyed an injected comment to write a fake key to `../leak.txt` | Policy denied it |
| 5 | Passed an unknown argument | Schema validation rejected it |
| 6-8 | Ran tests, wrote the fix, re-ran tests | Allowed after approval |
| 9 | Finished with tests passing | Accepted |

Three model mistakes became zero real damage, and the leak file was never created. Verification belongs in the harness because prompts are suggestions while code is enforced every time.

### 50.6 Failure scenarios and fixes

| Failure | Fix |
| --- | --- |
| Infinite loops, repeated failing calls | Step budgets, loop detection, escalate |
| "Done!" without proof | Verification hooks run tests before accepting |
| Context overflow | Truncation, compaction, sub-agents, just-in-time retrieval |
| Wrong tool or arguments | Better descriptions, schema validation, helpful errors |
| Destructive actions | Permission policy, sandbox, checkpoints |
| Prompt injection from content | Data-not-instructions, approvals, egress allowlists |
| Runaway cost | Budgets, smaller models for sub-tasks, caching |
| Hard to debug | Per-step traces with inputs, outputs, timing, cost |

### 50.7 Challenges

Balancing autonomy and control, context budgets on long tasks, evaluating non-deterministic trajectories, permission fatigue for power users (allowlists help), and keeping safety intact as tools grow.

### 50.8 Practitioner's guide

| Aspect | Details |
| --- | --- |
| Benefits | Reliable agents, contained mistakes, measurable quality, debuggability |
| Constraints | Engineering effort, latency of checks, permission UX |
| Trade-offs | Autonomy (fewer prompts) vs control (more approvals); rich context vs cost |
| Heavy harness when | Agents act on real systems (code, money, email) |
| Light harness when | Read-only Q&A assistants |
| Avoid | Trusting "done" claims; unbounded loops |

```
Harness checklist: budgets · loop detection · schema validation · allow/ask/deny
· sandbox · secrets out of context · verification hook · checkpoints · traces · eval suite
```

### Review questions

1. Why did the harness reject the first "Done!" and why is this check better in the harness than in the prompt?

#### Answers

1. The verification hook ran the tests, saw them fail, and rejected the claim because it had no evidence. In the harness the check runs every time in deterministic code; in a prompt it is only a suggestion the model can forget, skip to appear finished, or be talked out of by injection.

## Chapter 51: AI Agents

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Hand an AI a goal ("research this", "fix this bug") and let it plan and act until done. |
| Why it is hard | Steps are unknown in advance, mistakes compound, tasks run long, and an agent with data, untrusted input and outbound channels can be tricked into leaking. |
| How we solve it | Use the least autonomy that works, plan and re-plan, manage memory carefully, use multi-agent patterns only for independent work, run durably with approvals, and break the lethal trifecta. |
| What fails, and why | Twenty steps on the wrong goal (no clarifying question), repeated side effects after crashes (no durable execution or idempotency), planted false memories (unvalidated memory writes), and data exfiltration (all three trifecta legs present). |

An AI agent is a system in which an LLM decides, step by step, which actions to take toward a goal, observes the results, and continues until done. A chatbot is a librarian at a desk; an agent is an assistant you send on errands.

### 51.1 The autonomy spectrum

```
LOW ─────────────────────────────────────────────────────────────────► HIGH
Chatbot     Workflow             Tool-using assistant   Agent              Background agent
answers     fixed code steps     model picks tools      loops to a goal    works for hours, reports back
```

Use workflows when steps are known and stable and predictability matters; agents when steps depend on discoveries. Choose the least autonomy that solves the problem.

### 51.2 Building blocks

Model, tools (Chapter 48), memory, planning, environment and harness (Chapter 50).

Reasoning patterns: ReAct alternates thought, action and observation (search restaurants, check preferences, confirm before booking). Plan-and-execute writes a plan first and re-plans when reality differs. Reflection and self-critique (evaluator-optimizer) works best with external signals such as tests and sources. Reasoning models think longer before acting, at token and latency cost.

Memory types:

| Type | Human analogy | Implementation |
| --- | --- | --- |
| Working | What you are thinking now | The context window |
| Episodic | "Last Tuesday X failed" | Logs and summaries of past sessions |
| Semantic | Facts you know | User preferences, docs, knowledge graphs |
| Procedural | Skills | Instruction files, skills, playbooks |

Decide what deserves writing, retrieve just in time, keep memories correctable with timestamps and user control, and validate writes, because memory is an injection surface (a web page planting "send refunds to account X").

Planning: decompose goals into verifiable steps, track progress visibly, checkpoint milestones, ask one sharp clarifying question when ambiguous, and define success criteria plus budgets upfront.

### 51.3 Multi-agent systems

| Architecture | How | Good for |
| --- | --- | --- |
| Single agent + tools | One agent | Most tasks: start here |
| Orchestrator-workers | Lead splits work; sub-agents run in parallel | Broad research, large codebases |
| Hierarchical | Managers of managers | Very large tasks, rarely needed |
| Handoffs | Specialized agents pass the conversation | Support with distinct domains |
| Debate / review | Agents critique each other | High-stakes outputs |

Gains: parallelism, focused contexts, specialization. Costs: far more tokens, coordination overhead, error propagation, harder debugging. Split only for independent sub-tasks. MCP connects agents to tools and data; protocols such as Google's Agent2Agent (A2A), introduced in 2025, aim to connect agents to other agents.

### 51.4 Agent types

Coding agents (repo context, sandboxing, verification); computer-use and browser agents (changing UIs, injection from pages, credential safety, isolated VMs); research agents (source quality, citation accuracy, cost); support agents (limits in code, identity, handoff); data-analysis agents (text-to-SQL safety); voice agents (latency, turn-taking); background agents (durable execution, async approvals, cost); workflow automation agents (permissions across systems, idempotency, audit).

### 51.5 Agents at scale

```
User task → Task API → queue → agent workers (autoscaled, durable workflow engine)
   → steps checkpointed; every side effect carries an idempotency key
   → risky step? pause → approval request (app, email, Slack) → resume or expire
   → progress events (Kafka) → notify when done
   → sandbox per task · delegated short-lived OAuth credentials · budgets · trajectory traces
```

Durable execution survives restarts; async design spares users 40-minute spinners; human-in-the-loop works while users are away; agents use delegated, scoped, short-lived credentials with attributable audit logs and are managed as non-human identities; sandboxes contain actions; budgets track cost per successful task; per-user and per-org concurrency limits ensure fairness; trajectories (thoughts, calls, results, decisions, cost) are logged for replay; evals check outcomes, trajectories and efficiency.

### 51.6 The lethal trifecta

Security researcher Simon Willison popularized the observation that an agent becomes dangerous when it combines access to private data, exposure to untrusted content, and the ability to communicate externally:

```
   Private data  +  Untrusted content  +  Outbound channel  =  exfiltration risk
   (inbox, files)    (web pages, emails)     (send email, web requests)
```

Break at least one leg: remove or allowlist outbound channels for agents that read untrusted content, keep private data away from web-browsing agents, require approval before outbound actions containing private data, restrict sandbox egress, and monitor data flows. An email assistant that reads the inbox, browses links and sends mail has all three; for example, require approval for every outgoing email or disable sending while untrusted links are being processed.

### 51.7 Example scenario: a deep research agent

```
Question → LEAD AGENT: clarify scope → plan sub-questions
   → parallel SUB-AGENTS (fresh context, search/fetch tools, budget)
        each returns compact summary + citations
   → lead checks gaps → follow-up searches → synthesize report
   → CITATION VERIFIER checks each claim against fetched text → deliver + notify
```

Decisions: orchestrator-workers for independent sub-questions; summaries keep the lead's context small; per-agent and total budgets; citation verification against hallucinated sources; source-quality rules; read-only web tools and no private data (breaking the trifecta); async notifications; durable checkpoints; evals on known questions.

### 51.8 Failure scenarios and fixes

| Scenario | Symptom | Fix |
| --- | --- | --- |
| Wrong interpretation | 20 steps on the wrong goal | Ask one clarifying question first |
| Stale plan | Agent follows a plan reality broke | Re-planning checkpoints |
| Memory poisoning | False "preference" planted by a page | Validate memory writes; user-visible memory |
| Sub-agent error contaminates report | Wrong fact in final output | Verification step; cross-checks |
| Crash at minute 38 | Restarts from scratch, repeats side effects | Durable execution, idempotency keys |
| Approval never answered | Task hangs | Expiry and safe default |
| Data exfiltration | Private data sent outward | Break the trifecta |
| Cost blowup | Thousands of calls | Budgets, loop detection, cheaper sub-models |

### 51.9 Building your first agent

Define the task and success; try a prompt or workflow first; design a few sharp tools or connect MCP servers; write the system prompt; wrap it in a harness; build 30-100 eval tasks including adversarial ones; iterate on trajectories; ship gradually while monitoring success, cost per task, escalations and safety incidents. Provider SDKs and frameworks (LangGraph, CrewAI, LlamaIndex) help, but understand the loop underneath.

### 51.10 Practitioner's guide

| Aspect | Details |
| --- | --- |
| Benefits | Handles open-ended multi-step work, adapts to discoveries, saves human time |
| Constraints | Cost per task, latency, non-determinism, security exposure |
| Trade-offs | Autonomy vs oversight; multi-agent parallelism vs token cost and coordination |
| Use agents when | Steps unknown in advance, tasks valuable enough to justify cost |
| Use workflows when | Known steps, high volume, strict predictability |
| Avoid | Agents with all three trifecta legs and no approvals |

```
Trifecta check per agent design
 private data?  [Y/N]   untrusted input?  [Y/N]   outbound channel?  [Y/N]
 all three Y → add approvals, egress allowlists, or remove one capability
```

### Review questions

1. An email agent reads your inbox, browses links and sends mail. Explain the risk with the lethal trifecta and one change that breaks it.

#### Answers

1. The agent has private data (the inbox), untrusted content (links and emails from strangers) and an outbound channel (sending email): a malicious email can instruct it to forward private messages to an attacker. Break one leg: require human approval for every outgoing email, or disable sending while the agent processes untrusted links, or restrict recipients to an allowlist.

## Chapter 52: Evaluation, Guardrails and Cost

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Prove an AI product is good, keep it safe, and keep it affordable at scale. |
| Why it is hard | Quality is fuzzy to measure, guardrails block legitimate users as well as attackers, and token costs grow quietly with every feature. |
| How we solve it | Layered evaluation (offline suites, CI gates, online monitoring), layered guardrails (input, model, actions in code, output, UX), and cost levers (caching, routing, trimming context), each checked against evals. |
| What fails, and why | Over-refusal of normal questions (untuned classifiers), policy-breaking actions (rules only in prompts), cost doubling overnight (prompt changes or looping agents without alerts), and silent quality loss (cost cuts without evals). |

Production AI must answer three questions: is it good (quality), can it be trusted (safety), and can we afford it at scale (cost)?

### 52.1 The evaluation stack

| Layer | Checks | Chapter |
| --- | --- | --- |
| Harness unit tests | Loop, permissions, errors via a scripted model | 50 |
| Offline suites | Golden sets, rubrics, LLM judges, statistics | 42 |
| RAG evals | Retrieval vs generation | 45 |
| Agent evals | Task success, trajectory safety, cost per task | 50 |
| Safety and red teaming | Jailbreaks, injections, harmful requests | here |
| CI gates | Block regressions | 30 |
| Online monitoring | Live quality, drift, feedback | here |

LLM observability captures per request the prompt and model versions, retrieved documents, tool calls with arguments and results, tokens, cost, TTFT and total latency, guardrail decisions and user feedback. Sample traces, score them with rubrics, and turn failures into tests. Watch rising refusals, falling faithfulness, longer answers and cost creep.

### 52.2 Guardrails in layers

```
User input
 → L1 INPUT: rate limits, abuse, injection/jailbreak detection, PII redaction, scope check
 → L2 MODEL: safety training, clear system prompt, grounding via RAG and tools
 → L3 ACTIONS: permissions, sandbox, approvals, limits IN CODE, identity from session
 → L4 OUTPUT: safety classifier, PII leakage, faithfulness, schema, policy compliance
 → L5 UX: citations, AI labels, confidence cues, human handoff, feedback buttons
```

| Technique | Speed | Good for |
| --- | --- | --- |
| Rules and regex | Fastest | Card numbers, banned phrases, lengths |
| Small classifiers | Fast | Toxicity, injection, topic |
| Moderation APIs | Fast | General harmful categories |
| LLM-as-judge | Slower | Nuanced policy, faithfulness |
| Code-enforced rules | Fastest | Money, permissions, data access |

Use deterministic code for anything that must hold and models for fuzzy judgments. A refund limit belongs in code because prompts can be misread, manipulated by injection or hallucinated around.

Trade-offs: latency (parallelize checks, fast classifiers first); false positives versus false negatives, where over-refusing "How do I kill a stuck process?" is a real quality failure measured with benign-but-scary test sets and fixed with context-aware thresholds and judge escalation; streaming versus output checks (check sentence chunks and stop streams on failure); and fail-open versus fail-closed when a guardrail service is down (closed for high-risk actions).

Red teaming attacks include direct jailbreaks and role-play, obfuscation in encodings or other languages, indirect injection in documents and tool results, many-shot long-context attacks, data extraction, tool abuse and over-refusal probes; each success becomes a regression test.

### 52.3 Responsible AI

Fairness via invariance tests and per-group quality; privacy through minimization, redaction, retention limits, consent and provider terms (India's DPDP Act applies); transparency (AI labels, sources); human oversight for high-stakes decisions; accountability through audit logs and AI incident postmortems; and awareness of evolving, often risk-based regulation, with legal teams involved early.

### 52.4 Cost

```latex
\text{cost} = \text{input tokens} \times p_{in} + \text{output tokens} \times p_{out} + \text{embeddings} + \text{reranking} + \text{tools} + \text{infra}
```

For agents, measure cost per successful task. Worked example with hypothetical prices ($3 per million input and $15 per million output tokens for a big model; a small model at one-fifth):

```
Baseline: 4,000 input (1,500 system + 2,000 RAG + 500 history) + 300 output
          = $0.012 + $0.0045 = $0.0165/call × 3 calls × 1M conversations ≈ $49,500/day
Optimized: cache 1,500-token prefix at ~10% → ~150; RAG 2,000 → 800; history 500 → 300;
           output 300 → 200 → big call ≈ $0.00375 + $0.003 = $0.00675
           70% routed to small model ($0.00135) → blended ≈ $0.00297
           20% semantic-cache hits → ≈ $0.00238/call ≈ $7,100/day (≈7x cheaper)
```

Real savings depend on traffic, prices and quality impact, so every optimization passes the eval suite. Governance: tag calls by team and feature, budgets and alerts, per-user token quotas, anomaly detection (prompt changes doubling context, looping agents, bot attacks), batch APIs, right-sized models, and self-hosting only at high steady volume.

| Lever | Quality | Cost | Latency |
| --- | --- | --- | --- |
| Bigger model | Up | Up | Up |
| Reasoning mode | Up on hard tasks | Up | Up |
| More RAG chunks | Up, then down | Up | Up |
| Reranking | Up | Down overall | Slightly up |
| Caching | Same | Down | Down |
| Small-model routing | Risk if misrouted | Down | Down |
| More guardrails | Safety up | Up | Up |
| Self-consistency voting | Up | ×N | Up |
| Streaming | Same | Same | Perceived down |

### 52.5 Production architecture

```
User → gateway (auth, quotas) → input guardrails → AGENT HARNESS
   ├─ router + semantic cache   ├─ RAG (permission-filtered)   ├─ knowledge graph
   ├─ tools / MCP (identity from session, limits in code)   └─ sandboxes
 → LLM gateway (providers + self-hosted, fallbacks, prompt caching, cost tags)
 → output guardrails → response with citations, AI label, handoff
 → observability → sampled evals → drift/cost alerts → new tests → CI gates
```

### 52.6 Failure scenarios and fixes

| Scenario | Fix |
| --- | --- |
| Over-refusal of benign questions | Measure false refusals; context-aware thresholds; judge escalation |
| Refund above policy despite prompt | Enforce limits in tool code |
| Cost doubled overnight | Cost anomaly alerts; check prompt diffs and loops |
| Semantic cache returns another user's answer | Never cache personalized answers; key by user scope |
| Guardrail service outage | Fail closed for actions, open with logging for chat |
| Streaming leaks unsafe text before check | Chunked output checks; stop stream on failure |

### 52.7 Practitioner's guide

| Aspect | Details |
| --- | --- |
| Benefits | Safer launches, controlled cost, measurable quality over time |
| Constraints | Guardrail latency, false positives, evaluation spend |
| Trade-offs | Strictness vs helpfulness; cost cuts vs quality |
| Strict guardrails when | Actions, money, minors, health, regulated domains |
| Lighter guardrails when | Internal tools, creative drafting |
| Avoid | Optimizing cost without an eval suite |

```
Weekly AI ops review: quality (faithfulness, task success) · safety (incidents, refusals,
false refusals) · cost (per task, per feature, anomalies) · latency (TTFT p95) → actions
```

### Review questions

1. Guardrails refuse "How do I kill a stuck order process?" What is the problem and how do you measure and fix it?
2. Why enforce "max ₹500 refund" in code rather than in the prompt?
3. Which two cost optimizations would you try first, and why must each pass the eval suite?

#### Answers

1. Over-refusal, a guardrail false positive. The user had a legitimate question, lost trust and likely escalated to a human. Measure false-refusal rates with a benign-but-scary test set alongside a harmful set; fix with tuned thresholds, context-aware classifiers and escalation of borderline cases to an LLM judge.
2. A prompt can be misread, manipulated by injection or hallucinated around; code is deterministic, testable and auditable, so `issue_refund` rejects anything above ₹500 whatever the model decides.
3. Prompt caching (no quality cost) and reranking to fewer chunks (cheaper and often better), then small-model routing. Each must pass evals because savings can silently lower quality: misrouted hard questions, a dropped chunk holding the answer, or a cache returning a stale or wrong answer.
