# Product Insights — Scrappers (Diode Master Lite V1)

**Status:** prototype source only. No Cloudflare deployment, browser binding, OCR service, or production claim is included.

Three independent extraction strategies and a pattern-aware router live in this folder. They run **after** `engine/pattern-systems/` and produce bounded, evidence-linked *source content*, not manufacturing intelligence or JS1–JS10.

```text
URL + Pattern Systems analysis (optional)
    → access policy (explicit host allowlist, robots.txt)
    → routing decision
       S01  HTTP / HTML / JSON-LD / __NEXT_DATA__ / links
       S02  Cloudflare Browser Run, one optional "Load more" action
       S03  Text PDF, strict byte/page limits
    → extracted content + source locations + attempts + warnings
```

## Components

| Module | What is implemented | Important limitation |
|---|---|---|
| S01 | bounded manual-redirect HTTP, readable text, headings, links, PDF leads, JSON-LD and embedded app state | heuristic HTML parser, not a complete DOM parser or catalog crawler |
| S02 | `@cloudflare/puppeteer` browser binding, same-host request interception, limited interaction and rendered HTML capture | needs Cloudflare Browser Run account/binding; may block third-party JS and some SPA sites |
| S03 | bounded PDF retrieval + `unpdf` digital text extraction with page-level provenance | no OCR or reconstructed table grid; scanned PDFs produce `needs_ocr` |
| Router | consumes Pattern Systems assessment IDs, selects best first strategy and does bounded fallback | heuristic routing; accuracy not benchmarked against real sites |

## Install and run

Node.js 24+ recommended (required by current `unpdf`). Inside `Scrappers/`:

```bash
npm install
npm test
npm run dev
```

Set a secret in `.dev.vars` (do not commit it):

```text
SCRAPPERS_API_TOKEN=choose-a-long-random-local-token
```

Update the explicit `ALLOWED_HOSTS` list in `wrangler.jsonc` to your approved test domains. The sample host is a placeholder. An empty allowlist **rejects all extraction**.

S01 and S03 require no browser binding. To enable S02, add `"browser":{"binding":"MYBROWSER"}` to your Wrangler configuration and use an account with Browser Run support. Cloudflare browser execution may incur costs. Do not deploy without reviewing outbound network policy, plan limits and DNS-level SSRF protections.

### API

- `GET /health` — strategy and binding readiness.
- `GET /api/strategies` — strategy descriptions.
- `POST /api/extract` — requires `Authorization: Bearer <SCRAPPERS_API_TOKEN>`.

Request body (maximum 9 KB):

```json
{
  "url": "https://manufacturer.com/products",
  "mode": "auto",
  "maxPdfPages": 8,
  "patternAnalysis": {
    "assessments": [
      {"patternId":"R01","status":"observed"},
      {"patternId":"R03","status":"lead"}
    ]
  }
}
```

`mode` accepts `auto`, `S01`, `S02`, `S03`. An omitted `patternAnalysis` triggers HTTP-first routing. To connect a deployed Pattern Systems Worker, configure both `PATTERN_API_URL` and `PATTERN_API_TOKEN` as appropriate; this module calls its existing `POST /api/analyze` endpoint. Do not interpret route candidates as proof that an API or interaction works.

Sample command:

```bash
curl -sS http://127.0.0.1:8787/api/extract \
  -H 'Authorization: Bearer choose-a-long-random-local-token' \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://manufacturer.com/","mode":"auto"}'
```

Response includes `schemaVersion`, selected/final strategy, routing rationale, output `content`, source-specific `evidence`, `attempts` and explicit `warnings`. S03 can report `needs_ocr`. No data is stored by this module.

## Pattern-to-route logic

- Direct `.pdf` URL → S03.
- Sparse application shell `R04` + hydration `R07` or Load More `N11` → S02 (when available; otherwise S01).
- Ordinary HTML, JSON-LD `R02`, embedded state `R03` → S01 first; hydration alone does **not** require the browser.
- If S01 discovers a PDF response → S03 (automatic mode only).
- If S01 returns very sparse HTML, optionally try S02 and keep whichever yielded more text.
- No loops, login bypass, CAPTCHA solving, exhaustive pagination, or external-site traversal.

## Testing and known risks

`npm test` runs deterministic fixture tests without network calls. These cover URL policy, robots, redirect bounds, HTML JSON-LD, strategy routing, browser mock, PDF parser mock, fallback behavior and Worker authorization. **They are not live-site accuracy tests.** `S02` requires a separately configured Browser Run environment; `S03`'s actual `unpdf` integration needs dependency installation and a real test PDF before relying on it. Resource limits are conservative but not an exhaustive security boundary; neither the allowlist nor request interception proves DNS destinations are public. Treat as an internal experiment only.

## CLI benchmark prototype (added)

A **sequential 25-site candidate test batch**, JSON/CSV evidence exports, review queue, human-labeled route/keyword accuracy, automated basic usability, elapsed time and explicit limitations are in [`benchmark/README.md`](benchmark/README.md). No UI or cloud deployment is required for the local S01/S03 path; S02 still requires a configured Cloudflare Browser Run Worker.

```bash
npm run benchmark:dry
# Then review the hosts and create benchmark/approved-hosts.txt; see benchmark/README.md.
```

These are **prototype benchmark utilities**, not validated live-site performance. No 25-site live benchmark has been claimed or run by adding these files. Do not conflate sample successes with complete company or catalog coverage.
