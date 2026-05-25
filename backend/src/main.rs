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

async fn list_languages(
    State(state): State<Arc<AppState>>,
) -> Json<Vec<language::LanguageInfo>> {
    Json(state.languages.iter().map(|l| {
        let mut info = l.info.clone();
        info.compile_cmd = l.compile_cmd.clone();
        info.run_cmd = Some(l.run_cmd.clone());
        info
    }).collect())
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
