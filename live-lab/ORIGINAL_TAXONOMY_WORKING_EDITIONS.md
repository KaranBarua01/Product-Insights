# Product Insights v1 — code-only foundation and end-to-end prototype

## Decision

**No taxonomy database.** The original 1,213-node taxonomy and its 220 manufacturing-process names / 10,388 draft process relationships live as a local JSON code reference, pinned by an exact file SHA-256. The repository is **public**, so this original reference must remain in the Windows laptop's gitignored `Scrappers/local-data`, not be committed or uploaded as source.

`1,213 nodes` = 8 sectors, 30 industries, 171 systems, 1,004 leaf product/component classes. **All 10,388 process relationships are unreviewed taxonomy priors, not a company's verified manufacturing capabilities.**

### Layers

1. **Original OEM taxonomy:** fixed local JSON, read-only category codes + hierarchy + process associations. The laptop Lab exposes its version/manifest, a code-filtered preview, and an authenticated snapshot endpoint. No AI writes to the original.
2. **Company research:** existing source-grounded local scraper and Qwen3 product enrichment. JS1–JS10 is **company-level only**, never duplicated per SKU.
3. **Relationship graph:** known products, source-mentioned parts/accessories, material mentions, optional Qwen3 **hypothetical** BOM parts, proposed existing-category codes, and possible process requirements from the original code process dictionary or explicitly illustrative shape rules. Every edge remains review-only.
4. **AI working edition:** append-only, gitignored JSON:
   - `local-data/product-insights-working/runs/<sha256>.json`: immutable individual company research graphs and provenance.
   - `local-data/product-insights-working/versions/edition-000N.json`: versioned cross-run candidate-node/relationship indexes.
   - `local-data/product-insights-working/edition-manifest.json`: current accumulated working proposals, source sites and totals.
   No database and no automatic publication to the original taxonomy.
5. **Cloudflare viewer/control plane:** the existing Worker, Durable Object job/session state, authenticated browser and outbound-only laptop bridge. The original node tree and coded process association snapshot are **read-only viewer caches**, not a canonical database. Per-run source research and accumulated working-edition summaries are displayed. Cloudflare does not scrape websites or run the local Qwen3 model.

### Runtime configuration

New isolated source checkout: `%USERPROFILE%\PI-foundation-v1` (via separately supplied, pin-verified Windows launcher). New Lab port `127.0.0.1:8790`; original Lab on 8791 and previous agent worktrees are untouched.

Local Ollama model: `qwen3:4b-instruct`. The optional **part hypothesis** inference is only activated when `RESEARCH_LAB_RELATIONSHIP_AI=1`. It reviews up to two *already known* website product titles in a single bounded CPU request; unavailable model or timeout leaves the source-backed graph functional. Manufacturing process names must exist in the 220-process code reference.

### Module ownership

| Module | Purpose |
|---|---|
| `Scrappers/tools/oem-process-reference.mjs` | Validated private local original code; exact SHA, type-safe category/process lookups and draft part-shape rules |
| `Scrappers/tools/research-relationship-graph.mjs` | Company → product → part/material → possible process → proposed original code graph |
| `Scrappers/tools/ollama-relationships.mjs` | Optional bounded local Qwen3 speculative part breakdown |
| `Scrappers/tools/research-edition-store.mjs` | Append-only versioned cross-company working taxonomy JSON |
| `Scrappers/tools/research-lab.mjs` | Coordinates extraction, local inference, code-reference lookup and working-edition writes |
| `live-lab/src/protocol.js` | Validates and bounds the laptop-to-Cloudflare results and process snapshot |
| `Scrappers/tools/live-lab-bridge.mjs` | Outbound-only authenticated original taxonomy/process viewer sync and live tests |
| `live-lab/src/worker.js` | Protected viewer APIs and session-specific research graph |
| `live-lab/src/ui.js` | Searchable original tree, clickable L3 process associations and AI working-edition growth |

### API summary

- Laptop GET `/health`, GET `/api/process-reference/status`, GET `/api/working-edition/summary` (localhost only).
- Laptop POST `/api/taxonomy/master-snapshot` and `/api/process-reference/snapshot` require the Lab CSRF session token.
- Cloudflare GET `/api/original-taxonomy`, GET `/api/original-processes?code=...`, GET `/api/runs/{id}` require the **viewer** key.
- Cloudflare POST `/api/agent/original-taxonomy` and `/api/agent/original-processes` require a **separate** agent key. The agent cannot send arbitrary commands or URLs; the source approvals and fixed job limits remain.
- Cloudflare Durable Object only caches read-only viewer data and recent live test state. The authoritative taxonomy and all versioned cross-company working knowledge stay on the laptop as JSON code/files.

### Verification

Run `node --test Scrappers/tests/oem-foundation.test.mjs` and `cd live-lab && npm run check && npm run build:check` (Node >=24). CI repeats Linux and native Windows checks and bundling. The separate private taxonomy ZIP installer validates the real 1,213 nodes + 220 processes + 10,388 draft links using exact pinned SHA.

### Limits / release boundary

- Real product ownership (manufacture vs distribute/resell), integral BOM part identity, raw material grade and plant-level production capabilities **are not verified**.
- Unmapped products/parts remain explicit; AI must not invent an original code or turn a hypothesis into a source-backed fact.
- The 250-run JSON working-edition cap is intentional. Review/approval, normalization/dedup semantics and database migration are **later** projects, not in this foundation.
- This branch/PR and its CI do **not** deploy to the currently running Cloudflare Worker. The Windows startup bundle creates a separate approved source worktree and requires the old 8790 Lab/bridge window to stop; it does not overwrite their files or touch port 8791.
- No OS integration, autonomous remote shell or arbitrary website browsing is enabled.
