# Pattern Systems V1 — Architecture

1. **Input:** company + URL via Worker HTTP API or local CSV runner.
2. **Access policy:** public DNS name validation, robots lookup, conservative cross-host redirect policy, capped requests.
3. **Sampling:** primary page and up to four prioritized same-host links, without filter enumeration.
4. **Observation:** limited HTML structural/text signals and PDF response type; evidence retains URL, selector-like locator, excerpt, method, timestamp and content hash.
5. **Classification:** deterministic, source-taxonomy-aligned rules; ambiguous/unimplemented detections remain leads or `not_assessed`.
6. **Frequency:** latest site result per host; prevalence calculated only from evidence-positive and sampled-negative classifications, with leads/unknowns surfaced separately.
7. **Storage/output:** immediate JSON/CSV and optional D1 persistence. D1 holds summaries/evidence, not raw full website HTML.

**Responsibility boundary:** No manufacturing semantic extraction, supplier inference, browser session automation, full sitemap parser, production queueing, or OS synchronization.

**Future research, not implemented:** DOM parser improvements, browser HTML comparison, PDF text parsing and selective OCR, cross-host identity approval, sampled-page ground truth labels, statistical calibration. These should be introduced only when justified by evidence.
