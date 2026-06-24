# Kubernetes Assignment - CRUD API on Minikube

A small Node.js (Express) REST API backed by MySQL, deployed to a single-node
Minikube cluster in Linux system. The app exposes user CRUD endpoints plus Swagger docs, and the
manifests demonstrate Namespaces, Secrets/ConfigMaps, static PV/PVC storage, a
MySQL `StatefulSet`-style Deployment with an init script, a Service, an Ingress,
and a HorizontalPodAutoscaler.

The enitre source is available in GitHub Repository

```
https://github.com/gauravgn90/nagp-2026-kubernetes-devops
```
The pre-built application image is published on Docker Hub:

```
gauravgn90/kube-app:v6
docker pull gauravgn90/kube-app:v6
```

The source for that image lives in [docker/image/api-service/](docker/image/api-service/).

---

## Architecture

```
                 Ingress (webapp.local)
                          │
                          ▼
            Service "webapp" (ClusterIP :80 → :3000)
                          │
                          ▼
          Deployment "webapp-deployment" (2 replicas)
            gauravgn90/kube-app:v6  (Node 24)
            initContainer waits for MySQL
                          │  reads MYSQL_* from
                          │  ConfigMap + Secret
                          ▼
            Headless Service "mysql" (:3306)
                          │
                          ▼
          Deployment "mysql" (mysql:8.4.9, Recreate)
            init.sql seeds `student.users`
                          │
                          ▼
        PVC "mysql-pv-claim" → PV "mysql-pv"
        StorageClass "manual" (hostPath /mnt/data/mysql)
```

Everything is deployed into the **`student-app`** namespace.

---

## Prerequisites

Install these first:

