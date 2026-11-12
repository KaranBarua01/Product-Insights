# Manufacturing intelligence — Patricio's canonical development lane

**Status:** Handoff scaffold. The executable Python inference and matching engines **are not in this repository yet**. The current `Scrappers/src/patricio-pilot.ts` file is a sanitized static demonstration snapshot.

**Primary engineer:** Patricio (GitHub username to be verified for CODEOWNERS). **Tracker:** [Issue #3](https://github.com/KaranBarua01/Product-Insights/issues/3). **Joint contract:** [Issue #4](https://github.com/KaranBarua01/Product-Insights/issues/4).

## Canonical modules to import (do not rewrite)

- `process_inference/` — existing Python component-role and manufacturing-process rules; assumptions, evidence references and rule IDs.
- `supplier_matching/` — existing Python process capability comparison; strict `synthetic_test` data guard until real supplier data is authorized.
- `tests/` — original deterministic tests plus sanitized integration fixtures. Test every taxonomy mapping / exclusion / missing evidence case.
- Optional `docs/` — rules, taxonomy provenance, input/output version notes.

Do not add a second website crawler/Pattern Systems implementation here. Do not implement a rival manufacturing rules engine under `Scrappers/` merely to make the UI look live.

## First import PR

1. Check the original Python package's license/permission to redistribute in this **public** repository. Do not commit internal blueprint transcriptions or real supplier exports; if needed, use a separate approved private package.
2. Preserve phase 1 process inference and phase 2 supplier matching as distinct functions. Keep output labels such as hypothesis / conditions / compatibility (not a qualification guarantee).
3. Add a `pyproject.toml` with tested Python version, dependencies and a `[project.optional-dependencies].dev` test dependency (e.g. pytest). The central CI will run `python -m pytest intelligence/manufacturing/tests` once the package is present.
4. Preserve original unit tests, include at least one sanitized synthetic fixture, and document exact commands.
5. Compare real Python I/O to [the draft contract](../../docs/collaboration/INTEGRATION_CONTRACT.md), and agree on a versioned interface with Karan before changing shared files.
6. Open a MANUFACTURING PR citing #3. Cross-engine adapters are separate INTEGRATION PRs.

The first integration is **reviewed source evidence → deterministic inference → synthetic compatibility only**. It must not write to an InsideJob production company or supplier database.
