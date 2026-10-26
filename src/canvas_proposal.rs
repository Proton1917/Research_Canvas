use std::collections::{HashMap, HashSet};

use axum::{Json, extract::{Path, State}};
use pulldown_cmark::{CodeBlockKind, Event, Parser, Tag, TagEnd};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{AppState, db, error::{ApiError, Result}, model::*, research, scene::{Bounds, SceneSnapshot}};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Endpoint {
    Document { id: String },
    Created { key: String },
    Anchor { id: String },
    Scene { object_id: String },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum CanvasAction {
    CreateDocument {
        key: String, title: String, text: String, kind: DocumentKind, bounds: Bounds,
        #[serde(default)] source_numbers: Vec<usize>,
        #[serde(default)] source_object_ids: Vec<String>,
    },
    MoveObject { object_id: String, bounds: Bounds },
    ReplaceExcerpt { anchor_id: String, expected_version: i64, replacement: String },
    CreateRelation {
        key: String, source: Endpoint, target: Endpoint, label: String,
        #[serde(default)] conditions: String,
        #[serde(default)] counterexamples: String,
        #[serde(default)] source_numbers: Vec<usize>,
        #[serde(default)] mapping: String,
        #[serde(default)] preserved_operations: Vec<String>,
        #[serde(default)] missing_proof: String,
        #[serde(default)] next_validation: String,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GeneratedProposal { pub answer: String, pub actions: Vec<CanvasAction> }


#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Application {
    pub transaction_id: String,
    pub before_canvas: Canvas,
    pub before_documents: Vec<Document>,
    pub created_document_ids: Vec<String>,
    pub canvas: Canvas,
    pub documents: Vec<Document>,
    pub relations: Vec<Relation>,
    #[serde(default)] pub reverted_canvas: Option<Canvas>,
    #[serde(default)] pub reverted_documents: Vec<Document>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CanvasProposal {
    pub id: String,
    pub workspace_id: String,
    pub run_id: String,
    pub context_id: String,
    pub canvas_id: String,
    pub canvas_revision: i64,
    pub revision: i64,
    pub status: ProposalStatus,
    pub answer: String,
    #[serde(default)] pub raw_response: String,
    #[serde(default)] pub recovered_from: Option<Value>,
    pub actions: Vec<CanvasAction>,
    pub id_map: HashMap<String, String>,
    pub created_at: String,
    pub application: Option<Application>,
}

pub fn get(connection: &Connection, id: &str) -> Result<CanvasProposal> {
    let payload: String = connection.query_row("SELECT payload FROM canvas_proposals WHERE id=?", [id], |row| row.get(0))?;
    Ok(serde_json::from_str(&payload)?)
}

pub fn insert(connection: &Connection, proposal: &CanvasProposal) -> Result<()> {
    connection.execute("INSERT INTO canvas_proposals VALUES (?,?,?,?,?)", params![proposal.id, proposal.workspace_id, proposal.run_id, db::encode(proposal)?, proposal.created_at])?;
    Ok(())
}

fn save(connection: &Connection, proposal: &CanvasProposal) -> Result<()> {
    connection.execute("UPDATE canvas_proposals SET payload=? WHERE id=?", params![db::encode(proposal)?, proposal.id])?;
    Ok(())
}

fn view(proposal: &CanvasProposal) -> Value {
    json!({"id":proposal.id,"workspace_id":proposal.workspace_id,"run_id":proposal.run_id,"context_id":proposal.context_id,"canvas_id":proposal.canvas_id,"canvas_revision":proposal.canvas_revision,"revision":proposal.revision,"status":proposal.status,"answer":crate::math_text::normalize(&proposal.answer),"actions":proposal.actions,"id_map":proposal.id_map,"created_at":proposal.created_at,"transaction_id":proposal.application.as_ref().map(|application| &application.transaction_id),"applied_revision":proposal.application.as_ref().map(|application| application.canvas.revision)})
}

fn scene(context: &Context) -> Result<&SceneSnapshot> { context.scenes.last().ok_or_else(|| ApiError::invalid("提案缺少目标场景")) }

fn check_sources(context: &Context, sources: &[usize]) -> Result<()> {
    if sources.iter().any(|number| !context.sources.iter().any(|source| source.number == *number)) { return Err(ApiError::invalid("操作引用了上下文中不存在的来源编号")); }
    Ok(())
}

fn check_bounds(scene: &SceneSnapshot, bounds: &Bounds) -> Result<()> {
    bounds.validate()?;
    if let Some(area) = &scene.write_scope.bounds {
        if bounds.x < area.x || bounds.y < area.y || bounds.x + bounds.width > area.x + area.width || bounds.y + bounds.height > area.y + area.height {
            return Err(ApiError::invalid("候选对象超出用户允许写入的区域"));
        }
    }
    Ok(())
}

fn endpoint_ref(endpoint: &Endpoint, ids: &HashMap<String, String>, context: &Context) -> Result<crate::endpoints::ResearchEndpoint> {
    use crate::endpoints::ResearchEndpoint;
    match endpoint {
        Endpoint::Document { id } => Ok(ResearchEndpoint::Document { id: id.clone() }),
        Endpoint::Created { key } => Ok(ResearchEndpoint::Document { id: ids.get(key).cloned().ok_or_else(|| ApiError::invalid("关系引用的候选文稿不存在"))? }),
        Endpoint::Anchor { id } => Ok(ResearchEndpoint::Anchor { id: id.clone() }),
        Endpoint::Scene { object_id } => crate::endpoints::from_scene(context, object_id),
    }
}

fn validate(context: &Context, actions: &[CanvasAction]) -> Result<()> {
    if actions.is_empty() { return Err(ApiError::invalid("画布提案没有操作")); }
    let scene = scene(context)?;
    let mut keys = HashSet::new();
    let mut documents = HashSet::new();
    let mut changed = HashSet::new();
    for action in actions {
        match action {
            CanvasAction::CreateDocument { key, title, kind, bounds, source_numbers, source_object_ids, .. } => {
                if !scene.write_scope.allow_create { return Err(ApiError::invalid("本次阅读范围未允许创建画布对象")); }
                if key.is_empty() || key.contains(':') || !keys.insert(key) { return Err(ApiError::invalid("候选对象 key 需要唯一、非空且不含冒号")); }
                if title.trim().is_empty() || !matches!(kind, DocumentKind::Note | DocumentKind::Discussion) { return Err(ApiError::invalid("候选文稿需要标题，类型为 note 或 discussion")); }
                documents.insert(key);
                check_bounds(scene, bounds)?;
                check_sources(context, source_numbers)?;
                if source_object_ids.iter().any(|id| !scene.objects.iter().any(|object| &object.id == id)) { return Err(ApiError::invalid("候选内容引用了场景之外的对象")); }
            }
            CanvasAction::MoveObject { object_id, bounds } => {
                if !scene.write_scope.object_ids.contains(object_id) || !changed.insert(format!("object:{object_id}")) { return Err(ApiError::invalid("移动对象超出写入范围或包含重复操作")); }
                check_bounds(scene, bounds)?;
            }
            CanvasAction::ReplaceExcerpt { anchor_id, expected_version, .. } => {
                let object = scene.objects.iter().find(|object| object.anchor_id.as_ref() == Some(anchor_id) && scene.write_scope.object_ids.contains(&object.id)).ok_or_else(|| ApiError::invalid("改写锚点超出写入范围"))?;
                let source = context.sources.iter().find(|source| source.anchor_id.as_ref() == Some(anchor_id)).ok_or_else(|| ApiError::invalid("改写锚点未包含在阅读材料中"))?;
                if *expected_version < 1 || object.document_id.as_ref() != Some(&source.document_id) || !changed.insert(format!("document:{}", source.document_id)) { return Err(ApiError::invalid("同一提案中的文稿改写需要单一、明确的版本与范围")); }
            }
            CanvasAction::CreateRelation { key, source_numbers, .. } => {
                if !scene.write_scope.allow_create || key.is_empty() || key.contains(':') || !keys.insert(key) { return Err(ApiError::invalid("候选关系需要创建权限和唯一 key")); }
                check_sources(context, source_numbers)?;
            }
        }
    }
    for action in actions {
        if let CanvasAction::CreateRelation { source, target, .. } = action {
            for endpoint in [source, target] {
                match endpoint {
                    Endpoint::Created { key } if documents.contains(key) => {},
                    Endpoint::Document { id } if scene.objects.iter().any(|object| object.document_id.as_ref() == Some(id)) || context.sources.iter().any(|source| &source.document_id == id) => {},
                    Endpoint::Anchor { id } if scene.objects.iter().any(|object| object.anchor_id.as_ref() == Some(id)) || context.sources.iter().any(|source| source.anchor_id.as_ref() == Some(id)) => {},
                    Endpoint::Scene { object_id } => { crate::endpoints::from_scene(context, object_id)?; },
                    _ => return Err(ApiError::invalid("候选关系两端需要来自已选材料或本次新建文稿")),
                }
            }
        }
    }
    Ok(())
}

fn allocate_ids(actions: &[CanvasAction], existing: &HashMap<String, String>) -> HashMap<String, String> {
    let mut ids = HashMap::new();
    for action in actions {
        match action {
            CanvasAction::CreateDocument { key, .. } => {
                for key in [key.clone(), format!("{key}:object")] { ids.insert(key.clone(), existing.get(&key).cloned().unwrap_or_else(id)); }
            }
            CanvasAction::CreateRelation { key, .. } => { ids.insert(key.clone(), existing.get(key).cloned().unwrap_or_else(id)); }
            _ => {},
        }
    }
    ids
}

pub fn validate_archive(proposal: &CanvasProposal, context: &Context, document_ids: &HashSet<&String>) -> Result<()> {
    validate(context, &proposal.actions)?;
    let mut allocated = HashSet::new();
    for action in &proposal.actions {
        let keys = match action {
            CanvasAction::CreateDocument { key, .. } => vec![key.clone(), format!("{key}:object")],
            CanvasAction::CreateRelation { key, .. } => vec![key.clone()],
            _ => vec![],
        };
        for key in keys {
            let id = proposal.id_map.get(&key).ok_or_else(|| ApiError::invalid("归档提案缺少分配的对象标识"))?;
            if uuid::Uuid::parse_str(id).is_err() || !allocated.insert(id) { return Err(ApiError::invalid("归档提案的对象标识无效或重复")); }
        }
    }
    let requires_application = matches!(proposal.status, ProposalStatus::Applied | ProposalStatus::Reverted);
    if requires_application != proposal.application.is_some() { return Err(ApiError::invalid("归档提案状态与事务记录不一致")); }
    if let Some(application) = &proposal.application {
        for canvas in [&application.before_canvas, &application.canvas].into_iter().chain(application.reverted_canvas.iter()) {
            if canvas.id != proposal.canvas_id || canvas.workspace_id != proposal.workspace_id { return Err(ApiError::invalid("归档事务的画布归属无效")); }
        }
        for document in application.before_documents.iter().chain(&application.documents).chain(&application.reverted_documents) {
            if document.workspace_id != proposal.workspace_id { return Err(ApiError::invalid("归档事务的文稿归属无效")); }
        }
        if application.relations.iter().any(|relation| relation.workspace_id != proposal.workspace_id) { return Err(ApiError::invalid("归档事务的研究关系归属无效")); }
        if application.created_document_ids.iter().any(|id| !application.documents.iter().any(|document| &document.id == id)) { return Err(ApiError::invalid("归档事务缺少新建文稿记录")); }
        if proposal.status == ProposalStatus::Applied && application.documents.iter().any(|document| !document_ids.contains(&document.id)) { return Err(ApiError::invalid("已应用的归档事务缺少当前文稿")); }
    }
    Ok(())
}

fn parse_generated_response(answer: &str) -> Result<GeneratedProposal> {
    let text = answer.trim();
    if text.starts_with('{') {
        return crate::canvas_output::decode_json(text).map_err(|error| ApiError::invalid(format!("模型画布操作格式无效：{error}")));
    }
    let mut events = Parser::new(text);
    match events.next() {
        Some(Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(language)))) if language.trim().is_empty() || language.trim().eq_ignore_ascii_case("json") => {},
        _ => return Err(ApiError::invalid("模型画布操作需要 JSON 对象或单个 JSON 代码块")),
    }
    let mut json = String::new();
    let mut ended = false;
    for event in events.by_ref() {
        match event {
            Event::Text(text) => json.push_str(&text),
            Event::End(TagEnd::CodeBlock) => { ended = true; break; },
            _ => return Err(ApiError::invalid("模型画布代码块包含无效结构")),
        }
    }
    if !ended || events.next().is_some() { return Err(ApiError::invalid("模型画布输出需要单个完整的 JSON 代码块")); }
    crate::canvas_output::decode_json(&json).map_err(|error| ApiError::invalid(format!("模型画布操作格式无效：{error}")))
}

