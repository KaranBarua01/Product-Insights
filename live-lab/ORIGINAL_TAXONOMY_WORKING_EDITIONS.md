# Original Taxonomy Explorer + AI Working Taxonomy — prototype design

## Decision: two separate data layers, one product intelligence workflow

**Original taxonomy** is the installed OEM reference (expected 1,213 nodes, pending actual installation and count validation). Its codes, paths and hierarchy are immutable in this prototype. A category is a *type*, not an individual SKU. Do not add every new company product to the original hierarchy.

**AI Working Taxonomy** is the automatically generated, unapproved graph of observed product instances, component mentions, material evidence, possible production processes, proposed classification edges and taxonomy gaps. It references existing original taxonomy codes where exact matches exist. Never overwrite an original node from an AI inference. Auto-add AI proposals to the working graph, not the original file or InsideJob OS.

JS1–JS10 remains **one company-level profile**. Products are instances linked into the relationship graph; no duplicated JS1–JS10 profile for every product.

## UI behavior

The left sidebar has:
- **Original taxonomy** — the actual searchable read-only master from the laptop, including L0–L4 hierarchy, code, full path, source hash, count and last synchronization. Also shows AI mapping candidates (product to existing taxonomy code) and the per-run working graph in separate areas.
- **AI taxonomy** — the working graph of product, component/part and material claims, with any separately labeled inferred process hypotheses. Laptop results remain visible if optional Cloudflare Workers AI fails or exceeds its timeout.

Each proposed relation is labeled observed source candidate, local AI mention, AI hypothesis, or unknown. A source quote is attribution, not independent truth. Unmapped codes remain explicit rather than inventing a category.

## Data flow / security

1. Local Research Lab on 127.0.0.1:8790 loads its original validated taxonomy. The protected POST taxonomy/master-snapshot endpoint requires the Lab CSRF token and emits code/label/path/level plus manifest hash only; no local paths, user records or secrets.
2. Existing outbound-only Cloudflare bridge polls the protected snapshot on a throttled cadence, validates structure and synchronizes it only when the hash/status changes. This is separate from GitHub queue token.
3. Cloudflare Worker accepts the snapshot on a separately authenticated agent-only endpoint and stores it in the Live Lab Durable Object; the viewer uses its independent key. There is no new inbound laptop listener.
4. Every completed laptop investigation creates a bounded working graph in the Worker from the actual source-backed local result (products, components/material mentions, and only existing validated category codes). This graph works even when optional Cloudflare AI enrichment times out.
5. Original tree and working graph are displayed in the dashboard. The master is not modified; no OS writes occur.

The original taxonomy must actually be installed in the local Lab. A claimed total of 1,213 is not sufficient to manufacture missing nodes. The UI reports not installed until a real original file loads.

## Relationship model

- Company to product: manufactures / distributes / sells, only if documented.
- Product to part/accessory/tool: observed or hypothesized relation, separately typed.
- Part or product to material: source-supported or AI-proposed claim.
- Part to process: possible requirement, AI hypothesis, not proof of in-house production.
- Product / part / process to original taxonomy: proposed classification edge only when applicable.

The OEM industry taxonomy may not itself classify materials or manufacturing processes; keep separate working node types when no original taxonomy target exists.

## Current implementation status

Implemented in this draft: full read-only taxonomy sync; searchable original hierarchy; per-run mapping list; source-backed laptop working graph with product/component/material links; strict original-code validation; independent operation when Cloudflare Workers AI times out.

The local Research Lab currently reports 0 original nodes installed in the isolated 8790 checkout. Until installed, classification cannot target the real original master.

Not yet implemented: local Ollama part-to-process hypothesis inference across all products, durable cross-run/cross-company accumulation of working editions, Cloudflare taxonomy review/approval/publishing, and deploying/synchronizing this revision to the Windows Lab and live Cloudflare Worker.

## Next proof-of-concept milestone

1. Install the real OEM taxonomy in the isolated laptop Lab.
2. Run a permitted sample company through Cloudflare and confirm the original hierarchy appears in the new sidebar.
3. Confirm products map only to original codes, gaps stay in the working layer.
4. Extend Ollama with plausible part-to-process edges, labeled as hypotheses.
5. Add append-only versioned working-edition history before accumulating knowledge across companies.
