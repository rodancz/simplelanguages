use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{delete, get, post},
    Json, Router,
};
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

mod executor;
mod language;
mod models;
mod plugins;

struct AppState {
    languages: Vec<language::LanguageConfig>,
    plugin_store: plugins::PluginStore,
}

#[tokio::main]
async fn main() {
    let plugin_store = plugins::PluginStore::new(plugins::get_plugins_path());
    let state = Arc::new(AppState {
        languages: language::all_languages(),
        plugin_store,
    });

    let frontend_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../frontend");

    let app = Router::new()
        .route("/api/languages", get(list_languages))
        .route("/api/execute", post(execute_code))
        .route("/api/health", get(|| async { "ok" }))
        .route("/api/plugins", get(list_approved_plugins).post(submit_plugin))
        .route("/api/plugins/pending", get(list_pending_plugins))
        .route("/api/plugins/{id}/approve", post(approve_plugin))
        .route("/api/plugins/{id}/reject", post(reject_plugin))
        .route("/api/plugins/{id}", delete(delete_plugin))
        .fallback_service(ServeDir::new(frontend_dir))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3000);

    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap();
    println!("⚡ simplelanguages.com running on http://{}", addr);
    axum::serve(listener, app).await.unwrap();
}

fn require_owner(headers: &HeaderMap) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let key = headers
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if plugins::check_owner_key(key) {
        Ok(())
    } else {
        Err((
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "unauthorized"})),
        ))
    }
}

async fn list_languages(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<language::LanguageInfo>> {
    Json(
        state
            .languages
            .iter()
            .map(|l| {
                let mut info = l.info.clone();
                info.compile_cmd = l.compile_cmd.clone();
                info.run_cmd = Some(l.run_cmd.clone());
                info
            })
            .collect(),
    )
}

async fn execute_code(
    State(state): State<Arc<AppState>>,
    Json(req): Json<models::ExecuteRequest>,
) -> Json<models::ExecuteResponse> {
    let lang = state.languages.iter().find(|l| l.info.id == req.language);

    match lang {
        Some(config) => {
            let result = executor::execute(config, &req.code, &req.stdin).await;
            Json(models::ExecuteResponse {
                stdout: result.stdout,
                stderr: result.stderr,
                exit_code: result.exit_code,
                wall_time_ms: result.wall_time_ms,
                timed_out: result.timed_out,
                compile_cmd: result.compile_cmd,
                run_cmd: Some(result.run_cmd),
            })
        }
        None => Json(models::ExecuteResponse {
            stdout: String::new(),
            stderr: format!("Unknown language: {}", req.language),
            exit_code: 1,
            wall_time_ms: 0,
            timed_out: false,
            compile_cmd: None,
            run_cmd: None,
        }),
    }
}

// === Plugin routes ===

async fn list_approved_plugins(
    State(state): State<Arc<AppState>>,
) -> Json<plugins::PluginListResponse> {
    Json(plugins::PluginListResponse {
        plugins: state.plugin_store.all_approved(),
    })
}

async fn submit_plugin(
    State(state): State<Arc<AppState>>,
    Json(sub): Json<plugins::PluginSubmission>,
) -> Result<Json<plugins::Plugin>, (StatusCode, Json<serde_json::Value>)> {
    if sub.name.trim().is_empty() || sub.desc.trim().is_empty() || sub.cat.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "name, desc, and cat are required"})),
        ));
    }
    if !["language", "theme", "engine", "ai"].contains(&sub.cat.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "cat must be language, theme, engine, or ai"})),
        ));
    }
    state
        .plugin_store
        .submit(sub)
        .map(Json)
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": e})),
            )
        })
}

async fn list_pending_plugins(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> Result<Json<plugins::PluginListResponse>, (StatusCode, Json<serde_json::Value>)> {
    require_owner(&headers)?;
    Ok(Json(plugins::PluginListResponse {
        plugins: state.plugin_store.pending(),
    }))
}

async fn approve_plugin(
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<String>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<plugins::Plugin>, (StatusCode, Json<serde_json::Value>)> {
    require_owner(&headers)?;
    state
        .plugin_store
        .approve(&id)
        .map(Json)
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": e})),
            )
        })
}

async fn reject_plugin(
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<String>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<plugins::Plugin>, (StatusCode, Json<serde_json::Value>)> {
    require_owner(&headers)?;
    state
        .plugin_store
        .reject(&id)
        .map(Json)
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": e})),
            )
        })
}

async fn delete_plugin(
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<String>,
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    require_owner(&headers)?;
    state
        .plugin_store
        .delete(&id)
        .map(|_| Json(serde_json::json!({"deleted": id})))
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": e})),
            )
        })
}
