use axum::http::StatusCode;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{config::{Protocol, Provider}, db, error::{ApiError, Result}, model::{Asset, Context}};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct VisualInput {
    pub asset_id: String,
    pub object_ids: Vec<String>,
}

pub fn attach(connection: &Connection, context: &mut Context, visuals: Vec<VisualInput>) -> Result<()> {
    let current = context.scenes.last().ok_or_else(|| ApiError::invalid("视觉输入需要目标场景"))?;
    for visual in visuals {
        if visual.object_ids.is_empty() || visual.object_ids.iter().any(|id| !current.objects.iter().any(|object| &object.id == id)) { return Err(ApiError::invalid("图像范围需要关联本轮选中对象")); }
        let media_type: String = connection.query_row("SELECT media_type FROM assets WHERE id=? AND workspace_id=?", [&visual.asset_id, &context.workspace_id], |row| row.get(0))?;
        if !matches!(media_type.as_str(), "image/png" | "image/jpeg" | "image/webp" | "image/gif") { return Err(ApiError::invalid("视觉输入支持 PNG、JPEG、WebP 和 GIF")); }
        if !context.visuals.contains(&visual) { context.visuals.push(visual); }
    }
    Ok(())
}

pub fn load(connection: &Connection, context: &Context, provider: &Provider) -> Result<Vec<Asset>> {
    let assets = context.visuals.iter().map(|visual| db::asset(connection, &visual.asset_id)).collect::<Result<Vec<_>>>()?;
    let bytes: usize = assets.iter().map(|asset| asset.data_base64.len() / 4 * 3 - asset.data_base64.chars().rev().take_while(|character| *character == '=').count()).sum();
    if provider.max_input_image_bytes.is_some_and(|limit| bytes > limit) {
        let mut error = ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "image_budget_exceeded", "选中图像超出本机配置的输入大小，请缩小图像范围");
        error.details = json!({"image_bytes":bytes,"max_input_image_bytes":provider.max_input_image_bytes});
        return Err(error);
    }
    Ok(assets)
}

pub fn messages(context: &Context, assets: &[Asset], protocol: &Protocol) -> Result<Vec<Value>> {
    let mut messages = context.messages.iter().filter(|message| *protocol == Protocol::ChatCompletions || message.role != "system").map(serde_json::to_value).collect::<std::result::Result<Vec<_>, _>>()?;
    if !assets.is_empty() {
        let message = messages.iter_mut().rev().find(|message| message["role"] == "user").ok_or_else(|| ApiError::invalid("视觉上下文缺少用户消息"))?;
        let mut content = vec![json!({"type":"text","text":message["content"]})];
        for (visual, asset) in context.visuals.iter().zip(assets) {
            content.push(json!({"type":"text","text":format!("选中图像：{}；资产 {}；对应画布对象 {}", asset.filename, asset.id, visual.object_ids.join(", "))}));
            content.push(match protocol {
                Protocol::AnthropicMessages => json!({"type":"image","source":{"type":"base64","media_type":asset.media_type,"data":asset.data_base64}}),
                Protocol::ChatCompletions => json!({"type":"image_url","image_url":{"url":format!("data:{};base64,{}",asset.media_type,asset.data_base64)}}),
            });
        }
        message["content"] = Value::Array(content);
    }
    Ok(messages)
}
