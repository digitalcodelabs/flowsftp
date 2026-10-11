<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import {
  AlertTriangle,
  X,
  RotateCw,
  CheckCircle2,
  RefreshCw,
  WifiOff,
  Folder,
  Square,
} from 'lucide-vue-next'
import {
  useSftpStore,
  type SftpFileEntry,
  type LocalFileEntry,
} from '../stores/sftp'
import { useVaultStore } from '../stores/vault'
import { useSettingsStore } from '../stores/settings'
import { useSshStore } from '../stores/ssh'
import CatppuccinIcon from './CatppuccinIcon.vue'
import FileEditorModal from './FileEditorModal.vue'
import PermissionsModal from './PermissionsModal.vue'
import QuickLookModal from './QuickLookModal.vue'
import SftpRenameModal from './sftp/modals/SftpRenameModal.vue'
import SftpNewFolderModal from './sftp/modals/SftpNewFolderModal.vue'
import SftpNewFileModal from './sftp/modals/SftpNewFileModal.vue'
import SftpCompressModal from './sftp/modals/SftpCompressModal.vue'
import SftpExtractModal from './sftp/modals/SftpExtractModal.vue'
import SftpConflictModal from './sftp/modals/SftpConflictModal.vue'
import SftpDeleteConfirmModal from './sftp/modals/SftpDeleteConfirmModal.vue'
import SftpTransferQueue from './sftp/queue/SftpTransferQueue.vue'
import SftpComparisonBar from './sftp/compare/SftpComparisonBar.vue'
import SftpExternalEditBar from './sftp/SftpExternalEditBar.vue'
import SftpDirWatcherModal from './sftp/modals/SftpDirWatcherModal.vue'
import SftpSearchModal from './sftp/modals/SftpSearchModal.vue'
import { useSftpComparison } from './sftp/compare/useSftpComparison'
import { useExternalEditStore } from '../stores/externalEdit'
import { useDirWatcherStore } from '../stores/dirWatcher'
import { useSftpKeyboardNav } from './sftp/composables/useSftpKeyboardNav'
import { useSftpDragDrop } from './sftp/composables/useSftpDragDrop'
import SftpLocalPane from './sftp/panes/SftpLocalPane.vue'
import SftpRemotePane from './sftp/panes/SftpRemotePane.vue'
import SftpContextMenu from './sftp/contextmenu/SftpContextMenu.vue'
import { isArchiveFile } from '../utils/formatters'
import {
  type FileSortField,
  type FileSortOrder,
  getStoredSortBy,
  getStoredSortOrder,
  sortFileList,
} from './sftp/panes/sorting'
export type { FileSortField, FileSortOrder } from './sftp/panes/sorting'

const props = defineProps<{
  sessionId: string | null
  active?: boolean
}>()

const emit = defineEmits<{
  (e: 'open-terminal', dirPath: string): void
}>()

const sftpStore = useSftpStore()
const vaultStore = useVaultStore()
const settingsStore = useSettingsStore()
const sshStore = useSshStore()
const externalEditStore = useExternalEditStore()
const dirWatcherStore = useDirWatcherStore()
const showDirWatcherModal = ref(false)
const dirWatcherLocalDir = ref('')
const dirWatcherRemoteDir = ref('')
const showSearchModal = ref(false)
const searchInitialDir = ref('/')

const localPaneComp = ref<InstanceType<typeof SftpLocalPane> | null>(null)
const remotePaneComp = ref<InstanceType<typeof SftpRemotePane> | null>(null)
const localPaneRef = computed<HTMLElement | null>(() => localPaneComp.value?.rootEl ?? null)
const remotePaneRef = computed<HTMLElement | null>(() => remotePaneComp.value?.rootEl ?? null)
const splitContainerRef = ref<HTMLElement | null>(null)
const leftPanePercent = ref(50)
const isResizingHorizontal = ref(false)

const transferQueueRef = ref<InstanceType<typeof SftpTransferQueue> | null>(null)

const startHorizontalResize = (e: MouseEvent) => {
  isResizingHorizontal.value = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'

  const onMouseMove = (ev: MouseEvent) => {
    if (!splitContainerRef.value) return
    const containerRect = splitContainerRef.value.getBoundingClientRect()
    if (containerRect.width <= 0) return
    const relativeX = ev.clientX - containerRect.left
    const percent = (relativeX / containerRect.width) * 100
    leftPanePercent.value = Math.max(20, Math.min(80, Math.round(percent * 10) / 10))
  }

  const onMouseUp = () => {
    isResizingHorizontal.value = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
    localStorage.setItem('flowsftp_left_pane_percent', leftPanePercent.value.toString())
  }

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

const resetHorizontalSplit = () => {
  leftPanePercent.value = 50
  localStorage.setItem('flowsftp_left_pane_percent', '50')
}

// Row density helpers
const rowPaddingClass = computed(() => {
  switch (settingsStore.browserRowDensity) {
    case 'compact':
      return 'py-0 px-2'
    case 'relaxed':
      return 'py-1 px-2.5'
    default:
      return 'py-0.5 px-2'
  }
})

const cellPaddingClass = computed(() => {
  switch (settingsStore.browserRowDensity) {
    case 'compact':
      return 'py-0 px-1.5'
    case 'relaxed':
      return 'py-1 px-2'
    default:
      return 'py-0.5 px-1.5'
  }
})

// Input paths for direct editing
const localInputPath = ref('')
const remoteInputPath = ref('')

// Action dialogs
const showNewFolderModal = ref(false)
const newFolderTarget = ref<'local' | 'remote'>('remote')
const newFolderName = ref('')
const newFolderInputRef = ref<HTMLInputElement | null>(null)

const showNewFileModal = ref(false)
const newFileTarget = ref<'local' | 'remote'>('remote')
const newFileName = ref('')
const newFileInputRef = ref<HTMLInputElement | null>(null)

const showRenameModal = ref(false)
const renameTarget = ref<'local' | 'remote'>('remote')
const renameItem = ref<LocalFileEntry | SftpFileEntry | null>(null)
const renameNewName = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)

// Delete Confirmation Modal State
interface FileDeleteTarget {
  pane: 'local' | 'remote'
  files: (LocalFileEntry | SftpFileEntry)[]
}

interface ActiveDeletion {
  id: string
  pane: 'local' | 'remote'
  title: string
  totalCount: number
  completedCount: number
  isCancelling: boolean
}

const showDeleteConfirmModal = ref(false)
const deleteTarget = ref<FileDeleteTarget | null>(null)
const isDeletingFiles = ref(false)
const activeDeletion = ref<ActiveDeletion | null>(null)
const useFastRm = ref(false)


const showCompressModal = ref(false)
const compressTarget = ref<'local' | 'remote'>('remote')
const compressSelectedItems = ref<(LocalFileEntry | SftpFileEntry)[]>([])
const compressArchiveName = ref('')
const compressFormat = ref<'.tar.gz' | '.zip'>('.tar.gz')
const isCompressingArchive = ref(false)
const compressInputRef = ref<HTMLInputElement | null>(null)

const showExtractModal = ref(false)
const extractTarget = ref<'local' | 'remote'>('remote')
const extractArchiveFile = ref<LocalFileEntry | SftpFileEntry | null>(null)
const extractSubfolderName = ref('')
const isExtractingArchive = ref(false)
const extractInputRef = ref<HTMLInputElement | null>(null)

const archiveToast = ref<{ message: string; isError: boolean; isLoading: boolean } | null>(null)
let archiveToastTimer: any = null

const showArchiveToast = (message: string, isError = false, isLoading = false, duration = 3500) => {
  if (archiveToastTimer) clearTimeout(archiveToastTimer)
  archiveToast.value = { message, isError, isLoading }
  const effectiveDuration = duration > 0 ? duration : (isLoading ? 10000 : 3500)
  archiveToastTimer = setTimeout(() => {
    archiveToast.value = null
  }, effectiveDuration)
}

const dismissTransferToasts = () => {
  if (archiveToast.value && !archiveToast.value.isError) {
    if (archiveToastTimer) {
      clearTimeout(archiveToastTimer)
      archiveToastTimer = null
    }
    archiveToast.value = null
  }
  if (sftpStore.transferToast) {
    sftpStore.transferToast = null
  }
}

watch(
  () => sftpStore.transferToast,
  (t) => {
    if (t) {
      showArchiveToast(t.message, t.isError ?? false, false, 4500)
    }
  }
)

// When upload or download starts, automatically dismiss small notification toasts
watch(
  [
    () => sftpStore.activeFolderUpload,
    () => sftpStore.activeFolderDownload,
    () => sftpStore.activeTransfers.length,
  ],
  ([ul, dl, count]) => {
    if (ul || dl || count > 0) {
      dismissTransferToasts()
    }
  }
)

// Transfer drawer state & queue tabs (FileZilla 3-Tab Architecture)
const showTransferDrawer = ref(true)
const transferTab = ref<'active' | 'completed' | 'failed'>('active')

const folderUploadBottomOffset = computed(() => {
  if (!showTransferDrawer.value) return '36px'
  const h = transferQueueRef.value?.drawerHeight ?? 180
  return `${h + 14}px`
})

const activeDeletionBottomOffset = computed(() => {
  return folderUploadBottomOffset.value
})

const folderDownloadBottomOffset = computed(() => {
  const base = folderUploadBottomOffset.value
  if (activeDeletion.value) {
    const basePx = parseInt(base) || 194
    return `${basePx + 56}px`
  }
  return base
})

// File Editor State
const showEditorModal = ref(false)
const editorTarget = ref<'local' | 'remote'>('remote')
const editorFilePath = ref('')
const editorFileName = ref('')

const openEditor = (target: 'local' | 'remote', file: LocalFileEntry | SftpFileEntry) => {
  editorTarget.value = target
  editorFilePath.value = file.path
  editorFileName.value = file.name
  showEditorModal.value = true
  closeContextMenu()
}

const handleEditorSaved = () => {
  if (editorTarget.value === 'remote' && props.sessionId) {
    sftpStore.invalidateRemoteCache(props.sessionId, sftpStore.remotePath)
    sftpStore.fetchRemoteDir(props.sessionId, sftpStore.remotePath, { force: true })
  } else {
    sftpStore.invalidateLocalCache(sftpStore.localPath)
    sftpStore.fetchLocalDir(sftpStore.localPath, { force: true })
  }
}

// Permissions Modal State
const showPermissionsModal = ref(false)
const permissionsItem = ref<SftpFileEntry | null>(null)

// -------------------------------------------------------------
// Quick Look / Instant Preview State (Spacebar)
// -------------------------------------------------------------
const showQuickLook = ref(false)
const quickLookFile = ref<LocalFileEntry | SftpFileEntry | null>(null)
const quickLookTarget = ref<'local' | 'remote'>('remote')

// -------------------------------------------------------------
// Git Status Helper
// -------------------------------------------------------------
const getGitStatus = (isLocal: boolean, file: LocalFileEntry | SftpFileEntry): string | null => {
  const statusObj = isLocal ? sftpStore.localGitStatus : sftpStore.remoteGitStatus
  if (!statusObj?.is_repo || !statusObj.files) return null

  const normalizedPath = file.path.replace(/\\/g, '/')
  if (statusObj.files[normalizedPath]) {
    return statusObj.files[normalizedPath]
  }

  if (statusObj.root) {
    const rootClean = statusObj.root.replace(/\\/g, '/').replace(/\/+$/, '')
    if (normalizedPath.startsWith(rootClean + '/')) {
      const rel = normalizedPath.slice(rootClean.length + 1)
      if (statusObj.files[rel]) {
        return statusObj.files[rel]
      }
    }
  }

  if (statusObj.files[file.name]) {
    return statusObj.files[file.name]
  }

  if (file.is_dir) {
    for (const p of Object.keys(statusObj.files)) {
      if (p.includes(`/${file.name}/`) || p.startsWith(`${file.name}/`)) {
        return 'has-changes'
      }
    }
  }

  return null
}

// -------------------------------------------------------------
// Heartbeat Keep-Alive & Auto-Reconnect Logic
// -------------------------------------------------------------
const isConnectionDropped = ref(false)
const autoReconnectCountdown = ref(0)
const isReconnecting = ref(false)
let reconnectTimer: ReturnType<typeof setInterval> | null = null
let heartbeatInterval: ReturnType<typeof setInterval> | null = null
let lastHeartbeatTime = Date.now()

const isFtp = computed(() => {
  const session = sshStore.sessions.find(s => s.sessionId === props.sessionId)
  return session?.protocol === 'ftp' || session?.protocol === 'ftps'
})

const protocolBannerTitle = computed(() => {
  const session = sshStore.sessions.find(s => s.sessionId === props.sessionId)
  if (session?.protocol === 'ftps') return 'FTPS Connection Dropped'
  if (session?.protocol === 'ftp') return 'FTP Connection Dropped'
  return 'SFTP Connection Dropped'
})

const startHeartbeat = () => {
  if (heartbeatInterval) clearInterval(heartbeatInterval)
  lastHeartbeatTime = Date.now()

  heartbeatInterval = setInterval(async () => {
    const now = Date.now()
    const elapsed = now - lastHeartbeatTime
    lastHeartbeatTime = now

    // Sleep detection: if computer was asleep, elapsed will be > 40s
    const wokeFromSleep = elapsed > 40_000

    if (props.sessionId && !isReconnecting.value) {
      const isAlive = await sftpStore.checkSessionHealth(props.sessionId)
      if (!isAlive || wokeFromSleep) {
        // Double check after 1.5s to avoid temporary glitches
        await new Promise((r) => setTimeout(r, 1500))
        const confirmAlive = await sftpStore.checkSessionHealth(props.sessionId)
        if (!confirmAlive) {
          triggerConnectionDropped()
        }
      } else {
        isConnectionDropped.value = false
      }
    }
  }, 25_000)
}

const triggerConnectionDropped = () => {
  if (isConnectionDropped.value || isReconnecting.value) return
  isConnectionDropped.value = true
  autoReconnectCountdown.value = 5

  if (reconnectTimer) clearInterval(reconnectTimer)
  reconnectTimer = setInterval(() => {
    autoReconnectCountdown.value -= 1
    if (autoReconnectCountdown.value <= 0) {
      clearInterval(reconnectTimer!)
      reconnectTimer = null
      performAutoReconnect()
    }
  }, 1000)
}

const cancelAutoReconnect = () => {
  if (reconnectTimer) {
    clearInterval(reconnectTimer)
    reconnectTimer = null
  }
  isConnectionDropped.value = false
}

