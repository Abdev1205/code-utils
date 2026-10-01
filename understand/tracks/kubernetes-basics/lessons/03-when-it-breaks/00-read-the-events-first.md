## In one line

When something in a cluster goes wrong, the system usually writes down exactly why, and you read that note before you start guessing.

## The everyday version

A courier tries to deliver a parcel and leaves a card on your door: "Nobody home, 2:14 pm" or "Address not found." Most people ignore the card and phone the sender to complain. The card already says what happened.

Kubernetes leaves cards too, and they are called **events**. Two different people write them. A dispatcher decides which van takes the parcel, and a driver actually tries the door. Each card says who wrote it and why it failed. The cards get thrown away after about an hour, so read them while they're fresh.

## How it actually works

Some terms first:

- **Cluster**: the group of machines that runs your software.
- **Node**: one machine in the cluster.
- **Pod**: the smallest runnable unit, usually one container (your app, packaged) running on a node.
- **Scheduler**: the component that picks which node a new pod runs on.
- **Kubelet**: the agent on each node that pulls images and starts and stops containers.
- **Event**: a short record, stored in the cluster, that the scheduler, kubelet or another component writes when something notable happens.

A pod's life, and where the events come from:

1. You deploy. A pod is created and sits in `Pending`, meaning it has no node yet.
2. The scheduler looks for a node with enough free CPU and memory. If none fits, it writes a `FailedScheduling` event and the pod stays `Pending`.
3. Once a node is chosen, that node's kubelet pulls the image and writes `Pulling`, `Pulled`, `Created` and `Started`. If the pull fails, it writes `Failed`.
4. If the container later crashes, the kubelet restarts it with a growing delay and writes `BackOff`.
5. Each event expires after about an hour by default.

| Reason | Written by | Plain English |
|---|---|---|
| `FailedScheduling` | scheduler | No node has room, or none is allowed |
| `Failed` / `ErrImagePull` | kubelet | Image missing, wrong tag, or no registry access |
| `FailedMount` | kubelet | A volume or secret the pod needs isn't available |
| `Unhealthy` | kubelet | A health check (**probe**) is failing |
| `BackOff` | kubelet | The container keeps crashing and is being retried |

The same events appear at the bottom of `kubectl describe pod <name>`, filtered to that one pod. `describe` means "show everything the cluster knows about this object."

## In your setup

Run this against {{env:KUBE_CLUSTER_NAME}}:

```bash
kubectl config current-context        # confirm you're pointed where you think
kubectl get events --sort-by=.lastTimestamp | tail -20
```

Both commands only read. Sorting by time puts the newest event last, and `tail -20` keeps the final twenty lines. The output looks like this:

```
LAST SEEN   TYPE      REASON             OBJECT                      MESSAGE
4m          Normal    Scheduled          pod/checkout-7d9f6-x2k4p    Successfully assigned default/checkout-7d9f6-x2k4p to node-3
4m          Normal    Pulling            pod/checkout-7d9f6-x2k4p    Pulling image "registry.example.com/checkout:v2.4.1"
3m          Warning   Failed             pod/checkout-7d9f6-x2k4p    Failed to pull image: manifest unknown
2m          Warning   BackOff            pod/checkout-7d9f6-x2k4p    Back-off pulling image
```

Read it in this order:

1. Find the `Warning` rows. `Normal` rows are routine.
2. Look at `OBJECT` to see which pod is affected.
3. Read `MESSAGE` closely. Here "manifest unknown" means the tag `v2.4.1` doesn't exist in the registry.
4. Run `kubectl describe pod checkout-7d9f6-x2k4p` for the full per-pod history.

If the output is empty, either the events expired (over an hour old) or you're in the wrong **namespace** (a named partition of the cluster). Add `-A` to `get events` to search all namespaces.

One limit to know: an out-of-memory kill (**OOM**, when the kernel stops a container for exceeding its memory limit) often doesn't show up as an event. Look in `describe` under `Last State` for `Reason: OOMKilled`.

## Why it matters

An engineer ships a new version and the pods sit in `Pending`. They open the application logs and find nothing. They assume a bug, restart the deployment three times, then raise replicas from 3 to 10 "to be safe." Forty minutes pass.

The whole time, one event said `0/4 nodes are available: 4 Insufficient cpu`. The pods asked for more CPU than any node had free, so no container ever started and there were no logs to read. Raising the replica count made it worse, because it requested even more CPU.

The cost was forty minutes of degraded service and a bigger problem than they started with. Reading events first would have taken thirty seconds.

Good practice is simple. A pod that isn't working gets events first, then `describe`, then logs. Events explain why the container never started, and logs explain what it did once it was running.

## Check yourself

1. **Which two components write most of the events you'll read, and what does each one decide or do?**
   *The scheduler picks the node for a pod, and the kubelet on that node pulls the image and runs the container.*

2. **A pod is `Pending` and its logs are empty. Why, and where do you look instead?**
   *No container has started, so there are no logs; read events with `get events` or `describe pod`, where `FailedScheduling` explains it.*

3. **You run the events command and get nothing back. Name two likely reasons.**
   *The events expired after about an hour, or you're in the wrong namespace (try `-A`).*
