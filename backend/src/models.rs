use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct ExecuteRequest {
    pub language: String,
    pub code: String,
    #[serde(default)]
    pub stdin: String,
}

#[derive(Serialize)]
pub struct ExecuteResponse {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub wall_time_ms: u64,
    pub timed_out: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compile_cmd: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_cmd: Option<Vec<String>>,
}
