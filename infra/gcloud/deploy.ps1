[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)][ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$ProjectId,
  [string]$Region,
  [string]$FirestoreLocation,
  [string]$BillingAccountId,
  [string]$SecretValuesFile,
  [switch]$RouteImmediately
)

. (Join-Path $PSScriptRoot 'Common.ps1')
$config = Get-AutomniaConfig
if (-not $Region) { $Region = $config.Region }
if (-not $FirestoreLocation) { $FirestoreLocation = $config.FirestoreLocation }
if ($WhatIfPreference) {
  $PSCmdlet.ShouldProcess("$ProjectId/$Region/$($config.ServiceName)", 'plan complete Automnia Cloud deployment') | Out-Null
  return [pscustomobject]@{ WhatIf = $true; ProjectId = $ProjectId; Region = $Region; ServiceName = $config.ServiceName }
}

Assert-GcloudSession | Out-Null
$project = Assert-ProjectExists -ProjectId $ProjectId
$projectNumber = [string]$project.projectNumber
$serviceAccountEmail = "$($config.ServiceAccountName)@$ProjectId.iam.gserviceaccount.com"
$computeServiceAccount = "$projectNumber-compute@developer.gserviceaccount.com"

if ($BillingAccountId -and $PSCmdlet.ShouldProcess($ProjectId, "link billing account $BillingAccountId")) {
  Invoke-Gcloud -Arguments @('billing', 'projects', 'link', $ProjectId, '--billing-account', $BillingAccountId) | Out-Null
}
$billingEnabled = Invoke-Gcloud -Arguments @('billing', 'projects', 'describe', $ProjectId, '--format=value(billingEnabled)')
if ($billingEnabled -ne 'True') { throw "Billing is not enabled for '$ProjectId'. Supply -BillingAccountId or link billing before deployment." }

if ($PSCmdlet.ShouldProcess($ProjectId, 'enable required Google Cloud APIs')) {
  Invoke-Gcloud -Arguments (@('services', 'enable') + @($config.RequiredApis) + @('--project', $ProjectId)) | Out-Null
}

$serviceAccount = Invoke-Gcloud -Arguments @('iam', 'service-accounts', 'describe', $serviceAccountEmail, '--project', $ProjectId, '--format=value(email)') -AllowFailure
if ($serviceAccount.ExitCode -ne 0 -and $PSCmdlet.ShouldProcess($serviceAccountEmail, 'create Cloud Run runtime service account')) {
  Invoke-Gcloud -Arguments @('iam', 'service-accounts', 'create', $config.ServiceAccountName, '--project', $ProjectId, '--display-name=Automnia provisioner runtime') | Out-Null
}

foreach ($role in @($config.RuntimeRoles)) {
  if ($PSCmdlet.ShouldProcess("$serviceAccountEmail in $ProjectId", "grant $role")) {
    Invoke-Gcloud -Arguments @('projects', 'add-iam-policy-binding', $ProjectId, '--member', "serviceAccount:$serviceAccountEmail", '--role', $role, '--condition=None') | Out-Null
  }
}
if ($PSCmdlet.ShouldProcess("$computeServiceAccount in $ProjectId", 'grant Cloud Run source-build role')) {
  Invoke-Gcloud -Arguments @('projects', 'add-iam-policy-binding', $ProjectId, '--member', "serviceAccount:$computeServiceAccount", '--role', 'roles/run.builder', '--condition=None') | Out-Null
}

$providedSecrets = @{}
if ($SecretValuesFile) {
  if (-not (Test-Path -LiteralPath $SecretValuesFile -PathType Leaf)) { throw "Secret values file was not found: $SecretValuesFile" }
  $provided = Get-Content -LiteralPath $SecretValuesFile -Raw | ConvertFrom-Json
  foreach ($property in $provided.PSObject.Properties) { $providedSecrets[[string]$property.Name] = [string]$property.Value }
}

