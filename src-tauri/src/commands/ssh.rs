use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::ssh::session::spawn_ssh_session;
use crate::ssh::types::{SessionInfo, SshConnectConfig};
use crate::state::AppState;

#[tauri::command]
pub async fn ssh_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    config: SshConnectConfig,
) -> Result<String, String> {
    let session_id = Uuid::new_v4().to_string();

    let session = spawn_ssh_session(app, session_id.clone(), config).await?;
    state.add_session(session).await;

    Ok(session_id)
}

#[tauri::command]
pub async fn ssh_write_stdin(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let session = state
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("Session '{}' not found", session_id))?;

    session.send_stdin(data.as_bytes()).await
}

#[tauri::command]
pub async fn ssh_resize_pty(
    state: State<'_, AppState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let session = state
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("Session '{}' not found", session_id))?;

    session.resize_pty(cols, rows).await
}

#[tauri::command]
pub async fn ssh_disconnect(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    if state.remove_ftp_session(&session_id).await.is_none() {
        state.remove_session(&session_id).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn ssh_list_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<SessionInfo>, String> {
    Ok(state.list_sessions().await)
}

#[tauri::command]
pub async fn ssh_get_history(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<String, String> {
    let session = state
        .get_session(&session_id)
        .await
        .ok_or_else(|| format!("Session '{}' not found", session_id))?;

    let bytes = session.get_history().await;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}
