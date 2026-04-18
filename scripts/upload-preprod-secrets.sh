#!/usr/bin/env bash
# Reads apps/api/.env and uploads preprod + shared GitHub Actions secrets.
# Run from repo root: bash scripts/upload-preprod-secrets.sh
# Requires: gh CLI authenticated (gh auth login)

set -euo pipefail

ENV_FILE="apps/api/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found. Run from the repo root." >&2
  exit 1
fi

if ! gh auth status &>/dev/null; then
  echo "Error: gh CLI not authenticated. Run: gh auth login" >&2
  exit 1
fi

# Load .env without polluting the current shell
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

echo "Uploading preprod secrets..."

gh secret set PREPROD_DATABASE_URL          --body "$DATABASE_URL"
gh secret set PREPROD_REDIS_URL             --body "$REDIS_URL"
gh secret set PREPROD_JWT_SECRET            --body "$JWT_SECRET"
gh secret set PREPROD_TWILIO_ACCOUNT_SID    --body "$TWILIO_ACCOUNT_SID"
gh secret set PREPROD_TWILIO_AUTH_TOKEN     --body "$TWILIO_AUTH_TOKEN"
gh secret set PREPROD_STRIPE_SECRET_KEY     --body "$STRIPE_SECRET_KEY"
gh secret set PREPROD_STRIPE_WEBHOOK_SECRET --body "$STRIPE_WEBHOOK_SECRET"

echo "Uploading shared secrets..."

gh secret set ANTHROPIC_API_KEY               --body "$ANTHROPIC_API_KEY"
gh secret set AZURE_STORAGE_CONNECTION_STRING --body "$AZURE_STORAGE_CONNECTION_STRING"

echo ""
echo "Done. Verify at: https://github.com/j2preston/quotebuilder/settings/secrets/actions"
echo ""
echo "Still needed (prod values — set manually):"
echo "  PROD_DATABASE_URL"
echo "  PROD_REDIS_URL"
echo "  PROD_JWT_SECRET"
echo "  PROD_TWILIO_ACCOUNT_SID"
echo "  PROD_TWILIO_AUTH_TOKEN"
echo "  PROD_STRIPE_SECRET_KEY"
echo "  PROD_STRIPE_WEBHOOK_SECRET"
