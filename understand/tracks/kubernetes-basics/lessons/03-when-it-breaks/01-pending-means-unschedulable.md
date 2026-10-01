## In one line

A pod stuck in `Pending` has been accepted by the cluster, but no machine in it can currently offer what the pod asked for.

## The everyday version

Picture a restaurant host with a party of six. The host doesn't care how hungry anyone is. They check the floor plan for a table that seats six. Every big table might be booked, or the only free one might carry a "private event" sign. The party could also need a wheelchair-accessible table, and the host might find none. The party waits at the door, not at a table.

Kubernetes works the same way. The host checks the reservation (what the pod *requested*), not how busy the kitchen actually is. A restaurant can look half-empty and still have no table for six.

## How it actually works

A **pod** is one running copy of your application. A **node** is one machine, virtual or physical, that runs pods. The **scheduler** is the cluster component that picks a node for each new pod. Until it picks one, the pod's status is `Pending`.

The scheduler works in two steps:

1. **Filter:** drop every node that can't host the pod.
2. **Score:** pick the best of the survivors.

If filtering leaves zero nodes, the pod stays `Pending` and the scheduler retries. It also records *why* every node was rejected.

The usual reasons:

| Message in the events | Plain meaning |
|---|---|
| `Insufficient cpu` / `Insufficient memory` | Your pod's **request** doesn't fit in what's left on any node |
| `untolerated taint` | A **taint** (a "keep out unless you're allowed" mark on a node) blocks the pod, and the pod has no matching **toleration** (its permission slip) |
| `didn't match Pod's node affinity/selector` | The pod demands node labels that no node has |
| `unbound immediate PersistentVolumeClaims` | The pod needs storage (a **PersistentVolumeClaim**, a request for a disk) and no disk has been provided |
| `volume node affinity conflict` | The disk exists, but in a zone where no eligible node lives |

A **request** is the amount of CPU (central processing unit) or memory a pod reserves, written in the pod spec. CPU is measured in **millicores**, where `1000m` is one core. The scheduler adds up *requests*, not live usage.

Worked example: a node has `4000m` allocatable. Existing pods request `3500m` but actually use `400m`. Your new pod requests `1000m`. Only `500m` is unreserved, so the pod doesn't fit. The node is 10% busy and still "full".

Here is what the scheduler leaves behind:

```
Events:
  Type     Reason            Age   From               Message
  Warning  FailedScheduling  2m    default-scheduler  0/5 nodes are available:
    3 Insufficient cpu, 1 node(s) had untolerated taint {dedicated: gpu},
    1 node(s) didn't match Pod's node affinity/selector.
```

The numbers add up to the 5 nodes in the cluster: 3 + 1 + 1. Every node is accounted for, so the message tells you what to fix.

A caveat: if the scheduler *did* place the pod and the disk then fails to attach, the status is `ContainerCreating`, not `Pending`. That is a different lesson.

## In your setup

First, confirm `kubectl` points at {{env:KUBE_CLUSTER_NAME}}:

```
kubectl config current-context
```

List every pod stuck in `Pending`:

```
kubectl get pods -A --field-selector=status.phase=Pending
```

Output looks like this:

```
NAMESPACE   NAME                    READY   STATUS    RESTARTS   AGE
payments    worker-7d9c5b6f4-x2k8q  0/1     Pending   0          14m
```

`0/1` ready and `RESTARTS 0` tell you the container never started. Now ask the scheduler for its reasoning:

```
kubectl describe pod worker-7d9c5b6f4-x2k8q -n payments
```

Scroll to the **Events** section at the bottom and read the `FailedScheduling` line. To see these across {{env:KUBE_CLUSTER_NAME}} at once:

```
kubectl get events -A --field-selector reason=FailedScheduling
```

If the cause is `Insufficient cpu`, check how much each node has reserved:

```
kubectl describe nodes | grep -A 8 "Allocated resources"
```

Compare the `cpu` *requests* percentage with the pod's request. If requests sit at 90% or more on every node, you've found the cause. For storage causes, run `kubectl get pvc -A` and look for a claim whose `STATUS` is `Pending` instead of `Bound`.

## Why it matters

Imagine a Friday deploy of a payment worker, six replicas. Someone copied `cpu: 2` from a load-test config, but the service really uses `200m`. Three new pods schedule. Three sit `Pending`, so the rolling update stalls at 3 of 6 new pods. Dashboards show nodes at 12% CPU, so the team assumes the cluster is fine and spends 90 minutes suspecting the application, its logs and the network.

The container never started, so there were no logs to read. The answer was in one `kubectl describe` away.

The cost was a stalled release and an hour of guessing. A wrong guess can be worse, such as adding nodes when a typo in a node selector was the cause.

Good looks like this:

- When a pod is `Pending`, you read the Events first and logs second.
- Requests are sized from observed usage, with some headroom.
- You alert when a pod has been `Pending` for more than 5 minutes.

## Check yourself

1. **A node shows 10% CPU usage, yet your pod says `Insufficient cpu`. How?**
   *The scheduler counts the sum of pod requests, not live usage, and the reserved total leaves too little room.*

2. **Why does `kubectl logs` on a `Pending` pod return nothing useful?**
   *No container ever started, so there are no logs. The evidence is in the scheduler's events.*

3. **An event says `0/5 nodes are available: 4 untolerated taint, 1 Insufficient memory`. What are your two options?**
   *Add a matching toleration so the pod can use the tainted nodes, or lower the memory request so it fits the one untainted node.*
