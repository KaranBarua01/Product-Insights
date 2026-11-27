# Product Insights — Standing Operating Model

**Decision:** Approved by the project owner on 2026-11-27. This is the default operating model for their Product Insights acquisition, product intelligence, and taxonomy-enrichment workflow **until the owner explicitly changes it**.

**Status:** Architecture/working agreement, **not** a claim that every connection or capability is already implemented or deployed.

## Three responsibilities, one system

| Participant | Standing responsibility |
| --- | --- |
| **Owner's laptop** | Provides CPU, RAM, local storage and network. Runs the actual website scraper, extraction/PDF processing, pattern analysis, tests, benchmarks, local database, and other computation. Hosts the localhost control center. |
| **GitHub** | Canonical source of truth for application code, tests, reviewed plans, version history, fixes, branches and releases; also hosts the **private, scoped local-agent job queue**. Do not create competing local-only code versions as the normal workflow. |
| **ChatGPT — intelligence role** | Processes approved, source-traceable evidence packets collected on the laptop. Identifies products/components/materials/processes, proposes relationships and taxonomy enrichment, and distinguishes documented statements, inferences and unknowns. Human review/validation gates control durable claims. |
| **ChatGPT — engineering role** | Architects features, writes code and fixes into GitHub, designs tests, diagnoses results, plans improvements, and requests permitted local jobs through the authenticated bridge. |
| **Localhost dashboard and agent** | A single observable operating console: starts/stops approved tasks, shows live status/logs/results, and connects GitHub work to laptop execution. The **local agent**, not the web dashboard alone, executes authenticated jobs. |

## Default research flow

1. Research request is initiated from ChatGPT or the local dashboard.
2. The local agent validates the request against **fixed, authorized actions** and site/network budgets.
3. The laptop performs scraping, PDF extraction, pattern detection, relevance assessment and evidence packaging locally.
4. Sanitized, bounded evidence packets with source URLs and verbatim quotes are made available **through an explicitly approved private transport**. Do not post full private databases, credentials, or proprietary documents to a public repository.
5. ChatGPT analyzes evidence, proposes product intelligence and taxonomy mappings, and returns structured, source-linked drafts.
6. The laptop validates schemas/provenance and stores approved output in the local database. Unsupported conclusions remain labeled inferred/unknown.
7. Localhost displays provenance, gaps, progress and benchmark outcomes.

**Division of labor:** the laptop performs acquisition and deterministic computation; ChatGPT performs the requested AI research and enrichment where the evidence transport is connected. Do not quietly substitute an unrelated local LLM as the decision maker or claim that inaccessible evidence has been analyzed.

## Default development flow

1. ChatGPT diagnoses a change and works in the canonical GitHub repository using an issue and feature branch.
2. CI executes code/tests; shared contracts and security-sensitive changes go through review. No direct unreviewed production deployment.
3. The local agent fetches an **approved pinned revision** and runs supported build, test, research or smoke-check jobs on the laptop.
4. Results/logs return through the private bridge for ChatGPT to inspect and fix further.
5. Owner authorizes integration and release separately. Preserve the working local installation, local data and rollback ability.

**Do not require repeated ZIP downloads or manual file replacement as the normal update process.** Prefer GitHub-pinned, reproducible local updates. Keep one maintained local agent and one local dashboard rather than diverging versions.

## Constraints and truthfulness

- The local agent currently authorizes **specific allowlisted actions**, not unrestricted remote PowerShell. A dashboard console can display execution and support *user-approved* bounded tasks, but does not confer arbitrary shell access.
- Network acquisition must honor robots, origin restrictions, transport safety, rate limits and per-company budgets. An access-policy failure is not evidence that the company has no products.
- ChatGPT cannot directly access the laptop or localhost. Remote execution requires a live authenticated agent and a supported action; availability and successful execution must be confirmed from returned results.
- The intelligence channel needs an explicit secure data-transfer/import mechanism; a GitHub connector alone does not continuously stream local evidence.
- Treat **verified source text**, **machine-generated suggestions**, **unreviewed inference**, and **missing information** as separate classes. Taxonomy matching and scraped-company claims are not intrinsically validated.
- Do not change another workstream's code or build the unrelated supplier/procurement lane as part of this acquisition project without an explicit separate decision.
- Keep local working versions and user data intact during integration. A new prototype branch, launch script or artifact is not a verified replacement for the owner's latest running local version.
- Security, review, deployment and ownership controls in [WORKFLOW.md](WORKFLOW.md) remain in force.

## Changing this architecture

This is the **standing default**. Deviate only when the owner explicitly requests/approves an architectural change, or a security limitation requires stopping an unsafe operation. Record the decision and update this document; do not silently switch compute location, source-of-truth, AI responsibilities, agent permissions or deployment process.

## Implementation status at agreement time

Pieces of this architecture already exist as separate prototypes: the private GitHub job queue, fixed-action local agent, local scraping/testing, evidence packets, GitHub development and localhost UI. **Full integration, secure bidirectional AI ingestion/write-back, reliable code-update mechanism, and a consolidated execution console are still work to complete.** Documenting the architecture does not certify those capabilities as operational.
