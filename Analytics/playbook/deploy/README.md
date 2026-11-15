# Deploying Playbook to Google Cloud Platform (GCP)

This guide walks you through setting up automated deployments to **Google Cloud Run** using GitHub Actions.

---

## 1. Prerequisites on GCP

Make sure you have the [Google Cloud SDK (`gcloud`)](https://cloud.google.com/sdk/docs/install) installed and authenticated:

```bash
gcloud auth login
gcloud config set project project-6e693c84-c360-41df-b83
```

Enable the required GCP APIs:

```bash
gcloud services enable \
  artifactregistry.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  iam.googleapis.com
```

---

## 2. Create Artifact Registry Docker Repository

Create an Artifact Registry repository to hold your Docker images:

```bash
gcloud artifacts repositories create playbook \
  --repository-format=docker \
  --location=us-central1 \
  --description="Playbook Docker repository"
```

---

## 3. Create Service Account for GitHub Actions

Create a dedicated Service Account for deployment:

```bash
export PROJECT_ID=$(gcloud config get-value project)
export SA_NAME="github-actions-deployer"

# 1. Create Service Account
gcloud iam service-accounts create $SA_NAME \
  --display-name="GitHub Actions Playbook Deployer"

export SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# 2. Grant Artifact Registry Writer role
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/artifactregistry.writer"

# 3. Grant Cloud Run Admin role
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/run.admin"

# 4. Grant Service Account User role (to run as the runtime service account)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/iam.serviceAccountUser"
```

---

## 4. Generate Key & Add GitHub Secrets

Generate a JSON key for this Service Account:

```bash
gcloud iam service-accounts keys create sa-key.json \
  --iam-account=${SA_EMAIL}
```

Now, navigate to your GitHub repository:
👉 **Settings > Secrets and variables > Actions > New repository secret**

Add the following secrets:

| Secret Name | Value | Description |
| :--- | :--- | :--- |
| `GCP_PROJECT_ID` | `<YOUR_GCP_PROJECT_ID>` | Your Google Cloud project ID |
| `GCP_SA_KEY` | Contents of `sa-key.json` | Full JSON key for the deployer account |
| `GCP_REGION` | `us-central1` *(optional)* | Preferred GCP region (default: `us-central1`) |
| `CLOUD_RUN_SERVICE` | `playbook` *(optional)* | Cloud Run service name (default: `playbook`) |
| `ARTIFACT_REGISTRY_REPO` | `playbook` *(optional)* | Artifact Registry repository (default: `playbook`) |



> [!CAUTION]
> Delete the local `sa-key.json` file once added to GitHub secrets so it is never committed:
> ```bash
> rm -f sa-key.json
> ```

---

## 5. Automated CI/CD Execution

Once secrets are in place:
1. Every **pull request** touching `Analytics/playbook/**` automatically runs:
   - Backend tests (pytest) against PostgreSQL and SQLite with Alembic migrations.
   - Frontend linting (`npm run lint`) and type-checking + build (`npm run build`).
2. Every **push or merge to `main`** executes the test suite, builds the Docker container, pushes it to Google Artifact Registry, and deploys it to Cloud Run with `--no-cpu-throttling` (so background live polling stays active).

