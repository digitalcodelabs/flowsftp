use tauri::{AppHandle, Emitter, State};
use crate::sftp::{
    canonicalize_remote, copy_local_paths, create_local_dir, create_local_file,
    create_remote_file, download_file, get_default_local_path,
    get_git_status, get_wsl_distributions, is_path_ignored, list_local_dir, list_remote_dir,
    normalize_to_native_path, open_in_default_app, read_local_file_binary,
    read_local_file_text, read_remote_file_binary, read_remote_file_text, remove_local_item,
    remove_remote_dir_recursive_with_cancel, remove_remote_file, rename_local, rename_remote,
    set_remote_permissions, upload_file, write_local_file_text, write_remote_file_text,
    compress_local_archive, compress_remote_archive, extract_local_archive, extract_remote_archive,
    ensure_remote_dir_recursive, get_matching_ignore_pattern,
    CrawlProgressPayload, FileConflictInfo, GitRepoStatus, LocalCrawlDirectory, LocalCrawlIgnored, LocalCrawlResult,
    LocalCrawlTask, LocalFileEntry, RemoteCrawlTask, SftpFileEntry, batch_create_remote_dirs,
};
use crate::state::AppState;

#[tauri::command]
pub async fn sftp_list_remote(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<(String, Vec<SftpFileEntry>), String> {
    if let Some(ftp) = state.get_ftp_session(&session_id).await {
        return ftp.list_dir(&path).await;
    }

    let session = state
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("Session '{}' not found", session_id))?;

    let sftp = session.get_sftp().await?;
    list_remote_dir(&sftp, &path).await
}

#[tauri::command]
pub async fn sftp_canonicalize_remote(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<String, String> {
    if let Some(ftp) = state.get_ftp_session(&session_id).await {
        return ftp.canonicalize_path(&path).await;
    }

    let session = state
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("Session '{}' not found", session_id))?;

    let sftp = session.get_sftp().await?;
    canonicalize_remote(&sftp, &path).await
}

#[tauri::command]
pub async fn sftp_create_remote_dir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    if let Some(ftp) = state.get_ftp_session(&session_id).await {
        return ftp.create_dir(&path).await;
    }

    let session = state
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("Session '{}' not found", session_id))?;

    let sftp = session.get_sftp().await?;
    ensure_remote_dir_recursive(&sftp, &path).await
}

#[tauri::command]
pub async fn sftp_batch_create_remote_dirs(
    state: State<'_, AppState>,
    session_id: String,
    paths: Vec<String>,
) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }

    if let Some(ftp) = state.get_ftp_session(&session_id).await {
        for path in paths {
            let _ = ftp.create_dir(&path).await;
        }
        return Ok(());
    }

    let session = state
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("Session '{}' not found", session_id))?;

    let sftp = session.get_sftp().await?;
    batch_create_remote_dirs(&sftp, paths).await
}

#[tauri::command]
pub async fn sftp_create_remote_file(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    overwrite: Option<bool>,
) -> Result<(), String> {
    if let Some(ftp) = state.get_ftp_session(&session_id).await {
        return ftp.create_file(&path, overwrite).await;
    }

    let session = state
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("Session '{}' not found", session_id))?;

    let sftp = session.get_sftp().await?;
    create_remote_file(&sftp, &path, overwrite).await
}

#[tauri::command]
pub async fn sftp_remove_remote_dir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    deletion_id: Option<String>,
    use_fast_rm: Option<bool>,
) -> Result<(), String> {
    let clean = path.trim().replace('\\', "/");
    let clean_path = clean.trim_end_matches('/').to_string();
    eprintln!("[FLOWSFTP_BACKEND] sftp_remove_remote_dir: session={}, path='{}', clean_path='{}', use_fast_rm={:?}, deletion_id={:?}", session_id, path, clean_path, use_fast_rm, deletion_id);

    if clean_path.is_empty() || clean_path == "/" || clean_path == "." || clean_path == ".." {
        let err = "Cannot delete root or empty directory".to_string();
        eprintln!("[FLOWSFTP_BACKEND] Error: {}", err);
        return Err(err);
    }

    if let Some(ref del_id) = deletion_id {
        if state.is_deletion_cancelled(del_id) {
            eprintln!("[FLOWSFTP_BACKEND] Deletion was cancelled by user: {}", del_id);
            return Err("Deletion cancelled by user".to_string());
        }
    }

    let del_id_clone = deletion_id.clone();
    let app_state = state.inner().clone();
    let cancel_watcher = async move {
        if let Some(ref id) = del_id_clone {
            loop {
                if app_state.is_deletion_cancelled(id) {
                    return;
                }
                tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
            }
        } else {
            std::future::pending::<()>().await;
        }
    };

    if let Some(ftp) = state.get_ftp_session(&session_id).await {
        eprintln!("[FLOWSFTP_BACKEND] Removing directory via FTP session: '{}'", clean_path);
        let ftp_work = async {
            tokio::time::timeout(tokio::time::Duration::from_secs(60), ftp.remove_dir(&clean_path))
                .await
                .map_err(|_| format!("FTP remove_dir timed out for '{}'", clean_path))?
        };

        tokio::select! {
            res = ftp_work => {
                eprintln!("[FLOWSFTP_BACKEND] FTP remove_dir result: {:?}", res);
                if let Some(ref del_id) = deletion_id {
                    if state.is_deletion_cancelled(del_id) {
                        return Err("Deletion cancelled by user".to_string());
                    }
                }
                res
            }
            _ = cancel_watcher => {
                eprintln!("[FLOWSFTP_BACKEND] FTP remove_dir cancelled by user: {:?}", deletion_id);
                Err("Deletion cancelled by user".to_string())
            }
        }
    } else {
        let session = state
            .get_session(&session_id)
            .await
            .ok_or_else(|| {
                let err = format!("Session '{}' not found", session_id);
                eprintln!("[FLOWSFTP_BACKEND] Error: {}", err);
                err
            })?;

        let sftp = session.get_sftp().await?;

        let dir_work = async {
            if use_fast_rm.unwrap_or(false) {
                log::info!("Attempting fast rm -rf for remote directory '{}'", clean_path);
                eprintln!("[FLOWSFTP_BACKEND] Attempting fast rm -rf for remote directory '{}'", clean_path);
                let escaped_path = crate::shell::escape_single_quotes(&clean_path);
                let cmd = format!("rm -rf -- '{}'", escaped_path);

                let exec_result: Result<(), String> = async {
                    let channel = tokio::time::timeout(
                        std::time::Duration::from_secs(10),
                        session.handle.channel_open_session(),
                    )
                    .await
                    .map_err(|_| "Timeout opening SSH channel".to_string())?
                    .map_err(|e| format!("Failed to open SSH channel: {}", e))?;

                    tokio::time::timeout(
                        std::time::Duration::from_secs(10),
                        channel.exec(true, cmd),
                    )
                    .await
                    .map_err(|_| "Timeout executing rm -rf command".to_string())?
                    .map_err(|e| format!("Failed to execute rm -rf: {}", e))?;

                    use tokio::io::AsyncReadExt;
                    let mut stream = channel.into_stream();
                    let mut dummy = Vec::new();
                    let _ = tokio::time::timeout(
                        std::time::Duration::from_secs(10),
                        stream.read_to_end(&mut dummy),
                    )
                    .await;

                    Ok(())
                }
                .await;

                if exec_result.is_ok() {
                    let exists = match tokio::time::timeout(std::time::Duration::from_secs(5), sftp.metadata(&clean_path)).await {
                        Ok(Ok(_)) => true,
                        _ => false,
                    };
                    if !exists {
                        log::info!("Fast rm -rf succeeded for '{}'", clean_path);
                        eprintln!("[FLOWSFTP_BACKEND] Fast rm -rf verified succeeded for '{}'", clean_path);
                        return Ok(());
                    }
                    log::warn!("rm -rf executed but directory '{}' still exists; falling back to recursive SFTP deletion", clean_path);
                    eprintln!("[FLOWSFTP_BACKEND] rm -rf executed but directory '{}' still exists; falling back to recursive SFTP deletion", clean_path);
                } else {
                    log::warn!("Fast rm -rf failed ({:?}); falling back to recursive SFTP deletion", exec_result);
                    eprintln!("[FLOWSFTP_BACKEND] Fast rm -rf failed ({:?}); falling back to recursive SFTP deletion", exec_result);
                }
            }

            remove_remote_dir_recursive_with_cancel(&sftp, &clean_path, &state, deletion_id.as_deref()).await
        };

        tokio::select! {
            res = dir_work => {
                eprintln!("[FLOWSFTP_BACKEND] remove_remote_dir result for '{}': {:?}", clean_path, res);
                if let Some(ref del_id) = deletion_id {
                    if state.is_deletion_cancelled(del_id) {
                        return Err("Deletion cancelled by user".to_string());
                    }
                }
                res
            }
            _ = cancel_watcher => {
                eprintln!("[FLOWSFTP_BACKEND] remove_remote_dir cancelled by user: {:?}", deletion_id);
                Err("Deletion cancelled by user".to_string())
            }
        }
    }
}

