pub mod external_edit;
pub mod dir_watcher;
pub mod search;

use russh_sftp::client::SftpSession;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{Instant, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub fn now_epoch_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SftpFileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    #[serde(default)]
    pub symlink_target: Option<String>,
    pub size: u64,
    pub modified: u64,
    pub permissions: u32,
    pub owner: Option<String>,
    pub group: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalFileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    #[serde(default)]
    pub symlink_target: Option<String>,
    pub size: u64,
    pub modified: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferProgress {
    pub transfer_id: String,
    pub file_name: String,
    pub direction: String, // "upload" | "download"
    pub bytes_transferred: u64,
    pub total_bytes: u64,
    pub speed_bytes_per_sec: u64,
    pub is_complete: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileConflictInfo {
    pub exists: bool,
    pub size: u64,
    pub modified: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalCrawlTask {
    pub local_path: String,
    pub remote_path: String,
    pub file_name: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalCrawlDirectory {
    pub local_path: String,
    pub remote_path: String,
    pub dir_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalCrawlIgnored {
    pub local_path: String,
    pub remote_path: String,
    pub item_name: String,
    pub is_dir: bool,
    pub matched_pattern: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalCrawlResult {
    pub files: Vec<LocalCrawlTask>,
    pub directories: Vec<LocalCrawlDirectory>,
    pub ignored: Vec<LocalCrawlIgnored>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteCrawlTask {
    pub remote_path: String,
    pub local_path: String,
    pub file_name: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrawlProgressPayload {
    pub scan_type: String,
    pub files: usize,
    pub directories: usize,
}

pub fn get_matching_ignore_pattern(name: &str, rel_or_full_path: &str, patterns: &[String]) -> Option<String> {
    if patterns.is_empty() {
        return None;
    }
    let norm_path = rel_or_full_path.replace('\\', "/");
    let name_lower = name.to_lowercase();
    let norm_path_lower = norm_path.to_lowercase();

    // Only check relative subpath parts (ignore Windows drive letters or absolute prefixes)
    let clean_rel = if norm_path_lower.contains(':') {
        norm_path_lower.split('/').last().unwrap_or("").to_string()
    } else {
        norm_path_lower.trim_start_matches('/').to_string()
    };
    let parts: Vec<&str> = clean_rel.split('/').filter(|s| !s.is_empty()).collect();

    for raw_pat in patterns {
        let pat = raw_pat.trim().trim_start_matches('/').to_lowercase();
        if pat.is_empty() {
            continue;
        }

        // Exact match with name or any segment of the relative path (e.g. "node_modules", ".git")
        if name_lower == pat || parts.iter().any(|&p| p == pat) {
            return Some(raw_pat.clone());
        }

        // Match path boundary within clean relative path
        if clean_rel == pat
            || clean_rel.starts_with(&format!("{}/", pat))
            || clean_rel.ends_with(&format!("/{}", pat))
            || clean_rel.contains(&format!("/{}/", pat))
        {
            return Some(raw_pat.clone());
        }

        // Wildcard extension match (e.g. "*.log", "*.swp", "*.tmp", "*.bak")
        if pat.starts_with("*.") {
            let ext = &pat[1..];
            if name_lower.ends_with(ext) || clean_rel.ends_with(ext) {
                return Some(raw_pat.clone());
            }
        } else if pat.starts_with('*') {
            let suffix = &pat[1..];
            if name_lower.ends_with(suffix) || clean_rel.ends_with(suffix) {
                return Some(raw_pat.clone());
            }
        } else if pat.ends_with('*') {
            let prefix = &pat[..pat.len() - 1];
            if name_lower.starts_with(prefix) || clean_rel.starts_with(prefix) {
                return Some(raw_pat.clone());
            }
        }
    }

    None
}

pub fn is_path_ignored(name: &str, rel_or_full_path: &str, patterns: &[String]) -> bool {
    get_matching_ignore_pattern(name, rel_or_full_path, patterns).is_some()
}

// -------------------------------------------------------------
// Remote SFTP Operations
// -------------------------------------------------------------

pub async fn list_remote_dir(sftp: &SftpSession, dir_path: &str) -> Result<(String, Vec<SftpFileEntry>), String> {
    let clean_path = if dir_path.trim().is_empty() { "." } else { dir_path.trim() };

    // Canonicalize to resolve relative paths like "." and "..", skipping redundant network call if already absolute
    let canonical = if clean_path.starts_with('/') && !clean_path.contains("/.") && !clean_path.ends_with("/..") {
        clean_path.to_string()
    } else {
        match tokio::time::timeout(std::time::Duration::from_secs(5), sftp.canonicalize(clean_path)).await {
            Ok(Ok(c)) if !c.is_empty() => c,
            _ => clean_path.to_string(),
        }
    };

    let target_dir = if canonical.is_empty() { clean_path } else { &canonical };

    let entries = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        sftp.read_dir(target_dir),
    )
    .await
    .map_err(|_| format!("Listing remote directory '{}' timed out after 15s", target_dir))?
    .map_err(|e| format!("Failed to read remote directory '{}': {}", target_dir, e))?;

    let mut result = Vec::new();
    for entry in entries {
        let file_name = entry.file_name();
        if file_name == "." || file_name == ".." {
            continue;
        }

        let file_type = entry.file_type();
        let metadata = entry.metadata();
        let is_dir = file_type.is_dir();
        let is_symlink = file_type.is_symlink();
        let size = metadata.size.unwrap_or(0);
        let modified = metadata.mtime.unwrap_or(0) as u64;
        let permissions = metadata.permissions.unwrap_or(0);
        let owner = metadata.uid.map(|u| if u == 0 { "root".to_string() } else { u.to_string() });
        let group = metadata.gid.map(|g| if g == 0 { "root".to_string() } else { g.to_string() });

        let full_path = if target_dir.ends_with('/') {
            format!("{}{}", target_dir, file_name)
        } else {
            format!("{}/{}", target_dir, file_name)
        };

        let symlink_target = if is_symlink {
            sftp.read_link(&full_path).await.ok()
        } else {
            None
        };

        result.push(SftpFileEntry {
            name: file_name,
            path: full_path,
            is_dir,
            is_symlink,
            symlink_target,
            size,
            modified,
            permissions,
            owner,
            group,
        });
    }

    result.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok((canonical, result))
}

pub async fn create_remote_dir(sftp: &SftpSession, path: &str) -> Result<(), String> {
    sftp.create_dir(path)
        .await
        .map_err(|e| format!("Failed to create remote directory '{}': {}", path, e))
}

pub async fn ensure_remote_dir_recursive(sftp: &SftpSession, path: &str) -> Result<(), String> {
    let clean = path.trim().replace('\\', "/");
    let clean_path = clean.trim_end_matches('/');
    if clean_path.is_empty() || clean_path == "/" {
        return Ok(());
    }

    // Fast-path: try creating the target directory directly (1 network roundtrip)
    if sftp.create_dir(clean_path).await.is_ok() {
        return Ok(());
    }

    let segments: Vec<&str> = clean_path.split('/').filter(|s| !s.is_empty()).collect();
    if segments.is_empty() {
        return Ok(());
    }

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

        let _ = sftp.create_dir(&current).await;
    }

    Ok(())
}

pub async fn batch_create_remote_dirs(sftp: &SftpSession, paths: Vec<String>) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }

    // Sort paths by length so shallower directories are created before deeper ones
    let mut sorted_paths = paths;
    sorted_paths.sort_by_key(|p| p.len());

    let mut created: std::collections::HashSet<String> = std::collections::HashSet::new();

    for raw_path in sorted_paths {
        let clean = raw_path.trim().replace('\\', "/");
        let clean_path = clean.trim_end_matches('/').to_string();
        if clean_path.is_empty() || clean_path == "/" || created.contains(&clean_path) {
            continue;
        }

        // Try direct creation first (fast path: only 1 network roundtrip)
        if sftp.create_dir(&clean_path).await.is_ok() {
            created.insert(clean_path);
            continue;
        }

        // If direct creation failed (e.g. parent missing), create ancestors
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

            let _ = sftp.create_dir(&current).await;
            created.insert(current.clone());
        }
    }

    Ok(())
}

pub async fn create_remote_file(sftp: &SftpSession, path: &str, overwrite: Option<bool>) -> Result<(), String> {
    if !overwrite.unwrap_or(false) {
        if sftp.metadata(path).await.is_ok() {
            return Err(format!("File '{}' already exists on remote server", path));
        }
    }
    sftp.create(path)
        .await
        .map(|_| ())
        .map_err(|e| format!("Failed to create remote file '{}': {}", path, e))
}

pub async fn remove_remote_dir(sftp: &SftpSession, path: &str) -> Result<(), String> {
    remove_remote_dir_recursive(sftp, path).await
}

pub async fn remove_remote_dir_recursive(sftp: &SftpSession, path: &str) -> Result<(), String> {
    remove_remote_dir_recursive_with_cancel(sftp, path, &crate::state::AppState::default(), None).await
}

pub async fn remove_remote_dir_recursive_with_cancel(
    sftp: &SftpSession,
    path: &str,
    state: &crate::state::AppState,
    deletion_id: Option<&str>,
) -> Result<(), String> {
    let clean = path.trim().replace('\\', "/");
    let clean_path = clean.trim_end_matches('/');
    if clean_path.is_empty() || clean_path == "/" || clean_path == "." || clean_path == ".." {
        return Err("Cannot delete root or special directory".to_string());
    }

    if let Some(id) = deletion_id {
        if state.is_deletion_cancelled(id) {
            return Err("Deletion cancelled by user".to_string());
        }
    }

    // 1. Try direct rmdir first (fast for empty directories)
    if let Ok(Ok(())) = tokio::time::timeout(std::time::Duration::from_secs(5), sftp.remove_dir(clean_path)).await {
        return Ok(());
    }

    if let Some(id) = deletion_id {
        if state.is_deletion_cancelled(id) {
            return Err("Deletion cancelled by user".to_string());
        }
    }

    // 2. Read entries inside the directory to delete them recursively
    let entries = match tokio::time::timeout(std::time::Duration::from_secs(10), sftp.read_dir(clean_path)).await {
        Ok(Ok(e)) => e,
        Ok(Err(e)) => {
            log::warn!("Failed to read remote directory '{}': {}", clean_path, e);
            return tokio::time::timeout(std::time::Duration::from_secs(10), sftp.remove_dir(clean_path))
                .await
                .map_err(|_| format!("Timed out removing remote directory '{}'", clean_path))?
                .map_err(|e2| {
                    format!("Failed to remove remote directory '{}': {} (read error: {})", clean_path, e2, e)
                });
        }
        Err(_) => {
            return Err(format!("Timed out reading remote directory '{}'", clean_path));
        }
    };

    for entry in entries {
        if let Some(id) = deletion_id {
            if state.is_deletion_cancelled(id) {
                return Err("Deletion cancelled by user".to_string());
            }
        }

        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }

        let child_path = format!("{}/{}", clean_path, name);

        if entry.file_type().is_dir() {
            Box::pin(remove_remote_dir_recursive_with_cancel(sftp, &child_path, state, deletion_id)).await?;
        } else {
            let res = tokio::time::timeout(std::time::Duration::from_secs(10), sftp.remove_file(&child_path)).await;
            if res.is_err() || matches!(res, Ok(Err(_))) {
                Box::pin(remove_remote_dir_recursive_with_cancel(sftp, &child_path, state, deletion_id)).await?;
            }
        }
    }

    if let Some(id) = deletion_id {
        if state.is_deletion_cancelled(id) {
            return Err("Deletion cancelled by user".to_string());
        }
    }

    // 3. Directory should now be empty; remove it
    tokio::time::timeout(std::time::Duration::from_secs(10), sftp.remove_dir(clean_path))
        .await
        .map_err(|_| format!("Timed out removing remote directory '{}'", clean_path))?
        .map_err(|e| format!("Failed to remove remote directory '{}': {}", clean_path, e))
}

pub async fn remove_remote_file(sftp: &SftpSession, path: &str) -> Result<(), String> {
    let clean = path.trim().replace('\\', "/");
    tokio::time::timeout(tokio::time::Duration::from_secs(15), sftp.remove_file(&clean))
        .await
        .map_err(|_| format!("Timed out after 15s removing remote file '{}'", clean))?
        .map_err(|e| format!("Failed to remove remote file '{}': {}", clean, e))
}

pub async fn rename_remote(sftp: &SftpSession, old_path: &str, new_path: &str) -> Result<(), String> {
    sftp.rename(old_path, new_path)
        .await
        .map_err(|e| format!("Failed to rename remote item: {}", e))
}

pub async fn canonicalize_remote(sftp: &SftpSession, path: &str) -> Result<String, String> {
    let clean = if path.trim().is_empty() { "." } else { path.trim() };
    if clean.starts_with('/') && !clean.contains("/.") && !clean.ends_with("/..") {
        return Ok(clean.to_string());
    }
    match tokio::time::timeout(std::time::Duration::from_secs(5), sftp.canonicalize(clean)).await {
        Ok(Ok(canonical)) if !canonical.is_empty() => Ok(canonical),
        _ => Ok(clean.to_string()),
    }
}

pub async fn set_remote_permissions(
    sftp: &SftpSession,
    path: &str,
    permissions: u32,
    recursive: bool,
    target_type: Option<&str>,
) -> Result<(), String> {
    if !recursive {
        let mut attrs = russh_sftp::protocol::FileAttributes::default();
        attrs.permissions = Some(permissions);
        sftp.set_metadata(path, attrs)
            .await
            .map_err(|e| format!("Failed to set permissions on '{}': {}", path, e))?;
        return Ok(());
    }

    // Recursive chmod
    let mut stack = vec![path.to_string()];
    let target = target_type.unwrap_or("all");

    while let Some(current_path) = stack.pop() {
        let meta = sftp.metadata(&current_path).await.ok();
        let is_dir = meta.as_ref().map(|m| {
            // Check if POSIX directory bit (0o040000) or check read_dir
            m.permissions.map(|p| (p & 0o170000) == 0o040000).unwrap_or(false)
        }).unwrap_or(false);

        let should_apply = match target {
            "dirs" => is_dir,
            "files" => !is_dir,
            _ => true,
        };

        if should_apply {
            let mut attrs = russh_sftp::protocol::FileAttributes::default();
            attrs.permissions = Some(permissions);
            let _ = sftp.set_metadata(&current_path, attrs).await;
        }

        // Try reading as directory
        if let Ok(entries) = sftp.read_dir(&current_path).await {
            for entry in entries {
                let name = entry.file_name();
                if name != "." && name != ".." {
                    let sub_path = if current_path.ends_with('/') {
                        format!("{}{}", current_path, name)
                    } else {
                        format!("{}/{}", current_path, name)
                    };
                    stack.push(sub_path);
                }
            }
        }
    }

    Ok(())
}

pub async fn read_remote_file_text(sftp: &SftpSession, path: &str) -> Result<String, String> {
    let mut file = sftp
        .open(path)
        .await
        .map_err(|e| format!("Failed to open remote file '{}': {}", path, e))?;

    let mut buf = Vec::new();
    // Safety limit: 10 MB
    let mut take = (&mut file).take(10 * 1024 * 1024);
    take.read_to_end(&mut buf)
        .await
        .map_err(|e| format!("Failed to read remote file: {}", e))?;

    match String::from_utf8(buf) {
        Ok(s) => Ok(s),
        Err(e) => Ok(String::from_utf8_lossy(e.as_bytes()).to_string()),
    }
}

pub async fn write_remote_file_binary(sftp: &SftpSession, path: &str, data: &[u8]) -> Result<(), String> {
    let mut file = sftp
        .create(path)
        .await
        .map_err(|e| format!("Failed to create/open remote file '{}': {}", path, e))?;

    file.write_all(data)
        .await
        .map_err(|e| format!("Failed to write content to remote file: {}", e))?;
    file.flush()
        .await
        .map_err(|e| format!("Failed to flush remote file: {}", e))?;
    let _ = file.shutdown().await;

    Ok(())
}

pub async fn write_remote_file_text(sftp: &SftpSession, path: &str, content: &str) -> Result<(), String> {
    write_remote_file_binary(sftp, path, content.as_bytes()).await
}

pub async fn read_local_file_text(path: &str) -> Result<String, String> {
    let (native, _) = normalize_to_native_path(path);
    tokio::fs::read_to_string(&native)
        .await
        .map_err(|e| format!("Failed to read local file: {}", e))
}

pub async fn write_local_file_text(path: &str, content: &str) -> Result<(), String> {
    let (native, _) = normalize_to_native_path(path);
    tokio::fs::write(&native, content)
        .await
        .map_err(|e| format!("Failed to write local file: {}", e))
}

pub async fn read_remote_file_binary(sftp: &SftpSession, path: &str) -> Result<Vec<u8>, String> {
    let mut file = sftp
        .open(path)
        .await
        .map_err(|e| format!("Failed to open remote file '{}': {}", path, e))?;

    let mut buf = Vec::new();
    let mut take = (&mut file).take(25 * 1024 * 1024);
    take.read_to_end(&mut buf)
        .await
        .map_err(|e| format!("Failed to read remote file: {}", e))?;

    Ok(buf)
}

pub async fn read_local_file_binary(path: &str) -> Result<Vec<u8>, String> {
    let (native, _) = normalize_to_native_path(path);
    let mut file = tokio::fs::File::open(&native)
        .await
        .map_err(|e| format!("Failed to open local file: {}", e))?;

    let mut buf = Vec::new();
    let mut take = (&mut file).take(25 * 1024 * 1024);
    take.read_to_end(&mut buf)
        .await
        .map_err(|e| format!("Failed to read local file: {}", e))?;

    Ok(buf)
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
pub struct GitRepoStatus {
    pub is_repo: bool,
    pub root: Option<String>,
    pub branch: Option<String>,
    pub files: std::collections::HashMap<String, String>,
}

pub async fn get_git_status(path: &str) -> Result<GitRepoStatus, String> {
    let (native, _) = normalize_to_native_path(path);
    if !native.exists() {
        return Ok(GitRepoStatus::default());
    }

    let dir = if native.is_dir() {
        native
    } else {
        native.parent().unwrap_or(&native).to_path_buf()
    };

    let root_out = match tokio::process::Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(&dir)
        .output()
        .await
    {
        Ok(out) if out.status.success() => out,
        _ => return Ok(GitRepoStatus::default()),
    };

    let root_raw = String::from_utf8_lossy(&root_out.stdout).trim().replace('\\', "/");
    let root_clean = root_raw.trim_end_matches('/').to_string();

    let branch_out = tokio::process::Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(&dir)
        .output()
        .await;

    let branch = match branch_out {
        Ok(bo) if bo.status.success() => {
            let b = String::from_utf8_lossy(&bo.stdout).trim().to_string();
            if b.is_empty() {
                let head_out = tokio::process::Command::new("git")
                    .args(["rev-parse", "--short", "HEAD"])
                    .current_dir(&dir)
                    .output()
                    .await;
                head_out.ok().and_then(|h| {
                    if h.status.success() {
                        Some(String::from_utf8_lossy(&h.stdout).trim().to_string())
                    } else {
                        None
                    }
                })
            } else {
                Some(b)
            }
        }
        _ => None,
    };

    let mut files = std::collections::HashMap::new();
    let status_out = tokio::process::Command::new("git")
        .args(["status", "--porcelain=v1", "-uall"])
        .current_dir(&dir)
        .output()
        .await;

    if let Ok(so) = status_out {
        if so.status.success() {
            let text = String::from_utf8_lossy(&so.stdout);
            for line in text.lines() {
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
                let abs_path = format!("{}/{}", root_clean, norm_path);
                files.insert(abs_path, status_type.to_string());
                if let Some(fname) = norm_path.split('/').last() {
                    files.entry(fname.to_string()).or_insert_with(|| status_type.to_string());
                }
            }
        }
    }

    Ok(GitRepoStatus {
        is_repo: true,
        root: Some(root_clean),
        branch,
        files,
    })
}


pub async fn open_in_default_app(path: &str) -> Result<(), String> {
    let (native, _) = normalize_to_native_path(path);
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &native.to_string_lossy()])
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&native)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&native)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }
    Ok(())
}

