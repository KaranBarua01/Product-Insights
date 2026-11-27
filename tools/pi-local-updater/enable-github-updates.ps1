#requires -Version 5.1
param(
 [string]$RootPath = $PSScriptRoot,
 [switch]$TestOnly
)
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($RootPath)
$Pin = '06f3bb6c873d1497c33cec2165313083c08276c7'
$Repo = 'KaranBarua01/Product-Insights'
$Files = [ordered]@{
 'core.mjs'         = 'e175aecf1ab241b7b271f22a3ab91ebb03c12aed'
 'cli.mjs'          = '32e8951ca8d7829c3a8eddd666218d28075b971f'
 'watch.mjs'        = '4b75b5085302b759fa28b531710de5107ec1fe98'
 'bridge-patch.mjs' = '83e642f6c397bdc22b139e0ac5813296ed811acc'
 'core.test.mjs'    = '3546b9281f7799cc11676c47be7ed663e210eaf1'
 'bridge.test.mjs'  = '7593a2e761c70ef1503bb9f4b8e1489a0a1d9d5a'
}
function GitBlobSha1([string]$Path) {
 $bytes = [IO.File]::ReadAllBytes($Path)
 $head = [Text.Encoding]::ASCII.GetBytes("blob $($bytes.Length)" + [char]0)
 $data = [byte[]]::new($head.Length + $bytes.Length)
 [Array]::Copy($head,$data,$head.Length)
 [Array]::Copy($bytes,0,$data,$head.Length,$bytes.Length)
 $hasher = [Security.Cryptography.SHA1]::Create()
 try { return ([BitConverter]::ToString($hasher.ComputeHash($data))).Replace('-','').ToLowerInvariant() }
 finally { $hasher.Dispose() }
}
function CheckedNode([string[]]$ArgList) {
 & node.exe @ArgList
 if ($LASTEXITCODE -ne 0) { throw "Node test/check failed (exit $LASTEXITCODE)" }
}
$staging = Join-Path ([IO.Path]::GetTempPath()) ('pi-bootstrap-'+[guid]::NewGuid().ToString('N'))
$original = @{}
$updated = @()
try {
 $node = (& node.exe -p 'process.versions.node').Trim()
 if ([int]($node.Split('.')[0]) -lt 24) { throw "Node 24+ required (found $node)" }
 if (!$TestOnly) {
  foreach ($path in @('START_WITH_AGENT.bat','START_LOCALHOST.bat','start.mjs','app\queue-agent.mjs','data\knowledge.sqlite')) {
   if (!(Test-Path -LiteralPath (Join-Path $Root $path))) { throw "Not the unified Phase 4 app folder: $path missing" }
  }
  if (Get-NetTCPConnection -LocalPort 8791 -State Listen -ErrorAction SilentlyContinue) { throw 'Stop localhost 8791 (Ctrl+C) before enabling updates' }
 }
 New-Item -ItemType Directory -Path (Join-Path $staging 'updater') -Force | Out-Null
 foreach ($name in $Files.Keys) {
  $url = "https://raw.githubusercontent.com/$Repo/$Pin/tools/pi-local-updater/$name"
  $dest = Join-Path (Join-Path $staging 'updater') $name
  Invoke-WebRequest -Uri $url -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 45 -OutFile $dest
  if ((GitBlobSha1 $dest) -ne $Files[$name]) { throw "Pinned code hash mismatch: $name" }
 }
 Write-Host 'Verified all six GitHub updater modules against pinned Git blob IDs.'
 CheckedNode @('--check',(Join-Path $staging 'updater\core.mjs'))
 CheckedNode @('--check',(Join-Path $staging 'updater\cli.mjs'))
 CheckedNode @('--test',(Join-Path $staging 'updater\core.test.mjs'),(Join-Path $staging 'updater\bridge.test.mjs'))
 if ($TestOnly) { Write-Host 'GitHub updater source retrieval and offline tests passed.'; exit 0 }
 $target = Join-Path $Root 'updater'
 if (!(Test-Path -LiteralPath $target)) { New-Item -ItemType Directory -Path $target -Force | Out-Null }
 foreach ($name in $Files.Keys) {
  $dest = Join-Path $target $name
  if (Test-Path -LiteralPath $dest) {
   $original[$dest] = [IO.File]::ReadAllBytes($dest)
   # Only allow known downloaded content or a previously installed release copy.
   if ((GitBlobSha1 $dest) -ne $Files[$name]) { throw "Unknown existing updater file: $name; refusing overwrite" }
  }
 }
 foreach ($name in $Files.Keys) {
  $dest = Join-Path $target $name
  if (!(Test-Path -LiteralPath $dest)) { $original[$dest] = $null }
  Copy-Item -LiteralPath (Join-Path (Join-Path $staging 'updater') $name) -Destination $dest -Force
  $updated += $dest
 }
 # Only the known patched Phase 4 local agent is supported. Back up before writing.
 foreach ($relative in @('app\queue-agent.mjs','start.mjs')) {
  $path = Join-Path $Root $relative
  $original[$path] = [IO.File]::ReadAllBytes($path)
  $updated += $path
 }
 Push-Location -LiteralPath $Root
 try {
  CheckedNode @('--input-type=module','-e',"import {installBridge} from './updater/bridge-patch.mjs'; const result=await installBridge(process.cwd()); console.log(JSON.stringify(result));")
  CheckedNode @('--experimental-sqlite','--test','engine/test.mjs','tests/integration.test.mjs','tests/queue-agent.test.mjs','tests/acquisition-phase4.test.mjs','benchmark/pinned-fetch.test.mjs')
 } finally { Pop-Location }
 $common = @'
@echo off
setlocal
cd /d "%~dp0"
node.exe "%~dp0updater\cli.mjs" auto "%~dp0"
if errorlevel 1 echo Update channel unavailable; continuing installed version.
node.exe "%~dp0updater\cli.mjs" activate-if-staged "%~dp0"
if errorlevel 1 (echo A staged update could not be verified. Application not started. & pause & exit /b 1)
'@
 foreach ($mode in @('AGENT','LOCALHOST')) {
  $name = "START_GITHUB_$mode.bat"
  $dest = Join-Path $Root $name
  $original[$dest] = if (Test-Path -LiteralPath $dest) { [IO.File]::ReadAllBytes($dest) } else { $null }
  $launcher = if ($mode -eq 'AGENT') { 'START_WITH_AGENT.bat' } else { 'START_LOCALHOST.bat' }
  $text = $common + "`r`n" + 'call "%~dp0' + $launcher + '"' + "`r`n" + 'exit /b %ERRORLEVEL%' + "`r`n"
  [IO.File]::WriteAllText($dest,$text,[Text.Encoding]::ASCII)
  $updated += $dest
 }
 Write-Host 'GitHub updater connected. Remote fixed actions: update_status, update_check, update_stage.'
 Write-Host 'Use START_GITHUB_AGENT.bat or START_GITHUB_LOCALHOST.bat from now on.'
} catch {
 foreach ($file in $updated) {
  if ($null -eq $original[$file]) { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue }
  else { [IO.File]::WriteAllBytes($file,$original[$file]) }
 }
 Write-Host ('Update bootstrap failed: '+$_.Exception.Message) -ForegroundColor Red
 throw
} finally {
 if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue }
}
