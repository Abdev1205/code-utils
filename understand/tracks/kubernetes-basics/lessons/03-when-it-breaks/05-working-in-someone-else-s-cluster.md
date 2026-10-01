## In one line
Before you run any command that changes something, check which cluster and which section of it your terminal is connected to, because the same command does very different things in different places.

## The everyday version
Think of a courier app with saved addresses: Home, Office, Warehouse. Whichever one is selected gets pre-filled on every order. You don't type the address each time, so you stop noticing it. Then one day you order a pallet of paper and it arrives at your flat.

`kubectl` (pronounced "kube-control", the command-line tool for talking to a Kubernetes cluster) works the same way. It has a pre-selected destination, and it never asks "are you sure this is the right building?" The only safeguard is you checking the address first.

## How it actually works
A **cluster** is a group of machines that run your containers, managed as one unit. Every cluster has an **API server**, which is its front door. `kubectl` is only a messenger, and every command becomes a web request to some API server.

Here is how it decides which one:

1. `kubectl` reads the **kubeconfig** file, by default `~/.kube/config`.
2. That file holds three lists. The **clusters** list has server addresses. The **users** list has credentials. The **contexts** list has named bundles of one cluster, one user and one namespace.
3. A field called `current-context` names the active bundle. Every command uses it unless you override it.
4. A **namespace** is a named partition inside a cluster, like a folder. Teams and apps are usually separated this way. If your context doesn't set one, you land in the namespace called `default`.

So there are two separate questions: which cluster, and which namespace in it.

| Question | Read-only command |
|---|---|
| Which context is active? | `kubectl config current-context` |
| What contexts exist? | `kubectl config get-contexts` |
| Which namespace am I in? | `kubectl config view --minify --output 'jsonpath={..namespace}'` |
| Which server address is behind it? | `kubectl config view --minify` |

`get-contexts` output looks like this. The names are illustrative only:

```
CURRENT   NAME          CLUSTER       AUTHINFO     NAMESPACE
*         staging-eu    staging-eu    me-staging   payments
          prod-us       prod-us       me-prod      payments
```

The `*` marks the active row. You can override it for one command with `kubectl --context prod-us --namespace payments get pods`. Overriding doesn't change the file.

Switching is different. `kubectl config use-context prod-us` rewrites `~/.kube/config`, so **every terminal tab on your machine** switches at once. The tab you left on staging an hour ago is now pointed at production.

## In your setup
Run this:

```
kubectl config current-context
```

It prints one line with no spaces, such as `some-prefix_{{env:KUBE_CLUSTER_NAME}}`. Cloud providers often add prefixes or suffixes to the name, but it should clearly identify {{env:KUBE_CLUSTER_NAME}}. If it names something else, stop and work out why before you run anything.

Then check the namespace:

```
kubectl config view --minify --output 'jsonpath={..namespace}'
```

An empty result means `default`. For a service you were told lives elsewhere, expect to see its namespace here, or pass `-n <namespace>` on each command.

A context name is only a label someone typed. For certainty, run `kubectl config view --minify` and read the `server:` line. That is the address your commands will actually hit.

## Why it matters
Here is a common story. An engineer chases a crash-looping pod in staging. Then a production alert arrives, so they run `kubectl config use-context prod-us` in a second tab and investigate there. Later they go back to the first tab, which still looks like staging. They type `kubectl scale deployment checkout --replicas=0 -n payments` to quiet the noise while they debug.

That tab is now pointed at production. `scale ... --replicas=0` stops every running copy of the checkout service. Customers get errors for the 11 minutes it takes to notice and scale back up. Nothing was hacked and nothing was misconfigured. They just didn't check the address.

Good looks like this:

- You read `current-context` and the namespace before every command that changes something. Reading logs doesn't need this, but `delete`, `scale`, `apply`, `rollout restart` and `exec` do.
- In shared tabs, you pass `--context` and `-n` on the command itself instead of relying on the saved default.
- You show the context in your shell prompt so it is always visible.
- You treat {{env:KUBE_CLUSTER_NAME}} as the place you have confirmed, and everything else as somewhere you haven't.

In a cluster that other teams use, namespaces you don't own hold other people's workloads. Read freely there, but change nothing.

## Check yourself
1. **Which file decides where `kubectl` sends a command, and what three things does a context bundle together?**
   *The kubeconfig (`~/.kube/config`); a context bundles one cluster, one user (credentials) and one namespace.*

2. **You run `kubectl config use-context` in tab A. What happens to tab B, and why?**
   *Tab B switches too, because `use-context` rewrites the shared kubeconfig file, not just that terminal session.*

3. **How do you confirm you're pointed at {{env:KUBE_CLUSTER_NAME}}, and why isn't the context name enough proof?**
   *Run `kubectl config current-context`, then check `kubectl config view --minify` for the `server:` address, because a context name is only a label someone typed.*
