import { defineStore } from 'pinia'
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface DirWatcherPairing {
  id: string
  session_id: string
  local_dir: string
  remote_dir: string
  enabled: boolean
  ignore_patterns: string[]
  last_sync_time?: number | null
  last_synced_file?: string | null
  status: 'watching' | 'syncing' | 'paused' | 'error'
  error?: string | null
  files_uploaded: number
}

export interface DirWatcherSyncEvent {
  watcher_id: string
  session_id: string
  filename: string
  relative_path: string
  remote_path: string
  status: 'syncing' | 'uploaded' | 'error'
  error?: string | null
  timestamp: number
}

export const useDirWatcherStore = defineStore('dirWatcher', () => {
  const pairings = ref<DirWatcherPairing[]>([])
  const lastSyncEvent = ref<DirWatcherSyncEvent | null>(null)
  let unlistenEvents: UnlistenFn | null = null

  async function init() {
    if (unlistenEvents) return

    try {
      unlistenEvents = await listen<DirWatcherSyncEvent>('dir-watcher:event', (event) => {
        const payload = event.payload
        lastSyncEvent.value = payload

        const idx = pairings.value.findIndex((p) => p.id === payload.watcher_id)
        if (idx !== -1) {
          const item = pairings.value[idx]
          if (payload.status === 'uploaded') {
            item.files_uploaded += 1
            item.last_synced_file = payload.filename
            item.last_sync_time = payload.timestamp
            item.status = 'watching'
            item.error = null
          } else if (payload.status === 'error') {
            item.status = 'error'
            item.error = payload.error || 'Upload failed'
          } else if (payload.status === 'syncing') {
            item.status = 'syncing'
          }
        }
      })
    } catch (err) {
      console.warn('Failed to listen to dir-watcher:event', err)
    }

    await loadPairings()
  }

  async function loadPairings(sessionId?: string) {
    try {
      const list = await invoke<DirWatcherPairing[]>('sftp_list_dir_watchers', {
        sessionId: sessionId || null,
      })
      pairings.value = list
    } catch (err) {
      console.error('Failed to list dir watchers:', err)
    }
  }

  async function startWatcher(
    sessionId: string,
    localDir: string,
    remoteDir: string,
    ignorePatterns?: string[]
  ): Promise<DirWatcherPairing> {
    const pairing = await invoke<DirWatcherPairing>('sftp_start_dir_watcher', {
      sessionId,
      localDir,
      remoteDir,
      ignorePatterns: ignorePatterns || null,
    })

    const idx = pairings.value.findIndex((p) => p.id === pairing.id)
    if (idx !== -1) {
      pairings.value[idx] = pairing
    } else {
      pairings.value.push(pairing)
    }

    return pairing
  }

  async function stopWatcher(watcherId: string): Promise<void> {
    try {
      await invoke('sftp_stop_dir_watcher', { watcherId })
      pairings.value = pairings.value.filter((p) => p.id !== watcherId)
    } catch (err) {
      console.error('Failed to stop dir watcher:', err)
    }
  }

  async function toggleWatcher(watcherId: string, enabled: boolean): Promise<DirWatcherPairing | null> {
    try {
      const updated = await invoke<DirWatcherPairing>('sftp_toggle_dir_watcher', {
        watcherId,
        enabled,
      })
      const idx = pairings.value.findIndex((p) => p.id === watcherId)
      if (idx !== -1) {
        pairings.value[idx] = updated
      }
      return updated
    } catch (err) {
      console.error('Failed to toggle dir watcher:', err)
      return null
    }
  }

  return {
    pairings,
    lastSyncEvent,
    init,
    loadPairings,
    startWatcher,
    stopWatcher,
    toggleWatcher,
  }
})
