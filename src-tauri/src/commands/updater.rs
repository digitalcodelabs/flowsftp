use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

pub const DEFAULT_UPDATE_BASE_URL: &str = "https://flowsftp.com/update";

static UPDATE_CANCEL_FLAG: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateServerResponse {
    pub version: String,
    pub url: String,
    pub notes: Option<String>,
    pub pub_date: Option<String>,
    pub signature: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub update_available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub download_url: Option<String>,
    pub notes: Option<String>,
    pub pub_date: Option<String>,
    pub signature: Option<String>,
    pub platform: String,
    pub arch: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDownloadProgress {
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percent: u8,
    pub phase: String,
    pub message: String,
}

pub fn current_target() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        std::env::consts::OS
    }
}

pub fn current_arch() -> &'static str {
    if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        std::env::consts::ARCH
    }
}

fn ensure_rustls_provider() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

fn build_http_client(timeout_secs: u64, current_version: &str) -> Result<reqwest::Client, String> {
    ensure_rustls_provider();
    let user_agent = format!(
        "FlowSFTP/{} ({}; {})",
        current_version,
        current_target(),
        current_arch()
    );
    reqwest::Client::builder()
        .user_agent(user_agent)
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("Failed to initialize HTTP client: {}", e))
}

pub fn sanitize_version(version: &str) -> String {
    let raw: String = version
        .trim()
        .trim_start_matches(['v', 'V'])
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-' || *c == '_')
        .collect();
    let cleaned = raw
        .split('.')
        .filter(|seg| !seg.is_empty())
        .collect::<Vec<_>>()
        .join(".");
    if cleaned.is_empty() {
        "latest".to_string()
    } else {
        cleaned
    }
}

pub fn validate_download_url(raw_url: &str) -> Result<String, String> {
    let trimmed = raw_url.trim();
    if trimmed.is_empty() {
        return Err("Update download URL is empty".to_string());
    }
    let lower = trimmed.to_lowercase();
    let is_https = lower.starts_with("https://");
    let is_local_dev =
        lower.starts_with("http://localhost") || lower.starts_with("http://127.0.0.1");
    if !is_https && !is_local_dev {
        return Err("Update download URL must use HTTPS".to_string());
    }
    Ok(trimmed.to_string())
}

pub fn sanitize_update_filename(url: &str, version: &str) -> String {
    let without_query = url.split('?').next().unwrap_or(url);
    let raw_name = without_query
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("");

    let safe_name: String = raw_name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-' || *c == '_')
        .collect();

    let safe_name = safe_name.trim_start_matches('.').to_string();
    let lower = safe_name.to_lowercase();
    let has_known_ext = lower.ends_with(".exe")
        || lower.ends_with(".msi")
        || lower.ends_with(".dmg")
        || lower.ends_with(".pkg")
        || lower.ends_with(".appimage")
        || lower.ends_with(".deb")
        || lower.ends_with(".rpm")
        || lower.ends_with(".zip")
        || lower.ends_with(".tar.gz");

    if !safe_name.is_empty() && has_known_ext {
        return safe_name;
    }

    let safe_ver = sanitize_version(version);
    match current_target() {
        "windows" => format!("FlowSFTP-Windows-v{}.exe", safe_ver),
        "darwin" => format!("FlowSFTP-macOS-v{}.dmg", safe_ver),
        _ => format!("FlowSFTP-Linux-v{}.AppImage", safe_ver),
    }
}

fn find_extracted_installer(dir: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut subdirs = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        let name_lower = entry.file_name().to_string_lossy().to_lowercase();

        if path.is_dir() {
            if name_lower.ends_with(".app") {
                return Some(path);
            }
            subdirs.push(path);
            continue;
        }

        if name_lower.ends_with(".exe")
            || name_lower.ends_with(".msi")
            || name_lower.ends_with(".dmg")
            || name_lower.ends_with(".pkg")
            || name_lower.ends_with(".appimage")
            || name_lower.ends_with(".deb")
            || name_lower.ends_with(".rpm")
        {
            return Some(path);
        }
    }

    for sub in subdirs {
        if let Some(found) = find_extracted_installer(&sub) {
            return Some(found);
        }
    }

    None
}

