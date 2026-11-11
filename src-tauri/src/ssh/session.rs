use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};
use crate::ssh::client::SshClientHandler;
use crate::ssh::types::{SshAuthMethod, SshConnectConfig};

use russh::client::Handle;
use russh::keys::agent::client::{AgentClient, AgentStream};
use russh::keys::agent::AgentIdentity;
use russh_sftp::client::SftpSession;

pub enum SessionCommand {
    Write(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
}

pub struct ActiveSession {
    pub session_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub cmd_tx: mpsc::Sender<SessionCommand>,
    pub handle: Handle<SshClientHandler>,
    pub sftp: Arc<Mutex<Option<Arc<SftpSession>>>>,
    pub is_closed: Arc<AtomicBool>,
    pub stdout_history: Arc<Mutex<Vec<u8>>>,
}

impl ActiveSession {
    pub async fn send_stdin(&self, data: &[u8]) -> Result<(), String> {
        self.cmd_tx
            .send(SessionCommand::Write(data.to_vec()))
            .await
            .map_err(|e| format!("Failed to send STDIN: {}", e))
    }

    pub async fn resize_pty(&self, cols: u32, rows: u32) -> Result<(), String> {
        self.cmd_tx
            .send(SessionCommand::Resize { cols, rows })
            .await
            .map_err(|e| format!("Failed to resize PTY: {}", e))
    }

    pub async fn close(&self) -> Result<(), String> {
        self.is_closed.store(true, Ordering::SeqCst);
        *self.sftp.lock().await = None;
        let _ = self.cmd_tx.send(SessionCommand::Close).await;
        let _ = self.handle.disconnect(russh::Disconnect::ByApplication, "", "en").await;
        Ok(())
    }

    pub async fn get_history(&self) -> Vec<u8> {
        let hist = self.stdout_history.lock().await;
        hist.clone()
    }

    pub async fn get_sftp(&self) -> Result<Arc<SftpSession>, String> {
        let mut lock = self.sftp.lock().await;
        if let Some(ref sftp) = *lock {
            return Ok(sftp.clone());
        }

        log::info!("Opening SFTP subsystem channel for session '{}'", self.session_id);

        let channel = self
            .handle
            .channel_open_session()
            .await
            .map_err(|e| format!("Failed to open SFTP channel: {}", e))?;

        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| format!("Failed to request SFTP subsystem from remote server: {}", e))?;

        let sftp_session = tokio::time::timeout(
            std::time::Duration::from_secs(15),
            SftpSession::new(channel.into_stream()),
        )
        .await
        .map_err(|_| "SFTP session initialization timed out after 15s. Ensure SFTP subsystem is enabled on the server.".to_string())?
        .map_err(|e| format!("Failed to initialize SFTP session: {}", e))?;

        log::info!("SFTP session initialized successfully for session '{}'", self.session_id);

        let sftp_arc = Arc::new(sftp_session);
        *lock = Some(sftp_arc.clone());
        Ok(sftp_arc)
    }
}

/// Normalizes a user-supplied SSH key path (expanding leading `~` and stripping surrounding quotes).
/// If the path points to a `.pub` public key file (e.g. `C:\Users\user\.ssh\id_ed25519.pub`),
/// checks whether the sibling private key file (`C:\Users\user\.ssh\id_ed25519`) exists and
/// automatically resolves to it.
fn resolve_private_key_path_pure(raw_path: &str) -> Result<(std::path::PathBuf, bool), String> {
    let trimmed = raw_path.trim().trim_matches('"').trim_matches('\'');
    if trimmed.is_empty() {
        return Err("No private key path provided".to_string());
    }

    let expanded = if trimmed == "~" {
        dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from(trimmed))
    } else if let Some(rest) = trimmed.strip_prefix("~/").or_else(|| trimmed.strip_prefix("~\\")) {
        if let Some(home) = dirs::home_dir() {
            home.join(rest)
        } else {
            std::path::PathBuf::from(trimmed)
        }
    } else {
        std::path::PathBuf::from(trimmed)
    };

    let is_pub_ext = expanded
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("pub"));

    if is_pub_ext {
        let private_candidate = expanded.with_extension("");
        if private_candidate.is_file() {
            return Ok((private_candidate, true));
        }
        return Err(format!(
            "Selected file '{}' is a public key (.pub), and no matching private key was found at '{}'. Please select your private key file (without .pub).",
            expanded.display(),
            private_candidate.display()
        ));
    }

    Ok((expanded, false))
}

