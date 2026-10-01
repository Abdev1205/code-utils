# 01. What a cluster is

**Goal:** explain, without notes, what happens between `kubectl apply` and your container
actually running somewhere.

**Prerequisites:** none. **Time:** 2 to 3 hours.

## Topics

- [ ] **Desired state, not instructions** — You describe what you want to exist; controllers work continuously to make reality match. Nothing is "run once".
  - Ask: "Explain Kubernetes' desired-state model from zero with an everyday analogy, then show what happens when I delete a pod that belongs to a Deployment."
  - See: `kubectl get deploy -A`
- [ ] **Nodes** — The machines that actually run your containers. Each runs a kubelet, which asks the control plane what it should be running.
  - See: `kubectl get nodes -o wide`
- [ ] **The control plane** — The API server, etcd, the scheduler and the controllers. Every change goes through the API server; etcd is the only place state really lives.
  - Ask: "Walk me through what each control-plane component does, using one `kubectl apply` as the worked example."
- [ ] **Namespaces** — A way to divide one cluster into logical areas. Names are unique within a namespace, not across the cluster.
  - See: `kubectl get ns`
- [ ] **kubectl is just an API client** — Everything the CLI does is an HTTP call you could make yourself. Seeing that demystifies the whole thing.
  - See: `kubectl get pods -v=6`
