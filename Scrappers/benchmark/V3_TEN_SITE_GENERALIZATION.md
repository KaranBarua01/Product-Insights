# PI V3 — ten-site generalization evaluation

This is an **isolated holdout test**, not a claim that PI works on every website.

Test domains (each on its own GitHub-hosted runner): Hammond Manufacturing (enclosures), Bosch Rexroth (hydraulics), SparkFun (electronics), Prusa (3D printing), SMC USA (pneumatics), AutomationDirect (automation distribution), Adafruit (electronic modules), 10x Genomics (scientific instruments), Flowserve (pumps) and Rice Lake (weighing).

## Methodology
- Holdout branch based on V3 PR #34; no changes to V2 or V3 extraction algorithms.
- V2 and V3 are each given the same 15-page visit maximum per website and the same validated exact-host root URL and browser fallback; V2 is run first, so website volatility and anti-bot state are confounders.
- Capture availability (visited, usable, blocked), product candidates, raw and distinct source-backed part candidates, part-to-material and part-to-process statement counts, linked technical documents, and partial source URL/quote samples.
- Candidate counts are **not** precision/recall or evidence of verified BOMs. A product may be sold rather than manufactured; a material/process source claim is not proof of in-house manufacturing.
- A blocked homepage is a website-access failure, not evidence that the site has no products.
- At least one manually reviewed source/product sample per accessible vertical is required before concluding that +50% accuracy holds across industries.
- No automatic web-request bypass; no company-level D1 process gets promoted into part-level fact.
- If the site redirects to a different host, exact-host policy can block it: report as an integration constraint, not a website problem.
- Private D1 database, OEM taxonomy, laptop Qwen, Patricio engine and Cloudflare production are not used.
