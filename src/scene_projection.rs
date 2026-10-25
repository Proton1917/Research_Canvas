use std::collections::HashSet;

use rusqlite::Connection;
use serde::Deserialize;
use serde_json::Value;

use crate::{context::FrozenSource, db, error::{ApiError, Result}, model::ResearchMode, scene::*};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectionInput {
    pub question: String,
    #[serde(default)] pub mode: ResearchMode,
    pub projection: Projection,
    pub materials: Vec<Material>,
    #[serde(default)] pub write_scope: WriteScope,
    #[serde(default)] pub visuals: Vec<crate::visual::VisualInput>,
}

#[derive(Deserialize)]
pub struct Projection {
    workspace_id: String,
    canvas_id: String,
    canvas_revision: i64,
    entry: String,
    viewport: Value,
    objects: Vec<ProjectedObject>,
}

#[derive(Deserialize)]
struct Layout { x: f64, y: f64, width: f64, height: f64, rotate: f64 }

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Reference {
    Document { document_id: String, version: i64 },
    Anchor { anchor_id: String, document_id: String, version: i64 },
    Relation { relation_id: String },
    Editor {},
}

#[derive(Deserialize)]
struct ProjectedObject {
    instance_id: String,
    kind: String,
    #[serde(rename = "ref")] reference: Reference,
    title: String,
    text: String,
    formulas: Vec<String>,
    layout: Option<Layout>,
    parent_ids: Vec<String>,
    child_ids: Vec<String>,
    link: Option<ProjectedLink>,
    unreadable: Option<String>,
}

#[derive(Deserialize)]
struct ProjectedLink {
    label: String,
    source_instance: Option<String>,
    target_instance: Option<String>,
    source_point: Option<[f64; 2]>,
    target_point: Option<[f64; 2]>,
}

