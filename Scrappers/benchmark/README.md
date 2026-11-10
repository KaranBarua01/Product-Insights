# Scrappers V1 — command-line extraction benchmark

This is a **prototype evaluator**, not a production scraper, a crawler, or a JS1–JS10 company intelligence system. It tests the existing three scraper strategies and router on a bounded list of industrial websites. The batch contains **25 candidates** (7 from the Pattern Systems human-review test plan and 18 exploratory industrial examples). Website ownership, official domain mapping, permissions, robots policies and current accessibility **must be independently reviewed before live execution**.

## Outputs

Each benchmark creates a local folder containing:

| File | Contents |
|---|---|
| `summary.json` | Counts, strategy accuracy for human-labeled cases, usable-content rate, timing, goals and limitations |
| `results.json` | Per-site full Scrappers response, content, evidence, routing and evaluation |
| `results.csv` | One sortable row/site with status, patterns, route, text volume, evidence and manual scores |
| `attempts.csv` | Every S01/S02/S03 attempt with duration and failure reason |
| `review_queue.csv` | Sites missing manual labels or failing basic usability / verified expectations |
| `labels_to_review.csv` | Generated **only when `--labels` is omitted**. Blank review sheet to fill after manual inspection |

Local reports are gitignored by default.

## Prepare the batch (NO UI needed)

From repository root:

```bash
cd engine/pattern-systems && npm install && npm run build
cd ../../Scrappers && npm install
```

Inspect `benchmark/sites.example.csv`. The CSV requires `site_id,url`; optional `company_name,note` columns are provided. Max 30 sites per run, sequential, no recursive crawling.

Review every hostname and its permitted use, then explicitly approve only appropriate hosts:

```bash
cp benchmark/approved-hosts.example.txt benchmark/approved-hosts.txt
# edit benchmark/approved-hosts.txt, removing any host not approved
npm run benchmark:dry
```

`benchmark:dry` validates the sample list using the **example allowlist** solely for structural preflight. It **does not** establish site ownership, grant permission or make network requests. For an actual live run, use your edited `benchmark/approved-hosts.txt`.

## Run S01 + S03 locally

```bash
npm run benchmark -- \
  --sites benchmark/sites.example.csv \
  --allow-hosts benchmark/approved-hosts.txt \
  --pattern-mode local \
  --delay-ms 2000 \
  --out benchmark/results/run-001
```

`--pattern-mode local` imports the compiled existing Pattern Systems library and samples at most **2 pages per website**. Pattern results are passed to the Scrappers router; if classification fails, that site's extraction falls back to conservative HTTP-first routing with an explicit error. S01 and S03 can run locally after dependencies are installed. **S02 can execute on Node via the optional Playwright adapter.** Install Chromium and add `--browser playwright` to the local command. Without it, S02 is unavailable and auto mode retains its HTTP fallback.

If the Pattern Systems library has not been built, build it as shown above, or use `--pattern-mode none` to test extraction without pattern-assisted routing. `none` does **not** validate the full Pattern → Router workflow.

## Test all three strategies via a generic Node or Cloudflare HTTP API

Run the portable Node extraction API (`npm run serve`) or the optional Cloudflare Worker with approved `ALLOWED_HOSTS` and an API token. Configure Playwright or an equivalent browser adapter on that server to use S02. Then:

```bash
export SCRAPPERS_API_TOKEN='your-worker-token'
npm run benchmark -- \
  --sites benchmark/sites.example.csv \
  --allow-hosts benchmark/approved-hosts.txt \
  --pattern-mode local \
  --extract-api https://your-authorized-api.example.com \
  --out benchmark/results/worker-run-001
```

Optional deployed Pattern Systems variant: `--pattern-mode api --pattern-api https://your-pattern-worker.example.workers.dev` with `PATTERN_API_TOKEN` set. No secrets are stored in results. `https` is required except explicitly supplied loopback endpoints for local development. Requests use bounded timeouts and response sizes.

