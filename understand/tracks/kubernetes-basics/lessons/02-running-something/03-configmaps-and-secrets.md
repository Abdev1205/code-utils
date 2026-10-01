## In one line
Kubernetes lets you keep an app's settings and passwords on a separate sheet of paper, so the same packaged app can run anywhere with different settings.

## The everyday version
Picture a restaurant franchise. Every branch gets the same recipe book. That's the **image**, your app packaged once with its dependencies. Each branch also has local details like the supplier's phone number and opening hours. Those go on a noticeboard by the kitchen door, and anyone on staff can read it. That noticeboard is a **ConfigMap**.

The safe code goes in an envelope marked "confidential". That's a **Secret**. By default, though, Kubernetes writes the code in a letter-swap cipher that anyone can undo in a second. The envelope is labelled, not locked. What protects it is who is allowed into the office, and whether the cluster stores envelopes in a real safe (*encryption at rest*, covered below).

## How it actually works
A **ConfigMap** is a Kubernetes object holding non-sensitive key-value pairs. A **Secret** has the same shape but is meant for sensitive values. Here is one of each for a service called `orders-api`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: orders-config
data:
  LOG_LEVEL: "info"
  PAYMENTS_URL: "http://payments:8080"
---
apiVersion: v1
kind: Secret
metadata:
  name: orders-db
type: Opaque          # "no particular structure"
stringData:
  DB_PASSWORD: "s3cr3t-pw"
```

Here is what happens next:

1. **You apply the YAML.** The API server, the cluster's front door, validates it and stores it in **etcd**, the cluster's database.
2. **The Secret is stored base64-encoded.** **base64** is a reversible way to write bytes as plain text. It is not encryption.
3. **Your Pod references the objects.** A **Pod** is the running unit that wraps your container:
   ```yaml
   containers:
   - name: orders-api
     image: orders-api:1.4.2
     envFrom:
     - configMapRef: {name: orders-config}
     env:
     - name: DB_PASSWORD
       valueFrom:
         secretKeyRef: {name: orders-db, key: DB_PASSWORD}
   ```
4. **The kubelet injects the values.** The **kubelet** is the agent on each machine that starts containers. It fetches the objects and hands them to your app as environment variables, or as files if you mount them as a *volume*.
5. **Updates behave differently for each method.** Environment variables are fixed at container start, so editing the ConfigMap changes nothing until you run `kubectl rollout restart deployment/orders-api`. Mounted files refresh in about a minute, but only if your app re-reads them.

Anyone can reverse the "protection":

```
$ echo -n 's3cr3t-pw' | base64
czNjcjN0LXB3
$ echo 'czNjcjN0LXB3' | base64 -d
s3cr3t-pw
```

Real protection comes from three places:
- **RBAC** (role-based access control) decides who may `get secrets`.
- **Encryption at rest** makes the API server encrypt values before writing them to etcd, optionally with keys held in an external key service.
- **Not storing the YAML in shared places** keeps the value out of repositories and chat.

Each object is limited to 1 MiB (1,048,576 bytes).

## In your setup
First confirm you're pointed at the right place. The output should show {{env:KUBE_CLUSTER_NAME}}, or a context name that maps to it:

```
kubectl config current-context
kubectl get configmaps,secrets -A
```

`-A` means all namespaces, which are the cluster's named partitions. The output has two tables:

```
NAMESPACE     NAME                         DATA   AGE
kube-system   configmap/coredns            1      212d
default       configmap/kube-root-ca.crt   1      212d

NAMESPACE   NAME               TYPE                DATA   AGE
default     secret/orders-db   Opaque              1      40d
```

`DATA` is the number of keys, not bytes. `TYPE` tells you what a Secret is for. `Opaque` means generic, `kubernetes.io/tls` is a certificate, and `kubernetes.io/dockerconfigjson` holds registry login credentials.

Every namespace has a ConfigMap called `kube-root-ca.crt`, so you can inspect one safely:

```
kubectl get configmap kube-root-ca.crt -n kube-system -o yaml
```

Then see what a Secret exposes:

```
kubectl describe secret orders-db
kubectl get secret orders-db -o jsonpath='{.data.DB_PASSWORD}' | base64 -d
```

Use your own Secret's name and namespace in place of `orders-db`. `describe` shows key names and sizes but not values. The second command prints the real value. If it works for you, it works for everyone holding the same permission on {{env:KUBE_CLUSTER_NAME}}. A "Forbidden" error means RBAC is doing its job.

`kubectl` cannot show whether encryption at rest is on. That is a control-plane setting. The **control plane** is the machines running the API server and etcd. On managed clusters it's usually an option in the cluster's settings at your provider.

## Why it matters
A team commits `secret.yaml` to a shared repository because "the password looks scrambled". It is base64. A contractor clones the repo and decodes the production database password in one second. Automated scanners find leaked credentials in public repositories within minutes. The cost is a rotation across three services, an audit of access logs, and a lost day.

A quieter version: someone sets `LOG_LEVEL: debug` in the ConfigMap, sees no change, and spends 40 minutes debugging. The environment variables were read at container start.

Good looks like this:
- One image runs in every environment, with only the config differing.
- Secret values never appear in git.
- `get secrets` is restricted to few people.
- Encryption at rest is on.
- Config changes ship with a deliberate restart.

## Check yourself
1. **Why can the same image run in staging and production without being rebuilt?**
   *Settings live in ConfigMaps and Secrets that are injected at start, not baked into the image.*

2. **Is `czNjcjN0LXB3` safe to paste in a public chat?**
   *No. It's base64, which is reversible with `base64 -d`, so it's the password itself.*

3. **You edited a ConfigMap, but the running app still shows old values. Why?**
   *Environment variables are read once at container start, so restart the Pods. Mounted files refresh on their own, but the app must re-read them.*
