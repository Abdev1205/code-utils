## In one line

Your program started on the cluster, crashed within moments, and keeps getting restarted, so the explanation is whatever it printed just before it died.

## The everyday version

Imagine you hire an assistant to open a shop each morning. They unlock the door, walk in, find the safe key missing, and walk straight back out. You send them in again and get the same result. Each time, you wait a little longer before retrying, because hammering at it doesn't help.

The shop is fine. The door works, and the assistant showed up. What you need is the note they left on the counter on their way out. In Kubernetes, that note is the previous attempt's logs. Looking at an assistant who walked in a second ago tells you nothing.

## How it actually works

Some terms first:
- A **container** is your packaged program running in isolation.
- A **pod** is the smallest thing Kubernetes runs. It wraps one or more containers.
- A **node** is a machine in the cluster.
- The **kubelet** is the agent on each node that starts and watches containers.

The sequence:

1. The kubelet pulls your image and starts the container's command.
2. The process exits. It leaves an **exit code**, a number where 0 means success and anything else means failure.
3. The pod's **restart policy** defaults to `Always`, so the kubelet restarts the container. It does this even after exit code 0, because a service is expected to keep running.
4. The wait between restarts doubles each time: 10s, 20s, 40s, 80s, 160s, then capped at 5 minutes. It resets after the container survives 10 minutes.
5. While it waits, the pod's status reads `CrashLoopBackOff`. That means a crash loop, with back-off delays between attempts.

The key point is that the image was pulled and the container *started*. Scheduling, networking and the registry all worked. The failure is inside your process or its configuration.

The exit code narrows it down:

| Exit code | Meaning | Typical cause |
|---|---|---|
| 1 | App exited with an error | Uncaught exception, missing config |
| 0 | Exited cleanly | A script or job running as if it were a server |
| 127 | Command not found | Wrong entrypoint in the image |
| 137 | Killed (128 + signal 9) | Out of memory, shown as `OOMKilled` |

## In your setup

First confirm you're pointed at the right place. `kubectl config current-context` should correspond to {{env:KUBE_CLUSTER_NAME}}. Then find the pod:

```
$ kubectl get pods -n <namespace>
NAME                         READY   STATUS             RESTARTS       AGE
orders-api-7d9f8c6b5-xk2lp   0/1     CrashLoopBackOff   6 (92s ago)    9m
```

`READY 0/1` means zero of one containers are running. `RESTARTS 6` means this is the seventh start. Now read the evidence:

```
$ kubectl logs orders-api-7d9f8c6b5-xk2lp -n <namespace> --previous
Error: DATABASE_URL is not set
    at loadConfig (/app/config.js:14:11)
    at main (/app/server.js:5:3)
```

Plain `kubectl logs` shows the *current* container. During back-off that container is either brand new with nothing printed yet, or not running at all. `--previous` shows the last one that died, which is the one with the story. If the pod has several containers, add `-c <container-name>`.

For the exit code, run `kubectl describe pod orders-api-7d9f8c6b5-xk2lp -n <namespace>` and find:

```
Last State:     Terminated
  Reason:       Error
  Exit Code:    1
  Started:      Thu, 01 Oct 2026 09:14:02 +0000
  Finished:     Thu, 01 Oct 2026 09:14:02 +0000
```

Started and finished in the same second means it died immediately, which usually points to config or startup. Both commands are read-only. If `--previous` says no previous terminated container exists, the container hasn't crashed yet.

If the logs are empty, trust the exit code. An `OOMKilled` container is killed before it can log anything.

## Why it matters

A common failure goes like this. A deploy ships at 9:00 and the new pods show `CrashLoopBackOff`. The engineer assumes the cluster is unhealthy and deletes the pods, expecting a fresh start. The replacements crash the same way. Worse, the deleted pods took their previous-attempt logs with them, so the evidence is gone.

Forty minutes later, someone runs `--previous` on a surviving pod and sees `DATABASE_URL is not set`. The fix is one missing line in the deployment's environment settings. The 40 minutes went to guessing.

Good looks like this. You see `CrashLoopBackOff` and read it as "my process ran and exited". You run `--previous` before touching anything, and you check the exit code. Within two minutes you know whether it's config (1), a bad command (127), memory (137) or an unhandled error in your code. Only then do you change something.

## Check yourself

1. **What does `CrashLoopBackOff` tell you about whether the container started?**
   *It started and then exited, so the image pulled and scheduling worked, and the problem is inside the process or its config.*

2. **Why use `kubectl logs <pod> --previous` instead of plain `kubectl logs <pod>`?**
   *Plain logs show the current container, which is often brand new or waiting in back-off, while `--previous` shows the last crashed one that holds the error.*

3. **A pod's last exit code is 137 and its logs are empty. What's the likely cause, and why is deleting the pod a bad first move?**
   *The container was killed for exceeding its memory limit (`OOMKilled`), and deleting the pod destroys the previous-attempt evidence.*
