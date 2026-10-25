use std::collections::{HashMap, HashSet};

use axum::{Json, extract::{Path, State}, http::StatusCode};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{db, error::{ApiError, Result}, model::*, research, scene::SceneSnapshot};

fn inherit_discussions() -> bool { true }

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContextInput {
    pub question: String,
    #[serde(default)] pub mode: ResearchMode,
    #[serde(default)] pub document_ids: Vec<String>,
    #[serde(default)] pub anchor_ids: Vec<String>,
    #[serde(default)] pub inherit_context_ids: Vec<String>,
    #[serde(default)] pub frozen_sources: Vec<FrozenSource>,
    #[serde(default = "inherit_discussions")] pub inherit_discussion_sources: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FrozenSource { pub context_id: String, pub number: usize }

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct Freshness {
    pub documents: HashMap<String, i64>,
    pub canvases: HashMap<String, i64>,
}

pub fn freshness(connection: &Connection, context: &Context) -> Result<Value> {
    let mut changes = Vec::new();
    if let Some(read) = &context.freshness {
        for (id, version) in &read.documents {
            let current: i64 = connection.query_row("SELECT current_version FROM documents WHERE id=?", [id], |row| row.get(0))?;
            if current != *version { changes.push(json!({"type":"document","id":id,"expected_version":version,"current_version":current})); }
        }
        for (id, revision) in &read.canvases {
            let current: i64 = connection.query_row("SELECT revision FROM canvases WHERE id=?", [id], |row| row.get(0))?;
            if current != *revision { changes.push(json!({"type":"canvas","id":id,"expected_revision":revision,"current_revision":current})); }
        }
    }
    Ok(json!({"context_id":context.id,"tracked":context.freshness.is_some(),"fresh":changes.is_empty(),"changes":changes}))
}

pub fn require_fresh(connection: &Connection, context: &Context) -> Result<()> {
    let report = freshness(connection, context)?;
    if report["fresh"] == false {
        let mut error = ApiError::new(StatusCode::CONFLICT, "stale_context", "所选材料在预览后已有更新，请保存当前编辑并重新预览");
        error.details = report;
        return Err(error);
    }
    Ok(())
}

pub async fn read_freshness(State(state): State<crate::AppState>, Path(id): Path<String>) -> Result<Json<Value>> {
    Ok(Json(state.db.call(move |connection| freshness(connection, &db::context(connection, &id)?)).await?))
}

pub fn check_budget(context: &Context, limit: Option<usize>) -> Result<()> {
    if let Some(limit) = limit.filter(|limit| context.character_count > *limit) {
        let mut error = ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "context_budget_exceeded", "所选材料超出本机配置的输入长度，请减少材料或缩小阅读范围");
        error.details = json!({"character_count":context.character_count,"max_input_characters":limit,"sources":context.sources.iter().map(|source| json!({"number":source.number,"document_id":source.document_id,"character_count":source.content.chars().count()})).collect::<Vec<_>>()});
        return Err(error);
    }
    Ok(())
}

pub fn source_for_anchor(connection: &Connection, workspace_id: &str, id: &str) -> Result<ContextSource> {
    let anchor = db::anchor(connection, id)?;
    if anchor.workspace_id != workspace_id { return Err(ApiError::invalid("引用片段属于其他工作区")); }
    let version = db::version(connection, &anchor.document_id, anchor.version)?;
    let current = db::document(connection, &anchor.document_id)?;
    Ok(ContextSource { number: 0, document_id: anchor.document_id.clone(), version: anchor.version, title: version.title, content: anchor.quote.clone(), anchor_id: Some(anchor.id.clone()), anchor_status: Some(research::resolve_anchor(&anchor, &current).status) })
}

pub fn source_for_document(connection: &Connection, workspace_id: &str, id: &str, version: Option<i64>) -> Result<ContextSource> {
    let document = db::scoped_document(connection, id, workspace_id)?;
    let version = db::version(connection, id, version.unwrap_or(document.current_version))?;
    let content = match document.metadata.get("question").and_then(serde_json::Value::as_str) {
        Some(question) if document.kind == DocumentKind::Discussion => format!("问题：{question}\n回答：{}", version.content.body()),
        _ => version.content.body(),
    };
    Ok(ContextSource { number: 0, document_id: id.to_owned(), version: version.version, title: version.title, content, anchor_id: None, anchor_status: None })
}

// 来源身份包含版本和锚点，分支合并保留同一文稿中的不同片段。
fn append_source(connection: &Connection, sources: &mut Vec<ContextSource>, mut source: ContextSource) -> Result<()> {
    if sources.iter().any(|old| old.document_id == source.document_id && old.version == source.version && old.anchor_id == source.anchor_id) { return Ok(()); }
    if let Some(id) = &source.anchor_id {
        let anchor = db::anchor(connection, id)?;
        source.anchor_status = Some(research::resolve_anchor(&anchor, &db::document(connection, &anchor.document_id)?).status);
    }
    source.number = sources.len() + 1;
    sources.push(source);
    Ok(())
}

