use std::{collections::HashSet, time::Instant};

use axum::{Json, extract::{Path, State}, http::StatusCode};
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

use crate::{AppState, RunControl, config::Protocol, db, error::{ApiError, Result}, model::*};

fn configuration_error() -> ApiError {
    ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "provider_not_configured", "请在后端环境中配置模型服务凭据")
}

fn upstream_error(error: impl std::fmt::Display, key: &str) -> ApiError {
    let message = error.to_string();
    let message = if key.is_empty() { message } else { message.replace(key, "[redacted]") };
    ApiError::new(StatusCode::BAD_GATEWAY, "provider_error", message.chars().take(1200).collect::<String>())
}

fn provider_request(state: &AppState, method: reqwest::Method, path: &str) -> Result<reqwest::RequestBuilder> {
    if !state.config.credentials_available() { return Err(configuration_error()); }
    let mut request = state.client.request(method, format!("{}{path}", state.config.provider.base_url.trim_end_matches('/')));
    for (name, value) in &state.config.provider.headers { request = request.header(name, value); }
    if let Some(key) = state.config.api_key() { request = request.bearer_auth(key); }
    Ok(request)
}

async fn check_response(response: reqwest::Response, key: &str) -> Result<reqwest::Response> {
    if response.status().is_success() { return Ok(response); }
    let status = response.status();
    let body = response.text().await.map_err(|error| upstream_error(error, key))?;
    let message = serde_json::from_str::<Value>(&body).ok().and_then(|value| value.pointer("/error/message").and_then(Value::as_str).map(str::to_owned));
    Err(upstream_error(format!("模型服务 HTTP {status}：{}", message.unwrap_or_else(|| "请求未成功，请检查服务状态和模型配置".into())), key))
}

pub async fn models(State(state): State<AppState>) -> Result<Json<Value>> {
    {
        let cache = state.models.read().await;
        if let Some((timestamp, value)) = cache.as_ref() {
            if timestamp.elapsed().as_secs() < state.config.provider.models_cache_seconds { return Ok(Json(value.clone())); }
        }
    }
    let key = state.config.api_key().unwrap_or_default();
    let response = provider_request(&state, reqwest::Method::GET, "/models")?.send().await.map_err(|error| upstream_error(error, &key))?;
    let response = check_response(response, &key).await?;
    let data: Value = response.json().await.map_err(|error| upstream_error(error, &key))?;
    let items = data.get("data").and_then(Value::as_array).ok_or_else(|| upstream_error("模型服务未返回 data 数组", &key))?;
    let items = items.iter().filter_map(|item| {
        item.get("id").and_then(Value::as_str)
            .filter(|id| state.config.provider.allowed_models.iter().any(|allowed| allowed == id))
            .map(|id| json!({"id":id, "name":item.get("name").and_then(Value::as_str).unwrap_or(id), "context_length":item.get("context_length").or_else(|| item.get("context_window"))}))
    }).collect::<Vec<_>>();
    let value = json!({"models":items,"default_model":state.config.provider.default_model});
    *state.models.write().await = Some((Instant::now(), value.clone()));
    Ok(Json(value))
}

#[derive(Deserialize)]
pub struct RunInput {
    pub context_id: String,
    pub model: Option<String>,
    pub max_output_tokens: Option<u32>,
}

