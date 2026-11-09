use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{atomic::{AtomicBool, Ordering}, Arc};
use std::time::Instant;
use suppaftp::{FtpStream, RustlsConnector, RustlsFtpStream};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{Mutex, RwLock};

use crate::sftp::{
    normalize_to_native_path, FileConflictInfo, RemoteCrawlTask, SftpFileEntry,
    TransferProgress,
};

#[derive(Debug)]
struct AllowAnyCertVerifier;

impl rustls::client::danger::ServerCertVerifier for AllowAnyCertVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

pub enum FtpClientStream {
    Plain(FtpStream),
    Secure(RustlsFtpStream),
}

fn is_connection_error(err: &str) -> bool {
    let lower = err.to_lowercase();
    lower.contains("10053")
        || lower.contains("10054")
        || lower.contains("broken pipe")
        || lower.contains("connection reset")
        || lower.contains("connection was aborted")
        || lower.contains("connection aborted")
        || lower.contains("connection closed")
        || lower.contains("connection error")
        || lower.contains("closed")
        || lower.contains("not connected")
        || lower.contains("eof")
        || lower.contains("timed out")
        || lower.contains("timeout")
}

const MAX_FTP_TRANSFER_POOL_SIZE: usize = 6;

fn connect_ftp_stream(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    secure: bool,
) -> Result<(FtpClientStream, String), String> {
    let addr = format!("{}:{}", host, port);
    if secure {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let root_store = rustls::RootCertStore::empty();
        let mut config = rustls::ClientConfig::builder_with_protocol_versions(&[&rustls::version::TLS12])
            .with_root_certificates(root_store)
            .with_no_client_auth();

        config
            .dangerous()
            .set_certificate_verifier(Arc::new(AllowAnyCertVerifier));

        let connector = RustlsConnector::from(Arc::new(config));

        let stream = RustlsFtpStream::connect(&addr)
            .map_err(|e| format!("Failed to connect to FTP server {}: {}", addr, e))?;

        let mut secure_stream = stream
            .into_secure(connector, host)
            .map_err(|e| {
                format!(
                    "Failed to establish TLS encryption (FTPS): {}. If this server does not support TLS/FTPS, try connecting with 'FTP (Plain)' protocol.",
                    e
                )
            })?;

        secure_stream.set_passive_nat_workaround(true);

        secure_stream
            .login(username, password)
            .map_err(|e| format!("FTP authentication failed for user '{}': {}", username, e))?;

        let pwd = secure_stream.pwd().unwrap_or_else(|_| "/".to_string());

        Ok((FtpClientStream::Secure(secure_stream), pwd))
    } else {
        let mut stream = FtpStream::connect(&addr)
            .map_err(|e| format!("Failed to connect to FTP server {}: {}", addr, e))?;

        stream.set_passive_nat_workaround(true);

        stream
            .login(username, password)
            .map_err(|e| format!("FTP authentication failed for user '{}': {}", username, e))?;

        let pwd = stream.pwd().unwrap_or_else(|_| "/".to_string());

        Ok((FtpClientStream::Plain(stream), pwd))
    }
}

fn return_transfer_stream(pool_arc: &Arc<Mutex<Vec<FtpClientStream>>>, mut stream: FtpClientStream) {
    let mut pool = pool_arc.blocking_lock();
    if pool.len() < MAX_FTP_TRANSFER_POOL_SIZE {
        pool.push(stream);
    } else {
        match &mut stream {
            FtpClientStream::Plain(s) => {
                let _ = s.quit();
            }
            FtpClientStream::Secure(s) => {
                let _ = s.quit();
            }
        }
    }
}

pub struct ActiveFtpSession {
    pub session_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub is_secure: bool,
    pub current_dir: Arc<RwLock<String>>,
    client: Arc<Mutex<FtpClientStream>>,
    transfer_pool: Arc<Mutex<Vec<FtpClientStream>>>,
}

macro_rules! run_ftp_download {
    ($stream:expr, $app_handle:expr, $remote_path:expr, $local_path:expr, $transfer_id:expr, $conflict_action:expr, $known_size:expr) => {{
        let stream = $stream;
        let (native_local, _) = normalize_to_native_path($local_path);
        let file_name = Path::new($remote_path)
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".to_string());

        let total_size = match $known_size {
            Some(sz) if sz > 0 => sz,
            _ => stream.size($remote_path).unwrap_or(0) as u64,
        };
        let event_name = format!("sftp:progress:{}", $transfer_id);

        let conflict = $conflict_action.as_deref().unwrap_or("overwrite");
        if conflict == "skip" && native_local.exists() {
            let _ = $app_handle.emit(
                &event_name,
                TransferProgress {
                    transfer_id: $transfer_id.to_string(),
                    file_name,
                    direction: "download".to_string(),
                    bytes_transferred: total_size,
                    total_bytes: total_size,
                    speed_bytes_per_sec: 0,
                    is_complete: true,
                    error: Some("Skipped (file exists)".to_string()),
                },
            );
            return Ok::<(), String>(());
        }

        // Ensure parent directory exists
        if let Some(parent) = native_local.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let mut reader = stream
            .retr_as_stream($remote_path)
            .map_err(|e| format!("Failed to retrieve file: {}", e))?;

        let mut local_file = File::create(&native_local)
            .map_err(|e| format!("Failed to create local destination file: {}", e))?;

        let mut buffer = [0u8; 64 * 1024];
        let mut transferred = 0u64;
        let start_time = Instant::now();
        let mut last_emit = Instant::now();

        // Emit initial 0% progress immediately so frontend queue displays the item in active state
        let _ = $app_handle.emit(
            &event_name,
            TransferProgress {
                transfer_id: $transfer_id.to_string(),
                file_name: file_name.clone(),
                direction: "download".to_string(),
                bytes_transferred: 0,
                total_bytes: total_size,
                speed_bytes_per_sec: 0,
                is_complete: false,
                error: None,
            },
        );

        let state = $app_handle.state::<crate::state::AppState>();
        loop {
            if state.is_transfer_cancelled($transfer_id) {
                let err_msg = "Transfer cancelled by user".to_string();
                log::info!("[ftp_download] Cancelled by user: transfer_id='{}'", $transfer_id);
                drop(local_file);
                let _ = std::fs::remove_file(&native_local);
                let _ = $app_handle.emit(
                    &event_name,
                    TransferProgress {
                        transfer_id: $transfer_id.to_string(),
                        file_name: file_name.clone(),
                        direction: "download".to_string(),
                        bytes_transferred: transferred,
                        total_bytes: if total_size > 0 { total_size } else { transferred },
                        speed_bytes_per_sec: 0,
                        is_complete: true,
                        error: Some(err_msg.clone()),
                    },
                );
                return Err(err_msg);
            }

            let bytes_read = reader
                .read(&mut buffer)
                .map_err(|e| format!("Failed to read from FTP stream: {}", e))?;

            if bytes_read == 0 {
                break;
            }

            local_file
                .write_all(&buffer[..bytes_read])
                .map_err(|e| format!("Failed to write to local file: {}", e))?;

            transferred += bytes_read as u64;

            if last_emit.elapsed().as_millis() >= 100 {
                let elapsed_secs = start_time.elapsed().as_secs_f64();
                let speed = if elapsed_secs > 0.0 {
                    (transferred as f64 / elapsed_secs) as u64
                } else {
                    0
                };

                let _ = $app_handle.emit(
                    &event_name,
                    TransferProgress {
                        transfer_id: $transfer_id.to_string(),
                        file_name: file_name.clone(),
                        direction: "download".to_string(),
                        bytes_transferred: transferred,
                        total_bytes: if total_size > 0 { total_size } else { transferred },
                        speed_bytes_per_sec: speed,
                        is_complete: false,
                        error: None,
                    },
                );
                last_emit = Instant::now();
            }
        }

        stream
            .finalize_retr_stream(reader)
            .map_err(|e| format!("Failed to finalize FTP download: {}", e))?;

        let _ = $app_handle.emit(
            &event_name,
            TransferProgress {
                transfer_id: $transfer_id.to_string(),
                file_name,
                direction: "download".to_string(),
                bytes_transferred: transferred,
                total_bytes: transferred,
                speed_bytes_per_sec: 0,
                is_complete: true,
                error: None,
            },
        );

        Ok::<(), String>(())
    }};
}

