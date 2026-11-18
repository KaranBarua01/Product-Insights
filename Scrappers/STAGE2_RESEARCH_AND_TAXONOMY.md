# Product Insights — Stage 2 Research and Taxonomy Enrichment (prototype)

## Scope and status

This draft builds Stage 2 on the **existing** local Research Lab from PR #8. It keeps **one canonical JS1–JS10 implementation**: `Scrappers/src/js-profile.ts` is reused by the authenticated Cloudflare Scrappers Worker bridge. The PC continues running Playwright/S01/S02/S03 using its existing extraction engine.

**Important:** A merged source PR does **not** configure or deploy the updated Cloudflare Worker. AI inference is only active after a reviewed deployment through `KaranBarua01/development-controller` and configuration of the presenter's PC. All company claims, product leads, taxonomy gap proposals and proposed aliases remain unverified until reviewed.

## What now works locally without Cloudflare AI

- Once the original taxonomy is installed, it loads automatically on restart.
- Product JSON-LD candidates and bounded **product/category page headings** are collected as explicitly unverified leads. A heading is not necessarily a verified SKU; a category is not an individual product.
- Each lead is checked against the installed taxonomy and may yield **requires-review candidate codes** or **gap/insufficient-evidence**. No product lead is not counted as zero gaps — report coverage distinguishes "not assessed".
- The Stage 2 dashboard includes an approval queue. For an unmapped product from a completed research run, a presenter may select **Propose missing category manually**, enter a label, select an existing parent L0–L2, and supply a rationale.
- Proposals are **never auto-published**. Review each proposal; approve or reject it, then click **Publish approved working edition**. The result is a new version stored locally under gitignored `Scrappers/local-data/stage2/`. Original `Scrappers/local-data/installed-taxonomy.json` is unchanged. Versioned snapshots are retained; an export link is provided.
- Published aliases (when the AI proposal route is configured) improve future local candidate matching, but still require classification review. Working-edition nodes use a stable `local_...` code and are **not** globally canonical InsideJob OS codes.

## Turn on Cloudflare Workers AI (optional, needs release review)

**On Cloudflare, after deployment via development-controller**:
- Update the EXISTING `product-insights-scrappers-prototype` Worker from this reviewed source SHA. Do not deploy it directly from this repository.
- Keep the existing `AI` binding.
- Configure the existing `SCRAPPERS_API_TOKEN` secret. The new authenticated POST APIs are `/api/stage2/plan`, `/api/stage2/analyze`, `/api/stage2/propose`.
- These endpoints accept only bounded source-page evidence and taxonomy **candidate code/label choices**; the entire local taxonomy file is never uploaded, and the Worker never crawls the user-provided URLs or directly writes taxonomy records.
- The `analyze` endpoint reuses `buildJsProfile` for JS1–JS10 and separately proposes source-quoted named products/product families.
- `plan` ranks only actual extracted same-host links; it cannot invent a new URL.
- `propose` returns `alias` or `new_node` suggestions from genuine, locally observed gaps and actual taxonomy code choices. Parent and existing codes are checked again by the PC before enqueueing.

**On the presenter's Windows PC, in the PowerShell session that launches the lab**:

```powershell
cd "$HOME\Projects\Product-Insights"
git switch feat/acquisition-stage2-intelligence
git pull --ff-only
cd Scrappers
npm.cmd install
npx.cmd playwright install chromium

# Configure only AFTER the reviewed Cloudflare Worker has been deployed.
# Use the exact deployed HTTPS origin. Never commit the token to Git.
$env:RESEARCH_LAB_AI_URL = "https://YOUR-APPROVED-SCRAPPERS-WORKER.workers.dev"
$env:RESEARCH_LAB_AI_TOKEN = "YOUR-SCRAPPERS-API-TOKEN"

npm.cmd run lab
```

If AI is not deployed, **omit** both environment variables; offline detection, review, and local taxonomy versioning still work. Setting only one variable or using a non-HTTPS endpoint is rejected.

Open `http://127.0.0.1:8790`; keep the console running. Research a permitted public company URL. Inspect evidence/source pages, AI status, JS1–JS10 sections, unverified taxonomy candidates, and the proposal queue.

## Data and privacy

- Local taxonomy files and approved edition snapshots stay in `Scrappers/local-data/` (gitignored).
- When AI is enabled, the PC sends **bounded public source excerpts**, product evidence quotes, and a limited list of existing taxonomy labels/codes to the configured Worker for analysis. It **does not** send the full 1,213-node taxonomy file. Do not point the tool at proprietary or private websites; use only authorized public targets.
- No worker-side D1 database or multi-user approval system is installed. This is a PC-local prototype. Team-wide canonical taxonomy publication requires a separate reviewed migration/provenance process and coordination with the manufacturing workstream.
- Claims have exact source-quote checks but are **not independently verified**. Do not infer supplier qualification, BOM completeness, engineering requirements, an RFQ, or in-house manufacturing capability from a product name alone.
- The local website acquisition engine has the **same known QA limitations** reported on 2026-11-18, including PDF/S02 routing, some canonical hosts, and incomplete dynamic catalogs. Stage 2 does not silently fix these.

## Acceptance testing

```powershell
cd Scrappers
npm.cmd test
```

Tests cover local Stage 2 evidence, candidate mapping, review and publication, master immutability, model quote checks, HTTPS API auth and allowed-link validation. **Only an actual Cloudflare release + live research on the Windows PC can confirm production AI connectivity and website performance.**

Success for this Stage 2 **prototype source PR** means: offline gap → manual proposal → approval → versioned working edition → reload/export, plus testable optional Cloudflare AI planner/JS profile/product proposal/taxonomy enrichment API. It does **not** imply full OS integration or completed 10-company real-world accuracy.

For UI demonstration purposes, the human-reviewed local edition is deliberately labeled **not canonical**. PR validation runs in the source repository; only approved releases of the existing Worker through the development-controller may activate Cloudflare inference.