#[derive(Deserialize)]
pub struct Material {
    key: String,
    group: String,
    #[serde(rename = "objectId")] object_id: String,
    include: bool,
    legacy: Option<MaterialReference>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum MaterialReference { Anchor { anchor_id: String }, Document { document_id: String } }

impl ProjectionInput {
    pub fn normalize(self, connection: &Connection, workspace_id: &str) -> Result<SceneContextInput> {
        if self.projection.workspace_id != workspace_id { return Err(ApiError::invalid("场景投影属于其他工作区")); }
        let mut seen = HashSet::new();
        for object in &self.projection.objects {
            if !seen.insert(&object.instance_id) { return Err(ApiError::invalid("场景实例标识重复")); }
        }
        let included: Vec<_> = self.materials.iter().filter(|material| material.include).collect();
        if included.iter().any(|material| !seen.contains(&material.object_id)) { return Err(ApiError::invalid("选入材料缺少对应场景对象")); }
        let mut objects = Vec::new();
        let mut anchor_ids = Vec::new();
        let mut frozen_sources = Vec::new();
        for projected in &self.projection.objects {
            let materials: Vec<_> = included.iter().filter(|material| material.object_id == projected.instance_id).collect();
            if materials.is_empty() && !self.write_scope.object_ids.contains(&projected.instance_id) { continue; }
            let kind = match projected.kind.as_str() {
                "document" => SceneKind::Document, "fragment" => SceneKind::Fragment, "idea" => SceneKind::Idea,
                "discussion" => SceneKind::Discussion, "link" => SceneKind::Connector, "group" => SceneKind::Group,
                "frame" => SceneKind::Frame, "drawing" => SceneKind::Drawing, "image" => SceneKind::Image,
                _ => return Err(ApiError::invalid("场景对象类型不受支持")),
            };
            let mut object = SceneObject {
                id: projected.instance_id.clone(), kind, bounds: projected.layout.as_ref().map(|layout| Bounds { x: layout.x, y: layout.y, width: layout.width, height: layout.height }),
                rotation: projected.layout.as_ref().map_or(0.0, |layout| layout.rotate), parent_id: projected.parent_ids.first().cloned(), parent_ids: projected.parent_ids.clone(), child_ids: projected.child_ids.clone(),
                document_id: None, version: None, anchor_id: None, relation_id: None,
                source_id: projected.link.as_ref().and_then(|link| link.source_instance.clone()), target_id: projected.link.as_ref().and_then(|link| link.target_instance.clone()),
                source_point: projected.link.as_ref().and_then(|link| link.source_point), target_point: projected.link.as_ref().and_then(|link| link.target_point),
                text: String::new(), label: projected.link.as_ref().map_or_else(|| projected.title.clone(), |link| link.label.clone()), formulas: vec![], unreadable: projected.unreadable.clone(), read_scope: ReadScope::Reference,
            };
            match &projected.reference {
                Reference::Document { document_id, version } => { object.document_id = Some(document_id.clone()); object.version = Some(*version); }
                Reference::Anchor { anchor_id, document_id, version } => { object.document_id = Some(document_id.clone()); object.version = Some(*version); object.anchor_id = Some(anchor_id.clone()); }
                _ => {},
            }
            for material in materials {
                match &material.legacy {
                    Some(MaterialReference::Anchor { anchor_id }) => {
                        let anchor = db::anchor(connection, anchor_id)?;
                        if anchor.workspace_id != workspace_id { return Err(ApiError::invalid("选入锚点属于其他工作区")); }
                        if material.group == "body" && object.document_id.as_ref() != Some(&anchor.document_id) { return Err(ApiError::invalid("选段与场景文稿引用不一致")); }
                        anchor_ids.push(anchor_id.clone());
                        if let Reference::Anchor { anchor_id: projected_anchor, .. } = &projected.reference {
                            if projected_anchor != anchor_id { return Err(ApiError::invalid("片段卡片与所选锚点不一致")); }
                            object.anchor_id = Some(anchor_id.clone()); object.read_scope = ReadScope::Excerpt;
                        }
                    }
                    Some(MaterialReference::Document { document_id }) => {
                        if object.document_id.as_ref() != Some(document_id) { return Err(ApiError::invalid("选入正文与场景文稿引用不一致")); }
                        object.read_scope = ReadScope::Full;
                    }
                    None if material.group == "history" => {
                        let document_id = object.document_id.as_ref().ok_or_else(|| ApiError::invalid("历史来源缺少讨论文稿"))?;
                        let document = db::scoped_document(connection, document_id, workspace_id)?;
                        let context_id = document.metadata.get("context_id").and_then(Value::as_str).ok_or_else(|| ApiError::invalid("讨论缺少历史上下文，请补选来源"))?;
                        let parent = db::context(connection, context_id)?;
                        let source = parent.sources.iter().find(|source| material.key == format!("hist-doc:{}@{}", source.document_id, source.version)).ok_or_else(|| ApiError::invalid("勾选的历史材料未包含在讨论快照中"))?;
                        frozen_sources.push(FrozenSource { context_id: context_id.to_owned(), number: source.number });
                    }
                    None if material.group == "body" => match &projected.reference {
                        Reference::Relation { relation_id } => { object.relation_id = Some(relation_id.clone()); }
                        Reference::Editor {} => { object.read_scope = ReadScope::Inline; object.text = projected.text.clone(); object.formulas = projected.formulas.clone(); }
                        _ => return Err(ApiError::invalid("所选正文缺少精确材料引用")),
                    },
                    _ => {},
                }
            }
            objects.push(object);
        }
        Ok(SceneContextInput { question: self.question, mode: self.mode, canvas_id: self.projection.canvas_id, expected_revision: self.projection.canvas_revision, objects, document_ids: vec![], anchor_ids, inherit_context_ids: vec![], write_scope: self.write_scope, viewport: Some(self.projection.viewport), entry: Some(self.projection.entry), frozen_sources, inherit_discussion_sources: false, visuals: self.visuals })
    }
}
