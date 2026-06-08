#!/usr/bin/env bash
# Deploy the webhook + chat UI to Cloud Run.
# Run from project root after provisioning + ingestion:  bash deploy/02_deploy_services.sh
set -euo pipefail

PROJECT="${GOOGLE_CLOUD_PROJECT:-autodev-agent}"
REGION="${GOOGLE_CLOUD_LOCATION:-us-central1}"
gcloud config set project "$PROJECT"

# Env passed to both services (VECTOR_* must already be in your .env / shell).
ENVVARS="GOOGLE_CLOUD_PROJECT=$PROJECT,GOOGLE_CLOUD_LOCATION=$REGION"
ENVVARS="$ENVVARS,GITLAB_URL=${GITLAB_URL:-https://gitlab.com}"
ENVVARS="$ENVVARS,VECTOR_INDEX_ID=${VECTOR_INDEX_ID:?set VECTOR_INDEX_ID}"
ENVVARS="$ENVVARS,VECTOR_INDEX_ENDPOINT_ID=${VECTOR_INDEX_ENDPOINT_ID:?set VECTOR_INDEX_ENDPOINT_ID}"
ENVVARS="$ENVVARS,VECTOR_DEPLOYED_INDEX_ID=${VECTOR_DEPLOYED_INDEX_ID:-gitlab_oracle_deployed}"
ENVVARS="$ENVVARS,AGENT_MODEL=${AGENT_MODEL:-gemini-2.5-pro}"

echo "==> Deploying chat UI..."
gcloud run deploy gitlab-oracle-ui \
  --source . --region "$REGION" --allow-unauthenticated \
  --memory 1Gi --timeout 300 \
  --set-env-vars "$ENVVARS,APP_MODULE=ui.main:app" \
  --set-secrets "GITLAB_PAT=gitlab-pat:latest"

echo "==> Deploying MR webhook..."
gcloud run deploy gitlab-oracle-webhook \
  --source . --region "$REGION" --allow-unauthenticated \
  --memory 1Gi --timeout 300 \
  --set-env-vars "$ENVVARS,APP_MODULE=webhook.main:app,GITLAB_WEBHOOK_SECRET=${GITLAB_WEBHOOK_SECRET:?set GITLAB_WEBHOOK_SECRET}" \
  --set-secrets "GITLAB_PAT=gitlab-pat:latest"

echo "✅ Deployed. UI + webhook URLs printed above."
echo "   Add the webhook URL (+ /webhook) and secret token to your FORK:"
echo "   Settings -> Webhooks -> URL=<webhook-url>/webhook, Secret token=GITLAB_WEBHOOK_SECRET, Trigger=Merge request events"
