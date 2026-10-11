import { defineStore } from 'pinia'
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface ExternalEditInfo {
  id: string
  session_id: string
  remote_path: string
  local_path: string
  filename: string
  last_synced_at: number
  status: 'watching' | 'syncing' | 'synced' | 'error'
  error?: string | null
}

export const useExternalEditStore = defineStore('externalEdit', () => {
  const activeEdits = ref<ExternalEditInfo[]>([])
  const isOpening = ref<string | null>(null) // remote_path currently downloading/opening
  const lastSyncNotification = ref<{ filename: string; remotePath: string; time: string } | null>(null)
  let unlistenStatus: UnlistenFn | null = null

  async function init() {
    if (unlistenStatus) return

    try {
      unlistenStatus = await listen<ExternalEditInfo>('external-edit:status', (event) => {
        const payload = event.payload
        const idx = activeEdits.value.findIndex((e) => e.id === payload.id)
        if (idx !== -1) {
          activeEdits.value[idx] = { ...activeEdits.value[idx], ...payload }
        } else {
          activeEdits.value.push(payload)
        }

        if (payload.status === 'synced') {
          const now = new Date().toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })
          lastSyncNotification.value = {
            filename: payload.filename,
            remotePath: payload.remote_path,
            time: now,
          }
          setTimeout(() => {
            if (lastSyncNotification.value?.remotePath === payload.remote_path) {
              lastSyncNotification.value = null
            }
          }, 4000)
        }
      })
    } catch (err) {
      console.warn('Failed to listen to external-edit:status', err)
    }

    await loadActiveEdits()
  }

  async function loadActiveEdits(sessionId?: string) {
    try {
      const list = await invoke<ExternalEditInfo[]>('sftp_list_active_external_edits', {
        sessionId: sessionId || null,
      })
      activeEdits.value = list
    } catch (err) {
      console.error('Failed to load active external edits:', err)
    }
  }

  async function startEdit(sessionId: string, remotePath: string, editor?: string): Promise<ExternalEditInfo> {
    isOpening.value = remotePath
    try {
      const info = await invoke<ExternalEditInfo>('sftp_start_external_edit', {
        sessionId,
        remotePath,
        preferredEditor: editor || null,
      })
      const idx = activeEdits.value.findIndex((e) => e.id === info.id)
      if (idx !== -1) {
        activeEdits.value[idx] = info
      } else {
        activeEdits.value.push(info)
      }
      return info
    } finally {
      isOpening.value = null
    }
  }

  async function stopEdit(editId: string): Promise<void> {
    try {
      await invoke('sftp_stop_external_edit', { editId })
      activeEdits.value = activeEdits.value.filter((e) => e.id !== editId)
    } catch (err) {
      console.error('Failed to stop external edit:', err)
    }
  }

  async function retryUpload(editId: string): Promise<void> {
    try {
      const target = activeEdits.value.find((e) => e.id === editId)
      if (target) {
        target.status = 'syncing'
      }
      await invoke('sftp_retry_external_edit_upload', { editId })
    } catch (err: any) {
      console.error('Failed to retry external edit upload:', err)
      const target = activeEdits.value.find((e) => e.id === editId)
      if (target) {
        target.status = 'error'
        target.error = err?.message || String(err)
      }
    }
  }

  return {
    activeEdits,
    isOpening,
    lastSyncNotification,
    init,
    loadActiveEdits,
    startEdit,
    stopEdit,
    retryUpload,
  }
})
