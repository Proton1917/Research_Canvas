use std::{sync::{Arc, Mutex}, time::Duration};

use base64::{Engine, engine::general_purpose::STANDARD};
use rusqlite::{Connection, Row, params};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};

use crate::{error::{ApiError, Result}, model::*};

#[derive(Clone)]
pub struct Db(Arc<Mutex<Connection>>);

impl Db {
    pub fn open(path: &str) -> Result<Self> {
        let connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.execute_batch(include_str!("schema.sql"))?;
        let has_canvas_proposal: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('runs') WHERE name='canvas_proposal_id')", [], |row| row.get(0))?;
        if !has_canvas_proposal { connection.execute("ALTER TABLE runs ADD COLUMN canvas_proposal_id TEXT", [])?; }
        let has_endpoints: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('relations') WHERE name='source_ref')", [], |row| row.get(0))?;
        if !has_endpoints { connection.execute_batch(include_str!("migrations/research_endpoints.sql"))?; }
        connection.execute("UPDATE runs SET status='interrupted', error='服务进程中断，请根据已保存上下文重新发起', updated_at=? WHERE status IN ('queued','running')", [now()])?;
        Ok(Self(Arc::new(Mutex::new(connection))))
    }

    pub async fn call<T: Send + 'static>(&self, operation: impl FnOnce(&mut Connection) -> Result<T> + Send + 'static) -> Result<T> {
        let database = self.0.clone();
        tokio::task::spawn_blocking(move || {
            let mut connection = database.lock().map_err(ApiError::internal)?;
            operation(&mut connection)
        }).await.map_err(ApiError::internal)?
    }
}

pub fn encode(value: &impl Serialize) -> Result<String> { Ok(serde_json::to_string(value)?) }

pub fn enum_name(value: &impl Serialize) -> Result<String> {
    match serde_json::to_value(value)? {
        Value::String(name) => Ok(name),
        _ => Err(ApiError::internal("枚举的序列化结果无效")),
    }
}

fn parse<T: DeserializeOwned>(text: String) -> rusqlite::Result<T> {
    serde_json::from_str(&text).map_err(|error| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error)))
}

fn enumeration<T: DeserializeOwned>(text: String) -> rusqlite::Result<T> {
    serde_json::from_value(Value::String(text)).map_err(|error| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error)))
}

pub fn workspace_row(row: &Row<'_>) -> rusqlite::Result<Workspace> {
    Ok(Workspace { id: row.get(0)?, name: row.get(1)?, created_at: row.get(2)?, updated_at: row.get(3)? })
}

pub fn workspace(connection: &Connection, id: &str) -> Result<Workspace> {
    Ok(connection.query_row("SELECT id,name,created_at,updated_at FROM workspaces WHERE id=?", [id], workspace_row)?)
}

pub fn touch(connection: &Connection, id: &str) -> Result<()> {
    connection.execute("UPDATE workspaces SET updated_at=? WHERE id=?", params![now(), id])?;
    Ok(())
}

const DOCUMENT_SELECT: &str = "SELECT d.id,d.workspace_id,d.title,d.kind,d.current_version,d.metadata,v.content,d.created_at,d.updated_at FROM documents d JOIN document_versions v ON v.document_id=d.id AND v.version=d.current_version ";

fn document_row(row: &Row<'_>) -> rusqlite::Result<Document> {
    Ok(Document {
        id: row.get(0)?, workspace_id: row.get(1)?, title: row.get(2)?, kind: enumeration(row.get(3)?)?,
        current_version: row.get(4)?, metadata: parse(row.get(5)?)?, content: parse(row.get(6)?)?,
        created_at: row.get(7)?, updated_at: row.get(8)?,
    })
}

pub fn document(connection: &Connection, id: &str) -> Result<Document> {
    Ok(connection.query_row(&format!("{DOCUMENT_SELECT} WHERE d.id=?"), [id], document_row)?)
}

pub fn scoped_document(connection: &Connection, id: &str, workspace_id: &str) -> Result<Document> {
    let document = document(connection, id)?;
    if document.workspace_id != workspace_id { return Err(ApiError::invalid("文稿属于其他工作区")); }
    Ok(document)
}

