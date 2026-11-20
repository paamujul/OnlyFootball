# Deploying Playbook to Google Cloud (Cloud Run + Cloud SQL)

## Architecture

- One container (frontend + API + live poller) on **Cloud Run**, `min-instances=1`,
  `max-instances=1`, `--no-cpu-throttling` so background polling keeps running.
- **Cloud SQL for PostgreSQL 16** (`playbook-db`, `db-f1-micro`, daily backups),
  attached to Cloud Run through the Cloud SQL connector (unix socket).
- `DATABASE_URL` lives in **Secret Manager** (`playbook-database-url`) and is
  injected into the service and jobs.
- Images are stored in **Artifact Registry**: `<region>-docker.pkg.dev/<project>/playbook/app`.
- GitHub Actions (`.github/workflows/ci-cd.yml`) tests, builds, pushes, runs the
  `playbook-migrate` Cloud Run Job (`alembic upgrade head`), then deploys the service.
- Service accounts: `github-actions-deployer` (CI) and `playbook-runtime` (service and jobs).

> **Warning:** the GitHub `deploy` job will fail (or deploy a service with no
> database) until step 1 has been run **and** the GitHub secrets in step 2 are set.
> Do steps 1 and 2 before merging to `main`.

## 1. Run the one-time setup script

Requires `gcloud` (authenticated: `gcloud auth login`) and `openssl`.
**This creates billed resources** (see Cost).

```bash
PROJECT_ID=<your-project-id> REGION=us-central1 ./Analytics/playbook/deploy/gcp-setup.sh
```

Run it from a trusted single-user machine or Cloud Shell: `gcloud sql users create --password` briefly exposes the DB password in the process list (`ps`).

It is safe to re-run. It enables APIs, creates the Artifact Registry repo, both
service accounts and their roles, the Cloud SQL instance/database/user, and the
`playbook-database-url` secret (random password, never printed). If the secret
already exists the DB user and password are left untouched.

Roles granted:

| Account | Roles |
| :--- | :--- |
| `github-actions-deployer` | `artifactregistry.writer`, `run.admin`, `cloudsql.client`, `iam.serviceAccountUser` (on `playbook-runtime` only) |
| `playbook-runtime` | `cloudsql.client`, `secretmanager.secretAccessor` (on the secret only) |

## 2. GitHub secrets

Authentication, choose one:

```bash
# Option A: service account key (simplest)
gcloud iam service-accounts keys create sa-key.json \
  --iam-account=github-actions-deployer@<PROJECT_ID>.iam.gserviceaccount.com
# paste the file contents into GCP_SA_KEY, then:
rm -f sa-key.json
```

Option B: Workload Identity Federation (no long-lived key): set
`GCP_WORKLOAD_IDENTITY_PROVIDER` (and, if the workflow requires it, the
service account) instead of `GCP_SA_KEY`.

**Settings > Secrets and variables > Actions**:

| Secret | Value |
| :--- | :--- |
| `GCP_PROJECT_ID` | your project ID (required) |
| `GCP_SA_KEY` | deployer key JSON (or use the Workload Identity pair) |
| `GCP_REGION` | optional, default `us-central1` |
| `CLOUD_RUN_SERVICE` | optional, default `playbook` |
| `ARTIFACT_REGISTRY_REPO` | optional, default `playbook` |

Never commit `sa-key.json`.

## 3. First deploy

Push to `main` (or run the workflow manually). The pipeline migrates the schema
via `playbook-migrate`, then deploys the service. The service starts with
`AUTO_SEED=0`, so the database is empty until you seed it (step 4).

Variables used below (match the workflow defaults):

```bash
export PROJECT_ID=<your-project-id> REGION=us-central1
export IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/playbook/app:latest
export RUNTIME_SA=playbook-runtime@$PROJECT_ID.iam.gserviceaccount.com
export SQL=$PROJECT_ID:$REGION:playbook-db
```

The workflow pushes both `:<sha>` and `:latest` tags, so the job commands below use `:latest`.

## 4. Seed job (run once)

```bash
gcloud run jobs deploy playbook-seed \
  --image $IMAGE --region $REGION --project $PROJECT_ID \
  --service-account $RUNTIME_SA \
  --set-cloudsql-instances $SQL \
  --set-secrets DATABASE_URL=playbook-database-url:latest \
  --memory 2Gi --task-timeout 3600 --max-retries 0 \
  --command python --args -m,app.cli,seed

gcloud run jobs execute playbook-seed --region $REGION --project $PROJECT_ID --wait
```

