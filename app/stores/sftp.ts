import { defineStore } from 'pinia'
import { ref, shallowRef, triggerRef, computed, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useSshStore } from './ssh'
import { useSettingsStore } from './settings'

export interface SftpFileEntry {
  name: string
  path: string
  is_dir: boolean
  is_symlink: boolean
  size: number
  modified: number
  permissions: number
  owner?: string | null
  group?: string | null
}

export interface LocalFileEntry {
  name: string
  path: string
  is_dir: boolean
  is_symlink: boolean
  size: number
  modified: number
}

export interface LocalCrawlTask {
  local_path: string
  remote_path: string
  file_name: string
  size: number
}

export interface LocalCrawlDirectory {
  local_path: string
  remote_path: string
  dir_name: string
}

export interface LocalCrawlIgnored {
  local_path: string
  remote_path: string
  item_name: string
  is_dir: boolean
  matched_pattern: string
}

export interface LocalCrawlResult {
  files: LocalCrawlTask[]
  directories: LocalCrawlDirectory[]
  ignored: LocalCrawlIgnored[]
}

export interface ActiveFolderUploadInfo {
  id: string
  folderName: string
  totalFiles: number
  totalFolders: number
  completedFiles: number
  isScanning: boolean
  isStopping: boolean
  isComplete?: boolean
}

export interface RemoteCrawlTask {
  remote_path: string
  local_path: string
  file_name: string
  size: number
}

export type TransferPriority = 'Lowest' | 'Low' | 'Normal' | 'High' | 'Highest'

export interface TransferItem {
  transfer_id: string
  file_name: string
  direction: 'upload' | 'download'
  bytes_transferred: number
  total_bytes: number
  speed_bytes_per_sec: number
  is_complete: boolean
  is_dir?: boolean
  error?: string
  local_path?: string
  remote_path?: string
  session_id?: string
  server_url?: string
  priority?: TransferPriority
  started_at?: number
  completed_at?: number
  status?: 'queued' | 'transferring' | 'paused' | 'failed' | 'completed'
}

export function getServerUrlForSession(sessionId?: string): string {
  if (!sessionId) return 'sftp://remote'
  try {
    const sshStore = useSshStore()
    const s = sshStore.sessions.find((sess) => sess.sessionId === sessionId)
    if (s) {
      const proto = s.protocol || 'sftp'
      const portPart = s.port && s.port !== 22 && s.port !== 21 ? `:${s.port}` : ''
      return `${proto}://${s.username}@${s.host}${portPart}`
    }
  } catch {}
  return 'sftp://remote'
}

export interface FileConflictInfo {
  exists: boolean
  size: number
  modified: number
}

export type ConflictPolicy = 'ask' | 'overwrite' | 'skip'
export type ConflictDecision = 'overwrite' | 'skip' | 'overwrite-all' | 'skip-all'

export interface ConflictDialogState {
  show: boolean
  fileName: string
  direction: 'download' | 'upload'
  source: { size: number; modified: number; path: string }
  destination: { size: number; modified: number; path: string }
  resolveDecision?: (decision: ConflictDecision) => void
}

export interface CacheEntry<T> {
  timestamp: number
  canonical: string
  entries: T[]
}

export interface GitRepoStatus {
  is_repo: boolean
  root?: string | null
  branch?: string | null
  files: Record<string, string>
}

export interface FetchDirOptions {
  force?: boolean
  background?: boolean
}

