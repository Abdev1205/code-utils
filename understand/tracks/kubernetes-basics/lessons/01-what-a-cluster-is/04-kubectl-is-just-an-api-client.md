## In one line

`kubectl` is a messenger: it turns what you type into a web request to your cluster's front door and prints the reply.

## The everyday version

Picture a hotel front desk. Guests never walk into the laundry room or the kitchen. They tell the desk what they want. The desk checks their room key, writes a ticket ("extra towels, room 412"), and says "noted." Staff elsewhere pick up tickets later.

`kubectl` is the house phone in your room. It's a convenience, because you could walk down and say the same sentence yourself. And "noted" has never meant the towels arrived.

## How it actually works

A **cluster** is a group of machines pooled to run your containers. Its front desk is the **API server**. (API means application programming interface: a set of URLs a program answers.) Every fact about the cluster, such as "run 3 copies of orders-api", is a record stored through this server. Nothing talks to the cluster except through it, and that includes `kubectl`.

When you run `kubectl get pods`:

1. **Read the kubeconfig.** This file (`~/.kube/config`) holds the server's address, a certificate that proves the server is genuine, and your credentials. A **context** is one saved bundle of these.
2. **Work out the URL.** `kubectl` asks the server which resource types exist and caches the answer. "pods" becomes `/api/v1/namespaces/default/pods`. A **namespace** is a named folder inside the cluster. `default` is used if you don't pick one.
3. **Send an HTTP request.** HTTP (HyperText Transfer Protocol) is what browsers speak. Here it's a `GET` on that URL.
4. **The server checks you.** *Authentication*: who are you? *Authorization*: may you list pods here? Kubernetes enforces the second with RBAC (role-based access control).
5. **The server replies with JSON** (JavaScript Object Notation, structured text). `kubectl` reformats it into the table you see.

Other commands are other HTTP verbs on other URLs:

| You type | HTTP call |
|---|---|
| `kubectl get pod web-1` | `GET /api/v1/namespaces/default/pods/web-1` |
| `kubectl logs web-1` | `GET …/pods/web-1/log` |
| `kubectl apply -f app.yaml` (new) | `POST /apis/apps/v1/namespaces/default/deployments` |
| `kubectl apply -f app.yaml` (exists) | `PATCH …/deployments/orders-api` |
| `kubectl delete pod web-1` | `DELETE …/pods/web-1` |

You can skip the table formatting: `kubectl get --raw /api/v1/namespaces/default/pods` prints the raw JSON. Any HTTP tool with the same credentials would get the same answer.

The key point is that `apply` converts your YAML file (a human-friendly config format) to JSON and sends it. The server validates it, stores it, and answers `200 OK` or `201 Created`. That means the record is saved, and `kubectl`'s job is over. Other programs start containers later, when they notice the new record. The rest of this module covers them.

## In your setup

Run this against {{env:KUBE_CLUSTER_NAME}}:

```
kubectl get pods -v=6
```

`-v=6` sets verbosity to level 6, which logs every HTTP request `kubectl` makes. The log goes to stderr and the table to stdout. Expect something like:

```
I1001 10:42:07.311204   48211 loader.go:402] Config loaded from file:  /Users/you/.kube/config
I1001 10:42:07.452881   48211 round_trippers.go:553] GET https://<api-server-address>/api/v1/namespaces/default/pods?limit=500 200 OK in 38 milliseconds
NAME                         READY   STATUS    RESTARTS   AGE
orders-api-7d9f8b6c5-x2k4p   1/1     Running   0          3d
```

Read the `GET` line left to right: verb, URL, status code, time taken.

- **Address:** it should be the server for {{env:KUBE_CLUSTER_NAME}}. If it isn't, your current context points at a different cluster. Find that out here, not after an `apply`.
- **Namespace:** the path shows which one you're querying.
- **`?limit=500`:** `kubectl` fetches in pages of 500 items.

The status code tells you where a failure is:

- **401 Unauthorized:** the server doesn't know who you are, often because a token expired.
- **403 Forbidden:** the server knows you, but RBAC says no.
- **404 Not Found:** wrong resource type or namespace.
- **No status line, then a timeout:** you never reached the server. Suspect your VPN (virtual private network) or the address.

## Why it matters

An engineer ships a hotfix and runs `kubectl apply -f deploy.yaml`. The terminal says `deployment.apps/orders-api configured`, so they close the ticket. But the image tag has a typo, so the new pods sit in `ImagePullBackOff` (the machine can't download the image). Kubernetes keeps the three old pods serving traffic, which is by design, so nothing visibly breaks. Customers hit the original bug for three hours, until someone checks the running version.

"Configured" is a receipt, not a delivery confirmation. It means the API server stored your record.

Good looks like this:

- **After `apply`:** treat the output as "request accepted", then verify with `kubectl rollout status deployment/orders-api`. That is another API call, and it waits for the real outcome.
- **When `kubectl` misbehaves:** run it with `-v=6` before guessing. One line shows whether the problem is the address, your credentials, your permissions, or the object. A command that hangs with no response line is usually your network, not a cluster outage.

## Check yourself

1. What does `kubectl get pods` actually send, and where?
   *An HTTP GET to the API server's `/api/v1/namespaces/<ns>/pods` URL, using the address and credentials from your kubeconfig.*

2. `kubectl apply` prints "configured". What has happened, and what hasn't?
   *The API server validated and stored your record; no container is guaranteed to be running yet.*

3. One failed command shows `403`, another times out. What does each tell you?
   *403: you reached the server and were identified, but RBAC denies you. Timeout: you never reached the server (network, VPN, or wrong address).*
