# Kubernetes Assignment - Solution Documentation

**Project:** CRUD REST API (Node.js/Express + MySQL) on Minikube

**Author:** Gaurav Kumar

**Source:** https://github.com/gauravgn90/nagp-2026-kubernetes-devops

**Image:** `gauravgn90/kube-app:v6` (Docker Hub)

This document is the design-and-justification companion to the operational
[README.md](README.md). It covers four
sections: 
**Requirement Understanding**, **Assumptions**, **Solution Overview**,
and **Justification for the Resources Utilized**.

---

## 1. Requirement Understanding

The objective is to containerize a stateful web application and deploy it on a
Kubernetes cluster (In our case it is Minikube) in a way that demonstrates the core
production-readiness capabilities of Kubernetes. Decomposed, the requirement is:

| # | Requirement | How it is interpreted |
|---|-------------|-----------------------|
| 1 | **A working web application** | A Node.js/Express REST API exposing user CRUD endpoints (`GET/POST/PUT/DELETE /users`) plus a Swagger UI at `/api-docs`. |
| 2 | **A backing datastore** | A MySQL 8.4 database holding the `student.users` table, seeded on first boot. |
| 3 | **Two-tier separation** | A stateless application/API tier and a stateful database tier, deployed and scaled independently. |
| 4 | **Configuration & secret management** | Non-sensitive config (host/port) and sensitive config (DB credentials) must be externalized from the image - not hard-coded. |
| 5 | **Persistent storage** | Database data must survive pod restarts, rescheduling, and deletion. |
| 6 | **Service discovery & networking** | The app tier must reach the DB by a stable name; external users must reach the app via a friendly URL. |
| 7 | **Self-healing** | Killing a pod must result in automatic recreation with no manual intervention. |
| 8 | **Scalability / autoscaling** | The stateless tier must scale horizontally based on load. |
| 9 | **Zero-downtime deploys** | The app tier must support rolling upgrades; the DB must avoid concurrent writers on one volume. |
| 10 | **Reproducible, one-command deploy** | The whole stack must apply cleanly in the correct order from a single command. |
| 11 | **Health management** | Liveness/readiness probes must keep traffic off unhealthy/not-ready pods. |
| 12 | **Cost-awareness (FinOps)** | Resource requests/limits and autoscaling must bound and right-size spend. |

In short: **package a two-tier stateful app and prove that Kubernetes gives it
configuration management, persistence, discovery, ingress, self-healing,
autoscaling, and safe rollout - reproducibly, on a single-node cluster.**

---

## 2. Assumptions

The solution was built against the following assumptions:

**Environment**
- The target is a **single-node Minikube cluster** on Linux, using the **Docker
  driver**. This drives several choices (hostPath storage, `WaitForFirstConsumer`).
- `kubectl`, `minikube`, and a container runtime are pre-installed.
- The **`ingress`** and **`metrics-server`** add-ons are available and enabled
  (Ingress is required for external access; metrics-server is required by the HPA).
- The user can edit `/etc/hosts` and run `minikube tunnel` to resolve
  `webapp.local`.

**Application**
- The published image **`gauravgn90/kube-app:v6`** is built `FROM node:24-alpine`
  and listens on port **3000**. Re-building is optional - the cluster pulls the
  published image, so no local build is required.
- The app reads all of its configuration from environment variables
  (`MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DB_USERNAME`, `MYSQL_DB_PASSWORD`,
  `MYSQL_DB_NAME`) - no config is baked into the image.
- The API is **stateless** (no in-pod session/file state), so any replica can
  serve any request and the tier is freely scalable.

**Data**
- A **single MySQL instance** is sufficient for this assignment - no HA/replication
  or clustering is required.
- The `init.sql` script seeds data **only on first initialization** (when the
  data directory is empty); on later restarts the existing data on the PV is reused.
- **ReadWriteOnce (RWO)** single-node storage is acceptable; the DB never needs
  more than one writer pod.

**Security (scope-limited for a demo)**
- The credentials in the Secret (`root`/`root`, db `student`) are **demo defaults**
  and are expected to be changed for any real use. They are kept in a `Secret`
  (not the image) to demonstrate the correct pattern, while accepting that base64
  is encoding, not encryption.
- TLS/HTTPS on the Ingress is out of scope for the local demo (HTTP `webapp.local`).

**Sequencing**
- The web tier may start before MySQL is ready; therefore startup ordering must be
  handled explicitly (an init container) rather than assumed.

---

## 3. Solution Overview

### 3.1 Architecture

