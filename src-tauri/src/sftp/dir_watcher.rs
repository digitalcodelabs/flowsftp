use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;

use crate::sftp::{ensure_remote_dir_recursive, write_remote_file_binary};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirWatcherPairing {
    pub id: String,
    pub session_id: String,
    pub local_dir: String,
    pub remote_dir: String,
    pub enabled: bool,
    pub ignore_patterns: Vec<String>,
    pub last_sync_time: Option<u64>,
    pub last_synced_file: Option<String>,
    pub status: String, // "watching", "syncing", "paused", "error"
    pub error: Option<String>,
    pub files_uploaded: u64,
}

pub struct ActiveDirWatcherHandle {
    pub id: String,
    pub is_active: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirWatcherSyncEvent {
    pub watcher_id: String,
    pub session_id: String,
    pub filename: String,
    pub relative_path: String,
    pub remote_path: String,
    pub status: String, // "syncing", "uploaded", "error"
    pub error: Option<String>,
    pub timestamp: u64,
}

pub use super::now_epoch_secs;

pub fn should_ignore_file(rel_path: &Path, ignore_patterns: &[String]) -> bool {
    let rel_str = rel_path.to_string_lossy().replace('\\', "/");
    let file_name = rel_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());

    // 1. Check user-configured patterns
    if crate::sftp::is_path_ignored(&file_name, &rel_str, ignore_patterns) {
        return true;
    }

    // 2. Default ignored build directories, caches, and temp files
    const DEFAULT_IGNORED: &[&str] = &[
        ".git", "node_modules", ".vscode", ".idea", "dist", "build",
        ".next", ".nuxt", "target", ".cache", ".turbo", "vendor",
        "__pycache__", ".DS_Store", "Thumbs.db", ".flowsftp",
        "*.swp", "*.tmp", "*.log", "*~", ".#*", ".goutputstream-*",
    ];

    let default_pats: Vec<String> = DEFAULT_IGNORED.iter().map(|&s| s.to_string()).collect();
    crate::sftp::is_path_ignored(&file_name, &rel_str, &default_pats)
}

fn collect_dir_files_recursive(
    dir: &Path,
    watched_root: &Path,
    ignores: &[String],
    results: &mut Vec<PathBuf>,
) {
    let read_dir = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };

    for entry in read_dir.flatten() {
        let path = entry.path();
        let rel_path = match path.strip_prefix(watched_root) {
            Ok(r) => r,
            Err(_) => continue,
        };

        if should_ignore_file(rel_path, ignores) {
            continue;
        }

        if let Ok(file_type) = entry.file_type() {
            if file_type.is_dir() {
                collect_dir_files_recursive(&path, watched_root, ignores, results);
            } else if file_type.is_file() || file_type.is_symlink() {
                results.push(path);
            }
        }
    }
}