pub async fn start_run(State(state): State<AppState>, Path(workspace_id): Path<String>, Json(input): Json<RunInput>) -> Result<(StatusCode, Json<Run>)> {
    if !state.config.credentials_available() { return Err(configuration_error()); }
    let key = state.config.api_key().unwrap_or_default();
    let model = input.model.unwrap_or_else(|| state.config.provider.default_model.clone());
    if !state.config.provider.allowed_models.contains(&model) { return Err(ApiError::invalid("该模型未包含在当前允许的模型列表中")); }
    let max_tokens = input.max_output_tokens.unwrap_or(state.config.provider.max_output_tokens);
    let input_limit = state.config.provider.max_input_characters;
    let provider = state.config.provider.clone();
    if max_tokens == 0 || max_tokens > state.config.provider.max_output_tokens { return Err(ApiError::invalid("输出长度超出后端配置范围")); }
    let (context, run, assets) = state.db.call(move |connection| {
        let context = db::context(connection, &input.context_id)?;
        if context.workspace_id != workspace_id { return Err(ApiError::invalid("上下文属于其他工作区")); }
        crate::context::require_fresh(connection, &context)?;
        crate::context::check_budget(&context, input_limit)?;
        if !context.visuals.is_empty() && !provider.vision_models.contains(&model) { return Err(ApiError::new(StatusCode::UNPROCESSABLE_ENTITY, "vision_unsupported", "所选模型配置为文字输入，请选择支持视觉的模型或移除图像材料")); }
        let assets = crate::visual::load(connection, &context, &provider)?;
        let timestamp = now();
        let run = Run { id: id(), workspace_id, context_id: context.id.clone(), model, status: RunStatus::Queued, answer: String::new(), model_used: None, usage: None, error: None, document_id: None, proposal_id: None, canvas_proposal_id: None, origin: context.origin.clone(), placement: None, created_at: timestamp.clone(), updated_at: timestamp };
        db::insert_run(connection, &run)?;
        Ok((context, run, assets))
    }).await?;
    let (progress, _) = watch::channel(RunProgress { sequence: 0, run: run.clone() });
    let control = RunControl { progress, cancel: CancellationToken::new() };
    state.runs.lock().await.insert(run.id.clone(), control.clone());
    let response = run.clone();
    let task_state = state.clone();
    let task = tokio::spawn(async move { execute(task_state, context, run, control, key, max_tokens, assets).await; });
    state.tasks.lock().await.push(task);
    Ok((StatusCode::ACCEPTED, Json(response)))
}

fn publish(control: &RunControl, run: &Run) {
    let sequence = control.progress.borrow().sequence + 1;
    control.progress.send_replace(RunProgress { sequence, run: run.clone() });
}

