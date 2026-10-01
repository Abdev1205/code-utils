## In one line

A Service is a permanent name and address that always leads to whichever copies of your app are running right now.

## The everyday version

Think of a company's main support number. Behind it, staff come and go: someone goes on holiday, someone new joins, desks get reshuffled and direct extensions change. Customers never learn any of that. They dial the main number and the switchboard connects them to someone who is in today.

A Service is that main number. The individual workers (Pods) are temporary, but the number you dial never changes. The switchboard also skips anyone who isn't at their desk.

## How it actually works

A **Pod** is the smallest thing Kubernetes runs: one or more containers sharing a network identity. Each Pod gets its own **IP address** (a numeric network address, like `10.244.1.17`). When a Pod is replaced during a deploy or after a crash, the new Pod gets a different IP. That is the problem Services solve.

Pods carry **labels**, which are key-value tags such as `app=orders-api`. A Service finds its Pods with a **selector**, a rule that matches labels:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: orders-api
spec:
  selector:
    app: orders-api
  ports:
    - port: 80          # what callers connect to
      targetPort: 8080  # what your container listens on
```

What happens next:

1. Kubernetes assigns the Service a stable virtual IP, the **ClusterIP**, for example `10.96.42.7`. It also registers a **DNS** (Domain Name System, name-to-address lookup) entry: `orders-api`, or in full `orders-api.default.svc.cluster.local`.
2. Kubernetes continuously watches for Pods matching `app: orders-api`. It keeps a list of their `IP:port` pairs, called the **Endpoints**. Only Pods that report **Ready** (passing their readiness check) are included.
3. A caller connects to `orders-api:80`. DNS returns `10.96.42.7`.
4. **kube-proxy**, a small agent on every machine (**node**) in the cluster, has forwarding rules that rewrite that address to one real Pod IP from the list. The choice is roughly random.
5. If a Pod dies, it drops off the list within seconds. The ClusterIP and DNS name stay the same.

Services come in three common types:

| Type | Reachable from | Use it for |
|---|---|---|
| `ClusterIP` (default) | Inside the cluster only | Service-to-service calls |
| `NodePort` | Outside, via a port (30000–32767) opened on every node | Quick testing |
| `LoadBalancer` | Outside, via a cloud-provisioned load balancer | Public traffic |

## In your setup

Run this against {{env:KUBE_CLUSTER_NAME}}:

```
kubectl get svc
```

The output has this shape (your names and numbers will differ):

```
NAME         TYPE        CLUSTER-IP    EXTERNAL-IP   PORT(S)   AGE
kubernetes   ClusterIP   10.96.0.1     <none>        443/TCP   41d
orders-api   ClusterIP   10.96.42.7    <none>        80/TCP    3d
```

How to read it:

- **NAME** is the DNS name other apps use.
- **TYPE** is one of the three above.
- **CLUSTER-IP** is the stable internal address.
- **EXTERNAL-IP** is `<none>` unless the type is `LoadBalancer`.
- **PORT(S)** is the `port` callers use.
- The `kubernetes` row is built in. It is the cluster's own API.

This lists only your current **namespace**, which is a named partition of the cluster. Add `-A` to see every namespace.

The next step is to check what a Service points at, using two more read-only commands:

```
kubectl get endpoints orders-api
kubectl describe svc orders-api
```

A healthy result shows one `IP:port` per running replica, such as `10.244.1.17:8080,10.244.2.9:8080`. The `describe` output also shows the `Selector` the Service is using.

## Why it matters

A team copies a Pod IP, `10.244.1.17`, into another service's config because it "works". The next deploy replaces every Pod and the IP vanishes. Every call fails with connection timeouts for twelve minutes, until someone realises the config holds an address that no longer exists.

A subtler version is more common. Someone writes `app: order-api` in the Service but the Pods are labelled `app: orders-api`. Kubernetes accepts it without complaint, but the Service matches nothing. Callers see timeouts. The application logs show nothing because no request ever arrives. People lose an hour reading logs for an error that isn't in them.

Good looks like this:

- Callers use the Service name, never a Pod IP.
- `kubectl get endpoints` lists as many addresses as you have healthy replicas.
- An empty Endpoints list is the first thing you check when a service is unreachable.

## Check yourself

1. Why can't you rely on a Pod's IP address staying the same?
   *Pods are replaced, not repaired, and each new Pod gets a new IP.*

2. How does a Service know which Pods to send traffic to?
   *Its label selector matches Pod labels, and only Ready Pods are listed as Endpoints.*

3. A Service exists but every call to it times out, and `kubectl get endpoints` shows `<none>`. What is the likely cause?
   *The selector matches no Ready Pods, usually from a label typo or Pods failing readiness.*
