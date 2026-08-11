[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)][ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$ProjectId,
  [string]$Region,
  [string]$DnsProjectId,
  [string]$DnsZone,
  [switch]$ExternalDnsReady
)

. (Join-Path $PSScriptRoot 'Common.ps1')
$config = Get-AutomniaConfig
if (-not $Region) { $Region = $config.Region }
if (-not $DnsProjectId) { $DnsProjectId = $config.DnsProjectId }
if (-not $DnsZone) { $DnsZone = $config.DnsZone }
if ($WhatIfPreference) {
  $PSCmdlet.ShouldProcess($config.PermanentDomain, "plan mapping to $ProjectId/$($config.ServiceName)") | Out-Null
  return [pscustomobject]@{ WhatIf = $true; ProjectId = $ProjectId; Domain = $config.PermanentDomain; DnsProjectId = $DnsProjectId; DnsZone = $DnsZone; ExternalDnsReady = [bool]$ExternalDnsReady }
}

Assert-GcloudSession | Out-Null
Assert-ProjectExists -ProjectId $ProjectId | Out-Null
if ($DnsProjectId -and $DnsZone) {
  Assert-ProjectExists -ProjectId $DnsProjectId | Out-Null
  $dnsApi = Invoke-Gcloud -Arguments @('services', 'list', '--enabled', '--project', $DnsProjectId, '--filter=config.name:dns.googleapis.com', '--format=value(config.name)')
  if ($dnsApi -notcontains 'dns.googleapis.com' -and $PSCmdlet.ShouldProcess($DnsProjectId, 'enable Cloud DNS API')) {
    Invoke-Gcloud -Arguments @('services', 'enable', 'dns.googleapis.com', '--project', $DnsProjectId) | Out-Null
  }
}
& (Join-Path $PSScriptRoot 'health.ps1') -ProjectId $ProjectId -Region $Region | Out-Null

$labels = $config.PermanentDomain.Split('.')
$baseDomain = if ($labels.Count -gt 2) { ($labels[($labels.Count - 2)..($labels.Count - 1)] -join '.') } else { $config.PermanentDomain }
$verified = @(Invoke-Gcloud -Arguments @('domains', 'list-user-verified', '--format=value(id)') -split "`n")
if ($verified -notcontains $baseDomain -and $verified -notcontains $config.PermanentDomain) {
  throw "Domain ownership is not verified for '$baseDomain'. Run: gcloud domains verify $baseDomain"
}

$mapping = Get-DomainMapping -ProjectId $ProjectId -Domain $config.PermanentDomain
if (-not $mapping -and $PSCmdlet.ShouldProcess($config.PermanentDomain, "map to $ProjectId/$($config.ServiceName)")) {
  $mapping = New-DomainMapping -ProjectId $ProjectId -Domain $config.PermanentDomain -ServiceName $config.ServiceName
}

$resourceRecordDeadline = [DateTimeOffset]::UtcNow.AddMinutes(5)
do {
  $mapping = Get-DomainMapping -ProjectId $ProjectId -Domain $config.PermanentDomain
  if (@($mapping.status.resourceRecords).Count -gt 0) { break }
  if ([DateTimeOffset]::UtcNow -ge $resourceRecordDeadline) { throw 'Cloud Run did not publish DNS records for the domain mapping within five minutes.' }
  Start-Sleep -Seconds 5
} while ($true)

if ($DnsProjectId -and $DnsZone) {
  if ($PSCmdlet.ShouldProcess("$DnsProjectId/$DnsZone", 'synchronize Cloud Run domain DNS records')) {
    Sync-DomainDnsRecords -Mapping $mapping -DnsProjectId $DnsProjectId -DnsZone $DnsZone
  }
} elseif (-not $ExternalDnsReady) {
  $timestamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
  $pendingState = [ordered]@{
    kind = 'automnia-domain-dns-pending'
    createdAt = [DateTimeOffset]::UtcNow.ToString('o')
    projectId = $ProjectId
    domain = $config.PermanentDomain
    serviceName = $config.ServiceName
    resourceRecords = @($mapping.status.resourceRecords)
    nextCommand = ".\infra\gcloud\configure-domain.ps1 -ProjectId $ProjectId -ExternalDnsReady"
    passed = $false
    pendingDns = $true
  }
  $statePath = Write-StateJson -Name "domain-dns-pending-$ProjectId-$timestamp.json" -Value $pendingState
  return [pscustomobject]@{
    Passed = $false
    PendingDns = $true
    ProjectId = $ProjectId
    Domain = $config.PermanentDomain
    ResourceRecords = @($mapping.status.resourceRecords)
    NextCommand = $pendingState.nextCommand
    StatePath = $statePath
  }
}

$ready = Wait-DomainMappingReady -ProjectId $ProjectId -Domain $config.PermanentDomain -TimeoutMinutes $config.DomainMappingTimeoutMinutes
$health = Wait-HttpJson -Url "$($config.PermanentBaseUrl.TrimEnd('/'))/health" -TimeoutSeconds ($config.DomainMappingTimeoutMinutes * 60)
[pscustomobject]@{
  Passed = $health.ok -eq $true
  ProjectId = $ProjectId
  Domain = $config.PermanentDomain
  ServiceName = $config.ServiceName
  ResourceRecords = $ready.status.resourceRecords
}
