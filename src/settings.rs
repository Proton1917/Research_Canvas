use std::{collections::HashMap, io::Write, path::Path, sync::Arc, time::{Duration, Instant}};

use axum::{Json, extract::State, http::StatusCode};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::RwLock;

use crate::{AppState, config::{Protocol, Provider}, error::{ApiError, Result}};

pub struct ProviderRuntime {
    pub provider: Provider,
    pub revision: u64,
    pub client: reqwest::Client,
    pub key: Option<String>,
    pub models: RwLock<Option<(Instant, Value)>>,
}

fn header(name: &str, value: &str) -> Result<(HeaderName, HeaderValue)> {
    let name = HeaderName::from_bytes(name.as_bytes()).map_err(|_| ApiError::invalid("请求头名称格式无效"))?;
    let mut value = HeaderValue::from_str(value).map_err(|_| ApiError::invalid("请求头取值格式无效"))?;
    value.set_sensitive(true);
    Ok((name, value))
}

impl ProviderRuntime {
    pub fn new(mut provider: Provider, revision: u64) -> Result<Self> {
        provider.base_url = provider.base_url.trim().trim_end_matches('/').to_owned();
        let url = reqwest::Url::parse(&provider.base_url).map_err(|_| ApiError::invalid("请填写完整的 HTTP 或 HTTPS API 基础地址"))?;
        if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none()
            || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
            return Err(ApiError::invalid("API 基础地址使用 HTTP 或 HTTPS 域名与路径，凭据通过密钥字段提供"));
        }
        if provider.request_timeout_seconds == 0 || provider.max_output_tokens == 0 {
            return Err(ApiError::invalid("请求超时与输出长度需要大于零"));
        }
        let key = provider.api_key();
        let mut headers = HeaderMap::new();
        for (name, value) in &provider.headers {
            let (name, value) = header(name, value)?;
            headers.insert(name, value);
        }
        if provider.protocol == Protocol::AnthropicMessages && !headers.contains_key("anthropic-version") {
            headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
        }
        if let Some(key) = &key {
            let (name, value) = match provider.protocol {
                Protocol::ChatCompletions => header("authorization", &format!("Bearer {key}"))?,
                Protocol::AnthropicMessages => header("x-api-key", key)?,
            };
            headers.insert(name, value);
        }
        let client = reqwest::Client::builder().default_headers(headers)
            .timeout(Duration::from_secs(provider.request_timeout_seconds))
            .connect_timeout(Duration::from_secs(15)).build().map_err(ApiError::internal)?;
        Ok(Self { provider, revision, client, key, models: RwLock::new(None) })
    }

    pub fn credentials_available(&self) -> bool {
        self.provider.api_key_environment.is_none() || self.key.is_some()
    }

    pub fn request(&self, method: reqwest::Method, path: &str) -> Result<reqwest::RequestBuilder> {
        if !self.credentials_available() {
            return Err(ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "provider_not_configured", "请配置模型服务 API 密钥"));
        }
        Ok(self.client.request(method, format!("{}{path}", self.provider.base_url)))
    }

    pub fn error(&self, error: impl std::fmt::Display) -> ApiError {
        let mut message = error.to_string();
        for value in self.key.iter().chain(self.provider.headers.values()) {
            if !value.is_empty() {
                message = message.replace(value, "[redacted]");
                if let Some(token) = value.strip_prefix("Bearer ").filter(|token| !token.is_empty()) {
                    message = message.replace(token, "[redacted]");
                }
            }
        }
        ApiError::new(StatusCode::BAD_GATEWAY, "provider_error", message.chars().take(1200).collect::<String>())
    }

    pub fn view(&self) -> Value {
        let provider = &self.provider;
        let source = if provider.api_key.is_some() { "saved" }
            else if provider.api_key_environment.is_some() { "environment" }
            else if provider.headers.keys().any(|name| name.eq_ignore_ascii_case("authorization") || name.eq_ignore_ascii_case("x-api-key")) { "headers" }
            else { "none" };
        let mut header_names = provider.headers.keys().collect::<Vec<_>>();
        header_names.sort();
        json!({"revision":self.revision,"protocol":provider.protocol,"base_url":provider.base_url,
            "default_model":provider.default_model,"allowed_models":provider.allowed_models,"vision_models":provider.vision_models,
            "api_key_configured":self.key.is_some() || source == "headers", "credential_source":source,"header_names":header_names,
            "max_output_tokens":provider.max_output_tokens,"max_input_characters":provider.max_input_characters,
            "max_input_image_bytes":provider.max_input_image_bytes,"request_timeout_seconds":provider.request_timeout_seconds})
    }
}

