mod api;
mod canvas_proposal;
mod canvas_output;
mod canvas_state;
mod claim;
mod config;
mod context;
mod db;
mod endpoints;
mod error;
mod model;
mod math_text;
mod provider;
mod research;
mod run_placement;
mod scene;
mod scene_projection;
mod transfer;
mod visual;
mod visual_assets;

use std::{collections::HashMap, path::PathBuf, sync::Arc, time::{Duration, Instant}};

use axum::{Router, extract::{DefaultBodyLimit, Request, State}, http::{HeaderValue, Method, header}, middleware::{self, Next}, response::Response, routing::{get, post}};
use serde_json::Value;
use tokio::sync::{Mutex, RwLock, watch};
use tokio_util::sync::CancellationToken;
use tower_http::{cors::CorsLayer, services::{ServeDir, ServeFile}, trace::TraceLayer};

use crate::{config::Config, db::Db, error::{ApiError, Result}, model::RunProgress};

#[derive(Clone)]
struct RunControl {
    progress: watch::Sender<RunProgress>,
    cancel: CancellationToken,
}

#[derive(Clone)]
struct AppState {
    config: Arc<Config>,
    db: Db,
    client: reqwest::Client,
    runs: Arc<Mutex<HashMap<String, RunControl>>>,
    models: Arc<RwLock<Option<(Instant, Value)>>>,
    tasks: Arc<Mutex<Vec<tokio::task::JoinHandle<()>>>>,
    shutdown: CancellationToken,
}

async fn origin_guard(State(state): State<AppState>, request: Request, next: Next) -> Result<Response> {
    if let Some(origin) = request.headers().get(header::ORIGIN) {
        let origin = origin.to_str().map_err(|_| ApiError::invalid("Origin 请求头无效"))?;
        if !state.config.allowed_origins.iter().any(|allowed| allowed == origin) {
            return Err(ApiError::new(axum::http::StatusCode::FORBIDDEN, "origin_forbidden", "此页面来源未获本地服务授权"));
        }
    }
    Ok(next.run(request).await)
}

