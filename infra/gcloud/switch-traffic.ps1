[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium')]
param(
  [Parameter(Mandatory)][ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$ProjectId,
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$SourceProjectId,
  [string]$Region,
  [string]$DnsProjectId,
  [string]$DnsZone,
  [switch]$SkipGmail,
  [switch]$UseTargetShopifySecrets,
  [switch]$AllowShopifyConfigMigration,
  [string]$SourceGcloudAccount,
  [string]$TargetGcloudAccount
)

. (Join-Path $PSScriptRoot 'Common.ps1')
$config = Get-AutomniaConfig
if (-not $Region) { $Region = $config.Region }
if (-not $DnsProjectId) { $DnsProjectId = $config.DnsProjectId }
if (-not $DnsZone) { $DnsZone = $config.DnsZone }
if ($UseTargetShopifySecrets -ne $AllowShopifyConfigMigration) {
  throw 'Use -UseTargetShopifySecrets and -AllowShopifyConfigMigration together when the destination uses a new Shopify app.'
}
if ($WhatIfPreference) {
  $PSCmdlet.ShouldProcess($ProjectId, 'plan verified final-delta cutover to the permanent domain') | Out-Null
  return [pscustomobject]@{ WhatIf = $true; TargetProjectId = $ProjectId; SourceProjectId = $SourceProjectId; Domain = $config.PermanentDomain }
}

$previousProjectAccountOverrides = $env:AUTOMNIA_GCLOUD_PROJECT_ACCOUNT_OVERRIDES
$projectAccountOverrides = [ordered]@{}
if ($SourceGcloudAccount) {
  if (-not $SourceProjectId) { throw 'Specify -SourceProjectId when -SourceGcloudAccount is supplied.' }
  $projectAccountOverrides[$SourceProjectId] = $SourceGcloudAccount
}
if ($TargetGcloudAccount) { $projectAccountOverrides[$ProjectId] = $TargetGcloudAccount }
if ($projectAccountOverrides.Count -gt 0) {
  $env:AUTOMNIA_GCLOUD_PROJECT_ACCOUNT_OVERRIDES = $projectAccountOverrides | ConvertTo-Json -Compress
}

try {
Assert-GcloudSession | Out-Null
$migrationState = Get-LatestState -Pattern "migration-*-to-$ProjectId-*.json" -AllowMissing
if (-not $SourceProjectId -and $migrationState) { $SourceProjectId = [string]$migrationState.Data.fromProjectId }
if (-not $SourceProjectId) { throw 'SourceProjectId was not supplied and no migration state identifies the current project.' }
if ($SourceProjectId -eq $ProjectId) { throw 'Source and target projects must be different.' }

# The authoritative verification runs after the source is paused and the final
# delta has been copied. A pre-freeze snapshot can drift while Shopify writes.

$sourceService = Get-ServiceDescriptor -ProjectId $SourceProjectId -Region $Region -ServiceName $config.ServiceName
$targetService = Get-ServiceDescriptor -ProjectId $ProjectId -Region $Region -ServiceName $config.ServiceName
$sourceOriginalTraffic = @($sourceService.status.traffic)
$targetOriginalTraffic = @($targetService.status.traffic)
$stagingCandidate = @($targetOriginalTraffic | Where-Object { $_ -and $_.PSObject.Properties['tag'] -and $_.tag -eq 'candidate' } | Select-Object -First 1)
if (-not $stagingCandidate -or -not $stagingCandidate.url) { throw 'Target must have a tagged candidate revision before cutover.' }
$stagingHealth = Wait-HttpJson -Url "$(([string]$stagingCandidate.url).TrimEnd('/'))/health" -TimeoutSeconds $config.HealthTimeoutSeconds
if ($stagingHealth.service -ne $config.ServiceName -or $stagingHealth.writeMode -ne 'read_only') {
  throw "Target candidate must be healthy and read-only before cutover: $($stagingHealth | ConvertTo-Json -Compress)"
}
$sourceOriginalRevision = [string](@($sourceOriginalTraffic | Where-Object { $_ -and $_.PSObject.Properties['percent'] -and $_.percent -gt 0 -and $_.PSObject.Properties['revisionName'] } | Sort-Object percent -Descending | Select-Object -First 1).revisionName)
$sourceScheduler = Get-SchedulerJobDescriptor -ProjectId $SourceProjectId -Region $Region -JobName $config.BillingRetryJobName
$targetScheduler = Get-SchedulerJobDescriptor -ProjectId $ProjectId -Region $Region -JobName $config.BillingRetryJobName
if ($sourceScheduler.state -notin @('ENABLED', 'PAUSED') -or $targetScheduler.state -notin @('ENABLED', 'PAUSED')) {
  throw "Billing retry scheduler is not in a cutover-safe state (source=$($sourceScheduler.state), target=$($targetScheduler.state))."
}
$sourceSchedulerWasEnabled = $sourceScheduler.state -eq 'ENABLED'
if ($targetScheduler.state -ne 'PAUSED') {
  throw 'Target billing retry scheduler must be paused before cutover; deploy the target in staging mode first.'
}
$sourceMapping = Get-DomainMapping -ProjectId $SourceProjectId -Domain $config.PermanentDomain
$targetMappingCreated = $false
$sourceFrozen = $false
$targetActivated = $false
$timestamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')

try {
  if ($sourceSchedulerWasEnabled) {
    Set-SchedulerJobState -ProjectId $SourceProjectId -Region $Region -JobName $config.BillingRetryJobName -Action pause
  }

  if ($PSCmdlet.ShouldProcess("$SourceProjectId/$($config.ServiceName)", 'enter read-only migration mode and route it to 100 percent')) {
    Invoke-Gcloud -Arguments @(
      'run', 'services', 'update', $config.ServiceName,
      '--project', $SourceProjectId,
      '--region', $Region,
      '--update-env-vars', "MIGRATION_WRITE_MODE=read_only,AUTOMNIA_MIGRATION_FREEZE=$timestamp"
    ) | Out-Null
    $frozenService = Get-ServiceDescriptor -ProjectId $SourceProjectId -Region $Region -ServiceName $config.ServiceName
    $frozenRevision = [string]$frozenService.status.latestCreatedRevisionName
    Invoke-Gcloud -Arguments @('run', 'services', 'update-traffic', $config.ServiceName, '--project', $SourceProjectId, '--region', $Region, '--to-revisions', "$frozenRevision=100") | Out-Null
    $sourceFrozen = $true
  }
  $sourceUrl = Get-ServiceUrl -ProjectId $SourceProjectId -Region $Region -ServiceName $config.ServiceName
  $sourceHealth = Wait-HttpJson -Url "$($sourceUrl.TrimEnd('/'))/health" -TimeoutSeconds $config.HealthTimeoutSeconds
  if ($sourceHealth.service -ne $config.ServiceName -or $sourceHealth.writeMode -ne 'read_only') {
    throw "Source service did not confirm read-only mode during cutover: $($sourceHealth | ConvertTo-Json -Compress)"
  }

  # Close the race between the earlier bulk copy and cutover. Shopify receives
  # retryable 503 responses while this final delta is exported and imported.
  & (Join-Path $PSScriptRoot 'migrate-firestore.ps1') -From $SourceProjectId -To $ProjectId -Region $Region -AllowNonEmptyTarget -SkipGmail:$SkipGmail -UseTargetShopifySecrets:$UseTargetShopifySecrets | Out-Null
  $finalVerification = & (Join-Path $PSScriptRoot 'verify.ps1') -ProjectId $ProjectId -SourceProjectId $SourceProjectId -Region $Region -ExpectedWriteMode read_only -SkipGmail:$SkipGmail -AllowShopifyConfigMigration:$AllowShopifyConfigMigration
  if (-not $finalVerification.Passed) { throw 'Final verification did not pass.' }

  if ($PSCmdlet.ShouldProcess("$ProjectId/$($config.ServiceName)", 'create a no-traffic active revision after final read-only verification')) {
    Invoke-Gcloud -Arguments @(
      'run', 'services', 'update', $config.ServiceName,
      '--project', $ProjectId,
      '--region', $Region,
      '--update-env-vars', 'MIGRATION_WRITE_MODE=active',
      '--no-traffic',
      '--tag=candidate'
    ) | Out-Null
  }
  $targetActivated = $true
  $targetService = Get-ServiceDescriptor -ProjectId $ProjectId -Region $Region -ServiceName $config.ServiceName
  $candidate = @($targetService.status.traffic | Where-Object { $_ -and $_.PSObject.Properties['tag'] -and $_.tag -eq 'candidate' } | Select-Object -First 1)
  $candidateRevision = [string]$candidate.revisionName
  $candidateUrl = [string]$candidate.url
  if (-not $candidateRevision -or -not $candidateUrl) { throw 'Activated target revision is missing its candidate tag or URL.' }
  & (Join-Path $PSScriptRoot 'health.ps1') -ProjectId $ProjectId -Region $Region -BaseUrl $candidateUrl -ExpectedWriteMode active -SkipGmail:$SkipGmail | Out-Null
  if ($PSCmdlet.ShouldProcess("$ProjectId/$candidateRevision", 'route target Cloud Run service to 100 percent')) {
    Invoke-Gcloud -Arguments @('run', 'services', 'update-traffic', $config.ServiceName, '--project', $ProjectId, '--region', $Region, '--to-revisions', "$candidateRevision=100", '--update-tags', "candidate=$candidateRevision") | Out-Null
  }
  $targetUrl = Get-ServiceUrl -ProjectId $ProjectId -Region $Region -ServiceName $config.ServiceName
  & (Join-Path $PSScriptRoot 'health.ps1') -ProjectId $ProjectId -Region $Region -BaseUrl $targetUrl -ExpectedWriteMode active -SkipGmail:$SkipGmail | Out-Null

  if ($sourceMapping -and $PSCmdlet.ShouldProcess("$SourceProjectId/$($config.PermanentDomain)", 'remove current domain mapping')) {
    Remove-DomainMapping -ProjectId $SourceProjectId -Domain $config.PermanentDomain -Account $SourceGcloudAccount
    $deleteDeadline = [DateTimeOffset]::UtcNow.AddMinutes(5)
    while ((Get-DomainMapping -ProjectId $SourceProjectId -Domain $config.PermanentDomain) -and [DateTimeOffset]::UtcNow -lt $deleteDeadline) { Start-Sleep -Seconds 5 }
  }

  $existingTargetMapping = Get-DomainMapping -ProjectId $ProjectId -Domain $config.PermanentDomain
  if (-not $existingTargetMapping -and $PSCmdlet.ShouldProcess("$ProjectId/$($config.PermanentDomain)", 'create target domain mapping')) {
    $existingTargetMapping = New-DomainMapping -ProjectId $ProjectId -Domain $config.PermanentDomain -ServiceName $config.ServiceName
    $targetMappingCreated = $true
  }

  if ($DnsProjectId -and $DnsZone) {
    $dnsDeadline = [DateTimeOffset]::UtcNow.AddMinutes(5)
    do {
      $existingTargetMapping = Get-DomainMapping -ProjectId $ProjectId -Domain $config.PermanentDomain
      if (@($existingTargetMapping.status.resourceRecords).Count -gt 0) { break }
      if ([DateTimeOffset]::UtcNow -ge $dnsDeadline) { throw 'Target domain mapping did not publish DNS records.' }
      Start-Sleep -Seconds 5
    } while ($true)
    Sync-DomainDnsRecords -Mapping $existingTargetMapping -DnsProjectId $DnsProjectId -DnsZone $DnsZone
  }

  Wait-DomainMappingReady -ProjectId $ProjectId -Domain $config.PermanentDomain -TimeoutMinutes $config.DomainMappingTimeoutMinutes | Out-Null
  & (Join-Path $PSScriptRoot 'health.ps1') -ProjectId $ProjectId -Region $Region -BaseUrl $config.PermanentBaseUrl -TimeoutSeconds ($config.DomainMappingTimeoutMinutes * 60) -SkipGmail:$SkipGmail | Out-Null
  Set-SchedulerJobState -ProjectId $ProjectId -Region $Region -JobName $config.BillingRetryJobName -Action resume

  $state = [ordered]@{
    kind = 'automnia-traffic-switch'
    schemaVersion = $config.SchemaVersion
    createdAt = [DateTimeOffset]::UtcNow.ToString('o')
    sourceProjectId = $SourceProjectId
    targetProjectId = $ProjectId
    region = $Region
    domain = $config.PermanentDomain
    permanentBaseUrl = $config.PermanentBaseUrl
    sourceOriginalRevision = $sourceOriginalRevision
    sourceOriginalTraffic = $sourceOriginalTraffic
    targetOriginalTraffic = $targetOriginalTraffic
    sourceBillingRetryWasEnabled = $sourceSchedulerWasEnabled
    targetBillingRetryWasEnabled = $false
    targetRevision = $candidateRevision
    verificationId = $finalVerification.VerificationId
    sourceWasMapped = $null -ne $sourceMapping
    passed = $true
  }
  $statePath = Write-StateJson -Name "switch-$SourceProjectId-to-$ProjectId-$timestamp.json" -Value $state
  [pscustomobject]@{ Passed = $true; From = $SourceProjectId; To = $ProjectId; Domain = $config.PermanentDomain; Revision = $candidateRevision; VerificationId = $finalVerification.VerificationId; StatePath = $statePath }
} catch {
  $failure = $_
  Write-Warning "Traffic switch failed; restoring the source route. $($failure.Exception.Message)"
  try {
    Set-SchedulerJobState -ProjectId $ProjectId -Region $Region -JobName $config.BillingRetryJobName -Action pause
  } catch {
    Write-Error "Could not pause the target billing retry scheduler during recovery: $($_.Exception.Message)"
  }
  $targetActivationRecovered = $true
  if ($targetActivated) {
    try {
      Invoke-Gcloud -Arguments @(
        'run', 'services', 'update', $config.ServiceName,
        '--project', $ProjectId,
        '--region', $Region,
        '--update-env-vars', 'MIGRATION_WRITE_MODE=read_only',
        '--no-traffic',
        '--tag=candidate'
      ) | Out-Null
      $safeService = Get-ServiceDescriptor -ProjectId $ProjectId -Region $Region -ServiceName $config.ServiceName
      $safeCandidate = @($safeService.status.traffic | Where-Object { $_ -and $_.PSObject.Properties['tag'] -and $_.tag -eq 'candidate' } | Select-Object -First 1)
      if (-not $safeCandidate -or -not $safeCandidate.revisionName -or -not $safeCandidate.url) { throw 'Read-only recovery revision is missing its candidate tag or URL.' }
      Invoke-Gcloud -Arguments @('run', 'services', 'update-traffic', $config.ServiceName, '--project', $ProjectId, '--region', $Region, '--to-revisions', "$($safeCandidate.revisionName)=100", '--update-tags', "candidate=$($safeCandidate.revisionName)") | Out-Null
      & (Join-Path $PSScriptRoot 'health.ps1') -ProjectId $ProjectId -Region $Region -BaseUrl ([string]$safeCandidate.url) -ExpectedWriteMode read_only -SkipGmail:$SkipGmail | Out-Null
    } catch {
      $targetActivationRecovered = $false
      Write-Error "Could not return the target candidate to read-only mode during recovery: $($_.Exception.Message)"
    }
  }
  $sourceRouteRecovered = $true
  try {
    if ($targetMappingCreated -or (Get-DomainMapping -ProjectId $ProjectId -Domain $config.PermanentDomain)) {
      Remove-DomainMapping -ProjectId $ProjectId -Domain $config.PermanentDomain
    }
    if ($sourceMapping -and -not (Get-DomainMapping -ProjectId $SourceProjectId -Domain $config.PermanentDomain)) {
      $restored = New-DomainMapping -ProjectId $SourceProjectId -Domain $config.PermanentDomain -ServiceName $config.ServiceName -Account $SourceGcloudAccount
      if ($DnsProjectId -and $DnsZone -and @($restored.status.resourceRecords).Count -gt 0) {
        Sync-DomainDnsRecords -Mapping $restored -DnsProjectId $DnsProjectId -DnsZone $DnsZone
      }
    }
    if ($sourceFrozen -and $sourceOriginalRevision) {
      Invoke-Gcloud -Arguments @('run', 'services', 'update-traffic', $config.ServiceName, '--project', $SourceProjectId, '--region', $Region, '--to-revisions', "$sourceOriginalRevision=100") | Out-Null
    }
    $targetPercentAssignments = @($targetOriginalTraffic | Where-Object { $_ -and $_.PSObject.Properties['percent'] -and $_.percent -gt 0 -and $_.PSObject.Properties['revisionName'] -and $_.revisionName } | ForEach-Object { "$($_.revisionName)=$($_.percent)" }) -join ','
    if ($targetPercentAssignments) {
      Invoke-Gcloud -Arguments @('run', 'services', 'update-traffic', $config.ServiceName, '--project', $ProjectId, '--region', $Region, '--to-revisions', $targetPercentAssignments) | Out-Null
    }
  } catch {
    $sourceRouteRecovered = $false
    Write-Error "Automatic domain or traffic recovery also encountered an error: $($_.Exception.Message)"
  }
  try {
    if ($sourceRouteRecovered -and $targetActivationRecovered -and $sourceSchedulerWasEnabled) {
      Set-SchedulerJobState -ProjectId $SourceProjectId -Region $Region -JobName $config.BillingRetryJobName -Action resume
    } else {
      Set-SchedulerJobState -ProjectId $SourceProjectId -Region $Region -JobName $config.BillingRetryJobName -Action pause
    }
  } catch {
    Write-Error "Automatic billing scheduler recovery also encountered an error: $($_.Exception.Message)"
  }
  $failureState = [ordered]@{
    kind = 'automnia-traffic-switch-failure'
    createdAt = [DateTimeOffset]::UtcNow.ToString('o')
    sourceProjectId = $SourceProjectId
    targetProjectId = $ProjectId
    domain = $config.PermanentDomain
    error = $failure.Exception.Message
    automaticRollbackAttempted = $true
    targetActivationRecovered = $targetActivationRecovered
    passed = $false
  }
  Write-StateJson -Name "switch-failed-$SourceProjectId-to-$ProjectId-$timestamp.json" -Value $failureState | Out-Null
  throw $failure
}
} finally {
  $env:AUTOMNIA_GCLOUD_PROJECT_ACCOUNT_OVERRIDES = $previousProjectAccountOverrides
}
