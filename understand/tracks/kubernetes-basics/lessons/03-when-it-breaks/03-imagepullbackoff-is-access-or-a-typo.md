## In one line
Kubernetes couldn't download the packaged copy of your app that it was told to run, almost always because the name is wrong or it wasn't given permission to fetch it.

## The everyday version
Picture a courier sent to a warehouse to collect a parcel. The slip says "Shelf B, parcel 1.4.3". There are three ways this goes wrong. The shelf holds 1.4.2, so the slip has a typo. The slip names a warehouse that doesn't exist. Or the warehouse is real, but the staff won't release anything without an ID badge the courier was never issued.

Each time, the courier comes back empty-handed. They don't give up, though. They wait a little, try again, then wait longer. The parcel was never the problem. The pickup was.

## How it actually works
A few terms first. An **image** is your app packaged with everything it needs to run. A **registry** is a server that stores images. A **node** is one machine in the cluster. A **pod** is the unit Kubernetes runs on a node, made of one or more containers. The **kubelet** is the agent on each node that starts them.

1. You apply a Deployment, which is the definition of what to run, containing `image: registry.example.com/payments/api:v1.4.3`.
2. The scheduler picks a node for the pod.
3. The node's kubelet asks the container runtime to fetch the image.
4. The runtime contacts the registry, which checks the name and your credentials.
5. If the fetch fails, the pod is marked `ErrImagePull`. The kubelet retries with exponential backoff, which means the wait doubles each time, from 10 seconds up to a 5-minute cap. While it waits, the status reads `ImagePullBackOff`.

So `ErrImagePull` is the failed attempt and `ImagePullBackOff` is the waiting. They describe the same fault.

An image name has three parts: host `registry.example.com`, repository `payments/api`, and **tag** `v1.4.3` (a label for one version). A mistake in any part is a failure. The error text tells you which:

| Message contains | Meaning |
|---|---|
| `not found` / `manifest unknown` | Tag or repository name is wrong |
| `no such host` | Registry hostname is misspelled |
| `unauthorized` / `pull access denied` / `403` | Missing or wrong credentials |
| `i/o timeout` | Node can't reach the registry (network) |

Private registries need an **imagePullSecret**. This is a Kubernetes Secret holding a registry login, named in the pod spec. It must sit in the same **namespace** (a named partition of the cluster) as the pod. A secret in the wrong namespace is a classic cause.

Some registries answer "denied" even when the repository doesn't exist, so they don't reveal what's hosted. A "denied" message can therefore still be a typo.

## In your setup
Confirm you're pointed at the right place with `kubectl config current-context`. It should match {{env:KUBE_CLUSTER_NAME}}. Then list pods:

```
kubectl get pods -n {{env:KUBE_NAMESPACE}}
NAME                  READY   STATUS             RESTARTS   AGE
api-7d9f8c6b5-x2k4q   0/1     ImagePullBackOff   0          4m12s
```

`READY 0/1` means the container never started. Don't bother with `kubectl logs` here. It will be empty, because there is no running app to produce logs. The evidence is in the pod's events:

```
kubectl describe pod {{env:POD_NAME}} -n {{env:KUBE_NAMESPACE}}
```

Scroll to the `Events:` section at the bottom:

```
Normal   Pulling  3m (x4 over 4m)  kubelet  Pulling image "registry.example.com/payments/api:v1.4.3"
Warning  Failed   3m (x4 over 4m)  kubelet  Failed to pull image ...: not found
Warning  Failed   3m (x4 over 4m)  kubelet  Error: ErrImagePull
Normal   BackOff  2m (x6 over 4m)  kubelet  Back-off pulling image
```

Read the `Failed` line and match it against the table above. Here it's `not found`, so the tag or repository is wrong. Next, print the exact image string and any secrets attached:

```
kubectl get pod {{env:POD_NAME}} -n {{env:KUBE_NAMESPACE}} \
  -o jsonpath='{.spec.containers[*].image}{"\n"}{.spec.imagePullSecrets}{"\n"}'
```

Compare the string character by character with what your registry lists. If the secrets output is empty and the registry is private, you've found the cause.

## Why it matters
A release goes out on a Friday. The pipeline pushed `1.4.2`, but the manifest says `v1.4.2`. The rollout stalls. Kubernetes keeps the old pods serving, so nothing visibly breaks and the deploy just never finishes. An engineer spends 40 minutes searching logs that don't exist. The answer was one `describe` away.

The credential version is worse. Images are fetched per node and cached, so running pods hide an expired registry token. Weeks later, traffic spikes and the autoscaler adds fresh nodes. None of them can pull the image, and capacity doesn't grow when you need it.

Good looks like this. You read Events first and let the message decide the fix. Tags are exact and never reused. The pipeline checks the image exists before deploying. Pull secrets are rotated on a schedule, and their expiry is tracked.

## Check yourself
1. Why is `kubectl logs` useless for an `ImagePullBackOff` pod, and what do you run instead?
   *No container ever started, so there are no logs. Run `kubectl describe pod` and read the Events.*
2. What's the difference between `ErrImagePull` and `ImagePullBackOff`?
   *`ErrImagePull` is a failed attempt. `ImagePullBackOff` is the growing wait (10 seconds up to 5 minutes) before the next one.*
3. The event says `unauthorized`. Name two things to check.
   *Whether an `imagePullSecret` is attached to the pod, and whether it's in the same namespace with valid credentials.*