pub fn from_run(connection: &Connection, context: &Context, run: &mut Run) -> Result<()> {
    let mut generated = parse_generated_response(&run.answer)?;
    crate::math_text::normalize_generated(&mut generated);
    if generated.actions.is_empty() {
        if generated.answer.trim().is_empty() { return Err(ApiError::invalid("模型回答为空")); }
        let document = db::new_document(context.workspace_id.clone(), context.question.chars().take(80).collect(), DocumentKind::Discussion, Content::text(generated.answer.clone()), json!({"question":context.question,"context_id":context.id,"run_id":run.id,"model":run.model_used,"usage":run.usage,"raw_response":run.answer}));
        db::insert_document(connection, &document, "generation")?;
        run.answer = generated.answer;
        run.document_id = Some(document.id);
        return Ok(());
    }
    validate(context, &generated.actions)?;
    let recovered_from = (run.status == RunStatus::Failed).then(|| json!({"error":run.error,"recovered_at":now()}));
    let proposal = CanvasProposal { id: id(), workspace_id: context.workspace_id.clone(), run_id: run.id.clone(), context_id: context.id.clone(), canvas_id: scene(context)?.canvas_id.clone(), canvas_revision: scene(context)?.revision, revision: 1, status: ProposalStatus::Pending, answer: generated.answer.clone(), raw_response: run.answer.clone(), recovered_from, id_map: allocate_ids(&generated.actions, &HashMap::new()), actions: generated.actions, created_at: now(), application: None };
    insert(connection, &proposal)?;
    run.answer = generated.answer;
    run.canvas_proposal_id = Some(proposal.id);
    Ok(())
}

