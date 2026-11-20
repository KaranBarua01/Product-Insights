# Starts the existing private GitHub Issues Local Agent, with Ollama testing enabled.
# Does not publish a port, store the GitHub token on disk, or execute remote shell commands.
$ErrorActionPreference = 'Stop'
$workspace = Join-Path $env:USERPROFILE 'PI-ollama-queue-agent\Scrappers'
$runner = Join-Path $workspace 'tools\pi-local-agent\agent.mjs'
$modelTest = Join-Path $workspace 'tools\pi-local-agent\ollama-job.mjs'
if (-not (Test-Path -LiteralPath $runner -PathType Leaf) -or
    -not (Test-Path -LiteralPath $modelTest -PathType Leaf)) {
    throw "Ollama Local Agent checkout was not installed at $workspace"
}
Push-Location $workspace
$env:PI_AGENT_WORKSPACE = (Get-Location).Path
$env:PI_AGENT_QUEUE_REPO = 'KaranBarua01/PI-Agent-Queue'
$env:PI_AGENT_ALLOWED_AUTHOR = 'KaranBarua01'
$env:PI_AGENT_ALLOW_OLLAMA_1UP = '1'
$env:PI_AGENT_ALLOW_TESTS = '0'
$env:PI_AGENT_ALLOW_LIVE_10 = '0'
$env:PI_AGENT_ALLOW_DEPTH_7 = '0'
$env:PI_AGENT_ALLOW_PRODUCTS_7 = '0'
$env:PI_AGENT_ALLOW_U30 = '0'
$ptr = [IntPtr]::Zero
try {
    Write-Host 'Product Insights fixed Ollama agent: health + 1UP only.' -ForegroundColor Cyan
    Write-Host 'Private queue: KaranBarua01/PI-Agent-Queue'
    Write-Host 'Laptop model endpoint: http://127.0.0.1:11434'
    Write-Host 'The queue cannot send PowerShell commands or arbitrary URLs.'
    Write-Host 'Keep this window open while you want remote tests. Ctrl+C stops it.'
    Write-Host ''
    $secure = Read-Host 'Paste PRIVATE fine-grained GitHub queue token (hidden input)' -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $env:PI_AGENT_GITHUB_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    if ($env:PI_AGENT_GITHUB_TOKEN.Length -lt 20) {
        throw 'Token missing or too short. No agent started.'
    }
    Remove-Variable -Name secure -ErrorAction SilentlyContinue
    node $runner
}
finally {
    if ($ptr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
    Remove-Item Env:\PI_AGENT_GITHUB_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:\PI_AGENT_WORKSPACE -ErrorAction SilentlyContinue
    Remove-Item Env:\PI_AGENT_QUEUE_REPO -ErrorAction SilentlyContinue
    Remove-Item Env:\PI_AGENT_ALLOWED_AUTHOR -ErrorAction SilentlyContinue
    Remove-Item Env:\PI_AGENT_ALLOW_OLLAMA_1UP -ErrorAction SilentlyContinue
    Remove-Item Env:\PI_AGENT_ALLOW_TESTS -ErrorAction SilentlyContinue
    Remove-Item Env:\PI_AGENT_ALLOW_LIVE_10 -ErrorAction SilentlyContinue
    Remove-Item Env:\PI_AGENT_ALLOW_DEPTH_7 -ErrorAction SilentlyContinue
    Remove-Item Env:\PI_AGENT_ALLOW_PRODUCTS_7 -ErrorAction SilentlyContinue
    Remove-Item Env:\PI_AGENT_ALLOW_U30 -ErrorAction SilentlyContinue
    Pop-Location
}