#[tauri::command]
pub async fn sftp_remove_remote_file(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    deletion_id: Option<String>,
) -> Result<(), String> {
    let clean_path = path.trim().replace('\\', "/");
    eprintln!("[FLOWSFTP_BACKEND] sftp_remove_remote_file: session={}, path='{}', deletion_id={:?}", session_id, clean_path, deletion_id);
    if let Some(ref del_id) = deletion_id {
        if state.is_deletion_cancelled(del_id) {
            eprintln!("[FLOWSFTP_BACKEND] File deletion cancelled by user: {}", del_id);
            return Err("Deletion cancelled by user".to_string());
        }
    }

    let del_id_clone = deletion_id.clone();
    let app_state = state.inner().clone();
    let cancel_watcher = async move {
        if let Some(ref id) = del_id_clone {
            loop {
                if app_state.is_deletion_cancelled(id) {
                    return;
                }
                tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
            }
        } else {
            std::future::pending::<()>().await;
        }
    };

    if let Some(ftp) = state.get_ftp_session(&session_id).await {
        let ftp_work = async {
            tokio::time::timeout(tokio::time::Duration::from_secs(15), ftp.remove_file(&clean_path))
                .await
                .map_err(|_| format!("FTP remove_file timed out after 15s for '{}'", clean_path))?
        };

        tokio::select! {
            res = ftp_work => {
                eprintln!("[FLOWSFTP_BACKEND] FTP remove_file result: {:?}", res);
                if let Some(ref del_id) = deletion_id {
                    if state.is_deletion_cancelled(del_id) {
                        return Err("Deletion cancelled by user".to_string());
                    }
                }
                res
            }
            _ = cancel_watcher => {
                eprintln!("[FLOWSFTP_BACKEND] FTP remove_file cancelled by user: {:?}", deletion_id);
                Err("Deletion cancelled by user".to_string())
            }
        }
    } else {
        let session = state
            .get_session(&session_id)
            .await
            .ok_or_else(|| {
                let err = format!("Session '{}' not found", session_id);
                eprintln!("[FLOWSFTP_BACKEND] Error: {}", err);
                err
            })?;

        let sftp = session.get_sftp().await?;

        tokio::select! {
            res = remove_remote_file(&sftp, &clean_path) => {
                eprintln!("[FLOWSFTP_BACKEND] SFTP remove_file result: {:?}", res);
                if let Some(ref del_id) = deletion_id {
                    if state.is_deletion_cancelled(del_id) {
                        return Err("Deletion cancelled by user".to_string());
                    }
                }
                res
            }
            _ = cancel_watcher => {
                eprintln!("[FLOWSFTP_BACKEND] SFTP remove_file cancelled by user: {:?}", deletion_id);
                Err("Deletion cancelled by user".to_string())
            }
        }
    }
}

#[tauri::command]
pub async fn sftp_rename_remote(
    state: State<'_, AppState>,
    session_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    if let Some(ftp) = state.get_ftp_session(&session_id).await {
        return ftp.rename(&old_path, &new_path).await;
    }

    let session = state
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("Session '{}' not found", session_id))?;

    let sftp = session.get_sftp().await?;
    rename_remote(&sftp, &old_path, &new_path).await
}

#[tauri::command]
pub async fn sftp_download(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    transfer_id: String,
    remote_path: String,
    local_path: String,
    conflict_action: Option<String>,
    file_size: Option<u64>,
) -> Result<(), String> {
    log::info!(
        "Command sftp_download: session='{}', transfer_id='{}', remote='{}' -> local='{}' (conflict: '{:?}', size: '{:?}')",
        session_id, transfer_id, remote_path, local_path, conflict_action, file_size
    );

    if let Some(ftp) = state.get_ftp_session(&session_id).await {
        return ftp
            .download_file(&app, &remote_path, &local_path, &transfer_id, conflict_action)
            .await;
    }

    let session = state
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("Session '{}' not found", session_id))?;

    let sftp = session.get_sftp().await?;
    download_file(app, &sftp, transfer_id, remote_path, local_path, conflict_action, file_size).await
}

#[tauri::command]
pub async fn sftp_upload(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    transfer_id: String,
    local_path: String,
    remote_path: String,
    conflict_action: Option<String>,
    file_size: Option<u64>,
) -> Result<(), String> {
    log::info!(
        "Command sftp_upload: session='{}', transfer_id='{}', local='{}' -> remote='{}' (conflict: '{:?}', size: '{:?}')",
        session_id, transfer_id, local_path, remote_path, conflict_action, file_size
    );

    if let Some(ftp) = state.get_ftp_session(&session_id).await {
        return ftp
            .upload_file(&app, &local_path, &remote_path, &transfer_id, conflict_action)
            .await;
    }

    let session = state
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("Session '{}' not found", session_id))?;

    let sftp = session.get_sftp().await?;
    upload_file(app, &sftp, transfer_id, local_path, remote_path, conflict_action, file_size).await
}