macro_rules! ensure_ftp_dir_recursive {
    ($stream:expr, $path:expr) => {{
        let clean = $path.trim().replace('\\', "/");
        let clean_path = clean.trim_end_matches('/');
        if !clean_path.is_empty() && clean_path != "/" && $stream.mkdir(clean_path).is_err() {
            let segments: Vec<&str> = clean_path.split('/').filter(|s| !s.is_empty()).collect();
            if !segments.is_empty() {
                let is_absolute = clean_path.starts_with('/');
                let mut current = if is_absolute { String::from("/") } else { String::new() };
                for seg in segments {
                    if !current.is_empty() && !current.ends_with('/') {
                        current.push('/');
                    }
                    current.push_str(seg);
                    if current == "/" {
                        continue;
                    }
                    let _ = $stream.mkdir(&current);
                }
            }
        }
    }};
}

macro_rules! remove_ftp_dir_recursive {
    ($stream:expr, $target:expr) => {{
        let stream = $stream;
        let p_str = $target;

        if stream.rmdir(p_str).is_ok() {
            Ok::<(), String>(())
        } else {
            let initial_pwd = match stream.pwd() {
                Ok(pwd) => pwd,
                Err(_) => "/".to_string(),
            };

            let mut files_to_delete = Vec::new();
            let mut dirs_to_delete = Vec::new();
            let mut dirs_to_visit = vec![p_str.to_string()];

            while let Some(dir) = dirs_to_visit.pop() {
                if stream.cwd(&dir).is_err() {
                    continue;
                }
                let canonical_dir = stream.pwd().unwrap_or_else(|_| dir.clone());
                dirs_to_delete.push(dir.clone());

                let lines = match stream.list(None) {
                    Ok(l) => l,
                    Err(_) => continue,
                };

                for line in lines {
                    if let Some(entry) = parse_ftp_list_line(&line, &canonical_dir) {
                        if entry.name == "." || entry.name == ".." {
                            continue;
                        }
                        if entry.is_dir {
                            dirs_to_visit.push(entry.path);
                        } else {
                            files_to_delete.push(entry.path);
                        }
                    }
                }
            }

            // Always restore initial PWD before deleting
            let _ = stream.cwd(&initial_pwd);

            // Delete files first
            for file_path in files_to_delete {
                let _ = stream.rm(&file_path);
            }

            // Delete subdirectories (reverse order: deepest first)
            for dir_path in dirs_to_delete.into_iter().rev() {
                let _ = stream.rmdir(&dir_path);
            }

            // Finally remove the target directory itself
            stream.rmdir(p_str).map_err(|e| format!("Failed to remove FTP directory '{}': {}", p_str, e))
        }
    }};
}

macro_rules! run_ftp_upload {
    ($stream:expr, $app_handle:expr, $local_path:expr, $remote_path:expr, $transfer_id:expr, $conflict_action:expr) => {{
        let stream = $stream;
        let (native_local, _) = normalize_to_native_path($local_path);
        let file_name = native_local
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".to_string());

        let mut local_file = File::open(&native_local)
            .map_err(|e| format!("Failed to open local source file: {}", e))?;

        let total_size = local_file
            .metadata()
            .map(|m| m.len())
            .unwrap_or(0);

        let event_name = format!("sftp:progress:{}", $transfer_id);

        let conflict = $conflict_action.as_deref().unwrap_or("overwrite");
        if conflict == "skip" && stream.size($remote_path).is_ok() {
            let _ = $app_handle.emit(
                &event_name,
                TransferProgress {
                    transfer_id: $transfer_id.to_string(),
                    file_name,
                    direction: "upload".to_string(),
                    bytes_transferred: total_size,
                    total_bytes: total_size,
                    speed_bytes_per_sec: 0,
                    is_complete: true,
                    error: Some("Skipped (file exists)".to_string()),
                },
            );
            return Ok::<(), String>(());
        }

        let mut writer = match stream.put_with_stream($remote_path) {
            Ok(w) => w,
            Err(initial_err) => {
                if let Some(parent) = Path::new($remote_path).parent() {
                    let parent_str = parent.to_string_lossy().replace('\\', "/");
                    if !parent_str.is_empty() && parent_str != "/" && parent_str != "." {
                        ensure_ftp_dir_recursive!(stream, &parent_str);
                    }
                }
                stream.put_with_stream($remote_path).map_err(|e| {
                    format!("Failed to initiate FTP upload for '{}' (initial error: {}): {}", $remote_path, initial_err, e)
                })?
            }
        };

        let mut buffer = [0u8; 64 * 1024];
        let mut transferred = 0u64;
        let start_time = Instant::now();
        let mut last_emit = Instant::now();

        // Emit initial 0% progress immediately so frontend queue displays the item in active state
        let _ = $app_handle.emit(
            &event_name,
            TransferProgress {
                transfer_id: $transfer_id.to_string(),
                file_name: file_name.clone(),
                direction: "upload".to_string(),
                bytes_transferred: 0,
                total_bytes: total_size,
                speed_bytes_per_sec: 0,
                is_complete: false,
                error: None,
            },
        );

        let state = $app_handle.state::<crate::state::AppState>();
        loop {
            if state.is_transfer_cancelled($transfer_id) {
                let err_msg = "Transfer cancelled by user".to_string();
                log::info!("[ftp_upload] Cancelled by user: transfer_id='{}'", $transfer_id);
                let _ = $app_handle.emit(
                    &event_name,
                    TransferProgress {
                        transfer_id: $transfer_id.to_string(),
                        file_name: file_name.clone(),
                        direction: "upload".to_string(),
                        bytes_transferred: transferred,
                        total_bytes: total_size,
                        speed_bytes_per_sec: 0,
                        is_complete: true,
                        error: Some(err_msg.clone()),
                    },
                );
                return Err(err_msg);
            }

            let bytes_read = local_file
                .read(&mut buffer)
                .map_err(|e| format!("Failed to read from local file: {}", e))?;

            if bytes_read == 0 {
                break;
            }

            writer
                .write_all(&buffer[..bytes_read])
                .map_err(|e| format!("Failed to write to FTP stream: {}", e))?;

            transferred += bytes_read as u64;

            if last_emit.elapsed().as_millis() >= 100 {
                let elapsed_secs = start_time.elapsed().as_secs_f64();
                let speed = if elapsed_secs > 0.0 {
                    (transferred as f64 / elapsed_secs) as u64
                } else {
                    0
                };

                let _ = $app_handle.emit(
                    &event_name,
                    TransferProgress {
                        transfer_id: $transfer_id.to_string(),
                        file_name: file_name.clone(),
                        direction: "upload".to_string(),
                        bytes_transferred: transferred,
                        total_bytes: total_size,
                        speed_bytes_per_sec: speed,
                        is_complete: false,
                        error: None,
                    },
                );
                last_emit = Instant::now();
            }
        }

        stream
            .finalize_put_stream(writer)
            .map_err(|e| format!("Failed to finalize FTP upload: {}", e))?;

        let _ = $app_handle.emit(
            &event_name,
            TransferProgress {
                transfer_id: $transfer_id.to_string(),
                file_name,
                direction: "upload".to_string(),
                bytes_transferred: transferred,
                total_bytes: total_size,
                speed_bytes_per_sec: 0,
                is_complete: true,
                error: None,
            },
        );

        Ok::<(), String>(())
    }};
}

