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
$activeMapping = Get-DomainMapping -ProjectId $FromProjectId -Domain $config.PermanentDomain
$restoredMappingCreated = $false

try {
  if ($PSCmdlet.ShouldProcess("$FromProjectId/$($config.ServiceName)", 'freeze current project for rollback delta migration')) {
    Invoke-Gcloud -Arguments @('run', 'services', 'update', $config.ServiceName, '--project', $FromProjectId, '--region', $Region, '--update-env-vars', "MIGRATION_WRITE_MODE=read_only,AUTOMNIA_ROLLBACK_FREEZE=$timestamp") | Out-Null
    $frozen = Get-ServiceDescriptor -ProjectId $FromProjectId -Region $Region -ServiceName $config.ServiceName
    Invoke-Gcloud -Arguments @('run', 'services', 'update-traffic', $config.ServiceName, '--project', $FromProjectId, '--region', $Region, '--to-revisions', "$($frozen.status.latestCreatedRevisionName)=100") | Out-Null
  }
  & (Join-Path $PSScriptRoot 'health.ps1') -ProjectId $FromProjectId -Region $Region -ExpectedWriteMode read_only | Out-Null

  & (Join-Path $PSScriptRoot 'migrate-firestore.ps1') -From $FromProjectId -To $ToProjectId -Region $Region -AllowNonEmptyTarget | Out-Null
  $verification = & (Join-Path $PSScriptRoot 'verify.ps1') -ProjectId $ToProjectId -SourceProjectId $FromProjectId -Region $Region
  if (-not $verification.Passed) { throw 'Rollback verification failed.' }

  $restoredService = Get-ServiceDescriptor -ProjectId $ToProjectId -Region $Region -ServiceName $config.ServiceName
  $candidate = @($restoredService.status.traffic | Where-Object { $_.tag -eq 'candidate' } | Select-Object -First 1)
  $restoredRevision = if ($candidate.revisionName) { [string]$candidate.revisionName } else { [string]$restoredService.status.latestCreatedRevisionName }
  Invoke-Gcloud -Arguments @('run', 'services', 'update-traffic', $config.ServiceName, '--project', $ToProjectId, '--region', $Region, '--to-revisions', "$restoredRevision=100", '--update-tags', "candidate=$restoredRevision") | Out-Null
  & (Join-Path $PSScriptRoot 'health.ps1') -ProjectId $ToProjectId -Region $Region | Out-Null

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

  $state = [ordered]@{
    kind = 'automnia-traffic-rollback'
    schemaVersion = $config.SchemaVersion
    createdAt = [DateTimeOffset]::UtcNow.ToString('o')
    fromProjectId = $FromProjectId
    toProjectId = $ToProjectId
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
    Write-Error "Automatic domain recovery also encountered an error: $($_.Exception.Message)"
  }
  if ($activeOriginalRevision) {
    Invoke-Gcloud -Arguments @('run', 'services', 'update-traffic', $config.ServiceName, '--project', $FromProjectId, '--region', $Region, '--to-revisions', "$activeOriginalRevision=100") -AllowFailure | Out-Null
  }
  throw $rollbackFailure
}
