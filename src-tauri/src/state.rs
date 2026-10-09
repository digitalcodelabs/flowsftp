use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::ftp::ActiveFtpSession;
use crate::ssh::session::ActiveSession;
use crate::ssh::types::SessionInfo;

#[derive(Default)]
pub struct AppState {
    sessions: Arc<RwLock<HashMap<String, Arc<ActiveSession>>>>,
    ftp_sessions: Arc<RwLock<HashMap<String, Arc<ActiveFtpSession>>>>,
    cancelled_transfers: Arc<std::sync::RwLock<HashSet<String>>>,
    cancel_all_transfers: Arc<AtomicBool>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            ftp_sessions: Arc::new(RwLock::new(HashMap::new())),
            cancelled_transfers: Arc::new(std::sync::RwLock::new(HashSet::new())),
            cancel_all_transfers: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn cancel_transfer(&self, transfer_id: &str) {
        if let Ok(mut set) = self.cancelled_transfers.write() {
            set.insert(transfer_id.to_string());
        }
    }

    pub fn cancel_all_transfers(&self) {
        self.cancel_all_transfers.store(true, Ordering::SeqCst);
    }

    pub fn reset_cancel_all(&self) {
        self.cancel_all_transfers.store(false, Ordering::SeqCst);
        if let Ok(mut set) = self.cancelled_transfers.write() {
            set.clear();
        }
    }

    pub fn is_transfer_cancelled(&self, transfer_id: &str) -> bool {
        // Deletion operations use 'del-' prefix and must never be aborted by global transfer cancel-all
        if !transfer_id.starts_with("del-") && self.cancel_all_transfers.load(Ordering::SeqCst) {
            return true;
        }
        if let Ok(set) = self.cancelled_transfers.read() {
            set.contains(transfer_id)
        } else {
            false
        }
    }

    pub fn is_deletion_cancelled(&self, deletion_id: &str) -> bool {
        // Deletions are only aborted if the specific deletion ID was explicitly added to cancelled_transfers
        if let Ok(set) = self.cancelled_transfers.read() {
            set.contains(deletion_id)
        } else {
            false
        }
    }

    pub fn clear_cancelled(&self, id: &str) {
        if let Ok(mut set) = self.cancelled_transfers.write() {
            set.remove(id);
        }
    }

    pub async fn add_session(&self, session: ActiveSession) {
        let mut map = self.sessions.write().await;
        map.insert(session.session_id.clone(), Arc::new(session));
    }

    pub async fn get_session(&self, session_id: &str) -> Option<Arc<ActiveSession>> {
        let map = self.sessions.read().await;
        map.get(session_id).cloned()
    }

    pub async fn remove_session(&self, session_id: &str) -> Option<Arc<ActiveSession>> {
        let mut map = self.sessions.write().await;
        if let Some(session) = map.remove(session_id) {
            let _ = session.close().await;
            Some(session)
        } else {
            None
        }
    }

    pub async fn add_ftp_session(&self, session: ActiveFtpSession) {
        let mut map = self.ftp_sessions.write().await;
        map.insert(session.session_id.clone(), Arc::new(session));
    }

    pub async fn get_ftp_session(&self, session_id: &str) -> Option<Arc<ActiveFtpSession>> {
        let map = self.ftp_sessions.read().await;
        map.get(session_id).cloned()
    }

    pub async fn remove_ftp_session(&self, session_id: &str) -> Option<Arc<ActiveFtpSession>> {
        let mut map = self.ftp_sessions.write().await;
        if let Some(session) = map.remove(session_id) {
            let _ = session.close().await;
            Some(session)
        } else {
            None
        }
    }

    pub async fn list_sessions(&self) -> Vec<SessionInfo> {
        let mut res = Vec::new();
        {
            let map = self.sessions.read().await;
            for s in map.values() {
                if !s.is_closed.load(std::sync::atomic::Ordering::SeqCst) {
                    res.push(SessionInfo {
                        session_id: s.session_id.clone(),
                        host: s.host.clone(),
                        port: s.port,
                        username: s.username.clone(),
                        protocol: "sftp".to_string(),
                    });
                }
            }
        }
        {
            let map = self.ftp_sessions.read().await;
            for s in map.values() {
                res.push(SessionInfo {
                    session_id: s.session_id.clone(),
                    host: s.host.clone(),
                    port: s.port,
                    username: s.username.clone(),
                    protocol: if s.is_secure { "ftps".to_string() } else { "ftp".to_string() },
                });
            }
        }
        res
    }
}
