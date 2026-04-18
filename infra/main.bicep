targetScope = 'resourceGroup'

// ── Environment ───────────────────────────────────────────────────────────────

@description('Short environment name — drives resource names and sizing')
@allowed(['preprod', 'prod'])
param env string

param location string = resourceGroup().location

// ── Images (injected by CI) ───────────────────────────────────────────────────

@description('Full image ref for the API, e.g. quotebotmqpcv63d.azurecr.io/quotebot-api:preprod-abc123')
param apiImage string

@description('Full image ref for the web app')
param webImage string

// ── Existing shared infrastructure ────────────────────────────────────────────

@description('Name of the Azure Container Registry in this resource group')
param acrName string

@description('Resource ID of the shared Container Apps managed environment')
param containerAppEnvironmentId string

// ── Non-secret config (safe to commit) ───────────────────────────────────────

param frontendUrl string
param appUrl string

@description('WhatsApp sender number, e.g. +14155238886 for Twilio sandbox')
param twilioWhatsappNumber string

param stripePriceIdStarter string = ''
param stripePriceIdPro string = ''

// ── Secrets (passed from GitHub secrets — never committed) ────────────────────

@secure()
param databaseUrl string

@secure()
param redisUrl string

@secure()
param jwtSecret string

@secure()
param anthropicApiKey string

@secure()
param twilioAccountSid string

@secure()
param twilioAuthToken string

@secure()
param stripeSecretKey string

@secure()
param stripeWebhookSecret string

@secure()
param azureStorageConnectionString string

// ── Derived values ────────────────────────────────────────────────────────────

var isProd       = env == 'prod'
var apiAppName   = isProd ? 'ca-quotebot-api'       : 'ca-quotebot-api-${env}'
var webAppName   = isProd ? 'ca-quotebot-web'       : 'ca-quotebot-web-${env}'
var voiceContainer = 'voice-notes${isProd ? '' : '-${env}'}'
var pdfsContainer  = 'quote-pdfs${isProd ? '' : '-${env}'}'

// ── ACR — retrieve admin credentials at deploy time ──────────────────────────

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
}

var acrLoginServer = acr.properties.loginServer
var acrPassword    = acr.listCredentials().passwords[0].value

// ── API Container App ─────────────────────────────────────────────────────────

resource apiApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: apiAppName
  location: location
  properties: {
    environmentId: containerAppEnvironmentId
    configuration: {
      ingress: {
        external:   true
        targetPort: 3001
        transport:  'auto'
      }
      registries: [
        {
          server:            acrLoginServer
          username:          acrName
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        { name: 'acr-password',                    value: acrPassword }
        { name: 'database-url',                    value: databaseUrl }
        { name: 'redis-url',                       value: redisUrl }
        { name: 'jwt-secret',                      value: jwtSecret }
        { name: 'anthropic-api-key',               value: anthropicApiKey }
        { name: 'twilio-account-sid',              value: twilioAccountSid }
        { name: 'twilio-auth-token',               value: twilioAuthToken }
        { name: 'stripe-secret-key',               value: stripeSecretKey }
        { name: 'stripe-webhook-secret',           value: stripeWebhookSecret }
        { name: 'azure-storage-connection-string', value: azureStorageConnectionString }
      ]
    }
    template: {
      scale: {
        minReplicas: isProd ? 1 : 0
        maxReplicas: isProd ? 3 : 1
      }
      containers: [
        {
          name:  'api'
          image: apiImage
          resources: {
            cpu:    json(isProd ? '0.5' : '0.25')
            memory: isProd ? '1Gi' : '0.5Gi'
          }
          env: [
            { name: 'NODE_ENV',                        value: 'production' }
            { name: 'PORT',                            value: '3001' }
            { name: 'DATABASE_URL',                    secretRef: 'database-url' }
            { name: 'REDIS_URL',                       secretRef: 'redis-url' }
            { name: 'JWT_SECRET',                      secretRef: 'jwt-secret' }
            { name: 'ANTHROPIC_API_KEY',               secretRef: 'anthropic-api-key' }
            { name: 'TWILIO_ACCOUNT_SID',              secretRef: 'twilio-account-sid' }
            { name: 'TWILIO_AUTH_TOKEN',               secretRef: 'twilio-auth-token' }
            { name: 'TWILIO_WHATSAPP_NUMBER',          value: twilioWhatsappNumber }
            { name: 'STRIPE_SECRET_KEY',               secretRef: 'stripe-secret-key' }
            { name: 'STRIPE_WEBHOOK_SECRET',           secretRef: 'stripe-webhook-secret' }
            { name: 'STRIPE_PRICE_ID_STARTER',         value: stripePriceIdStarter }
            { name: 'STRIPE_PRICE_ID_PRO',             value: stripePriceIdPro }
            { name: 'AZURE_STORAGE_CONNECTION_STRING', secretRef: 'azure-storage-connection-string' }
            { name: 'AZURE_STORAGE_CONTAINER_VOICE',   value: voiceContainer }
            { name: 'AZURE_STORAGE_CONTAINER_PDFS',    value: pdfsContainer }
            { name: 'PUPPETEER_EXECUTABLE_PATH',       value: '/usr/bin/chromium-browser' }
            { name: 'FRONTEND_URL',                    value: frontendUrl }
            { name: 'APP_URL',                         value: appUrl }
          ]
        }
      ]
    }
  }
}

// ── Web Container App ─────────────────────────────────────────────────────────

resource webApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: webAppName
  location: location
  properties: {
    environmentId: containerAppEnvironmentId
    configuration: {
      ingress: {
        external:   true
        targetPort: 80
        transport:  'auto'
      }
      registries: [
        {
          server:            acrLoginServer
          username:          acrName
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        { name: 'acr-password', value: acrPassword }
      ]
    }
    template: {
      scale: {
        minReplicas: isProd ? 1 : 0
        maxReplicas: isProd ? 3 : 1
      }
      containers: [
        {
          name:  'web'
          image: webImage
          resources: {
            cpu:    json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
    }
  }
}

// ── Outputs ───────────────────────────────────────────────────────────────────

output apiUrl string = 'https://${apiApp.properties.configuration.ingress.fqdn}'
output webUrl string = 'https://${webApp.properties.configuration.ingress.fqdn}'
