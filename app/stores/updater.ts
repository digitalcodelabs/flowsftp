import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'

export interface UpdateCheckResult {
  updateAvailable: boolean
  currentVersion: string
  latestVersion: string
  downloadUrl: string | null
  notes: string | null
  pubDate: string | null
  signature: string | null
  platform: string
  arch: string
}

export interface UpdateDownloadProgress {
  downloadedBytes: number
  totalBytes: number
  percent: number
  phase: 'downloading' | 'extracting' | 'installing' | 'completed' | 'cancelled' | 'error'
  message: string
}

const STORAGE_AUTO_CHECK_KEY = 'flowsftp_auto_check_updates'
const STORAGE_DISMISSED_VERSION_KEY = 'flowsftp_dismissed_update_version'

export const useUpdaterStore = defineStore('updater', () => {
  const checking = ref(false)
  const downloading = ref(false)
  const installing = ref(false)
  const updateAvailable = ref(false)
  const currentVersion = ref('0.9.1')
  const latestVersion = ref<string | null>(null)
  const downloadUrl = ref<string | null>(null)
  const releaseNotes = ref<string | null>(null)
  const pubDate = ref<string | null>(null)
  const platform = ref('')
  const arch = ref('')

  const downloadedBytes = ref(0)
  const totalBytes = ref(0)
  const progressPercent = ref(0)
  const statusMessage = ref<string | null>(null)
  const errorMessage = ref<string | null>(null)
  const lastCheckedAt = ref<number | null>(null)

  const autoCheckOnStartup = ref<boolean>(
    typeof localStorage !== 'undefined'
      ? localStorage.getItem(STORAGE_AUTO_CHECK_KEY) !== 'false'
      : true
  )

  const dismissedVersion = ref<string | null>(
    typeof localStorage !== 'undefined'
      ? localStorage.getItem(STORAGE_DISMISSED_VERSION_KEY)
      : null
  )

  if (typeof localStorage !== 'undefined') {
    watch(autoCheckOnStartup, (val) => {
      localStorage.setItem(STORAGE_AUTO_CHECK_KEY, val ? 'true' : 'false')
    })
    watch(dismissedVersion, (val) => {
      if (val) {
        localStorage.setItem(STORAGE_DISMISSED_VERSION_KEY, val)
      } else {
        localStorage.removeItem(STORAGE_DISMISSED_VERSION_KEY)
      }
    })
  }

  const showHeaderUpdateBadge = computed(() => {
    return (
      updateAvailable.value &&
      Boolean(latestVersion.value) &&
      latestVersion.value !== dismissedVersion.value
    )
  })

  let unlistenProgress: (() => void) | null = null

  async function ensureProgressListener() {
    if (unlistenProgress) return
    if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) return
    try {
      const { listen } = await import('@tauri-apps/api/event')
      unlistenProgress = await listen<UpdateDownloadProgress>('app:update-progress', (event) => {
        const p = event.payload
        downloadedBytes.value = p.downloadedBytes
        totalBytes.value = p.totalBytes
        progressPercent.value = p.percent
        statusMessage.value = p.message

        if (p.phase === 'downloading' || p.phase === 'extracting') {
          downloading.value = true
          installing.value = false
        } else if (p.phase === 'installing') {
          downloading.value = false
          installing.value = true
        } else if (p.phase === 'cancelled') {
          downloading.value = false
          installing.value = false
        }
      })
    } catch (err) {
      console.warn('Failed to listen to app:update-progress:', err)
    }
  }

  async function checkForUpdates(options?: { silent?: boolean }): Promise<UpdateCheckResult | null> {
    if (checking.value || downloading.value || installing.value) return null
    checking.value = true
    errorMessage.value = null
    if (!options?.silent) {
      statusMessage.value = 'Checking flowsftp.com for updates...'
    }

    try {
      await ensureProgressListener()
      const result = await invoke<UpdateCheckResult>('app_check_for_updates')
      currentVersion.value = result.currentVersion || currentVersion.value
      latestVersion.value = result.latestVersion || null
      updateAvailable.value = result.updateAvailable
      downloadUrl.value = result.downloadUrl
      releaseNotes.value = result.notes
      pubDate.value = result.pubDate
      platform.value = result.platform
      arch.value = result.arch
      lastCheckedAt.value = Date.now()

      if (result.updateAvailable) {
        if (!options?.silent) {
          dismissedVersion.value = null
        }
        statusMessage.value = `Update v${result.latestVersion} is ready to install.`
      } else {
        statusMessage.value = `FlowSFTP v${result.currentVersion} is up to date.`
      }

      return result
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err?.message || 'Unable to check for updates.'
      if (!options?.silent) {
        errorMessage.value = msg
        statusMessage.value = null
      }
      return null
    } finally {
      checking.value = false
    }
  }

  async function downloadAndInstallUpdate(): Promise<boolean> {
    if (!downloadUrl.value || downloading.value || installing.value) return false
    errorMessage.value = null
    downloading.value = true
    installing.value = false
    downloadedBytes.value = 0
    totalBytes.value = 0
    progressPercent.value = 0
    statusMessage.value = `Starting download for FlowSFTP v${latestVersion.value || 'latest'}...`

    try {
      await ensureProgressListener()
      await invoke<string>('app_download_and_install_update', {
        downloadUrl: downloadUrl.value,
        version: latestVersion.value || 'latest',
      })
      return true
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err?.message || 'Update installation failed.'
      downloading.value = false
      installing.value = false
      if (!msg.toLowerCase().includes('cancelled')) {
        errorMessage.value = msg
      }
      return false
    }
  }

  async function cancelDownload() {
    if (!downloading.value) return
    try {
      await invoke('app_cancel_update_download')
    } catch {
      // ignore
    } finally {
      downloading.value = false
      installing.value = false
    }
  }

  function dismissUpdate() {
    if (latestVersion.value) {
      dismissedVersion.value = latestVersion.value
    }
  }

  return {
    checking,
    downloading,
    installing,
    updateAvailable,
    currentVersion,
    latestVersion,
    downloadUrl,
    releaseNotes,
    pubDate,
    platform,
    arch,
    downloadedBytes,
    totalBytes,
    progressPercent,
    statusMessage,
    errorMessage,
    lastCheckedAt,
    autoCheckOnStartup,
    dismissedVersion,
    showHeaderUpdateBadge,
    checkForUpdates,
    downloadAndInstallUpdate,
    cancelDownload,
    dismissUpdate,
  }
})

