use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};
use crate::ssh::client::SshClientHandler;
use crate::ssh::types::{SshAuthMethod, SshConnectConfig};

use russh::client::Handle;
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
        let _ = self.cmd_tx.send(SessionCommand::Close).await;
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

pub async fn spawn_ssh_session(
    app: AppHandle,
    session_id: String,
    config: SshConnectConfig,
) -> Result<ActiveSession, String> {
    let mut client_config = russh::client::Config::default();
    // Disable Nagle's algorithm for instant, zero-latency interactive terminal typing
    client_config.nodelay = true;
    client_config.keepalive_interval = Some(std::time::Duration::from_secs(15));
    let client_config = Arc::new(client_config);

    // Clean up host string (strip ssh://, username@, and trailing slashes)
    let mut host_str = config.host.trim().to_string();
    if let Some(stripped) = host_str.strip_prefix("ssh://") {
        host_str = stripped.to_string();
    }
    if let Some((_, h)) = host_str.split_once('@') {
        host_str = h.to_string();
    }
    let port = if let Some((h, p)) = host_str.split_once(':') {
        let parsed_port = p.parse::<u16>().unwrap_or(config.port);
        host_str = h.to_string();
        parsed_port
    } else {
        config.port
    };

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
            let key = russh::keys::load_secret_key(path, pass)
                .map_err(|e| format!("Failed to load private key: {}", e))?;

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
            return Err("SSH Agent authentication not yet implemented".to_string());
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
                                hist.drain(0..PURGE_CHUNK);
                            }
                        }
                        Some(russh::ChannelMsg::ExtendedData { ref data, ext: 1 }) => {
                            let text = String::from_utf8_lossy(data).to_string();
                            let _ = app.emit(&event_name, text);
                            let mut hist = stdout_history_clone.lock().await;
                            hist.extend_from_slice(data);
                            if hist.len() > MAX_HISTORY + PURGE_CHUNK {
                                hist.drain(0..PURGE_CHUNK);
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
    });

    Ok(ActiveSession {
        session_id,
        host: host_str,
        port,
        username,
        cmd_tx,
        handle,
        sftp: Arc::new(Mutex::new(None)),
        is_closed,
        stdout_history,
    })
}
