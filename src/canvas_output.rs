use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;

use crate::{canvas_proposal::{CanvasAction, Endpoint, GeneratedProposal}, error::Result, model::DocumentKind, scene::Bounds};

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct ToolOutput {
    #[schemars(description = "Markdown 分析正文。公式字段值中的命令使用单个反斜杠，例如 $A \\leftrightarrow B$；JSON 序列化由工具协议处理。")]
    answer: String,
    #[serde(default)] create_documents: Vec<CreateDocument>,
    #[serde(default)] move_objects: Vec<MoveObject>,
    #[serde(default)] replace_excerpts: Vec<ReplaceExcerpt>,
    #[serde(default)] create_relations: Vec<CreateRelation>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
enum NoteKind { Note, Discussion }

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct CreateDocument {
    key: String, title: String,
    #[schemars(description = "Markdown 文稿。LaTeX 命令在字段值中保留单个反斜杠，矩阵换行使用两个反斜杠。JSON 传输转义由工具协议完成。")]
    text: String, kind: NoteKind, bounds: Bounds,
    #[serde(default)] source_numbers: Vec<usize>,
    #[serde(default)] source_object_ids: Vec<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct MoveObject { object_id: String, bounds: Bounds }

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct ReplaceExcerpt { anchor_id: String, expected_version: i64, replacement: String }

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
enum EndpointKind { Document, Created, Anchor, Scene }

impl EndpointKind {
    fn reference(self, value: String) -> Endpoint {
        match self {
            Self::Document => Endpoint::Document { id: value },
            Self::Created => Endpoint::Created { key: value },
            Self::Anchor => Endpoint::Anchor { id: value },
            Self::Scene => Endpoint::Scene { object_id: value },
        }
    }
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct CreateRelation {
    key: String, source_kind: EndpointKind, source_id: String,
    target_kind: EndpointKind, target_id: String, label: String,
    #[serde(default)] mapping: String,
    #[serde(default)] preserved_operations: Vec<String>,
    #[serde(default)] conditions: String,
    #[serde(default)] counterexamples: String,
    #[serde(default)] missing_proof: String,
    #[serde(default)] next_validation: String,
    #[serde(default)] source_numbers: Vec<usize>,
}

pub fn tool_schema() -> Result<Value> {
    let schema = schemars::generate::SchemaSettings::draft07().with(|settings| {
        settings.inline_subschemas = true;
        settings.meta_schema = None;
    }).into_generator().into_root_schema_for::<ToolOutput>();
    Ok(serde_json::to_value(schema)?)
}

pub fn decode_json(text: &str) -> std::result::Result<GeneratedProposal, serde_json::Error> {
    let value: Value = serde_json::from_str(text)?;
    if value.get("actions").is_some() { return serde_json::from_value(value); }
    let output: ToolOutput = serde_json::from_value(value)?;
    let mut actions = Vec::new();
    for item in output.create_documents {
        actions.push(CanvasAction::CreateDocument { key: item.key, title: item.title, text: item.text, kind: match item.kind { NoteKind::Note => DocumentKind::Note, NoteKind::Discussion => DocumentKind::Discussion }, bounds: item.bounds, source_numbers: item.source_numbers, source_object_ids: item.source_object_ids });
    }
    for item in output.move_objects { actions.push(CanvasAction::MoveObject { object_id: item.object_id, bounds: item.bounds }); }
    for item in output.replace_excerpts { actions.push(CanvasAction::ReplaceExcerpt { anchor_id: item.anchor_id, expected_version: item.expected_version, replacement: item.replacement }); }
    for item in output.create_relations {
        actions.push(CanvasAction::CreateRelation { key: item.key, source: item.source_kind.reference(item.source_id), target: item.target_kind.reference(item.target_id), label: item.label, conditions: item.conditions, counterexamples: item.counterexamples, source_numbers: item.source_numbers, mapping: item.mapping, preserved_operations: item.preserved_operations, missing_proof: item.missing_proof, next_validation: item.next_validation });
    }
    Ok(GeneratedProposal { answer: output.answer, actions })
}
