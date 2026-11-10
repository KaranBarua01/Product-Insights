CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  host TEXT NOT NULL,
  company_name TEXT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  result_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_host_date ON runs(host, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_date ON runs(created_at DESC);