foreach ($binding in $config.SecretBindings.GetEnumerator()) {
  $secretName = [string]$binding.Value
  $requiresOperatorValue = [string]$binding.Key -in @('SHOPIFY_ADMIN_API_TOKEN', 'GMAIL_OAUTH_CREDENTIALS')
  if ($requiresOperatorValue) {
    # A random bootstrap value would make health look configured while every
    # paid order still fails at the external provider. Require real operator
    # credentials for both Shopify administration and Gmail delivery.
    Ensure-SecretResource -ProjectId $ProjectId -SecretName $secretName
  } else {
    Ensure-SecretResource -ProjectId $ProjectId -SecretName $secretName -BootstrapVersion
  }
  if ($providedSecrets.ContainsKey($secretName) -or $providedSecrets.ContainsKey([string]$binding.Key)) {
    $value = if ($providedSecrets.ContainsKey($secretName)) { $providedSecrets[$secretName] } else { $providedSecrets[[string]$binding.Key] }
    $temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ('automnia-secret-input-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
    $secretFile = Join-Path $temporaryDirectory 'value'
    try {
      [IO.File]::WriteAllText($secretFile, $value, [Text.UTF8Encoding]::new($false))
      Invoke-Gcloud -Arguments @('secrets', 'versions', 'add', $secretName, '--project', $ProjectId, '--data-file', $secretFile) | Out-Null
    } finally {
      Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
    }
  }
  if ($requiresOperatorValue -and -not (Test-SecretVersion -ProjectId $ProjectId -SecretName $secretName)) {
    $credentialDescription = if ([string]$binding.Key -eq 'GMAIL_OAUTH_CREDENTIALS') { 'Gmail OAuth credentials' } else { 'Shopify app secret' }
    throw "Secret '$secretName' must contain $credentialDescription before deployment. Pass it through -SecretValuesFile; bootstrap placeholders are not accepted."
  }
  if ($PSCmdlet.ShouldProcess("$secretName in $ProjectId", 'grant runtime secret access')) {
    Invoke-Gcloud -Arguments @('secrets', 'add-iam-policy-binding', $secretName, '--project', $ProjectId, '--member', "serviceAccount:$serviceAccountEmail", '--role', 'roles/secretmanager.secretAccessor', '--condition=None') | Out-Null
  }
}

& (Join-Path $PSScriptRoot 'initialize-firestore.ps1') -ProjectId $ProjectId -Location $FirestoreLocation
if ($LASTEXITCODE -ne 0) { throw 'Firestore initialization failed.' }

$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ('automnia-deploy-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
try {
  $envFile = Join-Path $temporaryDirectory 'environment.yaml'
  $planBase64 = Get-PlanMappingBase64
  $environmentYaml = @"
SHOPIFY_PLAN_MAPPINGS: '$planBase64'
SHOPIFY_CHECKOUT_URL: '$($config.ShopifyCheckoutUrl)'
SHOPIFY_STORE_DOMAIN: '$($config.ShopifyStoreDomain)'
SHOPIFY_APP_CLIENT_ID: '$($config.ShopifyAppClientId)'
SHOPIFY_API_VERSION: '$($config.ShopifyApiVersion)'
GMAIL_SENDER: '$($config.GmailSender)'
VERTEX_LOCATION: '$($config.VertexLocation)'
AUTOMNIA_RELAY_MODEL: '$($config.AutomniaRelayModel)'
AUTOMNIA_RELAY_FALLBACK_MODELS: '$([string]::Join(',', [string[]]$config.AutomniaRelayFallbackModels))'
AUTOMNIA_RELAY_MAX_INPUT_TOKENS: '$($config.RelayMaxInputTokens)'
AUTOMNIA_RELAY_MAX_OUTPUT_TOKENS: '$($config.RelayMaxOutputTokens)'
AUTOMNIA_RELAY_TEXT_OUTPUT_TOKENS: '$($config.RelayTextOutputTokens)'
AUTOMNIA_RELAY_TOOL_OUTPUT_TOKENS: '$($config.RelayToolOutputTokens)'
AUTOMNIA_RELAY_MAX_TOOL_TOKENS: '$($config.RelayMaxToolTokens)'
AUTOMNIA_RELAY_MAX_TOOLS: '$($config.RelayMaxTools)'
AUTOMNIA_RELAY_MAX_SYSTEM_CHARS: '$($config.RelayMaxSystemChars)'
AUTOMNIA_RELAY_MAX_MESSAGE_CHARS: '$($config.RelayMaxMessageChars)'
AUTOMNIA_RELAY_MAX_TOOL_RESULT_CHARS: '$($config.RelayMaxToolResultChars)'
AUTOMNIA_RELAY_MAX_HISTORY_MESSAGES: '$($config.RelayMaxHistoryMessages)'
AUTOMNIA_RELAY_MAX_INLINE_IMAGES: '$($config.RelayMaxInlineImages)'
AUTOMNIA_RELAY_MAX_INLINE_IMAGE_CHARS: '$($config.RelayMaxInlineImageChars)'
AUTOMNIA_SCHEMA_VERSION: '$($config.SchemaVersion)'
AUTOMNIA_KNOWLEDGE_MODEL_VERSION: '$($config.KnowledgeModelVersion)'
AUTOMNIA_KNOWLEDGE_FALLBACK_MODEL_VERSION: '$($config.KnowledgeFallbackModelVersion)'
GOOGLE_CLOUD_PROJECT: '$ProjectId'
GCLOUD_PROJECT: '$ProjectId'
AUTOMNIA_KNOWLEDGE_SERVING_CONFIG: 'projects/$projectNumber/locations/global/collections/default_collection/engines/$($config.KnowledgeEngineId)/servingConfigs/default_search'
"@
  [IO.File]::WriteAllText($envFile, $environmentYaml, [Text.UTF8Encoding]::new($false))
  $secretFlags = @($config.SecretBindings.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value):latest" }) -join ','
  $sourcePath = Join-Path $PSScriptRoot 'service'
  $existing = Get-ServiceDescriptor -ProjectId $ProjectId -Region $Region -ServiceName $config.ServiceName -AllowMissing
  $arguments = @(
    'run', 'deploy', $config.ServiceName,
    '--project', $ProjectId,
    '--region', $Region,
    '--source', $sourcePath,
    '--service-account', $serviceAccountEmail,
    '--allow-unauthenticated',
    '--ingress=all',
    '--port=8080',
    '--cpu=1',
    '--memory=512Mi',
    '--concurrency=80',
    '--timeout=300',
    '--min=0',
    '--max=3',
    '--cpu-boost',
    '--env-vars-file', $envFile,
    '--set-secrets', $secretFlags,
    '--labels=automnia-component=provisioner,managed-by=automnia-gcloud-package',
    '--tag=candidate'
  )
  if ($existing -and -not $RouteImmediately) { $arguments += '--no-traffic' }
  if ($PSCmdlet.ShouldProcess("$ProjectId/$Region/$($config.ServiceName)", 'deploy Cloud Run source revision')) {
    Invoke-Gcloud -Arguments $arguments | Out-Null
  }
} finally {
  if (Test-Path -LiteralPath $temporaryDirectory) { Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force }
}

$service = Get-ServiceDescriptor -ProjectId $ProjectId -Region $Region -ServiceName $config.ServiceName
$candidateTraffic = $null
if ($service.status -and $service.status.PSObject.Properties['traffic'] -and $service.status.traffic) {
  $candidateTraffic = @($service.status.traffic | Where-Object { $_ -and $_.PSObject.Properties['tag'] -and $_.tag -eq 'candidate' } | Select-Object -First 1)
}
$candidateUrl = if ($candidateTraffic -and $candidateTraffic.url) { [string]$candidateTraffic.url } else { [string]$service.status.url }
$health = & (Join-Path $PSScriptRoot 'health.ps1') -ProjectId $ProjectId -Region $Region -BaseUrl $candidateUrl
$timestamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$state = [ordered]@{
  kind = 'automnia-gcloud-deployment'
  schemaVersion = $config.SchemaVersion
  createdAt = [DateTimeOffset]::UtcNow.ToString('o')
  projectId = $ProjectId
  projectNumber = $projectNumber
  region = $Region
  serviceName = $config.ServiceName
  serviceUrl = [string]$service.status.url
  candidateUrl = $candidateUrl
  revision = [string]$health.Revision
  planMappingHash = Get-LocalPlanMappingHash
  permanentBaseUrl = $config.PermanentBaseUrl
  routedImmediately = [bool]$RouteImmediately
  passed = $health.Passed
}
$statePath = Write-StateJson -Name "deploy-$ProjectId-$timestamp.json" -Value $state
[pscustomobject]@{ Passed = $true; ProjectId = $ProjectId; Revision = $state.revision; CandidateUrl = $candidateUrl; StatePath = $statePath }
