## In one line

A namespace is a labelled folder inside a cluster, so different teams or environments can use the same names without colliding.

## The everyday version

Think of street names. Almost every town has a "Main Street", and nobody is confused, because the full address includes the town. "12 Main Street" is ambiguous. "12 Main Street, Springfield" is not.

A namespace is the town. A **cluster** is a group of machines that Kubernetes manages as one pool for running your containers. Inside it you can have a `staging` town and a `production` town, each with its own Main Street, and the two never collide.

## How it actually works

Everything you create with `kubectl apply` is an **object**: a Deployment (the instruction "keep 3 copies of this app running"), a Service (a stable internal address for those copies), and so on. Most objects belong to exactly one namespace.

1. **Placement.** The manifest names a namespace, or you pass `-n staging`. If you do neither, the object lands in the namespace called `default`.
2. **Uniqueness.** The API server, the cluster's front door that stores every object, identifies an object by *kind + namespace + name*. Two Deployments called `api` can coexist if they sit in different namespaces.
3. **Built-ins.** A fresh cluster already has four namespaces:

| Namespace | Holds |
|---|---|
| `default` | Anything you create without specifying one |
| `kube-system` | Kubernetes' own components (DNS, networking agents) |
| `kube-public` | Data readable by everyone, rarely used |
| `kube-node-lease` | Heartbeats from machines (nodes) |

4. **Name lookup.** Services get a **DNS** (Domain Name System, name-to-address lookup) entry shaped like `<service>.<namespace>.svc.cluster.local`. Inside the same namespace the short name `db` works. From another namespace you must write `db.production`.
5. **A few things are cluster-wide.** Nodes and namespaces themselves belong to no namespace.

```
$ kubectl get deployments -A        # -A = all namespaces
NAMESPACE    NAME   READY   UP-TO-DATE   AVAILABLE   AGE
production   api    3/3     3            3            41d
staging      api    1/1     1            1            9d
```

Two objects are both named `api`, and the NAMESPACE column is what tells them apart.

**A namespace is not a security wall.** By default, a pod (the smallest runnable unit, one or more containers) in `staging` can still reach a pod in `production` over the network. Real isolation comes from other tools, which you'll meet later. These are RBAC (role-based access control, who may do what), NetworkPolicy (who may talk to whom) and ResourceQuota (how much CPU and memory a namespace may use).

## In your setup

Run this against {{env:KUBE_CLUSTER_NAME}}:

```
kubectl get ns
```

The output looks like this. The names and ages below are illustrative:

```
NAME              STATUS   AGE
default           Active   212d
kube-node-lease   Active   212d
kube-public       Active   212d
kube-system       Active   212d
payments          Active   87d
staging           Active   64d
```

- **NAME** is the namespace. The four built-ins are there, and the rest were created by people at your organisation.
- **STATUS** is normally `Active`. `Terminating` means someone deleted it and Kubernetes is still removing everything inside.
- **AGE** is time since creation.

Two companion checks, both read-only:

- `kubectl config current-context` shows which cluster your commands are going to.
- `kubectl config view --minify | grep namespace` shows your default namespace. No output means you are using `default`.

If `get ns` returns `Forbidden`, nothing is broken. Your account lacks permission to list namespaces cluster-wide, and `kubectl get pods -n <name>` will still work for namespaces you can access.

## Why it matters

A backend engineer deploys a service, runs `kubectl get pods`, and sees `No resources found in default namespace.` They conclude the deploy failed and re-apply it. This time the app starts, but it crashes with `dial tcp: lookup db on 10.96.0.10:53: no such host`.

The first apply had worked and the pods were running in `staging`. The re-apply, without `-n`, created a second copy in `default`. There, the short name `db` doesn't resolve, because the database Service lives in `staging`.

The cost is an hour of confused debugging and an orphan Deployment burning 3 replicas of CPU. The next engineer to run `kubectl delete deployment api` may then delete the wrong one.

Good looks like this:

- Every command carries `-n <namespace>`, or your context's default namespace is set deliberately.
- Nothing real lives in `default`.
- You treat "not found" as "not found *in this namespace*" before concluding anything is missing.

## Check yourself

1. Two teams each create a Deployment named `api`. Under what condition does Kubernetes accept both?
   *Only if they're in different namespaces, because the unique key is kind + namespace + name.*

2. You run `kubectl apply -f app.yaml` with no `-n` flag and no namespace in the file. Where does the object go?
   *Into the `default` namespace, unless your context sets a different default.*

3. A pod in `staging` calls `db`, and the database Service is in `production`. What must change, and does the namespace stop the traffic?
   *Call `db.production`; the namespace is a naming boundary, not a network or security boundary.*
