#!/usr/bin/env bash
# Provision Google Cloud for GitLab Oracle.
# Run from project root:  bash deploy/01_provision_gcp.sh
set -euo pipefail

PROJECT="${GOOGLE_CLOUD_PROJECT:-autodev-agent}"
REGION="${GOOGLE_CLOUD_LOCATION:-us-central1}"

echo "Project=$PROJECT  Region=$REGION"
gcloud config set project "$PROJECT"

echo "==> Enabling APIs..."
gcloud services enable \
  aiplatform.googleapis.com \
  firestore.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  discoveryengine.googleapis.com

echo "==> Creating Firestore database (native mode)..."
gcloud firestore databases create --location="$REGION" 2>/dev/null \
  || echo "   (Firestore DB already exists — ok)"

echo "==> Storing GitLab PAT in Secret Manager..."
if ! gcloud secrets describe gitlab-pat >/dev/null 2>&1; then
  if [ -n "${GITLAB_PAT:-}" ]; then
    printf '%s' "$GITLAB_PAT" | gcloud secrets create gitlab-pat --data-file=-
  else
    echo "   Set GITLAB_PAT env var, then re-run, or create manually:"
    echo "   printf '%s' 'glpat-...' | gcloud secrets create gitlab-pat --data-file=-"
  fi
else
  echo "   (secret gitlab-pat already exists — ok)"
fi

echo "==> Creating Vertex AI Vector Search index + endpoint (billable, ~20-40 min)..."
PYTHONPATH="$(pwd)" python deploy/provision_vector_search.py

echo "✅ Provisioning complete. Paste the printed VECTOR_* IDs into .env."
