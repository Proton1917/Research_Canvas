use axum::{Json, http::StatusCode, response::{IntoResponse, Response}};
use serde_json::{Value, json};

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
    pub details: Value,
}

impl ApiError {
    pub fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self { status, code, message: message.into(), details: Value::Null }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNPROCESSABLE_ENTITY, "invalid_input", message)
    }

    pub fn missing(object: &str) -> Self {
        Self::new(StatusCode::NOT_FOUND, "not_found", format!("未找到{object}"))
    }

    pub fn conflict(version: i64) -> Self {
        let mut error = Self::new(StatusCode::CONFLICT, "version_conflict", "内容已更新，请读取当前版本后提交");
        error.details = json!({"current_version": version});
        error
    }

    pub fn internal(error: impl std::fmt::Display) -> Self {
        tracing::error!(error = %error, "内部操作失败");
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", "服务内部操作失败，详情见服务日志")
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for ApiError {}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({"error": {"code": self.code, "message": self.message, "details": self.details}}))).into_response()
    }
}

impl From<rusqlite::Error> for ApiError {
    fn from(error: rusqlite::Error) -> Self {
        match error {
            rusqlite::Error::QueryReturnedNoRows => Self::missing("记录"),
            error => Self::internal(error),
        }
    }
}

impl From<serde_json::Error> for ApiError {
    fn from(error: serde_json::Error) -> Self { Self::internal(error) }
}

impl From<std::io::Error> for ApiError {
    fn from(error: std::io::Error) -> Self { Self::internal(error) }
}

pub type Result<T> = std::result::Result<T, ApiError>;
