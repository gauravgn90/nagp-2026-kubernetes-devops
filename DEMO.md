# Demo Runbook - Kubernetes Assignment Screen Recording

A step-by-step script for the demonstration. Run each block, narrate
what's on screen, and pause so the output is captured.

Covers: all objects deployed & running, an API call retrieving DB records,
API pod self-healing, DB pod self-healing **with data persistence**, and
points for deployments, deployment strategy, and FinOps.

---

## Segment 0 - Setup

```bash
minikube status
minikube stop
minikube start
minikube addons list | grep -E "ingress|metrics-server"
# both should be enabled; if not:
# minikube addons enable ingress && minikube addons enable metrics-server
```

---

## Segment 1 - Show all objects deployed and running

```bash
# Everything in one shot: deployments, pods, services, hpa
kubectl apply -k yamls
kubectl get all -n student-app

# Storage objects (PV/PVC) and config/secrets - the full stack
kubectl get pv,pvc,storageclass -n student-app
kubectl get configmap,secret -n student-app
kubectl get ingress -n student-app

# Pods are actually Ready (not just Running)
kubectl get pods -n student-app -o wide
```

**NOTE:** 2× `webapp-deployment` pods, 1× `mysql` pod, `webapp` ClusterIP
Service, headless `mysql` Service, the HPA, the bound PV/PVC, and the Ingress on
`webapp.local` - all in the `student-app` namespace.

---

## Segment 2 - API call retrieving records from the database

Port-forward running in a second terminal:

```bash
kubectl port-forward -n student-app svc/webapp 8080:80
```

Then in main terminal:

```bash
# Read records from the backend (MySQL student.users table)
curl -s http://localhost:8080/users | jq

# Optional: create a record so you can prove persistence later
curl -s -X POST http://localhost:8080/users \
  -H 'Content-Type: application/json' \
  -d '{"name":"DemoUser","email":"demo@example.com","phone":"9999999999"}' | jq

curl -s http://localhost:8080/users | jq
```

**NOTE:** the API tier (`webapp`) reads rows from the MySQL backend tier -
request flows webapp pod → headless `mysql` Service → MySQL pod → PV.
(Prefer the Ingress URL? Use `http://webapp.local/users` with `minikube tunnel`
running and the `/etc/hosts` entry.)

---

## Segment 3 - Kill API microservice pod → self-healing

```bash
# Watch in one terminal
kubectl get pods -n student-app -w
```

In another terminal:

```bash
# Delete ONE webapp pod (grab a name from `kubectl get pods`)
kubectl delete pod -n student-app "$(kubectl get pods -n student-app -l app=webapp -o jsonpath='{.items[0].metadata.name}')"
```

**NOTE:** the Deployment's ReplicaSet immediately spins up a replacement to
maintain `replicas: 2`. The other replica stays up, so the API has **zero
downtime** - prove it:

```bash
curl -s http://localhost:8080/users | jq '.[] | .name'   # still responds during recovery
kubectl get pods -n student-app          # back to 2/2 Running
```

---

## Segment 4 - Kill database pod → regenerates AND keeps old data (persistence)

```bash
# Show data exists BEFORE
curl -s http://localhost:8080/users | jq

# Delete the mysql pod
kubectl delete pod -n student-app -l app=mysql

# Watch it come back (Recreate strategy: old pod terminates, new one starts)
kubectl get pods -n student-app -w
```

Once `mysql` is `Running`/`Ready` again:

```bash
# Same records are still there → data survived because /var/lib/mysql is on the PV
curl -s http://localhost:8080/users | jq
```

**NOTE:** the new MySQL pod re-attaches to the **same PVC → PV
(hostPath `/mnt/data/mysql`)**, so the `DemoUser` added earlier is still
present. That's persistence beyond the pod lifecycle.

---

## Segment 5 - Points to call out

**Deployments**
- `webapp-deployment`: 2 replicas, stateless API tier.
- `mysql`: 1 replica, stateful, backed by PV/PVC.

**Self-healing**
- Killing a webapp pod → ReplicaSet recreates it to hold desired count (Segment 3).
- Liveness/readiness probes on both tiers restart unhealthy containers and keep
  traffic off not-ready pods.

**Persistence**
- `mysql-pv` (hostPath) + `mysql-pv-claim`, `StorageClass manual` with
  `WaitForFirstConsumer`.
- Data in `/var/lib/mysql` survives pod deletion (Segment 4).

**Deployment strategy** - show the difference:

```bash
kubectl get deploy webapp-deployment -n student-app -o jsonpath='{.spec.strategy}'; echo
kubectl get deploy mysql -n student-app -o jsonpath='{.spec.strategy}'; echo
```

- **webapp → `RollingUpdate`** (`maxSurge:1, maxUnavailable:0`): zero-downtime
  upgrades for the stateless tier.
- **mysql → `Recreate`**: never run two pods against one RWO volume (avoids data
  corruption).
- Optionally trigger a rollout live:

  ```bash
  kubectl rollout restart deploy/webapp-deployment -n student-app
  kubectl rollout status deploy/webapp-deployment -n student-app
  ```

**FinOps considerations** - show and explain:

```bash
kubectl get hpa -n student-app
kubectl describe hpa webapp-hpa -n student-app | head -20
kubectl top pods -n student-app   # needs metrics-server
```

- **HPA** (2→10 replicas at 60% CPU): scales out only under load, scales back in
  when idle - pay for capacity only when needed.
- **resource requests/limits** on every container: requests enable
  bin-packing/right-sizing; limits cap spend and prevent noisy-neighbor waste.
- **minikube single node**: minimal footprint for dev/demo instead of an
  always-on managed cluster.
