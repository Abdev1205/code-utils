## In one line

A Deployment is a standing instruction to Kubernetes: "always keep this many copies of my app running," and Kubernetes keeps that promise even when machines fail or you ship a new version.

## The everyday version

Picture a café that must always have four baristas on shift. The manager doesn't hire anyone personally. They post a staffing plan: "4 baristas, trained on handbook v1.4." A shift supervisor holds the roster for that handbook version. If someone walks out, the supervisor calls in a replacement. If a fifth shows up, one goes home.

When handbook v1.5 arrives, the manager doesn't close the café. A new roster is started for v1.5. One v1.5 barista starts, then one v1.4 barista leaves, and so on until the shift is all v1.5. The old roster stays in the drawer, empty but kept, so you can go back to v1.4 in a minute if v1.5 is a disaster.

The plan is the **Deployment**. Each roster is a **ReplicaSet**. The baristas are **Pods**.

## How it actually works

A few terms first. A **pod** is the smallest thing Kubernetes runs: one or more containers (running copies of your image) sharing a network address. A **replica** is one copy of a pod. A **manifest** is the YAML file describing what you want.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
spec:
  replicas: 4
  selector:
    matchLabels: {app: orders-api}
  template:
    metadata:
      labels: {app: orders-api}
    spec:
      containers:
      - name: api
        image: orders-api:1.4
```

The `template` is the blueprint for each pod. The `selector` is a label query ("pods tagged `app=orders-api`") that says which pods belong to this Deployment.

1. You apply the manifest. The Deployment controller creates a ReplicaSet named `orders-api-<hash>`. A **controller** is a loop that compares desired state to actual state and fixes the difference, forever. The hash is computed from the pod template.
2. The ReplicaSet controller counts pods matching the selector. It sees 0, wants 4, and creates 4.
3. A pod dies. The count drops to 3 and the ReplicaSet creates a replacement within seconds.
4. You change the image to `1.5`. The template hash changes, so the Deployment creates a **second** ReplicaSet. Changing only `replicas` doesn't do this. It just resizes the existing one.
5. The Deployment shifts pods across gradually. By default it may run 25% extra (`maxSurge`) and tolerate 25% unavailable (`maxUnavailable`). With 4 replicas that means 1 extra and 1 missing at most:

| Step | New RS (1.5) | Old RS (1.4) | Total |
|---|---|---|---|
| Start | 0 | 4 | 4 |
| Surge | 1 | 4 | 5 |
| Old one removed | 1 | 3 | 4 |
| …repeat… | 4 | 0 | 4 |

A new pod only counts as ready once its **readiness probe** passes. That is a check Kubernetes runs to decide whether a pod may receive traffic. No probe means "ready" as soon as the process starts, which is rarely true.

## In your setup

Confirm you're pointed at {{env:KUBE_CLUSTER_NAME}}, then look at both layers. All of these are read-only:

```
kubectl config current-context
kubectl get deployments -A
kubectl get replicasets -A
```

The Deployment output looks like this:

```
NAMESPACE  NAME        READY  UP-TO-DATE  AVAILABLE  AGE
shop       orders-api  4/4    4           4          12d
```

`READY 4/4` means four of four wanted pods are serving. `UP-TO-DATE` is how many run the latest template. If `UP-TO-DATE` is lower than `READY`, a rollout is in progress or stuck.

The ReplicaSet output looks like this:

```
NAMESPACE  NAME                  DESIRED  CURRENT  READY  AGE
shop       orders-api-7d9c6b5f8  4        4        4      2d
shop       orders-api-6b8f94c7d  0        0        0      12d
```

The row with non-zero numbers is live. The zero rows are your rollback history, and Kubernetes keeps 10 by default (`revisionHistoryLimit`). To see a rollout's story, run `kubectl describe deployment orders-api -n shop` and read the `NewReplicaSet`, `OldReplicaSets` and `Events` sections.

## Why it matters

A team ran `kubectl apply` with a typo in the image tag (`orders-api:1.5.0` instead of `1.5`). The command printed "configured" and everyone moved on. The new pod sat in `ImagePullBackOff` (it couldn't download the image), and it never became ready, so the rollout stalled at one new pod and three old ones. Kubernetes did the safe thing and kept the old pods serving.

Nobody noticed for six hours. The team assumed 1.5 was live, so a database migration written for 1.5 was running against 1.4 code. The cost was a morning of confusing support tickets and a rushed rollback.

Good looks like this:
- Treat `apply` as the start of a deploy, not the end.
- Run `kubectl rollout status deployment/orders-api` and wait for it to finish.
- Define readiness probes.
- Know that `kubectl rollout undo deployment/orders-api` scales the previous ReplicaSet back up.
- Never edit pods by hand, because the ReplicaSet will simply replace them.

## Check yourself

1. You delete one pod from a 4-replica Deployment. What happens, and which object notices?
   *The ReplicaSet sees 3 of 4, creates a replacement pod within seconds, and you're back to 4.*

2. You change only the image tag in the manifest. What new object appears, and what happens to the old one?
   *A new ReplicaSet (new template hash) scales up while the old one scales down to 0, and the old one is kept for rollback.*

3. `kubectl get deploy` shows `READY 3/4`, `UP-TO-DATE 1`. What's your first read?
   *A rollout is in progress or stuck. Check `rollout status` and the new pod's events, for example for an image pull failure or a failing readiness probe.*