impl ActiveFtpSession {
    pub async fn connect(
        session_id: String,
        host: String,
        port: u16,
        username: String,
        password: Option<String>,
        secure: bool,
    ) -> Result<Self, String> {
        let user = username.clone();
        let pass = password.clone().unwrap_or_default();
        let pass_stored = password.clone();
        let h = host.clone();

        let (client, initial_pwd) = tokio::task::spawn_blocking(move || -> Result<(FtpClientStream, String), String> {
            connect_ftp_stream(&h, port, &user, &pass, secure)
        })
        .await
        .map_err(|e| format!("FTP worker thread failed: {}", e))??;

        let clean_pwd = if initial_pwd.is_empty() {
            "/".to_string()
        } else {
            initial_pwd
        };

        Ok(Self {
            session_id,
            host,
            port,
            username,
            password: pass_stored,
            is_secure: secure,
            current_dir: Arc::new(RwLock::new(clean_pwd)),
            client: Arc::new(Mutex::new(client)),
            transfer_pool: Arc::new(Mutex::new(Vec::new())),
        })
    }

    pub async fn reconnect(&self) -> Result<(), String> {
        let user = self.username.clone();
        let pass = self.password.clone().unwrap_or_default();
        let h = self.host.clone();
        let port = self.port;
        let secure = self.is_secure;
        let client_arc = self.client.clone();
        let current_dir_arc = self.current_dir.clone();

        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut guard = client_arc.blocking_lock();

            let (new_stream, _) = connect_ftp_stream(&h, port, &user, &pass, secure)?;

            let cached_dir = {
                let dir_guard = current_dir_arc.blocking_read();
                dir_guard.clone()
            };

            *guard = new_stream;

            if !cached_dir.is_empty() && cached_dir != "/" {
                match &mut *guard {
                    FtpClientStream::Plain(s) => { let _ = s.cwd(&cached_dir); }
                    FtpClientStream::Secure(s) => { let _ = s.cwd(&cached_dir); }
                }
            }

            Ok(())
        })
        .await
        .map_err(|e| format!("FTP reconnect failed: {}", e))?
    }

    pub async fn ping(&self) -> bool {
        let client_arc = self.client.clone();
        let is_ok = tokio::task::spawn_blocking(move || {
            let mut guard = match client_arc.try_lock() {
                Ok(g) => g,
                Err(_) => return true,
            };

            match &mut *guard {
                FtpClientStream::Plain(s) => s.noop().is_ok(),
                FtpClientStream::Secure(s) => s.noop().is_ok(),
            }
        })
        .await
        .unwrap_or(false);

        if !is_ok && self.reconnect().await.is_ok() {
            return true;
        }

        is_ok
    }

    pub async fn list_dir(&self, target_path: &str) -> Result<(String, Vec<SftpFileEntry>), String> {
        match self.try_list_dir(target_path).await {
            Ok(res) => Ok(res),
            Err(e) => {
                if is_connection_error(&e) {
                    log::info!("[ftp] Connection dropped during list_dir, attempting auto-reconnect...");
                    if self.reconnect().await.is_ok() {
                        return self.try_list_dir(target_path).await;
                    }
                }
                Err(e)
            }
        }
    }

    async fn try_list_dir(&self, target_path: &str) -> Result<(String, Vec<SftpFileEntry>), String> {
        let client_arc = self.client.clone();
        let current_dir_arc = self.current_dir.clone();
        let path = target_path.trim().to_string();

        tokio::task::spawn_blocking(move || -> Result<(String, Vec<SftpFileEntry>), String> {
            let mut guard = client_arc.blocking_lock();

            let cached_dir = {
                let dir_guard = current_dir_arc.blocking_read();
                dir_guard.clone()
            };

            let is_current = path.is_empty() || path == "." || path == cached_dir;

            let canonical_dir = if is_current {
                // If querying current directory, avoid calling CWD as it can trigger spurious syntax errors on chrooted roots.
                match &mut *guard {
                    FtpClientStream::Plain(s) => s.pwd().unwrap_or_else(|_| cached_dir.clone()),
                    FtpClientStream::Secure(s) => s.pwd().unwrap_or_else(|_| cached_dir.clone()),
                }
            } else {
                // Navigate to target directory
                match &mut *guard {
                    FtpClientStream::Plain(s) => {
                        s.cwd(&path).map_err(|e| format!("Failed to change directory to '{}': {}", path, e))?;
                        s.pwd().unwrap_or_else(|_| path.clone())
                    }
                    FtpClientStream::Secure(s) => {
                        s.cwd(&path).map_err(|e| format!("Failed to change directory to '{}': {}", path, e))?;
                        s.pwd().unwrap_or_else(|_| path.clone())
                    }
                }
            };

            let lines = match &mut *guard {
                FtpClientStream::Plain(s) => s.list(None).map_err(|e| format!("Failed to list directory: {}", e))?,
                FtpClientStream::Secure(s) => s.list(None).map_err(|e| {
                    let err_str = e.to_string();
                    if err_str.contains("invalid syntax") || err_str.contains("10053") {
                        format!(
                            "Failed to list directory: {}. The server aborted the FTPS data connection. On vsFTPd servers, this occurs when 'require_ssl_reuse=YES' is enabled (vsFTPd rejects TLS data channels without session reuse). Please add 'require_ssl_reuse=NO' to /etc/vsftpd.conf on the server and restart vsftpd.",
                            e
                        )
                    } else {
                        format!("Failed to list directory: {}", e)
                    }
                })?,
            };

            let mut entries = Vec::new();
            for line in lines {
                if let Some(entry) = parse_ftp_list_line(&line, &canonical_dir) {
                    entries.push(entry);
                }
            }

            // Sort: directories first, then alphabetical
            entries.sort_by(|a, b| {
                if a.is_dir == b.is_dir {
                    a.name.to_lowercase().cmp(&b.name.to_lowercase())
                } else if a.is_dir {
                    std::cmp::Ordering::Less
                } else {
                    std::cmp::Ordering::Greater
                }
            });

            // Update cached current dir
            {
                let mut dir_guard = current_dir_arc.blocking_write();
                *dir_guard = canonical_dir.clone();
            }

            Ok((canonical_dir, entries))
        })
        .await
        .map_err(|e| format!("Worker thread error: {}", e))?
    }

    pub async fn canonicalize_path(&self, path: &str) -> Result<String, String> {
        let client_arc = self.client.clone();
        let p = path.to_string();

        tokio::task::spawn_blocking(move || -> Result<String, String> {
            let mut guard = client_arc.blocking_lock();
            if p.trim().is_empty() || p == "." {
                match &mut *guard {
                    FtpClientStream::Plain(s) => s.pwd().map_err(|e| format!("FTP pwd failed: {}", e)),
                    FtpClientStream::Secure(s) => s.pwd().map_err(|e| format!("FTP pwd failed: {}", e)),
                }
            } else {
                Ok(p)
            }
        })
        .await
        .map_err(|e| format!("Worker thread error: {}", e))?
    }

    pub async fn create_dir(&self, path: &str) -> Result<(), String> {
        let client_arc = self.client.clone();
        let p = path.to_string();

        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut guard = client_arc.blocking_lock();
            match &mut *guard {
                FtpClientStream::Plain(s) => s.mkdir(&p).map_err(|e| format!("Failed to create directory: {}", e)),
                FtpClientStream::Secure(s) => s.mkdir(&p).map_err(|e| format!("Failed to create directory: {}", e)),
            }
        })
        .await
        .map_err(|e| format!("Worker thread error: {}", e))?
    }

    pub async fn ensure_dir_recursive(&self, path: &str) -> Result<(), String> {
        let client_arc = self.client.clone();
        let p = path.to_string();

        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut guard = client_arc.blocking_lock();
            match &mut *guard {
                FtpClientStream::Plain(s) => {
                    ensure_ftp_dir_recursive!(s, &p);
                }
                FtpClientStream::Secure(s) => {
                    ensure_ftp_dir_recursive!(s, &p);
                }
            }
            Ok(())
        })
        .await
        .map_err(|e| format!("Worker thread error: {}", e))?
    }

    pub async fn batch_create_dirs(&self, paths: Vec<String>) -> Result<(), String> {
        if paths.is_empty() {
            return Ok(());
        }

        let client_arc = self.client.clone();
        let pool_arc = self.transfer_pool.clone();
        let host = self.host.clone();
        let port = self.port;
        let user = self.username.clone();
        let pass = self.password.clone().unwrap_or_default();
        let secure = self.is_secure;

        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut sorted_paths = paths;
            sorted_paths.sort_by_key(|p| p.len());
            let mut created: std::collections::HashSet<String> = std::collections::HashSet::new();

            let pooled = {
                let mut pool = pool_arc.blocking_lock();
                pool.pop()
            };
            let dedicated = pooled.or_else(|| {
                connect_ftp_stream(&host, port, &user, &pass, secure)
                    .ok()
                    .map(|(st, _)| st)
            });

            macro_rules! create_dirs_on_stream {
                ($stream:expr) => {{
                    for raw_path in &sorted_paths {
                        let clean = raw_path.trim().replace('\\', "/");
                        let clean_path = clean.trim_end_matches('/').to_string();
                        if clean_path.is_empty() || clean_path == "/" || created.contains(&clean_path) {
                            continue;
                        }
                        if $stream.mkdir(&clean_path).is_ok() {
                            created.insert(clean_path);
                            continue;
                        }
                        let segments: Vec<&str> = clean_path.split('/').filter(|s| !s.is_empty()).collect();
                        let is_absolute = clean_path.starts_with('/');
                        let mut current = if is_absolute { String::from("/") } else { String::new() };
                        for seg in segments {
                            if !current.is_empty() && !current.ends_with('/') {
                                current.push('/');
                            }
                            current.push_str(seg);
                            if current == "/" || created.contains(&current) {
                                continue;
                            }
                            let _ = $stream.mkdir(&current);
                            created.insert(current.clone());
                        }
                    }
                }};
            }

            if let Some(mut stream) = dedicated {
                match &mut stream {
                    FtpClientStream::Plain(s) => create_dirs_on_stream!(s),
                    FtpClientStream::Secure(s) => create_dirs_on_stream!(s),
                }
                return_transfer_stream(&pool_arc, stream);
            } else {
                let mut guard = client_arc.blocking_lock();
                match &mut *guard {
                    FtpClientStream::Plain(s) => create_dirs_on_stream!(s),
                    FtpClientStream::Secure(s) => create_dirs_on_stream!(s),
                }
            }

            Ok(())
        })
        .await
        .map_err(|e| format!("Worker thread error: {}", e))?
    }

    pub async fn crawl_remote_paths(
        &self,
        app: AppHandle,
        cancel_token: Arc<AtomicBool>,
        paths: Vec<String>,
        target_local_dir: String,
        ignore_patterns: Option<Vec<String>>,
        crawl_id: Option<String>,
    ) -> Result<Vec<RemoteCrawlTask>, String> {
        let client_arc = self.client.clone();
        let target_local = target_local_dir.trim().replace('\\', "/").trim_end_matches('/').to_string();
        let patterns = ignore_patterns.unwrap_or_default();

        tokio::task::spawn_blocking(move || -> Result<Vec<RemoteCrawlTask>, String> {
            let mut results: Vec<RemoteCrawlTask> = Vec::new();
            let mut dirs_count = 0usize;
            let mut last_emit = std::time::Instant::now();
            let mut last_count = 0usize;
            let mut emitted_files_idx = 0usize;
            let mut last_batch_emit = std::time::Instant::now();

            // Emit initial 0 count
            let _ = app.emit(
                "sftp:crawl:progress",
                crate::sftp::CrawlProgressPayload {
                    scan_type: "download".to_string(),
                    files: 0,
                    directories: 0,
                },
            );

            let initial_pwd = {
                let mut guard = client_arc.blocking_lock();
                match &mut *guard {
                    FtpClientStream::Plain(s) => s.pwd().unwrap_or_else(|_| "/".to_string()),
                    FtpClientStream::Secure(s) => s.pwd().unwrap_or_else(|_| "/".to_string()),
                }
            };

            let flush_crawl_batch = |results: &[RemoteCrawlTask],
                                     emitted_idx: &mut usize,
                                     last_batch: &mut std::time::Instant,
                                     dirs: usize,
                                     force: bool| {
                if let Some(ref cid) = crawl_id {
                    let pending = results.len().saturating_sub(*emitted_idx);
                    if pending > 0
                        && (force
                            || pending >= crate::sftp::CRAWL_STREAM_BATCH_SIZE
                            || last_batch.elapsed()
                                >= std::time::Duration::from_millis(
                                    crate::sftp::CRAWL_STREAM_BATCH_INTERVAL_MS,
                                ))
                    {
                        let batch_files = results[*emitted_idx..].to_vec();
                        *emitted_idx = results.len();
                        *last_batch = std::time::Instant::now();
                        let _ = app.emit(
                            "sftp:crawl:remote_batch",
                            crate::sftp::RemoteCrawlBatchPayload {
                                crawl_id: cid.clone(),
                                files: batch_files,
                                total_files: results.len(),
                                total_directories: dirs,
                            },
                        );
                    }
                }
            };

            for p in paths {
                if cancel_token.load(Ordering::SeqCst) {
                    break;
                }
                let clean_p = p.trim().trim_end_matches('/').to_string();
                if clean_p.is_empty() {
                    continue;
                }

                // Check if root path is a directory (locking only for this check)
                let is_dir_or_size = {
                    let mut guard = client_arc.blocking_lock();
                    match &mut *guard {
                        FtpClientStream::Plain(s) => {
                            if s.cwd(&clean_p).is_ok() {
                                Ok(())
                            } else {
                                Err(s.size(&clean_p).unwrap_or(0) as u64)
                            }
                        }
                        FtpClientStream::Secure(s) => {
                            if s.cwd(&clean_p).is_ok() {
                                Ok(())
                            } else {
                                Err(s.size(&clean_p).unwrap_or(0) as u64)
                            }
                        }
                    }
                };

                match is_dir_or_size {
                    Ok(()) => {
                        let folder_name = clean_p.split('/').next_back().unwrap_or("folder");
                        let local_base = if target_local.is_empty() {
                            folder_name.to_string()
                        } else {
                            format!("{}/{}", target_local, folder_name)
                        };

                        let mut dirs_to_visit = vec![clean_p.clone()];
                        dirs_count += 1;

                        while let Some(dir) = dirs_to_visit.pop() {
                            if cancel_token.load(Ordering::SeqCst) {
                                break;
                            }

                            // Lock client ONLY for this single directory's CWD + PWD + LIST
                            let dir_listing = {
                                let mut guard = client_arc.blocking_lock();
                                match &mut *guard {
                                    FtpClientStream::Plain(s) => {
                                        if s.cwd(&dir).is_ok() {
                                            let canonical = s.pwd().unwrap_or_else(|_| dir.clone());
                                            s.list(None).ok().map(|lines| (canonical, lines))
                                        } else {
                                            None
                                        }
                                    }
                                    FtpClientStream::Secure(s) => {
                                        if s.cwd(&dir).is_ok() {
                                            let canonical = s.pwd().unwrap_or_else(|_| dir.clone());
                                            s.list(None).ok().map(|lines| (canonical, lines))
                                        } else {
                                            None
                                        }
                                    }
                                }
                            };

                            let (canonical_dir, lines) = match dir_listing {
                                Some(pair) => pair,
                                None => continue,
                            };

                            for line in lines {
                                if cancel_token.load(Ordering::SeqCst) {
                                    break;
                                }
                                if let Some(entry) = parse_ftp_list_line(&line, &canonical_dir) {
                                    if entry.name == "." || entry.name == ".." {
                                        continue;
                                    }
                                    if crate::sftp::is_path_ignored(&entry.name, &entry.path, &patterns) {
                                        continue;
                                    }
                                    if entry.is_dir {
                                        dirs_count += 1;
                                        dirs_to_visit.push(entry.path);
                                    } else {
                                        let rel = entry
                                            .path
                                            .strip_prefix(&clean_p)
                                            .unwrap_or(&entry.path)
                                            .trim_start_matches('/');
                                        let local_path = format!("{}/{}", local_base.trim_end_matches('/'), rel);
                                        results.push(RemoteCrawlTask {
                                            remote_path: entry.path,
                                            local_path,
                                            file_name: entry.name,
                                            size: entry.size,
                                        });
                                    }

                                    let total = results.len() + dirs_count;
                                    if total.saturating_sub(last_count) >= 20
                                        || last_emit.elapsed() >= std::time::Duration::from_millis(35)
                                    {
                                        last_count = total;
                                        last_emit = std::time::Instant::now();
                                        let _ = app.emit(
                                            "sftp:crawl:progress",
                                            crate::sftp::CrawlProgressPayload {
                                                scan_type: "download".to_string(),
                                                files: results.len(),
                                                directories: dirs_count,
                                            },
                                        );
                                    }

                                    flush_crawl_batch(
                                        &results,
                                        &mut emitted_files_idx,
                                        &mut last_batch_emit,
                                        dirs_count,
                                        false,
                                    );
                                }
                            }
                        }
                    }
                    Err(size) => {
                        let file_name = clean_p.split('/').next_back().unwrap_or("file").to_string();
                        if !crate::sftp::is_path_ignored(&file_name, &file_name, &patterns) {
                            let local_path = if target_local.is_empty() {
                                file_name.clone()
                            } else {
                                format!("{}/{}", target_local, file_name)
                            };
                            results.push(RemoteCrawlTask {
                                remote_path: clean_p,
                                local_path,
                                file_name,
                                size,
                            });
                            flush_crawl_batch(
                                &results,
                                &mut emitted_files_idx,
                                &mut last_batch_emit,
                                dirs_count,
                                false,
                            );
                        }
                    }
                }
            }

            // Restore initial PWD
            {
                let mut guard = client_arc.blocking_lock();
                match &mut *guard {
                    FtpClientStream::Plain(s) => {
                        let _ = s.cwd(&initial_pwd);
                    }
                    FtpClientStream::Secure(s) => {
                        let _ = s.cwd(&initial_pwd);
                    }
                }
            }

            if !cancel_token.load(Ordering::SeqCst) {
                flush_crawl_batch(
                    &results,
                    &mut emitted_files_idx,
                    &mut last_batch_emit,
                    dirs_count,
                    true,
                );
            }

            // Emit final progress
            let _ = app.emit(
                "sftp:crawl:progress",
                crate::sftp::CrawlProgressPayload {
                    scan_type: "download".to_string(),
                    files: results.len(),
                    directories: dirs_count,
                },
            );

            if cancel_token.load(Ordering::SeqCst) {
                return Err("Download crawl cancelled by user".to_string());
            }

            Ok(results)
        })
        .await
        .map_err(|e| format!("Worker thread error: {}", e))?
    }

    pub async fn file_size(&self, path: &str) -> Result<u64, String> {
        let client_arc = self.client.clone();
        let p = path.to_string();

        tokio::task::spawn_blocking(move || -> Result<u64, String> {
            let mut guard = client_arc.blocking_lock();
            match &mut *guard {
                FtpClientStream::Plain(s) => s.size(&p).map(|sz| sz as u64).map_err(|e| format!("Failed to get file size: {}", e)),
                FtpClientStream::Secure(s) => s.size(&p).map(|sz| sz as u64).map_err(|e| format!("Failed to get file size: {}", e)),
            }
        })
        .await
        .map_err(|e| format!("Worker thread error: {}", e))?
    }

    pub async fn create_file(&self, path: &str, overwrite: Option<bool>) -> Result<(), String> {
        let client_arc = self.client.clone();
        let p = path.to_string();
        let allow_overwrite = overwrite.unwrap_or(false);

        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut guard = client_arc.blocking_lock();
            if !allow_overwrite {
                let exists = match &mut *guard {
                    FtpClientStream::Plain(s) => s.size(&p).is_ok(),
                    FtpClientStream::Secure(s) => s.size(&p).is_ok(),
                };
                if exists {
                    return Err(format!("File '{}' already exists on remote server", p));
                }
            }
            let mut cursor = std::io::Cursor::new(&[]);
            match &mut *guard {
                FtpClientStream::Plain(s) => s.put_file(&p, &mut cursor).map(|_| ()).map_err(|e| format!("Failed to create file: {}", e)),
                FtpClientStream::Secure(s) => s.put_file(&p, &mut cursor).map(|_| ()).map_err(|e| format!("Failed to create file: {}", e)),
            }
        })
        .await
        .map_err(|e| format!("Worker thread error: {}", e))?
    }

    pub async fn remove_dir(&self, path: &str) -> Result<(), String> {
        let client_arc = self.client.clone();
        let p = path.to_string();

        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut guard = client_arc.blocking_lock();
            let clean = p.trim().replace('\\', "/");
            let target = clean.trim_end_matches('/').to_string();

            match &mut *guard {
                FtpClientStream::Plain(s) => remove_ftp_dir_recursive!(s, &target),
                FtpClientStream::Secure(s) => remove_ftp_dir_recursive!(s, &target),
            }
        })
        .await
        .map_err(|e| format!("Worker thread error: {}", e))?
    }

    pub async fn remove_file(&self, path: &str) -> Result<(), String> {
        let client_arc = self.client.clone();
        let p = path.to_string();

        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut guard = client_arc.blocking_lock();
            match &mut *guard {
                FtpClientStream::Plain(s) => s.rm(&p).map_err(|e| format!("Failed to delete file: {}", e)),
                FtpClientStream::Secure(s) => s.rm(&p).map_err(|e| format!("Failed to delete file: {}", e)),
            }
        })
        .await
        .map_err(|e| format!("Worker thread error: {}", e))?
    }

    pub async fn rename(&self, from: &str, to: &str) -> Result<(), String> {
        let client_arc = self.client.clone();
        let src = from.to_string();
        let dst = to.to_string();

        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut guard = client_arc.blocking_lock();
            match &mut *guard {
                FtpClientStream::Plain(s) => s.rename(&src, &dst).map_err(|e| format!("Failed to rename item: {}", e)),
                FtpClientStream::Secure(s) => s.rename(&src, &dst).map_err(|e| format!("Failed to rename item: {}", e)),
            }
        })
        .await
        .map_err(|e| format!("Worker thread error: {}", e))?
    }

    pub async fn read_file_binary(&self, path: &str) -> Result<Vec<u8>, String> {
        match self.try_read_file_binary(path).await {
            Ok(bytes) => Ok(bytes),
            Err(e) => {
                if is_connection_error(&e) {
                    log::info!("[ftp] Connection dropped during read_file_binary, reconnecting...");
                    if self.reconnect().await.is_ok() {
                        return self.try_read_file_binary(path).await;
                    }
                }
                Err(e)
            }
        }
    }

    async fn try_read_file_binary(&self, path: &str) -> Result<Vec<u8>, String> {
        let client_arc = self.client.clone();
        let p = path.to_string();

        tokio::task::spawn_blocking(move || -> Result<Vec<u8>, String> {
            let mut guard = client_arc.blocking_lock();
            let mut buf = Vec::new();
            let max_bytes: usize = 25 * 1024 * 1024;
            let mut exceeded = false;

            match &mut *guard {
                FtpClientStream::Plain(s) => {
                    let mut reader = s
                        .retr_as_stream(&p)
                        .map_err(|e| format!("Failed to retrieve file '{}': {}", p, e))?;
                    let mut buffer = [0u8; 64 * 1024];
                    let mut total_read = 0usize;
                    loop {
                        let to_read = std::cmp::min(buffer.len(), (max_bytes + 1).saturating_sub(total_read));
                        if to_read == 0 {
                            exceeded = true;
                            let _ = std::io::copy(&mut reader, &mut std::io::sink());
                            break;
                        }
                        let n = reader
                            .read(&mut buffer[..to_read])
                            .map_err(|e| format!("Failed to read file '{}': {}", p, e))?;
                        if n == 0 {
                            break;
                        }
                        buf.extend_from_slice(&buffer[..n]);
                        total_read += n;
                        if total_read > max_bytes {
                            exceeded = true;
                            let _ = std::io::copy(&mut reader, &mut std::io::sink());
                            break;
                        }
                    }
                    let _ = s.finalize_retr_stream(reader);
                }
                FtpClientStream::Secure(s) => {
                    let mut reader = s
                        .retr_as_stream(&p)
                        .map_err(|e| format!("Failed to retrieve file '{}': {}", p, e))?;
                    let mut buffer = [0u8; 64 * 1024];
                    let mut total_read = 0usize;
                    loop {
                        let to_read = std::cmp::min(buffer.len(), (max_bytes + 1).saturating_sub(total_read));
                        if to_read == 0 {
                            exceeded = true;
                            let _ = std::io::copy(&mut reader, &mut std::io::sink());
                            break;
                        }
                        let n = reader
                            .read(&mut buffer[..to_read])
                            .map_err(|e| format!("Failed to read file '{}': {}", p, e))?;
                        if n == 0 {
                            break;
                        }
                        buf.extend_from_slice(&buffer[..n]);
                        total_read += n;
                        if total_read > max_bytes {
                            exceeded = true;
                            let _ = std::io::copy(&mut reader, &mut std::io::sink());
                            break;
                        }
                    }
                    let _ = s.finalize_retr_stream(reader);
                }
            }

            if exceeded {
                return Err("File exceeds 25 MB in-memory limit".to_string());
            }

            Ok(buf)
        })
        .await
        .map_err(|e| format!("Worker thread error: {}", e))?
    }

    pub async fn download_to_local_file(&self, remote_path: &str, local_path: &Path) -> Result<(), String> {
        match self.try_download_to_local_file(remote_path, local_path).await {
            Ok(()) => Ok(()),
            Err(e) => {
                if is_connection_error(&e) {
                    log::info!("[ftp] Connection dropped during download_to_local_file, reconnecting...");
                    if self.reconnect().await.is_ok() {
                        return self.try_download_to_local_file(remote_path, local_path).await;
                    }
                }
                let _ = self.reconnect().await;
                Err(e)
            }
        }
    }

    async fn try_download_to_local_file(&self, remote_path: &str, local_path: &Path) -> Result<(), String> {
        let client_arc = self.client.clone();
        let p = remote_path.to_string();
        let local_buf = local_path.to_path_buf();

        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut guard = client_arc.blocking_lock();
            if let Some(parent) = local_buf.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let mut local_file = File::create(&local_buf)
                .map_err(|e| format!("Failed to create local file '{}': {}", local_buf.display(), e))?;

            match &mut *guard {
                FtpClientStream::Plain(s) => {
                    let mut reader = s
                        .retr_as_stream(&p)
                        .map_err(|e| format!("Failed to retrieve file '{}': {}", p, e))?;
                    std::io::copy(&mut reader, &mut local_file)
                        .map_err(|e| format!("Failed to stream file '{}': {}", p, e))?;
                    local_file
                        .flush()
                        .map_err(|e| format!("Failed to flush local file: {}", e))?;
                    s.finalize_retr_stream(reader)
                        .map_err(|e| format!("Failed to finalize FTP download: {}", e))?;
                }
                FtpClientStream::Secure(s) => {
                    let mut reader = s
                        .retr_as_stream(&p)
                        .map_err(|e| format!("Failed to retrieve file '{}': {}", p, e))?;
                    std::io::copy(&mut reader, &mut local_file)
                        .map_err(|e| format!("Failed to stream file '{}': {}", p, e))?;
                    local_file
                        .flush()
                        .map_err(|e| format!("Failed to flush local file: {}", e))?;
                    s.finalize_retr_stream(reader)
                        .map_err(|e| format!("Failed to finalize FTP download: {}", e))?;
                }
            }
            Ok(())
        })
        .await
        .map_err(|e| format!("Worker thread error: {}", e))?
    }

    pub async fn upload_from_local_file(&self, local_path: &Path, remote_path: &str) -> Result<(), String> {
        match self.try_upload_from_local_file(local_path, remote_path).await {
            Ok(()) => Ok(()),
            Err(e) => {
                if is_connection_error(&e) {
                    log::info!("[ftp] Connection dropped during upload_from_local_file, reconnecting...");
                    if self.reconnect().await.is_ok() {
                        return self.try_upload_from_local_file(local_path, remote_path).await;
                    }
                }
                let _ = self.reconnect().await;
                Err(e)
            }
        }
    }

    async fn try_upload_from_local_file(&self, local_path: &Path, remote_path: &str) -> Result<(), String> {
        let client_arc = self.client.clone();
        let p = remote_path.to_string();
        let local_buf = local_path.to_path_buf();

        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut guard = client_arc.blocking_lock();
            let mut local_file = File::open(&local_buf)
                .map_err(|e| format!("Failed to open local file '{}': {}", local_buf.display(), e))?;

            match &mut *guard {
                FtpClientStream::Plain(s) => {
                    if let Some(parent) = Path::new(&p).parent() {
                        let parent_str = parent.to_string_lossy().replace('\\', "/");
                        if !parent_str.is_empty() && parent_str != "/" && parent_str != "." {
                            ensure_ftp_dir_recursive!(s, &parent_str);
                        }
                    }
                    s.put_file(&p, &mut local_file)
                        .map(|_| ())
                        .map_err(|e| format!("Failed to upload file '{}': {}", p, e))
                }
                FtpClientStream::Secure(s) => {
                    if let Some(parent) = Path::new(&p).parent() {
                        let parent_str = parent.to_string_lossy().replace('\\', "/");
                        if !parent_str.is_empty() && parent_str != "/" && parent_str != "." {
                            ensure_ftp_dir_recursive!(s, &parent_str);
                        }
                    }
                    s.put_file(&p, &mut local_file)
                        .map(|_| ())
                        .map_err(|e| format!("Failed to upload file '{}': {}", p, e))
                }
            }
        })
        .await
        .map_err(|e| format!("Worker thread error: {}", e))?
    }

    pub async fn copy_file(&self, src_path: &str, dest_path: &str) -> Result<(), String> {
        let tmp_path = std::env::temp_dir().join(format!("flowsftp-ftp-copy-{}", uuid::Uuid::new_v4()));
        let res = async {
            self.download_to_local_file(src_path, &tmp_path).await?;
            self.upload_from_local_file(&tmp_path, dest_path).await
        }
        .await;
        let _ = tokio::fs::remove_file(&tmp_path).await;
        res
    }

    pub async fn calculate_checksum(&self, path: &str, algorithm: &str) -> Result<String, String> {
        use sha2::{Digest, Sha256};

        let client_arc = self.client.clone();
        let p = path.to_string();
        let is_md5 = algorithm.eq_ignore_ascii_case("md5");

        let res = tokio::task::spawn_blocking(move || -> Result<String, String> {
            let mut guard = client_arc.blocking_lock();
            let mut buffer = [0u8; 64 * 1024];

            match &mut *guard {
                FtpClientStream::Plain(s) => {
                    let mut reader = s
                        .retr_as_stream(&p)
                        .map_err(|e| format!("Failed to retrieve file '{}': {}", p, e))?;
                    let hash = if is_md5 {
                        let mut ctx = md5::Context::new();
                        loop {
                            let n = reader
                                .read(&mut buffer)
                                .map_err(|e| format!("Failed to read file '{}': {}", p, e))?;
                            if n == 0 {
                                break;
                            }
                            ctx.consume(&buffer[..n]);
                        }
                        format!("{:x}", ctx.compute())
                    } else {
                        let mut hasher = Sha256::new();
                        loop {
                            let n = reader
                                .read(&mut buffer)
                                .map_err(|e| format!("Failed to read file '{}': {}", p, e))?;
                            if n == 0 {
                                break;
                            }
                            hasher.update(&buffer[..n]);
                        }
                        format!("{:x}", hasher.finalize())
                    };
                    let _ = s.finalize_retr_stream(reader);
                    Ok(hash)
                }
                FtpClientStream::Secure(s) => {
                    let mut reader = s
                        .retr_as_stream(&p)
                        .map_err(|e| format!("Failed to retrieve file '{}': {}", p, e))?;
                    let hash = if is_md5 {
                        let mut ctx = md5::Context::new();
                        loop {
                            let n = reader
                                .read(&mut buffer)
                                .map_err(|e| format!("Failed to read file '{}': {}", p, e))?;
                            if n == 0 {
                                break;
                            }
                            ctx.consume(&buffer[..n]);
                        }
                        format!("{:x}", ctx.compute())
                    } else {
                        let mut hasher = Sha256::new();
                        loop {
                            let n = reader
                                .read(&mut buffer)
                                .map_err(|e| format!("Failed to read file '{}': {}", p, e))?;
                            if n == 0 {
                                break;
                            }
                            hasher.update(&buffer[..n]);
                        }
                        format!("{:x}", hasher.finalize())
                    };
                    let _ = s.finalize_retr_stream(reader);
                    Ok(hash)
                }
            }
        })
        .await
        .map_err(|e| format!("Worker thread error: {}", e))?;

        if res.is_err() {
            let _ = self.reconnect().await;
        }
        res
    }

    pub async fn read_file_text(&self, path: &str) -> Result<String, String> {
        let bytes = self.read_file_binary(path).await?;
        match String::from_utf8(bytes) {
            Ok(s) => Ok(s),
            Err(e) => Ok(String::from_utf8_lossy(e.as_bytes()).to_string()),
        }
    }

    pub async fn write_file_binary(&self, path: &str, bytes: &[u8]) -> Result<(), String> {
        match self.try_write_file_binary(path, bytes).await {
            Ok(()) => Ok(()),
            Err(e) => {
                if is_connection_error(&e) {
                    log::info!("[ftp] Connection dropped during write_file_binary, reconnecting...");
                    if self.reconnect().await.is_ok() {
                        return self.try_write_file_binary(path, bytes).await;
                    }
                }
                Err(e)
            }
        }
    }

    async fn try_write_file_binary(&self, path: &str, bytes: &[u8]) -> Result<(), String> {
        let client_arc = self.client.clone();
        let p = path.to_string();
        let buf = bytes.to_vec();

        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut guard = client_arc.blocking_lock();
            let mut cursor = std::io::Cursor::new(buf);

            match &mut *guard {
                FtpClientStream::Plain(s) => {
                    s.put_file(&p, &mut cursor)
                        .map(|_| ())
                        .map_err(|e| format!("Failed to save file '{}': {}", p, e))
                }
                FtpClientStream::Secure(s) => {
                    s.put_file(&p, &mut cursor)
                        .map(|_| ())
                        .map_err(|e| format!("Failed to save file '{}': {}", p, e))
                }
            }
        })
        .await
        .map_err(|e| format!("Worker thread error: {}", e))?
    }

    pub async fn write_file_text(&self, path: &str, content: &str) -> Result<(), String> {
        self.write_file_binary(path, content.as_bytes()).await
    }

    pub async fn set_permissions(&self, path: &str, permissions: u32) -> Result<(), String> {
        if path.contains('\r') || path.contains('\n') {
            return Err("Invalid path: contains control characters".to_string());
        }

        let client_arc = self.client.clone();
        let p = path.to_string();

        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut guard = client_arc.blocking_lock();
            let cmd = format!("SITE CHMOD {:o} {}", permissions, p);
            match &mut *guard {
                FtpClientStream::Plain(s) => {
                    s.site(&cmd).map(|_| ()).map_err(|e| format!("Failed to change permissions: {}", e))
                }
                FtpClientStream::Secure(s) => {
                    s.site(&cmd).map(|_| ()).map_err(|e| format!("Failed to change permissions: {}", e))
                }
            }
        })
        .await
        .map_err(|e| format!("Worker thread error: {}", e))?
    }

    pub async fn check_file_exists(&self, path: &str) -> FileConflictInfo {
        let client_arc = self.client.clone();
        let p = path.to_string();

        tokio::task::spawn_blocking(move || {
            let mut guard = client_arc.blocking_lock();
            let size = match &mut *guard {
                FtpClientStream::Plain(s) => s.size(&p).ok().map(|s| s as u64),
                FtpClientStream::Secure(s) => s.size(&p).ok().map(|s| s as u64),
            };

            if let Some(s) = size {
                FileConflictInfo {
                    exists: true,
                    size: s,
                    modified: 0,
                }
            } else {
                FileConflictInfo {
                    exists: false,
                    size: 0,
                    modified: 0,
                }
            }
        })
        .await
        .unwrap_or(FileConflictInfo {
            exists: false,
            size: 0,
            modified: 0,
        })
    }

    pub async fn download_file(
        &self,
        app: &AppHandle,
        remote_path: &str,
        local_path: &str,
        transfer_id: &str,
        conflict_action: Option<String>,
        file_size: Option<u64>,
    ) -> Result<(), String> {
        let client_arc = self.client.clone();
        let pool_arc = self.transfer_pool.clone();
        let host = self.host.clone();
        let port = self.port;
        let user = self.username.clone();
        let pass = self.password.clone().unwrap_or_default();
        let secure = self.is_secure;
        let r_path = remote_path.to_string();
        let l_path = local_path.to_string();
        let t_id = transfer_id.to_string();
        let app_handle = app.clone();

        let (res, used_shared_client) = tokio::task::spawn_blocking(move || -> (Result<(), String>, bool) {
            let pooled = {
                let mut pool = pool_arc.blocking_lock();
                pool.pop()
            };

            if let Some(mut stream) = pooled {
                let first_try = (|| -> Result<(), String> {
                    match &mut stream {
                        FtpClientStream::Plain(s) => {
                            run_ftp_download!(s, app_handle, &r_path, &l_path, &t_id, conflict_action, file_size)
                        }
                        FtpClientStream::Secure(s) => {
                            run_ftp_download!(s, app_handle, &r_path, &l_path, &t_id, conflict_action, file_size)
                        }
                    }
                })();
                match first_try {
                    Ok(()) => {
                        return_transfer_stream(&pool_arc, stream);
                        return (Ok(()), false);
                    }
                    Err(ref e) if !is_connection_error(e) => {
                        return (first_try, false);
                    }
                    Err(_) => {
                        // Pooled connection went stale; fall through to open a fresh stream
                    }
                }
            }

            if let Ok((mut stream, _)) = connect_ftp_stream(&host, port, &user, &pass, secure) {
                let transfer_res = (|| -> Result<(), String> {
                    match &mut stream {
                        FtpClientStream::Plain(s) => {
                            run_ftp_download!(s, app_handle, &r_path, &l_path, &t_id, conflict_action, file_size)
                        }
                        FtpClientStream::Secure(s) => {
                            run_ftp_download!(s, app_handle, &r_path, &l_path, &t_id, conflict_action, file_size)
                        }
                    }
                })();
                if transfer_res.is_ok() {
                    return_transfer_stream(&pool_arc, stream);
                }
                return (transfer_res, false);
            }

            let mut guard = client_arc.blocking_lock();
            let shared_res = (|| -> Result<(), String> {
                match &mut *guard {
                    FtpClientStream::Plain(s) => {
                        run_ftp_download!(s, app_handle, &r_path, &l_path, &t_id, conflict_action, file_size)
                    }
                    FtpClientStream::Secure(s) => {
                        run_ftp_download!(s, app_handle, &r_path, &l_path, &t_id, conflict_action, file_size)
                    }
                }
            })();
            (shared_res, true)
        })
        .await
        .map_err(|e| format!("Worker thread error: {}", e))?;

        if res.is_err() {
            let (native_local, _) = normalize_to_native_path(local_path);
            let _ = tokio::fs::remove_file(&native_local).await;
            if used_shared_client {
                let _ = self.reconnect().await;
            }
        }

        res
    }

    pub async fn upload_file(
        &self,
        app: &AppHandle,
        local_path: &str,
        remote_path: &str,
        transfer_id: &str,
        conflict_action: Option<String>,
    ) -> Result<(), String> {
        let client_arc = self.client.clone();
        let pool_arc = self.transfer_pool.clone();
        let host = self.host.clone();
        let port = self.port;
        let user = self.username.clone();
        let pass = self.password.clone().unwrap_or_default();
        let secure = self.is_secure;
        let r_path = remote_path.to_string();
        let l_path = local_path.to_string();
        let t_id = transfer_id.to_string();
        let app_handle = app.clone();

        let (res, used_shared_client) = tokio::task::spawn_blocking(move || -> (Result<(), String>, bool) {
            let pooled = {
                let mut pool = pool_arc.blocking_lock();
                pool.pop()
            };

            if let Some(mut stream) = pooled {
                let first_try = (|| -> Result<(), String> {
                    match &mut stream {
                        FtpClientStream::Plain(s) => {
                            run_ftp_upload!(s, app_handle, &l_path, &r_path, &t_id, conflict_action)
                        }
                        FtpClientStream::Secure(s) => {
                            run_ftp_upload!(s, app_handle, &l_path, &r_path, &t_id, conflict_action)
                        }
                    }
                })();
                match first_try {
                    Ok(()) => {
                        return_transfer_stream(&pool_arc, stream);
                        return (Ok(()), false);
                    }
                    Err(ref e) if !is_connection_error(e) => {
                        return (first_try, false);
                    }
                    Err(_) => {
                        // Pooled connection went stale; fall through to open a fresh stream
                    }
                }
            }

            if let Ok((mut stream, _)) = connect_ftp_stream(&host, port, &user, &pass, secure) {
                let transfer_res = (|| -> Result<(), String> {
                    match &mut stream {
                        FtpClientStream::Plain(s) => {
                            run_ftp_upload!(s, app_handle, &l_path, &r_path, &t_id, conflict_action)
                        }
                        FtpClientStream::Secure(s) => {
                            run_ftp_upload!(s, app_handle, &l_path, &r_path, &t_id, conflict_action)
                        }
                    }
                })();
                if transfer_res.is_ok() {
                    return_transfer_stream(&pool_arc, stream);
                }
                return (transfer_res, false);
            }

            let mut guard = client_arc.blocking_lock();
            let shared_res = (|| -> Result<(), String> {
                match &mut *guard {
                    FtpClientStream::Plain(s) => {
                        run_ftp_upload!(s, app_handle, &l_path, &r_path, &t_id, conflict_action)
                    }
                    FtpClientStream::Secure(s) => {
                        run_ftp_upload!(s, app_handle, &l_path, &r_path, &t_id, conflict_action)
                    }
                }
            })();
            (shared_res, true)
        })
        .await
        .map_err(|e| format!("Worker thread error: {}", e))?;

        if res.is_err() && used_shared_client {
            let _ = self.reconnect().await;
        }

        res
    }

    pub async fn close(&self) -> Result<(), String> {
        let client_arc = self.client.clone();
        let pool_arc = self.transfer_pool.clone();
        tokio::task::spawn_blocking(move || {
            let pooled_streams: Vec<FtpClientStream> = {
                let mut pool = pool_arc.blocking_lock();
                std::mem::take(&mut *pool)
            };
            for mut stream in pooled_streams {
                match &mut stream {
                    FtpClientStream::Plain(s) => {
                        let _ = s.quit();
                    }
                    FtpClientStream::Secure(s) => {
                        let _ = s.quit();
                    }
                }
            }

            let mut guard = client_arc.blocking_lock();
            match &mut *guard {
                FtpClientStream::Plain(s) => {
                    let _ = s.quit();
                }
                FtpClientStream::Secure(s) => {
                    let _ = s.quit();
                }
            }
        })
        .await
        .map_err(|e| format!("Failed to close FTP session: {}", e))
    }
}

