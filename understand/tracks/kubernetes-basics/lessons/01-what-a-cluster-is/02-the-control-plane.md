## In one line
The control plane is the cluster's front desk and filing system: it records what you want and makes sure something acts on it.

## The everyday version
Picture an office building with one reception desk and one locked ledger in the vault. Everyone goes through the desk, whether they're staff, visitors or facilities. The desk checks your pass, checks your form is filled in properly, and writes the request in the ledger. Nobody writes in the ledger directly, and nobody phones anyone else.

Facilities staff simply watch the ledger. They see "Meeting for 10 people, no room assigned", so the room allocator picks Room 4 and files that back through the desk. If the desk is rebuilt overnight, nothing is lost. If the ledger is lost, the building forgets everything it promised.

## How it actually works
Some terms first. A **cluster** is a group of machines run as one system. A **node** is one of those machines. A **pod** is the smallest unit Kubernetes runs: one or more containers placed together on a node. The **control plane** is the set of programs that decide what should run where.

| Piece | Job |
|---|---|
| **API server** (application programming interface server) | The only front door. Checks identity, permissions and validity, then reads and writes etcd. |
| **etcd** | A distributed key-value database. The only place state durably lives. |
| **Scheduler** | Picks a node for every pod that has none. |
| **Controllers** | Loops that compare desired state with actual state and act on the difference. |

Here is `kubectl apply -f orders-api.yaml`, a Deployment (an object meaning "keep 3 copies of this pod running"):

1. **kubectl calls the API server over HTTPS.** The server authenticates you, authorizes you (via RBAC, role-based access control) and validates the object.
2. **The API server writes it to etcd** under a key like `/registry/deployments/{{env:KUBE_NAMESPACE}}/orders-api`. etcd runs as 3 or 5 members and commits a write only when a majority agree. Only then does kubectl print `deployment.apps/orders-api created`.
3. **The Deployment controller** holds an open "watch" (a streaming subscription) on the API server. It sees the new object and creates a ReplicaSet, which keeps N identical pods alive. The ReplicaSet controller then creates 3 Pod *records*. They have an empty `nodeName` and status `Pending`. No container exists yet.
4. **The scheduler** sees pods with no node. It filters out nodes without enough free CPU and memory (say the pod requests `250m`, a quarter of a core, and `256Mi` of memory). It scores the rest and writes `nodeName: node-2` back through the API server.
5. **The kubelet**, the agent on node-2, also watching, sees a pod assigned to it. It tells the container runtime to pull the image and start it. That is the next lesson.

Components never call each other. Each one reads and writes through the API server, so the cluster is just records plus programs reacting to them.

## In your setup
Four read-only commands:

```bash
kubectl cluster-info
kubectl get --raw='/readyz?verbose'
kubectl get events -n {{env:KUBE_NAMESPACE}} --sort-by=.lastTimestamp -o wide
kubectl get pods -n kube-system
```

`cluster-info` prints `Kubernetes control plane is running at https://…`. That URL is the API server for {{env:KUBE_CLUSTER_NAME}}, and every kubectl command you've run went there.

`/readyz?verbose` lists the API server's health checks:

```
[+]ping ok
[+]etcd ok
[+]poststarthook/start-apiserver-informers ok
readyz check passed
```

A `[-]etcd failed` line means the front desk can't reach the ledger.

The events show steps 3 and 4 as they happened. The SOURCE column names the actor:

```
REASON             OBJECT                       SOURCE                  MESSAGE
ScalingReplicaSet  deployment/orders-api        deployment-controller   Scaled up replica set …to 3
SuccessfulCreate   replicaset/orders-api-7d9f   replicaset-controller   Created pod: orders-api-7d9f-x2k8p
Scheduled          pod/orders-api-7d9f-x2k8p    default-scheduler       Successfully assigned … to node-2
```

On a self-managed cluster, `kube-system` shows pods like `kube-apiserver-…`, `etcd-…` and `kube-scheduler-…`. On managed services (EKS, GKE, AKS), the provider hides the control plane, so you'll see none of these. `readyz` and events still work.

## Why it matters
A team runs its own control plane. Their etcd has a default storage quota of 2 GiB, and it slowly fills with Events and thousands of old Helm release Secrets. One afternoon etcd logs `mvcc: database space exceeded` and flips to read-only. Every `kubectl apply` fails. The autoscaler can't add pods and a crashed pod isn't replaced, because replacing it needs a write too.

The app keeps serving traffic, so the dashboards stay green. The team spends two hours debugging their deploy pipeline before anyone checks etcd. Their last backup is five weeks old and has never been test-restored.

Good looks like this:
- You know "kubectl hangs or errors" means the API server or etcd, not your app.
- etcd size is monitored.
- Backups are tested.
- You never treat anything but etcd as the source of truth.

## Check yourself
1. Why can't the scheduler start a container?
   *It only writes a `nodeName` onto a Pod record through the API server. The kubelet on that node starts the container.*

2. If the API server process is killed and restarted, what do you lose?
   *Nothing. State is in etcd, and the API server is stateless. Changes just can't be made while it's down.*

3. Where does state live if etcd is lost with no backup?
   *Nowhere. Running containers may carry on, but the cluster forgets every Deployment, Secret and ConfigMap it was told about.*
