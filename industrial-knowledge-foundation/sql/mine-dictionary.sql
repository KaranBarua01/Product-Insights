-- Product Insights industrial knowledge V2: company-INDEPENDENT vocabulary mining.
-- SOURCE ONLY: company_commodity_dictionary. Persist only aggregated terms/counts;
-- no company_record_id, domain, company association or product attestation.
-- Re-running INSERT OR IGNORE is safe but does not refresh existing frequencies;
-- rebuild inventory separately when the source corpus materially changes.

INSERT OR IGNORE INTO pi_kb_lexicon_v2(term_kind, normalized_term, occurrence_count)
SELECT 'product_phrase', normalized_term, COUNT(DISTINCT company_record_id)
FROM (
 SELECT c.id company_record_id,
  LOWER(TRIM(REPLACE(REPLACE(CAST(j.value AS TEXT), CHAR(10), ' '), CHAR(9), ' '))) normalized_term
 FROM company_commodity_dictionary c,
  json_each('[' || REPLACE(REPLACE(json_quote(COALESCE(c.what_they_make,'')), ',', '","'), ';', '","') || ']') j
 WHERE LENGTH(COALESCE(c.what_they_make,''))>0
) WHERE LENGTH(normalized_term) BETWEEN 3 AND 120 GROUP BY normalized_term;

INSERT OR IGNORE INTO pi_kb_lexicon_v2(term_kind, normalized_term, occurrence_count)
SELECT 'material_token', normalized_term, COUNT(DISTINCT company_record_id)
FROM (
 SELECT c.id company_record_id,
  LOWER(TRIM(REPLACE(REPLACE(CAST(j.value AS TEXT), CHAR(10), ' '), CHAR(9), ' '))) normalized_term
 FROM company_commodity_dictionary c,
  json_each('[' || REPLACE(REPLACE(json_quote(COALESCE(c.materials_required,'')), ',', '","'), ';', '","') || ']') j
 WHERE LENGTH(COALESCE(c.materials_required,''))>0
) WHERE LENGTH(normalized_term) BETWEEN 2 AND 120 GROUP BY normalized_term;

INSERT OR IGNORE INTO pi_kb_lexicon_v2(term_kind, normalized_term, occurrence_count)
SELECT 'commodity_token', normalized_term, COUNT(DISTINCT company_record_id)
FROM (
 SELECT c.id company_record_id,
  LOWER(TRIM(REPLACE(REPLACE(CAST(j.value AS TEXT), CHAR(10), ' '), CHAR(9), ' '))) normalized_term
 FROM company_commodity_dictionary c,
  json_each('[' || REPLACE(REPLACE(json_quote(COALESCE(c.commodity,'')), ',', '","'), ';', '","') || ']') j
 WHERE LENGTH(COALESCE(c.commodity,''))>0
) WHERE LENGTH(normalized_term) BETWEEN 2 AND 120 GROUP BY normalized_term;

-- The mined strings must be reviewed; DO NOT bulk-promote them into pi_kb_names_v1.
SELECT term_kind, COUNT(*) AS distinct_terms, SUM(occurrence_count) AS appearances
FROM pi_kb_lexicon_v2 GROUP BY term_kind;
