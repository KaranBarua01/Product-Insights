# Direct QA and Cloudflare AI connection — Product Insights

## What this adds

The same deterministic QA command works on the presenter's laptop and on GitHub Actions. **It does not require ChatGPT, Cursor, an API key or a live LLM.**

| Mode | Command from `Scrappers/` | Result |
| --- | --- | --- |
| Offline | `npm.cmd run qa:direct -- --mode offline --out qa-results` | Runs the Scrappers test suite; starts a temporary localhost Lab with a four-node disposable taxonomy; checks health, taxonomy parent lookup, review queue and unauthenticated write rejection; saves JSON/HTML. |
| Local health | `npm.cmd run qa:direct -- --mode local --out qa-results` | Checks the existing Lab at `127.0.0.1:8790`, including installed taxonomy, AI-configured flag and local working edition. |
| One live website | `npm.cmd run qa:direct -- --mode local --site https://1up-usa.com/ --out qa-results` | Executes **one explicitly requested**, four-page, auto-strategy acquisition run against the localhost Lab; records page statuses, product leads, gaps and AI status. |

On macOS/Linux use `npm` rather than `npm.cmd`.

Open `Scrappers/qa-results/index.html` in Chrome and inspect `summary.json`. The result categories PASS, PARTIAL, NOT_ASSESSED, NOT_CONFIGURED and FAIL intentionally distinguish a working mechanism from verified intelligence.

### GitHub Actions

The **Direct QA - Product Insights (offline, source-only)** workflow runs when this code is reviewed in a PR to `main`, and can also be started through Actions → Direct QA → Run workflow once the workflow is present on the default branch. It uploads `product-insights-direct-qa` HTML/JSON reports as an artifact. GitHub actions cannot reach your laptop's `127.0.0.1` — local live checks must run **on the laptop itself**.

There are **no CI Cloudflare secrets**, no automatic web crawls and no production deployment in this workflow. On-demand live tests are explicit and bounded to one domain. Site robots/access blocks remain enforced by the Lab.

### Suggested Windows commands

```powershell
cd "$HOME\Projects\Product-Insights"
git fetch origin
git switch feat/acquisition-direct-qa-harness
git pull --ff-only
cd Scrappers
npm.cmd install

# First, deterministic tests, without an AI
npm.cmd run qa:direct -- --mode offline --out qa-results

# Separately, leave the Research Lab running in another PowerShell window
npm.cmd run lab

# From a second PowerShell window opened in Scrappers:
npm.cmd run qa:direct -- --mode local --site https://1up-usa.com/ --out qa-results
```

The local exporter writes **no tokens or raw source HTML** to the QA report. The optional live research run can still add pending taxonomy proposals when AI is connected, as the existing Lab does.

## Cloudflare AI connection: prepared, not yet deployed

The Stage 2 branch already contains Cloudflare Worker routes `/api/stage2/plan`, `/api/stage2/analyze`, `/api/stage2/propose`. They require the **existing Scrappers Worker secret** `SCRAPPERS_API_TOKEN` and the `AI` binding. `/api/stage2/analyze` reuses the existing JS1–JS10 implementation and only accepts bounded, source-quoted proposed product facts. The local Lab is not equivalent to an AI model simply because these routes are present in GitHub.

**Activation gate:** Production deployments for Product Insights must go through private `KaranBarua01/development-controller` with a reviewed, pinned source SHA. The controller's current `deploy-scrappers.yml` still pins an older revision, so the Stage 2 code is **not yet live**. Do not run `wrangler deploy` straight from the public source repository, merge controller changes automatically, or send a secret in chat.

After the controller approves/deploys the reviewed source revision and checks that the AI binding is operational, launch the PC Lab with **both** environment variables:

```powershell
$env:RESEARCH_LAB_AI_URL = "https://product-insights-scrappers-prototype.injindiaops.workers.dev"
$env:RESEARCH_LAB_AI_TOKEN = "<set-privately-to-existing-worker-SCRAPPERS_API_TOKEN>"
npm.cmd run lab
```

Use PowerShell or Windows Credential Manager to load the real secret privately; never paste its value into a GitHub issue, source file, commit, screenshot or chat. On that Lab, the dashboard status should show the AI endpoint is configured, and the **one-site QA report** should independently record the returned `stage2.aiStatus` and `taxonomyProposalStatus`. A configured flag is **not proof** of successful AI inference.

**AI checks that must pass before calling it connected:**
1. Cloudflare Worker health and expected `AI` binding (no secrets printed).
2. An unauthenticated Stage 2 POST receives HTTP 401.
3. An authenticated `/api/stage2/analyze` call using approved public-site excerpts returns a source-quoted JS1–JS10 profile (not `not_configured` or `unavailable`).
4. An AI proposal is only queued after a genuine gap, can be rejected, and is never automatically published.
5. One real-site run from the PC records model results and handles model errors without losing extraction evidence.

### Current limitations

A green QA report validates source-code tests, localhost operation and export. It **does not validate** full catalog coverage or correctness of OEM/manufacturer classifications. The original 1,213-node taxonomy is **not** in this public repository and must be separately installed on each PC. Taxonomy expansion must group models/variants into reusable product families before being treated as a real taxonomy change; the current Stage 2 candidate logic can still overcount SKU gaps. The existing PDF S02 routing, host canonicalization and browser asset issues also remain.

The CI does not have a local Windows laptop or access to the user's private taxonomy. Independent laptop and actual taxonomy acceptance are separate checks.

**Review boundary:** The GitHub Actions QA workflow is a PLATFORM/ACQUISITION cross-lane change. Both owners must review PR #10 before it is merged. No live manufacturer correctness test is triggered by source CI.

## Company intelligence output-quality correction

The Lab now displays a provisional **company role** only when its sampled page contains an explicit self-description; otherwise it reports `unknown`. Source quotes and URLs remain visible, and manufacturer/distributor claims require human review.

Product/SKU leads are preserved, but grouping by exact product name or distinctive model number yields provisional **product families**. Taxonomy candidates and unresolved mappings are now counted per family, not per SKU. A gap remains `gap_or_insufficient_evidence`, never a certified missing category. AI or manual taxonomy proposals now operate on one provisional family with page evidence. The dashboard presents this summary before raw evidence; expand a family to inspect every underlying lead.

The new `research-intelligence.test.mjs` contains deterministic regressions for Aircraft Spruce distribution, 1UP manufacturer evidence, third-party manufacturer exclusion, 25 variants vs five provisional family groups, and website identity-page prioritization. These synthetic tests do **not** replace a real-site, reviewed precision/recall benchmark.

To check laptop intelligence quality, run `npm.cmd run qa:direct -- --mode local --site https://1up-usa.com/ --out qa-results`. The HTML/JSON now include `COMPANY_ROLE`, `FAMILY_GROUPING`, `familyNames` and unresolved family mapping counts. A `PARTIAL` means extracted but **not human validated**.

**Independent real-data check (not live crawling):** A locally provided 25-record Aircraft Spruce export was compared with the user's separate 1,213-node taxonomy reference. With the acronym/model normalization, 25 records form five provisional families (14, 6, 3, 1, 1). None received a lexical taxonomy match. This verifies grouping on a held-out example, not that five taxonomy nodes are missing, nor that the source extraction is complete. The reference file and user export remain local and have not been committed.
