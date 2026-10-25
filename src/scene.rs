use std::collections::HashSet;

use axum::{Json, extract::{Path, State}, http::StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{AppState, context::{self, ContextInput}, db, error::{ApiError, Result}, model::*};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Bounds { pub x: f64, pub y: f64, pub width: f64, pub height: f64 }

impl Bounds {
    pub fn validate(&self) -> Result<()> {
        if ![self.x, self.y, self.width, self.height].iter().all(|value| value.is_finite()) || self.width < 0.0 || self.height < 0.0 {
            return Err(ApiError::invalid("画布位置需要有限数值，尺寸应为非负数"));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SceneKind { Document, Fragment, Idea, Text, Shape, Frame, Group, Drawing, Connector, Discussion, Image }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ReadScope { #[default] Reference, Excerpt, Full, Inline }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SceneObject {
    pub id: String,
    pub kind: SceneKind,
    pub bounds: Option<Bounds>,
    #[serde(default)] pub rotation: f64,
    #[serde(default)] pub parent_id: Option<String>,
    #[serde(default)] pub document_id: Option<String>,
    #[serde(default)] pub version: Option<i64>,
    #[serde(default)] pub anchor_id: Option<String>,
    #[serde(default)] pub relation_id: Option<String>,
    #[serde(default)] pub source_id: Option<String>,
    #[serde(default)] pub target_id: Option<String>,
    #[serde(default)] pub text: String,
    #[serde(default)] pub label: String,
    #[serde(default)] pub parent_ids: Vec<String>,
    #[serde(default)] pub child_ids: Vec<String>,
    #[serde(default)] pub formulas: Vec<String>,
    #[serde(default)] pub source_point: Option<[f64; 2]>,
    #[serde(default)] pub target_point: Option<[f64; 2]>,
    #[serde(default)] pub unreadable: Option<String>,
    #[serde(default)] pub read_scope: ReadScope,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct WriteScope {
    #[serde(default)] pub allow_create: bool,
    #[serde(default)] pub object_ids: Vec<String>,
    #[serde(default)] pub bounds: Option<Bounds>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SceneSnapshot {
    pub canvas_id: String,
    pub revision: i64,
    pub objects: Vec<SceneObject>,
    pub relations: Vec<Relation>,
    pub write_scope: WriteScope,
    #[serde(default)] pub viewport: Option<Value>,
    #[serde(default)] pub entry: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SceneContextInput {
    pub question: String,
    #[serde(default)] pub mode: ResearchMode,
    pub canvas_id: String,
    pub expected_revision: i64,
    pub objects: Vec<SceneObject>,
    #[serde(default)] pub document_ids: Vec<String>,
    #[serde(default)] pub anchor_ids: Vec<String>,
    #[serde(default)] pub inherit_context_ids: Vec<String>,
    #[serde(default)] pub write_scope: WriteScope,
    #[serde(default)] pub viewport: Option<Value>,
    #[serde(default)] pub entry: Option<String>,
    #[serde(default)] pub frozen_sources: Vec<context::FrozenSource>,
    #[serde(default = "default_inherit")] pub inherit_discussion_sources: bool,
}

fn default_inherit() -> bool { true }

#[derive(Deserialize)]
#[serde(untagged)]
pub enum SceneRequest {
    Projection(crate::scene_projection::ProjectionInput),
    Objects(SceneContextInput),
}

pub async fn capabilities(State(state): State<AppState>) -> Json<Value> {
    Json(json!({"scene_context":1,"frozen_inheritance":true,"canvas_proposals":if state.config.prompts.contains_key("canvas") { 2 } else { 0 },"canvas_proposal_recovery":1,"claim_reviews":1,"claim_research_plan":1,"relation_endpoints":1,"api_version":2}))
}

pub async fn api_not_found() -> ApiError { ApiError::missing("API 路径") }

pub async fn create_context(State(state): State<AppState>, Path(workspace_id): Path<String>, Json(input): Json<SceneRequest>) -> Result<(StatusCode, Json<Context>)> {
    let prompts = state.config.prompts.clone();
    let context = state.db.call(move |connection| {
        let transaction = connection.transaction()?;
        let mut input = match input {
            SceneRequest::Projection(input) => input.normalize(&transaction, &workspace_id)?,
            SceneRequest::Objects(input) => input,
        };
        let prompt = prompts.get(&db::enum_name(&input.mode)?).cloned().ok_or_else(|| ApiError::invalid("服务尚未配置此模式的提示词"))?;
        let canvas = db::canvas(&transaction, &input.canvas_id)?;
        if canvas.workspace_id != workspace_id { return Err(ApiError::invalid("画布属于其他工作区")); }
        if canvas.revision != input.expected_revision { return Err(ApiError::conflict(canvas.revision)); }
        let mut ids = HashSet::new();
        let mut sources = Vec::new();
        let mut relations = Vec::new();
        for object in &mut input.objects {
            if object.id.is_empty() || !ids.insert(object.id.clone()) { return Err(ApiError::invalid("场景对象标识需要唯一且非空")); }
            if let Some(bounds) = &object.bounds { bounds.validate()?; }
            if !object.rotation.is_finite() { return Err(ApiError::invalid("旋转角度需要有限数值")); }
            if let Some(id) = &object.document_id { db::scoped_document(&transaction, id, &workspace_id)?; }
            if let Some(id) = object.anchor_id.as_ref().filter(|_| object.read_scope != ReadScope::Excerpt) {
                let anchor = db::anchor(&transaction, id)?;
                if anchor.workspace_id != workspace_id || object.document_id.as_ref().is_some_and(|id| id != &anchor.document_id) || object.version.is_some_and(|version| version != anchor.version) { return Err(ApiError::invalid("场景片段实例与锚点来源不一致")); }
            }
            match object.read_scope {
                ReadScope::Excerpt => {
                    let anchor_id = object.anchor_id.as_ref().ok_or_else(|| ApiError::invalid("片段阅读需要锚点"))?;
                    let source = context::source_for_anchor(&transaction, &workspace_id, anchor_id)?;
                    if object.document_id.as_ref().is_some_and(|id| id != &source.document_id) || object.version.is_some_and(|version| version != source.version) { return Err(ApiError::invalid("片段对象与锚点来源不一致")); }
                    object.document_id = Some(source.document_id.clone());
                    object.version = Some(source.version);
                    object.text.clear();
                    sources.push(source);
                }
                ReadScope::Full => {
                    let id = object.document_id.as_ref().ok_or_else(|| ApiError::invalid("全文阅读需要文稿标识"))?;
                    let document = db::document(&transaction, id)?;
                    if document.kind == DocumentKind::Discussion && input.inherit_discussion_sources {
                        let parent = document.metadata.get("context_id").and_then(Value::as_str).ok_or_else(|| ApiError::invalid("所选讨论缺少来源快照，请补选来源材料"))?;
                        input.inherit_context_ids.push(parent.to_owned());
                    }
                    let source = context::source_for_document(&transaction, &workspace_id, id, object.version)?;
                    object.version = Some(source.version);
                    object.text.clear();
                    sources.push(source);
                }
                ReadScope::Inline => {
                    if object.document_id.is_some() || object.anchor_id.is_some() { return Err(ApiError::invalid("文稿引用应明确选择片段、全文或定位范围")); }
                }
                ReadScope::Reference => { object.text.clear(); object.formulas.clear(); }
            }
            if let Some(id) = &object.relation_id {
                let relation = db::relation(&transaction, id)?;
                if relation.workspace_id != workspace_id { return Err(ApiError::invalid("研究关系属于其他工作区")); }
                if !relations.iter().any(|existing: &Relation| existing.id == relation.id) { relations.push(relation); }
            }
        }
        if let Some(bounds) = &input.write_scope.bounds { bounds.validate()?; }
        if input.write_scope.object_ids.iter().any(|id| !ids.contains(id)) { return Err(ApiError::invalid("写入对象需要包含在当前场景选择中")); }
        let snapshot = SceneSnapshot { canvas_id: canvas.id, revision: canvas.revision, objects: input.objects, relations, write_scope: input.write_scope, viewport: input.viewport, entry: input.entry };
        let request = ContextInput { question: input.question, mode: input.mode, document_ids: input.document_ids, anchor_ids: input.anchor_ids, inherit_context_ids: input.inherit_context_ids, frozen_sources: input.frozen_sources, inherit_discussion_sources: input.inherit_discussion_sources };
        let result = context::build(&transaction, workspace_id, request, prompt, sources, Some(snapshot))?;
        db::insert_context(&transaction, &result)?;
        transaction.commit()?;
        Ok(result)
    }).await?;
    Ok((StatusCode::CREATED, Json(context)))
}
