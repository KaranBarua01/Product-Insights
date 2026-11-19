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
