//! Trust-on-first-use (TOFU) store for SSH host keys.
//!
//! Host keys are persisted as `known_hosts.json` inside the app data directory.
//! The evaluation logic ([`KnownHosts::evaluate`]) is pure so it can be unit tested
//! without touching the filesystem or the network.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

const FILE_NAME: &str = "known_hosts.json";

/// Serialises read-modify-write cycles so concurrent connections cannot clobber each other.
static FILE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostKeyEntry {
    /// SSH key algorithm name, e.g. `ssh-ed25519`.
    pub algorithm: String,
    /// OpenSSH style fingerprint, e.g. `SHA256:AbC...`.
    pub fingerprint: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostKeyStatus {
    /// The presented key matches a previously trusted key.
    Trusted,
    /// We have never seen this host (or never seen this key algorithm for it).
    Unknown,
    /// The host previously presented a different key for the same algorithm.
    Changed { old_fingerprint: String },
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct KnownHosts {
    #[serde(default)]
    hosts: BTreeMap<String, Vec<HostKeyEntry>>,
}

/// Builds the canonical identifier used as the map key for a host.
pub fn host_id(host: &str, port: u16) -> String {
    format!("{}:{}", host.trim().to_lowercase(), port)
}

impl KnownHosts {
    pub fn evaluate(&self, host_id: &str, algorithm: &str, fingerprint: &str) -> HostKeyStatus {
        let Some(entries) = self.hosts.get(host_id) else {
            return HostKeyStatus::Unknown;
        };

        match entries.iter().find(|e| e.algorithm == algorithm) {
            Some(entry) if entry.fingerprint == fingerprint => HostKeyStatus::Trusted,
            Some(entry) => HostKeyStatus::Changed {
                old_fingerprint: entry.fingerprint.clone(),
            },
            None => HostKeyStatus::Unknown,
        }
    }

    /// Trusts `fingerprint` for `host_id`, replacing any key of the same algorithm.
    pub fn trust(&mut self, host_id: &str, algorithm: &str, fingerprint: &str) {
        let entries = self.hosts.entry(host_id.to_string()).or_default();
        entries.retain(|e| e.algorithm != algorithm);
        entries.push(HostKeyEntry {
            algorithm: algorithm.to_string(),
            fingerprint: fingerprint.to_string(),
        });
    }

    pub fn load_from(path: &Path) -> Self {
        fs::read_to_string(path)
            .ok()
            .and_then(|data| serde_json::from_str(&data).ok())
            .unwrap_or_default()
    }

    /// Writes atomically (temp file + rename) so a crash never leaves a truncated store.
    pub fn save_to(&self, path: &Path) -> Result<(), String> {
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize known hosts: {}", e))?;
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(|e| format!("Failed to write known hosts: {}", e))?;
        fs::rename(&tmp, path).map_err(|e| format!("Failed to persist known hosts: {}", e))
    }
}

fn store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create app data directory: {}", e))?;
    }
    Ok(dir.join(FILE_NAME))
}

pub fn check(
    app: &tauri::AppHandle,
    host_id: &str,
    algorithm: &str,
    fingerprint: &str,
) -> Result<HostKeyStatus, String> {
    let path = store_path(app)?;
    let _guard = FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    Ok(KnownHosts::load_from(&path).evaluate(host_id, algorithm, fingerprint))
}

pub fn trust(
    app: &tauri::AppHandle,
    host_id: &str,
    algorithm: &str,
    fingerprint: &str,
) -> Result<(), String> {
    let path = store_path(app)?;
    let _guard = FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut store = KnownHosts::load_from(&path);
    store.trust(host_id, algorithm, fingerprint);
    store.save_to(&path)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOST: &str = "example.com:22";

    #[test]
    fn unknown_host_is_unknown() {
        let store = KnownHosts::default();
        assert_eq!(
            store.evaluate(HOST, "ssh-ed25519", "SHA256:aaa"),
            HostKeyStatus::Unknown
        );
    }

    #[test]
    fn trusted_key_matches() {
        let mut store = KnownHosts::default();
        store.trust(HOST, "ssh-ed25519", "SHA256:aaa");
        assert_eq!(
            store.evaluate(HOST, "ssh-ed25519", "SHA256:aaa"),
            HostKeyStatus::Trusted
        );
    }

    #[test]
    fn changed_key_for_same_algorithm_is_flagged() {
        let mut store = KnownHosts::default();
        store.trust(HOST, "ssh-ed25519", "SHA256:aaa");
        assert_eq!(
            store.evaluate(HOST, "ssh-ed25519", "SHA256:bbb"),
            HostKeyStatus::Changed {
                old_fingerprint: "SHA256:aaa".to_string()
            }
        );
    }

    #[test]
    fn different_algorithm_is_treated_as_new_not_changed() {
        let mut store = KnownHosts::default();
        store.trust(HOST, "ssh-ed25519", "SHA256:aaa");
        assert_eq!(
            store.evaluate(HOST, "ssh-rsa", "SHA256:zzz"),
            HostKeyStatus::Unknown
        );
    }

    #[test]
    fn different_port_is_a_different_host() {
        let mut store = KnownHosts::default();
        store.trust(&host_id("example.com", 22), "ssh-ed25519", "SHA256:aaa");
        assert_eq!(
            store.evaluate(&host_id("example.com", 2222), "ssh-ed25519", "SHA256:aaa"),
            HostKeyStatus::Unknown
        );
    }

    #[test]
    fn host_id_is_case_and_whitespace_insensitive() {
        assert_eq!(host_id("  Example.COM ", 22), "example.com:22");
    }

    #[test]
    fn trusting_replaces_same_algorithm_but_keeps_others() {
        let mut store = KnownHosts::default();
        store.trust(HOST, "ssh-ed25519", "SHA256:old");
        store.trust(HOST, "ssh-rsa", "SHA256:rsa");
        store.trust(HOST, "ssh-ed25519", "SHA256:new");

        assert_eq!(
            store.evaluate(HOST, "ssh-ed25519", "SHA256:new"),
            HostKeyStatus::Trusted
        );
        assert_eq!(
            store.evaluate(HOST, "ssh-ed25519", "SHA256:old"),
            HostKeyStatus::Changed {
                old_fingerprint: "SHA256:new".to_string()
            }
        );
        assert_eq!(
            store.evaluate(HOST, "ssh-rsa", "SHA256:rsa"),
            HostKeyStatus::Trusted
        );
    }

    #[test]
    fn save_and_load_round_trip() {
        let path = std::env::temp_dir().join(format!("flowsftp-known-hosts-{}.json", uuid::Uuid::new_v4()));

        let mut store = KnownHosts::default();
        store.trust(HOST, "ssh-ed25519", "SHA256:aaa");
        store.save_to(&path).expect("save should succeed");

        let loaded = KnownHosts::load_from(&path);
        assert_eq!(
            loaded.evaluate(HOST, "ssh-ed25519", "SHA256:aaa"),
            HostKeyStatus::Trusted
        );

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn corrupt_file_loads_as_empty_store() {
        let path = std::env::temp_dir().join(format!("flowsftp-known-hosts-{}.json", uuid::Uuid::new_v4()));
        fs::write(&path, "{ not valid json").unwrap();

        let loaded = KnownHosts::load_from(&path);
        assert_eq!(
            loaded.evaluate(HOST, "ssh-ed25519", "SHA256:aaa"),
            HostKeyStatus::Unknown
        );

        let _ = fs::remove_file(&path);
    }
}
