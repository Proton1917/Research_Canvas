use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use yrs::{Any, Array, ArrayPrelim, Doc, Map, MapPrelim, MapRef, Out, ReadTxn, StateVector, TextPrelim, Transact, TransactionMut, Update, types::ToJson, updates::decoder::Decode};

use crate::{canvas_proposal::{CanvasAction, CanvasProposal, Endpoint}, error::{ApiError, Result}, model::{Canvas, CanvasObject, id, now}};

const CARD: &str = "affine:embed-synced-doc";

fn decode(state: &Value) -> Result<Doc> {
    let encoded = state["update"].as_str().ok_or_else(|| ApiError::invalid("画布状态缺少 Yjs update"))?;
    let bytes = STANDARD.decode(encoded).map_err(|_| ApiError::invalid("画布 update 需要 Base64 编码"))?;
    let update = Update::decode_v1(&bytes).map_err(|_| ApiError::invalid("画布 Yjs 数据格式错误"))?;
    let doc = Doc::new();
    doc.get_or_insert_map("blocks");
    let mut txn = doc.transact_mut();
    txn.apply_update(update).map_err(|_| ApiError::invalid("画布 Yjs 数据加载失败"))?;
    if txn.store().pending_update().is_some() || txn.store().pending_ds().is_some() { return Err(ApiError::invalid("请提交完整画布状态")); }
    drop(txn);
    Ok(doc)
}

fn map(value: Option<Out>) -> Result<MapRef> {
    match value { Some(Out::YMap(map)) => Ok(map), _ => Err(ApiError::invalid("画布操作引用的内容缺失")) }
}

fn string<T: ReadTxn>(map: &MapRef, txn: &T, key: &str) -> Result<String> {
    map.get(txn, key).map(|value| value.to_string(txn)).ok_or_else(|| ApiError::invalid(format!("画布内容缺少 {key}")))
}

fn project_blocks<T: ReadTxn>(blocks: &MapRef, txn: &T) -> Result<Vec<CanvasObject>> {
    let mut objects = Vec::new();
    for (id, block) in blocks.iter(txn) {
        let Out::YMap(block) = block else { continue; };
        if block.get(txn, "sys:flavour").is_none_or(|flavour| flavour.to_string(txn) != CARD) { continue; }
        let [x, y, width, height]: [f64; 4] = serde_json::from_str(&string(&block, txn, "prop:xywh")?).map_err(|_| ApiError::invalid("画布位置格式错误"))?;
        objects.push(CanvasObject { id: id.to_owned(), document_id: string(&block, txn, "prop:pageId")?, x, y, width, height });
    }
    objects.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(objects)
}

pub fn project(state: &Value) -> Result<Vec<CanvasObject>> {
    let doc = decode(state)?;
    let txn = doc.transact();
    project_blocks(&txn.get_map("blocks").unwrap(), &txn)
}

fn block(blocks: &MapRef, txn: &mut TransactionMut, id: &str, flavour: &str, version: i64) -> MapRef {
    let block = blocks.insert(txn, id, MapPrelim::default());
    block.insert(txn, "sys:id", id);
    block.insert(txn, "sys:flavour", flavour);
    block.insert(txn, "sys:version", version);
    block.insert(txn, "sys:children", ArrayPrelim::default());
    block
}

fn append(parent: &MapRef, txn: &mut TransactionMut, id: &str) -> Result<()> {
    let Some(Out::YArray(children)) = parent.get(txn, "sys:children") else { return Err(ApiError::invalid("画布父节点缺少子节点集合")); };
    children.push_back(txn, id);
    Ok(())
}

fn card(blocks: &MapRef, surface: &MapRef, txn: &mut TransactionMut, object: &CanvasObject) -> Result<()> {
    let block = block(blocks, txn, &object.id, CARD, 1);
    block.insert(txn, "prop:pageId", object.document_id.clone());
    block.insert(txn, "prop:xywh", serde_json::to_string(&[object.x, object.y, object.width, object.height])?);
    block.insert(txn, "prop:index", "a0");
    block.insert(txn, "prop:style", "syncedDoc");
    block.insert(txn, "prop:rotate", 0);
    append(surface, txn, &object.id)
}

fn locate<T: ReadTxn>(endpoint: &Endpoint, proposal: &CanvasProposal, blocks: &MapRef, elements: &MapRef, txn: &T, state: &Value) -> Option<String> {
    let exists = |id: &str| blocks.contains_key(txn, id) || elements.contains_key(txn, id);
    match endpoint {
        Endpoint::Created { key } => Some(proposal.id_map[&format!("{key}:object")].clone()),
        Endpoint::Scene { object_id } => exists(object_id).then(|| object_id.clone()),
        Endpoint::Document { id } => {
            let cards = blocks.iter(txn).find_map(|(instance, block)| match block {
                Out::YMap(block) if block.get(txn, "prop:pageId").is_some_and(|page| page.to_string(txn) == *id) => Some(instance.to_owned()),
                _ => None,
            });
            cards.or_else(|| state["fragments"].as_object()?.iter().find(|(instance, fragment)| fragment["document_id"] == *id && exists(instance)).map(|(id, _)| id.clone()))
        }
        Endpoint::Anchor { id } => state["fragments"].as_object()?.iter().find(|(instance, fragment)| fragment["anchor_id"] == *id && exists(instance)).map(|(id, _)| id.clone()),
    }
}

