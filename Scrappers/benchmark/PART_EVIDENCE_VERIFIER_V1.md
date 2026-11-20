# Part Evidence Verifier V1 — D1 + PI + source-specific evidence

Prototype, not a production matchmaker. This module is wired into the **existing Windows Local Research Lab** on this branch. It does not alter the Cloudflare Worker, InsideJob OS or the master OEM taxonomy.

## Data boundary

- **D1** `company_commodity_dictionary` supplies company-level *hypotheses*: products, commodities, materials, business role. These are **never copied** to a part as if verified.
- **PI** supplies product identity, exact product-detail source URL and captured page text.
- **Verifier** finds part/material/process mentions on the **same primary product page** and includes exact source quotes. The results all require human review; no extracted claim is labeled verified BOM or plant capability.
- **Process dictionary / Patricio** integration is downstream, not implemented by this module. Production process ownership remains unknown.
- Company-domain mismatch, collection-page text, cross-product citations and speculative manufacturing statements do not become supported part/process claims.

## Local D1 context (optional, private)

Export only the company records you are permitted to use into a **local, gitignored** JSON file at `Scrappers/local-data/d1-company-context.json` or set `PI_D1_CONTEXT_FILE` to its absolute path. Use an array of objects containing `website`, `what_they_make`, `commodity`, `materials_required`, `manufacturing_role`, `buyer_supplier_classification`, `evidence_confidence`. The same-domain record is selected at runtime. Do not commit the full internal 27,441-company D1 database, D1 credentials or private reference taxonomy. No D1 network requests are made by the Local Lab.

## Execution

On the feature branch, run `cd Scrappers && npm install && npm test`; or start `npm run lab` with the existing local prerequisites. Perform a normal local website investigation (Quick 5, Standard 15, Deep 30) and open `/api/report` or export the report. The new `partEvidence` field includes:

- `d1`: optional company-level unverified priors;
- `products[].parts[].observations`: source-quoted candidate mentions;
- `products[].parts[].materialClaims`: part-specific material quotes only;
- `products[].parts[].processClaims`: source-stated manufacturing wording, **not** ownership/capability;
- `products[].productMaterials`: material specified at whole-product scope (never inherited into parts);
- `products[].uncorroboratedScraperMentions`: questionable or uncheckable extraction;
- `counts`: coverage and extraction metrics.

The original `productIntelligence` and `researchGraph` remain available for comparison. No outward data sink other than the existing Lab report/export is introduced.

## Tests and acceptance

`tests/part-evidence-verifier.test.mjs` covers e-loop-like component/process sentences, cross-product contamination, strict company-domain matching, missing raw pages, unverified D1 priors, hypothetical-process abstention and read-only subset import. The e-loop sentences in the unit test are **constructed regression examples**, not a new live scrape or independent truth labels.

Next measure real source coverage on igus e-loop / 1UP Heavy Duty with human labels for false positives and false negatives. Unknown remains unknown. Do **not** claim full 10-company/50-page precision or Patricio integration from these unit tests.
