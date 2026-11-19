# Product Insights Local Agent — Windows prototype v0.1

**Status:** source-code prototype only. The GitHub PR does not install an agent, grant access to Windows, or create an API credential.

## Architecture

ChatGPT GitHub connector -> PRIVATE GitHub Issues queue -> outbound-only local Node agent -> fixed operation -> private Issue result.

The source code is in the PUBLIC Product-Insights repository. DO NOT use this public repository for job issues, credentials, taxonomy data or logs. Create a separate private queue repository and grant your connected GitHub app access to it.

## Allowed jobs

- health: Node and agent health; no private contents.
- taxonomy_1up: existing offline taxonomy benchmark with fixed input file names.
- taxonomy_cross: same benchmark with cross-industry evidence.
- run_tests: compile and test the existing Scrappers checkout; disabled until PI_AGENT_ALLOW_TESTS=1.

No job may specify a PowerShell command, script path, arbitrary file path or custom flags. Job expiry must be at most 15 minutes. The agent uses only outbound HTTPS to GitHub. It never opens a Windows network port.

## What one folder actually means

Set PI_AGENT_WORKSPACE to the absolute path of the Scrappers folder. Inputs and outputs are in the existing Git-ignored Scrappers/local-data/pi-local-agent directory. Application-level path and realpath checks reject traversal and symlinks pointing outside the workspace.

**A working-directory restriction is NOT an operating-system permission boundary.** Node.js or tests still run with the Windows user's permissions. For true one-folder access, use a separate restricted Windows account or VM with suitable filesystem permissions; NEVER run as Administrator. We have deliberately prohibited arbitrary PowerShell in v0.1.

## Setup outline (Windows, Node.js 24+)

1. Create a separate GitHub repository called PI-Agent-Queue and mark it PRIVATE. Do not create the queue in public Product-Insights. Connect the existing ChatGPT GitHub integration to the private repository if repository access is restricted.
2. Create a fine-grained GitHub token restricted to PI-Agent-Queue with Issues Read and write, Metadata Read. Set a short expiry. NEVER paste the token into chat, public GitHub, or any file committed to source control.
3. Install the agent source from the feature branch in the Scrappers workspace. Until PR #14 merges, the agent branch and the taxonomy matcher branch are independent, so the taxonomy actions will fail unless the current workspace also contains PR #14's taxonomy-benchmark.mjs.
4. From within your chosen Scrappers workspace (for example C:\Users\<user>\PI-taxonomy-test\Scrappers), copy the OEM taxonomy and evidence sources into the already gitignored local-data directory:

    $dir = 'local-data\pi-local-agent\inputs'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Copy-Item "$HOME\Downloads\oem_industry_taxonomy_explorer.html" "$dir\taxonomy.html"
    Copy-Item "$HOME\Documents\Codex\2026-11-19\files-pasted-by-the-user-product\outputs\integration-taxonomy-results.json" "$dir\1up.json"
    Copy-Item '.\qa-results\cross-industry-evidence.json' "$dir\cross-industry.json"

5. Set agent configuration in this PowerShell session (the private repo name below is an example until you create it):

    $env:PI_AGENT_WORKSPACE = (Resolve-Path '.').Path
    $env:PI_AGENT_QUEUE_REPO = 'KaranBarua01/PI-Agent-Queue'
    $env:PI_AGENT_ALLOWED_AUTHOR = 'KaranBarua01'

6. Enter the GitHub token without displaying it in the terminal or storing it in command history:

    $secure = Read-Host 'Private queue token' -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $env:PI_AGENT_GITHUB_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); Remove-Variable secure,ptr -ErrorAction SilentlyContinue }

7. Run a single poll (checks queue privacy and processes only jobs created by the configured owner):

    node tools/pi-local-agent/agent.mjs --once

Or start continuous polling (Ctrl+C stops the agent):

    node tools/pi-local-agent/agent.mjs

8. Ask ChatGPT to create a health job in the private queue. Once the agent posts its result, ChatGPT can read the comment via the existing GitHub integration. There is no PowerShell output to paste manually.

9. After you exit, clear the session token:

    Remove-Item Env:\PI_AGENT_GITHUB_TOKEN

## Issue protocol

Create a PRIVATE GitHub Issue with label pi-local-agent-job, authored by the configured GitHub username, containing exactly this JSON structure with NEW timestamps. The example below is expired on purpose:

    {
      "schemaVersion": "pi-local-agent/job-v1",
      "jobId": "demo_health_001",
      "action": "health",
      "issuedAt": "2026-11-19T10:00:00Z",
      "expiresAt": "2026-11-19T10:10:00Z"
    }

