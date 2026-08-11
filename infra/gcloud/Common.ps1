Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$env:CLOUDSDK_CORE_DISABLE_PROMPTS = '1'
$env:CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK = '1'

$script:InfraRoot = Split-Path -Parent $PSCommandPath
$script:StateRoot = Join-Path $script:InfraRoot '.state'

function Get-AutomniaConfig {
  Import-PowerShellDataFile -LiteralPath (Join-Path $script:InfraRoot 'config.psd1')
}

function Assert-Tool {
  param([Parameter(Mandatory)][string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found on PATH."
  }
}

function Assert-GcloudSession {
  Assert-Tool -Name 'gcloud'
  $account = Invoke-Gcloud -Arguments @('auth', 'list', '--filter=status:ACTIVE', '--format=value(account)')
  if (-not $account) { throw 'No active gcloud account was found. Run gcloud auth login first.' }
  $account
}

function Invoke-Gcloud {
  param(
    [Parameter(Mandatory)][string[]]$Arguments,
    [switch]$AllowFailure
  )
  $output = & gcloud @Arguments 2>&1
  $exitCode = $LASTEXITCODE
  $text = ($output | ForEach-Object { [string]$_ }) -join "`n"
  if ($exitCode -ne 0 -and -not $AllowFailure) {
    throw "gcloud $($Arguments -join ' ') failed with exit code ${exitCode}:`n$text"
  }
  if ($AllowFailure) {
    return [pscustomobject]@{ ExitCode = $exitCode; Output = $text.Trim() }
  }
  $text.Trim()
}

function Invoke-GcloudJson {
  param([Parameter(Mandatory)][string[]]$Arguments)
  $json = Invoke-Gcloud -Arguments ($Arguments + '--format=json')
  if (-not $json) { return $null }
  $json | ConvertFrom-Json
}

function Assert-ProjectExists {
  param([Parameter(Mandatory)][string]$ProjectId)
  $project = Invoke-GcloudJson -Arguments @('projects', 'describe', $ProjectId)
  if (-not $project.projectNumber) { throw "Google Cloud project '$ProjectId' is not accessible." }
  $project
}

function Get-ProjectNumber {
  param([Parameter(Mandatory)][string]$ProjectId)
  [string](Assert-ProjectExists -ProjectId $ProjectId).projectNumber
}

function Get-ServiceDescriptor {
  param(
    [Parameter(Mandatory)][string]$ProjectId,
    [Parameter(Mandatory)][string]$Region,
    [Parameter(Mandatory)][string]$ServiceName,
    [switch]$AllowMissing
  )
  $result = Invoke-Gcloud -Arguments @('run', 'services', 'describe', $ServiceName, '--project', $ProjectId, '--region', $Region, '--format=json') -AllowFailure
  if ($result.ExitCode -ne 0) {
    if ($AllowMissing) { return $null }
    throw "Cloud Run service '$ServiceName' was not found in $ProjectId/$Region.`n$($result.Output)"
  }
  $result.Output | ConvertFrom-Json
}

function Get-ServiceUrl {
  param(
    [Parameter(Mandatory)][string]$ProjectId,
    [Parameter(Mandatory)][string]$Region,
    [Parameter(Mandatory)][string]$ServiceName
  )
  $service = Get-ServiceDescriptor -ProjectId $ProjectId -Region $Region -ServiceName $ServiceName
  [string]$service.status.url
}

function Wait-HttpJson {
  param(
    [Parameter(Mandatory)][string]$Url,
    [int]$TimeoutSeconds = 180,
    [int]$IntervalSeconds = 5
  )
  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
  $lastError = $null
  while ([DateTimeOffset]::UtcNow -lt $deadline) {
    try {
      $response = Invoke-RestMethod -Method Get -Uri $Url -TimeoutSec 15 -Headers @{ Accept = 'application/json' }
      if ($response.ok -eq $true) { return $response }
      $lastError = "Endpoint returned ok=$($response.ok)."
    } catch {
      $lastError = $_.Exception.Message
    }
    Start-Sleep -Seconds $IntervalSeconds
  }
  throw "Timed out waiting for $Url. Last error: $lastError"
}

function Get-Sha256Text {
  param([Parameter(Mandatory)][AllowEmptyString()][string]$Value)
  $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $hash = $sha.ComputeHash($bytes) } finally { $sha.Dispose() }
  (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Get-ObjectPropertyValue {
  param($InputObject, [Parameter(Mandatory)][string]$Name, $Default = '')
  if ($null -eq $InputObject -or $InputObject.PSObject.Properties.Name -notcontains $Name) { return $Default }
  $InputObject.$Name
}

function Get-PlanMappingBase64 {
  $path = Join-Path $script:InfraRoot 'shopify-plan-mappings.json'
  $json = [IO.File]::ReadAllText($path)
  $parsed = $json | ConvertFrom-Json
  if ($parsed.Count -lt 1) { throw 'shopify-plan-mappings.json must contain at least one plan.' }
  [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($parsed | ConvertTo-Json -Depth 20 -Compress)))
}

function Get-LocalPlanMappingHash {
  Assert-Tool -Name 'node'
  $tool = Join-Path $script:InfraRoot 'tools\plan-hash.mjs'
  $mappingPath = Join-Path $script:InfraRoot 'shopify-plan-mappings.json'
  $hash = & node $tool $mappingPath
  if ($LASTEXITCODE -ne 0 -or -not $hash) { throw 'Unable to compute the Shopify plan-mapping hash.' }
  ([string]$hash).Trim()
}

function Get-FirestoreSnapshot {
  param([Parameter(Mandatory)][string]$ProjectId)
  Assert-Tool -Name 'node'
  $tool = Join-Path $script:InfraRoot 'tools\firestore-snapshot.mjs'
  $previousToken = $env:AUTOMNIA_GCLOUD_ACCESS_TOKEN
  try {
    $env:AUTOMNIA_GCLOUD_ACCESS_TOKEN = Get-GoogleAccessToken
    $json = & node $tool $ProjectId
    if ($LASTEXITCODE -ne 0 -or -not $json) { throw "Unable to snapshot Firestore project '$ProjectId'." }
    ([string]$json) | ConvertFrom-Json
  } finally {
    $env:AUTOMNIA_GCLOUD_ACCESS_TOKEN = $previousToken
  }
}

function Get-FirestoreIndexes {
  param([Parameter(Mandatory)][string]$ProjectId)
  $raw = Invoke-GcloudJson -Arguments @('firestore', 'indexes', 'composite', 'list', '--project', $ProjectId, '--database=(default)')
  $items = @($raw | ForEach-Object {
    [pscustomobject]@{
      collectionGroup = [string](Get-ObjectPropertyValue $_ 'collectionGroup')
      queryScope = [string](Get-ObjectPropertyValue $_ 'queryScope')
      apiScope = [string](Get-ObjectPropertyValue $_ 'apiScope')
      state = [string](Get-ObjectPropertyValue $_ 'state')
      fields = @($_.fields | ForEach-Object {
        [ordered]@{
          fieldPath = [string](Get-ObjectPropertyValue $_ 'fieldPath')
          order = [string](Get-ObjectPropertyValue $_ 'order')
          arrayConfig = [string](Get-ObjectPropertyValue $_ 'arrayConfig')
        }
      })
    }
  })
  @($items | Sort-Object collectionGroup, queryScope, @{ Expression = { $_.fields | ConvertTo-Json -Compress } })
}

function Get-ServiceEnvironment {
  param(
    [Parameter(Mandatory)][string]$ProjectId,
    [Parameter(Mandatory)][string]$Region,
    [Parameter(Mandatory)][string]$ServiceName
  )
  $service = Get-ServiceDescriptor -ProjectId $ProjectId -Region $Region -ServiceName $ServiceName
  $environment = @{}
  foreach ($entry in @($service.spec.template.spec.containers[0].env)) {
    if ($entry.PSObject.Properties.Name -contains 'value') { $environment[[string]$entry.name] = [string]$entry.value }
  }
  $environment
}

function Get-ServicePlanMappingHash {
  param(
    [Parameter(Mandatory)][string]$ProjectId,
    [Parameter(Mandatory)][string]$Region,
    [Parameter(Mandatory)][string]$ServiceName
  )
  $environment = Get-ServiceEnvironment -ProjectId $ProjectId -Region $Region -ServiceName $ServiceName
  $encoded = [string]$environment['SHOPIFY_PLAN_MAPPINGS']
  if (-not $encoded) { throw "Cloud Run service in '$ProjectId' has no SHOPIFY_PLAN_MAPPINGS value." }
  try {
    $padding = (4 - ($encoded.Length % 4)) % 4
    $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded + ('=' * $padding)))
    $null = $json | ConvertFrom-Json
  } catch {
    $json = $encoded
    $null = $json | ConvertFrom-Json
  }
  $temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ('automnia-plan-hash-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
  $mappingFile = Join-Path $temporaryDirectory 'mappings.json'
  try {
    [IO.File]::WriteAllText($mappingFile, $json, [Text.UTF8Encoding]::new($false))
    $tool = Join-Path $script:InfraRoot 'tools\plan-hash.mjs'
    $hash = & node $tool $mappingFile
    if ($LASTEXITCODE -ne 0 -or -not $hash) { throw "Unable to hash SHOPIFY_PLAN_MAPPINGS in '$ProjectId'." }
    ([string]$hash).Trim()
  } finally {
    if (Test-Path -LiteralPath $temporaryDirectory) { Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force }
  }
}