fn resolve_private_key_path(raw_path: &str, app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let (resolved, stripped_pub) = resolve_private_key_path_pure(raw_path)?;
    if stripped_pub {
        let _ = app.emit(
            "ssh:connect_log",
            format!(
                "Selected key had .pub extension; using matching private key '{}'",
                resolved.display()
            ),
        );
    }
    Ok(resolved)
}

pub fn parse_host_and_port(raw_host: &str, default_port: u16) -> (String, u16) {
    let mut host_str = raw_host.trim().trim_end_matches('/').to_string();
    if let Some(stripped) = host_str.strip_prefix("ssh://") {
        host_str = stripped.trim_end_matches('/').to_string();
    }
    if let Some((_, h)) = host_str.rsplit_once('@') {
        host_str = h.to_string();
    }

    // Bracketed IPv6: e.g. "[2001:db8::1]:2222" or "[::1]"
    if let Some(rest) = host_str.strip_prefix('[')
        && let Some((ipv6_host, after_bracket)) = rest.split_once(']')
    {
        let port = after_bracket
            .strip_prefix(':')
            .and_then(|p| p.parse::<u16>().ok())
            .unwrap_or(default_port);
        return (ipv6_host.to_string(), port);
    }

    // Unbracketed IPv6 literal (contains multiple colons, e.g. "::1", "2001:db8::1")
    if host_str.matches(':').count() > 1 {
        return (host_str, default_port);
    }

    // Hostname or IPv4 with optional ":port"
    if let Some((h, p)) = host_str.split_once(':') {
        let parsed_port = p.parse::<u16>().unwrap_or(default_port);
        (h.to_string(), parsed_port)
    } else {
        (host_str, default_port)
    }
}