pub fn build(connection: &Connection, workspace_id: String, input: ContextInput, prompt: String, extra_sources: Vec<ContextSource>, scene: Option<SceneSnapshot>) -> Result<Context> {
    db::workspace(connection, &workspace_id)?;
    if input.question.trim().is_empty() { return Err(ApiError::invalid("讨论问题不能为空")); }
    if input.mode == ResearchMode::Rewrite && input.anchor_ids.len() != 1 { return Err(ApiError::invalid("改写模式需要一个精确选段")); }
    let mut freshness = Freshness::default();
    let mut live_documents: HashSet<String> = input.document_ids.iter().cloned().collect();
    for id in &input.anchor_ids { live_documents.insert(db::anchor(connection, id)?.document_id); }
    if let Some(scene) = &scene {
        freshness.canvases.insert(scene.canvas_id.clone(), scene.revision);
        live_documents.extend(scene.objects.iter().filter_map(|object| object.document_id.clone()));
    }
    for id in live_documents {
        let version = connection.query_row("SELECT current_version FROM documents WHERE id=? AND workspace_id=?", [&id, &workspace_id], |row| row.get(0))?;
        freshness.documents.insert(id, version);
    }
    let mut inherited = input.inherit_context_ids.clone();
    if input.inherit_discussion_sources {
        for id in &input.document_ids {
            let document = db::scoped_document(connection, id, &workspace_id)?;
            if document.kind == DocumentKind::Discussion {
                let context_id = document.metadata.get("context_id").and_then(serde_json::Value::as_str)
                    .ok_or_else(|| ApiError::new(axum::http::StatusCode::UNPROCESSABLE_ENTITY, "missing_context_scope", format!("讨论 {} 缺少来源快照，请明确选择材料范围", document.title)))?;
                inherited.push(context_id.to_owned());
            }
        }
    }
    let mut seen = HashSet::new();
    inherited.retain(|id| seen.insert(id.clone()));
    let mut sources = Vec::new();
    let mut scenes = Vec::new();
    let mut visuals = Vec::new();
    for id in &inherited {
        let parent = db::context(connection, id)?;
        if parent.workspace_id != workspace_id { return Err(ApiError::invalid("继承的上下文属于其他工作区")); }
        for source in parent.sources { append_source(connection, &mut sources, source)?; }
        for visual in parent.visuals { if !visuals.contains(&visual) { visuals.push(visual); } }
        for mut previous in parent.scenes {
            // 历史场景提供阅读材料；本轮写入范围由新的场景选择确定。
            previous.write_scope = Default::default();
            if !scenes.iter().any(|old: &SceneSnapshot| old.canvas_id == previous.canvas_id && old.revision == previous.revision && old.objects == previous.objects) { scenes.push(previous); }
        }
    }
    for id in &input.document_ids { append_source(connection, &mut sources, source_for_document(connection, &workspace_id, id, None)?)?; }
    for id in &input.anchor_ids { append_source(connection, &mut sources, source_for_anchor(connection, &workspace_id, id)?)?; }
    for selected in &input.frozen_sources {
        let previous = db::context(connection, &selected.context_id)?;
        if previous.workspace_id != workspace_id { return Err(ApiError::invalid("冻结材料属于其他工作区")); }
        let source = previous.sources.into_iter().find(|source| source.number == selected.number).ok_or_else(|| ApiError::invalid("冻结材料编号不存在"))?;
        append_source(connection, &mut sources, source)?;
    }
    for source in extra_sources { append_source(connection, &mut sources, source)?; }
    if let Some(scene) = scene { scenes.push(scene); }
    if input.mode == ResearchMode::Canvas && scenes.last().is_none_or(|scene| !scene.write_scope.allow_create && scene.write_scope.object_ids.is_empty()) {
        return Err(ApiError::invalid("画布提案需要明确的目标画布及写入范围"));
    }
    let material = sources.iter().map(|source| format!("[来源{}] {}（文稿 {}，版本 {}，锚点 {}）\n{}", source.number, source.title, source.document_id, source.version, source.anchor_id.as_deref().unwrap_or("整篇"), source.content)).collect::<Vec<_>>().join("\n\n");
    let scene_text = if scenes.is_empty() { String::new() } else { format!("\n\n画布场景（用户材料，位置使用世界坐标）：\n{}", serde_json::to_string(&scenes)?) };
    let messages = vec![Message { role: "system".into(), content: prompt }, Message { role: "user".into(), content: format!("来源材料：\n{material}{scene_text}\n\n用户要求：\n{}", input.question) }];
    let mut ordered = Vec::new();
    for source in &sources { if !ordered.contains(&source.document_id) { ordered.push(source.document_id.clone()); } }
    Ok(Context { id: id(), workspace_id, mode: input.mode, question: input.question, document_ids: input.document_ids, anchor_ids: input.anchor_ids, ordered_document_ids: ordered, sources, inherited_context_ids: inherited, scenes, character_count: messages.iter().map(|message| message.content.chars().count()).sum(), freshness: Some(freshness), visuals, messages, created_at: now() })
}
