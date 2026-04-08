Web: https://ca-quotebot-web.thankfuldune-b686df08.uksouth.azurecontainerapps.io
API: https://ca-quotebot-api.thankfuldune-b686df08.uksouth.azurecontainerapps.io



#

 QuoteBot

AI-powered quoting tool for UK tradespeople. Dictate a job description, get a professional quote in seconds.

## Tech stack

| Layer | Technology |
|---|---|
| API | Fastify + Node.js 20 (ESM) |
| Web | React 18 + Vite + Tailwind CSS (PWA) |
| Shared | TypeScript package (`@quotebot/shared`) |
| Database | PostgreSQL 16 |
| Cache | Redis 7 |
| AI | Anthropic Claude (job extraction + pricing) |
| Messaging | Twilio WhatsApp |
| Storage | Azure Blob Storage (PDF quotes) |
| Infra | Azure Container Apps + Bicep |

---

## Local development

### Prerequisites

- [Node.js 20+](https://nodejs.org)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for Postgres + Redis)
- An [Anthropic API key](https://console.anthropic.com) (optional — only needed for the Dictate feature)

### 1. Install dependencies

```powershell
npm install
```

### 2. Configure environment

```powershell
copy apps\api\.env apps\api\.env.local
```

Edit `apps/api/.env` and fill in at minimum:

```env
JWT_SECRET=any-long-random-string-at-least-64-chars
```

Everything else is optional for basic login/register flow. See the table below for what each key enables.

| Key | Required for |
|---|---|
| `JWT_SECRET` | Login / register (required) |
| `ANTHROPIC_API_KEY` | Dictate a quote |
| `TWILIO_*` | Sending quotes via WhatsApp |
| `STRIPE_*` | Subscription billing |
| `AZURE_STORAGE_*` | PDF generation + upload |

### 3. Start Postgres and Redis

```powershell
docker run -d --name quotebot-pg `
  -e POSTGRES_PASSWORD=postgres `
  -e POSTGRES_DB=quotebot `
  -p 5432:5432 postgres:16

docker run -d --name quotebot-redis `
  -p 6379:6379 redis:7
```

On subsequent runs, the containers already exist — just start them:

```powershell
docker start quotebot-pg quotebot-redis
```

### 4. Run the database migration

```powershell
npm run migrate -w apps/api
```

### 5. Start the servers

Open two terminals:

**Terminal 1 — API (port 3001):**
```powershell
npm run dev -w apps/api
```

**Terminal 2 — Web (port 5173):**
```powershell
npm run dev -w apps/web
```

Open **http://localhost:5173** in your browser.

The Vite dev server proxies all `/api` requests to the API at `:3001` — no CORS issues.

### Run tests

```powershell
npm test -w apps/api
```

52 unit tests covering the pricing engine.

---

## Production deployment (Azure)

### Prerequisites

- [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) installed and logged in
- A GitHub repository with this code pushed to `main`
- An Azure subscription

### 1. Fill in deployment parameters

```powershell
copy apps\api\infra\main.parameters.example.json apps\api\infra\main.parameters.json
```

Edit `main.parameters.json` with real values:

| Parameter | Where to get it |
|---|---|
| `pgAdminPassword` | Choose a strong password (16+ chars) |
| `jwtSecret` | Generate: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `anthropicApiKey` | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| `twilioAccountSid` / `twilioAuthToken` | [console.twilio.com](https://console.twilio.com) |
| `stripeSecretKey` / `stripeWebhookSecret` | [dashboard.stripe.com](https://dashboard.stripe.com) |

> `main.parameters.json` is gitignored — never commit it.

### 2. Log in to Azure

```powershell
az login
```

### 3. Deploy infrastructure + images

```powershell
.\apps\api\infra\deploy.ps1
```

This will:
1. Create resource group `rg-quotebot-prod` in `uksouth`
2. Deploy all Azure resources via Bicep (~10 min)
3. Build and push Docker images to Azure Container Registry
4. Update the Container Apps with the new images

At the end it prints your URLs.

**Flags:**

```powershell
.\apps\api\infra\deploy.ps1 -InfraOnly   # Bicep only, skip Docker
.\apps\api\infra\deploy.ps1 -ImagesOnly  # Docker build/push only, skip Bicep
```

### 4. Run the database migration (first time only)

In [Azure Cloud Shell](https://shell.azure.com) (Bash):

```bash
pg=$(az postgres flexible-server list -g rg-quotebot-prod --query "[0].fullyQualifiedDomainName" -o tsv)
psql "postgresql://quotebotadmin:YOUR_PG_PASSWORD@$pg:5432/quotebot?sslmode=require"
```

Then paste the contents of `apps/api/src/db/schema.sql` at the prompt and press Enter.

### 5. Configure Twilio webhook

After deployment, set your Twilio WhatsApp sandbox/number webhook URL to:

```
https://<api-fqdn>/api/webhooks/whatsapp
```

Get your API FQDN:
```powershell
az containerapp show -n ca-quotebot-api -g rg-quotebot-prod `
  --query "properties.configuration.ingress.fqdn" -o tsv
```

### Subsequent deployments

Push to `main` on GitHub — the Actions workflow (`.github/workflows/deploy.yml`) builds both images and updates the Container Apps automatically.

To deploy manually without GitHub Actions:

```powershell
.\apps\api\infra\deploy.ps1 -ImagesOnly
```

### Azure resources created

| Resource | Name pattern | Purpose |
|---|---|---|
| Container Registry | `quotebot{suffix}` | Stores Docker images |
| Container App — API | `ca-quotebot-api` | Fastify API (scales to zero) |
| Container App — Web | `ca-quotebot-web` | React PWA via nginx (scales to zero) |
| Container Apps Environment | `cae-quotebot-prod` | Shared networking + logging |
| PostgreSQL Flexible Server | `psql-quotebot-{suffix}` | Main database |
| Redis Cache | `redis-quotebot-{suffix}` | WhatsApp session state |
| Storage Account | `stqbot{suffix}` | PDF quote storage |
| Key Vault | `kvqbot{suffix}` | All secrets |
| Log Analytics | `log-quotebot-prod` | Centralised logs |

All secrets are stored in Key Vault and injected into Container Apps at runtime — nothing is baked into images.