#[tauri::command]
pub async fn sftp_check_conflict(
    state: State<'_, AppState>,
    session_id: Option<String>,
    path: String,
    is_remote: bool,
) -> Result<FileConflictInfo, String> {
    if is_remote {
        let sid = session_id.ok_or_else(|| "No session ID provided for remote check".to_string())?;

        if let Some(ftp) = state.get_ftp_session(&sid).await {
            return Ok(ftp.check_file_exists(&path).await);
        }

        let session = state
            .get_session(&sid)
            .await
            .ok_or_else(|| format!("Session '{}' not found", sid))?;
        let sftp = session.get_sftp().await?;
        match sftp.metadata(&path).await {
            Ok(meta) => Ok(FileConflictInfo {
                exists: true,
                size: meta.size.unwrap_or(0),
                modified: meta.mtime.unwrap_or(0) as u64,
            }),
            Err(_) => Ok(FileConflictInfo {
                exists: false,
                size: 0,
                modified: 0,
            }),
        }
    } else {
        let (native, _) = normalize_to_native_path(&path);
        if native.exists() {
            let meta = tokio::fs::metadata(&native).await.ok();
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified = meta
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            Ok(FileConflictInfo {
                exists: true,
                size,
                modified,
            })
        } else {
            Ok(FileConflictInfo {
                exists: false,
                size: 0,
                modified: 0,
            })
        }
    }
}

#[tauri::command]
pub async fn sftp_list_local(
    dir_path: Option<String>,
) -> Result<(String, Vec<LocalFileEntry>), String> {
    list_local_dir(dir_path).await
}

#[tauri::command]
pub async fn sftp_create_local_dir(path: String) -> Result<(), String> {
    create_local_dir(&path).await
}

#[tauri::command]
pub async fn sftp_create_local_file(path: String, overwrite: Option<bool>) -> Result<(), String> {
    create_local_file(&path, overwrite).await
}

#[tauri::command]
pub async fn sftp_remove_local(path: String) -> Result<(), String> {
    eprintln!("[FLOWSFTP_BACKEND] sftp_remove_local: path='{}'", path);
    let res = match tokio::time::timeout(tokio::time::Duration::from_secs(15), remove_local_item(&path)).await {
        Ok(inner) => inner,
        Err(_) => Err(format!("Timed out removing local item '{}'", path)),
    };
    eprintln!("[FLOWSFTP_BACKEND] sftp_remove_local result: {:?}", res);
    res
}

#[tauri::command]
pub async fn sftp_rename_local(old_path: String, new_path: String) -> Result<(), String> {
    rename_local(&old_path, &new_path).await
}

#[tauri::command]
pub async fn sftp_get_default_local_path() -> Result<String, String> {
    Ok(get_default_local_path())
}

#[tauri::command]
pub async fn sftp_get_wsl_distros() -> Result<Vec<String>, String> {
    get_wsl_distributions().await
}

#[tauri::command]
pub async fn sftp_get_paths_metadata(paths: Vec<String>) -> Result<Vec<LocalFileEntry>, String> {
    let mut entries = Vec::new();
    for p in paths {
        let (native, _) = normalize_to_native_path(&p);
        if let Ok(meta) = tokio::fs::metadata(&native).await {
            let name = native
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| p.clone());
            let is_dir = meta.is_dir();
            let is_symlink = meta.is_symlink();
            let size = if is_dir { 0 } else { meta.len() };
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);

            let symlink_target = if is_symlink {
                std::fs::read_link(&native).ok().map(|p| p.to_string_lossy().replace('\\', "/"))
            } else {
                None
            };

            entries.push(LocalFileEntry {
                name,
                path: native.to_string_lossy().to_string(),
                is_dir,
                is_symlink,
                symlink_target,
                size,
                modified,
            });
        }
    }
    Ok(entries)
}

#[tauri::command]
pub async fn sftp_copy_local_paths(paths: Vec<String>, target_dir: String) -> Result<(), String> {
    copy_local_paths(paths, &target_dir).await
}

#[tauri::command]
pub async fn sftp_set_permissions(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    permissions: u32,
    recursive: bool,
    target_type: Option<String>,
) -> Result<(), String> {
    if let Some(ftp) = state.get_ftp_session(&session_id).await {
        return ftp.set_permissions(&path, permissions).await;
    }

    let session = state
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("Session '{}' not found", session_id))?;

    let sftp = session.get_sftp().await?;
    set_remote_permissions(&sftp, &path, permissions, recursive, target_type.as_deref()).await
}

#[tauri::command]
pub async fn sftp_read_file_text(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<String, String> {
    if let Some(ftp) = state.get_ftp_session(&session_id).await {
        return ftp.read_file_text(&path).await;
    }

    let session = state
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("Session '{}' not found", session_id))?;

    let sftp = session.get_sftp().await?;
    read_remote_file_text(&sftp, &path).await
}

#[tauri::command]
pub async fn sftp_write_file_text(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    if let Some(ftp) = state.get_ftp_session(&session_id).await {
        return ftp.write_file_text(&path, &content).await;
    }

    let session = state
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("Session '{}' not found", session_id))?;

    let sftp = session.get_sftp().await?;
    write_remote_file_text(&sftp, &path, &content).await
}

#[tauri::command]
pub async fn sftp_read_local_file_text(path: String) -> Result<String, String> {
    read_local_file_text(&path).await
}

#[tauri::command]
pub async fn sftp_write_local_file_text(path: String, content: String) -> Result<(), String> {
    write_local_file_text(&path, &content).await
}

#[tauri::command]
pub async fn sftp_open_in_default_app(path: String) -> Result<(), String> {
    open_in_default_app(&path).await
}

#[tauri::command]
pub async fn sftp_read_file_binary(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<Vec<u8>, String> {
    if let Some(ftp) = state.get_ftp_session(&session_id).await {
        return ftp.read_file_binary(&path).await;
    }

    let session = state
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("Session '{}' not found", session_id))?;

    let sftp = session.get_sftp().await?;
    read_remote_file_binary(&sftp, &path).await
}

#[tauri::command]
pub async fn sftp_read_local_file_binary(path: String) -> Result<Vec<u8>, String> {
    read_local_file_binary(&path).await
}

