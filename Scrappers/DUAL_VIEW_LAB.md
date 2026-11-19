# Product Insights — Dual-View Intelligence Lab (prototype)

The Local Research Lab now has **two top-level buttons**. Both present the exact same completed research run, using the existing Scrappers planner and S01/S02/S03 extractors. The old technical controls remain intact.

## 1. Product Insights — Manuel (default)

A business-level explanation of the research:

Company → observed category → product/model → explicit component mentions and materials → separately reviewed manufacturing processes/capabilities → draft InsideJob OS JSON.

- Enter a public company URL and a 1–12 page budget, then select **Investigate**. This runs actual website requests through the existing protected Local Research Lab. It is not a scripted demo and cannot bypass robots or HTTP denials.
- The page shows the company and provisional role, counts of product/category candidates, source-linked product drilldowns, specs, components and materials. Clicking **Open original page** provides a live website citation.
- **Component mentions are not a confirmed product BOM or part hierarchy.** A material or component does not establish the process needed to manufacture it.
- The process section is not fabricated. JS5 = a quoted process relevant to products; JS6 = a separate website claim of a company-performed capability. Both remain proposed until reviewed. Neither is automatically linked to an individual product or factory.
- Taxonomy mappings are unverified suggestions. No approved OS taxonomy assignments are created automatically.
- **OS today vs. research:** Without actual OS data, the left side explicitly says **Not connected** (not zero). Import an OS company JSON snapshot **from a real OS export** using the local file picker; the server holds a sanitized version in memory on 127.0.0.1, never sends it to Cloudflare and never persists it. Compare only matching company websites. Matching product names are leads, not proof of identical products.
- **Download JSON** exports a review-only draft handoff with sources and unknown values. It does NOT call or mutate InsideJob OS, and it is not the agreed production contract.

## 2. Technical View — Engineering

Preserves the existing controls and diagnostics:

- Website URL, page budget, S01/auto/S02 and visible Chromium choices.
- Live progress and source-page table, source quotations, extracted text and routing evidence.
- Local taxonomy installation and review, Stage 2 candidate mapping and optional AI claims.
- Raw extraction report JSON and taxonomy working-edition controls.

The modes share one server run: there are no separate synthetic business results.

## Using it on Windows

From an installed Scrappers workspace with Node 24 and dependencies already present:

~~~powershell
cd "$HOME\PI-local-agent\Scrappers"
npm.cmd run lab
~~~

If Windows blocks npm.ps1, prefer **npm.cmd**, not a machine-wide PowerShell execution-policy change. Open http://127.0.0.1:8790 on the **same PC**. Do not expose the server to a LAN or the internet.

The private GitHub agent is a separate process. Keep it in another PowerShell window if needed; Lab research does not require the agent.

## What the OS snapshot file must contain

There is no authenticated InsideJob OS company-record connector in this repository. The business interface can compare only **actual exported OS JSON** mapped to this draft structure. Use the in-app **Snapshot format** link to get an empty template.

Example of a **format only**, not a real OS record:

~~~json
{
  "schemaVersion": "pi-os-snapshot/v1",
  "company": {"id": null, "name": "REPLACE_WITH_ACTUAL_OS_COMPANY_NAME", "website": "https://example.com/"},
  "categories": [],
  "products": [],
  "parts": [],
  "manufacturingProcesses": []
}
~~~

No one should fill fields with guesses or pretend this demonstrates OS's present records. The first OS integration task is to map an approved OS export (its actual schema) into this snapshot format or build a read-only, authenticated connector. Until that is done, show **OS not connected**.

The importer rejects unrecognized schemas, invalid company websites and catalogs exceeding the local comparison limits, instead of silently treating missing records as zero. File ingestion is limited, token-protected, in-memory, loopback-only. The **Clear OS snapshot** button drops imported data.

## Outputs and exact limitations

- **Raw research JSON:** unchanged /api/export, with the extractor and Stage 2 content.
- **Review-only OS draft JSON:** /api/os/handoff, available only after a real research run, with per-product evidence and explicit unknowns.
- **Business view:** /api/business projection (not a production OS API).
- **Import OS snapshot:** POST /api/os/snapshot (token-protected; normalized and kept only in server memory).
- **Read-only template:** /api/os/template.

The frozen independent U30 baseline was 30 companies, 138 usable pages, 24 product candidates, 7 categories, one technical specification and no extracted material claims. Source quote traceability is not independent accuracy. This Lab upgrade does NOT change the frozen Product Intelligence V1 extractor, the research planner, or the U30 test data and MUST NOT be reported as improved extraction recall.

Manuel should see Product Insights first. Engineering can switch to Technical View at any time to explain *how* the same findings were obtained.
