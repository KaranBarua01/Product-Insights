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
4. **First run only:** Expand **Install or replace taxonomy (one time per PC)** and choose the original `OEM Industry Taxonomy Explorer.html` or JSON file. The Lab validates its hierarchy and saves only normalized nodes in `Scrappers/local-data/installed-taxonomy.json` (automatically ignored by Git). On subsequent starts, it loads the installed taxonomy automatically; no more file selection is needed. The UI visibly reports genuine initialization, level counts and a local version hash. **Do not commit the taxonomy to the public repository.**
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
- Install the original taxonomy locally as JSON or the uploaded explorer HTML **once**, store normalized nodes on the presenter's PC (never Cloudflare/GitHub), automatically load and integrity-check it after restart, and show the real installed version in the UI. Return **unverified lexical code candidates** and honest gaps; a lexical match is not an approved L3 assignment.
- JSON download with per-page source, strategy, status, observed text, structured product candidates, mapping suggestions and limitations.
- No remote account, AI subscription, secret or Cloudflare deployment required for this first slice. **Exception:** the explicitly installed taxonomy is persisted locally so the presenter does not upload it for every run. Research results remain in memory until exported.

## What this does NOT yet do

- It does not match ChatGPT's deeper model-driven research. JS1–JS10 Workers AI remains in the separate existing Cloudflare prototype. Local AI provider integration, adaptive follow-up questions, complex SPA workflows, visual screenshots, CSV comparison, human-label scoring, component graph and reproducible 10-company assessment are **next increments**, not implemented here.
- It is **not a verified catalog**, automated supplier qualification, process-inference engine or InsideJob OS integration.
- Playwright's existing route policy permits only the exact approved host. Sites requiring cross-host JS/CDN assets may show incomplete content. Never weaken host checks merely to improve a demo.

## Security constraints

- Always run on the presenter's PC. The server binds to `127.0.0.1` only, uses a random session token for browser POSTs, checks Host/Origin, and serves no CORS policy.
- Public DNS preflight blocks known private/reserved IP results, but **it does not pin DNS** throughout HTTP fetches or Chromium, so DNS rebinding is still a risk. **Do not expose this tool on a LAN, public interface or arbitrary remote-user endpoint** until a network-level public-only egress sandbox and tests have been implemented.
- Only research websites the presenter is authorized to access. Respect robots.txt and website terms; stop on 429/access challenges. The browser does not bypass authentication or CAPTCHA.
- Do not enter secrets, personal accounts, private IP addresses or internal websites. Do not use the same browser context as a signed-in employee session. Website evidence is untrusted data.
- The installed taxonomy is **persistent on this PC only**, saved in gitignored `Scrappers/local-data/`; the server does not send it to Cloudflare, and the UI does not falsely claim a network upload. Research reports are transient until explicitly saved/exported. The source file is not automatically trusted as an independently verified ontology.

## Demonstration script for Manuel

1. Show benchmark company **Baja Designs**, then switch to **a new, unlisted public manufacturer** to prove the domain is not hardcoded.
2. Select **Chromium on every page / Visible Chrome window** and demonstrate the real browser. Use lower page budget for a fast demonstration.
3. Inspect extracted product evidence and download JSON. Show source pages directly; if a site is blocked, explain the clear failure state instead of attempting a bypass.
4. Show the taxonomy initialization panel: the **previously installed** L0–L3 explorer is loaded, validated and ready with a real checksum (no manual upload on demo day). Then show unverified code suggestions versus taxonomy gaps.
5. Explain the remaining roadmap: source-linked AI JS1–JS10 → reviewed product/component evidence → Patricio's deterministic Python inference → synthetic supplier compatibility, after an agreed integration contract.

**Success criterion for this PR:** localhost UI runs, a new permitted public domain can be researched without editing `ALLOWED_HOSTS`, headful Chromium is a selectable option, bounded evidence JSON and taxonomy candidates are exportable, and tests cover domain boundaries, HTML taxonomy parsing, JSON-LD product candidates, DNS rejects and planning.

## November 18 live QA findings (not yet fixed in this taxonomy-install change)

Independent local browser QA reported 67/67 Scrappers tests and 24/24 Pattern Systems tests passing, but only one JSON-LD product lead across the ten four-page website runs. Significant research limitations remain: JSON-LD-only product discovery, some canonical redirects failing exact-host allowlists, PDFs being opened with S02 rather than routed to S03 under forced browser mode, and irrelevant links consuming page budget. Site robots 403/non-text errors are access-policy blocks, **not proof** that a robots Disallow rule applies. Taxonomy auto-installation fixes repeat manual upload and provenance visibility only; it does not repair these extraction or completeness failures. Keep the Manuel demo labeled experimental until live site results are revalidated.

### Updating an already-running Windows lab

The existing Research Lab process will not automatically replace its running code when a GitHub branch changes. Stop it with **Ctrl+C**, then:

```powershell
cd "$HOME\Projects\Product-Insights"
git switch feat/acquisition-local-research-lab
git pull --ff-only
cd Scrappers
npm.cmd run lab
```

The updated taxonomy panel shows **Checking installed taxonomy on this PC**, then the **actual** validated node count and a checksum. If you used the old memory-only upload before this update, install the explorer **one final time** using the expandable one-time installation control. After that, the normalized taxonomy is stored in gitignored `local-data/installed-taxonomy.json` and loaded on every restart. The UI demonstrates authentic local initialization, not a simulated upload to Cloudflare.

The local research app's full browser integration is still a prototype; a successful taxonomy initialization does not establish company research accuracy.
