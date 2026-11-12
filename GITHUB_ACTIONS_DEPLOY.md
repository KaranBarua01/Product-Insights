# Cloudflare deployment — central Development Controller only

**Current policy (November 2026):** `Product-Insights` is a **source + test repository**. Its GitHub Actions run CI but **do not deploy**. Only `KaranBarua01/development-controller` promotes pinned, reviewed `Product-Insights` commits and deploys the existing named Workers.

## Why this matters for Karan and Patricio

Both engineers can merge reviewed code without unexpectedly replacing the other's running Worker. Patricio's standalone Python research package will not trigger Cloudflare deployment merely because its tests and modules are in this repo.

## Release steps

1. Open a feature PR referencing a tracking issue, include test evidence and obtain required peer approval.
2. Merge to `Product-Insights/main`; verify the source-only CI is green.
3. Karan opens a **separate controller release change**, updating the exact source commit SHA in `development-controller/registry/projects.json` and the relevant pinned `.github/workflows/deploy-pattern-systems.yml` or `.github/workflows/deploy-scrappers.yml`.
4. Deploy the **existing** `insidejob-pattern-systems` or `product-insights-scrappers-prototype` Worker through its controller workflow.
5. Verify its health, authenticated API, Pattern Systems service binding, reviewed allowlist and live smoke tests; document the released SHA.

Do not copy API tokens, Cloudflare credentials, worker runtime bearer secrets, supplier records or private handoff packages into this public repo. Runtime secrets stay in their existing secured locations.

See [collaboration handoff](docs/collaboration/HANDOFF.md), [workflow and branch protection](docs/collaboration/WORKFLOW.md), and [active work](docs/collaboration/ACTIVE_WORK.md).
