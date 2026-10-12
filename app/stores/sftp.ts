import { defineStore } from 'pinia'
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useConflictResolution } from '../lib/sftp/useConflictResolution'
import { useTransferQueue } from '../lib/sftp/useTransferQueue'
import { useDirectoryBrowser } from '../lib/sftp/useDirectoryBrowser'
import { useTransferPipeline } from '../lib/sftp/useTransferPipeline'

import type {
  SftpFileEntry,
  LocalFileEntry,
  FileClipboardItem,
  ActiveFolderUploadInfo,
  ActiveFolderDownloadInfo,
  CrawlProgressPayload,
} from '../lib/sftp/types'
import { getServerUrlForSession } from '../lib/sftp/serverUrl'

// Public types live in lib/sftp/types.ts; re-exported so existing imports keep working.
export type * from '../lib/sftp/types'
export { getServerUrlForSession }

export const useSftpStore = defineStore('sftp', () => {
  // Directory browsing & caching (both panes; see lib/sftp/useDirectoryBrowser.ts)
  const browser = useDirectoryBrowser()
  const {
    currentSessionId,
    remotePath,
    remoteFiles,
    selectedRemotePath,
    isLoadingRemote,
    remoteError,
    sessionRemotePaths,
    sessionRemoteFiles,
    isBackgroundRefreshingRemote,
    localPath,
    localFiles,
    selectedLocalPath,
    isLoadingLocal,
    localError,
    isBackgroundRefreshingLocal,
    localGitStatus,
    remoteGitStatus,
    fetchLocalGitStatus,
    fetchRemoteGitStatus,
    isSessionDisconnected,
    isAutoReconnecting,
    checkSessionHealth,
    initLocal,
    fetchLocalDir,
    fetchRemoteDir,
    switchSession,
    clearSession,
    invalidateRemoteCache,
    invalidateLocalCache,
    clearAllCache,
    triggerBackgroundLocalRefresh,
    triggerBackgroundRemoteRefresh,
  } = browser

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

  // Transfer queue (row buckets, progress flushing, pause/resume, cancel/clear/remove helpers;
  // see lib/sftp/useTransferQueue.ts)
  const queue = useTransferQueue({
    clearFolderProgress: () => {
      activeFolderUpload.value = null
      activeFolderDownload.value = null
    },
  })
  const {
    activeTransfers,
    completedTransfers,
    failedTransfers,
    transferMap,
    activeRunningIds,
    transfers,
    totalTransferSpeed,
    totalActiveBytes,
    totalTransferredBytes,
    overallProgressPercent,
    maxSimultaneousTransfers,
    isQueueProcessing,
    autoRemoveSuccessful,
    isCancellingAll,
    activeWorkersNotifiers,
    flushNewTransfersNow,
    scheduleNewTransfersFlush,
    scheduleProgressFlush,
    completeTransferItem,
    failTransferItem,
    waitIfQueuePaused,
    pauseQueue,
    processQueue,
    toggleProcessQueue,
    runWithConcurrency,
    clearCompletedTransfers,
    clearFailedTransfers,
    clearAllTransfers,
    removeTransfer,
    removeTransfers,
    cancelTransfer,
    cancelAllTransfers,
    setPriority,
    stopAndRemoveAllQueued,
  } = queue

  // Conflict Resolution (policy, dialog and decisions; see lib/sftp/useConflictResolution.ts)
  const conflicts = useConflictResolution()
  const { conflictPolicy, activeConflictDialog, resolveConflict, determineConflictAction } = conflicts

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

  // Transfer pipeline (download / upload / remote-to-remote, retry & requeue;
  // see lib/sftp/useTransferPipeline.ts)
  const {
    ensureTransferReady,
    startDownload,
    startBatchDownload,
    startUpload,
    startBatchUpload,
    copyRemotePaths,
    transferRemoteToRemote,
    startBatchRemoteToRemoteTransfer,
    retryTransfer,
    retryAllFailed,
    requeueTransfer,
    requeueTransfers,
    requeueAll,
  } = useTransferPipeline({
    queue,
    conflicts,
    browser,
    folderProgress: { activeFolderUpload, activeFolderDownload, triggerTransferToast },
  })

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
