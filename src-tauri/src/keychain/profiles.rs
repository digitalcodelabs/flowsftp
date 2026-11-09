use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
use crate::keychain::KeychainManager;

static PROFILE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedConnectionProfile {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default = "default_protocol")]
    pub protocol: String, // "sftp" | "ftp" | "ftps"
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub username: String,
    #[serde(default = "default_auth_type")]
    pub auth_type: String, // "Password" | "KeyFile" | "Agent"
    #[serde(default)]
    pub key_path: Option<String>,
    #[serde(default)]
    pub has_saved_secret: bool,
    #[serde(default)]
    pub default_remote_path: Option<String>,
    #[serde(default)]
    pub created_at: u64,
}

fn default_protocol() -> String {
    "sftp".to_string()
}

fn default_port() -> u16 {
    22
}

fn default_auth_type() -> String {
    "Password".to_string()
}

fn get_app_data_file(app: &tauri::AppHandle, filename: &str) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    if !app_dir.exists() {
        fs::create_dir_all(&app_dir)
            .map_err(|e| format!("Failed to create app data directory: {}", e))?;
    }

    Ok(app_dir.join(filename))
}

fn get_storage_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    get_app_data_file(app, "saved_connections.json")
}

fn atomic_write_file(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent()
        && !parent.exists()
    {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directory: {}", e))?;
    }

    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "data.json".to_string());
    let temp_path = path.with_file_name(format!(".{}.tmp", file_name));

    fs::write(&temp_path, content)
        .map_err(|e| format!("Failed to write temporary file '{}': {}", temp_path.display(), e))?;

    fs::rename(&temp_path, path).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        format!("Failed to atomically replace '{}': {}", path.display(), e)
    })
}

fn load_profiles_from_path(path: &Path) -> Result<Vec<SavedConnectionProfile>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let data = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read profiles file: {}", e))?;

    if data.trim().is_empty() {
        return Ok(Vec::new());
    }

    match serde_json::from_str::<Vec<SavedConnectionProfile>>(&data) {
        Ok(profiles) => Ok(profiles),
        Err(e) => {
            let backup_path = path.with_extension("json.bak");
            log::error!(
                "Failed to parse profiles file '{}': {}. Backing up corrupt file to '{}'",
                path.display(),
                e,
                backup_path.display()
            );
            let _ = fs::copy(path, &backup_path);
            Err(format!("Corrupt profiles file '{}': {}", path.display(), e))
        }
    }
}

pub fn load_profiles(app: &tauri::AppHandle) -> Result<Vec<SavedConnectionProfile>, String> {
    let _guard = PROFILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = get_storage_path(app)?;
    load_profiles_from_path(&path)
}

pub fn save_profile(
    app: &tauri::AppHandle,
    mut profile: SavedConnectionProfile,
    secret: Option<String>,
) -> Result<SavedConnectionProfile, String> {
    let _guard = PROFILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = get_storage_path(app)?;
    let mut profiles = load_profiles_from_path(&path)?;

    if let Some(secret_value) = secret {
        if !secret_value.trim().is_empty() {
            KeychainManager::set_secret(&profile.id, &secret_value)?;
            profile.has_saved_secret = true;
        } else {
            profile.has_saved_secret = false;
            let _ = KeychainManager::delete_secret(&profile.id);
        }
    }

    if profile.created_at == 0 {
        profile.created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
    }

    if let Some(index) = profiles.iter().position(|p| p.id == profile.id) {
        profiles[index] = profile.clone();
    } else {
        profiles.push(profile.clone());
    }

    let json = serde_json::to_string_pretty(&profiles)
        .map_err(|e| format!("Failed to serialize profiles: {}", e))?;

    atomic_write_file(&path, &json)?;

    Ok(profile)
}

pub fn delete_profile(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let _guard = PROFILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _ = KeychainManager::delete_secret(id);

    let path = get_storage_path(app)?;
    let mut profiles = load_profiles_from_path(&path)?;

    profiles.retain(|p| p.id != id);

    let json = serde_json::to_string_pretty(&profiles)
        .map_err(|e| format!("Failed to serialize profiles: {}", e))?;

    atomic_write_file(&path, &json)?;

    Ok(())
}

pub fn rename_group(
    app: &tauri::AppHandle,
    old_name: &str,
    new_name: &str,
) -> Result<usize, String> {
    let _guard = PROFILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = get_storage_path(app)?;
    let mut profiles = load_profiles_from_path(&path)?;
    let mut updated_count = 0;

    let target_group = if new_name.trim().is_empty() {
        None
    } else {
        Some(new_name.trim().to_string())
    };

    for p in profiles.iter_mut() {
        if p.group.as_deref() == Some(old_name) {
            p.group = target_group.clone();
            updated_count += 1;
        }
    }

    let json = serde_json::to_string_pretty(&profiles)
        .map_err(|e| format!("Failed to serialize profiles: {}", e))?;

    atomic_write_file(&path, &json)?;

    Ok(updated_count)
}

pub fn rename_profile(
    app: &tauri::AppHandle,
    id: &str,
    new_name: &str,
) -> Result<SavedConnectionProfile, String> {
    let _guard = PROFILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = get_storage_path(app)?;
    let mut profiles = load_profiles_from_path(&path)?;

    let profile = profiles
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("Profile not found: {}", id))?;

    profile.name = new_name.trim().to_string();
    let updated = profile.clone();

    let json = serde_json::to_string_pretty(&profiles)
        .map_err(|e| format!("Failed to serialize profiles: {}", e))?;

    atomic_write_file(&path, &json)?;

    Ok(updated)
}

