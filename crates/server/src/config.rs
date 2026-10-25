use serde::Deserialize;
use std::{collections::HashMap, path::Path};

#[derive(Clone, Deserialize)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub temporary_directory: String,
    pub frontend_directory: String,
    pub allowed_origins: Vec<String>,
    pub max_request_bytes: usize,
    pub pdf_extract_timeout_seconds: u64,
    pub provider: Provider,
    pub prompts: HashMap<String, String>,
}

#[derive(Clone, Deserialize)]
pub struct Provider {
    pub protocol: Protocol,
    pub base_url: String,
    pub api_key_environment: Option<String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    pub default_model: String,
    pub allowed_models: Vec<String>,
    pub request_timeout_seconds: u64,
    pub max_output_tokens: u32,
    pub models_cache_seconds: u64,
}

#[derive(Clone, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Protocol {
    ChatCompletions,
    AnthropicMessages,
}

impl Config {
    pub fn load(path: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        let mut config: Self = toml::from_str(&std::fs::read_to_string(path)?)?;
        for prompt in config.prompts.values_mut() { *prompt = std::fs::read_to_string(&*prompt)?; }
        for mode in ["discussion", "rewrite", "relation"] {
            if !config.prompts.contains_key(mode) { return Err(format!("缺少提示词配置：{mode}").into()); }
        }
        if !config.provider.allowed_models.contains(&config.provider.default_model) {
            return Err("默认模型需要包含在允许的模型列表中".into());
        }
        for (name, value) in &config.provider.headers {
            reqwest::header::HeaderName::from_bytes(name.as_bytes())?;
            reqwest::header::HeaderValue::from_str(value)?;
        }
        std::fs::create_dir_all(&config.temporary_directory)?;
        if let Some(parent) = Path::new(&config.database).parent() { std::fs::create_dir_all(parent)?; }
        Ok(config)
    }

    pub fn api_key(&self) -> Option<String> {
        self.provider.api_key_environment.as_ref().and_then(|name| std::env::var(name).ok()).filter(|key| !key.trim().is_empty())
    }

    pub fn credentials_available(&self) -> bool {
        self.provider.api_key_environment.is_none() || self.api_key().is_some()
    }
}
