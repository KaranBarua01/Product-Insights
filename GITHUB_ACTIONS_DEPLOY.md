# GitHub Actions -> Cloudflare Workers (one-time setup)

This repository deploys **two existing Cloudflare Workers** using [`.github/workflows/deploy-cloudflare.yml`](.github/workflows/deploy-cloudflare.yml), without requiring Cloudflare's built-in GitHub connection.

The workflow runs on changes under `Scrappers/`, `engine/pattern-systems/`, or its own workflow file on `main`, and can also be started manually under **GitHub -> Actions**. It tests both modules first, then deploys **Pattern Systems before Scrappers**.

## Workers targeted

| Directory | Existing Worker name | Purpose |
|---|---|---|
| `engine/pattern-systems/` | `insidejob-pattern-systems` | Detect page patterns |
| `Scrappers/` | `product-insights-scrappers-prototype` | S01/S02/S03 extraction API |

**Do not target the separately-created `pi-pattern-system` Worker.** That is not the Worker referenced by this repository's existing bindings. Do not rename or delete either Worker without an explicit migration.

## Your one-time actions (no secrets shared in chat)

1. Open the [Cloudflare dashboard](https://dash.cloudflare.com/), select your correct account, then go to **Account API Tokens -> Create Token**.
2. Create a dedicated token named `Product Insights GitHub Deploy` using the **Edit Cloudflare Workers** template. Scope it to the target account and, where supported, only the two existing Workers. It needs permission to **deploy existing Worker scripts**. Do not copy your Workers' own bearer tokens into GitHub.
3. In `KaranBarua01/Product-Insights`, open **Settings -> Secrets and variables -> Actions -> New repository secret**. Add two secrets:

   - `CLOUDFLARE_API_TOKEN` — the **new Cloudflare deployment API token** from step 2.
   - `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare **account ID** (not a token; found in the Cloudflare dashboard or `wrangler whoami`).

4. Go to [repository Actions](https://github.com/KaranBarua01/Product-Insights/actions), choose **Deploy Product Insights Workers to Cloudflare**, then **Run workflow -> main -> Run workflow**.
5. Inspect the workflow run. Both test suites must pass, followed by **Deploy existing Pattern Systems Worker** and **Deploy existing Scrappers Worker**. If credentials are missing, deploy steps are skipped with a notice.
6. Verify the existing Worker `/health` endpoints and then perform an authenticated `/api/extract` check with your **SCRAPPERS_API_TOKEN**. Expected: `configured.patternTransport="service-binding"` and `routing.provenance="remote"`, provided Pattern Systems responds successfully for the approved site.

## Security and scope

- The two API secrets already set on the Workers (`PATTERN_SYSTEM_API_TOKEN`, `SCRAPPERS_API_TOKEN`) and the Scrappers Worker secret (`PATTERN_API_TOKEN`) remain **on Cloudflare**. They are **not** GitHub deployment credentials and must not be committed.
- GitHub Actions needs its **own dedicated Cloudflare deploy token**. Never paste its value into chat, code, workflow YAML, a shell command that might appear in shell history, or job logs.
- A scoped deployment token and default GitHub Actions `contents: read` minimize privileges. Review every change to `main`, because a deployment pipeline can publish changes automatically.
- In Cloudflare, verify the two existing Worker names match `wrangler.jsonc` exactly; otherwise Wrangler may deploy to a different Worker.
- The current Scrappers Wrangler config includes `PATTERN_SERVICE` targeting `insidejob-pattern-systems`, and an approved two-host test allowlist. It does **not** enable paid Browser Run.
- Existing security constraints (robots, allowlist, no DNS-pinned SSRF defense) remain. This is a prototype, not an authorization for public user-controlled crawling.

## Future updates

Once the first workflow succeeds, updating the relevant source files on `main` causes GitHub Actions to test and deploy to both existing Cloudflare Workers automatically. No repeated Wrangler login or manual deploy is required.

If Cloudflare's native GitHub Builds connection is added later, **disable one deployment route** to avoid dueling automatic deploys.
