## In one line
Your app tried to use more memory than the cap it was given, so the system shut it down instantly. The app wasn't broken. The cap was too low for the job.

## The everyday version
Think of a prepaid electricity meter. You buy 500 units, and the moment you use the 501st, the power cuts. Your fridge isn't faulty and the wiring is fine. The meter is doing exactly what the plan says.

Restarting is like flipping the breaker back on. Everything runs happily until you hit the cap again. The cap was a number someone chose. That is OOMKilled: "OOM" means *out of memory*, and the meter is a line in your deployment file.

## How it actually works
A Kubernetes **pod** is the unit that runs your container. Each container can declare two memory numbers:

| Setting | Meaning | If you exceed it |
|---|---|---|
| `requests.memory` | What the **scheduler** (the part that picks which machine runs the pod) reserves for you | Nothing happens |
| `limits.memory` | The hard ceiling | The container is killed |

Memory is different from CPU. A process over its CPU limit is *throttled*, meaning slowed down. Memory can't be taken back from a running program, so the only option is to kill it.

What happens, step by step:

1. Your manifest says `limits: memory: 512Mi`. (`Mi` is a mebibyte, 1,048,576 bytes, so this is 536,870,912 bytes. `M` without the `i` means 1,000,000 and is easy to mix up.)
2. The **kubelet** (the agent on each machine that runs pods) has the container runtime create a **cgroup**. This is a Linux feature that caps the resources of a group of processes. Its ceiling is that byte count.
3. Your process allocates memory: caches, buffers, a big query result. Usage climbs toward the ceiling.
4. The kernel tries to reclaim memory, such as file cache. If that isn't enough, its **OOM killer** sends `SIGKILL` (signal 9) to a process in the cgroup.
5. `SIGKILL` cannot be caught. Your code gets no handler, no graceful shutdown and no final log line.
6. The container exits with code **137**, which is 128 + 9, meaning "died from signal 9."
7. The kubelet records `Reason: OOMKilled` and restarts the container. After repeated kills it waits 10s, 20s, 40s and so on, up to 5 minutes between attempts. That state is `CrashLoopBackOff`.

If a pod has *no* limit, the node itself can run dry and the kubelet **evicts** pods (`Reason: Evicted`). That is a different failure with a different cause.

## In your setup
First confirm you're pointed at the right place. `kubectl config current-context` should correspond to {{env:KUBE_CLUSTER_NAME}}.

Then list pods across all namespaces:

```
kubectl get pods -A
NAMESPACE   NAME                      READY   STATUS             RESTARTS      AGE
payments    report-api-6d9f7c-x2k8q   0/1     CrashLoopBackOff   6 (45s ago)   18m
```

A climbing `RESTARTS` count is the first clue, but it doesn't say *why*. Ask the pod:

```
kubectl describe pod report-api-6d9f7c-x2k8q -n payments
```

Read the `Containers:` block:

```
    State:          Waiting
      Reason:       CrashLoopBackOff
    Last State:     Terminated
      Reason:       OOMKilled
      Exit Code:    137
      Started:      09:12:03
      Finished:     09:14:47
    Limits:
      memory:  512Mi
```

Read **Last State**, not State. State only shows what the container is doing right now, which is waiting to retry. Last State holds the cause of death:

- `OOMKilled` with exit code 137 means the memory limit.
- `Error` with exit code 1 means your code exited on its own.

Started to Finished is 2m44s. It ran under three minutes before hitting the ceiling, which hints at how fast memory grows.

To find every OOMKilled container at once:

```
kubectl get pods -A -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name}{"\t"}{.status.containerStatuses[*].lastState.terminated.reason}{"\n"}{end}' | grep OOMKilled
```

Also run `kubectl logs <pod> -n <namespace> --previous`, which shows the *dead* container's logs. If they stop mid-flow with no error or stack trace, that fits `SIGKILL`.

## Why it matters
A team sees a crash-looping `report-api`. They read the logs, find no exception, and spend a day hunting a bug that doesn't exist. The real cause was a nightly export that loads 700 MB of rows into memory, against a 512Mi limit. Every run killed the pod mid-request. Customers got 502 errors, retries piled onto the next restart, and the on-call engineer lost a night.

Misreading OOMKilled costs hours, because you debug code when you should be reading a number. The reverse mistake is also expensive. Setting limits absurdly high "to be safe" wastes money and hides leaks until a node fills up.

Good looks like this:
- Limits come from observed peak usage plus headroom. Check with `kubectl top pod`, which needs **metrics-server**, a cluster add-on that reports live usage.
- Runtimes know about the limit, for example `-XX:MaxRAMPercentage=75` on Java or `--max-old-space-size` on Node.
- Alerts fire on restart counts and OOMKilled reasons before users notice.

## Check yourself
1. A pod shows `CrashLoopBackOff`. Which field in `kubectl describe` tells you whether memory was the cause?
   *Last State → Reason: `OOMKilled`, with Exit Code 137.*

2. Why does exceeding a CPU limit slow your app, while exceeding a memory limit kills it?
   *CPU can be shared out over time, but memory already handed to a process can't be taken back, so the kernel kills it.*

3. Your logs end abruptly with no error just before each restart. What does that suggest, and why is there no stack trace?
   *An OOM kill. `SIGKILL` can't be caught, so the process never gets to log anything.*
