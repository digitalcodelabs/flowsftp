use std::path::PathBuf;

#[tauri::command]
pub async fn save_file_dialog(
    default_name: Option<String>,
    content: String,
    filter_name: Option<String>,
    filter_ext: Option<String>,
) -> Result<Option<String>, String> {
    let mut dialog = rfd::AsyncFileDialog::new().set_title("Save File");

    if let Some(ref name) = default_name {
        dialog = dialog.set_file_name(name);
    }

    if let Some(dir) = dirs::download_dir().or_else(dirs::home_dir) {
        dialog = dialog.set_directory(&dir);
    }

    if let (Some(ref fname), Some(ref fext)) = (filter_name, filter_ext) {
        let extensions: Vec<&str> = fext.split(',').map(|s| s.trim()).collect();
        dialog = dialog.add_filter(fname, &extensions);
    }

    let file = dialog.save_file().await;
    if let Some(f) = file {
        let path: PathBuf = f.path().to_path_buf();
        tokio::fs::write(&path, content)
            .await
            .map_err(|e| format!("Failed to write file to {}: {}", path.display(), e))?;
        Ok(Some(path.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn pick_and_read_file(
    filter_name: Option<String>,
    filter_ext: Option<String>,
) -> Result<Option<String>, String> {
    let mut dialog = rfd::AsyncFileDialog::new().set_title("Select File");

    if let Some(dir) = dirs::download_dir().or_else(dirs::home_dir) {
        dialog = dialog.set_directory(&dir);
    }

    if let (Some(ref fname), Some(ref fext)) = (filter_name, filter_ext) {
        let extensions: Vec<&str> = fext.split(',').map(|s| s.trim()).collect();
        dialog = dialog.add_filter(fname, &extensions);
    }

    let file = dialog.pick_file().await;
    if let Some(f) = file {
        let content = tokio::fs::read_to_string(f.path())
            .await
            .map_err(|e| format!("Failed to read file: {}", e))?;
        Ok(Some(content))
    } else {
        Ok(None)
    }
}
