[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium')]
param(
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$FromProjectId,
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$ToProjectId,
  [string]$Region,
  [string]$DnsProjectId,
  [string]$DnsZone
)

. (Join-Path $PSScriptRoot 'Common.ps1')
$config = Get-AutomniaConfig
if (-not $Region) { $Region = $config.Region }
if (-not $DnsProjectId) { $DnsProjectId = $config.DnsProjectId }
if (-not $DnsZone) { $DnsZone = $config.DnsZone }
if ($WhatIfPreference) {
  $PSCmdlet.ShouldProcess("$FromProjectId -> $ToProjectId", 'plan verified reverse migration and permanent-domain rollback') | Out-Null
  return [pscustomobject]@{ WhatIf = $true; FromProjectId = $FromProjectId; ToProjectId = $ToProjectId; Domain = $config.PermanentDomain }
}

$switchState = if ($FromProjectId -and $ToProjectId) {
  Get-LatestState -Pattern "switch-$ToProjectId-to-$FromProjectId-*.json"
} else {
  Get-LatestState -Pattern 'switch-*-to-*.json'
}
if (-not $FromProjectId) { $FromProjectId = [string]$switchState.Data.targetProjectId }
if (-not $ToProjectId) { $ToProjectId = [string]$switchState.Data.sourceProjectId }
if ($FromProjectId -eq $ToProjectId) { throw 'Rollback source and target projects must be different.' }

Assert-GcloudSession | Out-Null
$timestamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$activeService = Get-ServiceDescriptor -ProjectId $FromProjectId -Region $Region -ServiceName $config.ServiceName
$activeOriginalRevision = [string](@($activeService.status.traffic | Where-Object { $_.percent -gt 0 } | Sort-Object percent -Descending | Select-Object -First 1).revisionName)
$activeScheduler = Get-SchedulerJobDescriptor -ProjectId $FromProjectId -Region $Region -JobName $config.BillingRetryJobName
$restoreScheduler = Get-SchedulerJobDescriptor -ProjectId $ToProjectId -Region $Region -JobName $config.BillingRetryJobName
if ($activeScheduler.state -notin @('ENABLED', 'PAUSED') -or $restoreScheduler.state -notin @('ENABLED', 'PAUSED')) {
  throw "Billing retry scheduler is not in a rollback-safe state (active=$($activeScheduler.state), restore=$($restoreScheduler.state))."
}
$activeSchedulerWasEnabled = $activeScheduler.state -eq 'ENABLED'
if ($restoreScheduler.state -ne 'PAUSED') {
  throw 'Rollback destination billing retry scheduler must be paused before rollback.'
}
$activeMapping = Get-DomainMapping -ProjectId $FromProjectId -Domain $config.PermanentDomain
$restoredMappingCreated = $false
$restoreOriginalTraffic = @()
$restoreActivated = $false

# The previous service must remain read-only until the reverse delta and its
# parity checks finish. A tagged no-traffic active revision is created only
# after those checks pass.
& (Join-Path $PSScriptRoot 'health.ps1') -ProjectId $ToProjectId -Region $Region -ExpectedWriteMode read_only | Out-Null

try {
  if ($activeSchedulerWasEnabled) {
    Set-SchedulerJobState -ProjectId $FromProjectId -Region $Region -JobName $config.BillingRetryJobName -Action pause
  }
  if ($PSCmdlet.ShouldProcess("$FromProjectId/$($config.ServiceName)", 'freeze current project for rollback delta migration')) {
    Invoke-Gcloud -Arguments @('run', 'services', 'update', $config.ServiceName, '--project', $FromProjectId, '--region', $Region, '--update-env-vars', "MIGRATION_WRITE_MODE=read_only,AUTOMNIA_ROLLBACK_FREEZE=$timestamp") | Out-Null
    $frozen = Get-ServiceDescriptor -ProjectId $FromProjectId -Region $Region -ServiceName $config.ServiceName
    Invoke-Gcloud -Arguments @('run', 'services', 'update-traffic', $config.ServiceName, '--project', $FromProjectId, '--region', $Region, '--to-revisions', "$($frozen.status.latestCreatedRevisionName)=100") | Out-Null
  }
  & (Join-Path $PSScriptRoot 'health.ps1') -ProjectId $FromProjectId -Region $Region -ExpectedWriteMode read_only | Out-Null

  & (Join-Path $PSScriptRoot 'migrate-firestore.ps1') -From $FromProjectId -To $ToProjectId -Region $Region -AllowNonEmptyTarget -UseTargetShopifySecrets | Out-Null
  $verification = & (Join-Path $PSScriptRoot 'verify.ps1') -ProjectId $ToProjectId -SourceProjectId $FromProjectId -Region $Region -ExpectedWriteMode read_only -AllowShopifyConfigMigration
  if (-not $verification.Passed) { throw 'Rollback verification failed.' }

  if ($PSCmdlet.ShouldProcess("$ToProjectId/$($config.ServiceName)", 'create a no-traffic active revision after reverse verification')) {
    Invoke-Gcloud -Arguments @(
      'run', 'services', 'update', $config.ServiceName,
      '--project', $ToProjectId,
      '--region', $Region,
      '--update-env-vars', 'MIGRATION_WRITE_MODE=active',
      '--no-traffic',
      '--tag=candidate'
    ) | Out-Null
  }
  $restoreActivated = $true
  $restoredService = Get-ServiceDescriptor -ProjectId $ToProjectId -Region $Region -ServiceName $config.ServiceName
  $restoreOriginalTraffic = @($restoredService.status.traffic)
  $candidate = @($restoredService.status.traffic | Where-Object { $_.tag -eq 'candidate' } | Select-Object -First 1)
  $restoredRevision = [string]$candidate.revisionName
  $candidateUrl = [string]$candidate.url
  if (-not $restoredRevision -or -not $candidateUrl) { throw 'Activated rollback revision is missing its candidate tag or URL.' }
  & (Join-Path $PSScriptRoot 'health.ps1') -ProjectId $ToProjectId -Region $Region -BaseUrl $candidateUrl -ExpectedWriteMode active | Out-Null
  Invoke-Gcloud -Arguments @('run', 'services', 'update-traffic', $config.ServiceName, '--project', $ToProjectId, '--region', $Region, '--to-revisions', "$restoredRevision=100", '--update-tags', "candidate=$restoredRevision") | Out-Null
  & (Join-Path $PSScriptRoot 'health.ps1') -ProjectId $ToProjectId -Region $Region -ExpectedWriteMode active | Out-Null

  $currentMapping = Get-DomainMapping -ProjectId $FromProjectId -Domain $config.PermanentDomain
  if ($currentMapping) { Remove-DomainMapping -ProjectId $FromProjectId -Domain $config.PermanentDomain }
  $deleteDeadline = [DateTimeOffset]::UtcNow.AddMinutes(5)
  while ((Get-DomainMapping -ProjectId $FromProjectId -Domain $config.PermanentDomain) -and [DateTimeOffset]::UtcNow -lt $deleteDeadline) { Start-Sleep -Seconds 5 }
  $restoredMapping = Get-DomainMapping -ProjectId $ToProjectId -Domain $config.PermanentDomain
  if (-not $restoredMapping) {
    $restoredMapping = New-DomainMapping -ProjectId $ToProjectId -Domain $config.PermanentDomain -ServiceName $config.ServiceName
    $restoredMappingCreated = $true
  }
  if ($DnsProjectId -and $DnsZone -and @($restoredMapping.status.resourceRecords).Count -gt 0) {
    Sync-DomainDnsRecords -Mapping $restoredMapping -DnsProjectId $DnsProjectId -DnsZone $DnsZone
  }
  Wait-DomainMappingReady -ProjectId $ToProjectId -Domain $config.PermanentDomain -TimeoutMinutes $config.DomainMappingTimeoutMinutes | Out-Null
  & (Join-Path $PSScriptRoot 'health.ps1') -ProjectId $ToProjectId -Region $Region -BaseUrl $config.PermanentBaseUrl -TimeoutSeconds ($config.DomainMappingTimeoutMinutes * 60) | Out-Null
  Set-SchedulerJobState -ProjectId $ToProjectId -Region $Region -JobName $config.BillingRetryJobName -Action resume

  $state = [ordered]@{
    kind = 'automnia-traffic-rollback'
    schemaVersion = $config.SchemaVersion
    createdAt = [DateTimeOffset]::UtcNow.ToString('o')
    fromProjectId = $FromProjectId
    toProjectId = $ToProjectId
    activeBillingRetryWasEnabled = $activeSchedulerWasEnabled
    restoredBillingRetryWasEnabled = $false
    domain = $config.PermanentDomain
    restoredRevision = $restoredRevision
    verificationId = $verification.VerificationId
    passed = $true
  }
  $statePath = Write-StateJson -Name "rollback-$FromProjectId-to-$ToProjectId-$timestamp.json" -Value $state
  [pscustomobject]@{ Passed = $true; From = $FromProjectId; To = $ToProjectId; Domain = $config.PermanentDomain; Revision = $restoredRevision; StatePath = $statePath }
} catch {
  $rollbackFailure = $_
  Write-Warning "Rollback failed; restoring the pre-rollback service and domain route. $($rollbackFailure.Exception.Message)"
  try {
    Set-SchedulerJobState -ProjectId $ToProjectId -Region $Region -JobName $config.BillingRetryJobName -Action pause
  } catch {
    Write-Error "Could not pause the rollback destination billing scheduler: $($_.Exception.Message)"
  }
  $safeRestoreRevision = ''
  if ($restoreActivated) {
    try {
      Invoke-Gcloud -Arguments @(
        'run', 'services', 'update', $config.ServiceName,
        '--project', $ToProjectId,
        '--region', $Region,
        '--update-env-vars', 'MIGRATION_WRITE_MODE=read_only',
        '--no-traffic',
        '--tag=candidate'
      ) | Out-Null
      $safeService = Get-ServiceDescriptor -ProjectId $ToProjectId -Region $Region -ServiceName $config.ServiceName
      $safeCandidate = @($safeService.status.traffic | Where-Object { $_ -and $_.PSObject.Properties['tag'] -and $_.tag -eq 'candidate' } | Select-Object -First 1)
      if (-not $safeCandidate -or -not $safeCandidate.revisionName -or -not $safeCandidate.url) { throw 'Read-only rollback recovery revision is missing its candidate tag or URL.' }
      $safeRestoreRevision = [string]$safeCandidate.revisionName
      & (Join-Path $PSScriptRoot 'health.ps1') -ProjectId $ToProjectId -Region $Region -BaseUrl ([string]$safeCandidate.url) -ExpectedWriteMode read_only | Out-Null
    } catch {
      Write-Error "Could not return the rollback destination to read-only mode: $($_.Exception.Message)"
      $safeRestoreRevision = ''
    }
  }
  $activeRouteRecovered = $true
  try {
    if ($restoredMappingCreated) {
      Remove-DomainMapping -ProjectId $ToProjectId -Domain $config.PermanentDomain
    }
    if ($activeMapping -and -not (Get-DomainMapping -ProjectId $FromProjectId -Domain $config.PermanentDomain)) {
      $recoveredMapping = New-DomainMapping -ProjectId $FromProjectId -Domain $config.PermanentDomain -ServiceName $config.ServiceName
      if ($DnsProjectId -and $DnsZone -and @($recoveredMapping.status.resourceRecords).Count -gt 0) {
        Sync-DomainDnsRecords -Mapping $recoveredMapping -DnsProjectId $DnsProjectId -DnsZone $DnsZone
      }
    }
  } catch {
    $activeRouteRecovered = $false
    Write-Error "Automatic domain recovery also encountered an error: $($_.Exception.Message)"
  }
  if ($activeOriginalRevision) {
    $activeTrafficAssignments = @($activeService.status.traffic | Where-Object { $_ -and $_.percent -gt 0 -and $_.revisionName } | ForEach-Object { "$($_.revisionName)=$($_.percent)" }) -join ','
    if ($activeTrafficAssignments) {
      $activeTrafficRestore = Invoke-Gcloud -Arguments @('run', 'services', 'update-traffic', $config.ServiceName, '--project', $FromProjectId, '--region', $Region, '--to-revisions', $activeTrafficAssignments) -AllowFailure
      if ($activeTrafficRestore.ExitCode -ne 0) { $activeRouteRecovered = $false; Write-Error "Could not restore active service traffic: $($activeTrafficRestore.Output)" }
    }
  }
  $restoreTrafficAssignments = @($restoreOriginalTraffic | Where-Object { $_ -and $_.percent -gt 0 -and $_.revisionName } | ForEach-Object { "$($_.revisionName)=$($_.percent)" }) -join ','
  if ($restoreTrafficAssignments) {
    $restoreTrafficResult = Invoke-Gcloud -Arguments @('run', 'services', 'update-traffic', $config.ServiceName, '--project', $ToProjectId, '--region', $Region, '--to-revisions', $restoreTrafficAssignments) -AllowFailure
    if ($restoreTrafficResult.ExitCode -ne 0) { Write-Error "Could not restore rollback destination traffic: $($restoreTrafficResult.Output)" }
  } elseif ($safeRestoreRevision) {
    $safeTrafficResult = Invoke-Gcloud -Arguments @('run', 'services', 'update-traffic', $config.ServiceName, '--project', $ToProjectId, '--region', $Region, '--to-revisions', "$safeRestoreRevision=100", '--update-tags', "candidate=$safeRestoreRevision") -AllowFailure
    if ($safeTrafficResult.ExitCode -ne 0) { Write-Error "Could not route rollback destination to its read-only recovery revision: $($safeTrafficResult.Output)" }
  }
  try {
    if ($activeRouteRecovered -and $activeSchedulerWasEnabled) {
      Set-SchedulerJobState -ProjectId $FromProjectId -Region $Region -JobName $config.BillingRetryJobName -Action resume
    } else {
      Set-SchedulerJobState -ProjectId $FromProjectId -Region $Region -JobName $config.BillingRetryJobName -Action pause
    }
  } catch {
    Write-Error "Automatic billing scheduler recovery also encountered an error: $($_.Exception.Message)"
  }
  throw $rollbackFailure
}
