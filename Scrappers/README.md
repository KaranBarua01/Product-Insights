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

## Company-facing Product Insights demonstration

The deployed Scrappers Worker can serve a company-facing UI at `/demo`. It displays a **recorded and verified** Saginaw integration result without fabricating missing excerpts or pattern IDs; provides a clickable four-stage pipeline; fetches the real pattern catalog over the existing `PATTERN_SERVICE` binding; and supports **authenticated** live analysis of the two approved websites.

- Demo: `https://product-insights-scrappers-prototype.injindiaops.workers.dev/demo`
- To run live: choose **Live analysis**, select Saginaw or Dometic, and enter the existing `SCRAPPERS_API_TOKEN` **privately on the presenter's machine**. The token is used in one same-origin request to `POST /api/extract`, then cleared from the input. No token is stored in localStorage, sessionStorage, cookies, or URLs.
- The UI reports actual pattern IDs, routing provenance/reason, extraction status, strategy attempts, content previews, evidence and warnings. The public recorded view cannot reveal original evidence text because it was not retained in the verification run.
- Live extraction authentication, domain allowlist and robots checks remain unchanged. This is still a prototype: S02/S03 live validation, completeness measurement and OEM/supplier classification remain pending.

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

For Cloudflare Workers in the same account, public `workers.dev` Worker-to-Worker fetches may return HTTP 404. The Scrappers Worker now prefers an optional `PATTERN_SERVICE` **Service Binding**, with the existing `PATTERN_API_TOKEN` authentication; see [`CLOUDFLARE_SETUP.md`](../CLOUDFLARE_SETUP.md#4-connect-pattern-systems-to-scrappers-using-a-service-binding). The binding is now committed in `Scrappers/wrangler.jsonc` for the existing Cloudflare Workers, with two previously tested approved hostnames. GitHub-to-Cloudflare automatic deployment requires the one-time Cloudflare **Settings → Builds → Connect** setup. The Node/Playwright engine and public HTTPS fallback remain unchanged.

## Outcome-first management demo (combined prototype)

The **existing** `product-insights-scrappers-prototype` Worker now serves an outcome-first [management interface](https://product-insights-scrappers-prototype.injindiaops.workers.dev/demo) showing a **sanitized, precomputed snapshot** of Patricio's deterministic Busch R5 RA 0100 F pilot: 16 process hypotheses, 4 components, 2 excluded purchased parts, and compatibility against 10 **synthetic** suppliers. This is not live supplier matching and not evidence of OEM demand or qualification. The original private blueprint fact transcriptions and full reasoning are **not committed** to this public GitHub repository. Every result card opens a side drawer with process codes, fact/rule references, conditions, or per-supplier match explanations. The prior demo remains under `/demo/legacy`.

**Live Cloudflare AI (optional):** The same existing Worker now has an `AI` binding. Authenticated `POST /api/insights/analyze` calls the same allowlisted Pattern Systems -> Router -> Scrappers pipeline as `POST /api/extract`; when `useAI:true`, it then asks Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) for at most five candidate facts with verbatim supporting quotes. Responses are rejected when their quotes do not appear in the extracted text. Surviving candidates remain **unverified** and are **not** passed automatically into Patricio's inference or real supplier data. Using AI can incur metered Cloudflare charges; leaving the checkbox off avoids inference. Failure of AI does not invalidate the scraper result.

**Security:** Public `GET /api/insights/pilot` is a sanitized prototype summary, not original private handoff. `POST /api/insights/analyze` requires `SCRAPPERS_API_TOKEN` and retains the existing exact domain allowlist and robots behavior. Source-level handoff facts and real supplier exports remain unavailable from this public demo. Browser UI does not store the token. Never paste API tokens into shared screenshots or chat.

## Research company test selector (14 exact-host websites)

The outcome dashboard permits **14 exact-host URLs** (original Saginaw and Dometic, plus 12 selected sites whose extraction completed in the 2026-11-12 Node-based 100-website benchmark). The catalog is `Scrappers/src/demo-companies.ts`; the Worker production `ALLOWED_HOSTS` values in `Scrappers/wrangler.jsonc` must exactly match its hostnames, enforced by the demo tests. Research baseline text/evidence counts appear below the selector, explicitly distinguished from live Cloudflare outcomes. Requests remain token-authenticated, limited to the exact listed hosts, and subject to robots.txt, redirects, and access restrictions. No new Worker or browser binding is necessary.

## Evidence-grounded multi-page AI improvements

Live S01 extraction now preserves bounded per-source text sections as well as the combined content output. When Workers AI is enabled, it prioritizes up to three relevant source pages (including product pages), rather than feeding only the first 5,500 characters from the homepage. The model must return a specific numeric source ID and verbatim quote that is present in that source's prompt excerpt. Unsupported or misattributed quotes are rejected. The UI distinguishes an empty model result from unsupported suggestions and reports counts without exposing raw model output. This is still an optional **unverified** fact-proposal step; it does not run Patricio's inference engine or certify suppliers. Live AI uses the existing Cloudflare AI binding and can incur metered inference charges.

## JS1–JS10 Product Insights company intelligence prototype

Product Insights' original JS codes refer to ten logical sections, **not JavaScript or ten databases**. The prototype defines JS1 (company overview), JS2 (product categories), JS3 (products/components), JS4 (materials), JS5 (manufacturing processes), JS6 (actual company capabilities), JS7 (supply chain signals), JS8 (industries/markets), JS9 (differentiators), and JS10 (coverage/evidence report). The definitions and typed output contract live in `Scrappers/src/js-profile.ts`.

An authenticated `POST /api/insights/analyze` with `{"url":"https://www.epcpower.com/","buildProfile":true,"useAI":true}` runs the existing allowlisted scraper and a **single** Workers AI pass for the JS profile. Source quotes must match the correct sampled page; rejected or missing claims are never replaced by fabrications. The existing five-fact AI display is derived from this same profile when both are requested, to avoid double billing. JS10 is generated deterministically from coverage and quote checks, not from AI assertions. Every accepted claim is explicitly **unverified**. The prototype does not persist profiles in D1, resolve canonical InsideJob OS company IDs, infer manufacturing requirements, or verify buyer needs.
