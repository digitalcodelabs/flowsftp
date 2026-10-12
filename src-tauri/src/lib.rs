pub mod commands;
pub mod ftp;
pub mod keychain;
pub mod sftp;
pub mod ssh;
pub mod state;

use commands::dialog::{pick_and_read_file, save_file_dialog};
use commands::fonts::get_system_fonts;
use commands::dir_watcher::{
    sftp_list_dir_watchers, sftp_start_dir_watcher, sftp_stop_dir_watcher,
    sftp_toggle_dir_watcher,
};
use commands::external_edit::{
    sftp_list_active_external_edits, sftp_retry_external_edit_upload, sftp_start_external_edit,
    sftp_stop_external_edit,
};
use commands::search::{sftp_cancel_search, sftp_search_remote};
use commands::ftp::ftp_connect;
use commands::keychain::{
    keychain_delete_profile, keychain_get_secret, keychain_list_profiles,
    keychain_rename_group, keychain_rename_profile, keychain_save_profile,
    pick_key_file, vault_delete_file, vault_load_file, vault_save_file,
};
use commands::sftp::{
    sftp_canonicalize_remote, sftp_check_conflict, sftp_copy_local_paths, sftp_create_local_dir,
    sftp_create_local_file, sftp_create_remote_dir, sftp_create_remote_file, sftp_download,
    sftp_get_default_local_path, sftp_get_git_status, sftp_get_paths_metadata,
    sftp_get_remote_git_status, sftp_get_wsl_distros, sftp_list_local, sftp_list_remote,
    sftp_open_in_default_app, sftp_ping, sftp_read_file_binary, sftp_read_file_text,
    sftp_read_local_file_binary, sftp_read_local_file_text, sftp_remove_local,
    sftp_remove_remote_dir, sftp_remove_remote_file, sftp_rename_local, sftp_rename_remote,
    sftp_set_permissions, sftp_upload, sftp_write_file_text, sftp_write_local_file_text,
    sftp_cancel_transfer, sftp_cancel_all_transfers, sftp_reset_cancel_transfers,
    sftp_extract_remote_archive, sftp_compress_remote_archive,
    sftp_extract_local_archive, sftp_compress_local_archive,
    sftp_crawl_local_paths, sftp_crawl_remote_paths, sftp_batch_create_remote_dirs, exit_app,
    sftp_move_remote_paths, sftp_move_local_paths, sftp_duplicate_remote_path, sftp_duplicate_local_path,
    sftp_create_remote_symlink, sftp_create_local_symlink, sftp_get_remote_dir_size, sftp_get_local_dir_size,
    sftp_calculate_remote_checksum, sftp_calculate_local_checksum,
};
use commands::ssh::{
    ssh_connect, ssh_disconnect, ssh_get_history, ssh_list_sessions, ssh_resize_pty, ssh_write_stdin,
};
use state::AppState;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .manage(AppState::new())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_icon(tauri::include_image!("icons/128x128.png"));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // SSH Terminal Commands
            ssh_connect,
            ssh_write_stdin,
            ssh_resize_pty,
            ssh_disconnect,
            ssh_list_sessions,
            ssh_get_history,
            // FTP Commands
            ftp_connect,
            // SFTP File Browser Commands
            sftp_list_remote,
            sftp_canonicalize_remote,
            sftp_create_remote_dir,
            sftp_batch_create_remote_dirs,
            sftp_create_remote_file,
            sftp_remove_remote_dir,
            sftp_remove_remote_file,
            sftp_rename_remote,
            sftp_download,
            sftp_upload,
            sftp_cancel_transfer,
            sftp_cancel_all_transfers,
            sftp_reset_cancel_transfers,
            sftp_list_local,
            sftp_create_local_dir,
            sftp_create_local_file,
            sftp_remove_local,
            sftp_rename_local,
            sftp_get_default_local_path,
            sftp_get_wsl_distros,
            sftp_get_paths_metadata,
            sftp_copy_local_paths,
            sftp_check_conflict,
            sftp_set_permissions,
            sftp_read_file_text,
            sftp_write_file_text,
            sftp_read_local_file_text,
            sftp_write_local_file_text,
            sftp_read_file_binary,
            sftp_read_local_file_binary,
            sftp_ping,
            sftp_get_git_status,
            sftp_get_remote_git_status,
            sftp_open_in_default_app,
            sftp_extract_remote_archive,
            sftp_compress_remote_archive,
            sftp_extract_local_archive,
            sftp_compress_local_archive,
            sftp_crawl_local_paths,
            sftp_crawl_remote_paths,
            sftp_move_remote_paths,
            sftp_move_local_paths,
            sftp_duplicate_remote_path,
            sftp_duplicate_local_path,
            sftp_create_remote_symlink,
            sftp_create_local_symlink,
            sftp_get_remote_dir_size,
            sftp_get_local_dir_size,
            sftp_calculate_remote_checksum,
            sftp_calculate_local_checksum,
            // External Editor & Live Auto-Sync Commands
            sftp_start_external_edit,
            sftp_stop_external_edit,
            sftp_list_active_external_edits,
            sftp_retry_external_edit_upload,
            // Directory Watcher & Folder Pairing Commands
            sftp_start_dir_watcher,
            sftp_stop_dir_watcher,
            sftp_list_dir_watchers,
            sftp_toggle_dir_watcher,
            // Recursive Remote Search & Grep Commands
            sftp_search_remote,
            sftp_cancel_search,
            // Keychain & Saved Profiles Commands
            keychain_save_profile,
            keychain_rename_group,
            keychain_rename_profile,
            keychain_list_profiles,
            keychain_delete_profile,
            keychain_get_secret,
            // Master Password Encrypted Vault Commands
            vault_load_file,
            vault_save_file,
            vault_delete_file,
            // Native File Picker & Dialogs
            pick_key_file,
            save_file_dialog,
            pick_and_read_file,
            exit_app,
            get_system_fonts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
