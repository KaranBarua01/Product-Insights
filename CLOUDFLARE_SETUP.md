# Product Insights: Cloudflare test environment (prototype)

**Purpose:** deploy the existing Pattern Systems and Scrappers APIs to Cloudflare Workers. This does **not** change the portable Node/Playwright architecture, create the JS1–JS10 system, or deploy anything without your Cloudflare login. Keep the full project handoff separate.

## Existing services

| GitHub directory | Cloudflare Worker name | API routes |
| --- | --- | --- |
| `engine/pattern-systems` | `insidejob-pattern-systems` | `GET /health`, `GET /api/patterns`, authorized `POST /api/analyze` |
| `Scrappers` | `product-insights-scrappers-prototype` | `GET /health`, `GET /api/strategies`, authorized `POST /api/extract` |

S01/S03 use ordinary Workers HTTP APIs. S02 remains portable on Node Playwright; in Cloudflare it can *optionally* use Browser Run Quick Actions after you add a browser binding and validate its limits. **Keep the browser binding omitted for the first deploy**. Pattern Systems can pass detection results to Scrappers through an optional authenticated HTTP connection; neither Worker has a database requirement.

## 1. Authenticate once (PowerShell, from the checked-out repository)

You need your own Cloudflare account and enabled Workers. No new Git repo is needed.

```powershell
cd "C:\Users\Karanbarua01\Desktop\Insidejob Work\Product Insights\Product-Insights"
git pull
cd .\engine\pattern-systems
npm.cmd install
npx.cmd wrangler login
npx.cmd wrangler whoami
```

Wrangler opens your browser for authorization. Do **not** paste login tokens or API secrets in chat or commit them to GitHub.

## 2. Pattern Systems Worker

```powershell
# Still in engine\pattern-systems
npm.cmd test
npx.cmd wrangler deploy
npx.cmd wrangler secret put PATTERN_SYSTEM_API_TOKEN
```

Generate a **long random secret** when prompted, and save it in a private password manager. The resulting URL will resemble `https://insidejob-pattern-systems.<YOUR_SUBDOMAIN>.workers.dev` (use the actual output).

Check `https://<your-pattern-worker>/health` in a browser. The `/api/analyze` endpoint requires `Authorization: Bearer <your secret>`.

**Safety:** Pattern Systems currently lacks explicit host allowlisting/DNS-pinned egress. Until that is implemented, treat it as a small, private prototype: use a strong token, avoid untrusted callers, and do not advertise the endpoint as a general website scanner. Its requests still respect its existing public-host and robots policies.

## 3. Scrappers Worker

```powershell
cd ..\..\Scrappers
npm.cmd install
npm.cmd test
```

Edit `Scrappers/wrangler.jsonc` and change `vars.ALLOWED_HOSTS` from the placeholder `manufacturer.com` to the **exact approved hostnames** you intend to test, comma separated. E.g. `www.saginawcontrol.com,www.dometic.com`. Only include hosts you have reviewed; a robots block is still respected.

```powershell
npx.cmd wrangler deploy
npx.cmd wrangler secret put SCRAPPERS_API_TOKEN
```

Use a **different long random secret** for Scrappers. Check the resulting `https://<your-scrappers-worker>/health` URL. `configured.browser` will be `false` initially, which is expected.

### 4. Connect Pattern Systems to Scrappers (optional after both Workers deploy)

In `Scrappers/wrangler.jsonc`, under `vars`, add:

```json
"PATTERN_API_URL": "https://insidejob-pattern-systems.<YOUR_SUBDOMAIN>.workers.dev"
```

Remember to insert a comma after the preceding `ALLOWED_HOSTS` property. Re-deploy Scrappers and then:

```powershell
npx.cmd wrangler secret put PATTERN_API_TOKEN
```

Enter the **same value** as `PATTERN_SYSTEM_API_TOKEN` in the Pattern Worker. Scrappers will use it to request pattern analysis if the incoming extraction request does not already include `patternAnalysis`.

### 5. Test authenticated extraction

```powershell
$api = "https://product-insights-scrappers-prototype.<YOUR_SUBDOMAIN>.workers.dev"
$secret = Read-Host "Enter SCRAPPERS_API_TOKEN" -AsSecureString
$token = [System.Net.NetworkCredential]::new("", $secret).Password
Invoke-RestMethod -Method Get -Uri "$api/health"
Invoke-RestMethod -Method Post -Uri "$api/api/extract" -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body '{"url":"https://www.saginawcontrol.com/","mode":"S01"}'
Remove-Variable token, secret
```

Adjust the sample URL to an exact approved host in your allowlist. The prompt hides the token as you type. Avoid pasting tokens into chat or committing secrets.

### 6. Optional Cloudflare S02 Browser Run (later)

Cloudflare offers Browser Run on supported plans. To enable, add this property at the top level of `Scrappers/wrangler.jsonc`, then deploy:

```json
"browser": { "binding": "MYBROWSER" }
```

The Cloudflare adapter uses `MYBROWSER.quickAction("content", ...)` with a bounded HTML response and exact hostname request regex, but it does **not** support the interactive `Load more` behavior of the Node Playwright adapter. Quick Actions do not provide session-level guardrails or a verified final browser URL: do not present its final URL as proven without further evidence. Browser Run usage is metered. For local Quick Actions development, use `npx.cmd wrangler dev --remote` (not plain local mode). Never bypass a robots block.

### 7. Optional: connect GitHub to Cloudflare for automatic deployment

Only after **manual deploys are successful**: open Cloudflare dashboard > Workers & Pages > select each Worker > Settings > Builds > Connect. Select `KaranBarua01/Product-Insights` and main branch. Set **root directory** separately for each service:

- Pattern Systems: `engine/pattern-systems`
- Scrappers: `Scrappers`

Build command: `npm run build` or leave blank for Wrangler-managed compilation. Deploy command: `npx wrangler deploy`. Ensure Worker names match the `name` fields of each folder's Wrangler file. Cloudflare's Git integration supports monorepos and builds on pushes. Inspect security and preview settings before enabling automatic deploys.

## Operating boundaries

- Worker endpoints are internet-reachable even when the API operations use bearer tokens. Do not use them for uncontrolled crawling or send credentials in URL parameters.
- Host allowlists and robots are necessary but **not sufficient against DNS-rebinding/SSRF**; do not open public self-service URL analysis without network egress controls.
- S03 is built but has not been confirmed using a real PDF under Cloudflare Workers.
- S02 Cloudflare Browser Run is optional and has not been exercised against your actual Cloudflare account.
- The existing local Node CLI remains the baseline for meaningful benchmark comparisons.
- No Worker has been deployed by this repository change. Your Cloudflare account authorization and deploy are required.
