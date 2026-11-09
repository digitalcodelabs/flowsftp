use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SshConfigHostEntry {
    pub alias: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub identity_file: Option<String>,
}

#[derive(Debug, Default, Clone)]
struct RawHostBlock {
    patterns: Vec<String>,
    host_name: Option<String>,
    user: Option<String>,
    port: Option<u16>,
    identity_file: Option<String>,
}

fn strip_inline_comment(line: &str) -> &str {
    let mut in_quotes = false;
    for (idx, ch) in line.char_indices() {
        if ch == '"' {
            in_quotes = !in_quotes;
        } else if ch == '#'
            && !in_quotes
            && (idx == 0 || line[..idx].ends_with(char::is_whitespace))
        {
            return &line[..idx];
        }
    }
    line
}

fn split_key_value(line: &str) -> Option<(&str, &str)> {
    let trimmed = strip_inline_comment(line).trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }

    // OpenSSH supports both `Key Value` and `Key=Value` / `Key = Value`
    let mut key_end = 0;
    for (idx, ch) in trimmed.char_indices() {
        if ch.is_whitespace() || ch == '=' {
            key_end = idx;
            break;
        }
    }
    if key_end == 0 {
        return None;
    }

    let key = &trimmed[..key_end];
    let rest = trimmed[key_end..].trim_start();
    let rest = rest.strip_prefix('=').map(str::trim_start).unwrap_or(rest);
    if rest.is_empty() {
        return None;
    }
    Some((key, rest))
}

fn unquote_value(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        trimmed[1..trimmed.len() - 1].to_string()
    } else {
        trimmed.to_string()
    }
}