pub fn documents(connection: &Connection, workspace_id: &str) -> Result<Vec<Document>> {
    let mut statement = connection.prepare(&format!("{DOCUMENT_SELECT} WHERE d.workspace_id=? ORDER BY d.created_at,d.id"))?;
    Ok(statement.query_map([workspace_id], document_row)?.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn validate_content(content: &Content) -> Result<()> {
    let mut ids = std::collections::HashSet::new();
    for block in &content.blocks {
        if block.id.is_empty() || !ids.insert(&block.id) { return Err(ApiError::invalid("文本块需要互不重复的非空标识")); }
        if block.page == Some(0) { return Err(ApiError::invalid("PDF 页码从 1 开始")); }
    }
    Ok(())
}

pub fn insert_document(connection: &Connection, document: &Document, reason: &str) -> Result<()> {
    validate_content(&document.content)?;
    connection.execute("INSERT INTO documents VALUES (?,?,?,?,?,?,?,?)", params![document.id, document.workspace_id, document.title, enum_name(&document.kind)?, document.current_version, encode(&document.metadata)?, document.created_at, document.updated_at])?;
    insert_version(connection, &DocumentVersion {
        document_id: document.id.clone(), version: document.current_version, title: document.title.clone(),
        content: document.content.clone(), created_at: document.updated_at.clone(), reason: reason.to_string(),
    })?;
    touch(connection, &document.workspace_id)
}

pub fn new_document(workspace_id: String, title: String, kind: DocumentKind, content: Content, metadata: Value) -> Document {
    let timestamp = now();
    Document { id: id(), workspace_id, title, kind, current_version: 1, metadata, content, created_at: timestamp.clone(), updated_at: timestamp }
}

pub fn insert_version(connection: &Connection, version: &DocumentVersion) -> Result<()> {
    connection.execute("INSERT INTO document_versions VALUES (?,?,?,?,?,?)", params![version.document_id, version.version, version.title, encode(&version.content)?, version.created_at, version.reason])?;
    Ok(())
}

fn version_row(row: &Row<'_>) -> rusqlite::Result<DocumentVersion> {
    Ok(DocumentVersion { document_id: row.get(0)?, version: row.get(1)?, title: row.get(2)?, content: parse(row.get(3)?)?, created_at: row.get(4)?, reason: row.get(5)? })
}

pub fn version(connection: &Connection, document_id: &str, version: i64) -> Result<DocumentVersion> {
    Ok(connection.query_row("SELECT document_id,version,title,content,created_at,reason FROM document_versions WHERE document_id=? AND version=?", params![document_id, version], version_row)?)
}

pub fn versions(connection: &Connection, document_id: &str) -> Result<Vec<DocumentVersion>> {
    let mut statement = connection.prepare("SELECT document_id,version,title,content,created_at,reason FROM document_versions WHERE document_id=? ORDER BY version")?;
    Ok(statement.query_map([document_id], version_row)?.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn revise(connection: &Connection, document: &mut Document, expected: i64, reason: &str) -> Result<()> {
    validate_content(&document.content)?;
    let next_version = expected + 1;
    let timestamp = now();
    let changed = connection.execute("UPDATE documents SET title=?, current_version=?,metadata=?,updated_at=? WHERE id=? AND current_version=?", params![document.title, next_version, encode(&document.metadata)?, timestamp, document.id, expected])?;
    if changed != 1 { return Err(ApiError::conflict(self::document(connection, &document.id)?.current_version)); }
    document.current_version = next_version;
    document.updated_at = timestamp;
    insert_version(connection, &DocumentVersion { document_id: document.id.clone(), version: next_version, title: document.title.clone(), content: document.content.clone(), created_at: document.updated_at.clone(), reason: reason.to_string() })?;
    touch(connection, &document.workspace_id)
}

fn canvas_row(row: &Row<'_>) -> rusqlite::Result<Canvas> {
    let state: Option<String> = row.get(5)?;
    Ok(Canvas { id: row.get(0)?, workspace_id: row.get(1)?, name: row.get(2)?, revision: row.get(3)?, objects: parse(row.get(4)?)?, editor_state: state.map(parse).transpose()?, updated_at: row.get(6)? })
}

pub fn canvas(connection: &Connection, id: &str) -> Result<Canvas> {
    Ok(connection.query_row("SELECT * FROM canvases WHERE id=?", [id], canvas_row)?)
}

pub fn canvases(connection: &Connection, workspace_id: &str) -> Result<Vec<Canvas>> {
    let mut statement = connection.prepare("SELECT * FROM canvases WHERE workspace_id=? ORDER BY updated_at,id")?;
    Ok(statement.query_map([workspace_id], canvas_row)?.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn insert_canvas(connection: &Connection, canvas: &Canvas) -> Result<()> {
    connection.execute("INSERT INTO canvases VALUES (?,?,?,?,?,?,?)", params![canvas.id, canvas.workspace_id, canvas.name, canvas.revision, encode(&canvas.objects)?, canvas.editor_state.as_ref().map(encode).transpose()?, canvas.updated_at])?;
    Ok(())
}

fn relation_row(row: &Row<'_>) -> rusqlite::Result<Relation> {
    let claim: Option<String> = row.get(8)?;
    let source: Option<String> = row.get(10)?;
    let target: Option<String> = row.get(11)?;
    Ok(Relation { id: row.get(0)?, workspace_id: row.get(1)?, source_id: row.get(2)?, target_id: row.get(3)?, kind: row.get(4)?, label: row.get(5)?, include_in_context: row.get(6)?, context_order: row.get(7)?, claim: claim.map(parse).transpose()?, created_at: row.get(9)?, source_ref: source.map(parse).transpose()?, target_ref: target.map(parse).transpose()? })
}

pub fn relation(connection: &Connection, id: &str) -> Result<Relation> {
    let mut relation = connection.query_row("SELECT * FROM relations WHERE id=?", [id], relation_row)?;
    crate::claim::refresh(connection, &mut relation)?;
    Ok(relation)
}

pub fn relations(connection: &Connection, workspace_id: &str) -> Result<Vec<Relation>> {
    let mut statement = connection.prepare("SELECT * FROM relations WHERE workspace_id=? ORDER BY created_at,id")?;
    let mut relations = statement.query_map([workspace_id], relation_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
    for relation in &mut relations { crate::claim::refresh(connection, relation)?; }
    Ok(relations)
}

pub fn insert_relation(connection: &Connection, relation: &Relation) -> Result<()> {
    connection.execute("INSERT INTO relations VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", params![relation.id, relation.workspace_id, relation.source_id, relation.target_id, relation.kind, relation.label, relation.include_in_context, relation.context_order, relation.claim.as_ref().map(encode).transpose()?, relation.created_at, relation.source_ref.as_ref().map(encode).transpose()?, relation.target_ref.as_ref().map(encode).transpose()?])?;
    Ok(())
}

fn anchor_row(row: &Row<'_>) -> rusqlite::Result<Anchor> {
    Ok(Anchor { id: row.get(0)?, workspace_id: row.get(1)?, document_id: row.get(2)?, version: row.get(3)?, block_id: row.get(4)?, quote: row.get(5)?, start_utf16: row.get(6)?, prefix: row.get(7)?, suffix: row.get(8)?, page: row.get(9)?, created_at: row.get(10)? })
}

pub fn anchor(connection: &Connection, id: &str) -> Result<Anchor> {
    Ok(connection.query_row("SELECT * FROM anchors WHERE id=?", [id], anchor_row)?)
}

pub fn anchors(connection: &Connection, workspace_id: &str) -> Result<Vec<Anchor>> {
    let mut statement = connection.prepare("SELECT * FROM anchors WHERE workspace_id=? ORDER BY created_at,id")?;
    Ok(statement.query_map([workspace_id], anchor_row)?.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn insert_anchor(connection: &Connection, anchor: &Anchor) -> Result<()> {
    connection.execute("INSERT INTO anchors VALUES (?,?,?,?,?,?,?,?,?,?,?)", params![anchor.id, anchor.workspace_id, anchor.document_id, anchor.version, anchor.block_id, anchor.quote, anchor.start_utf16, anchor.prefix, anchor.suffix, anchor.page, anchor.created_at])?;
    Ok(())
}

pub fn context(connection: &Connection, id: &str) -> Result<Context> {
    let payload: String = connection.query_row("SELECT payload FROM contexts WHERE id=?", [id], |row| row.get(0))?;
    Ok(serde_json::from_str(&payload)?)
}

pub fn insert_context(connection: &Connection, context: &Context) -> Result<()> {
    connection.execute("INSERT INTO contexts VALUES (?,?,?,?)", params![context.id, context.workspace_id, encode(context)?, context.created_at])?;
    Ok(())
}

pub fn run_row(row: &Row<'_>) -> rusqlite::Result<Run> {
    let usage: Option<String> = row.get(7)?;
    Ok(Run { id: row.get(0)?, workspace_id: row.get(1)?, context_id: row.get(2)?, model: row.get(3)?, status: enumeration(row.get(4)?)?, answer: row.get(5)?, model_used: row.get(6)?, usage: usage.map(parse).transpose()?, error: row.get(8)?, document_id: row.get(9)?, proposal_id: row.get(10)?, created_at: row.get(11)?, updated_at: row.get(12)?, canvas_proposal_id: row.get(13)? })
}

pub fn run(connection: &Connection, id: &str) -> Result<Run> {
    Ok(connection.query_row("SELECT * FROM runs WHERE id=?", [id], run_row)?)
}

pub fn insert_run(connection: &Connection, run: &Run) -> Result<()> {
    connection.execute("INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", params![run.id, run.workspace_id, run.context_id, run.model, enum_name(&run.status)?, run.answer, run.model_used, run.usage.as_ref().map(encode).transpose()?, run.error, run.document_id, run.proposal_id, run.created_at, run.updated_at, run.canvas_proposal_id])?;
    Ok(())
}

pub fn update_run(connection: &Connection, run: &Run) -> Result<()> {
    connection.execute("UPDATE runs SET status=?,answer=?,model_used=?,usage=?,error=?,document_id=?,proposal_id=?,updated_at=?,canvas_proposal_id=? WHERE id=?", params![enum_name(&run.status)?, run.answer, run.model_used, run.usage.as_ref().map(encode).transpose()?, run.error, run.document_id, run.proposal_id, run.updated_at, run.canvas_proposal_id, run.id])?;
    Ok(())
}

fn proposal_row(row: &Row<'_>) -> rusqlite::Result<Proposal> {
    Ok(Proposal { id: row.get(0)?, workspace_id: row.get(1)?, run_id: row.get(2)?, anchor_id: row.get(3)?, replacement: row.get(4)?, status: enumeration(row.get(5)?)?, applied_version: row.get(6)?, previous_version: row.get(7)?, created_at: row.get(8)? })
}

pub fn proposal(connection: &Connection, id: &str) -> Result<Proposal> {
    Ok(connection.query_row("SELECT * FROM proposals WHERE id=?", [id], proposal_row)?)
}

pub fn insert_proposal(connection: &Connection, proposal: &Proposal) -> Result<()> {
    connection.execute("INSERT INTO proposals VALUES (?,?,?,?,?,?,?,?,?)", params![proposal.id, proposal.workspace_id, proposal.run_id, proposal.anchor_id, proposal.replacement, enum_name(&proposal.status)?, proposal.applied_version, proposal.previous_version, proposal.created_at])?;
    Ok(())
}

pub fn update_proposal(connection: &Connection, proposal: &Proposal) -> Result<()> {
    connection.execute("UPDATE proposals SET status=?,applied_version=?,previous_version=? WHERE id=?", params![enum_name(&proposal.status)?, proposal.applied_version, proposal.previous_version, proposal.id])?;
    Ok(())
}

pub fn insert_asset(connection: &Connection, asset: &Asset) -> Result<()> {
    let bytes = STANDARD.decode(&asset.data_base64).map_err(|_| ApiError::invalid("资产的 Base64 数据无效"))?;
    connection.execute("INSERT INTO assets VALUES (?,?,?,?,?,?)", params![asset.id, asset.workspace_id, asset.filename, asset.media_type, bytes, asset.created_at])?;
    Ok(())
}

pub fn asset(connection: &Connection, id: &str) -> Result<Asset> {
    Ok(connection.query_row("SELECT * FROM assets WHERE id=?", [id], |row| {
        let bytes: Vec<u8> = row.get(4)?;
        Ok(Asset { id: row.get(0)?, workspace_id: row.get(1)?, filename: row.get(2)?, media_type: row.get(3)?, data_base64: STANDARD.encode(bytes), created_at: row.get(5)? })
    })?)
}

pub fn archive(connection: &Connection, workspace_id: &str) -> Result<WorkspaceArchive> {
    let documents = documents(connection, workspace_id)?;
    let mut all_versions = Vec::new();
    for document in &documents { all_versions.extend(versions(connection, &document.id)?); }
    let mut contexts_statement = connection.prepare("SELECT payload FROM contexts WHERE workspace_id=? ORDER BY created_at,id")?;
    let contexts = contexts_statement.query_map([workspace_id], |row| parse(row.get(0)?))?.collect::<rusqlite::Result<Vec<Context>>>()?;
    let mut runs_statement = connection.prepare("SELECT * FROM runs WHERE workspace_id=? ORDER BY created_at,id")?;
    let runs = runs_statement.query_map([workspace_id], run_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
    let mut proposals_statement = connection.prepare("SELECT * FROM proposals WHERE workspace_id=? ORDER BY created_at,id")?;
    let proposals = proposals_statement.query_map([workspace_id], proposal_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
    let mut assets_statement = connection.prepare("SELECT id FROM assets WHERE workspace_id=? ORDER BY created_at,id")?;
    let asset_ids = assets_statement.query_map([workspace_id], |row| row.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    let mut assets = Vec::new();
    for id in asset_ids { assets.push(asset(connection, &id)?); }
    let mut canvas_statement = connection.prepare("SELECT payload FROM canvas_proposals WHERE workspace_id=? ORDER BY created_at,id")?;
    let canvas_proposals = canvas_statement.query_map([workspace_id], |row| parse(row.get(0)?))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(WorkspaceArchive { format_version: 3, workspace: workspace(connection, workspace_id)?, documents, versions: all_versions, canvases: canvases(connection, workspace_id)?, relations: relations(connection, workspace_id)?, anchors: anchors(connection, workspace_id)?, contexts, runs, proposals, canvas_proposals, assets })
}

pub fn workspace_summary(connection: &Connection, workspace_id: &str) -> Result<Value> {
    Ok(json!({"workspace": workspace(connection, workspace_id)?, "documents": documents(connection, workspace_id)?, "canvases": canvases(connection, workspace_id)?, "relations": relations(connection, workspace_id)?, "anchors": anchors(connection, workspace_id)?}))
}
