use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use tokio::time::{timeout, Duration};

use crate::ftp::ActiveFtpSession;
use crate::ssh::session::ActiveSession;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteSearchResultItem {
    pub path: String,
    pub filename: String,
    pub line_number: Option<usize>,
    pub line_content: Option<String>,
    pub is_dir: bool,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteSearchQuery {
    pub search_id: Option<String>,
    pub session_id: String,
    pub base_path: String,
    pub query: String,
    pub search_type: String, // "filename" | "content" (grep)
    pub case_sensitive: bool,
    pub max_depth: Option<usize>,
    pub max_results: Option<usize>,
}

pub async fn search_remote(
    state: &AppState,
    req: RemoteSearchQuery,
) -> Result<Vec<RemoteSearchResultItem>, String> {
    let clean_path = if req.base_path.trim().is_empty() {
        "/".to_string()
    } else {
        req.base_path.trim().replace('\\', "/")
    };

    let max_results = req.max_results.unwrap_or(200).min(500);
    let max_depth = req.max_depth.unwrap_or(5).min(15);
    let trimmed_query = req.query.trim();

    if trimmed_query.is_empty() {
        return Ok(Vec::new());
    }

    let search_id = req.search_id.clone();

    // 1. Try SSH Exec (Ultra-fast kernel-level find / grep on remote Unix / Linux)
    let res = if let Some(session) = state.get_session(&req.session_id).await {
        if let Ok(results) = search_via_ssh_exec(state, &session, &clean_path, &req, max_depth, max_results).await {
            if !results.is_empty() {
                Ok(results)
            } else if let Ok(sftp) = session.get_sftp().await {
                // If SSH exec returned 0 or couldn't run find/grep, fall back to SFTP crawl
                search_via_sftp_crawl(state, &sftp, &clean_path, &req, max_depth, max_results).await
            } else {
                Ok(Vec::new())
            }
        } else if let Ok(sftp) = session.get_sftp().await {
            search_via_sftp_crawl(state, &sftp, &clean_path, &req, max_depth, max_results).await
        } else {
            Err(format!("SFTP not available for session '{}'", req.session_id))
        }
    } else if let Some(ftp) = state.get_ftp_session(&req.session_id).await {
        // 2. FTP Session search (Breadth-first crawl)
        search_via_ftp_crawl(state, &ftp, &clean_path, &req, max_depth, max_results).await
    } else {
        Err(format!("Session '{}' not connected", req.session_id))
    };

    if let Some(id) = search_id {
        state.clear_cancelled_search(&id);
    }

    res
}

async fn search_via_ssh_exec(
    state: &AppState,
    session: &ActiveSession,
    base_path: &str,
    req: &RemoteSearchQuery,
    max_depth: usize,
    max_results: usize,
) -> Result<Vec<RemoteSearchResultItem>, String> {
    let mut channel = session
        .handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open SSH channel: {}", e))?;

    // Escape query for bash shell safety
    let safe_query = crate::shell::escape_single_quotes(&req.query);
    let safe_base = crate::shell::escape_single_quotes(&base_path);

    let cmd = if req.search_type == "content" {
        // Grep text content inside files
        let icase = if req.case_sensitive { "" } else { "-i" };
        format!(
            "grep -rnI {} --exclude-dir={{.git,node_modules,dist,build,vendor,.vscode,.idea}} -m {} '{}' '{}' 2>/dev/null | head -n {}",
            icase, max_results, safe_query, safe_base, max_results
        )
    } else {
        // Find filename
        let iname = if req.case_sensitive { "-name" } else { "-iname" };
        let glob = if safe_query.contains('*') || safe_query.contains('?') {
            safe_query
        } else {
            format!("*{}*", safe_query)
        };
        format!(
            "find '{}' -maxdepth {} \\( -path '*/.git' -o -path '*/node_modules' -o -path '*/dist' -o -path '*/build' -o -path '*/vendor' \\) -prune -o {} '{}' -print 2>/dev/null | head -n {}",
            safe_base, max_depth, iname, glob, max_results
        )
    };

    channel
        .exec(true, cmd.into_bytes())
        .await
        .map_err(|e| format!("Failed to exec search: {}", e))?;

    let mut output_bytes = Vec::new();
    let timeout_deadline = tokio::time::Instant::now() + Duration::from_secs(25);

    loop {
        if let Some(id) = &req.search_id {
            if state.is_search_cancelled(id) {
                let _ = channel.close().await;
                break;
            }
        }

        if tokio::time::Instant::now() > timeout_deadline {
            let _ = channel.close().await;
            break;
        }

        match timeout(Duration::from_millis(150), channel.wait()).await {
            Ok(Some(russh::ChannelMsg::Data { data })) => {
                output_bytes.extend_from_slice(&data);
                if output_bytes.len() > 1024 * 1024 {
                    let _ = channel.close().await;
                    break;
                }
            }
            Ok(Some(russh::ChannelMsg::Eof)) | Ok(Some(russh::ChannelMsg::Close)) => {
                break;
            }
            Ok(Some(_)) => {}
            Ok(None) => break,
            Err(_) => {
                // 150ms timeout chunk elapsed with no data yet, loop back to check cancellation
                continue;
            }
        }
    }

    let output_str = String::from_utf8_lossy(&output_bytes);
    let mut results = Vec::new();

    for line in output_str.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        if req.search_type == "content" {
            // Parse grep output: filepath:line:content
            // Note: filepath on Linux starts with '/' or './'
            if let Some((filepath, rest)) = line.split_once(':') {
                if let Some((line_num_str, line_content)) = rest.split_once(':') {
                    let line_num = line_num_str.parse::<usize>().ok();
                    let filename = filepath.rsplit('/').next().unwrap_or(filepath).to_string();
                    results.push(RemoteSearchResultItem {
                        path: filepath.to_string(),
                        filename,
                        line_number: line_num,
                        line_content: Some(line_content.trim().to_string()),
                        is_dir: false,
                        size: None,
                    });
                }
            }
        } else {
            // Parse find output: filepath
            let filename = line.rsplit('/').next().unwrap_or(line).to_string();
            results.push(RemoteSearchResultItem {
                path: line.to_string(),
                filename,
                line_number: None,
                line_content: None,
                is_dir: false,
                size: None,
            });
        }

        if results.len() >= max_results {
            break;
        }
    }

    Ok(results)
}

