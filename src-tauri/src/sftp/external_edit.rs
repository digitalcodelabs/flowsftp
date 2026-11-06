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

pub fn sanitize_path_component(raw: &str, fallback: &str) -> String {
    let cleaned: String = raw
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | '\0' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn get_staging_dir(session_id: &str) -> Result<PathBuf, String> {
    let safe_session = sanitize_path_component(session_id, "session");
    let base_dir = std::env::temp_dir().join("flowsftp_ext_edits").join(safe_session);
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
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;

                let cmd_str = match trimmed {
                    "code" | "vscode" => "code",
                    "cursor" => "cursor",
                    "zed" => "zed",
                    "subl" | "sublime" => "subl",
                    "notepad++" => "notepad++",
                    "notepad" => "notepad",
                    other => other,
                };

                let candidates = [
                    cmd_str.to_string(),
                    format!("{}.cmd", cmd_str),
                    format!("{}.exe", cmd_str),
                ];

                for candidate in candidates {
                    let mut cmd = std::process::Command::new(&candidate);
                    cmd.arg(path);
                    if candidate.ends_with(".cmd") || candidate.ends_with(".bat") {
                        cmd.creation_flags(CREATE_NO_WINDOW);
                    }
                    if cmd.spawn().is_ok() {
                        return Ok(());
                    }
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                let cmd_str = match trimmed {
                    "code" | "vscode" => "code",
                    "cursor" => "cursor",
                    "zed" => "zed",
                    "subl" | "sublime" => "subl",
                    other => other,
                };

                let res = std::process::Command::new(cmd_str)
                    .arg(path)
                    .spawn();

                if res.is_ok() {
                    return Ok(());
                }
            }
        }
    }

    // Default system application launcher
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", &path.to_string_lossy()])
            .creation_flags(CREATE_NO_WINDOW)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_traversal_and_separators() {
        assert_eq!(sanitize_path_component("../../etc/passwd", "unnamed"), "etcpasswd");
        assert_eq!(sanitize_path_component("..", "unnamed"), "unnamed");
        assert_eq!(sanitize_path_component("...", "unnamed"), "unnamed");
        assert_eq!(sanitize_path_component("normal_file.rs", "unnamed"), "normal_file.rs");
    }
}