function Get-StateDirectory {
  if (-not (Test-Path -LiteralPath $script:StateRoot)) {
    New-Item -ItemType Directory -Path $script:StateRoot | Out-Null
  }
  $script:StateRoot
}

function Write-StateJson {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)]$Value
  )
  $directory = Get-StateDirectory
  $path = Join-Path $directory $Name
  $json = $Value | ConvertTo-Json -Depth 30
  [IO.File]::WriteAllText($path, $json, [Text.UTF8Encoding]::new($false))
  $path
}

function Get-LatestState {
  param(
    [Parameter(Mandatory)][string]$Pattern,
    [switch]$AllowMissing
  )
  $directory = Get-StateDirectory
  $file = Get-ChildItem -LiteralPath $directory -Filter $Pattern -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  if (-not $file) {
    if ($AllowMissing) { return $null }
    throw "No state file matching '$Pattern' was found in $directory."
  }
  [pscustomobject]@{ Path = $file.FullName; Data = (Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json) }
}

function Test-SecretVersion {
  param(
    [Parameter(Mandatory)][string]$ProjectId,
    [Parameter(Mandatory)][string]$SecretName
  )
  $result = Invoke-Gcloud -Arguments @('secrets', 'versions', 'list', $SecretName, '--project', $ProjectId, '--filter=state:ENABLED', '--limit=1', '--format=value(name)') -AllowFailure
  $result.ExitCode -eq 0 -and [bool]$result.Output
}

