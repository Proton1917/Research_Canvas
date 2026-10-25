PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  current_version INTEGER NOT NULL,
  metadata TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS document_versions (
  document_id TEXT NOT NULL REFERENCES documents(id),
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY (document_id, version)
);
CREATE TABLE IF NOT EXISTS canvases (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  revision INTEGER NOT NULL,
  objects TEXT NOT NULL,
  editor_state TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS relations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  include_in_context INTEGER NOT NULL,
  context_order INTEGER NOT NULL,
  claim TEXT,
  created_at TEXT NOT NULL,
  source_ref TEXT,
  target_ref TEXT
);
CREATE TABLE IF NOT EXISTS anchors (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  document_id TEXT NOT NULL REFERENCES documents(id),
  version INTEGER NOT NULL,
  block_id TEXT NOT NULL,
  quote TEXT NOT NULL,
  start_utf16 INTEGER NOT NULL,
  prefix TEXT NOT NULL,
  suffix TEXT NOT NULL,
  page INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (document_id, version) REFERENCES document_versions(document_id, version)
);
CREATE TABLE IF NOT EXISTS contexts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  context_id TEXT NOT NULL REFERENCES contexts(id),
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  answer TEXT NOT NULL,
  model_used TEXT,
  usage TEXT,
  error TEXT,
  document_id TEXT REFERENCES documents(id),
  proposal_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  run_id TEXT NOT NULL REFERENCES runs(id),
  anchor_id TEXT NOT NULL REFERENCES anchors(id),
  replacement TEXT NOT NULL,
  status TEXT NOT NULL,
  applied_version INTEGER,
  previous_version INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS canvas_proposals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  run_id TEXT NOT NULL UNIQUE REFERENCES runs(id),
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS documents_workspace ON documents(workspace_id);
CREATE INDEX IF NOT EXISTS relations_workspace ON relations(workspace_id);
CREATE INDEX IF NOT EXISTS relations_target ON relations(target_id, include_in_context);
CREATE INDEX IF NOT EXISTS runs_workspace ON runs(workspace_id);
