use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plugin {
    pub id: String,
    pub name: String,
    pub desc: String,
    pub cat: String,
    #[serde(default)]
    pub ver: String,
    #[serde(default)]
    pub tpl: String,
    #[serde(default)]
    pub css: String,
    #[serde(default)]
    pub upcoming: bool,
    #[serde(default)]
    pub status: String, // "pending", "approved", "rejected"
    #[serde(default)]
    pub submitted_at: String,
    #[serde(default)]
    pub source_filename: Option<String>,
    #[serde(default)]
    pub compile_cmd: Option<Vec<String>>,
    #[serde(default)]
    pub run_cmd: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct PluginSubmission {
    pub name: String,
    pub desc: String,
    pub cat: String,
    #[serde(default)]
    pub ver: String,
    #[serde(default)]
    pub tpl: String,
    #[serde(default)]
    pub css: String,
    #[serde(default)]
    pub source_filename: Option<String>,
    #[serde(default)]
    pub compile_cmd: Option<Vec<String>>,
    #[serde(default)]
    pub run_cmd: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct PluginListResponse {
    pub plugins: Vec<Plugin>,
}

pub struct PluginStore {
    path: PathBuf,
    mu: Mutex<()>,
}

impl PluginStore {
    pub fn new(path: PathBuf) -> Self {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if !path.exists() {
            let _ = fs::write(&path, "[]");
        }
        Self { path, mu: Mutex::new(()) }
    }

    pub fn all_approved(&self) -> Vec<Plugin> {
        let _lock = self.mu.lock().unwrap();
        let plugins: Vec<Plugin> = self.read();
        plugins.into_iter().filter(|p| p.status == "approved").collect()
    }

    pub fn pending(&self) -> Vec<Plugin> {
        let _lock = self.mu.lock().unwrap();
        let plugins: Vec<Plugin> = self.read();
        plugins.into_iter().filter(|p| p.status == "pending").collect()
    }

    pub fn submit(&self, sub: PluginSubmission) -> Result<Plugin, String> {
        let _lock = self.mu.lock().unwrap();
        let mut plugins: Vec<Plugin> = self.read();

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let id = format!(
            "user-{}-{}",
            sub.name.to_lowercase().replace(' ', "-"),
            now
        );

        if plugins.iter().any(|p| p.id == id) {
            return Err("Plugin with this ID already exists".into());
        }

        let plugin = Plugin {
            id,
            name: sub.name,
            desc: sub.desc,
            cat: sub.cat,
            ver: sub.ver,
            tpl: sub.tpl,
            css: sub.css,
            upcoming: false,
            status: "pending".into(),
            submitted_at: chrono_now(),
            source_filename: sub.source_filename,
            compile_cmd: sub.compile_cmd,
            run_cmd: sub.run_cmd,
        };

        plugins.push(plugin.clone());
        self.write(&plugins);
        Ok(plugin)
    }

    pub fn approve(&self, id: &str) -> Result<Plugin, String> {
        let _lock = self.mu.lock().unwrap();
        let mut plugins: Vec<Plugin> = self.read();
        let idx = plugins.iter().position(|p| p.id == id)
            .ok_or("Plugin not found")?;
        if plugins[idx].status != "pending" {
            return Err("Plugin is not pending".into());
        }
        plugins[idx].status = "approved".into();
        let plugin = plugins[idx].clone();
        self.write(&plugins);
        Ok(plugin)
    }

    pub fn reject(&self, id: &str) -> Result<Plugin, String> {
        let _lock = self.mu.lock().unwrap();
        let mut plugins: Vec<Plugin> = self.read();
        let idx = plugins.iter().position(|p| p.id == id)
            .ok_or("Plugin not found")?;
        if plugins[idx].status != "pending" {
            return Err("Plugin is not pending".into());
        }
        plugins[idx].status = "rejected".into();
        let plugin = plugins[idx].clone();
        self.write(&plugins);
        Ok(plugin)
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        let _lock = self.mu.lock().unwrap();
        let mut plugins: Vec<Plugin> = self.read();
        let idx = plugins.iter().position(|p| p.id == id)
            .ok_or("Plugin not found")?;
        plugins.remove(idx);
        self.write(&plugins);
        Ok(())
    }

    fn read(&self) -> Vec<Plugin> {
        match fs::read_to_string(&self.path) {
            Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
            Err(_) => vec![],
        }
    }

    fn write(&self, plugins: &[Plugin]) {
        let data = serde_json::to_string_pretty(plugins).unwrap_or_else(|_| "[]".into());
        let _ = fs::write(&self.path, data);
    }
}

pub fn get_data_dir() -> PathBuf {
    std::env::var("SL_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let mut p = PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".into()));
            p.push(".simplelanguages");
            p
        })
}

pub fn get_plugins_path() -> PathBuf {
    let mut p = get_data_dir();
    p.push("plugins.json");
    p
}

pub fn check_owner_key(key: &str) -> bool {
    let expected = std::env::var("OWNER_API_KEY").unwrap_or_default();
    if expected.is_empty() {
        return false;
    }
    key == expected
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    // basic YYYY-MM-DD HH:MM:SS UTC
    let secs_in_day: u64 = 86400;
    let days = d / secs_in_day;
    let time_of_day = d % secs_in_day;
    let hours = time_of_day / 3600;
    let mins = (time_of_day % 3600) / 60;
    let secs = time_of_day % 60;

    let total_days = days + 719468;
    let era = total_days / 146097;
    let doe = total_days - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = y + if month <= 2 { 1 } else { 0 };

    format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", year, month, day, hours, mins, secs)
}
