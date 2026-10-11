use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Arc;
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

pub struct ActiveFtpSession {
    pub session_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub is_secure: bool,
    pub current_dir: Arc<RwLock<String>>,
    client: Arc<Mutex<FtpClientStream>>,
}

macro_rules! run_ftp_download {
    ($stream:expr, $app_handle:expr, $remote_path:expr, $local_path:expr, $transfer_id:expr, $conflict_action:expr) => {{
        let stream = $stream;
        let (native_local, _) = normalize_to_native_path($local_path);
        let file_name = Path::new($remote_path)
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".to_string());

        let total_size = stream.size($remote_path).unwrap_or(0) as u64;
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

        let _ = stream.finalize_retr_stream(reader);
        Ok::<(), String>(())
    }};
}

macro_rules! ensure_ftp_dir_recursive {
    ($stream:expr, $path:expr) => {{
        let clean = $path.trim().replace('\\', "/");
        let segments: Vec<&str> = clean.split('/').filter(|s| !s.is_empty()).collect();
        if !segments.is_empty() {
            let is_absolute = clean.starts_with('/');
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
    }};
}

macro_rules! crawl_ftp_single_path {
    ($stream:expr, $clean_p:expr, $target_local:expr, $patterns:expr, $results:expr) => {{
        let stream = $stream;
        let p_str = $clean_p;
        let patterns = $patterns;

        if stream.cwd(p_str).is_ok() {
            let folder_name = p_str.split('/').last().unwrap_or("folder");
            let local_base = if $target_local.is_empty() {
                folder_name.to_string()
            } else {
                format!("{}/{}", $target_local, folder_name)
            };

            let mut dirs_to_visit = vec![p_str.to_string()];
            while let Some(dir) = dirs_to_visit.pop() {
                if stream.cwd(&dir).is_err() {
                    continue;
                }
                let canonical_dir = stream.pwd().unwrap_or_else(|_| dir.clone());
                let lines = match stream.list(None) {
                    Ok(l) => l,
                    Err(_) => continue,
                };

                for line in lines {
                    if let Some(entry) = parse_ftp_list_line(&line, &canonical_dir) {
                        if entry.name == "." || entry.name == ".." {
                            continue;
                        }
                        if crate::sftp::is_path_ignored(&entry.name, &entry.path, patterns) {
                            continue;
                        }
                        if entry.is_dir {
                            dirs_to_visit.push(entry.path);
                        } else {
                            let rel = entry.path
                                .strip_prefix(p_str)
                                .unwrap_or(&entry.path)
                                .trim_start_matches('/');
                            let local_path = format!("{}/{}", local_base.trim_end_matches('/'), rel);
                            $results.push(RemoteCrawlTask {
                                remote_path: entry.path,
                                local_path,
                                file_name: entry.name,
                                size: entry.size,
                            });
                        }
                    }
                }
            }
        } else {
            let file_name = p_str.split('/').last().unwrap_or("file").to_string();
            if !crate::sftp::is_path_ignored(&file_name, &file_name, patterns) {
                let size = stream.size(p_str).unwrap_or(0) as u64;
                let local_path = if $target_local.is_empty() {
                    file_name.clone()
                } else {
                    format!("{}/{}", $target_local, file_name)
                };
                $results.push(RemoteCrawlTask {
                    remote_path: p_str.to_string(),
                    local_path,
                    file_name,
                    size,
                });
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

        let _ = stream.finalize_put_stream(writer);

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
        let addr = format!("{}:{}", host, port);
        let user = username.clone();
        let pass = password.clone().unwrap_or_default();
        let pass_stored = password.clone();
        let h = host.clone();

        let (client, initial_pwd) = tokio::task::spawn_blocking(move || -> Result<(FtpClientStream, String), String> {
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
                    .into_secure(connector, &h)
                    .map_err(|e| {
                        format!(
                            "Failed to establish TLS encryption (FTPS): {}. If this server does not support TLS/FTPS, try connecting with 'FTP (Plain)' protocol.",
                            e
                        )
                    })?;

                secure_stream.set_passive_nat_workaround(true);

                secure_stream
                    .login(&user, &pass)
                    .map_err(|e| format!("FTP authentication failed for user '{}': {}", user, e))?;

                let pwd = secure_stream.pwd().unwrap_or_else(|_| "/".to_string());

                Ok((FtpClientStream::Secure(secure_stream), pwd))
            } else {
                let mut stream = FtpStream::connect(&addr)
                    .map_err(|e| format!("Failed to connect to FTP server {}: {}", addr, e))?;

                stream.set_passive_nat_workaround(true);

                stream
                    .login(&user, &pass)
                    .map_err(|e| format!("FTP authentication failed for user '{}': {}", user, e))?;

                let pwd = stream.pwd().unwrap_or_else(|_| "/".to_string());

                Ok((FtpClientStream::Plain(stream), pwd))
            }
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
        })
    }

    pub async fn reconnect(&self) -> Result<(), String> {
        let addr = format!("{}:{}", self.host, self.port);
        let user = self.username.clone();
        let pass = self.password.clone().unwrap_or_default();
        let h = self.host.clone();
        let secure = self.is_secure;
        let client_arc = self.client.clone();
        let current_dir_arc = self.current_dir.clone();

        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut guard = client_arc.blocking_lock();

            let new_stream = if secure {
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
                    .into_secure(connector, &h)
                    .map_err(|e| format!("Failed to establish TLS encryption (FTPS): {}", e))?;

                secure_stream.set_passive_nat_workaround(true);
                secure_stream
                    .login(&user, &pass)
                    .map_err(|e| format!("FTP authentication failed for user '{}': {}", user, e))?;

                FtpClientStream::Secure(secure_stream)
            } else {
                let mut stream = FtpStream::connect(&addr)
                    .map_err(|e| format!("Failed to connect to FTP server {}: {}", addr, e))?;

                stream.set_passive_nat_workaround(true);
                stream
                    .login(&user, &pass)
                    .map_err(|e| format!("FTP authentication failed for user '{}': {}", user, e))?;

                FtpClientStream::Plain(stream)
            };

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

        if !is_ok {
            if self.reconnect().await.is_ok() {
                return true;
            }
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

    pub async fn crawl_remote_paths(
        &self,
        paths: Vec<String>,
        target_local_dir: String,
        ignore_patterns: Option<Vec<String>>,
    ) -> Result<Vec<RemoteCrawlTask>, String> {
        let client_arc = self.client.clone();
        let target_local = target_local_dir.trim().replace('\\', "/").trim_end_matches('/').to_string();
        let patterns = ignore_patterns.unwrap_or_default();

        tokio::task::spawn_blocking(move || -> Result<Vec<RemoteCrawlTask>, String> {
            let mut guard = client_arc.blocking_lock();
            let mut results = Vec::new();

            let initial_pwd = match &mut *guard {
                FtpClientStream::Plain(s) => s.pwd().unwrap_or_else(|_| "/".to_string()),
                FtpClientStream::Secure(s) => s.pwd().unwrap_or_else(|_| "/".to_string()),
            };

            for p in paths {
                let clean_p = p.trim().trim_end_matches('/').to_string();
                if clean_p.is_empty() {
                    continue;
                }

                match &mut *guard {
                    FtpClientStream::Plain(s) => {
                        crawl_ftp_single_path!(s, &clean_p, &target_local, &patterns, &mut results);
                    }
                    FtpClientStream::Secure(s) => {
                        crawl_ftp_single_path!(s, &clean_p, &target_local, &patterns, &mut results);
                    }
                }
            }

            // Restore initial PWD
            match &mut *guard {
                FtpClientStream::Plain(s) => { let _ = s.cwd(&initial_pwd); }
                FtpClientStream::Secure(s) => { let _ = s.cwd(&initial_pwd); }
            }

            Ok(results)
        })
        .await
        .map_err(|e| format!("Worker thread error: {}", e))?
    }

    pub async fn create_file(&self, path: &str) -> Result<(), String> {
        let client_arc = self.client.clone();
        let p = path.to_string();

        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut guard = client_arc.blocking_lock();
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

            match &mut *guard {
                FtpClientStream::Plain(s) => {
                    let mut reader = s
                        .retr_as_stream(&p)
                        .map_err(|e| format!("Failed to retrieve file '{}': {}", p, e))?;
                    let mut buffer = [0u8; 64 * 1024];
                    let max_bytes = 25 * 1024 * 1024;
                    let mut total_read = 0;
                    loop {
                        let to_read = std::cmp::min(buffer.len(), max_bytes - total_read);
                        if to_read == 0 {
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
                    }
                    let _ = s.finalize_retr_stream(reader);
                }
                FtpClientStream::Secure(s) => {
                    let mut reader = s
                        .retr_as_stream(&p)
                        .map_err(|e| format!("Failed to retrieve file '{}': {}", p, e))?;
                    let mut buffer = [0u8; 64 * 1024];
                    let max_bytes = 25 * 1024 * 1024;
                    let mut total_read = 0;
                    loop {
                        let to_read = std::cmp::min(buffer.len(), max_bytes - total_read);
                        if to_read == 0 {
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
                    }
                    let _ = s.finalize_retr_stream(reader);
                }
            }

            Ok(buf)
        })
        .await
        .map_err(|e| format!("Worker thread error: {}", e))?
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
        .unwrap_or_else(|_| FileConflictInfo {
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
    ) -> Result<(), String> {
        let client_arc = self.client.clone();
        let r_path = remote_path.to_string();
        let l_path = local_path.to_string();
        let t_id = transfer_id.to_string();
        let app_handle = app.clone();

        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut guard = client_arc.blocking_lock();
            match &mut *guard {
                FtpClientStream::Plain(s) => run_ftp_download!(s, app_handle, &r_path, &l_path, &t_id, conflict_action),
                FtpClientStream::Secure(s) => run_ftp_download!(s, app_handle, &r_path, &l_path, &t_id, conflict_action),
            }
        })
        .await
        .map_err(|e| format!("Worker thread error: {}", e))?
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
        let r_path = remote_path.to_string();
        let l_path = local_path.to_string();
        let t_id = transfer_id.to_string();
        let app_handle = app.clone();

        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let mut guard = client_arc.blocking_lock();
            match &mut *guard {
                FtpClientStream::Plain(s) => run_ftp_upload!(s, app_handle, &l_path, &r_path, &t_id, conflict_action),
                FtpClientStream::Secure(s) => run_ftp_upload!(s, app_handle, &l_path, &r_path, &t_id, conflict_action),
            }
        })
        .await
        .map_err(|e| format!("Worker thread error: {}", e))?
    }

    pub async fn close(&self) -> Result<(), String> {
        let client_arc = self.client.clone();
        tokio::task::spawn_blocking(move || {
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
    let name = if is_symlink {
        raw_name.split(" -> ").next().unwrap_or(&raw_name).to_string()
    } else {
        raw_name
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
        size,
        modified: 0,
        permissions: perm,
        owner,
        group,
    })
}

