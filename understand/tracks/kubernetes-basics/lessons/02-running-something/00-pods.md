## In one line

A pod is the smallest unit Kubernetes will run for you: one or more programs that start together, stop together, and share one network address.

## The everyday version

Think of a rented flat. It has one street address and one front door. The flatmates inside (the containers) share that address, the same Wi-Fi and the same fridge, and they move in and out together. Visitors write to the flat's address, never to an individual flatmate.

The building doesn't maintain the flat, though. If it burns down, nobody rebuilds it, and any replacement gets a different address. That's why you rarely create pods yourself. You hire a property manager (a Deployment, covered in a later lesson) whose job is to keep a set number of flats occupied.

## How it actually works

Terms first:
- An **image** is a packaged, read-only copy of your app and its dependencies.
- A **container** is a running process started from an image and isolated from its neighbours.
- A **node** is a machine in the cluster, usually a virtual one, that runs pods.

Here is the smallest possible pod, in YAML (a config format that uses indentation):

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: hello
spec:
  containers:
    - name: web
      image: nginx:1.27
```

After `kubectl apply -f pod.yaml`:

1. kubectl sends the manifest to the **API server**, the cluster's front door. It stores the manifest in **etcd**, the cluster's database.
2. The **scheduler** sees a pod with no node assigned. It picks a node with enough free CPU and memory and records the choice.
3. The **kubelet**, the agent on every node, notices a pod assigned to it. It tells the container runtime to pull the image and start the containers.
4. The cluster network gives the pod one IP address (Internet Protocol address), such as `10.244.1.17`. All containers in the pod share it and reach each other on `localhost`.
5. The kubelet reports status back, and you see `Pending` become `Running`.

Two consequences follow:
- A pod is never repaired or moved. If its node dies, the pod is gone. A replacement is a new pod with a new name and a new IP.
- A crashed *container* restarts in place, so the pod survives and its RESTARTS counter goes up.

Most pods hold one container. A second container is a **sidecar**, a helper such as a log shipper that must share the app's network and disk.

| STATUS | Meaning |
|---|---|
| `Pending` | Accepted, not running yet. No node fits, or the image is still downloading. |
| `ImagePullBackOff` | The image can't be downloaded: wrong tag, or missing registry credentials. |
| `CrashLoopBackOff` | The container starts, exits and restarts. Kubernetes waits longer each time, up to 5 minutes. |
| `Completed` | The process exited with code 0. Normal for one-off jobs. |

## In your setup

Your cluster is {{env:KUBE_CLUSTER_NAME}}. Your workloads live in the namespace {{env:KUBE_NAMESPACE}}. A namespace is a named partition of the cluster, like a folder.

```
kubectl get pods -n {{env:KUBE_NAMESPACE}}
```

The output looks like this (names are illustrative):

```
NAME                         READY   STATUS             RESTARTS      AGE
orders-api-7d9f8b6c5-x2k4p   1/1     Running            0             3d
orders-api-7d9f8b6c5-9qtlm   1/1     Running            0             3d
billing-worker-5c8d6f-hq7zv  0/1     CrashLoopBackOff   14 (2m ago)   41m
debug-shell                  1/1     Running            0             19d
```

How to read it:
- **READY** is containers passing their health check, over total containers. `0/1` means traffic won't be sent to it.
- **RESTARTS** counts container restarts. 14 in 41 minutes means a crash loop.
- **AGE** is how long this pod has existed, not how long the app has existed.
- **NAME** tells you who made it. Two hash-like chunks (`-7d9f8b6c5-x2k4p`) mean a Deployment created it, so it will be replaced if it dies. A plain name like `debug-shell` was made by hand, and nothing will recreate it.

For more detail, add `-o wide` to see each pod's IP and node. `kubectl describe pod <name>` ends with an **Events** list, which is the scheduler's and kubelet's own account of what went wrong.

## Why it matters

The pod is where nearly every security setting is applied. It's also where an attacker lands. Suppose someone gets code execution in your app, for example through a deserialization bug. They are now inside a pod, and they inherit three things:
- The pod's network position. By default any pod can reach any other pod's IP.
- Its **service account token**, a credential mounted as a file that lets the pod call the Kubernetes API.
- Its environment variables, which often hold secrets.

If the pod is *privileged* (allowed to act like root on the node) or mounts the node's filesystem, the attacker escapes the container and owns the node. In 2018, attackers found Tesla's Kubernetes dashboard exposed without a password. They started pods that mined cryptocurrency on Tesla's cloud account.

Good looks like this:
- Every pod is owned by a controller, so no hand-made strays like `debug-shell` sit around for 19 days.
- Containers run as non-root, are never privileged, and have CPU and memory limits.
- Service account tokens are mounted only where needed.
- Images come from an approved registry, pinned to a specific tag.
- **NetworkPolicies** (firewall rules between pods) restrict who can talk to whom.

## Check yourself

1. Two containers in the same pod both listen on port 8080. What happens, and why?
*They collide, because they share one IP and one set of ports. Siblings reach each other on `localhost`.*

2. A pod's node crashes. Does Kubernetes move the pod to a healthy node?
*No. A pod is never moved. A controller creates a new pod with a new name and IP, and a bare pod simply disappears.*

3. In `kubectl get pods`, what does `0/1 CrashLoopBackOff 14` tell you?
*The container starts and exits repeatedly and has restarted 14 times. It isn't ready, so it receives no traffic. Check `kubectl logs` and `kubectl describe pod`.*
