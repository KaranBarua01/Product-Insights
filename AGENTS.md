# AI coding agent instructions — Product Insights

This repository is developed in parallel by Karan and Patricio. Follow these directions when acting as an implementation agent.

1. **Read** `README.md`, `docs/collaboration/HANDOFF.md`, `docs/collaboration/OWNERSHIP.md`, and `collaboration/workstreams.json` before creating files or code.
2. **Find the tracking GitHub issue** and identify the primary workstream: ACQUISITION, MANUFACTURING, INTEGRATION or PLATFORM. Search the workstream registry and existing source first. Never create a second scraper, matching engine, process-inference engine, evidence schema or taxonomy unless an accepted design decision explicitly supersedes the existing implementation.
3. **Stay in the assigned lane.** Karan owns `engine/pattern-systems/` and `Scrappers/`. Patricio owns the future Python package in `intelligence/manufacturing/`. `contracts/` and `integration/` require review by both people.
4. **Use a feature branch and PR** referencing an issue. Do not push features directly to `main`. Cross-lane changes must identify both reviewers and contract implications.
5. **Never directly deploy the Cloudflare Workers** or alter production tokens, Worker names, allowlists, D1 bindings or account settings. Only `KaranBarua01/development-controller` promotes pinned revisions after reviews and tests.
6. **Preserve epistemic safeguards:** an exact website quote is not verified engineering truth; JS5 process hypotheses are not JS6 factory capabilities; JS7 possible compatibility is not a confirmed RFQ or supplier qualification; Patricio's pilot uses synthetic suppliers and deterministic rules.
7. **Do not publish private content**: this repository is public. No customer/supplier exports, OEM technical blueprints, original handoff ZIPs without explicit permission, private SaaS credentials, or token values. Use fictional/sanitized fixtures.
8. **Do not claim implementation that does not exist.** `Scrappers/src/patricio-pilot.ts` is a precomputed snapshot; the executable Python inference/matcher is not currently integrated into the Worker.

The workstream registry is the implementation ownership source of truth; issue descriptions track active work. Documentation and checks may evolve by reviewed PR.
