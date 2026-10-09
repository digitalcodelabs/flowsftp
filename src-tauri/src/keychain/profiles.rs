use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
use crate::keychain::KeychainManager;

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

fn get_storage_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    if !app_dir.exists() {
        fs::create_dir_all(&app_dir)
            .map_err(|e| format!("Failed to create app data directory: {}", e))?;
    }

    Ok(app_dir.join("saved_connections.json"))
}

pub fn load_profiles(app: &tauri::AppHandle) -> Result<Vec<SavedConnectionProfile>, String> {
    let path = get_storage_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    let data = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read profiles file: {}", e))?;

    let profiles: Vec<SavedConnectionProfile> = serde_json::from_str(&data)
        .unwrap_or_else(|_| Vec::new());

    Ok(profiles)
}

pub fn save_profile(
    app: &tauri::AppHandle,
    mut profile: SavedConnectionProfile,
    secret: Option<String>,
) -> Result<SavedConnectionProfile, String> {
    let path = get_storage_path(app)?;
    let mut profiles = load_profiles(app)?;

    if let Some(secret_value) = secret {
        if !secret_value.trim().is_empty() {
            let _ = KeychainManager::set_secret(&profile.id, &secret_value);
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

    fs::write(&path, json)
        .map_err(|e| format!("Failed to write profiles file: {}", e))?;

    Ok(profile)
}

pub fn delete_profile(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let _ = KeychainManager::delete_secret(id);

    let path = get_storage_path(app)?;
    let mut profiles = load_profiles(app)?;

    profiles.retain(|p| p.id != id);

    let json = serde_json::to_string_pretty(&profiles)
        .map_err(|e| format!("Failed to serialize profiles: {}", e))?;

    fs::write(&path, json)
        .map_err(|e| format!("Failed to write profiles file: {}", e))?;

    Ok(())
}

pub fn rename_group(
    app: &tauri::AppHandle,
    old_name: &str,
    new_name: &str,
) -> Result<usize, String> {
    let path = get_storage_path(app)?;
    let mut profiles = load_profiles(app)?;
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

    fs::write(&path, json)
        .map_err(|e| format!("Failed to write profiles file: {}", e))?;

    Ok(updated_count)
}

pub fn rename_profile(
    app: &tauri::AppHandle,
    id: &str,
    new_name: &str,
) -> Result<SavedConnectionProfile, String> {
    let path = get_storage_path(app)?;
    let mut profiles = load_profiles(app)?;

    let profile = profiles
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("Profile not found: {}", id))?;

    profile.name = new_name.trim().to_string();
    let updated = profile.clone();

    let json = serde_json::to_string_pretty(&profiles)
        .map_err(|e| format!("Failed to serialize profiles: {}", e))?;

    fs::write(&path, json)
        .map_err(|e| format!("Failed to write profiles file: {}", e))?;

    Ok(updated)
}

fn get_vault_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    if !app_dir.exists() {
        fs::create_dir_all(&app_dir)
            .map_err(|e| format!("Failed to create app data directory: {}", e))?;
    }

    Ok(app_dir.join("vault.json"))
}

pub fn load_vault_file(app: &tauri::AppHandle) -> Result<Option<String>, String> {
    let path = get_vault_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let data = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read vault file: {}", e))?;
    Ok(Some(data))
}

pub fn save_vault_file(app: &tauri::AppHandle, content: &str) -> Result<(), String> {
    let path = get_vault_path(app)?;
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write vault file: {}", e))
}

pub fn delete_vault_file(app: &tauri::AppHandle) -> Result<(), String> {
    let path = get_vault_path(app)?;
    if path.exists() {
        let _ = fs::remove_file(&path);
    }
    Ok(())
}