#[tauri::command]
pub async fn sftp_ping(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<bool, String> {
    if let Some(session) = state.get_session(&session_id).await {
        if session.is_closed.load(std::sync::atomic::Ordering::SeqCst) {
            return Ok(false);
        }
        match session.get_sftp().await {
            Ok(sftp) => {
                match tokio::time::timeout(std::time::Duration::from_secs(4), sftp.canonicalize(".")).await {
                    Ok(Ok(_)) => Ok(true),
                    _ => Ok(false),
                }
            }
            Err(_) => Ok(false),
        }
    } else if let Some(ftp) = state.get_ftp_session(&session_id).await {
        Ok(ftp.ping().await)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub async fn sftp_get_git_status(path: String) -> Result<GitRepoStatus, String> {
    get_git_status(&path).await
}

#[tauri::command]
pub async fn sftp_get_remote_git_status(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<GitRepoStatus, String> {
    let session = match state.get_session(&session_id).await {
        Some(s) => s,
        None => return Ok(GitRepoStatus::default()),
    };

    let channel = match session.handle.channel_open_session().await {
        Ok(c) => c,
        Err(_) => return Ok(GitRepoStatus::default()),
    };

    let cmd = format!(
        "cd '{}' 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null && git branch --show-current 2>/dev/null && echo '---FLOWSFTP_GIT_SEPARATOR---' && git status --porcelain=v1 -uall 2>/dev/null",
        crate::shell::escape_single_quotes(&path)
    );
    if channel.exec(true, cmd).await.is_err() {
        return Ok(GitRepoStatus::default());
    }

    use tokio::io::AsyncReadExt;
    let mut stream = channel.into_stream();
    let mut output_bytes = Vec::new();
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(4),
        stream.read_to_end(&mut output_bytes),
    )
    .await;

    let text = String::from_utf8_lossy(&output_bytes);
    if !text.contains("---FLOWSFTP_GIT_SEPARATOR---") {
        return Ok(GitRepoStatus::default());
    }

    let parts: Vec<&str> = text.split("---FLOWSFTP_GIT_SEPARATOR---").collect();
    let header_part = parts[0].trim();
    let status_part = if parts.len() > 1 { parts[1] } else { "" };

    let header_lines: Vec<&str> = header_part.lines().collect();
    let root = header_lines.first().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    if root.is_none() {
        return Ok(GitRepoStatus::default());
    }

    let branch = header_lines.get(1).map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let mut files = std::collections::HashMap::new();

    for line in status_part.lines() {
        let line = line.trim();
        if line.len() < 4 {
            continue;
        }
        let xy = &line[0..2];
        let file_part = line[3..].trim();
        let file_path = if let Some(idx) = file_part.find(" -> ") {
            &file_part[idx + 4..]
        } else {
            file_part
        }
        .trim_matches('"');

        let status_type = match xy {
            "??" => "untracked",
            " M" | "M " | "MM" | "AM" => "modified",
            "A " => "staged",
            "D " | " D" => "deleted",
            "R " => "renamed",
            "UU" | "AA" | "DD" => "conflict",
            s if s.starts_with('M') || s.ends_with('M') => "modified",
            s if s.starts_with('A') => "staged",
            _ => "modified",
        };

        let norm_path = file_path.replace('\\', "/");
        files.insert(norm_path.clone(), status_type.to_string());
        if let Some(ref r) = root {
            files.insert(format!("{}/{}", r.trim_end_matches('/'), norm_path), status_type.to_string());
        }
        if let Some(fname) = norm_path.split('/').last() {
            files.entry(fname.to_string()).or_insert_with(|| status_type.to_string());
        }
    }

    Ok(GitRepoStatus {
        is_repo: true,
        root,
        branch,
        files,
    })
}

#[tauri::command]
pub fn sftp_cancel_transfer(state: State<'_, AppState>, transfer_id: String) {
    log::info!("Command sftp_cancel_transfer: transfer_id='{}'", transfer_id);
    state.cancel_transfer(&transfer_id);
}

#[tauri::command]
pub fn sftp_cancel_all_transfers(state: State<'_, AppState>) {
    log::info!("Command sftp_cancel_all_transfers: stopping all active transfers");
    state.cancel_all_transfers();
}

#[tauri::command]
pub fn sftp_reset_cancel_transfers(state: State<'_, AppState>) {
    state.reset_cancel_all();
}

#[tauri::command]
pub async fn sftp_extract_remote_archive(
    state: State<'_, AppState>,
    session_id: String,
    archive_path: String,
    target_dir: Option<String>,
) -> Result<String, String> {
    if state.get_ftp_session(&session_id).await.is_some() {
        return Err("Remote archive extraction requires an SSH/SFTP session".to_string());
    }

    let session = state
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("Session '{}' not found", session_id))?;

    extract_remote_archive(&session, &archive_path, target_dir.as_deref().unwrap_or("")).await
}

#[tauri::command]
pub async fn sftp_compress_remote_archive(
    state: State<'_, AppState>,
    session_id: String,
    parent_dir: String,
    items: Vec<String>,
    archive_name: String,
) -> Result<String, String> {
    if state.get_ftp_session(&session_id).await.is_some() {
        return Err("Remote archive compression requires an SSH/SFTP session".to_string());
    }

    let session = state
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("Session '{}' not found", session_id))?;

    compress_remote_archive(&session, &parent_dir, &items, &archive_name).await
}

#[tauri::command]
pub async fn sftp_extract_local_archive(
    archive_path: String,
    target_dir: Option<String>,
) -> Result<String, String> {
    extract_local_archive(&archive_path, target_dir.as_deref().unwrap_or("")).await
}

#[tauri::command]
pub async fn sftp_compress_local_archive(
    parent_dir: String,
    items: Vec<String>,
    archive_name: String,
) -> Result<String, String> {
    compress_local_archive(&parent_dir, &items, &archive_name).await
}

#[tauri::command]
pub async fn sftp_crawl_local_paths(
    app: AppHandle,
    state: State<'_, AppState>,
    paths: Vec<String>,
    target_remote_dir: String,
    ignore_patterns: Option<Vec<String>>,
) -> Result<LocalCrawlResult, String> {
    let cancel_token = state.cancel_token();
    let app_handle = app.clone();

    tokio::task::spawn_blocking(move || {
        let mut files = Vec::new();
        let mut directories = Vec::new();
        let mut ignored = Vec::new();
        let clean_remote = target_remote_dir.trim().trim_end_matches('/').to_string();
        let patterns = ignore_patterns.unwrap_or_default();

        let mut last_emit = std::time::Instant::now();
        let mut last_count = 0usize;

        // Emit initial 0 count
        let _ = app_handle.emit(
            "sftp:crawl:progress",
            CrawlProgressPayload {
                scan_type: "upload".to_string(),
                files: 0,
                directories: 0,
            },
        );

        for p in paths {
            if cancel_token.load(std::sync::atomic::Ordering::SeqCst) {
                return Err("Upload crawl cancelled by user".to_string());
            }

            let (native_path, _) = normalize_to_native_path(&p);
            if !native_path.exists() {
                continue;
            }

            let file_name = native_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "file".to_string());

            if native_path.is_file() || native_path.is_symlink() {
                let remote_path = if clean_remote.is_empty() {
                    file_name.clone()
                } else {
                    format!("{}/{}", clean_remote, file_name)
                };

                if let Some(matched_pat) = get_matching_ignore_pattern(&file_name, &file_name, &patterns) {
                    ignored.push(LocalCrawlIgnored {
                        local_path: native_path.to_string_lossy().to_string(),
                        remote_path,
                        item_name: file_name,
                        is_dir: false,
                        matched_pattern: matched_pat,
                    });
                    continue;
                }

                let size = std::fs::metadata(&native_path).map(|m| m.len()).unwrap_or(0);
                files.push(LocalCrawlTask {
                    local_path: native_path.to_string_lossy().to_string(),
                    remote_path,
                    file_name,
                    size,
                });

                let total = files.len() + directories.len();
                if total.saturating_sub(last_count) >= 20 || last_emit.elapsed() >= std::time::Duration::from_millis(35) {
                    last_count = total;
                    last_emit = std::time::Instant::now();
                    let _ = app_handle.emit(
                        "sftp:crawl:progress",
                        CrawlProgressPayload {
                            scan_type: "upload".to_string(),
                            files: files.len(),
                            directories: directories.len(),
                        },
                    );
                }
            } else if native_path.is_dir() {
                let root_folder_name = native_path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "folder".to_string());

                let remote_base = if clean_remote.is_empty() {
                    root_folder_name.clone()
                } else {
                    format!("{}/{}", clean_remote, root_folder_name)
                };

                if let Some(matched_pat) = get_matching_ignore_pattern(&root_folder_name, &root_folder_name, &patterns) {
                    ignored.push(LocalCrawlIgnored {
                        local_path: native_path.to_string_lossy().to_string(),
                        remote_path: remote_base,
                        item_name: root_folder_name,
                        is_dir: true,
                        matched_pattern: matched_pat,
                    });
                    continue;
                }

                // Explicitly record root folder so it will be created on remote even if empty or all contents ignored
                directories.push(LocalCrawlDirectory {
                    local_path: native_path.to_string_lossy().to_string(),
                    remote_path: remote_base.clone(),
                    dir_name: root_folder_name,
                });

                let total = files.len() + directories.len();
                if total.saturating_sub(last_count) >= 20 || last_emit.elapsed() >= std::time::Duration::from_millis(35) {
                    last_count = total;
                    last_emit = std::time::Instant::now();
                    let _ = app_handle.emit(
                        "sftp:crawl:progress",
                        CrawlProgressPayload {
                            scan_type: "upload".to_string(),
                            files: files.len(),
                            directories: directories.len(),
                        },
                    );
                }

                crawl_local_dir_recursive(
                    &app_handle,
                    &cancel_token,
                    &mut last_emit,
                    &mut last_count,
                    &native_path,
                    &native_path,
                    &remote_base,
                    &patterns,
                    &mut files,
                    &mut directories,
                    &mut ignored,
                )?;
            }
        }

        // Final progress emit
        let _ = app_handle.emit(
            "sftp:crawl:progress",
            CrawlProgressPayload {
                scan_type: "upload".to_string(),
                files: files.len(),
                directories: directories.len(),
            },
        );

        if cancel_token.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("Upload crawl cancelled by user".to_string());
        }

        Ok(LocalCrawlResult {
            files,
            directories,
            ignored,
        })
    })
    .await
    .map_err(|e| format!("Local crawler failed: {}", e))?
}