const performAutoReconnect = async () => {
  if (!props.sessionId || isReconnecting.value) return
  isReconnecting.value = true
  if (reconnectTimer) {
    clearInterval(reconnectTimer)
    reconnectTimer = null
  }

  const oldSessionId = props.sessionId
  const savedRemotePath = sftpStore.remotePath

  try {
    const newSessionId = await sshStore.reconnect(oldSessionId)
    isConnectionDropped.value = false
    await sftpStore.switchSession(newSessionId)
    if (savedRemotePath && savedRemotePath !== '.') {
      await sftpStore.fetchRemoteDir(newSessionId, savedRemotePath)
    }
  } catch (err) {
    console.error('Auto-reconnect failed:', err)
    autoReconnectCountdown.value = 10
    reconnectTimer = setInterval(() => {
      autoReconnectCountdown.value -= 1
      if (autoReconnectCountdown.value <= 0) {
        clearInterval(reconnectTimer!)
        reconnectTimer = null
        performAutoReconnect()
      }
    }, 1000)
  } finally {
    isReconnecting.value = false
  }
}

const handleNetworkOnline = async () => {
  if (props.sessionId) {
    const isAlive = await sftpStore.checkSessionHealth(props.sessionId)
    if (!isAlive) {
      performAutoReconnect()
    } else {
      isConnectionDropped.value = false
    }
  }
}

const handleRemoteRefresh = async () => {
  if (!props.sessionId) return
  const isAlive = await sftpStore.checkSessionHealth(props.sessionId)
  if (!isAlive) {
    await performAutoReconnect()
  } else {
    await sftpStore.fetchRemoteDir(props.sessionId, sftpStore.remotePath, { force: true })
  }
}

const handleRefresh = async (target?: 'local' | 'remote' | 'both') => {
  const t = target || (activePane.value === 'remote' ? 'remote' : 'local')
  if (t === 'both') {
    const promises: Promise<any>[] = [
      sftpStore.fetchLocalDir(sftpStore.localPath, { force: true }),
    ]
    if (props.sessionId) {
      promises.push(handleRemoteRefresh())
    }
    await Promise.allSettled(promises)
    return
  }

  if (t === 'remote') {
    if (props.sessionId) {
      await handleRemoteRefresh()
    } else {
      await sftpStore.fetchLocalDir(sftpStore.localPath, { force: true })
    }
  } else {
    await sftpStore.fetchLocalDir(sftpStore.localPath, { force: true })
  }
}

const openPermissions = (item: SftpFileEntry) => {
  permissionsItem.value = item
  showPermissionsModal.value = true
  closeContextMenu()
}

const handlePermissionsUpdated = () => {
  if (props.sessionId) {
    sftpStore.invalidateRemoteCache(props.sessionId, sftpStore.remotePath)
    sftpStore.fetchRemoteDir(props.sessionId, sftpStore.remotePath, { force: true })
  }
}

// Hidden Files Toggle
const showHiddenFiles = ref(false)

// In-Pane Instant Live Filter State (Ctrl+F)
const showLocalFilter = ref(false)
const localSearchQuery = ref('')
const localFilterInputRef = computed<HTMLInputElement | null>(() => localPaneComp.value?.filterInputRef ?? null)

const showRemoteFilter = ref(false)
const remoteSearchQuery = ref('')
const remoteFilterInputRef = computed<HTMLInputElement | null>(() => remotePaneComp.value?.filterInputRef ?? null)

// -------------------------------------------------------------
// Directory Comparison Mode (Visual Diff between Local & Remote)
// -------------------------------------------------------------
const {
  isComparing,
  compareCriteria,
  hideIdenticalFiles,
  toggleComparison,
  comparisonResult,
  syncLocalToRemote,
  syncRemoteToLocal,
  getLocalRowCompareStyle,
  getRemoteRowCompareStyle,
} = useSftpComparison({
  sessionId: () => props.sessionId,
  onBatchUpload: (files) => handleBatchUpload(files),
  onBatchDownload: (files) => handleBatchDownload(files),
})

const getRowStyle = (isLocal: boolean, path: string, file: LocalFileEntry | SftpFileEntry) => {
  const isDropTarget = activeDropFolder.value?.pane === (isLocal ? 'local' : 'remote') && activeDropFolder.value?.path === path
  const isSelected = isLocal ? selectedLocalPaths.value.has(path) : selectedRemotePaths.value.has(path)
  const accentColor = isLocal ? 'var(--color-accent)' : 'var(--color-accent-secondary)'

  if (isDropTarget || isSelected) {
    return {
      backgroundColor: 'var(--color-bg-hover)',
      borderLeft: `3px solid ${accentColor}`,
      color: 'var(--color-text-main)',
    }
  }

  const compareStyle = isLocal ? getLocalRowCompareStyle(file as LocalFileEntry) : getRemoteRowCompareStyle(file as SftpFileEntry)
  if (compareStyle) {
    return {
      borderLeft: '3px solid transparent',
      color: 'var(--color-text-main)',
      ...compareStyle,
    }
  }

  return {
    borderLeft: '3px solid transparent',
    color: 'var(--color-text-main)',
  }
}

// -------------------------------------------------------------
// File & Directory Sorting State & Logic
// -------------------------------------------------------------
const localSortBy = ref<FileSortField>(getStoredSortBy('flowsftp_local_sort_by', 'name'))
const localSortOrder = ref<FileSortOrder>(getStoredSortOrder('flowsftp_local_sort_order', 'asc'))
const remoteSortBy = ref<FileSortField>(getStoredSortBy('flowsftp_remote_sort_by', 'name'))
const remoteSortOrder = ref<FileSortOrder>(getStoredSortOrder('flowsftp_remote_sort_order', 'asc'))

const handleLocalSort = (field: FileSortField) => {
  if (localSortBy.value === field) {
    localSortOrder.value = localSortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    localSortBy.value = field
    localSortOrder.value = 'asc'
  }
  if (typeof window !== 'undefined') {
    localStorage.setItem('flowsftp_local_sort_by', localSortBy.value)
    localStorage.setItem('flowsftp_local_sort_order', localSortOrder.value)
  }
}

const handleRemoteSort = (field: FileSortField) => {
  if (remoteSortBy.value === field) {
    remoteSortOrder.value = remoteSortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    remoteSortBy.value = field
    remoteSortOrder.value = 'asc'
  }
  if (typeof window !== 'undefined') {
    localStorage.setItem('flowsftp_remote_sort_by', remoteSortBy.value)
    localStorage.setItem('flowsftp_remote_sort_order', remoteSortOrder.value)
  }
}

const filteredLocalFiles = computed(() => {
  let list = sftpStore.localFiles
  if (!showHiddenFiles.value) {
    list = list.filter((f) => !f.name.startsWith('.'))
  }
  const q = localSearchQuery.value.trim().toLowerCase()
  if (q) {
    list = list.filter((f) => f.name.toLowerCase().includes(q))
  }
  if (isComparing.value && hideIdenticalFiles.value && comparisonResult.value) {
    list = list.filter((f) => {
      const match = comparisonResult.value?.localMap.get(f.name)
      return match && match.status !== 'identical'
    })
  }
  return sortFileList(list, localSortBy.value, localSortOrder.value)
})

const filteredRemoteFiles = computed(() => {
  let list = sftpStore.remoteFiles
  if (!showHiddenFiles.value) {
    list = list.filter((f) => !f.name.startsWith('.'))
  }
  const q = remoteSearchQuery.value.trim().toLowerCase()
  if (q) {
    list = list.filter((f) => f.name.toLowerCase().includes(q))
  }
  if (isComparing.value && hideIdenticalFiles.value && comparisonResult.value) {
    list = list.filter((f) => {
      const match = comparisonResult.value?.remoteMap.get(f.name)
      return match && match.status !== 'identical'
    })
  }
  return sortFileList(list, remoteSortBy.value, remoteSortOrder.value)
})

// -------------------------------------------------------------
// Quick Look / Instant Preview Computed & Navigation
// -------------------------------------------------------------
const quickLookFileList = computed<(LocalFileEntry | SftpFileEntry)[]>(() => {
  return quickLookTarget.value === 'local' ? filteredLocalFiles.value : filteredRemoteFiles.value
})

const quickLookCurrentIndex = computed<number>(() => {
  if (!quickLookFile.value) return -1
  return quickLookFileList.value.findIndex((f) => f.path === quickLookFile.value?.path)
})

const openQuickLook = (target?: 'local' | 'remote', file?: LocalFileEntry | SftpFileEntry) => {
  const chosenTarget = target || activePane.value
  quickLookTarget.value = chosenTarget

  if (file) {
    quickLookFile.value = file
  } else {
    const isLocal = chosenTarget === 'local'
    const files = isLocal ? filteredLocalFiles.value : filteredRemoteFiles.value
    const selected = isLocal ? selectedLocalFiles.value : selectedRemoteFiles.value
    const lastIdx = isLocal ? lastLocalClickedIndex.value : lastRemoteClickedIndex.value

    if (selected.length > 0 && !selected[0].is_dir) {
      quickLookFile.value = selected[0]
    } else if (lastIdx !== null && lastIdx >= 0 && files[lastIdx] && !files[lastIdx].is_dir) {
      quickLookFile.value = files[lastIdx]
    } else {
      const firstNonDir = files.find((f) => !f.is_dir)
      if (firstNonDir) {
        quickLookFile.value = firstNonDir
      } else {
        return
      }
    }
  }

  showQuickLook.value = true
  closeContextMenu()
}

const navigateQuickLook = (direction: 'prev' | 'next') => {
  const list = quickLookFileList.value
  if (list.length === 0) return
  let idx = quickLookCurrentIndex.value
  if (idx === -1) idx = 0

  if (direction === 'prev') {
    for (let i = idx - 1; i >= 0; i--) {
      if (!list[i].is_dir) {
        quickLookFile.value = list[i]
        return
      }
    }
    for (let i = list.length - 1; i > idx; i--) {
      if (!list[i].is_dir) {
        quickLookFile.value = list[i]
        return
      }
    }
  } else {
    for (let i = idx + 1; i < list.length; i++) {
      if (!list[i].is_dir) {
        quickLookFile.value = list[i]
        return
      }
    }
    for (let i = 0; i < idx; i++) {
      if (!list[i].is_dir) {
        quickLookFile.value = list[i]
        return
      }
    }
  }
}

const toggleFilter = (pane: 'local' | 'remote') => {
  const isLocal = pane === 'local'
  if (isLocal) {
    if (showLocalFilter.value && document.activeElement === localFilterInputRef.value) {
      if (localSearchQuery.value) {
        localFilterInputRef.value?.select()
      } else {
        showLocalFilter.value = false
      }
      return
    }
    showLocalFilter.value = true
    activePane.value = 'local'
    nextTick(() => {
      localFilterInputRef.value?.focus()
      localFilterInputRef.value?.select()
    })
  } else {
    if (!props.sessionId) {
      toggleFilter('local')
      return
    }
    if (showRemoteFilter.value && document.activeElement === remoteFilterInputRef.value) {
      if (remoteSearchQuery.value) {
        remoteFilterInputRef.value?.select()
      } else {
        showRemoteFilter.value = false
      }
      return
    }
    showRemoteFilter.value = true
    activePane.value = 'remote'
    nextTick(() => {
      remoteFilterInputRef.value?.focus()
      remoteFilterInputRef.value?.select()
    })
  }
}

const handleFilterEsc = (pane: 'local' | 'remote') => {
  if (pane === 'local') {
    if (localSearchQuery.value) {
      localSearchQuery.value = ''
    } else {
      showLocalFilter.value = false
      localFilterInputRef.value?.blur()
    }
  } else {
    if (remoteSearchQuery.value) {
      remoteSearchQuery.value = ''
    } else {
      showRemoteFilter.value = false
      remoteFilterInputRef.value?.blur()
    }
  }
}

// Bookmarks State
const localBookmarks = ref<string[]>([])
const remoteBookmarks = ref<string[]>([])
const showLocalBookmarksMenu = ref(false)
const showRemoteBookmarksMenu = ref(false)

const loadBookmarks = () => {
  try {
    const lb = localStorage.getItem('flowsftp_local_bookmarks')
    if (lb) {
      localBookmarks.value = JSON.parse(lb)
    } else {
      localBookmarks.value = []
    }
    const rb = localStorage.getItem('flowsftp_remote_bookmarks')
    if (rb) {
      remoteBookmarks.value = JSON.parse(rb)
    } else {
      remoteBookmarks.value = ['/', '/var/www', '/etc', '/home']
    }
  } catch (e) {
    console.warn('Failed to load bookmarks:', e)
  }
}

const saveLocalBookmarks = () => {
  localStorage.setItem('flowsftp_local_bookmarks', JSON.stringify(localBookmarks.value))
}

const saveRemoteBookmarks = () => {
  localStorage.setItem('flowsftp_remote_bookmarks', JSON.stringify(remoteBookmarks.value))
}

const isLocalBookmarked = computed(() => localBookmarks.value.includes(sftpStore.localPath))
const isRemoteBookmarked = computed(() => remoteBookmarks.value.includes(sftpStore.remotePath))

const toggleLocalBookmark = (path?: string) => {
  const p = path || sftpStore.localPath
  if (!p) return
  if (localBookmarks.value.includes(p)) {
    localBookmarks.value = localBookmarks.value.filter((b) => b !== p)
  } else {
    localBookmarks.value.push(p)
  }
  saveLocalBookmarks()
  closeContextMenu()
}

const toggleRemoteBookmark = (path?: string) => {
  const p = path || sftpStore.remotePath
  if (!p) return
  if (remoteBookmarks.value.includes(p)) {
    remoteBookmarks.value = remoteBookmarks.value.filter((b) => b !== p)
  } else {
    remoteBookmarks.value.push(p)
  }
  saveRemoteBookmarks()
  closeContextMenu()
}

// Open in Terminal
const handleOpenInTerminal = (path?: string) => {
  const p = path || sftpStore.remotePath
  closeContextMenu()
  emit('open-terminal', p)
}

// Open in Default App (Local)
const handleOpenInDefaultApp = async (path: string) => {
  try {
    closeContextMenu()
    await invoke('sftp_open_in_default_app', { path })
  } catch (err) {
    console.error('Failed to open file in default app:', err)
  }
}

