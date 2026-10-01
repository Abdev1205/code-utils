# 03. When it breaks

**Goal:** given a pod that isn't working, find the reason from evidence rather than guessing.

**Prerequisites:** 01, 02. **Time:** 2 to 3 hours.

## Topics

- [ ] **Read the events first** — Most answers are already written down. `describe` shows why the scheduler or kubelet refused.
  - See: `kubectl get events --sort-by=.lastTimestamp | tail -20`
- [ ] **Pending means unschedulable** — No node can satisfy what the pod asked for: not enough CPU or memory, a taint, or a volume that cannot attach.
  - Ask: "List the reasons a pod stays Pending, with the command that confirms each one."
- [ ] **CrashLoopBackOff is your code** — The container started and exited. The logs from the previous attempt are the evidence.
  - See: `kubectl logs <pod> --previous`
- [ ] **ImagePullBackOff is access or a typo** — The node could not fetch the image: wrong tag, wrong registry, or missing credentials.
- [ ] **OOMKilled** — The container exceeded its memory limit and was killed. It is not a crash in your code; it is a limit you set.
  - Ask: "Explain OOMKilled versus a normal crash, and how to tell them apart from the pod's status."
- [ ] **Working in someone else's cluster** — Know which cluster and namespace you are pointed at before running anything. On this machine that is {{env:KUBE_CLUSTER_NAME}}.
  - See: `kubectl config current-context`
