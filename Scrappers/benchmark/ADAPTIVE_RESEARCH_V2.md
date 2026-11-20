# Adaptive Product Research V2 — implementation, testing and rollout

This is a **code-only laptop Research Lab upgrade**. The canonical OEM taxonomy (1,213 nodes, 220 process names, 10,388 unreviewed links) remains a private, gitignored local JSON file. No taxonomy database, InsideJob OS write or remote shell is introduced.

## Three research budgets

| Mode | Requested pages | Local Qwen known products | Total Qwen evidence budget |
| --- | ---: | ---: | ---: |
| Quick | 5 | Up to 2 | 90 seconds |
| Standard | 15 | Up to 6 | 180 seconds |
| Deep | 30 | Up to 10 | 260 seconds |

Existing 3/7/12-page remote requests remain accepted. A **requested** page count is a maximum, not a promise: robots/access failures, exhausted frontiers, and diminishing returns can stop the crawler earlier.

### Stages and evidence treatment

1. **Navigation discovery:** Rank exact-host HTTPS/HTTP links with product/category/technical signals, with bounded fallback for unfamiliar navigation. Category/detail routes outrank generic corporate pages and demo-booking links.
2. **Product discovery:** Source JSON-LD records and visited product detail pages create **review-only** product identities. Product cards from category pages become a separate `productLeads` list until the linked detail page is retrieved. Company manufacture versus reseller role remains unverified.
3. **Technical evidence:** Main-content HTML links are prioritized over large menus. Up to 90k characters of a page are preserved; late material/specification passages can be extracted. No arbitrary cross-domain crawling, CAPTCHA bypass or private-network fetching.
4. **Laptop Qwen:** Rank ~5.1k characters of verbatim product-related excerpts from across the page and validate extracted materials/components against those excerpts. The model enriches already-known products only, and returns no invented product identities.
5. **Taxonomy:** Existing category IDs only; unknown categories remain unmapped. Part/process suggestions are hypotheses from the private original process dictionary; no process is verified as an in-house manufacturer capability.
6. **Working JSON:** Existing immutable per-run evidence and cumulative versioned candidate graph remain local to the laptop.

### Coverage report

New metrics include `usefulPages`, `catalogPages`, `productPages`, `productCardLeads`, `stopReason`, `distinctProductFamilyLabels`, `skuNamedProductCandidates`, `catalogLinkCandidates`, actual Qwen review count, and an explicit list of unverified catalog links.

`distinctProductFamilyLabels` is **lexical grouping only**, not an authoritative engineering product-family taxonomy or deduplicated BOM.

## Holdout benchmark

Prior 8-site real test on GitHub-hosted Chromium used 3 pages/site and extracted 1 product candidate total. Adaptive V2 repeats exactly the same eight sites with 15 pages/site. Historical comparisons are **directional**, not a controlled attribution of every improvement: page budget, site access and extraction changes are not independently isolated in this initial experiment.

Industrial subset (2026-11-20, early verified result):

| Company | Adaptive page visits | Successful pages | Product/SKU candidates | Caveat |
| --- | ---: | ---: | ---: | --- |
| Hammond Manufacturing | 1 | 0 | 0 | Access blocked; no bypass |
| igus | 15 | 12 | 25 | Includes SKU variants, not necessarily 25 product families |
| Rice Lake | 1 | 0 | 0 | Access blocked; no bypass |
| Nordson | 1 | 0 | 0 | Access blocked; no bypass |

Hardware subset uses Raspberry Pi, SparkFun, Prusa and Bosch Rexroth; see workflow artifact once complete.

- [Cross-platform QA](https://github.com/KaranBarua01/Product-Insights/actions?query=workflow%3A%22Original+Taxonomy+Viewer+QA%22+branch%3Afeat%2Fadaptive-evidence-research-v2)
- [15-page live holdout](https://github.com/KaranBarua01/Product-Insights/actions/runs/44787385824)

**A successful GitHub smoke test does not prove laptop Ollama or private taxonomy integration.** The real Windows laptop must run the updated local Lab and bridge before those can be accepted end-to-end.

## Validation

```sh
cd Scrappers
npm install
npm run build
node --test tests/adaptive-research-v2.test.mjs tests/adaptive-html.test.mjs tests/product-intelligence.test.mjs tests/ollama-known-products.test.mjs tests/research-lab.test.mjs

cd ../live-lab
npm install
npm run check
npm run build:check
```

CI runs the suite on Ubuntu and native Windows. The Worker dry-run must pass before any release.

## Rollout contract

1. Keep the current V1 live Lab on 8790 and private queue agent unchanged while testing. The original Lab on 8791 is preserved.
2. Stage the V2 Cloudflare Worker using inherited bindings; **do not promote V2** while the connected laptop still runs the V1 bridge because new 15/30-page requests would be rejected by that old bridge.
3. On a coordinated upgrade, stop only the old 8790 Lab/bridge, start a verified isolated V2 worktree with the same gitignored private taxonomy and source-hash checks, and deploy the corresponding Worker.
4. Run a real approved website in Quick, Standard and Deep on the actual laptop; inspect Qwen, source quotes, candidate family grouping and cumulative JSON. Record failures, not only products found.
5. A successful rollout must verify Cloudflare viewer/agent separation, original taxonomy hash unchanged and no OS writes.

## Known remaining gaps

- Robots/403/429/CAPTCHA/IP-blocked sites remain inaccessible without a permitted first-party access method. Do not bypass restrictions.
- Client-rendered product tiles and embedded app-state catalogs are only partially handled. Product schema and link evidence are preferable to inventing identities from marketing copy.
- False positives and duplicate model variants require precision/recall measurement on a human-labeled holdout; one site with many SKU records is not proof of universal product extraction.
- Part-to-process relationships are hypotheses; actual manufacturer production routing cannot be inferred solely from a general website.