```
                 Ingress (webapp.local)         ← external entry point
                          │
                          ▼
            Service "webapp" (ClusterIP :80 → :3000)
                          │
                          ▼
          Deployment "webapp-deployment" (2 replicas, RollingUpdate)
            gauravgn90/kube-app:v6  (Node 24, stateless API tier)
            initContainer "wait-for-mysql" blocks until 3306 is open
                          │  env from ConfigMap (host/port)
                          │  env from Secret  (user/pass/db)
                          ▼
            Headless Service "mysql" (clusterIP: None, :3306)
                          │  stable DNS name "mysql"
                          ▼
          Deployment "mysql" (mysql:8.4.9, Recreate, stateful tier)
            /docker-entrypoint-initdb.d ← init.sql (ConfigMap)
                          │
                          ▼
        PVC "mysql-pv-claim" → PV "mysql-pv"
        StorageClass "manual" (no-provisioner, hostPath /mnt/data/mysql)

  Autoscaling:  HPA watches webapp CPU → scales 2..10 replicas at 60% target
  Namespace:    everything lives in "student-app"
```

### 3.2 Two-tier design

- **Application tier** - `webapp-deployment`, 2 replicas, stateless. Fronted by a
  ClusterIP Service and an NGINX Ingress. Horizontally autoscaled.
- **Database tier** - `mysql`, 1 replica, stateful. Fronted by a headless Service
  for stable DNS, backed by a statically provisioned PV/PVC.

The tiers are decoupled through Kubernetes primitives: the app finds the DB by
the DNS name `mysql` (Service), and reads credentials/host from a Secret and
ConfigMap rather than from code.

### 3.3 Request and data flow

1. A client hits `http://webapp.local/...`. The **Ingress** routes it to the
   **`webapp` Service**, which load-balances across the two app pods.
2. The app pod queries MySQL using a connection pool, resolving the DB through the
   headless **`mysql` Service** to the single MySQL pod.
3. MySQL reads/writes `/var/lib/mysql`, which is mounted from the **PV**
   (hostPath `/mnt/data/mysql`), so data outlives the pod.

### 3.4 Startup ordering

The web pod includes an **init container** (`busybox`) that runs
`until nc -z mysql 3306` so the application container never starts - and never
crash-loops - until MySQL is accepting connections.

### 3.5 Configuration management

| Concern | Object | Keys |
|---------|--------|------|
| Non-sensitive | ConfigMap `mysql-config` | `MYSQL_HOST`, `MYSQL_PORT` |
| Sensitive | Secret `mysql-secret` | username, password, root-password, database |
| Schema/seed | ConfigMap `mysql-init-script` | `init.sql` mounted to `/docker-entrypoint-initdb.d` |

The app consumes these as environment variables; the MySQL container consumes the
Secret for its root password and database name, and mounts the init ConfigMap.

### 3.6 Resilience features delivered

- **Self-healing** - the Deployment/ReplicaSet recreates any deleted/failed pod to
  hold the desired replica count.
- **Persistence** - deleting the MySQL pod does not lose data; the replacement
  re-attaches to the same PVC → PV.
- **Health probes** - readiness probes keep traffic off not-ready pods; liveness
  probes restart hung containers. MySQL uses `mysqladmin ping`; the app uses a TCP
  probe on 3000.
- **Autoscaling** - HPA scales the app tier 2→10 on 60% average CPU.
- **Safe rollout** - app tier `RollingUpdate` (`maxSurge:1, maxUnavailable:0`) for
  zero-downtime upgrades; DB tier `Recreate` so two pods never write one RWO volume.

### 3.7 Deployment workflow

All 13 manifests are wired together with **Kustomize**
([yamls/kustomization.yaml](yamls/kustomization.yaml)), which pins the namespace
and applies resources in dependency order. The entire stack deploys with:

```bash
kubectl apply -k yamls/
```

---

## 4. Justification for the Resources Utilized

Each Kubernetes object is included to satisfy a specific requirement. The table
maps manifest → purpose → why this choice.

