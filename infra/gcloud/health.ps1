[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$ProjectId,
  [string]$Region,
  [string]$BaseUrl,
  [int]$TimeoutSeconds,
  [ValidateSet('active', 'read_only')][string]$ExpectedWriteMode = 'active'
)

. (Join-Path $PSScriptRoot 'Common.ps1')
$config = Get-AutomniaConfig
if (-not $Region) { $Region = $config.Region }
if (-not $TimeoutSeconds) { $TimeoutSeconds = $config.HealthTimeoutSeconds }
if (-not $BaseUrl) { $BaseUrl = Get-ServiceUrl -ProjectId $ProjectId -Region $Region -ServiceName $config.ServiceName }
$BaseUrl = $BaseUrl.TrimEnd('/')

$health = Wait-HttpJson -Url "$BaseUrl/health" -TimeoutSeconds $TimeoutSeconds
$ready = Wait-HttpJson -Url "$BaseUrl/ready" -TimeoutSeconds $TimeoutSeconds
$expectedPlanHash = Get-LocalPlanMappingHash

$checks = [ordered]@{
  service = $health.service -eq $config.ServiceName
  schemaVersion = $health.schemaVersion -eq $config.SchemaVersion
  writeMode = $health.writeMode -eq $ExpectedWriteMode
  firestore = $health.storage -eq 'firestore'
  readiness = $ready.ok -eq $true
  checkout = $health.commerce.checkoutConfigured -eq $true
  planMappings = $health.commerce.planMappingsConfigured -eq $true
  planMappingHash = $health.commerce.planMappingHash -eq $expectedPlanHash
  webhookSecrets = $health.commerce.webhookSecretsConfigured -eq $true
  emailDelivery = $health.commerce.emailDeliveryConfigured -eq $true
}
$passed = -not ($checks.Values -contains $false)
$result = [pscustomobject]@{
  Passed = $passed
  ProjectId = $ProjectId
  BaseUrl = $BaseUrl
  Revision = $health.revision
  Version = $health.version
  SchemaVersion = $health.schemaVersion
  Checks = $checks
}
if (-not $passed) { throw "Cloud Run health contract failed: $($result | ConvertTo-Json -Depth 10 -Compress)" }
$result
