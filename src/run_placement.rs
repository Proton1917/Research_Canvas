use axum::{Json, extract::{Path, State}};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{AppState, canvas_state, db, error::{ApiError, Result}, model::*, scene::Bounds};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlaceInput {
    pub expected_canvas_revision: i64,
    pub bounds: Option<Bounds>,
}

pub async fn place(State(state): State<AppState>, Path(id): Path<String>, Json(input): Json<PlaceInput>) -> Result<Json<Value>> {
    Ok(Json(state.db.call(move |connection| {
        let transaction = connection.transaction()?;
        let mut run = db::run(&transaction, &id)?;
        let origin = run.origin.as_ref().ok_or_else(|| ApiError::invalid("此运行的材料来自文稿讨论，请手动选择放置画布"))?;
        let mut canvas = db::canvas(&transaction, &origin.canvas_id)?;
        if run.placement.is_some() { return Ok(json!({"run":run,"canvas":canvas})); }
        if run.status != RunStatus::Succeeded { return Err(ApiError::invalid("讨论生成成功后可放入原画布")); }
        let document_id = run.document_id.as_ref().ok_or_else(|| ApiError::invalid("此运行请通过提案确认写入"))?;
        if canvas.revision != input.expected_canvas_revision { return Err(ApiError::conflict(canvas.revision)); }
        let bounds = match origin.write_region.as_ref() {
            Some(bounds) => bounds,
            None => {
                let bounds = input.bounds.as_ref().ok_or_else(|| ApiError::invalid("请指定讨论卡片的放置区域"))?;
                bounds.validate()?;
                bounds
            }
        };
        let object = CanvasObject { id: format!("{}:discussion", run.id), document_id: document_id.clone(), x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
        canvas_state::place_discussion(&mut canvas, &object, &origin.source_ids)?;
        db::save_canvas(&transaction, &mut canvas)?;
        run.placement = Some(RunPlacement { object_id: object.id, canvas_revision: canvas.revision });
        run.updated_at = now();
        db::update_run(&transaction, &run)?;
        transaction.commit()?;
        Ok(json!({"run":run,"canvas":canvas}))
    }).await?))
}