#[tokio::main]
async fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "research_canvas=info,tower_http=info".into())).init();
    let env_file = PathBuf::from(".env");
    if env_file.exists() { dotenvy::from_path(env_file)?; }
    let config_path = std::env::var_os("RC_CONFIG").map(PathBuf::from).unwrap_or_else(|| "config/server.toml".into());
    let config = Config::load(&config_path)?;
    let address = format!("{}:{}", config.host, config.port);
    let origins = config.allowed_origins.iter().map(|origin| origin.parse::<HeaderValue>()).collect::<std::result::Result<Vec<_>, _>>()?;
    let static_files = ServeDir::new(&config.frontend_directory).not_found_service(ServeFile::new(PathBuf::from(&config.frontend_directory).join("index.html")));
    let state = AppState {
        db: Db::open(&config.database)?,
        client: reqwest::Client::builder().timeout(Duration::from_secs(config.provider.request_timeout_seconds)).connect_timeout(Duration::from_secs(15)).build()?,
        config: Arc::new(config), runs: Arc::new(Mutex::new(HashMap::new())), models: Arc::new(RwLock::new(None)), tasks: Arc::new(Mutex::new(Vec::new())), shutdown: CancellationToken::new(),
    };
    let routes = Router::new()
        .route("/health", get(api::health))
        .route("/capabilities", get(scene::capabilities))
        .route("/models", get(provider::models))
        .route("/workspaces", get(api::list_workspaces).post(api::create_workspace))
        .route("/workspaces/import", post(transfer::import_archive))
        .route("/workspaces/{id}", get(api::get_workspace).patch(api::rename_workspace))
        .route("/workspaces/{id}/documents", post(api::create_document))
        .route("/documents/{id}", get(api::get_document).patch(api::update_document))
        .route("/documents/{id}/versions", get(api::list_versions))
        .route("/documents/{id}/versions/{version}", get(api::get_version))
        .route("/documents/{id}/restore", post(api::restore_version))
        .route("/workspaces/{id}/canvases", post(api::create_canvas))
        .route("/canvases/{id}", get(api::get_canvas).put(api::update_canvas))
        .route("/workspaces/{id}/relations", post(api::create_relation))
        .route("/relations/{id}", get(claim::read).patch(api::update_relation).delete(api::delete_relation))
        .route("/relations/{id}/review", post(claim::review))
        .route("/workspaces/{id}/anchors", post(api::create_anchor))
        .route("/anchors/{id}", get(api::get_anchor))
        .route("/anchors/{id}/resolve", get(api::resolve_anchor))
        .route("/workspaces/{id}/contexts", post(api::create_context))
        .route("/workspaces/{id}/scene-contexts", post(scene::create_context))
        .route("/contexts/{id}", get(api::get_context))
        .route("/contexts/{id}/freshness", get(context::read_freshness))
        .route("/workspaces/{id}/runs", get(api::list_runs).post(provider::start_run))
        .route("/runs/{id}", get(api::get_run))
        .route("/runs/{id}/events", get(api::run_events))
        .route("/runs/{id}/cancel", post(api::cancel_run))
        .route("/runs/{id}/place", post(run_placement::place))
        .route("/runs/{id}/recover-canvas-proposal", post(canvas_proposal::recover))
        .route("/proposals/{id}", get(api::get_proposal))
        .route("/proposals/{id}/apply", post(api::apply_proposal))
        .route("/proposals/{id}/revert", post(api::revert_proposal))
        .route("/proposals/{id}/reject", post(api::reject_proposal))
        .route("/canvas-proposals/{id}", get(canvas_proposal::read).patch(canvas_proposal::edit))
        .route("/canvas-proposals/{id}/apply", post(canvas_proposal::apply))
        .route("/canvas-proposals/{id}/revert", post(canvas_proposal::revert))
        .route("/canvas-proposals/{id}/reject", post(canvas_proposal::reject))
        .route("/workspaces/{id}/imports", post(transfer::import_file))
        .route("/workspaces/{id}/visual-assets", get(visual_assets::list).post(visual_assets::upload))
        .route("/workspaces/{id}/visual-assets/{asset_id}", axum::routing::delete(visual_assets::discard))
        .route("/assets/{id}", get(transfer::get_asset))
        .route("/workspaces/{id}/search", get(api::search))
        .route("/workspaces/{id}/export", get(transfer::export_json))
        .route("/workspaces/{id}/export.zip", get(transfer::export_zip))
        .fallback(scene::api_not_found)
        .layer(middleware::from_fn_with_state(state.clone(), origin_guard))
        .layer(DefaultBodyLimit::max(state.config.max_request_bytes));
    let application = Router::new().nest("/api", routes).fallback_service(static_files)
        .layer(CorsLayer::new().allow_origin(origins).allow_methods([Method::GET,Method::POST,Method::PUT,Method::PATCH,Method::DELETE]).allow_headers([header::CONTENT_TYPE]))
        .layer(TraceLayer::new_for_http()).with_state(state.clone());
    let listener = tokio::net::TcpListener::bind(&address).await?;
    tracing::info!(address = %address, "Research Canvas 后端已启动");
    let stopping = state.shutdown.clone();
    axum::serve(listener, application).with_graceful_shutdown(async move {
        #[cfg(unix)]
        let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("无法安装终止信号处理器");
        #[cfg(windows)]
        let mut terminate = tokio::signal::windows::ctrl_break().expect("无法安装 Ctrl+Break 信号处理器");
        tokio::select! {
            result = tokio::signal::ctrl_c() => result.expect("无法接收 Ctrl+C 信号"),
            _ = terminate.recv() => {},
        }
        stopping.cancel();
    }).await?;
    for task in state.tasks.lock().await.drain(..) { task.await?; }
    tracing::info!("Research Canvas 后端已停止");
    Ok(())
}