async fn search_via_sftp_crawl(
    state: &AppState,
    sftp: &russh_sftp::client::SftpSession,
    base_path: &str,
    req: &RemoteSearchQuery,
    max_depth: usize,
    max_results: usize,
) -> Result<Vec<RemoteSearchResultItem>, String> {
    let mut queue = VecDeque::new();
    queue.push_back((base_path.to_string(), 0usize));

    let query_lower = req.query.to_lowercase();
    let mut results = Vec::new();

    while let Some((dir_path, depth)) = queue.pop_front() {
        if let Some(id) = &req.search_id {
            if state.is_search_cancelled(id) {
                break;
            }
        }

        if depth > max_depth || results.len() >= max_results {
            break;
        }

        let entries = match sftp.read_dir(&dir_path).await {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries {
            if let Some(id) = &req.search_id {
                if state.is_search_cancelled(id) {
                    break;
                }
            }

            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }

            // Skip heavy folders
            if name == ".git" || name == "node_modules" || name == "dist" || name == "vendor" {
                continue;
            }

            let full_path = if dir_path == "/" {
                format!("/{}", name)
            } else {
                format!("{}/{}", dir_path.trim_end_matches('/'), name)
            };

            let is_dir = entry.file_type().is_dir();

            let matched = if req.case_sensitive {
                name.contains(&req.query)
            } else {
                name.to_lowercase().contains(&query_lower)
            };

            if matched {
                results.push(RemoteSearchResultItem {
                    path: full_path.clone(),
                    filename: name.clone(),
                    line_number: None,
                    line_content: None,
                    is_dir,
                    size: Some(entry.metadata().size.unwrap_or(0)),
                });
            }

            if is_dir && depth + 1 <= max_depth {
                queue.push_back((full_path, depth + 1));
            }

            if results.len() >= max_results {
                break;
            }
        }
    }

    Ok(results)
}

async fn search_via_ftp_crawl(
    state: &AppState,
    ftp: &ActiveFtpSession,
    base_path: &str,
    req: &RemoteSearchQuery,
    max_depth: usize,
    max_results: usize,
) -> Result<Vec<RemoteSearchResultItem>, String> {
    let mut queue = VecDeque::new();
    queue.push_back((base_path.to_string(), 0usize));

    let query_lower = req.query.to_lowercase();
    let mut results = Vec::new();

    while let Some((dir_path, depth)) = queue.pop_front() {
        if let Some(id) = &req.search_id {
            if state.is_search_cancelled(id) {
                break;
            }
        }

        if depth > max_depth || results.len() >= max_results {
            break;
        }

        let (_, entries) = match ftp.list_dir(&dir_path).await {
            Ok(res) => res,
            Err(_) => continue,
        };

        for entry in entries {
            if let Some(id) = &req.search_id {
                if state.is_search_cancelled(id) {
                    break;
                }
            }

            if entry.name == "." || entry.name == ".." {
                continue;
            }

            if entry.name == ".git" || entry.name == "node_modules" || entry.name == "dist" || entry.name == "vendor" {
                continue;
            }

            let matched = if req.case_sensitive {
                entry.name.contains(&req.query)
            } else {
                entry.name.to_lowercase().contains(&query_lower)
            };

            if matched {
                results.push(RemoteSearchResultItem {
                    path: entry.path.clone(),
                    filename: entry.name.clone(),
                    line_number: None,
                    line_content: None,
                    is_dir: entry.is_dir,
                    size: Some(entry.size),
                });
            }

            if entry.is_dir && depth + 1 <= max_depth {
                queue.push_back((entry.path, depth + 1));
            }

            if results.len() >= max_results {
                break;
            }
        }
    }

    Ok(results)
}
