# Deployment Setup Guide

Getting preprod and prod live with separate environments and automatic deployments.

---

## Overview

| | Preprod | Prod |
|---|---|---|
| Branch | `master` | `main` |
| API app | `ca-quotebot-api-preprod` | `ca-quotebot-api` |
| Web app | `ca-quotebot-web-preprod` | `ca-quotebot-web` |
| Replicas | 0 min (scales to zero) | 1 min (always warm) |
| Twilio | Sandbox (`+14155238886`) | Live per-trader numbers |
| Stripe | `sk_test_...` | `sk_live_...` |

---

## Prerequisites

- `az` CLI installed and logged in (`az login`)
- `gh` CLI installed and authenticated (`gh auth login`)
- Docker running locally (only needed if building locally; CI handles it otherwise)
- Access to the `rg-quotebot-prod` resource group

---

## Step 1 — Enable ACR admin (one-off)

Bicep retrieves ACR credentials at deploy time via `listCredentials()`.
ACR admin must be enabled for this to work.

```bash
az acr update \
  --name quotebotmqpcv63d \
  --resource-group rg-quotebot-prod \
  --admin-enabled true
```

---

## Step 2 — Create the preprod Postgres database (one-off)

Find your Postgres server name first:

```bash
az postgres flexible-server list \
  --resource-group rg-quotebot-prod \
  --query "[].name" -o tsv
```

Then create the preprod database on that server:

```bash
az postgres flexible-server db create \
  --resource-group rg-quotebot-prod \
  --server-name <YOUR_PG_SERVER_NAME> \
  --database-name quotebot_preprod
```

Then run `schema.sql` against the new database to create all tables and seed data:

```bash
psql "<PREPROD_DATABASE_URL>" -f apps/api/src/db/schema.sql
```

---

## Step 3 — Create the preprod container apps (one-off)

These only need to be created once. Bicep will manage them from that point on.

```bash
# Get the Container Apps environment name
ENV_NAME=$(az containerapp env list \
  --resource-group rg-quotebot-prod \
  --query "[0].name" -o tsv)

ACR_SERVER=quotebotmqpcv63d.azurecr.io

# API
az containerapp create \
  --name ca-quotebot-api-preprod \
  --resource-group rg-quotebot-prod \
  --environment $ENV_NAME \
  --image ${ACR_SERVER}/quotebot-api:latest \
  --registry-server $ACR_SERVER \
  --target-port 3001 \
  --ingress external \
  --min-replicas 0 \
  --max-replicas 1 \
  --cpu 0.25 --memory 0.5Gi

# Web
az containerapp create \
  --name ca-quotebot-web-preprod \
  --resource-group rg-quotebot-prod \
  --environment $ENV_NAME \
  --image ${ACR_SERVER}/quotebot-web:latest \
  --registry-server $ACR_SERVER \
  --target-port 80 \
  --ingress external \
  --min-replicas 0 \
  --max-replicas 1 \
  --cpu 0.25 --memory 0.5Gi
```

---

## Step 4 — Upload preprod GitHub secrets

Run from the repo root in Git Bash. Reads `apps/api/.env` and uploads directly to GitHub — values never go through any intermediate system.

```bash
bash scripts/upload-preprod-secrets.sh
```

This sets:

| GitHub Secret | Source |
|---|---|
| `PREPROD_DATABASE_URL` | `DATABASE_URL` from `.env` |
| `PREPROD_REDIS_URL` | `REDIS_URL` from `.env` |
| `PREPROD_JWT_SECRET` | `JWT_SECRET` from `.env` |
| `PREPROD_TWILIO_ACCOUNT_SID` | `TWILIO_ACCOUNT_SID` from `.env` |
| `PREPROD_TWILIO_AUTH_TOKEN` | `TWILIO_AUTH_TOKEN` from `.env` |
| `PREPROD_STRIPE_SECRET_KEY` | `STRIPE_SECRET_KEY` from `.env` (must be `sk_test_...`) |
| `PREPROD_STRIPE_WEBHOOK_SECRET` | `STRIPE_WEBHOOK_SECRET` from `.env` |
| `ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` from `.env` (shared) |
| `AZURE_STORAGE_CONNECTION_STRING` | from `.env` (shared) |

---

## Step 5 — Upload prod GitHub secrets (manual)

Prod secrets are **different values** from preprod — set them individually.
Go to: **GitHub → Settings → Secrets and variables → Actions → New repository secret**

