import { defineStore } from 'pinia'
import { ref, shallowRef, triggerRef, computed, watch, type Ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useSshStore } from './ssh'
import { useSettingsStore } from './settings'
import {
  getPreCheckAction,
  getExistingAction,
  resolveDecision,
  isPathUnderRoots,
  canSkipConflictCheck,
  createConflictBatch,
  type ConflictPolicy,
  type ConflictDecision,
  type ConflictAction,
  type ConflictBatch,
} from '../utils/conflict'
import { TaskPump, type PumpTask } from '../utils/taskPump'
import {
  SKIPPED_MESSAGE,
  buildQueuedItem,
  buildSkippedItem,
  buildIgnoredItem,
  ignoredToastMessage,
  folderBatchTitle,
  type TransferSpec,
} from '../utils/transferItems'

import type {
  SftpFileEntry,
  LocalFileEntry,
  FileClipboardItem,
  LocalCrawlTask,
  LocalCrawlDirectory,
  LocalCrawlIgnored,
  LocalCrawlResult,
  ActiveFolderTransferInfo,
  ActiveFolderUploadInfo,
  ActiveFolderDownloadInfo,
  CrawlProgressPayload,
  RemoteCrawlTask,
  TransferPriority,
  TransferItem,
  FileConflictInfo,
  ConflictDialogState,
  CacheEntry,
  GitRepoStatus,
  FetchDirOptions,
} from '../lib/sftp/types'
import { getServerUrlForSession } from '../lib/sftp/serverUrl'