// Open in External Editor with Live Sync (Remote)
const handleOpenInExternalEditor = async (file: SftpFileEntry) => {
  closeContextMenu()
  if (!props.sessionId) return
  try {
    const editor = settingsStore.preferredExternalEditor === 'custom'
      ? settingsStore.customExternalEditorCommand
      : settingsStore.preferredExternalEditor
    showArchiveToast(`Opening ${file.name} in external editor...`, false, true, 2500)
    await externalEditStore.startEdit(props.sessionId, file.path, editor)
    showArchiveToast(`Watching ${file.name} for external edits (auto-upload on save)`, false, false, 3500)
  } catch (err: any) {
    console.error('Failed to start external edit:', err)
    showArchiveToast(`Failed to open in external editor: ${err?.message || err}`, true, false, 6000)
  }
}

watch(
  () => externalEditStore.lastSyncNotification,
  (notif) => {
    if (notif && props.sessionId) {
      showArchiveToast(`Auto-uploaded: ${notif.filename} (${notif.time})`, false, false, 3000)
      sftpStore.invalidateRemoteCache(props.sessionId, sftpStore.remotePath)
      sftpStore.fetchRemoteDir(props.sessionId, sftpStore.remotePath, { force: true }).catch(() => {})
    }
  }
)

watch(
  () => dirWatcherStore.lastSyncEvent,
  (ev) => {
    if (ev && ev.status === 'uploaded' && props.sessionId) {
      showArchiveToast(`Auto-synced: ${ev.relative_path}`, false, false, 3000)
      sftpStore.invalidateRemoteCache(props.sessionId, sftpStore.remotePath)
      sftpStore.fetchRemoteDir(props.sessionId, sftpStore.remotePath, { force: true }).catch(() => {})
    }
  }
)

const openDirWatcherModal = (localDir?: string, remoteDir?: string) => {
  dirWatcherLocalDir.value = localDir || sftpStore.localPath
  dirWatcherRemoteDir.value = remoteDir || sftpStore.remotePath
  showDirWatcherModal.value = true
  closeContextMenu()
}

const openSearchModal = (remoteDir?: string) => {
  searchInitialDir.value = remoteDir || sftpStore.remotePath || '/'
  showSearchModal.value = true
  closeContextMenu()
}

// Multi-Selection & Navigation State
const activePane = ref<'local' | 'remote'>('local')
const selectedLocalPaths = ref<Set<string>>(new Set())
const lastLocalClickedIndex = ref<number | null>(null)
const isLocalParentSelected = ref(false)
const localSelectionAnchor = ref<number | null>(null)

const selectedRemotePaths = ref<Set<string>>(new Set())
const lastRemoteClickedIndex = ref<number | null>(null)
const isRemoteParentSelected = ref(false)
const remoteSelectionAnchor = ref<number | null>(null)

const selectedLocalFiles = computed(() =>
  sftpStore.localFiles.filter((f) => selectedLocalPaths.value.has(f.path))
)

const selectedRemoteFiles = computed(() =>
  sftpStore.remoteFiles.filter((f) => selectedRemotePaths.value.has(f.path))
)

// Context Menu State
interface ContextMenuState {
  show: boolean
  x: number
  y: number
  pane: 'local' | 'remote'
  targetItem?: LocalFileEntry | SftpFileEntry | null
}

const contextMenu = ref<ContextMenuState>({
  show: false,
  x: 0,
  y: 0,
  pane: 'local',
  targetItem: null,
})

// Watchers
watch(
  () => sftpStore.localPath,
  (newPath) => {
    localInputPath.value = newPath
    localPaneComp.value?.syncInputPath(newPath)
    localSearchQuery.value = ''
    showLocalFilter.value = false
    selectedLocalPaths.value.clear()
    lastLocalClickedIndex.value = null
    isLocalParentSelected.value = false
    localSelectionAnchor.value = null
  }
)

watch(
  () => sftpStore.remotePath,
  (newPath) => {
    remoteInputPath.value = newPath
    remotePaneComp.value?.syncInputPath(newPath)
    remoteSearchQuery.value = ''
    showRemoteFilter.value = false
    selectedRemotePaths.value.clear()
    lastRemoteClickedIndex.value = null
    isRemoteParentSelected.value = false
    remoteSelectionAnchor.value = null
  }
)

const loadedSessionId = ref<string | null>(null)

const closeContextMenu = () => {
  contextMenu.value.show = false
  localPaneComp.value?.closeAllDropdowns()
  remotePaneComp.value?.closeAllDropdowns()
  transferQueueRef.value?.closeContextMenu()
}

// React to session ID or tab activation
watch(
  () => [props.sessionId, props.active] as const,
  ([newSessionId, isActive]) => {
    // 1. Session ID changed (e.g. connecting to another server or switching session tabs)
    if (newSessionId !== loadedSessionId.value) {
      loadedSessionId.value = newSessionId || null
      selectedRemotePaths.value.clear()
      lastRemoteClickedIndex.value = null
      isRemoteParentSelected.value = false
      remoteSelectionAnchor.value = null
      remoteSearchQuery.value = ''
      showRemoteFilter.value = false
      isConnectionDropped.value = false
      closeContextMenu()

      if (newSessionId) {
        activePane.value = 'remote'
        sftpStore.switchSession(newSessionId)
      } else {
        activePane.value = 'local'
        isComparing.value = false
        sftpStore.switchSession('')
      }
    } else if (newSessionId && isActive) {
      // 2. Tab became active and files are empty/not loaded yet for this session
      if (sftpStore.remoteFiles.length === 0 && !sftpStore.isLoadingRemote) {
        sftpStore.switchSession(newSessionId)
      }
    } else if (!newSessionId) {
      activePane.value = 'local'
    }

    // 3. Initialize local pane when active and empty
    if (isActive && sftpStore.localFiles.length === 0 && !sftpStore.isLoadingLocal) {
      sftpStore.initLocal()
    }
  },
  { immediate: true }
)

// -------------------------------------------------------------
// Keyboard Navigation & Row Selection Helpers
// -------------------------------------------------------------
const handleLocalParentClick = () => {
  closeContextMenu()
  activePane.value = 'local'
  isLocalParentSelected.value = true
  selectedLocalPaths.value.clear()
  lastLocalClickedIndex.value = -1
  localSelectionAnchor.value = -1
  sftpStore.selectedLocalPath = localParentPath.value || ''
}

const handleRemoteParentClick = () => {
  closeContextMenu()
  activePane.value = 'remote'
  isRemoteParentSelected.value = true
  selectedRemotePaths.value.clear()
  lastRemoteClickedIndex.value = -1
  remoteSelectionAnchor.value = -1
  sftpStore.selectedRemotePath = remoteParentPath.value || ''
}

const scrollToRow = (pane: 'local' | 'remote', index: number) => {
  nextTick(() => {
    const id = `${pane}-row-${index === -1 ? 'parent' : index}`
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  })
}

const isAnyModalOpen = () => {
  return (
    showNewFolderModal.value ||
    showNewFileModal.value ||
    showRenameModal.value ||
    showCompressModal.value ||
    showExtractModal.value ||
    showEditorModal.value ||
    showPermissionsModal.value ||
    showDeleteConfirmModal.value ||
    settingsStore.isSettingsModalOpen ||
    showDirWatcherModal.value ||
    showSearchModal.value ||
    vaultStore.showModal
  )
}

const handleWindowShortcut = (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    e.stopPropagation()
    if (props.sessionId) {
      openSearchModal()
    }
  }
}

onMounted(() => {
  const savedLeftPercent = localStorage.getItem('flowsftp_left_pane_percent')
  if (savedLeftPercent) {
    const parsed = parseFloat(savedLeftPercent)
    if (!isNaN(parsed) && parsed >= 20 && parsed <= 80) {
      leftPanePercent.value = parsed
    }
  }

  sftpStore.initLocal()
  vaultStore.init()
  externalEditStore.init()
  dirWatcherStore.init()
  if (props.sessionId) {
    externalEditStore.loadActiveEdits(props.sessionId)
    dirWatcherStore.loadPairings(props.sessionId)
  }
  loadBookmarks()
  startHeartbeat()
  window.addEventListener('online', handleNetworkOnline)
  window.addEventListener('click', closeContextMenu)
  window.addEventListener('keydown', handleWindowShortcut)
  window.addEventListener('auxclick', handleAuxClick)
})

onUnmounted(() => {
  window.removeEventListener('auxclick', handleAuxClick)
  window.removeEventListener('keydown', handleWindowShortcut)
  window.removeEventListener('click', closeContextMenu)
  window.removeEventListener('online', handleNetworkOnline)
  if (heartbeatInterval) clearInterval(heartbeatInterval)
  if (reconnectTimer) clearInterval(reconnectTimer)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
})

// Directory Navigation Helpers & Parent Resolution
const getLocalParentPath = (pathStr: string): string | null => {
  if (!pathStr) return null
  const normalized = pathStr.replace(/\\/g, '/').replace(/\/+$/, '')
  // Prevent navigating above the UNC share/distro root (e.g. //wsl.localhost/Ubuntu-24.04)
  if (normalized.startsWith('//')) {
    const parts = normalized.split('/')
    if (parts.length <= 4) {
      return null
    }
    return parts.slice(0, -1).join('/')
  }
  // Windows drive root (e.g. C: or C:/)
  if (/^[a-zA-Z]:$/.test(normalized)) {
    return null
  }
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash === -1) {
    return null
  }
  let parent = normalized.substring(0, lastSlash)
  if (/^[a-zA-Z]:$/.test(parent)) {
    parent += '/'
  } else if (parent === '') {
    parent = '/'
  }
  if (normalized === '' || normalized === '/') {
    return null
  }
  return parent
}

const getRemoteParentPath = (pathStr: string): string | null => {
  if (!pathStr || !props.sessionId) return null
  const normalized = pathStr.replace(/\\/g, '/').replace(/\/+$/, '')
  if (normalized === '' || normalized === '/') {
    return null
  }
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash === -1) {
    return '/'
  }
  const parent = normalized.substring(0, lastSlash)
  return parent.length === 0 ? '/' : parent
}

const localParentPath = computed(() => getLocalParentPath(sftpStore.localPath))
const canNavigateLocalUp = computed(() => !!localParentPath.value)

const remoteParentPath = computed(() => getRemoteParentPath(sftpStore.remotePath))
const canNavigateRemoteUp = computed(() => !!props.sessionId && !!remoteParentPath.value)

// -------------------------------------------------------------
// Folder Navigation History (Back / Forward Stacks)
// -------------------------------------------------------------
const localHistory = ref<string[]>([])
const localHistoryIndex = ref<number>(-1)
let isNavigatingLocalHistory = false

const canNavigateLocalBack = computed(() => localHistoryIndex.value > 0)
const canNavigateLocalForward = computed(
  () => localHistoryIndex.value >= 0 && localHistoryIndex.value < localHistory.value.length - 1
)

watch(
  () => sftpStore.localPath,
  (newPath) => {
    if (!newPath) return
    if (isNavigatingLocalHistory) {
      isNavigatingLocalHistory = false
      return
    }
    if (localHistory.value.length === 0) {
      localHistory.value = [newPath]
      localHistoryIndex.value = 0
    } else if (localHistory.value[localHistoryIndex.value] !== newPath) {
      localHistory.value = localHistory.value.slice(0, localHistoryIndex.value + 1)
      localHistory.value.push(newPath)
      localHistoryIndex.value = localHistory.value.length - 1
    }
  },
  { immediate: true }
)

const navigateLocalBack = () => {
  if (!canNavigateLocalBack.value) return
  isNavigatingLocalHistory = true
  localHistoryIndex.value--
  const targetPath = localHistory.value[localHistoryIndex.value]
  if (targetPath) {
    sftpStore.fetchLocalDir(targetPath)
  }
}

const navigateLocalForward = () => {
  if (!canNavigateLocalForward.value) return
  isNavigatingLocalHistory = true
  localHistoryIndex.value++
  const targetPath = localHistory.value[localHistoryIndex.value]
  if (targetPath) {
    sftpStore.fetchLocalDir(targetPath)
  }
}

const remoteHistory = ref<string[]>([])
const remoteHistoryIndex = ref<number>(-1)
let isNavigatingRemoteHistory = false

const canNavigateRemoteBack = computed(
  () => !!props.sessionId && remoteHistoryIndex.value > 0
)
const canNavigateRemoteForward = computed(
  () =>
    !!props.sessionId &&
    remoteHistoryIndex.value >= 0 &&
    remoteHistoryIndex.value < remoteHistory.value.length - 1
)

watch(
  () => sftpStore.remotePath,
  (newPath) => {
    if (!newPath || !props.sessionId) return
    if (isNavigatingRemoteHistory) {
      isNavigatingRemoteHistory = false
      return
    }
    if (remoteHistory.value.length === 0) {
      remoteHistory.value = [newPath]
      remoteHistoryIndex.value = 0
    } else if (remoteHistory.value[remoteHistoryIndex.value] !== newPath) {
      remoteHistory.value = remoteHistory.value.slice(0, remoteHistoryIndex.value + 1)
      remoteHistory.value.push(newPath)
      remoteHistoryIndex.value = remoteHistory.value.length - 1
    }
  },
  { immediate: true }
)

watch(
  () => props.sessionId,
  (newSid) => {
    remoteHistory.value = []
    remoteHistoryIndex.value = -1
    if (newSid && sftpStore.remotePath) {
      remoteHistory.value = [sftpStore.remotePath]
      remoteHistoryIndex.value = 0
    }
  }
)

const navigateRemoteBack = () => {
  if (!canNavigateRemoteBack.value || !props.sessionId) return
  isNavigatingRemoteHistory = true
  remoteHistoryIndex.value--
  const targetPath = remoteHistory.value[remoteHistoryIndex.value]
  if (targetPath) {
    sftpStore.fetchRemoteDir(props.sessionId, targetPath)
  }
}

const navigateRemoteForward = () => {
  if (!canNavigateRemoteForward.value || !props.sessionId) return
  isNavigatingRemoteHistory = true
  remoteHistoryIndex.value++
  const targetPath = remoteHistory.value[remoteHistoryIndex.value]
  if (targetPath) {
    sftpStore.fetchRemoteDir(props.sessionId, targetPath)
  }
}

// Mouse Back / Forward (Button 3 & 4) Support
const handleAuxClick = (e: MouseEvent) => {
  if (props.active === false) return
  if (isAnyModalOpen()) return
  if (e.button === 3) {
    e.preventDefault()
    if (activePane.value === 'local') {
      navigateLocalBack()
    } else {
      navigateRemoteBack()
    }
  } else if (e.button === 4) {
    e.preventDefault()
    if (activePane.value === 'local') {
      navigateLocalForward()
    } else {
      navigateRemoteForward()
    }
  }
}