// 同一个编辑事务生成 Yjs、对象布局和新增连线，保留原有内容及格式。
pub fn materialize(before: &Canvas, canvas: &mut Canvas, proposal: &CanvasProposal) -> Result<()> {
    let doc = match &before.editor_state { Some(state) => decode(state)?, None => Doc::new() };
    let blocks = doc.get_or_insert_map("blocks");
    let mut txn = doc.transact_mut();
    let mut state = before.editor_state.clone().unwrap_or_else(|| json!({"format":"blocksuite-yjs-v1"}));
    let surface = if before.editor_state.is_some() {
        blocks.iter(&txn).find_map(|(_, value)| match value { Out::YMap(block) if block.get(&txn, "sys:flavour").is_some_and(|flavour| flavour.to_string(&txn) == "affine:surface") => Some(block), _ => None }).ok_or_else(|| ApiError::invalid("画布缺少绘制表面"))?
    } else {
        let root = block(&blocks, &mut txn, &id(), "affine:page", 2);
        root.insert(&mut txn, "prop:title", TextPrelim::new(&before.name));
        let surface_id = id();
        let surface = block(&blocks, &mut txn, &surface_id, "affine:surface", 5);
        append(&root, &mut txn, &surface_id)?;
        let boxed = surface.insert(&mut txn, "prop:elements", MapPrelim::default());
        boxed.insert(&mut txn, "type", "$blocksuite:internal:native$");
        boxed.insert(&mut txn, "value", MapPrelim::default());
        for object in &before.objects { card(&blocks, &surface, &mut txn, object)?; }
        surface
    };
    let boxed = map(surface.get(&txn, "prop:elements"))?;
    let elements = map(boxed.get(&txn, "value"))?;
    for action in &proposal.actions {
        match action {
            CanvasAction::CreateDocument { key, .. } => {
                let object = canvas.objects.iter().find(|object| object.id == proposal.id_map[&format!("{key}:object")]).unwrap();
                card(&blocks, &surface, &mut txn, object)?;
            }
            CanvasAction::MoveObject { object_id, bounds } => {
                let (target, property) = match blocks.get(&txn, object_id) { Some(block) => (map(Some(block))?, "prop:xywh"), None => (map(elements.get(&txn, object_id))?, "xywh") };
                target.insert(&mut txn, property, serde_json::to_string(&[bounds.x, bounds.y, bounds.width, bounds.height])?);
            }
            _ => {},
        }
    }
    let mut views = state["link_views"].as_object().cloned().unwrap_or_default();
    if state.get("link_views").is_none() {
        for (id, element) in elements.iter(&txn) {
            let element = serde_json::to_value(element.to_json(&txn))?;
            if element["type"] == "connector" { views.insert(id.into(), json!({"view_id":id,"connector_id":id,"relation_id":state["links"][id],"source_instance":element["source"]["id"],"target_instance":element["target"]["id"],"created_at":now()})); }
        }
    }
    for action in &proposal.actions {
        if let CanvasAction::CreateRelation { key, source, target, .. } = action {
            if let (Some(source), Some(target)) = (locate(source, proposal, &blocks, &elements, &txn, &state), locate(target, proposal, &blocks, &elements, &txn, &state)) {
                let relation = &proposal.id_map[key];
                let id = format!("{relation}:view");
                let connector = elements.insert(&mut txn, id.clone(), MapPrelim::default());
                for (key, value) in [("id", Any::from(id.clone())), ("type", Any::from("connector")), ("index", Any::from("a0")), ("mode", Any::from(2)), ("stroke", Any::from("#d97757")), ("strokeStyle", Any::from("dash")), ("strokeWidth", Any::from(3)), ("source", yrs::any!({"id":source.clone()})), ("target", yrs::any!({"id":target.clone()}))] { connector.insert(&mut txn, key, value); }
                views.insert(id.clone(), json!({"view_id":id,"connector_id":id,"relation_id":relation,"source_instance":source,"target_instance":target,"created_at":now()}));
            }
        }
    }
    state["links"] = Value::Object(views.iter().filter(|(_, view)| view["relation_id"].is_string()).map(|(id, view)| (id.clone(), view["relation_id"].clone())).collect());
    state["link_views"] = Value::Object(views);
    state["view_version"] = json!(2);
    state["update"] = json!(STANDARD.encode(txn.encode_state_as_update_v1(&StateVector::default())));
    canvas.objects = project_blocks(&blocks, &txn)?;
    canvas.editor_state = Some(state);
    Ok(())
}
