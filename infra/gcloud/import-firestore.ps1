[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)][ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$ProjectId,
  [Parameter(Mandatory)][ValidatePattern('^gs://')][string]$InputUriPrefix,
  [string[]]$CollectionIds,
  [switch]$AllowNonEmptyTarget
)

. (Join-Path $PSScriptRoot 'Common.ps1')
$config = Get-AutomniaConfig
if ($WhatIfPreference) {
  $PSCmdlet.ShouldProcess("$ProjectId/(default)", "plan Firestore import from $InputUriPrefix") | Out-Null
  return [pscustomobject]@{ WhatIf = $true; ProjectId = $ProjectId; InputUriPrefix = $InputUriPrefix }
}
Assert-GcloudSession | Out-Null
Assert-ProjectExists -ProjectId $ProjectId | Out-Null
& (Join-Path $PSScriptRoot 'initialize-firestore.ps1') -ProjectId $ProjectId -Location $config.FirestoreLocation | Out-Null

$before = Get-FirestoreSnapshot -ProjectId $ProjectId
if (-not $AllowNonEmptyTarget -and $before.totalDocuments -gt 0) {
  throw "Refusing to import into non-empty Firestore project '$ProjectId' ($($before.totalDocuments) documents). Use -AllowNonEmptyTarget only after reviewing merge semantics."
}

$arguments = @('firestore', 'import', $InputUriPrefix, '--project', $ProjectId, '--database=(default)')
if ($CollectionIds -and $CollectionIds.Count -gt 0) { $arguments += '--collection-ids=' + ($CollectionIds -join ',') }
if ($PSCmdlet.ShouldProcess("$ProjectId/(default)", "import Firestore from $InputUriPrefix")) {
  $output = Invoke-Gcloud -Arguments $arguments
}

$after = Get-FirestoreSnapshot -ProjectId $ProjectId
$timestamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$state = [ordered]@{
  kind = 'automnia-firestore-import'
  createdAt = [DateTimeOffset]::UtcNow.ToString('o')
  projectId = $ProjectId
  inputUriPrefix = $InputUriPrefix
  collectionIds = @($CollectionIds)
  before = $before
  after = $after
  gcloudOutput = $output
  passed = $true
}
$statePath = Write-StateJson -Name "import-$ProjectId-$timestamp.json" -Value $state
[pscustomobject]@{ Passed = $true; ProjectId = $ProjectId; BeforeDocuments = $before.totalDocuments; AfterDocuments = $after.totalDocuments; StatePath = $statePath }
