use axum::{extract::State, routing::get, Json, Router};
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

mod executor;
mod language;
mod models;

struct AppState {
    languages: Vec<language::LanguageConfig>,
}

#[tokio::main]
async fn main() {
    let state = Arc::new(AppState {
        languages: language::all_languages(),
    });

    let frontend_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../frontend");

    let app = Router::new()
        .route("/api/languages", get(list_languages))
        .route("/api/execute", axum::routing::post(execute_code))
        .route("/api/health", get(|| async { "ok" }))
        .fallback_service(ServeDir::new(frontend_dir))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000")
        .await
        .unwrap();
    println!("⚡ simplelanguages.com running on http://localhost:3000");
    axum::serve(listener, app).await.unwrap();
}

async fn list_languages(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<language::LanguageInfo>> {
    Json(state.languages.iter().map(|l| l.info.clone()).collect())
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
            })
        }
        None => Json(models::ExecuteResponse {
            stdout: String::new(),
            stderr: format!("Unknown language: {}", req.language),
            exit_code: 1,
            wall_time_ms: 0,
            timed_out: false,
        }),
    }
}
