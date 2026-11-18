use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};
use crate::ssh::client::SshClientHandler;
use crate::ssh::types::{SshAuthMethod, SshConnectConfig};

use russh::client::Handle;
use russh::keys::agent::client::{AgentClient, AgentStream};
use russh::keys::agent::AgentIdentity;
use russh_sftp::client::SftpSession;

const MAX_TRANSFER_SFTP_CHANNELS: usize = 4;

fn build_sftp_client_config() -> russh_sftp::client::Config {
    russh_sftp::client::Config {
        max_packet_len: 262144,
        max_concurrent_reads: 32,
        max_concurrent_writes: 32,
        max_write_packet_len: 65536,
        request_timeout_secs: 30,
    }
}

pub enum SessionCommand {
    Write(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close,
}

struct TerminalOutputState {
    history: std::collections::VecDeque<u8>,
    channel: Option<tauri::ipc::Channel<tauri::ipc::Response>>,
}

/// Tracks DEC Mode 2026 Synchronized Output (`\x1b[?2026h` begin / `\x1b[?2026l` end),
/// used heavily by Neovim 0.8+ and modern TUI plugins to bracket atomic full-screen redraws.
/// Preserves up to 7 trailing bytes across SSH packet boundaries so split escape sequences are caught.
/// Returns `true` when a synchronized frame end (`\x1b[?2026l`) completed inside `chunk`.
fn scan_dec_sync_mode(
    tail: &mut [u8; 7],
    tail_len: &mut usize,
    chunk: &[u8],
    in_sync: &mut bool,
) -> bool {
    const SYNC_BEGIN: &[u8; 8] = b"\x1b[?2026h";
    const SYNC_END: &[u8; 8] = b"\x1b[?2026l";

    if chunk.is_empty() {
        return false;
    }

    let mut saw_sync_end = false;
    let prev_len = *tail_len;

    // 1. Check boundary windows straddling `tail[..prev_len]` and the start of `chunk`
    if prev_len > 0 {
        let take_from_chunk = chunk.len().min(7);
        let mut combined = [0u8; 14];
        combined[..prev_len].copy_from_slice(&tail[..prev_len]);
        combined[prev_len..prev_len + take_from_chunk].copy_from_slice(&chunk[..take_from_chunk]);
        let combined_slice = &combined[..prev_len + take_from_chunk];
        for win in combined_slice.windows(8) {
            if win == SYNC_BEGIN {
                *in_sync = true;
            } else if win == SYNC_END {
                *in_sync = false;
                saw_sync_end = true;
            }
        }
    }

    // 2. Fast byte scan inside `chunk` (only inspecting 8-byte slices starting at ESC `0x1b`)
    if chunk.len() >= 8 {
        let last_start = chunk.len() - 8;
        let mut i = 0usize;
        while i <= last_start {
            if chunk[i] == 0x1b {
                let candidate = &chunk[i..i + 8];
                if candidate == SYNC_BEGIN {
                    *in_sync = true;
                    i += 8;
                    continue;
                } else if candidate == SYNC_END {
                    *in_sync = false;
                    saw_sync_end = true;
                    i += 8;
                    continue;
                }
            }
            i += 1;
        }
    }

    // 3. Update rolling 7-byte tail for the next SSH packet
    if chunk.len() >= 7 {
        tail.copy_from_slice(&chunk[chunk.len() - 7..]);
        *tail_len = 7;
    } else {
        let total = prev_len + chunk.len();
        let mut tmp = [0u8; 14];
        tmp[..prev_len].copy_from_slice(&tail[..prev_len]);
        tmp[prev_len..total].copy_from_slice(chunk);
        if total <= 7 {
            tail[..total].copy_from_slice(&tmp[..total]);
            *tail_len = total;
        } else {
            tail.copy_from_slice(&tmp[total - 7..total]);
            *tail_len = 7;
        }
    }

    saw_sync_end
}

fn flush_terminal_output(
    output_state: &std::sync::Mutex<TerminalOutputState>,
    app: &AppHandle,
    legacy_event_name: &str,
    out_buf: &mut Vec<u8>,
) {
    if out_buf.is_empty() {
        return;
    }
    const MAX_HISTORY: usize = 256 * 1024;
    const PURGE_CHUNK: usize = 64 * 1024;

    let payload = std::mem::replace(out_buf, Vec::with_capacity(64 * 1024));
    let active_channel = {
        let mut guard = output_state.lock().unwrap_or_else(|e| e.into_inner());
        guard.history.extend(&payload);
        if guard.history.len() > MAX_HISTORY + PURGE_CHUNK {
            let mut drain_end = PURGE_CHUNK;
            while drain_end < guard.history.len()
                && (guard.history[drain_end] & 0b1100_0000) == 0b1000_0000
            {
                drain_end += 1;
            }
            guard.history.drain(0..drain_end);
        }
        guard.channel.clone()
    };

    if let Some(ch) = active_channel {
        if ch.send(tauri::ipc::Response::new(payload)).is_err() {
            let mut guard = output_state.lock().unwrap_or_else(|e| e.into_inner());
            guard.channel = None;
        }
    } else {
        let text = String::from_utf8_lossy(&payload).to_string();
        let _ = app.emit(legacy_event_name, text);
    }
}

pub struct ActiveSession {
    pub session_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub cmd_tx: mpsc::Sender<SessionCommand>,
    pub handle: Handle<SshClientHandler>,
    pub sftp: Arc<Mutex<Option<Arc<SftpSession>>>>,
    pub transfer_sftp_pool: Arc<Mutex<Vec<Arc<SftpSession>>>>,
    pub transfer_sftp_cursor: AtomicUsize,
    pub is_closed: Arc<AtomicBool>,
    output_state: Arc<std::sync::Mutex<TerminalOutputState>>,
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
        self.transfer_sftp_pool.lock().await.clear();
        {
            let mut guard = self.output_state.lock().unwrap_or_else(|e| e.into_inner());
            guard.channel = None;
        }
        let _ = self.cmd_tx.send(SessionCommand::Close).await;
        let _ = self.handle.disconnect(russh::Disconnect::ByApplication, "", "en").await;
        Ok(())
    }

