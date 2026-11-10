# InsideJob — Website Pattern Systems V1

**Scope:** Research the *observable technical patterns* of industrial websites. This is **not** Diode Master, a complete crawler, Product Insights JS1–JS10 enrichment, or a manufacturing-intelligence service.

## What is implemented

- Research-derived, versioned library: **34 provisional website patterns**, **6 framework/technology indicators**, **10 research methods** (methods excluded from website frequency counts).
- Safe-by-default, bounded website sampling (1–5 HTML pages per website, up to 512 KB each), robots access checks, same-host sample discovery, conservative redirect handling, and URL restrictions.
- HTML signals for categories, product families, search, pagination, forms, filters, PDFs, structured JSON-LD, application state, regions, capability pages, and technology fingerprints.
- Multi-label evidence assessments: `observed`, `lead`, `not_observed` in sampled HTML, and `not_assessed`. A link or JS asset is not a verified product, working interface, or backend API.
- Flag unfamiliar embedded catalog behavior for **review**, not automatic canonical promotion.
- Frequency ranking with clear denominators; repeated host submissions deduplicated.
- Cloudflare Worker API, minimal browser-accessible form, optional Cloudflare D1 persistence, JSON and CSV matrix outputs, local CSV runner, and fixture-based tests.

**Limitations:** HTML analysis uses bounded structural heuristics rather than a complete DOM/browser. Deep client-side interactions, complete catalog enumeration, PDF text/OCR, DNS-to-private-IP validation, cross-host crawling, and production-scale queues are **not implemented**. Those are research gaps, not falsely claimed successes. Browser Run is intentionally not bound or billed in V1.

## Folder

All project code is under `engine/pattern-systems/` to avoid changing other Product Insights components.

## Run locally

Node.js 22+ is recommended. From this folder:

```sh
npm install
npm test
npm run dev
```

Wrangler dev starts the Worker locally. Visit the URL printed by Wrangler. The API will require a secret; create `.dev.vars` with:

```
PATTERN_SYSTEM_API_TOKEN=replace-with-a-strong-local-token
```

Do **not** commit `.dev.vars`. Use `npx wrangler secret put PATTERN_SYSTEM_API_TOKEN` for a real deployment. Deployment was **not** performed as part of this deliverable.

Run a small CSV locally (outside Cloudflare) after `npm run build`:

```sh
node tools/run-local.mjs data/example-websites.csv ./my-pattern-results
```

CSV must contain a URL (with `http://` or `https://`) in the first column, or a header column `url`, `website`, or `domain`. Optional company headers: `company_name`, `company`, `name`. The local runner processes sites sequentially; this is not an unlimited bulk crawler.

## HTTP API

`GET /health`: detector coverage and binding readiness.

`GET /api/patterns`: read-only pattern catalog (includes methods as **non-pattern** reference entries).

`POST /api/analyze` (Bearer token): `{"url":"https://www.example-industrial.com/","companyName":"Example","maxPages":3}`. Returns one bounded assessment plus evidence and errors.

`POST /api/batch` (Bearer token): `{"websites":[{"url":"https://...","companyName":"..."}],"maxPages":2}`. Maximum **three** sites per request; returns combined summary immediately. Use client-side chunking or the local CLI for larger CSVs.

`GET /api/runs`, `GET /api/runs/:id`, `GET /api/report?format=json|csv` (Bearer token): require optional D1 binding. `report` aggregates up to 500 most recent saved runs and deduplicates by hostname.

If D1 is not configured, analysis works but results are returned in the response rather than retained. Exports are available immediately from the local CLI or a batch response.

## Optional D1 setup

1. Run `npx wrangler d1 create insidejob-patterns` and copy the **real** database ID into a `d1_databases` binding in `wrangler.jsonc`. See `wrangler.d1.example.jsonc` for shape, not for deployable credentials.
2. Run `npx wrangler d1 migrations apply insidejob-patterns --local` before local persisted testing.
3. Apply remotely after reviewing database/plan settings: `npx wrangler d1 migrations apply insidejob-patterns --remote`.
4. Configure the API token as a secret, then run `npm run deploy` when authorized.

No cloud account, database, or deployment is created automatically.

## Research interpretation

The seed taxonomy comes from `Diode_Master_Pattern_Deduplication_Audit.xlsx`, which normalized 79 researcher labels from four batches into 34 site patterns, 6 technology signals, and 10 methods. `data/source-crosswalk.csv` preserves the original labels and provenance. This is a **semantic normalization**, not proof that all patterns have been observed across every site.

`observed` = visible signal in sampled source, **not** confirmed complete site behavior. `lead` = link/marker/keyword that needs verification. `not_observed` = no match in sampled pages, **not** absence from the whole site. `not_assessed` = detection requires manual/browser/document study or no appropriate sample.

Frequency: observed / (observed + not_observed), with leads/unassessed excluded. The report exposes all counts. Do not interpret the numbers as a representative market-wide sample or as validated detection accuracy.

## Safety

Requires API token on all mutating/research endpoints, rejects raw IPs and local/private hostnames, blocks cross-host redirects, checks robots before pages, restricts files and total bytes, and samples with small bounded budgets. This is **not** a complete SSRF defense (DNS rebinding/private resolution remains a hardening task). Do not expose it to untrusted arbitrary URLs without a network-egress policy and further testing. Follow applicable access terms and do not bypass anti-bot controls.

See `docs/TEST_PLAN.md`, `docs/RESULTS.md` and `docs/ARCHITECTURE.md`.