**Never expose an arbitrary-URL Worker publicly** without DNS/private-network SSRF controls, egress restrictions, authentication, and independent security testing. A host allowlist and robots checks alone are not a complete defense.

## Manually review and score results

Copy `benchmark/labels.template.csv` to `benchmark/labels.csv` (gitignored), inspect evidence for each site, and mark `reviewed=yes` **only when a human has verified its expected route and/or required content**. Label columns:

- `expected_initial_strategy`: first *optimal* S01, S02 or S03 choice based on target page and desired information. First-route scoring is distinct from final fallback strategy.
- `acceptable_final_strategies`: pipe-delimited alternatives such as `S01|S02` (optional).
- `expected_status`: expected engine outcome, not an assumption that the site must be accessible (optional).
- `required_terms`: pipe-delimited **source-observed** exact terms expected in extracted text, e.g. `pump|iron|machining`; omit until manually checked.
- `min_text_chars`: optional site-specific lower bound; unreviewed rows do not alter scoring.
- `reviewed`: `no` by default. Unreviewed websites NEVER count as route-accuracy successes or failures.

Rerun with `--labels benchmark/labels.csv` to compute labeled outcomes:

```bash
npm run benchmark -- \
  --sites benchmark/sites.example.csv \
  --allow-hosts benchmark/approved-hosts.txt \
  --labels benchmark/labels.csv \
  --pattern-mode local \
  --out benchmark/results/labeled-run-001
```

## Metrics (do not overinterpret)

- **Basic usability rate** = `status=completed` AND extracted text >= minimum length AND at least one evidence record. Denominator is sites not marked `blocked`. **This is not a full product-catalog coverage measure.**
- **Routing accuracy** = correct *initial* strategy divided by manually labeled sites that have an expected initial strategy. If none are labeled, it is `null` (**not 0%**). Final-fallback strategy has a separate optional score.
- **Keyword recall** = source-verified required terms found in extracted text / required terms, computed only on explicitly reviewed rows.
- **Latency** = per-site wall clock and per-attempt timings, not network/server processing decomposition.
- **Costs** = `null`; no billing telemetry is collected. Never treat attempted calls as monetary cost estimates.
- **Targets** = 90% basic usability on non-blocked sites, 85% labeled first-route accuracy. These are proposed experiment thresholds, not a claim of achievement.

Do not infer that 403/robots blocks can be bypassed, that PDF links were downloaded, or that extracted general engineering data proves a company's manufacturing capability or purchasing needs.

## Helpful CLI commands

```bash
npm run benchmark -- --help
npm run benchmark:dry
npm test
```

The code is under `tools/benchmark.mjs` (CLI) and `tools/benchmark-lib.mjs` (CSV, evaluation, artifacts). Fixture tests live in `tests/benchmark.test.mjs`. No dashboard or database is required.

## Portable Node / Docker mode (V1.1)

The scraper core, Node API, Docker image, and Playwright adapter now run independently of Cloudflare. `--worker-url` remains a backward-compatible alias for `--extract-api`; use `--extract-api http://127.0.0.1:8787` for the portable Node service. Set `SCRAPPERS_API_TOKEN` for either API. See `../deploy/README.md` for service startup and safe defaults.

For locally rendered S02, install Chromium once with `npx.cmd playwright install chromium` on Windows (or `npx playwright install chromium` on Linux/macOS), then add `--browser playwright`. For a trusted remote browser endpoint, set `PLAYWRIGHT_CDP_URL`; the same flag is used. `--html-pages 1..4` controls shallow internal-page discovery on local execution. Cloudflare-specific tooling is not installed by default.

The first Dometic benchmark failed above the pattern detector's 512 KB cap; that detector remains a separate limitation. S01 now salvages bounded HTML prefixes (and marks them partial), but **no live-site accuracy gain has yet been established**. The ConnectDER robots HTTP 429 remains a required stop. Re-run the three-site test, inspect `results.json`, and manually label claims before reporting extraction accuracy.