async fn generate(state: &AppState, context: &Context, run: &mut Run, control: &RunControl, key: &str, max_tokens: u32, assets: &[Asset]) -> Result<()> {
    let canvas_mode = context.mode == ResearchMode::Canvas;
    let messages = crate::visual::messages(context, assets, &state.config.provider.protocol)?;
    let (path, mut body) = match state.config.provider.protocol {
        Protocol::ChatCompletions => ("/chat/completions", json!({"model":run.model,"messages":messages,"stream":true,"stream_options":{"include_usage":true},"max_tokens":max_tokens})),
        Protocol::AnthropicMessages => {
            let system = context.messages.iter().filter(|message| message.role == "system").map(|message| message.content.as_str()).collect::<Vec<_>>().join("\n\n");
            ("/messages", json!({"model":run.model,"system":system,"messages":messages,"stream":true,"max_tokens":max_tokens}))
        }
    };
    if canvas_mode {
        let schema = crate::canvas_output::tool_schema()?;
        match state.config.provider.protocol {
            Protocol::AnthropicMessages => {
                body["tools"] = json!([{"name":"submit_canvas","description":"提交 answer 及按需填写的操作数组。关系使用 source_kind/source_id 和 target_kind/target_id。","input_schema":schema}]);
                body["tool_choice"] = json!({"type":"tool","name":"submit_canvas","disable_parallel_tool_use":true});
            }
            Protocol::ChatCompletions => {
                body["tools"] = json!([{"type":"function","function":{"name":"submit_canvas","description":"提交 answer 及按需填写的操作数组。","parameters":schema}}]);
                body["tool_choice"] = json!({"type":"function","function":{"name":"submit_canvas"}});
                body["parallel_tool_calls"] = json!(false);
            }
        }
    }
    let response = provider_request(state, reqwest::Method::POST, path)?
        .json(&body)
        .send().await.map_err(|error| upstream_error(error, key))?;
    let response = check_response(response, key).await?;
    let mut stream = response.bytes_stream().eventsource();
    let mut last_publish = Instant::now();
    let mut completed = false;
    let mut finish_reason = None;
    let mut canvas_tool_index = None;
    while let Some(event) = stream.next().await {
        let event = event.map_err(|error| upstream_error(error, key))?;
        if event.data.trim() == "[DONE]" { completed = true; break; }
        if event.data.trim().is_empty() { continue; }
        let value: Value = serde_json::from_str(&event.data).map_err(|error| upstream_error(error, key))?;
        if let Some(error) = value.get("error") { return Err(upstream_error(error, key)); }
        match state.config.provider.protocol {
            Protocol::ChatCompletions => {
                if let Some(model) = value.get("model").and_then(Value::as_str) { run.model_used = Some(model.to_string()); }
                if let Some(usage) = value.get("usage").filter(|usage| !usage.is_null()) { run.usage = Some(usage.clone()); }
                if let Some(choice) = value.get("choices").and_then(Value::as_array).and_then(|choices| choices.first()) {
                    if !canvas_mode {
                        if let Some(content) = choice.pointer("/delta/content").and_then(Value::as_str) { run.answer.push_str(content); }
                    } else if let Some(calls) = choice.pointer("/delta/tool_calls").and_then(Value::as_array) {
                        for call in calls {
                            if let Some(name) = call.pointer("/function/name").and_then(Value::as_str) {
                                if name != "submit_canvas" || canvas_tool_index.is_some() { return Err(upstream_error("画布运行需要一个 submit_canvas 工具调用", key)); }
                                canvas_tool_index = call.get("index").and_then(Value::as_u64);
                            }
                            if canvas_tool_index.is_none() || call.get("index").and_then(Value::as_u64) != canvas_tool_index { return Err(upstream_error("画布工具流标识不一致", key)); }
                            if let Some(arguments) = call.pointer("/function/arguments").and_then(Value::as_str) { run.answer.push_str(arguments); }
                        }
                    }
                    if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) { finish_reason = Some(reason.to_string()); }
                }
            }
            Protocol::AnthropicMessages => {
                if let Some(model) = value.pointer("/message/model").and_then(Value::as_str) { run.model_used = Some(model.to_string()); }
                if value.get("type").and_then(Value::as_str) == Some("message_stop") { completed = true; break; }
                if !canvas_mode && value.pointer("/delta/type").and_then(Value::as_str) == Some("text_delta") {
                    if let Some(text) = value.pointer("/delta/text").and_then(Value::as_str) { run.answer.push_str(text); }
                }
                if canvas_mode && value.get("type").and_then(Value::as_str) == Some("content_block_start") && value.pointer("/content_block/type").and_then(Value::as_str) == Some("tool_use") {
                    if value.pointer("/content_block/name").and_then(Value::as_str) != Some("submit_canvas") || canvas_tool_index.is_some() { return Err(upstream_error("画布运行需要一个 submit_canvas 工具调用", key)); }
                    canvas_tool_index = value.get("index").and_then(Value::as_u64);
                    if let Some(input) = value.pointer("/content_block/input").filter(|input| input.as_object().is_some_and(|object| !object.is_empty())) { run.answer = serde_json::to_string(input)?; }
                }
                if canvas_mode && value.pointer("/delta/type").and_then(Value::as_str) == Some("input_json_delta") {
                    if canvas_tool_index.is_none() || value.get("index").and_then(Value::as_u64) != canvas_tool_index { return Err(upstream_error("画布工具流标识不一致", key)); }
                    if let Some(partial) = value.pointer("/delta/partial_json").and_then(Value::as_str) { run.answer.push_str(partial); }
                }
                if let Some(reason) = value.pointer("/delta/stop_reason").and_then(Value::as_str) { finish_reason = Some(reason.to_string()); }
                if let Some(usage) = value.get("usage").or_else(|| value.pointer("/message/usage")).and_then(Value::as_object) {
                    let current = run.usage.get_or_insert_with(|| json!({}));
                    if let Some(current) = current.as_object_mut() { current.extend(usage.clone()); }
                }
            }
        }
        if last_publish.elapsed().as_millis() >= 50 {
            run.updated_at = now();
            publish(control, run);
            last_publish = Instant::now();
        }
    }
    if !completed { return Err(upstream_error("模型流在完成标记前中断，已保留接收内容", key)); }
    if canvas_mode && canvas_tool_index.is_none() { return Err(upstream_error("模型服务未返回 submit_canvas 结构化操作", key)); }
    if run.answer.trim().is_empty() { return Err(upstream_error("模型服务完成了请求，但未返回正文", key)); }
    if let Some(reason) = finish_reason {
        let usage = run.usage.get_or_insert_with(|| json!({}));
        if let Some(usage) = usage.as_object_mut() { usage.insert("finish_reason".into(), json!(reason)); }
    }
    Ok(())
}

