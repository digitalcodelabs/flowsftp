use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::ftp::ActiveFtpSession;
use crate::sftp::dir_watcher::{ActiveDirWatcherHandle, DirWatcherPairing};
use crate::sftp::external_edit::{ActiveWatcherHandle, ExternalEditInfo};
use crate::ssh::session::ActiveSession;
use crate::ssh::types::SessionInfo;

#[derive(Clone, Default)]
pub struct AppState {
    sessions: Arc<RwLock<HashMap<String, Arc<ActiveSession>>>>,
    ftp_sessions: Arc<RwLock<HashMap<String, Arc<ActiveFtpSession>>>>,
    cancelled_transfers: Arc<std::sync::RwLock<HashSet<String>>>,
    cancel_all_transfers: Arc<AtomicBool>,
    cancelled_searches: Arc<std::sync::RwLock<HashSet<String>>>,
    pub external_edits: Arc<std::sync::RwLock<HashMap<String, ExternalEditInfo>>>,
    pub external_watchers: Arc<std::sync::Mutex<HashMap<String, ActiveWatcherHandle>>>,
    pub dir_watchers: Arc<std::sync::RwLock<HashMap<String, DirWatcherPairing>>>,
    pub dir_watcher_handles: Arc<std::sync::Mutex<HashMap<String, ActiveDirWatcherHandle>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            ftp_sessions: Arc::new(RwLock::new(HashMap::new())),
            cancelled_transfers: Arc::new(std::sync::RwLock::new(HashSet::new())),
            cancel_all_transfers: Arc::new(AtomicBool::new(false)),
            cancelled_searches: Arc::new(std::sync::RwLock::new(HashSet::new())),
            external_edits: Arc::new(std::sync::RwLock::new(HashMap::new())),
            external_watchers: Arc::new(std::sync::Mutex::new(HashMap::new())),
            dir_watchers: Arc::new(std::sync::RwLock::new(HashMap::new())),
            dir_watcher_handles: Arc::new(std::sync::Mutex::new(HashMap::new())),
        }
    }

    pub fn cancel_search(&self, search_id: &str) {
        if let Ok(mut set) = self.cancelled_searches.write() {
            set.insert(search_id.to_string());
        }
    }

    pub fn is_search_cancelled(&self, search_id: &str) -> bool {
        if let Ok(set) = self.cancelled_searches.read() {
            set.contains(search_id)
        } else {
            false
        }
    }

    pub fn clear_cancelled_search(&self, search_id: &str) {
        if let Ok(mut set) = self.cancelled_searches.write() {
            set.remove(search_id);
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
        self.stop_all_external_edits(Some(session_id));
        self.stop_all_dir_watchers(Some(session_id));
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
        self.stop_all_external_edits(Some(session_id));
        self.stop_all_dir_watchers(Some(session_id));
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

    pub fn add_external_edit(&self, info: ExternalEditInfo, watcher: ActiveWatcherHandle) {
        if let Ok(mut map) = self.external_edits.write() {
            map.insert(info.id.clone(), info);
        }
        if let Ok(mut map) = self.external_watchers.lock() {
            map.insert(watcher.id.clone(), watcher);
        }
    }

    pub fn get_external_edit(&self, edit_id: &str) -> Option<ExternalEditInfo> {
        let map = self.external_edits.read().ok()?;
        map.get(edit_id).cloned()
    }

    pub fn list_external_edits(&self, session_id: Option<&str>) -> Vec<ExternalEditInfo> {
        if let Ok(map) = self.external_edits.read() {
            map.values()
                .filter(|e| session_id.map_or(true, |sid| e.session_id == sid))
                .cloned()
                .collect()
        } else {
            Vec::new()
        }
    }

    pub fn update_external_edit_status(
        &self,
        edit_id: &str,
        status: &str,
        error: Option<String>,
        synced_at: Option<u64>,
    ) {
        if let Ok(mut map) = self.external_edits.write() {
            if let Some(item) = map.get_mut(edit_id) {
                item.status = status.to_string();
                item.error = error;
                if let Some(ts) = synced_at {
                    item.last_synced_at = ts;
                }
            }
        }
    }

    pub fn stop_external_edit(&self, edit_id: &str) -> Option<ExternalEditInfo> {
        if let Ok(mut watchers) = self.external_watchers.lock() {
            if let Some(handle) = watchers.remove(edit_id) {
                handle.is_active.store(false, Ordering::SeqCst);
                let _ = std::fs::remove_file(&handle.local_path);
                if let Some(parent) = handle.local_path.parent() {
                    let _ = std::fs::remove_dir(parent);
                }
            }
        }
        if let Ok(mut map) = self.external_edits.write() {
            map.remove(edit_id)
        } else {
            None
        }
    }

    pub fn stop_all_external_edits(&self, session_id: Option<&str>) {
        let mut ids_to_remove = Vec::new();
        if let Ok(map) = self.external_edits.read() {
            for (id, edit) in map.iter() {
                if session_id.map_or(true, |sid| edit.session_id == sid) {
                    ids_to_remove.push(id.clone());
                }
            }
        }
        for id in ids_to_remove {
            self.stop_external_edit(&id);
        }
    }

    // ---------------------------------------------------------
    // Directory Watcher & Auto-Upload State Methods
    // ---------------------------------------------------------
    pub fn add_dir_watcher(&self, pairing: DirWatcherPairing, handle: ActiveDirWatcherHandle) {
        if let Ok(mut map) = self.dir_watchers.write() {
            map.insert(pairing.id.clone(), pairing);
        }
        if let Ok(mut map) = self.dir_watcher_handles.lock() {
            map.insert(handle.id.clone(), handle);
        }
    }

    pub fn get_dir_watcher(&self, watcher_id: &str) -> Option<DirWatcherPairing> {
        let map = self.dir_watchers.read().ok()?;
        map.get(watcher_id).cloned()
    }

    pub fn list_dir_watchers(&self, session_id: Option<&str>) -> Vec<DirWatcherPairing> {
        if let Ok(map) = self.dir_watchers.read() {
            map.values()
                .filter(|w| session_id.map_or(true, |sid| w.session_id == sid))
                .cloned()
                .collect()
        } else {
            Vec::new()
        }
    }

    pub fn record_dir_watcher_upload(&self, watcher_id: &str, filename: &str) {
        if let Ok(mut map) = self.dir_watchers.write() {
            if let Some(w) = map.get_mut(watcher_id) {
                w.files_uploaded += 1;
                w.last_synced_file = Some(filename.to_string());
                w.last_sync_time = Some(crate::sftp::dir_watcher::now_epoch_secs());
                w.status = "watching".to_string();
                w.error = None;
            }
        }
    }

    pub fn record_dir_watcher_error(&self, watcher_id: &str, error: &str) {
        if let Ok(mut map) = self.dir_watchers.write() {
            if let Some(w) = map.get_mut(watcher_id) {
                w.error = Some(error.to_string());
                w.status = "error".to_string();
            }
        }
    }

    pub fn stop_dir_watcher(&self, watcher_id: &str) -> Option<DirWatcherPairing> {
        if let Ok(mut handles) = self.dir_watcher_handles.lock() {
            if let Some(handle) = handles.remove(watcher_id) {
                handle.is_active.store(false, Ordering::SeqCst);
            }
        }
        if let Ok(mut map) = self.dir_watchers.write() {
            map.remove(watcher_id)
        } else {
            None
        }
    }

    pub fn stop_all_dir_watchers(&self, session_id: Option<&str>) {
        let mut ids_to_remove = Vec::new();
        if let Ok(map) = self.dir_watchers.read() {
            for (id, watcher) in map.iter() {
                if session_id.map_or(true, |sid| watcher.session_id == sid) {
                    ids_to_remove.push(id.clone());
                }
            }
        }
        for id in ids_to_remove {
            self.stop_dir_watcher(&id);
        }
    }
}