function Ensure-SecretResource {
  param(
    [Parameter(Mandatory)][string]$ProjectId,
    [Parameter(Mandatory)][string]$SecretName,
    [switch]$BootstrapVersion
  )
  $describe = Invoke-Gcloud -Arguments @('secrets', 'describe', $SecretName, '--project', $ProjectId, '--format=value(name)') -AllowFailure
  if ($describe.ExitCode -ne 0) {
    Invoke-Gcloud -Arguments @('secrets', 'create', $SecretName, '--project', $ProjectId, '--replication-policy=automatic') | Out-Null
  }
  if ($BootstrapVersion -and -not (Test-SecretVersion -ProjectId $ProjectId -SecretName $SecretName)) {
    $temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ('automnia-secret-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
    $secretFile = Join-Path $temporaryDirectory 'value'
    try {
      $randomBytes = New-Object byte[] 48
      $randomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
      try { $randomGenerator.GetBytes($randomBytes) } finally { $randomGenerator.Dispose() }
      $random = [Convert]::ToBase64String($randomBytes)
      [IO.File]::WriteAllText($secretFile, $random, [Text.UTF8Encoding]::new($false))
      Invoke-Gcloud -Arguments @('secrets', 'versions', 'add', $SecretName, '--project', $ProjectId, '--data-file', $secretFile) | Out-Null
    } finally {
      if (Test-Path -LiteralPath $temporaryDirectory) { Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force }
    }
  }
}

function Get-SecretFingerprint {
  param(
    [Parameter(Mandatory)][string]$ProjectId,
    [Parameter(Mandatory)][string]$SecretName
  )
  $temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ('automnia-fingerprint-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
  $secretFile = Join-Path $temporaryDirectory 'value'
  try {
    Invoke-Gcloud -Arguments @('secrets', 'versions', 'access', 'latest', '--secret', $SecretName, '--project', $ProjectId, '--out-file', $secretFile) | Out-Null
    (Get-FileHash -LiteralPath $secretFile -Algorithm SHA256).Hash.ToLowerInvariant()
  } finally {
    if (Test-Path -LiteralPath $temporaryDirectory) { Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force }
  }
}

function Copy-SecretLatestVersion {
  param(
    [Parameter(Mandatory)][string]$FromProjectId,
    [Parameter(Mandatory)][string]$ToProjectId,
    [Parameter(Mandatory)][string]$SecretName
  )
  Ensure-SecretResource -ProjectId $ToProjectId -SecretName $SecretName
  $temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ('automnia-secret-copy-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
  $secretFile = Join-Path $temporaryDirectory 'value'
  try {
    Invoke-Gcloud -Arguments @('secrets', 'versions', 'access', 'latest', '--secret', $SecretName, '--project', $FromProjectId, '--out-file', $secretFile) | Out-Null
    $sourceHash = (Get-FileHash -LiteralPath $secretFile -Algorithm SHA256).Hash.ToLowerInvariant()
    $targetHash = Get-SecretFingerprint -ProjectId $ToProjectId -SecretName $SecretName
    if ($targetHash -ne $sourceHash) {
      Invoke-Gcloud -Arguments @('secrets', 'versions', 'add', $SecretName, '--project', $ToProjectId, '--data-file', $secretFile) | Out-Null
      $targetHash = Get-SecretFingerprint -ProjectId $ToProjectId -SecretName $SecretName
    }
    if ($targetHash -ne $sourceHash) { throw "Secret '$SecretName' did not copy exactly." }
    [pscustomobject]@{ Name = $SecretName; Fingerprint = $sourceHash; Matched = $true }
  } finally {
    if (Test-Path -LiteralPath $temporaryDirectory) { Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force }
  }
}

function Get-GoogleAccessToken {
  (Invoke-Gcloud -Arguments @('auth', 'print-access-token')).Trim()
}

function Get-DomainMapping {
  param(
    [Parameter(Mandatory)][string]$ProjectId,
    [Parameter(Mandatory)][string]$Domain
  )
  $token = Get-GoogleAccessToken
  $encodedDomain = [Uri]::EscapeDataString($Domain)
  $uri = "https://run.googleapis.com/apis/domains.cloudrun.com/v1/namespaces/$ProjectId/domainmappings/$encodedDomain"
  try {
    Invoke-RestMethod -Method Get -Uri $uri -Headers @{ Authorization = "Bearer $token"; Accept = 'application/json' }
  } catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 404) { return $null }
    throw
  }
}

function Remove-DomainMapping {
  param(
    [Parameter(Mandatory)][string]$ProjectId,
    [Parameter(Mandatory)][string]$Domain
  )
  if (-not (Get-DomainMapping -ProjectId $ProjectId -Domain $Domain)) { return }
  $token = Get-GoogleAccessToken
  $encodedDomain = [Uri]::EscapeDataString($Domain)
  $uri = "https://run.googleapis.com/apis/domains.cloudrun.com/v1/namespaces/$ProjectId/domainmappings/$encodedDomain"
  Invoke-RestMethod -Method Delete -Uri $uri -Headers @{ Authorization = "Bearer $token"; Accept = 'application/json' } | Out-Null
}

function New-DomainMapping {
  param(
    [Parameter(Mandatory)][string]$ProjectId,
    [Parameter(Mandatory)][string]$Domain,
    [Parameter(Mandatory)][string]$ServiceName
  )
  $token = Get-GoogleAccessToken
  $uri = "https://run.googleapis.com/apis/domains.cloudrun.com/v1/namespaces/$ProjectId/domainmappings"
  $body = @{
    apiVersion = 'domains.cloudrun.com/v1'
    kind = 'DomainMapping'
    metadata = @{ name = $Domain; namespace = $ProjectId }
    spec = @{ routeName = $ServiceName; certificateMode = 'AUTOMATIC' }
  } | ConvertTo-Json -Depth 10
  Invoke-RestMethod -Method Post -Uri $uri -ContentType 'application/json' -Body $body -Headers @{ Authorization = "Bearer $token"; Accept = 'application/json' }
}

function Wait-DomainMappingReady {
  param(
    [Parameter(Mandatory)][string]$ProjectId,
    [Parameter(Mandatory)][string]$Domain,
    [int]$TimeoutMinutes = 30
  )
  $deadline = [DateTimeOffset]::UtcNow.AddMinutes($TimeoutMinutes)
  $lastState = 'mapping not found'
  while ([DateTimeOffset]::UtcNow -lt $deadline) {
    $mapping = Get-DomainMapping -ProjectId $ProjectId -Domain $Domain
    if ($mapping) {
      $ready = $mapping.status.conditions | Where-Object { $_.type -eq 'Ready' } | Select-Object -First 1
      $lastState = if ($ready) { "$($ready.status): $($ready.message)" } else { 'Ready condition pending' }
      if ($ready.status -eq 'True') { return $mapping }
    }
    Start-Sleep -Seconds 10
  }
  throw "Domain mapping for $Domain did not become ready in $TimeoutMinutes minutes. Last state: $lastState"
}

function Sync-DomainDnsRecords {
  param(
    [Parameter(Mandatory)]$Mapping,
    [Parameter(Mandatory)][string]$DnsProjectId,
    [Parameter(Mandatory)][string]$DnsZone,
    [int]$Ttl = 300
  )
  $records = @($Mapping.status.resourceRecords)
  if ($records.Count -eq 0) { throw 'Cloud Run has not supplied DNS resource records for the domain mapping yet.' }
  foreach ($record in $records) {
    $name = [string]$record.name
    if (-not $name.EndsWith('.')) { $name += '.' }
    $type = [string]$record.type
    $rrdata = @($record.rrdata) -join ','
    $existing = Invoke-Gcloud -Arguments @('dns', 'record-sets', 'describe', $name, '--type', $type, '--zone', $DnsZone, '--project', $DnsProjectId, '--format=value(name)') -AllowFailure
    $verb = if ($existing.ExitCode -eq 0) { 'update' } else { 'create' }
    Invoke-Gcloud -Arguments @('dns', 'record-sets', $verb, $name, '--type', $type, '--ttl', [string]$Ttl, '--rrdatas', $rrdata, '--zone', $DnsZone, '--project', $DnsProjectId) | Out-Null
  }
}