fn crawl_local_dir_recursive(
    app: &AppHandle,
    cancel_token: &std::sync::Arc<std::sync::atomic::AtomicBool>,
    last_emit: &mut std::time::Instant,
    last_count: &mut usize,
    root: &std::path::Path,
    current: &std::path::Path,
    remote_base: &str,
    patterns: &[String],
    files: &mut Vec<LocalCrawlTask>,
    directories: &mut Vec<LocalCrawlDirectory>,
    ignored: &mut Vec<LocalCrawlIgnored>,
) -> Result<(), String> {
    if cancel_token.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("Upload crawl cancelled by user".to_string());
    }

    let read_dir = match std::fs::read_dir(current) {
        Ok(rd) => rd,
        Err(e) => {
            log::warn!("Failed to read directory {:?}: {}", current, e);
            return Ok(());
        }
    };

    for entry_res in read_dir {
        if cancel_token.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("Upload crawl cancelled by user".to_string());
        }

        let entry = match entry_res {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };

        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".to_string());

        let rel_path = match path.strip_prefix(root) {
            Ok(rel) => rel.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };

        let remote_item_path = format!("{}/{}", remote_base, rel_path.trim_start_matches('/'));

        if let Some(matched_pat) = get_matching_ignore_pattern(&file_name, &rel_path, patterns) {
            ignored.push(LocalCrawlIgnored {
                local_path: path.to_string_lossy().to_string(),
                remote_path: remote_item_path,
                item_name: file_name,
                is_dir: file_type.is_dir(),
                matched_pattern: matched_pat,
            });
            continue;
        }

        if file_type.is_dir() {
            directories.push(LocalCrawlDirectory {
                local_path: path.to_string_lossy().to_string(),
                remote_path: remote_item_path,
                dir_name: file_name,
            });

            let total = files.len() + directories.len();
            if total.saturating_sub(*last_count) >= 20 || last_emit.elapsed() >= std::time::Duration::from_millis(35) {
                *last_count = total;
                *last_emit = std::time::Instant::now();
                let _ = app.emit(
                    "sftp:crawl:progress",
                    CrawlProgressPayload {
                        scan_type: "upload".to_string(),
                        files: files.len(),
                        directories: directories.len(),
                    },
                );
            }

            crawl_local_dir_recursive(
                app,
                cancel_token,
                last_emit,
                last_count,
                root,
                &path,
                remote_base,
                patterns,
                files,
                directories,
                ignored,
            )?;
        } else if file_type.is_file() || file_type.is_symlink() {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);

            files.push(LocalCrawlTask {
                local_path: path.to_string_lossy().to_string(),
                remote_path: remote_item_path,
                file_name,
                size,
            });

            let total = files.len() + directories.len();
            if total.saturating_sub(*last_count) >= 20 || last_emit.elapsed() >= std::time::Duration::from_millis(35) {
                *last_count = total;
                *last_emit = std::time::Instant::now();
                let _ = app.emit(
                    "sftp:crawl:progress",
                    CrawlProgressPayload {
                        scan_type: "upload".to_string(),
                        files: files.len(),
                        directories: directories.len(),
                    },
                );
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn sftp_crawl_remote_paths(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    paths: Vec<String>,
    target_local_dir: String,
    ignore_patterns: Option<Vec<String>>,
) -> Result<Vec<RemoteCrawlTask>, String> {
    let patterns = ignore_patterns.unwrap_or_default();
    let cancel_token = state.cancel_token();

    if let Some(ftp) = state.get_ftp_session(&session_id).await {
        return ftp.crawl_remote_paths(app, cancel_token, paths, target_local_dir, Some(patterns)).await;
    }

    let session = state
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("Session '{}' not found", session_id))?;

    let sftp = session.get_sftp().await?;
    let mut results = Vec::new();
    let mut dirs_count = 0usize;
    let clean_local = target_local_dir.trim().replace('\\', "/").trim_end_matches('/').to_string();

    let mut last_emit = std::time::Instant::now();
    let mut last_count = 0usize;

    // Initial 0 emit
    let _ = app.emit(
        "sftp:crawl:progress",
        CrawlProgressPayload {
            scan_type: "download".to_string(),
            files: 0,
            directories: 0,
        },
    );

    for p in paths {
        if cancel_token.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("Download crawl cancelled by user".to_string());
        }

        let clean_p = p.trim().trim_end_matches('/').to_string();
        if clean_p.is_empty() {
            continue;
        }

        match sftp.read_dir(&clean_p).await {
            Ok(_) => {
                dirs_count += 1;
                let folder_name = clean_p.split('/').last().unwrap_or("folder");
                let local_base = if clean_local.is_empty() {
                    folder_name.to_string()
                } else {
                    format!("{}/{}", clean_local, folder_name)
                };
                crawl_remote_dir_recursive(
                    &app,
                    &cancel_token,
                    &mut last_emit,
                    &mut last_count,
                    &sftp,
                    &clean_p,
                    &clean_p,
                    &local_base,
                    &patterns,
                    &mut results,
                    &mut dirs_count,
                ).await?;
            }
            Err(_) => {
                let file_name = clean_p.split('/').last().unwrap_or("file").to_string();
                if is_path_ignored(&file_name, &file_name, &patterns) {
                    continue;
                }
                let size = sftp.metadata(&clean_p).await.ok().and_then(|m| m.size).unwrap_or(0);
                let local_path = if clean_local.is_empty() {
                    file_name.clone()
                } else {
                    format!("{}/{}", clean_local, file_name)
                };
                results.push(RemoteCrawlTask {
                    remote_path: clean_p,
                    local_path,
                    file_name,
                    size,
                });

                let total = results.len() + dirs_count;
                if total.saturating_sub(last_count) >= 20 || last_emit.elapsed() >= std::time::Duration::from_millis(35) {
                    last_count = total;
                    last_emit = std::time::Instant::now();
                    let _ = app.emit(
                        "sftp:crawl:progress",
                        CrawlProgressPayload {
                            scan_type: "download".to_string(),
                            files: results.len(),
                            directories: dirs_count,
                        },
                    );
                }
            }
        }
    }

    // Final progress emit
    let _ = app.emit(
        "sftp:crawl:progress",
        CrawlProgressPayload {
            scan_type: "download".to_string(),
            files: results.len(),
            directories: dirs_count,
        },
    );

    if cancel_token.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("Download crawl cancelled by user".to_string());
    }

    Ok(results)
}