// Tab: Toggle Active Pane
const toggleActivePane = () => {
  if (props.sessionId) {
    activePane.value = activePane.value === 'local' ? 'remote' : 'local'
  } else {
    activePane.value = 'local'
  }
  nextTick(() => {
    if (activePane.value === 'local') {
      if (selectedLocalFiles.value.length === 0 && filteredLocalFiles.value.length > 0) {
        const idx = canNavigateLocalUp.value ? -1 : 0
        applySelection(true, idx, null, false)
      }
    } else {
      if (selectedRemoteFiles.value.length === 0 && filteredRemoteFiles.value.length > 0) {
        const idx = canNavigateRemoteUp.value ? -1 : 0
        applySelection(false, idx, null, false)
      }
    }
  })
}

// Ctrl+L: Edit active pane's address / location bar
const editActivePath = () => {
  if (activePane.value === 'local') {
    localPaneComp.value?.startEditPath()
  } else {
    remotePaneComp.value?.startEditPath()
  }
}

// Local Directory Navigation
const navigateLocalUp = () => {
  const parent = localParentPath.value
  if (parent) {
    sftpStore.fetchLocalDir(parent)
    if (sftpStore.isSynchronizedBrowsing && props.sessionId && remoteParentPath.value) {
      sftpStore.fetchRemoteDir(props.sessionId, remoteParentPath.value)
    }
  }
}

const handleLocalRowDoubleClick = (entry: LocalFileEntry) => {
  if (entry.is_dir) {
    sftpStore.fetchLocalDir(entry.path)
    if (sftpStore.isSynchronizedBrowsing && props.sessionId) {
      const match = sftpStore.remoteFiles.find(
        (f) => f.is_dir && f.name.toLowerCase() === entry.name.toLowerCase()
      )
      if (match) {
        sftpStore.fetchRemoteDir(props.sessionId, match.path)
      }
    }
  } else {
    openEditor('local', entry)
  }
}

// Remote Directory Navigation
const navigateRemoteUp = () => {
  if (!props.sessionId) return
  const parent = remoteParentPath.value
  if (parent) {
    sftpStore.fetchRemoteDir(props.sessionId, parent)
    if (sftpStore.isSynchronizedBrowsing && localParentPath.value) {
      sftpStore.fetchLocalDir(localParentPath.value)
    }
  }
}

const handleRemoteRowDoubleClick = (entry: SftpFileEntry) => {
  if (entry.is_dir && props.sessionId) {
    sftpStore.fetchRemoteDir(props.sessionId, entry.path)
    if (sftpStore.isSynchronizedBrowsing) {
      const match = sftpStore.localFiles.find(
        (f) => f.is_dir && f.name.toLowerCase() === entry.name.toLowerCase()
      )
      if (match) {
        sftpStore.fetchLocalDir(match.path)
      }
    }
  } else if (!entry.is_dir) {
    openEditor('remote', entry)
  }
}

// -------------------------------------------------------------
// Multi-Selection Logic (Shift / Ctrl / Cmd)
// -------------------------------------------------------------
const handleLocalRowClick = (event: MouseEvent, file: LocalFileEntry, index: number) => {
  closeContextMenu()
  activePane.value = 'local'
  isLocalParentSelected.value = false
  localSelectionAnchor.value = index
  if (event.shiftKey && lastLocalClickedIndex.value !== null) {
    const start = Math.min(lastLocalClickedIndex.value, index)
    const end = Math.max(lastLocalClickedIndex.value, index)
    const newSelection = event.ctrlKey || event.metaKey ? new Set(selectedLocalPaths.value) : new Set<string>()
    for (let i = start; i <= end; i++) {
      if (filteredLocalFiles.value[i]) {
        newSelection.add(filteredLocalFiles.value[i].path)
      }
    }
    selectedLocalPaths.value = newSelection
  } else if (event.ctrlKey || event.metaKey) {
    const newSelection = new Set(selectedLocalPaths.value)
    if (newSelection.has(file.path)) {
      newSelection.delete(file.path)
    } else {
      newSelection.add(file.path)
    }
    selectedLocalPaths.value = newSelection
    lastLocalClickedIndex.value = index
  } else {
    selectedLocalPaths.value = new Set([file.path])
    lastLocalClickedIndex.value = index
  }
  sftpStore.selectedLocalPath = file.path
}

const handleRemoteRowClick = (event: MouseEvent, file: SftpFileEntry, index: number) => {
  closeContextMenu()
  activePane.value = 'remote'
  isRemoteParentSelected.value = false
  remoteSelectionAnchor.value = index
  if (event.shiftKey && lastRemoteClickedIndex.value !== null) {
    const start = Math.min(lastRemoteClickedIndex.value, index)
    const end = Math.max(lastRemoteClickedIndex.value, index)
    const newSelection = event.ctrlKey || event.metaKey ? new Set(selectedRemotePaths.value) : new Set<string>()
    for (let i = start; i <= end; i++) {
      if (filteredRemoteFiles.value[i]) {
        newSelection.add(filteredRemoteFiles.value[i].path)
      }
    }
    selectedRemotePaths.value = newSelection
  } else if (event.ctrlKey || event.metaKey) {
    const newSelection = new Set(selectedRemotePaths.value)
    if (newSelection.has(file.path)) {
      newSelection.delete(file.path)
    } else {
      newSelection.add(file.path)
    }
    selectedRemotePaths.value = newSelection
    lastRemoteClickedIndex.value = index
  } else {
    selectedRemotePaths.value = new Set([file.path])
    lastRemoteClickedIndex.value = index
  }
  sftpStore.selectedRemotePath = file.path
}

const clearLocalSelection = () => {
  selectedLocalPaths.value = new Set()
  sftpStore.selectedLocalPath = null
  lastLocalClickedIndex.value = null
  isLocalParentSelected.value = false
  localSelectionAnchor.value = null
}

const clearRemoteSelection = () => {
  selectedRemotePaths.value = new Set()
  sftpStore.selectedRemotePath = null
  lastRemoteClickedIndex.value = null
  isRemoteParentSelected.value = false
  remoteSelectionAnchor.value = null
}

const handleLocalEmptyClick = (_event?: MouseEvent) => {
  closeContextMenu()
  activePane.value = 'local'
  clearLocalSelection()
}

const handleRemoteEmptyClick = (_event?: MouseEvent) => {
  closeContextMenu()
  activePane.value = 'remote'
  clearRemoteSelection()
}

const selectAll = (pane: 'local' | 'remote') => {
  if (pane === 'local') {
    selectedLocalPaths.value = new Set(filteredLocalFiles.value.map((f) => f.path))
    if (filteredLocalFiles.value.length > 0) {
      lastLocalClickedIndex.value = 0
    }
  } else {
    selectedRemotePaths.value = new Set(filteredRemoteFiles.value.map((f) => f.path))
    if (filteredRemoteFiles.value.length > 0) {
      lastRemoteClickedIndex.value = 0
    }
  }
}

// -------------------------------------------------------------
// Custom Right-Click Context Menu
// -------------------------------------------------------------
const openLocalContextMenu = (e: MouseEvent, file?: LocalFileEntry) => {
  e.preventDefault()
  if (file) {
    if (!selectedLocalPaths.value.has(file.path)) {
      selectedLocalPaths.value = new Set([file.path])
      lastLocalClickedIndex.value = filteredLocalFiles.value.findIndex((f) => f.path === file.path)
      sftpStore.selectedLocalPath = file.path
    }
  } else {
    clearLocalSelection()
  }
  const x = Math.max(10, Math.min(e.clientX, window.innerWidth - 275))
  const y = Math.max(45, Math.min(e.clientY, window.innerHeight - 420))
  contextMenu.value = {
    show: true,
    x,
    y,
    pane: 'local',
    targetItem: file || null,
  }
}

const openRemoteContextMenu = (e: MouseEvent, file?: SftpFileEntry) => {
  e.preventDefault()
  if (file) {
    if (!selectedRemotePaths.value.has(file.path)) {
      selectedRemotePaths.value = new Set([file.path])
      lastRemoteClickedIndex.value = filteredRemoteFiles.value.findIndex((f) => f.path === file.path)
      sftpStore.selectedRemotePath = file.path
    }
  } else {
    clearRemoteSelection()
  }
  const x = Math.max(10, Math.min(e.clientX, window.innerWidth - 275))
  const y = Math.max(45, Math.min(e.clientY, window.innerHeight - 420))
  contextMenu.value = {
    show: true,
    x,
    y,
    pane: 'remote',
    targetItem: file || null,
  }
}

// -------------------------------------------------------------
// -------------------------------------------------------------
// Drag & Drop Handling (Left <-> Right & Desktop Drops)
// -------------------------------------------------------------
const {
  activeDropFolder,
  activeDragging,
  isLocalDragActive,
  isRemoteDragActive,
  handleLocalDragStart,
  handleLocalDragEnd,
  handleRemoteDragStart,
  handleRemoteDragEnd,
  handleRemoteDragEnter,
  handleRemoteDragOver,
  handleRemoteDragLeave,
  handleRemoteDrop,
  handleLocalDragEnter,
  handleLocalDragOver,
  handleLocalDragLeave,
  handleLocalDrop,
  handleFolderDragOver,
  handleFolderDragLeave,
  handleParentFolderDragOver,
  handleParentFolderDragLeave,
  handleParentFolderDrop,
  handleFolderDrop,
} = useSftpDragDrop({
  active: () => props.active,
  sessionId: () => props.sessionId,
  localPaneRef,
  remotePaneRef,
  localParentPath,
  remoteParentPath,
  selectedLocalFiles,
  selectedRemoteFiles,
  selectedLocalPaths,
  selectedRemotePaths,
  lastLocalClickedIndex,
  lastRemoteClickedIndex,
  onBatchUpload: (files, dest) => handleBatchUpload(files, dest),
  onBatchDownload: (files, dest) => handleBatchDownload(files, dest),
})

// -------------------------------------------------------------
// Keyboard Navigation & Shortcuts
// -------------------------------------------------------------
const {
  focusFirstItem,
  handleGlobalKeyDown,
  handleKeyNavigation,
  applySelection,
} = useSftpKeyboardNav({
  active: () => props.active,
  sessionId: () => props.sessionId,
  activePane,
  selectedLocalFiles,
  selectedRemoteFiles,
  selectedLocalPaths,
  selectedRemotePaths,
  localSelectionAnchor,
  remoteSelectionAnchor,
  lastLocalClickedIndex,
  lastRemoteClickedIndex,
  isLocalParentSelected,
  isRemoteParentSelected,
  localParentPath,
  remoteParentPath,
  filteredLocalFiles,
  filteredRemoteFiles,
  canNavigateLocalUp,
  canNavigateRemoteUp,
  showQuickLook,
  quickLookFile,
  showEditorModal,
  showDeleteConfirmModal,
  showLocalFilter,
  showRemoteFilter,
  localSearchQuery,
  remoteSearchQuery,
  isComparing,
  hideIdenticalFiles,
  localFilterInputRef,
  remoteFilterInputRef,
  onRenameSelected: () => triggerRenameSelected(),
  onDeleteLocal: (files) => handleBatchDeleteLocal(files),
  onDeleteRemote: (files) => handleBatchDeleteRemote(files),
  onToggleComparison: () => toggleComparison(),
  onToggleFilter: (pane) => toggleFilter(pane),
  onSelectAll: (pane) => selectAll(pane),
  onOpenQuickLook: () => openQuickLook(),
  onCloseDeleteConfirm: () => closeDeleteConfirm(),
  onCloseContextMenu: () => closeContextMenu(),
  onCloseOtherModals: () => {
    showNewFolderModal.value = false
    showNewFileModal.value = false
    showRenameModal.value = false
    showCompressModal.value = false
    showExtractModal.value = false
    showSearchModal.value = false
    showDirWatcherModal.value = false
    localPaneComp.value?.closeAllDropdowns()
    remotePaneComp.value?.closeAllDropdowns()
    settingsStore.closeSettings()
    showPermissionsModal.value = false
  },
  onNavigateLocalUp: () => navigateLocalUp(),
  onNavigateRemoteUp: () => navigateRemoteUp(),
  onLocalRowDoubleClick: (entry) => handleLocalRowDoubleClick(entry),
  onRemoteRowDoubleClick: (entry) => handleRemoteRowDoubleClick(entry),
  onScrollToRow: (pane, idx) => scrollToRow(pane, idx),
  onTogglePane: () => toggleActivePane(),
  onEditPath: () => editActivePath(),
  onRefresh: (pane, both) => handleRefresh(both ? 'both' : pane),
  onTransferCopy: () => handleTransferCopy(),
  onTransferMove: () => handleTransferMove(),
  onNewFolder: (pane) => openNewFolder(pane),
  onNavigateBack: (pane) => (pane === 'local' ? navigateLocalBack() : navigateRemoteBack()),
  onNavigateForward: (pane) => (pane === 'local' ? navigateLocalForward() : navigateRemoteForward()),
  isAnyModalOpen,
})

const handleBatchUpload = async (files?: LocalFileEntry[], destinationDir?: string) => {
  const targetFiles = (Array.isArray(files) && files.length > 0) ? files : selectedLocalFiles.value
  if (!props.sessionId || targetFiles.length === 0) return
  closeContextMenu()
  dismissTransferToasts()
  showTransferDrawer.value = true
  transferTab.value = 'active'
  try {
    await sftpStore.startBatchUpload(props.sessionId, targetFiles, destinationDir)
  } catch (err) {
    console.error('Batch upload failed:', err)
  }
}

const handleBatchDownload = async (files?: SftpFileEntry[], destinationDir?: string) => {
  const targetFiles = (Array.isArray(files) && files.length > 0) ? files : selectedRemoteFiles.value
  if (!props.sessionId || targetFiles.length === 0) return
  closeContextMenu()
  dismissTransferToasts()
  showTransferDrawer.value = true
  transferTab.value = 'active'
  try {
    await sftpStore.startBatchDownload(props.sessionId, targetFiles, destinationDir)
  } catch (err) {
    console.error('Batch download failed:', err)
  }
}

// Transfer triggers from row buttons: if the clicked row is part of a multi-selection, upload/download the entire selection!
const handleUpload = async (localFile: LocalFileEntry) => {
  if (selectedLocalFiles.value.length > 1 && selectedLocalPaths.value.has(localFile.path)) {
    await handleBatchUpload(selectedLocalFiles.value)
  } else {
    await handleBatchUpload([localFile])
  }
}

