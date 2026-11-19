# Product Insights — Cloudflare + Laptop Live Lab

An actual hosted Worker application with a Cloudflare Durable Object session and outbound-only Windows browser bridge. A team member on another laptop can inspect real website tests and failures. No static mock results.

## Architecture

Team browser (viewer key) -> Cloudflare Worker (serialized live job, Durable Object) <- outbound HTTPS polling from your Windows laptop (agent key) -> existing localhost Research Lab -> S01/S02/S03 and optional Chromium.

The local Research Lab must be running and reachable on 127.0.0.1:8790. Do not expose localhost to the public internet.

## Live screens

- Product Insights: Company, observed categories, products, specifications, component/material mentions, separate process quotes, source links and draft integration JSON.
- Technical View: visited pages, real extraction strategies, live page events, errors and limitations.
- OS today: NO API CONNECTION. OS has no JSON export. Manual observations are entered only by the presenter into the browser memory, labeled as manual and never sent to Cloudflare.
- Results are visible only after a genuine investigation. Blocked sites, timeouts and insufficient evidence remain explicit.

## Safety

- Both viewer API and laptop agent API require independent Cloudflare secret keys. The browser uses a per-session key in memory only. Never commit keys to GitHub.
- Fixed six-domain allowlist for this prototype, maximum 12 pages (only 3, 7 or 12 configurable), one job at a time, headless local browser and no arbitrary remote commands.
- Website access, robots and exact hostname restrictions from the existing Scrappers engine still apply. No bypass.
- Cloud results are sanitized, capped, and are unreviewed claims. No raw HTML, OS user records or local credentials are sent to the hosted UI.
- Component mentions do not establish a bill of materials, materials do not establish processes, and OS integration does not exist.
- This remains a short-lived internal prototype. Protect the team key privately. Add Cloudflare Access identity-based login, rate limiting, reviewed retention and egress hardening before wider use.

## Cloudflare Worker

The standalone live-lab directory contains its own wrangler.jsonc; it must be deployed separately from the existing Product Insights Scrappers Worker.

On a machine authenticated to the approved Cloudflare account:

    cd live-lab
    npm.cmd install
    npx.cmd wrangler deploy
    npx.cmd wrangler secret put LAB_VIEW_KEY
    npx.cmd wrangler secret put LAB_AGENT_KEY

Use independently generated secret values of at least 24 characters. The team sees only LAB_VIEW_KEY; the Windows polling bridge uses only LAB_AGENT_KEY.

## Windows laptop

Window 1:

    cd $HOME\PI-local-agent\Scrappers
    npm.cmd run lab

Window 2:

    cd $HOME\PI-local-agent\Scrappers
    $env:PI_LIVE_LAB_URL = 'https://product-insights-live-lab.injindiaops.workers.dev/'
    $env:PI_LIVE_LAB_AGENT_KEY = '<the separately stored Cloudflare LAB_AGENT_KEY>'
    node tools\live-lab-bridge.mjs

Never paste the agent key into the team UI. Verify the actual hostname from deployment output.

## Controlled team demonstration

Open the deployed Worker URL from a separate laptop, authenticate with LAB_VIEW_KEY, confirm that the laptop bridge is online, and investigate 1up-usa.com with 7 pages. Switch to Technical View and show real access and extraction failures. Expand actual product records, source quotations and unknown component/process relationships in Product Insights. Export draft JSON for schema discussion; it is not an OS integration.

## Limitations

An offline laptop makes new research unavailable. The cloud history is bounded, not an archive. The hosted UI shows technical events during research and business outputs when a run finishes. No process ownership or BOM inference; no current OS company-record API; no independent precision/recall guarantee.

## New: Cloudflare Workers AI autonomous working taxonomy

Once a real laptop investigation finishes, the Cloudflare Worker automatically invokes the configured Workers AI model to infer **possible** product types (only from discovered categories), components, materials and manufacturing-process requirements. The browser waits for the actual inference, then displays a separate growing working overlay plus JS1–JS10 coverage, without a human approval click.

- The original master taxonomy is still read-only on the laptop. The bridge reads its manifest and up to 80 matching original node definitions through the existing localhost taxonomy search API, not the full master file. The cloud UI displays original total count, selected original branches, source-extracted candidates, and AI-inferred provisional nodes.
- All AI-generated parts, materials, processes, markets, supplier opportunities, and differentiators are marked **hypotheses**. Source-extracted product/category names are also candidates. JS5 possible processes NEVER establish JS6 in-house capabilities. There is no confirmed BOM.
- Inferences are stored as **run-specific, review-unapproved working nodes** in the Cloudflare Durable Object. The original taxonomy file is not edited, approved working editions on the laptop are not published, and the OS is not written.
- If the crawler discovers no products or categories, AI refuses to invent a catalog; the UI explicitly reports insufficient evidence. Invalid model JSON or unavailable AI yields visible enrichment failure rather than a fabricated diagram.
- Worker binding: `ai: { binding: 'AI' }` in `live-lab/wrangler.jsonc`; verified model availability in the connected Cloudflare account. Authentication and laptop bridge requirements from the previous section still apply; a deployed Worker by itself cannot run browser research.
- CI unit tests use mock model responses. They validate bounded candidate parents, AI-only node provenance, original taxonomy immutability, and unknown JS6 states. A real cross-laptop run and true accuracy assessment require the authenticated bridge and public source access.

## What Manuel should see

After a real run, watch **AI working edition queued** become **generated** in Product Insights. Open the tree to inspect source candidates (green), AI hypotheses (amber), and selected original taxonomy paths (gray). Compare JS1–JS10 statuses and use Technical View to inspect the actual source-page and scraper execution events. An AI-generated impeller/process combination is only a theory until confirmed on a source, not an OS record.
