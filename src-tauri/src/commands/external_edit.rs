use notify::{EventKind, RecursiveMode, Watcher};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::sftp::external_edit::{
    get_staging_dir, launch_external_editor, now_epoch_secs, sanitize_path_component,
    ActiveWatcherHandle, ExternalEditEvent, ExternalEditInfo,
};
use crate::sftp::{download_remote_to_local_file, upload_local_to_remote_file};
use crate::state::AppState;

#[tauri::command]
pub async fn sftp_start_external_edit(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    remote_path: String,
    preferred_editor: Option<String>,
) -> Result<ExternalEditInfo, String> {
    // Check if an external edit is already active for this session + remote path
    if let Some(existing) = state.list_external_edits(Some(&session_id)).into_iter().find(|e| e.remote_path == remote_path) {
        let local_path = std::path::PathBuf::from(&existing.local_path);
        if local_path.exists() {
            let _ = launch_external_editor(&local_path, preferred_editor.as_deref());
            return Ok(existing);
        } else {
            // Stale edit, clean it up
            state.stop_external_edit(&existing.id);
        }
    }

    let edit_id = format!("ext-{}", &Uuid::new_v4().to_string()[..8]);
    let raw_name = remote_path
        .replace('\\', "/")
        .split('/')
        .next_back()
        .filter(|s| !s.is_empty())
        .unwrap_or("unnamed_file")
        .to_string();
    let filename = sanitize_path_component(&raw_name, "unnamed_file");

    let staging_dir = get_staging_dir(&session_id)?.join(&edit_id);
    tokio::fs::create_dir_all(&staging_dir)
        .await
        .map_err(|e| format!("Failed to create staging directory: {}", e))?;

    let local_file_path = staging_dir.join(&filename);

    // 1. Stream the remote file directly to the local staging file (SFTP or FTP, no 25 MB cap)
    if let Some(ftp) = state.get_ftp_session(&session_id).await {
        ftp.download_to_local_file(&remote_path, &local_file_path).await?;
    } else if let Some(session) = state.get_session(&session_id).await {
        let sftp = session.get_sftp().await?;
        download_remote_to_local_file(&sftp, &remote_path, &local_file_path).await?;
    } else {
        return Err(format!("Session '{}' not found", session_id));
    }

    // 2. Launch external editor
    launch_external_editor(&local_file_path, preferred_editor.as_deref())?;

    // 4. Setup notify file watcher on the staging directory
    let (tx, mut rx) = mpsc::channel::<()>(32);
    let is_active = Arc::new(AtomicBool::new(true));

    let target_file_buf = local_file_path.clone();
    let watcher_is_active = is_active.clone();
    let tx_clone = tx.clone();

    let mut watcher = notify::RecommendedWatcher::new(
        move |res: Result<notify::Event, notify::Error>| {
            if !watcher_is_active.load(Ordering::SeqCst) {
                return;
            }
            if let Ok(event) = res {
                let matches = event.paths.iter().any(|p| p == &target_file_buf);
                if matches {
                    match event.kind {
                        EventKind::Modify(_) | EventKind::Create(_) => {
                            let _ = tx_clone.try_send(());
                        }
                        _ => {}
                    }
                }
            }
        },
        notify::Config::default(),
    )
    .map_err(|e| format!("Failed to initialize file watcher: {}", e))?;

    watcher
        .watch(&staging_dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch staging directory: {}", e))?;

    // 5. Spawn background debounced auto-sync worker
    let app_handle = app.clone();
    let bg_is_active = is_active.clone();
    let bg_edit_id = edit_id.clone();
    let bg_session_id = session_id.clone();
    let bg_remote_path = remote_path.clone();
    let bg_local_path = local_file_path.clone();
    let bg_filename = filename.clone();

    tokio::spawn(async move {
        while let Some(()) = rx.recv().await {
            // Debounce window to allow the external editor to finish flushing to disk
            tokio::time::sleep(tokio::time::Duration::from_millis(600)).await;
            while let Ok(()) = rx.try_recv() {}

            if !bg_is_active.load(Ordering::SeqCst) {
                break;
            }

            // Emit "syncing" event to UI
            let _ = app_handle.emit(
                "external-edit:status",
                ExternalEditEvent {
                    id: bg_edit_id.clone(),
                    session_id: bg_session_id.clone(),
                    remote_path: bg_remote_path.clone(),
                    local_path: bg_local_path.to_string_lossy().to_string(),
                    filename: bg_filename.clone(),
                    last_synced_at: now_epoch_secs(),
                    status: "syncing".to_string(),
                    error: None,
                },
            );

            // Stream the modified local staging file directly to the remote server
            if !bg_local_path.exists() {
                log::warn!(
                    "[external-edit] Staging file '{}' does not exist",
                    bg_local_path.display()
                );
                continue;
            }

            let state = app_handle.state::<AppState>();
            let upload_result: Result<(), String> = async {
                if let Some(ftp) = state.get_ftp_session(&bg_session_id).await {
                    ftp.upload_from_local_file(&bg_local_path, &bg_remote_path).await?;
                    Ok(())
                } else if let Some(session) = state.get_session(&bg_session_id).await {
                    let sftp = session.get_sftp().await?;
                    upload_local_to_remote_file(&sftp, &bg_local_path, &bg_remote_path).await?;
                    Ok(())
                } else {
                    Err("Connection dropped or session closed".to_string())
                }
            }
            .await;

            match upload_result {
                Ok(()) => {
                    let ts = now_epoch_secs();
                    state.update_external_edit_status(
                        &bg_edit_id,
                        "synced",
                        None,
                        Some(ts),
                    );
                    let _ = app_handle.emit(
                        "external-edit:status",
                        ExternalEditEvent {
                            id: bg_edit_id.clone(),
                            session_id: bg_session_id.clone(),
                            remote_path: bg_remote_path.clone(),
                            local_path: bg_local_path.to_string_lossy().to_string(),
                            filename: bg_filename.clone(),
                            last_synced_at: ts,
                            status: "synced".to_string(),
                            error: None,
                        },
                    );
                }
                Err(err) => {
                    log::error!(
                        "[external-edit] Failed to auto-upload '{}': {}",
                        bg_remote_path,
                        err
                    );
                    state.update_external_edit_status(
                        &bg_edit_id,
                        "error",
                        Some(err.clone()),
                        None,
                    );
                    let _ = app_handle.emit(
                        "external-edit:status",
                        ExternalEditEvent {
                            id: bg_edit_id.clone(),
                            session_id: bg_session_id.clone(),
                            remote_path: bg_remote_path.clone(),
                            local_path: bg_local_path.to_string_lossy().to_string(),
                            filename: bg_filename.clone(),
                            last_synced_at: now_epoch_secs(),
                            status: "error".to_string(),
                            error: Some(err),
                        },
                    );
                }
            }
        }
    });

    let edit_info = ExternalEditInfo {
        id: edit_id.clone(),
        session_id: session_id.clone(),
        remote_path: remote_path.clone(),
        local_path: local_file_path.to_string_lossy().to_string(),
        filename: filename.clone(),
        last_synced_at: now_epoch_secs(),
        status: "watching".to_string(),
        error: None,
    };

    let watcher_handle = ActiveWatcherHandle {
        id: edit_id.clone(),
        session_id,
        remote_path,
        local_path: local_file_path,
        is_active,
        trigger_tx: tx,
        watcher,
    };

    state.add_external_edit(edit_info.clone(), watcher_handle);

    Ok(edit_info)
}

#[tauri::command]
pub async fn sftp_stop_external_edit(
    state: State<'_, AppState>,
    edit_id: String,
) -> Result<(), String> {
    state.stop_external_edit(&edit_id);
    Ok(())
}

#[tauri::command]
pub async fn sftp_list_active_external_edits(
    state: State<'_, AppState>,
    session_id: Option<String>,
) -> Result<Vec<ExternalEditInfo>, String> {
    Ok(state.list_external_edits(session_id.as_deref()))
}

#[tauri::command]
pub async fn sftp_retry_external_edit_upload(
    app: AppHandle,
    state: State<'_, AppState>,
    edit_id: String,
) -> Result<(), String> {
    let edit = state
        .get_external_edit(&edit_id)
        .ok_or_else(|| format!("External edit '{}' not found", edit_id))?;

    let local_path = std::path::PathBuf::from(&edit.local_path);
    if !local_path.exists() {
        return Err(format!("Local staging file '{}' not found", edit.local_path));
    }

    if let Some(ftp) = state.get_ftp_session(&edit.session_id).await {
        ftp.upload_from_local_file(&local_path, &edit.remote_path).await?;
    } else if let Some(session) = state.get_session(&edit.session_id).await {
        let sftp = session.get_sftp().await?;
        upload_local_to_remote_file(&sftp, &local_path, &edit.remote_path).await?;
    } else {
        return Err("Connection dropped or session closed".to_string());
    }

    let ts = now_epoch_secs();
    state.update_external_edit_status(&edit_id, "synced", None, Some(ts));
    let _ = app.emit(
        "external-edit:status",
        ExternalEditEvent {
            id: edit.id.clone(),
            session_id: edit.session_id.clone(),
            remote_path: edit.remote_path.clone(),
            local_path: edit.local_path.clone(),
            filename: edit.filename.clone(),
            last_synced_at: ts,
            status: "synced".to_string(),
            error: None,
        },
    );

    Ok(())
}
