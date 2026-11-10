# Verification Plan

## Automated (must pass)

- Research seed counts and source crosswalk integrity.
- HTML signal extraction from representative fixed fixtures.
- Multi-label classification and evidence source mapping.
- Clear difference between observed, lead and review-only categories.
- Reject localhost, IP literals, credentialed URLs, and nonstandard ports.
- Respect robots restrictions and never fetch blocked paths.
- Bound site inspection, sample selected pages and stop on oversized responses.
- Avoid double-counting repeated company hosts in frequency analysis.
- Worker health/catalog routes and protected analysis endpoints.

## Human-reviewed live experiments (not yet done)

Test representative sites: Saginaw (deferred catalog), Dometic (Load More), ConnectDER (PDF content-type), Littelfuse (embedded state), Dataprobe (JSON-LD), Ancast (capability-led), and Atlas Copco (regional routing). For each, save actual request/response outcomes, timestamps, selected pages, and pattern evidence. Record false positives/negatives against a human-reviewed label set. Do not equate a linked PDF with a parsed PDF; do not equate a Load More button with proven backend pagination.

## Suggested research quality gates

- Every observed detection retains a reachable source URL and meaningful locator.
- No pattern is counted absent for an unassessed company.
- Same-host deduplication tested.
- Every manual-review pattern explicitly shown as unassessed until verified.
- New pattern candidates are not silently promoted.
- Deployment and live browser testing only reported after execution.
