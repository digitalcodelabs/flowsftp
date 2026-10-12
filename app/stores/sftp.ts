import { defineStore } from 'pinia'
import { ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { useConflictResolution } from '../lib/sftp/useConflictResolution'
import { useTransferQueue } from '../lib/sftp/useTransferQueue'
import { useDirectoryBrowser } from '../lib/sftp/useDirectoryBrowser'
import { useTransferPipeline } from '../lib/sftp/useTransferPipeline'
import { useFileOperations } from '../lib/sftp/useFileOperations'

import type {
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

  // File operations (create / delete / rename / duplicate / size / checksum / symlink / archives /
  // clipboard; see lib/sftp/useFileOperations.ts)
  const {
    clipboard,
    calculatedDirSizes,
    createRemoteFolder,
    createRemoteFile,
    createLocalFolder,
    createLocalFile,
    deleteRemoteItem,
    deleteLocalItem,
    renameRemoteItem,
    renameLocalItem,
    extractRemoteArchive,
    compressRemoteArchive,
    extractLocalArchive,
    compressLocalArchive,
    copyToClipboard,
    cutToClipboard,
    pasteFromClipboard,
    duplicateItem,
    calculateDirSize,
    calculateChecksum,
    createSymlink,
  } = useFileOperations({
    browser,
    pipeline: { startBatchDownload, startBatchUpload, startBatchRemoteToRemoteTransfer },
  })

  // Synchronized Browsing
  const isSynchronizedBrowsing = ref(false)
  function toggleSynchronizedBrowsing() {
    isSynchronizedBrowsing.value = !isSynchronizedBrowsing.value
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
