use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tokio::sync::mpsc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalEditInfo {
    pub id: String,
    pub session_id: String,
    pub remote_path: String,
    pub local_path: String,
    pub filename: String,
    pub last_synced_at: u64,
    pub status: String, // "watching" | "syncing" | "synced" | "error"
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExternalEditEvent {
    pub id: String,
    pub session_id: String,
    pub remote_path: String,
    pub local_path: String,
    pub filename: String,
    pub last_synced_at: u64,
    pub status: String,
    pub error: Option<String>,
}

pub struct ActiveWatcherHandle {
    pub id: String,
    pub session_id: String,
    pub remote_path: String,
    pub local_path: PathBuf,
    pub is_active: Arc<AtomicBool>,
    pub trigger_tx: mpsc::Sender<()>,
    pub watcher: notify::RecommendedWatcher,
}

pub fn get_staging_dir(session_id: &str) -> Result<PathBuf, String> {
    let base_dir = std::env::temp_dir().join("flowsftp_ext_edits").join(session_id);
    if !base_dir.exists() {
        std::fs::create_dir_all(&base_dir)
            .map_err(|e| format!("Failed to create staging directory: {}", e))?;
    }
    Ok(base_dir)
}

pub fn launch_external_editor(path: &Path, preferred_editor: Option<&str>) -> Result<(), String> {
    if let Some(editor) = preferred_editor {
        let trimmed = editor.trim();
        if !trimmed.is_empty() && trimmed != "default" {
            // Check common editor alias or direct executable
            #[cfg(target_os = "windows")]
            {
                let cmd_str = match trimmed {
                    "code" | "vscode" => "code",
                    "cursor" => "cursor",
                    "subl" | "sublime" => "subl",
                    "notepad++" => "notepad++",
                    "notepad" => "notepad",
                    other => other,
                };

                let res = std::process::Command::new("cmd")
                    .args(["/c", cmd_str, &path.to_string_lossy()])
                    .spawn();

                if let Ok(_) = res {
                    return Ok(());
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                let cmd_str = match trimmed {
                    "code" | "vscode" => "code",
                    "cursor" => "cursor",
                    "subl" | "sublime" => "subl",
                    other => other,
                };

                let res = std::process::Command::new(cmd_str)
                    .arg(path)
                    .spawn();

                if let Ok(_) = res {
                    return Ok(());
                }
            }
        }
    }

    // Default system application launcher
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &path.to_string_lossy()])
            .spawn()
            .map_err(|e| format!("Failed to open file in default app: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }

    Ok(())
}

pub use super::now_epoch_secs;

