[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)][ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')][string]$ProjectId,
  [string]$Location
)

. (Join-Path $PSScriptRoot 'Common.ps1')
$config = Get-AutomniaConfig
if (-not $Location) { $Location = $config.FirestoreLocation }
if ($WhatIfPreference) {
  $PSCmdlet.ShouldProcess("$ProjectId/(default)", "plan Firestore Native database and index initialization in $Location") | Out-Null
  return [pscustomobject]@{ WhatIf = $true; ProjectId = $ProjectId; Database = '(default)'; Location = $Location }
}

Assert-GcloudSession | Out-Null
Assert-ProjectExists -ProjectId $ProjectId | Out-Null

$database = Invoke-Gcloud -Arguments @('firestore', 'databases', 'describe', '--database=(default)', '--project', $ProjectId, '--format=json') -AllowFailure
if ($database.ExitCode -ne 0) {
  if ($PSCmdlet.ShouldProcess("$ProjectId/(default)", "create Firestore Native database in $Location")) {
    Invoke-Gcloud -Arguments @(
      'firestore', 'databases', 'create',
      '--database=(default)',
      '--location', $Location,
      '--type=firestore-native',
      '--project', $ProjectId
    ) | Out-Null
  }
} else {
  $current = $database.Output | ConvertFrom-Json
  if ([string]$current.locationId -ne $Location) {
    throw "Firestore already exists in '$($current.locationId)', not requested location '$Location'. Database location cannot be changed in place."
  }
}

$indexConfigPath = Join-Path $PSScriptRoot 'firestore.indexes.json'
$indexConfig = Get-Content -LiteralPath $indexConfigPath -Raw | ConvertFrom-Json
if (@($indexConfig.fieldOverrides).Count -gt 0) {
  throw 'fieldOverrides are not currently used by Automnia. Add an explicit migration implementation before introducing them.'
}

$existing = @(Get-FirestoreIndexes -ProjectId $ProjectId)
foreach ($index in @($indexConfig.indexes)) {
  $fieldSignature = @($index.fields | ForEach-Object { "$($_.fieldPath):$($_.order):$($_.arrayConfig)" }) -join '|'
  $match = $existing | Where-Object {
    $_.collectionGroup -eq $index.collectionGroup -and
    $_.queryScope -eq $index.queryScope -and
    ((@($_.fields | ForEach-Object { "$($_.fieldPath):$($_.order):$($_.arrayConfig)" }) -join '|') -eq $fieldSignature)
  }
  if ($match) { continue }

  $arguments = @(
    'firestore', 'indexes', 'composite', 'create',
    '--project', $ProjectId,
    '--database=(default)',
    '--collection-group', [string]$index.collectionGroup,
    '--query-scope', ([string]$index.queryScope).ToLowerInvariant()
  )
  foreach ($field in @($index.fields)) {
    $parts = @("field-path=$($field.fieldPath)")
    if ($field.order) { $parts += "order=$(([string]$field.order).ToLowerInvariant())" }
    if ($field.arrayConfig) { $parts += "array-config=$(([string]$field.arrayConfig).ToLowerInvariant())" }
    $arguments += '--field-config'
    $arguments += ($parts -join ',')
  }
  if ($PSCmdlet.ShouldProcess("$ProjectId/$($index.collectionGroup)", 'create Firestore composite index')) {
    Invoke-Gcloud -Arguments $arguments | Out-Null
  }
}

$deadline = [DateTimeOffset]::UtcNow.AddMinutes(30)
do {
  $indexes = @(Get-FirestoreIndexes -ProjectId $ProjectId)
  $pending = @($indexes | Where-Object { $_.state -and $_.state -notin @('READY', 'Ready') })
  if ($pending.Count -eq 0) { break }
  if ([DateTimeOffset]::UtcNow -ge $deadline) {
    throw "Firestore indexes did not become ready: $($pending | ConvertTo-Json -Depth 10 -Compress)"
  }
  Start-Sleep -Seconds 10
} while ($true)

[pscustomobject]@{
  ProjectId = $ProjectId
  Database = '(default)'
  Location = $Location
  IndexCount = $indexes.Count
  Ready = $true
}
