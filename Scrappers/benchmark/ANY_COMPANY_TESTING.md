# Any Public Company — Controlled Local Website Tests (Prototype)

## Why
The original Cloudflare Live Lab accepts six hard-coded approved domains, producing narrow and potentially misleading accuracy estimates. A complete production-ready universal website crawler is **not** claimed. The new foundation permits the **laptop operator** to approve additional eligible public company domains without editing or redeploying the Worker for each site.

## Security model
- **Local operator only** authorizes an exact public DNS host by running `node Scrappers/tools/approve-company.mjs https://www.company.com/` or the supplied `APPROVE-NEW-COMPANY.cmd`.
- `Scrappers/local-data/approved-company-websites.json` is **gitignored** and stores approved public hostnames, never keys, OS data or private source.
- Local approval requires an HTTPS URL and public DNS preflight. Loopback, IP literals, reserved hosts, credentials, custom ports, fragments and invalid hostnames are rejected.
- The existing outbound-only bridge reads local approvals and publishes only exact hostnames to the Cloudflare Worker through the **agent-key-only** endpoint. The viewer key can never register a host.
- The Cloudflare viewer can submit new public websites only after a currently connected laptop has approved them. The local bridge checks its local file **again before fetching**. The Research Lab independently preflights the DNS host and restricts navigation to its original hostname.
- No arbitrary remote code execution, shell commands, local network access, Cloudflare scraping, or operating-system integration is introduced.
- This is a **prototype**, not a DNS-pinned security sandbox. Research requires trusted operators and access controls. Public websites can enforce robots rules, CAPTCHAs, regional redirects, authentication or anti-bot restrictions. Do not bypass them.
- Existing six baseline demonstration sites remain available. The additional local approved list is limited to 45 exact hosts.

## Workflow — any new company
1. Keep the Cloudflare bridge and the Lab running, then locally run:
   `node Scrappers/tools/approve-company.mjs https://www.hammfg.com/`
2. The bridge sends the new exact host to the Worker using its existing protected agent key.
3. Open Cloudflare Live Tests -> **Refresh approved websites**, enter the approved URL, choose 3 / 7 / 12 pages and run.
4. Local scraper and Qwen3 work on the laptop; the Worker shows sanitised source-backed product/part/process/taxonomy hypotheses and the locally accumulated JSON working-edition counts.
5. To revoke: `node Scrappers/tools/approve-company.mjs --remove hammfg.com`. Local bridge sync removes it; queued job execution always checks the current file.

## Repeatable benchmark for unfamiliar sites
Default list: `Scrappers/benchmark/new-company-diversity-sites.txt`.

```powershell
cd "$env:USERPROFILE\PI-any-company-v1\Scrappers"
node tools/test-diverse-company-websites.mjs --pages 3 --max 4
# Increase coverage, separately, if the quick test is useful:
node tools/test-diverse-company-websites.mjs --pages 7 --max 6
# To test your own companies, edit a private text file (one HTTPS URL per line):
node tools/test-diverse-company-websites.mjs --sites "C:\path\my-company-list.txt" --pages 3 --max 5
```

The benchmark uses the *already running local Foundation Lab at 127.0.0.1:8790*. It refuses to interrupt a busy Lab, checks public DNS, processes companies **serially** within the page budget and saves a report after **each completed company**:

- `Scrappers/local-data/new-company-benchmark/PI-DIVERSE-COMPANY-RESULTS.json`
- `Scrappers/local-data/new-company-benchmark/PI-DIVERSE-COMPANY-REPORT.md`

The report distinguishes homepage-only failures, blocked pages, zero product candidates, missing materials, Ollama not enriched, taxonomy gaps, possible process hypotheses and whether the local JSON working edition advanced. A zero is a measured failure/unknown, never fabricated evidence.

### New cross-industry targets (all external and distinct from original six)
| Domain | Industry |
|---|---|
| www.hammfg.com | Electrical enclosures, cabinets and transformers |
| www.igus.com | Polymer bearings, motion plastics and cable carriers |
| www.ricelake.com | Weighing and instrumentation equipment |
| www.nordson.com | Industrial fluid dispensing, coating and electronics |
| www.graco.com | Industrial pumps, spray and fluid handling |
| www.festo.com | Pneumatics and factory automation |

Sample list is **not** an approval whitelist and can be replaced by any eligible company URLs. Site accessibility from web search does not guarantee success through the local scraper.

## Evidence and limitations
- Existing Research Lab distinguishes company website product candidates from verified OEM manufacturing ownership.
- Source-mentioned parts are not a verified bill of materials. Manufacturing-process priors are unreviewed hypotheses; they do not establish in-house capabilities.
- Tests run in CI validate HTTP contracts, local approval code, navigation fallback and report generation with synthetic fixtures. They do **not** run the actual laptop Qwen model or establish end-to-end extraction accuracy on these six new sites.
- Keep the existing production Lab on port 8791 and private GitHub queue agent unchanged. Upgrade the 8790 Lab/bridge only after current investigations finish.
