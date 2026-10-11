use std::path::PathBuf;
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::sftp::dir_watcher::{
    start_directory_watcher, DirWatcherPairing,
};
use crate::state::AppState;

#[tauri::command]
pub async fn sftp_start_dir_watcher(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    local_dir: String,
    remote_dir: String,
    ignore_patterns: Option<Vec<String>>,
) -> Result<DirWatcherPairing, String> {
    let local_path = PathBuf::from(&local_dir);
    if !local_path.exists() {
        return Err(format!("Local directory '{}' does not exist", local_dir));
    }
    if !local_path.is_dir() {
        return Err(format!("'{}' is not a directory", local_dir));
    }

    // Verify session exists
    let session_exists = state.get_session(&session_id).await.is_some()
        || state.get_ftp_session(&session_id).await.is_some();
    if !session_exists {
        return Err(format!("Session '{}' is not connected", session_id));
    }

    // Check if watcher already exists for this local_dir and session
    let existing_list = state.list_dir_watchers(Some(&session_id));
    for existing in existing_list {
        if existing.local_dir == local_dir && existing.remote_dir == remote_dir {
            return Ok(existing);
        }
    }

    let watcher_id = format!("watch-{}", &Uuid::new_v4().to_string()[..8]);
    let default_ignores = vec![
        ".git".to_string(),
        "node_modules".to_string(),
        ".vscode".to_string(),
        ".idea".to_string(),
        "target".to_string(),
        "dist".to_string(),
        "build".to_string(),
        "*.log".to_string(),
    ];
    let final_ignores = ignore_patterns.unwrap_or(default_ignores);

    let handle = start_directory_watcher(
        app,
        &state,
        watcher_id.clone(),
        session_id.clone(),
        local_path,
        remote_dir.clone(),
        final_ignores.clone(),
    )?;

    let pairing = DirWatcherPairing {
        id: watcher_id,
        session_id,
        local_dir,
        remote_dir,
        enabled: true,
        ignore_patterns: final_ignores,
        last_sync_time: None,
        last_synced_file: None,
        status: "watching".to_string(),
        error: None,
        files_uploaded: 0,
    };

    state.add_dir_watcher(pairing.clone(), handle);

    Ok(pairing)
}

#[tauri::command]
pub async fn sftp_stop_dir_watcher(
    state: State<'_, AppState>,
    watcher_id: String,
) -> Result<(), String> {
    state.stop_dir_watcher(&watcher_id);
    Ok(())
}

#[tauri::command]
pub async fn sftp_list_dir_watchers(
    state: State<'_, AppState>,
    session_id: Option<String>,
) -> Result<Vec<DirWatcherPairing>, String> {
    Ok(state.list_dir_watchers(session_id.as_deref()))
}

#[tauri::command]
pub async fn sftp_toggle_dir_watcher(
    app: AppHandle,
    state: State<'_, AppState>,
    watcher_id: String,
    enabled: bool,
) -> Result<DirWatcherPairing, String> {
    let mut current = state
        .get_dir_watcher(&watcher_id)
        .ok_or_else(|| format!("Directory watcher '{}' not found", watcher_id))?;

    if enabled == current.enabled {
        return Ok(current);
    }

    if !enabled {
        // Stop current active handle
        if let Ok(mut handles) = state.dir_watcher_handles.lock() {
            if let Some(h) = handles.remove(&watcher_id) {
                h.is_active.store(false, std::sync::atomic::Ordering::SeqCst);
            }
        }
        current.enabled = false;
        current.status = "paused".to_string();
        if let Ok(mut map) = state.dir_watchers.write() {
            map.insert(current.id.clone(), current.clone());
        }
        Ok(current)
    } else {
        // Re-start watcher
        let local_path = PathBuf::from(&current.local_dir);
        let handle = start_directory_watcher(
            app,
            &state,
            current.id.clone(),
            current.session_id.clone(),
            local_path,
            current.remote_dir.clone(),
            current.ignore_patterns.clone(),
        )?;

        current.enabled = true;
        current.status = "watching".to_string();
        state.add_dir_watcher(current.clone(), handle);
        Ok(current)
    }
}
