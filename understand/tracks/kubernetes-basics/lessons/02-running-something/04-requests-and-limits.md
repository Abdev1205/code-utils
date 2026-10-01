## In one line

A request is the amount of computer power your app is promised, and a limit is the ceiling it is not allowed to cross.

## The everyday version

Picture a coworking space. You book 2 desks, and those desks are yours even if you stay home. That is your **request**. The building also has a fire-code maximum: you can bring guests, but never more than 5 people in your room. That is your **limit**.

The two limits don't behave the same way. If your team is too big, the front desk slows you at the door, which is annoying but survivable. If you bring too many chairs, the fire marshal throws someone out. CPU is the slow queue. Memory is the marshal.

## How it actually works

Some terms first. A **container** is your app running in isolation. A **pod** is the unit Kubernetes schedules, holding one or more containers. A **node** is one machine in the cluster. The **scheduler** is the component that decides which node each pod runs on.

You declare both numbers per container:

```yaml
containers:
  - name: api
    image: my-api:1.4.2
    resources:
      requests:
        cpu: 250m
        memory: 256Mi
      limits:
        cpu: 500m
        memory: 512Mi
```

`cpu: 250m` means 250 **millicores**, a quarter of one CPU core (1000m = 1 core). `Mi` is mebibytes, roughly a megabyte each.

What happens next:

1. The scheduler adds up the **requests** of pods already on each node. It places your pod only on a node with enough unreserved capacity. Limits play no part in placement.
2. If no node fits, the pod sits in `Pending` with an event like `0/3 nodes are available: 3 Insufficient cpu`.
3. Once the pod is running, the Linux kernel enforces the **limits** using **cgroups** (control groups, a kernel feature that meters a group of processes).
4. Over its **CPU limit**, the container is **throttled**: paused in tiny slices so it averages out under the cap. It gets slower but stays alive.
5. Over its **memory limit**, memory can't be taken back, so the kernel's **OOM killer** (OOM = out of memory) kills the process. Kubernetes records `OOMKilled`, exit code 137, and restarts the container.

| | Request | Limit |
|---|---|---|
| Who reads it | Scheduler, and CPU sharing when the node is busy | Kernel |
| Exceeding CPU | Fine if spare capacity exists | Throttled |
| Exceeding memory | Fine until the node is tight, then you're evicted first | Killed |

Kubernetes also ranks pods by **QoS** (quality of service) class. `Guaranteed` means requests equal limits. `Burstable` means some are set. `BestEffort` means none are set, and those pods are the first to be evicted when a node runs short.

## In your setup

On cluster {{env:KUBE_CLUSTER_NAME}}, run this read-only command:

```
kubectl describe node | grep -A5 "Allocated resources"
```

You get one block per node, shaped like this:

```
Allocated resources:
  (Total limits may be over 100 percent, i.e., overcommitted.)
  Resource           Requests      Limits
  --------           --------      ------
  cpu                1850m (46%)   4200m (105%)
  memory             3200Mi (41%)  6400Mi (82%)
```

Read it like this:

- **Requests** is the sum of every pod's requests on that node. The percentage is of what the node can offer (its *allocatable* capacity). This is the number the scheduler uses.
- **Limits** is the sum of all ceilings. Going over 100% is normal. It is a bet that pods won't all peak together.
- **This is reserved capacity, not live usage.** A node at 90% requests can be nearly idle and still refuse new pods.

To see one pod's numbers and its last crash reason, run `kubectl describe pod <pod-name>`. Look under `Limits`, `Requests` and `Last State`.

## Why it matters

A team ships a service with `memory: 256Mi` as the limit because "it used about 200Mi in testing". In production a burst of large payloads pushes it to 260Mi. The kernel kills it with no warning and no chance to write a log line.

The service restarts every 40 minutes or so and drops in-flight requests. The logs look clean, so engineers lose hours looking for a bug that isn't in the code. The answer is in `kubectl describe pod`:

```
Last State:  Terminated
  Reason:    OOMKilled
  Exit Code: 137
```

The opposite mistake costs money. Ten replicas that each request 2 cores but use 200m reserve 20 cores to run 2. Nodes look full, new pods go `Pending`, and you pay for machines that sit idle.

Good looks like this:

- Measure real usage first, then add headroom.
- Set the memory request equal to the memory limit.
- Set the CPU request near typical usage.
- Keep CPU limits generous, or omit them, so throttling doesn't quietly add latency.

## Check yourself

1. **What does the scheduler look at when it decides where to place a pod, requests or limits?**
   *Requests. It sums them per node and picks one with enough unreserved capacity. Limits are ignored.*

2. **A container exceeds its CPU limit, and a different one exceeds its memory limit. What happens to each?**
   *The CPU one is throttled and slows down. The memory one is OOM-killed (exit code 137) and restarted.*

3. **Your pod restarts every 40 minutes and the logs show no errors. What command do you run, and what do you look for?**
   *`kubectl describe pod <pod-name>`, then check `Last State` for `Reason: OOMKilled` and `Exit Code: 137`.*