fn crawl_remote_dir_recursive<'a>(
    app: &'a AppHandle,
    cancel_token: &'a std::sync::Arc<std::sync::atomic::AtomicBool>,
    last_emit: &'a mut std::time::Instant,
    last_count: &'a mut usize,
    sftp: &'a russh_sftp::client::SftpSession,
    root: &'a str,
    current: &'a str,
    local_base: &'a str,
    patterns: &'a [String],
    results: &'a mut Vec<RemoteCrawlTask>,
    dirs_count: &'a mut usize,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'a>> {
    Box::pin(async move {
        if cancel_token.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("Download crawl cancelled by user".to_string());
        }

        let entries = match sftp.read_dir(current).await {
            Ok(e) => e,
            Err(err) => {
                log::warn!("Failed to read remote directory '{}': {}", current, err);
                return Ok(());
            }
        };

        for entry in entries {
            if cancel_token.load(std::sync::atomic::Ordering::SeqCst) {
                return Err("Download crawl cancelled by user".to_string());
            }

            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }

            let child_remote = if current == "/" {
                format!("/{}", name)
            } else {
                format!("{}/{}", current.trim_end_matches('/'), name)
            };

            let rel = child_remote
                .strip_prefix(root)
                .unwrap_or(&child_remote)
                .trim_start_matches('/');

            if is_path_ignored(&name, rel, patterns) {
                continue;
            }

            let file_type = entry.file_type();
            if file_type.is_dir() {
                *dirs_count += 1;
                let total = results.len() + *dirs_count;
                if total.saturating_sub(*last_count) >= 20 || last_emit.elapsed() >= std::time::Duration::from_millis(35) {
                    *last_count = total;
                    *last_emit = std::time::Instant::now();
                    let _ = app.emit(
                        "sftp:crawl:progress",
                        CrawlProgressPayload {
                            scan_type: "download".to_string(),
                            files: results.len(),
                            directories: *dirs_count,
                        },
                    );
                }

                crawl_remote_dir_recursive(
                    app,
                    cancel_token,
                    last_emit,
                    last_count,
                    sftp,
                    root,
                    &child_remote,
                    local_base,
                    patterns,
                    results,
                    dirs_count,
                ).await?;
            } else {
                let local_path = format!("{}/{}", local_base.trim_end_matches('/'), rel);
                let size = entry.metadata().size.unwrap_or(0);

                results.push(RemoteCrawlTask {
                    remote_path: child_remote,
                    local_path,
                    file_name: name,
                    size,
                });

                let total = results.len() + *dirs_count;
                if total.saturating_sub(*last_count) >= 20 || last_emit.elapsed() >= std::time::Duration::from_millis(35) {
                    *last_count = total;
                    *last_emit = std::time::Instant::now();
                    let _ = app.emit(
                        "sftp:crawl:progress",
                        CrawlProgressPayload {
                            scan_type: "download".to_string(),
                            files: results.len(),
                            directories: *dirs_count,
                        },
                    );
                }
            }
        }

        Ok(())
    })
}

#[tauri::command]
pub fn exit_app(app: AppHandle) {
    eprintln!("[FLOWSFTP_BACKEND] exit_app invoked. Exiting application.");
    app.exit(0);
}

