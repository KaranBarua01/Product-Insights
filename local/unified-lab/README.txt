PRODUCT INSIGHTS | FULL UNIFIED PHASE 4 PROTOTYPE

START HERE
1. Extract the entire ZIP into a NEW folder. Do not merge into your v0.8 folder.
2. Double-click START_LOCALHOST.bat. It opens the full application at
   http://127.0.0.1:8791/ and keeps the server in the terminal.
3. For the failed-company retest, close this new lab or leave it idle, then
   double-click START_UPDATED_TEST.bat. The 34-site benchmark runs in its own
   terminal and saves summary.json after each company under benchmark-results/.
   Share that summary when the run finishes. Ctrl+C stops the current run.

This is a full application package, not only a benchmark installer. The
original v0.4 lab source, UI, V2 SQLite database, knowledge and inference engine,
AI packet and Ollama workflow, and optional legacy private queue agent are
included. The acquisition adapter now uses the cumulative four-phase engine.
First launch automatically retrieves its pinned GitHub source and installs
local npm dependencies. Node.js 24+ and internet access are required. Git,
Chromium, Ollama and Python are not required for basic acquisition testing.
Subsequent starts reuse the verified local runtime. Existing v0.8 files, results,
port 8790, credentials and deployments are left alone.

WHAT IS INCLUDED
- Full localhost dashboard: overview, products/engineering, source pages,
  AI claims/QA, knowledge explorer, and exports/comparison.
- Unchanged independent V2 SQLite snapshot: 27 tables, 39,858 product and
  component vocabulary records, 78 categories, 1,297 materials, 57 processes,
  and 3 draft inference rules. No OEM V1/V3 data or private production DB.
- Phase 1: access diagnostics, safe redirects, transient timeout recovery.
- Phase 2: catalog/product discovery, exact duplicates, branch/locale ranking.
- Phase 3: native PDF sampling, technical HTML tables, units, source locators,
  and optional review-only local OCR.
- Phase 4: source relevance gates, literal signal coverage, missing dimensions,
  false-success risk, adaptive stopping and remaining leads.
- Existing Pattern Systems: passive classification of up to 2 accepted HTML
  samples and 1 PDF from the crawl. No extra detector network requests and no
  preflight-based routing in this integration. Unobserved is not absent.
- Repaired cancellation-safe DNS-pinned HTTPS response transport. No browser
  capture, automatic cross-host redirect, proxy, credential or access bypass.
- Fixed 34-company benchmark (15 technical failures followed by 19 access
  rechecks), original seed URLs and anchors. 50 attempts per company. No AI,
  browser, OCR, pattern preflight, or expanded PDF limit in this benchmark.

LAUNCHERS
START_LOCALHOST.bat     Full dashboard, default local-only mode.
START_UPDATED_TEST.bat  Failed-only benchmark; no second download after setup.
RUN_REGRESSION_TESTS.bat Re-run bundled and pinned acquisition fixtures.
START_WITH_AGENT.bat    Optional legacy fixed-action queue integration. Only
                         use after stopping ALL other PI-Agent-Queue runners.

RELEASE AND COMPATIBILITY
The available full application source was v0.4, not the unpublished v0.8
installation. This is an independent integration based on that source, not a
byte-identical v0.8 update. It does not silently replace the v0.8 database,
agent, later ChatGPT import workflow or local modifications. The legacy queue
supports its original fixed actions (health, ollama_health, run_tests,
research_baja_50, research_1up_50, ollama_1up). It does not support the later
v0.8 collect_website, benchmark_100 or import_chatgpt queue actions. Use the
new manual benchmark launcher for failed34. Queue connection defaults off;
agent mode requests the existing restricted private token as hidden input (or
uses an explicitly supplied environment token). No token is bundled, cached
or uploaded by the setup. Do not send tokens in chat.

ACQUISITION / SAFETY
Only public HTTPS exact-host standard-port URLs, DNS answers checked then pinned
for each connection, TLS hostname validation, manual redirects and fail-closed
robots policies. Browser/S02 is retained in upstream source and fixture tests
but not enabled in this guarded release. Default limits per site: 50 source
attempts, 360 guarded requests, 64 MiB delivered body budget, 12-minute crawl
ceiling, 1.25 MB HTML, 3 MB PDF, 15 sampled PDF pages. Additional request/body
limits may stop early. Delivered body bytes are not an exact wire-byte count.
Transport requests identity encoding; unexpected compressed responses are
rejected. Access restrictions, robots and rate-limit stops are not failures to
circumvent. No model output becomes executable code.

OPTIONAL LOCAL OCR AND LARGER PDFS
Not needed for the benchmark. To enable on a manual dashboard run, install
Poppler pdftoppm and Tesseract English data yourself, with both commands on PATH.
In a CMD window from this folder: set PI_LOCAL_PDF_OCR=1 then run
START_LOCALHOST.bat. OCR is limited to 3 pages/document, 6/run, review only.
PI_LOCAL_LARGE_PDF=1 permits at most 3 reserved 12 MB PDF attempts per manual
run; the run-wide body budget still applies. Both flags default off and are
not granted to queue jobs. OCR subprocess is not an OS sandbox.

AI AND KNOWLEDGE
Default provider is Deterministic / ChatGPT packet. Frozen source batches
are available in Exports & comparison for manual ChatGPT analysis. The
existing optional local Ollama model qwen3:4b-instruct is supported; start
Ollama yourself, use Check AI, and select Ollama or Retry AI. Set
PI_START_OLLAMA=1 before starting if you want the launcher to start Ollama when
installed. No model download or external AI key is required. Quotes must
match within one excerpt; mechanical checks do not verify semantic accuracy.
All claims and engineering hypotheses are candidates for review. No supplier
matching, RFQ, procurement, make-vs-buy, or production database changes.

RESULTS
Full application: results/<run-id>/ contains six original JSON exports:
00_acquisition_report.json, 01_shared_input.json, 02_ollama_results.json,
03_validated_summary.json, 04_run_status.json, 05_full_report.json.
Phase 4 quality diagnostics and technical review previews appear in the UI
and acquisition exports. Only accepted native source text enters frozen
packets. OCR and layout geometry remain review-only. Repeated reports are
restored from this new package only. Benchmark saves individual site JSON
and summary.json separately. Recovery is provisional; not verified precision,
recall, or a strictly comparable A/B with the unpublished v0.8 runner.

SOURCE PIN AND VALIDATION
Product-Insights commit 89ec9c91706396c00d1b34e24d5a3f1bf58742ae (draft PR #44).
The first setup downloads the public commit archive, checks 13 known Git blob
IDs, builds Scrappers and Pattern Systems, runs the regression suites and
exercises the actual compiled engine through the new adapter using an offline
fixture. No GitHub branch or Cloudflare deployment is modified. The full
application integration source and database are bundled; upstream runtime
source and npm dependencies are downloaded at first start, not embedded.
Read VALIDATION.txt for exact tested versus pending checks.
