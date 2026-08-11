[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)][ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$ProjectId,
  [Parameter(Mandatory)][ValidatePattern('^gs://')][string]$OutputUriPrefix,
  [string[]]$CollectionIds
)

. (Join-Path $PSScriptRoot 'Common.ps1')
if ($WhatIfPreference) {
  $PSCmdlet.ShouldProcess("$ProjectId/(default)", "plan Firestore export to $OutputUriPrefix") | Out-Null
  return [pscustomobject]@{ WhatIf = $true; ProjectId = $ProjectId; OutputUriPrefix = $OutputUriPrefix }
}
Assert-GcloudSession | Out-Null
Assert-ProjectExists -ProjectId $ProjectId | Out-Null

$arguments = @('firestore', 'export', $OutputUriPrefix, '--project', $ProjectId, '--database=(default)')
if ($CollectionIds -and $CollectionIds.Count -gt 0) { $arguments += '--collection-ids=' + ($CollectionIds -join ',') }
if ($PSCmdlet.ShouldProcess("$ProjectId/(default)", "export Firestore to $OutputUriPrefix")) {
  $output = Invoke-Gcloud -Arguments $arguments
}

$timestamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$state = [ordered]@{
  kind = 'automnia-firestore-export'
  createdAt = [DateTimeOffset]::UtcNow.ToString('o')
  projectId = $ProjectId
  outputUriPrefix = $OutputUriPrefix
  collectionIds = @($CollectionIds)
  gcloudOutput = $output
  passed = $true
}
$statePath = Write-StateJson -Name "export-$ProjectId-$timestamp.json" -Value $state
[pscustomobject]@{ Passed = $true; ProjectId = $ProjectId; OutputUriPrefix = $OutputUriPrefix; StatePath = $statePath }
