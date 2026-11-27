param([ValidateSet('lab','benchmark','verify','agent')][string]$Mode = 'lab')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$Root = $PSScriptRoot
$Pin = '89ec9c91706396c00d1b34e24d5a3f1bf58742ae'
$Runtime = Join-Path $Root 'runtime'
$Repo = Join-Path $Runtime ('Product-Insights-' + $Pin)
$Marker = Join-Path $Repo '.pi-unified-ready.json'
$Staging = $null
$Guard = $null
$Output = $null
$inheritedToken = $env:PI_AGENT_GITHUB_TOKEN
Remove-Item Env:\PI_AGENT_GITHUB_TOKEN -ErrorAction SilentlyContinue
function Invoke-Checked {
  param([string]$Command,[string[]]$Arguments)
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Command failed (exit $LASTEXITCODE)" }
}
function Local-Tests {
  Write-Host 'Testing the full unified lab, SQLite, agent fixtures and repaired transport ...'
  Invoke-Checked node.exe @('--experimental-sqlite','--test','--test-reporter=tap','engine/test.mjs','tests/integration.test.mjs','tests/queue-agent.test.mjs','tests/acquisition-phase4.test.mjs','benchmark/pinned-fetch.test.mjs')
}
function Acquisition-Tests {
  Push-Location -LiteralPath (Join-Path $Repo 'Scrappers')
  try {
    $env:PI_TEST_LOCAL_OCR = '0'
    Invoke-Checked node.exe @('--test','tests/evidence-quality.test.mjs','tests/technical-extraction.test.mjs','tests/v3-technical-tables.test.mjs','tests/intelligent-discovery.test.mjs','tests/access-recovery.test.mjs','tests/scrappers.test.mjs','tests/research-v3.test.mjs','tests/adaptive-html.test.mjs')
  } finally { Pop-Location }
}
try {
  Write-Host 'PRODUCT INSIGHTS - FULL UNIFIED PHASE 4 PROTOTYPE'
  Write-Host 'Separate v0.4-based application + cumulative Phase 1-4 engine + repaired 34-site retest.'
  Write-Host 'Existing v0.8 application, results and credentials are not modified.'
  Get-Command node.exe -ErrorAction Stop | Out-Null
  Get-Command npm.cmd -ErrorAction Stop | Out-Null
  $version = (& node.exe -p 'process.versions.node' | Select-Object -Last 1).Trim()
  if ($LASTEXITCODE -ne 0 -or [int]($version.Split('.')[0]) -lt 24) { throw "Node.js 24+ required; detected $version" }
  Write-Host "Node.js $version"
  if (!(Test-Path -LiteralPath (Join-Path $Root 'data\knowledge.sqlite') -PathType Leaf)) { throw 'Database missing. Extract the complete ZIP before launching.' }
  if ($Mode -in @('lab','agent')) {
    $listener = Get-NetTCPConnection -LocalPort 8791 -State Listen -ErrorAction SilentlyContinue
    if ($listener) { throw 'Port 8791 is already in use. Close this new lab before restarting. The old lab on port 8790 is untouched.' }
  }
  New-Item -ItemType Directory -Path $Runtime -Force | Out-Null
  # Prevent simultaneous first-time installers from writing the same runtime.
  try { $Guard = [IO.File]::Open((Join-Path $Runtime '.setup.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
  catch { throw 'Another setup is using this new package. Close it or wait for that setup to finish before retrying.' }
  if (!(Test-Path -LiteralPath $Repo -PathType Container)) {
    $Staging = Join-Path $Runtime ('stage-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $Staging | Out-Null
    $Archive = Join-Path $Staging 'source.zip'
    $Source = Join-Path $Staging ('Product-Insights-' + $Pin)
    Write-Host "Downloading reviewed GitHub revision $Pin ..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri "https://codeload.github.com/KaranBarua01/Product-Insights/zip/$Pin" -UseBasicParsing -OutFile $Archive -TimeoutSec 180
    Expand-Archive -LiteralPath $Archive -DestinationPath $Staging
    Invoke-Checked node.exe @((Join-Path $Root 'verify-runtime.mjs'),$Source)
    Move-Item -LiteralPath $Source -Destination $Repo
    Remove-Item -LiteralPath $Staging -Recurse -Force
    $Staging = $null
  }
  Invoke-Checked node.exe @((Join-Path $Root 'verify-runtime.mjs'),$Repo)
  $needBuild = !(Test-Path -LiteralPath $Marker) -or !(Test-Path -LiteralPath (Join-Path $Repo 'Scrappers\dist\engine.js')) -or !(Test-Path -LiteralPath (Join-Path $Repo 'engine\pattern-systems\dist\parse.js')) -or !(Test-Path -LiteralPath (Join-Path $Repo 'engine\pattern-systems\dist\patterns.js'))
  if (!$needBuild) {
    try { $Ready = Get-Content -LiteralPath $Marker -Raw | ConvertFrom-Json; $needBuild = $Ready.revision -ne $Pin } catch { $needBuild = $true }
  }
  if ($needBuild) {
    # No Chromium, global package, Cloudflare deployment, or credentials needed.
    foreach ($Module in @('engine\pattern-systems','Scrappers')) {
      Write-Host "Installing and building $Module ..."
      Push-Location -LiteralPath (Join-Path $Repo $Module)
      try { Invoke-Checked npm.cmd @('install','--omit=optional','--no-audit','--no-fund'); Invoke-Checked npm.cmd @('run','build') } finally { Pop-Location }
    }
    Acquisition-Tests
    Local-Tests
    Invoke-Checked node.exe @((Join-Path $Root 'runtime-smoke.mjs'),$Repo)
    @{revision=$Pin;release='phase4-unified-v04-base';verifiedAt=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress | Set-Content -LiteralPath $Marker -Encoding ASCII
  } elseif ($Mode -eq 'verify') {
    Acquisition-Tests
    Local-Tests
    Invoke-Checked node.exe @((Join-Path $Root 'runtime-smoke.mjs'),$Repo)
  } elseif ($Mode -eq 'benchmark') {
    # Rerun the cancellation regression before every new live retest.
    Invoke-Checked node.exe @('--test','benchmark/pinned-fetch.test.mjs')
  }
  $Guard.Dispose(); $Guard = $null
  if ($Mode -eq 'verify') { Write-Host 'All selected regression tests passed.' -ForegroundColor Green; exit 0 }
  if ($Mode -eq 'benchmark') {
    $Results = Join-Path $Root 'benchmark-results'
    New-Item -ItemType Directory -Path $Results -Force | Out-Null
    $Output = Join-Path $Results ('failed34-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,6))
    Write-Host 'Retesting only the original 34 zero-evidence companies. Technical failures first. No AI, OCR or browser in this benchmark.'
    Write-Host 'Results checkpoint after each company. Ctrl+C stops this test.'
    Invoke-Checked node.exe @((Join-Path $Root 'benchmark\run-failed34.mjs'),$Repo,$Output)
    Write-Host ('Share this summary: ' + (Join-Path $Output 'summary.json')) -ForegroundColor Green
    exit 0
  }
  if ($Mode -eq 'agent') {
    Write-Host 'Only enable the legacy fixed-action queue agent if the original v0.8 agent is stopped.' -ForegroundColor Yellow
    $confirm = Read-Host 'Have you stopped every other PI-Agent-Queue runner? [y/N]'
    if ($confirm -notmatch '^(y|yes)$') { throw 'Queue agent not started. Use START_LOCALHOST.bat for local-only mode.' }
    $queueToken = $inheritedToken
    if ([string]::IsNullOrWhiteSpace($queueToken)) {
      $secure = Read-Host 'Existing private PI-Agent-Queue token (hidden input)' -AsSecureString
      $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
      try { $queueToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    }
    if ([string]::IsNullOrWhiteSpace($queueToken)) { throw 'No queue credential supplied. Use START_LOCALHOST.bat for local-only mode.' }
    $env:PI_AGENT_GITHUB_TOKEN = $queueToken
    Remove-Variable queueToken,secure -ErrorAction SilentlyContinue
  }
  Remove-Variable inheritedToken -ErrorAction SilentlyContinue
  $env:PI_LAB_PORT = '8791'
  Write-Host 'Starting full Local Research Lab on http://127.0.0.1:8791/ ...'
  Invoke-Checked node.exe @('--experimental-sqlite',(Join-Path $Root 'start.mjs'))
} catch {
  Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red
  if ($Output) { Write-Host "Partial benchmark results: $Output" }
  Write-Host 'Original v0.8 installation remains untouched.'
  exit 1
} finally {
  if ($Guard) { $Guard.Dispose() }
  # Only the isolated temporary staging directory created in this run is removed.
  if ($Staging -and (Test-Path -LiteralPath $Staging)) { Remove-Item -LiteralPath $Staging -Recurse -Force -ErrorAction SilentlyContinue }
  Remove-Item Env:\PI_AGENT_GITHUB_TOKEN -ErrorAction SilentlyContinue
}
