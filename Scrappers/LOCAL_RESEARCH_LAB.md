# InsideJob Product Insights — Local Research Lab (experimental)

**Purpose:** Show a manager an interactive, live research demonstration on an arbitrary **public** company website without changing the deployed Cloudflare Worker allowlist. This is an **acquisition-only** tool, built on existing `dist/engine.js`, `node-browser.mjs` and, optionally, the canonical Pattern Systems build. It does not duplicate Patricio's manufacturing inference or supplier matcher.

## Quick start on Windows PC (PowerShell)

1. Install [Node.js 24+](https://nodejs.org/) and Chrome/Chromium-capable Playwright. Clone the existing Product Insights repository.
2. Open PowerShell in the repository:

```powershell
cd Scrappers
npm.cmd install
npx.cmd playwright install chromium
npm.cmd run lab
```

3. Open **http://127.0.0.1:8790** in your PC browser.
4. Optionally upload your existing `OEM Industry Taxonomy Explorer.html` (or equivalent JSON) using **Load taxonomy**. **Do not commit this file to the public repository.** The data stays in the running lab process's memory.
5. Enter any permissible **public** company website, choose a bounded research budget (1–12 source pages), and run. Use **Chromium on every page + Visible Chrome window** to demonstrate real browser navigation and the existing single "load more" interaction. Use `Auto` for faster HTTP-first exploration. The lab only opens one active research run at a time.
6. Review the source-page table and JSON-LD product candidates. Download the evidence JSON for review.

On macOS/Linux the same `npm install`, `npx playwright install chromium`, `npm run lab` commands apply.

### Optional: Enable the canonical Pattern Systems router

Build Pattern Systems first:

```powershell
cd ../engine/pattern-systems
npm.cmd install
npm.cmd run build
cd ../../Scrappers
$env:RESEARCH_LAB_PATTERN_MODE = 'local'
npm.cmd run lab
```

If the detector is unavailable, the lab continues with the existing conservative Scrappers router and records a warning. To use a different local port, set `$env:RESEARCH_LAB_PORT = '8791'` before starting.

## What is implemented

- PC-local dashboard, research status, cancellation after current page and source evidence report.
- Per-run exact public hostname approval (not restricted to the old benchmark domains), conservative DNS public-address preflight and the **existing** robots/redirect/host checks.
- Bounded research link prioritization, sequential URL exploration and extraction through existing S01/S02/S03 engines. No unrestricted spider or CAPTCHA bypass.
- Optional visible Chromium launch via the **existing** Playwright adapter. Be aware that its safe default blocks off-host assets and that some JavaScript-heavy sites will be incomplete.
- Product *candidates* derived from explicitly published `schema.org/Product` JSON-LD; never label them as reviewed facts.
- Import the original taxonomy locally as JSON or the uploaded explorer HTML. Return **unverified lexical code candidates** and honest gaps. Do not interpret a lexical match as an approved L3 assignment.
- JSON download with per-page source, strategy, status, observed text, structured product candidates, mapping suggestions and limitations.
- No persistent data, remote account, AI subscription, secret or Cloudflare deployment required for this first slice.

## What this does NOT yet do

- It does not match ChatGPT's deeper model-driven research. JS1–JS10 Workers AI remains in the separate existing Cloudflare prototype. Local AI provider integration, adaptive follow-up questions, complex SPA workflows, visual screenshots, CSV comparison, human-label scoring, component graph and reproducible 10-company assessment are **next increments**, not implemented here.
- It is **not a verified catalog**, automated supplier qualification, process-inference engine or InsideJob OS integration.
- Playwright's existing route policy permits only the exact approved host. Sites requiring cross-host JS/CDN assets may show incomplete content. Never weaken host checks merely to improve a demo.

## Security constraints

- Always run on the presenter's PC. The server binds to `127.0.0.1` only, uses a random session token for browser POSTs, checks Host/Origin, and serves no CORS policy.
- Public DNS preflight blocks known private/reserved IP results, but **it does not pin DNS** throughout HTTP fetches or Chromium, so DNS rebinding is still a risk. **Do not expose this tool on a LAN, public interface or arbitrary remote-user endpoint** until a network-level public-only egress sandbox and tests have been implemented.
- Only research websites the presenter is authorized to access. Respect robots.txt and website terms; stop on 429/access challenges. The browser does not bypass authentication or CAPTCHA.
- Do not enter secrets, personal accounts, private IP addresses or internal websites. Do not use the same browser context as a signed-in employee session. Website evidence is untrusted data.
- Taxonomy files and reports are local and transient until the presenter explicitly downloads and saves them.

## Demonstration script for Manuel

1. Show benchmark company **Baja Designs**, then switch to **a new, unlisted public manufacturer** to prove the domain is not hardcoded.
2. Select **Chromium on every page / Visible Chrome window** and demonstrate the real browser. Use lower page budget for a fast demonstration.
3. Inspect extracted product evidence and download JSON. Show source pages directly; if a site is blocked, explain the clear failure state instead of attempting a bypass.
4. Upload the L0–L3 taxonomy explorer and show valid code suggestions versus taxonomy gaps.
5. Explain the remaining roadmap: source-linked AI JS1–JS10 → reviewed product/component evidence → Patricio's deterministic Python inference → synthetic supplier compatibility, after an agreed integration contract.

**Success criterion for this PR:** localhost UI runs, a new permitted public domain can be researched without editing `ALLOWED_HOSTS`, headful Chromium is a selectable option, bounded evidence JSON and taxonomy candidates are exportable, and tests cover domain boundaries, HTML taxonomy parsing, JSON-LD product candidates, DNS rejects and planning.