#!/usr/bin/env bash
# Uploads prod GitHub Actions secrets.
# DB and Redis are passed as arguments; everything else is read from apps/api/.env.
#
# Usage:
#   bash scripts/upload-prod-secrets.sh "postgres://..." "rediss://..."

set -euo pipefail

PROD_DATABASE_URL="${1:-}"
PROD_REDIS_URL="${2:-}"

if [[ -z "$PROD_DATABASE_URL" || -z "$PROD_REDIS_URL" ]]; then
  echo "Usage: bash scripts/upload-prod-secrets.sh <PROD_DATABASE_URL> <PROD_REDIS_URL>" >&2
  exit 1
fi

ENV_FILE="apps/api/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found. Run from the repo root." >&2
  exit 1
fi

if ! gh auth status &>/dev/null; then
  echo "Error: gh CLI not authenticated. Run: winpty gh auth login" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

echo "Uploading prod secrets..."

gh secret set PROD_DATABASE_URL          --body "$PROD_DATABASE_URL"
gh secret set PROD_REDIS_URL             --body "$PROD_REDIS_URL"
gh secret set PROD_JWT_SECRET            --body "$JWT_SECRET"
gh secret set PROD_TWILIO_ACCOUNT_SID    --body "$TWILIO_ACCOUNT_SID"
gh secret set PROD_TWILIO_AUTH_TOKEN     --body "$TWILIO_AUTH_TOKEN"
gh secret set PROD_STRIPE_SECRET_KEY     --body "$STRIPE_SECRET_KEY"
gh secret set PROD_STRIPE_WEBHOOK_SECRET --body "$STRIPE_WEBHOOK_SECRET"

echo ""
echo "Done. All prod secrets set."
echo "Verify at: https://github.com/j2preston/quotebuilder/settings/secrets/actions"
