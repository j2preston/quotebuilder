// QuoteBot — Azure infrastructure
// Scope: resource group (create rg-quotebot-prod before deploying)
// Deploy: az deployment group create -g rg-quotebot-prod -f main.bicep -p @main.parameters.json

@description('Azure region for all resources')
param location string = resourceGroup().location

@description('PostgreSQL administrator login')
param pgAdminLogin string = 'quotebotadmin'

@description('PostgreSQL administrator password')
@secure()
param pgAdminPassword string

@description('JWT signing secret (64+ random chars)')
@secure()
param jwtSecret string

@description('Anthropic API key')
@secure()
param anthropicApiKey string

@description('Twilio Account SID')
@secure()
param twilioAccountSid string

@description('Twilio Auth Token')
@secure()
param twilioAuthToken string

@description('Twilio WhatsApp sender number')
param twilioWhatsappNumber string = 'whatsapp:+14155238886'

@description('Stripe secret key')
@secure()
param stripeSecretKey string

@description('Stripe webhook signing secret')
@secure()
param stripeWebhookSecret string

// ── Naming ─────────────────────────────────────────────────────────────────────
var uniqueSuffix = take(uniqueString(resourceGroup().id), 8)
var acrName      = 'quotebot${uniqueSuffix}'
var pgName       = 'psql-quotebot-${uniqueSuffix}'
var redisName    = 'redis-quotebot-${uniqueSuffix}'
var storageName  = 'stqbot${uniqueSuffix}'
var kvName       = 'kvqbot${uniqueSuffix}'

// ── Log Analytics ──────────────────────────────────────────────────────────────

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: 'log-quotebot-prod'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

// ── Container Registry ─────────────────────────────────────────────────────────

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

// ── Container Apps Environment ─────────────────────────────────────────────────

resource cae 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: 'cae-quotebot-prod'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

// ── PostgreSQL Flexible Server ─────────────────────────────────────────────────

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-06-01-preview' = {
  name: pgName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    administratorLogin: pgAdminLogin
    administratorLoginPassword: pgAdminPassword
    version: '16'
    storage: {
      storageSizeGB: 32
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
  }
}

resource postgresDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-06-01-preview' = {
  parent: postgres
  name: 'quotebot'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource postgresFirewall 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-06-01-preview' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// ── Redis Cache ────────────────────────────────────────────────────────────────

resource redis 'Microsoft.Cache/Redis@2023-08-01' = {
  name: redisName
  location: location
  properties: {
    sku: {
      name: 'Basic'
      family: 'C'
      capacity: 0
    }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
  }
}

// ── Storage Account ────────────────────────────────────────────────────────────

resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  name: '${storage.name}/default/quotebot-quotes-prod'
  properties: {
    publicAccess: 'None'
  }
}

// ── Key Vault ──────────────────────────────────────────────────────────────────

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    softDeleteRetentionInDays: 7
    enableSoftDelete: true
  }
}

// ── Managed Identity ───────────────────────────────────────────────────────────

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-quotebot-prod'
  location: location
}

// ── Role Assignments ───────────────────────────────────────────────────────────

resource acrPullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, identity.id, 'acrpull')
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '7f951dda-4ed3-4680-a7ca-43fe172d538d'
    )
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource kvSecretsRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, identity.id, 'kvsecretuser')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '4633458b-17de-408a-b874-0445c86b69e6'
    )
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// Deployment scripts need Contributor on the RG to create a storage account
// and ACI instance internally — this role lets the managed identity do that.
resource deployScriptRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, identity.id, 'contributor')
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'b24988ac-6180-42a0-ab88-20f7382dd24c' // Contributor
    )
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── RBAC propagation wait ──────────────────────────────────────────────────────
// Azure RBAC can take 1-2 min to propagate after role assignment creation.
// This deployment script sleeps 90 s so Container Apps can read KV secrets
// on first deploy without failing.

resource waitForRbac 'Microsoft.Resources/deploymentScripts@2023-08-01' = {
  name: 'wait-rbac-propagation'
  location: location
  kind: 'AzurePowerShell'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    azPowerShellVersion: '12.0'
    scriptContent: 'Start-Sleep -Seconds 90'
    retentionInterval: 'PT1H'
    cleanupPreference: 'OnSuccess'
  }
  dependsOn: [
    kvSecretsRole
    acrPullRole
    deployScriptRole
  ]
}

// ── Key Vault Secrets ──────────────────────────────────────────────────────────

var dbUrl     = 'postgresql://${pgAdminLogin}:${pgAdminPassword}@${postgres.properties.fullyQualifiedDomainName}:5432/quotebot?sslmode=require'
var redisUrl  = 'rediss://:${redis.listKeys().primaryKey}@${redis.properties.hostName}:6380'
var storageCs = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=core.windows.net'

resource kvSecretDb 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'DatabaseUrl'
  properties: { value: dbUrl }
}

