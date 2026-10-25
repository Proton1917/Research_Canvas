use std::{collections::HashSet, convert::Infallible, time::Duration};

use axum::{Json, extract::{Path, Query, State}, http::StatusCode, response::{Sse, sse::{Event, KeepAlive}}};
use futures_util::StreamExt;
use rusqlite::params;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio_stream::wrappers::WatchStream;

use crate::{AppState, db, error::{ApiError, Result}, model::*, research};

#[derive(Deserialize)]
pub struct NameInput { pub name: String }

pub async fn health(State(state): State<AppState>) -> Result<Json<Value>> {
    state.db.call(|connection| { connection.query_row("SELECT 1", [], |_| Ok(()))?; Ok(()) }).await?;
    Ok(Json(json!({"service":"research-canvas", "api_version":2, "database":"ready", "provider_configured":state.config.credentials_available(), "default_model":state.config.provider.default_model})))
}

pub async fn list_workspaces(State(state): State<AppState>) -> Result<Json<Vec<Workspace>>> {
    Ok(Json(state.db.call(|connection| {
        let mut statement = connection.prepare("SELECT id,name,created_at,updated_at FROM workspaces ORDER BY updated_at DESC,id")?;
        Ok(statement.query_map([], db::workspace_row)?.collect::<rusqlite::Result<Vec<_>>>()?)
    }).await?))
}

pub async fn create_workspace(State(state): State<AppState>, Json(input): Json<NameInput>) -> Result<(StatusCode, Json<Workspace>)> {
    if input.name.trim().is_empty() { return Err(ApiError::invalid("工作区名称不能为空")); }
    let result = state.db.call(move |connection| {
        let timestamp = now();
        let workspace = Workspace { id: id(), name: input.name, created_at: timestamp.clone(), updated_at: timestamp };
        connection.execute("INSERT INTO workspaces VALUES (?,?,?,?)", params![workspace.id, workspace.name, workspace.created_at, workspace.updated_at])?;
        Ok(workspace)
    }).await?;
    Ok((StatusCode::CREATED, Json(result)))
}