pub async fn spawn_ssh_session(
    app: AppHandle,
    state: crate::state::AppState,
    session_id: String,
    config: SshConnectConfig,
) -> Result<ActiveSession, String> {
    let client_config = Arc::new(russh::client::Config {
        // Disable Nagle's algorithm for instant, zero-latency interactive terminal typing
        nodelay: true,
        keepalive_interval: Some(std::time::Duration::from_secs(15)),
        ..Default::default()
    });

    let (host_str, port) = parse_host_and_port(&config.host, config.port);

    let username = config.username.trim().to_string();
    log::info!("Connecting to SSH server at {}:{} as '{}'", host_str, port, username);
    let _ = app.emit("ssh:connect_log", format!("Connecting to SSH server at {}:{}...", host_str, port));

    // 1. Establish TCP & SSH handshake. The 10-second budget does not tick while we are
    //    waiting for the user to accept/reject an unknown or changed host key.
    let _ = app.emit("ssh:connect_log", "Establishing TCP socket & SSH transport handshake...");
    let handler = SshClientHandler::new(app.clone(), host_str.clone(), port);
    let prompting = handler.prompting.clone();
    let failure = handler.failure.clone();

    const CONNECT_BUDGET: std::time::Duration = std::time::Duration::from_secs(10);
    const TICK: std::time::Duration = std::time::Duration::from_millis(100);

    let connect_result = {
        let connect_fut = russh::client::connect(client_config, (host_str.as_str(), port), handler);
        tokio::pin!(connect_fut);
        let mut remaining = CONNECT_BUDGET;

        loop {
            tokio::select! {
                res = &mut connect_fut => break Some(res),
                _ = tokio::time::sleep(TICK) => {
                    if !prompting.load(Ordering::SeqCst) {
                        remaining = remaining.saturating_sub(TICK);
                        if remaining.is_zero() {
                            break None;
                        }
                    }
                }
            }
        }
    };

    let mut handle = match connect_result {
        None => return Err(format!("Connection to {}:{} timed out after 10 seconds", host_str, port)),
        Some(Ok(handle)) => handle,
        Some(Err(e)) => {
            let reason = failure.lock().unwrap_or_else(|p| p.into_inner()).take();
            return Err(match reason {
                Some(reason) => {
                    let _ = app.emit("ssh:connect_log", reason.clone());
                    reason
                }
                None => format!("Failed to connect to {}:{}: {}", host_str, port, e),
            });
        }
    };

    // 2. Authenticate
    let auth_desc = match &config.auth {
        SshAuthMethod::Password(_) => "password",
        SshAuthMethod::KeyFile { .. } => "private key",
        SshAuthMethod::Agent => "SSH agent",
    };
    let _ = app.emit("ssh:connect_log", format!("Authenticating as '{}' ({auth_desc})...", config.username));

    match &config.auth {
        SshAuthMethod::Password(password) => {
            let auth_res = handle
                .authenticate_password(&config.username, password)
                .await
                .map_err(|e| format!("Password auth error: {}", e))?;

            if !auth_res.success() {
                let _ = app.emit("ssh:connect_log", "Authentication failed: invalid password");
                return Err("Authentication failed: invalid password".to_string());
            }
        }
        SshAuthMethod::KeyFile { path, passphrase } => {
            let pass = passphrase.as_deref().filter(|s| !s.is_empty());
            let resolved_key_path = resolve_private_key_path(path, &app)?;
            let key = russh::keys::load_secret_key(&resolved_key_path, pass).map_err(|e| {
                if resolved_key_path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("pub"))
                {
                    format!(
                        "Failed to load private key: '{}' is a public key (.pub). Please select the matching private key file (without the .pub extension).",
                        resolved_key_path.display()
                    )
                } else {
                    format!(
                        "Failed to load private key '{}': {}",
                        resolved_key_path.display(),
                        e
                    )
                }
            })?;

            let key_alg = key.algorithm();
            let key_alg_name = key_alg.as_str().to_string();
            let is_rsa = key_alg.is_rsa();
            let key_arc = Arc::new(key);

            let algorithms_to_try: Vec<Option<russh::keys::HashAlg>> = if is_rsa {
                let mut algs = Vec::new();
                if let Ok(Some(best_alg)) = handle.best_supported_rsa_hash().await {
                    algs.push(best_alg);
                }
                for fallback in [
                    Some(russh::keys::HashAlg::Sha512),
                    Some(russh::keys::HashAlg::Sha256),
                    None,
                ] {
                    if !algs.contains(&fallback) {
                        algs.push(fallback);
                    }
                }
                algs
            } else {
                vec![None]
            };

            let mut authenticated = false;
            let mut last_err = None;

            for hash_alg in algorithms_to_try {
                let alg_name = match hash_alg {
                    Some(russh::keys::HashAlg::Sha512) => "rsa-sha2-512",
                    Some(russh::keys::HashAlg::Sha256) => "rsa-sha2-256",
                    Some(_) => "rsa",
                    None => if is_rsa { "ssh-rsa" } else { &key_alg_name },
                };

                let _ = app.emit("ssh:connect_log", format!("Attempting public key authentication ({alg_name})..."));

                let key_with_alg = russh::keys::PrivateKeyWithHashAlg::new(Arc::clone(&key_arc), hash_alg);
                match handle.authenticate_publickey(&config.username, key_with_alg).await {
                    Ok(auth_res) => {
                        if auth_res.success() {
                            authenticated = true;
                            let _ = app.emit("ssh:connect_log", format!("Authentication verified ({alg_name})."));
                            break;
                        }
                    }
                    Err(e) => {
                        last_err = Some(e);
                    }
                }

                if handle.is_closed() {
                    break;
                }
            }

            if !authenticated {
                let _ = app.emit("ssh:connect_log", "Authentication failed: private key rejected by server");
                return Err(last_err.map(|e| e.to_string()).unwrap_or_else(|| "Authentication failed: private key rejected".to_string()));
            }
        }
        SshAuthMethod::Agent => {
            authenticate_with_system_agent(&mut handle, &config.username, &app).await?;
        }
    }

    let _ = app.emit("ssh:connect_log", "Authentication verified. Opening channel & requesting PTY shell...");

    // 3. Open session channel
    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open channel: {}", e))?;

    // 4. Request PTY & Shell
    channel
        .request_pty(
            false,
            &config.term,
            config.cols,
            config.rows,
            0,
            0,
            &[],
        )
        .await
        .map_err(|e| format!("Failed to request PTY: {}", e))?;

    channel
        .request_shell(true)
        .await
        .map_err(|e| format!("Failed to request shell: {}", e))?;

    let _ = app.emit("ssh:connect_log", "PTY Shell ready. Connection established.");

    // 5. Spawn actor task for bidirectional streaming
    let (cmd_tx, mut cmd_rx) = mpsc::channel::<SessionCommand>(100);
    let event_name = format!("ssh:stdout:{}", session_id);
    let session_id_clone = session_id.clone();
    let stdout_history = Arc::new(Mutex::new(Vec::new()));
    let stdout_history_clone = stdout_history.clone();
    let is_closed = Arc::new(AtomicBool::new(false));
    let is_closed_clone = is_closed.clone();
    let sftp = Arc::new(Mutex::new(None));
    let sftp_for_task = sftp.clone();
    let state_for_task = state;

    tokio::spawn(async move {
        const MAX_HISTORY: usize = 256 * 1024;
        const PURGE_CHUNK: usize = 64 * 1024;

        loop {
            tokio::select! {
                Some(cmd) = cmd_rx.recv() => {
                    match cmd {
                        SessionCommand::Write(data) => {
                            if channel.data(&data[..]).await.is_err() {
                                is_closed_clone.store(true, Ordering::SeqCst);
                                let _ = app.emit(&format!("ssh:exit:{}", session_id_clone), ());
                                break;
                            }
                        }
                        SessionCommand::Resize { cols, rows } => {
                            let _ = channel.window_change(cols, rows, 0, 0).await;
                        }
                        SessionCommand::Close => {
                            is_closed_clone.store(true, Ordering::SeqCst);
                            let _ = channel.close().await;
                            break;
                        }
                    }
                }
                msg = channel.wait() => {
                    match msg {
                        Some(russh::ChannelMsg::Data { ref data }) => {
                            let text = String::from_utf8_lossy(data).to_string();
                            let _ = app.emit(&event_name, text);
                            let mut hist = stdout_history_clone.lock().await;
                            hist.extend_from_slice(data);
                            if hist.len() > MAX_HISTORY + PURGE_CHUNK {
                                let mut drain_end = PURGE_CHUNK;
                                while drain_end < hist.len() && (hist[drain_end] & 0b1100_0000) == 0b1000_0000 {
                                    drain_end += 1;
                                }
                                hist.drain(0..drain_end);
                            }
                        }
                        Some(russh::ChannelMsg::ExtendedData { ref data, ext: 1 }) => {
                            let text = String::from_utf8_lossy(data).to_string();
                            let _ = app.emit(&event_name, text);
                            let mut hist = stdout_history_clone.lock().await;
                            hist.extend_from_slice(data);
                            if hist.len() > MAX_HISTORY + PURGE_CHUNK {
                                let mut drain_end = PURGE_CHUNK;
                                while drain_end < hist.len() && (hist[drain_end] & 0b1100_0000) == 0b1000_0000 {
                                    drain_end += 1;
                                }
                                hist.drain(0..drain_end);
                            }
                        }
                        Some(russh::ChannelMsg::Eof) | Some(russh::ChannelMsg::Close) | None => {
                            is_closed_clone.store(true, Ordering::SeqCst);
                            let _ = app.emit(&format!("ssh:exit:{}", session_id_clone), ());
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }

        // Always clean up session-scoped staged external edits, directory watchers, and SFTP channel on exit
        is_closed_clone.store(true, Ordering::SeqCst);
        *sftp_for_task.lock().await = None;
        state_for_task.stop_all_external_edits(Some(&session_id_clone));
        state_for_task.stop_all_dir_watchers(Some(&session_id_clone));
    });

    Ok(ActiveSession {
        session_id,
        host: host_str,
        port,
        username,
        cmd_tx,
        handle,
        sftp,
        is_closed,
        stdout_history,
    })
}

#[cfg(unix)]
async fn connect_system_ssh_agent(
    app: &AppHandle,
) -> Result<AgentClient<Box<dyn AgentStream + Send + Unpin + 'static>>, String> {
    let _ = app.emit("ssh:connect_log", "Connecting to SSH agent via SSH_AUTH_SOCK...");
    AgentClient::connect_env()
        .await
        .map(|client| client.dynamic())
        .map_err(|e| {
            format!(
                "Could not connect to SSH agent ({e}). Ensure ssh-agent (or 1Password/Bitwarden SSH agent) is running and SSH_AUTH_SOCK is set."
            )
        })
}

#[cfg(windows)]
async fn connect_system_ssh_agent(
    app: &AppHandle,
) -> Result<AgentClient<Box<dyn AgentStream + Send + Unpin + 'static>>, String> {
    if let Ok(sock) = std::env::var("SSH_AUTH_SOCK") {
        let trimmed = sock.trim();
        if !trimmed.is_empty()
            && let Ok(client) = AgentClient::connect_named_pipe(trimmed).await
        {
            let _ = app.emit(
                "ssh:connect_log",
                format!("Connected to SSH agent via SSH_AUTH_SOCK ({trimmed})."),
            );
            return Ok(client.dynamic());
        }
    }

    const OPENSSH_PIPE: &str = r"\\.\pipe\openssh-ssh-agent";
    if let Ok(client) = AgentClient::connect_named_pipe(OPENSSH_PIPE).await {
        let _ = app.emit(
            "ssh:connect_log",
            "Connected to Windows OpenSSH Agent pipe.",
        );
        return Ok(client.dynamic());
    }

    if let Ok(client) = AgentClient::connect_pageant().await {
        let _ = app.emit("ssh:connect_log", "Connected to Pageant SSH agent.");
        return Ok(client.dynamic());
    }

    Err(
        "Could not connect to any running SSH agent (checked Windows OpenSSH Agent pipe and Pageant). Start the 'OpenSSH Authentication Agent' service, 1Password/Bitwarden SSH Agent, or Pageant."
            .to_string(),
    )
}

async fn authenticate_with_system_agent(
    handle: &mut Handle<SshClientHandler>,
    username: &str,
    app: &AppHandle,
) -> Result<(), String> {
    let mut agent = connect_system_ssh_agent(app).await?;
    let identities = agent
        .request_identities()
        .await
        .map_err(|e| format!("Failed to query identities from SSH agent: {e}"))?;

    if identities.is_empty() {
        let _ = app.emit(
            "ssh:connect_log",
            "SSH agent is running, but no identities are loaded.",
        );
        return Err(
            "SSH agent is running but holds no keys. Add a key with 'ssh-add' or unlock your SSH agent."
                .to_string(),
        );
    }

    let _ = app.emit(
        "ssh:connect_log",
        format!(
            "Found {} identit{} in SSH agent. Negotiating authentication...",
            identities.len(),
            if identities.len() == 1 { "y" } else { "ies" }
        ),
    );

    let best_rsa_hash: Option<russh::keys::HashAlg> = handle
        .best_supported_rsa_hash()
        .await
        .ok()
        .flatten()
        .flatten();
    let mut last_err: Option<String> = None;

    for identity in identities {
        if handle.is_closed() {
            break;
        }

        match identity {
            AgentIdentity::Certificate {
                certificate,
                comment,
            } => {
                let is_rsa = certificate.algorithm().is_rsa();
                let hash_alg = if is_rsa {
                    best_rsa_hash.or(Some(russh::keys::HashAlg::Sha256))
                } else {
                    None
                };
                let label = if comment.trim().is_empty() {
                    certificate.algorithm().as_str().to_string()
                } else {
                    format!("{} ({})", certificate.algorithm().as_str(), comment.trim())
                };
                let _ = app.emit(
                    "ssh:connect_log",
                    format!("Trying SSH agent certificate {label}..."),
                );

                match handle
                    .authenticate_certificate_with(username, certificate, hash_alg, &mut agent)
                    .await
                {
                    Ok(res) if res.success() => {
                        let _ = app.emit(
                            "ssh:connect_log",
                            format!("Authentication verified via SSH agent certificate ({label})."),
                        );
                        return Ok(());
                    }
                    Ok(_) => {}
                    Err(e) => {
                        last_err = Some(e.to_string());
                    }
                }
            }
            AgentIdentity::PublicKey { key, comment } => {
                let is_rsa = key.algorithm().is_rsa();
                let key_alg_str = key.algorithm().as_str().to_string();
                let algs_to_try: Vec<Option<russh::keys::HashAlg>> = if is_rsa {
                    let mut list = Vec::new();
                    if let Some(best) = best_rsa_hash {
                        list.push(Some(best));
                    }
                    for fallback in [
                        Some(russh::keys::HashAlg::Sha512),
                        Some(russh::keys::HashAlg::Sha256),
                        None,
                    ] {
                        if !list.contains(&fallback) {
                            list.push(fallback);
                        }
                    }
                    list
                } else {
                    vec![None]
                };

                for hash_alg in algs_to_try {
                    if handle.is_closed() {
                        break;
                    }
                    let alg_desc = match hash_alg {
                        Some(russh::keys::HashAlg::Sha512) => "rsa-sha2-512",
                        Some(russh::keys::HashAlg::Sha256) => "rsa-sha2-256",
                        Some(_) => "rsa",
                        None => {
                            if is_rsa {
                                "ssh-rsa"
                            } else {
                                &key_alg_str
                            }
                        }
                    };
                    let label = if comment.trim().is_empty() {
                        alg_desc.to_string()
                    } else {
                        format!("{alg_desc} ({})", comment.trim())
                    };
                    let _ = app.emit(
                        "ssh:connect_log",
                        format!("Trying SSH agent key {label}..."),
                    );

                    match handle
                        .authenticate_publickey_with(username, key.clone(), hash_alg, &mut agent)
                        .await
                    {
                        Ok(res) if res.success() => {
                            let _ = app.emit(
                                "ssh:connect_log",
                                format!("Authentication verified via SSH agent ({label})."),
                            );
                            return Ok(());
                        }
                        Ok(_) => {
                            // If server rejected the public key itself, no need to retry other RSA hashes for the same key
                            break;
                        }
                        Err(e) => {
                            last_err = Some(e.to_string());
                        }
                    }
                }
            }
        }
    }

    let _ = app.emit(
        "ssh:connect_log",
        "Authentication failed: none of the SSH agent keys were accepted by server.",
    );
    Err(last_err.unwrap_or_else(|| {
        "Authentication failed: none of the keys in your SSH agent were accepted by the server"
            .to_string()
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pub_key_path_automatically_resolves_to_sibling_private_key() {
        let temp_dir = std::env::temp_dir().join(format!("flowsftp_key_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let priv_path = temp_dir.join("id_ed25519");
        let pub_path = temp_dir.join("id_ed25519.pub");
        std::fs::write(&priv_path, "-----BEGIN OPENSSH PRIVATE KEY-----\n").unwrap();
        std::fs::write(&pub_path, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA\n").unwrap();

        let (resolved, stripped) = resolve_private_key_path_pure(&pub_path.to_string_lossy()).unwrap();
        assert!(stripped);
        assert_eq!(resolved, priv_path);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn pub_key_without_sibling_private_key_returns_clear_error() {
        let temp_dir = std::env::temp_dir().join(format!("flowsftp_key_test_missing_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let pub_path = temp_dir.join("id_ed25519.pub");
        std::fs::write(&pub_path, "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA\n").unwrap();

        let err = resolve_private_key_path_pure(&pub_path.to_string_lossy()).unwrap_err();
        assert!(err.contains("public key (.pub)"));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn parse_host_and_port_handles_ipv4_hostnames_and_ipv6() {
        assert_eq!(parse_host_and_port("example.com", 22), ("example.com".to_string(), 22));
        assert_eq!(parse_host_and_port("ssh://root@example.com:2222/", 22), ("example.com".to_string(), 2222));
        assert_eq!(parse_host_and_port("::1", 22), ("::1".to_string(), 22));
        assert_eq!(parse_host_and_port("2001:db8::1", 22), ("2001:db8::1".to_string(), 22));
        assert_eq!(parse_host_and_port("[2001:db8::1]:2222", 22), ("2001:db8::1".to_string(), 2222));
        assert_eq!(parse_host_and_port("ssh://user@[::1]:2200", 22), ("::1".to_string(), 2200));
    }
}
