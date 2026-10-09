use tauri::AppHandle;
use crate::keychain::profiles::{
    delete_profile, delete_vault_file, load_profiles, load_vault_file, save_profile,
    save_vault_file, SavedConnectionProfile,
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
pub async fn keychain_list_profiles(
    app: AppHandle,
) -> Result<Vec<SavedConnectionProfile>, String> {
    load_profiles(&app)
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
        .set_title("Select Private Key File (PuTTY / OpenSSH)");

    if let Some(home) = dirs::home_dir() {
        let ssh_dir = home.join(".ssh");
        if ssh_dir.exists() {
            dialog = dialog.set_directory(&ssh_dir);
        } else {
            dialog = dialog.set_directory(&home);
        }
    }

    dialog = dialog
        .add_filter("Private Keys (*.ppk, *.pem, *.key, id_*)", &["ppk", "pem", "key", "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa"])
        .add_filter("PuTTY Private Keys (*.ppk)", &["ppk"])
        .add_filter("OpenSSH & PEM Keys (*.pem, *.key)", &["pem", "key"])
        .add_filter("All Files (*.*)", &["*"]);

    let file = dialog.pick_file().await;
    Ok(file.map(|f| f.path().to_string_lossy().to_string()))
}

