# 02. Running something

**Goal:** take an image and get it serving traffic, and explain every object you created on
the way.

**Prerequisites:** 01. **Time:** 3 to 4 hours.

## Topics

- [ ] **Pods** — The smallest thing Kubernetes schedules: one or more containers that share a network address and lifetime. You rarely create one directly.
  - See: `kubectl get pods`
- [ ] **Deployments and ReplicaSets** — A Deployment says "keep N copies of this running" and manages rollouts. The ReplicaSet underneath does the counting.
  - Ask: "Explain the relationship between Deployment, ReplicaSet and Pod, and what actually happens during a rolling update."
- [ ] **Services** — Pods come and go with changing addresses. A Service is the stable name and address in front of them.
  - See: `kubectl get svc`
- [ ] **ConfigMaps and Secrets** — Configuration kept outside the image. A Secret is only base64-encoded, not encrypted, unless the cluster is set up for it.
  - Ask: "Explain the difference between a ConfigMap and a Secret, and what 'a Secret is not encrypted by default' means in practice."
- [ ] **Requests and limits** — What your container is guaranteed and what it may not exceed. Getting these wrong is the most common cause of mysterious restarts.
  - See: `kubectl describe node | grep -A5 "Allocated resources"`
