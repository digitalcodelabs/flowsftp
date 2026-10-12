use russh::client::Handler;
use russh::keys::{HashAlg, PublicKeyOrCertificate};
use serde::Serialize;
use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::ssh::known_hosts::{self, HostKeyStatus};

/// How long we wait for the user to accept/reject an unknown or changed host key.
const PROMPT_TIMEOUT: Duration = Duration::from_secs(120);

type PendingMap = Mutex<HashMap<String, oneshot::Sender<bool>>>;

fn pending() -> &'static PendingMap {
    static PENDING: OnceLock<PendingMap> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Delivers the user's decision to the connection that is waiting on it.
/// Returns `false` when the request is unknown (already answered or timed out).
pub fn resolve_host_key_prompt(request_id: &str, accept: bool) -> bool {
    let sender = pending()
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .remove(request_id);
    match sender {
        Some(tx) => tx.send(accept).is_ok(),
        None => false,
    }
}

/// Payload emitted to the frontend as the `ssh:host_key_prompt` event.
#[derive(Debug, Clone, Serialize)]
pub struct HostKeyPrompt {
    pub request_id: String,
    pub host: String,
    pub port: u16,
    pub algorithm: String,
    pub fingerprint: String,
    /// `"unknown"` for a first-time host, `"changed"` when the stored key no longer matches.
    pub status: String,
    pub old_fingerprint: Option<String>,
}

#[derive(Clone)]
pub struct SshClientHandler {
    app: AppHandle,
    host: String,
    port: u16,
    /// True while we are blocked waiting for the user; lets the caller pause its connect timeout.
    pub prompting: Arc<AtomicBool>,
    /// Human readable reason when the handler rejected the server key.
    pub failure: Arc<Mutex<Option<String>>>,
}

impl SshClientHandler {
    pub fn new(app: AppHandle, host: String, port: u16) -> Self {
        Self {
            app,
            host,
            port,
            prompting: Arc::new(AtomicBool::new(false)),
            failure: Arc::new(Mutex::new(None)),
        }
    }

    fn fail(&self, reason: impl Into<String>) {
        *self.failure.lock().unwrap_or_else(|p| p.into_inner()) = Some(reason.into());
    }

    async fn ask_user(&self, prompt: HostKeyPrompt) -> bool {
        let request_id = prompt.request_id.clone();
        let (tx, rx) = oneshot::channel();
        pending()
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(request_id.clone(), tx);

        if self.app.emit("ssh:host_key_prompt", prompt).is_err() {
            pending()
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .remove(&request_id);
            return false;
        }

        self.prompting.store(true, Ordering::SeqCst);
        let decision = tokio::time::timeout(PROMPT_TIMEOUT, rx).await;
        self.prompting.store(false, Ordering::SeqCst);

        // Make sure a timed-out request cannot linger in the registry.
        pending()
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(&request_id);

        matches!(decision, Ok(Ok(true)))
    }
}

/// Returns `(algorithm, sha256 fingerprint)` for the key the server presented.
fn describe(key: &PublicKeyOrCertificate) -> (String, String) {
    match key {
        PublicKeyOrCertificate::PublicKey { key, .. } => (
            key.algorithm().to_string(),
            key.fingerprint(HashAlg::Sha256).to_string(),
        ),
        PublicKeyOrCertificate::Certificate(cert) => (
            format!("{}", cert.algorithm()),
            cert.public_key().fingerprint(HashAlg::Sha256).to_string(),
        ),
    }
}

impl Handler for SshClientHandler {
    type Error = russh::Error;

    fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> impl Future<Output = Result<bool, Self::Error>> + Send {
        let (algorithm, fingerprint) = describe(server_public_key);
        let this = self.clone();

        async move {
            let id = known_hosts::host_id(&this.host, this.port);

            let status = match known_hosts::check(&this.app, &id, &algorithm, &fingerprint) {
                Ok(status) => status,
                Err(e) => {
                    // Fail closed: never silently trust a key because the store is unreadable.
                    log::error!("Host key store unavailable for {}: {}", id, e);
                    this.fail(format!("Could not verify host key: {}", e));
                    return Ok(false);
                }
            };

            let (status_label, old_fingerprint) = match status {
                HostKeyStatus::Trusted => return Ok(true),
                HostKeyStatus::Unknown => ("unknown", None),
                HostKeyStatus::Changed { old_fingerprint } => ("changed", Some(old_fingerprint)),
            };

            log::warn!(
                "Host key {} for {} ({} {})",
                status_label,
                id,
                algorithm,
                fingerprint
            );

            let accepted = this
                .ask_user(HostKeyPrompt {
                    request_id: Uuid::new_v4().to_string(),
                    host: this.host.clone(),
                    port: this.port,
                    algorithm: algorithm.clone(),
                    fingerprint: fingerprint.clone(),
                    status: status_label.to_string(),
                    old_fingerprint,
                })
                .await;

            if !accepted {
                this.fail(if status_label == "changed" {
                    "Host key verification failed: the server's key has changed and was not accepted."
                } else {
                    "Host key verification failed: the server's key was not accepted."
                });
                return Ok(false);
            }

            if let Err(e) = known_hosts::trust(&this.app, &id, &algorithm, &fingerprint) {
                // The user accepted, so connect, but make the failure to persist visible.
                log::error!("Failed to persist trusted host key for {}: {}", id, e);
            }
            Ok(true)
        }
    }
}
