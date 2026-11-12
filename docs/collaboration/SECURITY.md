# Security, public-repository boundaries and release authority

**The Product-Insights GitHub repository is public.** Never commit or attach: bearer tokens; Cloudflare or GitHub credentials; private customer data; supplier exports; proprietary OEM designs / drawings / BOMs; personal information; original internal ZIP handoffs without explicit redistribution permission; raw proprietary rule traces; production D1 exports.

Use fictional or independently approved sanitized fixtures. A filename or a screenshot marked "prototype" is not permission to publish internal source data.

Existing Workers have authentication, exact-domain allowlists and robots/access policies. Do not widen those or enable unrestricted browser traversal in a PR without explicit security review. The current Node hostname allowlist does not automatically prove DNS-pinned SSRF protection; do not expose arbitrary-url extraction to the public.

The development-controller repository holds central Cloudflare deployment authority; runtime Scrappers/Pattern bearer tokens stay in Worker secrets. **Never copy a token into code, a PR description, Actions logs, screenshots or ChatGPT conversation.** If a credential appears exposed, rotate it and review access.

Patricio's Python research rules and original OEM technical facts may be intellectual property. Import only material explicitly cleared for this public repository. Otherwise keep the engine in a private package/repository with a versioned dependency, and commit only reviewed interface/tests here. No production real-supplier matching until governance and permissions are approved.

Any change to `ALLOWED_HOSTS`, `wrangler.jsonc`, D1 bindings, authentication, model spending, supplier data scope or deployment workflow requires separate security review and central release approval.
