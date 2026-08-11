[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$ProjectId,
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$SourceProjectId,
  [string]$Region,
  [string]$CandidateUrl
)

. (Join-Path $PSScriptRoot 'Common.ps1')
$config = Get-AutomniaConfig
if (-not $Region) { $Region = $config.Region }
Assert-GcloudSession | Out-Null
Assert-ProjectExists -ProjectId $ProjectId | Out-Null

$migrationState = Get-LatestState -Pattern "migration-*-to-$ProjectId-*.json" -AllowMissing
if (-not $SourceProjectId -and $migrationState) { $SourceProjectId = [string]$migrationState.Data.fromProjectId }
if (-not $SourceProjectId) { throw 'SourceProjectId was not supplied and no matching migration state exists.' }
Assert-ProjectExists -ProjectId $SourceProjectId | Out-Null

if (-not $CandidateUrl -and $migrationState -and $migrationState.Data.candidateUrl) { $CandidateUrl = [string]$migrationState.Data.candidateUrl }
if (-not $CandidateUrl) {
  $service = Get-ServiceDescriptor -ProjectId $ProjectId -Region $Region -ServiceName $config.ServiceName
  $candidate = @($service.status.traffic | Where-Object { $_.tag -eq 'candidate' } | Select-Object -First 1)
  $CandidateUrl = if ($candidate -and $candidate.url) { [string]$candidate.url } else { [string]$service.status.url }
}
$CandidateUrl = $CandidateUrl.TrimEnd('/')

$checks = [Collections.Generic.List[object]]::new()
function Add-VerificationCheck {
  param([string]$Name, [bool]$Passed, $Expected, $Actual, [string]$Detail = '')
  $checks.Add([pscustomobject]@{ Name = $Name; Passed = $Passed; Expected = $Expected; Actual = $Actual; Detail = $Detail })
}

function Get-IndexContractSignature {
  param($Index)
  $fields = @($Index.fields | Where-Object { (Get-ObjectPropertyValue $_ 'fieldPath') -ne '__name__' } | ForEach-Object {
    "$(Get-ObjectPropertyValue $_ 'fieldPath'):$(([string](Get-ObjectPropertyValue $_ 'order')).ToUpperInvariant()):$(([string](Get-ObjectPropertyValue $_ 'arrayConfig')).ToUpperInvariant())"
  }) -join '|'
  "$(Get-ObjectPropertyValue $Index 'collectionGroup'):$(([string](Get-ObjectPropertyValue $Index 'queryScope')).ToUpperInvariant()):$fields"
}

try {
  $sourceSnapshot = Get-FirestoreSnapshot -ProjectId $SourceProjectId
  $targetSnapshot = Get-FirestoreSnapshot -ProjectId $ProjectId
  Add-VerificationCheck -Name 'firestore-document-hash' -Passed ($sourceSnapshot.globalHash -eq $targetSnapshot.globalHash) -Expected $sourceSnapshot.globalHash -Actual $targetSnapshot.globalHash
  Add-VerificationCheck -Name 'customer-count' -Passed ($sourceSnapshot.customerCount -eq $targetSnapshot.customerCount) -Expected $sourceSnapshot.customerCount -Actual $targetSnapshot.customerCount
  Add-VerificationCheck -Name 'active-customer-count' -Passed ($sourceSnapshot.activeCustomerCount -eq $targetSnapshot.activeCustomerCount) -Expected $sourceSnapshot.activeCustomerCount -Actual $targetSnapshot.activeCustomerCount
  Add-VerificationCheck -Name 'credit-balance-total' -Passed ($sourceSnapshot.creditBalanceTotal -eq $targetSnapshot.creditBalanceTotal) -Expected $sourceSnapshot.creditBalanceTotal -Actual $targetSnapshot.creditBalanceTotal
  Add-VerificationCheck -Name 'credit-topup-total' -Passed ($sourceSnapshot.creditTopupTotal -eq $targetSnapshot.creditTopupTotal) -Expected $sourceSnapshot.creditTopupTotal -Actual $targetSnapshot.creditTopupTotal
  Add-VerificationCheck -Name 'credit-deducted-total' -Passed ($sourceSnapshot.creditDeductedTotal -eq $targetSnapshot.creditDeductedTotal) -Expected $sourceSnapshot.creditDeductedTotal -Actual $targetSnapshot.creditDeductedTotal
} catch {
  Add-VerificationCheck -Name 'firestore-snapshot' -Passed $false -Expected 'matching source and target snapshots' -Actual $_.Exception.Message
  $sourceSnapshot = $null
  $targetSnapshot = $null
}