pub fn parse_ftp_list_line(line: &str, current_dir: &str) -> Option<SftpFileEntry> {
    let line = line.trim();
    if line.is_empty() || line.starts_with("total ") {
        return None;
    }

    // Windows / IIS FTP format check:
    if line.len() > 18 && (&line[2..3] == "-" || &line[2..3] == "/") {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 4 {
            let is_dir = parts[2] == "<DIR>";
            let size = if is_dir { 0 } else { parts[2].parse::<u64>().unwrap_or(0) };
            let name = parts[3..].join(" ");
            if name == "." || name == ".." {
                return None;
            }
            let full_path = if current_dir == "/" {
                format!("/{}", name)
            } else {
                format!("{}/{}", current_dir.trim_end_matches('/'), name)
            };
            return Some(SftpFileEntry {
                name,
                path: full_path,
                is_dir,
                is_symlink: false,
                symlink_target: None,
                size,
                modified: 0,
                permissions: if is_dir { 0o755 } else { 0o644 },
                owner: None,
                group: None,
            });
        }
    }

    // Unix style:
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 9 {
        return None;
    }

    let first_char = parts[0].chars().next().unwrap_or('-');
    let is_dir = first_char == 'd';
    let is_symlink = first_char == 'l';

    // Parse unix mode bits from permissions string (e.g. -rwxr-xr-x)
    let mut perm: u32 = 0;
    let mode_bytes = parts[0].as_bytes();
    if mode_bytes.len() >= 10 {
        if mode_bytes[1] == b'r' { perm |= 0o400; }
        if mode_bytes[2] == b'w' { perm |= 0o200; }
        if mode_bytes[3] == b'x' || mode_bytes[3] == b's' { perm |= 0o100; }
        if mode_bytes[4] == b'r' { perm |= 0o040; }
        if mode_bytes[5] == b'w' { perm |= 0o020; }
        if mode_bytes[6] == b'x' || mode_bytes[6] == b's' { perm |= 0o010; }
        if mode_bytes[7] == b'r' { perm |= 0o004; }
        if mode_bytes[8] == b'w' { perm |= 0o002; }
        if mode_bytes[9] == b'x' || mode_bytes[9] == b't' { perm |= 0o001; }
    } else {
        perm = if is_dir { 0o755 } else { 0o644 };
    }

    let owner = Some(parts[2].to_string());
    let group = Some(parts[3].to_string());

    // File size is usually index 4
    let size = parts[4].parse::<u64>().unwrap_or(0);

    // Filename is from index 8 onwards
    let raw_name = parts[8..].join(" ");
    let (name, symlink_target) = if is_symlink {
        let mut split = raw_name.split(" -> ");
        let n = split.next().unwrap_or(&raw_name).to_string();
        let target = split.next().map(|s| s.to_string());
        (n, target)
    } else {
        (raw_name, None)
    };

    if name == "." || name == ".." {
        return None;
    }

    let full_path = if current_dir == "/" {
        format!("/{}", name)
    } else {
        format!("{}/{}", current_dir.trim_end_matches('/'), name)
    };

    Some(SftpFileEntry {
        name,
        path: full_path,
        is_dir,
        is_symlink,
        symlink_target,
        size,
        modified: 0,
        permissions: perm,
        owner,
        group,
    })
}