fn split_whitespace_respecting_quotes(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;

    for ch in input.chars() {
        if ch == '"' {
            in_quotes = !in_quotes;
        } else if ch.is_whitespace() && !in_quotes {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
        } else {
            current.push(ch);
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn expand_tilde_path(raw_path: &str, home_dir: Option<&Path>) -> String {
    let cleaned = unquote_value(raw_path);
    if let Some(home) = home_dir {
        if cleaned == "~" {
            return home.to_string_lossy().to_string();
        }
        if let Some(rest) = cleaned.strip_prefix("~/").or_else(|| cleaned.strip_prefix("~\\")) {
            return home.join(rest).to_string_lossy().to_string();
        }
    }
    cleaned
}

fn is_concrete_alias(pattern: &str) -> bool {
    !pattern.is_empty()
        && !pattern.contains('*')
        && !pattern.contains('?')
        && !pattern.starts_with('!')
}

fn pattern_matches_alias(pattern: &str, alias: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    if pattern.starts_with('!') {
        return false;
    }
    if !pattern.contains('*') && !pattern.contains('?') {
        return pattern.eq_ignore_ascii_case(alias);
    }

    // Simple glob match supporting `*` and `?` for inherited defaults (e.g. `Host *.prod`)
    let pat_bytes = pattern.to_ascii_lowercase().into_bytes();
    let str_bytes = alias.to_ascii_lowercase().into_bytes();
    let (mut pi, mut si) = (0usize, 0usize);
    let mut star_idx: Option<usize> = None;
    let mut match_idx = 0usize;

    while si < str_bytes.len() {
        if pi < pat_bytes.len() && (pat_bytes[pi] == b'?' || pat_bytes[pi] == str_bytes[si]) {
            pi += 1;
            si += 1;
        } else if pi < pat_bytes.len() && pat_bytes[pi] == b'*' {
            star_idx = Some(pi);
            match_idx = si;
            pi += 1;
        } else if let Some(star) = star_idx {
            pi = star + 1;
            match_idx += 1;
            si = match_idx;
        } else {
            return false;
        }
    }

    while pi < pat_bytes.len() && pat_bytes[pi] == b'*' {
        pi += 1;
    }
    pi == pat_bytes.len()
}

fn block_matches_alias(patterns: &[String], alias: &str) -> bool {
    let mut matched = false;
    for pat in patterns {
        if let Some(negated) = pat.strip_prefix('!') {
            if pattern_matches_alias(negated, alias) {
                return false;
            }
        } else if pattern_matches_alias(pat, alias) {
            matched = true;
        }
    }
    matched
}

fn parse_blocks(content: &str, blocks: &mut Vec<RawHostBlock>, base_ssh_dir: Option<&Path>, include_depth: u8) {
    // Implicit top-level block before any `Host` directive applies to all hosts (`*`)
    let mut current = RawHostBlock {
        patterns: vec!["*".to_string()],
        ..Default::default()
    };

    for line in content.lines() {
        let Some((key, val)) = split_key_value(line) else {
            continue;
        };

        if key.eq_ignore_ascii_case("Host") {
            blocks.push(current);
            let patterns = split_whitespace_respecting_quotes(val);
            current = RawHostBlock {
                patterns,
                ..Default::default()
            };
        } else if key.eq_ignore_ascii_case("Match") {
            // Stop capturing into previous Host block when encountering a conditional Match block
            blocks.push(current);
            current = RawHostBlock::default();
        } else if key.eq_ignore_ascii_case("Include") && include_depth < 2 {
            if let Some(ssh_dir) = base_ssh_dir {
                for pattern in split_whitespace_respecting_quotes(val) {
                    for included_path in resolve_include_paths(ssh_dir, &pattern) {
                        if let Ok(included_text) = fs::read_to_string(&included_path) {
                            blocks.push(current);
                            parse_blocks(&included_text, blocks, Some(ssh_dir), include_depth + 1);
                            current = RawHostBlock::default();
                        }
                    }
                }
            }
        } else if key.eq_ignore_ascii_case("HostName") {
            if current.host_name.is_none() {
                current.host_name = Some(unquote_value(val));
            }
        } else if key.eq_ignore_ascii_case("User") {
            if current.user.is_none() {
                current.user = Some(unquote_value(val));
            }
        } else if key.eq_ignore_ascii_case("Port") {
            if current.port.is_none()
                && let Ok(p) = unquote_value(val).parse::<u16>()
                && p > 0
            {
                current.port = Some(p);
            }
        } else if key.eq_ignore_ascii_case("IdentityFile")
            && current.identity_file.is_none()
        {
            current.identity_file = Some(unquote_value(val));
        }
    }

    blocks.push(current);
}

fn resolve_include_paths(ssh_dir: &Path, raw_pattern: &str) -> Vec<PathBuf> {
    let home = dirs::home_dir();
    let expanded = expand_tilde_path(raw_pattern, home.as_deref());
    let candidate = Path::new(&expanded);
    let full_pattern = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        ssh_dir.join(candidate)
    };

    if !expanded.contains('*') && !expanded.contains('?') {
        return if full_pattern.is_file() {
            vec![full_pattern]
        } else {
            Vec::new()
        };
    }

    let Some(parent) = full_pattern.parent() else {
        return Vec::new();
    };
    let Some(file_glob) = full_pattern.file_name().and_then(|n| n.to_str()) else {
        return Vec::new();
    };

    let Ok(entries) = fs::read_dir(parent) else {
        return Vec::new();
    };

    let mut matched: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|name| pattern_matches_alias(file_glob, name))
        })
        .collect();
    matched.sort();
    matched
}

pub fn parse_ssh_config_str(
    content: &str,
    home_dir: Option<&Path>,
    fallback_user: &str,
) -> Vec<SshConfigHostEntry> {
    parse_ssh_config_internal(content, home_dir, None, fallback_user)
}

