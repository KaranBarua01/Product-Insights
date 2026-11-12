# Reviewed facts → engineering: shared interface proposal

**Status: PROPOSED ONLY (v0), not frozen and not consumed by either engine.** [Joint design issue #4](https://github.com/KaranBarua01/Product-Insights/issues/4). Patricio's actual Python input/output field names must be reviewed before turning this into `v1`.

## Intended boundaries

```text
Karan: Website URL → Pattern Systems → Scrappers → source evidence → JS1–JS10 quote-backed candidates
                                     ↓ HUMAN/SEMANTIC REVIEW
Both:   canonical company & product IDs → component records with reviewed source-linked facts
                                     ↓ VERSIONED ADAPTER
Patricio: deterministic component-role/process rules → conditional process requirements
                                     ↓
Patricio: taxonomy-normalized matching against synthetic supplier capabilities
                                     ↓
Karan:   UI presents process compatibility, conditions, source/rule provenance, unknowns
```

The initial sample [JSON Schema proposal](../../contracts/proposals/evidence-to-engineering.v0.schema.json) and [fictional fixture](../../contracts/proposals/evidence-to-engineering.example.json) exist to start review, not to declare compatibility. A quote matched in HTML is insufficient for an automatically approved BOM or material grade.

## Required meaning

- `companyRef` and `productRef` are **local/provisional IDs** until matched to canonical InsideJob OS records; do not invent OS IDs.
- Components need distinct identity, possible parent assembly, **role classification basis** (`explicit_source`, `engineering_hypothesis`, or `unknown`) and review state.
- Each source fact needs a source URL, exact quote, statement, observation/interpretation status and human review state. Never let a model self-approve its suggestions.
- Patricio should accept only inputs validated to the agreed schema/review gate. Unreviewed component roles/material grades must not be silently treated as fact.
- Process requirements belong to **JS5**; assertions about a company's actual in-house machines, factories or processes belong to **JS6** and require separate proof.
- Supplier/process compatibility is **not** verified manufacturing capability, capacity, certification, commercial eligibility, actual procurement demand or an RFQ.
- **JS7** missing sourcing evidence stays unknown. Real supplier data is out of scope for the first integration.

## Proposed contract negotiation

1. Patricio shares *schema/field shape* (not confidential values) for his phase-1 and phase-2 inputs/outputs on Issue #4.
2. Karan maps `Scrappers/src/types.ts` and `Scrappers/src/js-profile.ts` to source fact candidates and human-reviewed component facts.
3. Both approve canonical IDs, taxonomy version, evidence provenance, review statuses and rejected-input behavior.
4. Freeze `contracts/v1/` with validated positive + negative examples and consumer-driven tests. Keep `contracts/proposals/` for discussion only.
5. Implement adapters in `integration/`; do not reach inside the other person's engine to rewrite its logic.

**No contract review, no automatic JS → manufacturing inference bridge.**
