use std::collections::HashMap;

use axum::{Json, extract::{Multipart, Path, State}, http::StatusCode};
use base64::{Engine, engine::general_purpose::STANDARD};
use rusqlite::Connection;
use serde_json::{Value, json};

use crate::{AppState, db, error::{ApiError, Result}, model::{Asset, id, now}, transfer};

pub async fn upload(State(state): State<AppState>, Path(workspace_id): Path<String>, multipart: Multipart) -> Result<(StatusCode, Json<Value>)> {
    let (filename, media_type, data) = transfer::read_upload(multipart).await?;
    if !matches!(media_type.as_str(), "image/png" | "image/jpeg" | "image/webp" | "image/gif") { return Err(ApiError::invalid("提问截图支持 PNG、JPEG、WebP 和 GIF")); }
    let size = data.len();
    let asset = Asset { id: id(), workspace_id, filename, media_type, data_base64: STANDARD.encode(data), created_at: now(), temporary: true };
    let result = state.db.call(move |connection| {
        db::workspace(connection, &asset.workspace_id)?;
        db::insert_asset(connection, &asset)?;
        Ok(json!({"id":asset.id,"filename":asset.filename,"media_type":asset.media_type,"byte_length":size,"url":format!("/api/assets/{}",asset.id),"created_at":asset.created_at,"references":[]}))
    }).await?;
    Ok((StatusCode::CREATED, Json(result)))
}

// 清理请求读取既有引用及历史版本；日常生成和编辑直接复用保存的资产标识。
fn references(connection: &Connection, workspace_id: &str, asset_id: Option<&str>) -> Result<HashMap<String, Vec<Value>>> {
    let mut statement = connection.prepare(
        "WITH refs(asset_id,kind,id,version) AS (
          SELECT json_extract(v.value,'$.asset_id'),'context',c.id,NULL
          FROM contexts c,json_each(c.payload,'$.visuals') v WHERE c.workspace_id=?1
          UNION ALL
          SELECT json_extract(metadata,'$.source_asset_id'),'document',id,NULL
          FROM documents WHERE workspace_id=?1
          UNION ALL
          SELECT a.value,'document_version',v.document_id,v.version
          FROM document_versions v JOIN documents d ON d.id=v.document_id,
          json_each(v.content,'$.editor_state.assets') a WHERE d.workspace_id=?1
          UNION ALL
          SELECT a.value,'canvas',c.id,c.revision
          FROM canvases c,json_each(c.editor_state,'$.assets') a WHERE c.workspace_id=?1
          UNION ALL
          SELECT a.value,'canvas_proposal',p.id,NULL
          FROM canvas_proposals p,json_each(p.payload,'$.application.before_canvas.editor_state.assets') a WHERE p.workspace_id=?1
        ) SELECT DISTINCT asset_id,kind,id,version FROM refs
          WHERE asset_id IS NOT NULL AND (?2 IS NULL OR asset_id=?2) ORDER BY asset_id,kind,id,version"
    )?;
    let rows = statement.query_map(rusqlite::params![workspace_id, asset_id], |row| Ok((row.get::<_, String>(0)?, json!({"type":row.get::<_, String>(1)?,"id":row.get::<_, String>(2)?,"version":row.get::<_, Option<i64>>(3)?}))))?;
    let mut references: HashMap<String, Vec<Value>> = HashMap::new();
    for row in rows { let (id, reference) = row?; references.entry(id).or_default().push(reference); }
    Ok(references)
}

pub async fn list(State(state): State<AppState>, Path(workspace_id): Path<String>) -> Result<Json<Value>> {
    Ok(Json(state.db.call(move |connection| {
        db::workspace(connection, &workspace_id)?;
        let mut references = references(connection, &workspace_id, None)?;
        let mut statement = connection.prepare("SELECT id,filename,media_type,length(data),created_at FROM assets WHERE workspace_id=? AND temporary=1 ORDER BY created_at,id")?;
        let rows = statement.query_map([workspace_id], |row| {
            let id: String = row.get(0)?;
            let used_by = references.remove(&id).unwrap_or_default();
            Ok(json!({"id":id,"filename":row.get::<_, String>(1)?,"media_type":row.get::<_, String>(2)?,"byte_length":row.get::<_, i64>(3)?,"created_at":row.get::<_, String>(4)?,"url":format!("/api/assets/{id}"),"references":used_by}))
        })?.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(json!(rows))
    }).await?))
}

pub async fn discard(State(state): State<AppState>, Path((workspace_id, asset_id)): Path<(String, String)>) -> Result<StatusCode> {
    state.db.call(move |connection| {
        let transaction = connection.transaction()?;
        let temporary: bool = transaction.query_row("SELECT temporary FROM assets WHERE id=? AND workspace_id=?", [&asset_id, &workspace_id], |row| row.get(0))?;
        if !temporary { return Err(ApiError::invalid("此入口处理提问截图；导入材料保留在文稿中")); }
        let used_by = references(&transaction, &workspace_id, Some(&asset_id))?.remove(&asset_id).unwrap_or_default();
        if !used_by.is_empty() {
            let mut error = ApiError::new(StatusCode::CONFLICT, "asset_in_use", "图像已有来源引用，已保留图像和引用记录");
            error.details = json!({"asset_id":asset_id,"references":used_by});
            return Err(error);
        }
        transaction.execute("DELETE FROM assets WHERE id=?", [&asset_id])?;
        transaction.commit()?;
        Ok(())
    }).await?;
    Ok(StatusCode::NO_CONTENT)
}