Or use the `gh` CLI one at a time:

```bash
gh secret set PROD_DATABASE_URL          --body "postgres://..."
gh secret set PROD_REDIS_URL             --body "rediss://..."
gh secret set PROD_JWT_SECRET            --body "..."
gh secret set PROD_TWILIO_ACCOUNT_SID    --body "AC..."
gh secret set PROD_TWILIO_AUTH_TOKEN     --body "..."
gh secret set PROD_STRIPE_SECRET_KEY     --body "sk_live_..."
gh secret set PROD_STRIPE_WEBHOOK_SECRET --body "whsec_..."
```

> `ANTHROPIC_API_KEY` and `AZURE_STORAGE_CONNECTION_STRING` were already set
> as shared secrets in Step 4 and are reused by both environments.

---

## Step 6 — Preview prod Bicep changes (safety check)

Before the first prod deployment via Bicep, run a what-if to see exactly what
will change on the existing prod container apps. No changes are applied.

```bash
az deployment group what-if \
  --resource-group rg-quotebot-prod \
  --template-file infra/main.bicep \
  --parameters @infra/environments/prod.parameters.json \
  --parameters \
    apiImage="quotebotmqpcv63d.azurecr.io/quotebot-api:latest" \
    webImage="quotebotmqpcv63d.azurecr.io/quotebot-web:latest" \
    databaseUrl="<PROD_DATABASE_URL>" \
    redisUrl="<PROD_REDIS_URL>" \
    jwtSecret="<PROD_JWT_SECRET>" \
    anthropicApiKey="<ANTHROPIC_API_KEY>" \
    twilioAccountSid="<PROD_TWILIO_ACCOUNT_SID>" \
    twilioAuthToken="<PROD_TWILIO_AUTH_TOKEN>" \
    stripeSecretKey="<PROD_STRIPE_SECRET_KEY>" \
    stripeWebhookSecret="<PROD_STRIPE_WEBHOOK_SECRET>" \
    azureStorageConnectionString="<AZURE_STORAGE_CONNECTION_STRING>"
```

Review the output. Expected changes on first run:
- Env vars set/updated on `ca-quotebot-api` (Bicep now owns them)
- Scaling policy applied (min 1, max 3)
- ACR registry credentials added to container app config

If anything looks unexpected, investigate before proceeding.

---

## Step 7 — Trigger deployments

**Preprod** — push any commit to `master` (already happens on every commit):

```bash
git push origin master
```

The `deploy-preprod.yml` workflow runs automatically. First run creates the
preprod container apps via Bicep; subsequent runs update images and config.

**Prod** — push to `main` (only do this deliberately):

```bash
git push origin master:main
```

The `deploy-prod.yml` workflow runs. First run takes ownership of the existing
prod container apps via Bicep.

---

## Step 8 — Verify

After each deployment, check the GitHub Actions summary for the URLs.
Then smoke-test:

```bash
# Health check
curl https://ca-quotebot-api-preprod.thankfuldune-b686df08.uksouth.azurecontainerapps.io/health
curl https://ca-quotebot-api.thankfuldune-b686df08.uksouth.azurecontainerapps.io/health

# Both should return: {"status":"ok","ts":"..."}
```

Open the web URLs in a browser and confirm login works.

---

## Ongoing workflow

```
feature work  →  commit  →  push origin master
                              ↓
                         preprod deploys automatically
                              ↓
                         test on preprod
                              ↓
                    push origin master:main
                              ↓
                         prod deploys automatically
```

---

## Notes

- **`prod.parameters.json` has `twilioWhatsappNumber: ""`** — fill this in once
  you have a live Twilio sender number for prod.
- **Stripe price IDs** (`stripePriceIdStarter`, `stripePriceIdPro`) in both
  parameters files are empty until Stripe billing is implemented (P3.5).
- **Redis** — preprod and prod can share the same Redis instance safely.
  Keys are scoped by phone numbers and message SIDs which don't collide.
  If you want full isolation later, append `/1` to the preprod Redis URL to
  use DB index 1.
- **Blob storage** — same Azure Storage account, different containers:
  `voice-notes-preprod` / `quote-pdfs-preprod` vs `voice-notes` / `quote-pdfs`.
  The containers are created automatically on first use.
- **`001_initial.sql`** in `apps/api/src/db/migrations/` is an old unused
  schema from an early design iteration. It does not match the current schema
  and should not be run. The canonical schema is `apps/api/src/db/schema.sql`.
