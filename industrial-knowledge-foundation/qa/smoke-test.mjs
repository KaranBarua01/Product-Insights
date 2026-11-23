/** Read-only assertions against Cloudflare D1 using a Wrangler-bound D1Database.
 * Or adapt the SQL in foundation-checks.sql to the Cloudflare D1 console.
 * This file is intentionally side-effect free.
 */
export async function checkFoundation(db) {
  const [summary,issues,counts,unknown] = await Promise.all([
    db.prepare('SELECT * FROM pi_kb_quality_summary_v2').first(),
    db.prepare('SELECT issue,reference FROM pi_kb_integrity_issues_v2 LIMIT 20').all(),
    db.prepare("SELECT (SELECT COUNT(*) FROM pi_product_part_routes_v1) s,(SELECT COUNT(*) FROM pi_kb_part_route_map_v1) m,(SELECT COUNT(*) FROM pi_kb_product_tree_v1) v").first(),
    db.prepare("SELECT COUNT(*) n FROM pi_kb_part_route_map_v1 WHERE knowledge_status!='engineering_hypothesis'").first()
  ]);
  if (!summary || counts.s !== counts.m || counts.s !== counts.v) {
    throw new Error('KB route count mismatch');
  }
  if ((issues.results || []).length) {
    throw new Error('KB integrity issues: ' + JSON.stringify(issues.results));
  }
  if (!summary.product_categories || !summary.product_archetypes || !summary.part_types) {
    throw new Error('KB canonical hierarchy is empty');
  }
  return { summary, counts, issues: [], nonHypotheticalRoutes: unknown.n };
}
