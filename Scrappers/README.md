# Product Insights — Scrappers V1.1 (portable prototype)

**Primary runtime: Node.js 24+ on Windows, Linux, macOS, Docker or any suitable VPS.** The three scraper strategies are independent of Cloudflare. Cloudflare Worker/Browser Run remains an optional adapter, not a required server or dependency.

```text
Approved website URL + optional Pattern Systems assessments
  -> host allowlist + robots.txt
  -> pattern-informed router
      S01: bounded HTTP/HTML + JSON-LD + app state + relevant same-host page samples
      S02: optional Playwright on Node or remote Chromium CDP (Cloudflare optional)
      S03: PDF digital-text extraction; scanned documents flagged needs_ocr
  -> evidence-linked structured content + sampled URLs + attempts + warnings
```

## Install and test locally (PowerShell)

From `Scrappers/`:

```powershell
npm.cmd install
npm.cmd test
npm.cmd run benchmark:dry
```

The dry run makes **zero network requests**. Live benchmarks require an explicitly reviewed `benchmark/approved-hosts.txt` and a site CSV. Build the adjacent Pattern Systems module first for `--pattern-mode local`:

```powershell
cd ..\engine\pattern-systems
npm.cmd install
npm.cmd run build
cd ..\..\Scrappers
```

## Run a first three-site test on your own server/PC

```powershell
# Needed once for Playwright-backed S02 (optional for S01/S03):
npx.cmd playwright install chromium

# Review the exact hosts and permissions first; then:
npm.cmd run benchmark -- --sites benchmark/sites.first3.csv --allow-hosts benchmark/approved-hosts.txt --pattern-mode local --browser playwright --html-pages 3 --delay-ms 2000 --out benchmark/results/portable-v11
```

Omit `--browser playwright` if you do not have Chromium installed; S02 then reports unavailable and the router uses its HTTP fallback. A remote browser service can be configured using `PLAYWRIGHT_CDP_URL` with the same CLI flag.

The CLI can alternatively call **any compatible HTTP API**, not only Cloudflare:

```powershell
$env:SCRAPPERS_API_TOKEN = "your-service-token"
npm.cmd run benchmark -- --sites benchmark/sites.first3.csv --allow-hosts benchmark/approved-hosts.txt --pattern-mode local --extract-api http://127.0.0.1:8787 --out benchmark/results/http-service
```

`--worker-url` remains a backward-compatible alias of `--extract-api`. The HTTP endpoint must be HTTPS except for localhost loopback.

For standalone API server setup and Docker examples, see [`deploy/README.md`](deploy/README.md). The Node API uses `POST /api/extract`, `GET /health`, `GET /api/strategies` with the same response contract as the optional Cloudflare Worker.

## What improved over V1

- S01 can recover **up to three** targeted same-host content pages from observed links rather than reading only a homepage. It keeps page-level source records and deduplicates repeated text.
- Large HTML responses are handled as **bounded partial samples**, explicitly marked `truncated`. A truncated response is not silently called complete. PDF and robots responses retain strict byte limits.
- S02 browser execution is now injected. The portable implementation uses Playwright and Chromium locally or a remote CDP connection. Off-host requests, forbidden robots paths, downloads and service workers are blocked by the adapter.
- New Node HTTP server and minimal Docker image support deployment beyond Cloudflare.
- Default npm dependency graph no longer includes `@cloudflare/puppeteer` 1.x or Wrangler. Run `npm.cmd install` and `npm.cmd audit --omit=dev` locally to verify that your **actual installed** dependency tree is clear of the previously reported advisories; the audit cannot be certified from fixture testing.
- The benchmark still produces JSON, CSV, attempt history, and manual review queue. Accuracy remains **unmeasured until humans label the expected extraction method and content**.

## Important limitations

- This is an internal prototype, not a production crawler, AI JS1–JS10 enrichment, or OS integration.
- `robots.txt` HTTP 429 (ConnectDER in the first trial) must remain blocked; no bypass is performed.
- Pattern Systems still has a separate 512 KB sample limit. If that detector fails on a large page, the extraction runner records the error and defaults to HTTP-first; it does not invent patterns.
- Shallow HTML heuristics do not prove product completeness. Browser adapters require real-world validation and optional Chromium installation. PDF integration requires a real-document test; scanned pages still need OCR.
- No DNS-pinned public-only egress policy yet: exact host allowlists **do not fully prevent SSRF/DNS rebinding**. Do not expose arbitrary-site extraction publicly without network controls.
- Large HTML and multi-page sampling improve diagnosability, not guaranteed extraction quality. Live tests on three candidate sites reported S01 and S02 completed on Saginaw and Dometic, while ConnectDER remained blocked by robots.txt HTTP 429. These results do not establish catalog completeness, S03 live behavior, or labeled routing accuracy.

**Cloudflare deployment:** See [the repository Cloudflare setup guide](../CLOUDFLARE_SETUP.md) for PowerShell login, deploying Pattern Systems and Scrappers Workers, configuring secrets, optional Browser Run Quick Actions, and connecting GitHub Builds. `wrangler` is a development dependency; the Node/Playwright runtime is unchanged. The first Cloudflare deployment has not yet been performed or verified.

## Internal Pattern Systems calls on Cloudflare

For Cloudflare Workers in the same account, public `workers.dev` Worker-to-Worker fetches may return HTTP 404. The Scrappers Worker now prefers an optional `PATTERN_SERVICE` **Service Binding**, with the existing `PATTERN_API_TOKEN` authentication; see [`CLOUDFLARE_SETUP.md`](../CLOUDFLARE_SETUP.md#4-connect-pattern-systems-to-scrappers-using-a-service-binding). Add the binding to your already customized **local** `wrangler.jsonc`, preserving your approved hostnames. The Node/Playwright engine and public HTTPS fallback remain unchanged.