resource kvSecretRedis 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'RedisUrl'
  properties: { value: redisUrl }
}

resource kvSecretJwt 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'JwtSecret'
  properties: { value: jwtSecret }
}

resource kvSecretAI 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'AnthropicApiKey'
  properties: { value: anthropicApiKey }
}

resource kvSecretTwSid 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'TwilioAccountSid'
  properties: { value: twilioAccountSid }
}

resource kvSecretTwToken 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'TwilioAuthToken'
  properties: { value: twilioAuthToken }
}

resource kvSecretTwNum 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'TwilioWhatsappNumber'
  properties: { value: twilioWhatsappNumber }
}

resource kvSecretStripe 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'StripeSecretKey'
  properties: { value: stripeSecretKey }
}

resource kvSecretStripeW 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'StripeWebhookSecret'
  properties: { value: stripeWebhookSecret }
}

resource kvSecretStorage 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'AzureStorageConnectionString'
  properties: { value: storageCs }
}

// ── Container App: API ─────────────────────────────────────────────────────────

var webFqdn = 'ca-quotebot-web.${cae.properties.defaultDomain}'

resource apiApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: 'ca-quotebot-api'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      ingress: {
        external: true
        targetPort: 80
        transport: 'http'
        allowInsecure: false
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: identity.id
        }
      ]
      secrets: [
        {
          name: 'database-url'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/DatabaseUrl'
          identity: identity.id
        }
        {
          name: 'redis-url'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/RedisUrl'
          identity: identity.id
        }
        {
          name: 'jwt-secret'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/JwtSecret'
          identity: identity.id
        }
        {
          name: 'anthropic-api-key'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/AnthropicApiKey'
          identity: identity.id
        }
        {
          name: 'twilio-account-sid'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/TwilioAccountSid'
          identity: identity.id
        }
        {
          name: 'twilio-auth-token'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/TwilioAuthToken'
          identity: identity.id
        }
        {
          name: 'twilio-whatsapp-number'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/TwilioWhatsappNumber'
          identity: identity.id
        }
        {
          name: 'stripe-secret-key'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/StripeSecretKey'
          identity: identity.id
        }
        {
          name: 'stripe-webhook-secret'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/StripeWebhookSecret'
          identity: identity.id
        }
        {
          name: 'azure-storage-connection-string'
          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/AzureStorageConnectionString'
          identity: identity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'FRONTEND_URL'
              value: 'https://${webFqdn}'
            }
            {
              name: 'AZURE_STORAGE_CONTAINER'
              value: 'quotebot-quotes-prod'
            }
            {
              name: 'DATABASE_URL'
              secretRef: 'database-url'
            }
            {
              name: 'REDIS_URL'
              secretRef: 'redis-url'
            }
            {
              name: 'JWT_SECRET'
              secretRef: 'jwt-secret'
            }
            {
              name: 'ANTHROPIC_API_KEY'
              secretRef: 'anthropic-api-key'
            }
            {
              name: 'TWILIO_ACCOUNT_SID'
              secretRef: 'twilio-account-sid'
            }
            {
              name: 'TWILIO_AUTH_TOKEN'
              secretRef: 'twilio-auth-token'
            }
            {
              name: 'TWILIO_WHATSAPP_NUMBER'
              secretRef: 'twilio-whatsapp-number'
            }
            {
              name: 'STRIPE_SECRET_KEY'
              secretRef: 'stripe-secret-key'
            }
            {
              name: 'STRIPE_WEBHOOK_SECRET'
              secretRef: 'stripe-webhook-secret'
            }
            {
              name: 'AZURE_STORAGE_CONNECTION_STRING'
              secretRef: 'azure-storage-connection-string'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 3
        rules: [
          {
            name: 'http-scale'
            http: {
              metadata: {
                concurrentRequests: '20'
              }
            }
          }
        ]
      }
    }
  }
  dependsOn: [
    waitForRbac
  ]
}

// ── Container App: Web ─────────────────────────────────────────────────────────

var apiFqdn = 'ca-quotebot-api.${cae.properties.defaultDomain}'

resource webApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: 'ca-quotebot-web'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      ingress: {
        external: true
        targetPort: 80
        transport: 'http'
        allowInsecure: false
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: identity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            {
              name: 'API_URL'
              value: 'https://${apiFqdn}'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 2
      }
    }
  }
  dependsOn: [
    waitForRbac
  ]
}

// ── Outputs ────────────────────────────────────────────────────────────────────

output acrName        string = acr.name
output acrLoginServer string = acr.properties.loginServer
output apiFqdn        string = apiApp.properties.configuration.ingress.fqdn
output webFqdnOut     string = webApp.properties.configuration.ingress.fqdn
output keyVaultName   string = keyVault.name
output postgresFqdn   string = postgres.properties.fullyQualifiedDomainName
