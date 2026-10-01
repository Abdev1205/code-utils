## In one line

A node is one of the computers in your cluster that actually runs your program, and it keeps asking the cluster's "brain" what work it should be doing.

## The everyday version

Picture a parcel company. Head office keeps a dispatch board: "Depot 3 holds parcels 41 and 42." Head office never phones depots with orders. Each depot has a clerk who walks to the board every few seconds, reads the lines with their depot's name, and loads the vans. When a van is loaded, the clerk writes "done" next to the line.

If a clerk stops checking in, head office assumes the depot has closed and rewrites those lines for another depot. In Kubernetes, the depot is the **node**, the clerk is the **kubelet**, the board is the **API server**, and the parcels are **Pods**. Each term is defined below.

## How it actually works

A **node** is one machine, either physical or a virtual machine (VM, a software-simulated computer). It has CPU (central processing unit) and memory, and it can run containers. A **container** is your program packaged with everything it needs. A **Pod** is the smallest thing Kubernetes places: one or more containers that always run together on one node.

The **control plane** is the set of programs that records what you want and decides where it runs. Its front door is the **API server** (API = application programming interface), which is what `kubectl` talks to.

Every node runs two key programs:

- **kubelet**: the agent that talks to the control plane and makes the node match it.
- **container runtime** (usually containerd): the program that pulls images and starts containers.

Here is the life of a node and a Pod:

1. The machine boots and the kubelet starts. It registers with the API server, which creates a Node record listing the machine's size.
2. The kubelet sends a heartbeat (it renews a small record called a Lease) about every 10 seconds.
3. You run `kubectl apply`. The control plane stores a Pod with no node assigned.
4. The **scheduler**, a control-plane program, picks a node with enough free room. It does this by writing that node's name into the Pod record. It never contacts the node.
5. Each kubelet is watching the API server for Pods carrying its own node name. Yours sees the new one.
6. The kubelet tells the container runtime to pull the image and start the container, then reports status back.

If heartbeats stop for about 40 seconds, the control plane marks the node `NotReady`. By default it waits roughly 5 more minutes (300 seconds) before evicting the node's Pods so they can be rescheduled elsewhere.

Not all of a node's size is usable. A node with 4 CPU and 16 GiB (gibibytes, about 1.07 GB each) of memory reports two figures:

| Field | Example | Meaning |
|---|---|---|
| Capacity | 4 CPU, 16 GiB | What the machine physically has |
| Allocatable | 3920m, ~14.6 GiB | What Pods can use after reserving room for the operating system (OS) and kubelet |

The `m` stands for millicores, where 1000m is one CPU core.

## In your setup

First confirm you are pointed at the right place:

```
kubectl config current-context
```

This should name {{env:KUBE_CLUSTER_NAME}}. Then list its nodes:

```
kubectl get nodes -o wide
```

Expect one row per machine, shaped like this (the values are illustrative):

```
NAME       STATUS   ROLES    AGE   VERSION   INTERNAL-IP   OS-IMAGE             CONTAINER-RUNTIME
worker-1   Ready    <none>   41d   v1.31.2   10.0.1.14     Ubuntu 22.04.5 LTS   containerd://1.7.22
worker-2   Ready    <none>   41d   v1.31.2   10.0.1.15     Ubuntu 22.04.5 LTS   containerd://1.7.22
```

How to read it:

- **STATUS**: `Ready` means heartbeats are arriving. `NotReady` means the control plane has stopped hearing from that kubelet.
- **AGE**: how long the node has been registered. A very young node usually means it was recently replaced or added.
- **VERSION**: the kubelet's version, not your app's.
- **INTERNAL-IP** (IP = Internet Protocol address): the node's address inside the private network.
- **CONTAINER-RUNTIME**: what actually starts your containers.

On many managed clusters the control-plane machines are hidden, so you only see worker nodes.

To see the capacity and allocatable figures, run `kubectl describe node worker-1`. Look at the `Capacity`, `Allocatable`, and `Allocated resources` sections. This command only reads.

## Why it matters

A team deploys a service with 3 replicas (copies), each asking for 3 CPU. The cluster has 3 nodes of 4 CPU each, so they reason that 9 CPU needed against 12 available is fine.

The Pods stay `Pending` for hours. `kubectl describe pod` shows `0/3 nodes are available: 3 Insufficient cpu`. Each node reserves some CPU for the OS and kubelet and already runs about 1.5 CPU of other Pods. That leaves roughly 2.4 CPU free per node. A Pod can't be split across machines, and no single node has 3 CPU free.

The team spends an afternoon blaming their image and then scales the replica count up, which makes things worse. The actual fix is a smaller CPU request per Pod, or a bigger node.

Good looks like this. You think in per-node terms, not cluster totals. You check `Allocatable` before sizing requests. When a node goes `NotReady`, you know it takes about 40 seconds to be noticed and about 5 more minutes before its Pods move, so you can explain the gap in service.

## Check yourself

1. **When you run `kubectl apply`, does the control plane send the Pod to the node?**
   *No. The scheduler only writes a node name into the Pod record, and that node's kubelet notices it by watching the API server.*

2. **What does a `NotReady` status actually tell you?**
   *The control plane has stopped receiving that node's kubelet heartbeats. It doesn't say why, and the cause could be the kubelet, the machine, or the network.*

3. **Why can a Pod stay `Pending` when the cluster's total free CPU looks sufficient?**
   *A Pod must fit on a single node's allocatable room, and capacity minus reservations and existing Pods can leave every node too full.*
