#!/usr/bin/env bash
# QuoteBot deployment script
# Usage: ./deploy.sh [--infra-only] [--images-only]
#
# Prerequisites:
#   - Azure CLI logged in:  az login
#   - Docker running
#   - apps/api/infra/main.parameters.json filled from main.parameters.example.json
#
# On first run, omit flags to do a full deploy.
# Subsequent image-only deploys: ./deploy.sh --images-only

set -euo pipefail

RESOURCE_GROUP="rg-quotebot-prod"
LOCATION="uksouth"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
INFRA_ONLY=false
IMAGES_ONLY=false

for arg in "$@"; do
  case $arg in
    --infra-only)  INFRA_ONLY=true  ;;
    --images-only) IMAGES_ONLY=true ;;
  esac
done

# ── 1. Resource group ──────────────────────────────────────────────────────────

if [ "$IMAGES_ONLY" = false ]; then
  echo "▶ Creating resource group ${RESOURCE_GROUP} in ${LOCATION}..."
  az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

  PARAMS_FILE="${SCRIPT_DIR}/main.parameters.json"
  if [ ! -f "$PARAMS_FILE" ]; then
    echo "❌ ${PARAMS_FILE} not found."
    echo "   Copy main.parameters.example.json → main.parameters.json and fill in values."
    exit 1
  fi

  # ── 2. Bicep deployment ──────────────────────────────────────────────────────

  echo "▶ Deploying Bicep infrastructure (this takes ~10 min on first run)..."
  az deployment group create \
    --resource-group "$RESOURCE_GROUP" \
    --template-file "${SCRIPT_DIR}/main.bicep" \
    --parameters "@${PARAMS_FILE}" \
    --name "quotebot-$(date +%Y%m%d-%H%M%S)" \
    --output none

  echo "✅ Infrastructure deployed."
fi

# ── 3. Resolve ACR details ─────────────────────────────────────────────────────

ACR_NAME=$(az acr list --resource-group "$RESOURCE_GROUP" --query "[0].name" -o tsv)
ACR_LOGIN_SERVER=$(az acr show --name "$ACR_NAME" --query "loginServer" -o tsv)

echo "▶ ACR: ${ACR_LOGIN_SERVER}"

if [ "$INFRA_ONLY" = true ]; then
  echo "✅ Infra-only run complete."
  exit 0
fi

# ── 4. Build & push Docker images ─────────────────────────────────────────────

echo "▶ Logging in to ACR..."
az acr login --name "$ACR_NAME"

GIT_SHA=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo "manual")
API_IMAGE="${ACR_LOGIN_SERVER}/quotebot-api:${GIT_SHA}"
WEB_IMAGE="${ACR_LOGIN_SERVER}/quotebot-web:${GIT_SHA}"

echo "▶ Building API image (${API_IMAGE})..."
docker build \
  --file "${REPO_ROOT}/apps/api/Dockerfile" \
  --tag "$API_IMAGE" \
  --tag "${ACR_LOGIN_SERVER}/quotebot-api:latest" \
  "$REPO_ROOT"

echo "▶ Pushing API image..."
docker push "$API_IMAGE"
docker push "${ACR_LOGIN_SERVER}/quotebot-api:latest"

echo "▶ Building Web image (${WEB_IMAGE})..."
docker build \
  --file "${REPO_ROOT}/apps/web/Dockerfile" \
  --tag "$WEB_IMAGE" \
  --tag "${ACR_LOGIN_SERVER}/quotebot-web:latest" \
  "$REPO_ROOT"

echo "▶ Pushing Web image..."
docker push "$WEB_IMAGE"
docker push "${ACR_LOGIN_SERVER}/quotebot-web:latest"

# ── 5. Update Container Apps ───────────────────────────────────────────────────

echo "▶ Updating ca-quotebot-api → ${API_IMAGE}..."
az containerapp update \
  --name "ca-quotebot-api" \
  --resource-group "$RESOURCE_GROUP" \
  --image "$API_IMAGE" \
  --output none

echo "▶ Updating ca-quotebot-web → ${WEB_IMAGE}..."
az containerapp update \
  --name "ca-quotebot-web" \
  --resource-group "$RESOURCE_GROUP" \
  --image "$WEB_IMAGE" \
  --output none

# ── 6. Print endpoints ─────────────────────────────────────────────────────────

API_FQDN=$(az containerapp show \
  --name "ca-quotebot-api" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.configuration.ingress.fqdn" -o tsv)

WEB_FQDN=$(az containerapp show \
  --name "ca-quotebot-web" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.configuration.ingress.fqdn" -o tsv)

echo ""
echo "═══════════════════════════════════════════════"
echo "  ✅ QuoteBot deployed"
echo "═══════════════════════════════════════════════"
echo "  Web:  https://${WEB_FQDN}"
echo "  API:  https://${API_FQDN}"
echo ""
echo "  Twilio webhook URL:"
echo "  https://${API_FQDN}/api/webhooks/whatsapp"
echo ""
echo "  Next: run the DB migration once:"
echo "  See README — connect to PostgreSQL and run apps/api/src/db/schema.sql"
echo "═══════════════════════════════════════════════"
