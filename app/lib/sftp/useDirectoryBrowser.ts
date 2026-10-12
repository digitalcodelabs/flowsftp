import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { SftpFileEntry, LocalFileEntry, CacheEntry, GitRepoStatus, FetchDirOptions } from './types'

/**
 * Directory browsing for both panes: current session / path / listing, per-session remote
 * state, the in-memory directory cache with stale-while-revalidate refresh, git status
 * and connection health. It knows nothing about transfers.
 */
export function useDirectoryBrowser() {
  // Remote State
  const currentSessionId = ref<string | null>(null)
  const remotePath = ref<string>('.')
  const remoteFiles = ref<SftpFileEntry[]>([])
  const selectedRemotePath = ref<string | null>(null)
  const isLoadingRemote = ref(false)
  const remoteError = ref<string | null>(null)

  // Local State
  const localPath = ref<string>('')
  const localFiles = ref<LocalFileEntry[]>([])
  const selectedLocalPath = ref<string | null>(null)
  const isLoadingLocal = ref(false)
  const localError = ref<string | null>(null)

  // Git Status Tracking
  const localGitStatus = ref<GitRepoStatus | null>(null)
  const remoteGitStatus = ref<GitRepoStatus | null>(null)

  // Connection Health & Auto-reconnect
  const isSessionDisconnected = ref(false)
  const isAutoReconnecting = ref(false)

  async function checkSessionHealth(sessionId: string): Promise<boolean> {
    try {
      const isAlive = await invoke<boolean>('sftp_ping', { sessionId })
      return isAlive
    } catch {
      return false
    }
  }

  async function fetchLocalGitStatus(path?: string) {
    const target = path || localPath.value
    if (!target) return
    try {
      const status = await invoke<GitRepoStatus>('sftp_get_git_status', { path: target })
      localGitStatus.value = status
    } catch {
      localGitStatus.value = null
    }
  }

  async function fetchRemoteGitStatus(sessionId: string, path?: string) {
    if (!sessionId) return
    const target = path || remotePath.value
    if (!target) return
    try {
      const status = await invoke<GitRepoStatus>('sftp_get_remote_git_status', { sessionId, path: target })
      remoteGitStatus.value = status
    } catch {
      remoteGitStatus.value = null
    }
  }

  async function initLocal() {
    isLoadingLocal.value = true
    localError.value = null
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('flowsftp_last_local_path') : null
      let ok = false
      if (saved) {
        ok = await fetchLocalDir(saved)
      }
      if (!ok) {
        const defaultPath = await invoke<string>('sftp_get_default_local_path')
        await fetchLocalDir(defaultPath)
        localError.value = null
      }
    } catch (err: any) {
      console.error('Failed to init local directory:', err)
      localError.value = typeof err === 'string' ? err : err?.message || String(err)
    } finally {
      isLoadingLocal.value = false
    }
  }

  // -------------------------------------------------------------
  // FileZilla-style In-Memory Directory Cache
  // -------------------------------------------------------------
  const CACHE_TTL_MS = 60_000 // 60 seconds

  const remoteDirCache = ref<Record<string, CacheEntry<SftpFileEntry>>>({})
  const localDirCache = ref<Record<string, CacheEntry<LocalFileEntry>>>({})

  const isBackgroundRefreshingRemote = ref(false)
  const isBackgroundRefreshingLocal = ref(false)

  function normalizeCacheKey(p: string): string {
    return p.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
  }

  function getRemoteCacheKey(sessionId: string, p: string): string {
    return `${sessionId}:${normalizeCacheKey(p)}`
  }

  function getLocalCacheKey(p: string): string {
    return normalizeCacheKey(p)
  }

  function invalidateRemoteCache(sessionId?: string, path?: string) {
    if (!sessionId) {
      remoteDirCache.value = {}
      return
    }
    if (!path) {
      const prefix = `${sessionId}:`
      for (const k of Object.keys(remoteDirCache.value)) {
        if (k.startsWith(prefix)) {
          delete remoteDirCache.value[k]
        }
      }
      return
    }
    delete remoteDirCache.value[getRemoteCacheKey(sessionId, path)]
  }

  function invalidateLocalCache(path?: string) {
    if (!path) {
      localDirCache.value = {}
      return
    }
    delete localDirCache.value[getLocalCacheKey(path)]
  }

  function clearAllCache() {
    remoteDirCache.value = {}
    localDirCache.value = {}
  }

  async function fetchLocalDir(path?: string, options: FetchDirOptions = {}): Promise<boolean> {
    const targetPath = path !== undefined ? path : (localPath.value || null)
    const cacheKey = targetPath ? getLocalCacheKey(targetPath) : null
    const cached = cacheKey ? localDirCache.value[cacheKey] : null
    const now = Date.now()
    const isCacheFresh = cached && (now - cached.timestamp < CACHE_TTL_MS)

    if (!options.force && cached) {
      // 1. Instant Cache Hit: Display files immediately (0 ms latency)
      localPath.value = cached.canonical
      localFiles.value = cached.entries
      selectedLocalPath.value = null

      if (isCacheFresh) {
        return true
      }
      isBackgroundRefreshingLocal.value = true
    } else if (options.background) {
      isBackgroundRefreshingLocal.value = true
    } else {
      isLoadingLocal.value = true
      localError.value = null
    }

    try {
      const [canonical, entries] = await invoke<[string, LocalFileEntry[]]>(
        'sftp_list_local',
        { dirPath: targetPath }
      )
      localPath.value = canonical
      localFiles.value = entries
      selectedLocalPath.value = null

      if (typeof window !== 'undefined') {
        localStorage.setItem('flowsftp_last_local_path', canonical)
      }
      fetchLocalGitStatus(canonical)

      const cacheItem: CacheEntry<LocalFileEntry> = {
        timestamp: Date.now(),
        canonical,
        entries,
      }
      if (cacheKey) {
        localDirCache.value[cacheKey] = cacheItem
      }
      localDirCache.value[getLocalCacheKey(canonical)] = cacheItem
      return true
    } catch (err: any) {
      console.error('Failed to list local directory:', err)
      if (!cached) {
        localError.value = typeof err === 'string' ? err : err?.message || String(err)
      }
      return false
    } finally {
      isLoadingLocal.value = false
      isBackgroundRefreshingLocal.value = false
    }
  }

  // Per-session Remote Directory State & Cache
  const sessionRemotePaths = ref<Record<string, string>>({})
  const sessionRemoteFiles = ref<Record<string, SftpFileEntry[]>>({})

  async function switchSession(sessionId: string, defaultPath?: string) {
    if (!sessionId) {
      currentSessionId.value = null
      remoteFiles.value = []
      remotePath.value = '.'
      selectedRemotePath.value = null
      remoteError.value = null
      remoteGitStatus.value = null
      return
    }

    currentSessionId.value = sessionId
    remoteError.value = null
    selectedRemotePath.value = null

    if (sessionRemoteFiles.value[sessionId] && sessionRemotePaths.value[sessionId] && !defaultPath) {
      remotePath.value = sessionRemotePaths.value[sessionId]
      remoteFiles.value = sessionRemoteFiles.value[sessionId]
      fetchRemoteGitStatus(sessionId, remotePath.value)
      fetchRemoteDir(sessionId, remotePath.value)
    } else {
      const saved = typeof window !== 'undefined' ? localStorage.getItem(`flowsftp_last_remote_path_${sessionId}`) : null
      const initialPath = defaultPath || saved || '.'
      remotePath.value = initialPath
      remoteFiles.value = []
      await fetchRemoteDir(sessionId, initialPath)
    }
  }

  function clearSession(sessionId: string) {
    delete sessionRemotePaths.value[sessionId]
    delete sessionRemoteFiles.value[sessionId]
    invalidateRemoteCache(sessionId)
    if (currentSessionId.value === sessionId) {
      currentSessionId.value = null
      remoteFiles.value = []
      remotePath.value = '.'
      selectedRemotePath.value = null
      remoteError.value = null
      remoteGitStatus.value = null
    }
  }

  async function fetchRemoteDir(sessionId: string, path?: string, options: FetchDirOptions = {}) {
    if (!sessionId) return
    const targetPath = path !== undefined ? path : (remotePath.value || '.')
    const cacheKey = getRemoteCacheKey(sessionId, targetPath)
    const cached = remoteDirCache.value[cacheKey]
    const now = Date.now()
    const isCacheFresh = cached && (now - cached.timestamp < CACHE_TTL_MS)

    if (!options.force && cached) {
      // 1. Instant Cache Hit: Display files immediately (0 ms latency)
      if (currentSessionId.value === sessionId) {
        remotePath.value = cached.canonical
        remoteFiles.value = cached.entries
        selectedRemotePath.value = null
      }
      sessionRemotePaths.value[sessionId] = cached.canonical
      sessionRemoteFiles.value[sessionId] = cached.entries

      if (isCacheFresh) {
        return
      }
      if (currentSessionId.value === sessionId) {
        isBackgroundRefreshingRemote.value = true
      }
    } else if (options.background) {
      if (currentSessionId.value === sessionId) {
        isBackgroundRefreshingRemote.value = true
      }
    } else {
      if (currentSessionId.value === sessionId) {
        isLoadingRemote.value = true
        remoteError.value = null
      }
    }

    try {
      const [canonical, entries] = await invoke<[string, SftpFileEntry[]]>('sftp_list_remote', {
        sessionId,
        path: targetPath,
      })

      sessionRemotePaths.value[sessionId] = canonical
      sessionRemoteFiles.value[sessionId] = entries

      if (typeof window !== 'undefined') {
        localStorage.setItem(`flowsftp_last_remote_path_${sessionId}`, canonical)
      }

      const cacheItem: CacheEntry<SftpFileEntry> = {
        timestamp: Date.now(),
        canonical,
        entries,
      }
      remoteDirCache.value[cacheKey] = cacheItem
      remoteDirCache.value[getRemoteCacheKey(sessionId, canonical)] = cacheItem

      // Guard: only apply to current active display if this is still the active session!
      if (currentSessionId.value === sessionId) {
        remotePath.value = canonical
        remoteFiles.value = entries
        selectedRemotePath.value = null
        fetchRemoteGitStatus(sessionId, canonical)
      }
    } catch (err: any) {
      console.error('Failed to list remote directory:', err)
      if (currentSessionId.value === sessionId && !cached) {
        remoteError.value = typeof err === 'string' ? err : err?.message || String(err)
      }
    } finally {
      if (currentSessionId.value === sessionId) {
        isLoadingRemote.value = false
        isBackgroundRefreshingRemote.value = false
      }
    }
  }

  let lastLocalBgRefresh = 0
  let lastRemoteBgRefresh = 0

  function triggerBackgroundLocalRefresh(changedPath?: string) {
    const now = Date.now()
    if (now - lastLocalBgRefresh < 1500) return
    lastLocalBgRefresh = now
    if (localPath.value) {
      invalidateLocalCache(localPath.value)
      fetchLocalDir(localPath.value, { force: true, background: true }).catch(() => {})
    }
  }

  function triggerBackgroundRemoteRefresh(sessionId: string, changedPath?: string) {
    const now = Date.now()
    if (now - lastRemoteBgRefresh < 1500) return
    lastRemoteBgRefresh = now
    if (sessionId === currentSessionId.value && remotePath.value) {
      invalidateRemoteCache(sessionId, remotePath.value)
      fetchRemoteDir(sessionId, remotePath.value, { force: true, background: true }).catch(() => {})
    }
  }

  return {
    // remote pane
    currentSessionId,
    remotePath,
    remoteFiles,
    selectedRemotePath,
    isLoadingRemote,
    remoteError,
    sessionRemotePaths,
    sessionRemoteFiles,
    isBackgroundRefreshingRemote,
    // local pane
    localPath,
    localFiles,
    selectedLocalPath,
    isLoadingLocal,
    localError,
    isBackgroundRefreshingLocal,
    // git status
    localGitStatus,
    remoteGitStatus,
    fetchLocalGitStatus,
    fetchRemoteGitStatus,
    // connection health
    isSessionDisconnected,
    isAutoReconnecting,
    checkSessionHealth,
    // loading & sessions
    initLocal,
    fetchLocalDir,
    fetchRemoteDir,
    switchSession,
    clearSession,
    // cache
    invalidateRemoteCache,
    invalidateLocalCache,
    clearAllCache,
    triggerBackgroundLocalRefresh,
    triggerBackgroundRemoteRefresh,
  }
}