async fn execute(state: AppState, context: Context, mut run: Run, control: RunControl, key: String, max_tokens: u32, assets: Vec<Asset>) {
    run.status = RunStatus::Running;
    run.updated_at = now();
    let starting = run.clone();
    if let Err(error) = state.db.call(move |connection| db::update_run(connection, &starting)).await {
        run.status = RunStatus::Failed;
        run.error = Some(error.to_string());
        publish(&control, &run);
        state.runs.lock().await.remove(&run.id);
        return;
    }
    publish(&control, &run);
    tokio::select! {
        biased;
        _ = state.shutdown.cancelled() => { run.status = RunStatus::Interrupted; run.error = Some("服务正在停止，已保留接收内容".into()); }
        _ = control.cancel.cancelled() => { run.status = RunStatus::Cancelled; }
        result = generate(&state, &context, &mut run, &control, &key, max_tokens, &assets) => {
            match result {
                Ok(()) => { run.status = RunStatus::Succeeded; }
                Err(error) => { run.status = RunStatus::Failed; run.error = Some(error.message); }
            }
        }
    }
    run.updated_at = now();
    let mut finished = run.clone();
    let result = state.db.call(move |connection| {
        let transaction = connection.transaction()?;
        if finished.status == RunStatus::Succeeded {
            if context.mode == ResearchMode::Canvas {
                crate::canvas_proposal::from_run(&transaction, &context, &mut finished)?;
            } else if context.mode == ResearchMode::Rewrite {
                let proposal = Proposal { id: id(), workspace_id: finished.workspace_id.clone(), run_id: finished.id.clone(), anchor_id: context.anchor_ids[0].clone(), replacement: finished.answer.clone(), status: ProposalStatus::Pending, applied_version: None, previous_version: None, created_at: now() };
                db::insert_proposal(&transaction, &proposal)?;
                finished.proposal_id = Some(proposal.id);
            } else {
                let document = db::new_document(finished.workspace_id.clone(), context.question.chars().take(80).collect(), DocumentKind::Discussion, Content::text(finished.answer.clone()), json!({"question":context.question,"model":finished.model_used,"run_id":finished.id,"context_id":context.id,"usage":finished.usage}));
                db::insert_document(&transaction, &document, "generation")?;
                let mut sources = HashSet::new();
                for source in &context.sources {
                    if !sources.insert(&source.document_id) { continue; }
                    db::insert_relation(&transaction, &Relation { id: id(), workspace_id: finished.workspace_id.clone(), source_id: source.document_id.clone(), target_id: document.id.clone(), source_ref: None, target_ref: None, kind: "context".into(), label: "讨论来源".into(), include_in_context: false, context_order: source.number as i64, claim: None, created_at: now() })?;
                }
                finished.document_id = Some(document.id);
            }
        }
        db::update_run(&transaction, &finished)?;
        transaction.commit()?;
        Ok(finished)
    }).await;
    match result {
        Ok(finished) => run = finished,
        Err(error) => {
            run.status = RunStatus::Failed;
            run.error = Some(format!("生成结果持久化失败：{error}"));
            let failed = run.clone();
            if let Err(error) = state.db.call(move |connection| db::update_run(connection, &failed)).await { tracing::error!(%error, run_id = %run.id, "保存失败状态失败"); }
        }
    }
    publish(&control, &run);
    state.runs.lock().await.remove(&run.id);
    tracing::info!(run_id = %run.id, status = ?run.status, "模型运行结束");
}