- [Minikube](https://minikube.sigs.k8s.io/docs/start/)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)
- A container/VM driver for Minikube (Docker is recommended)

Verify:

```bash
minikube version
kubectl version --client
```

---

## Quick start

### 1. Start Minikube

```bash
minikube start --driver=docker
```

### 2. Enable required add-ons

The manifests use an NGINX Ingress and an HPA (which needs metrics):

```bash
minikube addons enable ingress
minikube addons enable metrics-server
```

### 3. Deploy everything

The manifests are wired together with Kustomize, so a single command applies
all resources in the correct namespace:

```bash
kubectl apply -k yamls/
```

> The webapp Deployment already references `gauravgn90/kube-app:v6`, so nothing
> needs to be built locally — Kubernetes pulls it from Docker Hub.

### 4. Wait for the pods to be ready

```bash
kubectl get pods -n student-app -w
```

Expect to see `mysql-*` and two `webapp-deployment-*` pods reach `Running`/`Ready`.
The webapp pods use an init container that blocks until MySQL accepts
connections, so the first start can take a minute.

---

## Accessing the application

The Service is `ClusterIP`, exposed through the Ingress at host `webapp.local`.

### 1. Point `webapp.local` at the cluster

Get the Minikube IP and add a hosts entry:

```bash
minikube ip            # e.g. 192.168.49.2
```

Add this line to `/etc/hosts` (use the IP from above):

```
192.168.49.2  webapp.local
```

### 2. Open the app

If your driver supports it, run a tunnel in a separate terminal (Docker driver
on Linux/macOS usually needs this):

```bash
minikube tunnel        # leave running; may prompt for sudo
```

Then visit:

- App root:  http://webapp.local/
- Swagger UI: http://webapp.local/api-docs
- Users:      http://webapp.local/users

### Alternative: port-forward (no Ingress / hosts setup)

```bash
kubectl port-forward -n student-app svc/webapp 8080:80
```

Then use http://localhost:8080/ , http://localhost:8080/api-docs , etc.

---

## API endpoints

| Method | Path          | Description                |
|--------|---------------|----------------------------|
| GET    | `/`           | Health/welcome message     |
| GET    | `/api-docs`   | Swagger UI                 |
| GET    | `/users`      | List all users             |
| POST   | `/users`      | Create a user              |
| PUT    | `/users/:id`  | Update a user              |
| DELETE | `/users/:id`  | Delete a user              |

Example (via port-forward on :8080):

```bash
# list seeded users
curl http://webapp.local/users

# create a user
curl -X POST http://webapp.local/users \
  -H 'Content-Type: application/json' \
  -d '{"name":"Alice","email":"alice@example.com","phone":"9000000000"}'
```

The `student.users` table is created and seeded automatically by the init
script in [yamls/05-mysql-init-script-config.yaml](yamls/05-mysql-init-script-config.yaml).

---

## What gets deployed

Applied in order via [yamls/kustomization.yaml](yamls/kustomization.yaml):

| File | Resource |
|------|----------|
| `00-namespace.yaml` | Namespace `student-app` |
| `01-manual-storageclass.yaml` | StorageClass `manual` (no-provisioner, hostPath) |
| `02-mysql-pv.yaml` | PersistentVolume `mysql-pv` (hostPath `/mnt/data/mysql`) |
| `03-mysql-secret.yaml` | Secret `mysql-secret` (db user/pass/name) |
| `04-mysql-config.yaml` | ConfigMap `mysql-config` (host/port) |
| `05-mysql-init-script-config.yaml` | ConfigMap with `init.sql` |
| `06-mysql-pvc.yaml` | PVC `mysql-pv-claim` |
| `07-mysql-deployment.yaml` | MySQL Deployment (`mysql:8.4.9`, Recreate) |
| `08-mysql-service.yaml` | Headless Service `mysql` |
| `09-webapp-deployment.yaml` | Webapp Deployment (`gauravgn90/kube-app:v6`, 2 replicas) |
| `10-webapp-service.yaml` | Service `webapp` (ClusterIP) |
| `11-webapp-hpa.yaml` | HPA (2–10 replicas, 60% CPU) |
| `12-webapp-ingress.yaml` | Ingress `webapp.local` |

### Default credentials (from the Secret)

| Key | Value |
|-----|-------|
| username | `root` |
| password | `root` |
| database | `student` |

> These are demo defaults stored in `03-mysql-secret.yaml`. Change them for any
> real use.

---

## (Optional) Rebuild the image yourself

The cluster already uses the published `gauravgn90/kube-app:v6` image. To build
your own from source:

```bash
cd docker/image/api-service

# build
docker build -t <your-dockerhub-user>/kube-app:v6 .

# push
docker login
docker push <your-dockerhub-user>/kube-app:v6
```

Then update the `image:` field in
[yamls/09-webapp-deployment.yaml](yamls/09-webapp-deployment.yaml#L32) and
re-apply:

```bash
kubectl apply -k yamls/
```
---

## Troubleshooting

```bash
# overall status
kubectl get all -n student-app

# webapp logs (env vars + DB connection are logged at startup)
kubectl logs -n student-app deploy/webapp-deployment

# mysql logs
kubectl logs -n student-app deploy/mysql

# describe a pending pod (PV binding, image pull, etc.)
kubectl describe pod -n student-app <pod-name>

# HPA status (needs metrics-server)
kubectl get hpa -n student-app

# ingress status
kubectl get ingress -n student-app
```

Common issues:

- **Webapp stuck in `Init:`** — MySQL isn't ready yet; the init container is
  waiting on port 3306. Check the `mysql` pod.
- **`webapp.local` doesn't resolve** — confirm the `/etc/hosts` entry and that
  `minikube tunnel` is running (Docker driver).
- **HPA shows `<unknown>` targets** — `metrics-server` add-on isn't enabled or
  hasn't scraped yet.
- **PVC `Pending`** — the `manual` StorageClass uses `WaitForFirstConsumer`, so
  the PV binds only once the MySQL pod is scheduled. This is expected.

---

## Tear down

```bash
# remove the application resources
kubectl delete -k yamls/

# or stop/delete the whole cluster
minikube stop
minikube delete
```
