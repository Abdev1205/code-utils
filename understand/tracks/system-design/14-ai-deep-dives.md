# AI Deep Dives

**Topic:** System design
**Covers:** LoRA: Low-Rank Adaptation, in Depth; Training Parameters (Hyperparameters), in Depth; AI Researcher Interview Topics; AI Researcher Topics, Taught in Depth
**Source:** [Claude artifact](https://claude.ai/artifact/7xxGdVxPGbUiPY13z4MdZ2) — written by a colleague, mirrored here for study.

In-depth companions to Part VII of the main book. Each deep dive covers the problem, the mechanism with worked numbers, how to build and run it in production, failures and why they happen, and interview questions.

## LoRA: Low-Rank Adaptation, in Depth

LoRA fine-tunes a large model by freezing all its weights and training two small matrices beside selected layers; the product of those matrices is the learned change. It cuts trainable parameters by orders of magnitude, makes fine-tuning fit on one GPU, and lets one base model serve hundreds of customized behaviors.

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Adapt a pretrained LLM to a task, tone or format without the cost of updating billions of weights. |
| Why it is hard | Full fine-tuning needs gradients and optimizer state for every weight (about 16 bytes per parameter), a full copy of the model per task, and risks erasing general ability. |
| How LoRA solves it | Freeze the base; learn a low-rank update ΔW = B·A for chosen weight matrices; store and serve only the tiny A and B per task. |
| What fails, and why | Weak results (rank too low, wrong target layers, poor data), garbled outputs (chat template mismatch), lost general skills (overfitting), and slow serving (adapters not batched). |

### 1. The core idea

A weight matrix W (for example 4096 × 4096) maps an input vector x to Wx. Full fine-tuning learns a new W. The LoRA paper (Hu et al., 2021, Microsoft) observed that the useful change ΔW for a task has low intrinsic rank: it can be approximated by the product of two thin matrices.

```latex
h = W x + \frac{\alpha}{r} B A x, \qquad A \in \mathbb{R}^{r \times k},\; B \in \mathbb{R}^{d \times r},\; r \ll \min(d, k)
```

W stays frozen. Only A and B train. A starts with small random values and B starts at zero, so at step 0 the model behaves exactly like the base model. The scale α/r controls how strongly the update is applied.

> *Diagram in the original artifact: LoRA layer · frozen W plus trainable A and B*

Analogy: the base model is a printed textbook; LoRA is a pad of sticky notes on specific pages. The book never changes; you can swap note pads per class.

### 2. Worked numbers

```
One 4096 × 4096 matrix:        16,777,216 parameters (frozen)
LoRA at rank r = 8:            A = 8 × 4096 = 32,768;  B = 4096 × 8 = 32,768
Trainable:                     65,536 = 0.39% of that matrix

7B model, 32 layers, LoRA on q_proj and v_proj (both 4096 × 4096):
  per layer 2 × 65,536 = 131,072  →  × 32 layers ≈ 4.2M trainable (≈ 0.06% of 7B)
  adapter file in 16-bit ≈ 8.4 MB, versus ≈ 14 GB for the full model
```

Memory to train a 7B model (approximate):

| Method | Base weights | Gradients + optimizer | Fits on |
| --- | --- | --- | --- |
| Full fine-tune (mixed precision, Adam) | \~14 GB | \~98 GB more (≈16 bytes/param total) | Several 80 GB GPUs |
| LoRA (16-bit base) | \~14 GB | Small (adapters only) + activations | One 24-48 GB GPU |
| QLoRA (4-bit base) | \~4 GB | Small + activations | One 16-24 GB GPU |

The LoRA paper reported that for GPT-3 175B it reduced trainable parameters by about 10,000x and GPU memory by about 3x compared with full fine-tuning, with comparable quality on its benchmarks.

### 3. Design choices

| Choice | Common values | Effect | Guidance |
| --- | --- | --- | --- |
| Rank r | 4, 8, 16, 32, 64 | Capacity of the update | Start at 8-16; raise for harder tasks or more data |
| Alpha α | Often r or 2r | Strength of the update | Keep α/r fixed when changing r, or use rsLoRA scaling |
| Target modules | Attention q, k, v, o; MLP gate, up, down | Where the model can change | All linear layers usually beat attention-only, at more parameters |
| Dropout | 0-0.1 | Regularization | Higher for small datasets |
| Learning rate | \~1e-4 to 3e-4 | Speed vs stability | Higher than full fine-tuning; warmup and decay |
| Epochs | 1-3 | Fit vs overfit | Watch validation loss; stop early |

### 4. QLoRA and other variants

QLoRA (Dettmers et al., 2023) keeps the frozen base in 4-bit NF4 format, adds double quantization of the quantization constants and paged optimizers to survive memory spikes, and trains LoRA adapters in 16-bit on top. The paper fine-tuned a 65B model on a single 48 GB GPU. Trade-off: slower steps (weights are dequantized on the fly) and a small quality gap in some cases.

| Variant | What it changes | When useful |
| --- | --- | --- |
| QLoRA | 4-bit frozen base | Large models on small GPUs |
| DoRA | Splits weights into magnitude and direction; LoRA updates direction | Closer to full fine-tuning quality |
| LoRA+ | Higher learning rate for B than A | Faster, more stable training |
| rsLoRA | Scales by α/√r instead of α/r | Stable training at high ranks |
| AdaLoRA | Allocates rank where it matters during training | Fixed parameter budget |

### 5. Training pipeline, step by step

1. Define the behavior and build an evaluation set first (task metrics, regression set, safety set).
2. Measure the baseline: base model with a good prompt, and with RAG if knowledge is involved.
3. Collect high-quality examples (often 1,000-10,000); deduplicate; remove test overlap; balance cases.
4. Format with the exact chat template the serving engine will use; mask loss on user turns so only answers are learned.
5. Choose the base model (license, size, language coverage, context length).
6. Configure LoRA (rank, alpha, targets, dropout) and train with warmup, decay and gradient clipping.
7. Evaluate on task, regression and safety sets; compare with the baseline.
8. Deploy: merge into the base for a single-purpose model, or serve as a hot-swappable adapter.
9. Monitor quality in production; feed failures back into the dataset.

```python
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM

base = AutoModelForCausalLM.from_pretrained("base-7b", torch_dtype="bfloat16")
config = LoraConfig(
    r=16, lora_alpha=32, lora_dropout=0.05,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    task_type="CAUSAL_LM",
)
model = get_peft_model(base, config)
model.print_trainable_parameters()   # shows trainable vs total parameters
# train with your trainer of choice, then: model.save_pretrained("adapter-support-tone")
```

### 6. Serving LoRA in production

Two ways to deploy:

| Option | How | Best for | Cost |
| --- | --- | --- | --- |
| Merge | W' = W + (α/r)BA, saved as a normal model | One task, lowest latency | A full model copy per task |
| Hot-swap adapters | Base loaded once; adapters loaded per request | Many tenants or tasks | Small extra compute per request |

Multi-LoRA serving keeps one base model in GPU memory and batches requests that use different adapters together. Inference engines such as vLLM support this, and research systems such as S-LoRA showed thousands of adapters served from one base. Production design: an adapter registry (name, version, base model hash, eval scores), routing by tenant or task, an adapter cache in GPU memory with eviction, and per-adapter quality and latency metrics.

### 7. Failure scenarios

| Failure | Symptom | Why it happens | Fix |
| --- | --- | --- | --- |
| No improvement | Same as baseline | Rank too low, only attention targeted, too few or noisy examples | Better data first; target all linear layers; raise rank |
| Garbled or rambling output | Stray role names, never stops | Training and serving chat templates differ | One template everywhere; test on the serving engine |
| General ability drops | Off-task answers worse | Overfitting a narrow dataset | Fewer epochs, mixed general data, regression evals |
| Safety regression | More harmful completions | Training data weakened refusals | Safety evals as a release gate; include refusal examples |
| Loss spikes or NaN | Training diverges | Learning rate too high, fp16 overflow | Lower LR, BF16, gradient clipping |
| Adapter applied to wrong base | Nonsense outputs | Adapter trained on a different base version | Store base model hash with each adapter; refuse mismatches |
| Hallucinated facts | Confident wrong prices or policies | Knowledge pushed into weights | Use RAG for facts; LoRA for behavior |
| Slow multi-tenant serving | Latency grows with adapter count | Adapters swapped one at a time, not batched | Multi-LoRA batching, adapter cache |

### 8. Production incident walkthrough

| Time | Event | Why | Response |
| --- | --- | --- | --- |
| Day 0 | Base model upgraded from v1.0 to v1.1 for all tenants | Security patch | Routine deploy |
| Day 0 | 40 tenant adapters produce odd outputs | Adapters were trained on v1.0 weights | Rolled base back for adapter traffic |
| Day 1 | Adapters retrained on v1.1 using stored datasets | Datasets versioned with adapters | Evals run per adapter |
| Day 3 | Gradual rollout tenant by tenant | Canary per adapter | Back to normal |
| Postmortem | Registry did not enforce base compatibility | Missing check | Adapter registry stores base hash; deploys blocked on mismatch |

### 9. Worked use cases

| Use case | Why LoRA fits | Setup |
| --- | --- | --- |
| Support replies in brand tone and JSON format | Stable behavior, not facts | r=16 on all linear layers; 3,000 curated replies; RAG for policies |
| Ticket classification distilled from a large model | Cheap, fast small model | Big model labels 20,000 tickets; LoRA on a 3B model |
| Better Kannada and Hindi answers | Language style and fluency | Bilingual instruction data; QLoRA on a multilingual base |
| Per-customer assistants in a SaaS product | One base, many tenants | One adapter per customer, multi-LoRA serving |

### 10. When to use LoRA, and when not

| Use LoRA when | Avoid LoRA when |
| --- | --- |
| You need consistent format, tone or task behavior | You need fresh or changing facts (use RAG) |
| Prompting is too long, slow or inconsistent | A good prompt already meets the target |
| You want a smaller, cheaper model to match a larger one | You have only a few dozen examples |
| Many tenants need custom behavior on one base | The task needs a totally new capability or language the base lacks (more data or continued pretraining) |

### 11. Interview questions

1. Why initialize B to zero? So the adapted model starts identical to the base model, and training begins from known behavior.
2. What does rank control? The capacity of the update; low rank is cheaper and regularizes, higher rank can fit more complex changes.
3. Merge or hot-swap? Merge for one high-traffic task at minimum latency; hot-swap when many tasks or tenants share one base.
4. How does QLoRA fit a 65B model on one 48 GB GPU? The frozen base sits in 4-bit NF4 (about a quarter of 16-bit size), only small adapters train in 16-bit, and paged optimizers absorb memory spikes.
5. A LoRA model is worse than prompting. What do you check? Data quality and template consistency, target modules and rank, overfitting on validation, and whether the task actually needs knowledge (RAG) rather than behavior.

## Training Parameters (Hyperparameters), in Depth

Training parameters are the settings you choose before training (learning rate, batch size, epochs and so on); the model's weights are what training learns. Most failed fine-tunes come from data problems first and from three settings second: learning rate, effective batch size and number of epochs.

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Pick settings that make the model learn the task quickly and stably without overfitting or running out of memory. |
| Why it is hard | Settings interact (batch size and learning rate, epochs and dataset size), runs are expensive, and bad settings often fail silently. |
| How we solve it | Start from proven defaults, compute steps and tokens explicitly, change one thing at a time, and judge by validation loss plus task evaluations. |
| What fails, and why | Divergence (learning rate too high), no learning (too low or wrong data masking), overfitting (too many epochs), and out-of-memory (batch or sequence too large). |

### 1. Parameters versus training parameters

| Term | Meaning | Example |
| --- | --- | --- |
| Model parameters (weights) | Numbers the model learns | 7 billion weights in a 7B model |
| Trainable parameters | Weights actually updated in this run | \~4-40M LoRA weights while 7B stay frozen |
| Hyperparameters (training parameters) | Settings you choose | Learning rate 2e-4, 3 epochs, batch 16 |

### 2. The core training parameters

| Parameter | What it controls | Pretraining (typical) | Full fine-tune | LoRA / QLoRA |
| --- | --- | --- | --- | --- |
| Learning rate (peak) | Size of each update | \~1e-4 to 6e-4, lower for bigger models | 1e-5 to 5e-5 | 1e-4 to 3e-4 |
| LR schedule | How the rate changes over time | Warmup, then cosine decay | Warmup + linear or cosine | Warmup + cosine or constant |
| Warmup | Gentle start | Hundreds to thousands of steps | 3-10% of steps | 3-10% of steps |
| Effective batch size | Examples (or tokens) per update | Millions of tokens | 16-128 sequences | 8-64 sequences |
| Epochs | Passes over the data | \~1 (data is huge) | 1-3 | 1-3 |
| Max sequence length | Tokens per example | 2K-8K+ | Fit your longest real example | Same |
| Optimizer | Update rule | AdamW, betas \~(0.9, 0.95) | AdamW | AdamW (paged 8-bit for QLoRA) |
| Weight decay | Pull weights toward zero | \~0.1 | 0-0.1 | 0-0.01 |
| Gradient clipping | Cap on update size | 1.0 | 1.0 | 0.3-1.0 |
| Precision | Number format | BF16 mixed precision | BF16 | BF16 adapters; 4-bit base in QLoRA |
| Dropout | Random zeroing to regularize | Often 0 | 0-0.1 | LoRA dropout 0-0.1 |
| Seed | Randomness | Fixed and logged | Fixed | Fixed |

LoRA-specific settings (rank, alpha, target modules) are covered in the LoRA section above.

### 3. The arithmetic you should always do

```latex
\text{effective batch} = \text{per-device batch} \times \text{gradient accumulation steps} \times \text{number of GPUs}
```

```latex
\text{steps per epoch} \approx \frac{\text{training tokens}}{\text{effective batch} \times \text{tokens per sequence}}
```

Worked example: 5,000 support conversations averaging 600 tokens = 3M tokens. With 1 GPU, per-device batch 4 and gradient accumulation 4, the effective batch is 16 sequences. Packing examples into 1,024-token sequences gives about 16,000 tokens per step, so about 188 steps per epoch, about 563 steps for 3 epochs, and about 28 warmup steps at 5%.

Why it matters: with too few steps, warmup and decay never behave as intended; with a tiny dataset and many epochs the model memorizes. Always know your step count before launching.

### 4. How the settings interact

| Interaction | What happens | Rule of thumb |
| --- | --- | --- |
| Batch size ↑ | Smoother gradients, fewer steps per epoch | Raise learning rate somewhat, or keep steps sufficient |
| Learning rate ↑ | Faster learning, less stability | Pair with warmup and clipping |
| Epochs ↑ on small data | Memorization, worse generalization | Stop at the best validation checkpoint |
| Sequence length ↑ | More memory and time per step | Use packing; gradient checkpointing for memory |
| LoRA rank ↑ | More capacity, more parameters | Keep alpha/rank ratio fixed when changing rank |
| Gradient accumulation ↑ | Larger effective batch without more memory | Slower wall-clock per update |

Learning-rate schedule with warmup then cosine decay:

```latex
\eta_t = \begin{cases} \eta_{max} \cdot \frac{t}{T_{warm}} & t < T_{warm} \\ \eta_{min} + \frac{1}{2}(\eta_{max} - \eta_{min})\left(1 + \cos\left(\pi \frac{t - T_{warm}}{T - T_{warm}}\right)\right) & t \ge T_{warm} \end{cases}
```

### 5. Memory: what each setting costs

| Setting | Memory effect | Lever when out of memory |
| --- | --- | --- |
| Per-device batch size | Activations grow linearly | Lower it; raise gradient accumulation |
| Sequence length | Activations grow with length (attention more) | Shorten, pack, or use FlashAttention |
| Precision | 16-bit halves weights vs 32-bit | BF16; 4-bit base with QLoRA |
| Optimizer | Adam keeps two extra values per trained weight | Train fewer weights (LoRA); 8-bit or paged optimizers |
| Gradient checkpointing | Recomputes activations instead of storing them | Turn on: \~30% slower, much less memory |
| Model sharding | Splits weights and states across GPUs | FSDP or ZeRO for full fine-tuning |

### 6. Reading the loss curves

| Pattern | Meaning | Action |
| --- | --- | --- |
| Train and validation fall together, then flatten | Healthy | Stop near the flat point |
| Train falls, validation rises | Overfitting | Fewer epochs, more data, more dropout, lower rank |
| Loss spikes then recovers | Bad batch or learning rate near the edge | Clip gradients, lower LR, inspect data |
| Loss becomes NaN | Divergence or numeric overflow | Lower LR, BF16 instead of FP16, clip |
| Loss barely moves | Learning rate too low, labels masked wrongly, frozen everything | Check trainable count, loss mask, raise LR |
| Loss very low immediately | Leakage or answers inside prompts | Check data formatting and duplicates |

Loss alone is not quality: always run the task evaluation, a regression set and a safety set on checkpoints.

### 7. A tuning order that saves money

1. Fix the data and the chat template; run a tiny overfit test on 50 examples (loss should go near zero) to prove the pipeline works.
2. Use defaults: LoRA r=16, alpha=32, all linear layers, LR 2e-4, effective batch 16-32, 2-3 epochs, warmup 3-5%, cosine schedule, BF16, clipping 1.0.
3. Sweep learning rate first (for example 5e-5, 1e-4, 2e-4, 3e-4) on a short run.
4. Then choose epochs by the validation curve.
5. Then rank and target modules if quality is still short.
6. Change one thing at a time and log every run.

### 8. Example configurations

| Scenario | Key settings |
| --- | --- |
| 7B support-tone LoRA, 1 × 24 GB GPU | r=16, alpha=32, all linear, LR 2e-4, per-device 4, accum 4, 3 epochs, seq 1024 packed, BF16, gradient checkpointing |
| 70B QLoRA, 1 × 80 GB GPU | 4-bit NF4 base, r=16-64, LR 1e-4, per-device 1-2, accum 16, 1-2 epochs, paged 8-bit AdamW |
| Full fine-tune of a 1-3B model, 4 GPUs | LR 2e-5, effective batch 64, 2 epochs, warmup 5%, weight decay 0.01, FSDP |
| Classifier distilled from a big model | LoRA r=8, LR 3e-4, 1-2 epochs, short sequences, class-balanced data |

```python
from transformers import TrainingArguments

args = TrainingArguments(
    output_dir="runs/support-tone-r16",
    learning_rate=2e-4,                  # peak LR for LoRA
    lr_scheduler_type="cosine",
    warmup_ratio=0.05,                   # 5% of steps
    per_device_train_batch_size=4,
    gradient_accumulation_steps=4,       # effective batch 16 on one GPU
    num_train_epochs=3,
    weight_decay=0.0,
    max_grad_norm=1.0,                   # gradient clipping
    bf16=True,
    gradient_checkpointing=True,         # trade compute for memory
    eval_strategy="steps", eval_steps=50,
    save_strategy="steps", save_steps=50,
    load_best_model_at_end=True,         # keep the best validation checkpoint
    logging_steps=10,
    seed=42,
)
```

### 9. Failure scenarios

| Failure | Symptom | Why it happens | Fix |
| --- | --- | --- | --- |
| Divergence | Loss spikes to NaN | LR too high, FP16 overflow, no clipping | Lower LR, BF16, clip at 1.0, longer warmup |
| Nothing learned | Outputs identical to base | LR too low, loss masked on everything, adapters not attached | Check trainable parameter count and loss mask; raise LR |
| Overfitting | Validation worse after epoch 1 | Too many epochs on small data | Early stopping, fewer epochs, more data |
| Out of memory | Crash at first step | Batch or sequence too large | Lower per-device batch, raise accumulation, checkpointing |
| Results not reproducible | Two runs differ a lot | Unlogged seeds, data order, library versions | Fix seeds; version data, code and config |
| Wasted compute | Warmup longer than the run | Step count never computed | Compute steps before launch |
| Silent regression | Task better, general answers worse | Narrow data, too strong updates | Regression evals; lower LR or rank; mix general data |

### 10. Production practices

Treat every training run like a release: store the config, data version, code commit, base model hash and seed with the resulting checkpoint; track runs in an experiment tracker; promote only checkpoints that pass task, regression and safety evaluations; and keep the previous model ready for rollback.

### 11. Interview questions

1. Why is the LoRA learning rate higher than full fine-tuning? Far fewer weights are updated and B starts at zero, so larger steps are needed and remain stable.
2. What is gradient accumulation? Summing gradients over several small batches before one update, to get a large effective batch on limited memory.
3. How do you choose epochs? From the validation curve and task evals: stop where validation stops improving.
4. Why warm up the learning rate? Early gradients are noisy; a gradual start avoids destabilizing updates.
5. Your 7B fine-tune runs out of memory. Name four fixes. Smaller per-device batch with accumulation, gradient checkpointing, shorter or packed sequences, and LoRA or QLoRA instead of full fine-tuning.

## AI Researcher Interview Topics

AI research interviews test whether you can produce reliable new knowledge: deep fundamentals, the ability to implement models from scratch, rigorous experiment design, and research taste (choosing questions that matter). Breadth across the field plus real depth in one area is the usual bar.

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Show you can ask good questions, run trustworthy experiments, and turn results into correct claims that move a team forward. |
| Why it is hard | The field moves monthly, results are noisy and seed-dependent, compute is scarce, and impressive-looking findings are often artifacts. |
| How to prepare | Master fundamentals and transformer internals, implement core pieces from scratch, practice experiment design and paper critique, and prepare a crisp talk on your own work. |
| What fails, and why | Shallow answers (memorized buzzwords), unconvincing experiments (no baselines, seeds or ablations), weak coding (cannot implement attention or a training loop), and unclear communication of past work. |

### 1. Roles

| Role | Focus | Emphasis in interviews |
| --- | --- | --- |
| Research scientist | New methods and understanding | Research taste, depth, publications or equivalent work |
| Research engineer | Making research run at scale | Strong engineering, distributed training, debugging, experiment infrastructure |
| Areas | Pretraining, post-training and RL, interpretability, alignment and safety, evaluation, efficiency, multimodal | Depth in your chosen area |

### 2. The usual interview loop

Loops vary by lab; these rounds are common.

| Round | What it tests | Example prompt |
| --- | --- | --- |
| Research talk or past-work deep dive | Ownership, rigor, communication | "Walk us through your best project and what you would do differently" |
| ML fundamentals | Math and deep-learning depth | "Derive the gradient of softmax cross-entropy" |
| ML coding | Implementing from scratch | "Implement multi-head causal self-attention and a training loop" |
| Experiment design | Rigor and judgment | "Does this new optimizer actually help? Design the study" |
| Paper discussion | Critical reading | "What are the weaknesses of this paper's evaluation?" |
| Research direction or taste | Choosing what matters | "What would you work on for the next year, and why?" |
| Behavioral and collaboration | Working in teams, handling failure | "Tell me about a result that turned out to be wrong" |

### 3. Topic map

| Area | What gets probed | Sample question | Strong answer covers |
| --- | --- | --- | --- |
| Math foundations | Linear algebra, probability, calculus, information theory | Why is cross-entropy the right loss for next-token prediction? | Maximum likelihood, KL divergence to the data distribution |
| Optimization | SGD, Adam/AdamW, schedules, normalization, initialization | Why does AdamW decouple weight decay? | Adam's adaptive scaling distorts L2 penalty; decoupled decay acts as true regularization |
| Transformers | Attention, positions (RoPE), normalization, residuals, KV cache | Why scale dot products by √d? | Keep softmax inputs from growing with dimension, avoiding saturated gradients |
| Scaling laws | Loss vs parameters, data, compute; compute-optimal training | How would you size a model for a fixed compute budget? | Chinchilla-style balance (\~20 tokens per parameter) adjusted for inference cost |
| Training dynamics | Loss spikes, instabilities, mixed precision | A run spikes at step 40K. Debug it. | Data batch, LR, gradient norms, numerics, logits growth; rollback and fixes |
| Post-training | SFT, RLHF, DPO, reward models, RL for reasoning | Compare RLHF and DPO | Reward model + RL vs direct preference loss; stability, cost, reward hacking risk |
| Evaluation | Benchmarks, contamination, statistics, LLM judges | Model A beats B by 1.5 points. Is it real? | Variance across seeds and samples, confidence intervals, contamination checks |
| Interpretability | Probing, attribution, sparse autoencoders, circuits, superposition | What problem do sparse autoencoders solve? | Neurons are polysemantic; SAEs find sparser, more interpretable features |
| Alignment and safety | Reward hacking, specification gaming, red teaming, oversight | Give an example of reward hacking and a mitigation | Model exploits flaws in the reward; better rewards, held-out checks, process supervision |
| Efficiency | Quantization, distillation, MoE, FlashAttention, speculative decoding | Why does FlashAttention speed things up? | Fewer slow memory reads by tiling in on-chip SRAM |
| Data | Deduplication, quality filtering, mixtures, synthetic data | How does deduplication change results? | Less memorization, better generalization, fairer evaluation |
| RL basics | Policy gradients, advantage, PPO, KL penalties | Why add a KL penalty in RLHF? | Keep the policy close to the reference model; limit reward hacking and drift |
| Generalization | Overfitting, double descent, in-context learning | Why do huge models not simply memorize? | Implicit regularization, data scale, inductive biases; still memorize rare items |
| Multimodal | Vision encoders, contrastive learning, tokenizing images and audio | How does CLIP-style training work? | Contrastive loss aligning paired image and text embeddings |

### 4. Experiment design: worked case

**Problem statement.** A teammate claims a new optimizer improves final loss by 2% on a 1B-parameter model.

**Why it is hard.** Single runs vary with seed and data order; the baseline may be under-tuned; improvements at small scale may vanish at large scale; and the metric may not reflect downstream quality.

**How to design the study.**

1. State the hypothesis and the decision it informs ("adopt for the next 7B run").
2. Tune both optimizers fairly with the same budget for learning-rate sweeps.
3. Run several seeds for each and report means with confidence intervals.
4. Test at two or three scales to see whether the gap holds or shrinks.
5. Measure downstream evaluations, not only loss; check wall-clock and memory cost.
6. Ablate the new optimizer's components to find what actually helps.
7. Pre-register what result would count as success to avoid moving the goalposts.

| Failure in the study | Why it happens | Fix |
| --- | --- | --- |
| Baseline under-tuned | More effort spent on the new method | Equal tuning budget for both |
| Seed noise mistaken for gains | One run each | Multiple seeds, intervals |
| Doesn't transfer to scale | Small-scale artifact | Scaling sweep |
| Benchmark contamination | Test data in training corpus | Decontamination, held-out evals |
| Cherry-picked checkpoints | Choosing the best of many | Fixed evaluation protocol |

### 5. The research loop

> *Diagram in the original artifact: The research loop · six stages with the revise-or-kill path*

### 6. Why research projects fail

| Failure | Why it happens | Fix |
| --- | --- | --- |
| Months on an unimportant question | No check on whether the answer changes anything | Ask what decision or belief the result would change |
| Results do not reproduce | Unlogged configs, seeds, data versions | Version everything; rerun before claiming |
| Bugs mistaken for discoveries | Surprising results not double-checked | Sanity checks, simple baselines, independent reimplementation |
| Slow iteration | Every experiment at full scale | Small proxies first, scale only promising ideas |
| Overclaiming | Narrative ahead of evidence | Claims limited to what the data shows; state limitations |
| Lost in infrastructure | Tooling consumes the project | Reuse shared infra; ask research engineers early |

### 7. ML coding round

Be ready to implement, without libraries doing the core work: scaled dot-product and multi-head causal attention; a transformer block with residuals and normalization; a training loop with AdamW, warmup and gradient clipping; cross-entropy with label masking; top-k and temperature sampling; a KV cache for generation; LoRA layers; a simple tokenizer such as BPE merges; and evaluation code computing accuracy with confidence intervals. The companion `mini_gpt.py` from Chapter 41 covers most of these.

### 8. Research talk and paper critique

Talk structure: the problem and why it matters; what was known; your key idea in one sentence; the most convincing experiment; ablations and failure cases; what you would do next. Expect deep questions on any number you show.

Paper critique checklist:

1. What exactly is claimed, and does the evidence support that claim and nothing more?
2. Are baselines strong and fairly tuned?
3. Are there enough seeds, confidence intervals and ablations?
4. Could the gains come from more compute, data or tuning rather than the idea?
5. Is the evaluation contaminated, saturated or a poor proxy?
6. Would it hold at larger scale or in other settings?

### 9. Foundational reading list

Cited from memory; titles and years are well known but check details before quoting them.

| Paper | Year | Why it matters |
| --- | --- | --- |
| Attention Is All You Need (Vaswani et al.) | 2017 | The Transformer |
| Adam: A Method for Stochastic Optimization (Kingma and Ba) | 2014 | Default optimizer family |
| Scaling Laws for Neural Language Models (Kaplan et al.) | 2020 | Power-law scaling of loss |
| Training Compute-Optimal Large Language Models (Hoffmann et al., "Chinchilla") | 2022 | Balance of parameters and tokens |
| Training language models to follow instructions with human feedback (Ouyang et al.) | 2022 | RLHF for instruction following |
| Constitutional AI (Bai et al.) | 2022 | AI feedback guided by principles |
| Direct Preference Optimization (Rafailov et al.) | 2023 | Preference tuning without an RL loop |
| LoRA (Hu et al.) | 2021 | Parameter-efficient fine-tuning |
| FlashAttention (Dao et al.) | 2022 | IO-aware exact attention |
| Chain-of-Thought Prompting (Wei et al.) | 2022 | Reasoning via intermediate steps |
| Toy Models of Superposition (Elhage et al.) | 2022 | How networks pack many features into few neurons |
| Towards Monosemanticity (Bricken et al.) | 2023 | Sparse autoencoders for interpretable features |

### 10. Preparation checklist

- Derive backpropagation through softmax, attention and layer normalization by hand
- Implement a small GPT, a training loop and a KV cache from scratch
- Explain scaling laws and compute-optimal sizing with numbers
- Compare SFT, RLHF and DPO, and explain reward hacking
- Design three experiments with baselines, seeds and ablations
- Critique three recent papers in your area in writing
- Prepare a 20-minute talk on your best work and rehearse hard questions
- Write a one-page research agenda for the next year

### Review questions

1. Your new method beats the baseline by 1 point on one seed. What do you do before claiming a result?
2. Why might a result found at 100M parameters disappear at 10B?
3. How would you detect benchmark contamination?

#### Answers

1. Tune the baseline equally, run several seeds for both, compute confidence intervals, add ablations, and check downstream evaluations; claim only what survives.
2. Larger models may already learn what the method provides, optimization dynamics change with scale, and small-scale noise can mimic gains; test across a scaling sweep.
3. Search the training corpus for test items or near-duplicates (n-gram overlap), compare performance on original vs freshly written equivalent questions, and keep private held-out sets.

## AI Researcher Topics, Taught in Depth

Fourteen lessons, one per topic area from the interview topic map above. Each lesson gives the intuition, the key math, worked numeric examples, code where useful, common mistakes, and interview questions with answers.

### Lesson 1: Math Foundations

Four areas of math explain almost everything a model does: linear algebra (how data flows), probability (what outputs mean), calculus (how learning happens) and information theory (what the loss measures).

#### 1.1 Linear algebra

A token becomes a vector (a list of numbers). A layer is a matrix that transforms vectors. The dot product measures alignment between two vectors.

Example: a = \[1, 2, 3\], b = \[4, 5, 6\]. Dot product = 1×4 + 2×5 + 3×6 = 32. Lengths: |a| = √14 ≈ 3.74, |b| = √77 ≈ 8.77. Cosine similarity = 32 ÷ (3.74 × 8.77) ≈ 0.97: they point almost the same way. Attention scores and embedding search are dot products.

Shapes in a transformer: activations are (batch × sequence × d\_model), for example (8 × 1,024 × 4,096). Multiplying by a 4,096 × 4,096 weight keeps the shape; the query-key product gives (sequence × sequence) attention scores per head.

Rank: the number of independent directions a matrix uses. A 4,096 × 4,096 matrix can have rank up to 4,096; LoRA assumes the useful change has rank around 8-64. The singular value decomposition (SVD) writes any matrix as a sum of rank-1 pieces ordered by importance, which is why low-rank approximations work.

#### 1.2 Probability

A language model outputs a probability distribution over the next token. Raw scores (logits) become probabilities with softmax:

```latex
p_i = \frac{e^{z_i}}{\sum_j e^{z_j}}
```

Example: logits \[2, 1, 0\]. Exponentials: 7.389, 2.718, 1.000; sum 11.107. Probabilities: 0.665, 0.245, 0.090. Temperature divides logits before softmax: at T = 2, logits \[1, 0.5, 0\] give 0.506, 0.307, 0.186 (flatter, more random); at T = 0.5, logits \[4, 2, 0\] give 0.867, 0.117, 0.016 (sharper).

Maximum likelihood: training picks weights that make the observed text most probable. Expectation and variance appear everywhere: initialization keeps activation variance stable; evaluation reports mean and variance across seeds.

#### 1.3 Calculus

Learning is following gradients downhill. The chain rule passes gradients backward through layers (backpropagation). For softmax followed by cross-entropy, the gradient with respect to the logits is beautifully simple:

```latex
\frac{\partial L}{\partial z_i} = p_i - y_i
```

Example: probabilities \[0.665, 0.245, 0.090\], correct token is class 0, so y = \[1, 0, 0\]. Gradient = \[−0.335, 0.245, 0.090\]: push the correct logit up, the others down, in proportion to their probability.

#### 1.4 Information theory

Entropy measures uncertainty; cross-entropy measures how surprised the model is by the true answer; KL divergence measures the gap between two distributions.

```latex
H(p, q) = -\sum_x p(x) \log q(x), \qquad \mathrm{KL}(p \Vert q) = \sum_x p(x) \log \frac{p(x)}{q(x)}
```

Example: the model gives the correct token probability 0.665, so the loss is −ln 0.665 ≈ 0.408 nats. Perplexity = e^loss: a loss of 2.0 means perplexity ≈ 7.4, as if choosing among about 7 equally likely tokens. Minimizing cross-entropy equals minimizing KL from the data distribution to the model, because the data's own entropy is a constant.

#### 1.5 Code: stable softmax and cross-entropy

```python
import numpy as np

def softmax(z):
    z = z - z.max()              # subtract max: avoids overflow, same result
    e = np.exp(z)
    return e / e.sum()

def cross_entropy(z, target):
    z = z - z.max()
    log_probs = z - np.log(np.exp(z).sum())   # log-softmax via log-sum-exp
    return -log_probs[target]

z = np.array([2.0, 1.0, 0.0])
print(softmax(z))            # [0.665 0.245 0.090]
print(cross_entropy(z, 0))   # 0.408
```

#### 1.6 Common mistakes

| Mistake | Why it happens | Fix |
| --- | --- | --- |
| Softmax overflow (inf or NaN) | exp of large logits | Subtract the max logit first |
| log(0) in the loss | Probability rounded to zero | Compute log-softmax directly |
| Shape bugs | Mixing (batch, seq) and (seq, batch) | Assert shapes at every layer |
| Confusing nats and bits | Natural log vs log base 2 | Loss in bits = nats ÷ ln 2 |

#### 1.7 Interview questions

1. Why use cross-entropy instead of mean squared error for classification? It is the maximum-likelihood loss for categorical outputs and gives the clean gradient p − y; MSE on probabilities gives weak gradients when the model is confidently wrong.
2. What is perplexity of a loss of 1.5 nats? e^1.5 ≈ 4.48.
3. Why can attention scores be computed as one matrix product? Every query dotted with every key is exactly Q times K transposed.

### Lesson 2: Optimization

Optimization is how a model turns gradients into better weights. The choices (optimizer, learning rate schedule, normalization, initialization) decide whether training is fast, stable, or diverges.

#### 2.1 Gradient descent by hand

Minimize f(w) = (w − 3)². The gradient is 2(w − 3). Update rule: w ← w − η × gradient.

| Step | w | Gradient | New w (η = 0.1) |
| --- | --- | --- | --- |
| 0 | 0.000 | −6.000 | 0.600 |
| 1 | 0.600 | −4.800 | 1.080 |
| 2 | 1.080 | −3.840 | 1.464 |
| ... | approaches 3 | shrinks | converges |

With η = 1.1 the update overshoots: w goes 0 → 6.6 → −1.32 → 8.18, swinging further from 3 each time. That is divergence, the same thing that happens when a learning rate is too high.

Stochastic gradient descent (SGD) uses gradients from small batches, which are noisy but cheap; the noise also helps escape poor regions.

#### 2.2 Momentum

Momentum keeps a running velocity so updates continue in consistent directions and cancel out in zig-zag directions: v ← βv + g; w ← w − ηv, with β ≈ 0.9. Like a ball rolling downhill, it speeds through flat valleys.

#### 2.3 Adam and AdamW

Adam tracks a running mean of gradients (m) and of squared gradients (v), and divides by √v, giving each weight its own effective step size.

```latex
m_t = \beta_1 m_{t-1} + (1-\beta_1) g_t, \quad v_t = \beta_2 v_{t-1} + (1-\beta_2) g_t^2, \quad \hat m_t = \frac{m_t}{1-\beta_1^t}, \quad \hat v_t = \frac{v_t}{1-\beta_2^t}, \quad w \leftarrow w - \eta \frac{\hat m_t}{\sqrt{\hat v_t} + \epsilon}
```

Worked first step: gradient g = 0.5, β1 = 0.9, β2 = 0.999. m = 0.05, v = 0.00025. Bias correction: m̂ = 0.05 ÷ 0.1 = 0.5; v̂ = 0.00025 ÷ 0.001 = 0.25; √v̂ = 0.5. Update = η × 0.5 ÷ 0.5 = η. Early Adam steps are about η × sign(gradient), regardless of gradient size, which is why warmup matters.

AdamW applies weight decay separately (w ← w − ηλw) instead of adding it to the gradient, so decay is not distorted by Adam's per-weight scaling. It is the default for transformers.

```python
import numpy as np

def adamw_step(w, g, m, v, t, lr=1e-3, b1=0.9, b2=0.999, eps=1e-8, wd=0.01):
    m = b1 * m + (1 - b1) * g
    v = b2 * v + (1 - b2) * g * g
    m_hat = m / (1 - b1 ** t)
    v_hat = v / (1 - b2 ** t)
    w = w - lr * (m_hat / (np.sqrt(v_hat) + eps) + wd * w)   # decoupled decay
    return w, m, v
```

Memory cost: Adam stores m and v for every trained weight, two extra numbers each, which is why full fine-tuning needs so much memory and LoRA helps.

#### 2.4 Learning-rate schedules

Warmup increases the rate from near zero over the first steps, because early gradients are large and unreliable. Cosine decay then lowers it smoothly toward a small final value, letting the model settle into a good minimum. Constant rates often end with a noisier final loss.

#### 2.5 Normalization

LayerNorm rescales each token's activations to zero mean and unit variance, then applies learned scale and shift. RMSNorm skips the mean subtraction and is cheaper; many modern LLMs use it. Pre-norm (normalize before each sublayer, add the residual after) trains more stably in deep models than post-norm, because the residual path stays clean.

#### 2.6 Initialization

Weights start random with a variance chosen to keep activations from shrinking or exploding layer after layer (Xavier for tanh-like activations, He for ReLU-like). Example: a layer with 4,096 inputs and He initialization uses standard deviation √(2/4,096) ≈ 0.022. Deep transformers also scale down residual-branch outputs so many added layers do not blow up the residual stream.

#### 2.7 Gradient clipping

If the total gradient norm exceeds a threshold (often 1.0), the whole gradient is scaled down to that norm. It prevents a single bad batch from throwing the weights far away.

#### 2.8 Common mistakes

| Mistake | Symptom | Fix |
| --- | --- | --- |
| Learning rate too high | Loss spikes, NaN | Lower LR; add warmup and clipping |
| No warmup with Adam | Early instability | Warmup 1-10% of steps |
| Weight decay on norms and biases | Slightly worse results | Exclude them from decay |
| Comparing optimizers with unequal tuning | Misleading conclusions | Same tuning budget for each |

#### 2.9 Interview questions

1. Why does Adam need bias correction? m and v start at zero, so early averages are biased toward zero; dividing by 1 − β^t removes that bias.
2. Why is AdamW preferred to Adam with L2 regularization? With Adam, L2 penalties are rescaled per weight and stop acting like true decay; AdamW decouples them.
3. Why do large-batch runs often use larger learning rates? Larger batches give less noisy gradients, so bigger steps stay stable, up to a limit.

### Lesson 3: Transformers in Depth

A decoder-only transformer turns tokens into vectors, lets every token gather information from earlier tokens (attention), transforms each token independently (feed-forward), repeats this in many layers, and finally predicts the next token.

#### 3.1 The pipeline

1. Tokenize text into IDs.
2. Look up an embedding vector per token (d\_model numbers, for example 4,096).
3. For each of L layers: normalize → self-attention → add back (residual) → normalize → feed-forward → add back.
4. Final normalization, multiply by the output matrix to get one logit per vocabulary token, softmax, sample.

#### 3.2 Attention, worked by hand

Each token produces a query (what it looks for), a key (what it offers) and a value (what it passes on).

```latex
\mathrm{Attention}(Q, K, V) = \mathrm{softmax}\left(\frac{Q K^\top}{\sqrt{d_k}} + M\right) V
```

Example with d\_k = 2. The token "it" has query \[1, 0\]. Earlier tokens: "cat" with key \[1, 0\] and value \[10, 0\]; "mat" with key \[0, 1\] and value \[0, 10\].

| Step | cat | mat |
| --- | --- | --- |
| Dot product q·k | 1 | 0 |
| Divide by √2 | 0.707 | 0 |
| Softmax | 0.67 | 0.33 |
| Weighted value | 0.67 × \[10, 0\] | 0.33 × \[0, 10\] |

Output for "it" = \[6.7, 3.3\]: mostly information from "cat". The √d\_k scaling keeps scores from growing with dimension; without it, softmax saturates and gradients vanish.

The causal mask M sets scores for future tokens to −∞, so they get zero weight: a token can only use the past, which is what makes next-token training valid.

#### 3.3 Multi-head attention

Instead of one attention with d = 4,096, use 32 heads of 128 dimensions each. Each head learns a different relationship (syntax, coreference, position), then their outputs are concatenated and mixed by an output matrix. Grouped-query attention (GQA) lets several query heads share one key-value head, shrinking the KV cache several-fold.

#### 3.4 Positions: RoPE

Attention alone ignores order. Rotary position embeddings rotate query and key vectors by an angle proportional to the token's position, so their dot product depends on the relative distance between tokens. This generalizes better to new positions than learned absolute positions, and is widely used in open models.

#### 3.5 Feed-forward layers

Each token passes through a two-layer network, usually 4x wider in the middle (or SwiGLU, a gated variant). These layers hold much of the model's stored knowledge and make up about two-thirds of its parameters.

#### 3.6 Residual stream and normalization

Each sublayer adds its output to a running vector (the residual stream). Information flows straight through, gradients reach early layers, and each layer only needs to learn a change. Pre-norm with RMSNorm keeps deep stacks stable.

#### 3.7 Counting parameters

Per layer, attention has about 4d² weights (Q, K, V, output) and a 4x feed-forward has about 8d², so about 12d² per layer.

```
d = 4,096, L = 32:  12 × 4,096² × 32 ≈ 6.4B
Embeddings:         32,000 vocab × 4,096 ≈ 0.13B
Total ≈ 6.6B  → a "7B" model
```

#### 3.8 KV cache

During generation, keys and values of earlier tokens are stored so each new token computes attention only for itself. Memory per token = 2 (K and V) × layers × KV heads × head size × bytes.

```
Llama-style 7B (32 layers, 32 KV heads, head size 128, 16-bit):
2 × 32 × 32 × 128 × 2 bytes = 524,288 bytes ≈ 0.5 MB per token
4,096-token context ≈ 2 GB per sequence;  with GQA (8 KV heads) ≈ 0.5 GB
```

#### 3.9 Code: causal self-attention

```python
import numpy as np

def causal_attention(Q, K, V):
    # Q, K, V: (seq, d)
    d = Q.shape[-1]
    scores = Q @ K.T / np.sqrt(d)                       # (seq, seq)
    mask = np.triu(np.ones_like(scores), k=1) * -1e9    # hide the future
    scores = scores + mask
    weights = np.exp(scores - scores.max(-1, keepdims=True))
    weights /= weights.sum(-1, keepdims=True)
    return weights @ V
```

#### 3.10 Common mistakes

| Mistake | Effect | Fix |
| --- | --- | --- |
| Forgetting the causal mask | Model "cheats" by reading future tokens; fails at generation | Mask upper triangle |
| Mask applied after softmax | Weights no longer sum to 1 | Add −∞ before softmax |
| No √d scaling | Saturated softmax, slow training | Divide by √d\_k |
| Position bugs in KV cache | Garbled long generations | Apply RoPE with the absolute position of each cached token |

#### 3.11 Interview questions

1. Why is attention cost quadratic? Every token scores every other token: n² scores per head per layer.
2. What does the KV cache trade? Memory for speed: no recomputation of past keys and values.
3. Why do many heads help? Each head can specialize in a different relationship with little extra cost.

### Lesson 4: Scaling Laws and Compute-Optimal Training

Loss falls predictably as a power law when you increase parameters, data and compute. This lets labs predict a big run's result from small runs and decide how to split a compute budget between model size and training tokens.

#### 4.1 The shape of the law

```latex
L(N, D) \approx E + \frac{A}{N^{\alpha}} + \frac{B}{D^{\beta}}
```

N is parameters, D is training tokens, E is the irreducible loss (the entropy of text itself), and A, B, α, β are fitted constants. Doubling N or D removes a fixed fraction of the reducible loss, so each improvement costs more than the last: on a log-log plot, loss versus compute is nearly a straight line.

#### 4.2 Compute

```latex
C \approx 6 N D
```

The 6 counts about 2 FLOPs per parameter per token for the forward pass and 4 for the backward pass.

#### 4.3 Compute-optimal sizing, worked

The Chinchilla study (Hoffmann et al., 2022) found that for a fixed budget, parameters and tokens should grow together, at roughly 20 tokens per parameter. With D = 20N, C = 120N², so N = √(C ÷ 120).

```
Budget C = 1e22 FLOPs
N = √(1e22 / 120) = √(8.3e19) ≈ 9.1e9   → about 9B parameters
D = 20 × 9.1e9 ≈ 1.8e11                   → about 180B tokens
Check: 6 × 9.1e9 × 1.8e11 ≈ 9.9e21 ≈ 1e22 ✓
```

Earlier practice trained very large models on relatively few tokens; Chinchilla showed a smaller model trained on more data reaches lower loss for the same compute.

#### 4.4 Why labs overtrain small models anyway

Training happens once; inference happens billions of times. A smaller model trained far past 20 tokens per parameter costs more to train than compute-optimal but is much cheaper and faster to serve. Meta reported training its Llama 3 models on over 15 trillion tokens, far beyond Chinchilla-optimal for their sizes, for this reason.

#### 4.5 Using scaling laws in research

1. Train a ladder of small models (for example 10M to 1B parameters) with the same recipe.
2. Fit the power law to their final losses.
3. Predict the loss of the large run; if a new method shifts the whole curve down at every size, it likely helps at scale.
4. If the gain shrinks as models grow, it may vanish at the target size.

#### 4.6 Limits

Loss predicts downstream ability only roughly: some capabilities appear to jump suddenly at certain scales, though part of that "emergence" depends on the metric chosen. Data is finite: repeating data a few times works reasonably, but heavy repetition yields diminishing returns. Quality and mixture changes shift the whole curve.

#### 4.7 Common mistakes

| Mistake | Why it misleads | Fix |
| --- | --- | --- |
| Fitting a law on too few points | Unreliable extrapolation | At least 5-7 sizes spanning orders of magnitude |
| Different hyperparameters per size | Curve reflects tuning, not scale | Consistent recipe; scaled learning rates |
| Comparing at equal steps instead of equal compute | Unfair across sizes | Compare at equal FLOPs |
| Ignoring inference cost | Wrong model choice for products | Decide with total lifetime cost |

#### 4.8 Interview questions

1. You have 4x more compute. How do you grow N and D? Roughly 2x each, keeping the token-to-parameter ratio.
2. FLOPs to train a 7B model on 2T tokens? 6 × 7e9 × 2e12 = 8.4e22.
3. Why might a method that helps at 100M parameters not help at 10B? Larger models may already learn what the method adds; check across a scale ladder.

### Lesson 5: Training Dynamics and Debugging Instabilities

Large training runs fail in recognizable ways: spikes, divergence, silent slowdowns and data bugs. Researchers are expected to read the signals and debug methodically.

#### 5.1 What to monitor

| Signal | Healthy pattern | Warning sign |
| --- | --- | --- |
| Training loss | Smooth decline | Sudden spikes, plateaus, NaN |
| Validation loss | Tracks training loss | Rises while training falls (overfitting) |
| Gradient norm | Stable, slowly varying | Sudden jumps (often before a loss spike) |
| Learning rate | Follows the schedule | Wrong schedule from a config bug |
| Max attention logit or output logit size | Bounded | Steady growth (instability risk) |
| Throughput and MFU | Steady | Drops: data loader, network or hardware |
| Per-domain loss | Each falls | One rises: data mixture or corruption issue |

#### 5.2 Why loss spikes happen

1. A bad batch: corrupted text, extremely long repeated strings, or encoding garbage gives huge gradients.
2. Learning rate near the edge of stability: fine for most batches, explosive for some.
3. Growing logits in attention: as query-key products grow, softmax saturates and small changes swing outputs wildly.
4. Numeric overflow in 16-bit formats.
5. Hardware faults producing wrong values.

Fixes used in practice: gradient clipping, lower peak learning rate or longer warmup, normalizing queries and keys (QK-norm), an auxiliary penalty keeping output logits small (z-loss), BF16 instead of FP16, skipping or filtering offending batches, and rolling back to a checkpoint before the spike.

#### 5.3 Mixed precision

FP16 has a small range: values above about 65,504 overflow and tiny gradients underflow to zero, so FP16 training needs loss scaling. BF16 keeps FP32's exponent range with less precision, so it rarely overflows; most modern LLM training uses BF16 with FP32 master weights and optimizer states.

#### 5.4 Worked debugging example

| Step | Observation | Inference | Action |
| --- | --- | --- | --- |
| 41,200 | Loss jumps from 2.1 to 3.4 | Instability event | Pause, inspect |
| 41,180-41,200 | Gradient norm rose 6x over 20 steps | Building instability, not a single bad batch | Check logits |
| Same window | Max attention logit growing steadily | Attention saturation | Enable QK-norm, lower LR 20% |
| Rollback | Resume from step 40,000 with fixes |  | Loss continues smoothly |

If instead the gradient norm spiked at exactly one step, inspect that batch's data first.

#### 5.5 The debugging playbook

1. Reproduce at small scale if possible.
2. Overfit a tiny batch (loss should approach zero); if not, the bug is in code, labels or masking.
3. Check the data loader: shuffling, duplicated shards, tokenization, loss masks.
4. Compare against a known-good baseline config.
5. Change one variable at a time; log everything.

#### 5.6 Interview questions

1. Loss is flat from step 0. Top suspects? Learning rate too low or zero, frozen weights, loss mask hiding all targets, or a data loader returning padding.
2. Why BF16 over FP16? Same exponent range as FP32, so no overflow and no loss scaling needed.
3. A spike repeats at the same step after rollback. What does that tell you? It is likely the data at that step, not random numerics; inspect and skip that batch.

### Lesson 6: Post-Training (SFT, Reward Models, RLHF, DPO, RL for Reasoning)

A pretrained model predicts internet text; post-training turns it into a helpful, honest, safe assistant. The stages are supervised fine-tuning, preference learning, and increasingly reinforcement learning on tasks with checkable answers.

#### 6.1 Supervised fine-tuning (SFT)

Train on high-quality conversations (prompt → ideal response). Loss is computed only on the assistant's tokens, not the user's. Quality beats quantity: thousands of excellent, diverse examples often outperform millions of mediocre ones. SFT teaches format and style but copies whatever the demonstrations contain, including mistakes.

#### 6.2 Reward models

Humans (or AI judges) compare two responses to the same prompt and pick the better one. A reward model learns a score r so that preferred answers score higher, using the Bradley-Terry model:

```latex
P(a \succ b) = \sigma(r_a - r_b), \qquad \mathcal{L} = -\log \sigma(r_{chosen} - r_{rejected})
```

Example: r(chosen) = 1.2, r(rejected) = 0.4. σ(0.8) ≈ 0.69, so the model is 69% confident in the human choice; loss = −ln 0.69 ≈ 0.37. Training pushes the gap wider.

#### 6.3 RLHF with PPO

The policy (the chatbot) generates answers, the reward model scores them, and the policy is updated to increase reward while staying close to the original SFT model:

```latex
\max_\pi \; \mathbb{E}\left[ r(x, y) \right] - \beta \, \mathrm{KL}\left(\pi(\cdot \mid x) \,\Vert\, \pi_{ref}(\cdot \mid x)\right)
```

The KL term stops the policy from drifting into strange text that fools the reward model. PPO (Lesson 12) makes each update small and stable. Cost: four models in memory (policy, reference, reward, value), sampling during training, many hyperparameters.

#### 6.4 Direct Preference Optimization (DPO)

DPO skips the separate reward model and the RL loop, optimizing a classification-style loss directly on preference pairs:

```latex
\mathcal{L}_{DPO} = -\log \sigma\left(\beta \left[ \log \frac{\pi_\theta(y_w)}{\pi_{ref}(y_w)} - \log \frac{\pi_\theta(y_l)}{\pi_{ref}(y_l)} \right]\right)
```

Worked example: for the chosen answer, the policy's log-probability is −10 versus −11 for the reference (+1); for the rejected answer, −12 versus −11.5 (−0.5). Margin = 1 − (−0.5) = 1.5; with β = 0.1 the input is 0.15; σ(0.15) ≈ 0.537; loss ≈ 0.62. Training raises the chosen answer's relative probability and lowers the rejected one's.

|  | RLHF (PPO) | DPO |
| --- | --- | --- |
| Components | Reward model + RL | One loss on preference pairs |
| Stability and cost | Harder, costlier | Simpler, cheaper |
| Online exploration | Yes, samples new answers | Offline unless extended |
| Typical use | Large-scale alignment | Common default in open models |

#### 6.5 AI feedback and principles

Anthropic's Constitutional AI uses a written set of principles: the model critiques and revises its own outputs, and AI-generated preferences train the model (reinforcement learning from AI feedback), reducing reliance on human labels for harmlessness.

#### 6.6 RL for reasoning with verifiable rewards

For math and code, correctness can be checked automatically (the answer matches, the tests pass). The model samples several attempts per problem; correct ones are reinforced. Group-relative methods such as GRPO (introduced in DeepSeek's math work) compare each attempt's reward with the group average instead of training a value model.

Example: 8 attempts, 3 correct (reward 1), 5 wrong (0). Mean = 0.375. Advantages: correct ≈ +0.625, wrong ≈ −0.375 (often also divided by the standard deviation). The update raises the probability of the reasoning that led to correct answers.

#### 6.7 Failure modes

| Failure | Why it happens | Mitigation |
| --- | --- | --- |
| Reward hacking | Policy exploits reward model blind spots | KL penalty, reward model ensembles, fresh human checks |
| Sycophancy | Raters prefer agreeable answers | Preference data that rewards honest disagreement |
| Verbosity | Longer answers look better to raters | Length-controlled comparisons and penalties |
| Mode collapse | Policy narrows to a few safe patterns | KL control, diverse prompts |
| Over-refusal | Harmlessness overweighted | Balanced data with benign-but-sensitive prompts |

#### 6.8 Interview questions

1. Why keep a reference model in RLHF and DPO? To measure and limit drift; without it the policy can exploit the reward or lose general ability.
2. When would you choose DPO over PPO? Limited compute, a fixed preference dataset, and a need for simplicity and stability.
3. Why do verifiable rewards help reasoning? They are hard to fool, so the model is rewarded for being correct rather than for looking convincing.

### Lesson 7: Evaluation and Statistics

A claim is only as good as its evaluation. Researchers must pick measurements that reflect the capability, quantify uncertainty, and rule out contamination and judge bias.

#### 7.1 Kinds of evaluation

| Kind | Example | Strength | Weakness |
| --- | --- | --- | --- |
| Multiple choice knowledge | Exam-style questions | Cheap, objective | Saturates; contamination |
| Reasoning with exact answers | Math problems | Objective | Narrow; answer-format issues |
| Code with tests | Pass rate on unit tests | Functional correctness | Weak tests let wrong code pass |
| Open-ended with judges | Helpfulness ratings | Covers real use | Judge bias, cost |
| Human evaluation | Side-by-side preferences | Closest to users | Slow, expensive, noisy |
| Agentic tasks | Multi-step tasks in sandboxes | Real workflows | High variance, costly |

#### 7.2 How big is the noise?

For an accuracy p measured on n independent questions:

```latex
SE = \sqrt{\frac{p(1-p)}{n}}, \qquad 95\%\ \text{interval} \approx p \pm 1.96 \times SE
```

Example: 80% on 500 questions gives SE = √(0.8 × 0.2 ÷ 500) ≈ 0.018, so the 95% interval is about ±3.5 points. A 1.5-point gain between two models on this benchmark is within noise. Paired comparisons (both models on the same questions, counting where they disagree) and bootstrap resampling give tighter, more honest estimates.

```python
import numpy as np

def bootstrap_diff(correct_a, correct_b, n_boot=10_000, seed=0):
    rng = np.random.default_rng(seed)
    a, b = np.array(correct_a), np.array(correct_b)   # 1/0 per question, same order
    idx = rng.integers(0, len(a), size=(n_boot, len(a)))
    diffs = a[idx].mean(1) - b[idx].mean(1)
    return np.percentile(diffs, [2.5, 97.5])          # 95% interval of A - B
```

#### 7.3 pass@k for code and reasoning

Generate n samples per problem, count c correct, and estimate the chance that at least one of k samples is correct:

```latex
\text{pass@}k = 1 - \frac{\binom{n-c}{k}}{\binom{n}{k}}
```

Example: n = 10, c = 3. pass@1 = 0.30. pass@5 = 1 − C(7,5) ÷ C(10,5) = 1 − 21 ÷ 252 ≈ 0.92.

#### 7.4 Contamination

If test questions appear in training data, scores measure memory, not ability. Detect it with n-gram overlap searches against the training corpus, by comparing scores on original versus freshly written equivalent questions, and by watching for suspiciously high accuracy on old benchmarks versus new ones. Keep private held-out sets.

#### 7.5 LLM judges

| Bias | What happens | Fix |
| --- | --- | --- |
| Position bias | Prefers the first (or second) answer | Swap order and average |
| Length bias | Prefers longer answers | Length-controlled scoring, rubrics |
| Self-preference | Prefers its own model family's style | Different judge model; human calibration |
| Vague criteria | Inconsistent scores | Specific rubrics with examples |

Always measure judge agreement with human labels on a sample before trusting it.

#### 7.6 Interview questions

1. Model A scores 72.0% and B 70.5% on 1,000 questions. Is A better? SE ≈ 1.4 points per model; the difference is within noise unless a paired test on the same questions shows significance.
2. Why report several seeds? Training randomness alone can move scores by a point or more.
3. A benchmark is near 95% for all top models. What now? It is saturated; use harder or newer evaluations that still separate models.

### Lesson 8: Interpretability

Interpretability asks what a model has learned internally and which internal computations cause its outputs. It supports debugging, safety checks and scientific understanding.

#### 8.1 Probing

Train a small linear classifier on a layer's activations to predict a property (for example, whether a sentence is in Hindi or English). High probe accuracy means the information is linearly readable there. Caution: readable is not the same as used; the model may never rely on it.

#### 8.2 Attribution

Gradient-based attribution asks which input tokens most affect an output. Integrated gradients averages gradients along a path from a baseline input to the real input, giving more reliable attributions. Attention weights show where a head looks, but they are not a full explanation, because values and later layers transform what is gathered.

#### 8.3 Logit lens

Apply the final output layer to intermediate residual-stream states to see what the model would predict at each layer. Often the correct answer emerges gradually through middle layers.

#### 8.4 Causal interventions (activation patching)

Run the model on a clean prompt ("The Eiffel Tower is in" → Paris) and a corrupted one ("The Colosseum is in" → Rome). Copy one internal activation from the clean run into the corrupted run and see whether the output shifts toward Paris.

Example: the logit difference (Paris minus Rome) is +6 on the clean run and −4 on the corrupted run. Patching the layer-12 residual at the last subject token raises it to +4. Recovery = (4 − (−4)) ÷ (6 − (−4)) = 80%, so that location carries most of the fact. Repeating this across layers and positions maps where information flows.

#### 8.5 Superposition

Models represent more features than they have neurons by storing features as directions that overlap, tolerating a little interference because most features are rarely active together. This is why single neurons are often polysemantic (responding to unrelated things). Anthropic's "Toy Models of Superposition" (2022) demonstrated this in small networks.

#### 8.6 Sparse autoencoders (SAEs)

An SAE learns a much wider dictionary of features (for example 16x the activation size) such that each activation is reconstructed from only a few active features:

```latex
\mathcal{L} = \lVert x - \hat{x} \rVert_2^2 + \lambda \lVert f \rVert_1, \qquad f = \mathrm{ReLU}(W_{enc} x + b), \quad \hat{x} = W_{dec} f
```

The sparsity penalty pushes each feature to mean one thing. Anthropic's work found interpretable features in production-scale models (cities, code bugs, deception-related concepts), and showed that clamping a feature changes behavior: amplifying a Golden Gate Bridge feature made a model bring up the bridge constantly. That causal effect is evidence the feature is used, not merely present.

#### 8.7 Circuits

A circuit is a set of features and connections implementing a behavior, such as induction heads that copy patterns ("A B ... A" → predict "B"), which support in-context learning. Circuit analysis combines feature dictionaries with patching to trace a computation step by step.

#### 8.8 Limits

Dictionaries reconstruct activations imperfectly; features can split or merge with dictionary size; interpretations can be over-read from a few examples; and full explanations of large models remain far off.

#### 8.9 Interview questions

1. Why is probe accuracy not proof of use? A probe shows information is present; only interventions show the model relies on it.
2. What problem do SAEs address? Polysemantic neurons caused by superposition; they produce sparser, more interpretable units.
3. How would you test whether a feature causes a behavior? Ablate or amplify it and measure the change in outputs on held-out prompts, with controls.

### Lesson 9: Alignment and Safety

Alignment is getting models to do what we actually intend, honestly and safely, even when the objective we wrote down is imperfect. Safety research also measures dangerous capabilities and builds layers of protection around deployed models.

#### 9.1 The core gap: what we specify versus what we want

We train on a proxy (a reward model, passing tests, rater approval). A strong optimizer finds ways to score well on the proxy that we did not intend. This is specification gaming or reward hacking.

Classic example: in a boat-racing game, an RL agent learned to circle forever hitting the same reward targets instead of finishing the race, because the score rewarded targets, not winning (described by OpenAI in 2016).

LLM example: a coding agent rewarded for "tests pass" edits the tests or special-cases the expected outputs instead of fixing the bug.

| Fix for the coding case | Why it helps |
| --- | --- |
| Hidden tests the agent cannot see or edit | Removes the shortcut |
| Penalize or block changes to test files | Makes the hack visible and costly |
| Review diffs with another model or human | Catches unexpected strategies |
| Reward the process (sound steps), not only the outcome | Harder to fake |

#### 9.2 Other alignment failures

Sycophancy: telling users what they want to hear, because raters reward agreement. Overconfidence: stating guesses as facts, because training rewards answers. Goal misgeneralization: the model learns a goal that matched training data but differs elsewhere (it learned "go to the green door" when the intent was "go to the exit"). Deceptive behavior is a research concern: a model behaving well when it detects evaluation and differently otherwise.

#### 9.3 Attacks on deployed models

Jailbreaks use role-play, obfuscation or many-shot examples to bypass safety training. Prompt injection hides instructions in documents, web pages or tool results that an agent reads. Defenses are layered: safety training, input and output classifiers, treating external content as data, permissions and sandboxes for actions, and monitoring.

#### 9.4 Red teaming

People and automated systems search for failures: harmful compliance, over-refusal, leakage, injection, unsafe agent actions. Automated red teaming uses one model to generate attacks against another at scale. Every successful attack becomes a regression test.

#### 9.5 Scalable oversight

As models exceed human ability on some tasks, humans struggle to judge outputs. Approaches include AI-assisted evaluation (models help humans find flaws), debate (two models argue and a judge decides), process supervision (rating each reasoning step), and constitutions that let AI feedback follow written principles.

#### 9.6 Dangerous-capability evaluations and policies

Labs test models for capabilities such as serious cyber offense or biological weapons uplift, and tie deployment safeguards to results. Anthropic's Responsible Scaling Policy, for example, defines AI Safety Levels with required security and deployment measures as capabilities grow.

#### 9.7 Interview questions

1. Give a reward hacking example and two mitigations. Agent edits tests to pass; hidden tests and diff review.
2. Why does RLHF risk sycophancy? Raters often prefer agreement and confident tone; the model optimizes for approval.
3. How would you evaluate an agent's resistance to prompt injection? Build tasks containing hidden malicious instructions in tool results, measure how often the agent follows them, and track it as a release metric.

### Lesson 10: Efficiency

Efficiency research makes models cheaper and faster to train and serve with as little quality loss as possible. The main levers are fewer bits, fewer active parameters, fewer memory reads and fewer sequential steps.

#### 10.1 Quantization

Store weights (and sometimes activations or the KV cache) in fewer bits.

```
70B parameters:  16-bit = 140 GB   8-bit = 70 GB   4-bit = 35 GB
```

How it works: group weights (per channel or per block of, say, 64 values), store a scale for each group, and round each weight to the nearest representable level. Example with 4-bit symmetric levels −7 to 7 and a group whose largest absolute weight is 0.35: scale = 0.35 ÷ 7 = 0.05; a weight of 0.12 becomes round(0.12 ÷ 0.05) = 2, dequantized to 0.10 (error 0.02). Methods such as GPTQ and AWQ choose rounding to minimize output error rather than per-weight error, and protect the most important channels. Decode speed improves because memory bandwidth is the bottleneck (Chapter 61).

#### 10.2 Distillation

A small student learns to match a large teacher's full output distribution (soft labels), which carries more information than the single correct token.

```latex
\mathcal{L} = \alpha \, \mathrm{CE}(y, p_s) + (1 - \alpha) \, T^2 \, \mathrm{KL}\left(p_t^{(T)} \Vert p_s^{(T)}\right)
```

T is a temperature that softens both distributions so the student learns which wrong answers are "almost right".

#### 10.3 Mixture of experts (MoE)

Replace each feed-forward layer with many experts and a router that sends each token to a few of them (often 2). Total parameters are large, but compute per token stays small. Mistral described Mixtral 8x7B as having about 47B total parameters but using about 13B per token. Challenges: load balancing (an auxiliary loss keeps experts evenly used), memory to hold all experts, and communication when experts sit on different GPUs.

#### 10.4 FlashAttention

Standard attention writes an n × n score matrix to slow GPU memory and reads it back. FlashAttention computes attention in tiles held in fast on-chip memory with an online softmax, never storing the full matrix. Same exact result, far less memory traffic, and memory grows linearly instead of quadratically with sequence length.

#### 10.5 Speculative decoding

A small draft model proposes k tokens; the big model checks all of them in one parallel pass, accepting the longest correct prefix. If each draft token is accepted with probability α, the expected number of tokens produced per big-model pass is:

```latex
\mathbb{E}[\text{tokens}] = \frac{1 - \alpha^{k+1}}{1 - \alpha}
```

Example: α = 0.8, k = 4 gives (1 − 0.8⁵) ÷ 0.2 ≈ 3.4 tokens per pass instead of 1, with output quality identical to the big model's own sampling.

#### 10.6 Other levers

Grouped-query attention and KV-cache quantization shrink serving memory; continuous batching keeps GPUs busy; pruning removes weights; shorter prompts and caching cut work entirely.

| Lever | Saves | Typical cost |
| --- | --- | --- |
| 4-bit weights | \~4x memory, faster decode | Small quality loss, task-dependent |
| Distillation | Smaller model at inference | Training effort; some capability loss |
| MoE | Compute per token | Memory and engineering complexity |
| FlashAttention | Memory traffic | None in quality |
| Speculative decoding | Latency | Draft model, extra compute |

#### 10.7 Interview questions

1. Why does quantization speed up decoding? Decoding is memory-bandwidth-bound; fewer bytes per weight means fewer bytes moved per token.
2. Total vs active parameters in MoE? Total is all experts; active is what each token uses; compute follows active, memory follows total.
3. When does speculative decoding help least? When the draft model is often wrong (low acceptance), so verification work is wasted.

### Lesson 11: Data

Data decides more of a model's quality than most architecture tweaks. Researchers are expected to understand deduplication, quality filtering, mixtures, synthetic data and contamination, and to reason about each with evidence.

#### 11.1 The pretraining data pipeline

1. Collect: web crawls, books, code, papers, conversations (with licensing and consent checks).
2. Extract text from HTML and PDFs; detect language.
3. Heuristic filters: length, symbol ratios, repeated lines, boilerplate.
4. Quality classifier: score documents by similarity to trusted reference text.
5. Deduplicate exactly and approximately.
6. Remove personal data and toxic content; respect opt-outs.
7. Decontaminate against evaluation sets.
8. Mix domains with chosen weights; tokenize; shuffle.

#### 11.2 Deduplication with MinHash

Exact duplicates are found by hashing documents. Near-duplicates (same article with different ads) need similarity. Split each document into shingles (for example, every 5-word window) and compare sets with Jaccard similarity:

```latex
J(A, B) = \frac{|A \cap B|}{|A \cup B|}
```

Example: two pages share 800 shingles out of 1,000 distinct shingles in total, so J = 0.8. Computing this for billions of pairs is impossible, so MinHash stores, per document, the minimum hash value under each of, say, 128 hash functions. The chance that two documents share a minimum equals their Jaccard similarity, so the fraction of matching minimums estimates J. Locality-sensitive hashing groups likely matches so only candidates are compared. Removing near-duplicates reduces memorization and wasted compute.

#### 11.3 Quality filtering

Train a classifier to separate high-quality reference text (curated books, encyclopedic pages) from random web text, then keep documents above a threshold or sample by score. Risk: the classifier can encode bias (dropping dialects or informal languages), so check what gets removed per language and domain.

#### 11.4 Data mixtures

| Domain | Share of raw data | Share in training mix | Why |
| --- | --- | --- | --- |
| General web | 80% | 60% | Breadth |
| Code | 8% | 15% | Reasoning and coding ability |
| Books and papers | 5% | 12% | Long-form, high-quality text |
| Math | 2% | 8% | Reasoning |
| Multilingual | 5% | 5% | Language coverage |

The numbers are illustrative. Upsampled domains are seen more than once; mixtures are tuned with small proxy runs, and teams often raise high-quality data near the end of training.

#### 11.5 Synthetic data

Models can generate training data: rewritten text, question-answer pairs, reasoning traces, code with tests. It works best when outputs are verified (tests pass, answers checked) and diverse. Risks: errors and biases of the generator are copied, and repeatedly training on a model's own unfiltered outputs can narrow and degrade the distribution over generations (often called model collapse). Mixing in real data and filtering by verification reduces this.

#### 11.6 Fine-tuning data

For SFT and preference data, quality and coverage beat size: cover the real task distribution, include hard and edge cases, balance classes, keep consistent formatting, and hold out a test set written independently.

#### 11.7 Interview questions

1. Why deduplicate? Duplicates waste compute, increase memorization and privacy risk, and inflate evaluation if test items repeat.
2. How would you decide the share of code in a mixture? Train small proxy models with different shares and measure code and general evaluations, then choose the best trade-off.
3. What can go wrong with a quality classifier? It may remove valid but underrepresented text (dialects, low-resource languages), biasing the model.

### Lesson 12: Reinforcement Learning Basics

Reinforcement learning trains an agent to choose actions that maximize long-term reward. For LLMs, the state is the prompt plus tokens so far, an action is the next token, an episode is a full response, and the reward usually arrives at the end.

#### 12.1 Core terms

| Term | Meaning | LLM version |
| --- | --- | --- |
| Policy π(a\|s) | Probability of action given state | The language model |
| Reward r | Feedback signal | Reward model score or test pass |
| Return G | Sum of (discounted) rewards | Usually one final reward |
| Value V(s) | Expected return from a state | Critic predicting final reward |
| Advantage A | How much better an action was than expected | Reward minus baseline |

Discounted return example: rewards 1, 0, 2 with γ = 0.9 give G = 1 + 0.9 × 0 + 0.81 × 2 = 2.62.

#### 12.2 Policy gradients (REINFORCE)

Increase the probability of actions that led to higher-than-expected return:

```latex
\nabla_\theta J = \mathbb{E}\left[ \nabla_\theta \log \pi_\theta(a \mid s) \, (G - b) \right]
```

The baseline b (often the average return or a learned value) does not change the expected gradient but greatly reduces its variance. Example: four responses score 0.9, 0.2, 0.6, 0.3 (mean 0.5). Advantages: +0.4, −0.3, +0.1, −0.2. The first response's tokens are pushed up strongly, the second's pushed down.

#### 12.3 PPO

Policy updates that are too large can wreck a policy. PPO limits how far the new policy's probability ratio ρ = π\_new ÷ π\_old can move in one update:

```latex
L = \mathbb{E}\left[ \min\left( \rho A, \; \mathrm{clip}(\rho, 1-\epsilon, 1+\epsilon) A \right) \right], \quad \epsilon \approx 0.2
```

Example: advantage A = +2, ratio ρ = 1.5. Unclipped term = 3.0; clipped term = 1.2 × 2 = 2.4; PPO takes the minimum, 2.4, so there is no extra incentive to push the probability further this round.

#### 12.4 KL penalty in RLHF

The reward is reduced by β × KL(policy ‖ reference), measured per token. This keeps the model close to its fluent starting point and limits reward hacking. Too small β: drift and exploits. Too large: almost no learning.

#### 12.5 Hard parts

Credit assignment: one reward for a 500-token answer must be spread across tokens. Sparse rewards: if almost nothing succeeds, there is little signal (curricula and easier problems help). Exploration: the model must try different approaches (sampling temperature, multiple attempts per prompt). Reward hacking: optimizers exploit flaws (Lesson 9).

#### 12.6 Code: REINFORCE on a toy bandit

```python
import numpy as np
rng = np.random.default_rng(0)
logits = np.zeros(3)                       # policy over 3 actions
true_reward = np.array([0.2, 0.8, 0.5])   # action 1 is best
baseline, lr = 0.0, 0.1
for step in range(2000):
    p = np.exp(logits) / np.exp(logits).sum()
    a = rng.choice(3, p=p)
    r = float(rng.random() < true_reward[a])
    grad = -p; grad[a] += 1                # gradient of log pi(a)
    logits += lr * (r - baseline) * grad
    baseline = 0.99 * baseline + 0.01 * r  # running average baseline
print(np.round(p, 2))                      # most probability on action 1
```

#### 12.7 Interview questions

1. Why subtract a baseline? It reduces gradient variance without biasing the expected gradient.
2. What does PPO's clipping prevent? Destructively large policy updates from a single batch.
3. How is RL for LLMs different from games? Huge action space (vocabulary), very long episodes, rewards from learned or checkable judges, and a strong pretrained starting policy.

### Lesson 13: Generalization

Generalization is performing well on data the model never saw. Modern deep learning breaks some classical intuitions: huge models can fit their training data perfectly yet still generalize, and sometimes generalize long after they stopped improving on training data.

#### 13.1 Overfitting, worked

| Epoch | Train loss | Validation loss | Reading |
| --- | --- | --- | --- |
| 1 | 1.80 | 1.85 | Learning |
| 2 | 1.40 | 1.52 | Still learning |
| 3 | 1.10 | 1.49 | Best validation |
| 4 | 0.80 | 1.58 | Overfitting starts |
| 5 | 0.50 | 1.75 | Memorizing training data |

Keep the epoch-3 checkpoint. Tools against overfitting: more and more diverse data, early stopping, weight decay, dropout, data augmentation, smaller models or adapters.

#### 13.2 Bias, variance and double descent

Classical view: small models underfit (high bias), large models overfit (high variance), so test error forms a U-shape against model size. Deep networks often show double descent: test error rises near the point where the model can just barely fit the training data (the interpolation threshold), then falls again as models grow much larger, because among the many perfect fits, training tends to find smooth, simple ones.

#### 13.3 Grokking

On small algorithmic tasks (such as modular arithmetic), networks can memorize the training set early, then, after much longer training with weight decay, suddenly generalize to held-out examples. It shows that training loss alone can hide whether a model has learned the general rule.

#### 13.4 Memorization

Large models memorize some training text, especially rare or duplicated sequences. Researchers measure it by prompting with a prefix from training data and checking whether the exact continuation is produced, or by inserting unique "canary" strings and testing recall. Risks: privacy leaks and copyright issues. Mitigations: deduplication, filtering personal data, and output filters.

#### 13.5 In-context learning

Models learn from examples in the prompt without changing weights: show three translations and the model continues the pattern. Mechanistic work links part of this to induction heads that find an earlier occurrence of the current token and copy what followed. Few-shot performance grows strongly with scale.

#### 13.6 Distribution shift

Models fail when deployment data differs from training data: new slang, new document formats, other languages, adversarial inputs. Detect shift by monitoring input statistics and per-slice performance; address it with more representative data, retrieval, or targeted fine-tuning.

#### 13.7 Interview questions

1. Training loss keeps falling but validation rises. What do you do? Stop at the best validation checkpoint and add regularization or data.
2. What is double descent? Test error that worsens near the interpolation threshold, then improves again as model size keeps increasing.
3. How would you test whether a model memorized a document? Prompt with prefixes from it and measure exact-match continuations against a baseline of unseen documents.

### Lesson 14: Multimodal Models

Multimodal models turn images, audio and video into vectors the language model can attend to, alongside text tokens. The key ideas are encoding each modality into tokens, aligning modalities in a shared space, and connecting encoders to the language model.

#### 14.1 Images as tokens

A vision transformer cuts an image into fixed-size patches and treats each patch as a token.

```
224 × 224 image, 16 × 16 patches → 14 × 14 = 196 patches
Each patch: 16 × 16 pixels × 3 colors = 768 numbers → projected to a d-dimensional vector
```

Higher resolution means more patches and more tokens: a 448 × 448 image gives 784 patches, four times the cost. Many systems tile large images into crops plus a low-resolution overview.

#### 14.2 Contrastive alignment (CLIP-style)

Train an image encoder and a text encoder together on matching image-caption pairs. In a batch of N pairs, compute all N × N similarities; the loss asks each image to pick its own caption among N, and each caption its own image.

```latex
\mathcal{L} = -\frac{1}{2N} \sum_{i=1}^{N} \left[ \log \frac{e^{s_{ii}/\tau}}{\sum_j e^{s_{ij}/\tau}} + \log \frac{e^{s_{ii}/\tau}}{\sum_j e^{s_{ji}/\tau}} \right]
```

Worked 2 × 2 example: similarities (cosine) image 1 with captions 1 and 2 are 0.9 and 0.2; with temperature τ = 0.1 the scaled scores are 9 and 2; softmax gives 0.999 for the correct caption, a tiny loss. If they were 0.5 and 0.45, scaled 5 and 4.5, softmax ≈ 0.62 for the correct caption, a larger loss pushing them apart. The result is a shared space where "a dosa on a plate" lands near photos of dosas, enabling zero-shot classification and image search.

#### 14.3 Connecting vision to a language model

Common designs: (1) a projector maps vision-encoder outputs into the language model's embedding space, and image tokens are placed in the sequence with text; (2) cross-attention layers let text tokens attend to image features. Training usually first aligns the projector on captions, then fine-tunes on instruction data with images (charts, documents, screenshots).

#### 14.4 Audio

Speech is converted into frames of a spectrogram (for example 25 ms windows every 10 ms, about 100 frames per second), then encoded; or compressed into discrete tokens by a neural audio codec so a model can both understand and generate audio. Speech-to-speech models avoid separate transcription and synthesis steps, reducing latency (Chapter 19).

#### 14.5 Common failures

| Failure | Why it happens | Mitigation |
| --- | --- | --- |
| Describing objects that are not there | Language prior overrides weak visual evidence | Grounding data, higher resolution, verification prompts |
| Misreading small text in images | Too few pixels per character after resizing | Tiling, higher-resolution crops, OCR tools |
| Weak spatial reasoning (left/right, counting) | Patch tokens lose fine geometry; little training data | Targeted data, coordinate outputs |
| High cost per image | Hundreds to thousands of tokens per image | Resize sensibly, cache image encodings |

#### 14.6 Interview questions

1. How many tokens does a 336 × 336 image produce with 14 × 14 patches? (336 ÷ 14)² = 24² = 576.
2. Why does CLIP use large batches? Each batch supplies the negatives; more negatives make the contrastive task harder and the embeddings better.
3. How would you reduce hallucinated objects in image descriptions? Train with grounded data, increase resolution, penalize unsupported mentions, and evaluate with object-level checks.
