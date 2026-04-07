# QuoteBot deployment script (PowerShell)
# Usage:
#   .\deploy.ps1              # full deploy (infra + images)
#   .\deploy.ps1 -InfraOnly   # Bicep only, no Docker
#   .\deploy.ps1 -ImagesOnly  # Docker build/push + container update only
#
# Prerequisites:
#   - Azure CLI installed and logged in: az login
#   - Docker Desktop running
#   - main.parameters.json filled from main.parameters.example.json

param(
    [switch]$InfraOnly,
    [switch]$ImagesOnly
)

$ErrorActionPreference = 'Stop'

$ResourceGroup = 'rg-quotebot-prod'
$Location      = 'uksouth'
$ScriptDir     = $PSScriptRoot
$RepoRoot      = Resolve-Path "$ScriptDir\..\..\..\"

function Step($msg) { Write-Host "`n▶ $msg" -ForegroundColor Cyan }
function OK($msg)   { Write-Host "  ✅ $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "  ❌ $msg" -ForegroundColor Red; exit 1 }

# ── 1. Infrastructure (Bicep) ──────────────────────────────────────────────────

if (-not $ImagesOnly) {
    Step "Creating resource group $ResourceGroup in $Location..."
    az group create --name $ResourceGroup --location $Location --output none
    if ($LASTEXITCODE -ne 0) { Fail "az group create failed" }

    $ParamsFile = Join-Path $ScriptDir 'main.parameters.json'
    if (-not (Test-Path $ParamsFile)) {
        Fail "main.parameters.json not found.`n  Copy main.parameters.example.json -> main.parameters.json and fill in values."
    }

    Step "Deploying Bicep infrastructure (~10 min on first run)..."
    $DeployName = "quotebot-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Write-Host "  Deployment name: $DeployName" -ForegroundColor Gray

    # Kick off asynchronously so we can show live progress
    az deployment group create `
        --resource-group $ResourceGroup `
        --template-file "$ScriptDir\main.bicep" `
        --parameters "@$ParamsFile" `
        --name $DeployName `
        --no-wait `
        --output none
    if ($LASTEXITCODE -ne 0) { Fail "Failed to start Bicep deployment" }

    # Poll every 15 s — print timestamp + only changed/failed rows
    $lastPrint = @{}
    while ($true) {
        Start-Sleep -Seconds 15

        $state = az deployment group show `
            --resource-group $ResourceGroup `
            --name $DeployName `
            --query "properties.provisioningState" -o tsv 2>$null

        $ops = az deployment operation group list `
            --resource-group $ResourceGroup `
            --name $DeployName `
            --query "[].{r:properties.targetResource.resourceType, s:properties.provisioningState, m:properties.statusMessage}" `
            -o json 2>$null | ConvertFrom-Json

        $ts = Get-Date -Format 'HH:mm:ss'
        foreach ($op in $ops) {
            $key = $op.r
            if ($op.s -ne $lastPrint[$key]) {
                $colour = switch ($op.s) {
                    'Succeeded' { 'Green'  }
                    'Failed'    { 'Red'    }
                    'Running'   { 'Yellow' }
                    default     { 'Gray'   }
                }
                $msg = "  [$ts]  $($op.s.PadRight(10))  $($op.r)"
                Write-Host $msg -ForegroundColor $colour
                if ($op.s -eq 'Failed' -and $op.m) {
                    $errText = ($op.m | ConvertTo-Json -Depth 5 -Compress) 2>$null
                    Write-Host "             $errText" -ForegroundColor Red
                }
                $lastPrint[$key] = $op.s
            }
        }

        Write-Host "  [$ts]  Overall: $state" -ForegroundColor Cyan
        if ($state -in @('Succeeded', 'Failed', 'Canceled')) { break }
    }

    if ($state -ne 'Succeeded') {
        Write-Host "`n  Failed operations:" -ForegroundColor Red
        az deployment operation group list `
            --resource-group $ResourceGroup `
            --name $DeployName `
            --query "[?properties.provisioningState=='Failed'].{Resource:properties.targetResource.resourceType, Error:properties.statusMessage}" `
            -o table
        Fail "Bicep deployment finished with state: $state"
    }
    OK "Infrastructure deployed."
}

# ── 2. Resolve ACR ─────────────────────────────────────────────────────────────

Step "Resolving ACR..."
$AcrName        = az acr list --resource-group $ResourceGroup --query "[0].name" -o tsv
$AcrLoginServer = az acr show --name $AcrName --query "loginServer" -o tsv
if (-not $AcrLoginServer) { Fail "Could not find ACR in $ResourceGroup" }
Write-Host "  ACR: $AcrLoginServer"

if ($InfraOnly) { OK "Infra-only run complete."; exit 0 }

# ── 3. Build & push via ACR Tasks (no local Docker required) ─────────────────
# az acr build uploads the source context to Azure and builds in the cloud.

$GitSha = (git -C $RepoRoot rev-parse --short HEAD 2>$null)

foreach ($App in @(
    @{ Name='api'; File='apps/api/Dockerfile' },
    @{ Name='web'; File='apps/web/Dockerfile' }
)) {
    $Image = "quotebot-$($App.Name)"
    Step "Building $($App.Name) image in ACR (cloud build)..."
    az acr build `
        --registry $AcrName `
        --image "${Image}:${GitSha}" `
        --image "${Image}:latest" `
        --file "$RepoRoot\$($App.File)" `
        $RepoRoot
    if ($LASTEXITCODE -ne 0) { Fail "ACR build failed for $($App.Name)" }
}

# ── 4. Update Container Apps ───────────────────────────────────────────────────

foreach ($App in @('api', 'web')) {
    Step "Updating ca-quotebot-$App..."
    az containerapp update `
        --name "ca-quotebot-$App" `
        --resource-group $ResourceGroup `
        --image "$AcrLoginServer/quotebot-${App}:${GitSha}" `
        --output none
    if ($LASTEXITCODE -ne 0) { Fail "containerapp update failed for $App" }
}

# ── 5. Print endpoints ─────────────────────────────────────────────────────────

$ApiFqdn = az containerapp show -n ca-quotebot-api -g $ResourceGroup `
    --query "properties.configuration.ingress.fqdn" -o tsv
$WebFqdn = az containerapp show -n ca-quotebot-web -g $ResourceGroup `
    --query "properties.configuration.ingress.fqdn" -o tsv

Write-Host ""
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  ✅ QuoteBot deployed" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  Web:  https://$WebFqdn"
Write-Host "  API:  https://$ApiFqdn"
Write-Host ""
Write-Host "  Twilio webhook URL:"
Write-Host "  https://$ApiFqdn/api/webhooks/whatsapp" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Run DB migration once (replace placeholders):"
Write-Host "  psql `"postgresql://quotebotadmin:<pw>@<pg-fqdn>:5432/quotebot?sslmode=require`" -f apps/api/src/db/schema.sql"
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Green
