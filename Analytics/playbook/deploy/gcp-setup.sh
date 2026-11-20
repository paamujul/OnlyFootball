#!/usr/bin/env bash
# One-time (re-runnable) GCP setup for Playbook: Artifact Registry, service
# accounts + IAM, Cloud SQL Postgres, and the DATABASE_URL secret.
#
# Usage: PROJECT_ID=my-project REGION=us-central1 ./deploy/gcp-setup.sh
#
# This creates BILLED resources (Cloud SQL). The script never prints the DB
# password or the secret value.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-project-6e693c84-c360-41df-b83}"
REGION="${REGION:-us-central1}"
REPO="${REPO:-playbook}"
SQL_INSTANCE="${SQL_INSTANCE:-playbook-db}"
DB_NAME="${DB_NAME:-playbook}"
DB_USER="${DB_USER:-playbook}"
SECRET_NAME="${SECRET_NAME:-playbook-database-url}"
DEPLOYER_SA_NAME="github-actions-deployer"
RUNTIME_SA_NAME="playbook-runtime"
DEPLOYER_SA="${DEPLOYER_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_SA="${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

G=(gcloud --project "$PROJECT_ID" --quiet)

log() { printf '==> %s\n' "$*"; }

log "Enabling APIs"
"${G[@]}" services enable \
  artifactregistry.googleapis.com run.googleapis.com cloudbuild.googleapis.com \
  iam.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com \
  cloudscheduler.googleapis.com

log "Artifact Registry repo '$REPO'"
if ! "${G[@]}" artifacts repositories describe "$REPO" --location "$REGION" >/dev/null 2>&1; then
  "${G[@]}" artifacts repositories create "$REPO" \
    --repository-format=docker --location "$REGION" \
    --description="Playbook Docker images"
fi

ensure_sa() { # name display-name
  if ! "${G[@]}" iam service-accounts describe "${1}@${PROJECT_ID}.iam.gserviceaccount.com" >/dev/null 2>&1; then
    "${G[@]}" iam service-accounts create "$1" --display-name "$2"
  fi
}

bind_project() { # member role
  "${G[@]}" projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:$1" --role "$2" --condition=None >/dev/null
}

log "Service accounts"
ensure_sa "$DEPLOYER_SA_NAME" "GitHub Actions Playbook Deployer"
ensure_sa "$RUNTIME_SA_NAME" "Playbook Cloud Run runtime"

log "Deployer IAM roles"
bind_project "$DEPLOYER_SA" roles/artifactregistry.writer
bind_project "$DEPLOYER_SA" roles/run.admin
# Scoped to the runtime SA only (not project-wide).
"${G[@]}" iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member "serviceAccount:$DEPLOYER_SA" --role roles/iam.serviceAccountUser >/dev/null

log "Runtime IAM roles"
bind_project "$RUNTIME_SA" roles/cloudsql.client

log "Cloud SQL instance '$SQL_INSTANCE' (can take several minutes)"
if ! "${G[@]}" sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1; then
  "${G[@]}" sql instances create "$SQL_INSTANCE" \
    --database-version=POSTGRES_16 --edition=ENTERPRISE --tier=db-f1-micro \
    --region "$REGION" --storage-size=10GB --storage-type=SSD \
    --backup --backup-start-time=03:00
fi

log "Database '$DB_NAME'"
if ! "${G[@]}" sql databases describe "$DB_NAME" --instance "$SQL_INSTANCE" >/dev/null 2>&1; then
  "${G[@]}" sql databases create "$DB_NAME" --instance "$SQL_INSTANCE"
fi

log "Secret '$SECRET_NAME'"
if "${G[@]}" secrets describe "$SECRET_NAME" >/dev/null 2>&1; then
  log "Secret already exists; leaving DB user/password untouched"
else
  # URL-safe password: strips / + = so no URL-encoding is needed.
  PW="$(openssl rand -base64 24 | tr -d '/+=')"
  # TRADEOFF: `gcloud sql users` has no stdin/file form for the password, so it
  # is briefly visible in this machine's process list (`ps`). Run this script
  # on a trusted, single-user machine (e.g. your own laptop or Cloud Shell).
  if "${G[@]}" sql users list --instance "$SQL_INSTANCE" --format='value(name)' | grep -qx "$DB_USER"; then
    "${G[@]}" sql users set-password "$DB_USER" --instance "$SQL_INSTANCE" --password="$PW" >/dev/null
  else
    "${G[@]}" sql users create "$DB_USER" --instance "$SQL_INSTANCE" --password="$PW" >/dev/null
  fi
  # Secret value goes via stdin only; never echoed.
  printf 'postgresql+psycopg://%s:%s@/%s?host=/cloudsql/%s:%s:%s' \
    "$DB_USER" "$PW" "$DB_NAME" "$PROJECT_ID" "$REGION" "$SQL_INSTANCE" |
    "${G[@]}" secrets create "$SECRET_NAME" --replication-policy=automatic --data-file=- >/dev/null
  unset PW
fi

# Secret-scoped (not project-wide) access for the runtime SA.
"${G[@]}" secrets add-iam-policy-binding "$SECRET_NAME" \
  --member "serviceAccount:$RUNTIME_SA" --role roles/secretmanager.secretAccessor >/dev/null

cat <<MSG

Setup complete.
  Project:       $PROJECT_ID
  Region:        $REGION
  Image repo:    ${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}
  Cloud SQL:     ${PROJECT_ID}:${REGION}:${SQL_INSTANCE}
  Secret:        $SECRET_NAME
  Deployer SA:   $DEPLOYER_SA
  Runtime SA:    $RUNTIME_SA

Next: create a key / Workload Identity for the deployer SA and add the GitHub
secrets (see deploy/README.md).
MSG
