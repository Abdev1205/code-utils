## In one line
You tell Kubernetes what you want to be true, and it keeps working, around the clock, to make it true.

## The everyday version
Think of a thermostat. You don't tell the heating system "run for 20 minutes." You set it to 21 °C and walk away. Every few seconds it measures the room, compares the result to 21, and switches the heater on or off. If someone opens a window at 3 a.m., it reheats without anyone asking.

`kubectl apply` works like the thermostat dial, not like a power switch. "Turn the heater on" is an instruction: it happens once and is over. "Keep it at 21" is a desired state, and it never finishes because the checking never stops.

## How it actually works
A **cluster** is a group of machines (called **nodes**) managed as one pool. A **pod** is the smallest thing Kubernetes runs: a wrapper around one or more containers. A **Deployment** is an object that says "I want N identical pods running this image." A **controller** is a program that loops forever, comparing what you asked for with what exists.

Here is a Deployment. It is a description, not a script:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  replicas: 3
  selector:
    matchLabels: {app: api}
  template:
    metadata:
      labels: {app: api}
    spec:
      containers:
        - name: api
          image: api:1.8.2
```

What happens after `kubectl apply -f api.yaml`:

1. `kubectl` sends the YAML to the **API server**, the cluster's front door. It stores it as the desired state. Nothing runs yet.
2. The Deployment controller notices: desired 3 pods, existing 0. It creates a **ReplicaSet**, a helper object whose only job is "keep N pods alive." That ReplicaSet creates 3 pod records.
3. Other components assign each pod to a node and start the containers. Later lessons cover how.
4. The controller does not stop. It keeps looping: **observe, compare, act, repeat**.
5. At 02:14 a node loses power and one pod disappears. The next pass sees 2 running and 3 desired, so it creates one more. A replacement is usually scheduled within seconds. Nobody typed anything.

Every object has two halves:

| Field | Meaning | Who writes it |
|---|---|---|
| `spec` | What you want (`replicas: 3`) | You |
| `status` | What exists right now (`readyReplicas: 2`) | Controllers |

Controllers work to close the gap between `spec` and `status`. When they match, they idle, but they keep watching.

Even a one-off task (a **Job**) is expressed as desired state: "one successful completion." Kubernetes retries until that is true.

## In your setup
Run this against {{env:KUBE_CLUSTER_NAME}}. It only reads:

```
kubectl get deploy -A
```

`-A` is short for `--all-namespaces`. A **namespace** is a named folder that groups objects inside a cluster. The output looks like this:

```
NAMESPACE     NAME      READY   UP-TO-DATE   AVAILABLE   AGE
default       api       3/3     3            3           42d
default       worker    2/2     2            2           42d
kube-system   coredns   2/2     2            2           91d
```

Read it as desired versus reality:

- **READY** `3/3` means 3 pods are running out of 3 desired. `2/3` means a gap exists and a controller is closing it.
- **UP-TO-DATE** is how many pods match the latest template. During a rollout it lags behind READY.
- **AVAILABLE** is how many pods can serve traffic.

Add `--watch` to stream changes live. During a deploy you will see READY and UP-TO-DATE tick upward as the loop does its work.

## Why it matters
Say a traffic spike hits and an engineer runs `kubectl scale deploy/api --replicas=10`. It works, and the error rate drops. Forty minutes later CI deploys a small fix by applying the YAML in git, which still says `replicas: 3`. Kubernetes obeys the latest desired state and terminates 7 pods during peak traffic. The result is about 12 minutes of 503 errors, and a confused on-call engineer who "didn't change anything."

The same misunderstanding shows up when someone deletes a crashing pod to "stop it." The controller sees 2 of 3, creates a fresh pod, and the crash loop continues.

Good looks like this:

- The YAML in git is the source of truth. You change desired state there, not by hand.
- To stop something, you lower its desired state (`replicas: 0`) or delete the Deployment, not its pods.
- When something "keeps coming back," you ask which controller wants it to exist.

## Check yourself
1. You delete one of three pods in a Deployment. Ten seconds later there are three again. Why?
   *A controller compared desired (3) to actual (2) on its next loop and created a replacement.*

2. What is the difference between `spec` and `status`, and who writes each?
   *`spec` is what you want and you write it; `status` is what exists now and controllers write it.*

3. In `kubectl get deploy -A`, what does `READY 2/3` tell you?
   *Three pods are desired and two are running, so reality differs from the desired state and a controller is working to close the gap.*