pub fn start_directory_watcher(
    app: AppHandle,
    _state: &AppState,
    watcher_id: String,
    session_id: String,
    local_dir: PathBuf,
    remote_dir: String,
    ignore_patterns: Vec<String>,
) -> Result<ActiveDirWatcherHandle, String> {
    let is_active = Arc::new(AtomicBool::new(true));
    let is_active_clone = is_active.clone();

    let (event_tx, mut event_rx) = mpsc::channel::<PathBuf>(256);

    let watched_root = local_dir.clone();
    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                match event.kind {
                    EventKind::Create(_) | EventKind::Modify(_) => {
                        for path in event.paths {
                            let _ = event_tx.blocking_send(path);
                        }
                    }
                    _ => {}
                }
            }
        },
        notify::Config::default(),
    )
    .map_err(|e| format!("Failed to create filesystem watcher: {}", e))?;

    watcher
        .watch(&local_dir, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch directory '{}': {}", local_dir.display(), e))?;

    // Spawn the background worker with debouncing
    let w_id = watcher_id.clone();
    let s_id = session_id.clone();
    let r_dir = remote_dir.clone();
    let ignores = ignore_patterns.clone();
    let app_handle = app.clone();

    tauri::async_runtime::spawn(async move {
        // Keep watcher instance alive for the lifetime of this async loop
        let _watcher = watcher;

        while is_active_clone.load(Ordering::SeqCst) {
            // Wait for first event or timeout
            let first_path = match tokio::time::timeout(Duration::from_millis(500), event_rx.recv()).await {
                Ok(Some(p)) => p,
                Ok(None) => break, // Channel closed
                Err(_) => continue,
            };

            let mut batch = HashSet::new();
            batch.insert(first_path);

            // Debounce window: drain all queued events over the next 400ms
            let debounce_end = Instant::now() + Duration::from_millis(400);
            while Instant::now() < debounce_end {
                match tokio::time::timeout(Duration::from_millis(100), event_rx.recv()).await {
                    Ok(Some(p)) => {
                        batch.insert(p);
                    }
                    _ => break,
                }
            }

            if !is_active_clone.load(Ordering::SeqCst) {
                break;
            }

            // Process all modified paths
            for path in batch {
                if !is_active_clone.load(Ordering::SeqCst) {
                    break;
                }

                // Check if path is a regular file that exists
                let meta = match tokio::fs::metadata(&path).await {
                    Ok(m) => m,
                    Err(_) => continue, // Deleted or temporary lock
                };

                let mut files_to_sync = Vec::new();
                if meta.is_file() || meta.is_symlink() {
                    files_to_sync.push(path);
                } else if meta.is_dir() {
                    collect_dir_files_recursive(&path, &watched_root, &ignores, &mut files_to_sync);
                }

                for file_path in files_to_sync {
                    if !is_active_clone.load(Ordering::SeqCst) {
                        break;
                    }

                    let rel_path = match file_path.strip_prefix(&watched_root) {
                        Ok(r) => r,
                        Err(_) => continue,
                    };

                    if should_ignore_file(rel_path, &ignores) {
                        continue;
                    }

                    let rel_str = rel_path.to_string_lossy().replace('\\', "/");
                    let filename = file_path.file_name().unwrap_or_default().to_string_lossy().to_string();
                    let remote_target_path = format!("{}/{}", r_dir.trim_end_matches('/'), rel_str);
                    let remote_parent = remote_target_path.rsplit_once('/').map(|(p, _)| p).unwrap_or("");

                    // Emit syncing status
                    let _ = app_handle.emit(
                        "dir-watcher:event",
                        DirWatcherSyncEvent {
                            watcher_id: w_id.clone(),
                            session_id: s_id.clone(),
                            filename: filename.clone(),
                            relative_path: rel_str.clone(),
                            remote_path: remote_target_path.clone(),
                            status: "syncing".to_string(),
                            error: None,
                            timestamp: now_epoch_secs(),
                        },
                    );

                    // Small delay to ensure file write handle is completely closed by OS
                    tokio::time::sleep(Duration::from_millis(100)).await;

                    let file_data = match tokio::fs::read(&file_path).await {
                        Ok(d) => d,
                        Err(e) => {
                            log::warn!("[dir-watcher] Failed to read local file '{}': {}", file_path.display(), e);
                            continue;
                        }
                    };

                let state = app_handle.state::<AppState>();
                let upload_result: Result<(), String> = if let Some(ftp) = state.get_ftp_session(&s_id).await {
                    if !remote_parent.is_empty() {
                        let _ = ftp.create_dir(remote_parent).await;
                    }
                    ftp.write_file_binary(&remote_target_path, &file_data).await
                } else if let Some(session) = state.get_session(&s_id).await {
                    match session.get_sftp().await {
                        Ok(sftp) => {
                            if !remote_parent.is_empty() {
                                let _ = ensure_remote_dir_recursive(&sftp, remote_parent).await;
                            }
                            write_remote_file_binary(&sftp, &remote_target_path, &file_data).await
                        }
                        Err(e) => Err(format!("SFTP error: {}", e)),
                    }
                } else {
                    Err(format!("Session '{}' disconnected", s_id))
                };

                match upload_result {
                    Ok(()) => {
                        state.record_dir_watcher_upload(&w_id, &filename);
                        let _ = app_handle.emit(
                            "dir-watcher:event",
                            DirWatcherSyncEvent {
                                watcher_id: w_id.clone(),
                                session_id: s_id.clone(),
                                filename: filename.clone(),
                                relative_path: rel_str.clone(),
                                remote_path: remote_target_path.clone(),
                                status: "uploaded".to_string(),
                                error: None,
                                timestamp: now_epoch_secs(),
                            },
                        );
                    }
                    Err(err) => {
                        log::error!("[dir-watcher] Upload error for '{}': {}", remote_target_path, err);
                        state.record_dir_watcher_error(&w_id, &err);
                        let _ = app_handle.emit(
                            "dir-watcher:event",
                            DirWatcherSyncEvent {
                                watcher_id: w_id.clone(),
                                session_id: s_id.clone(),
                                filename: filename.clone(),
                                relative_path: rel_str.clone(),
                                remote_path: remote_target_path.clone(),
                                status: "error".to_string(),
                                error: Some(err),
                                timestamp: now_epoch_secs(),
                            },
                        );
                    }
                }
            }
        }
    }
});

    Ok(ActiveDirWatcherHandle {
        id: watcher_id,
        is_active,
    })
}