try {
  $sourceIndexes = @(Get-FirestoreIndexes -ProjectId $SourceProjectId)
  $targetIndexes = @(Get-FirestoreIndexes -ProjectId $ProjectId)
  $sourceIndexJson = $sourceIndexes | ConvertTo-Json -Depth 20 -Compress
  $targetIndexJson = $targetIndexes | ConvertTo-Json -Depth 20 -Compress
  Add-VerificationCheck -Name 'firestore-indexes-source-target' -Passed ($sourceIndexJson -eq $targetIndexJson) -Expected $sourceIndexJson -Actual $targetIndexJson
  $expectedIndexes = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'firestore.indexes.json') -Raw | ConvertFrom-Json
  $expectedSignatures = @($expectedIndexes.indexes | ForEach-Object { Get-IndexContractSignature $_ } | Sort-Object)
  $targetSignatures = @($targetIndexes | ForEach-Object { Get-IndexContractSignature $_ } | Sort-Object)
  Add-VerificationCheck -Name 'firestore-indexes-declared-target' -Passed (($expectedSignatures | ConvertTo-Json -Compress) -eq ($targetSignatures | ConvertTo-Json -Compress)) -Expected $expectedSignatures -Actual $targetSignatures -Detail 'Every production index must be declared exactly in firestore.indexes.json.'
  $notReady = @($targetIndexes | Where-Object { $_.state -and $_.state.ToUpperInvariant() -ne 'READY' })
  Add-VerificationCheck -Name 'firestore-indexes-ready' -Passed ($notReady.Count -eq 0) -Expected 0 -Actual $notReady.Count
} catch {
  Add-VerificationCheck -Name 'firestore-indexes' -Passed $false -Expected 'matching ready index definitions' -Actual $_.Exception.Message
}

try {
  $localPlanHash = Get-LocalPlanMappingHash
  $sourcePlanHash = Get-ServicePlanMappingHash -ProjectId $SourceProjectId -Region $Region -ServiceName $config.ServiceName
  $targetPlanHash = Get-ServicePlanMappingHash -ProjectId $ProjectId -Region $Region -ServiceName $config.ServiceName
  Add-VerificationCheck -Name 'shopify-plan-mappings-local-target' -Passed ($localPlanHash -eq $targetPlanHash) -Expected $localPlanHash -Actual $targetPlanHash
  Add-VerificationCheck -Name 'shopify-plan-mappings-source-target' -Passed ($sourcePlanHash -eq $targetPlanHash) -Expected $sourcePlanHash -Actual $targetPlanHash
} catch {
  Add-VerificationCheck -Name 'shopify-plan-mappings' -Passed $false -Expected 'matching local, source, and target mappings' -Actual $_.Exception.Message
}

$secretFingerprints = [ordered]@{}
foreach ($secretName in @($config.MigrationSecrets)) {
  try {
    $sourceHash = Get-SecretFingerprint -ProjectId $SourceProjectId -SecretName $secretName
    $targetHash = Get-SecretFingerprint -ProjectId $ProjectId -SecretName $secretName
    $secretFingerprints[$secretName] = $targetHash
    Add-VerificationCheck -Name "secret:$secretName" -Passed ($sourceHash -eq $targetHash) -Expected $sourceHash -Actual $targetHash
  } catch {
    Add-VerificationCheck -Name "secret:$secretName" -Passed $false -Expected 'matching enabled latest versions' -Actual $_.Exception.Message
  }
}

try {
  $service = Get-ServiceDescriptor -ProjectId $ProjectId -Region $Region -ServiceName $config.ServiceName
  $runtimeServiceAccount = "$($config.ServiceAccountName)@$ProjectId.iam.gserviceaccount.com"
  $actualServiceAccount = [string]$service.spec.template.spec.serviceAccountName
  Add-VerificationCheck -Name 'runtime-service-account' -Passed ($actualServiceAccount -eq $runtimeServiceAccount) -Expected $runtimeServiceAccount -Actual $actualServiceAccount

  $secretBindings = @{}
  foreach ($entry in @($service.spec.template.spec.containers[0].env)) {
    if ($entry.PSObject.Properties.Name -contains 'valueFrom' -and $entry.valueFrom.secretKeyRef) { $secretBindings[[string]$entry.name] = [string]$entry.valueFrom.secretKeyRef.name }
  }
  foreach ($binding in $config.SecretBindings.GetEnumerator()) {
    Add-VerificationCheck -Name "secret-binding:$($binding.Key)" -Passed ($secretBindings[[string]$binding.Key] -eq [string]$binding.Value) -Expected ([string]$binding.Value) -Actual $secretBindings[[string]$binding.Key]
  }

  $policy = Invoke-GcloudJson -Arguments @('projects', 'get-iam-policy', $ProjectId)
  foreach ($role in @($config.RuntimeRoles)) {
    $binding = @($policy.bindings | Where-Object { $_.role -eq $role -and $_.members -contains "serviceAccount:$runtimeServiceAccount" })
    Add-VerificationCheck -Name "runtime-role:$role" -Passed ($binding.Count -gt 0) -Expected $true -Actual ($binding.Count -gt 0)
  }
} catch {
  Add-VerificationCheck -Name 'cloud-run-configuration' -Passed $false -Expected 'declared service account, roles, and secret bindings' -Actual $_.Exception.Message
}