#[derive(Deserialize, Serialize)]
struct SavedProvider {
    revision: u64,
    provider: Provider,
}

fn validate_models(provider: &Provider) -> Result<()> {
    if provider.default_model.trim().is_empty() || !provider.allowed_models.contains(&provider.default_model) {
        return Err(ApiError::invalid("请选择默认模型并将其列入启用模型"));
    }
    Ok(())
}

pub fn load(path: &Path, initial: Provider) -> Result<ProviderRuntime> {
    let saved = match std::fs::read_to_string(path) {
        Ok(text) => toml::from_str::<SavedProvider>(&text).map_err(|_| ApiError::invalid("本地模型设置文件格式无效"))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => SavedProvider { revision: 0, provider: initial },
        Err(error) => return Err(error.into()),
    };
    validate_models(&saved.provider)?;
    ProviderRuntime::new(saved.provider, saved.revision)
}

#[derive(Deserialize)]
pub struct ConnectionInput {
    pub protocol: Protocol,
    pub base_url: String,
    pub api_key: Option<String>,
    pub headers: Option<HashMap<String, String>>,
}

impl ConnectionInput {
    fn apply(self, current: &Provider) -> Provider {
        let mut provider = current.clone();
        let base_url = self.base_url.trim().trim_end_matches('/').to_owned();
        // 凭据沿用限于同一接口地址和协议，切换服务时由本次输入建立认证。
        if base_url != current.base_url || self.protocol != current.protocol {
            provider.headers.clear();
            provider.api_key = None;
            provider.api_key_environment = None;
        }
        provider.protocol = self.protocol;
        provider.base_url = base_url;
        if let Some(headers) = self.headers { provider.headers = headers; }
        if let Some(key) = self.api_key {
            provider.api_key = if key.trim().is_empty() { None } else { Some(key.trim().to_owned()) };
            provider.api_key_environment = None;
            provider.headers.retain(|name, _| !name.eq_ignore_ascii_case("authorization") && !name.eq_ignore_ascii_case("x-api-key"));
        }
        provider
    }
}

#[derive(Deserialize)]
pub struct ProviderUpdate {
    pub expected_revision: u64,
    #[serde(flatten)] pub connection: ConnectionInput,
    pub default_model: String,
    #[serde(default)] pub allowed_models: Vec<String>,
    #[serde(default)] pub vision_models: Vec<String>,
}

#[derive(Deserialize)]
pub struct ConnectionTest {
    #[serde(flatten)] pub connection: ConnectionInput,
    pub model: Option<String>,
}

pub async fn read(State(state): State<AppState>) -> Json<Value> {
    Json(state.provider.read().await.view())
}

pub async fn save(State(state): State<AppState>, Json(input): Json<ProviderUpdate>) -> Result<Json<Value>> {
    let mut active = state.provider.clone().write_owned().await;
    if input.expected_revision != active.revision {
        let mut error = ApiError::new(StatusCode::CONFLICT, "settings_conflict", "模型设置已更新，请载入当前设置后保存");
        error.details = json!({"current_revision":active.revision});
        return Err(error);
    }
    let mut provider = input.connection.apply(&active.provider);
    provider.default_model = input.default_model.trim().to_owned();
    provider.allowed_models = input.allowed_models;
    if !provider.allowed_models.contains(&provider.default_model) { provider.allowed_models.push(provider.default_model.clone()); }
    provider.vision_models = input.vision_models;
    validate_models(&provider)?;
    let next = ProviderRuntime::new(provider, active.revision + 1)?;
    let encoded = toml::to_string(&SavedProvider { revision: next.revision, provider: next.provider.clone() }).map_err(ApiError::internal)?;
    let path = state.provider_path.clone();
    let response = tokio::task::spawn_blocking(move || -> Result<Value> {
        let mut file = tempfile::NamedTempFile::new_in(path.parent().unwrap())?;
        file.write_all(encoded.as_bytes())?;
        file.as_file().sync_all()?;
        file.persist(path.as_ref()).map_err(|error| ApiError::from(error.error))?;
        let response = next.view();
        *active = Arc::new(next);
        Ok(response)
    }).await.map_err(ApiError::internal)??;
    Ok(Json(response))
}

pub async fn test(State(state): State<AppState>, Json(input): Json<ConnectionTest>) -> Result<Json<Value>> {
    let active = state.provider.read().await.clone();
    let candidate = ProviderRuntime::new(input.connection.apply(&active.provider), active.revision)?;
    let models = crate::provider::fetch_models(&candidate).await?;
    let available = input.model.as_ref().map(|model| models.iter().any(|entry| entry["id"].as_str() == Some(model.as_str())));
    Ok(Json(json!({"connected":true,"models":models,"model":input.model,"model_available":available})))
}
