use tauri::State;

use crate::sftp::search::{
    search_remote, RemoteSearchQuery, RemoteSearchResultItem,
};
use crate::state::AppState;

#[tauri::command]
pub async fn sftp_search_remote(
    state: State<'_, AppState>,
    query: RemoteSearchQuery,
) -> Result<Vec<RemoteSearchResultItem>, String> {
    search_remote(&state, query).await
}

#[tauri::command]
pub async fn sftp_cancel_search(
    state: State<'_, AppState>,
    search_id: String,
) -> Result<(), String> {
    state.cancel_search(&search_id);
    Ok(())
}