export const useSftpStore = defineStore('sftp', () => {
  // Remote State
  const currentSessionId = ref<string | null>(null)
  const remotePath = ref<string>('.')
  const remoteFiles = ref<SftpFileEntry[]>([])
  const selectedRemotePath = ref<string | null>(null)
  const isLoadingRemote = ref(false)
  const remoteError = ref<string | null>(null)

  const transferToast = ref<{ message: string; isError?: boolean; timestamp: number } | null>(null)

  function triggerTransferToast(message: string, isError = false) {
    transferToast.value = { message, isError, timestamp: Date.now() }
  }

  const activeFolderUpload = ref<ActiveFolderUploadInfo | null>(null)

  async function stopActiveFolderUpload() {
    if (!activeFolderUpload.value) return
    activeFolderUpload.value.isStopping = true
    await cancelAllTransfers()
    activeFolderUpload.value = null
    triggerTransferToast('Folder upload stopped by user', false)
  }

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

  // Transfers State & Queue (FileZilla-grade separated buckets with shallow reactivity)
  const activeTransfers = shallowRef<TransferItem[]>([])
  const completedTransfers = shallowRef<TransferItem[]>([])
  const failedTransfers = shallowRef<TransferItem[]>([])
  const transferMap = new Map<string, TransferItem>()
  const activeRunningIds = new Set<string>()

  // Unified transfers getter/setter for backward compatibility and tests
  const transfers = computed<TransferItem[]>({
    get() {
      return [
        ...activeTransfers.value,
        ...completedTransfers.value,
        ...failedTransfers.value,
      ]
    },
    set(newTransfers: TransferItem[]) {
      transferMap.clear()
      activeRunningIds.clear()
      const active: TransferItem[] = []
      const completed: TransferItem[] = []
      const failed: TransferItem[] = []
      for (let i = 0; i < newTransfers.length; i++) {
        const t = newTransfers[i]
        transferMap.set(t.transfer_id, t)
        if (!t.is_complete) {
          active.push(t)
          if (t.status === 'transferring' || (t.speed_bytes_per_sec && t.speed_bytes_per_sec > 0)) {
            activeRunningIds.add(t.transfer_id)
          }
        } else if (t.error) {
          failed.push(t)
        } else {
          completed.push(t)
        }
      }
      activeTransfers.value = active
      completedTransfers.value = completed
      failedTransfers.value = failed
    },
  })

  let pendingNewTransfers: TransferItem[] = []
  let newTransfersTimer: any = null
  let progressFlushScheduled = false

  function flushNewTransfersNow() {
    if (newTransfersTimer) {
      clearTimeout(newTransfersTimer)
      newTransfersTimer = null
    }
    if (pendingNewTransfers.length > 0) {
      activeTransfers.value = [...activeTransfers.value, ...pendingNewTransfers]
      pendingNewTransfers = []
    }
  }

  function scheduleNewTransfersFlush(item: TransferItem) {
    transferMap.set(item.transfer_id, item)
    pendingNewTransfers.push(item)
    if (!newTransfersTimer) {
      newTransfersTimer = setTimeout(flushNewTransfersNow, 60)
    }
  }

  function scheduleProgressFlush() {
    if (progressFlushScheduled) return
    progressFlushScheduled = true
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => {
        progressFlushScheduled = false
        triggerRef(activeTransfers)
      })
    } else {
      setTimeout(() => {
        progressFlushScheduled = false
        triggerRef(activeTransfers)
      }, 40)
    }
  }

  function completeTransferItem(transferId: string, fileSize?: number) {
    activeRunningIds.delete(transferId)
    const item = transferMap.get(transferId)
    if (item) {
      if (!item.error) {
        item.bytes_transferred = item.total_bytes || fileSize || 0
        item.speed_bytes_per_sec = 0
        item.status = 'completed'
        item.is_complete = true
        item.completed_at = Date.now()
        activeTransfers.value = activeTransfers.value.filter((t) => t.transfer_id !== transferId)
        if (!autoRemoveSuccessful.value) {
          completedTransfers.value = [item, ...completedTransfers.value]
        } else {
          transferMap.delete(transferId)
        }
      } else {
        item.status = 'failed'
        item.is_complete = true
        item.completed_at = Date.now()
        item.speed_bytes_per_sec = 0
        activeTransfers.value = activeTransfers.value.filter((t) => t.transfer_id !== transferId)
        failedTransfers.value = [item, ...failedTransfers.value]
      }
      scheduleProgressFlush()
    }
  }

  function failTransferItem(transferId: string, errorMsg: string) {
    activeRunningIds.delete(transferId)
    const item = transferMap.get(transferId)
    if (item) {
      item.is_complete = true
      item.status = 'failed'
      item.completed_at = Date.now()
      item.error = errorMsg
      item.speed_bytes_per_sec = 0
      activeTransfers.value = activeTransfers.value.filter((t) => t.transfer_id !== transferId)
      failedTransfers.value = [item, ...failedTransfers.value]
      scheduleProgressFlush()
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

  const totalTransferSpeed = computed(() => {
    if (activeRunningIds.size > 0) {
      let sum = 0
      for (const id of activeRunningIds) {
        const item = transferMap.get(id)
        if (item?.speed_bytes_per_sec) sum += item.speed_bytes_per_sec
      }
      return sum
    }
    let sum = 0
    const list = activeTransfers.value
    for (let i = 0; i < list.length; i++) {
      if (list[i].speed_bytes_per_sec) sum += list[i].speed_bytes_per_sec
    }
    return sum
  })

  const totalActiveBytes = computed(() => {
    let sum = 0
    const list = activeTransfers.value
    for (let i = 0; i < list.length; i++) {
      sum += (list[i].total_bytes || 0)
    }
    return sum
  })

  const totalTransferredBytes = computed(() => {
    let sum = 0
    const list = activeTransfers.value
    for (let i = 0; i < list.length; i++) {
      sum += (list[i].bytes_transferred || 0)
    }
    return sum
  })

  const overallProgressPercent = computed(() => {
    if (totalActiveBytes.value <= 0) return 0
    return Math.min(100, Math.round((totalTransferredBytes.value / totalActiveBytes.value) * 100))
  })

  // Conflict Resolution
  const conflictPolicy = ref<ConflictPolicy>('ask')
  const batchConflictOverride = ref<'overwrite' | 'skip' | null>(null)
  const activeConflictDialog = ref<ConflictDialogState | null>(null)

  // Transfer Settings
  const maxSimultaneousTransfers = ref<number>(
    typeof window !== 'undefined'
      ? Number(localStorage.getItem('flowsftp_max_transfers')) || 3
      : 3
  )

  if (typeof window !== 'undefined') {
    watch(maxSimultaneousTransfers, (val) => {
      localStorage.setItem('flowsftp_max_transfers', String(val))
    })
  }

  // FileZilla-style Queue Processing & Auto-Remove
  const isQueueProcessing = ref<boolean>(true)
  const autoRemoveSuccessful = ref<boolean>(
    typeof window !== 'undefined'
      ? localStorage.getItem('flowsftp_auto_remove_successful') === 'true'
      : false
  )

  if (typeof window !== 'undefined') {
    watch(autoRemoveSuccessful, (val) => {
      localStorage.setItem('flowsftp_auto_remove_successful', String(val))
    })
  }

  const queueResumeResolvers: (() => void)[] = []

  function notifyQueueResumed() {
    while (queueResumeResolvers.length > 0) {
      const r = queueResumeResolvers.shift()
      if (r) r()
    }
  }

  async function waitIfQueuePaused() {
    while (!isQueueProcessing.value) {
      if (isCancellingAll.value) break
      await new Promise<void>((resolve) => {
        queueResumeResolvers.push(resolve)
      })
    }
  }

  function pauseQueue() {
    isQueueProcessing.value = false
  }

  function processQueue() {
    isQueueProcessing.value = true
    notifyQueueResumed()
  }

  function toggleProcessQueue() {
    if (isQueueProcessing.value) {
      pauseQueue()
    } else {
      processQueue()
    }
  }

  const isCancellingAll = ref(false)
  const activeWorkersNotifiers = new Set<() => void>()

  async function runWithConcurrency<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>
  ): Promise<void> {
    const effectiveLimit = Math.max(1, Math.min(limit, 10))
    let index = 0

    async function next(): Promise<void> {
      while (index < items.length) {
        if (isCancellingAll.value) {
          break
        }
        const item = items[index++]
        try {
          await worker(item)
        } catch (err) {
          console.error('Error in concurrent transfer:', err)
        }
      }
    }

    const pool: Promise<void>[] = []
    for (let i = 0; i < Math.min(effectiveLimit, items.length); i++) {
      pool.push(next())
    }
    await Promise.all(pool)
  }

  function resolveConflict(decision: ConflictDecision) {
    if (decision === 'overwrite-all') {
      batchConflictOverride.value = 'overwrite'
    } else if (decision === 'skip-all') {
      batchConflictOverride.value = 'skip'
    }
    if (activeConflictDialog.value?.resolveDecision) {
      activeConflictDialog.value.resolveDecision(decision)
    }
    activeConflictDialog.value = null
  }

  let conflictQueue: Promise<void> = Promise.resolve()

  async function promptConflictDialog(
    data: Omit<ConflictDialogState, 'show' | 'resolveDecision'>
  ): Promise<ConflictDecision> {
    if (batchConflictOverride.value === 'overwrite') return 'overwrite'
    if (batchConflictOverride.value === 'skip') return 'skip'

    return new Promise<ConflictDecision>((resolve) => {
      conflictQueue = conflictQueue.then(async () => {
        if (batchConflictOverride.value === 'overwrite') {
          resolve('overwrite')
          return
        }
        if (batchConflictOverride.value === 'skip') {
          resolve('skip')
          return
        }
        await new Promise<void>((dialogDone) => {
          activeConflictDialog.value = {
            ...data,
            show: true,
            resolveDecision: (decision) => {
              resolve(decision)
              dialogDone()
            },
          }
        })
      })
    })
  }

  async function initLocal() {
    isLoadingLocal.value = true
    localError.value = null
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('flowsftp_last_local_path') : null
      const defaultPath = saved || (await invoke<string>('sftp_get_default_local_path'))
      await fetchLocalDir(defaultPath)
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

  async function fetchLocalDir(path?: string, options: FetchDirOptions = {}) {
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
        return
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
    } catch (err: any) {
      console.error('Failed to list local directory:', err)
      if (!cached) {
        localError.value = typeof err === 'string' ? err : err?.message || String(err)
      }
    } finally {
      isLoadingLocal.value = false
      isBackgroundRefreshingLocal.value = false
    }
  }

  // Per-session Remote Directory State & Cache
  const sessionRemotePaths = ref<Record<string, string>>({})
  const sessionRemoteFiles = ref<Record<string, SftpFileEntry[]>>({})

  async function switchSession(sessionId: string) {
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

    if (sessionRemoteFiles.value[sessionId] && sessionRemotePaths.value[sessionId]) {
      remotePath.value = sessionRemotePaths.value[sessionId]
      remoteFiles.value = sessionRemoteFiles.value[sessionId]
      fetchRemoteGitStatus(sessionId, remotePath.value)
      fetchRemoteDir(sessionId, remotePath.value)
    } else {
      const saved = typeof window !== 'undefined' ? localStorage.getItem(`flowsftp_last_remote_path_${sessionId}`) : null
      const initialPath = saved || '.'
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

  async function createRemoteFolder(sessionId: string, name: string) {
    const target = remotePath.value.endsWith('/')
      ? `${remotePath.value}${name}`
      : `${remotePath.value}/${name}`
    await invoke('sftp_create_remote_dir', { sessionId, path: target })
    invalidateRemoteCache(sessionId, remotePath.value)
    await fetchRemoteDir(sessionId, remotePath.value, { force: true })
  }

  async function createRemoteFile(sessionId: string, name: string) {
    const target = remotePath.value.endsWith('/')
      ? `${remotePath.value}${name}`
      : `${remotePath.value}/${name}`
    await invoke('sftp_create_remote_file', { sessionId, path: target })
    invalidateRemoteCache(sessionId, remotePath.value)
    await fetchRemoteDir(sessionId, remotePath.value, { force: true })
  }

  async function createLocalFolder(name: string) {
    const target = localPath.value.endsWith('/')
      ? `${localPath.value}${name}`
      : `${localPath.value}/${name}`
    await invoke('sftp_create_local_dir', { path: target })
    invalidateLocalCache(localPath.value)
    await fetchLocalDir(localPath.value, { force: true })
  }

  async function createLocalFile(name: string) {
    const target = localPath.value.endsWith('/')
      ? `${localPath.value}${name}`
      : `${localPath.value}/${name}`
    await invoke('sftp_create_local_file', { path: target })
    invalidateLocalCache(localPath.value)
    await fetchLocalDir(localPath.value, { force: true })
  }

  async function deleteRemoteItem(
    sessionId: string,
    item: SftpFileEntry,
    deletionId?: string,
    skipRefresh: boolean = false,
    useFastRm: boolean = false
  ) {
    console.log('[Store] deleteRemoteItem invoking backend:', { sessionId, path: item.path, is_dir: item.is_dir, deletionId, useFastRm })
    try {
      if (item.is_dir) {
        await invoke('sftp_remove_remote_dir', {
          sessionId,
          path: item.path,
          deletionId: deletionId || null,
          useFastRm: !!useFastRm,
        })
        invalidateRemoteCache(sessionId, item.path)
      } else {
        await invoke('sftp_remove_remote_file', { sessionId, path: item.path, deletionId: deletionId || null })
      }
      console.log('[Store] deleteRemoteItem success:', item.path)
    } catch (err) {
      console.error('[Store] deleteRemoteItem failed:', item.path, err)
      throw err
    }
    invalidateRemoteCache(sessionId, remotePath.value)
    if (!skipRefresh) {
      await fetchRemoteDir(sessionId, remotePath.value, { force: true })
    }
  }

  async function deleteLocalItem(item: LocalFileEntry, skipRefresh: boolean = false) {
    console.log('[Store] deleteLocalItem invoking backend:', { path: item.path, is_dir: item.is_dir })
    try {
      await invoke('sftp_remove_local', { path: item.path })
      console.log('[Store] deleteLocalItem success:', item.path)
    } catch (err) {
      console.error('[Store] deleteLocalItem failed:', item.path, err)
      throw err
    }
    if (item.is_dir) {
      invalidateLocalCache(item.path)
    }
    invalidateLocalCache(localPath.value)
    if (!skipRefresh) {
      await fetchLocalDir(localPath.value, { force: true })
    }
  }

  async function renameRemoteItem(sessionId: string, oldPath: string, newPath: string) {
    await invoke('sftp_rename_remote', { sessionId, oldPath, newPath })
    invalidateRemoteCache(sessionId, remotePath.value)
    invalidateRemoteCache(sessionId, oldPath)
    invalidateRemoteCache(sessionId, newPath)
    await fetchRemoteDir(sessionId, remotePath.value, { force: true })
  }

  async function renameLocalItem(oldPath: string, newPath: string) {
    await invoke('sftp_rename_local', { oldPath, newPath })
    invalidateLocalCache(localPath.value)
    invalidateLocalCache(oldPath)
    invalidateLocalCache(newPath)
    await fetchLocalDir(localPath.value, { force: true })
  }

  async function determineConflictAction(
    direction: 'download' | 'upload',
    fileName: string,
    sourceMeta: { size: number; modified: number; path: string },
    destinationPath: string,
    sessionId?: string
  ): Promise<'overwrite' | 'skip'> {
    if (batchConflictOverride.value === 'overwrite') {
      return 'overwrite'
    }

    if (conflictPolicy.value === 'overwrite' && !batchConflictOverride.value) {
      return 'overwrite'
    }

    try {
      const isRemote = direction === 'upload'
      const conflictInfo = await invoke<FileConflictInfo>('sftp_check_conflict', {
        sessionId: isRemote ? (sessionId || null) : null,
        path: destinationPath,
        isRemote,
      })

      if (!conflictInfo.exists) {
        return 'overwrite'
      }

      if (batchConflictOverride.value === 'skip') {
        return 'skip'
      }

      if (conflictPolicy.value === 'skip') {
        return 'skip'
      }

      const decision = await promptConflictDialog({
        fileName,
        direction,
        source: sourceMeta,
        destination: {
          size: conflictInfo.size,
          modified: conflictInfo.modified,
          path: destinationPath,
        },
      })

      if (decision === 'overwrite-all') {
        batchConflictOverride.value = 'overwrite'
        return 'overwrite'
      } else if (decision === 'skip-all') {
        batchConflictOverride.value = 'skip'
        return 'skip'
      } else if (decision === 'skip') {
        return 'skip'
      } else {
        return 'overwrite'
      }
    } catch (err) {
      console.warn('Failed to check conflict, defaulting to overwrite:', err)
      return 'overwrite'
    }
  }

  interface DownloadTask {
    file: SftpFileEntry
    targetParent: string
    transferId: string
    targetLocal: string
  }

  interface UploadTask {
    file: LocalFileEntry
    targetParent: string
    transferId: string
    targetRemote: string
  }

  async function ensureTransferReady() {
    if (isCancellingAll.value) {
      isCancellingAll.value = false
      try {
        await invoke('sftp_reset_cancel_transfers')
      } catch {}
    }
  }

  async function collectRemoteDownloadTasks(
    sessionId: string,
    items: SftpFileEntry[],
    targetLocalParent: string,
    onTaskFound: (task: DownloadTask) => void
  ): Promise<void> {
    for (const item of items) {
      if (isCancellingAll.value) return
      if (item.is_dir) {
        const cleanParent = targetLocalParent.replace(/\\/g, '/').replace(/\/+$/, '')
        const localDirPath = `${cleanParent}/${item.name}`
        try {
          await invoke('sftp_create_local_dir', { path: localDirPath })
          triggerBackgroundLocalRefresh(localDirPath)
          const [, children] = await invoke<[string, SftpFileEntry[]]>('sftp_list_remote', {
            sessionId,
            path: item.path,
          })
          await collectRemoteDownloadTasks(sessionId, children, localDirPath, onTaskFound)
        } catch (err) {
          console.error(`Failed to scan remote directory ${item.path}:`, err)
        }
      } else {
        const cleanLocalDir = targetLocalParent.replace(/\\/g, '/').replace(/\/+$/, '')
        const targetLocal = `${cleanLocalDir}/${item.name}`
        const transferId = `dl-${Date.now()}-${Math.random().toString(36).substring(2, 7)}-${Math.floor(Math.random() * 100000)}`
        onTaskFound({ file: item, targetParent: targetLocalParent, transferId, targetLocal })
      }
    }
  }

  async function collectLocalUploadTasks(
    sessionId: string,
    items: LocalFileEntry[],
    targetRemoteParent: string,
    onTaskFound: (task: UploadTask) => void
  ): Promise<void> {
    for (const item of items) {
      if (isCancellingAll.value) return
      if (item.is_dir) {
        const cleanParent = targetRemoteParent.replace(/\/+$/, '')
        const remoteDirPath = cleanParent === '' ? item.name : `${cleanParent}/${item.name}`
        try {
          await invoke('sftp_create_remote_dir', { sessionId, path: remoteDirPath })
          triggerBackgroundRemoteRefresh(sessionId, remoteDirPath)
          const [, children] = await invoke<[string, LocalFileEntry[]]>('sftp_list_local', {
            dirPath: item.path,
          })
          await collectLocalUploadTasks(sessionId, children, remoteDirPath, onTaskFound)
        } catch (err) {
          console.error(`Failed to scan local directory ${item.path}:`, err)
        }
      } else {
        const cleanRemoteDir = targetRemoteParent.replace(/\/+$/, '')
        const targetRemote = cleanRemoteDir === '' ? item.name : `${cleanRemoteDir}/${item.name}`
        const transferId = `ul-${Date.now()}-${Math.random().toString(36).substring(2, 7)}-${Math.floor(Math.random() * 100000)}`
        onTaskFound({ file: item, targetParent: targetRemoteParent, transferId, targetRemote })
      }
    }
  }

  async function startDownload(
    sessionId: string,
    remoteFile: SftpFileEntry,
    targetLocalParent?: string,
    options: { skipRefresh?: boolean; preEnqueuedTransferId?: string; exactLocalPath?: string } = {}
  ) {
    if (remoteFile.is_dir) {
      return startBatchDownload(sessionId, [remoteFile], targetLocalParent)
    }
    if (activeTransfers.value.length === 0) {
      await ensureTransferReady()
    }
    let baseLocal = targetLocalParent || localPath.value
    if (!baseLocal) {
      await initLocal()
      baseLocal = targetLocalParent || localPath.value
    }
    if (!baseLocal) {
      baseLocal = await invoke<string>('sftp_get_default_local_path')
      localPath.value = baseLocal
    }

    const cleanLocalDir = baseLocal.replace(/\\/g, '/').replace(/\/+$/, '')
    const targetLocal = options.exactLocalPath || `${cleanLocalDir}/${remoteFile.name}`
    const transferId = options.preEnqueuedTransferId || `dl-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`

    const conflictAction = await determineConflictAction(
      'download',
      remoteFile.name,
      { size: remoteFile.size, modified: remoteFile.modified, path: remoteFile.path },
      targetLocal
    )

    if (conflictAction === 'skip') {
      let item = transferMap.get(transferId)
      if (item) {
        item.is_complete = true
        item.completed_at = Date.now()
        item.error = 'Skipped (file exists)'
        item.bytes_transferred = remoteFile.size
        item.status = 'failed'
        activeTransfers.value = activeTransfers.value.filter((t) => t.transfer_id !== transferId)
        failedTransfers.value = [item, ...failedTransfers.value]
      } else {
        item = {
          transfer_id: transferId,
          file_name: remoteFile.name,
          direction: 'download',
          bytes_transferred: remoteFile.size,
          total_bytes: remoteFile.size,
          speed_bytes_per_sec: 0,
          is_complete: true,
          error: 'Skipped (file exists)',
          local_path: targetLocal,
          remote_path: remoteFile.path,
          session_id: sessionId,
          server_url: getServerUrlForSession(sessionId),
          priority: 'Normal',
          started_at: Date.now(),
          completed_at: Date.now(),
          status: 'failed',
        }
        transferMap.set(transferId, item)
        failedTransfers.value = [item, ...failedTransfers.value]
      }
      scheduleProgressFlush()
      return
    }

    if (!options.preEnqueuedTransferId) {
      const item: TransferItem = {
        transfer_id: transferId,
        file_name: remoteFile.name,
        direction: 'download',
        bytes_transferred: 0,
        total_bytes: remoteFile.size,
        speed_bytes_per_sec: 0,
        is_complete: false,
        local_path: targetLocal,
        remote_path: remoteFile.path,
        session_id: sessionId,
        server_url: getServerUrlForSession(sessionId),
        priority: 'Normal',
        started_at: Date.now(),
        status: 'queued',
      }
      transferMap.set(transferId, item)
      activeTransfers.value = [item, ...activeTransfers.value]
      scheduleProgressFlush()
    }

    let unlisten: (() => void) | null = null
    try {
      unlisten = await listen<TransferItem>(`sftp:progress:${transferId}`, (event) => {
        const item = transferMap.get(transferId)
        if (item) {
          activeRunningIds.add(transferId)
          item.status = 'transferring'
          item.bytes_transferred = event.payload.bytes_transferred
          item.total_bytes = event.payload.total_bytes || item.total_bytes
          item.speed_bytes_per_sec = event.payload.speed_bytes_per_sec
          if (event.payload.error) {
            item.error = event.payload.error
            item.status = 'failed'
          }
          scheduleProgressFlush()
        }
      })
    } catch (listenErr) {
      console.warn('Failed to attach download progress listener:', listenErr)
    }

    try {
      const currentItem = transferMap.get(transferId)
      if (currentItem) {
        currentItem.status = 'transferring'
        currentItem.started_at = Date.now()
        activeRunningIds.add(transferId)
        scheduleProgressFlush()
      }

      await invoke('sftp_download', {
        sessionId,
        transferId,
        remotePath: remoteFile.path,
        localPath: targetLocal,
        fileSize: remoteFile.size || null,
        conflictAction,
      })

      completeTransferItem(transferId, remoteFile.size)

      // Smooth background refresh of local folder during downloads
      triggerBackgroundLocalRefresh(targetLocal)

      if (!options.skipRefresh && localPath.value) {
        invalidateLocalCache(targetLocal)
        invalidateLocalCache(localPath.value)
        await fetchLocalDir(localPath.value, { force: true })
      }
    } catch (err: any) {
      failTransferItem(transferId, err?.message || String(err))
      throw err
    } finally {
      if (unlisten) {
        unlisten()
        unlisten = null
      }
    }
  }

  async function startBatchDownload(sessionId: string, files: SftpFileEntry[], destinationDir?: string) {
    if (!localPath.value) {
      await initLocal()
    }
    const targetDir = destinationDir || localPath.value
    batchConflictOverride.value = null
    await ensureTransferReady()

    const taskQueue: DownloadTask[] = []
    const queuedIds = new Set<string>()
    let isScanning = true
    const waitingWorkers: (() => void)[] = []

    function notifyWorkers() {
      while (waitingWorkers.length > 0) {
        const resolve = waitingWorkers.shift()
        if (resolve) resolve()
      }
    }

    activeWorkersNotifiers.add(notifyWorkers)

    function onTaskFound(task: DownloadTask) {
      if (queuedIds.has(task.transferId)) return
      queuedIds.add(task.transferId)
      taskQueue.push(task)

      const newItem: TransferItem = {
        transfer_id: task.transferId,
        file_name: task.file.name,
        direction: 'download',
        bytes_transferred: 0,
        total_bytes: task.file.size || 0,
        speed_bytes_per_sec: 0,
        is_complete: false,
        local_path: task.targetLocal,
        remote_path: task.file.path,
        session_id: sessionId,
        server_url: getServerUrlForSession(sessionId),
        priority: 'Normal',
        started_at: Date.now(),
        status: 'queued',
      }
      scheduleNewTransfersFlush(newItem)
      notifyWorkers()
    }

    function finishScanning() {
      isScanning = false
      flushNewTransfersNow()
      notifyWorkers()
    }

    const settingsStore = useSettingsStore()
    const ignoreFilterActive = settingsStore.enableTransferIgnoreFilter
    const ignorePatterns = ignoreFilterActive ? settingsStore.transferIgnorePatterns : []

    // 1. Immediately enqueue only root-level regular files (recording ignored files if enabled)
    const ignoredDirectDownloads: { name: string; is_dir: boolean; pattern: string }[] = []
    for (const f of files) {
      if (!f.is_dir) {
        if (ignoreFilterActive && settingsStore.isPatternIgnored(f.name)) {
          const matchedPat = settingsStore.getMatchedIgnorePattern(f.name) || f.name
          const cleanLocalDir = targetDir.replace(/\\/g, '/').replace(/\/+$/, '')
          const targetLocal = `${cleanLocalDir}/${f.name}`
          const transferId = `ign-dl-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
          const ignoredItem: TransferItem = {
            transfer_id: transferId,
            file_name: f.name,
            direction: 'download',
            bytes_transferred: 0,
            total_bytes: f.size || 0,
            speed_bytes_per_sec: 0,
            is_complete: true,
            is_dir: false,
            error: `Ignored (filter rule: ${matchedPat})`,
            local_path: targetLocal,
            remote_path: f.path,
            session_id: sessionId,
            server_url: getServerUrlForSession(sessionId),
            priority: 'Normal',
            started_at: Date.now(),
            completed_at: Date.now(),
            status: 'failed',
          }
          transferMap.set(transferId, ignoredItem)
          failedTransfers.value = [ignoredItem, ...failedTransfers.value]
          ignoredDirectDownloads.push({ name: f.name, is_dir: false, pattern: matchedPat })
          continue
        }
        const cleanLocalDir = targetDir.replace(/\\/g, '/').replace(/\/+$/, '')
        const targetLocal = `${cleanLocalDir}/${f.name}`
        const transferId = `dl-${Date.now()}-${Math.random().toString(36).substring(2, 7)}-${taskQueue.length}`
        onTaskFound({ file: f, targetParent: targetDir, transferId, targetLocal })
      }
    }

    // 2. Filter directories: if a root directory itself is ignored, record it as ignored
    const dirItems: SftpFileEntry[] = []
    for (const f of files) {
      if (f.is_dir) {
        if (ignoreFilterActive && settingsStore.isPatternIgnored(f.name)) {
          const matchedPat = settingsStore.getMatchedIgnorePattern(f.name) || f.name
          const cleanLocalDir = targetDir.replace(/\\/g, '/').replace(/\/+$/, '')
          const targetLocal = `${cleanLocalDir}/${f.name}`
          const transferId = `ign-dl-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
          const ignoredItem: TransferItem = {
            transfer_id: transferId,
            file_name: f.name,
            direction: 'download',
            bytes_transferred: 0,
            total_bytes: 0,
            speed_bytes_per_sec: 0,
            is_complete: true,
            is_dir: true,
            error: `Ignored (filter rule: ${matchedPat})`,
            local_path: targetLocal,
            remote_path: f.path,
            session_id: sessionId,
            server_url: getServerUrlForSession(sessionId),
            priority: 'Normal',
            started_at: Date.now(),
            completed_at: Date.now(),
            status: 'failed',
          }
          transferMap.set(transferId, ignoredItem)
          failedTransfers.value = [ignoredItem, ...failedTransfers.value]
          ignoredDirectDownloads.push({ name: f.name, is_dir: true, pattern: matchedPat })
          continue
        }
        dirItems.push(f)
      }
    }

    if (ignoredDirectDownloads.length > 0) {
      const folders = ignoredDirectDownloads.filter((i) => i.is_dir)
      const count = ignoredDirectDownloads.length
      const sample = ignoredDirectDownloads[0].name
      triggerTransferToast(`Transfer filter: Ignored ${count} item${count > 1 ? 's' : ''} (${sample}${count > 1 ? '…' : ''})`)
    }
    const scanPromise = (async () => {
      try {
        if (dirItems.length > 0) {
          try {
            // Fast Native Remote Crawler: walks remote SFTP tree in Rust
            const crawled = await invoke<RemoteCrawlTask[]>('sftp_crawl_remote_paths', {
              sessionId,
              paths: dirItems.map((d) => d.path),
              targetLocalDir: targetDir,
              ignorePatterns,
            })
            for (let i = 0; i < crawled.length; i++) {
              if (isCancellingAll.value) break
              const c = crawled[i]
              const transferId = `dl-${Date.now()}-${Math.random().toString(36).substring(2, 7)}-${taskQueue.length}`
              const fileEntry: SftpFileEntry = {
                name: c.file_name,
                path: c.remote_path,
                is_dir: false,
                is_symlink: false,
                size: c.size,
                modified: 0,
                permissions: 0o644,
              }
              onTaskFound({
                file: fileEntry,
                targetParent: targetDir,
                transferId,
                targetLocal: c.local_path,
              })
            }
          } catch (crawlErr) {
            console.warn('Native remote crawl failed, falling back to JS crawler:', crawlErr)
            await collectRemoteDownloadTasks(sessionId, dirItems, targetDir, onTaskFound)
          }
        }
      } catch (scanErr) {
        console.error('Directory scanning error:', scanErr)
      } finally {
        finishScanning()
      }
    })()

    // 3. Worker implementation
    async function worker(): Promise<void> {
      while (true) {
        if (isCancellingAll.value) break
        await waitIfQueuePaused()
        if (isCancellingAll.value) break
        if (taskQueue.length > 0) {
          const task = taskQueue.shift()!
          try {
            await startDownload(sessionId, task.file, task.targetParent, {
              skipRefresh: true,
              preEnqueuedTransferId: task.transferId,
              exactLocalPath: task.targetLocal,
            })
          } catch (err) {
            console.error('Download worker error:', err)
          }
        } else if (!isScanning) {
          break
        } else {
          await new Promise<void>((resolve) => {
            waitingWorkers.push(resolve)
          })
        }
      }
    }

    const concurrency = Math.max(1, Math.min(maxSimultaneousTransfers.value || 3, 10))
    const workerPromises = Array.from({ length: concurrency }, () => worker())

    try {
      await Promise.all([scanPromise, ...workerPromises])
    } finally {
      flushNewTransfersNow()
      activeWorkersNotifiers.delete(notifyWorkers)
      batchConflictOverride.value = null
    }

    // Refresh directory ONCE at the end of the batch (FileZilla style)
    if (localPath.value) {
      invalidateLocalCache(targetDir)
      invalidateLocalCache(localPath.value)
      await fetchLocalDir(localPath.value, { force: true })
    }
  }

  async function startUpload(
    sessionId: string,
    localFile: LocalFileEntry,
    targetRemoteParent?: string,
    options: { skipRefresh?: boolean; preEnqueuedTransferId?: string; exactRemotePath?: string } = {}
  ) {
    if (localFile.is_dir) {
      return startBatchUpload(sessionId, [localFile], targetRemoteParent)
    }
    if (activeTransfers.value.length === 0) {
      await ensureTransferReady()
    }
    const baseRemote = targetRemoteParent || remotePath.value || '.'
    const cleanRemoteDir = baseRemote.replace(/\/+$/, '')
    const targetRemote = options.exactRemotePath || (cleanRemoteDir === '' ? localFile.name : `${cleanRemoteDir}/${localFile.name}`)
    const transferId = options.preEnqueuedTransferId || `ul-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`

    const conflictAction = await determineConflictAction(
      'upload',
      localFile.name,
      { size: localFile.size, modified: localFile.modified, path: localFile.path },
      targetRemote,
      sessionId
    )

    if (conflictAction === 'skip') {
      let item = transferMap.get(transferId)
      if (item) {
        item.is_complete = true
        item.completed_at = Date.now()
        item.error = 'Skipped (file exists)'
        item.bytes_transferred = localFile.size
        item.status = 'failed'
        activeTransfers.value = activeTransfers.value.filter((t) => t.transfer_id !== transferId)
        failedTransfers.value = [item, ...failedTransfers.value]
      } else {
        item = {
          transfer_id: transferId,
          file_name: localFile.name,
          direction: 'upload',
          bytes_transferred: localFile.size,
          total_bytes: localFile.size,
          speed_bytes_per_sec: 0,
          is_complete: true,
          error: 'Skipped (file exists)',
          local_path: localFile.path,
          remote_path: targetRemote,
          session_id: sessionId,
          server_url: getServerUrlForSession(sessionId),
          priority: 'Normal',
          started_at: Date.now(),
          completed_at: Date.now(),
          status: 'failed',
        }
        transferMap.set(transferId, item)
        failedTransfers.value = [item, ...failedTransfers.value]
      }
      scheduleProgressFlush()
      return
    }

    if (!options.preEnqueuedTransferId) {
      const item: TransferItem = {
        transfer_id: transferId,
        file_name: localFile.name,
        direction: 'upload',
        bytes_transferred: 0,
        total_bytes: localFile.size,
        speed_bytes_per_sec: 0,
        is_complete: false,
        local_path: localFile.path,
        remote_path: targetRemote,
        session_id: sessionId,
        server_url: getServerUrlForSession(sessionId),
        priority: 'Normal',
        started_at: Date.now(),
        status: 'queued',
      }
      transferMap.set(transferId, item)
      activeTransfers.value = [item, ...activeTransfers.value]
      scheduleProgressFlush()
    }

    let unlisten: (() => void) | null = null
    try {
      unlisten = await listen<TransferItem>(`sftp:progress:${transferId}`, (event) => {
        const item = transferMap.get(transferId)
        if (item) {
          activeRunningIds.add(transferId)
          item.status = 'transferring'
          item.bytes_transferred = event.payload.bytes_transferred
          item.total_bytes = event.payload.total_bytes || item.total_bytes
          item.speed_bytes_per_sec = event.payload.speed_bytes_per_sec
          if (event.payload.error) {
            item.error = event.payload.error
            item.status = 'failed'
          }
          scheduleProgressFlush()
        }
      })
    } catch (listenErr) {
      console.warn('Failed to attach upload progress listener:', listenErr)
    }

    try {
      const currentItem = transferMap.get(transferId)
      if (currentItem) {
        currentItem.status = 'transferring'
        currentItem.started_at = Date.now()
        activeRunningIds.add(transferId)
        scheduleProgressFlush()
      }

      await invoke('sftp_upload', {
        sessionId,
        transferId,
        localPath: localFile.path,
        remotePath: targetRemote,
        fileSize: localFile.size || null,
        conflictAction,
      })

      completeTransferItem(transferId, localFile.size)

      // Smooth background refresh of remote folder during uploads
      triggerBackgroundRemoteRefresh(sessionId, targetRemote)

      if (!options.skipRefresh && remotePath.value) {
        invalidateRemoteCache(sessionId, targetRemote)
        invalidateRemoteCache(sessionId, remotePath.value)
        await fetchRemoteDir(sessionId, remotePath.value, { force: true })
      }
    } catch (err: any) {
      failTransferItem(transferId, err?.message || String(err))
      throw err
    } finally {
      if (unlisten) {
        unlisten()
        unlisten = null
      }
    }
  }

  async function startBatchUpload(sessionId: string, files: LocalFileEntry[], destinationDir?: string) {
    const targetDir = destinationDir || remotePath.value
    batchConflictOverride.value = null
    await ensureTransferReady()

    const taskQueue: UploadTask[] = []
    const queuedIds = new Set<string>()
    let isScanning = true
    const waitingWorkers: (() => void)[] = []

    function notifyWorkers() {
      while (waitingWorkers.length > 0) {
        const resolve = waitingWorkers.shift()
        if (resolve) resolve()
      }
    }

    activeWorkersNotifiers.add(notifyWorkers)

    function onTaskFound(task: UploadTask) {
      if (queuedIds.has(task.transferId)) return
      queuedIds.add(task.transferId)
      taskQueue.push(task)

      const newItem: TransferItem = {
        transfer_id: task.transferId,
        file_name: task.file.name,
        direction: 'upload',
        bytes_transferred: 0,
        total_bytes: task.file.size || 0,
        speed_bytes_per_sec: 0,
        is_complete: false,
        local_path: task.file.path,
        remote_path: task.targetRemote,
        session_id: sessionId,
        server_url: getServerUrlForSession(sessionId),
        priority: 'Normal',
        started_at: Date.now(),
        status: 'queued',
      }
      scheduleNewTransfersFlush(newItem)
      notifyWorkers()
    }

    function finishScanning() {
      isScanning = false
      flushNewTransfersNow()
      notifyWorkers()
    }

    const settingsStore = useSettingsStore()
    const ignoreFilterActive = settingsStore.enableTransferIgnoreFilter
    const ignorePatterns = ignoreFilterActive ? settingsStore.transferIgnorePatterns : []

    // 1. Immediately enqueue only root-level regular files (recording ignored files if enabled)
    const ignoredDirectUploads: { name: string; is_dir: boolean; pattern: string }[] = []
    for (const f of files) {
      if (!f.is_dir) {
        if (ignoreFilterActive && settingsStore.isPatternIgnored(f.name)) {
          const matchedPat = settingsStore.getMatchedIgnorePattern(f.name) || f.name
          const cleanRemoteDir = targetDir.replace(/\/+$/, '')
          const targetRemote = cleanRemoteDir === ''
            ? (targetDir.startsWith('/') ? `/${f.name}` : f.name)
            : `${cleanRemoteDir}/${f.name}`
          const transferId = `ign-ul-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
          const ignoredItem: TransferItem = {
            transfer_id: transferId,
            file_name: f.name,
            direction: 'upload',
            bytes_transferred: 0,
            total_bytes: f.size || 0,
            speed_bytes_per_sec: 0,
            is_complete: true,
            is_dir: false,
            error: `Ignored (filter rule: ${matchedPat})`,
            local_path: f.path,
            remote_path: targetRemote,
            session_id: sessionId,
            server_url: getServerUrlForSession(sessionId),
            priority: 'Normal',
            started_at: Date.now(),
            completed_at: Date.now(),
            status: 'failed',
          }
          transferMap.set(transferId, ignoredItem)
          failedTransfers.value = [ignoredItem, ...failedTransfers.value]
          ignoredDirectUploads.push({ name: f.name, is_dir: false, pattern: matchedPat })
          continue
        }
        const cleanRemoteDir = targetDir.replace(/\/+$/, '')
        const targetRemote = cleanRemoteDir === ''
          ? (targetDir.startsWith('/') ? `/${f.name}` : f.name)
          : `${cleanRemoteDir}/${f.name}`
        const transferId = `ul-${Date.now()}-${Math.random().toString(36).substring(2, 7)}-${taskQueue.length}`
        onTaskFound({ file: f, targetParent: targetDir, transferId, targetRemote })
      }
    }

    // 2. Filter directories: if a root directory itself is ignored (e.g. node_modules), record it as ignored
    const dirItems: LocalFileEntry[] = []
    for (const f of files) {
      if (f.is_dir) {
        if (ignoreFilterActive && settingsStore.isPatternIgnored(f.name)) {
          const matchedPat = settingsStore.getMatchedIgnorePattern(f.name) || f.name
          const cleanRemoteDir = targetDir.replace(/\/+$/, '')
          const targetRemote = cleanRemoteDir === ''
            ? (targetDir.startsWith('/') ? `/${f.name}` : f.name)
            : `${cleanRemoteDir}/${f.name}`
          const transferId = `ign-ul-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
          const ignoredItem: TransferItem = {
            transfer_id: transferId,
            file_name: f.name,
            direction: 'upload',
            bytes_transferred: 0,
            total_bytes: 0,
            speed_bytes_per_sec: 0,
            is_complete: true,
            is_dir: true,
            error: `Ignored (filter rule: ${matchedPat})`,
            local_path: f.path,
            remote_path: targetRemote,
            session_id: sessionId,
            server_url: getServerUrlForSession(sessionId),
            priority: 'Normal',
            started_at: Date.now(),
            completed_at: Date.now(),
            status: 'failed',
          }
          transferMap.set(transferId, ignoredItem)
          failedTransfers.value = [ignoredItem, ...failedTransfers.value]
          ignoredDirectUploads.push({ name: f.name, is_dir: true, pattern: matchedPat })
          continue
        }
        dirItems.push(f)
      }
    }

    if (ignoredDirectUploads.length > 0) {
      const folders = ignoredDirectUploads.filter((i) => i.is_dir)
      const count = ignoredDirectUploads.length
      const sample = ignoredDirectUploads[0].name
      triggerTransferToast(`Transfer filter: Ignored ${count} item${count > 1 ? 's' : ''} (${sample}${count > 1 ? '…' : ''})`)
    }

    if (dirItems.length > 0) {
      const folderTitle = dirItems.length > 1
        ? `${dirItems[0].name} (+${dirItems.length - 1} folders)`
        : dirItems[0].name

      activeFolderUpload.value = {
        id: `folder-ul-${Date.now()}`,
        folderName: folderTitle,
        totalFiles: 0,
        totalFolders: dirItems.length,
        completedFiles: 0,
        isScanning: true,
        isStopping: false,
        isComplete: false,
      }
    }

    const scanPromise = (async () => {
      try {
        if (dirItems.length > 0) {
          try {
            // Fast Native Crawler: scans 10k+ files in ~20ms in parallel on local disk
            const crawled = await invoke<LocalCrawlResult | LocalCrawlTask[]>('sftp_crawl_local_paths', {
              paths: dirItems.map((d) => d.path),
              targetRemoteDir: targetDir,
              ignorePatterns,
            })

            const filesList: LocalCrawlTask[] = Array.isArray(crawled) ? crawled : (crawled.files || [])
            const dirsList: LocalCrawlDirectory[] = Array.isArray(crawled) ? [] : (crawled.directories || [])
            const ignoredList: LocalCrawlIgnored[] = Array.isArray(crawled) ? [] : (crawled.ignored || [])

            if (activeFolderUpload.value) {
              activeFolderUpload.value.totalFiles = filesList.length
              activeFolderUpload.value.totalFolders = Math.max(dirsList.length, dirItems.length)
              activeFolderUpload.value.isScanning = false
            }

            // Step A: Immediately create all remote directories (ensures parent folders like 3005 and empty subfolders exist!)
            for (const d of dirsList) {
              if (isCancellingAll.value) break
              try {
                await invoke('sftp_create_remote_dir', { sessionId, path: d.remote_path })
              } catch (dirErr) {
                console.warn(`Failed to create remote directory ${d.remote_path}:`, dirErr)
              }
            }

            // Step B: Record all ignored subfolders/files in the failed/skipped transfers queue so users see them
            for (const ign of ignoredList) {
              if (isCancellingAll.value) break
              const transferId = `ign-ul-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
              const ignoredItem: TransferItem = {
                transfer_id: transferId,
                file_name: ign.item_name,
                direction: 'upload',
                bytes_transferred: 0,
                total_bytes: 0,
                speed_bytes_per_sec: 0,
                is_complete: true,
                is_dir: ign.is_dir,
                error: `Ignored (filter rule: ${ign.matched_pattern})`,
                local_path: ign.local_path,
                remote_path: ign.remote_path,
                session_id: sessionId,
                server_url: getServerUrlForSession(sessionId),
                priority: 'Normal',
                started_at: Date.now(),
                completed_at: Date.now(),
                status: 'failed',
              }
              transferMap.set(transferId, ignoredItem)
              failedTransfers.value = [ignoredItem, ...failedTransfers.value]
            }

            if (ignoredList.length > 0) {
              const folders = ignoredList.filter((i) => i.is_dir)
              const sampleFolder = folders.length > 0 ? folders[0].item_name : ''
              const msg = folders.length > 0
                ? `Transfer filter: Ignored ${folders.length} folder${folders.length > 1 ? 's' : ''} (${sampleFolder}${folders.length > 1 ? '…' : ''}) in upload`
                : `Transfer filter: Ignored ${ignoredList.length} item(s) matching ignore rules`
              triggerTransferToast(msg)
            }

            // Step C: Enqueue crawled regular files for transfer
            for (let i = 0; i < filesList.length; i++) {
              if (isCancellingAll.value) break
              const c = filesList[i]
              const transferId = `ul-${Date.now()}-${Math.random().toString(36).substring(2, 7)}-${taskQueue.length}`
              const fileEntry: LocalFileEntry = {
                name: c.file_name,
                path: c.local_path,
                is_dir: false,
                is_symlink: false,
                size: c.size,
                modified: 0,
              }
              onTaskFound({
                file: fileEntry,
                targetParent: targetDir,
                transferId,
                targetRemote: c.remote_path,
              })
            }
          } catch (crawlErr) {
            console.warn('Native local crawl failed, falling back to JS crawler:', crawlErr)
            await collectLocalUploadTasks(sessionId, dirItems, targetDir, onTaskFound)
            if (activeFolderUpload.value) {
              activeFolderUpload.value.totalFiles = taskQueue.length
              activeFolderUpload.value.isScanning = false
            }
          }
        }
      } catch (scanErr) {
        console.error('Local directory scanning error:', scanErr)
      } finally {
        finishScanning()
      }
    })()

    // 3. Worker implementation
    async function worker(): Promise<void> {
      while (true) {
        if (isCancellingAll.value) break
        await waitIfQueuePaused()
        if (isCancellingAll.value) break
        if (taskQueue.length > 0) {
          const task = taskQueue.shift()!
          try {
            await startUpload(sessionId, task.file, task.targetParent, {
              skipRefresh: true,
              preEnqueuedTransferId: task.transferId,
              exactRemotePath: task.targetRemote,
            })
            if (activeFolderUpload.value) {
              activeFolderUpload.value.completedFiles++
            }
          } catch (err) {
            console.error('Upload worker error:', err)
          }
        } else if (!isScanning) {
          break
        } else {
          await new Promise<void>((resolve) => {
            waitingWorkers.push(resolve)
          })
        }
      }
    }

    const concurrency = Math.max(1, Math.min(maxSimultaneousTransfers.value || 3, 10))
    const workerPromises = Array.from({ length: concurrency }, () => worker())

    try {
      await Promise.all([scanPromise, ...workerPromises])
    } finally {
      flushNewTransfersNow()
      activeWorkersNotifiers.delete(notifyWorkers)
      batchConflictOverride.value = null
      if (activeFolderUpload.value && !activeFolderUpload.value.isStopping && !isCancellingAll.value) {
        activeFolderUpload.value.isComplete = true
        setTimeout(() => {
          if (activeFolderUpload.value?.isComplete) {
            activeFolderUpload.value = null
          }
        }, 3200)
      } else {
        activeFolderUpload.value = null
      }
    }

    // Refresh directory ONCE at the end of the batch (FileZilla style)
    if (sessionId && remotePath.value) {
      invalidateRemoteCache(sessionId, targetDir)
      invalidateRemoteCache(sessionId, remotePath.value)
      await fetchRemoteDir(sessionId, remotePath.value, { force: true })
    }
  }

  function clearCompletedTransfers() {
    for (const t of completedTransfers.value) {
      transferMap.delete(t.transfer_id)
    }
    completedTransfers.value = []
  }

  function clearFailedTransfers() {
    for (const t of failedTransfers.value) {
      transferMap.delete(t.transfer_id)
    }
    failedTransfers.value = []
  }

  function clearAllTransfers() {
    for (const t of completedTransfers.value) {
      transferMap.delete(t.transfer_id)
    }
    for (const t of failedTransfers.value) {
      transferMap.delete(t.transfer_id)
    }
    completedTransfers.value = []
    failedTransfers.value = []
  }

  function removeTransfer(transferId: string) {
    const item = transferMap.get(transferId)
    if (item && !item.is_complete) {
      cancelTransfer(transferId)
    }
    transferMap.delete(transferId)
    activeRunningIds.delete(transferId)
    activeTransfers.value = activeTransfers.value.filter((t) => t.transfer_id !== transferId)
    completedTransfers.value = completedTransfers.value.filter((t) => t.transfer_id !== transferId)
    failedTransfers.value = failedTransfers.value.filter((t) => t.transfer_id !== transferId)
  }

  async function cancelTransfer(transferId: string) {
    activeRunningIds.delete(transferId)
    try {
      await invoke('sftp_cancel_transfer', { transferId })
    } catch (e) {
      console.warn('Failed to invoke sftp_cancel_transfer:', e)
    }
    const item = transferMap.get(transferId)
    if (item) {
      item.is_complete = true
      item.completed_at = Date.now()
      item.error = 'Cancelled by user'
      item.speed_bytes_per_sec = 0
      item.status = 'failed'
      activeTransfers.value = activeTransfers.value.filter((t) => t.transfer_id !== transferId)
      failedTransfers.value = [item, ...failedTransfers.value]
      scheduleProgressFlush()
    }
  }

  async function cancelAllTransfers() {
    isCancellingAll.value = true
    for (const notify of activeWorkersNotifiers) {
      try {
        notify()
      } catch {}
    }
    try {
      await invoke('sftp_cancel_all_transfers')
    } catch (e) {
      console.warn('Failed to invoke sftp_cancel_all_transfers:', e)
    }
    activeRunningIds.clear()
    if (activeFolderUpload.value) {
      activeFolderUpload.value = null
    }
    const now = Date.now()
    const cancelledItems: TransferItem[] = []
    for (const t of activeTransfers.value) {
      t.is_complete = true
      t.completed_at = now
      t.error = 'Cancelled by user'
      t.speed_bytes_per_sec = 0
      t.status = 'failed'
      cancelledItems.push(t)
    }
    activeTransfers.value = []
    failedTransfers.value = [...cancelledItems, ...failedTransfers.value]
    scheduleProgressFlush()

    // Automatically reset the cancel-all transfer state after active workers had time to abort
    setTimeout(async () => {
      isCancellingAll.value = false
      try {
        await invoke('sftp_reset_cancel_transfers')
      } catch {}
    }, 350)
  }

  async function retryTransfer(item: TransferItem) {
    if (!item.session_id) return
    removeTransfer(item.transfer_id)
    await ensureTransferReady()

    if (item.direction === 'download' && item.remote_path) {
      const parentDir = item.local_path ? item.local_path.substring(0, Math.max(item.local_path.lastIndexOf('/'), item.local_path.lastIndexOf('\\'))) : undefined
      const fileEntry: SftpFileEntry = {
        name: item.file_name,
        path: item.remote_path,
        is_dir: false,
        is_symlink: false,
        size: item.total_bytes,
        modified: 0,
        permissions: 0o644,
      }
      await startDownload(item.session_id, fileEntry, parentDir)
    } else if (item.direction === 'upload' && item.local_path) {
      const parentDir = item.remote_path ? item.remote_path.substring(0, item.remote_path.lastIndexOf('/')) : undefined
      const fileEntry: LocalFileEntry = {
        name: item.file_name,
        path: item.local_path,
        is_dir: false,
        is_symlink: false,
        size: item.total_bytes,
        modified: 0,
      }
      await startUpload(item.session_id, fileEntry, parentDir)
    }
  }

  async function retryAllFailed() {
    const toRetry = [...failedTransfers.value]
    for (const item of toRetry) {
      removeTransfer(item.transfer_id)
    }
    await ensureTransferReady()

    await runWithConcurrency(
      toRetry,
      maxSimultaneousTransfers.value,
      async (item) => {
        try {
          if (!item.session_id) return
          if (item.direction === 'download' && item.remote_path) {
            const parentDir = item.local_path ? item.local_path.substring(0, Math.max(item.local_path.lastIndexOf('/'), item.local_path.lastIndexOf('\\'))) : undefined
            const fileEntry: SftpFileEntry = {
              name: item.file_name,
              path: item.remote_path,
              is_dir: false,
              is_symlink: false,
              size: item.total_bytes,
              modified: 0,
              permissions: 0o644,
            }
            await startDownload(item.session_id, fileEntry, parentDir, { skipRefresh: true })
          } else if (item.direction === 'upload' && item.local_path) {
            const parentDir = item.remote_path ? item.remote_path.substring(0, item.remote_path.lastIndexOf('/')) : undefined
            const fileEntry: LocalFileEntry = {
              name: item.file_name,
              path: item.local_path,
              is_dir: false,
              is_symlink: false,
              size: item.total_bytes,
              modified: 0,
            }
            await startUpload(item.session_id, fileEntry, parentDir, { skipRefresh: true })
          }
        } catch (err) {
          console.error('Failed to retry transfer:', item.file_name, err)
        }
      }
    )

    if (localPath.value) {
      invalidateLocalCache(localPath.value)
      await fetchLocalDir(localPath.value, { force: true })
    }
    if (currentSessionId.value && remotePath.value) {
      invalidateRemoteCache(currentSessionId.value, remotePath.value)
      await fetchRemoteDir(currentSessionId.value, remotePath.value, { force: true })
    }
  }

  async function requeueTransfer(item: TransferItem) {
    if (!item.session_id) return
    completedTransfers.value = completedTransfers.value.filter((t) => t.transfer_id !== item.transfer_id)
    failedTransfers.value = failedTransfers.value.filter((t) => t.transfer_id !== item.transfer_id)

    item.is_complete = false
    item.error = undefined
    item.bytes_transferred = 0
    item.speed_bytes_per_sec = 0
    item.started_at = Date.now()
    item.completed_at = undefined
    item.status = 'queued'
    transferMap.set(item.transfer_id, item)
    activeTransfers.value = [...activeTransfers.value, item]
    scheduleProgressFlush()

    await ensureTransferReady()
    try {
      await waitIfQueuePaused()
      if (item.direction === 'download' && item.remote_path) {
        const parentDir = item.local_path
          ? item.local_path.substring(0, Math.max(item.local_path.lastIndexOf('/'), item.local_path.lastIndexOf('\\')))
          : undefined
        const fileEntry: SftpFileEntry = {
          name: item.file_name,
          path: item.remote_path,
          is_dir: false,
          is_symlink: false,
          size: item.total_bytes,
          modified: 0,
          permissions: 0o644,
        }
        await startDownload(item.session_id, fileEntry, parentDir, {
          skipRefresh: true,
          preEnqueuedTransferId: item.transfer_id,
        })
      } else if (item.direction === 'upload' && item.local_path) {
        const parentDir = item.remote_path
          ? item.remote_path.substring(0, item.remote_path.lastIndexOf('/'))
          : undefined
        const fileEntry: LocalFileEntry = {
          name: item.file_name,
          path: item.local_path,
          is_dir: false,
          is_symlink: false,
          size: item.total_bytes,
          modified: 0,
        }
        await startUpload(item.session_id, fileEntry, parentDir, {
          skipRefresh: true,
          preEnqueuedTransferId: item.transfer_id,
        })
      }
    } catch (err) {
      console.error('Failed to requeue transfer:', item.file_name, err)
    }
  }

  async function requeueTransfers(items: TransferItem[]) {
    if (!items || items.length === 0) return
    const idSet = new Set(items.map((i) => i.transfer_id))
    completedTransfers.value = completedTransfers.value.filter((t) => !idSet.has(t.transfer_id))
    failedTransfers.value = failedTransfers.value.filter((t) => !idSet.has(t.transfer_id))

    const newActive: TransferItem[] = []
    for (const item of items) {
      item.is_complete = false
      item.error = undefined
      item.bytes_transferred = 0
      item.speed_bytes_per_sec = 0
      item.started_at = Date.now()
      item.completed_at = undefined
      item.status = 'queued'
      transferMap.set(item.transfer_id, item)
      newActive.push(item)
    }
    activeTransfers.value = [...activeTransfers.value, ...newActive]
    scheduleProgressFlush()

    await ensureTransferReady()
    await runWithConcurrency(items, maxSimultaneousTransfers.value || 3, async (item) => {
      await waitIfQueuePaused()
      try {
        if (!item.session_id) return
        if (item.direction === 'download' && item.remote_path) {
          const parentDir = item.local_path
            ? item.local_path.substring(0, Math.max(item.local_path.lastIndexOf('/'), item.local_path.lastIndexOf('\\')))
            : undefined
          const fileEntry: SftpFileEntry = {
            name: item.file_name,
            path: item.remote_path,
            is_dir: false,
            is_symlink: false,
            size: item.total_bytes,
            modified: 0,
            permissions: 0o644,
          }
          await startDownload(item.session_id, fileEntry, parentDir, {
            skipRefresh: true,
            preEnqueuedTransferId: item.transfer_id,
          })
        } else if (item.direction === 'upload' && item.local_path) {
          const parentDir = item.remote_path
            ? item.remote_path.substring(0, item.remote_path.lastIndexOf('/'))
            : undefined
          const fileEntry: LocalFileEntry = {
            name: item.file_name,
            path: item.local_path,
            is_dir: false,
            is_symlink: false,
            size: item.total_bytes,
            modified: 0,
          }
          await startUpload(item.session_id, fileEntry, parentDir, {
            skipRefresh: true,
            preEnqueuedTransferId: item.transfer_id,
          })
        }
      } catch (err) {
        console.error('Failed to execute requeued transfer:', item.file_name, err)
      }
    })

    if (localPath.value) {
      invalidateLocalCache(localPath.value)
      await fetchLocalDir(localPath.value, { force: true })
    }
    if (currentSessionId.value && remotePath.value) {
      invalidateRemoteCache(currentSessionId.value, remotePath.value)
      await fetchRemoteDir(currentSessionId.value, remotePath.value, { force: true })
    }
  }

  async function requeueAll(type: 'failed' | 'successful' | 'all' = 'all') {
    let targets: TransferItem[] = []
    if (type === 'failed') {
      targets = [...failedTransfers.value]
    } else if (type === 'successful') {
      targets = [...completedTransfers.value]
    } else {
      targets = [...failedTransfers.value, ...completedTransfers.value]
    }
    await requeueTransfers(targets)
  }

  function removeTransfers(itemIds: string[]) {
    const idSet = new Set(itemIds)
    for (const id of idSet) {
      const item = transferMap.get(id)
      if (item && !item.is_complete) {
        cancelTransfer(id)
      }
      transferMap.delete(id)
      activeRunningIds.delete(id)
    }
    activeTransfers.value = activeTransfers.value.filter((t) => !idSet.has(t.transfer_id))
    completedTransfers.value = completedTransfers.value.filter((t) => !idSet.has(t.transfer_id))
    failedTransfers.value = failedTransfers.value.filter((t) => !idSet.has(t.transfer_id))
  }

  function setPriority(itemIds: string[], priority: TransferPriority) {
    const idSet = new Set(itemIds)
    for (const id of idSet) {
      const item = transferMap.get(id)
      if (item) {
        item.priority = priority
      }
    }
    scheduleProgressFlush()
  }

  async function stopAndRemoveAllQueued() {
    isQueueProcessing.value = false
    await cancelAllTransfers()
    failedTransfers.value = failedTransfers.value.filter((t) => t.error !== 'Cancelled by user')
    activeTransfers.value = []
    activeRunningIds.clear()
    transferMap.clear()
    for (const t of completedTransfers.value) {
      transferMap.set(t.transfer_id, t)
    }
    for (const t of failedTransfers.value) {
      transferMap.set(t.transfer_id, t)
    }
    setTimeout(async () => {
      isCancellingAll.value = false
      try {
        await invoke('sftp_reset_cancel_transfers')
      } catch {}
    }, 350)
  }

  // Synchronized Browsing
  const isSynchronizedBrowsing = ref(false)
  function toggleSynchronizedBrowsing() {
    isSynchronizedBrowsing.value = !isSynchronizedBrowsing.value
  }

  // Archive Operations
  async function extractRemoteArchive(sessionId: string, archivePath: string, targetDir?: string): Promise<string> {
    const res = await invoke<string>('sftp_extract_remote_archive', {
      sessionId,
      archivePath,
      targetDir: targetDir || null,
    })
    invalidateRemoteCache(sessionId, remotePath.value)
    await fetchRemoteDir(sessionId, remotePath.value, { force: true })
    return res
  }

  async function compressRemoteArchive(sessionId: string, parentDir: string, items: string[], archiveName: string): Promise<string> {
    const res = await invoke<string>('sftp_compress_remote_archive', {
      sessionId,
      parentDir,
      items,
      archiveName,
    })
    invalidateRemoteCache(sessionId, remotePath.value)
    await fetchRemoteDir(sessionId, remotePath.value, { force: true })
    return res
  }

  async function extractLocalArchive(archivePath: string, targetDir?: string): Promise<string> {
    const res = await invoke<string>('sftp_extract_local_archive', {
      archivePath,
      targetDir: targetDir || null,
    })
    invalidateLocalCache(localPath.value)
    await fetchLocalDir(localPath.value, { force: true })
    return res
  }

  async function compressLocalArchive(parentDir: string, items: string[], archiveName: string): Promise<string> {
    const res = await invoke<string>('sftp_compress_local_archive', {
      parentDir,
      items,
      archiveName,
    })
    invalidateLocalCache(localPath.value)
    await fetchLocalDir(localPath.value, { force: true })
    return res
  }

  return {
    currentSessionId,
    remotePath,
    remoteFiles,
    selectedRemotePath,
    isLoadingRemote,
    remoteError,
    localPath,
    localFiles,
    selectedLocalPath,
    isLoadingLocal,
    localError,
    transfers,
    activeTransfers,
    completedTransfers,
    failedTransfers,
    totalTransferSpeed,
    totalActiveBytes,
    totalTransferredBytes,
    overallProgressPercent,
    conflictPolicy,
    activeConflictDialog,
    maxSimultaneousTransfers,
    isCancellingAll,
    isQueueProcessing,
    autoRemoveSuccessful,
    pauseQueue,
    processQueue,
    toggleProcessQueue,
    cancelTransfer,
    cancelAllTransfers,
    resolveConflict,
    switchSession,
    clearSession,
    initLocal,
    fetchLocalDir,
    fetchRemoteDir,
    createRemoteFolder,
    createRemoteFile,
    createLocalFolder,
    createLocalFile,
    deleteRemoteItem,
    deleteLocalItem,
    renameRemoteItem,
    renameLocalItem,
    startDownload,
    startUpload,
    startBatchDownload,
    startBatchUpload,
    invalidateRemoteCache,
    invalidateLocalCache,
    clearAllCache,
    ensureTransferReady,
    isBackgroundRefreshingRemote,
    isBackgroundRefreshingLocal,
    clearCompletedTransfers,
    clearFailedTransfers,
    clearAllTransfers,
    removeTransfer,
    removeTransfers,
    retryTransfer,
    retryAllFailed,
    requeueTransfer,
    requeueTransfers,
    requeueAll,
    setPriority,
    stopAndRemoveAllQueued,
    localGitStatus,
    remoteGitStatus,
    fetchLocalGitStatus,
    fetchRemoteGitStatus,
    isSessionDisconnected,
    isAutoReconnecting,
    checkSessionHealth,
    isSynchronizedBrowsing,
    toggleSynchronizedBrowsing,
    extractRemoteArchive,
    compressRemoteArchive,
    extractLocalArchive,
    compressLocalArchive,
    transferToast,
    triggerTransferToast,
    activeFolderUpload,
    stopActiveFolderUpload,
  }
})
