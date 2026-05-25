use crate::language::LanguageConfig;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::process::Command;
use tokio::time::timeout;
use uuid::Uuid;

pub struct ExecutionResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub wall_time_ms: u64,
    pub timed_out: bool,
    pub compile_cmd: Option<Vec<String>>,
    pub run_cmd: Vec<String>,
}

pub async fn execute(config: &LanguageConfig, code: &str, _stdin: &str) -> ExecutionResult {
    let tmp_dir = PathBuf::from("/tmp").join(format!("sl_{}", Uuid::new_v4()));
    if let Err(e) = std::fs::create_dir_all(&tmp_dir) {
        return ExecutionResult {
            stdout: String::new(),
            stderr: format!("Failed to create temp directory: {}", e),
            exit_code: 1,
            wall_time_ms: 0,
            timed_out: false,
            compile_cmd: config.compile_cmd.clone(),
            run_cmd: config.run_cmd.clone(),
        };
    }

    for (filename, content) in &config.aux_files {
        let path = tmp_dir.join(filename);
        if let Err(e) = std::fs::write(&path, content) {
            let _ = std::fs::remove_dir_all(&tmp_dir);
            return ExecutionResult {
                stdout: String::new(),
                stderr: format!("Failed to write auxiliary file {}: {}", filename, e),
                exit_code: 1,
                wall_time_ms: 0,
                timed_out: false,
                compile_cmd: config.compile_cmd.clone(),
                run_cmd: config.run_cmd.clone(),
            };
        }
    }

    let source_file = tmp_dir.join(&config.source_filename);
    if let Err(e) = std::fs::write(&source_file, code) {
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return ExecutionResult {
            stdout: String::new(),
            stderr: format!("Failed to write source file: {}", e),
            exit_code: 1,
            wall_time_ms: 0,
            timed_out: false,
            compile_cmd: config.compile_cmd.clone(),
            run_cmd: config.run_cmd.clone(),
        };
    }

    let overall_start = Instant::now();
    let compiled_cmd = config.compile_cmd.as_ref().map(|t| build_command(t, &source_file, &tmp_dir));
    let run_cmd = build_command(&config.run_cmd, &source_file, &tmp_dir);

    if let Some(cmd) = &compiled_cmd {
        let result = run_process(cmd, &tmp_dir, 30).await;
        if result.exit_code != 0 || result.timed_out {
            let _ = std::fs::remove_dir_all(&tmp_dir);
            return ExecutionResult {
                stderr: result.stderr,
                stdout: result.stdout,
                exit_code: result.exit_code,
                wall_time_ms: result.wall_time_ms,
                timed_out: result.timed_out,
                compile_cmd: compiled_cmd,
                run_cmd,
            };
        }
    }

    let result = run_process(&run_cmd, &tmp_dir, 30).await;

    let _ = std::fs::remove_dir_all(&tmp_dir);

    ExecutionResult {
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exit_code,
        wall_time_ms: overall_start.elapsed().as_millis() as u64,
        timed_out: result.timed_out,
        compile_cmd: compiled_cmd,
        run_cmd,
    }
}

fn build_command(template: &[String], source_file: &Path, work_dir: &Path) -> Vec<String> {
    template
        .iter()
        .map(|arg| {
            arg.replace("{file}", &source_file.to_string_lossy())
                .replace("{dir}", &work_dir.to_string_lossy())
        })
        .collect()
}

async fn run_process(cmd: &[String], work_dir: &Path, timeout_secs: u64) -> ExecutionResult {
    let start = Instant::now();

    if cmd.is_empty() {
        return ExecutionResult {
            stdout: String::new(),
            stderr: "Empty command".into(),
            exit_code: 1,
            wall_time_ms: 0,
            timed_out: false,
            compile_cmd: None,
            run_cmd: vec![],
        };
    }

    let mut command = Command::new(&cmd[0]);
    command
        .args(&cmd[1..])
        .current_dir(work_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let child = match command.spawn() {
        Ok(c) => c,
        Err(e) => {
            return ExecutionResult {
                stdout: String::new(),
                stderr: format!("Failed to start process `{}`: {}", cmd[0], e),
                exit_code: 1,
                wall_time_ms: start.elapsed().as_millis() as u64,
                timed_out: false,
                compile_cmd: None,
                run_cmd: vec![],
            };
        }
    };

    let output = match timeout(
        Duration::from_secs(timeout_secs),
        child.wait_with_output(),
    )
    .await
    {
        Ok(Ok(output)) => output,
        Ok(Err(e)) => {
            return ExecutionResult {
                stdout: String::new(),
                stderr: format!("Process error: {}", e),
                exit_code: 1,
                wall_time_ms: start.elapsed().as_millis() as u64,
                timed_out: false,
                compile_cmd: None,
                run_cmd: vec![],
            };
        }
        Err(_elapsed) => {
            return ExecutionResult {
                stdout: String::new(),
                stderr: format!(
                    "Execution timed out after {}s (process was killed)",
                    timeout_secs
                ),
                exit_code: 124,
                wall_time_ms: timeout_secs * 1000,
                timed_out: true,
                compile_cmd: None,
                run_cmd: vec![],
            };
        }
    };

    ExecutionResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
        wall_time_ms: start.elapsed().as_millis() as u64,
        timed_out: false,
        compile_cmd: None,
        run_cmd: vec![],
    }
}