The four allowed action values are health, run_tests, taxonomy_1up, taxonomy_cross. Each issue receives a private JSON summary comment, then closes. Local artifacts remain in Scrappers/local-data/pi-local-agent/outputs. Jobs with invalid schema, identity, expiration, paths or unauthorized actions never execute.

## Scope and limitations

- The agent must be running to handle jobs. It cannot be contacted through this chat until the private queue and token are configured and ChatGPT has been granted access to the new private repo.
- It does not provide arbitrary shell execution, a remote desktop, automatic Git updates, system installation, or production Cloudflare deployment.
- A local interruption does not replay a running operation; inspect the local output and issue a new fresh job.
- Taxonomy labels are proposals requiring review. The agent does not verify OEM category correctness.
- Passwords/tokens do not belong in the public source repository, local evidence JSON, job bodies, or chat messages.

## Opt-in fixed ten-company reality-check benchmark

`benchmark_10` is an additional, explicitly gated operation. It loads `benchmark/insidejob-os-ten-sites.csv` and its ten exact approved hosts and runs the existing `tools/benchmark.mjs` locally, respecting robots.txt, bounded HTML fetch, rate limits and maximum 10 sites. Enable only with `PI_AGENT_ALLOW_LIVE_10=1` in the agent's own Windows session. There are NO parameters for choosing external URLs, changing scripts, introducing model prompts, or publishing results. Site-level statuses, text/evidence counts, and reasons are posted back to the private queue; full artifacts remain in gitignored `local-data/pi-local-agent/outputs/<job-id>-os10` on the PC. It deliberately uses `--pattern-mode none --browser none`, so it measures first-pass local HTML extraction only; this is NOT a full Product Insights end-to-end run, nor a product-accuracy benchmark.

## Explicit opt-in: 3-page versus 12-page source-coverage comparison

Operation `depth_7` is separately disabled unless the Windows agent session sets `PI_AGENT_ALLOW_DEPTH_7=1`. It uses exactly the seven accessible hosts from the first real ten-company InsideJob benchmark: Aircraft Spruce, Hoshizaki America, Abbott Tool, 1UP USA, Flagstone Pavers, Flow Control and CMC Supply. The three blocked hosts are not retried or bypassed.

- One deterministic maximum-12-page `runResearch` trace per site, with the **first three pages of the same trace** forming the comparable baseline.
- Prioritizes identity, relevant product/category links and a same-host technical PDF if discovered. Respects robots, 403/429 access blocks, bounded downloads and rate limits.
- S01 is primary; optional S02 Playwright escalation is attempted only for sparse HTML where the browser is installed, without relaxing access policies. S03 reads permitted PDFs (up to eight pages and 3 MB per PDF).
- Measures unique source pages, on-page product/category leads, published JSON-LD product records, observed technical lines, PDFs discovered/read and retrieved evidence records. These are **not validated product families or specifications**.
- Artifacts stay private under `local-data/pi-local-agent/outputs/<job-id>-depth7/`; the private issue receives a bounded comparison.
- No AI API requests, manufacturing-process inference, supplier matching, unbounded web crawling, remote PowerShell commands or private-taxonomy publication.

Install the branch update on the local Scrappers checkout, opt in via environment variable and restart the agent. Do not place tokens in issue bodies, chat, console histories or public git.

## Product Intelligence Extractor pilot (`products_7`)

`products_7` is a new, separately gated fixed operation. Enable only with
`PI_AGENT_ALLOW_PRODUCTS_7=1` in the Windows agent session and restart that process.
The queue cannot provide custom URLs, files, flags, model prompts or commands.
The operation re-retrieves the same seven previously accessible websites, up to 12 same-host
pages each, respecting robots, exact-host allowlists and bounded time/byte budgets.
It is necessary to re-fetch because prior depth benchmark files contain only metrics
and limited snippets, not complete source page content.

The extractor produces explicit `company -> source category -> source product ->
specifications/components/materials` candidate entities with per-claim quotes and
source URLs. JSON-LD is marked as published structured metadata, and HTML heading
products do not require JSON-LD. The category link relationship is emitted only when
actually observed. Components and materials are not inferred from generic engineering
knowledge. Every field is provisional; seller listings never prove manufacturing.

Full per-source evidence and the report are stored only under
`local-data/pi-local-agent/outputs/<jobId>-products7/`. A bounded summary with
sample candidates, public source URLs and review caveats returns to the PRIVATE
GitHub issue. No private taxonomy, AI secrets, RFQ data, production OS writes, or
manufacturing-process assertions are included. Public GitHub receives code and
synthetic tests only.
