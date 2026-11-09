use tauri::AppHandle;
use crate::keychain::profiles::{
    delete_profile, delete_vault_file, import_profiles, load_profiles, load_vault_file,
    rename_group, rename_profile, save_profile, save_vault_file, SavedConnectionProfile,
};
use crate::keychain::KeychainManager;

#[tauri::command]
pub async fn keychain_save_profile(
    app: AppHandle,
    profile: SavedConnectionProfile,
    secret: Option<String>,
) -> Result<SavedConnectionProfile, String> {
    save_profile(&app, profile, secret)
}

#[tauri::command]
pub async fn keychain_rename_group(
    app: AppHandle,
    old_name: String,
    new_name: String,
) -> Result<usize, String> {
    rename_group(&app, &old_name, &new_name)
}

#[tauri::command]
pub async fn keychain_rename_profile(
    app: AppHandle,
    id: String,
    new_name: String,
) -> Result<SavedConnectionProfile, String> {
    rename_profile(&app, &id, &new_name)
}

#[tauri::command]
pub async fn keychain_list_profiles(
    app: AppHandle,
) -> Result<Vec<SavedConnectionProfile>, String> {
    load_profiles(&app)
}

#[tauri::command]
pub async fn keychain_import_profiles(
    app: AppHandle,
    profiles: Vec<SavedConnectionProfile>,
    replace_existing: bool,
) -> Result<usize, String> {
    import_profiles(&app, profiles, replace_existing)
}

#[tauri::command]
pub async fn keychain_delete_profile(
    app: AppHandle,
    id: String,
) -> Result<(), String> {
    delete_profile(&app, &id)
}

#[tauri::command]
pub async fn keychain_get_secret(
    id: String,
) -> Result<Option<String>, String> {
    KeychainManager::get_secret(&id)
}

#[tauri::command]
pub async fn vault_load_file(app: AppHandle) -> Result<Option<String>, String> {
    load_vault_file(&app)
}

#[tauri::command]
pub async fn vault_save_file(app: AppHandle, content: String) -> Result<(), String> {
    save_vault_file(&app, &content)
}

#[tauri::command]
pub async fn vault_delete_file(app: AppHandle) -> Result<(), String> {
    delete_vault_file(&app)
}

#[tauri::command]
pub async fn pick_key_file() -> Result<Option<String>, String> {
    let mut dialog = rfd::AsyncFileDialog::new()
        .set_title("Select Private Key File (OpenSSH / PuTTY)");

    if let Some(home) = dirs::home_dir() {
        let ssh_dir = home.join(".ssh");
        if ssh_dir.exists() {
            dialog = dialog.set_directory(&ssh_dir);
        } else {
            dialog = dialog.set_directory(&home);
        }
    }

    // OpenSSH private keys (id_ed25519, id_rsa, id_ecdsa) have no file extension,
    // so the default filter must include "*" on Windows/macOS/Linux to keep them visible.
    dialog = dialog
        .add_filter("All SSH Key Files (*.*, id_ed25519, id_rsa, *.pem, *.ppk)", &["*"])
        .add_filter("PEM & Key Files (*.pem, *.key, *.ppk)", &["pem", "key", "ppk"])
        .add_filter("PuTTY Private Keys (*.ppk)", &["ppk"]);

    let file = dialog.pick_file().await;
    Ok(file.map(|f| {
        let selected_path = f.path().to_path_buf();
        if selected_path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("pub"))
        {
            let candidate = selected_path.with_extension("");
            if candidate.is_file() {
                return candidate.to_string_lossy().to_string();
            }
        }
        selected_path.to_string_lossy().to_string()
    }))
}

