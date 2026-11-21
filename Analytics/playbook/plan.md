# Plan: Run Playbook entirely on Google Cloud (Cloud Run + Cloud SQL Postgres)

## Context
Nothing is live yet. The app is one container (React SPA served by FastAPI) built by `backend/Dockerfile` (build context = `Analytics/playbook`), deployed to Cloud Run by `/.github/workflows/ci-cd.yml` (git root is `OnlyFootball/`; app lives under `Analytics/playbook/`). Missing: a database, runtime config/secrets, ML models in the image, migrations, data seeding, scheduled jobs. Target DB: Cloud SQL Postgres.

## Global Constraints
- GCP project `project-6e693c84-c360-41df-b83`, region `us-central1`, Artifact Registry repo `playbook`, Cloud Run service `playbook`.
- Names: Cloud SQL instance `playbook-db` (Postgres 16), database `nfl_analytics`, user `playbook`, runtime service account `playbook-runtime`, secret `playbook-database-url`, jobs `playbook-migrate`, `playbook-seed`, `playbook-refresh`, `playbook-train`.
- Cloud SQL connection name: `<project>:us-central1:playbook-db`; `DATABASE_URL` uses the unix-socket form `postgresql+psycopg://playbook:<pw>@/nfl_analytics?host=/cloudsql/<connection-name>`.
- Exactly one Cloud Run instance (`--min-instances=1 --max-instances=1`): the live ingester runs in-process. Keep `--no-cpu-throttling`.
- Never commit secrets or passwords. No `git push` to `main` without user approval.
- Do not touch the unrelated uncommitted files `README.md`, `.claude/launch.json`, `.github/workflows/test.yml`.

### Task 1: Bake ML model artifacts into the image
Files: `Analytics/playbook/.dockerignore`, `Analytics/playbook/backend/Dockerfile`.
- `.dockerignore` currently ignores `backend/storage`. Keep that, but add `!backend/storage/models` so the 2 MB tracked model files (`backend/storage/models/playcall_presnap`, `playcall_situation`, each with `<version>.txt/.json` and `latest`) enter the build context. Verify negation works: Docker needs the parent re-included correctly (use `backend/storage/*` + `!backend/storage/models` if required).
- `backend/Dockerfile`: before the `chown -R nflapp:nflapp /app` line, add `COPY backend/storage/models ./storage/models` (STORAGE_DIR is `/app/storage`). Update the nearby comment to explain why.
- Verify: `docker build -f backend/Dockerfile -t playbook-test .` from `Analytics/playbook`, then `docker run --rm playbook-test ls /app/storage/models/playcall_presnap`.

### Task 2: CI/CD workflow - migrate job, runtime config
File: `/.github/workflows/ci-cd.yml` (repo root `.github`, deploy job at the bottom).
- After "Build and push container image", add a step that deploys and runs the migration job:
  `gcloud run jobs deploy playbook-migrate --image <IMAGE_TAG> --region $GCP_REGION --service-account playbook-runtime@<project>.iam.gserviceaccount.com --set-cloudsql-instances <project>:$GCP_REGION:playbook-db --set-secrets DATABASE_URL=playbook-database-url:latest --command alembic --args upgrade,head --max-retries 0` followed by `gcloud run jobs execute playbook-migrate --region $GCP_REGION --wait`.
- In the "Deploy to Cloud Run" step flags, add: `--service-account=playbook-runtime@<project>.iam.gserviceaccount.com`, `--add-cloudsql-instances=<project>:<region>:playbook-db`, `--set-secrets=DATABASE_URL=playbook-database-url:latest`, `--set-env-vars=AUTO_SEED=0`, `--min-instances=1`, `--max-instances=1`, `--memory=2Gi`, `--cpu=1` (keep `--allow-unauthenticated` and `--no-cpu-throttling`).
- Use `${{ secrets.GCP_PROJECT_ID }}` for `<project>`; do not hard-code the project id. Keep YAML valid (check with `python -c "import yaml,sys; yaml.safe_load(open(...))"`).

### Task 3: Deployment docs and one-time setup script
Files: `Analytics/playbook/deploy/README.md` (rewrite), `Analytics/playbook/deploy/gcp-setup.sh` (new, executable).
- `gcp-setup.sh`: idempotent-ish bash script using `gcloud` that, given `PROJECT_ID` (default the project above) and `REGION`, enables APIs (`artifactregistry run cloudbuild iam sqladmin secretmanager cloudscheduler`), creates the Artifact Registry repo, the `github-actions-deployer` and `playbook-runtime` service accounts with roles (deployer: `artifactregistry.writer`, `run.admin`, `iam.serviceAccountUser`, `cloudsql.client`; runtime: `cloudsql.client`, `secretmanager.secretAccessor`), the Cloud SQL instance (Postgres 16, `db-f1-micro`, backups enabled), database and user (generate the password with `openssl rand`, never echo it), and the `playbook-database-url` secret. Each create step must tolerate "already exists". `set -euo pipefail`.
- `deploy/README.md`: document the architecture, running `gcp-setup.sh`, GitHub secrets (`GCP_PROJECT_ID`, `GCP_SA_KEY` or the Workload Identity pair, optional `GCP_REGION`/`CLOUD_RUN_SERVICE`/`ARTIFACT_REGISTRY_REPO`), the seed job (`playbook-seed`: `python -m app.cli seed`), the daily refresh job + Cloud Scheduler (`python -m app.cli refresh-nflverse 2026`), the manual train job (`python -m app.cli train 2025`, 4 GiB), verification steps, and the cost note (~$30-50/month).
- `bash -n deploy/gcp-setup.sh` must pass.

### Task 4: Probes, rollback and production-readiness notes
Files: `/.github/workflows/ci-cd.yml`, `Analytics/playbook/deploy/README.md`.
- Add Cloud Run startup and liveness probes on `GET /api/` (defined in `backend/app/main.py` `api_root`). Do NOT probe `/api/health`: it returns 503 whenever the last successful sync is older than 6 hours (`backend/app/api/routes.py`), which is true for a freshly migrated or seeding database and would crash-loop the service. Check the exact flag syntax with `gcloud run deploy --help` (e.g. `--startup-probe`/`--liveness-probe`, or a service YAML if flags are unavailable); startup probe must allow up to ~150s.
- Keep the `:<sha>` image tags already pushed so rollback is `gcloud run services update-traffic playbook --to-revisions=<previous>=100`; document this and the migration rule (migrations must stay backward-compatible with the previous revision) in `deploy/README.md`.
- In the README add a short production-readiness checklist: secrets only in Secret Manager, exactly one instance, Cloud SQL backups on, uptime check on `/api/health` (alerting only, not probes), and that the web service is public by design.