fn parse_ssh_config_internal(
    content: &str,
    home_dir: Option<&Path>,
    base_ssh_dir: Option<&Path>,
    fallback_user: &str,
) -> Vec<SshConfigHostEntry> {
    let mut blocks = Vec::new();
    parse_blocks(content, &mut blocks, base_ssh_dir, 0);

    let mut seen_aliases = HashSet::new();
    let mut concrete_aliases = Vec::new();

    for block in &blocks {
        for pat in &block.patterns {
            if is_concrete_alias(pat) && seen_aliases.insert(pat.to_ascii_lowercase()) {
                concrete_aliases.push(pat.clone());
            }
        }
    }

    let default_user = if fallback_user.trim().is_empty() {
        "root"
    } else {
        fallback_user.trim()
    };

    let mut results = Vec::with_capacity(concrete_aliases.len());

    for alias in concrete_aliases {
        let mut host_name: Option<String> = None;
        let mut user: Option<String> = None;
        let mut port: Option<u16> = None;
        let mut identity_file: Option<String> = None;

        // OpenSSH applies the FIRST obtained value for each parameter across matching Host blocks
        for block in &blocks {
            if block.patterns.is_empty() || !block_matches_alias(&block.patterns, &alias) {
                continue;
            }
            if host_name.is_none()
                && let Some(ref h) = block.host_name
            {
                host_name = Some(h.replace("%h", &alias));
            }
            if user.is_none()
                && let Some(ref u) = block.user
            {
                user = Some(u.clone());
            }
            if port.is_none()
                && let Some(p) = block.port
            {
                port = Some(p);
            }
            if identity_file.is_none()
                && let Some(ref idf) = block.identity_file
            {
                identity_file = Some(expand_tilde_path(idf, home_dir));
            }
        }

        results.push(SshConfigHostEntry {
            host: host_name.unwrap_or_else(|| alias.clone()),
            alias,
            port: port.unwrap_or(22),
            username: user.unwrap_or_else(|| default_user.to_string()),
            identity_file,
        });
    }

    results
}

pub fn load_user_ssh_config_hosts() -> Result<Vec<SshConfigHostEntry>, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not determine user home directory".to_string())?;
    let ssh_dir = home.join(".ssh");
    let config_path = ssh_dir.join("config");

    if !config_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read '{}': {}", config_path.display(), e))?;

    let fallback_user = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "root".to_string());

    Ok(parse_ssh_config_internal(
        &content,
        Some(&home),
        Some(&ssh_dir),
        &fallback_user,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_concrete_hosts_inherits_defaults_and_skips_wildcards() {
        let sample = r#"
# SSH config with specific hosts followed by wildcard defaults
Host prod-api prod-worker
    HostName 10.20.30.40
    User deploy
    Port 2222
    IdentityFile "~/.ssh/id_prod_ed25519"

Host staging.internal
    User ubuntu # inline comment

Host *.corp.local !bastion.corp.local
    User corpuser

Host app.corp.local
    HostName 172.16.5.9

Host *
    User fallback_global
    IdentityFile ~/.ssh/id_default
"#;

        let home = PathBuf::from("/home/alice");
        let entries = parse_ssh_config_str(sample, Some(&home), "alice");

        assert_eq!(entries.len(), 4);

        assert_eq!(
            entries[0],
            SshConfigHostEntry {
                alias: "prod-api".to_string(),
                host: "10.20.30.40".to_string(),
                port: 2222,
                username: "deploy".to_string(),
                identity_file: Some(home.join(".ssh/id_prod_ed25519").to_string_lossy().to_string()),
            }
        );

        assert_eq!(entries[1].alias, "prod-worker");
        assert_eq!(entries[1].host, "10.20.30.40");
        assert_eq!(entries[1].port, 2222);

        assert_eq!(entries[2].alias, "staging.internal");
        assert_eq!(entries[2].host, "staging.internal");
        assert_eq!(entries[2].username, "ubuntu");
        assert_eq!(
            entries[2].identity_file,
            Some(home.join(".ssh/id_default").to_string_lossy().to_string())
        );

        assert_eq!(entries[3].alias, "app.corp.local");
        assert_eq!(entries[3].host, "172.16.5.9");
        assert_eq!(entries[3].username, "corpuser");
    }

    #[test]
    fn host_specific_port_overrides_trailing_wildcard_port() {
        let sample = r#"
Host custom-port-box
    HostName = 192.168.1.99
    Port = 22022

Host *
    Port 22
    User devops
"#;
        let entries = parse_ssh_config_str(sample, None, "localuser");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].alias, "custom-port-box");
        assert_eq!(entries[0].host, "192.168.1.99");
        assert_eq!(entries[0].port, 22022);
        assert_eq!(entries[0].username, "devops");
    }
}