// -------------------------------------------------------------
// Streaming Transfers (Upload & Download with Progress Events)
// -------------------------------------------------------------

pub async fn download_file(
    app: AppHandle,
    sftp: &SftpSession,
    transfer_id: String,
    remote_path: String,
    local_path: String,
    conflict_action: Option<String>,
    file_size: Option<u64>,
) -> Result<(), String> {
    log::info!(
        "[download_file] Started: remote='{}' -> local='{}' (transfer_id='{}', conflict='{:?}', size='{:?}')",
        remote_path, local_path, transfer_id, conflict_action, file_size
    );

    let file_name = Path::new(&remote_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());

    // 1. Get remote file size (fast-path: if known, skip network roundtrip stat)
    let total_bytes = match file_size {
        Some(s) if s > 0 => s,
        _ => sftp.metadata(&remote_path).await.ok().and_then(|m| m.size).unwrap_or(0),
    };

    let (native_local, _) = normalize_to_native_path(&local_path);

    let conflict = conflict_action.as_deref().unwrap_or("overwrite");
    if conflict == "skip" && native_local.exists() {
        log::info!("[download_file] Skipping existing local file: '{}'", local_path);
        let event_name = format!("sftp:progress:{}", transfer_id);
        let _ = app.emit(
            &event_name,
            TransferProgress {
                transfer_id,
                file_name,
                direction: "download".to_string(),
                bytes_transferred: total_bytes,
                total_bytes,
                speed_bytes_per_sec: 0,
                is_complete: true,
                error: Some("Skipped (file exists)".to_string()),
            },
        );
        return Ok(());
    }

    // 2. Open remote file
    let mut remote_file = sftp
        .open(&remote_path)
        .await
        .map_err(|e| {
            let msg = format!("Failed to open remote file '{}': {}", remote_path, e);
            log::error!("[download_file] {}", msg);
            msg
        })?;

    // 3. Create parent local directories if needed
    if let Some(parent) = native_local.parent() {
        if let Err(e) = fs::create_dir_all(parent).await {
            log::warn!("[download_file] Warning creating parent dir '{:?}': {}", parent, e);
        }
    }

    // 4. Create local file
    let mut local_file = fs::File::create(&native_local)
        .await
        .map_err(|e| {
            let msg = format!("Failed to create local file '{}': {}", local_path, e);
            log::error!("[download_file] {}", msg);
            msg
        })?;

    let event_name = format!("sftp:progress:{}", transfer_id);
    let buf_size = if total_bytes > 0 && total_bytes < 64 * 1024 {
        (total_bytes as usize).max(4096)
    } else {
        64 * 1024
    };
    let mut buffer = vec![0u8; buf_size];
    let mut transferred: u64 = 0;
    let start_time = Instant::now();
    let mut last_emit = Instant::now();

    // For larger files (> 128 KB), emit initial 0% progress so UI displays active status.
    // For small files that complete in milliseconds, skip this to cut IPC overhead in half.
    if total_bytes > 128 * 1024 {
        let _ = app.emit(
            &event_name,
            TransferProgress {
                transfer_id: transfer_id.clone(),
                file_name: file_name.clone(),
                direction: "download".to_string(),
                bytes_transferred: 0,
                total_bytes,
                speed_bytes_per_sec: 0,
                is_complete: false,
                error: None,
            },
        );
    }

    let state = app.state::<crate::state::AppState>();
    loop {
        if state.is_transfer_cancelled(&transfer_id) {
            let err_msg = "Transfer cancelled by user".to_string();
            log::info!("[download_file] Cancelled by user: transfer_id='{}'", transfer_id);
            let _ = app.emit(
                &event_name,
                TransferProgress {
                    transfer_id: transfer_id.clone(),
                    file_name: file_name.clone(),
                    direction: "download".to_string(),
                    bytes_transferred: transferred,
                    total_bytes,
                    speed_bytes_per_sec: 0,
                    is_complete: true,
                    error: Some(err_msg.clone()),
                },
            );
            return Err(err_msg);
        }

        let bytes_read = match remote_file.read(&mut buffer).await {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                let err_msg = format!("Read error during download: {}", e);
                log::error!("[download_file] {}", err_msg);
                let _ = app.emit(
                    &event_name,
                    TransferProgress {
                        transfer_id: transfer_id.clone(),
                        file_name: file_name.clone(),
                        direction: "download".to_string(),
                        bytes_transferred: transferred,
                        total_bytes,
                        speed_bytes_per_sec: 0,
                        is_complete: true,
                        error: Some(err_msg.clone()),
                    },
                );
                return Err(err_msg);
            }
        };

        if let Err(e) = local_file.write_all(&buffer[..bytes_read]).await {
            let err_msg = format!("Write error during download: {}", e);
            log::error!("[download_file] {}", err_msg);
            let _ = app.emit(
                &event_name,
                TransferProgress {
                    transfer_id: transfer_id.clone(),
                    file_name: file_name.clone(),
                    direction: "download".to_string(),
                    bytes_transferred: transferred,
                    total_bytes,
                    speed_bytes_per_sec: 0,
                    is_complete: true,
                    error: Some(err_msg.clone()),
                },
            );
            return Err(err_msg);
        }

        transferred += bytes_read as u64;

        // Emit progress every ~100ms
        if last_emit.elapsed().as_millis() >= 100 {
            let elapsed_secs = start_time.elapsed().as_secs_f64();
            let speed = if elapsed_secs > 0.0 {
                (transferred as f64 / elapsed_secs) as u64
            } else {
                0
            };

            let _ = app.emit(
                &event_name,
                TransferProgress {
                    transfer_id: transfer_id.clone(),
                    file_name: file_name.clone(),
                    direction: "download".to_string(),
                    bytes_transferred: transferred,
                    total_bytes,
                    speed_bytes_per_sec: speed,
                    is_complete: false,
                    error: None,
                },
            );
            last_emit = Instant::now();
        }
    }

    // Flush and complete
    let _ = local_file.flush().await;
    drop(local_file);

    // Preserve remote modification timestamp on downloaded local file
    if let Ok(meta) = sftp.metadata(&remote_path).await {
        if let Some(mtime) = meta.mtime {
            let ft = filetime::FileTime::from_unix_time(mtime as i64, 0);
            let _ = filetime::set_file_mtime(&native_local, ft);
        }
    }

    log::info!(
        "[download_file] Finished successfully: '{}' ({} bytes)",
        remote_path, transferred
    );

    let _ = app.emit(
        &event_name,
        TransferProgress {
            transfer_id,
            file_name,
            direction: "download".to_string(),
            bytes_transferred: transferred,
            total_bytes: transferred,
            speed_bytes_per_sec: 0,
            is_complete: true,
            error: None,
        },
    );

    Ok(())
}

