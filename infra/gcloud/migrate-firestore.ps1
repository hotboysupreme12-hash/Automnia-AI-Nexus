[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)][ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$From,
  [Parameter(Mandatory)][ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$To,
  [string]$Region,
  [string]$BucketName,
  [switch]$AllowNonEmptyTarget,
  [switch]$SkipSecretCopy,
  [switch]$SkipGmail,
  [switch]$UseTargetShopifySecrets,
  [switch]$DataOnly
)

. (Join-Path $PSScriptRoot 'Common.ps1')
$config = Get-AutomniaConfig
if (-not $Region) { $Region = $config.Region }
if ($From -eq $To) { throw 'Source and target projects must be different.' }
if ($WhatIfPreference) {
  $PSCmdlet.ShouldProcess("$From -> $To", 'plan Firestore and Secret Manager migration') | Out-Null
  return [pscustomobject]@{ WhatIf = $true; From = $From; To = $To; Region = $Region; SkipGmail = [bool]$SkipGmail; DataOnly = [bool]$DataOnly }
}

Assert-GcloudSession | Out-Null
$sourceProject = Assert-ProjectExists -ProjectId $From
$targetProject = Assert-ProjectExists -ProjectId $To
$targetService = Get-ServiceDescriptor -ProjectId $To -Region $Region -ServiceName $config.ServiceName -AllowMissing
if (-not $targetService -and -not $DataOnly) { throw "Deploy the target first with .\deploy.ps1 -ProjectId $To" }
if ($DataOnly) { $SkipSecretCopy = $true }
$targetShopifySecretNames = if ($UseTargetShopifySecrets -and -not $DataOnly) {
  @('automnia-shopify-webhook-secrets', 'automnia-shopify-admin-api-token')
} else { @() }
foreach ($secretName in $targetShopifySecretNames) {
  if (-not (Test-SecretVersion -ProjectId $To -SecretName $secretName)) {
    throw "Target Shopify secret '$secretName' must have an enabled version before migration."
  }
}
$targetShopifySecretsReady = $true
$migrationSecretNames = @($config.MigrationSecrets | Where-Object {
  -not ($SkipGmail -and $_ -eq 'automnia-gmail-oauth-credentials') -and $_ -notin $targetShopifySecretNames
})
$secretBindings = @($config.SecretBindings.GetEnumerator() | Where-Object { -not ($SkipGmail -and [string]$_.Key -eq 'GMAIL_OAUTH_CREDENTIALS') })

$sourceBefore = Get-FirestoreSnapshot -ProjectId $From
$targetBefore = Get-FirestoreSnapshot -ProjectId $To
if (-not $AllowNonEmptyTarget -and $targetBefore.totalDocuments -gt 0) {
  throw "Refusing to migrate into non-empty target '$To' ($($targetBefore.totalDocuments) documents)."
}

if (-not $BucketName) {
  $rawName = "$To-$($config.MigrationBucketSuffix)".ToLowerInvariant()
  $BucketName = ($rawName -replace '[^a-z0-9._-]', '-').Trim('-').Substring(0, [Math]::Min(63, $rawName.Length))
}
$bucketUri = "gs://$BucketName"
$bucket = Invoke-Gcloud -Arguments @('storage', 'buckets', 'describe', $bucketUri, '--project', $To, '--format=value(name)') -AllowFailure
if ($bucket.ExitCode -ne 0 -and $PSCmdlet.ShouldProcess($bucketUri, "create migration bucket in $To")) {
  Invoke-Gcloud -Arguments @('storage', 'buckets', 'create', $bucketUri, '--project', $To, '--location', $config.FirestoreLocation, '--uniform-bucket-level-access') | Out-Null
}

$sourceFirestoreAgent = "service-$($sourceProject.projectNumber)@gcp-sa-firestore.iam.gserviceaccount.com"
$targetFirestoreAgent = "service-$($targetProject.projectNumber)@gcp-sa-firestore.iam.gserviceaccount.com"
foreach ($agent in @($sourceFirestoreAgent, $targetFirestoreAgent)) {
  if ($PSCmdlet.ShouldProcess($bucketUri, "grant temporary migration access to $agent")) {
    Invoke-Gcloud -Arguments @('storage', 'buckets', 'add-iam-policy-binding', $bucketUri, '--project', $To, '--member', "serviceAccount:$agent", '--role', 'roles/storage.admin') | Out-Null
  }
}

$timestamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$exportUri = "$bucketUri/automnia/$From-to-$To/$timestamp"
try {
  & (Join-Path $PSScriptRoot 'export-firestore.ps1') -ProjectId $From -OutputUriPrefix $exportUri | Out-Null
  & (Join-Path $PSScriptRoot 'import-firestore.ps1') -ProjectId $To -InputUriPrefix $exportUri -AllowNonEmptyTarget:$AllowNonEmptyTarget | Out-Null

  $secretResults = @()
  if (-not $SkipSecretCopy) {
    foreach ($secretName in $migrationSecretNames) {
      $secretResults += Copy-SecretLatestVersion -FromProjectId $From -ToProjectId $To -SecretName $secretName
    }
    $secretFlags = @($secretBindings | ForEach-Object { "$($_.Key)=$($_.Value):latest" }) -join ','
    Invoke-Gcloud -Arguments @(
      'run', 'services', 'update', $config.ServiceName,
      '--project', $To,
      '--region', $Region,
      '--update-env-vars', "AUTOMNIA_MIGRATION_REFRESH=$timestamp,MIGRATION_WRITE_MODE=read_only",
      '--update-secrets', $secretFlags,
      '--no-traffic',
      '--tag=candidate'
    ) | Out-Null
  }

  $sourceAfter = Get-FirestoreSnapshot -ProjectId $From
  $targetAfter = Get-FirestoreSnapshot -ProjectId $To
  $dataMatched = $sourceAfter.globalHash -eq $targetAfter.globalHash -and
    $sourceAfter.customerCount -eq $targetAfter.customerCount -and
    $sourceAfter.creditBalanceTotal -eq $targetAfter.creditBalanceTotal
  if (-not $dataMatched) {
    throw "Post-import Firestore snapshot mismatch. Source=$($sourceAfter | ConvertTo-Json -Compress) Target=$($targetAfter | ConvertTo-Json -Compress)"
  }

  $candidateUrl = $null
  $candidateRevision = $null
  if (-not $DataOnly) {
    $service = Get-ServiceDescriptor -ProjectId $To -Region $Region -ServiceName $config.ServiceName
    $candidate = @($service.status.traffic | Where-Object { $_ -and $_.PSObject.Properties['tag'] -and $_.tag -eq 'candidate' } | Select-Object -First 1)
    $candidateUrl = if ($candidate -and $candidate.url) { [string]$candidate.url } else { [string]$service.status.url }
    $candidateRevision = [string]$service.status.latestCreatedRevisionName
    & (Join-Path $PSScriptRoot 'health.ps1') -ProjectId $To -Region $Region -BaseUrl $candidateUrl -ExpectedWriteMode read_only -SkipGmail:$SkipGmail | Out-Null
  }

  $state = [ordered]@{
    kind = 'automnia-firestore-migration'
    schemaVersion = $config.SchemaVersion
    createdAt = [DateTimeOffset]::UtcNow.ToString('o')
    fromProjectId = $From
    toProjectId = $To
    region = $Region
    exportUri = $exportUri
    sourceBefore = $sourceBefore
    sourceAfter = $sourceAfter
    targetBefore = $targetBefore
    targetAfter = $targetAfter
    candidateUrl = $candidateUrl
    candidateRevision = $candidateRevision
    secrets = $secretResults
    secretCopySkipped = [bool]$SkipSecretCopy
    targetShopifySecretsPreserved = @($targetShopifySecretNames)
    dataOnly = [bool]$DataOnly
    switchEligible = -not $DataOnly -and -not $SkipSecretCopy
    gmailSecretSkipped = [bool]$SkipGmail
    passed = $dataMatched -and ($DataOnly -or -not $SkipSecretCopy) -and $targetShopifySecretsReady
  }
  $statePath = Write-StateJson -Name "migration-$From-to-$To-$timestamp.json" -Value $state
  if (-not $state.passed) { throw 'Migration copied data but did not pass its configured checks.' }
  [pscustomobject]@{ Passed = $true; SwitchEligible = $state.switchEligible; DataOnly = [bool]$DataOnly; From = $From; To = $To; Documents = $targetAfter.totalDocuments; Customers = $targetAfter.customerCount; CreditBalanceTotal = $targetAfter.creditBalanceTotal; CandidateUrl = $candidateUrl; StatePath = $statePath }
} finally {
  foreach ($agent in @($sourceFirestoreAgent, $targetFirestoreAgent)) {
    Invoke-Gcloud -Arguments @('storage', 'buckets', 'remove-iam-policy-binding', $bucketUri, '--project', $To, '--member', "serviceAccount:$agent", '--role', 'roles/storage.admin') -AllowFailure | Out-Null
  }
}
