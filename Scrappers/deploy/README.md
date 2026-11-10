# Portable Node server / Docker deployment (prototype)

The extraction engine has no Cloudflare runtime dependency. The host provides:

- S01: a fetch-compatible HTTP client, byte limits, robots checks, same-host discovery.
- S02: optional Playwright browser adapter; launch Chromium locally or connect to an operator-managed remote CDP endpoint.
- S03: `unpdf` for digital PDFs (no scanned-PDF OCR).
- Routing: an optional Pattern Systems analysis object; absence falls back to HTTP first.

## Node.js 24+ on Windows, Linux, macOS or a VPS

From `Scrappers/`:

```powershell
npm.cmd install
npm.cmd test
# Optional S02: download a compatible Chromium browser once
npx.cmd playwright install chromium

$env:ALLOWED_HOSTS = "www.saginawcontrol.com"
$env:SCRAPPERS_API_TOKEN = "choose-a-random-token-at-least-16-characters"
$env:SCRAPPERS_BROWSER = "playwright"   # or none
npm.cmd run serve
```

The HTTP service binds to `127.0.0.1:8787` by default, intentionally not the public network.

```text
GET  /health
GET  /api/strategies
POST /api/extract (Authorization: Bearer <SCRAPPERS_API_TOKEN>)
```

Example PowerShell request to a local Node server:

```powershell
$headers = @{Authorization = "Bearer $env:SCRAPPERS_API_TOKEN"}
$body = @{url="https://www.saginawcontrol.com/";mode="auto"} | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:8787/api/extract -Method Post -Headers $headers -ContentType 'application/json' -Body $body
```

For a hosted browser on an operator-controlled CDP service, set `PLAYWRIGHT_CDP_URL` to its WebSocket endpoint. The Playwright library must be installed locally on the API server, but Chromium can run elsewhere. Do not use arbitrary/user-supplied CDP endpoints.

Optional Node-side pattern sampling: set `SCRAPPERS_PATTERN_MODE=local`, and build `engine/pattern-systems` separately. Its 512 KB HTML sampling limit is still an independent prototype limitation; pattern failures do not prevent conservative HTTP extraction.

## Docker (minimal API)

From `Scrappers/`:

```bash
docker build -f deploy/Dockerfile -t product-insights-scrappers .
docker run --rm --name pi-scrappers \
  -e ALLOWED_HOSTS=www.saginawcontrol.com \
  -e SCRAPPERS_API_TOKEN=replace-with-long-random-token \
  -p 127.0.0.1:8787:8787 product-insights-scrappers
```

The image has no bundled Chromium or browser OS libraries; S01/S03 work if network policy permits, and S02 can use an operator-controlled CDP endpoint. For an embedded browser, build a custom image with Playwright's browser dependencies or use a Playwright-capable base image. The Docker build was authored but not run in the authoring environment.

## Portability and security boundaries

The API, scraper logic, output schema, and benchmark format are platform-independent. Cloudflare's Worker entrypoint is a **separate optional adapter** (`src/worker.ts` + `src/cloudflare-adapter.ts`), and is not required or installed for Node.

**Not production hardened:** explicit host allowlists are required; they do not stop a public DNS hostname resolving to a private IP (DNS rebinding/SSRF). Use outbound egress filtering or a DNS-pinned public-only transport before exposing this service publicly. Restrict API access, keep the Node HTTP API loopback-bound or behind a private reverse proxy, and do not send secrets to logs. Respect robots.txt and HTTP 429; do not bypass anti-bot or login boundaries. Limit cost/requests; browser rendering may download third-party data (this adapter blocks off-host resources, which can reduce rendering accuracy).

S02 browser launch, full PDF integration, and Docker deployment must be tested in their actual environments. Passing mocked fixture tests does not prove live website accuracy.