    pub async fn get_history(&self) -> Vec<u8> {
        let guard = self.output_state.lock().unwrap_or_else(|e| e.into_inner());
        let (a, b) = guard.history.as_slices();
        let mut out = Vec::with_capacity(a.len() + b.len());
        out.extend_from_slice(a);
        out.extend_from_slice(b);
        out
    }

    /// Atomically snapshots the current scrollback history and installs a binary IPC `Channel`
    /// so subsequent PTY bytes stream directly as `ArrayBuffer`s with zero JSON overhead or gaps.
    pub fn attach_stdout_channel(
        &self,
        channel: tauri::ipc::Channel<tauri::ipc::Response>,
    ) -> Vec<u8> {
        let mut guard = self.output_state.lock().unwrap_or_else(|e| e.into_inner());
        let (a, b) = guard.history.as_slices();
        let mut out = Vec::with_capacity(a.len() + b.len());
        out.extend_from_slice(a);
        out.extend_from_slice(b);
        guard.channel = Some(channel);
        out
    }

    async fn open_sftp_subsystem(&self) -> Result<Arc<SftpSession>, String> {
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
            SftpSession::new_with_config(channel.into_stream(), build_sftp_client_config()),
        )
        .await
        .map_err(|_| "SFTP session initialization timed out after 15s. Ensure SFTP subsystem is enabled on the server.".to_string())?
        .map_err(|e| format!("Failed to initialize SFTP session: {}", e))?;