#[tauri::command]
pub async fn app_check_for_updates(app: AppHandle) -> Result<UpdateCheckResult, String> {
    let current_version = app.package_info().version.to_string();
    let target = current_target();
    let arch = current_arch();

    let check_url = format!(
        "{}/{}/{}/{}",
        DEFAULT_UPDATE_BASE_URL, target, arch, current_version
    );

    log::info!("Checking for updates at {}", check_url);

    let client = build_http_client(15, &current_version)?;
    let response = client
        .get(&check_url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Could not reach update server: {}", e))?;

    let status = response.status();
    if status == reqwest::StatusCode::NO_CONTENT {
        return Ok(UpdateCheckResult {
            update_available: false,
            current_version: current_version.clone(),
            latest_version: current_version,
            download_url: None,
            notes: None,
            pub_date: None,
            signature: None,
            platform: target.to_string(),
            arch: arch.to_string(),
        });
    }

    if !status.is_success() {
        return Err(format!(
            "Update server returned HTTP {}",
            status.as_u16()
        ));
    }

    let payload: UpdateServerResponse = response
        .json()
        .await
        .map_err(|e| format!("Invalid update server response: {}", e))?;

    let clean_latest = payload.version.trim().trim_start_matches(['v', 'V']).to_string();

    Ok(UpdateCheckResult {
        update_available: true,
        current_version,
        latest_version: clean_latest,
        download_url: Some(payload.url),
        notes: payload.notes,
        pub_date: payload.pub_date,
        signature: payload.signature,
        platform: target.to_string(),
        arch: arch.to_string(),
    })
}

#[tauri::command]
pub fn app_cancel_update_download() {
    UPDATE_CANCEL_FLAG.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn app_download_and_install_update(
    app: AppHandle,
    download_url: String,
    version: String,
) -> Result<String, String> {
    UPDATE_CANCEL_FLAG.store(false, Ordering::SeqCst);

    let valid_url = validate_download_url(&download_url)?;
    let current_version = app.package_info().version.to_string();
    let safe_version = sanitize_version(&version);
    let filename = sanitize_update_filename(&valid_url, &safe_version);

    let update_dir = std::env::temp_dir().join(format!("flowsftp-update-v{}", safe_version));
    tokio::fs::create_dir_all(&update_dir)
        .await
        .map_err(|e| format!("Failed to create temporary update directory: {}", e))?;

    let final_path = update_dir.join(&filename);
    let part_path = update_dir.join(format!("{}.part", filename));

    let _ = app.emit(
        "app:update-progress",
        UpdateDownloadProgress {
            downloaded_bytes: 0,
            total_bytes: 0,
            percent: 0,
            phase: "downloading".to_string(),
            message: format!("Connecting to download FlowSFTP v{}...", safe_version),
        },
    );

    let client = build_http_client(600, &current_version)?;
    let mut response = client
        .get(&valid_url)
        .send()
        .await
        .map_err(|e| format!("Failed to start update download: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with HTTP status {}",
            response.status().as_u16()
        ));
    }

    let total_bytes = response.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(&part_path)
        .await
        .map_err(|e| format!("Failed to create temporary update file: {}", e))?;

    let mut downloaded_bytes: u64 = 0;
    let mut last_emit = Instant::now();

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Network error while downloading update: {}", e))?
    {
        if UPDATE_CANCEL_FLAG.load(Ordering::SeqCst) {
            drop(file);
            let _ = tokio::fs::remove_file(&part_path).await;
            let _ = app.emit(
                "app:update-progress",
                UpdateDownloadProgress {
                    downloaded_bytes,
                    total_bytes,
                    percent: 0,
                    phase: "cancelled".to_string(),
                    message: "Update download cancelled.".to_string(),
                },
            );
            return Err("Update download cancelled".to_string());
        }

        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed to write update chunk to disk: {}", e))?;

        downloaded_bytes += chunk.len() as u64;

        if last_emit.elapsed() >= Duration::from_millis(45) {
            last_emit = Instant::now();
            let percent = downloaded_bytes
                .saturating_mul(100)
                .checked_div(total_bytes)
                .map(|p| p.min(99) as u8)
                .unwrap_or(0);
            let _ = app.emit(
                "app:update-progress",
                UpdateDownloadProgress {
                    downloaded_bytes,
                    total_bytes,
                    percent,
                    phase: "downloading".to_string(),
                    message: format!("Downloading FlowSFTP v{}...", safe_version),
                },
            );
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("Failed to flush downloaded update file: {}", e))?;
    drop(file);

    if final_path.exists() {
        let _ = tokio::fs::remove_file(&final_path).await;
    }
    tokio::fs::rename(&part_path, &final_path)
        .await
        .map_err(|e| format!("Failed to finalize update file: {}", e))?;

    let mut installer_path = final_path.clone();
    let lower_name = filename.to_lowercase();

    // If the downloaded file is a compressed bundle (.zip or .tar.gz), extract it first
    if lower_name.ends_with(".zip") || lower_name.ends_with(".tar.gz") {
        let _ = app.emit(
            "app:update-progress",
            UpdateDownloadProgress {
                downloaded_bytes,
                total_bytes: downloaded_bytes,
                percent: 99,
                phase: "extracting".to_string(),
                message: "Extracting update package...".to_string(),
            },
        );

        let extract_dir = update_dir.join("extracted");
        let _ = tokio::fs::remove_dir_all(&extract_dir).await;
        tokio::fs::create_dir_all(&extract_dir)
            .await
            .map_err(|e| format!("Failed to create extraction directory: {}", e))?;

        let archive_str = final_path.to_string_lossy().to_string();
        let target_str = extract_dir.to_string_lossy().to_string();
        crate::sftp::extract_local_archive(&archive_str, &target_str).await?;

        if let Some(found) = find_extracted_installer(&extract_dir) {
            installer_path = found;
        }
    }

    let _ = app.emit(
        "app:update-progress",
        UpdateDownloadProgress {
            downloaded_bytes,
            total_bytes: downloaded_bytes,
            percent: 100,
            phase: "installing".to_string(),
            message: "Launching installer and restarting FlowSFTP...".to_string(),
        },
    );

    launch_installer_and_schedule_exit(&app, &installer_path)?;

    Ok(installer_path.to_string_lossy().to_string())
}

fn launch_installer_and_schedule_exit(app: &AppHandle, installer_path: &Path) -> Result<(), String> {
    let ext_lower = installer_path
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    #[cfg(target_os = "windows")]
    {
        if ext_lower.ends_with(".msi") {
            std::process::Command::new("msiexec")
                .arg("/i")
                .arg(installer_path)
                .spawn()
                .map_err(|e| format!("Failed to launch MSI installer: {}", e))?;
        } else {
            std::process::Command::new(installer_path)
                .spawn()
                .map_err(|e| format!("Failed to launch update installer: {}", e))?;
        }

        let app_clone = app.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(650)).await;
            app_clone.exit(0);
        });
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(installer_path)
            .spawn()
            .map_err(|e| format!("Failed to open macOS update package: {}", e))?;

        if ext_lower.ends_with(".pkg") || ext_lower.ends_with(".app") {
            let app_clone = app.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(650)).await;
                app_clone.exit(0);
            });
        }
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::PermissionsExt;

        if ext_lower.ends_with(".appimage") {
            if let Ok(meta) = std::fs::metadata(installer_path) {
                let mut perms = meta.permissions();
                perms.set_mode(0o755);
                let _ = std::fs::set_permissions(installer_path, perms);
            }

            // If currently running inside an AppImage, replace it in-place and relaunch
            if let Ok(current_appimage) = std::env::var("APPIMAGE") {
                let target_appimage = PathBuf::from(&current_appimage);
                if target_appimage.exists() && std::fs::copy(installer_path, &target_appimage).is_ok() {
                    if let Ok(meta) = std::fs::metadata(&target_appimage) {
                        let mut perms = meta.permissions();
                        perms.set_mode(0o755);
                        let _ = std::fs::set_permissions(&target_appimage, perms);
                    }
                    let _ = std::process::Command::new(&target_appimage).spawn();
                    let app_clone = app.clone();
                    tokio::spawn(async move {
                        tokio::time::sleep(Duration::from_millis(650)).await;
                        app_clone.exit(0);
                    });
                    return Ok(());
                }
            }

            std::process::Command::new(installer_path)
                .spawn()
                .map_err(|e| format!("Failed to launch updated AppImage: {}", e))?;

            let app_clone = app.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(650)).await;
                app_clone.exit(0);
            });
            return Ok(());
        }

        // For .deb / .rpm packages, open with xdg-open
        std::process::Command::new("xdg-open")
            .arg(installer_path)
            .spawn()
            .map_err(|e| format!("Failed to open Linux package installer: {}", e))?;

        return Ok(());
    }

    #[allow(unreachable_code)]
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_version() {
        assert_eq!(sanitize_version("v0.9.2-beta.1"), "0.9.2-beta.1");
        assert_eq!(sanitize_version("1.0.0"), "1.0.0");
        assert_eq!(sanitize_version("  V2.1.0../../ "), "2.1.0");
        assert_eq!(sanitize_version("///"), "latest");
    }

    #[test]
    fn test_validate_download_url() {
        assert!(validate_download_url("https://flowsftp.com/storage/releases/FlowSFTP.exe").is_ok());
        assert!(validate_download_url("http://localhost:8000/storage/FlowSFTP.exe").is_ok());
        assert!(validate_download_url("http://flowsftp.com/storage/FlowSFTP.exe").is_err());
        assert!(validate_download_url("ftp://flowsftp.com/FlowSFTP.exe").is_err());
        assert!(validate_download_url("").is_err());
    }

    #[test]
    fn test_sanitize_update_filename() {
        assert_eq!(
            sanitize_update_filename(
                "https://flowsftp.com/storage/releases/FlowSFTP-Windows-x64-v0.9.2.exe?token=abc",
                "0.9.2"
            ),
            "FlowSFTP-Windows-x64-v0.9.2.exe"
        );
        assert_eq!(
            sanitize_update_filename(
                "https://flowsftp.com/storage/releases/FlowSFTP-1.2.0.AppImage.tar.gz",
                "1.2.0"
            ),
            "FlowSFTP-1.2.0.AppImage.tar.gz"
        );
        let fallback = sanitize_update_filename("https://flowsftp.com/download/latest", "0.9.5");
        assert!(fallback.contains("0.9.5"));
    }

    #[test]
    fn test_current_target_and_arch() {
        let target = current_target();
        assert!(["windows", "darwin", "linux"].contains(&target));
        let arch = current_arch();
        assert!(!arch.is_empty());
    }
}