pub async fn recover(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Run>> {
    Ok(Json(state.db.call(move |connection| {
        let transaction = connection.transaction()?;
        let mut run = db::run(&transaction, &id)?;
        if run.canvas_proposal_id.is_some() { crate::math_text::normalize_run(&mut run); return Ok(run); }
        let context = db::context(&transaction, &run.context_id)?;
        let finish_reason = run.usage.as_ref().and_then(|usage| usage.get("finish_reason")).and_then(Value::as_str);
        if run.status != RunStatus::Failed || context.mode != ResearchMode::Canvas || !matches!(finish_reason, Some("end_turn" | "stop" | "tool_use" | "tool_calls")) {
            return Err(ApiError::invalid("恢复提案需要已完成模型输出的失败画布运行"));
        }
        from_run(&transaction, &context, &mut run)?;
        run.status = RunStatus::Succeeded;
        run.error = None;
        run.updated_at = now();
        db::update_run(&transaction, &run)?;
        transaction.commit()?;
        Ok(run)
    }).await?))
}

pub async fn read(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Value>> {
    Ok(Json(state.db.call(move |connection| Ok(view(&get(connection, &id)?))).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EditInput {
    pub expected_revision: i64,
    pub actions: Vec<CanvasAction>,
    pub expected_canvas_revision: Option<i64>,
}

pub async fn edit(State(state): State<AppState>, Path(id): Path<String>, Json(input): Json<EditInput>) -> Result<Json<Value>> {
    Ok(Json(state.db.call(move |connection| {
        let transaction = connection.transaction()?;
        let mut proposal = get(&transaction, &id)?;
        if proposal.revision != input.expected_revision { return Err(ApiError::conflict(proposal.revision)); }
        if proposal.status != ProposalStatus::Pending { return Err(ApiError::invalid("提案已处理")); }
        validate(&db::context(&transaction, &proposal.context_id)?, &input.actions)?;
        if let Some(expected) = input.expected_canvas_revision {
            let canvas = db::canvas(&transaction, &proposal.canvas_id)?;
            if canvas.revision != expected { return Err(ApiError::conflict(canvas.revision)); }
            proposal.canvas_revision = expected;
        }
        proposal.id_map = allocate_ids(&input.actions, &proposal.id_map);
        proposal.actions = input.actions;
        proposal.revision += 1;
        save(&transaction, &proposal)?;
        transaction.commit()?;
        Ok(view(&proposal))
    }).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApplyInput {
    pub expected_revision: i64,
    pub expected_canvas_revision: i64,
    #[serde(default, rename = "editor_state")] pub _editor_state: Option<serde::de::IgnoredAny>,
}

fn application_response(proposal: &CanvasProposal) -> Result<Value> {
    let application = proposal.application.as_ref().ok_or_else(|| ApiError::internal("提案缺少应用记录"))?;
    let reverted = proposal.status == ProposalStatus::Reverted;
    Ok(json!({"proposal":view(proposal),"transaction_id":application.transaction_id,"canvas":if reverted { application.reverted_canvas.as_ref() } else { Some(&application.canvas) },"documents":if reverted { &application.reverted_documents } else { &application.documents },"relations":if reverted { vec![] } else { application.relations.clone() },"removed_document_ids":if reverted { application.created_document_ids.clone() } else { vec![] },"removed_relation_ids":if reverted { application.relations.iter().map(|relation| relation.id.clone()).collect::<Vec<_>>() } else { vec![] }}))
}

pub async fn apply(State(state): State<AppState>, Path(id): Path<String>, Json(input): Json<ApplyInput>) -> Result<Json<Value>> {
    Ok(Json(state.db.call(move |connection| {
        let transaction = connection.transaction()?;
        let mut proposal = get(&transaction, &id)?;
        if proposal.status == ProposalStatus::Applied { return application_response(&proposal); }
        if proposal.status != ProposalStatus::Pending { return Err(ApiError::invalid("提案当前无法应用")); }
        if proposal.revision != input.expected_revision { return Err(ApiError::conflict(proposal.revision)); }
        let context = db::context(&transaction, &proposal.context_id)?;
        let mut canvas = db::canvas(&transaction, &proposal.canvas_id)?;
        if canvas.revision != input.expected_canvas_revision || canvas.revision != proposal.canvas_revision { return Err(ApiError::conflict(canvas.revision)); }
        let mut application = Application { transaction_id: crate::model::id(), before_canvas: canvas.clone(), before_documents: vec![], created_document_ids: vec![], canvas: canvas.clone(), documents: vec![], relations: vec![], reverted_canvas: None, reverted_documents: vec![] };
        for action in &proposal.actions {
            match action {
                CanvasAction::CreateDocument { key, title, text, kind, bounds, source_numbers, source_object_ids } => {
                    let mut document = db::new_document(proposal.workspace_id.clone(), title.clone(), kind.clone(), Content::text(text.clone()), json!({"context_id":context.id,"run_id":proposal.run_id,"canvas_proposal_id":proposal.id,"source_numbers":source_numbers,"source_object_ids":source_object_ids,"question":context.question}));
                    document.id = proposal.id_map[key].clone();
                    db::insert_document(&transaction, &document, "canvas-proposal")?;
                    canvas.objects.push(CanvasObject { id: proposal.id_map[&format!("{key}:object")].clone(), document_id: document.id.clone(), x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
                    application.created_document_ids.push(document.id.clone());
                    application.documents.push(document);
                }
                CanvasAction::MoveObject { object_id, bounds } => {
                    if let Some(object) = canvas.objects.iter_mut().find(|object| &object.id == object_id) {
                        object.x = bounds.x; object.y = bounds.y; object.width = bounds.width; object.height = bounds.height;
                    }
                }
                CanvasAction::ReplaceExcerpt { anchor_id, expected_version, replacement } => {
                    let anchor = db::anchor(&transaction, anchor_id)?;
                    let mut document = db::scoped_document(&transaction, &anchor.document_id, &proposal.workspace_id)?;
                    if document.current_version != *expected_version { return Err(ApiError::conflict(document.current_version)); }
                    application.before_documents.push(document.clone());
                    research::replace_excerpt(&mut document, &anchor, replacement)?;
                    db::revise(&transaction, &mut document, *expected_version, &format!("canvas-proposal:{}", proposal.id))?;
                    application.documents.push(document);
                }
                CanvasAction::CreateRelation { .. } => {},
            }
        }
        for action in &proposal.actions {
            if let CanvasAction::CreateRelation { key, source, target, label, conditions, counterexamples, source_numbers, mapping, preserved_operations, missing_proof, next_validation } = action {
                let source_ref = endpoint_ref(source, &proposal.id_map, &context)?;
                let target_ref = endpoint_ref(target, &proposal.id_map, &context)?;
                crate::endpoints::validate(&transaction, &proposal.workspace_id, &source_ref)?;
                crate::endpoints::validate(&transaction, &proposal.workspace_id, &target_ref)?;
                let relation = Relation { id: proposal.id_map[key].clone(), workspace_id: proposal.workspace_id.clone(), source_id: source_ref.identifier(), target_id: target_ref.identifier(), source_ref: Some(source_ref), target_ref: Some(target_ref), kind: "research".into(), label: label.clone(), include_in_context: false, context_order: 0, claim: Some(Claim { status: ClaimStatus::Candidate, conditions: conditions.clone(), counterexamples: counterexamples.clone(), sources: source_numbers.iter().map(|number| format!("context:{}#source:{number}", context.id)).collect(), mapping: mapping.clone(), preserved_operations: preserved_operations.clone(), missing_proof: missing_proof.clone(), next_validation: next_validation.clone(), revision: 1, reviews: vec![], review_required: false }), created_at: now() };
                db::insert_relation(&transaction, &relation)?;
                application.relations.push(relation);
            }
        }
        crate::canvas_state::materialize(&application.before_canvas, &mut canvas, &proposal)?;
        db::save_canvas(&transaction, &mut canvas)?;
        application.canvas = canvas;
        proposal.application = Some(application);
        proposal.status = ProposalStatus::Applied;
        proposal.revision += 1;
        save(&transaction, &proposal)?;
        transaction.commit()?;
        application_response(&proposal)
    }).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RevertInput { pub expected_revision: i64, pub expected_canvas_revision: i64 }

pub async fn revert(State(state): State<AppState>, Path(id): Path<String>, Json(input): Json<RevertInput>) -> Result<Json<Value>> {
    Ok(Json(state.db.call(move |connection| {
        let transaction = connection.transaction()?;
        let mut proposal = get(&transaction, &id)?;
        if proposal.status == ProposalStatus::Reverted { return application_response(&proposal); }
        if proposal.revision != input.expected_revision { return Err(ApiError::conflict(proposal.revision)); }
        if proposal.status != ProposalStatus::Applied { return Err(ApiError::invalid("提案当前未应用")); }
        let application = proposal.application.as_mut().ok_or_else(|| ApiError::internal("提案缺少应用记录"))?;
        let current = db::canvas(&transaction, &proposal.canvas_id)?;
        if current.revision != input.expected_canvas_revision || current.revision != application.canvas.revision { return Err(ApiError::conflict(current.revision)); }
        for document in &application.documents {
            let current = db::document(&transaction, &document.id)?;
            if current.current_version != document.current_version { return Err(ApiError::conflict(current.current_version)); }
        }
        for relation in &application.relations {
            if serde_json::to_value(db::relation(&transaction, &relation.id)?)? != serde_json::to_value(relation)? { return Err(ApiError::invalid("提案创建的研究关系已有后续修改")); }
        }
        let relation_ids: HashSet<_> = application.relations.iter().map(|relation| &relation.id).collect();
        let all_relations = db::relations(&transaction, &proposal.workspace_id)?;
        let canvases = db::canvases(&transaction, &proposal.workspace_id)?;
        let mut context_statement = transaction.prepare("SELECT payload FROM contexts WHERE workspace_id=?")?;
        let payloads = context_statement.query_map([&proposal.workspace_id], |row| row.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
        drop(context_statement);
        for id in &application.created_document_ids {
            let dependent_relation = all_relations.iter().any(|relation| !relation_ids.contains(&relation.id) && (&relation.source_id == id || &relation.target_id == id || relation.claim.as_ref().is_some_and(|claim| claim.reviews.iter().any(|review| review.evidence.iter().any(|source| &source.document_id == id)))));
            let dependent_canvas = canvases.iter().any(|canvas| canvas.id != proposal.canvas_id && canvas.objects.iter().any(|object| &object.document_id == id));
            let dependent_anchor: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM anchors WHERE document_id=?)", [id], |row| row.get(0))?;
            let mut dependent_context = false;
            for payload in &payloads {
                let context: Context = serde_json::from_str(payload)?;
                if context.sources.iter().any(|source| &source.document_id == id) || context.scenes.iter().any(|scene| scene.objects.iter().any(|object| object.document_id.as_ref() == Some(id))) { dependent_context = true; break; }
            }
            if dependent_relation || dependent_canvas || dependent_anchor || dependent_context { return Err(ApiError::new(axum::http::StatusCode::CONFLICT, "dependent_changes", "候选文稿已有后续引用，请先处理引用后再撤销")); }
        }
        for relation in &application.relations { transaction.execute("DELETE FROM relations WHERE id=?", [&relation.id])?; }
        for id in &application.created_document_ids {
            transaction.execute("DELETE FROM document_versions WHERE document_id=?", [id])?;
            transaction.execute("DELETE FROM documents WHERE id=?", [id])?;
        }
        for previous in &application.before_documents {
            let current = db::document(&transaction, &previous.id)?;
            let mut restored = previous.clone();
            db::revise(&transaction, &mut restored, current.current_version, &format!("revert-canvas-proposal:{}", proposal.id))?;
            application.reverted_documents.push(restored);
        }
        let mut restored = application.before_canvas.clone();
        restored.revision = current.revision;
        db::save_canvas(&transaction, &mut restored)?;
        application.reverted_canvas = Some(restored);
        proposal.status = ProposalStatus::Reverted;
        proposal.revision += 1;
        save(&transaction, &proposal)?;
        transaction.commit()?;
        application_response(&proposal)
    }).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RejectInput { pub expected_revision: i64 }

pub async fn reject(State(state): State<AppState>, Path(id): Path<String>, Json(input): Json<RejectInput>) -> Result<Json<Value>> {
    Ok(Json(state.db.call(move |connection| {
        let mut proposal = get(connection, &id)?;
        if proposal.status == ProposalStatus::Rejected { return Ok(view(&proposal)); }
        if proposal.revision != input.expected_revision { return Err(ApiError::conflict(proposal.revision)); }
        if proposal.status != ProposalStatus::Pending { return Err(ApiError::invalid("提案已处理")); }
        proposal.status = ProposalStatus::Rejected;
        proposal.revision += 1;
        save(connection, &proposal)?;
        Ok(view(&proposal))
    }).await?))
}
