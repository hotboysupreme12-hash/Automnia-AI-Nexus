[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'Medium')]
param(
  [Parameter(Mandatory)][ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$ProjectId,
  [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$SourceProjectId,
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
  $PSCmdlet.ShouldProcess($ProjectId, 'plan verified final-delta cutover to the permanent domain') | Out-Null
  return [pscustomobject]@{ WhatIf = $true; TargetProjectId = $ProjectId; SourceProjectId = $SourceProjectId; Domain = $config.PermanentDomain }
}

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
$sourceOriginalRevision = [string](@($sourceOriginalTraffic | Where-Object { $_ -and $_.PSObject.Properties['percent'] -and $_.percent -gt 0 -and $_.PSObject.Properties['revisionName'] } | Sort-Object percent -Descending | Select-Object -First 1).revisionName)
$sourceMapping = Get-DomainMapping -ProjectId $SourceProjectId -Domain $config.PermanentDomain
$targetMappingCreated = $false
$sourceFrozen = $false
$timestamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')

try {
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
  & (Join-Path $PSScriptRoot 'health.ps1') -ProjectId $SourceProjectId -Region $Region -BaseUrl $sourceUrl -ExpectedWriteMode read_only | Out-Null

  # Close the race between the earlier bulk copy and cutover. Shopify receives
  # retryable 503 responses while this final delta is exported and imported.
  & (Join-Path $PSScriptRoot 'migrate-firestore.ps1') -From $SourceProjectId -To $ProjectId -Region $Region -AllowNonEmptyTarget | Out-Null
  $finalVerification = & (Join-Path $PSScriptRoot 'verify.ps1') -ProjectId $ProjectId -SourceProjectId $SourceProjectId -Region $Region
  if (-not $finalVerification.Passed) { throw 'Final verification did not pass.' }

  $targetService = Get-ServiceDescriptor -ProjectId $ProjectId -Region $Region -ServiceName $config.ServiceName
  $candidate = @($targetService.status.traffic | Where-Object { $_ -and $_.PSObject.Properties['tag'] -and $_.tag -eq 'candidate' } | Select-Object -First 1)
  $candidateRevision = [string]$candidate.revisionName
  if (-not $candidateRevision) { $candidateRevision = [string]$targetService.status.latestCreatedRevisionName }
  if ($PSCmdlet.ShouldProcess("$ProjectId/$candidateRevision", 'route target Cloud Run service to 100 percent')) {
    Invoke-Gcloud -Arguments @('run', 'services', 'update-traffic', $config.ServiceName, '--project', $ProjectId, '--region', $Region, '--to-revisions', "$candidateRevision=100", '--update-tags', "candidate=$candidateRevision") | Out-Null
  }
  $targetUrl = Get-ServiceUrl -ProjectId $ProjectId -Region $Region -ServiceName $config.ServiceName
  & (Join-Path $PSScriptRoot 'health.ps1') -ProjectId $ProjectId -Region $Region -BaseUrl $targetUrl | Out-Null

  if ($sourceMapping -and $PSCmdlet.ShouldProcess("$SourceProjectId/$($config.PermanentDomain)", 'remove current domain mapping')) {
    Remove-DomainMapping -ProjectId $SourceProjectId -Domain $config.PermanentDomain
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
  & (Join-Path $PSScriptRoot 'health.ps1') -ProjectId $ProjectId -Region $Region -BaseUrl $config.PermanentBaseUrl -TimeoutSeconds ($config.DomainMappingTimeoutMinutes * 60) | Out-Null

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
    if ($targetMappingCreated -or (Get-DomainMapping -ProjectId $ProjectId -Domain $config.PermanentDomain)) {
      Remove-DomainMapping -ProjectId $ProjectId -Domain $config.PermanentDomain
    }
    if ($sourceMapping -and -not (Get-DomainMapping -ProjectId $SourceProjectId -Domain $config.PermanentDomain)) {
      $restored = New-DomainMapping -ProjectId $SourceProjectId -Domain $config.PermanentDomain -ServiceName $config.ServiceName
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
    Write-Error "Automatic rollback also encountered an error: $($_.Exception.Message)"
  }
  $failureState = [ordered]@{
    kind = 'automnia-traffic-switch-failure'
    createdAt = [DateTimeOffset]::UtcNow.ToString('o')
    sourceProjectId = $SourceProjectId
    targetProjectId = $ProjectId
    domain = $config.PermanentDomain
    error = $failure.Exception.Message
    automaticRollbackAttempted = $true
    passed = $false
  }
  Write-StateJson -Name "switch-failed-$SourceProjectId-to-$ProjectId-$timestamp.json" -Value $failureState | Out-Null
  throw $failure
}