const handleDownload = async (remoteFile: SftpFileEntry) => {
  if (selectedRemoteFiles.value.length > 1 && selectedRemotePaths.value.has(remoteFile.path)) {
    await handleBatchDownload(selectedRemoteFiles.value)
  } else {
    await handleBatchDownload([remoteFile])
  }
}

// Copy / Transfer selected files to opposite pane (Alt+F5)
const handleTransferCopy = async () => {
  if (!props.sessionId) return
  if (activePane.value === 'local') {
    if (selectedLocalFiles.value.length === 0) return
    await handleBatchUpload(selectedLocalFiles.value)
  } else {
    if (selectedRemoteFiles.value.length === 0) return
    await handleBatchDownload(selectedRemoteFiles.value)
  }
}

// F6: Move selected files to opposite pane (Transfer + Delete source prompt)
const handleTransferMove = async () => {
  if (!props.sessionId) return
  if (activePane.value === 'local') {
    if (selectedLocalFiles.value.length === 0) return
    const filesToMove = [...selectedLocalFiles.value]
    await handleBatchUpload(filesToMove)
    openDeleteConfirm('local', filesToMove)
  } else {
    if (selectedRemoteFiles.value.length === 0) return
    const filesToMove = [...selectedRemoteFiles.value]
    await handleBatchDownload(filesToMove)
    openDeleteConfirm('remote', filesToMove)
  }
}

// -------------------------------------------------------------
// Batch Delete Operations (Custom Lightbox Confirmation Modal)
// -------------------------------------------------------------
const openDeleteConfirm = (pane: 'local' | 'remote', files: (LocalFileEntry | SftpFileEntry)[]) => {
  if (!files || files.length === 0) return
  if (activeDeletion.value) {
    showArchiveToast('A deletion is already running in the background. Please wait or cancel it first.', true, false, 4000)
    return
  }
  closeContextMenu()
  useFastRm.value = false
  deleteTarget.value = { pane, files: [...files] }
  showDeleteConfirmModal.value = true
}

const closeDeleteConfirm = () => {
  showDeleteConfirmModal.value = false
  deleteTarget.value = null
  useFastRm.value = false
}

const cancelActiveDeletion = async () => {
  if (!activeDeletion.value || activeDeletion.value.isCancelling) return
  activeDeletion.value.isCancelling = true
  const cancellingDelId = activeDeletion.value.id
  const cancellingTitle = activeDeletion.value.title
  const cancellingPane = activeDeletion.value.pane

  showArchiveToast(`Cancelling deletion of ${cancellingTitle}...`, false, true, 2500)

  try {
    await invoke('sftp_cancel_transfer', { transferId: cancellingDelId })
  } catch (e) {
    console.error('Failed to cancel deletion:', e)
  }

  // Safety fallback: ensure deletion UI never gets stuck even if backend takes longer
  setTimeout(() => {
    if (activeDeletion.value && activeDeletion.value.id === cancellingDelId) {
      console.warn('[cancelActiveDeletion] Fallback clearing deletion state after 1.5s timeout')
      activeDeletion.value = null
      isDeletingFiles.value = false
      showArchiveToast(`Deletion of ${cancellingTitle} was cancelled`, false, false, 3500)
      const targetSessionId = props.sessionId || sftpStore.currentSessionId
      if (cancellingPane === 'remote' && targetSessionId) {
        sftpStore.fetchRemoteDir(targetSessionId, sftpStore.remotePath, { force: true }).catch(() => {})
      } else if (cancellingPane === 'local') {
        sftpStore.fetchLocalDir(sftpStore.localPath, { force: true }).catch(() => {})
      }
    }
  }, 1500)
}

const executeDeleteFiles = async () => {
  if (!deleteTarget.value || deleteTarget.value.files.length === 0) return
  const { pane, files } = deleteTarget.value
  const fastRm = useFastRm.value

  // Close confirmation modal immediately so the user can continue working without being trapped
  showDeleteConfirmModal.value = false
  deleteTarget.value = null
  useFastRm.value = false

  const targetSessionId = props.sessionId || sftpStore.currentSessionId
  console.log('[executeDeleteFiles] Starting deletion:', {
    pane,
    count: files.length,
    fastRm,
    sessionId: targetSessionId,
    paths: files.map((f) => f.path),
  })

  // Ensure any lingering queue cancel states are cleared safely
  try {
    if (typeof sftpStore.ensureTransferReady === 'function') {
      await sftpStore.ensureTransferReady()
    }
  } catch (err) {
    console.warn('[executeDeleteFiles] ensureTransferReady warning:', err)
  }

  isDeletingFiles.value = true
  const deletionId = 'del-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)
  const itemNames = files.length === 1
    ? files[0].name
    : `${files.length} items (${files[0].name}, ...)`

  activeDeletion.value = {
    id: deletionId,
    pane,
    title: itemNames,
    totalCount: files.length,
    completedCount: 0,
    isCancelling: false,
  }

  let wasCancelled = false
  try {
    if (pane === 'local') {
      for (let i = 0; i < files.length; i++) {
        if (activeDeletion.value?.isCancelling) {
          wasCancelled = true
          break
        }
        console.log(`[executeDeleteFiles] Deleting local item [${i + 1}/${files.length}]:`, files[i].path)
        await sftpStore.deleteLocalItem(files[i] as LocalFileEntry, true)
        if (activeDeletion.value) {
          activeDeletion.value.completedCount = i + 1
        }
      }
    } else if (pane === 'remote') {
      if (!targetSessionId) {
        throw new Error('No active remote session is connected.')
      }
      for (let i = 0; i < files.length; i++) {
        if (activeDeletion.value?.isCancelling) {
          wasCancelled = true
          break
        }
        console.log(`[executeDeleteFiles] Deleting remote item [${i + 1}/${files.length}]:`, files[i].path, 'fastRm:', fastRm)
        await sftpStore.deleteRemoteItem(targetSessionId, files[i] as SftpFileEntry, deletionId, true, fastRm)
        if (activeDeletion.value) {
          activeDeletion.value.completedCount = i + 1
        }
      }
    }

    if (wasCancelled || activeDeletion.value?.isCancelling) {
      showArchiveToast(`Deletion of ${itemNames} was cancelled`, false, false, 3500)
    } else {
      showArchiveToast(`Successfully deleted ${itemNames}`, false, false, 3500)
    }
  } catch (err: any) {
    const errMsg = String(err?.message || err)
    console.error('[executeDeleteFiles] Deletion failed with error:', err)
    if (errMsg.toLowerCase().includes('cancel') || activeDeletion.value?.isCancelling) {
      showArchiveToast(`Deletion of ${itemNames} was cancelled`, false, false, 3500)
    } else {
      showArchiveToast(`Delete failed: ${errMsg}`, true, false, 8000)
    }
  } finally {
    isDeletingFiles.value = false
    activeDeletion.value = null

    if (pane === 'local') {
      selectedLocalPaths.value.clear()
      sftpStore.fetchLocalDir(sftpStore.localPath, { force: true }).catch(() => {})
    } else if (pane === 'remote' && targetSessionId) {
      selectedRemotePaths.value.clear()
      sftpStore.fetchRemoteDir(targetSessionId, sftpStore.remotePath, { force: true }).catch(() => {})
    }
  }
}

const handleBatchDeleteLocal = (files?: LocalFileEntry[]) => {
  const targetFiles = (Array.isArray(files) && files.length > 0)
    ? files
    : selectedLocalFiles.value
  if (!targetFiles || targetFiles.length === 0) return
  openDeleteConfirm('local', targetFiles)
}

const handleBatchDeleteRemote = (files?: SftpFileEntry[]) => {
  const targetFiles = (Array.isArray(files) && files.length > 0)
    ? files
    : selectedRemoteFiles.value
  if (!targetFiles || targetFiles.length === 0) return
  openDeleteConfirm('remote', targetFiles)
}

const handleDeleteLocal = (entry: LocalFileEntry) => {
  openDeleteConfirm('local', [entry])
}

const handleDeleteRemote = (entry: SftpFileEntry) => {
  openDeleteConfirm('remote', [entry])
}

// -------------------------------------------------------------
// Folder Creation & Renaming & File Creation
// -------------------------------------------------------------
const focusInput = (inputEl: HTMLInputElement | null) => {
  if (!inputEl) return
  inputEl.focus()
  inputEl.select()
}

watch(showNewFolderModal, (val) => {
  if (val) {
    nextTick(() => {
      focusInput(newFolderInputRef.value)
      setTimeout(() => focusInput(newFolderInputRef.value), 50)
    })
  }
})

watch(showNewFileModal, (val) => {
  if (val) {
    nextTick(() => {
      focusInput(newFileInputRef.value)
      setTimeout(() => focusInput(newFileInputRef.value), 50)
    })
  }
})

const focusRenameInput = (inputEl: HTMLInputElement | null, isDir = false) => {
  if (!inputEl) return
  inputEl.focus()
  const name = inputEl.value
  if (isDir || !name.includes('.') || (name.startsWith('.') && name.indexOf('.', 1) === -1)) {
    inputEl.select()
  } else {
    const lastDot = name.lastIndexOf('.')
    if (lastDot > 0) {
      inputEl.setSelectionRange(0, lastDot)
    } else {
      inputEl.select()
    }
  }
}

watch(showRenameModal, (val) => {
  if (val) {
    nextTick(() => {
      focusRenameInput(renameInputRef.value, renameItem.value?.is_dir)
      setTimeout(() => focusRenameInput(renameInputRef.value, renameItem.value?.is_dir), 50)
    })
  }
})

const openNewFolder = (target: 'local' | 'remote') => {
  newFolderTarget.value = target
  newFolderName.value = ''
  showNewFolderModal.value = true
  closeContextMenu()
  nextTick(() => focusInput(newFolderInputRef.value))
  setTimeout(() => focusInput(newFolderInputRef.value), 50)
}

const submitNewFolder = async (folderName?: string) => {
  const nameToUse = (typeof folderName === 'string' ? folderName : newFolderName.value).trim()
  if (!nameToUse) return
  if (newFolderTarget.value === 'local') {
    await sftpStore.createLocalFolder(nameToUse)
  } else if (props.sessionId) {
    await sftpStore.createRemoteFolder(props.sessionId, nameToUse)
  }
  showNewFolderModal.value = false
}

const openNewFile = (target: 'local' | 'remote') => {
  newFileTarget.value = target
  newFileName.value = ''
  showNewFileModal.value = true
  closeContextMenu()
  nextTick(() => focusInput(newFileInputRef.value))
}

const submitNewFile = async (fileName?: string, overwrite: boolean = false) => {
  const nameToUse = (typeof fileName === 'string' ? fileName : newFileName.value).trim()
  if (!nameToUse) return
  try {
    if (newFileTarget.value === 'local') {
      await sftpStore.createLocalFile(nameToUse, overwrite)
    } else if (props.sessionId) {
      await sftpStore.createRemoteFile(props.sessionId, nameToUse, overwrite)
    }
    showNewFileModal.value = false
  } catch (err: any) {
    console.error('Failed to create file:', err)
  }
}

const openRename = (target: 'local' | 'remote', item: LocalFileEntry | SftpFileEntry) => {
  if (!item || item.name === '..') return
  renameTarget.value = target
  renameItem.value = item
  renameNewName.value = item.name
  showRenameModal.value = true
  closeContextMenu()
  nextTick(() => {
    focusRenameInput(renameInputRef.value, item.is_dir)
    setTimeout(() => focusRenameInput(renameInputRef.value, item.is_dir), 50)
  })
}

const triggerRenameSelected = () => {
  const isLocal = activePane.value === 'local'
  const primaryPane: 'local' | 'remote' = isLocal ? 'local' : 'remote'
  const secondaryPane: 'local' | 'remote' = isLocal ? 'remote' : 'local'

  const findRenameCandidate = (pane: 'local' | 'remote') => {
    const isTargetLocal = pane === 'local'
    const selected = isTargetLocal ? selectedLocalFiles.value : selectedRemoteFiles.value
    if (selected.length === 0) return null

    const files = isTargetLocal ? filteredLocalFiles.value : filteredRemoteFiles.value
    const lastIndex = isTargetLocal ? lastLocalClickedIndex.value : lastRemoteClickedIndex.value
    const selectedPaths = isTargetLocal ? selectedLocalPaths.value : selectedRemotePaths.value

    if (
      lastIndex !== null &&
      lastIndex >= 0 &&
      lastIndex < files.length &&
      selectedPaths.has(files[lastIndex].path) &&
      files[lastIndex].name !== '..'
    ) {
      return files[lastIndex]
    }

    return selected.find((f) => f.name !== '..') || null
  }

  const primaryCandidate = findRenameCandidate(primaryPane)
  if (primaryCandidate) {
    openRename(primaryPane, primaryCandidate)
    return
  }

  if (secondaryPane === 'remote' && !props.sessionId) return
  const secondaryCandidate = findRenameCandidate(secondaryPane)
  if (secondaryCandidate) {
    activePane.value = secondaryPane
    openRename(secondaryPane, secondaryCandidate)
  }
}

const getRenamedPath = (oldPath: string, newName: string, isLocal: boolean): string => {
  const lastSlash = Math.max(oldPath.lastIndexOf('/'), oldPath.lastIndexOf('\\'))
  if (lastSlash < 0) {
    return newName
  }
  const sep = oldPath[lastSlash]
  let parent = oldPath.substring(0, lastSlash)
  if (parent === '' && sep === '/') {
    parent = '/'
  } else if (/^[a-zA-Z]:$/.test(parent) && sep === '\\') {
    parent = `${parent}\\`
  }

  if (parent.endsWith('/') || parent.endsWith('\\')) {
    return `${parent}${newName}`
  }
  return `${parent}${sep}${newName}`
}

const submitRename = async (newName?: string) => {
  const nameToUse = (typeof newName === 'string' ? newName : renameNewName.value).trim()
  if (!renameItem.value || !nameToUse || nameToUse === renameItem.value.name) {
    showRenameModal.value = false
    return
  }
  const oldPath = renameItem.value.path
  const isLocal = renameTarget.value === 'local'
  const newPath = getRenamedPath(oldPath, nameToUse, isLocal)

  try {
    if (renameTarget.value === 'local') {
      await sftpStore.renameLocalItem(oldPath, newPath)
    } else if (props.sessionId) {
      await sftpStore.renameRemoteItem(props.sessionId, oldPath, newPath)
    }
  } catch (err: any) {
    console.error('Failed to rename item:', err)
  } finally {
    showRenameModal.value = false
  }
}

