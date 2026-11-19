# Evidence-aware OEM taxonomy retrieval — experimental local benchmark

This extends existing Stage 2 candidate retrieval; it does NOT publish taxonomy nodes, assert accurate mappings, or send the installed OEM reference to an AI provider.

## Implemented

- Searches every installed L2/L3 entry using name-bearing source quotations and taxonomy hierarchy paths.
- Requires a functional object token and matching parent-domain context; otherwise abstains.
- Uses a small generic normalization list. Brand names and promotional adjectives alone are insufficient.
- Returns up to three REVIEW-ONLY candidate codes, paths, rationales and relative retrieval scores (NOT probabilities).
- Stage 2 uses evidence candidates before its original name-only fallback. Human approvals are unchanged.

## Local commands

From the Scrappers directory, run:

    npm test
    npm run benchmark:taxonomy -- --out qa-results/taxonomy-demo.json

The bundled fixture is entirely SYNTHETIC: 13 positive product cases across mobility, servers, pumps, solar energy, foodservice, medical and truck drivetrains, plus three abstention cases. Passing it proves neither actual catalog coverage nor real-world taxonomy correctness.

To use your installed PRIVATE 1,213-node taxonomy without uploading it:

    npm run benchmark:taxonomy -- --taxonomy "C:\path\OEM-taxonomy-explorer.html" --cases "C:\path\human-reviewed-cases.json" --out qa-results/taxonomy-private.json

The cases JSON has the form:

    {"cases":[{"id":"a","name":"Product name","quote":"Verbatim named source statement describing function","expectedCode":"EXISTING_NODE_CODE"},{"id":"b","name":"Unclear item","quote":"Unclear item with no known object class","expectedCode":null}]}

Use human-reviewed codes and observed source quotations; null means abstention. Do not commit private reference files, labeled private examples, or exported results.

## Limitations and follow-ups

- This is evidence+hierarchy lexical retrieval, NOT YET embedding or reranker inference. Private-taxonomy calibration and real-website experiments remain untested.
- The scope of Cargo racks & boxes for hitch-mounted bicycle/motorcycle racks and add-on trays still needs taxonomy-owner approval.
- Calibrate recall, wrong-domain false candidates and abstention using real reviewed samples from multiple sectors before relaxing thresholds.
- Optionally benchmark a local Sentence Transformers encoder against the exact same cases; keep semantic candidates review-only until calibrated.
