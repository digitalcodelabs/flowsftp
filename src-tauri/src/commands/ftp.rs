use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::ftp::ActiveFtpSession;
use crate::state::AppState;

#[tauri::command]
pub async fn ftp_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    secure: bool,
) -> Result<String, String> {
    let proto = if secure { "FTPS" } else { "FTP" };
    let _ = app.emit("ssh:connect_log", format!("Connecting to {proto} server at {host}:{port}..."));
    let _ = app.emit("ssh:connect_log", format!("Authenticating as '{username}'..."));

    let session_id = format!("ftp-{}", Uuid::new_v4());
    let session = ActiveFtpSession::connect(
        session_id.clone(),
        host,
        port,
        username,
        password,
        secure,
    )
    .await?;

    let _ = app.emit("ssh:connect_log", "FTP authentication successful. Session ready.");
    state.add_ftp_session(session).await;
    Ok(session_id)
}