try {
  $enabledApis = @(Invoke-Gcloud -Arguments @('services', 'list', '--enabled', '--project', $ProjectId, '--format=value(config.name)') -split "`n")
  foreach ($api in @($config.RequiredApis)) {
    Add-VerificationCheck -Name "api:$api" -Passed ($enabledApis -contains $api) -Expected $true -Actual ($enabledApis -contains $api)
  }
} catch {
  Add-VerificationCheck -Name 'required-apis' -Passed $false -Expected $config.RequiredApis -Actual $_.Exception.Message
}

try {
  $health = & (Join-Path $PSScriptRoot 'health.ps1') -ProjectId $ProjectId -Region $Region -BaseUrl $CandidateUrl
  Add-VerificationCheck -Name 'cloud-run-health' -Passed $health.Passed -Expected $true -Actual $health.Passed
} catch {
  Add-VerificationCheck -Name 'cloud-run-health' -Passed $false -Expected $true -Actual $_.Exception.Message
}

try {
  $previousToken = $env:AUTOMNIA_GCLOUD_ACCESS_TOKEN
  try {
    $env:AUTOMNIA_GCLOUD_ACCESS_TOKEN = Get-GoogleAccessToken
    $liveJson = & node (Join-Path $PSScriptRoot 'tools\live-billing-test.mjs') $ProjectId $CandidateUrl
    if ($LASTEXITCODE -ne 0 -or -not $liveJson) { throw 'Live billing test process failed.' }
    $liveBilling = ([string]$liveJson) | ConvertFrom-Json
  } finally {
    $env:AUTOMNIA_GCLOUD_ACCESS_TOKEN = $previousToken
  }
  Add-VerificationCheck -Name 'live-billing-tests' -Passed ($liveBilling.passed -eq $true) -Expected $true -Actual $liveBilling.passed -Detail ($liveBilling.checks | ConvertTo-Json -Depth 10 -Compress)
} catch {
  $liveBilling = $null
  Add-VerificationCheck -Name 'live-billing-tests' -Passed $false -Expected $true -Actual $_.Exception.Message
}

try {
  $permanentUri = [Uri]$config.PermanentBaseUrl
  $permanentDomainValid = $permanentUri.Scheme -eq 'https' -and -not $permanentUri.Host.EndsWith('.run.app') -and $permanentUri.Host -eq $config.PermanentDomain
  Add-VerificationCheck -Name 'permanent-domain-contract' -Passed $permanentDomainValid -Expected $config.PermanentDomain -Actual $permanentUri.Host
} catch {
  Add-VerificationCheck -Name 'permanent-domain-contract' -Passed $false -Expected 'valid non-run.app HTTPS domain' -Actual $_.Exception.Message
}

$failedChecks = @($checks | Where-Object { -not $_.Passed })
$passed = $failedChecks.Count -eq 0
$timestamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$verificationId = [guid]::NewGuid().ToString('N')
$report = [ordered]@{
  kind = 'automnia-migration-verification'
  schemaVersion = $config.SchemaVersion
  verificationId = $verificationId
  createdAt = [DateTimeOffset]::UtcNow.ToString('o')
  sourceProjectId = $SourceProjectId
  targetProjectId = $ProjectId
  region = $Region
  candidateUrl = $CandidateUrl
  permanentBaseUrl = $config.PermanentBaseUrl
  sourceSnapshot = $sourceSnapshot
  targetSnapshot = $targetSnapshot
  secretFingerprints = $secretFingerprints
  liveBilling = $liveBilling
  checks = $checks
  passed = $passed
}
$reportPath = Write-StateJson -Name "verification-$SourceProjectId-to-$ProjectId-$timestamp.json" -Value $report
if (-not $passed) {
  $names = $failedChecks.Name -join ', '
  throw "Verification failed closed. Traffic cannot switch. Failed checks: $names. Report: $reportPath"
}

[pscustomobject]@{
  Passed = $true
  VerificationId = $verificationId
  SourceProjectId = $SourceProjectId
  TargetProjectId = $ProjectId
  CustomerCount = $targetSnapshot.customerCount
  CreditBalanceTotal = $targetSnapshot.creditBalanceTotal
  CandidateUrl = $CandidateUrl
  ReportPath = $reportPath
}