pub async fn upload_file(
    app: AppHandle,
    sftp: &SftpSession,
    transfer_id: String,
    local_path: String,
    remote_path: String,
    conflict_action: Option<String>,
    file_size: Option<u64>,
) -> Result<(), String> {
    log::info!(
        "[upload_file] Started: local='{}' -> remote='{}' (transfer_id='{}', conflict='{:?}', size='{:?}')",
        local_path, remote_path, transfer_id, conflict_action, file_size
    );

    let (native_local, _) = normalize_to_native_path(&local_path);
    let file_name = native_local
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());

    // 1. Get local file metadata
    let total_bytes = match file_size {
        Some(s) if s > 0 => s,
        _ => {
            let local_meta = fs::metadata(&native_local).await.map_err(|e| {
                let msg = format!("Failed to read local file metadata for '{}': {}", local_path, e);
                log::error!("[upload_file] {}", msg);
                msg
            })?;
            local_meta.len()
        }
    };

    let conflict = conflict_action.as_deref().unwrap_or("overwrite");
    if conflict == "skip" && sftp.metadata(&remote_path).await.is_ok() {
        log::info!("[upload_file] Skipping existing remote file: '{}'", remote_path);
        let event_name = format!("sftp:progress:{}", transfer_id);
        let _ = app.emit(
            &event_name,
            TransferProgress {
                transfer_id,
                file_name,
                direction: "upload".to_string(),
                bytes_transferred: total_bytes,
                total_bytes,
                speed_bytes_per_sec: 0,
                is_complete: true,
                error: Some("Skipped (file exists)".to_string()),
            },
        );
        return Ok(());
    }

    // 2. Open local file
    let mut local_file = fs::File::open(&native_local)
        .await
        .map_err(|e| {
            let msg = format!("Failed to open local file '{}': {}", local_path, e);
            log::error!("[upload_file] {}", msg);
            msg
        })?;

    // 3. Create remote file (with automatic parent directory creation if missing)
    let mut remote_file = match sftp.create(&remote_path).await {
        Ok(f) => f,
        Err(create_err) => {
            if let Some(parent) = std::path::Path::new(&remote_path).parent() {
                let parent_str = parent.to_string_lossy().replace('\\', "/");
                if !parent_str.is_empty() && parent_str != "/" && parent_str != "." {
                    let _ = ensure_remote_dir_recursive(sftp, &parent_str).await;
                }
            }
            sftp.create(&remote_path).await.map_err(|e| {
                let msg = format!("Failed to create remote file '{}' (initial error: {}): {}", remote_path, create_err, e);
                log::error!("[upload_file] {}", msg);
                msg
            })?
        }
    };

    let event_name = format!("sftp:progress:{}", transfer_id);
    let buf_size = if total_bytes > 0 && total_bytes < 64 * 1024 {
        (total_bytes as usize).max(4096)
    } else {
        64 * 1024
    };
    let mut buffer = vec![0u8; buf_size];
    let mut transferred: u64 = 0;
    let start_time = Instant::now();
    let mut last_emit = Instant::now();

    // For larger files (> 128 KB), emit initial 0% progress so UI displays active status.
    // For small files that complete in milliseconds, skip this to cut IPC overhead in half.
    if total_bytes > 128 * 1024 {
        let _ = app.emit(
            &event_name,
            TransferProgress {
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
    }

    let state = app.state::<crate::state::AppState>();
    loop {
        if state.is_transfer_cancelled(&transfer_id) {
            let err_msg = "Transfer cancelled by user".to_string();
            log::info!("[upload_file] Cancelled by user: transfer_id='{}'", transfer_id);
            let _ = app.emit(
                &event_name,
                TransferProgress {
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

        let bytes_read = match local_file.read(&mut buffer).await {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                let err_msg = format!("Read error during upload: {}", e);
                log::error!("[upload_file] {}", err_msg);
                let _ = app.emit(
                    &event_name,
                    TransferProgress {
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
        };

        if let Err(e) = remote_file.write_all(&buffer[..bytes_read]).await {
            let err_msg = format!("Write error during upload: {}", e);
            log::error!("[upload_file] {}", err_msg);
            let _ = app.emit(
                &event_name,
                TransferProgress {
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
                TransferProgress {
                    transfer_id: transfer_id.clone(),
                    file_name: file_name.clone(),
                    direction: "upload".to_string(),
                    bytes_transferred: transferred,
                    total_bytes,
                    speed_bytes_per_sec: speed,
                    is_complete: false,
                    error: None,
                },
            );
            last_emit = Instant::now();
        }
    }

    let _ = remote_file.flush().await;
    drop(remote_file);

    // Preserve local modification timestamp on uploaded remote file
    if let Ok(meta) = fs::metadata(&native_local).await {
        if let Ok(mtime) = meta.modified() {
            if let Ok(duration) = mtime.duration_since(UNIX_EPOCH) {
                let mut attrs = russh_sftp::protocol::FileAttributes::default();
                attrs.mtime = Some(duration.as_secs() as u32);
                let _ = sftp.set_metadata(&remote_path, attrs).await;
            }
        }
    }

    log::info!(
        "[upload_file] Finished successfully: '{}' ({} bytes)",
        remote_path, transferred
    );

    let _ = app.emit(
        &event_name,
        TransferProgress {
            transfer_id,
            file_name,
            direction: "upload".to_string(),
            bytes_transferred: transferred,
            total_bytes: transferred,
            speed_bytes_per_sec: 0,
            is_complete: true,
            error: None,
        },
    );

    Ok(())
}

// -------------------------------------------------------------
// Local Filesystem Operations (Dual-Pane Browser)
// -------------------------------------------------------------

pub fn get_default_local_path() -> String {
    dirs::home_dir()
        .map(|p| clean_local_path(&p))
        .unwrap_or_else(|| {
            #[cfg(windows)]
            { "C:/".to_string() }
            #[cfg(not(windows))]
            { "/".to_string() }
        })
}

pub fn normalize_to_native_path(raw: &str) -> (PathBuf, String) {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        let default_p = get_default_local_path();
        return (PathBuf::from(&default_p), default_p);
    }

    // Expand ~ / ~/ to home directory
    let expanded: String = if trimmed == "~" {
        dirs::home_dir()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|| trimmed.to_string())
    } else if trimmed.starts_with("~/") || trimmed.starts_with("~\\") {
        if let Some(home) = dirs::home_dir() {
            let sub = &trimmed[2..];
            let mut h = home.to_string_lossy().to_string();
            #[cfg(windows)]
            {
                if !h.ends_with('\\') && !h.ends_with('/') {
                    h.push('\\');
                }
                h.push_str(&sub.replace('/', "\\"));
            }
            #[cfg(not(windows))]
            {
                if !h.ends_with('/') {
                    h.push('/');
                }
                h.push_str(&sub.replace('\\', "/"));
            }
            h
        } else {
            trimmed.to_string()
        }
    } else {
        trimmed.to_string()
    };

    #[cfg(windows)]
    {
        let mut s = expanded.replace('/', "\\");

        // If someone pasted a WSL mount path like /mnt/c/Users/... on Windows
        if s.to_lowercase().starts_with("\\mnt\\") {
            let parts: Vec<&str> = s.split('\\').filter(|p| !p.is_empty()).collect();
            // parts[0] == "mnt", parts[1] == drive letter (e.g. "c")
            if parts.len() >= 2 && parts[1].len() == 1 {
                let drive_letter = parts[1].to_uppercase();
                let rest = parts[2..].join("\\");
                s = if rest.is_empty() {
                    format!("{}:\\", drive_letter)
                } else {
                    format!("{}:\\{}", drive_letter, rest)
                };
            }
        }

        // Handle UNC prefix if passed manually or via previous buggy display
        if s.to_uppercase().starts_with("UNC\\") {
            s = format!(r"\\{}", &s[4..]);
        } else if s.starts_with("//") {
            s = format!(r"\\{}", &s[2..]);
        }

        // Windows drive root fix: "C:" -> "C:\"
        if s.len() == 2 && s.ends_with(':') {
            s.push('\\');
        }

        let native = PathBuf::from(&s);
        (native, s)
    }

    #[cfg(not(windows))]
    {
        let mut s = expanded.replace('\\', "/");

        // Handle Windows drive path entered or persisted in Linux/WSL (e.g. "C:/...", "C:\...", "c:")
        let is_windows_drive = {
            let bytes = s.as_bytes();
            bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
        };

        if is_windows_drive {
            let drive_char = s.chars().next().unwrap().to_ascii_lowercase();
            let rest = if s.len() > 2 {
                let r = &s[2..];
                r.trim_start_matches('/')
            } else {
                ""
            };

            // Check if running under WSL with /mnt/<drive>
            let wsl_mnt = format!("/mnt/{}", drive_char);
            if Path::new(&wsl_mnt).exists() {
                s = if rest.is_empty() {
                    wsl_mnt
                } else {
                    format!("{}/{}", wsl_mnt, rest)
                };
            } else {
                // Not WSL or drive not mounted: if path doesn't exist, fallback to home directory
                if !Path::new(&s).exists() {
                    if let Some(home) = dirs::home_dir() {
                        s = home.to_string_lossy().to_string();
                    }
                }
            }
        }

        // Collapse multiple slashes (e.g. "//var///www" -> "/var/www"), but keep "/" for root
        let mut cleaned = String::with_capacity(s.len());
        let mut prev_slash = false;
        for c in s.chars() {
            if c == '/' {
                if !prev_slash {
                    cleaned.push('/');
                    prev_slash = true;
                }
            } else {
                cleaned.push(c);
                prev_slash = false;
            }
        }
        if cleaned.len() > 1 && cleaned.ends_with('/') {
            cleaned.pop();
        }
        if cleaned.is_empty() {
            cleaned.push('/');
        }

        let native = PathBuf::from(&cleaned);
        (native, cleaned)
    }
}

pub fn clean_local_path(path: &Path) -> String {
    let s = path.to_string_lossy().replace('\\', "/");
    #[cfg(windows)]
    {
        if let Some(stripped) = s.strip_prefix("//?/UNC/") {
            format!("//{}", stripped)
        } else if let Some(stripped) = s.strip_prefix("//?/") {
            stripped.to_string()
        } else if let Some(stripped) = s.strip_prefix("UNC/") {
            format!("//{}", stripped)
        } else {
            s
        }
    }
    #[cfg(not(windows))]
    {
        if s.len() > 1 && s.ends_with('/') {
            s.trim_end_matches('/').to_string()
        } else if s.is_empty() {
            "/".to_string()
        } else {
            s
        }
    }
}

pub async fn list_local_dir(dir_path: Option<String>) -> Result<(String, Vec<LocalFileEntry>), String> {
    let raw_target = dir_path
        .filter(|p| !p.trim().is_empty())
        .unwrap_or_else(get_default_local_path);

    let (mut native_path, mut display_target) = normalize_to_native_path(&raw_target);

    // If native_path does not exist, check if we should fallback to default local path
    if !native_path.exists() {
        let default_target = get_default_local_path();
        let (def_native, def_display) = normalize_to_native_path(&default_target);
        if def_native.exists() && def_native != native_path {
            #[cfg(not(windows))]
            {
                // On non-Windows, if an alien Windows drive path (e.g. C:/) was requested and doesn't exist, fallback
                if raw_target.contains(':') {
                    native_path = def_native;
                    display_target = def_display;
                }
            }
            #[cfg(windows)]
            {
                // On Windows, if a Unix-only path like /var/www or /home was requested and doesn't exist, fallback
                if raw_target.starts_with('/') && !raw_target.starts_with("//") {
                    native_path = def_native;
                    display_target = def_display;
                }
            }
        }
    }

    let (target_path_buf, clean_canonical_str) = match fs::canonicalize(&native_path).await {
        Ok(canon) => {
            let cleaned = clean_local_path(&canon);
            (canon, cleaned)
        }
        Err(_) => {
            if native_path.exists() {
                let cleaned = clean_local_path(&native_path);
                (native_path.clone(), cleaned)
            } else {
                return Err(format!("Invalid local directory '{}'", display_target));
            }
        }
    };

    let mut dir = fs::read_dir(&target_path_buf)
        .await
        .map_err(|e| format!("Failed to read local directory '{}': {}", clean_canonical_str, e))?;

    let mut result = Vec::new();

    while let Ok(Some(entry)) = dir.next_entry().await {
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name.starts_with('.') && file_name != ".git" {
            // Keep hidden files toggleable or skip if desired
        }

        let clean_path = clean_local_path(&entry.path());

        let file_type = entry.file_type().await.ok();
        let is_dir = file_type.as_ref().map(|t| t.is_dir()).unwrap_or(false);
        let is_symlink = file_type.as_ref().map(|t| t.is_symlink()).unwrap_or(false);

        let metadata = entry.metadata().await.ok();
        let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified = metadata
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let symlink_target = if is_symlink {
            fs::read_link(&entry.path())
                .await
                .ok()
                .map(|p| p.to_string_lossy().replace('\\', "/"))
        } else {
            None
        };

        result.push(LocalFileEntry {
            name: file_name,
            path: clean_path,
            is_dir,
            is_symlink,
            symlink_target,
            size,
            modified,
        });
    }

    result.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok((clean_canonical_str, result))
}

pub async fn create_local_dir(path: &str) -> Result<(), String> {
    let (native, _) = normalize_to_native_path(path);
    fs::create_dir_all(&native)
        .await
        .map_err(|e| format!("Failed to create local directory '{}': {}", path, e))
}

pub async fn create_local_file(path: &str, overwrite: Option<bool>) -> Result<(), String> {
    let (native, _) = normalize_to_native_path(path);
    if !overwrite.unwrap_or(false) && native.exists() {
        return Err(format!("File '{}' already exists", path));
    }
    if let Some(parent) = native.parent() {
        let _ = fs::create_dir_all(parent).await;
    }
    fs::File::create(&native)
        .await
        .map_err(|e| format!("Failed to create local file '{}': {}", path, e))?;
    Ok(())
}

pub async fn remove_local_item(path: &str) -> Result<(), String> {
    let (native, _) = normalize_to_native_path(path);
    let meta = fs::symlink_metadata(&native)
        .await
        .map_err(|e| format!("Failed to stat local item '{}': {}", path, e))?;
    if meta.is_dir() {
        fs::remove_dir_all(&native)
            .await
            .map_err(|e| format!("Failed to remove local directory '{}': {}", path, e))
    } else {
        fs::remove_file(&native)
            .await
            .map_err(|e| format!("Failed to remove local file '{}': {}", path, e))
    }
}

pub async fn rename_local(old_path: &str, new_path: &str) -> Result<(), String> {
    let (native_old, _) = normalize_to_native_path(old_path);
    let (native_new, _) = normalize_to_native_path(new_path);
    fs::rename(&native_old, &native_new)
        .await
        .map_err(|e| format!("Failed to rename local file from '{}' to '{}': {}", old_path, new_path, e))
}

pub async fn copy_local_paths(paths: Vec<String>, target_dir: &str) -> Result<(), String> {
    let (target_native, _) = normalize_to_native_path(target_dir);
    if !target_native.exists() {
        fs::create_dir_all(&target_native)
            .await
            .map_err(|e| format!("Failed to create destination directory: {}", e))?;
    }

    for path_str in paths {
        let (src_native, _) = normalize_to_native_path(&path_str);
        if !src_native.exists() {
            continue;
        }

        let file_name = match src_native.file_name() {
            Some(n) => n.to_os_string(),
            None => continue,
        };

        let dest_native = target_native.join(file_name);
        if src_native == dest_native {
            continue;
        }

        let meta = fs::symlink_metadata(&src_native)
            .await
            .map_err(|e| format!("Failed to read metadata for '{}': {}", path_str, e))?;

        if meta.is_dir() {
            copy_dir_recursive(&src_native, &dest_native).await?;
        } else {
            fs::copy(&src_native, &dest_native)
                .await
                .map_err(|e| format!("Failed to copy file to '{}': {}", dest_native.display(), e))?;
        }
    }
    Ok(())
}

fn copy_dir_recursive<'a>(
    src: &'a std::path::Path,
    dst: &'a std::path::Path,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'a>> {
    Box::pin(async move {
        fs::create_dir_all(dst)
            .await
            .map_err(|e| format!("Failed to create directory '{}': {}", dst.display(), e))?;

        let mut entries = fs::read_dir(src)
            .await
            .map_err(|e| format!("Failed to read directory '{}': {}", src.display(), e))?;

        while let Ok(Some(entry)) = entries.next_entry().await {
            let entry_path = entry.path();
            let entry_name = entry.file_name();
            let dest_child = dst.join(entry_name);

            let meta = entry
                .metadata()
                .await
                .map_err(|e| format!("Failed to read metadata for '{}': {}", entry_path.display(), e))?;

            if meta.is_dir() {
                copy_dir_recursive(&entry_path, &dest_child).await?;
            } else {
                fs::copy(&entry_path, &dest_child)
                    .await
                    .map_err(|e| format!("Failed to copy file '{}': {}", entry_path.display(), e))?;
            }
        }
        Ok(())
    })
}

pub async fn move_local_paths(paths: Vec<String>, target_dir: &str) -> Result<(), String> {
    let (target_native, _) = normalize_to_native_path(target_dir);
    if !target_native.exists() {
        fs::create_dir_all(&target_native)
            .await
            .map_err(|e| format!("Failed to create destination directory: {}", e))?;
    }

    for path_str in paths {
        let (src_native, _) = normalize_to_native_path(&path_str);
        if !src_native.exists() {
            continue;
        }

        let file_name = match src_native.file_name() {
            Some(n) => n.to_os_string(),
            None => continue,
        };

        let dest_native = target_native.join(file_name);
        if src_native == dest_native {
            continue;
        }

        if fs::rename(&src_native, &dest_native).await.is_err() {
            let meta = fs::symlink_metadata(&src_native)
                .await
                .map_err(|e| format!("Failed to read metadata for '{}': {}", path_str, e))?;

            if meta.is_dir() {
                copy_dir_recursive(&src_native, &dest_native).await?;
                let _ = fs::remove_dir_all(&src_native).await;
            } else {
                fs::copy(&src_native, &dest_native)
                    .await
                    .map_err(|e| format!("Failed to copy file to '{}': {}", dest_native.display(), e))?;
                let _ = fs::remove_file(&src_native).await;
            }
        }
    }
    Ok(())
}

pub async fn duplicate_local_path(path: &str, new_name: Option<String>) -> Result<String, String> {
    let (src_native, _) = normalize_to_native_path(path);
    if !src_native.exists() {
        return Err(format!("Source path '{}' does not exist", path));
    }

    let parent = src_native.parent().unwrap_or(&src_native);
    let orig_name = src_native.file_name().and_then(|n| n.to_str()).unwrap_or("file");

    let dest_name = if let Some(n) = new_name.filter(|s| !s.trim().is_empty()) {
        n.trim().to_string()
    } else {
        if let Some((stem, ext)) = orig_name.rsplit_once('.') {
            format!("{} - Copy.{}", stem, ext)
        } else {
            format!("{} - Copy", orig_name)
        }
    };

    let dest_native = parent.join(&dest_name);
    let meta = fs::symlink_metadata(&src_native)
        .await
        .map_err(|e| format!("Failed to inspect '{}': {}", path, e))?;

    if meta.is_dir() {
        copy_dir_recursive(&src_native, &dest_native).await?;
    } else {
        fs::copy(&src_native, &dest_native)
            .await
            .map_err(|e| format!("Failed to duplicate file to '{}': {}", dest_native.display(), e))?;
    }

    Ok(dest_native.to_string_lossy().replace('\\', "/"))
}

pub async fn get_local_dir_size(path: &str) -> Result<u64, String> {
    let (native, _) = normalize_to_native_path(path);
    if !native.exists() {
        return Err(format!("Path '{}' does not exist", path));
    }

    let mut total_bytes: u64 = 0;
    let mut stack = vec![native];

    while let Some(current) = stack.pop() {
        if let Ok(mut entries) = fs::read_dir(&current).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                if let Ok(meta) = entry.metadata().await {
                    if meta.is_dir() {
                        stack.push(entry.path());
                    } else {
                        total_bytes += meta.len();
                    }
                }
            }
        }
    }

    Ok(total_bytes)
}

pub async fn calculate_local_checksum(path: &str, algorithm: &str) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use tokio::io::AsyncReadExt;

    let (native, _) = normalize_to_native_path(path);
    if !native.exists() {
        return Err(format!("File '{}' does not exist", path));
    }

    let mut file = fs::File::open(&native)
        .await
        .map_err(|e| format!("Failed to open file: {}", e))?;

    let mut buffer = [0u8; 65536];

    if algorithm.eq_ignore_ascii_case("md5") {
        let mut context = md5::Context::new();
        loop {
            let n = file
                .read(&mut buffer)
                .await
                .map_err(|e| format!("Failed to read file: {}", e))?;
            if n == 0 {
                break;
            }
            context.consume(&buffer[..n]);
        }
        let digest = context.compute();
        Ok(format!("{:x}", digest))
    } else {
        let mut hasher = Sha256::new();
        loop {
            let n = file
                .read(&mut buffer)
                .await
                .map_err(|e| format!("Failed to read file: {}", e))?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
        }
        let result = hasher.finalize();
        Ok(format!("{:x}", result))
    }
}

pub async fn create_local_symlink(target: &str, link_path: &str) -> Result<(), String> {
    let (native_target, _) = normalize_to_native_path(target);
    let (native_link, _) = normalize_to_native_path(link_path);

    #[cfg(windows)]
    {
        if native_target.is_dir() {
            std::os::windows::fs::symlink_dir(&native_target, &native_link)
                .map_err(|e| format!("Failed to create directory symlink: {}", e))?;
        } else {
            std::os::windows::fs::symlink_file(&native_target, &native_link)
                .map_err(|e| format!("Failed to create file symlink: {}", e))?;
        }
        Ok(())
    }

    #[cfg(unix)]
    {
        tokio::fs::symlink(&native_target, &native_link)
            .await
            .map_err(|e| format!("Failed to create symlink: {}", e))
    }
}

pub async fn get_wsl_distributions() -> Result<Vec<String>, String> {
    let mut distros = Vec::new();

    // 1. Query Windows Registry for registered Lxss distributions
    if let Ok(output) = tokio::process::Command::new("reg")
        .args(&["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Lxss", "/s", "/v", "DistributionName"])
        .output()
        .await
    {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("DistributionName") {
                if let Some(val) = trimmed.split_whitespace().last() {
                    let name = val.trim().to_string();
                    if !name.is_empty() && !distros.contains(&name) {
                        distros.push(name);
                    }
                }
            }
        }
    }

    // 2. Fallback to wsl.exe -l -q if registry had no matches
    if distros.is_empty() {
        if let Ok(output) = tokio::process::Command::new("wsl.exe")
            .args(&["-l", "-q"])
            .output()
            .await
        {
            let text = if output.stdout.len() >= 2 && output.stdout[1] == 0 {
                let u16_vec: Vec<u16> = output.stdout
                    .chunks_exact(2)
                    .map(|a| u16::from_le_bytes([a[0], a[1]]))
                    .collect();
                String::from_utf16_lossy(&u16_vec)
            } else {
                String::from_utf8_lossy(&output.stdout).to_string()
            };

            for line in text.lines() {
                let name = line.trim().to_string();
                if !name.is_empty() && !distros.contains(&name) {
                    distros.push(name);
                }
            }
        }
    }

    Ok(distros)
}

// -------------------------------------------------------------
// Archive Operations (Remote via SSH channel & Local via tar)
// -------------------------------------------------------------

pub async fn extract_remote_archive(
    session: &crate::ssh::session::ActiveSession,
    archive_path: &str,
    target_dir: &str,
) -> Result<String, String> {
    let channel = session
        .handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open SSH channel: {}", e))?;

    let clean_archive = archive_path.trim();
    let clean_target = if target_dir.trim().is_empty() {
        let path = std::path::Path::new(clean_archive);
        path.parent().and_then(|p| p.to_str()).unwrap_or(".")
    } else {
        target_dir.trim()
    };

    let escaped_archive = clean_archive.replace('\'', "'\\''");
    let escaped_target = clean_target.replace('\'', "'\\''");

    let lower = clean_archive.to_lowercase();
    let extract_cmd = if lower.ends_with(".zip") {
        format!(
            "mkdir -p '{target}' && cd '{target}' && (unzip -q -o '{archive}' 2>&1 || tar -xf '{archive}' 2>&1 || python3 -c \"import zipfile; zipfile.ZipFile('{archive}').extractall('{target}')\" 2>&1 || python -c \"import zipfile; zipfile.ZipFile('{archive}').extractall('{target}')\" 2>&1)",
            target = escaped_target,
            archive = escaped_archive
        )
    } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        format!(
            "mkdir -p '{target}' && tar -xzf '{archive}' -C '{target}' 2>&1",
            target = escaped_target,
            archive = escaped_archive
        )
    } else if lower.ends_with(".tar.bz2") || lower.ends_with(".tbz2") {
        format!(
            "mkdir -p '{target}' && tar -xjf '{archive}' -C '{target}' 2>&1",
            target = escaped_target,
            archive = escaped_archive
        )
    } else if lower.ends_with(".tar.xz") || lower.ends_with(".txz") {
        format!(
            "mkdir -p '{target}' && tar -xJf '{archive}' -C '{target}' 2>&1",
            target = escaped_target,
            archive = escaped_archive
        )
    } else if lower.ends_with(".7z") {
        format!(
            "mkdir -p '{target}' && (7z x -y -o'{target}' '{archive}' 2>&1 || 7za x -y -o'{target}' '{archive}' 2>&1)",
            target = escaped_target,
            archive = escaped_archive
        )
    } else {
        format!(
            "mkdir -p '{target}' && tar -xf '{archive}' -C '{target}' 2>&1",
            target = escaped_target,
            archive = escaped_archive
        )
    };

    let full_cmd = format!(
        "{} && echo '---FLOWSFTP_ARCHIVE_SUCCESS---' || echo '---FLOWSFTP_ARCHIVE_FAILED---'",
        extract_cmd
    );

    channel
        .exec(true, full_cmd)
        .await
        .map_err(|e| format!("Failed to execute remote extraction command: {}", e))?;

    let mut stream = channel.into_stream();
    let mut output_bytes = Vec::new();
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(300),
        stream.read_to_end(&mut output_bytes),
    )
    .await
    .map_err(|_| "Archive extraction timed out after 5 minutes".to_string())?;

    let text = String::from_utf8_lossy(&output_bytes).to_string();
    if text.contains("---FLOWSFTP_ARCHIVE_SUCCESS---") {
        Ok("Archive extracted successfully".to_string())
    } else {
        let err_detail = text.replace("---FLOWSFTP_ARCHIVE_FAILED---", "").trim().to_string();
        Err(if err_detail.is_empty() {
            "Archive extraction failed on remote server (check file format and permissions)".to_string()
        } else {
            format!("Archive extraction failed: {}", err_detail)
        })
    }
}