const handleDeleteConfirm = (fastRm: boolean) => {
  useFastRm.value = fastRm
  executeDeleteFiles()
}

const handleCopyPath = (path: string) => {
  navigator.clipboard.writeText(path)
  closeContextMenu()
}

// Archive Operations Handlers
watch(showCompressModal, (val) => {
  if (val) {
    nextTick(() => {
      focusInput(compressInputRef.value)
      setTimeout(() => focusInput(compressInputRef.value), 50)
    })
  }
})

watch(showExtractModal, (val) => {
  if (val) {
    nextTick(() => {
      focusInput(extractInputRef.value)
      setTimeout(() => focusInput(extractInputRef.value), 50)
    })
  }
})

const handleExtractArchiveHere = async (target: 'local' | 'remote', file: LocalFileEntry | SftpFileEntry) => {
  closeContextMenu()
  showArchiveToast(`Extracting ${file.name}...`, false, true)
  try {
    if (target === 'remote') {
      if (!props.sessionId) return
      await sftpStore.extractRemoteArchive(props.sessionId, file.path)
    } else {
      await sftpStore.extractLocalArchive(file.path)
    }
    showArchiveToast(`Extracted ${file.name} successfully!`, false, false, 3500)
  } catch (err: any) {
    showArchiveToast(`Extraction failed: ${err}`, true, false, 6000)
  }
}

const openExtractToFolderModal = (target: 'local' | 'remote', file: LocalFileEntry | SftpFileEntry) => {
  closeContextMenu()
  extractTarget.value = target
  extractArchiveFile.value = file
  const baseName = file.name.replace(/\.(zip|tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz|tar|7z)$/i, '')
  extractSubfolderName.value = baseName
  showExtractModal.value = true
  nextTick(() => {
    extractInputRef.value?.focus()
    extractInputRef.value?.select()
  })
}

const submitExtractToFolder = async (subfolderNameParam?: string) => {
  if (!extractArchiveFile.value) return
  const subfolder = (subfolderNameParam || extractSubfolderName.value).trim()
  if (!subfolder) return

  const file = extractArchiveFile.value
  const target = extractTarget.value
  showExtractModal.value = false
  showArchiveToast(`Extracting ${file.name} to ${subfolder}/...`, false, true)

  try {
    if (target === 'remote') {
      if (!props.sessionId) return
      const targetDir = sftpStore.remotePath.endsWith('/')
        ? `${sftpStore.remotePath}${subfolder}`
        : `${sftpStore.remotePath}/${subfolder}`
      await sftpStore.extractRemoteArchive(props.sessionId, file.path, targetDir)
    } else {
      const sep = sftpStore.localPath.includes('/') && !sftpStore.localPath.includes('\\') ? '/' : '\\'
      const targetDir = `${sftpStore.localPath}${sep}${subfolder}`
      await sftpStore.extractLocalArchive(file.path, targetDir)
    }
    showArchiveToast(`Extracted ${file.name} to ${subfolder}/ successfully!`, false, false, 3500)
  } catch (err: any) {
    showArchiveToast(`Extraction failed: ${err}`, true, false, 6000)
  }
}

const openCompressModal = (target: 'local' | 'remote') => {
  closeContextMenu()
  compressTarget.value = target
  const items = target === 'local' ? selectedLocalFiles.value : selectedRemoteFiles.value
  if (items.length === 0) return

  compressSelectedItems.value = [...items]
  compressFormat.value = '.tar.gz'
  const defaultName = items.length === 1
    ? `${items[0].name}.tar.gz`
    : `archive-${new Date().toISOString().slice(0, 10)}.tar.gz`
  compressArchiveName.value = defaultName
  showCompressModal.value = true
  nextTick(() => {
    compressInputRef.value?.focus()
    compressInputRef.value?.select()
  })
}

const selectCompressFormat = (format: '.tar.gz' | '.zip') => {
  compressFormat.value = format
  let name = compressArchiveName.value.trim()
  name = name.replace(/\.(zip|tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz|tar|7z)$/i, '')
  compressArchiveName.value = `${name}${format}`
}

const submitCompress = async (archiveNameParam?: string, formatParam?: '.tar.gz' | '.zip') => {
  if (formatParam) compressFormat.value = formatParam
  const archiveName = (archiveNameParam || compressArchiveName.value).trim()
  if (!archiveName || compressSelectedItems.value.length === 0) return

  const target = compressTarget.value
  const itemNames = compressSelectedItems.value.map((i) => i.name)
  isCompressingArchive.value = true
  showCompressModal.value = false
  showArchiveToast(`Creating ${archiveName}...`, false, true)

  try {
    if (target === 'remote') {
      if (!props.sessionId) return
      await sftpStore.compressRemoteArchive(props.sessionId, sftpStore.remotePath, itemNames, archiveName)
    } else {
      await sftpStore.compressLocalArchive(sftpStore.localPath, itemNames, archiveName)
    }
    showArchiveToast(`Created ${archiveName} successfully!`, false, false, 3500)
  } catch (err: any) {
    showArchiveToast(`Compression failed: ${err}`, true, false, 6000)
  } finally {
    isCompressingArchive.value = false
  }
}
</script>

