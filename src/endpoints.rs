use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::{db, error::{ApiError, Result}, model::*, scene::{SceneKind, SceneObject, SceneSnapshot}};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ResearchEndpoint {
    Document { id: String },
    Anchor { id: String },
    CanvasObject { context_id: String, canvas_id: String, instance_id: String },
}

impl ResearchEndpoint {
    pub fn identifier(&self) -> String {
        match self {
            Self::Document { id } | Self::Anchor { id } => id.clone(),
            Self::CanvasObject { context_id, canvas_id, instance_id } => format!("scene:{context_id}:{canvas_id}:{instance_id}"),
        }
    }
}

fn scene_object<'a>(context: &'a Context, canvas_id: &str, instance_id: &str) -> Result<(&'a SceneSnapshot, &'a SceneObject)> {
    for scene in context.scenes.iter().rev().filter(|scene| scene.canvas_id == canvas_id) {
        if let Some(object) = scene.objects.iter().find(|object| object.id == instance_id) { return Ok((scene, object)); }
    }
    Err(ApiError::invalid("关系端点未包含在指定的冻结场景中"))
}

pub fn from_scene(context: &Context, instance_id: &str) -> Result<ResearchEndpoint> {
    let scene = context.scenes.last().ok_or_else(|| ApiError::invalid("关系端点缺少场景"))?;
    let (_, object) = scene_object(context, &scene.canvas_id, instance_id)?;
    if let Some(id) = &object.anchor_id { return Ok(ResearchEndpoint::Anchor { id: id.clone() }); }
    if let Some(id) = &object.document_id { return Ok(ResearchEndpoint::Document { id: id.clone() }); }
    if !matches!(object.kind, SceneKind::Idea | SceneKind::Text | SceneKind::Shape) { return Err(ApiError::invalid("该画布对象尚无可引用的研究内容")); }
    Ok(ResearchEndpoint::CanvasObject { context_id: context.id.clone(), canvas_id: scene.canvas_id.clone(), instance_id: instance_id.to_owned() })
}

pub fn validate(connection: &Connection, workspace_id: &str, endpoint: &ResearchEndpoint) -> Result<()> {
    match endpoint {
        ResearchEndpoint::Document { id } => { db::scoped_document(connection, id, workspace_id)?; }
        ResearchEndpoint::Anchor { id } => {
            if db::anchor(connection, id)?.workspace_id != workspace_id { return Err(ApiError::invalid("关系端点的片段属于其他工作区")); }
        }
        ResearchEndpoint::CanvasObject { context_id, canvas_id, instance_id } => {
            let context = db::context(connection, context_id)?;
            if context.workspace_id != workspace_id || db::canvas(connection, canvas_id)?.workspace_id != workspace_id { return Err(ApiError::invalid("关系端点的场景属于其他工作区")); }
            let (_, object) = scene_object(&context, canvas_id, instance_id)?;
            if !matches!(object.kind, SceneKind::Idea | SceneKind::Text | SceneKind::Shape) || object.document_id.is_some() || object.anchor_id.is_some() { return Err(ApiError::invalid("场景端点用于自由想法；文稿和片段使用相应的内容标识")); }
        }
    }
    Ok(())
}

pub fn input(connection: &Connection, workspace_id: &str, id: Option<String>, reference: Option<ResearchEndpoint>) -> Result<(String, Option<ResearchEndpoint>)> {
    if let Some(reference) = reference {
        validate(connection, workspace_id, &reference)?;
        let resolved = reference.identifier();
        if id.as_ref().is_some_and(|id| id != &resolved) { return Err(ApiError::invalid("关系端点标识与类型引用不一致")); }
        Ok((resolved, Some(reference)))
    } else {
        let id = id.ok_or_else(|| ApiError::invalid("缺少关系端点"))?;
        db::scoped_document(connection, &id, workspace_id)?;
        Ok((id, None))
    }
}

pub fn validate_archive(archive: &WorkspaceArchive, id: &str, reference: Option<&ResearchEndpoint>) -> Result<()> {
    let default = ResearchEndpoint::Document { id: id.to_owned() };
    let endpoint = reference.unwrap_or(&default);
    if endpoint.identifier() != id { return Err(ApiError::invalid("归档关系端点标识不一致")); }
    match endpoint {
        ResearchEndpoint::Document { id } => {
            if !archive.documents.iter().any(|document| &document.id == id) { return Err(ApiError::invalid("归档关系引用了缺失的文稿")); }
        }
        ResearchEndpoint::Anchor { id } => {
            if !archive.anchors.iter().any(|anchor| &anchor.id == id) { return Err(ApiError::invalid("归档关系引用了缺失的片段")); }
        }
        ResearchEndpoint::CanvasObject { context_id, canvas_id, instance_id } => {
            let context = archive.contexts.iter().find(|context| &context.id == context_id).ok_or_else(|| ApiError::invalid("归档关系的场景来源缺失"))?;
            let (_, object) = scene_object(context, canvas_id, instance_id)?;
            if !archive.canvases.iter().any(|canvas| &canvas.id == canvas_id) || !matches!(object.kind, SceneKind::Idea | SceneKind::Text | SceneKind::Shape) || object.document_id.is_some() || object.anchor_id.is_some() { return Err(ApiError::invalid("归档场景端点无效")); }
        }
    }
    Ok(())
}

pub fn archive_label(archive: &WorkspaceArchive, id: &str, reference: Option<&ResearchEndpoint>) -> Result<(String, String)> {
    let default = ResearchEndpoint::Document { id: id.to_owned() };
    match reference.unwrap_or(&default) {
        ResearchEndpoint::Document { id } => {
            let document = archive.documents.iter().find(|document| &document.id == id).ok_or_else(|| ApiError::invalid("关系文稿缺失"))?;
            Ok((document.title.clone(), format!("文稿 · 版本 {}", document.current_version)))
        }
        ResearchEndpoint::Anchor { id } => {
            let anchor = archive.anchors.iter().find(|anchor| &anchor.id == id).ok_or_else(|| ApiError::invalid("关系片段缺失"))?;
            Ok((anchor.quote.clone(), format!("选段 · 版本 {}{}", anchor.version, anchor.page.map(|page| format!(" · 第 {page} 页")).unwrap_or_default())))
        }
        ResearchEndpoint::CanvasObject { context_id, canvas_id, instance_id } => {
            let context = archive.contexts.iter().find(|context| &context.id == context_id).ok_or_else(|| ApiError::invalid("关系场景缺失"))?;
            let (scene, object) = scene_object(context, canvas_id, instance_id)?;
            Ok((if object.text.is_empty() { object.label.clone() } else { object.text.clone() }, format!("画布想法 · 布局版本 {}", scene.revision)))
        }
    }
}