#[tauri::command]
pub async fn sftp_move_remote_paths(
    state: State<'_, AppState>,
    session_id: String,
    paths: Vec<String>,
    target_dir: String,
) -> Result<(), String> {
    let clean_target = target_dir.trim().replace('\\', "/");
    let target_base = clean_target.trim_end_matches('/');

    for path in paths {
        let clean_path = path.trim().replace('\\', "/");
        let file_name = clean_path.split('/').filter(|s| !s.is_empty()).last().unwrap_or("");
        if file_name.is_empty() || file_name == "." || file_name == ".." {
            continue;
        }

        let new_path = if target_base.is_empty() {
            format!("/{}", file_name)
        } else {
            format!("{}/{}", target_base, file_name)
        };

        if clean_path == new_path {
            continue;
        }

        if let Some(ftp) = state.get_ftp_session(&session_id).await {
            ftp.rename(&clean_path, &new_path).await?;
        } else {
            let session = state
                .get_session(&session_id)
                .await
                .ok_or_else(|| format!("Session '{}' not found", session_id))?;
            let sftp = session.get_sftp().await?;
            rename_remote(&sftp, &clean_path, &new_path).await?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn sftp_copy_remote_paths(
    state: State<'_, AppState>,
    session_id: String,
    paths: Vec<String>,
    target_dir: String,
) -> Result<(), String> {
    let clean_target = target_dir.trim().replace('\\', "/");
    let dest_dir = clean_target.trim_end_matches('/');

    if let Some(session) = state.get_session(&session_id).await {
        let channel = session.handle.channel_open_session().await.map_err(|e| e.to_string())?;
        let escaped_dest = crate::shell::escape_single_quotes(&dest_dir);
        let mut files_escaped = String::new();
        for p in &paths {
            let clean = p.trim().replace('\\', "/");
            files_escaped.push_str(&format!(" '{}'", crate::shell::escape_single_quotes(&clean)));
        }
        let cmd = format!("cp -a -t '{}'{} 2>&1 || cp -r -t '{}'{} 2>&1", escaped_dest, files_escaped, escaped_dest, files_escaped);
        channel.exec(true, cmd).await.map_err(|e| e.to_string())?;
        let mut stream = channel.into_stream();
        let mut out = Vec::new();
        let _ = tokio::time::timeout(std::time::Duration::from_secs(60), tokio::io::AsyncReadExt::read_to_end(&mut stream, &mut out)).await;
        Ok(())
    } else if let Some(ftp) = state.get_ftp_session(&session_id).await {
        for p in paths {
            let clean_p = p.trim().replace('\\', "/");
            let file_name = clean_p.split('/').filter(|s| !s.is_empty()).last().unwrap_or("file");
            let dest_file = format!("{}/{}", dest_dir, file_name);
            let data = ftp.read_file_binary(&clean_p).await?;
            ftp.write_file_binary(&dest_file, &data).await?;
        }
        Ok(())
    } else {
        Err(format!("Session '{}' not found", session_id))
    }
}

#[tauri::command]
pub async fn sftp_transfer_remote_to_remote(
    app: AppHandle,
    state: State<'_, AppState>,
    src_session_id: String,
    dest_session_id: String,
    transfer_id: String,
    src_path: String,
    dest_path: String,
    file_size: Option<u64>,
) -> Result<(), String> {
    log::info!(
        "Command sftp_transfer_remote_to_remote: src_session='{}', dest_session='{}', transfer_id='{}', src='{}' -> dest='{}'",
        src_session_id, dest_session_id, transfer_id, src_path, dest_path
    );

    let clean_src = src_path.trim().replace('\\', "/");
    let clean_dest = dest_path.trim().replace('\\', "/");
    let file_name = clean_src.split('/').filter(|s| !s.is_empty()).last().unwrap_or("file").to_string();
    let event_name = format!("sftp:progress:{}", transfer_id);

    let total_bytes = file_size.unwrap_or(0);
    let _ = app.emit(
        &event_name,
        crate::sftp::TransferProgress {
            transfer_id: transfer_id.clone(),
            file_name: file_name.clone(),
            direction: "upload".to_string(),
            bytes_transferred: 0,
            total_bytes,
            speed_bytes_per_sec: 0,
            is_complete: false,
            error: None,
        },
    );

    if src_session_id == dest_session_id {
        // Same server: let the server copy the file itself, which avoids a round trip of the
        // data through this machine. Any problem other than a hang falls back to streaming.
        if let Some(session) = state.get_session(&src_session_id).await {
            let escaped_src = crate::shell::escape_single_quotes(&clean_src);
            let escaped_dest = crate::shell::escape_single_quotes(&clean_dest);
            let parent = clean_dest.rfind('/').map(|i| &clean_dest[..i]).unwrap_or("");
            let escaped_parent = crate::shell::escape_single_quotes(&parent);
            let cmd = if !parent.is_empty() {
                format!("mkdir -p '{}' && cp -a '{}' '{}'", escaped_parent, escaped_src, escaped_dest)
            } else {
                format!("cp -a '{}' '{}'", escaped_src, escaped_dest)
            };

            match crate::ssh::exec::run_command(&session.handle, cmd, std::time::Duration::from_secs(900)).await {
                Ok(result) if result.succeeded() => {
                    let _ = app.emit(
                        &event_name,
                        crate::sftp::TransferProgress {
                            transfer_id: transfer_id.clone(),
                            file_name: file_name.clone(),
                            direction: "upload".to_string(),
                            bytes_transferred: total_bytes,
                            total_bytes,
                            speed_bytes_per_sec: 0,
                            is_complete: true,
                            error: None,
                        },
                    );
                    return Ok(());
                }
                Ok(result) if result.outcome == crate::ssh::exec::ExecOutcome::TimedOut => {
                    // The copy may still be running on the server; starting a second one
                    // (the streaming fallback) would race with it.
                    return Err(format!("Server-side copy of '{}' timed out", clean_src));
                }
                Ok(result) => {
                    log::warn!(
                        "Server-side copy failed ({:?}): {}. Falling back to streaming copy.",
                        result.outcome,
                        result.output.trim()
                    );
                }
                Err(e) => {
                    log::warn!("Server-side copy unavailable ({}). Falling back to streaming copy.", e);
                }
            }
        }
    }

    let src_is_ftp = state.get_ftp_session(&src_session_id).await.is_some();
    let dest_is_ftp = state.get_ftp_session(&dest_session_id).await.is_some();

    if !src_is_ftp && !dest_is_ftp {
        let src_session = state.get_session(&src_session_id).await
            .ok_or_else(|| format!("Source session '{}' not found", src_session_id))?;
        let dest_session = state.get_session(&dest_session_id).await
            .ok_or_else(|| format!("Destination session '{}' not found", dest_session_id))?;

        let src_sftp = src_session.get_sftp().await?;
        let dest_sftp = dest_session.get_sftp().await?;

        let mut src_file = src_sftp.open(&clean_src).await
            .map_err(|e| format!("Failed to open source remote file '{}': {}", clean_src, e))?;

        if let Some(parent) = clean_dest.rfind('/').map(|i| &clean_dest[..i]) {
            if !parent.is_empty() {
                let _ = crate::sftp::ensure_remote_dir_recursive(&dest_sftp, parent).await;
            }
        }

        let mut dest_file = dest_sftp.create(&clean_dest).await
            .map_err(|e| format!("Failed to create destination remote file '{}': {}", clean_dest, e))?;

        let mut buffer = vec![0u8; 128 * 1024];
        let mut transferred: u64 = 0;
        let start_time = std::time::Instant::now();
        let mut last_emit = std::time::Instant::now();

        loop {
            if state.is_transfer_cancelled(&transfer_id) {
                let err_msg = "Transfer cancelled by user".to_string();
                let _ = app.emit(
                    &event_name,
                    crate::sftp::TransferProgress {
                        transfer_id: transfer_id.clone(),
                        file_name: file_name.clone(),
                        direction: "upload".to_string(),
                        bytes_transferred: transferred,
                        total_bytes,
                        speed_bytes_per_sec: 0,
                        is_complete: true,
                        error: Some(err_msg.clone()),
                    },
                );
                return Err(err_msg);
            }

            let bytes_read = match tokio::io::AsyncReadExt::read(&mut src_file, &mut buffer).await {
                Ok(0) => break,
                Ok(n) => n,
                Err(e) => return Err(format!("Read error from source remote file: {}", e)),
            };

            if let Err(e) = tokio::io::AsyncWriteExt::write_all(&mut dest_file, &buffer[..bytes_read]).await {
                return Err(format!("Write error to destination remote file: {}", e));
            }

            transferred += bytes_read as u64;

            if last_emit.elapsed().as_millis() >= 100 {
                let elapsed_secs = start_time.elapsed().as_secs_f64();
                let speed = if elapsed_secs > 0.0 {
                    (transferred as f64 / elapsed_secs) as u64
                } else {
                    0
                };
                let _ = app.emit(
                    &event_name,
                    crate::sftp::TransferProgress {
                        transfer_id: transfer_id.clone(),
                        file_name: file_name.clone(),
                        direction: "upload".to_string(),
                        bytes_transferred: transferred,
                        total_bytes: if total_bytes > 0 { total_bytes } else { transferred },
                        speed_bytes_per_sec: speed,
                        is_complete: false,
                        error: None,
                    },
                );
                last_emit = std::time::Instant::now();
            }
        }

        let _ = tokio::io::AsyncWriteExt::flush(&mut dest_file).await;
        let _ = tokio::io::AsyncWriteExt::shutdown(&mut dest_file).await;

        let elapsed_secs = start_time.elapsed().as_secs_f64();
        let final_speed = if elapsed_secs > 0.0 {
            (transferred as f64 / elapsed_secs) as u64
        } else {
            0
        };

        let _ = app.emit(
            &event_name,
            crate::sftp::TransferProgress {
                transfer_id: transfer_id.clone(),
                file_name: file_name.clone(),
                direction: "upload".to_string(),
                bytes_transferred: transferred,
                total_bytes: transferred,
                speed_bytes_per_sec: final_speed,
                is_complete: true,
                error: None,
            },
        );

        Ok(())
    } else {
        let data = if let Some(ftp) = state.get_ftp_session(&src_session_id).await {
            ftp.read_file_binary(&clean_src).await?
        } else if let Some(session) = state.get_session(&src_session_id).await {
            let sftp = session.get_sftp().await?;
            crate::sftp::read_remote_file_binary(&sftp, &clean_src).await?
        } else {
            return Err(format!("Source session '{}' not found", src_session_id));
        };

        if let Some(ftp) = state.get_ftp_session(&dest_session_id).await {
            ftp.write_file_binary(&clean_dest, &data).await?;
        } else if let Some(session) = state.get_session(&dest_session_id).await {
            let sftp = session.get_sftp().await?;
            crate::sftp::write_remote_file_binary(&sftp, &clean_dest, &data).await?;
        } else {
            return Err(format!("Destination session '{}' not found", dest_session_id));
        }

        let total = data.len() as u64;
        let _ = app.emit(
            &event_name,
            crate::sftp::TransferProgress {
                transfer_id: transfer_id.clone(),
                file_name: file_name.clone(),
                direction: "upload".to_string(),
                bytes_transferred: total,
                total_bytes: total,
                speed_bytes_per_sec: 0,
                is_complete: true,
                error: None,
            },
        );

        Ok(())
    }
}

#[tauri::command]
pub async fn sftp_move_local_paths(paths: Vec<String>, target_dir: String) -> Result<(), String> {
    crate::sftp::move_local_paths(paths, &target_dir).await
}

#[tauri::command]
pub async fn sftp_duplicate_remote_path(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    new_name: Option<String>,
) -> Result<String, String> {
    let clean_path = path.trim().replace('\\', "/");
    let parent = clean_path.rfind('/').map(|i| &clean_path[..i]).unwrap_or("");
    let original_name = clean_path.split('/').filter(|s| !s.is_empty()).last().unwrap_or("file");

    let dest_name = if let Some(n) = new_name.filter(|s| !s.trim().is_empty()) {
        n.trim().to_string()
    } else {
        if let Some((stem, ext)) = original_name.rsplit_once('.') {
            format!("{} - Copy.{}", stem, ext)
        } else {
            format!("{} - Copy", original_name)
        }
    };

    let new_path = if parent.is_empty() || parent == "/" {
        format!("/{}", dest_name)
    } else {
        format!("{}/{}", parent, dest_name)
    };

    if let Some(session) = state.get_session(&session_id).await {
        let channel = session.handle.channel_open_session().await.map_err(|e| e.to_string())?;
        let escaped_src = crate::shell::escape_single_quotes(&clean_path);
        let escaped_dst = crate::shell::escape_single_quotes(&new_path);
        let cmd = format!("cp -a '{}' '{}' 2>&1 || cp -r '{}' '{}' 2>&1", escaped_src, escaped_dst, escaped_src, escaped_dst);
        channel.exec(true, cmd).await.map_err(|e| e.to_string())?;
        let mut stream = channel.into_stream();
        let mut out = Vec::new();
        let _ = tokio::time::timeout(std::time::Duration::from_secs(60), tokio::io::AsyncReadExt::read_to_end(&mut stream, &mut out)).await;
        Ok(new_path)
    } else if let Some(ftp) = state.get_ftp_session(&session_id).await {
        let data = ftp.read_file_binary(&clean_path).await?;
        ftp.write_file_binary(&new_path, &data).await?;
        Ok(new_path)
    } else {
        Err(format!("Session '{}' not found", session_id))
    }
}

#[tauri::command]
pub async fn sftp_duplicate_local_path(
    path: String,
    new_name: Option<String>,
) -> Result<String, String> {
    crate::sftp::duplicate_local_path(&path, new_name).await
}

#[tauri::command]
pub async fn sftp_create_remote_symlink(
    state: State<'_, AppState>,
    session_id: String,
    target: String,
    link_path: String,
) -> Result<(), String> {
    let clean_target = target.trim().replace('\\', "/");
    let clean_link = link_path.trim().replace('\\', "/");

    if let Some(session) = state.get_session(&session_id).await {
        let channel = session.handle.channel_open_session().await.map_err(|e| e.to_string())?;
        let escaped_tgt = crate::shell::escape_single_quotes(&clean_target);
        let escaped_lnk = crate::shell::escape_single_quotes(&clean_link);
        let cmd = format!("ln -s '{}' '{}'", escaped_tgt, escaped_lnk);
        channel.exec(true, cmd).await.map_err(|e| e.to_string())?;
        let mut stream = channel.into_stream();
        let mut out = Vec::new();
        let _ = tokio::time::timeout(std::time::Duration::from_secs(10), tokio::io::AsyncReadExt::read_to_end(&mut stream, &mut out)).await;
        Ok(())
    } else {
        Err("Symlink creation is not supported on FTP sessions".to_string())
    }
}

#[tauri::command]
pub async fn sftp_create_local_symlink(target: String, link_path: String) -> Result<(), String> {
    crate::sftp::create_local_symlink(&target, &link_path).await
}

#[tauri::command]
pub async fn sftp_get_remote_dir_size(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<u64, String> {
    let clean_path = path.trim().replace('\\', "/");

    if let Some(session) = state.get_session(&session_id).await {
        let channel = session.handle.channel_open_session().await.map_err(|e| e.to_string())?;
        let escaped = crate::shell::escape_single_quotes(&clean_path);
        let cmd = format!("du -sb '{}' 2>/dev/null || du -sk '{}' 2>/dev/null", escaped, escaped);
        channel.exec(true, cmd).await.map_err(|e| e.to_string())?;
        let mut stream = channel.into_stream();
        let mut out = Vec::new();
        let _ = tokio::time::timeout(std::time::Duration::from_secs(30), tokio::io::AsyncReadExt::read_to_end(&mut stream, &mut out)).await;
        let text = String::from_utf8_lossy(&out);
        if let Some(first_word) = text.split_whitespace().next() {
            if let Ok(bytes) = first_word.parse::<u64>() {
                return Ok(bytes);
            }
        }
    }
    Err("Failed to calculate remote directory size".to_string())
}

#[tauri::command]
pub async fn sftp_get_local_dir_size(path: String) -> Result<u64, String> {
    crate::sftp::get_local_dir_size(&path).await
}

#[tauri::command]
pub async fn sftp_calculate_remote_checksum(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    algorithm: String,
) -> Result<String, String> {
    let clean_path = path.trim().replace('\\', "/");

    if let Some(session) = state.get_session(&session_id).await {
        let channel = session.handle.channel_open_session().await.map_err(|e| e.to_string())?;
        let escaped = crate::shell::escape_single_quotes(&clean_path);
        let cmd = if algorithm.eq_ignore_ascii_case("md5") {
            format!("md5sum '{}' 2>/dev/null || md5 -q '{}' 2>/dev/null", escaped, escaped)
        } else {
            format!("sha256sum '{}' 2>/dev/null || shasum -a 256 '{}' 2>/dev/null", escaped, escaped)
        };
        channel.exec(true, cmd).await.map_err(|e| e.to_string())?;
        let mut stream = channel.into_stream();
        let mut out = Vec::new();
        let _ = tokio::time::timeout(std::time::Duration::from_secs(60), tokio::io::AsyncReadExt::read_to_end(&mut stream, &mut out)).await;
        let text = String::from_utf8_lossy(&out);
        if let Some(hash) = text.split_whitespace().next() {
            return Ok(hash.to_string());
        }
    } else if let Some(ftp) = state.get_ftp_session(&session_id).await {
        let data = ftp.read_file_binary(&clean_path).await?;
        if algorithm.eq_ignore_ascii_case("md5") {
            let digest = md5::compute(&data);
            return Ok(format!("{:x}", digest));
        } else {
            use sha2::{Digest, Sha256};
            let mut hasher = Sha256::new();
            hasher.update(&data);
            return Ok(format!("{:x}", hasher.finalize()));
        }
    }
    Err("Failed to calculate remote file checksum".to_string())
}

#[tauri::command]
pub async fn sftp_calculate_local_checksum(
    path: String,
    algorithm: String,
) -> Result<String, String> {
    crate::sftp::calculate_local_checksum(&path, &algorithm).await
}