pub async fn compress_remote_archive(
    session: &crate::ssh::session::ActiveSession,
    parent_dir: &str,
    items: &[String],
    archive_name: &str,
) -> Result<String, String> {
    if items.is_empty() {
        return Err("No items selected for compression".to_string());
    }

    let channel = session
        .handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open SSH channel: {}", e))?;

    let clean_parent = if parent_dir.trim().is_empty() { "." } else { parent_dir.trim() };
    let escaped_parent = clean_parent.replace('\'', "'\\''");
    let escaped_archive = archive_name.trim().replace('\'', "'\\''");

    let quoted_items = items
        .iter()
        .map(|it| format!("'{}'", it.replace('\'', "'\\''")))
        .collect::<Vec<_>>()
        .join(" ");

    let lower = archive_name.to_lowercase();
    let compress_cmd = if lower.ends_with(".zip") {
        format!(
            "cd '{parent}' && (zip -r -q '{archive}' {items} 2>&1 || tar -acf '{archive}' {items} 2>&1)",
            parent = escaped_parent,
            archive = escaped_archive,
            items = quoted_items
        )
    } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        format!(
            "cd '{parent}' && tar -czf '{archive}' {items} 2>&1",
            parent = escaped_parent,
            archive = escaped_archive,
            items = quoted_items
        )
    } else if lower.ends_with(".tar.bz2") || lower.ends_with(".tbz2") {
        format!(
            "cd '{parent}' && tar -cjf '{archive}' {items} 2>&1",
            parent = escaped_parent,
            archive = escaped_archive,
            items = quoted_items
        )
    } else if lower.ends_with(".tar.xz") || lower.ends_with(".txz") {
        format!(
            "cd '{parent}' && tar -cJf '{archive}' {items} 2>&1",
            parent = escaped_parent,
            archive = escaped_archive,
            items = quoted_items
        )
    } else {
        format!(
            "cd '{parent}' && tar -cf '{archive}' {items} 2>&1",
            parent = escaped_parent,
            archive = escaped_archive,
            items = quoted_items
        )
    };

    let full_cmd = format!(
        "{} && echo '---FLOWSFTP_ARCHIVE_SUCCESS---' || echo '---FLOWSFTP_ARCHIVE_FAILED---'",
        compress_cmd
    );

    channel
        .exec(true, full_cmd)
        .await
        .map_err(|e| format!("Failed to execute remote compression command: {}", e))?;

    let mut stream = channel.into_stream();
    let mut output_bytes = Vec::new();
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(300),
        stream.read_to_end(&mut output_bytes),
    )
    .await
    .map_err(|_| "Archive compression timed out after 5 minutes".to_string())?;

    let text = String::from_utf8_lossy(&output_bytes).to_string();
    if text.contains("---FLOWSFTP_ARCHIVE_SUCCESS---") {
        Ok(format!("Archive '{}' created successfully", archive_name))
    } else {
        let err_detail = text.replace("---FLOWSFTP_ARCHIVE_FAILED---", "").trim().to_string();
        Err(if err_detail.is_empty() {
            "Archive compression failed on remote server (check permissions and disk space)".to_string()
        } else {
            format!("Archive compression failed: {}", err_detail)
        })
    }
}