fn import_profiles_to_path(
    path: &Path,
    incoming: Vec<SavedConnectionProfile>,
    replace_existing: bool,
) -> Result<usize, String> {
    let mut profiles = if replace_existing {
        Vec::new()
    } else {
        load_profiles_from_path(path)?
    };

    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let mut imported_count = 0usize;
    for mut item in incoming {
        if item.id.trim().is_empty() || item.host.trim().is_empty() {
            continue;
        }
        if item.created_at == 0 {
            item.created_at = now_secs;
        }
        if item.name.trim().is_empty() {
            item.name = format!("{}@{}", item.username, item.host);
        }
        if let Some(idx) = profiles.iter().position(|p| p.id == item.id) {
            profiles[idx] = item;
        } else {
            profiles.push(item);
        }
        imported_count += 1;
    }

    let json = serde_json::to_string_pretty(&profiles)
        .map_err(|e| format!("Failed to serialize profiles: {}", e))?;

    atomic_write_file(path, &json)?;
    Ok(imported_count)
}

pub fn import_profiles(
    app: &tauri::AppHandle,
    profiles: Vec<SavedConnectionProfile>,
    replace_existing: bool,
) -> Result<usize, String> {
    let _guard = PROFILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = get_storage_path(app)?;
    import_profiles_to_path(&path, profiles, replace_existing)
}

fn get_vault_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    get_app_data_file(app, "vault.json")
}

pub fn load_vault_file(app: &tauri::AppHandle) -> Result<Option<String>, String> {
    let _guard = PROFILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = get_vault_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let data = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read vault file: {}", e))?;
    Ok(Some(data))
}

pub fn save_vault_file(app: &tauri::AppHandle, content: &str) -> Result<(), String> {
    let _guard = PROFILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = get_vault_path(app)?;
    atomic_write_file(&path, content)
}

pub fn delete_vault_file(app: &tauri::AppHandle) -> Result<(), String> {
    let _guard = PROFILE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = get_vault_path(app)?;
    if path.exists() {
        let _ = fs::remove_file(&path);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corrupt_profiles_file_backs_up_and_returns_err() {
        let dir = std::env::temp_dir().join(format!("flowsftp_profile_test_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let file_path = dir.join("saved_connections.json");
        fs::write(&file_path, "{ invalid json").unwrap();

        let res = load_profiles_from_path(&file_path);
        assert!(res.is_err());
        assert!(dir.join("saved_connections.json.bak").exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn atomic_write_replaces_existing_file_cleanly() {
        let dir = std::env::temp_dir().join(format!("flowsftp_atomic_test_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let file_path = dir.join("saved_connections.json");

        atomic_write_file(&file_path, "[]").unwrap();
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "[]");

        atomic_write_file(&file_path, "[{\"id\":\"1\",\"host\":\"example.com\",\"username\":\"root\"}]").unwrap();
        let loaded = load_profiles_from_path(&file_path).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].host, "example.com");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn import_profiles_supports_merge_and_replace_modes() {
        let dir = std::env::temp_dir().join(format!("flowsftp_import_test_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let file_path = dir.join("saved_connections.json");

        let p1 = SavedConnectionProfile {
            id: "prof-1".to_string(),
            name: "Prod".to_string(),
            group: Some("Work".to_string()),
            protocol: "sftp".to_string(),
            host: "10.0.0.1".to_string(),
            port: 22,
            username: "ubuntu".to_string(),
            auth_type: "Password".to_string(),
            key_path: None,
            has_saved_secret: true,
            default_remote_path: None,
            created_at: 100,
        };
        let p2 = SavedConnectionProfile {
            id: "prof-2".to_string(),
            name: "Staging".to_string(),
            group: None,
            protocol: "sftp".to_string(),
            host: "10.0.0.2".to_string(),
            port: 2222,
            username: "deploy".to_string(),
            auth_type: "Agent".to_string(),
            key_path: None,
            has_saved_secret: false,
            default_remote_path: Some("/var/www".to_string()),
            created_at: 0,
        };

        let count = import_profiles_to_path(&file_path, vec![p1.clone()], false).unwrap();
        assert_eq!(count, 1);

        // Merge: update prof-1 name and add prof-2
        let mut p1_updated = p1;
        p1_updated.name = "Prod Updated".to_string();
        let merged = import_profiles_to_path(&file_path, vec![p1_updated, p2.clone()], false).unwrap();
        assert_eq!(merged, 2);

        let loaded = load_profiles_from_path(&file_path).unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].name, "Prod Updated");
        assert_eq!(loaded[1].id, "prof-2");
        assert!(loaded[1].created_at > 0);

        // Replace mode: keep only prof-2
        let replaced = import_profiles_to_path(&file_path, vec![p2], true).unwrap();
        assert_eq!(replaced, 1);
        let after_replace = load_profiles_from_path(&file_path).unwrap();
        assert_eq!(after_replace.len(), 1);
        assert_eq!(after_replace[0].id, "prof-2");

        let _ = fs::remove_dir_all(&dir);
    }
}