<template>
  <div
    class="flex flex-col h-full w-full overflow-hidden select-none transition-colors duration-150 relative"
    :style="{ backgroundColor: 'var(--color-bg-app)', color: 'var(--color-text-main)' }"
  >
    <!-- Global Drag/Resize Overlays (Prevents iframes, selections, and sub-elements from eating mousemove/mouseup) -->
    <div
      v-if="isResizingHorizontal"
      class="fixed inset-0 z-[99999] cursor-col-resize select-none pointer-events-auto"
    />
    <!-- Auto-Reconnect / Connection Health Toast Banner -->
    <div
      v-if="isConnectionDropped"
      class="bg-amber-950/95 border-b border-amber-600/50 px-4 py-2 flex items-center justify-between text-xs text-amber-200 animate-in slide-in-from-top duration-200 shadow-2xl z-30 flex-shrink-0"
    >
      <div class="flex items-center space-x-2.5">
        <WifiOff class="w-4 h-4 text-amber-400 animate-pulse flex-shrink-0" />
        <span class="font-semibold text-amber-300">{{ protocolBannerTitle }}</span>
        <span class="text-zinc-300 hidden md:inline">· Network change or computer wake</span>
        <span class="font-mono text-amber-400 font-bold ml-1">
          {{ isReconnecting ? 'Reconnecting now...' : `Auto-reconnecting in ${autoReconnectCountdown}s` }}
        </span>
      </div>

      <div class="flex items-center space-x-2">
        <button
          @click="performAutoReconnect"
          :disabled="isReconnecting"
          class="flex items-center space-x-1.5 px-3 py-1 rounded-md bg-amber-500 text-black font-semibold hover:bg-amber-400 transition cursor-pointer disabled:opacity-50 text-xs"
        >
          <RefreshCw class="w-3.5 h-3.5" :class="isReconnecting ? 'animate-spin' : ''" />
          <span>{{ isReconnecting ? 'Reconnecting...' : 'Reconnect Now' }}</span>
        </button>
        <button
          @click="cancelAutoReconnect"
          class="px-2 py-1 rounded text-zinc-400 hover:text-zinc-100 transition cursor-pointer text-xs"
        >
          Dismiss
        </button>
      </div>
    </div>

    <!-- Operation Floating Notification (Top Center) -->
    <transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="transform -translate-y-4 opacity-0 scale-95"
      enter-to-class="transform translate-y-0 opacity-100 scale-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="transform translate-y-0 opacity-100 scale-100"
      leave-to-class="transform -translate-y-4 opacity-0 scale-95"
    >
      <div
        v-if="archiveToast"
        class="fixed top-13 left-1/2 -translate-x-1/2 z-[80] flex items-center space-x-2.5 px-4 py-2 rounded-full border shadow-2xl text-xs font-medium backdrop-blur-xl select-none pointer-events-auto"
        :style="{
          backgroundColor: 'var(--color-bg-card)',
          borderColor: archiveToast.isError
            ? 'var(--color-danger, #f38ba8)'
            : archiveToast.isLoading
              ? 'var(--color-accent)'
              : 'var(--color-success, #a6e3a1)',
          color: 'var(--color-text-main)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.28), 0 0 20px ' + (
            archiveToast.isError
              ? 'color-mix(in srgb, var(--color-danger, #f38ba8) 25%, transparent)'
              : archiveToast.isLoading
                ? 'color-mix(in srgb, var(--color-accent) 25%, transparent)'
                : 'color-mix(in srgb, var(--color-success, #a6e3a1) 25%, transparent)'
          ),
        }"
      >
        <div
          class="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
          :style="{
            backgroundColor: archiveToast.isError
              ? 'color-mix(in srgb, var(--color-danger, #f38ba8) 18%, transparent)'
              : archiveToast.isLoading
                ? 'color-mix(in srgb, var(--color-accent) 18%, transparent)'
                : 'color-mix(in srgb, var(--color-success, #a6e3a1) 18%, transparent)',
            color: archiveToast.isError
              ? 'var(--color-danger, #f38ba8)'
              : archiveToast.isLoading
                ? 'var(--color-accent)'
                : 'var(--color-success, #a6e3a1)'
          }"
        >
          <div v-if="archiveToast.isLoading && archiveToast.message.toLowerCase().includes('download')" class="relative flex items-center justify-center">
            <CatppuccinIcon name="download" :size="14" class="opacity-80 animate-pulse" />
          </div>
          <div v-else-if="archiveToast.isLoading && archiveToast.message.toLowerCase().includes('upload')" class="relative flex items-center justify-center">
            <CatppuccinIcon name="upload" :size="14" class="opacity-80 animate-pulse" />
          </div>
          <RotateCw v-else-if="archiveToast.isLoading" class="w-3.5 h-3.5 animate-spin" />
          <CatppuccinIcon v-else-if="archiveToast.message.toLowerCase().includes('download')" name="download" :size="14" />
          <CatppuccinIcon v-else-if="archiveToast.message.toLowerCase().includes('upload')" name="upload" :size="14" />
          <CheckCircle2 v-else-if="!archiveToast.isError" class="w-3.5 h-3.5" />
          <AlertTriangle v-else class="w-3.5 h-3.5" />
        </div>
        <span class="font-medium tracking-wide">{{ archiveToast.message }}</span>
        <button
          type="button"
          @click="archiveToast = null"
          class="ml-1 p-0.5 rounded-full opacity-60 hover:opacity-100 transition cursor-pointer hover:bg-black/10 dark:hover:bg-white/10"
          :style="{ color: 'var(--color-text-muted)' }"
          title="Dismiss"
        >
          <X class="w-3 h-3" />
        </button>
      </div>
    </transition>

    <!-- Floating Active Deletion Progress Card with Live Cancel Action (Right Corner) -->
    <transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="transform translate-y-4 opacity-0 scale-95"
      enter-to-class="transform translate-y-0 opacity-100 scale-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="transform translate-y-0 opacity-100 scale-100"
      leave-to-class="transform translate-y-4 opacity-0 scale-95"
    >
      <div
        v-if="activeDeletion"
        class="fixed right-6 z-[80] flex items-center space-x-3 px-4 py-2.5 rounded-2xl border shadow-2xl backdrop-blur-xl max-w-md select-none transition-all duration-200 pointer-events-auto"
        :style="{
          bottom: activeDeletionBottomOffset,
          backgroundColor: 'var(--color-bg-card)',
          borderColor: 'color-mix(in srgb, var(--color-danger, #f38ba8) 45%, var(--color-border))',
          color: 'var(--color-text-main)',
          boxShadow: '0 10px 32px rgba(0, 0, 0, 0.28), 0 0 16px color-mix(in srgb, var(--color-danger, #f38ba8) 20%, transparent)'
        }"
      >
        <div
          class="relative shrink-0 flex items-center justify-center w-7 h-7 rounded-xl border"
          :style="{
            backgroundColor: 'color-mix(in srgb, var(--color-danger, #f38ba8) 16%, transparent)',
            borderColor: 'color-mix(in srgb, var(--color-danger, #f38ba8) 35%, transparent)',
            color: 'var(--color-danger, #f38ba8)'
          }"
        >
          <span
            class="animate-spin w-4 h-4 border-2 rounded-full"
            :style="{
              borderColor: 'color-mix(in srgb, var(--color-danger, #f38ba8) 30%, transparent)',
              borderTopColor: 'var(--color-danger, #f38ba8)'
            }"
          />
        </div>
        <div class="flex flex-col min-w-0 pr-1">
          <div class="flex items-center space-x-1.5 text-xs font-semibold truncate">
            <span :style="{ color: 'var(--color-danger, #f38ba8)' }">
              {{ activeDeletion.isCancelling ? 'Cancelling deletion...' : 'Deleting' }}
            </span>
            <span class="font-mono truncate max-w-[200px]" :style="{ color: 'var(--color-text-main)' }">
              "{{ activeDeletion.title }}"
            </span>
          </div>
          <span class="text-[10px] truncate" :style="{ color: 'var(--color-text-muted)' }">
            {{ activeDeletion.pane === 'remote' ? 'Remote server' : 'Local filesystem' }}
            <template v-if="activeDeletion.totalCount > 1">
              • {{ activeDeletion.completedCount }}/{{ activeDeletion.totalCount }} items
            </template>
          </span>
        </div>
        <button
          type="button"
          @click="cancelActiveDeletion"
          :disabled="activeDeletion.isCancelling"
          class="shrink-0 px-2.5 py-1 rounded-lg text-xs font-semibold border transition disabled:opacity-50 flex items-center space-x-1 cursor-pointer"
          :style="{
            backgroundColor: 'color-mix(in srgb, var(--color-danger, #f38ba8) 18%, var(--color-bg-card))',
            borderColor: 'color-mix(in srgb, var(--color-danger, #f38ba8) 45%, var(--color-border))',
            color: 'var(--color-danger, #f38ba8)'
          }"
          title="Cancel deletion"
        >
          <X class="w-3.5 h-3.5" />
          <span>{{ activeDeletion.isCancelling ? 'Cancelling...' : 'Cancel' }}</span>
        </button>
      </div>
    </transition>

    <!-- Floating Active Folder Upload Progress Card with Live Stop Action (Left Bottom Corner) -->
    <transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="transform translate-y-4 opacity-0 scale-95"
      enter-to-class="transform translate-y-0 opacity-100 scale-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="transform translate-y-0 opacity-100 scale-100"
      leave-to-class="transform translate-y-4 opacity-0 scale-95"
    >
      <div
        v-if="sftpStore.activeFolderUpload"
        class="fixed left-6 z-[80] flex items-center space-x-3 px-4 py-2.5 rounded-2xl border shadow-2xl backdrop-blur-xl max-w-lg select-none transition-all duration-200 pointer-events-auto"
        :style="{
          bottom: folderUploadBottomOffset,
          backgroundColor: 'var(--color-bg-card)',
          borderColor: sftpStore.activeFolderUpload.isComplete
            ? 'color-mix(in srgb, #16a34a 50%, var(--color-border))'
            : (sftpStore.activeFolderUpload.isStopping
                ? 'color-mix(in srgb, #ef4444 50%, var(--color-border))'
                : 'color-mix(in srgb, var(--color-accent) 45%, var(--color-border))'),
          color: 'var(--color-text-main)',
          boxShadow: '0 10px 32px rgba(0, 0, 0, 0.28), 0 0 16px ' + (
            sftpStore.activeFolderUpload.isComplete
              ? 'color-mix(in srgb, #16a34a 20%, transparent)'
              : (sftpStore.activeFolderUpload.isStopping
                  ? 'color-mix(in srgb, #ef4444 20%, transparent)'
                  : 'color-mix(in srgb, var(--color-accent) 20%, transparent)')
          )
        }"
      >
        <div
          class="relative shrink-0 flex items-center justify-center w-8 h-8 rounded-xl border"
          :style="{
            backgroundColor: sftpStore.activeFolderUpload.isComplete
              ? 'color-mix(in srgb, #16a34a 16%, transparent)'
              : (sftpStore.activeFolderUpload.isStopping
                  ? 'color-mix(in srgb, #ef4444 16%, transparent)'
                  : 'color-mix(in srgb, var(--color-accent) 16%, transparent)'),
            borderColor: sftpStore.activeFolderUpload.isComplete
              ? 'color-mix(in srgb, #16a34a 35%, transparent)'
              : (sftpStore.activeFolderUpload.isStopping
                  ? 'color-mix(in srgb, #ef4444 35%, transparent)'
                  : 'color-mix(in srgb, var(--color-accent) 35%, transparent)'),
            color: sftpStore.activeFolderUpload.isComplete
              ? '#16a34a'
              : (sftpStore.activeFolderUpload.isStopping ? '#ef4444' : 'var(--color-accent)')
          }"
        >
          <CheckCircle2 v-if="sftpStore.activeFolderUpload.isComplete" class="w-4 h-4 text-emerald-500" />
          <span
            v-else-if="sftpStore.activeFolderUpload.isStopping"
            class="animate-spin w-4 h-4 border-2 rounded-full"
            :style="{
              borderColor: 'color-mix(in srgb, currentColor 30%, transparent)',
              borderTopColor: 'currentColor'
            }"
          />
          <div v-else-if="sftpStore.activeFolderUpload.isScanning" class="relative flex items-center justify-center">
            <CatppuccinIcon name="upload" :size="16" class="opacity-75 animate-pulse" />
            <span
              class="absolute -inset-1 animate-spin border rounded-full pointer-events-none"
              :style="{
                borderColor: 'color-mix(in srgb, var(--color-accent) 25%, transparent)',
                borderTopColor: 'var(--color-accent)'
              }"
            />
          </div>
          <CatppuccinIcon v-else name="upload" :size="16" class="animate-bounce" />
        </div>

        <div class="flex flex-col min-w-0 pr-1">
          <div class="flex items-center space-x-1.5 text-xs font-semibold truncate">
            <span
              :style="{
                color: sftpStore.activeFolderUpload.isComplete
                  ? '#16a34a'
                  : (sftpStore.activeFolderUpload.isStopping ? '#ef4444' : 'var(--color-accent)')
              }"
            >
              {{
                sftpStore.activeFolderUpload.isComplete
                  ? 'Folder upload complete'
                  : (sftpStore.activeFolderUpload.isStopping
                      ? 'Stopping upload...'
                      : (sftpStore.activeFolderUpload.isScanning ? 'Scanning folder...' : 'Uploading folder'))
              }}
            </span>
            <span class="font-mono truncate max-w-[200px]" :style="{ color: 'var(--color-text-main)' }" :title="sftpStore.activeFolderUpload.folderName">
              "{{ sftpStore.activeFolderUpload.folderName }}"
            </span>
          </div>

          <div class="flex items-center space-x-2 text-[11px]" :style="{ color: 'var(--color-text-muted)' }">
            <span class="font-mono font-medium">
              {{ sftpStore.activeFolderUpload.totalFiles.toLocaleString() }} file{{ sftpStore.activeFolderUpload.totalFiles === 1 ? '' : 's' }},
              {{ sftpStore.activeFolderUpload.totalFolders.toLocaleString() }} folder{{ sftpStore.activeFolderUpload.totalFolders === 1 ? '' : 's' }}
            </span>
            <span v-if="sftpStore.activeFolderUpload.isScanning" class="italic opacity-85 font-medium animate-pulse text-amber-500/90 dark:text-amber-400/90">
              (Counting...)
            </span>
            <span v-else-if="sftpStore.activeFolderUpload.totalFiles > 0 && !sftpStore.activeFolderUpload.isComplete" class="opacity-80">
              • {{ sftpStore.activeFolderUpload.completedFiles }}/{{ sftpStore.activeFolderUpload.totalFiles }} uploaded
            </span>
          </div>
        </div>

        <template v-if="!sftpStore.activeFolderUpload.isComplete">
          <button
            type="button"
            @click="sftpStore.stopActiveFolderUpload"
            :disabled="sftpStore.activeFolderUpload.isStopping"
            class="shrink-0 px-2.5 py-1 rounded-lg text-xs font-semibold border transition disabled:opacity-50 flex items-center space-x-1.5 cursor-pointer ml-1"
            :style="{
              backgroundColor: 'color-mix(in srgb, #dc2626 18%, var(--color-bg-card))',
              borderColor: 'color-mix(in srgb, #dc2626 45%, var(--color-border))',
              color: '#ef4444'
            }"
            title="Stop folder upload"
          >
            <Square class="w-3.5 h-3.5 fill-current" />
            <span>{{ sftpStore.activeFolderUpload.isStopping ? 'Stopping...' : 'Stop upload' }}</span>
          </button>
        </template>
        <template v-else>
          <button
            type="button"
            @click="sftpStore.activeFolderUpload = null"
            class="shrink-0 p-1 rounded-lg transition hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer ml-1"
            :style="{ color: 'var(--color-text-muted)' }"
            title="Dismiss"
          >
            <X class="w-3.5 h-3.5" />
          </button>
        </template>
      </div>
    </transition>

    <!-- Floating Active Folder Download Progress Card with Live Stop Action (Right Bottom Corner) -->
    <transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="transform translate-y-4 opacity-0 scale-95"
      enter-to-class="transform translate-y-0 opacity-100 scale-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="transform translate-y-0 opacity-100 scale-100"
      leave-to-class="transform translate-y-4 opacity-0 scale-95"
    >
      <div
        v-if="sftpStore.activeFolderDownload"
        class="fixed right-6 z-[80] flex items-center space-x-3 px-4 py-2.5 rounded-2xl border shadow-2xl backdrop-blur-xl max-w-lg select-none transition-all duration-200 pointer-events-auto"
        :style="{
          bottom: folderDownloadBottomOffset,
          backgroundColor: 'var(--color-bg-card)',
          borderColor: sftpStore.activeFolderDownload.isComplete
            ? 'color-mix(in srgb, #16a34a 50%, var(--color-border))'
            : (sftpStore.activeFolderDownload.isStopping
                ? 'color-mix(in srgb, #ef4444 50%, var(--color-border))'
                : 'color-mix(in srgb, #06b6d4 45%, var(--color-border))'),
          color: 'var(--color-text-main)',
          boxShadow: '0 10px 32px rgba(0, 0, 0, 0.28), 0 0 16px ' + (
            sftpStore.activeFolderDownload.isComplete
              ? 'color-mix(in srgb, #16a34a 20%, transparent)'
              : (sftpStore.activeFolderDownload.isStopping
                  ? 'color-mix(in srgb, #ef4444 20%, transparent)'
                  : 'color-mix(in srgb, #06b6d4 20%, transparent)')
          )
        }"
      >
        <div
          class="relative shrink-0 flex items-center justify-center w-8 h-8 rounded-xl border"
          :style="{
            backgroundColor: sftpStore.activeFolderDownload.isComplete
              ? 'color-mix(in srgb, #16a34a 16%, transparent)'
              : (sftpStore.activeFolderDownload.isStopping
                  ? 'color-mix(in srgb, #ef4444 16%, transparent)'
                  : 'color-mix(in srgb, #06b6d4 16%, transparent)'),
            borderColor: sftpStore.activeFolderDownload.isComplete
              ? 'color-mix(in srgb, #16a34a 35%, transparent)'
              : (sftpStore.activeFolderDownload.isStopping
                  ? 'color-mix(in srgb, #ef4444 35%, transparent)'
                  : 'color-mix(in srgb, #06b6d4 35%, transparent)'),
            color: sftpStore.activeFolderDownload.isComplete
              ? '#16a34a'
              : (sftpStore.activeFolderDownload.isStopping ? '#ef4444' : '#06b6d4')
          }"
        >
          <CheckCircle2 v-if="sftpStore.activeFolderDownload.isComplete" class="w-4 h-4 text-emerald-500" />
          <span
            v-else-if="sftpStore.activeFolderDownload.isStopping"
            class="animate-spin w-4 h-4 border-2 rounded-full"
            :style="{
              borderColor: 'color-mix(in srgb, currentColor 30%, transparent)',
              borderTopColor: 'currentColor'
            }"
          />
          <div v-else-if="sftpStore.activeFolderDownload.isScanning" class="relative flex items-center justify-center">
            <CatppuccinIcon name="download" :size="16" class="opacity-75 animate-pulse" />
            <span
              class="absolute -inset-1 animate-spin border rounded-full pointer-events-none"
              :style="{
                borderColor: 'color-mix(in srgb, #06b6d4 25%, transparent)',
                borderTopColor: '#06b6d4'
              }"
            />
          </div>
          <CatppuccinIcon v-else name="download" :size="16" class="animate-bounce" />
        </div>

        <div class="flex flex-col min-w-0 pr-1">
          <div class="flex items-center space-x-1.5 text-xs font-semibold truncate">
            <span
              :style="{
                color: sftpStore.activeFolderDownload.isComplete
                  ? '#16a34a'
                  : (sftpStore.activeFolderDownload.isStopping ? '#ef4444' : '#06b6d4')
              }"
            >
              {{
                sftpStore.activeFolderDownload.isComplete
                  ? 'Folder download complete'
                  : (sftpStore.activeFolderDownload.isStopping
                      ? 'Stopping download...'
                      : (sftpStore.activeFolderDownload.isScanning ? 'Scanning remote folder...' : 'Downloading folder'))
              }}
            </span>
            <span class="font-mono truncate max-w-[200px]" :style="{ color: 'var(--color-text-main)' }" :title="sftpStore.activeFolderDownload.folderName">
              "{{ sftpStore.activeFolderDownload.folderName }}"
            </span>
          </div>

          <div class="flex items-center space-x-2 text-[11px]" :style="{ color: 'var(--color-text-muted)' }">
            <span class="font-mono font-medium">
              {{ sftpStore.activeFolderDownload.totalFiles.toLocaleString() }} file{{ sftpStore.activeFolderDownload.totalFiles === 1 ? '' : 's' }},
              {{ sftpStore.activeFolderDownload.totalFolders.toLocaleString() }} folder{{ sftpStore.activeFolderDownload.totalFolders === 1 ? '' : 's' }}
            </span>
            <span v-if="sftpStore.activeFolderDownload.isScanning" class="italic opacity-85 font-medium animate-pulse text-amber-500/90 dark:text-amber-400/90">
              (Counting...)
            </span>
            <span v-else-if="sftpStore.activeFolderDownload.totalFiles > 0 && !sftpStore.activeFolderDownload.isComplete" class="opacity-80">
              • {{ sftpStore.activeFolderDownload.completedFiles }}/{{ sftpStore.activeFolderDownload.totalFiles }} downloaded
            </span>
          </div>
        </div>

        <template v-if="!sftpStore.activeFolderDownload.isComplete">
          <button
            type="button"
            @click="sftpStore.stopActiveFolderDownload"
            :disabled="sftpStore.activeFolderDownload.isStopping"
            class="shrink-0 px-2.5 py-1 rounded-lg text-xs font-semibold border transition disabled:opacity-50 flex items-center space-x-1.5 cursor-pointer ml-1"
            :style="{
              backgroundColor: 'color-mix(in srgb, #dc2626 18%, var(--color-bg-card))',
              borderColor: 'color-mix(in srgb, #dc2626 45%, var(--color-border))',
              color: '#ef4444'
            }"
            title="Stop folder download"
          >
            <Square class="w-3.5 h-3.5 fill-current" />
            <span>{{ sftpStore.activeFolderDownload.isStopping ? 'Stopping...' : 'Stop download' }}</span>
          </button>
        </template>
        <template v-else>
          <button
            type="button"
            @click="sftpStore.activeFolderDownload = null"
            class="shrink-0 p-1 rounded-lg transition hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer ml-1"
            :style="{ color: 'var(--color-text-muted)' }"
            title="Dismiss"
          >
            <X class="w-3.5 h-3.5" />
          </button>
        </template>
      </div>
    </transition>

    <!-- External Editor Live Sync Bar -->
    <SftpExternalEditBar :session-id="props.sessionId" />

    <!-- Directory Comparison Control & Summary Bar -->
    <SftpComparisonBar
      v-if="isComparing && props.sessionId"
      v-model:criteria="compareCriteria"
      v-model:hide-identical="hideIdenticalFiles"
      :comparison-result="comparisonResult"
      @sync-local-to-remote="syncLocalToRemote"
      @sync-remote-to-local="syncRemoteToLocal"
      @close="toggleComparison"
    />

    <!-- Top Panes Layout (Left & Right Resizable Panes) -->
    <div
      ref="splitContainerRef"
      class="flex-1 flex flex-row overflow-hidden relative"
    >
      <!-- LEFT PANE: Local File System -->
      <SftpLocalPane
        ref="localPaneComp"
        :active="activePane === 'local'"
        :width-percent="leftPanePercent"
        :session-id="props.sessionId"
        :is-comparing="isComparing"
        :hide-identical-files="hideIdenticalFiles"
        :comparison-result="comparisonResult"
        v-model:show-hidden-files="showHiddenFiles"
        v-model:search-query="localSearchQuery"
        v-model:show-filter="showLocalFilter"
        :selected-paths="selectedLocalPaths"
        :selected-files="selectedLocalFiles"
        :filtered-files="filteredLocalFiles"
        :sort-by="localSortBy"
        :sort-order="localSortOrder"
        :active-drop-folder="activeDropFolder"
        :can-navigate-up="canNavigateLocalUp"
        :can-navigate-back="canNavigateLocalBack"
        :can-navigate-forward="canNavigateLocalForward"
        :parent-path="localParentPath"
        :is-parent-selected="isLocalParentSelected"
        :row-padding-class="rowPaddingClass"
        :cell-padding-class="cellPaddingClass"
        :local-bookmarks="localBookmarks"
        :current-path="sftpStore.localPath"
        :get-row-style="getRowStyle"
        :get-git-status="getGitStatus"
        @select-pane="activePane = 'local'"
        @sort="handleLocalSort"
        @toggle-comparison="toggleComparison"
        @toggle-filter="toggleFilter('local')"
        @filter-esc="handleFilterEsc('local')"
        @focus-first-item="focusFirstItem('local')"
        @navigate-up="navigateLocalUp"
        @navigate-back="navigateLocalBack"
        @navigate-forward="navigateLocalForward"
        @navigate-to="(path) => sftpStore.fetchLocalDir(path)"
        @copy-path="handleCopyPath"
        @refresh="() => handleRefresh('local')"
        @new-file="openNewFile('local')"
        @new-folder="openNewFolder('local')"
        @open-dir-watcher="() => openDirWatcherModal()"
        @open-settings="settingsStore.openSettings('transfers')"
        @batch-upload="(files) => handleBatchUpload(files)"
        @batch-delete="(files) => handleBatchDeleteLocal(files)"
        @row-click="handleLocalRowClick"
        @row-dblclick="handleLocalRowDoubleClick"
        @empty-click="handleLocalEmptyClick"
        @parent-click="handleLocalParentClick"
        @close-context-menu="closeContextMenu"
        @contextmenu="openLocalContextMenu"
        @dragstart="handleLocalDragStart"
        @dragend="handleLocalDragEnd"
        @dragover="handleLocalDragOver"
        @dragenter="handleLocalDragEnter"
        @dragleave="handleLocalDragLeave"
        @drop="handleLocalDrop"
        @folder-dragover="(ev, file) => handleFolderDragOver(ev, 'local', file)"
        @folder-dragleave="(file) => handleFolderDragLeave('local', file)"
        @folder-drop="(ev, file) => handleFolderDrop(ev, 'local', file)"
        @parent-folder-dragover="(ev) => handleParentFolderDragOver(ev, 'local')"
        @parent-folder-dragleave="handleParentFolderDragLeave('local')"
        @parent-folder-drop="(ev) => handleParentFolderDrop(ev, 'local')"
        @toggle-bookmark="toggleLocalBookmark"
      />

      <!-- Vertical Splitter Handle (Horizontal Resize between Local & Remote) -->
      <div
        @mousedown.prevent="startHorizontalResize"
        class="w-1.5 z-30 cursor-col-resize flex items-center justify-center transition-all group flex-shrink-0 relative select-none"
        :class="{ 'bg-sky-500/50': isResizingHorizontal }"
        :style="{ backgroundColor: isResizingHorizontal ? 'var(--color-accent)' : 'var(--color-border)' }"
        title="Drag to resize panes (Double-click to reset 50/50)"
        @dblclick="resetHorizontalSplit"
      >
        <div
          class="w-0.5 h-8 rounded-full transition-colors"
          :class="isResizingHorizontal ? 'bg-white' : 'bg-zinc-400 group-hover:bg-white'"
        />
      </div>

      <!-- RIGHT PANE: Remote SFTP File System -->
      <SftpRemotePane
        ref="remotePaneComp"
        :active="activePane === 'remote'"
        :width-percent="100 - leftPanePercent"
        :session-id="props.sessionId"
        :is-comparing="isComparing"
        :hide-identical-files="hideIdenticalFiles"
        :comparison-result="comparisonResult"
        v-model:show-hidden-files="showHiddenFiles"
        v-model:search-query="remoteSearchQuery"
        v-model:show-filter="showRemoteFilter"
        :selected-paths="selectedRemotePaths"
        :selected-files="selectedRemoteFiles"
        :filtered-files="filteredRemoteFiles"
        :sort-by="remoteSortBy"
        :sort-order="remoteSortOrder"
        :active-drop-folder="activeDropFolder"
        :can-navigate-up="canNavigateRemoteUp"
        :can-navigate-back="canNavigateRemoteBack"
        :can-navigate-forward="canNavigateRemoteForward"
        :parent-path="remoteParentPath"
        :is-parent-selected="isRemoteParentSelected"
        :row-padding-class="rowPaddingClass"
        :cell-padding-class="cellPaddingClass"
        :remote-bookmarks="remoteBookmarks"
        :current-path="sftpStore.remotePath"
        :get-row-style="getRowStyle"
        :get-git-status="getGitStatus"
        @select-pane="activePane = 'remote'"
        @sort="handleRemoteSort"
        @toggle-comparison="toggleComparison"
        @toggle-filter="toggleFilter('remote')"
        @filter-esc="handleFilterEsc('remote')"
        @focus-first-item="focusFirstItem('remote')"
        @navigate-up="navigateRemoteUp"
        @navigate-back="navigateRemoteBack"
        @navigate-forward="navigateRemoteForward"
        @navigate-to="(path) => props.sessionId && sftpStore.fetchRemoteDir(props.sessionId, path)"
        @copy-path="handleCopyPath"
        @refresh="() => handleRefresh('remote')"
        @reconnect="performAutoReconnect"
        @new-file="openNewFile('remote')"
        @new-folder="openNewFolder('remote')"
        @open-search="() => openSearchModal()"
        @permissions="(file) => openPermissions(file)"
        @batch-download="(files) => handleBatchDownload(files)"
        @batch-delete="(files) => handleBatchDeleteRemote(files)"
        @row-click="handleRemoteRowClick"
        @row-dblclick="handleRemoteRowDoubleClick"
        @empty-click="handleRemoteEmptyClick"
        @parent-click="handleRemoteParentClick"
        @close-context-menu="closeContextMenu"
        @contextmenu="openRemoteContextMenu"
        @dragstart="handleRemoteDragStart"
        @dragend="handleRemoteDragEnd"
        @dragover="handleRemoteDragOver"
        @dragenter="handleRemoteDragEnter"
        @dragleave="handleRemoteDragLeave"
        @drop="handleRemoteDrop"
        @folder-dragover="(ev, file) => handleFolderDragOver(ev, 'remote', file)"
        @folder-dragleave="(file) => handleFolderDragLeave('remote', file)"
        @folder-drop="(ev, file) => handleFolderDrop(ev, 'remote', file)"
        @parent-folder-dragover="(ev) => handleParentFolderDragOver(ev, 'remote')"
        @parent-folder-dragleave="handleParentFolderDragLeave('remote')"
        @parent-folder-drop="(ev) => handleParentFolderDrop(ev, 'remote')"
        @toggle-bookmark="toggleRemoteBookmark"
      />
    </div>

    <!-- Bottom Transfer Queue Drawer (FileZilla Exact 3-Tab Architecture) -->
    <SftpTransferQueue
      ref="transferQueueRef"
      v-model:show="showTransferDrawer"
      v-model:tab="transferTab"
      :session-id="props.sessionId"
      @toast="showArchiveToast"
    />

    <!-- Custom Right-Click Context Menu -->
    <SftpContextMenu
      :show="contextMenu.show"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :pane="contextMenu.pane"
      :session-id="props.sessionId"
      :selected-local-files="selectedLocalFiles"
      :selected-remote-files="selectedRemoteFiles"
      :local-bookmarks="localBookmarks"
      :remote-bookmarks="remoteBookmarks"
      :current-local-path="sftpStore.localPath"
      :current-remote-path="sftpStore.remotePath"
      :is-comparing="isComparing"
      @close="closeContextMenu"
      @batch-upload="(files) => handleBatchUpload(files)"
      @batch-download="(files) => handleBatchDownload(files)"
      @quick-look="(target, file) => openQuickLook(target, file)"
      @edit="(target, file) => openEditor(target, file)"
      @open-in-external-editor="(file) => handleOpenInExternalEditor(file)"
      @pair-folder="(localDir) => openDirWatcherModal(localDir)"
      @search-remote="(remoteDir) => openSearchModal(remoteDir)"
      @open-in-default-app="(path) => handleOpenInDefaultApp(path)"
      @permissions="(file) => openPermissions(file)"
      @open-in-terminal="(path) => handleOpenInTerminal(path)"
      @extract-here="(target, file) => handleExtractArchiveHere(target, file)"
      @extract-to-folder="(target, file) => openExtractToFolderModal(target, file)"
      @compress="(target) => openCompressModal(target)"
      @new-file="(target) => openNewFile(target)"
      @new-folder="(target) => openNewFolder(target)"
      @rename="(target, file) => openRename(target, file)"
      @copy-path="(path) => handleCopyPath(path)"
      @toggle-bookmark="(target, path) => target === 'local' ? toggleLocalBookmark(path) : toggleRemoteBookmark(path)"
      @toggle-comparison="toggleComparison"
      @select-all="(target) => selectAll(target)"
      @batch-delete-local="(files) => handleBatchDeleteLocal(files)"
      @batch-delete-remote="(files) => handleBatchDeleteRemote(files)"
      @refresh="(target) => handleRefresh(target)"
    />

    <!-- Rename Modal -->
    <SftpRenameModal
      :show="showRenameModal"
      :target="renameTarget"
      :initial-name="renameItem?.name || ''"
      :is-dir="renameItem?.is_dir"
      @close="showRenameModal = false"
      @submit="submitRename"
    />

    <!-- Compress Archive Modal -->
    <SftpCompressModal
      :show="showCompressModal"
      :target="compressTarget"
      :current-path="compressTarget === 'local' ? sftpStore.localPath : sftpStore.remotePath"
      :selected-items="compressSelectedItems"
      :is-compressing="isCompressingArchive"
      @close="showCompressModal = false"
      @submit="submitCompress"
    />

    <!-- Extract to Subfolder Modal -->
    <SftpExtractModal
      :show="showExtractModal"
      :target="extractTarget"
      :archive-file="extractArchiveFile"
      :is-extracting="isExtractingArchive"
      @close="showExtractModal = false"
      @submit="submitExtractToFolder"
    />

    <!-- New Directory Modal -->
    <SftpNewFolderModal
      :show="showNewFolderModal"
      :target="newFolderTarget"
      :existing-items="newFolderTarget === 'local' ? sftpStore.localFiles : sftpStore.remoteFiles"
      @close="showNewFolderModal = false"
      @submit="submitNewFolder"
    />

    <!-- New File Modal -->
    <SftpNewFileModal
      :show="showNewFileModal"
      :target="newFileTarget"
      :existing-items="newFileTarget === 'local' ? sftpStore.localFiles : sftpStore.remoteFiles"
      @close="showNewFileModal = false"
      @submit="submitNewFile"
    />

    <!-- Conflict Resolution Modal -->
    <SftpConflictModal
      :show="!!sftpStore.activeConflictDialog?.show"
      :dialog="sftpStore.activeConflictDialog"
      @resolve="sftpStore.resolveConflict($event)"
    />

    <!-- Custom Delete Confirmation Lightbox Modal -->
    <SftpDeleteConfirmModal
      :show="showDeleteConfirmModal"
      :target="deleteTarget"
      :initial-fast-rm="useFastRm"
      @close="closeDeleteConfirm"
      @confirm="handleDeleteConfirm"
    />
  </div>

  <!-- File Permissions (chmod) Modal -->
  <PermissionsModal
    :show="showPermissionsModal"
    :session-id="props.sessionId"
    :item="permissionsItem"
    @close="showPermissionsModal = false"
    @updated="handlePermissionsUpdated"
  />

  <!-- Live Directory Watcher Modal -->
  <SftpDirWatcherModal
    :show="showDirWatcherModal"
    :session-id="props.sessionId"
    :initial-local-dir="dirWatcherLocalDir"
    :initial-remote-dir="dirWatcherRemoteDir"
    @close="showDirWatcherModal = false"
    @toast="(msg, isErr) => showArchiveToast(msg, isErr)"
  />

  <!-- Remote Search & Grep Modal -->
  <SftpSearchModal
    :show="showSearchModal"
    :session-id="props.sessionId"
    :current-remote-path="searchInitialDir"
    @close="showSearchModal = false"
    @navigate-to="(path) => props.sessionId && sftpStore.fetchRemoteDir(props.sessionId, path)"
    @open-editor="(path, name) => openEditor('remote', { path, name, is_dir: false, is_symlink: false, size: 0, modified: 0, permissions: 0o644 })"
    @quick-look="(path, name) => openQuickLook('remote', { path, name, is_dir: false, is_symlink: false, size: 0, modified: 0, permissions: 0o644 })"
  />

  <!-- macOS-style Spacebar Quick Look Modal -->
  <QuickLookModal
    v-model:show="showQuickLook"
    :file="quickLookFile"
    :target="quickLookTarget"
    :session-id="props.sessionId"
    :current-index="quickLookCurrentIndex"
    :total-count="quickLookFileList.length"
    @open-editor="(target, file) => openEditor(target, file)"
    @prev="navigateQuickLook('prev')"
    @next="navigateQuickLook('next')"
  />

  <!-- File Editor Modal (in front of search & preview) -->
  <FileEditorModal
    :show="showEditorModal"
    :session-id="props.sessionId"
    :target="editorTarget"
    :file-path="editorFilePath"
    :file-name="editorFileName"
    @close="showEditorModal = false"
    @saved="handleEditorSaved"
  />
</template>

<style scoped>
.file-row {
  transition: background-color 75ms ease;
}
.file-row:hover {
  background-color: var(--color-bg-hover);
}

::-webkit-scrollbar-corner {
  background: transparent !important;
}

::-webkit-resizer {
  background: transparent !important;
}

::-webkit-scrollbar-button {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
}
</style>