pub async fn extract_local_archive(
    archive_path: &str,
    target_dir: &str,
) -> Result<String, String> {
    let (native_archive, _) = normalize_to_native_path(archive_path);
    let (native_target, _) = if target_dir.trim().is_empty() {
        let p = native_archive.parent().unwrap_or(&native_archive);
        (p.to_path_buf(), String::new())
    } else {
        normalize_to_native_path(target_dir)
    };

    if !native_archive.exists() {
        return Err(format!("Archive file not found: {}", native_archive.display()));
    }

    tokio::fs::create_dir_all(&native_target)
        .await
        .map_err(|e| format!("Failed to create target directory: {}", e))?;

    let output = tokio::process::Command::new("tar")
        .arg("-xf")
        .arg(&native_archive)
        .arg("-C")
        .arg(&native_target)
        .output()
        .await
        .map_err(|e| format!("Failed to run tar command: {}", e))?;

    if output.status.success() {
        Ok("Archive extracted successfully".to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Local extraction failed: {}", stderr.trim()))
    }
}

pub async fn compress_local_archive(
    parent_dir: &str,
    items: &[String],
    archive_name: &str,
) -> Result<String, String> {
    if items.is_empty() {
        return Err("No items selected for compression".to_string());
    }

    let (native_parent, _) = normalize_to_native_path(parent_dir);
    if !native_parent.exists() {
        return Err(format!("Directory not found: {}", native_parent.display()));
    }

    let lower = archive_name.to_lowercase();
    let flag = if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        "-czf"
    } else if lower.ends_with(".tar.bz2") || lower.ends_with(".tbz2") {
        "-cjf"
    } else if lower.ends_with(".tar.xz") || lower.ends_with(".txz") {
        "-cJf"
    } else if lower.ends_with(".zip") {
        "-acf"
    } else {
        "-cf"
    };

    let mut cmd = tokio::process::Command::new("tar");
    cmd.current_dir(&native_parent);
    cmd.arg(flag);
    cmd.arg(archive_name);
    for item in items {
        cmd.arg(item);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to run tar command: {}", e))?;

    if output.status.success() {
        Ok(format!("Archive '{}' created successfully", archive_name))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Local compression failed: {}", stderr.trim()))
    }
}



