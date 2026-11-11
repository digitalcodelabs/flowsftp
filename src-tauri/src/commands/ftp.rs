use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::ftp::ActiveFtpSession;
use crate::state::AppState;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn ftp_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    secure: bool,
    allow_invalid_certs: Option<bool>,
) -> Result<String, String> {
    let proto = if secure { "FTPS" } else { "FTP" };
    let allow_invalid = allow_invalid_certs.unwrap_or(false);
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
        allow_invalid,
    )
    .await?;

    let _ = app.emit("ssh:connect_log", "FTP authentication successful. Session ready.");
    state.add_ftp_session(session).await;
    Ok(session_id)
}