## 5. Daily refresh job + Cloud Scheduler

```bash
gcloud run jobs deploy playbook-refresh \
  --image $IMAGE --region $REGION --project $PROJECT_ID \
  --service-account $RUNTIME_SA \
  --set-cloudsql-instances $SQL \
  --set-secrets DATABASE_URL=playbook-database-url:latest \
  --memory 2Gi --task-timeout 1800 --max-retries 1 \
  --command python --args -m,app.cli,refresh-nflverse,2026

# Allow the runtime SA to trigger the job
gcloud run jobs add-iam-policy-binding playbook-refresh \
  --region $REGION --project $PROJECT_ID \
  --member serviceAccount:$RUNTIME_SA --role roles/run.invoker

gcloud scheduler jobs create http playbook-refresh-daily \
  --project $PROJECT_ID --location $REGION \
  --schedule "0 9 * * *" --time-zone "UTC" \
  --http-method POST \
  --uri "https://run.googleapis.com/v2/projects/$PROJECT_ID/locations/$REGION/jobs/playbook-refresh:run" \
  --oauth-service-account-email $RUNTIME_SA
```

Bump the season argument (`2026`) when a new season starts.

## 6. Manual train job (4 GiB)

```bash
gcloud run jobs deploy playbook-train \
  --image $IMAGE --region $REGION --project $PROJECT_ID \
  --service-account $RUNTIME_SA \
  --set-cloudsql-instances $SQL \
  --set-secrets DATABASE_URL=playbook-database-url:latest \
  --memory 4Gi --cpu 2 --task-timeout 3600 --max-retries 0 \
  --command python --args -m,app.cli,train,2025

gcloud run jobs execute playbook-train --region $REGION --project $PROJECT_ID --wait
```

Run it manually whenever you want to retrain; models are not committed to the image.

## 7. Verify

```bash
URL=$(gcloud run services describe playbook --region $REGION --project $PROJECT_ID --format='value(status.url)')
curl -fsS "$URL/api/health"          # expect a healthy response
gcloud run jobs executions list --job playbook-migrate --region $REGION --project $PROJECT_ID
gcloud run services logs read playbook --region $REGION --project $PROJECT_ID --limit 50
```

Open `$URL` in a browser and confirm teams/games load after the seed job. If the
health path differs, check `backend/app` for the actual route.

## Health probes

The workflow sets (verified against `gcloud run deploy --help`, gcloud 564.0.0, GA flags):

- `--port=8080`: Cloud Run sends traffic to 8080 and injects `PORT=8080`; the
  image `CMD` uses `${PORT:-8600}`, so it listens on 8080 on Cloud Run (8600 only locally).
- Startup probe `GET /api/` every 5s, 30 failures allowed (~150s to start).
- Liveness probe `GET /api/` every 30s, 3 failures to restart.

`/api/` only proves the process is serving. Do **not** probe `/api/health`: it
returns 503 when the last successful sync is more than 6 hours old (always true
for a fresh or empty database) and would crash-loop the service.

## Rollback

Images are kept under `:<sha>` tags in Artifact Registry, so every revision stays deployable.

```bash
gcloud run revisions list --service playbook --region $REGION --project $PROJECT_ID
gcloud run services update-traffic playbook \
  --to-revisions=<REVISION>=100 --region us-central1 --project $PROJECT_ID
```

Rule: migrations run before the new revision deploys, so every migration must be
backward-compatible with the previous revision (add columns/tables, do not drop
or rename in the same release). Otherwise a rollback will break on the new schema.
Run `gcloud run services update-traffic playbook --to-latest` to return to the newest revision.

## Production-readiness checklist

- [ ] Secrets only in Secret Manager (`playbook-database-url`); none in the repo or image.
- [ ] Exactly one instance (`min-instances=1`, `max-instances=1`) so the poller runs once.
- [ ] Cloud SQL automated backups enabled.
- [ ] Cloud Monitoring uptime check on `/api/health` for alerting only (not a probe).
- [ ] Service is public by design (`--allow-unauthenticated`); the app has no auth.

## Cost

Roughly **$30-50/month**: the always-on Cloud Run instance (min 1, no CPU
throttling) is the largest part, plus `db-f1-micro` Cloud SQL, storage, and
small Artifact Registry/Secret Manager charges. Job runs are billed per use.
To stop spending, delete the Cloud Run service, jobs, scheduler job and the
Cloud SQL instance.