pub async fn get_workspace(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Value>> {
    Ok(Json(state.db.call(move |connection| db::workspace_summary(connection, &id)).await?))
}

pub async fn rename_workspace(State(state): State<AppState>, Path(id): Path<String>, Json(input): Json<NameInput>) -> Result<Json<Workspace>> {
    if input.name.trim().is_empty() { return Err(ApiError::invalid("工作区名称不能为空")); }
    Ok(Json(state.db.call(move |connection| {
        db::workspace(connection, &id)?;
        connection.execute("UPDATE workspaces SET name=?,updated_at=? WHERE id=?", params![input.name, now(), id])?;
        db::workspace(connection, &id)
    }).await?))
}

#[derive(Deserialize)]
pub struct NewDocument {
    pub title: String,
    #[serde(default)] pub kind: DocumentKind,
    pub content: Content,
    #[serde(default = "empty_object")] pub metadata: Value,
}

fn empty_object() -> Value { json!({}) }

pub async fn create_document(State(state): State<AppState>, Path(workspace_id): Path<String>, Json(input): Json<NewDocument>) -> Result<(StatusCode, Json<Document>)> {
    let result = state.db.call(move |connection| {
        let transaction = connection.transaction()?;
        db::workspace(&transaction, &workspace_id)?;
        let document = db::new_document(workspace_id, input.title, input.kind, input.content, input.metadata);
        db::insert_document(&transaction, &document, "create")?;
        transaction.commit()?;
        Ok(document)
    }).await?;
    Ok((StatusCode::CREATED, Json(result)))
}

pub async fn get_document(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Document>> {
    Ok(Json(state.db.call(move |connection| db::document(connection, &id)).await?))
}

#[derive(Deserialize)]
pub struct DocumentUpdate {
    pub expected_version: i64,
    pub title: Option<String>,
    pub content: Option<Content>,
    pub metadata: Option<Value>,
}

pub async fn update_document(State(state): State<AppState>, Path(id): Path<String>, Json(input): Json<DocumentUpdate>) -> Result<Json<Document>> {
    Ok(Json(state.db.call(move |connection| {
        let transaction = connection.transaction()?;
        let mut document = db::document(&transaction, &id)?;
        if document.current_version != input.expected_version { return Err(ApiError::conflict(document.current_version)); }
        let unchanged = input.title.as_ref().is_none_or(|title| title == &document.title)
            && input.content.as_ref().is_none_or(|content| content == &document.content)
            && input.metadata.as_ref().is_none_or(|metadata| metadata == &document.metadata);
        if unchanged { return Ok(document); }
        if let Some(title) = input.title { document.title = title; }
        if let Some(content) = input.content { document.content = content; }
        if let Some(metadata) = input.metadata { document.metadata = metadata; }
        db::revise(&transaction, &mut document, input.expected_version, "edit")?;
        transaction.commit()?;
        Ok(document)
    }).await?))
}

pub async fn list_versions(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Vec<DocumentVersion>>> {
    Ok(Json(state.db.call(move |connection| { db::document(connection, &id)?; db::versions(connection, &id) }).await?))
}

pub async fn get_version(State(state): State<AppState>, Path((id, version)): Path<(String, i64)>) -> Result<Json<DocumentVersion>> {
    Ok(Json(state.db.call(move |connection| db::version(connection, &id, version)).await?))
}

#[derive(Deserialize)]
pub struct RestoreInput { pub expected_version: i64, pub version: i64 }

pub async fn restore_version(State(state): State<AppState>, Path(id): Path<String>, Json(input): Json<RestoreInput>) -> Result<Json<Document>> {
    Ok(Json(state.db.call(move |connection| {
        let transaction = connection.transaction()?;
        let mut document = db::document(&transaction, &id)?;
        let version = db::version(&transaction, &id, input.version)?;
        document.content = version.content;
        document.title = version.title;
        db::revise(&transaction, &mut document, input.expected_version, &format!("restore:{}", input.version))?;
        transaction.commit()?;
        Ok(document)
    }).await?))
}

pub async fn create_canvas(State(state): State<AppState>, Path(workspace_id): Path<String>, Json(input): Json<NameInput>) -> Result<(StatusCode, Json<Canvas>)> {
    let result = state.db.call(move |connection| {
        db::workspace(connection, &workspace_id)?;
        let canvas = Canvas { id: id(), workspace_id, name: input.name, revision: 1, objects: vec![], editor_state: None, updated_at: now() };
        db::insert_canvas(connection, &canvas)?;
        Ok(canvas)
    }).await?;
    Ok((StatusCode::CREATED, Json(result)))
}

pub async fn get_canvas(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Canvas>> {
    Ok(Json(state.db.call(move |connection| db::canvas(connection, &id)).await?))
}

#[derive(Deserialize)]
pub struct CanvasUpdate {
    pub expected_revision: i64,
    pub name: String,
    pub objects: Vec<CanvasObject>,
    pub editor_state: Option<Value>,
}

pub async fn update_canvas(State(state): State<AppState>, Path(id): Path<String>, Json(input): Json<CanvasUpdate>) -> Result<Json<Canvas>> {
    Ok(Json(state.db.call(move |connection| {
        let transaction = connection.transaction()?;
        let mut canvas = db::canvas(&transaction, &id)?;
        if canvas.revision != input.expected_revision { return Err(ApiError::conflict(canvas.revision)); }
        let mut object_ids = HashSet::new();
        let mut document_ids = HashSet::new();
        let objects = match &input.editor_state { Some(editor_state) => crate::canvas_state::project(editor_state)?, None => input.objects };
        for object in &objects {
            if object.id.is_empty() || !object_ids.insert(&object.id) { return Err(ApiError::invalid("画布对象标识需要唯一且非空")); }
            if object.width < 0.0 || object.height < 0.0 { return Err(ApiError::invalid("画布对象尺寸应为非负数")); }
            if document_ids.insert(&object.document_id) { db::scoped_document(&transaction, &object.document_id, &canvas.workspace_id)?; }
        }
        canvas.name = input.name;
        canvas.objects = objects;
        if canvas.editor_state.is_some() && input.editor_state.is_none() { return Err(ApiError::invalid("当前画布需要完整 editor_state，以保留自由对象和连线")); }
        canvas.editor_state = input.editor_state;
        canvas.revision += 1;
        canvas.updated_at = now();
        transaction.execute("UPDATE canvases SET name=?,revision=?,objects=?,editor_state=?,updated_at=? WHERE id=?", params![canvas.name, canvas.revision, db::encode(&canvas.objects)?, canvas.editor_state.as_ref().map(db::encode).transpose()?, canvas.updated_at, canvas.id])?;
        db::touch(&transaction, &canvas.workspace_id)?;
        transaction.commit()?;
        Ok(canvas)
    }).await?))
}

#[derive(Deserialize, Default)]
pub struct RelationInput {
    pub source_id: Option<String>, pub target_id: Option<String>,
    pub source_ref: Option<crate::endpoints::ResearchEndpoint>,
    pub target_ref: Option<crate::endpoints::ResearchEndpoint>,
    pub kind: Option<String>, pub label: Option<String>,
    pub include_in_context: Option<bool>, pub context_order: Option<i64>,
    pub claim: Option<Claim>,
    pub expected_claim_revision: Option<i64>,
}

fn validate_relation(connection: &rusqlite::Connection, relation: &Relation) -> Result<()> {
    if relation.include_in_context {
        if relation.source_ref.as_ref().is_some_and(|reference| !matches!(reference, crate::endpoints::ResearchEndpoint::Document { .. })) || relation.target_ref.as_ref().is_some_and(|reference| !matches!(reference, crate::endpoints::ResearchEndpoint::Document { .. })) { return Err(ApiError::invalid("旧版上下文连线用于文稿端点，精确材料通过上下文选择提交")); }
        let documents = db::documents(connection, &relation.workspace_id)?;
        let mut relations = db::relations(connection, &relation.workspace_id)?;
        relations.retain(|existing| existing.id != relation.id);
        relations.push(relation.clone());
        research::context_order(std::slice::from_ref(&relation.target_id), &documents, &relations)?;
    }
    Ok(())
}

pub async fn create_relation(State(state): State<AppState>, Path(workspace_id): Path<String>, Json(mut input): Json<RelationInput>) -> Result<(StatusCode, Json<Relation>)> {
    if let Some(claim) = input.claim.as_mut() {
        if crate::claim::needs_evidence(&claim.status) { return Err(ApiError::invalid("请通过研究状态确认接口提交证据和人工确认")); }
        claim.revision = 1;
        claim.reviews.clear();
        claim.review_required = false;
    }
    let result = state.db.call(move |connection| {
        let transaction = connection.transaction()?;
        let (source_id, source_ref) = crate::endpoints::input(&transaction, &workspace_id, input.source_id, input.source_ref)?;
        let (target_id, target_ref) = crate::endpoints::input(&transaction, &workspace_id, input.target_id, input.target_ref)?;
        let relation = Relation {
            id: id(), workspace_id,
            source_id, target_id, source_ref, target_ref,
            kind: input.kind.unwrap_or_else(|| "association".into()), label: input.label.unwrap_or_default(),
            include_in_context: input.include_in_context.unwrap_or(false), context_order: input.context_order.unwrap_or(0),
            claim: input.claim, created_at: now(),
        };
        validate_relation(&transaction, &relation)?;
        db::insert_relation(&transaction, &relation)?;
        db::touch(&transaction, &relation.workspace_id)?;
        transaction.commit()?;
        Ok(relation)
    }).await?;
    Ok((StatusCode::CREATED, Json(result)))
}

pub async fn update_relation(State(state): State<AppState>, Path(id): Path<String>, Json(mut input): Json<RelationInput>) -> Result<Json<Relation>> {
    Ok(Json(state.db.call(move |connection| {
        let transaction = connection.transaction()?;
        let mut relation = db::relation(&transaction, &id)?;
        let previous = relation.claim.clone();
        if let Some(claim) = &previous {
            if input.expected_claim_revision.is_some_and(|revision| revision != claim.revision) || (!claim.reviews.is_empty() && input.expected_claim_revision.is_none()) { return Err(ApiError::conflict(claim.revision)); }
        }
        if let Some(claim) = input.claim.as_mut() {
            if crate::claim::needs_evidence(&claim.status) && previous.as_ref().is_none_or(|old| old.status != claim.status) { return Err(ApiError::invalid("请通过研究状态确认接口提交证据和人工确认")); }
            claim.reviews = previous.as_ref().map(|old| old.reviews.clone()).unwrap_or_default();
        }
        if input.source_ref.is_some() || input.source_id.as_ref().is_some_and(|id| id != &relation.source_id) {
            (relation.source_id, relation.source_ref) = crate::endpoints::input(&transaction, &relation.workspace_id, input.source_id, input.source_ref)?;
        }
        if input.target_ref.is_some() || input.target_id.as_ref().is_some_and(|id| id != &relation.target_id) {
            (relation.target_id, relation.target_ref) = crate::endpoints::input(&transaction, &relation.workspace_id, input.target_id, input.target_ref)?;
        }
        if let Some(value) = input.kind { relation.kind = value; }
        if let Some(value) = input.label { relation.label = value; }
        if let Some(value) = input.include_in_context { relation.include_in_context = value; }
        if let Some(value) = input.context_order { relation.context_order = value; }
        if input.claim.is_some() { relation.claim = input.claim; }
        if let Some(claim) = relation.claim.as_mut() { claim.revision = previous.as_ref().map_or(1, |old| old.revision + 1); }
        crate::claim::refresh(&transaction, &mut relation)?;
        validate_relation(&transaction, &relation)?;
        transaction.execute("UPDATE relations SET source_id=?,target_id=?,kind=?,label=?,include_in_context=?,context_order=?,claim=?,source_ref=?,target_ref=? WHERE id=?", params![relation.source_id, relation.target_id, relation.kind, relation.label, relation.include_in_context, relation.context_order, relation.claim.as_ref().map(db::encode).transpose()?, relation.source_ref.as_ref().map(db::encode).transpose()?, relation.target_ref.as_ref().map(db::encode).transpose()?, relation.id])?;
        db::touch(&transaction, &relation.workspace_id)?;
        transaction.commit()?;
        Ok(relation)
    }).await?))
}

pub async fn delete_relation(State(state): State<AppState>, Path(id): Path<String>) -> Result<StatusCode> {
    state.db.call(move |connection| {
        let relation = db::relation(connection, &id)?;
        connection.execute("DELETE FROM relations WHERE id=?", [id])?;
        db::touch(connection, &relation.workspace_id)
    }).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct AnchorInput {
    pub document_id: String, pub version: i64, pub block_id: String,
    pub quote: String, pub start_utf16: Option<usize>,
}

pub async fn create_anchor(State(state): State<AppState>, Path(workspace_id): Path<String>, Json(input): Json<AnchorInput>) -> Result<(StatusCode, Json<Anchor>)> {
    if input.quote.is_empty() { return Err(ApiError::invalid("引用片段不能为空")); }
    let result = state.db.call(move |connection| {
        db::scoped_document(connection, &input.document_id, &workspace_id)?;
        let version = db::version(connection, &input.document_id, input.version)?;
        let block = version.content.blocks.iter().find(|block| block.id == input.block_id).ok_or_else(|| ApiError::invalid("来源版本中缺少该文本块"))?;
        let start = if let Some(start) = input.start_utf16 {
            if !research::quote_at(&block.text, start, &input.quote) { return Err(ApiError::invalid("选段与指定版本及偏移处的原文不一致")); }
            start
        } else {
            let matches: Vec<_> = block.text.match_indices(&input.quote).collect();
            if matches.len() != 1 { return Err(ApiError::invalid("请提供选段的 UTF-16 偏移以明确来源位置")); }
            block.text[..matches[0].0].encode_utf16().count()
        };
        let byte = research::utf16_to_byte(&block.text, start).ok_or_else(|| ApiError::invalid("选段偏移无效"))?;
        let prefix = block.text[..byte].chars().rev().take(32).collect::<Vec<_>>().into_iter().rev().collect();
        let suffix = block.text[byte + input.quote.len()..].chars().take(32).collect();
        let anchor = Anchor { id: id(), workspace_id, document_id: input.document_id, version: input.version, block_id: input.block_id, quote: input.quote, start_utf16: start, prefix, suffix, page: block.page, created_at: now() };
        db::insert_anchor(connection, &anchor)?;
        Ok(anchor)
    }).await?;
    Ok((StatusCode::CREATED, Json(result)))
}

pub async fn get_anchor(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Anchor>> {
    Ok(Json(state.db.call(move |connection| db::anchor(connection, &id)).await?))
}

pub async fn resolve_anchor(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<AnchorResolution>> {
    Ok(Json(state.db.call(move |connection| {
        let anchor = db::anchor(connection, &id)?;
        Ok(research::resolve_anchor(&anchor, &db::document(connection, &anchor.document_id)?))
    }).await?))
}

pub use crate::context::ContextInput;

pub async fn create_context(State(state): State<AppState>, Path(workspace_id): Path<String>, Json(input): Json<ContextInput>) -> Result<(StatusCode, Json<Context>)> {
    let prompt = state.config.prompts.get(&db::enum_name(&input.mode)?).cloned().ok_or_else(|| ApiError::internal("提示词配置缺失"))?;
    let result = state.db.call(move |connection| {
        let transaction = connection.transaction()?;
        let context = crate::context::build(&transaction, workspace_id, input, prompt, vec![], None)?;
        db::insert_context(&transaction, &context)?;
        transaction.commit()?;
        Ok(context)
    }).await?;
    Ok((StatusCode::CREATED, Json(result)))
}

pub async fn get_context(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Context>> {
    Ok(Json(state.db.call(move |connection| db::context(connection, &id)).await?))
}

pub async fn get_run(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Run>> {
    let live = state.runs.lock().await.get(&id).map(|control| control.progress.borrow().run.clone());
    let mut run = match live {
        Some(run) => run,
        None => state.db.call(move |connection| db::run(connection, &id)).await?,
    };
    crate::math_text::normalize_run(&mut run);
    Ok(Json(run))
}

pub async fn list_runs(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Vec<Run>>> {
    let mut runs = state.db.call(move |connection| {
        db::workspace(connection, &id)?;
        let mut statement = connection.prepare("SELECT * FROM runs WHERE workspace_id=? ORDER BY created_at DESC,id")?;
        Ok(statement.query_map([id], db::run_row)?.collect::<rusqlite::Result<Vec<_>>>()?)
    }).await?;
    let controls = state.runs.lock().await;
    for run in &mut runs {
        if let Some(control) = controls.get(&run.id) { *run = control.progress.borrow().run.clone(); }
    }
    drop(controls);
    for run in &mut runs { crate::math_text::normalize_run(run); }
    Ok(Json(runs))
}

pub async fn cancel_run(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Run>> {
    if let Some(control) = state.runs.lock().await.get(&id) {
        control.cancel.cancel();
        return Ok(Json(control.progress.borrow().run.clone()));
    }
    get_run(State(state), Path(id)).await
}

pub async fn run_events(State(state): State<AppState>, Path(id): Path<String>) -> Result<Sse<impl futures_util::Stream<Item = std::result::Result<Event, Infallible>>>> {
    let receiver = if let Some(control) = state.runs.lock().await.get(&id) {
        control.progress.subscribe()
    } else {
        let run = state.db.call(move |connection| db::run(connection, &id)).await?;
        let (sender, receiver) = tokio::sync::watch::channel(RunProgress { sequence: 0, run });
        drop(sender);
        receiver
    };
    let stream = WatchStream::new(receiver).map(|mut progress| {
        crate::math_text::normalize_run(&mut progress.run);
        // 结构中只有可序列化的 JSON 数据，失败时关闭连接并记录错误。
        let event = Event::default().event("progress").id(progress.sequence.to_string()).json_data(&progress);
        match event {
            Ok(event) => Ok(event),
            Err(error) => { tracing::error!(%error, "SSE 状态序列化失败"); Ok(Event::default().event("error").data("状态序列化失败")) }
        }
    });
    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15))))
}

pub async fn get_proposal(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Proposal>> {
    Ok(Json(state.db.call(move |connection| db::proposal(connection, &id)).await?))
}

#[derive(Deserialize)]
pub struct ExpectedVersion { pub expected_version: i64 }

pub async fn apply_proposal(State(state): State<AppState>, Path(id): Path<String>, Json(input): Json<ExpectedVersion>) -> Result<Json<Value>> {
    Ok(Json(state.db.call(move |connection| {
        let transaction = connection.transaction()?;
        let mut proposal = db::proposal(&transaction, &id)?;
        if proposal.status != ProposalStatus::Pending { return Err(ApiError::invalid("该提案已处理")); }
        let anchor = db::anchor(&transaction, &proposal.anchor_id)?;
        let mut document = db::document(&transaction, &anchor.document_id)?;
        if document.current_version != input.expected_version { return Err(ApiError::conflict(document.current_version)); }
        research::replace_excerpt(&mut document, &anchor, &proposal.replacement)?;
        proposal.previous_version = Some(document.current_version);
        db::revise(&transaction, &mut document, input.expected_version, &format!("proposal:{}", proposal.id))?;
        proposal.status = ProposalStatus::Applied;
        proposal.applied_version = Some(document.current_version);
        db::update_proposal(&transaction, &proposal)?;
        transaction.commit()?;
        Ok(json!({"proposal":proposal,"document":document}))
    }).await?))
}

pub async fn revert_proposal(State(state): State<AppState>, Path(id): Path<String>, Json(input): Json<ExpectedVersion>) -> Result<Json<Value>> {
    Ok(Json(state.db.call(move |connection| {
        let transaction = connection.transaction()?;
        let mut proposal = db::proposal(&transaction, &id)?;
        if proposal.status != ProposalStatus::Applied { return Err(ApiError::invalid("提案当前未处于已应用状态")); }
        let anchor = db::anchor(&transaction, &proposal.anchor_id)?;
        let mut document = db::document(&transaction, &anchor.document_id)?;
        if document.current_version != input.expected_version || Some(document.current_version) != proposal.applied_version { return Err(ApiError::conflict(document.current_version)); }
        let previous = db::version(&transaction, &document.id, proposal.previous_version.ok_or_else(|| ApiError::internal("提案缺少原版本"))?)?;
        document.content = previous.content;
        document.title = previous.title;
        db::revise(&transaction, &mut document, input.expected_version, &format!("revert-proposal:{}", proposal.id))?;
        proposal.status = ProposalStatus::Reverted;
        db::update_proposal(&transaction, &proposal)?;
        transaction.commit()?;
        Ok(json!({"proposal":proposal,"document":document}))
    }).await?))
}

pub async fn reject_proposal(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Proposal>> {
    Ok(Json(state.db.call(move |connection| {
        let mut proposal = db::proposal(connection, &id)?;
        if proposal.status != ProposalStatus::Pending { return Err(ApiError::invalid("该提案已处理")); }
        proposal.status = ProposalStatus::Rejected;
        db::update_proposal(connection, &proposal)?;
        Ok(proposal)
    }).await?))
}

#[derive(Deserialize)]
pub struct SearchInput { pub q: String, pub limit: Option<usize> }

pub async fn search(State(state): State<AppState>, Path(id): Path<String>, Query(input): Query<SearchInput>) -> Result<Json<Vec<Value>>> {
    if input.q.trim().is_empty() { return Ok(Json(vec![])); }
    Ok(Json(state.db.call(move |connection| {
        db::workspace(connection, &id)?;
        Ok(research::search(&db::documents(connection, &id)?, &input.q, input.limit.unwrap_or(20)))
    }).await?))
}
