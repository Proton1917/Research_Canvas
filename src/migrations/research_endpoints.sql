BEGIN IMMEDIATE;
CREATE TABLE relations_with_endpoints (
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
INSERT INTO relations_with_endpoints
  SELECT id,workspace_id,source_id,target_id,kind,label,include_in_context,context_order,claim,created_at,NULL,NULL FROM relations;
DROP TABLE relations;
ALTER TABLE relations_with_endpoints RENAME TO relations;
CREATE INDEX relations_workspace ON relations(workspace_id);
CREATE INDEX relations_target ON relations(target_id,include_in_context);
COMMIT;