        Ok(Arc::new(sftp_session))
    }

    pub async fn get_sftp(&self) -> Result<Arc<SftpSession>, String> {
        let mut lock = self.sftp.lock().await;
        if let Some(ref sftp) = *lock {
            return Ok(sftp.clone());
        }

        log::info!("Opening primary SFTP subsystem channel for session '{}'", self.session_id);
        let sftp_arc = self.open_sftp_subsystem().await?;
        log::info!("Primary SFTP session initialized for session '{}'", self.session_id);

        *lock = Some(sftp_arc.clone());
        Ok(sftp_arc)
    }

    /// Returns a pooled SFTP channel dedicated to file transfers (up to 4 parallel SFTP channels
    /// per SSH connection, staying safely under OpenSSH's `MaxSessions 10` default while isolating
    /// bulk file transfers from interactive browsing and directory crawling).
    pub async fn get_transfer_sftp(&self) -> Result<Arc<SftpSession>, String> {
        {
            let pool = self.transfer_sftp_pool.lock().await;
            if pool.len() >= MAX_TRANSFER_SFTP_CHANNELS {
                let idx = self.transfer_sftp_cursor.fetch_add(1, Ordering::Relaxed) % pool.len();
                return Ok(pool[idx].clone());
            }
        }

        let mut pool = self.transfer_sftp_pool.lock().await;
        if pool.len() < MAX_TRANSFER_SFTP_CHANNELS {
            match self.open_sftp_subsystem().await {
                Ok(ch) => {
                    pool.push(ch.clone());
                    log::debug!(
                        "Opened transfer SFTP channel {}/{} for session '{}'",
                        pool.len(),
                        MAX_TRANSFER_SFTP_CHANNELS,
                        self.session_id
                    );
                    return Ok(ch);
                }
                Err(err) => {
                    log::debug!(
                        "Could not open extra transfer SFTP channel for '{}' ({}); reusing existing SFTP session",
                        self.session_id,
                        err
                    );
                }
            }
        }

        if !pool.is_empty() {
            let idx = self.transfer_sftp_cursor.fetch_add(1, Ordering::Relaxed) % pool.len();
            return Ok(pool[idx].clone());
        }
        drop(pool);

        self.get_sftp().await
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
        // Enlarged channel flow-control window & buffers for smooth Neovim / TUI screen redraws
        window_size: 4 * 1024 * 1024,
        maximum_packet_size: 65536,
        channel_buffer_size: 512,
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

    // 4. Request PTY, advertise 24-bit truecolor (non-blocking), & launch Shell
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

    let _ = channel.set_env(false, "COLORTERM", "truecolor").await;

    channel
        .request_shell(true)
        .await
        .map_err(|e| format!("Failed to request shell: {}", e))?;

    let _ = app.emit("ssh:connect_log", "PTY Shell ready. Connection established.");

    // 5. Spawn actor task for bidirectional binary streaming with DEC Mode 2026 frame coalescing
    let (cmd_tx, mut cmd_rx) = mpsc::channel::<SessionCommand>(512);
    let event_name = format!("ssh:stdout:{}", session_id);
    let session_id_clone = session_id.clone();
    let output_state = Arc::new(std::sync::Mutex::new(TerminalOutputState {
        history: std::collections::VecDeque::with_capacity(256 * 1024),
        channel: None,
    }));
    let output_state_clone = output_state.clone();
    let is_closed = Arc::new(AtomicBool::new(false));
    let is_closed_clone = is_closed.clone();
    let sftp = Arc::new(Mutex::new(None));
    let sftp_for_task = sftp.clone();
    let transfer_sftp_pool = Arc::new(Mutex::new(Vec::new()));
    let transfer_sftp_for_task = transfer_sftp_pool.clone();
    let state_for_task = state;

    tokio::spawn(async move {
        const SYNC_FRAME_MAX_WAIT: std::time::Duration = std::time::Duration::from_millis(4);
        const BURST_COALESCE_WAIT: std::time::Duration = std::time::Duration::from_micros(750);
        const MAX_COALESCE_BYTES: usize = 128 * 1024;

        let mut out_buf: Vec<u8> = Vec::with_capacity(64 * 1024);
        let mut sync_tail = [0u8; 7];
        let mut sync_tail_len = 0usize;
        let mut in_sync_update = false;
        let mut flush_deadline: Option<tokio::time::Instant> = None;

        loop {
            let sleep_fut = async {
                match flush_deadline {
                    Some(deadline) => tokio::time::sleep_until(deadline).await,
                    None => std::future::pending::<()>().await,
                }
            };

            tokio::select! {
                biased;

                Some(cmd) = cmd_rx.recv() => {
                    match cmd {
                        SessionCommand::Write(mut data) => {
                            let mut pending_resize: Option<(u32, u32)> = None;
                            let mut should_close = false;
                            while data.len() < 32 * 1024 {
                                match cmd_rx.try_recv() {
                                    Ok(SessionCommand::Write(more)) => data.extend_from_slice(&more),
                                    Ok(SessionCommand::Resize { cols, rows }) => {
                                        pending_resize = Some((cols, rows));
                                    }
                                    Ok(SessionCommand::Close) => {
                                        should_close = true;
                                        break;
                                    }
                                    Err(_) => break,
                                }
                            }
                            if channel.data(&data[..]).await.is_err() {
                                flush_terminal_output(&output_state_clone, &app, &event_name, &mut out_buf);
                                is_closed_clone.store(true, Ordering::SeqCst);
                                let _ = app.emit(&format!("ssh:exit:{}", session_id_clone), ());
                                break;
                            }
                            if let Some((cols, rows)) = pending_resize {
                                let _ = channel.window_change(cols, rows, 0, 0).await;
                            }
                            if should_close {
                                flush_terminal_output(&output_state_clone, &app, &event_name, &mut out_buf);
                                is_closed_clone.store(true, Ordering::SeqCst);
                                let _ = channel.close().await;
                                break;
                            }
                        }
                        SessionCommand::Resize { cols, rows } => {
                            let _ = channel.window_change(cols, rows, 0, 0).await;
                        }
                        SessionCommand::Close => {
                            flush_terminal_output(&output_state_clone, &app, &event_name, &mut out_buf);
                            is_closed_clone.store(true, Ordering::SeqCst);
                            let _ = channel.close().await;
                            break;
                        }
                    }
                }
                msg = channel.wait() => {
                    match msg {
                        Some(russh::ChannelMsg::Data { ref data })
                        | Some(russh::ChannelMsg::ExtendedData { ref data, ext: 1 }) => {
                            let saw_sync_end = scan_dec_sync_mode(
                                &mut sync_tail,
                                &mut sync_tail_len,
                                data,
                                &mut in_sync_update,
                            );
                            let was_empty = out_buf.is_empty();
                            out_buf.extend_from_slice(data);

                            if out_buf.len() >= MAX_COALESCE_BYTES
                                || (!in_sync_update && (saw_sync_end || (was_empty && data.len() <= 128)))
                            {
                                flush_deadline = None;
                                flush_terminal_output(&output_state_clone, &app, &event_name, &mut out_buf);
                            } else if in_sync_update {
                                let target = tokio::time::Instant::now() + SYNC_FRAME_MAX_WAIT;
                                if flush_deadline.is_none_or(|d| d < target && was_empty) {
                                    flush_deadline = Some(target);
                                }
                            } else if flush_deadline.is_none() {
                                flush_deadline = Some(tokio::time::Instant::now() + BURST_COALESCE_WAIT);
                            }
                        }
                        Some(russh::ChannelMsg::Eof) | Some(russh::ChannelMsg::Close) | None => {
                            flush_terminal_output(&output_state_clone, &app, &event_name, &mut out_buf);
                            is_closed_clone.store(true, Ordering::SeqCst);
                            let _ = app.emit(&format!("ssh:exit:{}", session_id_clone), ());
                            break;
                        }
                        _ => {}
                    }
                }
                _ = sleep_fut => {
                    flush_deadline = None;
                    in_sync_update = false;
                    flush_terminal_output(&output_state_clone, &app, &event_name, &mut out_buf);
                }
            }
        }

        // Always clean up session-scoped staged external edits, directory watchers, and SFTP channels on exit
        is_closed_clone.store(true, Ordering::SeqCst);
        {
            let mut guard = output_state_clone.lock().unwrap_or_else(|e| e.into_inner());
            guard.channel = None;
        }
        *sftp_for_task.lock().await = None;
        transfer_sftp_for_task.lock().await.clear();
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
        transfer_sftp_pool,
        transfer_sftp_cursor: AtomicUsize::new(0),
        is_closed,
        output_state,
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

    #[test]
    fn scan_dec_sync_mode_tracks_neovim_frames_even_across_split_packets() {
        let mut tail = [0u8; 7];
        let mut tail_len = 0usize;
        let mut in_sync = false;

        // 1. Full frame in a single packet
        let single = b"\x1b[?2026h\x1b[Hhello nvim\x1b[?2026l";
        assert!(scan_dec_sync_mode(&mut tail, &mut tail_len, single, &mut in_sync));
        assert!(!in_sync);

        // 2. `\x1b[?2026h` split across packet 1 & packet 2, then `\x1b[?2026l` split across packet 3 & 4
        assert!(!scan_dec_sync_mode(&mut tail, &mut tail_len, b"prefix\x1b[?20", &mut in_sync));
        assert!(!in_sync);
        assert!(!scan_dec_sync_mode(&mut tail, &mut tail_len, b"26hframe_body_part_1", &mut in_sync));
        assert!(in_sync);
        assert!(!scan_dec_sync_mode(&mut tail, &mut tail_len, b"frame_body_part_2\x1b[?2026", &mut in_sync));
        assert!(in_sync);
        assert!(scan_dec_sync_mode(&mut tail, &mut tail_len, b"l", &mut in_sync));
        assert!(!in_sync);
    }
}