| Manifest | Resource | Why it is used (justification) |
|----------|----------|--------------------------------|
| `00-namespace.yaml` | **Namespace** `student-app` | Isolates all assignment objects into one logical boundary - clean scoping, easy bulk teardown, and avoids collisions with system/other workloads. |
| `01-manual-storageclass.yaml` | **StorageClass** `manual` | Single-node Minikube has no cloud volume provisioner. A `no-provisioner` class with `volumeBindingMode: WaitForFirstConsumer` is the correct pattern for node-local storage - binding is delayed until the consumer pod is scheduled, avoiding a PVC stuck `Pending` on the wrong node. `reclaimPolicy: Retain` protects data from accidental deletion. |
| `02-mysql-pv.yaml` | **PersistentVolume** (hostPath, 1Gi, RWO) | Provides durable storage decoupled from the pod lifecycle. `hostPath` is the standard, dependency-free choice for single-node clusters. `Retain` + `DirectoryOrCreate` make it safe and self-creating. Labels let the PVC bind to *this* exact volume. |
| `03-mysql-secret.yaml` | **Secret** `mysql-secret` | Externalizes credentials from the image and from plaintext manifests-in-use, demonstrating the correct separation of sensitive config. Consumed by both MySQL (root password, db name) and the app (user/pass/db). |
| `04-mysql-config.yaml` | **ConfigMap** `mysql-config` | Externalizes **non-sensitive** connection config (host, port). Keeping it separate from the Secret follows the principle of using the least-privileged object for each kind of data. |
| `05-mysql-init-script-config.yaml` | **ConfigMap** `mysql-init-script` | Ships the schema + seed data (`init.sql`) as config rather than baking it into a custom DB image. Mounted to `/docker-entrypoint-initdb.d`, the official MySQL image runs it automatically on first init - reproducible bootstrap with zero custom imaging. |
| `06-mysql-pvc.yaml` | **PersistentVolumeClaim** `mysql-pv-claim` | The pod's storage request. Pins `storageClassName: manual` and a label selector so it binds the static PV instead of a dynamic default - guaranteeing the DB always lands on the intended volume. |
| `07-mysql-deployment.yaml` | **Deployment** `mysql` (1 replica, **Recreate**) | Runs the stateful DB tier. `Recreate` guarantees the old pod fully terminates before a new one starts, so two MySQL processes never write the same RWO volume (which would corrupt data). Mounts the PVC at `/var/lib/mysql` and the init ConfigMap. Has probes and resource bounds. |
| `08-mysql-service.yaml` | **Service** `mysql` (**headless**, `clusterIP: None`) | Gives the DB a stable DNS name (`mysql`) for service discovery, so the app never hard-codes a pod IP. Headless is appropriate for a single stateful backend - DNS resolves straight to the pod with no extra proxy hop. |
| `09-webapp-deployment.yaml` | **Deployment** `webapp-deployment` (2 replicas, **RollingUpdate**) | Runs the stateless API tier. 2 replicas give baseline availability and self-healing. `RollingUpdate` (`maxSurge:1, maxUnavailable:0`) delivers zero-downtime upgrades. Includes an **init container** to order startup behind MySQL, env wiring from ConfigMap+Secret, probes, and resource requests/limits. |
| `10-webapp-service.yaml` | **Service** `webapp` (**ClusterIP** :80→:3000) | Provides a single stable virtual IP that load-balances across app replicas, decoupling clients (and the Ingress) from individual pod IPs. ClusterIP is the right type since external exposure is handled by the Ingress. |
| `11-webapp-hpa.yaml` | **HorizontalPodAutoscaler** (2–10, 60% CPU) | Satisfies the scalability + FinOps requirements: automatically adds replicas under CPU load and removes them when idle, so capacity (and cost) tracks demand instead of being statically over-provisioned. |
| `12-webapp-ingress.yaml` | **Ingress** `webapp.local` (nginx) | Provides friendly, host-based external access (`http://webapp.local/`) through a single entry point, instead of exposing NodePorts. The standard, production-shaped way to publish HTTP services. |
| `kustomization.yaml` | **Kustomize** config | Single source of truth that pins the namespace and applies all resources in the correct dependency order via one command - reproducible, ordered, declarative deploy. |

### 4.1 Supporting (non-Kubernetes) resources

| Resource | Why |
|----------|-----|
| **Node.js / Express + `mysql2`** | Lightweight, fast-to-build REST stack with a built-in connection pool (`connectionLimit: 10`) for efficient DB usage. `mysql2` supports MySQL 8.4's `caching_sha2_password`. |
| **Swagger (`swagger-jsdoc` + `swagger-ui-express`)** | Self-documenting API at `/api-docs` for easy verification and demo. |
| **`node:24-alpine` base image** | Minimal footprint → smaller image, faster pulls, reduced attack surface and cost. |
| **`mysql:8.4.9` official image** | Current LTS line; ships the `/docker-entrypoint-initdb.d` bootstrap hook used for seeding, so no custom DB image is needed. |
| **`busybox:1.36` init container** | Tiny, dependency-free image providing `nc` for the "wait-for-mysql" readiness gate. |

### 4.2 Resource sizing (requests/limits)

| Container | Requests | Limits | Rationale |
|-----------|----------|--------|-----------|
| `webapp` | 100m CPU / 128Mi | 500m CPU / 512Mi | Small stateless service; low request enables dense bin-packing, limit caps noisy-neighbor/runaway spend and is the signal the HPA scales against. |
| `mysql` | 250m CPU / 256Mi | 500m CPU / 512Mi | DB needs more baseline memory/CPU than the app; bounded so a single demo DB can't monopolize the node. |

**FinOps summary:** every container declares requests (for right-sizing and
scheduler bin-packing) and limits (to cap spend), and the stateless tier is
autoscaled so you only pay for capacity under actual load - on a single-node
Minikube, the minimal footprint suited to a dev/demo workload.

---

## 5. Verification

- **All objects running** - `kubectl get all,pv,pvc,configmap,secret,ingress -n student-app`
- **API ↔ DB** - `curl .../users` returns seeded rows
- **App self-healing** - delete a webapp pod → ReplicaSet recreates it, zero downtime
- **DB self-healing + persistence** - delete the MySQL pod → it returns with the
  same data (PV-backed)
- **Autoscaling** - `kubectl get hpa -n student-app`
- **Rollout strategy** - `kubectl get deploy ... -o jsonpath='{.spec.strategy}'`
