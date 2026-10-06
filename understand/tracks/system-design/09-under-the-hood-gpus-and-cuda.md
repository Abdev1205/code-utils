# Part IX: Under the Hood: GPUs and CUDA

**Topic:** System design
**Covers:** CUDA and GPU Computing
**Source:** [Claude artifact](https://claude.ai/artifact/7xxGdVxPGbUiPY13z4MdZ2) — written by a colleague, mirrored here for study.

## Chapter 61: CUDA and GPU Computing

#### The problem in one view

| Question | Answer |
| --- | --- |
| Problem statement | Run the enormous matrix math behind AI fast enough and cheaply enough to train and serve large models. |
| Why it is hard | CPUs are too slow for massively parallel math, GPU memory bandwidth is often the real limit, and multi-GPU communication adds overhead and failure points. |
| How we solve it | CUDA kernels across thousands of threads, memory-aware design (coalescing, shared-memory tiling), tensor cores with mixed precision, fused kernels such as FlashAttention, optimized libraries, and NCCL across GPUs. |
| What fails, and why | CUDA out of memory (activations, optimizer states or KV cache exceed HBM), slow kernels (uncoalesced access, warp divergence), idle GPUs (CPU-GPU sync or data loading stalls), and hung training (NCCL rank mismatches or failed nodes). |

Every LLM in Part VII runs on GPUs, and on NVIDIA GPUs the programming layer underneath is CUDA. Understanding it explains why decode is memory-bound, why batching and quantization help, why FlashAttention exists, and why GPU clusters fail the way they do.

### 61.1 CPU vs GPU

```
CPU: a few powerful cores                    GPU: thousands of simple cores
┌──────┐┌──────┐┌──────┐┌──────┐             ┌─────────────────────────────────┐
│ core ││ core ││ core ││ core │             │ SM │ SM │ SM │ SM │ SM │ SM │ ... │
│+big  ││cache ││branch││pred. │             │ each SM: many CUDA cores, tensor  │
└──────┘└──────┘└──────┘└──────┘             │ cores, registers, shared memory   │
low latency per task, complex logic          └─────────────────────────────────┘
                                              huge throughput on the SAME operation
```

A CPU minimizes the latency of one task; a GPU maximizes throughput across thousands of identical tasks, such as multiplying matrices. CUDA (Compute Unified Device Architecture) is NVIDIA's platform for programming that parallelism in C/C++ and, through libraries and frameworks, in Python.

### 61.2 The programming model

The CPU is the host and the GPU the device. A kernel is a function the host launches to run on the device across many threads at once. Threads are organized hierarchically:

```
Grid (one kernel launch)
├── Block 0 ── threads 0..255   (share fast on-chip shared memory, can synchronize)
├── Block 1 ── threads 0..255
└── Block N ...
Hardware schedules blocks onto Streaming Multiprocessors (SMs);
each SM runs threads in WARPS of 32 that execute the same instruction together (SIMT).
```

The classic first kernel adds two vectors, one element per thread:

```cuda
__global__ void vector_add(const float* a, const float* b, float* c, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;   // this thread's global index
    if (i < n) c[i] = a[i] + b[i];                   // guard: grid may exceed n
}

// host side: copy inputs to the GPU, launch, copy results back
int threads = 256;
int blocks = (n + threads - 1) / threads;
vector_add<<<blocks, threads>>>(d_a, d_b, d_c, n);
cudaDeviceSynchronize();
```

A typical host program allocates device memory (`cudaMalloc`), copies inputs (`cudaMemcpy` host to device), launches kernels, copies results back, and frees memory. Streams let copies and kernels overlap asynchronously; unified memory simplifies allocation at some performance cost.

### 61.3 The memory hierarchy

```
Fastest, smallest
  Registers            per thread
  Shared memory / L1   per SM, tens to a couple hundred KB, programmer-managed scratchpad
  L2 cache             shared by all SMs, tens of MB
  HBM (global memory)  tens of GB, several TB/s bandwidth, but far slower than on-chip
  Host RAM over PCIe   much slower still
Slowest, largest
```

Most GPU performance work is about moving data less. Memory coalescing: when the 32 threads of a warp read consecutive addresses, the hardware combines them into few transactions; scattered reads waste bandwidth. Shared memory tiling: load a tile of a matrix from HBM into shared memory once and reuse it many times. Occupancy: keep enough warps resident per SM to hide memory latency, limited by registers and shared memory per thread.

### 61.4 Compute-bound vs memory-bound

Arithmetic intensity is FLOPs performed per byte moved. The roofline model says a kernel is limited either by compute (high intensity) or by memory bandwidth (low intensity).

```
performance
   ▲          ___________________  ← compute roof (peak FLOP/s)
   │        /
   │      /   ← memory roof (bandwidth × intensity)
   │    /
   └──────────────────────────────► arithmetic intensity (FLOPs/byte)
     decode (1 token/user) ↑                    ↑ prefill, big-batch matmuls
```

This explains Chapter 47. LLM decode for one user reads all the weights to produce one token, which is very low intensity and memory-bound. Batching many users reuses each weight read for many tokens, raising intensity and throughput. Quantization shrinks the bytes moved per step. Prefill processes many tokens at once and is compute-bound.

### 61.5 Tensor cores and mixed precision

Tensor cores are specialized units that perform small matrix multiply-accumulates in one step, delivering most of a modern GPU's deep-learning FLOPs. They work on reduced precision (FP16, BF16, FP8, INT8, and on newer GPUs even lower), which is why training uses BF16 mixed precision and inference uses quantization: lower precision means more math per second and fewer bytes per weight.

### 61.6 The software stack

```
Your model code (PyTorch / JAX)
   ↓
Frameworks call optimized kernels: cuBLAS (matrix math), cuDNN (neural-net ops),
NCCL (multi-GPU communication), CUTLASS (templated matmul kernels)
   ↓
Custom kernels: CUDA C++, or Triton (a Python-like GPU kernel language from OpenAI)
   ↓
CUDA runtime + driver → GPU hardware
```

When PyTorch runs `x @ w` on a GPU, it dispatches to cuBLAS. Kernel fusion combines several small operations (matmul, bias, activation) into one kernel so intermediate results never round-trip through HBM; compilers such as `torch.compile` and inference engines such as TensorRT-LLM fuse aggressively.

### 61.7 FlashAttention: a CUDA idea that changed LLMs

Naive attention writes a full sequence × sequence score matrix to HBM and reads it back for softmax and the weighted sum, which is huge for long contexts. FlashAttention (Dao et al., 2022) tiles queries, keys and values into blocks that fit in on-chip SRAM, computes softmax incrementally, and never materializes the full matrix in HBM. Same math, far fewer memory reads, so it is faster and lets models use much longer contexts. It is a direct application of section 61.3: move less data.

### 61.8 Multi-GPU and clusters

Inside a server, GPUs connect through NVLink and NVSwitch at very high bandwidth; between servers, through InfiniBand or high-speed Ethernet. NCCL implements collective operations such as all-reduce (averaging gradients across GPUs in data-parallel training) and all-gather (sharded weights in FSDP).

```
Ring all-reduce across 4 GPUs: each sends a chunk to its neighbor, accumulates,
and passes it on; after 2 × (N − 1) steps every GPU holds the summed gradients.
GPU0 → GPU1 → GPU2 → GPU3 → GPU0
```

MIG (Multi-Instance GPU, on recent data-center GPUs) partitions one GPU into isolated slices, useful for serving several small models. Cluster schedulers (Slurm, Kubernetes with GPU operators) allocate GPUs, and topology-aware placement keeps communicating GPUs on fast links.

### 61.9 Example scenario: why a serving GPU sits at 30% utilization

A team serves a 7B model one request at a time and sees low GPU utilization with slow throughput. Diagnosis: each decode step is memory-bound and the batch size is 1, so tensor cores idle while weights stream from HBM. Fixes in order: continuous batching (raises arithmetic intensity), an engine with paged KV cache and fused kernels (vLLM, TensorRT-LLM), FP8 or INT4 weights (fewer bytes per step), and prefix caching. Utilization and tokens per second rise several-fold on the same hardware.

### 61.10 Failure scenarios and fixes

| Scenario | Symptom | Root cause | Fix |
| --- | --- | --- | --- |
| CUDA out of memory | `CUDA out of memory` during training | Activations, optimizer states or KV cache exceed HBM | Smaller batch + gradient accumulation, activation checkpointing, mixed precision, FSDP/ZeRO, quantization |
| Illegal memory access | Kernel crashes, "illegal address" | Out-of-bounds index, missing `if (i < n)` guard | Bounds checks; run `compute-sanitizer` |
| Race condition | Wrong, nondeterministic results | Threads write shared data without synchronization | `__syncthreads()`, atomics, redesign reductions |
| Warp divergence | Kernel unexpectedly slow | Threads in a warp take different branches, serializing | Restructure branches; group similar work |
| Uncoalesced access | Low bandwidth utilization | Strided or scattered reads | Change data layout (structure of arrays), tile via shared memory |
| CPU-GPU sync stalls | GPU idle between steps | `.item()`, prints or copies force synchronization each step | Remove syncs from hot loops; overlap with streams |
| PCIe bottleneck | Data loading starves GPUs | Host-to-device copies too slow | Pinned memory, async copies, prefetching, on-GPU decoding |
| NCCL hang | Distributed job freezes | Rank mismatch, failed node, network fault | Timeouts, health checks, consistent collective order, restart from checkpoint |
| Silent data corruption / ECC errors | Loss spikes, NaNs on one node | Faulty GPU memory | Monitor ECC counters, evict bad nodes, checkpoint and resume |
| Thermal throttling | Throughput drops over time | Overheating | Monitor clocks and temperature; fix cooling |
| Version mismatch | Import or launch errors | Driver, CUDA toolkit and framework versions incompatible | Pin versions in containers; match driver to CUDA |

Profiling tools: Nsight Systems for timelines (find idle gaps and sync points), Nsight Compute for per-kernel analysis (occupancy, memory throughput), PyTorch profiler, and `nvidia-smi` for utilization, memory, temperature and ECC.

### 61.11 Challenges

GPU scarcity and cost; keeping expensive GPUs busy (utilization is a business metric); memory capacity versus model and context size; communication overhead at scale; hardware failures in large clusters; portability across GPU generations and vendors (other ecosystems exist, such as AMD ROCm and Google TPUs with XLA); and the expertise needed to write fast kernels, which tools like Triton aim to lower.

### 61.12 Practitioner's guide

| Aspect | Details |
| --- | --- |
| Benefits | Massive parallel throughput, tensor-core speed, mature libraries |
| Constraints | Memory capacity and bandwidth, scarcity, vendor lock-in, kernel expertise |
| Trade-offs | Lower precision (speed) vs accuracy; bigger batches (throughput) vs latency |
| Write custom kernels when | Profiling shows a hot op that libraries do not fuse well |
| Use libraries when | Almost always: cuBLAS, cuDNN, FlashAttention, engines |
| Avoid | Optimizing before profiling; CPU-GPU syncs in hot loops |

```
GPU optimization order
 1 profile (Nsight Systems) → 2 remove host syncs / data stalls → 3 batch more
 4 mixed precision / quantize → 5 fuse kernels (torch.compile, engines) → 6 custom kernels (Triton/CUDA)
```

### Review questions

1. Why is single-user LLM decode memory-bound, and how does batching help?
2. What does FlashAttention change to make attention faster?
3. A training job fails with CUDA out of memory. Name three fixes.

#### Answers

1. Generating one token for one user reads all the model weights from HBM but does very little math per byte, so speed is limited by memory bandwidth. Batching many users reuses each weight read for many tokens, raising arithmetic intensity and throughput.
2. It tiles queries, keys and values into blocks that fit in on-chip SRAM and computes softmax incrementally, never writing the full sequence × sequence score matrix to HBM. Same math, far less memory traffic, so it is faster and supports longer contexts.
3. Any three: smaller per-device batch with gradient accumulation; activation (gradient) checkpointing; mixed precision (BF16); sharding with FSDP or ZeRO; quantization or LoRA/QLoRA for fine-tuning; shorter sequence length.