// Public types live in lib/sftp/types.ts; re-exported so existing imports keep working.
export type * from '../lib/sftp/types'
export { getServerUrlForSession }

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
  const activeFolderDownload = ref<ActiveFolderDownloadInfo | null>(null)

  async function stopActiveFolderUpload() {
    if (!activeFolderUpload.value) return
    activeFolderUpload.value.isStopping = true
    await cancelAllTransfers()
    activeFolderUpload.value = null
  }

  async function stopActiveFolderDownload() {
    if (!activeFolderDownload.value) return
    activeFolderDownload.value.isStopping = true
    await cancelAllTransfers()
    activeFolderDownload.value = null
  }

  // Set up live crawling progress event listener from native Rust crawler
  if (typeof window !== 'undefined') {
    listen<CrawlProgressPayload>('sftp:crawl:progress', (event) => {
      const { scan_type, files, directories } = event.payload
      if (scan_type === 'upload' && activeFolderUpload.value && activeFolderUpload.value.isScanning) {
        activeFolderUpload.value.totalFiles = files
        activeFolderUpload.value.totalFolders = Math.max(activeFolderUpload.value.totalFolders, directories)
      } else if (scan_type === 'download' && activeFolderDownload.value && activeFolderDownload.value.isScanning) {
        activeFolderDownload.value.totalFiles = files
        activeFolderDownload.value.totalFolders = Math.max(activeFolderDownload.value.totalFolders, directories)
      }
    }).catch((err) => {
      console.warn('Failed to attach crawl progress listener:', err)
    })
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
      // A row can finish (or be skipped) before this debounced flush runs; it has already been
      // moved to the completed/failed list by then and must not be re-added as active.
      const stillActive = pendingNewTransfers.filter((t) => !t.is_complete)
      pendingNewTransfers = []
      if (stillActive.length > 0) {
        activeTransfers.value = [...activeTransfers.value, ...stillActive]
      }
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
  // "Skip All" / "Overwrite All" is NOT stored here: it lives in the ConflictBatch owned by
  // each transfer operation, so concurrent batches can't affect each other.
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
    // The dialog's resolver also applies "All" decisions to the batch that asked.
    activeConflictDialog.value?.resolveDecision?.(decision)
    activeConflictDialog.value = null
  }

  let conflictQueue: Promise<void> = Promise.resolve()

  async function promptConflictDialog(
    data: Omit<ConflictDialogState, 'show' | 'resolveDecision'>,
    batch: ConflictBatch
  ): Promise<ConflictDecision> {
    if (batch.override === 'overwrite') return 'overwrite'
    if (batch.override === 'skip') return 'skip'

    return new Promise<ConflictDecision>((resolve) => {
      conflictQueue = conflictQueue.then(async () => {
        // The user may have answered "All" for this batch while this prompt was waiting.
        if (batch.override === 'overwrite') {
          resolve('overwrite')
          return
        }
        if (batch.override === 'skip') {
          resolve('skip')
          return
        }
        await new Promise<void>((dialogDone) => {
          activeConflictDialog.value = {
            ...data,
            show: true,
            resolveDecision: (decision) => {
              // Set synchronously, before the next queued prompt is looked at.
              const { batchOverride } = resolveDecision(decision)
              if (batchOverride) batch.override = batchOverride
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

  async function createRemoteFolder(sessionId: string, name: string, parentDir?: string) {
    const basePath = parentDir || sessionRemotePaths.value[sessionId] || remotePath.value
    const target = basePath.endsWith('/')
      ? `${basePath}${name}`
      : `${basePath}/${name}`
    await invoke('sftp_create_remote_dir', { sessionId, path: target })
    invalidateRemoteCache(sessionId, basePath)
    await fetchRemoteDir(sessionId, basePath, { force: true })
  }

  async function createRemoteFile(sessionId: string, name: string, overwrite: boolean = false, parentDir?: string) {
    const basePath = parentDir || sessionRemotePaths.value[sessionId] || remotePath.value
    const target = basePath.endsWith('/')
      ? `${basePath}${name}`
      : `${basePath}/${name}`
    await invoke('sftp_create_remote_file', { sessionId, path: target, overwrite })
    invalidateRemoteCache(sessionId, basePath)
    await fetchRemoteDir(sessionId, basePath, { force: true })
  }

  async function createLocalFolder(name: string) {
    const target = localPath.value.endsWith('/')
      ? `${localPath.value}${name}`
      : `${localPath.value}/${name}`
    await invoke('sftp_create_local_dir', { path: target })
    invalidateLocalCache(localPath.value)
    await fetchLocalDir(localPath.value, { force: true })
  }

  async function createLocalFile(name: string, overwrite: boolean = false) {
    const target = localPath.value.endsWith('/')
      ? `${localPath.value}${name}`
      : `${localPath.value}/${name}`
    await invoke('sftp_create_local_file', { path: target, overwrite })
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

  async function renameRemoteItem(sessionId: string, oldPath: string, newPath: string, parentDir?: string) {
    await invoke('sftp_rename_remote', { sessionId, oldPath, newPath })
    const basePath = parentDir || sessionRemotePaths.value[sessionId] || remotePath.value
    invalidateRemoteCache(sessionId, basePath)
    invalidateRemoteCache(sessionId, oldPath)
    invalidateRemoteCache(sessionId, newPath)
    await fetchRemoteDir(sessionId, basePath, { force: true })
  }

  async function renameLocalItem(oldPath: string, newPath: string) {
    await invoke('sftp_rename_local', { oldPath, newPath })
    invalidateLocalCache(localPath.value)
    invalidateLocalCache(oldPath)
    invalidateLocalCache(newPath)
    await fetchLocalDir(localPath.value, { force: true })
  }

  /**
   * Decides whether to overwrite or skip a file that is about to be transferred, prompting
   * the user when needed. `batch` carries the sticky "All" answer for the current operation;
   * callers that transfer several files should share one, single transfers may omit it.
   */
  async function determineConflictAction(
    direction: 'download' | 'upload' | 'transfer',
    fileName: string,
    sourceMeta: { size: number; modified: number; path: string },
    destinationPath: string,
    sessionId?: string,
    destinationIsRemote?: boolean,
    batch: ConflictBatch = createConflictBatch()
  ): Promise<ConflictAction> {
    const known = getPreCheckAction(conflictPolicy.value, batch.override)
    if (known) {
      return known
    }

    try {
      const isRemote = destinationIsRemote !== undefined
        ? destinationIsRemote
        : (direction === 'upload' || direction === 'transfer')
      const conflictInfo = await invoke<FileConflictInfo>('sftp_check_conflict', {
        sessionId: isRemote ? (sessionId || null) : null,
        path: destinationPath,
        isRemote,
      })

      if (!conflictInfo.exists) {
        return 'overwrite'
      }

      const existing = getExistingAction(conflictPolicy.value, batch.override)
      if (existing !== 'ask') {
        return existing
      }

      const decision = await promptConflictDialog(
        {
          fileName,
          direction,
          source: sourceMeta,
          destination: {
            size: conflictInfo.size,
            modified: conflictInfo.modified,
            path: destinationPath,
          },
        },
        batch
      )

      // A sticky "All" answer was already stored on `batch` by the dialog's resolver.
      return resolveDecision(decision).action
    } catch (err) {
      console.warn('Failed to check conflict, defaulting to overwrite:', err)
      return 'overwrite'
    }
  }

  async function ensureTransferReady() {
    if (isCancellingAll.value) {
      isCancellingAll.value = false
      try {
        await invoke('sftp_reset_cancel_transfers')
      } catch {}
    }
  }



  // ---------------------------------------------------------------------------
  // Shared transfer pipeline
  //
  // Upload, download and remote-to-remote transfers differ only in WHAT they invoke and
  // which paths / sessions they use. Everything else (conflict check, queue rows, progress
  // events, completion bookkeeping, folder batches) is written once, below.
  // ---------------------------------------------------------------------------

  /** One file waiting in a folder batch. `destination` is the full target path. */
  interface BatchTask<F> {
    transferId: string
    file: F
    destination: string
    skipConflictCheck?: boolean
  }

  let transferIdSeq = 0
  function newTransferId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}-${transferIdSeq++}`
  }

  type TransferFileMeta = { name: string; path: string; size: number; modified?: number }

  function downloadSpec(id: string, sessionId: string, file: TransferFileMeta, targetLocal: string): TransferSpec {
    return {
      id,
      name: file.name,
      direction: 'download',
      size: file.size || 0,
      localPath: targetLocal,
      remotePath: file.path,
      sessionId,
      serverUrl: getServerUrlForSession(sessionId),
    }
  }

  function uploadSpec(id: string, sessionId: string, file: TransferFileMeta, targetRemote: string): TransferSpec {
    return {
      id,
      name: file.name,
      direction: 'upload',
      size: file.size || 0,
      localPath: file.path,
      remotePath: targetRemote,
      sessionId,
      serverUrl: getServerUrlForSession(sessionId),
    }
  }

  /** Remote-to-remote rows are shown as uploads to the destination server. */
  function remoteToRemoteSpec(
    id: string,
    srcSessionId: string,
    destSessionId: string,
    file: TransferFileMeta,
    targetDest: string
  ): TransferSpec {
    return {
      id,
      name: file.name,
      direction: 'upload',
      size: file.size || 0,
      localPath: file.path,
      remotePath: targetDest,
      sessionId: destSessionId,
      srcSessionId,
      serverUrl: getServerUrlForSession(destSessionId),
    }
  }

  function crawledRemoteEntry(c: RemoteCrawlTask): SftpFileEntry {
    return {
      name: c.file_name,
      path: c.remote_path,
      is_dir: false,
      is_symlink: false,
      size: c.size,
      modified: 0,
      permissions: 0o644,
    }
  }

  function crawledLocalEntry(c: LocalCrawlTask): LocalFileEntry {
    return {
      name: c.file_name,
      path: c.local_path,
      is_dir: false,
      is_symlink: false,
      size: c.size,
      modified: 0,
    }
  }

  /** Marks a file that exists at the destination as skipped (shown in the queue, not transferred). */
  function recordSkippedTransfer(spec: TransferSpec) {
    const existing = transferMap.get(spec.id)
    if (existing) {
      existing.is_complete = true
      existing.completed_at = Date.now()
      existing.error = SKIPPED_MESSAGE
      existing.bytes_transferred = spec.size
      existing.status = 'failed'
      activeTransfers.value = activeTransfers.value.filter((t) => t.transfer_id !== spec.id)
      failedTransfers.value = [existing, ...failedTransfers.value]
    } else {
      const item = buildSkippedItem(spec)
      transferMap.set(spec.id, item)
      failedTransfers.value = [item, ...failedTransfers.value]
    }
    scheduleProgressFlush()
  }

  async function attachProgressListener(transferId: string, label: string): Promise<() => void> {
    try {
      return await listen<TransferItem>(`sftp:progress:${transferId}`, (event) => {
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
      console.warn(`Failed to attach ${label} progress listener:`, listenErr)
      return () => {}
    }
  }

  interface TransferRun {
    spec: TransferSpec
    /** True when the queue row already exists (folder-batch workers, requeue). */
    preEnqueued: boolean
    /** How to decide between overwrite and skip for this file. */
    conflict: {
      direction: 'download' | 'upload' | 'transfer'
      sourceMeta: { size: number; modified: number; path: string }
      destinationPath: string
      /** Session that owns the destination (ignored for local destinations). */
      sessionId?: string
      destinationIsRemote?: boolean
      /** Skip the destination check entirely (known-new folder, or overwrite-all). */
      skipCheck?: boolean
      batch?: ConflictBatch
    }
    /** Used in log messages, e.g. "download". */
    label: string
    /** The actual Tauri call. */
    perform: (conflictAction: ConflictAction) => Promise<unknown>
    /** Runs after the transfer succeeded, e.g. to refresh a directory listing. */
    afterSuccess?: () => Promise<void> | void
  }

  /**
   * Runs ONE file transfer end to end: conflict decision, queue row, progress events,
   * the transfer itself and completion/failure bookkeeping. Rethrows transfer errors.
   */
  async function executeTransfer(run: TransferRun): Promise<void> {
    const { spec, conflict } = run

    const conflictAction: ConflictAction = conflict.skipCheck
      ? 'overwrite'
      : await determineConflictAction(
          conflict.direction,
          spec.name,
          conflict.sourceMeta,
          conflict.destinationPath,
          conflict.sessionId,
          conflict.destinationIsRemote,
          conflict.batch
        )

    if (conflictAction === 'skip') {
      recordSkippedTransfer(spec)
      return
    }

    if (!run.preEnqueued) {
      const item = buildQueuedItem(spec)
      transferMap.set(spec.id, item)
      activeTransfers.value = [item, ...activeTransfers.value]
      scheduleProgressFlush()
    }

    const unlisten = await attachProgressListener(spec.id, run.label)
    try {
      const currentItem = transferMap.get(spec.id)
      if (currentItem) {
        currentItem.status = 'transferring'
        currentItem.started_at = Date.now()
        activeRunningIds.add(spec.id)
        scheduleProgressFlush()
      }

      await run.perform(conflictAction)

      completeTransferItem(spec.id, spec.size)
      await run.afterSuccess?.()
    } catch (err: any) {
      failTransferItem(spec.id, err?.message || String(err))
      throw err
    } finally {
      unlisten()
    }
  }

  // ----- folder-batch building blocks -----

  /** Whether the per-file destination check can be skipped for this batch right now. */
  function skipCheckFor(batch: ConflictBatch, isChildOfBrandNew: boolean): boolean {
    return canSkipConflictCheck({
      isChildOfBrandNew,
      policy: conflictPolicy.value,
      batchOverride: batch.override,
    })
  }

  /**
   * Of the given destination folders, returns those that do not exist yet. Every file inside
   * them is guaranteed new, so the per-file destination check can be skipped. A failed
   * check counts as "new", matching the overwrite fallback in determineConflictAction.
   */
  async function findBrandNewRoots(
    paths: string[],
    destination: { sessionId?: string; isRemote: boolean }
  ): Promise<Set<string>> {
    const brandNew = new Set<string>()
    await Promise.all(
      paths.map(async (path) => {
        try {
          const check = await invoke<FileConflictInfo>('sftp_check_conflict', {
            sessionId: destination.isRemote ? destination.sessionId ?? null : null,
            path,
            isRemote: destination.isRemote,
          })
          if (!check.exists) brandNew.add(path)
        } catch {
          brandNew.add(path)
        }
      })
    )
    return brandNew
  }

  /**
   * Applies the user's transfer ignore filter to the root items of a batch. Ignored items are
   * recorded in the queue (so the user can see why they were not transferred) and dropped
   * from the returned list.
   */
  function filterIgnoredRoots<T extends { name: string; is_dir: boolean }>(
    files: T[],
    makeSpec: (file: T) => TransferSpec
  ): T[] {
    const settingsStore = useSettingsStore()
    if (!settingsStore.enableTransferIgnoreFilter) return files

    const kept: T[] = []
    const ignoredNames: string[] = []
    for (const f of files) {
      if (!settingsStore.isPatternIgnored(f.name)) {
        kept.push(f)
        continue
      }
      const pattern = settingsStore.getMatchedIgnorePattern(f.name) || f.name
      const spec = makeSpec(f)
      const item = buildIgnoredItem({ ...spec, size: f.is_dir ? 0 : spec.size }, pattern, f.is_dir)
      transferMap.set(item.transfer_id, item)
      failedTransfers.value = [item, ...failedTransfers.value]
      ignoredNames.push(f.name)
    }
    if (ignoredNames.length > 0) {
      triggerTransferToast(ignoredToastMessage(ignoredNames.length, ignoredNames[0]!))
    }
    return kept
  }

  function currentIgnorePatterns(): string[] {
    const settingsStore = useSettingsStore()
    return settingsStore.enableTransferIgnoreFilter ? settingsStore.transferIgnorePatterns : []
  }

  function beginFolderProgress(
    target: Ref<ActiveFolderTransferInfo | null>,
    idPrefix: string,
    folderNames: string[]
  ) {
    if (folderNames.length === 0) return
    target.value = {
      id: `${idPrefix}-${Date.now()}`,
      folderName: folderBatchTitle(folderNames),
      totalFiles: 0,
      totalFolders: folderNames.length,
      completedFiles: 0,
      isScanning: true,
      isStopping: false,
      isComplete: false,
    }
  }

  function endFolderScan(target: Ref<ActiveFolderTransferInfo | null>, totalFiles: number) {
    if (target.value) {
      target.value.totalFiles = totalFiles
      target.value.isScanning = false
    }
  }

  /**
   * Drives one folder batch: runs the scan (which feeds the pump) while a worker pool
   * transfers whatever has been found so far, then tidies up the progress banner.
   */
  async function runBatch<T extends PumpTask>(opts: {
    pump: TaskPump<T>
    /** Pushes tasks into the pump. Errors are logged; the batch still finishes. */
    scan: () => Promise<void>
    process: (task: T) => Promise<void>
    folder: Ref<ActiveFolderTransferInfo | null>
    /** How long the "complete" banner stays visible. */
    lingerMs: number
    label: string
  }): Promise<void> {
    const { pump, folder } = opts
    activeWorkersNotifiers.add(pump.notify)

    const scanPromise = (async () => {
      try {
        await opts.scan()
      } catch (scanErr) {
        console.error(`${opts.label} scan error:`, scanErr)
      } finally {
        pump.finishScanning()
      }
    })()

    const concurrency = Math.max(1, Math.min(maxSimultaneousTransfers.value || 3, 10))
    const workersPromise = pump.runWorkers(
      concurrency,
      async (task) => {
        await opts.process(task)
        if (folder.value) folder.value.completedFiles++
      },
      {
        shouldStop: () => isCancellingAll.value,
        beforeTask: waitIfQueuePaused,
        onTaskError: (_task, err) => console.error(`${opts.label} worker error:`, err),
      }
    )

    try {
      await Promise.all([scanPromise, workersPromise])
    } finally {
      flushNewTransfersNow()
      activeWorkersNotifiers.delete(pump.notify)
      if (folder.value && !folder.value.isStopping && !isCancellingAll.value) {
        folder.value.isComplete = true
        setTimeout(() => {
          if (folder.value?.isComplete) {
            folder.value = null
          }
        }, opts.lingerMs)
      } else {
        folder.value = null
      }
    }
  }

  function newBatchPump<F extends TransferFileMeta>(
    toSpec: (task: BatchTask<F>) => TransferSpec
  ): TaskPump<BatchTask<F>> {
    return new TaskPump<BatchTask<F>>({
      onEnqueue: (task) => scheduleNewTransfersFlush(buildQueuedItem(toSpec(task))),
      onFinishScanning: flushNewTransfersNow,
    })
  }

  // ----- download -----

  async function startDownload(
    sessionId: string,
    remoteFile: SftpFileEntry,
    targetLocalParent?: string,
    options: {
      skipRefresh?: boolean
      preEnqueuedTransferId?: string
      exactLocalPath?: string
      skipConflictCheck?: boolean
      batch?: ConflictBatch
    } = {}
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
    const transferId = options.preEnqueuedTransferId || newTransferId('dl')

    await executeTransfer({
      spec: downloadSpec(transferId, sessionId, remoteFile, targetLocal),
      preEnqueued: !!options.preEnqueuedTransferId,
      conflict: {
        direction: 'download',
        sourceMeta: { size: remoteFile.size, modified: remoteFile.modified, path: remoteFile.path },
        destinationPath: targetLocal,
        skipCheck: options.skipConflictCheck,
        batch: options.batch,
      },
      label: 'download',
      perform: (conflictAction) =>
        invoke('sftp_download', {
          sessionId,
          transferId,
          remotePath: remoteFile.path,
          localPath: targetLocal,
          fileSize: remoteFile.size || null,
          conflictAction,
        }),
      afterSuccess: async () => {
        // Smooth background refresh of local folder during downloads
        triggerBackgroundLocalRefresh(targetLocal)

        if (!options.skipRefresh && localPath.value) {
          invalidateLocalCache(targetLocal)
          invalidateLocalCache(localPath.value)
          await fetchLocalDir(localPath.value, { force: true })
        }
      },
    })
  }

  async function startBatchDownload(sessionId: string, files: SftpFileEntry[], destinationDir?: string) {
    if (!localPath.value) {
      await initLocal()
    }
    const targetDir = destinationDir || localPath.value
    const batch = createConflictBatch()
    await ensureTransferReady()

    const cleanTargetDir = targetDir.replace(/\\/g, '/').replace(/\/+$/, '')
    const localTargetFor = (name: string) => `${cleanTargetDir}/${name}`

    const pump = newBatchPump<SftpFileEntry>((t) =>
      downloadSpec(t.transferId, sessionId, t.file, t.destination)
    )

    // 1. Root level: drop ignored items, enqueue regular files immediately.
    const roots = filterIgnoredRoots(files, (f) =>
      downloadSpec(newTransferId('ign-dl'), sessionId, f, localTargetFor(f.name))
    )
    for (const f of roots) {
      if (!f.is_dir) {
        pump.push({ transferId: newTransferId('dl'), file: f, destination: localTargetFor(f.name) })
      }
    }

    // 2. Folders are crawled natively in the background while files already transfer.
    const dirItems = roots.filter((f) => f.is_dir)
    beginFolderProgress(activeFolderDownload, 'folder-dl', dirItems.map((d) => d.name))

    await runBatch({
      pump,
      folder: activeFolderDownload,
      lingerMs: 3200,
      label: 'Download',
      scan: async () => {
        if (dirItems.length === 0) return
        try {
          const crawled = await invoke<RemoteCrawlTask[]>('sftp_crawl_remote_paths', {
            sessionId,
            paths: dirItems.map((d) => d.path),
            targetLocalDir: targetDir,
            ignorePatterns: currentIgnorePatterns(),
          })
          endFolderScan(activeFolderDownload, crawled.length)

          // Local folders that don't exist yet can't contain conflicts.
          const brandNew = await findBrandNewRoots(
            dirItems.map((d) => (cleanTargetDir === '' ? d.name : `${cleanTargetDir}/${d.name}`)),
            { isRemote: false }
          )

          for (const c of crawled) {
            if (isCancellingAll.value) break
            pump.push({
              transferId: newTransferId('dl'),
              file: crawledRemoteEntry(c),
              destination: c.local_path,
              skipConflictCheck: skipCheckFor(batch, isPathUnderRoots(c.local_path, brandNew)),
            })
          }
        } catch (crawlErr) {
          console.error('Native Rust remote crawl error:', crawlErr)
          endFolderScan(activeFolderDownload, 0)
        }
      },
      process: (task) =>
        startDownload(sessionId, task.file, targetDir, {
          skipRefresh: true,
          preEnqueuedTransferId: task.transferId,
          exactLocalPath: task.destination,
          skipConflictCheck: task.skipConflictCheck,
          batch,
        }),
    })

    // Refresh directory ONCE at the end of the batch (FileZilla style)
    if (localPath.value) {
      invalidateLocalCache(targetDir)
      invalidateLocalCache(localPath.value)
      await fetchLocalDir(localPath.value, { force: true })
    }
  }

  // ----- upload -----

  async function startUpload(
    sessionId: string,
    localFile: LocalFileEntry,
    targetRemoteParent?: string,
    options: {
      skipRefresh?: boolean
      preEnqueuedTransferId?: string
      exactRemotePath?: string
      skipConflictCheck?: boolean
      batch?: ConflictBatch
    } = {}
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
    const transferId = options.preEnqueuedTransferId || newTransferId('ul')

    await executeTransfer({
      spec: uploadSpec(transferId, sessionId, localFile, targetRemote),
      preEnqueued: !!options.preEnqueuedTransferId,
      conflict: {
        direction: 'upload',
        sourceMeta: { size: localFile.size, modified: localFile.modified, path: localFile.path },
        destinationPath: targetRemote,
        sessionId,
        skipCheck: options.skipConflictCheck,
        batch: options.batch,
      },
      label: 'upload',
      perform: (conflictAction) =>
        invoke('sftp_upload', {
          sessionId,
          transferId,
          localPath: localFile.path,
          remotePath: targetRemote,
          fileSize: localFile.size || null,
          conflictAction,
        }),
      afterSuccess: async () => {
        // Smooth background refresh of remote folder during uploads
        triggerBackgroundRemoteRefresh(sessionId, targetRemote)

        if (!options.skipRefresh && remotePath.value) {
          invalidateRemoteCache(sessionId, targetRemote)
          invalidateRemoteCache(sessionId, remotePath.value)
          await fetchRemoteDir(sessionId, remotePath.value, { force: true })
        }
      },
    })
  }

  async function startBatchUpload(sessionId: string, files: LocalFileEntry[], destinationDir?: string) {
    const targetDir = destinationDir || remotePath.value
    const batch = createConflictBatch()
    await ensureTransferReady()

    const cleanTargetDir = targetDir.replace(/\/+$/, '')
    const remoteTargetFor = (name: string) =>
      cleanTargetDir === '' ? (targetDir.startsWith('/') ? `/${name}` : name) : `${cleanTargetDir}/${name}`

    const pump = newBatchPump<LocalFileEntry>((t) =>
      uploadSpec(t.transferId, sessionId, t.file, t.destination)
    )

    // 1. Root level: drop ignored items, enqueue regular files immediately.
    const roots = filterIgnoredRoots(files, (f) =>
      uploadSpec(newTransferId('ign-ul'), sessionId, f, remoteTargetFor(f.name))
    )
    for (const f of roots) {
      if (!f.is_dir) {
        pump.push({ transferId: newTransferId('ul'), file: f, destination: remoteTargetFor(f.name) })
      }
    }

    // 2. Folders are crawled natively in the background while files already transfer.
    const dirItems = roots.filter((f) => f.is_dir)
    beginFolderProgress(activeFolderUpload, 'folder-ul', dirItems.map((d) => d.name))

    await runBatch({
      pump,
      folder: activeFolderUpload,
      lingerMs: 3200,
      label: 'Upload',
      scan: async () => {
        if (dirItems.length === 0) return
        try {
          // Fast native crawler: scans 10k+ files in ~20ms in parallel on local disk
          const crawled = await invoke<LocalCrawlResult | LocalCrawlTask[]>('sftp_crawl_local_paths', {
            paths: dirItems.map((d) => d.path),
            targetRemoteDir: targetDir,
            ignorePatterns: currentIgnorePatterns(),
          })

          const filesList: LocalCrawlTask[] = Array.isArray(crawled) ? crawled : (crawled.files || [])
          const dirsList: LocalCrawlDirectory[] = Array.isArray(crawled) ? [] : (crawled.directories || [])
          const ignoredList: LocalCrawlIgnored[] = Array.isArray(crawled) ? [] : (crawled.ignored || [])

          endFolderScan(activeFolderUpload, filesList.length)
          if (activeFolderUpload.value) {
            activeFolderUpload.value.totalFolders = Math.max(dirsList.length, dirItems.length)
          }

          // If a remote folder didn't exist before this upload, 100% of its files are new,
          // so the per-file conflict check can be skipped.
          const brandNew = await findBrandNewRoots(
            dirItems.map((d) => (cleanTargetDir === '' ? d.name : `${cleanTargetDir}/${d.name}`)),
            { sessionId, isRemote: true }
          )

          // Enqueue all crawled files so workers start transferring right away.
          for (const c of filesList) {
            if (isCancellingAll.value) break
            pump.push({
              transferId: newTransferId('ul'),
              file: crawledLocalEntry(c),
              destination: c.remote_path,
              skipConflictCheck: skipCheckFor(batch, isPathUnderRoots(c.remote_path, brandNew)),
            })
          }

          // Record ignored subfolders/files so users can see why they were not uploaded.
          for (const ign of ignoredList) {
            if (isCancellingAll.value) break
            const item = buildIgnoredItem(
              {
                id: newTransferId('ign-ul'),
                name: ign.item_name,
                direction: 'upload',
                size: 0,
                localPath: ign.local_path,
                remotePath: ign.remote_path,
                sessionId,
                serverUrl: getServerUrlForSession(sessionId),
              },
              ign.matched_pattern,
              ign.is_dir
            )
            transferMap.set(item.transfer_id, item)
            failedTransfers.value = [item, ...failedTransfers.value]
          }

          if (ignoredList.length > 0) {
            const folders = ignoredList.filter((i) => i.is_dir)
            const sampleFolder = folders[0]?.item_name ?? ''
            triggerTransferToast(
              folders.length > 0
                ? `Transfer filter: Ignored ${folders.length} folder${folders.length > 1 ? 's' : ''} (${sampleFolder}${folders.length > 1 ? '…' : ''}) in upload`
                : `Transfer filter: Ignored ${ignoredList.length} item(s) matching ignore rules`
            )
          }

          // Create remote directories (including empty ones) in native Rust, in the background,
          // so it never blocks active file uploads.
          if (dirsList.length > 0) {
            invoke('sftp_batch_create_remote_dirs', {
              sessionId,
              paths: dirsList.map((d) => d.remote_path),
            }).catch((dirErr) => {
              console.warn('Background remote directory creation warning:', dirErr)
            })
          }
        } catch (crawlErr) {
          console.error('Native Rust local crawl error:', crawlErr)
          endFolderScan(activeFolderUpload, 0)
        }
      },
      process: (task) =>
        startUpload(sessionId, task.file, targetDir, {
          skipRefresh: true,
          preEnqueuedTransferId: task.transferId,
          exactRemotePath: task.destination,
          skipConflictCheck: task.skipConflictCheck,
          batch,
        }),
    })

    // Refresh directory ONCE at the end of the batch (FileZilla style)
    if (sessionId && remotePath.value) {
      invalidateRemoteCache(sessionId, targetDir)
      invalidateRemoteCache(sessionId, remotePath.value)
      await fetchRemoteDir(sessionId, remotePath.value, { force: true })
    }
  }

  async function copyRemotePaths(sessionId: string, paths: string[], targetDir: string): Promise<void> {
    const cleanTarget = targetDir.replace(/\\/g, '/').replace(/\/+$/, '')
    await invoke('sftp_copy_remote_paths', { sessionId, paths, targetDir: cleanTarget })
    invalidateRemoteCache(sessionId, cleanTarget)
    await fetchRemoteDir(sessionId, cleanTarget, { force: true })
  }

  // ----- remote -> remote -----

  async function transferRemoteToRemote(
    srcSessionId: string,
    destSessionId: string,
    srcFile: SftpFileEntry,
    targetDestParent?: string,
    options: {
      preEnqueuedTransferId?: string
      exactDestPath?: string
      skipRefresh?: boolean
      skipConflictCheck?: boolean
      batch?: ConflictBatch
    } = {}
  ) {
    if (srcFile.is_dir) {
      return startBatchRemoteToRemoteTransfer(srcSessionId, destSessionId, [srcFile], targetDestParent)
    }

    if (activeTransfers.value.length === 0) {
      await ensureTransferReady()
    }

    const baseDest = targetDestParent || sessionRemotePaths.value[destSessionId] || remotePath.value || '/'
    const cleanDestDir = baseDest.replace(/\\/g, '/').replace(/\/+$/, '')
    const targetDest = options.exactDestPath || (cleanDestDir === '' ? `/${srcFile.name}` : `${cleanDestDir}/${srcFile.name}`)
    const transferId = options.preEnqueuedTransferId || newTransferId('r2r')

    await executeTransfer({
      spec: remoteToRemoteSpec(transferId, srcSessionId, destSessionId, srcFile, targetDest),
      preEnqueued: !!options.preEnqueuedTransferId,
      conflict: {
        direction: 'transfer',
        sourceMeta: { size: srcFile.size, modified: srcFile.modified, path: srcFile.path },
        destinationPath: targetDest,
        sessionId: destSessionId,
        destinationIsRemote: true,
        skipCheck: options.skipConflictCheck,
        batch: options.batch,
      },
      label: 'remote-to-remote',
      perform: () =>
        invoke('sftp_transfer_remote_to_remote', {
          srcSessionId,
          destSessionId,
          transferId,
          srcPath: srcFile.path,
          destPath: targetDest,
          fileSize: srcFile.size || null,
        }),
      afterSuccess: async () => {
        if (!options.skipRefresh) {
          invalidateRemoteCache(destSessionId, cleanDestDir)
          await fetchRemoteDir(destSessionId, cleanDestDir, { force: true })
        }
      },
    })
  }

  async function startBatchRemoteToRemoteTransfer(
    srcSessionId: string,
    destSessionId: string,
    files: SftpFileEntry[],
    destinationDir?: string
  ) {
    if (!files || files.length === 0) return
    const targetDir = destinationDir || sessionRemotePaths.value[destSessionId] || remotePath.value || '/'

    await ensureTransferReady()
    const batch = createConflictBatch()

    const cleanTargetDir = targetDir.replace(/\\/g, '/').replace(/\/+$/, '')
    const destFor = (name: string) => (cleanTargetDir === '' ? `/${name}` : `${cleanTargetDir}/${name}`)

    const pump = newBatchPump<SftpFileEntry>((t) =>
      remoteToRemoteSpec(t.transferId, srcSessionId, destSessionId, t.file, t.destination)
    )

    // 1. Root level files are enqueued immediately.
    for (const f of files) {
      if (!f.is_dir) {
        pump.push({ transferId: newTransferId('r2r'), file: f, destination: destFor(f.name) })
      }
    }

    // 2. Folders are crawled on the source server in the background.
    const dirItems = files.filter((f) => f.is_dir)
    beginFolderProgress(activeFolderUpload, 'folder-r2r', dirItems.map((d) => d.name))

    await runBatch({
      pump,
      folder: activeFolderUpload,
      lingerMs: 3500,
      label: 'Remote-to-remote',
      scan: async () => {
        if (dirItems.length === 0) return
        try {
          const crawled = await invoke<RemoteCrawlTask[]>('sftp_crawl_remote_paths', {
            sessionId: srcSessionId,
            paths: dirItems.map((d) => d.path),
            targetLocalDir: targetDir,
            ignorePatterns: currentIgnorePatterns(),
          })
          endFolderScan(activeFolderUpload, crawled.length)

          // Destination folders that don't exist yet can't contain conflicts.
          const brandNew = await findBrandNewRoots(
            dirItems.map((d) => (cleanTargetDir === '' ? d.name : `${cleanTargetDir}/${d.name}`)),
            { sessionId: destSessionId, isRemote: true }
          )

          for (const c of crawled) {
            if (isCancellingAll.value) break
            // The crawler reports the destination path in `local_path`.
            pump.push({
              transferId: newTransferId('r2r'),
              file: crawledRemoteEntry(c),
              destination: c.local_path,
              skipConflictCheck: skipCheckFor(batch, isPathUnderRoots(c.local_path, brandNew)),
            })
          }
        } catch (crawlErr) {
          console.error('Remote-to-remote crawl error:', crawlErr)
          endFolderScan(activeFolderUpload, 0)
        }
      },
      process: (task) =>
        transferRemoteToRemote(srcSessionId, destSessionId, task.file, targetDir, {
          skipRefresh: true,
          preEnqueuedTransferId: task.transferId,
          exactDestPath: task.destination,
          skipConflictCheck: task.skipConflictCheck,
          batch,
        }),
    })

    // Refresh destination directory ONCE at the end of the batch
    invalidateRemoteCache(destSessionId, targetDir)
    await fetchRemoteDir(destSessionId, targetDir, { force: true })
    triggerTransferToast(`Finished remote-to-remote transfer of ${files.length} item(s)`)
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
    if (activeFolderDownload.value) {
      activeFolderDownload.value = null
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

  /**
   * Re-runs a recorded transfer row through the normal pipeline (download, upload or
   * remote-to-remote, whichever the row describes).
   * `reuseRow` keeps the existing queue row instead of creating a new one.
   */
  async function rerunTransferItem(
    item: TransferItem,
    opts: { skipRefresh?: boolean; reuseRow?: boolean; batch?: ConflictBatch } = {}
  ) {
    if (!item.session_id) return
    const preEnqueuedTransferId = opts.reuseRow ? item.transfer_id : undefined

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
        skipRefresh: opts.skipRefresh,
        preEnqueuedTransferId,
        batch: opts.batch,
      })
    } else if (item.src_session_id && item.src_session_id !== item.session_id && item.local_path) {
      // Remote-to-remote rows keep the SOURCE path in `local_path`.
      const fileEntry: SftpFileEntry = {
        name: item.file_name,
        path: item.local_path,
        is_dir: !!item.is_dir,
        is_symlink: false,
        size: item.total_bytes,
        modified: 0,
        permissions: 0o644,
      }
      await transferRemoteToRemote(item.src_session_id, item.session_id, fileEntry, undefined, {
        preEnqueuedTransferId,
        exactDestPath: item.remote_path,
        skipRefresh: opts.skipRefresh,
        batch: opts.batch,
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
        skipRefresh: opts.skipRefresh,
        preEnqueuedTransferId,
        batch: opts.batch,
      })
    }
  }

  async function retryTransfer(item: TransferItem) {
    if (!item.session_id) return
    removeTransfer(item.transfer_id)
    await ensureTransferReady()
    await rerunTransferItem(item)
  }

  async function retryAllFailed() {
    const toRetry = [...failedTransfers.value]
    for (const item of toRetry) {
      removeTransfer(item.transfer_id)
    }
    await ensureTransferReady()

    // One shared batch: "Overwrite All" / "Skip All" applies to the whole retry.
    const batch = createConflictBatch()
    await runWithConcurrency(
      toRetry,
      maxSimultaneousTransfers.value,
      async (item) => {
        try {
          await rerunTransferItem(item, { skipRefresh: true, batch })
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
      await rerunTransferItem(item, { skipRefresh: true, reuseRow: true })
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
    // One shared batch: "Overwrite All" / "Skip All" applies to the whole requeue.
    const batch = createConflictBatch()
    await runWithConcurrency(items, maxSimultaneousTransfers.value || 3, async (item) => {
      await waitIfQueuePaused()
      try {
        await rerunTransferItem(item, { skipRefresh: true, reuseRow: true, batch })
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

  // File Clipboard (Copy / Cut / Paste)
  const clipboard = ref<FileClipboardItem | null>(null)

  function copyToClipboard(pane: 'local' | 'remote', files: (LocalFileEntry | SftpFileEntry)[], sessionId?: string) {
    if (!files || files.length === 0) return
    clipboard.value = {
      files: [...files],
      sourcePane: pane,
      mode: 'copy',
      sessionId: pane === 'remote' ? (sessionId || currentSessionId.value) : undefined,
    }
  }

  function cutToClipboard(pane: 'local' | 'remote', files: (LocalFileEntry | SftpFileEntry)[], sessionId?: string) {
    if (!files || files.length === 0) return
    clipboard.value = {
      files: [...files],
      sourcePane: pane,
      mode: 'cut',
      sessionId: pane === 'remote' ? (sessionId || currentSessionId.value) : undefined,
    }
  }

  async function pasteFromClipboard(targetPane: 'local' | 'remote', targetDir?: string, targetSessionId?: string) {
    if (!clipboard.value || clipboard.value.files.length === 0) return
    const clip = clipboard.value
    const destSessionId = targetSessionId || currentSessionId.value
    const dest = targetDir || (targetPane === 'local' ? localPath.value : (destSessionId ? sessionRemotePaths.value[destSessionId] || remotePath.value : remotePath.value))
    if (!dest) return

    try {
      if (clip.sourcePane === 'local' && targetPane === 'local') {
        const paths = clip.files.map((f) => f.path)
        if (clip.mode === 'cut') {
          await invoke('sftp_move_local_paths', { paths, targetDir: dest })
          clipboard.value = null
        } else {
          await invoke('sftp_copy_local_paths', { paths, targetDir: dest })
        }
        await fetchLocalDir(localPath.value, { force: true })
      } else if (clip.sourcePane === 'remote' && targetPane === 'remote' && destSessionId) {
        const srcSessionId = clip.sessionId || destSessionId
        if (srcSessionId === destSessionId && clip.mode === 'cut') {
          const paths = clip.files.map((f) => f.path)
          await invoke('sftp_move_remote_paths', { sessionId: destSessionId, paths, targetDir: dest })
          clipboard.value = null
          await fetchRemoteDir(destSessionId, dest, { force: true })
        } else {
          // Cross-session remote transfer or same-server copy with conflict resolution!
          await startBatchRemoteToRemoteTransfer(srcSessionId, destSessionId, clip.files as SftpFileEntry[], dest)
          if (clip.mode === 'cut') {
            for (const f of clip.files) {
              try {
                await deleteRemoteItem(srcSessionId, f as SftpFileEntry)
              } catch (delErr) {
                console.warn('Failed to delete source file after cut transfer:', delErr)
              }
            }
            clipboard.value = null
          }
        }
      } else if (clip.sourcePane === 'local' && targetPane === 'remote' && destSessionId) {
        await startBatchUpload(destSessionId, clip.files as LocalFileEntry[], dest)
        if (clip.mode === 'cut') {
          clipboard.value = null
        }
      } else if (clip.sourcePane === 'remote' && targetPane === 'local') {
        const srcSessionId = clip.sessionId || currentSessionId.value
        if (srcSessionId) {
          await startBatchDownload(srcSessionId, clip.files as SftpFileEntry[], dest)
          if (clip.mode === 'cut') {
            clipboard.value = null
          }
        }
      }
    } catch (err) {
      console.error('Failed to paste from clipboard:', err)
      throw err
    }
  }

  async function duplicateItem(pane: 'local' | 'remote', item: LocalFileEntry | SftpFileEntry, sessionId?: string, parentDir?: string) {
    if (pane === 'local') {
      await invoke('sftp_duplicate_local_path', { path: item.path, newName: null })
      await fetchLocalDir(localPath.value, { force: true })
    } else {
      const sid = sessionId || currentSessionId.value
      if (sid) {
        await invoke('sftp_duplicate_remote_path', { sessionId: sid, path: item.path, newName: null })
        const dir = parentDir || sessionRemotePaths.value[sid] || remotePath.value
        invalidateRemoteCache(sid, dir)
        await fetchRemoteDir(sid, dir, { force: true })
      }
    }
  }

  // Calculated Directory Sizes
  const calculatedDirSizes = ref<Record<string, number>>({})

  async function calculateDirSize(pane: 'local' | 'remote', path: string, sessionId?: string): Promise<number> {
    if (pane === 'local') {
      const size = await invoke<number>('sftp_get_local_dir_size', { path })
      calculatedDirSizes.value[path] = size
      return size
    } else {
      const sid = sessionId || currentSessionId.value
      if (sid) {
        const size = await invoke<number>('sftp_get_remote_dir_size', { sessionId: sid, path })
        calculatedDirSizes.value[path] = size
        return size
      }
    }
    return 0
  }

  async function calculateChecksum(pane: 'local' | 'remote', path: string, algorithm: 'md5' | 'sha256', sessionId?: string): Promise<string> {
    if (pane === 'local') {
      return await invoke<string>('sftp_calculate_local_checksum', { path, algorithm })
    } else {
      const sid = sessionId || currentSessionId.value
      if (sid) {
        return await invoke<string>('sftp_calculate_remote_checksum', { sessionId: sid, path, algorithm })
      }
    }
    throw new Error('No active session')
  }

  async function createSymlink(pane: 'local' | 'remote', target: string, linkPath: string, sessionId?: string): Promise<void> {
    if (pane === 'local') {
      await invoke('sftp_create_local_symlink', { target, linkPath })
      await fetchLocalDir(localPath.value, { force: true })
    } else {
      const sid = sessionId || currentSessionId.value
      if (sid) {
        await invoke('sftp_create_remote_symlink', { sessionId: sid, target, linkPath })
        const dir = sessionRemotePaths.value[sid] || remotePath.value
        invalidateRemoteCache(sid, dir)
        await fetchRemoteDir(sid, dir, { force: true })
      }
    }
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
    determineConflictAction,
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
    copyRemotePaths,
    transferRemoteToRemote,
    startBatchRemoteToRemoteTransfer,
    sessionRemotePaths,
    sessionRemoteFiles,
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
    activeFolderDownload,
    stopActiveFolderDownload,
    clipboard,
    copyToClipboard,
    cutToClipboard,
    pasteFromClipboard,
    duplicateItem,
    calculatedDirSizes,
    calculateDirSize,
    calculateChecksum,
    createSymlink,
  }
})
