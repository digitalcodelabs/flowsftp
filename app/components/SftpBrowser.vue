<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  Trash2,
  AlertTriangle,
  Folder,
  FileText,
  X,
  Eye,
  EyeOff,
  Terminal,
  Shield,
  FileCode,
  ChevronDown,
  ExternalLink,
  RotateCw,
  CheckCircle2,
  XCircle,
  Clock,
  GitBranch,
  RefreshCw,
  Search,
  Wifi,
  WifiOff,
  GitCompare,
  GitCompareArrows,
  Check,
  Square,
  FolderSync,
  Package,
  Server,
  Lock,
  Play,
  Pause,
  ChevronRight,
  ArrowUp,
  ArrowDown,
} from 'lucide-vue-next'
import {
  useSftpStore,
  getServerUrlForSession,
  type SftpFileEntry,
  type LocalFileEntry,
  type TransferItem,
  type TransferPriority,
  type ConflictPolicy,
} from '../stores/sftp'
import { useVaultStore } from '../stores/vault'
import { useSettingsStore } from '../stores/settings'
import { useSshStore } from '../stores/ssh'
import SettingsModal from './SettingsModal.vue'
import FileEditorModal from './FileEditorModal.vue'
import PermissionsModal from './PermissionsModal.vue'
import QuickLookModal from './QuickLookModal.vue'
import FileIcon from './FileIcon.vue'
import CatppuccinIcon from './CatppuccinIcon.vue'

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
const showSettingsModal = ref(false)

const localPaneRef = ref<HTMLElement | null>(null)
const remotePaneRef = ref<HTMLElement | null>(null)
const splitContainerRef = ref<HTMLElement | null>(null)
const leftPanePercent = ref(50)
const isResizingHorizontal = ref(false)

const DEFAULT_DRAWER_HEIGHT = 180
const MIN_DRAWER_HEIGHT = 80
const drawerHeight = ref(DEFAULT_DRAWER_HEIGHT)
const isResizingVertical = ref(false)

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
    localStorage.setItem('termsftp_left_pane_percent', leftPanePercent.value.toString())
  }

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

const resetHorizontalSplit = () => {
  leftPanePercent.value = 50
  localStorage.setItem('termsftp_left_pane_percent', '50')
}

const startVerticalResize = (e: MouseEvent) => {
  if (!showTransferDrawer.value) {
    showTransferDrawer.value = true
  }
  isResizingVertical.value = true
  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
  const startY = e.clientY
  const startHeight = drawerHeight.value

  const onMouseMove = (ev: MouseEvent) => {
    const deltaY = startY - ev.clientY
    const newHeight = startHeight + deltaY
    const maxHeight = Math.max(200, window.innerHeight * 0.75)
    drawerHeight.value = Math.max(MIN_DRAWER_HEIGHT, Math.min(maxHeight, Math.round(newHeight)))
  }

  const onMouseUp = () => {
    isResizingVertical.value = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
    localStorage.setItem('termsftp_drawer_height', drawerHeight.value.toString())
  }

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

const resetVerticalSplit = () => {
  showTransferDrawer.value = true
  drawerHeight.value = DEFAULT_DRAWER_HEIGHT
  localStorage.setItem('termsftp_drawer_height', DEFAULT_DRAWER_HEIGHT.toString())
}

// -------------------------------------------------------------
// Bottom Queue Data Grid Column Resizing (FileZilla Style)
// -------------------------------------------------------------
interface QueueColumnWidths {
  local: number
  direction: number
  remote: number
  size: number
  priority: number
  status: number
  time: number
  reason: number
}

const DEFAULT_QUEUE_COL_WIDTHS: QueueColumnWidths = {
  local: 420,
  direction: 60,
  remote: 280,
  size: 95,
  priority: 75,
  status: 120,
  time: 120,
  reason: 180,
}

const queueColWidths = ref<QueueColumnWidths>({ ...DEFAULT_QUEUE_COL_WIDTHS })
const isResizingQueueCol = ref<string | null>(null)

const loadQueueColWidths = () => {
  try {
    const saved = localStorage.getItem('termsftp_queue_col_widths')
    if (saved) {
      const parsed = JSON.parse(saved)
      if (parsed && typeof parsed === 'object') {
        queueColWidths.value = { ...DEFAULT_QUEUE_COL_WIDTHS, ...parsed }
      }
    }
  } catch {}
}

const saveQueueColWidths = () => {
  try {
    localStorage.setItem('termsftp_queue_col_widths', JSON.stringify(queueColWidths.value))
  } catch {}
}

const startQueueColResize = (colKey: keyof QueueColumnWidths, e: MouseEvent) => {
  isResizingQueueCol.value = colKey
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  const startX = e.clientX
  const startWidth = queueColWidths.value[colKey]

  const onMouseMove = (ev: MouseEvent) => {
    const deltaX = ev.clientX - startX
    const minWidths: Record<keyof QueueColumnWidths, number> = {
      local: 180,
      direction: 45,
      remote: 120,
      size: 60,
      priority: 50,
      status: 70,
      time: 70,
      reason: 90,
    }
    const minW = minWidths[colKey] || 50
    queueColWidths.value[colKey] = Math.max(minW, Math.round(startWidth + deltaX))
  }

  const onMouseUp = () => {
    isResizingQueueCol.value = null
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
    saveQueueColWidths()
  }

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

const resetQueueColWidth = (colKey: keyof QueueColumnWidths) => {
  queueColWidths.value[colKey] = DEFAULT_QUEUE_COL_WIDTHS[colKey]
  saveQueueColWidths()
}

let unlistenDragDrop: (() => void) | null = null

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

// Archive Operations State
const isArchiveFile = (fileName: string) =>
  /\.(zip|tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz|tar|7z)$/i.test(fileName)

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
  if (!isLoading) {
    archiveToastTimer = setTimeout(() => {
      archiveToast.value = null
    }, duration)
  }
}

// Transfer drawer state & queue tabs (FileZilla 3-Tab Architecture)
const showTransferDrawer = ref(true)
const transferTab = ref<'active' | 'completed' | 'failed'>('active')

// -------------------------------------------------------------
// FileZilla-Grade Virtual Scroller for Queue Data Grid
// -------------------------------------------------------------
const isTransferActive = (item: TransferItem): boolean => {
  return !item.is_complete && (item.status === 'transferring' || item.speed_bytes_per_sec > 0 || item.bytes_transferred > 0)
}

export type VirtualQueueRow =
  | { type: 'group'; id: string; server_url: string; count: number }
  | { type: 'item'; id: string; item: TransferItem }

const queueRowsCache = new WeakMap<TransferItem[], { len: number; rows: VirtualQueueRow[] }>()

function buildVirtualQueueRows(transfers: TransferItem[]): VirtualQueueRow[] {
  if (transfers.length === 0) return []
  const cached = queueRowsCache.get(transfers)
  if (cached && cached.len === transfers.length) {
    return cached.rows
  }

  const map = new Map<string, TransferItem[]>()
  for (let i = 0; i < transfers.length; i++) {
    const t = transfers[i]
    const key = t.server_url || (t.session_id ? getServerUrlForSession(t.session_id) : 'sftp://remote')
    let list = map.get(key)
    if (!list) {
      list = []
      map.set(key, list)
    }
    list.push(t)
  }

  const rows: VirtualQueueRow[] = []
  for (const [server_url, groupTransfers] of map.entries()) {
    rows.push({
      type: 'group',
      id: `group-${server_url}`,
      server_url,
      count: groupTransfers.length,
    })
    for (let i = 0; i < groupTransfers.length; i++) {
      const item = groupTransfers[i]
      rows.push({
        type: 'item',
        id: item.transfer_id,
        item,
      })
    }
  }
  queueRowsCache.set(transfers, { len: transfers.length, rows })
  return rows
}

const activeVirtualRows = computed(() => buildVirtualQueueRows(sftpStore.activeTransfers))
const failedVirtualRows = computed(() => buildVirtualQueueRows(sftpStore.failedTransfers))
const completedVirtualRows = computed(() => buildVirtualQueueRows(sftpStore.completedTransfers))

const currentVirtualRows = computed<VirtualQueueRow[]>(() => {
  if (transferTab.value === 'active') return activeVirtualRows.value
  if (transferTab.value === 'failed') return failedVirtualRows.value
  return completedVirtualRows.value
})

const queueScrollContainerRef = ref<HTMLDivElement | null>(null)
const queueScrollTop = ref(0)
const queueViewportHeight = ref(250)

const updateQueueViewportHeight = () => {
  if (queueScrollContainerRef.value) {
    queueViewportHeight.value = queueScrollContainerRef.value.clientHeight || 250
  }
}

const handleQueueScroll = (e: Event) => {
  const target = e.target as HTMLElement
  if (target) {
    queueScrollTop.value = target.scrollTop
  }
}

watch(transferTab, () => {
  queueScrollTop.value = 0
  if (queueScrollContainerRef.value) {
    queueScrollContainerRef.value.scrollTop = 0
  }
  nextTick(() => updateQueueViewportHeight())
})

watch(showTransferDrawer, (open) => {
  if (open) {
    nextTick(() => updateQueueViewportHeight())
  }
})

watch(drawerHeight, () => {
  nextTick(() => updateQueueViewportHeight())
})

function findRowIndexAtOffset(offsets: number[], targetOffset: number): number {
  let low = 0
  let high = offsets.length - 2
  let result = 0

  while (low <= high) {
    const mid = (low + high) >> 1
    if (offsets[mid] <= targetOffset) {
      result = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return result
}

const OVERSCAN_BUFFER = 8

const virtualQueueLayout = computed(() => {
  const rows = currentVirtualRows.value
  const len = rows.length
  const offsets = new Array<number>(len + 1)
  offsets[0] = 0
  let total = 0
  const isTabActive = transferTab.value === 'active'

  for (let i = 0; i < len; i++) {
    const r = rows[i]
    let h = 25
    if (r.type === 'item' && isTabActive && isTransferActive(r.item)) {
      h = 48
    }
    total += h
    offsets[i + 1] = total
  }

  return {
    prefixOffsets: offsets,
    totalHeight: total,
  }
})

const virtualQueueRange = computed(() => {
  const rows = currentVirtualRows.value
  const len = rows.length
  if (len === 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      topPadding: 0,
      bottomPadding: 0,
      visibleRows: [] as VirtualQueueRow[],
    }
  }

  const { prefixOffsets, totalHeight } = virtualQueueLayout.value
  const scrollTop = queueScrollTop.value
  const viewHeight = queueViewportHeight.value || 250

  const rawStart = findRowIndexAtOffset(prefixOffsets, scrollTop)
  const rawEnd = findRowIndexAtOffset(prefixOffsets, scrollTop + viewHeight)

  const startIndex = Math.max(0, rawStart - OVERSCAN_BUFFER)
  const endIndex = Math.min(len - 1, rawEnd + OVERSCAN_BUFFER)

  const topPadding = prefixOffsets[startIndex]
  const bottomPadding = Math.max(0, totalHeight - prefixOffsets[endIndex + 1])
  const visibleRows = rows.slice(startIndex, endIndex + 1)

  return {
    startIndex,
    endIndex,
    topPadding,
    bottomPadding,
    visibleRows,
  }
})

const totalQueueBytes = computed(() => {
  return Math.max(0, sftpStore.totalActiveBytes - sftpStore.totalTransferredBytes)
})

const formatQueueSizeDisplay = (bytes: number): string => {
  if (bytes <= 0) return 'Queue empty'
  if (bytes < 1024) return `Queue: ${bytes} B`
  if (bytes < 1024 * 1024) return `Queue: ${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 * 1024 * 1024) return `Queue: ${(bytes / (1024 * 1024)).toFixed(1)} MiB`
  return `Queue: ${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`
}

const formatTransferTime = (timestampMs?: number): string => {
  if (!timestampMs) return '-'
  const d = new Date(timestampMs)
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

// Queue row selection & context menu state
const selectedQueueItemIds = ref<Set<string>>(new Set())
const lastQueueClickedId = ref<string | null>(null)

const handleQueueRowClick = (item: TransferItem, e: MouseEvent) => {
  closeQueueContextMenu()
  if (e.ctrlKey || e.metaKey) {
    if (selectedQueueItemIds.value.has(item.transfer_id)) {
      selectedQueueItemIds.value.delete(item.transfer_id)
    } else {
      selectedQueueItemIds.value.add(item.transfer_id)
    }
    lastQueueClickedId.value = item.transfer_id
  } else if (e.shiftKey && lastQueueClickedId.value) {
    const currentList = transferTab.value === 'active'
      ? sftpStore.activeTransfers
      : transferTab.value === 'completed'
      ? sftpStore.completedTransfers
      : sftpStore.failedTransfers
    const prevIdx = currentList.findIndex((t) => t.transfer_id === lastQueueClickedId.value)
    const currIdx = currentList.findIndex((t) => t.transfer_id === item.transfer_id)
    if (prevIdx !== -1 && currIdx !== -1) {
      const start = Math.min(prevIdx, currIdx)
      const end = Math.max(prevIdx, currIdx)
      const newSet = new Set<string>()
      for (let i = start; i <= end; i++) {
        newSet.add(currentList[i].transfer_id)
      }
      selectedQueueItemIds.value = newSet
    }
  } else {
    selectedQueueItemIds.value = new Set([item.transfer_id])
    lastQueueClickedId.value = item.transfer_id
  }
}

const queueContextMenu = ref<{
  show: boolean
  x: number
  y: number
  tab: 'active' | 'completed' | 'failed'
  activeSubmenu: 'priority' | 'completion' | null
}>({
  show: false,
  x: 0,
  y: 0,
  tab: 'active',
  activeSubmenu: null as 'prio' | 'compl' | null,
  openSubmenuLeft: false,
})

let queueSubmenuTimer: ReturnType<typeof setTimeout> | null = null

const setQueueSubmenu = (menu: 'prio' | 'compl' | null) => {
  if (queueSubmenuTimer) {
    clearTimeout(queueSubmenuTimer)
    queueSubmenuTimer = null
  }
  queueContextMenu.value.activeSubmenu = menu
}

const scheduleQueueSubmenuClose = () => {
  if (queueSubmenuTimer) clearTimeout(queueSubmenuTimer)
  queueSubmenuTimer = setTimeout(() => {
    queueContextMenu.value.activeSubmenu = null
  }, 280) // 280ms debounce allows smooth diagonal mouse movement without disappearing
}

const toggleQueueSubmenu = (menu: 'prio' | 'compl') => {
  if (queueSubmenuTimer) {
    clearTimeout(queueSubmenuTimer)
    queueSubmenuTimer = null
  }
  queueContextMenu.value.activeSubmenu = queueContextMenu.value.activeSubmenu === menu ? null : menu
}

const openQueueContextMenu = (e: MouseEvent, item?: TransferItem) => {
  e.preventDefault()
  e.stopPropagation()
  closeContextMenu()

  if (item) {
    if (!selectedQueueItemIds.value.has(item.transfer_id)) {
      selectedQueueItemIds.value = new Set([item.transfer_id])
      lastQueueClickedId.value = item.transfer_id
    }
  }

  const menuWidth = 260
  const menuHeight = 280
  const submenuWidth = 200
  const x = Math.min(e.clientX, window.innerWidth - menuWidth)
  const y = Math.min(e.clientY, window.innerHeight - menuHeight)
  const openSubmenuLeft = x + menuWidth + submenuWidth > window.innerWidth

  queueContextMenu.value = {
    show: true,
    x,
    y,
    tab: transferTab.value,
    activeSubmenu: null,
    openSubmenuLeft,
  }
}

const closeQueueContextMenu = () => {
  if (queueSubmenuTimer) {
    clearTimeout(queueSubmenuTimer)
    queueSubmenuTimer = null
  }
  queueContextMenu.value.show = false
  queueContextMenu.value.activeSubmenu = null
}

const showFileExistsModal = ref(false)
const selectedDefaultConflict = ref<ConflictPolicy>('ask')

const openFileExistsModal = () => {
  selectedDefaultConflict.value = sftpStore.conflictPolicy
  showFileExistsModal.value = true
  closeQueueContextMenu()
}

const saveDefaultConflictAction = () => {
  sftpStore.conflictPolicy = selectedDefaultConflict.value
  showFileExistsModal.value = false
}

const handleSetPriority = (priority: TransferPriority) => {
  sftpStore.setPriority(Array.from(selectedQueueItemIds.value), priority)
  closeQueueContextMenu()
}

const handleResetAndRequeueAll = async () => {
  closeQueueContextMenu()
  const tab = transferTab.value
  transferTab.value = 'active'
  if (tab === 'completed') {
    await sftpStore.requeueAll('successful')
  } else if (tab === 'failed') {
    await sftpStore.requeueAll('failed')
  } else {
    await sftpStore.requeueAll('all')
  }
}

const handleResetAndRequeueSelected = async () => {
  closeQueueContextMenu()
  const currentList = transferTab.value === 'completed'
    ? sftpStore.completedTransfers
    : sftpStore.failedTransfers
  const targets = currentList.filter((t) => selectedQueueItemIds.value.has(t.transfer_id))
  if (targets.length > 0) {
    transferTab.value = 'active'
    await sftpStore.requeueTransfers(targets)
  }
}

const handleRemoveSelectedQueue = () => {
  closeQueueContextMenu()
  sftpStore.removeTransfers(Array.from(selectedQueueItemIds.value))
  selectedQueueItemIds.value.clear()
}

const handleRemoveAllInTab = () => {
  closeQueueContextMenu()
  if (transferTab.value === 'completed') {
    sftpStore.clearCompletedTransfers()
  } else if (transferTab.value === 'failed') {
    sftpStore.clearFailedTransfers()
  } else {
    sftpStore.stopAndRemoveAllQueued()
  }
  selectedQueueItemIds.value.clear()
}

const exportQueueTransfers = (tab: 'active' | 'completed' | 'failed') => {
  let list: TransferItem[] = []
  if (tab === 'active') list = sftpStore.activeTransfers
  else if (tab === 'completed') list = sftpStore.completedTransfers
  else list = sftpStore.failedTransfers

  const lines = [
    `Termsftp Transfer Queue Export - Tab: ${tab} - Date: ${new Date().toISOString()}`,
    '--------------------------------------------------------------------------------',
    'Server | Direction | Local File | Remote File | Size | Priority | Status/Error',
    ...list.map((t) =>
      `${t.server_url || 'sftp://remote'} | ${t.direction} | ${t.local_path || '-'} | ${t.remote_path || '-'} | ${t.total_bytes || 0} | ${t.priority || 'Normal'} | ${t.error || (t.is_complete ? 'Complete' : 'Queued')}`
    ),
  ].join('\n')

  const blob = new Blob([lines], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `termsftp-${tab}-transfers-${Date.now()}.txt`
  a.click()
  URL.revokeObjectURL(url)
  closeQueueContextMenu()
}

// -------------------------------------------------------------
// Action After Queue Completion (FileZilla Feature)
// -------------------------------------------------------------
type QueueCompletionAction = 'nothing' | 'play_sound' | 'disconnect' | 'close'
const queueCompletionAction = ref<QueueCompletionAction>(
  (typeof window !== 'undefined' && (localStorage.getItem('termsftp_queue_completion_action') as QueueCompletionAction)) || 'nothing'
)

const playNotificationSound = () => {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioContextClass) return
    const ctx = new AudioContextClass()
    const now = ctx.currentTime

    // Two-tone pleasant notification chime (E5 -> B5)
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.type = 'sine'
    osc1.frequency.setValueAtTime(659.25, now)
    gain1.gain.setValueAtTime(0.18, now)
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25)
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.start(now)
    osc1.stop(now + 0.25)

    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = 'sine'
    osc2.frequency.setValueAtTime(987.77, now + 0.12)
    gain2.gain.setValueAtTime(0.22, now + 0.12)
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45)
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.start(now + 0.12)
    osc2.stop(now + 0.45)
  } catch (err) {
    console.warn('Notification audio chime failed:', err)
  }
}

const setQueueCompletionAction = (action: QueueCompletionAction) => {
  queueCompletionAction.value = action
  if (typeof window !== 'undefined') {
    localStorage.setItem('termsftp_queue_completion_action', action)
  }
  closeQueueContextMenu()
  if (action === 'play_sound') {
    playNotificationSound()
    showArchiveToast('Action after queue: Play notification sound', false, false, 2500)
  } else if (action === 'disconnect') {
    showArchiveToast('Action after queue: Disconnect from server', false, false, 2500)
  } else if (action === 'close') {
    showArchiveToast('Action after queue: Close Termsftp', false, false, 2500)
  } else {
    showArchiveToast('Action after queue: Do nothing', false, false, 2000)
  }
}

const handleQueueCompleted = async () => {
  if (queueCompletionAction.value === 'play_sound') {
    playNotificationSound()
    showArchiveToast('All transfers completed successfully!', false, false, 3500)
  } else if (queueCompletionAction.value === 'disconnect') {
    playNotificationSound()
    showArchiveToast('Queue complete: Disconnecting from server...', false, false, 3500)
    if (props.sessionId) {
      await sshStore.disconnect(props.sessionId)
    }
  } else if (queueCompletionAction.value === 'close') {
    playNotificationSound()
    showArchiveToast('Queue complete: Closing TermSFTP in 2 seconds...', false, false, 2000)
    setTimeout(async () => {
      try {
        await invoke('exit_app')
      } catch (err) {
        console.warn('invoke exit_app error, trying window close fallback:', err)
        try {
          await getCurrentWindow().close()
        } catch (e2) {
          console.error('Failed to close window on queue complete:', e2)
        }
      }
    }, 2000)
  }
}

// Auto-expand drawer on start and trigger queue completion actions
watch(
  () => sftpStore.activeTransfers.length,
  (newCount, oldCount) => {
    if (newCount > 0 && (!oldCount || oldCount === 0)) {
      showTransferDrawer.value = true
      transferTab.value = 'active'
    } else if (oldCount && oldCount > 0 && newCount === 0) {
      handleQueueCompleted()
    }
  }
)

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
const localFilterInputRef = ref<HTMLInputElement | null>(null)

const showRemoteFilter = ref(false)
const remoteSearchQuery = ref('')
const remoteFilterInputRef = ref<HTMLInputElement | null>(null)

// -------------------------------------------------------------
// Directory Comparison Mode (Visual Diff between Local & Remote)
// -------------------------------------------------------------
type CompareStatus = 'identical' | 'local_only' | 'remote_only' | 'size_different' | 'local_newer' | 'remote_newer'

interface ComparisonItemInfo {
  status: CompareStatus
  counterpartSize?: number
  counterpartModified?: number
}

interface ComparisonResult {
  localMap: Map<string, ComparisonItemInfo>
  remoteMap: Map<string, ComparisonItemInfo>
  stats: {
    identical: number
    localOnly: number
    remoteOnly: number
    sizeDifferent: number
    localNewer: number
    remoteNewer: number
    totalDiffs: number
  }
}

const isComparing = ref(false)
const compareCriteria = ref<'size_and_time' | 'size_only'>('size_and_time')
const hideIdenticalFiles = ref(false)

const toggleComparison = () => {
  if (!props.sessionId) return
  isComparing.value = !isComparing.value
}

const comparisonResult = computed<ComparisonResult | null>(() => {
  if (!isComparing.value || !props.sessionId) return null

  const localMap = new Map<string, ComparisonItemInfo>()
  const remoteMap = new Map<string, ComparisonItemInfo>()

  const remoteByName = new Map<string, SftpFileEntry>()
  for (const rf of sftpStore.remoteFiles) {
    if (rf.name !== '..' && rf.name !== '.') {
      remoteByName.set(rf.name, rf)
    }
  }

  const localByName = new Map<string, LocalFileEntry>()
  for (const lf of sftpStore.localFiles) {
    if (lf.name !== '..' && lf.name !== '.') {
      localByName.set(lf.name, lf)
    }
  }

  let identical = 0
  let localOnly = 0
  let remoteOnly = 0
  let sizeDifferent = 0
  let localNewer = 0
  let remoteNewer = 0

  for (const [name, lf] of localByName) {
    const rf = remoteByName.get(name)
    if (!rf) {
      localMap.set(name, { status: 'local_only' })
      localOnly++
    } else {
      if (lf.is_dir && rf.is_dir) {
        localMap.set(name, { status: 'identical', counterpartSize: rf.size, counterpartModified: rf.modified })
        identical++
      } else if (!lf.is_dir && !rf.is_dir) {
        if (lf.size !== rf.size) {
          localMap.set(name, { status: 'size_different', counterpartSize: rf.size, counterpartModified: rf.modified })
          sizeDifferent++
        } else if (compareCriteria.value === 'size_and_time') {
          const timeDiff = (lf.modified || 0) - (rf.modified || 0)
          if (timeDiff > 2) {
            localMap.set(name, { status: 'local_newer', counterpartSize: rf.size, counterpartModified: rf.modified })
            localNewer++
          } else if (timeDiff < -2) {
            localMap.set(name, { status: 'remote_newer', counterpartSize: rf.size, counterpartModified: rf.modified })
            remoteNewer++
          } else {
            localMap.set(name, { status: 'identical', counterpartSize: rf.size, counterpartModified: rf.modified })
            identical++
          }
        } else {
          localMap.set(name, { status: 'identical', counterpartSize: rf.size, counterpartModified: rf.modified })
          identical++
        }
      } else {
        localMap.set(name, { status: 'size_different', counterpartSize: rf.size, counterpartModified: rf.modified })
        sizeDifferent++
      }
    }
  }

  for (const [name, rf] of remoteByName) {
    const lf = localByName.get(name)
    if (!lf) {
      remoteMap.set(name, { status: 'remote_only' })
      remoteOnly++
    } else {
      const localStatus = localMap.get(name)?.status || 'identical'
      remoteMap.set(name, { status: localStatus, counterpartSize: lf.size, counterpartModified: lf.modified })
    }
  }

  return {
    localMap,
    remoteMap,
    stats: {
      identical,
      localOnly,
      remoteOnly,
      sizeDifferent,
      localNewer,
      remoteNewer,
      totalDiffs: localOnly + remoteOnly + sizeDifferent + localNewer + remoteNewer,
    },
  }
})

const syncLocalToRemote = async () => {
  if (!comparisonResult.value || !props.sessionId) return
  const toUpload: LocalFileEntry[] = []
  for (const lf of sftpStore.localFiles) {
    const comp = comparisonResult.value.localMap.get(lf.name)
    if (comp && (comp.status === 'local_only' || comp.status === 'local_newer' || comp.status === 'size_different')) {
      toUpload.push(lf)
    }
  }
  if (toUpload.length > 0) {
    await handleBatchUpload(toUpload)
  }
}

const syncRemoteToLocal = async () => {
  if (!comparisonResult.value || !props.sessionId) return
  const toDownload: SftpFileEntry[] = []
  for (const rf of sftpStore.remoteFiles) {
    const comp = comparisonResult.value.remoteMap.get(rf.name)
    if (comp && (comp.status === 'remote_only' || comp.status === 'remote_newer' || comp.status === 'size_different')) {
      toDownload.push(rf)
    }
  }
  if (toDownload.length > 0) {
    await handleBatchDownload(toDownload)
  }
}

const getLocalRowCompareStyle = (file: LocalFileEntry) => {
  if (!isComparing.value || !comparisonResult.value) return null
  const res = comparisonResult.value.localMap.get(file.name)
  if (!res) return null
  switch (res.status) {
    case 'local_only':
      return {
        backgroundColor: 'rgba(16, 185, 129, 0.08)',
        borderLeft: '3px solid #10b981',
      }
    case 'local_newer':
      return {
        backgroundColor: 'rgba(245, 158, 11, 0.08)',
        borderLeft: '3px solid #f59e0b',
      }
    case 'size_different':
      return {
        backgroundColor: 'rgba(239, 68, 68, 0.08)',
        borderLeft: '3px solid #ef4444',
      }
    case 'remote_newer':
      return {
        backgroundColor: 'rgba(100, 116, 139, 0.05)',
        borderLeft: '3px solid #64748b',
      }
    case 'identical':
      return comparisonResult.value.stats.totalDiffs > 0 ? { opacity: 0.6 } : null
  }
}

const getRemoteRowCompareStyle = (file: SftpFileEntry) => {
  if (!isComparing.value || !comparisonResult.value) return null
  const res = comparisonResult.value.remoteMap.get(file.name)
  if (!res) return null
  switch (res.status) {
    case 'remote_only':
      return {
        backgroundColor: 'rgba(59, 130, 246, 0.08)',
        borderLeft: '3px solid #3b82f6',
      }
    case 'remote_newer':
      return {
        backgroundColor: 'rgba(245, 158, 11, 0.08)',
        borderLeft: '3px solid #f59e0b',
      }
    case 'size_different':
      return {
        backgroundColor: 'rgba(239, 68, 68, 0.08)',
        borderLeft: '3px solid #ef4444',
      }
    case 'local_newer':
      return {
        backgroundColor: 'rgba(100, 116, 139, 0.05)',
        borderLeft: '3px solid #64748b',
      }
    case 'identical':
      return comparisonResult.value.stats.totalDiffs > 0 ? { opacity: 0.6 } : null
  }
}

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
// File Attribute Formatters & Classification Helpers
// -------------------------------------------------------------
const formatPermissions = (permissions: number, isDir: boolean, isSymlink?: boolean): string => {
  if (!permissions) {
    return isDir ? 'drwxr-xr-x' : isSymlink ? 'lrwxrwxrwx' : '-rw-r--r--'
  }
  const typeChar = isDir ? 'd' : isSymlink ? 'l' : '-'
  const perm = permissions & 0o777
  const r1 = (perm & 0o400) ? 'r' : '-'
  const w1 = (perm & 0o200) ? 'w' : '-'
  const x1 = (perm & 0o100) ? ((permissions & 0o4000) ? 's' : 'x') : ((permissions & 0o4000) ? 'S' : '-')
  const r2 = (perm & 0o040) ? 'r' : '-'
  const w2 = (perm & 0o020) ? 'w' : '-'
  const x2 = (perm & 0o010) ? ((permissions & 0o2000) ? 's' : 'x') : ((permissions & 0o2000) ? 'S' : '-')
  const r3 = (perm & 0o004) ? 'r' : '-'
  const w3 = (perm & 0o002) ? 'w' : '-'
  const x3 = (perm & 0o001) ? ((permissions & 0o1000) ? 't' : 'x') : ((permissions & 0o1000) ? 'T' : '-')
  return `${typeChar}${r1}${w1}${x1}${r2}${w2}${x2}${r3}${w3}${x3}`
}

const formatOctalPermissions = (permissions: number, isDir: boolean): string => {
  const perm = permissions ? (permissions & 0o777) : (isDir ? 0o755 : 0o644)
  return `0${perm.toString(8)}`
}

const formatOwnerGroup = (file: SftpFileEntry): string => {
  if (file.owner && file.group) {
    return `${file.owner} / ${file.group}`
  }
  if (file.owner) {
    return file.owner
  }
  if (file.group) {
    return file.group
  }
  return '-'
}

const getFileType = (entry: LocalFileEntry | SftpFileEntry): string => {
  if (entry.is_dir) return 'Folder'
  if (entry.is_symlink) return 'Symlink'

  const name = entry.name
  const lower = name.toLowerCase()

  if (lower === 'dockerfile') return 'Dockerfile'
  if (lower === 'makefile') return 'Makefile'
  if (lower === 'license' || lower === 'licence') return 'License'
  if (lower === 'readme' || lower.startsWith('readme.')) return 'Readme'
  if (lower.endsWith('.tar.gz')) return 'TAR.GZ Archive'
  if (lower.endsWith('.tar.bz2')) return 'TAR.BZ2 Archive'

  const lastDotIndex = name.lastIndexOf('.')
  if (lastDotIndex <= 0) {
    if (name.startsWith('.')) {
      return name.slice(1).toUpperCase() + ' File'
    }
    return 'File'
  }

  const ext = name.slice(lastDotIndex + 1).toLowerCase()

  const map: Record<string, string> = {
    txt: 'Text Document',
    md: 'Markdown',
    json: 'JSON',
    js: 'JavaScript',
    ts: 'TypeScript',
    vue: 'Vue Component',
    html: 'HTML Document',
    css: 'CSS Stylesheet',
    scss: 'SCSS Stylesheet',
    rs: 'Rust Source',
    py: 'Python Script',
    sh: 'Shell Script',
    bash: 'Bash Script',
    png: 'PNG Image',
    jpg: 'JPEG Image',
    jpeg: 'JPEG Image',
    gif: 'GIF Image',
    svg: 'SVG Vector',
    webp: 'WebP Image',
    ico: 'Icon Image',
    pdf: 'PDF Document',
    zip: 'ZIP Archive',
    tar: 'TAR Archive',
    gz: 'GZ Archive',
    tgz: 'TAR Archive',
    rar: 'RAR Archive',
    '7z': '7-Zip Archive',
    xml: 'XML Document',
    yaml: 'YAML File',
    yml: 'YAML File',
    toml: 'TOML File',
    sql: 'SQL Database',
    db: 'Database',
    sqlite: 'SQLite DB',
    log: 'Log File',
    exe: 'Executable',
    dll: 'Dynamic Library',
    so: 'Shared Object',
    dylib: 'Mach-O Library',
    bin: 'Binary File',
    iso: 'Disk Image',
    deb: 'Debian Package',
    rpm: 'RPM Package',
    mp3: 'MP3 Audio',
    mp4: 'MP4 Video',
    wav: 'WAV Audio',
    mkv: 'MKV Video',
    woff: 'Web Font',
    woff2: 'Web Font',
    ttf: 'TrueType Font',
    env: 'Environment',
  }

  if (map[ext]) {
    return map[ext]
  }

  return ext.toUpperCase() + ' File'
}

// -------------------------------------------------------------
// File & Directory Sorting State & Logic
// -------------------------------------------------------------
export type FileSortField = 'name' | 'type' | 'size' | 'modified' | 'permissions' | 'owner'
export type FileSortOrder = 'asc' | 'desc'

const validSortFields: FileSortField[] = ['name', 'type', 'size', 'modified', 'permissions', 'owner']
const validSortOrders: FileSortOrder[] = ['asc', 'desc']

const getStoredSortBy = (key: string, defaultVal: FileSortField): FileSortField => {
  if (typeof window === 'undefined') return defaultVal
  const val = localStorage.getItem(key) as FileSortField
  return validSortFields.includes(val) ? val : defaultVal
}

const getStoredSortOrder = (key: string, defaultVal: FileSortOrder): FileSortOrder => {
  if (typeof window === 'undefined') return defaultVal
  const val = localStorage.getItem(key) as FileSortOrder
  return validSortOrders.includes(val) ? val : defaultVal
}

const localSortBy = ref<FileSortField>(getStoredSortBy('termsftp_local_sort_by', 'name'))
const localSortOrder = ref<FileSortOrder>(getStoredSortOrder('termsftp_local_sort_order', 'asc'))
const remoteSortBy = ref<FileSortField>(getStoredSortBy('termsftp_remote_sort_by', 'name'))
const remoteSortOrder = ref<FileSortOrder>(getStoredSortOrder('termsftp_remote_sort_order', 'asc'))

const handleLocalSort = (field: FileSortField) => {
  if (localSortBy.value === field) {
    localSortOrder.value = localSortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    localSortBy.value = field
    localSortOrder.value = 'asc'
  }
  if (typeof window !== 'undefined') {
    localStorage.setItem('termsftp_local_sort_by', localSortBy.value)
    localStorage.setItem('termsftp_local_sort_order', localSortOrder.value)
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
    localStorage.setItem('termsftp_remote_sort_by', remoteSortBy.value)
    localStorage.setItem('termsftp_remote_sort_order', remoteSortOrder.value)
  }
}

function sortFileList<T extends LocalFileEntry | SftpFileEntry>(
  files: T[],
  sortBy: FileSortField,
  sortOrder: FileSortOrder
): T[] {
  return [...files].sort((a, b) => {
    // 1. Folders always remain grouped at the top ahead of regular files
    if (a.is_dir && !b.is_dir) return -1
    if (!a.is_dir && b.is_dir) return 1

    // 2. Primary field comparison
    let cmp = 0
    switch (sortBy) {
      case 'name':
        cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        break
      case 'type': {
        const typeA = getFileType(a)
        const typeB = getFileType(b)
        cmp = typeA.localeCompare(typeB, undefined, { numeric: true, sensitivity: 'base' })
        break
      }
      case 'size':
        cmp = (a.size || 0) - (b.size || 0)
        break
      case 'modified':
        cmp = (a.modified || 0) - (b.modified || 0)
        break
      case 'permissions': {
        const permA = ('permissions' in a ? (a.permissions || 0) : 0)
        const permB = ('permissions' in b ? (b.permissions || 0) : 0)
        cmp = permA - permB
        break
      }
      case 'owner': {
        const ownerA = 'owner' in a ? formatOwnerGroup(a as SftpFileEntry) : ''
        const ownerB = 'owner' in b ? formatOwnerGroup(b as SftpFileEntry) : ''
        cmp = ownerA.localeCompare(ownerB, undefined, { numeric: true, sensitivity: 'base' })
        break
      }
      default:
        cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    }

    // 3. Invert direction for descending
    if (sortOrder === 'desc') {
      cmp = -cmp
    }

    // 4. Stable tie-breaker: sort alphabetically by name if field values are identical
    if (cmp === 0) {
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    }

    return cmp
  })
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

const highlightMatch = (text: string, query: string): { before: string; match: string; after: string } | null => {
  const q = query.trim().toLowerCase()
  if (!q) return null
  const idx = text.toLowerCase().indexOf(q)
  if (idx === -1) return null
  return {
    before: text.slice(0, idx),
    match: text.slice(idx, idx + q.length),
    after: text.slice(idx + q.length),
  }
}

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
    const lb = localStorage.getItem('termsftp_local_bookmarks')
    if (lb) {
      localBookmarks.value = JSON.parse(lb)
    } else {
      localBookmarks.value = []
    }
    const rb = localStorage.getItem('termsftp_remote_bookmarks')
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
  localStorage.setItem('termsftp_local_bookmarks', JSON.stringify(localBookmarks.value))
}

const saveRemoteBookmarks = () => {
  localStorage.setItem('termsftp_remote_bookmarks', JSON.stringify(remoteBookmarks.value))
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

// Drag and Drop State
interface DraggingState {
  source: 'local' | 'remote'
  files: (LocalFileEntry | SftpFileEntry)[]
}
const activeDragging = ref<DraggingState | null>(null)

const isRemoteDragActive = ref(false)
let remoteDragCounter = 0

const isLocalDragActive = ref(false)
let localDragCounter = 0

const activeDropFolder = ref<{ pane: 'local' | 'remote'; path: string } | null>(null)

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

// WSL Discovery & Menu State
const wslDistros = ref<string[]>([])
const showWslMenu = ref(false)
const isLoadingWsl = ref(false)

const loadWslDistros = async () => {
  try {
    isLoadingWsl.value = true
    const distros = await invoke<string[]>('sftp_get_wsl_distros')
    wslDistros.value = distros
  } catch (err) {
    console.warn('Failed to get WSL distros:', err)
  } finally {
    isLoadingWsl.value = false
  }
}

const toggleWslMenu = async (event: MouseEvent) => {
  event.stopPropagation()
  showWslMenu.value = !showWslMenu.value
  if (showWslMenu.value) {
    await loadWslDistros()
  }
}

const navigateToWslDistro = (distro: string) => {
  showWslMenu.value = false
  sftpStore.fetchLocalDir(`//wsl.localhost/${distro}`)
}

// Helper formatting
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

const formatDate = (timestampSec: number): string => {
  if (!timestampSec) return '-'
  const d = new Date(timestampSec * 1000)
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const formatETA = (item: TransferItem): string => {
  if (
    item.speed_bytes_per_sec &&
    item.speed_bytes_per_sec > 0 &&
    item.total_bytes &&
    item.bytes_transferred < item.total_bytes
  ) {
    const remainingBytes = item.total_bytes - item.bytes_transferred
    const secs = Math.ceil(remainingBytes / item.speed_bytes_per_sec)
    if (secs < 60) return `${secs}s`
    if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`
    return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`
  }
  return '--'
}

const formatDuration = (ms?: number): string => {
  if (!ms || ms <= 0) return '< 1s'
  const secs = Math.round(ms / 1000)
  if (secs < 1) return '< 1s'
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const remSecs = secs % 60
  if (mins < 60) return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  return `${hours}h ${remMins}m`
}

const formatAvgSpeed = (item: TransferItem): string => {
  if (item.started_at && item.completed_at && item.completed_at > item.started_at) {
    const durationSec = (item.completed_at - item.started_at) / 1000
    if (durationSec > 0 && item.bytes_transferred > 0) {
      const speed = item.bytes_transferred / durationSec
      return `${formatBytes(speed)}/s`
    }
  }
  return '--'
}

const queueTimerTick = ref(Date.now())
let queueTimerInterval: any = null

const formatHms = (seconds: number): string => {
  if (isNaN(seconds) || seconds < 0 || !isFinite(seconds)) return '00:00:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

const getTransferElapsed = (item: TransferItem): string => {
  const _tick = queueTimerTick.value
  if (!item.started_at) return '00:00:00 elapsed'
  const elapsedSec = Math.max(0, (_tick - item.started_at) / 1000)
  return `${formatHms(elapsedSec)} elapsed`
}

const getTransferLeft = (item: TransferItem): string => {
  if (!item.total_bytes || item.bytes_transferred >= item.total_bytes) return '00:00:00 left'
  if (!item.speed_bytes_per_sec || item.speed_bytes_per_sec <= 0) return '--:--:-- left'
  const remainingBytes = Math.max(0, item.total_bytes - item.bytes_transferred)
  const leftSec = Math.ceil(remainingBytes / item.speed_bytes_per_sec)
  return `${formatHms(leftSec)} left`
}

const getTransferPercentNumber = (item: TransferItem): number => {
  if (!item.total_bytes || item.total_bytes <= 0) return item.is_complete ? 100 : 0
  return Math.min(100, Math.max(0, (item.bytes_transferred / item.total_bytes) * 100))
}

const getTransferPercentFormatted = (item: TransferItem): string => {
  const num = getTransferPercentNumber(item)
  return `${num.toFixed(1)}%`
}

const formatSpeedMib = (bytesPerSec?: number): string => {
  if (!bytesPerSec || bytesPerSec <= 0) return '0.0 B/s'
  const k = 1024
  if (bytesPerSec < k) return `${bytesPerSec.toFixed(0)} B/s`
  if (bytesPerSec < k * k) return `${(bytesPerSec / k).toFixed(1)} KiB/s`
  if (bytesPerSec < k * k * k) return `${(bytesPerSec / (k * k)).toFixed(1)} MiB/s`
  return `${(bytesPerSec / (k * k * k)).toFixed(1)} GiB/s`
}

const getTransferProgressPercent = (item: TransferItem): number => {
  if (!item.total_bytes || item.total_bytes <= 0) return item.is_complete ? 100 : 0
  return Math.min(100, Math.max(0, Math.round((item.bytes_transferred / item.total_bytes) * 100)))
}



// Watchers
watch(
  () => sftpStore.localPath,
  (newPath) => {
    localInputPath.value = newPath
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
  showWslMenu.value = false
  showLocalBookmarksMenu.value = false
  showRemoteBookmarksMenu.value = false
  closeQueueContextMenu()
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

const applySelection = (isLocal: boolean, nextIndex: number, prevIndex: number | null, isShift: boolean) => {
  const files = isLocal ? filteredLocalFiles.value : filteredRemoteFiles.value

  if (nextIndex === -1) {
    if (isLocal) {
      isLocalParentSelected.value = true
      selectedLocalPaths.value = new Set()
      lastLocalClickedIndex.value = -1
      localSelectionAnchor.value = -1
      sftpStore.selectedLocalPath = localParentPath.value || ''
      scrollToRow('local', -1)
    } else {
      isRemoteParentSelected.value = true
      selectedRemotePaths.value = new Set()
      lastRemoteClickedIndex.value = -1
      remoteSelectionAnchor.value = -1
      sftpStore.selectedRemotePath = remoteParentPath.value || ''
      scrollToRow('remote', -1)
    }
    return
  }

  if (nextIndex >= 0 && nextIndex < files.length) {
    const file = files[nextIndex]
    if (isLocal) {
      isLocalParentSelected.value = false
      if (isShift && prevIndex !== null && prevIndex >= 0) {
        const anchor = localSelectionAnchor.value ?? prevIndex
        const start = Math.min(anchor, nextIndex)
        const end = Math.max(anchor, nextIndex)
        const newSet = new Set<string>()
        for (let i = start; i <= end; i++) {
          if (files[i]) newSet.add(files[i].path)
        }
        selectedLocalPaths.value = newSet
        lastLocalClickedIndex.value = nextIndex
      } else {
        localSelectionAnchor.value = nextIndex
        selectedLocalPaths.value = new Set([file.path])
        lastLocalClickedIndex.value = nextIndex
      }
      sftpStore.selectedLocalPath = file.path
      scrollToRow('local', nextIndex)
    } else {
      isRemoteParentSelected.value = false
      if (isShift && prevIndex !== null && prevIndex >= 0) {
        const anchor = remoteSelectionAnchor.value ?? prevIndex
        const start = Math.min(anchor, nextIndex)
        const end = Math.max(anchor, nextIndex)
        const newSet = new Set<string>()
        for (let i = start; i <= end; i++) {
          if (files[i]) newSet.add(files[i].path)
        }
        selectedRemotePaths.value = newSet
        lastRemoteClickedIndex.value = nextIndex
      } else {
        remoteSelectionAnchor.value = nextIndex
        selectedRemotePaths.value = new Set([file.path])
        lastRemoteClickedIndex.value = nextIndex
      }
      sftpStore.selectedRemotePath = file.path
      scrollToRow('remote', nextIndex)
    }
  }
}

const isTypingInInput = (e: KeyboardEvent) => {
  const target = e.target as HTMLElement | null
  if (!target) return false
  const tag = target.tagName?.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || target.isContentEditable) {
    return true
  }
  return false
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
    showSettingsModal.value ||
    vaultStore.showModal
  )
}

const handleKeyNavigation = (e: KeyboardEvent) => {
  if (props.active === false) return
  if (isTypingInInput(e) || isAnyModalOpen()) return

  // Tab: toggle active pane
  if (e.key === 'Tab') {
    e.preventDefault()
    if (props.sessionId) {
      activePane.value = activePane.value === 'local' ? 'remote' : 'local'
    } else {
      activePane.value = 'local'
    }
    return
  }

  // Backspace or Alt+ArrowUp: go to parent directory
  if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowUp')) {
    e.preventDefault()
    if (activePane.value === 'local' && canNavigateLocalUp.value) {
      navigateLocalUp()
    } else if (activePane.value === 'remote' && canNavigateRemoteUp.value) {
      navigateRemoteUp()
    }
    return
  }

  const isLocal = activePane.value === 'local'
  const files = isLocal ? filteredLocalFiles.value : filteredRemoteFiles.value
  const hasParent = isLocal ? canNavigateLocalUp.value : canNavigateRemoteUp.value

  if (files.length === 0 && !hasParent) return

  const minIndex = hasParent ? -1 : 0
  const maxIndex = files.length - 1

  // Determine current index
  let curr: number | null = null
  const isParentSelected = isLocal ? isLocalParentSelected.value : isRemoteParentSelected.value
  const lastIndex = isLocal ? lastLocalClickedIndex.value : lastRemoteClickedIndex.value
  const selectedPaths = isLocal ? selectedLocalPaths.value : selectedRemotePaths.value

  if (isParentSelected) {
    curr = -1
  } else if (lastIndex !== null && lastIndex >= 0 && lastIndex <= maxIndex) {
    curr = lastIndex
  } else if (selectedPaths.size > 0) {
    const found = files.findIndex((f) => selectedPaths.has(f.path))
    if (found !== -1) curr = found
  }

  // ArrowDown
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    let nextIndex: number
    if (curr === null) {
      nextIndex = minIndex
    } else {
      nextIndex = Math.min(maxIndex, curr + 1)
    }
    applySelection(isLocal, nextIndex, curr, e.shiftKey)
    if (showQuickLook.value && files[nextIndex] && !files[nextIndex].is_dir) {
      quickLookFile.value = files[nextIndex]
    }
    return
  }

  // ArrowUp
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    let nextIndex: number
    if (curr === null) {
      nextIndex = maxIndex
    } else {
      nextIndex = Math.max(minIndex, curr - 1)
    }
    applySelection(isLocal, nextIndex, curr, e.shiftKey)
    if (showQuickLook.value && files[nextIndex] && !files[nextIndex].is_dir) {
      quickLookFile.value = files[nextIndex]
    }
    return
  }

  // Home
  if (e.key === 'Home') {
    e.preventDefault()
    applySelection(isLocal, minIndex, curr, false)
    return
  }

  // End
  if (e.key === 'End') {
    e.preventDefault()
    applySelection(isLocal, maxIndex, curr, false)
    return
  }

  // Enter: enter folder or open file
  if (e.key === 'Enter') {
    e.preventDefault()
    if (curr === -1) {
      if (isLocal) {
        navigateLocalUp()
      } else {
        navigateRemoteUp()
      }
    } else if (curr !== null && files[curr]) {
      const entry = files[curr]
      if (isLocal) {
        handleLocalRowDoubleClick(entry as LocalFileEntry)
      } else {
        handleRemoteRowDoubleClick(entry as SftpFileEntry)
      }
    }
    return
  }
}

const focusFirstItem = (pane: 'local' | 'remote') => {
  const isLocal = pane === 'local'
  const files = isLocal ? filteredLocalFiles.value : filteredRemoteFiles.value
  if (files.length > 0) {
    applySelection(isLocal, 0, null, false)
    scrollToRow(pane, 0)
    if (isLocal) {
      localFilterInputRef.value?.blur()
    } else {
      remoteFilterInputRef.value?.blur()
    }
  }
}

const handleGlobalKeyDown = (e: KeyboardEvent) => {
  if (props.active === false) return
  if (showEditorModal.value) {
    // When the code editor modal is open, global Escape must NEVER close it
    return
  }

  // F2: Rename selected item in active pane
  if (e.key === 'F2') {
    const target = e.target as HTMLElement
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.closest('.monaco-editor'))
    ) {
      return
    }
    if (isAnyModalOpen()) return

    e.preventDefault()
    e.stopPropagation()
    triggerRenameSelected()
    return
  }

  // Delete / Del: Delete selected item(s) in active pane
  if (e.key === 'Delete' || e.key === 'Del') {
    const target = e.target as HTMLElement
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.closest('.monaco-editor'))
    ) {
      return
    }
    if (isAnyModalOpen()) return

    e.preventDefault()
    e.stopPropagation()

    if (activePane.value === 'local' && selectedLocalFiles.value.length > 0) {
      handleBatchDeleteLocal(selectedLocalFiles.value)
    } else if (activePane.value === 'remote' && selectedRemoteFiles.value.length > 0) {
      handleBatchDeleteRemote(selectedRemoteFiles.value)
    }
    return
  }

  // Ctrl+Shift+C / Cmd+Shift+C: Toggle Directory Comparison
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
    e.preventDefault()
    e.stopPropagation()
    toggleComparison()
    return
  }

  // Ctrl+F / Cmd+F: Toggle In-Pane Instant Live Filter
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    e.stopPropagation()
    toggleFilter(activePane.value || 'remote')
    return
  }

  // Ctrl+A / Cmd+A: Select All in active pane
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    const target = e.target as HTMLElement
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.closest('.monaco-editor'))
    ) {
      return
    }
    e.preventDefault()
    e.stopPropagation()
    selectAll(activePane.value || 'local')
    return
  }

  // Spacebar macOS-style Quick Look Trigger
  if (e.code === 'Space') {
    const target = e.target as HTMLElement
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        target.closest('.monaco-editor'))
    ) {
      return
    }

    e.preventDefault()
    if (showQuickLook.value) {
      showQuickLook.value = false
    } else {
      openQuickLook()
    }
    return
  }

  if (e.key === 'Escape') {
    if (showQuickLook.value) {
      showQuickLook.value = false
      return
    }
    if (showDeleteConfirmModal.value) {
      closeDeleteConfirm()
      return
    }
    if (showLocalFilter.value && localSearchQuery.value) {
      localSearchQuery.value = ''
      return
    }
    if (showRemoteFilter.value && remoteSearchQuery.value) {
      remoteSearchQuery.value = ''
      return
    }
    if (showLocalFilter.value) {
      showLocalFilter.value = false
      return
    }
    if (showRemoteFilter.value) {
      showRemoteFilter.value = false
      return
    }
    if (isComparing.value && hideIdenticalFiles.value) {
      hideIdenticalFiles.value = false
      return
    }
    if (isComparing.value) {
      isComparing.value = false
      return
    }
    if (showFileExistsModal.value) {
      showFileExistsModal.value = false
      return
    }
    closeContextMenu()
    showNewFolderModal.value = false
    showNewFileModal.value = false
    showRenameModal.value = false
    showCompressModal.value = false
    showExtractModal.value = false
    showWslMenu.value = false
    showLocalBookmarksMenu.value = false
    showRemoteBookmarksMenu.value = false
    showSettingsModal.value = false
    showPermissionsModal.value = false
    if (sftpStore.activeConflictDialog?.show) {
      sftpStore.resolveConflict('skip')
    }
    return
  }

  handleKeyNavigation(e)
}

onMounted(() => {
  const savedLeftPercent = localStorage.getItem('termsftp_left_pane_percent')
  if (savedLeftPercent) {
    const parsed = parseFloat(savedLeftPercent)
    if (!isNaN(parsed) && parsed >= 20 && parsed <= 80) {
      leftPanePercent.value = parsed
    }
  }

  const savedDrawerHeight = localStorage.getItem('termsftp_drawer_height')
  if (savedDrawerHeight) {
    const parsed = parseInt(savedDrawerHeight, 10)
    if (!isNaN(parsed) && parsed >= MIN_DRAWER_HEIGHT) {
      drawerHeight.value = parsed
    }
  }

  loadQueueColWidths()
  sftpStore.initLocal()
  vaultStore.init()
  loadBookmarks()
  startHeartbeat()
  window.addEventListener('online', handleNetworkOnline)
  window.addEventListener('click', closeContextMenu)
  window.addEventListener('keydown', handleGlobalKeyDown)

  // Listen to OS desktop file drag & drop into webview
  try {
    getCurrentWebview()
      .onDragDropEvent(async (event) => {
        // If tab or window is not active, ignore
        if (props.active === false) return

        const payload = event.payload
        if (payload.type === 'enter' || payload.type === 'over') {
          const cssX = payload.position.x / window.devicePixelRatio
          const cssY = payload.position.y / window.devicePixelRatio

          if (remotePaneRef.value) {
            const rect = remotePaneRef.value.getBoundingClientRect()
            if (cssX >= rect.left && cssX <= rect.right && cssY >= rect.top && cssY <= rect.bottom) {
              isRemoteDragActive.value = true
              isLocalDragActive.value = false
              return
            }
          }

          if (localPaneRef.value) {
            const rect = localPaneRef.value.getBoundingClientRect()
            if (cssX >= rect.left && cssX <= rect.right && cssY >= rect.top && cssY <= rect.bottom) {
              isLocalDragActive.value = true
              isRemoteDragActive.value = false
              return
            }
          }

          isRemoteDragActive.value = false
          isLocalDragActive.value = false
        } else if (payload.type === 'leave') {
          isRemoteDragActive.value = false
          isLocalDragActive.value = false
        } else if (payload.type === 'drop') {
          const cssX = payload.position.x / window.devicePixelRatio
          const cssY = payload.position.y / window.devicePixelRatio

          const isOverRemote =
            remotePaneRef.value &&
            (() => {
              const rect = remotePaneRef.value.getBoundingClientRect()
              return cssX >= rect.left && cssX <= rect.right && cssY >= rect.top && cssY <= rect.bottom
            })()

          const isOverLocal =
            localPaneRef.value &&
            (() => {
              const rect = localPaneRef.value.getBoundingClientRect()
              return cssX >= rect.left && cssX <= rect.right && cssY >= rect.top && cssY <= rect.bottom
            })()

          const targetFolder = activeDropFolder.value ? { ...activeDropFolder.value } : null

          isRemoteDragActive.value = false
          isLocalDragActive.value = false
          activeDropFolder.value = null

          if (isOverRemote && props.sessionId && payload.paths && payload.paths.length > 0) {
            try {
              const destDir = (targetFolder?.pane === 'remote') ? targetFolder.path : sftpStore.remotePath
              const entries = await invoke<LocalFileEntry[]>('sftp_get_paths_metadata', {
                paths: payload.paths,
              })
              if (entries && entries.length > 0) {
                await handleBatchUpload(entries, destDir)
              }
            } catch (err) {
              console.error('Failed to resolve dropped desktop files:', err)
            }
          } else if (isOverLocal && payload.paths && payload.paths.length > 0) {
            try {
              const destDir = (targetFolder?.pane === 'local') ? targetFolder.path : sftpStore.localPath
              await invoke('sftp_copy_local_paths', {
                paths: payload.paths,
                targetDir: destDir,
              })
              sftpStore.invalidateLocalCache(destDir)
              sftpStore.invalidateLocalCache(sftpStore.localPath)
              await sftpStore.fetchLocalDir(sftpStore.localPath, { force: true })
            } catch (err) {
              console.error('Failed to copy dropped desktop files to local:', err)
            }
          }
        }
      })
      .then((unlisten) => {
        unlistenDragDrop = unlisten
      })
      .catch((err) => {
        console.warn('Failed to register webview drag-drop handler:', err)
      })
  } catch (err) {
    console.warn('Error initiating drag & drop listener:', err)
  }

  queueTimerInterval = setInterval(() => {
    if (sftpStore.activeTransfers.some(isTransferActive)) {
      queueTimerTick.value = Date.now()
    }
  }, 1000)

  updateQueueViewportHeight()
  if (typeof ResizeObserver !== 'undefined' && queueScrollContainerRef.value) {
    queueResizeObserver = new ResizeObserver(() => {
      updateQueueViewportHeight()
    })
    queueResizeObserver.observe(queueScrollContainerRef.value)
  }
})

let queueResizeObserver: ResizeObserver | null = null

onUnmounted(() => {
  window.removeEventListener('click', closeContextMenu)
  window.removeEventListener('keydown', handleGlobalKeyDown)
  window.removeEventListener('online', handleNetworkOnline)
  if (heartbeatInterval) clearInterval(heartbeatInterval)
  if (reconnectTimer) clearInterval(reconnectTimer)
  if (queueTimerInterval) clearInterval(queueTimerInterval)
  if (queueResizeObserver) {
    queueResizeObserver.disconnect()
    queueResizeObserver = null
  }
  if (unlistenDragDrop) {
    unlistenDragDrop()
    unlistenDragDrop = null
  }
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
    }
  }
  const x = Math.min(e.clientX, window.innerWidth - 220)
  const y = Math.min(e.clientY, window.innerHeight - 380)
  contextMenu.value = {
    show: true,
    x,
    y,
    pane: 'local',
    targetItem: file || (selectedLocalFiles.value[0] ?? null),
  }
}

const openRemoteContextMenu = (e: MouseEvent, file?: SftpFileEntry) => {
  e.preventDefault()
  if (file) {
    if (!selectedRemotePaths.value.has(file.path)) {
      selectedRemotePaths.value = new Set([file.path])
      lastRemoteClickedIndex.value = filteredRemoteFiles.value.findIndex((f) => f.path === file.path)
    }
  }
  const x = Math.min(e.clientX, window.innerWidth - 220)
  const y = Math.min(e.clientY, window.innerHeight - 380)
  contextMenu.value = {
    show: true,
    x,
    y,
    pane: 'remote',
    targetItem: file || (selectedRemoteFiles.value[0] ?? null),
  }
}

// -------------------------------------------------------------
// Drag & Drop Handling (Left <-> Right & Desktop Drops)
// -------------------------------------------------------------
let inMemoryDragPayload: {
  source: 'local' | 'remote'
  files: (LocalFileEntry | SftpFileEntry)[]
} | null = null

const createDragAvatar = (title: string, count: number, isUpload: boolean) => {
  const el = document.createElement('div')
  el.style.position = 'fixed'
  el.style.left = '-9999px'
  el.style.top = '-9999px'
  el.style.padding = '5px 12px'
  el.style.borderRadius = '8px'
  el.style.backgroundColor = isUpload ? '#0284c7' : '#059669'
  el.style.color = '#ffffff'
  el.style.fontSize = '12px'
  el.style.fontWeight = '600'
  el.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)'
  el.style.border = isUpload ? '1px solid #38bdf8' : '1px solid #34d399'
  el.style.pointerEvents = 'none'
  el.style.zIndex = '99999'
  el.style.display = 'flex'
  el.style.alignItems = 'center'
  el.style.gap = '6px'
  
  const icon = isUpload ? '↑' : '↓'
  el.innerText = count > 1 ? `${icon} ${count} items (${title})` : `${icon} ${title}`
  document.body.appendChild(el)
  setTimeout(() => {
    if (el.parentNode) el.parentNode.removeChild(el)
  }, 1000)
  return el
}

const handleLocalDragStart = (e: DragEvent, file: LocalFileEntry) => {
  if (!selectedLocalPaths.value.has(file.path)) {
    selectedLocalPaths.value = new Set([file.path])
    lastLocalClickedIndex.value = sftpStore.localFiles.findIndex((f) => f.path === file.path)
  }
  const filesToDrag = selectedLocalFiles.value.length > 0 && selectedLocalPaths.value.has(file.path)
    ? [...selectedLocalFiles.value]
    : [file]

  const payload = {
    source: 'local' as const,
    files: filesToDrag,
  }
  activeDragging.value = payload
  inMemoryDragPayload = payload

  if (e.dataTransfer) {
    const jsonStr = JSON.stringify({
      type: 'termsftp-drag',
      source: 'local',
      files: filesToDrag,
    })
    e.dataTransfer.setData('application/json', jsonStr)
    e.dataTransfer.setData('text/plain', jsonStr)
    e.dataTransfer.effectAllowed = 'copy'
    try {
      const avatar = createDragAvatar(file.name, filesToDrag.length, true)
      e.dataTransfer.setDragImage(avatar, 20, 15)
    } catch {}
  }
}

const handleLocalDragEnd = () => {
  isRemoteDragActive.value = false
  remoteDragCounter = 0
  activeDropFolder.value = null
  setTimeout(() => {
    activeDragging.value = null
    inMemoryDragPayload = null
  }, 350)
}

const handleRemoteDragStart = (e: DragEvent, file: SftpFileEntry) => {
  if (!selectedRemotePaths.value.has(file.path)) {
    selectedRemotePaths.value = new Set([file.path])
    lastRemoteClickedIndex.value = sftpStore.remoteFiles.findIndex((f) => f.path === file.path)
  }
  const filesToDrag = selectedRemoteFiles.value.length > 0 && selectedRemotePaths.value.has(file.path)
    ? [...selectedRemoteFiles.value]
    : [file]

  const payload = {
    source: 'remote' as const,
    files: filesToDrag,
  }
  activeDragging.value = payload
  inMemoryDragPayload = payload

  if (e.dataTransfer) {
    const jsonStr = JSON.stringify({
      type: 'termsftp-drag',
      source: 'remote',
      files: filesToDrag,
    })
    e.dataTransfer.setData('application/json', jsonStr)
    e.dataTransfer.setData('text/plain', jsonStr)
    e.dataTransfer.effectAllowed = 'copy'
    try {
      const avatar = createDragAvatar(file.name, filesToDrag.length, false)
      e.dataTransfer.setDragImage(avatar, 20, 15)
    } catch {}
  }
}

const handleRemoteDragEnd = () => {
  isLocalDragActive.value = false
  localDragCounter = 0
  activeDropFolder.value = null
  setTimeout(() => {
    activeDragging.value = null
    inMemoryDragPayload = null
  }, 350)
}

const handleRemoteDragEnter = (e: DragEvent) => {
  e.preventDefault()
  remoteDragCounter++
  const dragPayload = activeDragging.value || inMemoryDragPayload
  const isExternalFile = !!(e.dataTransfer?.types?.includes('Files') && !dragPayload)
  if (dragPayload?.source === 'local' || isExternalFile) {
    isRemoteDragActive.value = true
  }
}

const handleRemoteDragOver = (e: DragEvent) => {
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'copy'
  }
  const dragPayload = activeDragging.value || inMemoryDragPayload
  const isExternalFile = !!(e.dataTransfer?.types?.includes('Files') && !dragPayload)
  if ((dragPayload?.source === 'local' || isExternalFile) && !activeDropFolder.value) {
    isRemoteDragActive.value = true
  }
}

const handleRemoteDragLeave = (e: DragEvent) => {
  const related = e.relatedTarget as Node | null
  if (remotePaneRef.value && related && remotePaneRef.value.contains(related)) {
    return
  }
  remoteDragCounter = 0
  isRemoteDragActive.value = false
}

const handleRemoteDrop = async (e: DragEvent) => {
  e.preventDefault()
  e.stopPropagation()
  remoteDragCounter = 0
  isRemoteDragActive.value = false
  const targetFolder = activeDropFolder.value ? { ...activeDropFolder.value } : null
  activeDropFolder.value = null
  if (!props.sessionId) return

  const destDir = (targetFolder?.pane === 'remote') ? targetFolder.path : sftpStore.remotePath

  // 1. In-memory drag state (100% reliable within webview)
  const dragPayload = activeDragging.value || inMemoryDragPayload
  if (dragPayload?.source === 'local') {
    const files = [...dragPayload.files] as LocalFileEntry[]
    activeDragging.value = null
    inMemoryDragPayload = null
    if (files.length > 0) {
      await handleBatchUpload(files, destDir)
      return
    }
  }

  // 2. dataTransfer application/json or text/plain fallback
  const dataStr = e.dataTransfer?.getData('application/json') || e.dataTransfer?.getData('text/plain')
  if (dataStr) {
    try {
      const data = JSON.parse(dataStr)
      if (data.type === 'termsftp-drag' && data.source === 'local' && Array.isArray(data.files) && data.files.length > 0) {
        await handleBatchUpload(data.files, destDir)
        return
      }
    } catch {
      // not internal drag JSON
    }
  }

  // 3. HTML5 files fallback (e.g. desktop files in WebView2 that have .path property)
  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    const filePaths: string[] = []
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      const f = e.dataTransfer.files[i] as any
      if (f.path) {
        filePaths.push(f.path)
      }
    }
    if (filePaths.length > 0) {
      try {
        const entries = await invoke<LocalFileEntry[]>('sftp_get_paths_metadata', { paths: filePaths })
        if (entries && entries.length > 0) {
          await handleBatchUpload(entries, destDir)
          return
        }
      } catch (err) {
        console.error('Failed to parse dropped HTML5 files:', err)
      }
    }
  }
}

const handleLocalDragEnter = (e: DragEvent) => {
  e.preventDefault()
  localDragCounter++
  const dragPayload = activeDragging.value || inMemoryDragPayload
  const isExternalFile = !!(e.dataTransfer?.types?.includes('Files') && !dragPayload)
  if (dragPayload?.source === 'remote' || isExternalFile) {
    isLocalDragActive.value = true
  }
}

const handleLocalDragOver = (e: DragEvent) => {
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'copy'
  }
  const dragPayload = activeDragging.value || inMemoryDragPayload
  const isExternalFile = !!(e.dataTransfer?.types?.includes('Files') && !dragPayload)
  if ((dragPayload?.source === 'remote' || isExternalFile) && !activeDropFolder.value) {
    isLocalDragActive.value = true
  }
}

const handleLocalDragLeave = (e: DragEvent) => {
  const related = e.relatedTarget as Node | null
  if (localPaneRef.value && related && localPaneRef.value.contains(related)) {
    return
  }
  localDragCounter = 0
  isLocalDragActive.value = false
}

const handleLocalDrop = async (e: DragEvent) => {
  e.preventDefault()
  e.stopPropagation()
  localDragCounter = 0
  isLocalDragActive.value = false
  const targetFolder = activeDropFolder.value ? { ...activeDropFolder.value } : null
  activeDropFolder.value = null

  const destDir = (targetFolder?.pane === 'local') ? targetFolder.path : sftpStore.localPath

  // 1. In-memory drag state (100% reliable within webview)
  const dragPayload = activeDragging.value || inMemoryDragPayload
  if (dragPayload?.source === 'remote') {
    const files = [...dragPayload.files] as SftpFileEntry[]
    activeDragging.value = null
    inMemoryDragPayload = null
    if (files.length > 0 && props.sessionId) {
      await handleBatchDownload(files, destDir)
      return
    }
  }

  // 2. dataTransfer application/json or text/plain fallback
  const dataStr = e.dataTransfer?.getData('application/json') || e.dataTransfer?.getData('text/plain')
  if (dataStr) {
    try {
      const data = JSON.parse(dataStr)
      if (data.type === 'termsftp-drag' && data.source === 'remote' && Array.isArray(data.files) && data.files.length > 0) {
        if (props.sessionId) {
          await handleBatchDownload(data.files, destDir)
        }
        return
      }
    } catch {
      // not internal drag JSON
    }
  }

  // 3. Desktop files fallback
  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    const filePaths: string[] = []
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      const f = e.dataTransfer.files[i] as any
      if (f.path) {
        filePaths.push(f.path)
      }
    }
    if (filePaths.length > 0) {
      try {
        await invoke('sftp_copy_local_paths', {
          paths: filePaths,
          targetDir: destDir,
        })
        await sftpStore.fetchLocalDir(sftpStore.localPath)
      } catch (err) {
        console.error('Failed to copy files locally:', err)
      }
    }
  }
}

// Subfolder Drop Targeting
const handleFolderDragOver = (e: DragEvent, pane: 'local' | 'remote', entry: LocalFileEntry | SftpFileEntry) => {
  if (!entry.is_dir) return
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'copy'
  }
  activeDropFolder.value = { pane, path: entry.path }
  if (pane === 'remote') {
    isRemoteDragActive.value = false
  } else {
    isLocalDragActive.value = false
  }
}

const handleFolderDragLeave = (pane: 'local' | 'remote', entry: LocalFileEntry | SftpFileEntry) => {
  if (activeDropFolder.value?.pane === pane && activeDropFolder.value?.path === entry.path) {
    activeDropFolder.value = null
  }
}

const handleParentFolderDragOver = (e: DragEvent, pane: 'local' | 'remote') => {
  const parentPath = pane === 'local' ? localParentPath.value : remoteParentPath.value
  if (!parentPath) return
  const virtualEntry: LocalFileEntry | SftpFileEntry = {
    name: '..',
    path: parentPath,
    is_dir: true,
    is_symlink: false,
    size: 0,
    modified: 0,
    ...(pane === 'remote' ? { permissions: 0o755 } : {}),
  }
  handleFolderDragOver(e, pane, virtualEntry)
}

const handleParentFolderDragLeave = (pane: 'local' | 'remote') => {
  const parentPath = pane === 'local' ? localParentPath.value : remoteParentPath.value
  if (!parentPath) return
  const virtualEntry: LocalFileEntry | SftpFileEntry = {
    name: '..',
    path: parentPath,
    is_dir: true,
    is_symlink: false,
    size: 0,
    modified: 0,
    ...(pane === 'remote' ? { permissions: 0o755 } : {}),
  }
  handleFolderDragLeave(pane, virtualEntry)
}

const handleParentFolderDrop = async (e: DragEvent, pane: 'local' | 'remote') => {
  const parentPath = pane === 'local' ? localParentPath.value : remoteParentPath.value
  if (!parentPath) return
  const virtualEntry: LocalFileEntry | SftpFileEntry = {
    name: '..',
    path: parentPath,
    is_dir: true,
    is_symlink: false,
    size: 0,
    modified: 0,
    ...(pane === 'remote' ? { permissions: 0o755 } : {}),
  }
  await handleFolderDrop(e, pane, virtualEntry)
}

const handleFolderDrop = async (e: DragEvent, pane: 'local' | 'remote', entry: LocalFileEntry | SftpFileEntry) => {
  if (!entry.is_dir) return
  e.preventDefault()
  e.stopPropagation()
  activeDropFolder.value = null
  remoteDragCounter = 0
  localDragCounter = 0
  isRemoteDragActive.value = false
  isLocalDragActive.value = false

  // 1. In-memory drag state
  const dragPayload = activeDragging.value || inMemoryDragPayload
  if (dragPayload) {
    if (pane === 'remote' && dragPayload.source === 'local' && props.sessionId) {
      const files = [...dragPayload.files] as LocalFileEntry[]
      activeDragging.value = null
      inMemoryDragPayload = null
      await handleBatchUpload(files, entry.path)
      return
    } else if (pane === 'local' && dragPayload.source === 'remote' && props.sessionId) {
      const files = [...dragPayload.files] as SftpFileEntry[]
      activeDragging.value = null
      inMemoryDragPayload = null
      await handleBatchDownload(files, entry.path)
      return
    } else if (pane === 'local' && dragPayload.source === 'local') {
      const files = [...dragPayload.files] as LocalFileEntry[]
      activeDragging.value = null
      inMemoryDragPayload = null
      const paths = files.map((f) => f.path)
      try {
        await invoke('sftp_copy_local_paths', {
          paths,
          targetDir: entry.path,
        })
        await sftpStore.fetchLocalDir(sftpStore.localPath)
      } catch (err) {
        console.error('Failed to copy files locally:', err)
      }
      return
    }
  }

  // 2. dataTransfer fallback
  const dataStr = e.dataTransfer?.getData('application/json') || e.dataTransfer?.getData('text/plain')
  if (dataStr) {
    try {
      const data = JSON.parse(dataStr)
      if (pane === 'remote' && props.sessionId) {
        if (data.type === 'termsftp-drag' && data.source === 'local' && Array.isArray(data.files)) {
          await handleBatchUpload(data.files, entry.path)
          return
        }
      } else if (pane === 'local') {
        if (data.type === 'termsftp-drag' && data.source === 'remote' && Array.isArray(data.files)) {
          if (props.sessionId) {
            await handleBatchDownload(data.files, entry.path)
          }
          return
        } else if (data.type === 'termsftp-drag' && data.source === 'local' && Array.isArray(data.files)) {
          const paths = data.files.map((f: any) => f.path).filter(Boolean)
          if (paths.length > 0) {
            await invoke('sftp_copy_local_paths', {
              paths,
              targetDir: entry.path,
            })
            await sftpStore.fetchLocalDir(sftpStore.localPath)
          }
          return
        }
      }
    } catch {
      // not internal drag JSON
    }
  }

  // 3. Desktop files fallback
  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    const filePaths: string[] = []
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      const f = e.dataTransfer.files[i] as any
      if (f.path) {
        filePaths.push(f.path)
      }
    }
    if (filePaths.length > 0) {
      if (pane === 'local') {
        try {
          await invoke('sftp_copy_local_paths', {
            paths: filePaths,
            targetDir: entry.path,
          })
          await sftpStore.fetchLocalDir(sftpStore.localPath)
          return
        } catch (err) {
          console.error('Failed to copy files to folder:', err)
        }
      } else if (pane === 'remote' && props.sessionId) {
        try {
          const entries = await invoke<LocalFileEntry[]>('sftp_get_paths_metadata', { paths: filePaths })
          if (entries && entries.length > 0) {
            await handleBatchUpload(entries, entry.path)
          }
        } catch (err) {
          console.error('Failed to upload files to folder:', err)
        }
      }
    }
  }
}

// -------------------------------------------------------------
// Batch Transfer Operations
// -------------------------------------------------------------
const handleBatchUpload = async (files?: LocalFileEntry[], destinationDir?: string) => {
  const targetFiles = (Array.isArray(files) && files.length > 0) ? files : selectedLocalFiles.value
  if (!props.sessionId || targetFiles.length === 0) return
  closeContextMenu()
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

// -------------------------------------------------------------
// Batch Delete Operations (Custom Lightbox Confirmation Modal)
// -------------------------------------------------------------
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
  try {
    await invoke('sftp_cancel_transfer', { transferId: activeDeletion.value.id })
    showArchiveToast(`Cancelling deletion of ${activeDeletion.value.title}...`, false, true, 2500)
  } catch (e) {
    console.error('Failed to cancel deletion:', e)
  }
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
    if (pane === 'local') {
      selectedLocalPaths.value.clear()
      await sftpStore.fetchLocalDir(sftpStore.localPath, { force: true }).catch(() => {})
    } else if (pane === 'remote' && targetSessionId) {
      selectedRemotePaths.value.clear()
      await sftpStore.fetchRemoteDir(targetSessionId, sftpStore.remotePath, { force: true }).catch(() => {})
    }
    isDeletingFiles.value = false
    activeDeletion.value = null
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

const submitNewFolder = async () => {
  if (!newFolderName.value.trim()) return
  if (newFolderTarget.value === 'local') {
    await sftpStore.createLocalFolder(newFolderName.value.trim())
  } else if (props.sessionId) {
    await sftpStore.createRemoteFolder(props.sessionId, newFolderName.value.trim())
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

const submitNewFile = async () => {
  if (!newFileName.value.trim()) return
  if (newFileTarget.value === 'local') {
    await sftpStore.createLocalFile(newFileName.value.trim())
  } else if (props.sessionId) {
    await sftpStore.createRemoteFile(props.sessionId, newFileName.value.trim())
  }
  showNewFileModal.value = false
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

const submitRename = async () => {
  if (!renameItem.value || !renameNewName.value.trim() || renameNewName.value.trim() === renameItem.value.name) {
    showRenameModal.value = false
    return
  }
  const oldPath = renameItem.value.path
  const newName = renameNewName.value.trim()
  const isLocal = renameTarget.value === 'local'
  const newPath = getRenamedPath(oldPath, newName, isLocal)

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

const submitExtractToFolder = async () => {
  if (!extractArchiveFile.value) return
  const subfolder = extractSubfolderName.value.trim()
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

const submitCompress = async () => {
  const archiveName = compressArchiveName.value.trim()
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
    class="flex flex-col h-full w-full text-slate-200 overflow-hidden select-none transition-colors duration-150 relative"
    :style="{ backgroundColor: 'var(--color-bg-app)' }"
  >
    <!-- Global Drag/Resize Overlays (Prevents iframes, selections, and sub-elements from eating mousemove/mouseup) -->
    <div
      v-if="isResizingVertical"
      class="fixed inset-0 z-[99999] cursor-row-resize select-none pointer-events-auto"
    />
    <div
      v-if="isResizingHorizontal"
      class="fixed inset-0 z-[99999] cursor-col-resize select-none pointer-events-auto"
    />
    <div
      v-if="isResizingQueueCol"
      class="fixed inset-0 z-[99999] cursor-col-resize select-none pointer-events-auto"
    />
    <!-- Auto-Reconnect / Connection Health Toast Banner -->
    <div
      v-if="isConnectionDropped"
      class="bg-amber-950/95 border-b border-amber-600/50 px-4 py-2 flex items-center justify-between text-xs text-amber-200 animate-in slide-in-from-top duration-200 shadow-2xl z-30 flex-shrink-0"
    >
      <div class="flex items-center space-x-2.5">
        <WifiOff class="w-4 h-4 text-amber-400 animate-pulse flex-shrink-0" />
        <span class="font-semibold text-amber-300">SFTP Connection Dropped</span>
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

    <!-- Archive Operation Floating Notification -->
    <transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="transform -translate-y-4 opacity-0"
      enter-to-class="transform translate-y-0 opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="transform translate-y-0 opacity-100"
      leave-to-class="transform -translate-y-4 opacity-0"
    >
      <div
        v-if="archiveToast"
        class="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center space-x-2.5 px-4 py-2 rounded-full border shadow-2xl text-xs font-medium backdrop-blur-md"
        :class="archiveToast.isError ? 'bg-red-950/90 border-red-500/50 text-red-200' : archiveToast.isLoading ? 'bg-sky-950/90 border-sky-500/50 text-sky-200' : 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200'"
      >
        <RotateCw v-if="archiveToast.isLoading" class="w-3.5 h-3.5 animate-spin text-sky-400" />
        <CheckCircle2 v-else-if="!archiveToast.isError" class="w-3.5 h-3.5 text-emerald-400" />
        <AlertTriangle v-else class="w-3.5 h-3.5 text-red-400" />
        <span class="font-medium">{{ archiveToast.message }}</span>
        <button v-if="!archiveToast.isLoading" @click="archiveToast = null" class="ml-1 opacity-60 hover:opacity-100">
          <X class="w-3 h-3" />
        </button>
      </div>
    </transition>

    <!-- Floating Active Deletion Progress Card with Live Cancel Action -->
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
        class="fixed bottom-6 right-6 z-50 flex items-center space-x-3 px-4 py-2.5 rounded-xl border shadow-2xl backdrop-blur-md bg-stone-900/95 border-rose-500/50 text-stone-200 max-w-md ring-1 ring-rose-500/20"
      >
        <div class="relative shrink-0 flex items-center justify-center w-5 h-5">
          <span class="animate-spin w-4 h-4 border-2 border-rose-400/30 border-t-rose-400 rounded-full" />
        </div>
        <div class="flex flex-col min-w-0 pr-1">
          <div class="flex items-center space-x-1.5 text-xs font-semibold text-rose-300 truncate">
            <span>{{ activeDeletion.isCancelling ? 'Cancelling deletion...' : 'Deleting' }}</span>
            <span class="text-stone-200 font-mono truncate max-w-[200px]">"{{ activeDeletion.title }}"</span>
          </div>
          <span class="text-[10px] text-stone-400 truncate">
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
          class="shrink-0 px-2.5 py-1 rounded-md text-xs font-semibold bg-rose-500/20 hover:bg-rose-500/40 active:bg-rose-500/60 text-rose-200 border border-rose-500/40 hover:border-rose-500 transition disabled:opacity-50 flex items-center space-x-1 cursor-pointer"
          title="Cancel deletion"
        >
          <X class="w-3.5 h-3.5" />
          <span>{{ activeDeletion.isCancelling ? 'Cancelling...' : 'Cancel' }}</span>
        </button>
      </div>
    </transition>

    <!-- Directory Comparison Control & Summary Bar -->
    <div
      v-if="isComparing && props.sessionId"
      class="border-b px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs shadow-md z-20 transition-all duration-150 animate-in slide-in-from-top-2"
      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
    >
      <!-- Left: Title & Controls -->
      <div class="flex items-center space-x-3">
        <div class="flex items-center space-x-1.5 font-semibold" :style="{ color: 'var(--color-accent)' }">
          <GitCompare class="w-4 h-4" />
          <span>Directory Comparison</span>
        </div>

        <div class="h-4 w-px" :style="{ backgroundColor: 'var(--color-border)' }" />

        <!-- Criteria Selector -->
        <div class="flex items-center space-x-1">
          <span class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">Compare by:</span>
          <select
            v-model="compareCriteria"
            class="px-2 py-0.5 rounded border text-[11px] font-medium bg-transparent focus:outline-none cursor-pointer"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
          >
            <option value="size_and_time" class="bg-slate-900 text-slate-200">Size & Modification Time</option>
            <option value="size_only" class="bg-slate-900 text-slate-200">File Size Only</option>
          </select>
        </div>

        <!-- Hide Identical Files Checkbox -->
        <label class="flex items-center space-x-1.5 cursor-pointer text-[11px] select-none text-slate-300 hover:text-white transition">
          <input
            type="checkbox"
            v-model="hideIdenticalFiles"
            class="rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
          />
          <span>Hide identical files</span>
          <span v-if="comparisonResult?.stats.identical" class="text-[10px] text-zinc-500 font-mono">
            ({{ comparisonResult.stats.identical }} hidden)
          </span>
        </label>
      </div>

      <!-- Center: Stats / Diffs Pill Counters -->
      <div v-if="comparisonResult" class="flex items-center space-x-1.5 flex-wrap">
        <template v-if="comparisonResult.stats.totalDiffs === 0">
          <span class="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center space-x-1">
            <span>✓ Both directories are in sync</span>
          </span>
        </template>
        <template v-else>
          <span
            v-if="comparisonResult.stats.localOnly > 0"
            class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
          >
            +{{ comparisonResult.stats.localOnly }} Local only
          </span>
          <span
            v-if="comparisonResult.stats.remoteOnly > 0"
            class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/15 text-blue-300 border border-blue-500/30"
          >
            +{{ comparisonResult.stats.remoteOnly }} Remote only
          </span>
          <span
            v-if="comparisonResult.stats.localNewer > 0"
            class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30"
          >
            ▲ {{ comparisonResult.stats.localNewer }} Local newer
          </span>
          <span
            v-if="comparisonResult.stats.remoteNewer > 0"
            class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/15 text-purple-300 border border-purple-500/30"
          >
            ▲ {{ comparisonResult.stats.remoteNewer }} Remote newer
          </span>
          <span
            v-if="comparisonResult.stats.sizeDifferent > 0"
            class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-500/15 text-rose-300 border border-rose-500/30"
          >
            ≠ {{ comparisonResult.stats.sizeDifferent }} Size diff
          </span>
        </template>
      </div>

      <!-- Right: Sync Buttons & Exit -->
      <div class="flex items-center space-x-2">
        <template v-if="comparisonResult && comparisonResult.stats.totalDiffs > 0">
          <button
            v-if="comparisonResult.stats.localOnly > 0 || comparisonResult.stats.localNewer > 0 || comparisonResult.stats.sizeDifferent > 0"
            @click="syncLocalToRemote()"
            class="px-2.5 py-1 rounded text-xs font-semibold flex items-center space-x-1.5 transition shadow-sm btn-accent cursor-pointer"
            title="Upload all local-only, newer, and size-differing files to remote"
          >
            <span>↑ Sync to Remote</span>
          </button>
          <button
            v-if="comparisonResult.stats.remoteOnly > 0 || comparisonResult.stats.remoteNewer > 0 || comparisonResult.stats.sizeDifferent > 0"
            @click="syncRemoteToLocal()"
            class="px-2.5 py-1 rounded text-xs font-semibold flex items-center space-x-1.5 transition shadow-sm btn-accent-secondary cursor-pointer"
            title="Download all remote-only, newer, and size-differing files to local"
          >
            <span>↓ Sync to Local</span>
          </button>
        </template>

        <button
          @click="toggleComparison"
          class="p-1 rounded text-xs opacity-70 hover:opacity-100 transition hover:bg-white/10 cursor-pointer"
          :style="{ color: 'var(--color-text-muted)' }"
          title="Exit Directory Comparison (Esc)"
        >
          <X class="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- Top Panes Layout (Left & Right Resizable Panes) -->
    <div
      ref="splitContainerRef"
      class="flex-1 flex flex-row overflow-hidden relative"
    >
      <!-- LEFT PANE: Local File System -->
      <div
        ref="localPaneRef"
        class="flex flex-col h-full overflow-hidden relative transition-colors duration-150 shrink-0 min-w-0"
        :style="{
          width: `${leftPanePercent}%`,
          backgroundColor: 'var(--color-bg-pane)'
        }"
        @click="activePane = 'local'"
        @dragover="handleLocalDragOver"
        @dragenter="handleLocalDragEnter"
        @dragleave="handleLocalDragLeave"
        @drop="handleLocalDrop"
        @contextmenu.self="openLocalContextMenu($event)"
      >
        <!-- Local Header Toolbar -->
        <div
          class="flex items-center justify-between px-3 h-9 border-b transition-colors duration-150 shrink-0"
          :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)' }"
        >
          <div class="flex items-center space-x-2">
            <span
              class="w-1.5 h-1.5 rounded-full transition-all duration-150"
              :class="activePane === 'local' ? 'opacity-100 scale-100 ring-2 ring-emerald-500/30' : 'opacity-0 scale-50'"
              :style="{ backgroundColor: 'var(--color-accent)' }"
              title="Active navigation pane"
            />
            <span class="text-xs font-semibold" :style="{ color: 'var(--color-accent)' }">Local Files</span>
            <span class="text-[11px] font-mono" :style="{ color: 'var(--color-text-muted)' }">
              ({{ selectedLocalPaths.size > 0 ? `${selectedLocalPaths.size} of ` : '' }}{{ localSearchQuery || (isComparing && hideIdenticalFiles) ? `${filteredLocalFiles.length} of ${sftpStore.localFiles.length}` : `${filteredLocalFiles.length}` }} items)
            </span>
          </div>

          <div class="flex items-center space-x-1.5">
            <!-- Batch Actions for Local Selection -->
            <template v-if="selectedLocalFiles.length > 0">
              <button
                v-if="props.sessionId"
                @click="handleBatchUpload(selectedLocalFiles)"
                :title="`Upload ${selectedLocalFiles.length} selected item(s) to remote`"
                class="h-6 px-1.5 rounded text-xs transition flex items-center justify-center bg-sky-500/15 hover:bg-sky-500/30 text-sky-400 border border-sky-500/30 shadow-sm"
              >
                <CatppuccinIcon name="upload" :size="15" />
              </button>
              <button
                @click="handleBatchDeleteLocal(selectedLocalFiles)"
                :title="`Delete ${selectedLocalFiles.length} selected item(s)`"
                class="h-6 px-1.5 rounded text-red-400 hover:bg-red-950/60 text-xs transition flex items-center justify-center border border-transparent hover:border-red-500/30"
              >
                <CatppuccinIcon name="delete" :size="15" />
              </button>
              <div class="h-3.5 w-px mx-0.5" :style="{ backgroundColor: 'var(--color-border)' }" />
            </template>

            <!-- Toggle Directory Comparison -->
            <button
              v-if="props.sessionId"
              @click="toggleComparison"
              :title="isComparing ? 'Exit Directory Comparison (Ctrl+Shift+C)' : 'Compare with Remote Directory (Ctrl+Shift+C)'"
              class="p-1 rounded text-xs transition hover:opacity-80"
              :class="isComparing ? 'text-indigo-400 bg-indigo-500/10' : ''"
              :style="{ color: isComparing ? 'var(--color-accent)' : 'var(--color-text-muted)' }"
            >
              <GitCompare class="w-4 h-4" />
            </button>

            <!-- Toggle Synchronized Browsing -->
            <button
              v-if="props.sessionId"
              @click="sftpStore.toggleSynchronizedBrowsing()"
              :title="sftpStore.isSynchronizedBrowsing ? 'Synchronized Browsing is ON (Lockstep Navigation)' : 'Turn ON Synchronized Browsing (Lockstep Navigation)'"
              class="p-1 rounded text-xs transition hover:opacity-80 relative"
              :class="sftpStore.isSynchronizedBrowsing ? 'text-sky-400 bg-sky-500/15 ring-1 ring-sky-400/40' : ''"
              :style="{ color: sftpStore.isSynchronizedBrowsing ? 'var(--color-accent)' : 'var(--color-text-muted)' }"
            >
              <FolderSync class="w-4 h-4" />
              <span v-if="sftpStore.isSynchronizedBrowsing" class="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
            </button>

            <!-- Toggle In-Pane Search Filter (Ctrl+F) -->
            <button
              @click="toggleFilter('local')"
              :title="showLocalFilter ? 'Close Filter (Ctrl+F)' : 'Filter files (Ctrl+F)'"
              class="p-1 rounded text-xs transition hover:opacity-80"
              :class="showLocalFilter || localSearchQuery ? 'text-emerald-400' : ''"
              :style="{ color: showLocalFilter || localSearchQuery ? 'var(--color-accent)' : 'var(--color-text-muted)' }"
            >
              <Search class="w-4 h-4" />
            </button>

            <button
              @click="navigateLocalUp"
              :disabled="!canNavigateLocalUp"
              :class="{ 'opacity-30 cursor-not-allowed': !canNavigateLocalUp }"
              title="Go to parent directory"
              class="p-1 rounded text-xs transition hover:opacity-80"
              :style="{ color: 'var(--color-text-muted)' }"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            </button>
            <button
              @click="sftpStore.fetchLocalDir(sftpStore.localPath, { force: true })"
              title="Refresh"
              class="p-1 rounded text-xs transition hover:opacity-80 flex items-center justify-center"
              :style="{ color: 'var(--color-text-muted)' }"
            >
              <CatppuccinIcon
                name="refresh"
                :size="15"
                :class="{ 'animate-spin': sftpStore.isBackgroundRefreshingLocal || sftpStore.isLoadingLocal }"
              />
            </button>

            <!-- Toggle Hidden Files -->
            <button
              @click="showHiddenFiles = !showHiddenFiles"
              :title="showHiddenFiles ? 'Hide dotfiles' : 'Show hidden dotfiles (.env, .git, etc.)'"
              class="p-1 rounded text-xs transition hover:opacity-80"
              :class="showHiddenFiles ? 'text-indigo-400' : ''"
              :style="{ color: showHiddenFiles ? 'var(--color-accent)' : 'var(--color-text-muted)' }"
            >
              <Eye v-if="showHiddenFiles" class="w-4 h-4" />
              <EyeOff v-else class="w-4 h-4" />
            </button>

            <button
              @click="openNewFile('local')"
              title="New File"
              class="p-1 rounded text-xs transition hover:opacity-80"
              :style="{ color: 'var(--color-text-muted)' }"
            >
              <CatppuccinIcon name="file" :size="15" />
            </button>
            <button
              @click="openNewFolder('local')"
              title="New Directory"
              class="p-1 rounded text-xs transition hover:opacity-80"
              :style="{ color: 'var(--color-text-muted)' }"
            >
              <CatppuccinIcon name="folder" :size="15" />
            </button>

            <div class="h-3.5 w-px mx-0.5" :style="{ backgroundColor: 'var(--color-border)' }" />

            <!-- Settings button -->
            <button
              @click="showSettingsModal = true"
              title="Settings (Transfers, Master Password, Protocols)"
              class="p-1 rounded text-xs transition hover:opacity-80"
              :style="{ color: 'var(--color-text-muted)' }"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            <!-- WSL Shortcut Menu -->
            <div class="relative">
              <button
                @click="toggleWslMenu"
                title="Browse WSL Linux distributions"
                class="px-2 py-0.5 rounded border text-xs font-medium flex items-center space-x-1 transition btn-theme-card"
              >
                <span>🐧</span>
                <span>WSL</span>
                <span class="text-[9px]" :style="{ color: 'var(--color-text-muted)' }">▼</span>
              </button>

              <div
                v-if="showWslMenu"
                class="absolute right-0 mt-1.5 z-50 w-56 backdrop-blur-md rounded-xl border shadow-2xl p-1 text-xs select-none animate-in fade-in zoom-in-95 duration-75"
                :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
                @click.stop
              >
                <div
                  class="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider border-b mb-1"
                  :style="{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
                >
                  WSL Distributions
                </div>

                <div v-if="isLoadingWsl" class="px-3 py-2 text-xs flex items-center space-x-2" :style="{ color: 'var(--color-text-muted)' }">
                  <span class="animate-spin w-3 h-3 border rounded-full" :style="{ borderColor: 'var(--color-border)', borderTopColor: 'var(--color-accent)' }" />
                  <span>Scanning distros...</span>
                </div>

                <div v-else-if="wslDistros.length === 0" class="px-3 py-2 text-xs space-y-1" :style="{ color: 'var(--color-text-muted)' }">
                  <div>No WSL distros detected.</div>
                  <button
                    @click="navigateToWslDistro('Ubuntu-24.04')"
                    class="hover:underline text-[11px] block"
                    :style="{ color: 'var(--color-accent)' }"
                  >
                    Open //wsl.localhost/Ubuntu-24.04
                  </button>
                </div>

                <template v-else>
                  <button
                    v-for="distro in wslDistros"
                    :key="distro"
                    @click="navigateToWslDistro(distro)"
                    class="w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left hover:opacity-90"
                    :style="{ color: 'var(--color-text-main)' }"
                  >
                    <span>🐧</span>
                    <div class="flex-1 min-w-0">
                      <div class="font-medium truncate">{{ distro }}</div>
                      <div class="text-[10px] font-mono truncate" :style="{ color: 'var(--color-text-muted)' }">//wsl.localhost/{{ distro }}</div>
                    </div>
                  </button>
                </template>
              </div>
            </div>
          </div>
        </div>

        <!-- Local Path Address Bar (Location) -->
        <div
          class="px-3 py-1.5 border-b flex items-center space-x-2 transition-colors duration-150"
          :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
        >
          <div
            class="flex-1 flex items-center space-x-2 px-2.5 py-1 rounded-lg border transition-colors duration-150"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
          >
            <CatppuccinIcon name="laptop" :size="15" class="shrink-0 select-none" />
            <input
              v-model="localInputPath"
              @keyup.enter="sftpStore.fetchLocalDir(localInputPath)"
              placeholder="C:/Users/..."
              class="flex-1 bg-transparent text-xs font-mono focus:outline-none truncate"
              :style="{ color: 'var(--color-text-main)' }"
            />

            <!-- Local Git Branch Badge -->
            <div
              v-if="sftpStore.localGitStatus?.is_repo && sftpStore.localGitStatus.branch"
              class="flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono border flex-shrink-0"
              :style="{
                backgroundColor: 'rgba(245, 158, 11, 0.12)',
                color: '#fbbf24',
                borderColor: 'rgba(245, 158, 11, 0.35)'
              }"
              :title="`Git Branch: ${sftpStore.localGitStatus.branch}`"
            >
              <GitBranch class="w-3 h-3 text-amber-400" />
              <span class="font-semibold">{{ sftpStore.localGitStatus.branch }}</span>
            </div>

            <button
              @click="sftpStore.fetchLocalDir(localInputPath)"
              class="p-0.5 rounded text-xs font-semibold transition hover:opacity-100 opacity-60"
              :style="{ color: 'var(--color-accent)' }"
              title="Navigate to path (Enter)"
            >
              ↵
            </button>
          </div>

          <!-- Local Bookmark Toggle & Dropdown -->
          <div class="relative flex items-center space-x-1">
            <button
              @click="toggleLocalBookmark()"
              :title="isLocalBookmarked ? 'Remove Bookmark' : 'Bookmark this folder'"
              class="p-1.5 rounded-lg border text-xs transition btn-theme-card flex items-center justify-center"
              :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
            >
              <CatppuccinIcon
                :name="isLocalBookmarked ? 'bookmark-filled' : 'bookmark'"
                :size="14"
              />
            </button>
            <button
              @click.stop="showLocalBookmarksMenu = !showLocalBookmarksMenu; showRemoteBookmarksMenu = false"
              title="Saved Local Bookmarks"
              class="p-1.5 rounded-lg border text-xs transition btn-theme-card"
              :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
            >
              <ChevronDown class="w-3.5 h-3.5 text-slate-400" />
            </button>

            <!-- Bookmarks Dropdown Menu -->
            <div
              v-if="showLocalBookmarksMenu"
              class="absolute right-0 top-full mt-1.5 z-50 w-64 backdrop-blur-md rounded-xl border shadow-2xl p-1.5 text-xs select-none animate-in fade-in zoom-in-95 duration-100"
              :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
              @click.stop
            >
              <div
                class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider border-b mb-1 flex items-center justify-between"
                :style="{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
              >
                <span>Local Bookmarks</span>
                <span class="text-[10px] lowercase opacity-70">{{ localBookmarks.length }} saved</span>
              </div>
              <div v-if="localBookmarks.length === 0" class="px-3 py-2 text-xs italic" :style="{ color: 'var(--color-text-muted)' }">
                No bookmarks yet. Click bookmark icon to save current folder.
              </div>
              <div v-else class="max-h-48 overflow-y-auto space-y-0.5">
                <div
                  v-for="b in localBookmarks"
                  :key="b"
                  class="flex items-center justify-between px-2 py-1.5 rounded-lg group hover:bg-slate-700/40 transition cursor-pointer"
                  @click="sftpStore.fetchLocalDir(b); showLocalBookmarksMenu = false"
                >
                  <div class="flex items-center space-x-2 min-w-0 mr-1">
                    <Folder class="w-3.5 h-3.5 shrink-0 text-amber-400" />
                    <span class="font-mono text-[11px] truncate" :style="{ color: 'var(--color-text-main)' }">{{ b }}</span>
                  </div>
                  <button
                    @click.stop="toggleLocalBookmark(b)"
                    title="Remove"
                    class="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 text-slate-400 transition"
                  >
                    <X class="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Local In-Pane Live Filter Bar (Ctrl+F) -->
        <div
          v-if="showLocalFilter"
          class="px-3 py-1.5 border-b flex items-center space-x-2 transition-all duration-150 animate-in fade-in slide-in-from-top-1"
          :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
        >
          <div
            class="flex-1 flex items-center space-x-2 px-2.5 py-1 rounded-lg border transition-colors duration-150"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
          >
            <Search class="w-3.5 h-3.5 shrink-0 select-none opacity-60" :style="{ color: 'var(--color-accent)' }" />
            <input
              ref="localFilterInputRef"
              v-model="localSearchQuery"
              @keydown.esc.stop="handleFilterEsc('local')"
              @keydown.down.prevent="focusFirstItem('local')"
              @keydown.enter.prevent="focusFirstItem('local')"
              placeholder="Filter files by name... (Esc to clear, ↓ to select)"
              class="flex-1 bg-transparent text-xs font-mono focus:outline-none truncate"
              :style="{ color: 'var(--color-text-main)' }"
            />
            <button
              v-if="localSearchQuery"
              @click="localSearchQuery = ''; localFilterInputRef?.focus()"
              class="p-0.5 rounded text-xs opacity-60 hover:opacity-100 transition"
              :style="{ color: 'var(--color-text-muted)' }"
              title="Clear filter"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>
          <div class="flex items-center space-x-1.5 shrink-0">
            <span
              v-if="localSearchQuery"
              class="text-[10px] font-mono px-1.5 py-0.5 rounded border"
              :style="{
                backgroundColor: filteredLocalFiles.length > 0 ? 'var(--color-bg-pane)' : 'rgba(239, 68, 68, 0.1)',
                borderColor: filteredLocalFiles.length > 0 ? 'var(--color-border)' : 'rgba(239, 68, 68, 0.3)',
                color: filteredLocalFiles.length > 0 ? 'var(--color-text-muted)' : '#f87171'
              }"
            >
              {{ filteredLocalFiles.length }} found
            </span>
            <button
              @click="showLocalFilter = false; localSearchQuery = ''"
              class="p-1 rounded text-xs opacity-60 hover:opacity-100 transition hover:bg-white/5"
              :style="{ color: 'var(--color-text-muted)' }"
              title="Close filter (Esc)"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <!-- Local File List Table -->
        <div
          class="flex-1 overflow-auto"
          @dragover="handleLocalDragOver"
          @drop="handleLocalDrop"
          @contextmenu.self="openLocalContextMenu($event)"
        >
          <div v-if="sftpStore.isLoadingLocal" class="flex items-center justify-center p-8 text-xs" :style="{ color: 'var(--color-text-muted)' }">
            <span class="animate-spin w-4 h-4 border-2 border-slate-600 rounded-full mr-2" :style="{ borderTopColor: 'var(--color-accent)' }" />
            Reading local directory...
          </div>
          <div v-else-if="sftpStore.localError" class="flex flex-col items-center justify-center p-8 text-center">
            <div class="w-10 h-10 rounded-xl bg-red-950/60 border border-red-800/60 flex items-center justify-center text-red-400 mb-2">
              ⚠️
            </div>
            <p class="text-xs font-semibold text-red-300 mb-1">Failed to read local directory</p>
            <p class="text-[11px] text-red-400/80 max-w-sm mb-4 font-mono break-all">{{ sftpStore.localError }}</p>
            <button
              @click="sftpStore.fetchLocalDir(sftpStore.localPath, { force: true })"
              class="px-3 py-1.5 rounded-lg border text-xs font-medium transition"
              :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
            >
              🔄 Retry
            </button>
          </div>
          <table
            v-else
            class="min-w-[620px] w-full text-left border-collapse select-none"
            @dragover="handleLocalDragOver"
            @drop="handleLocalDrop"
            :style="{
              fontFamily: settingsStore.browserFontFamily,
              fontSize: `${settingsStore.browserFontSize}px`,
            }"
          >
            <thead
              class="sticky top-0 backdrop-blur-sm border-b text-[0.88em] z-10 shadow-sm transition-colors duration-150"
              :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
            >
              <tr>
                <th
                  :class="[rowPaddingClass, 'font-medium min-w-[220px] cursor-pointer select-none hover:text-[var(--color-text-main)] transition-colors']"
                  :style="localSortBy === 'name' ? { color: 'var(--color-accent)' } : undefined"
                  @click="handleLocalSort('name')"
                  :title="localSortBy === 'name' ? (localSortOrder === 'asc' ? 'Sorted by Name (Ascending) - Click to sort Descending' : 'Sorted by Name (Descending) - Click to sort Ascending') : 'Sort by Name'"
                >
                  <div class="flex items-center gap-1.5">
                    <span :class="{ 'font-semibold': localSortBy === 'name' }">Name</span>
                    <ArrowUp v-if="localSortBy === 'name' && localSortOrder === 'asc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent)' }" />
                    <ArrowDown v-else-if="localSortBy === 'name' && localSortOrder === 'desc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent)' }" />
                  </div>
                </th>
                <th
                  :class="[cellPaddingClass, 'w-28 min-w-[90px] font-medium whitespace-nowrap cursor-pointer select-none hover:text-[var(--color-text-main)] transition-colors']"
                  :style="localSortBy === 'type' ? { color: 'var(--color-accent)' } : undefined"
                  @click="handleLocalSort('type')"
                  :title="localSortBy === 'type' ? (localSortOrder === 'asc' ? 'Sorted by Type (Ascending) - Click to sort Descending' : 'Sorted by Type (Descending) - Click to sort Ascending') : 'Sort by Type'"
                >
                  <div class="flex items-center gap-1.5">
                    <span :class="{ 'font-semibold': localSortBy === 'type' }">Type</span>
                    <ArrowUp v-if="localSortBy === 'type' && localSortOrder === 'asc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent)' }" />
                    <ArrowDown v-else-if="localSortBy === 'type' && localSortOrder === 'desc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent)' }" />
                  </div>
                </th>
                <th
                  :class="[cellPaddingClass, 'w-24 min-w-[85px] font-medium text-right whitespace-nowrap cursor-pointer select-none hover:text-[var(--color-text-main)] transition-colors']"
                  :style="localSortBy === 'size' ? { color: 'var(--color-accent)' } : undefined"
                  @click="handleLocalSort('size')"
                  :title="localSortBy === 'size' ? (localSortOrder === 'asc' ? 'Sorted by Size (Ascending) - Click to sort Descending' : 'Sorted by Size (Descending) - Click to sort Ascending') : 'Sort by Size'"
                >
                  <div class="flex items-center justify-end gap-1.5">
                    <ArrowUp v-if="localSortBy === 'size' && localSortOrder === 'asc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent)' }" />
                    <ArrowDown v-else-if="localSortBy === 'size' && localSortOrder === 'desc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent)' }" />
                    <span :class="{ 'font-semibold': localSortBy === 'size' }">Size</span>
                  </div>
                </th>
                <th
                  :class="[cellPaddingClass, 'w-36 min-w-[130px] font-medium whitespace-nowrap cursor-pointer select-none hover:text-[var(--color-text-main)] transition-colors']"
                  :style="localSortBy === 'modified' ? { color: 'var(--color-accent)' } : undefined"
                  @click="handleLocalSort('modified')"
                  :title="localSortBy === 'modified' ? (localSortOrder === 'asc' ? 'Sorted by Modified (Ascending) - Click to sort Descending' : 'Sorted by Modified (Descending) - Click to sort Ascending') : 'Sort by Modified'"
                >
                  <div class="flex items-center gap-1.5">
                    <span :class="{ 'font-semibold': localSortBy === 'modified' }">Modified</span>
                    <ArrowUp v-if="localSortBy === 'modified' && localSortOrder === 'asc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent)' }" />
                    <ArrowDown v-else-if="localSortBy === 'modified' && localSortOrder === 'desc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent)' }" />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              <!-- FileZilla-style Parent Directory Entry (📁 ..) -->
              <tr
                v-if="canNavigateLocalUp"
                id="local-row-parent"
                @dblclick="navigateLocalUp"
                @click="handleLocalParentClick"
                @contextmenu.prevent.stop="closeContextMenu"
                @dragover="handleParentFolderDragOver($event, 'local')"
                @dragleave="handleParentFolderDragLeave('local')"
                @drop="handleParentFolderDrop($event, 'local')"
                class="group cursor-pointer select-none file-row"
                :style="activeDropFolder?.pane === 'local' && activeDropFolder?.path === localParentPath
                  ? { backgroundColor: 'var(--color-bg-hover)', borderLeft: '3px solid var(--color-accent)', color: 'var(--color-text-main)' }
                  : isLocalParentSelected
                  ? { backgroundColor: 'var(--color-bg-hover)', borderLeft: '3px solid var(--color-accent)', color: 'var(--color-text-main)' }
                  : { borderLeft: '3px solid transparent', color: 'var(--color-text-main)' }"
                title="Double-click or press Enter to go to parent directory"
              >
                <td :class="[rowPaddingClass, 'whitespace-nowrap']">
                  <div class="flex items-center space-x-1.5 leading-none">
                    <FileIcon name=".." :is-dir="true" :is-open="activeDropFolder?.pane === 'local' && activeDropFolder?.path === localParentPath" :size="15" />
                    <span class="font-bold text-sm tracking-wide leading-tight" :style="{ color: 'var(--color-text-main)' }">..</span>
                  </div>
                </td>
                <td :class="[cellPaddingClass, 'text-[0.92em] whitespace-nowrap']" :style="{ color: 'var(--color-text-muted)' }">
                  Folder
                </td>
                <td :class="[cellPaddingClass, 'text-right font-mono text-[0.92em] whitespace-nowrap']" :style="{ color: 'var(--color-text-muted)' }">
                  -
                </td>
                <td :class="[cellPaddingClass, 'text-[0.92em] whitespace-nowrap']" :style="{ color: 'var(--color-text-muted)' }">
                  -
                </td>
              </tr>

              <tr v-if="filteredLocalFiles.length === 0" @dragover="handleLocalDragOver" @drop="handleLocalDrop">
                <td colspan="4" class="py-8 text-center italic" :style="{ color: 'var(--color-text-muted)' }">
                  <template v-if="localSearchQuery">
                    No files matching "<span class="font-semibold text-amber-300 font-mono">{{ localSearchQuery }}</span>"
                    <button @click="localSearchQuery = ''" class="ml-2 underline text-xs not-italic cursor-pointer hover:opacity-80" :style="{ color: 'var(--color-accent)' }">
                      Clear filter
                    </button>
                  </template>
                  <template v-else-if="isComparing && hideIdenticalFiles">
                    All {{ sftpStore.localFiles.length }} files match remote (identical files are hidden)
                    <button @click="hideIdenticalFiles = false" class="ml-2 underline text-xs not-italic cursor-pointer hover:opacity-80" :style="{ color: 'var(--color-accent)' }">
                      Show all files
                    </button>
                  </template>
                  <template v-else>
                    Folder is empty
                  </template>
                </td>
              </tr>
              <tr
                v-for="(file, index) in filteredLocalFiles"
                :key="file.path"
                :id="`local-row-${index}`"
                draggable="true"
                @dragstart="handleLocalDragStart($event, file)"
                @dragend="handleLocalDragEnd"
                @click="handleLocalRowClick($event, file, index)"
                @contextmenu="openLocalContextMenu($event, file)"
                @dblclick="handleLocalRowDoubleClick(file)"
                @dragover="file.is_dir ? handleFolderDragOver($event, 'local', file) : handleLocalDragOver($event)"
                @dragleave="file.is_dir ? handleFolderDragLeave('local', file) : undefined"
                @drop="file.is_dir ? handleFolderDrop($event, 'local', file) : handleLocalDrop($event)"
                class="group cursor-pointer select-none file-row"
                :style="getRowStyle(true, file.path, file)"
              >
                <td :class="[rowPaddingClass, 'whitespace-nowrap']" :title="file.name">
                  <div class="flex items-center space-x-1.5 leading-none">
                    <FileIcon :name="file.name" :is-dir="file.is_dir" :is-open="activeDropFolder?.path === file.path" :size="15" />
                    <span v-if="localSearchQuery && highlightMatch(file.name, localSearchQuery)" class="font-normal truncate leading-tight" :style="{ color: 'var(--color-text-main)' }">
                      <span>{{ highlightMatch(file.name, localSearchQuery)!.before }}</span>
                      <span class="bg-amber-400/30 text-amber-300 font-semibold rounded px-0.5">{{ highlightMatch(file.name, localSearchQuery)!.match }}</span>
                      <span>{{ highlightMatch(file.name, localSearchQuery)!.after }}</span>
                    </span>
                    <span v-else class="font-normal truncate leading-tight" :style="{ color: 'var(--color-text-main)' }">{{ file.name }}</span>

                    <!-- Comparison Status Badge -->
                    <template v-if="isComparing && comparisonResult?.localMap.get(file.name)">
                      <span
                        v-if="comparisonResult.localMap.get(file.name)!.status === 'local_only'"
                        class="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex-shrink-0"
                        title="Only exists on local"
                      >
                        + Local Only
                      </span>
                      <span
                        v-else-if="comparisonResult.localMap.get(file.name)!.status === 'local_newer'"
                        class="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex-shrink-0"
                        title="Local file is newer than remote"
                      >
                        ▲ Newer
                      </span>
                      <span
                        v-else-if="comparisonResult.localMap.get(file.name)!.status === 'remote_newer'"
                        class="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-zinc-600/30 text-zinc-400 border border-zinc-600/40 flex-shrink-0"
                        title="Remote file is newer than local"
                      >
                        ▼ Older
                      </span>
                      <span
                        v-else-if="comparisonResult.localMap.get(file.name)!.status === 'size_different'"
                        class="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/40 flex-shrink-0"
                        :title="`File size differs: Local is ${formatBytes(file.size)}, Remote is ${formatBytes(comparisonResult.localMap.get(file.name)!.counterpartSize || 0)}`"
                      >
                        ≠ Size Diff
                      </span>
                    </template>

                    <!-- Git Status Overlay Badge -->
                    <span
                      v-if="getGitStatus(true, file)"
                      class="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold flex-shrink-0"
                      :class="{
                        'text-amber-400 bg-amber-950/60 border border-amber-800/60': getGitStatus(true, file) === 'modified',
                        'text-emerald-400 bg-emerald-950/60 border border-emerald-800/60': getGitStatus(true, file) === 'untracked',
                        'text-cyan-400 bg-cyan-950/60 border border-cyan-800/60': getGitStatus(true, file) === 'staged',
                        'text-red-400 bg-red-950/60 border border-red-800/60': getGitStatus(true, file) === 'deleted',
                        'text-purple-400 bg-purple-950/60 border border-purple-800/60': getGitStatus(true, file) === 'renamed',
                        'text-amber-300/80 bg-amber-950/30 border border-amber-900/40': getGitStatus(true, file) === 'has-changes',
                      }"
                      :title="`Git: ${getGitStatus(true, file)}`"
                    >
                      {{ getGitStatus(true, file) === 'modified' ? 'M' : getGitStatus(true, file) === 'untracked' ? 'U' : getGitStatus(true, file) === 'staged' ? 'S' : getGitStatus(true, file) === 'deleted' ? 'D' : getGitStatus(true, file) === 'renamed' ? 'R' : '●' }}
                    </span>
                  </div>
                </td>
                <td :class="[cellPaddingClass, 'text-[0.92em] whitespace-nowrap']" :style="{ color: 'var(--color-text-muted)' }">
                  {{ getFileType(file) }}
                </td>
                <td :class="[cellPaddingClass, 'text-right font-mono text-[0.92em] whitespace-nowrap']" :style="{ color: 'var(--color-text-muted)' }">
                  {{ file.is_dir ? '-' : formatBytes(file.size) }}
                </td>
                <td :class="[cellPaddingClass, 'text-[0.92em] whitespace-nowrap']" :style="{ color: 'var(--color-text-muted)' }">
                  {{ formatDate(file.modified) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Vertical Splitter Handle (Horizontal Resize between Local & Remote) -->
      <div
        @mousedown.prevent="startHorizontalResize"
        class="w-1.5 z-30 cursor-col-resize flex items-center justify-center transition-all group flex-shrink-0 relative select-none"
        :class="{ 'bg-sky-500/50': isResizingHorizontal }"
        :style="{ backgroundColor: isResizingHorizontal ? 'var(--color-accent)' : 'var(--color-border)' }"
        title="Drag to resize panes (double-click to reset 50/50)"
        @dblclick="resetHorizontalSplit"
      >
        <div
          class="w-0.5 h-8 rounded-full transition-colors"
          :class="isResizingHorizontal ? 'bg-white' : 'bg-zinc-400 group-hover:bg-white'"
        />
      </div>

      <!-- RIGHT PANE: Remote SFTP File System -->
      <div
        ref="remotePaneRef"
        class="flex flex-col h-full overflow-hidden relative transition-colors duration-150 flex-1 min-w-0"
        :style="{
          width: `${100 - leftPanePercent}%`,
          backgroundColor: 'var(--color-bg-pane)'
        }"
        @click="activePane = 'remote'"
        @dragover="handleRemoteDragOver"
        @dragenter="handleRemoteDragEnter"
        @dragleave="handleRemoteDragLeave"
        @drop="handleRemoteDrop"
        @contextmenu.self="openRemoteContextMenu($event)"
      >
        <!-- Remote Header Toolbar -->
        <div
          class="flex items-center justify-between px-3 h-9 border-b transition-colors duration-150 shrink-0"
          :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)' }"
        >
          <div class="flex items-center space-x-2">
            <span
              class="w-1.5 h-1.5 rounded-full transition-all duration-150"
              :class="activePane === 'remote' ? 'opacity-100 scale-100 ring-2 ring-blue-500/30' : 'opacity-0 scale-50'"
              :style="{ backgroundColor: 'var(--color-accent-secondary)' }"
              title="Active navigation pane"
            />
            <span class="text-xs font-semibold" :style="{ color: 'var(--color-accent-secondary)' }">Remote SFTP</span>
            <span v-if="props.sessionId" class="text-[11px] font-mono" :style="{ color: 'var(--color-text-muted)' }">
              ({{ selectedRemotePaths.size > 0 ? `${selectedRemotePaths.size} of ` : '' }}{{ remoteSearchQuery || (isComparing && hideIdenticalFiles) ? `${filteredRemoteFiles.length} of ${sftpStore.remoteFiles.length}` : `${filteredRemoteFiles.length}` }} items)
            </span>
            <span v-else class="text-[11px] text-amber-500 font-medium">(Disconnected)</span>
          </div>

          <div v-if="props.sessionId" class="flex items-center space-x-1.5">
            <!-- Batch Actions for Remote Selection -->
            <template v-if="selectedRemoteFiles.length > 0">
              <button
                @click="handleBatchDownload(selectedRemoteFiles)"
                :title="`Download ${selectedRemoteFiles.length} selected item(s) to local`"
                class="h-6 px-1.5 rounded text-xs transition flex items-center justify-center bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 shadow-sm"
              >
                <CatppuccinIcon name="download" :size="15" />
              </button>
              <button
                @click="handleBatchDeleteRemote(selectedRemoteFiles)"
                :title="`Delete ${selectedRemoteFiles.length} selected item(s) from server`"
                class="h-6 px-1.5 rounded text-red-400 hover:bg-red-950/60 text-xs transition flex items-center justify-center border border-transparent hover:border-red-500/30"
              >
                <CatppuccinIcon name="delete" :size="15" />
              </button>
              <div class="h-3.5 w-px mx-0.5" :style="{ backgroundColor: 'var(--color-border)' }" />
            </template>

            <!-- Toggle Directory Comparison -->
            <button
              v-if="props.sessionId"
              @click="toggleComparison"
              :title="isComparing ? 'Exit Directory Comparison (Ctrl+Shift+C)' : 'Compare with Local Directory (Ctrl+Shift+C)'"
              class="p-1 rounded text-xs transition hover:opacity-80"
              :class="isComparing ? 'text-indigo-400 bg-indigo-500/10' : ''"
              :style="{ color: isComparing ? 'var(--color-accent-secondary)' : 'var(--color-text-muted)' }"
            >
              <GitCompare class="w-4 h-4" />
            </button>

            <!-- Toggle Synchronized Browsing -->
            <button
              v-if="props.sessionId"
              @click="sftpStore.toggleSynchronizedBrowsing()"
              :title="sftpStore.isSynchronizedBrowsing ? 'Synchronized Browsing is ON (Lockstep Navigation)' : 'Turn ON Synchronized Browsing (Lockstep Navigation)'"
              class="p-1 rounded text-xs transition hover:opacity-80 relative"
              :class="sftpStore.isSynchronizedBrowsing ? 'text-sky-400 bg-sky-500/15 ring-1 ring-sky-400/40' : ''"
              :style="{ color: sftpStore.isSynchronizedBrowsing ? 'var(--color-accent-secondary)' : 'var(--color-text-muted)' }"
            >
              <FolderSync class="w-4 h-4" />
              <span v-if="sftpStore.isSynchronizedBrowsing" class="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
            </button>

            <!-- Toggle In-Pane Search Filter (Ctrl+F) -->
            <button
              v-if="props.sessionId"
              @click="toggleFilter('remote')"
              :title="showRemoteFilter ? 'Close Filter (Ctrl+F)' : 'Filter remote files (Ctrl+F)'"
              class="p-1 rounded text-xs transition hover:opacity-80"
              :class="showRemoteFilter || remoteSearchQuery ? 'text-blue-400' : ''"
              :style="{ color: showRemoteFilter || remoteSearchQuery ? 'var(--color-accent-secondary)' : 'var(--color-text-muted)' }"
            >
              <Search class="w-4 h-4" />
            </button>

            <button
              @click="navigateRemoteUp"
              :disabled="!canNavigateRemoteUp"
              :class="{ 'opacity-30 cursor-not-allowed': !canNavigateRemoteUp }"
              title="Go to parent directory"
              class="p-1 rounded text-xs transition hover:opacity-80"
              :style="{ color: 'var(--color-text-muted)' }"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            </button>
            <button
              @click="props.sessionId && sftpStore.fetchRemoteDir(props.sessionId, sftpStore.remotePath, { force: true })"
              title="Refresh"
              class="p-1 rounded text-xs transition hover:opacity-80 flex items-center justify-center"
              :style="{ color: 'var(--color-text-muted)' }"
            >
              <CatppuccinIcon
                name="refresh"
                :size="15"
                :class="{ 'animate-spin': sftpStore.isBackgroundRefreshingRemote || sftpStore.isLoadingRemote }"
              />
            </button>

            <!-- Toggle Hidden Files -->
            <button
              @click="showHiddenFiles = !showHiddenFiles"
              :title="showHiddenFiles ? 'Hide dotfiles' : 'Show hidden dotfiles (.env, .git, etc.)'"
              class="p-1 rounded text-xs transition hover:opacity-80"
              :class="showHiddenFiles ? 'text-indigo-400' : ''"
              :style="{ color: showHiddenFiles ? 'var(--color-accent)' : 'var(--color-text-muted)' }"
            >
              <Eye v-if="showHiddenFiles" class="w-4 h-4" />
              <EyeOff v-else class="w-4 h-4" />
            </button>

            <button
              v-if="props.sessionId"
              @click="openNewFile('remote')"
              title="New File"
              class="p-1 rounded text-xs transition hover:opacity-80"
              :style="{ color: 'var(--color-text-muted)' }"
            >
              <CatppuccinIcon name="file" :size="15" />
            </button>
            <button
              v-if="props.sessionId"
              @click="openNewFolder('remote')"
              title="New Directory"
              class="p-1 rounded text-xs transition hover:opacity-80"
              :style="{ color: 'var(--color-text-muted)' }"
            >
              <CatppuccinIcon name="folder" :size="15" />
            </button>
          </div>
        </div>

        <!-- Remote Path Address Bar (Location) -->
        <div
          class="px-3 py-1.5 border-b flex items-center space-x-2 transition-colors duration-150"
          :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
        >
          <div
            class="flex-1 flex items-center space-x-2 px-2.5 py-1 rounded-lg border transition-colors duration-150"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
          >
            <CatppuccinIcon name="globe" :size="15" class="shrink-0 select-none" />
            <input
              v-if="props.sessionId"
              v-model="remoteInputPath"
              @keyup.enter="sftpStore.fetchRemoteDir(props.sessionId, remoteInputPath)"
              placeholder="/var/www/..."
              class="flex-1 bg-transparent text-xs font-mono focus:outline-none truncate"
              :style="{ color: 'var(--color-text-main)' }"
            />
            <div v-else class="text-xs italic flex-1" :style="{ color: 'var(--color-text-muted)' }">
              Connect an SSH session to access remote SFTP files
            </div>

            <!-- Remote Git Branch Badge -->
            <div
              v-if="props.sessionId && sftpStore.remoteGitStatus?.is_repo && sftpStore.remoteGitStatus.branch"
              class="flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono border flex-shrink-0"
              :style="{
                backgroundColor: 'rgba(245, 158, 11, 0.12)',
                color: '#fbbf24',
                borderColor: 'rgba(245, 158, 11, 0.35)'
              }"
              :title="`Remote Git Branch: ${sftpStore.remoteGitStatus.branch}`"
            >
              <GitBranch class="w-3 h-3 text-amber-400" />
              <span class="font-semibold">{{ sftpStore.remoteGitStatus.branch }}</span>
            </div>

            <button
              v-if="props.sessionId"
              @click="sftpStore.fetchRemoteDir(props.sessionId, remoteInputPath)"
              class="p-0.5 rounded text-xs font-semibold transition hover:opacity-100 opacity-60"
              :style="{ color: 'var(--color-accent-secondary)' }"
              title="Navigate to remote path (Enter)"
            >
              ↵
            </button>
          </div>

          <!-- Remote Bookmark Toggle & Dropdown -->
          <div v-if="props.sessionId" class="relative flex items-center space-x-1">
            <button
              @click="toggleRemoteBookmark()"
              :title="isRemoteBookmarked ? 'Remove Bookmark' : 'Bookmark this remote folder'"
              class="p-1.5 rounded-lg border text-xs transition btn-theme-card flex items-center justify-center"
              :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
            >
              <CatppuccinIcon
                :name="isRemoteBookmarked ? 'bookmark-filled' : 'bookmark'"
                :size="14"
              />
            </button>
            <button
              @click.stop="showRemoteBookmarksMenu = !showRemoteBookmarksMenu; showLocalBookmarksMenu = false"
              title="Saved Remote Bookmarks"
              class="p-1.5 rounded-lg border text-xs transition btn-theme-card"
              :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
            >
              <ChevronDown class="w-3.5 h-3.5 text-slate-400" />
            </button>

            <!-- Bookmarks Dropdown Menu -->
            <div
              v-if="showRemoteBookmarksMenu"
              class="absolute right-0 top-full mt-1.5 z-50 w-64 backdrop-blur-md rounded-xl border shadow-2xl p-1.5 text-xs select-none animate-in fade-in zoom-in-95 duration-100"
              :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
              @click.stop
            >
              <div
                class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider border-b mb-1 flex items-center justify-between"
                :style="{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
              >
                <span>Remote Bookmarks</span>
                <span class="text-[10px] lowercase opacity-70">{{ remoteBookmarks.length }} saved</span>
              </div>
              <div v-if="remoteBookmarks.length === 0" class="px-3 py-2 text-xs italic" :style="{ color: 'var(--color-text-muted)' }">
                No bookmarks yet. Click bookmark icon to save current folder.
              </div>
              <div v-else class="max-h-48 overflow-y-auto space-y-0.5">
                <div
                  v-for="b in remoteBookmarks"
                  :key="b"
                  class="flex items-center justify-between px-2 py-1.5 rounded-lg group hover:bg-slate-700/40 transition cursor-pointer"
                  @click="sftpStore.fetchRemoteDir(props.sessionId, b); showRemoteBookmarksMenu = false"
                >
                  <div class="flex items-center space-x-2 min-w-0 mr-1">
                    <Folder class="w-3.5 h-3.5 shrink-0 text-amber-400" />
                    <span class="font-mono text-[11px] truncate" :style="{ color: 'var(--color-text-main)' }">{{ b }}</span>
                  </div>
                  <button
                    @click.stop="toggleRemoteBookmark(b)"
                    title="Remove"
                    class="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 text-slate-400 transition"
                  >
                    <X class="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Remote In-Pane Live Filter Bar (Ctrl+F) -->
        <div
          v-if="props.sessionId && showRemoteFilter"
          class="px-3 py-1.5 border-b flex items-center space-x-2 transition-all duration-150 animate-in fade-in slide-in-from-top-1"
          :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
        >
          <div
            class="flex-1 flex items-center space-x-2 px-2.5 py-1 rounded-lg border transition-colors duration-150"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
          >
            <Search class="w-3.5 h-3.5 shrink-0 select-none opacity-60" :style="{ color: 'var(--color-accent-secondary)' }" />
            <input
              ref="remoteFilterInputRef"
              v-model="remoteSearchQuery"
              @keydown.esc.stop="handleFilterEsc('remote')"
              @keydown.down.prevent="focusFirstItem('remote')"
              @keydown.enter.prevent="focusFirstItem('remote')"
              placeholder="Filter remote files by name... (Esc to clear, ↓ to select)"
              class="flex-1 bg-transparent text-xs font-mono focus:outline-none truncate"
              :style="{ color: 'var(--color-text-main)' }"
            />
            <button
              v-if="remoteSearchQuery"
              @click="remoteSearchQuery = ''; remoteFilterInputRef?.focus()"
              class="p-0.5 rounded text-xs opacity-60 hover:opacity-100 transition"
              :style="{ color: 'var(--color-text-muted)' }"
              title="Clear filter"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>
          <div class="flex items-center space-x-1.5 shrink-0">
            <span
              v-if="remoteSearchQuery"
              class="text-[10px] font-mono px-1.5 py-0.5 rounded border"
              :style="{
                backgroundColor: filteredRemoteFiles.length > 0 ? 'var(--color-bg-pane)' : 'rgba(239, 68, 68, 0.1)',
                borderColor: filteredRemoteFiles.length > 0 ? 'var(--color-border)' : 'rgba(239, 68, 68, 0.3)',
                color: filteredRemoteFiles.length > 0 ? 'var(--color-text-muted)' : '#f87171'
              }"
            >
              {{ filteredRemoteFiles.length }} found
            </span>
            <button
              @click="showRemoteFilter = false; remoteSearchQuery = ''"
              class="p-1 rounded text-xs opacity-60 hover:opacity-100 transition hover:bg-white/5"
              :style="{ color: 'var(--color-text-muted)' }"
              title="Close filter (Esc)"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <!-- Remote File List Table -->
        <div
          class="flex-1 overflow-auto"
          @dragover="handleRemoteDragOver"
          @drop="handleRemoteDrop"
          @contextmenu.self="openRemoteContextMenu($event)"
        >
          <div v-if="!props.sessionId" class="flex flex-col items-center justify-center p-12 text-center">
            <div
              class="w-12 h-12 rounded-2xl flex items-center justify-center mb-3 border shadow-sm"
              :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
            >
              <CatppuccinIcon name="lock" :size="24" />
            </div>
            <p class="text-xs font-medium" :style="{ color: 'var(--color-text-muted)' }">No active remote session</p>
            <p class="text-[11px] max-w-xs mt-1" :style="{ color: 'var(--color-text-muted)' }">
              Start or select an active SSH connection to browse and manage remote SFTP files.
            </p>
          </div>
          <div v-else-if="sftpStore.isLoadingRemote" class="flex items-center justify-center p-8 text-xs" :style="{ color: 'var(--color-text-muted)' }">
            <span class="animate-spin w-4 h-4 border-2 border-slate-600 rounded-full mr-2" :style="{ borderTopColor: 'var(--color-accent-secondary)' }" />
            Reading remote directory...
          </div>
          <div v-else-if="sftpStore.remoteError" class="flex flex-col items-center justify-center p-8 text-center">
            <div class="w-10 h-10 rounded-xl bg-red-950/60 border border-red-800/60 flex items-center justify-center text-red-400 mb-2">
              ⚠️
            </div>
            <p class="text-xs font-semibold text-red-300 mb-1">Failed to read remote directory</p>
            <p class="text-[11px] text-red-400/80 max-w-sm mb-4 font-mono break-all">{{ sftpStore.remoteError }}</p>
            <button
              @click="props.sessionId && sftpStore.fetchRemoteDir(props.sessionId, sftpStore.remotePath, { force: true })"
              class="px-3 py-1.5 rounded-lg border text-xs font-medium transition"
              :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
            >
              🔄 Retry
            </button>
          </div>
          <table
            v-else
            class="min-w-[760px] w-full text-left border-collapse select-none"
            @dragover="handleRemoteDragOver"
            @drop="handleRemoteDrop"
            :style="{
              fontFamily: settingsStore.browserFontFamily,
              fontSize: `${settingsStore.browserFontSize}px`,
            }"
          >
            <thead
              class="sticky top-0 backdrop-blur-sm border-b text-[0.88em] z-10 shadow-sm transition-colors duration-150"
              :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
            >
              <tr>
                <th
                  :class="[rowPaddingClass, 'font-medium min-w-[190px] cursor-pointer select-none hover:text-[var(--color-text-main)] transition-colors']"
                  :style="remoteSortBy === 'name' ? { color: 'var(--color-accent-secondary)' } : undefined"
                  @click="handleRemoteSort('name')"
                  :title="remoteSortBy === 'name' ? (remoteSortOrder === 'asc' ? 'Sorted by Name (Ascending) - Click to sort Descending' : 'Sorted by Name (Descending) - Click to sort Ascending') : 'Sort by Name'"
                >
                  <div class="flex items-center gap-1.5">
                    <span :class="{ 'font-semibold': remoteSortBy === 'name' }">Name</span>
                    <ArrowUp v-if="remoteSortBy === 'name' && remoteSortOrder === 'asc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent-secondary)' }" />
                    <ArrowDown v-else-if="remoteSortBy === 'name' && remoteSortOrder === 'desc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent-secondary)' }" />
                  </div>
                </th>
                <th
                  :class="[cellPaddingClass, 'w-24 min-w-[75px] font-medium whitespace-nowrap cursor-pointer select-none hover:text-[var(--color-text-main)] transition-colors']"
                  :style="remoteSortBy === 'type' ? { color: 'var(--color-accent-secondary)' } : undefined"
                  @click="handleRemoteSort('type')"
                  :title="remoteSortBy === 'type' ? (remoteSortOrder === 'asc' ? 'Sorted by Type (Ascending) - Click to sort Descending' : 'Sorted by Type (Descending) - Click to sort Ascending') : 'Sort by Type'"
                >
                  <div class="flex items-center gap-1.5">
                    <span :class="{ 'font-semibold': remoteSortBy === 'type' }">Type</span>
                    <ArrowUp v-if="remoteSortBy === 'type' && remoteSortOrder === 'asc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent-secondary)' }" />
                    <ArrowDown v-else-if="remoteSortBy === 'type' && remoteSortOrder === 'desc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent-secondary)' }" />
                  </div>
                </th>
                <th
                  :class="[cellPaddingClass, 'w-24 min-w-[80px] font-medium text-right whitespace-nowrap cursor-pointer select-none hover:text-[var(--color-text-main)] transition-colors']"
                  :style="remoteSortBy === 'size' ? { color: 'var(--color-accent-secondary)' } : undefined"
                  @click="handleRemoteSort('size')"
                  :title="remoteSortBy === 'size' ? (remoteSortOrder === 'asc' ? 'Sorted by Size (Ascending) - Click to sort Descending' : 'Sorted by Size (Descending) - Click to sort Ascending') : 'Sort by Size'"
                >
                  <div class="flex items-center justify-end gap-1.5">
                    <ArrowUp v-if="remoteSortBy === 'size' && remoteSortOrder === 'asc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent-secondary)' }" />
                    <ArrowDown v-else-if="remoteSortBy === 'size' && remoteSortOrder === 'desc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent-secondary)' }" />
                    <span :class="{ 'font-semibold': remoteSortBy === 'size' }">Size</span>
                  </div>
                </th>
                <th
                  :class="[cellPaddingClass, 'w-36 min-w-[125px] font-medium whitespace-nowrap cursor-pointer select-none hover:text-[var(--color-text-main)] transition-colors']"
                  :style="remoteSortBy === 'modified' ? { color: 'var(--color-accent-secondary)' } : undefined"
                  @click="handleRemoteSort('modified')"
                  :title="remoteSortBy === 'modified' ? (remoteSortOrder === 'asc' ? 'Sorted by Modified (Ascending) - Click to sort Descending' : 'Sorted by Modified (Descending) - Click to sort Ascending') : 'Sort by Modified'"
                >
                  <div class="flex items-center gap-1.5">
                    <span :class="{ 'font-semibold': remoteSortBy === 'modified' }">Modified</span>
                    <ArrowUp v-if="remoteSortBy === 'modified' && remoteSortOrder === 'asc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent-secondary)' }" />
                    <ArrowDown v-else-if="remoteSortBy === 'modified' && remoteSortOrder === 'desc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent-secondary)' }" />
                  </div>
                </th>
                <th
                  :class="[cellPaddingClass, 'w-28 min-w-[105px] font-medium whitespace-nowrap font-mono cursor-pointer select-none hover:text-[var(--color-text-main)] transition-colors']"
                  :style="remoteSortBy === 'permissions' ? { color: 'var(--color-accent-secondary)' } : undefined"
                  @click="handleRemoteSort('permissions')"
                  :title="remoteSortBy === 'permissions' ? (remoteSortOrder === 'asc' ? 'Sorted by Permissions (Ascending) - Click to sort Descending' : 'Sorted by Permissions (Descending) - Click to sort Ascending') : 'Sort by Permissions'"
                >
                  <div class="flex items-center gap-1.5">
                    <span :class="{ 'font-semibold': remoteSortBy === 'permissions' }">Permissions</span>
                    <ArrowUp v-if="remoteSortBy === 'permissions' && remoteSortOrder === 'asc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent-secondary)' }" />
                    <ArrowDown v-else-if="remoteSortBy === 'permissions' && remoteSortOrder === 'desc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent-secondary)' }" />
                  </div>
                </th>
                <th
                  :class="[cellPaddingClass, 'w-28 min-w-[95px] font-medium whitespace-nowrap cursor-pointer select-none hover:text-[var(--color-text-main)] transition-colors']"
                  :style="remoteSortBy === 'owner' ? { color: 'var(--color-accent-secondary)' } : undefined"
                  @click="handleRemoteSort('owner')"
                  :title="remoteSortBy === 'owner' ? (remoteSortOrder === 'asc' ? 'Sorted by Owner / Group (Ascending) - Click to sort Descending' : 'Sorted by Owner / Group (Descending) - Click to sort Ascending') : 'Sort by Owner / Group'"
                >
                  <div class="flex items-center gap-1.5">
                    <span :class="{ 'font-semibold': remoteSortBy === 'owner' }">Owner / Group</span>
                    <ArrowUp v-if="remoteSortBy === 'owner' && remoteSortOrder === 'asc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent-secondary)' }" />
                    <ArrowDown v-else-if="remoteSortBy === 'owner' && remoteSortOrder === 'desc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent-secondary)' }" />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              <!-- FileZilla-style Parent Directory Entry (📁 ..) -->
              <tr
                v-if="canNavigateRemoteUp"
                id="remote-row-parent"
                @dblclick="navigateRemoteUp"
                @click="handleRemoteParentClick"
                @contextmenu.prevent.stop="closeContextMenu"
                @dragover="handleParentFolderDragOver($event, 'remote')"
                @dragleave="handleParentFolderDragLeave('remote')"
                @drop="handleParentFolderDrop($event, 'remote')"
                class="group cursor-pointer select-none file-row"
                :style="activeDropFolder?.pane === 'remote' && activeDropFolder?.path === remoteParentPath
                  ? { backgroundColor: 'var(--color-bg-hover)', borderLeft: '3px solid var(--color-accent-secondary)', color: 'var(--color-text-main)' }
                  : isRemoteParentSelected
                  ? { backgroundColor: 'var(--color-bg-hover)', borderLeft: '3px solid var(--color-accent-secondary)', color: 'var(--color-text-main)' }
                  : { borderLeft: '3px solid transparent', color: 'var(--color-text-main)' }"
                title="Double-click or press Enter to go to parent directory"
              >
                <td :class="[rowPaddingClass, 'whitespace-nowrap']">
                  <div class="flex items-center space-x-1.5 leading-none">
                    <FileIcon name=".." :is-dir="true" :is-open="activeDropFolder?.pane === 'remote' && activeDropFolder?.path === remoteParentPath" :size="15" />
                    <span class="font-bold text-sm tracking-wide leading-tight" :style="{ color: 'var(--color-text-main)' }">..</span>
                  </div>
                </td>
                <td :class="[cellPaddingClass, 'text-[0.92em] whitespace-nowrap']" :style="{ color: 'var(--color-text-muted)' }">
                  Folder
                </td>
                <td :class="[cellPaddingClass, 'text-right font-mono text-[0.92em] whitespace-nowrap']" :style="{ color: 'var(--color-text-muted)' }">
                  -
                </td>
                <td :class="[cellPaddingClass, 'text-[0.92em] whitespace-nowrap']" :style="{ color: 'var(--color-text-muted)' }">
                  -
                </td>
                <td :class="[cellPaddingClass, 'text-[0.88em] font-mono whitespace-nowrap']" :style="{ color: 'var(--color-text-muted)' }">
                  -
                </td>
                <td :class="[cellPaddingClass, 'text-[0.88em] font-mono whitespace-nowrap']" :style="{ color: 'var(--color-text-muted)' }">
                  -
                </td>
              </tr>

              <tr v-if="filteredRemoteFiles.length === 0" @dragover="handleRemoteDragOver" @drop="handleRemoteDrop">
                <td colspan="6" class="py-8 text-center italic" :style="{ color: 'var(--color-text-muted)' }">
                  <template v-if="remoteSearchQuery">
                    No files matching "<span class="font-semibold text-amber-300 font-mono">{{ remoteSearchQuery }}</span>"
                    <button @click="remoteSearchQuery = ''" class="ml-2 underline text-xs not-italic cursor-pointer hover:opacity-80" :style="{ color: 'var(--color-accent-secondary)' }">
                      Clear filter
                    </button>
                  </template>
                  <template v-else-if="isComparing && hideIdenticalFiles">
                    All {{ sftpStore.remoteFiles.length }} files match local (identical files are hidden)
                    <button @click="hideIdenticalFiles = false" class="ml-2 underline text-xs not-italic cursor-pointer hover:opacity-80" :style="{ color: 'var(--color-accent-secondary)' }">
                      Show all files
                    </button>
                  </template>
                  <template v-else>
                    Folder is empty
                  </template>
                </td>
              </tr>
              <tr
                v-for="(file, index) in filteredRemoteFiles"
                :key="file.path"
                :id="`remote-row-${index}`"
                draggable="true"
                @dragstart="handleRemoteDragStart($event, file)"
                @dragend="handleRemoteDragEnd"
                @click="handleRemoteRowClick($event, file, index)"
                @contextmenu="openRemoteContextMenu($event, file)"
                @dblclick="handleRemoteRowDoubleClick(file)"
                @dragover="file.is_dir ? handleFolderDragOver($event, 'remote', file) : handleRemoteDragOver($event)"
                @dragleave="file.is_dir ? handleFolderDragLeave('remote', file) : undefined"
                @drop="file.is_dir ? handleFolderDrop($event, 'remote', file) : handleRemoteDrop($event)"
                class="group cursor-pointer select-none file-row"
                :style="getRowStyle(false, file.path, file)"
              >
                <td :class="[rowPaddingClass, 'whitespace-nowrap']" :title="file.name">
                  <div class="flex items-center space-x-1.5 leading-none">
                    <FileIcon :name="file.name" :is-dir="file.is_dir" :is-open="activeDropFolder?.path === file.path" :size="15" />
                    <span v-if="remoteSearchQuery && highlightMatch(file.name, remoteSearchQuery)" class="font-normal truncate leading-tight" :style="{ color: 'var(--color-text-main)' }">
                      <span>{{ highlightMatch(file.name, remoteSearchQuery)!.before }}</span>
                      <span class="bg-amber-400/30 text-amber-300 font-semibold rounded px-0.5">{{ highlightMatch(file.name, remoteSearchQuery)!.match }}</span>
                      <span>{{ highlightMatch(file.name, remoteSearchQuery)!.after }}</span>
                    </span>
                    <span v-else class="font-normal truncate leading-tight" :style="{ color: 'var(--color-text-main)' }">{{ file.name }}</span>

                    <!-- Comparison Status Badge -->
                    <template v-if="isComparing && comparisonResult?.remoteMap.get(file.name)">
                      <span
                        v-if="comparisonResult.remoteMap.get(file.name)!.status === 'remote_only'"
                        class="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/40 flex-shrink-0"
                        title="Only exists on remote"
                      >
                        + Remote Only
                      </span>
                      <span
                        v-else-if="comparisonResult.remoteMap.get(file.name)!.status === 'remote_newer'"
                        class="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex-shrink-0"
                        title="Remote file is newer than local"
                      >
                        ▲ Newer
                      </span>
                      <span
                        v-else-if="comparisonResult.remoteMap.get(file.name)!.status === 'local_newer'"
                        class="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-zinc-600/30 text-zinc-400 border border-zinc-600/40 flex-shrink-0"
                        title="Local file is newer than remote"
                      >
                        ▼ Older
                      </span>
                      <span
                        v-else-if="comparisonResult.remoteMap.get(file.name)!.status === 'size_different'"
                        class="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/40 flex-shrink-0"
                        :title="`File size differs: Remote is ${formatBytes(file.size)}, Local is ${formatBytes(comparisonResult.remoteMap.get(file.name)!.counterpartSize || 0)}`"
                      >
                        ≠ Size Diff
                      </span>
                    </template>

                    <!-- Remote Git Status Overlay Badge -->
                    <span
                      v-if="getGitStatus(false, file)"
                      class="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold flex-shrink-0"
                      :class="{
                        'text-amber-400 bg-amber-950/60 border border-amber-800/60': getGitStatus(false, file) === 'modified',
                        'text-emerald-400 bg-emerald-950/60 border border-emerald-800/60': getGitStatus(false, file) === 'untracked',
                        'text-cyan-400 bg-cyan-950/60 border border-cyan-800/60': getGitStatus(false, file) === 'staged',
                        'text-red-400 bg-red-950/60 border border-red-800/60': getGitStatus(false, file) === 'deleted',
                        'text-purple-400 bg-purple-950/60 border border-purple-800/60': getGitStatus(false, file) === 'renamed',
                        'text-amber-300/80 bg-amber-950/30 border border-amber-900/40': getGitStatus(false, file) === 'has-changes',
                      }"
                      :title="`Git: ${getGitStatus(false, file)}`"
                    >
                      {{ getGitStatus(false, file) === 'modified' ? 'M' : getGitStatus(false, file) === 'untracked' ? 'U' : getGitStatus(false, file) === 'staged' ? 'S' : getGitStatus(false, file) === 'deleted' ? 'D' : getGitStatus(false, file) === 'renamed' ? 'R' : '●' }}
                    </span>
                  </div>
                </td>
                <td :class="[cellPaddingClass, 'text-[0.92em] whitespace-nowrap']" :style="{ color: 'var(--color-text-muted)' }">
                  {{ getFileType(file) }}
                </td>
                <td :class="[cellPaddingClass, 'text-right font-mono text-[0.92em] whitespace-nowrap']" :style="{ color: 'var(--color-text-muted)' }">
                  {{ file.is_dir ? '-' : formatBytes(file.size) }}
                </td>
                <td :class="[cellPaddingClass, 'text-[0.92em] whitespace-nowrap']" :style="{ color: 'var(--color-text-muted)' }">
                  {{ formatDate(file.modified) }}
                </td>
                <td
                  :class="[cellPaddingClass, 'text-[0.88em] font-mono whitespace-nowrap cursor-pointer hover:underline']"
                  :style="{ color: 'var(--color-text-muted)' }"
                  @click.stop="openPermissions(file)"
                  :title="`Click to edit: chmod ${formatOctalPermissions(file.permissions, file.is_dir)} (${formatPermissions(file.permissions, file.is_dir, file.is_symlink)})`"
                >
                  <span class="opacity-90">{{ formatPermissions(file.permissions, file.is_dir, file.is_symlink) }}</span>
                </td>
                <td
                  :class="[cellPaddingClass, 'text-[0.88em] font-mono whitespace-nowrap truncate max-w-[130px]']"
                  :style="{ color: 'var(--color-text-muted)' }"
                  :title="formatOwnerGroup(file)"
                >
                  {{ formatOwnerGroup(file) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Bottom Transfer Queue Drawer (FileZilla Exact 3-Tab Architecture) -->
    <div
      class="flex flex-col transition-colors duration-150 flex-shrink-0 relative border-t"
      :style="{
        height: showTransferDrawer ? `${drawerHeight}px` : 'auto',
        backgroundColor: 'var(--color-bg-card)',
        borderColor: 'var(--color-border)'
      }"
    >
      <!-- Horizontal Splitter Handle (Vertical Resize for Bottom Drawer) -->
      <div
        @mousedown.prevent="startVerticalResize"
        class="h-2 cursor-row-resize flex items-center justify-center transition-colors group flex-shrink-0 relative select-none z-30 before:absolute before:-top-1.5 before:-bottom-1.5 before:left-0 before:right-0 before:content-['']"
        :class="{ 'bg-sky-500/30': isResizingVertical }"
        title="Drag to resize transfer drawer (double-click to reset height)"
        @dblclick="resetVerticalSplit"
      >
        <div
          class="h-1 w-12 rounded-full transition-colors"
          :class="isResizingVertical ? 'bg-sky-400' : 'bg-zinc-400 dark:bg-zinc-500 group-hover:bg-sky-400'"
        />
      </div>

      <!-- Main Queue Data Grid (FileZilla Columns & Server Tree - Virtualized) -->
      <div
        ref="queueScrollContainerRef"
        v-show="showTransferDrawer"
        class="overflow-y-auto overflow-x-auto flex flex-col flex-1 min-h-0"
        :style="{
          backgroundColor: 'var(--color-bg-card)'
        }"
        @scroll="handleQueueScroll"
        @contextmenu.stop="openQueueContextMenu($event)"
      >
        <!-- 1. QUEUED FILES TAB (Screenshot 1 & Screenshot 5) -->
        <table
          v-if="transferTab === 'active'"
          class="text-left border-collapse table-fixed text-[11px] font-mono select-none"
          style="width: max-content; min-width: 100%;"
        >
          <colgroup>
            <col :style="{ width: `${queueColWidths.local}px` }" />
            <col :style="{ width: `${queueColWidths.direction}px` }" />
            <col :style="{ width: `${queueColWidths.remote}px` }" />
            <col :style="{ width: `${queueColWidths.size}px` }" />
            <col :style="{ width: `${queueColWidths.priority}px` }" />
            <col :style="{ width: `${queueColWidths.status}px` }" />
          </colgroup>
          <thead
            class="sticky top-0 z-10 border-b select-none"
            :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
          >
            <tr>
              <th class="px-2 py-1 font-normal border-r relative select-none" :style="{ borderColor: 'var(--color-border)' }">
                <span class="truncate block">Server/Local file</span>
                <div @mousedown.prevent.stop="startQueueColResize('local', $event)" @dblclick.stop="resetQueueColWidth('local')" class="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-sky-500/50 z-20" title="Drag to resize column (double-click to reset)" />
              </th>
              <th class="px-2 py-1 font-normal text-center border-r relative select-none" :style="{ borderColor: 'var(--color-border)' }">
                <span class="truncate block">Direction</span>
                <div @mousedown.prevent.stop="startQueueColResize('direction', $event)" @dblclick.stop="resetQueueColWidth('direction')" class="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-sky-500/50 z-20" title="Drag to resize column (double-click to reset)" />
              </th>
              <th class="px-2 py-1 font-normal border-r relative select-none" :style="{ borderColor: 'var(--color-border)' }">
                <span class="truncate block">Remote file</span>
                <div @mousedown.prevent.stop="startQueueColResize('remote', $event)" @dblclick.stop="resetQueueColWidth('remote')" class="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-sky-500/50 z-20" title="Drag to resize column (double-click to reset)" />
              </th>
              <th class="px-2 py-1 font-normal text-right border-r relative select-none" :style="{ borderColor: 'var(--color-border)' }">
                <span class="truncate block">Size</span>
                <div @mousedown.prevent.stop="startQueueColResize('size', $event)" @dblclick.stop="resetQueueColWidth('size')" class="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-sky-500/50 z-20" title="Drag to resize column (double-click to reset)" />
              </th>
              <th class="px-2 py-1 font-normal border-r relative select-none" :style="{ borderColor: 'var(--color-border)' }">
                <span class="truncate block">Priority</span>
                <div @mousedown.prevent.stop="startQueueColResize('priority', $event)" @dblclick.stop="resetQueueColWidth('priority')" class="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-sky-500/50 z-20" title="Drag to resize column (double-click to reset)" />
              </th>
              <th class="px-2 py-1 font-normal relative select-none">
                <span class="truncate block">Status</span>
                <div @mousedown.prevent.stop="startQueueColResize('status', $event)" @dblclick.stop="resetQueueColWidth('status')" class="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-sky-500/50 z-20" title="Drag to resize column (double-click to reset)" />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="sftpStore.activeTransfers.length === 0">
              <td colspan="6" class="py-8 text-center text-xs" :style="{ color: 'var(--color-text-muted)' }">
                <Clock class="w-6 h-6 mx-auto mb-1.5 opacity-30" />
                <span>Queue is empty</span>
              </td>
            </tr>
            <template v-else>
              <!-- Top Virtual Spacer -->
              <tr v-if="virtualQueueRange.topPadding > 0" :style="{ height: `${virtualQueueRange.topPadding}px` }">
                <td colspan="6" style="padding: 0; border: none; height: inherit;" />
              </tr>

              <!-- Visible Virtual Rows -->
              <template v-for="row in virtualQueueRange.visibleRows" :key="row.id">
                <!-- Server Group Header Row -->
                <tr
                  v-if="row.type === 'group'"
                  class="border-b bg-black/5 dark:bg-white/[0.02]"
                  :style="{ borderColor: 'var(--color-border)', height: '25px' }"
                >
                  <td colspan="6" class="px-2 py-1 font-semibold" :style="{ color: 'var(--color-text-main)' }">
                    <div class="flex items-center space-x-1.5">
                      <Server class="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
                      <span>{{ row.server_url }} ({{ row.count.toLocaleString() }} items)</span>
                    </div>
                  </td>
                </tr>

                <!-- Transfer Row -->
                <tr
                  v-else-if="row.type === 'item'"
                  @click="handleQueueRowClick(row.item, $event)"
                  @contextmenu.stop="openQueueContextMenu($event, row.item)"
                  class="border-b transition-colors cursor-pointer"
                  :class="selectedQueueItemIds.has(row.item.transfer_id) ? 'bg-sky-600/30 text-white font-medium' : 'hover:bg-black/10 dark:hover:bg-white/5'"
                  :style="{ borderColor: 'var(--color-border)' }"
                >
                  <td class="px-2 py-1 pl-6 align-top">
                    <div class="flex items-center space-x-1.5 truncate">
                      <FileText class="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                      <span class="truncate font-mono text-[11px]" :title="row.item.local_path || row.item.file_name">{{ row.item.local_path || row.item.file_name }}</span>
                    </div>

                    <!-- FileZilla-style Live Progress Bar Sub-line -->
                    <div
                      v-if="isTransferActive(row.item)"
                      class="flex items-center space-x-2.5 mt-1 text-[10px] font-mono text-zinc-400 dark:text-zinc-400 select-none whitespace-nowrap pl-5"
                    >
                      <span class="shrink-0">{{ getTransferElapsed(row.item) }}</span>
                      <span class="shrink-0">{{ getTransferLeft(row.item) }}</span>

                      <!-- FileZilla Crisp Green Progress Bar -->
                      <div
                        class="relative w-32 sm:w-36 h-3.5 rounded-[2px] border border-zinc-400/50 dark:border-zinc-600/70 bg-zinc-200 dark:bg-zinc-800 overflow-hidden flex items-center justify-center shrink-0 shadow-inner"
                      >
                        <div
                          class="absolute left-0 top-0 bottom-0 bg-[#22c55e] transition-all duration-150"
                          :style="{ width: `${getTransferPercentNumber(row.item)}%` }"
                        />
                        <span class="relative z-10 text-[9px] font-bold font-mono text-zinc-900 dark:text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)] leading-none select-none">
                          {{ getTransferPercentFormatted(row.item) }}
                        </span>
                      </div>

                      <!-- Exact Transferred Bytes and Speed -->
                      <span class="text-zinc-300 dark:text-zinc-300 shrink-0">
                        {{ (row.item.bytes_transferred || 0).toLocaleString() }} bytes ({{ formatSpeedMib(row.item.speed_bytes_per_sec) }})
                      </span>
                    </div>
                  </td>
                  <td class="px-2 py-1 text-center font-bold align-top">
                    <span :class="row.item.direction === 'upload' ? 'text-sky-400' : 'text-emerald-400'">
                      {{ row.item.direction === 'upload' ? '-->' : '<--' }}
                    </span>
                  </td>
                  <td class="px-2 py-1 truncate align-top font-mono text-[11px]" :title="row.item.remote_path || row.item.file_name">
                    {{ row.item.remote_path || row.item.file_name }}
                  </td>
                  <td class="px-2 py-1 text-right font-mono align-top text-[11px]">
                    {{ (row.item.total_bytes || 0).toLocaleString() }}
                  </td>
                  <td class="px-2 py-1 align-top text-[11px]">
                    {{ row.item.priority || 'Normal' }}
                  </td>
                  <td class="px-2 py-1 truncate align-top text-[11px]">
                    <span v-if="!sftpStore.isQueueProcessing" class="text-amber-400 font-semibold">Paused</span>
                    <span v-else-if="isTransferActive(row.item)" class="text-sky-400 font-medium">Transferring</span>
                    <span v-else class="text-zinc-500">Queued</span>
                  </td>
                </tr>
              </template>

              <!-- Bottom Virtual Spacer -->
              <tr v-if="virtualQueueRange.bottomPadding > 0" :style="{ height: `${virtualQueueRange.bottomPadding}px` }">
                <td colspan="6" style="padding: 0; border: none; height: inherit;" />
              </tr>
            </template>
          </tbody>
        </table>

        <!-- 2. FAILED TRANSFERS TAB (Screenshot 2) -->
        <table
          v-else-if="transferTab === 'failed'"
          class="text-left border-collapse table-fixed text-[11px] font-mono select-none"
          style="width: max-content; min-width: 100%;"
        >
          <colgroup>
            <col :style="{ width: `${queueColWidths.local}px` }" />
            <col :style="{ width: `${queueColWidths.direction}px` }" />
            <col :style="{ width: `${queueColWidths.remote}px` }" />
            <col :style="{ width: `${queueColWidths.size}px` }" />
            <col :style="{ width: `${queueColWidths.priority}px` }" />
            <col :style="{ width: `${queueColWidths.time}px` }" />
            <col :style="{ width: `${queueColWidths.reason}px` }" />
          </colgroup>
          <thead
            class="sticky top-0 z-10 border-b select-none"
            :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
          >
            <tr>
              <th class="px-2 py-1 font-normal border-r relative select-none" :style="{ borderColor: 'var(--color-border)' }">
                <span class="truncate block">Server/Local file</span>
                <div @mousedown.prevent.stop="startQueueColResize('local', $event)" @dblclick.stop="resetQueueColWidth('local')" class="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-sky-500/50 z-20" title="Drag to resize column (double-click to reset)" />
              </th>
              <th class="px-2 py-1 font-normal text-center border-r relative select-none" :style="{ borderColor: 'var(--color-border)' }">
                <span class="truncate block">Direction</span>
                <div @mousedown.prevent.stop="startQueueColResize('direction', $event)" @dblclick.stop="resetQueueColWidth('direction')" class="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-sky-500/50 z-20" title="Drag to resize column (double-click to reset)" />
              </th>
              <th class="px-2 py-1 font-normal border-r relative select-none" :style="{ borderColor: 'var(--color-border)' }">
                <span class="truncate block">Remote file</span>
                <div @mousedown.prevent.stop="startQueueColResize('remote', $event)" @dblclick.stop="resetQueueColWidth('remote')" class="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-sky-500/50 z-20" title="Drag to resize column (double-click to reset)" />
              </th>
              <th class="px-2 py-1 font-normal text-right border-r relative select-none" :style="{ borderColor: 'var(--color-border)' }">
                <span class="truncate block">Size</span>
                <div @mousedown.prevent.stop="startQueueColResize('size', $event)" @dblclick.stop="resetQueueColWidth('size')" class="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-sky-500/50 z-20" title="Drag to resize column (double-click to reset)" />
              </th>
              <th class="px-2 py-1 font-normal border-r relative select-none" :style="{ borderColor: 'var(--color-border)' }">
                <span class="truncate block">Priority</span>
                <div @mousedown.prevent.stop="startQueueColResize('priority', $event)" @dblclick.stop="resetQueueColWidth('priority')" class="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-sky-500/50 z-20" title="Drag to resize column (double-click to reset)" />
              </th>
              <th class="px-2 py-1 font-normal border-r relative select-none" :style="{ borderColor: 'var(--color-border)' }">
                <span class="truncate block">Time</span>
                <div @mousedown.prevent.stop="startQueueColResize('time', $event)" @dblclick.stop="resetQueueColWidth('time')" class="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-sky-500/50 z-20" title="Drag to resize column (double-click to reset)" />
              </th>
              <th class="px-2 py-1 font-normal relative select-none">
                <span class="truncate block">Reason</span>
                <div @mousedown.prevent.stop="startQueueColResize('reason', $event)" @dblclick.stop="resetQueueColWidth('reason')" class="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-sky-500/50 z-20" title="Drag to resize column (double-click to reset)" />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="sftpStore.failedTransfers.length === 0">
              <td colspan="7" class="py-8 text-center text-xs" :style="{ color: 'var(--color-text-muted)' }">
                <CheckCircle2 class="w-6 h-6 mx-auto mb-1.5 opacity-30 text-emerald-400" />
                <span>No failed transfers</span>
              </td>
            </tr>
            <template v-else>
              <!-- Top Virtual Spacer -->
              <tr v-if="virtualQueueRange.topPadding > 0" :style="{ height: `${virtualQueueRange.topPadding}px` }">
                <td colspan="7" style="padding: 0; border: none; height: inherit;" />
              </tr>

              <!-- Visible Virtual Rows -->
              <template v-for="row in virtualQueueRange.visibleRows" :key="row.id">
                <tr
                  v-if="row.type === 'group'"
                  class="border-b bg-black/5 dark:bg-white/[0.02]"
                  :style="{ borderColor: 'var(--color-border)', height: '25px' }"
                >
                  <td colspan="7" class="px-2 py-1 font-semibold" :style="{ color: 'var(--color-text-main)' }">
                    <div class="flex items-center space-x-1.5">
                      <Server class="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
                      <span>{{ row.server_url }} ({{ row.count.toLocaleString() }} items)</span>
                    </div>
                  </td>
                </tr>
                <tr
                  v-else-if="row.type === 'item'"
                  @click="handleQueueRowClick(row.item, $event)"
                  @contextmenu.stop="openQueueContextMenu($event, row.item)"
                  class="border-b transition-colors cursor-pointer"
                  :class="selectedQueueItemIds.has(row.item.transfer_id) ? 'bg-sky-600/30 text-white font-medium' : 'hover:bg-black/10 dark:hover:bg-white/5'"
                  :style="{ borderColor: 'var(--color-border)' }"
                >
                  <td class="px-2 py-0.5 truncate pl-6">
                    <div class="flex items-center space-x-1.5 truncate">
                      <FileText class="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                      <span class="truncate" :title="row.item.local_path || row.item.file_name">{{ row.item.local_path || row.item.file_name }}</span>
                    </div>
                  </td>
                  <td class="px-2 py-0.5 text-center font-bold">
                    <span :class="row.item.direction === 'upload' ? 'text-sky-400' : 'text-emerald-400'">
                      {{ row.item.direction === 'upload' ? '-->' : '<--' }}
                    </span>
                  </td>
                  <td class="px-2 py-0.5 truncate" :title="row.item.remote_path || row.item.file_name">
                    {{ row.item.remote_path || row.item.file_name }}
                  </td>
                  <td class="px-2 py-0.5 text-right font-mono">
                    {{ (row.item.total_bytes || 0).toLocaleString() }}
                  </td>
                  <td class="px-2 py-0.5">
                    {{ row.item.priority || 'Normal' }}
                  </td>
                  <td class="px-2 py-0.5 truncate text-[10px]">
                    {{ formatTransferTime(row.item.completed_at || row.item.started_at) }}
                  </td>
                  <td class="px-2 py-0.5 truncate text-red-400" :title="row.item.error">
                    {{ row.item.error || 'Transfer failed' }}
                  </td>
                </tr>
              </template>

              <!-- Bottom Virtual Spacer -->
              <tr v-if="virtualQueueRange.bottomPadding > 0" :style="{ height: `${virtualQueueRange.bottomPadding}px` }">
                <td colspan="7" style="padding: 0; border: none; height: inherit;" />
              </tr>
            </template>
          </tbody>
        </table>

        <!-- 3. SUCCESSFUL TRANSFERS TAB (Screenshot 3 & Screenshot 4) -->
        <table
          v-else-if="transferTab === 'completed'"
          class="text-left border-collapse table-fixed text-[11px] font-mono select-none"
          style="width: max-content; min-width: 100%;"
        >
          <colgroup>
            <col :style="{ width: `${queueColWidths.local}px` }" />
            <col :style="{ width: `${queueColWidths.direction}px` }" />
            <col :style="{ width: `${queueColWidths.remote}px` }" />
            <col :style="{ width: `${queueColWidths.size}px` }" />
            <col :style="{ width: `${queueColWidths.priority}px` }" />
            <col :style="{ width: `${queueColWidths.time}px` }" />
          </colgroup>
          <thead
            class="sticky top-0 z-10 border-b select-none"
            :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
          >
            <tr>
              <th class="px-2 py-1 font-normal border-r relative select-none" :style="{ borderColor: 'var(--color-border)' }">
                <span class="truncate block">Server/Local file</span>
                <div @mousedown.prevent.stop="startQueueColResize('local', $event)" @dblclick.stop="resetQueueColWidth('local')" class="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-sky-500/50 z-20" title="Drag to resize column (double-click to reset)" />
              </th>
              <th class="px-2 py-1 font-normal text-center border-r relative select-none" :style="{ borderColor: 'var(--color-border)' }">
                <span class="truncate block">Direction</span>
                <div @mousedown.prevent.stop="startQueueColResize('direction', $event)" @dblclick.stop="resetQueueColWidth('direction')" class="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-sky-500/50 z-20" title="Drag to resize column (double-click to reset)" />
              </th>
              <th class="px-2 py-1 font-normal border-r relative select-none" :style="{ borderColor: 'var(--color-border)' }">
                <span class="truncate block">Remote file</span>
                <div @mousedown.prevent.stop="startQueueColResize('remote', $event)" @dblclick.stop="resetQueueColWidth('remote')" class="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-sky-500/50 z-20" title="Drag to resize column (double-click to reset)" />
              </th>
              <th class="px-2 py-1 font-normal text-right border-r relative select-none" :style="{ borderColor: 'var(--color-border)' }">
                <span class="truncate block">Size</span>
                <div @mousedown.prevent.stop="startQueueColResize('size', $event)" @dblclick.stop="resetQueueColWidth('size')" class="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-sky-500/50 z-20" title="Drag to resize column (double-click to reset)" />
              </th>
              <th class="px-2 py-1 font-normal border-r relative select-none" :style="{ borderColor: 'var(--color-border)' }">
                <span class="truncate block">Priority</span>
                <div @mousedown.prevent.stop="startQueueColResize('priority', $event)" @dblclick.stop="resetQueueColWidth('priority')" class="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-sky-500/50 z-20" title="Drag to resize column (double-click to reset)" />
              </th>
              <th class="px-2 py-1 font-normal relative select-none">
                <span class="truncate block">Time</span>
                <div @mousedown.prevent.stop="startQueueColResize('time', $event)" @dblclick.stop="resetQueueColWidth('time')" class="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-sky-500/50 z-20" title="Drag to resize column (double-click to reset)" />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="sftpStore.completedTransfers.length === 0">
              <td colspan="6" class="py-8 text-center text-xs" :style="{ color: 'var(--color-text-muted)' }">
                <CheckCircle2 class="w-6 h-6 mx-auto mb-1.5 opacity-30 text-emerald-400" />
                <span>No successful transfers yet</span>
              </td>
            </tr>
            <template v-else>
              <!-- Top Virtual Spacer -->
              <tr v-if="virtualQueueRange.topPadding > 0" :style="{ height: `${virtualQueueRange.topPadding}px` }">
                <td colspan="6" style="padding: 0; border: none; height: inherit;" />
              </tr>

              <!-- Visible Virtual Rows -->
              <template v-for="row in virtualQueueRange.visibleRows" :key="row.id">
                <tr
                  v-if="row.type === 'group'"
                  class="border-b bg-black/5 dark:bg-white/[0.02]"
                  :style="{ borderColor: 'var(--color-border)', height: '25px' }"
                >
                  <td colspan="6" class="px-2 py-1 font-semibold" :style="{ color: 'var(--color-text-main)' }">
                    <div class="flex items-center space-x-1.5">
                      <Server class="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
                      <span>{{ row.server_url }} ({{ row.count.toLocaleString() }} items)</span>
                    </div>
                  </td>
                </tr>
                <tr
                  v-else-if="row.type === 'item'"
                  @click="handleQueueRowClick(row.item, $event)"
                  @contextmenu.stop="openQueueContextMenu($event, row.item)"
                  class="border-b transition-colors cursor-pointer"
                  :class="selectedQueueItemIds.has(row.item.transfer_id) ? 'bg-sky-600/30 text-white font-medium' : 'hover:bg-black/10 dark:hover:bg-white/5'"
                  :style="{ borderColor: 'var(--color-border)' }"
                >
                  <td class="px-2 py-0.5 truncate pl-6">
                    <div class="flex items-center space-x-1.5 truncate">
                      <FileText class="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                      <span class="truncate" :title="row.item.local_path || row.item.file_name">{{ row.item.local_path || row.item.file_name }}</span>
                    </div>
                  </td>
                  <td class="px-2 py-0.5 text-center font-bold">
                    <span :class="row.item.direction === 'upload' ? 'text-sky-400' : 'text-emerald-400'">
                      {{ row.item.direction === 'upload' ? '-->' : '<--' }}
                    </span>
                  </td>
                  <td class="px-2 py-0.5 truncate" :title="row.item.remote_path || row.item.file_name">
                    {{ row.item.remote_path || row.item.file_name }}
                  </td>
                  <td class="px-2 py-0.5 text-right font-mono">
                    {{ (row.item.total_bytes || 0).toLocaleString() }}
                  </td>
                  <td class="px-2 py-0.5">
                    {{ row.item.priority || 'Normal' }}
                  </td>
                  <td class="px-2 py-0.5 truncate text-[10px]">
                    {{ formatTransferTime(row.item.completed_at || row.item.started_at) }}
                  </td>
                </tr>
              </template>

              <!-- Bottom Virtual Spacer -->
              <tr v-if="virtualQueueRange.bottomPadding > 0" :style="{ height: `${virtualQueueRange.bottomPadding}px` }">
                <td colspan="6" style="padding: 0; border: none; height: inherit;" />
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <!-- FileZilla-Exact Bottom Tab & Status Bar (Screenshots 1-5) -->
      <div
        class="flex items-center justify-between border-t select-none text-[11px] px-2 py-1 flex-shrink-0"
        :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)' }"
      >
        <!-- Left: Bottom Docked Tabs -->
        <div class="flex items-center space-x-1">
          <button
            @click="transferTab = 'active'; showTransferDrawer = true"
            class="px-2.5 py-0.5 rounded border text-[11px] transition cursor-pointer flex items-center space-x-1"
            :style="transferTab === 'active' && showTransferDrawer
              ? { backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)', fontWeight: '600', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }
              : { backgroundColor: 'transparent', borderColor: 'transparent', color: 'var(--color-text-muted)' }"
          >
            <span>Queued files{{ sftpStore.activeTransfers.length > 0 ? ` (${sftpStore.activeTransfers.length})` : '' }}</span>
          </button>

          <button
            @click="transferTab = 'failed'; showTransferDrawer = true"
            class="px-2.5 py-0.5 rounded border text-[11px] transition cursor-pointer flex items-center space-x-1"
            :style="transferTab === 'failed' && showTransferDrawer
              ? { backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)', fontWeight: '600', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }
              : { backgroundColor: 'transparent', borderColor: 'transparent', color: 'var(--color-text-muted)' }"
          >
            <span>Failed transfers{{ sftpStore.failedTransfers.length > 0 ? ` (${sftpStore.failedTransfers.length})` : '' }}</span>
          </button>

          <button
            @click="transferTab = 'completed'; showTransferDrawer = true"
            class="px-2.5 py-0.5 rounded border text-[11px] transition cursor-pointer flex items-center space-x-1"
            :style="transferTab === 'completed' && showTransferDrawer
              ? { backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)', fontWeight: '600', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }
              : { backgroundColor: 'transparent', borderColor: 'transparent', color: 'var(--color-text-muted)' }"
          >
            <span>Successful transfers{{ sftpStore.completedTransfers.length > 0 ? ` (${sftpStore.completedTransfers.length})` : '' }}</span>
          </button>
        </div>

        <!-- Right: Status Bar (Lock, Queue Size, Connection Dots, Controls) -->
        <div class="flex items-center space-x-3 text-[11px] font-mono" :style="{ color: 'var(--color-text-muted)' }">
          <!-- Active Throughput Badge -->
          <div
            v-if="sftpStore.activeTransfers.length > 0 && sftpStore.totalTransferSpeed > 0"
            class="hidden md:flex items-center space-x-1 text-amber-400"
          >
            <span>⚡</span>
            <span class="font-semibold">{{ formatBytes(sftpStore.totalTransferSpeed) }}/s</span>
          </div>

          <!-- Lock Icon (Encrypted Session Indicator) -->
          <div class="flex items-center space-x-1" title="Secure SFTP connection active">
            <Lock class="w-3.5 h-3.5 text-amber-400" />
          </div>

          <!-- Queue Size Indicator (FileZilla format) -->
          <div class="flex items-center space-x-1" :title="`Queue remaining: ${formatBytes(totalQueueBytes)}`">
            <RefreshCw
              class="w-3 h-3 text-zinc-400"
              :class="sftpStore.activeTransfers.length > 0 && sftpStore.isQueueProcessing ? 'animate-spin' : ''"
            />
            <span>{{ formatQueueSizeDisplay(totalQueueBytes) }}</span>
          </div>

          <!-- Action After Queue Active Badge -->
          <div
            v-if="queueCompletionAction !== 'nothing'"
            class="hidden md:flex items-center space-x-1 text-[10px] px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-400 border border-sky-500/30 select-none animate-in fade-in"
            :title="`Action on queue completion: ${queueCompletionAction}`"
          >
            <span v-if="queueCompletionAction === 'play_sound'">🔔 Sound on complete</span>
            <span v-else-if="queueCompletionAction === 'disconnect'">🔌 Disconnect on complete</span>
            <span v-else-if="queueCompletionAction === 'close'">🚪 Close on complete</span>
          </div>

          <!-- Two Connection Status Dots (Green / Idle) -->
          <div class="flex items-center space-x-1" title="SFTP Connection & Queue Worker State">
            <div
              class="w-2 h-2 rounded-full"
              :class="props.sessionId ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50' : 'bg-zinc-600'"
            />
            <div
              class="w-2 h-2 rounded-full"
              :class="sftpStore.activeTransfers.length > 0 && sftpStore.isQueueProcessing ? 'bg-emerald-400 animate-pulse' : 'bg-red-500/70'"
            />
          </div>

          <!-- Drawer Collapse / Expand Button -->
          <button
            @click="showTransferDrawer = !showTransferDrawer"
            class="p-0.5 rounded transition hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
            :title="showTransferDrawer ? 'Collapse drawer' : 'Expand drawer'"
          >
            <ChevronDown
              class="w-3.5 h-3.5 transition-transform duration-200"
              :class="{ 'rotate-180': !showTransferDrawer }"
            />
          </button>
        </div>
      </div>
    </div>

    <!-- FileZilla Queue Context Menu (Screenshots 4 & 5) -->
    <div
      v-if="queueContextMenu.show"
      :style="{
        left: `${queueContextMenu.x}px`,
        top: `${queueContextMenu.y}px`,
        backgroundColor: 'var(--color-bg-card)',
        borderColor: 'var(--color-border)'
      }"
      class="fixed z-50 min-w-[240px] backdrop-blur-md rounded-xl border shadow-2xl p-1 text-xs select-none animate-in fade-in zoom-in-95 duration-75"
      @click.stop
    >
      <!-- Queued Files Tab Context Menu (Screenshot 5) -->
      <template v-if="queueContextMenu.tab === 'active'">
        <button
          @click="sftpStore.toggleProcessQueue(); closeQueueContextMenu()"
          class="w-full flex items-center justify-between px-3 py-1.5 rounded-lg transition text-left hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <div class="flex items-center space-x-2">
            <span class="w-4 text-center font-bold text-sky-400">
              <Check v-if="sftpStore.isQueueProcessing" class="w-3.5 h-3.5" />
            </span>
            <span>Process Queue</span>
          </div>
        </button>

        <button
          @click="handleRemoveAllInTab"
          class="w-full flex items-center space-x-2 px-3 py-1.5 rounded-lg text-red-400 transition text-left hover:bg-red-950/40 cursor-pointer"
        >
          <span class="w-4" />
          <span>Stop and remove all</span>
        </button>

        <div class="h-px my-1" :style="{ backgroundColor: 'var(--color-border)' }" />

        <button
          @click="handleRemoveSelectedQueue"
          :disabled="selectedQueueItemIds.size === 0"
          class="w-full flex items-center space-x-2 px-3 py-1.5 rounded-lg transition text-left"
          :class="selectedQueueItemIds.size > 0 ? 'hover:bg-black/10 dark:hover:bg-white/10 text-red-400 cursor-pointer' : 'opacity-40 cursor-not-allowed'"
          :style="selectedQueueItemIds.size > 0 ? {} : { color: 'var(--color-text-muted)' }"
        >
          <span class="w-4" />
          <span>Remove selected {{ selectedQueueItemIds.size > 0 ? `(${selectedQueueItemIds.size})` : '' }}</span>
        </button>

        <button
          @click="openFileExistsModal"
          class="w-full flex items-center space-x-2 px-3 py-1.5 rounded-lg transition text-left hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <span class="w-4" />
          <span>Default file exists action...</span>
        </button>

        <!-- Set Priority Submenu -->
        <div
          class="relative"
          @mouseenter="setQueueSubmenu('prio')"
          @mouseleave="scheduleQueueSubmenuClose"
        >
          <div
            @click.stop="toggleQueueSubmenu('prio')"
            class="w-full flex items-center justify-between px-3 py-1.5 rounded-lg transition text-left hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
            :class="queueContextMenu.activeSubmenu === 'prio' ? 'bg-black/10 dark:bg-white/10 font-medium' : ''"
            :style="{ color: 'var(--color-text-main)' }"
          >
            <div class="flex items-center space-x-2">
              <span class="w-4" />
              <span>Set Priority</span>
            </div>
            <ChevronRight class="w-3.5 h-3.5 text-zinc-400" />
          </div>

          <div
            v-show="queueContextMenu.activeSubmenu === 'prio'"
            @mouseenter="setQueueSubmenu('prio')"
            @mouseleave="scheduleQueueSubmenuClose"
            :class="[
              'absolute min-w-[130px] rounded-xl border shadow-xl p-1 text-xs z-50',
              'top-0',
              queueContextMenu.openSubmenuLeft ? 'right-full mr-1' : 'left-full ml-1'
            ]"
            :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
          >
            <!-- Invisible bridge extending hit-zone to prevent diagonal mouse loss -->
            <div
              :class="[
                'absolute top-[-4px] bottom-[-4px] w-4',
                queueContextMenu.openSubmenuLeft ? '-right-3' : '-left-3'
              ]"
            />
            <button
              v-for="p in (['Lowest', 'Low', 'Normal', 'High', 'Highest'] as TransferPriority[])"
              :key="p"
              @click="handleSetPriority(p)"
              class="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-lg transition text-left hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
              :style="{ color: 'var(--color-text-main)' }"
            >
              <span>{{ p }}</span>
            </button>
          </div>
        </div>

        <!-- Action After Queue Completion Submenu -->
        <div
          class="relative"
          @mouseenter="setQueueSubmenu('compl')"
          @mouseleave="scheduleQueueSubmenuClose"
        >
          <div
            @click.stop="toggleQueueSubmenu('compl')"
            class="w-full flex items-center justify-between px-3 py-1.5 rounded-lg transition text-left hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
            :class="queueContextMenu.activeSubmenu === 'compl' ? 'bg-black/10 dark:bg-white/10 font-medium' : ''"
            :style="{ color: 'var(--color-text-main)' }"
          >
            <div class="flex items-center space-x-2">
              <span class="w-4 text-center text-sky-400">
                <Check v-if="queueCompletionAction !== 'nothing'" class="w-3.5 h-3.5" />
              </span>
              <span>Action after queue completion</span>
            </div>
            <ChevronRight class="w-3.5 h-3.5 text-zinc-400" />
          </div>

          <div
            v-show="queueContextMenu.activeSubmenu === 'compl'"
            @mouseenter="setQueueSubmenu('compl')"
            @mouseleave="scheduleQueueSubmenuClose"
            :class="[
              'absolute min-w-[195px] rounded-xl border shadow-xl p-1 text-xs z-50',
              'bottom-[-6px]',
              queueContextMenu.openSubmenuLeft ? 'right-full mr-1' : 'left-full ml-1'
            ]"
            :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
          >
            <!-- Invisible bridge extending hit-zone to prevent diagonal mouse loss -->
            <div
              :class="[
                'absolute top-[-6px] bottom-[-6px] w-4',
                queueContextMenu.openSubmenuLeft ? '-right-3' : '-left-3'
              ]"
            />
            <button
              @click="setQueueCompletionAction('nothing')"
              class="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-lg transition text-left hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
              :style="{ color: 'var(--color-text-main)' }"
            >
              <Check v-if="queueCompletionAction === 'nothing'" class="w-3.5 h-3.5 text-sky-400" />
              <span v-else class="w-3.5" />
              <span>Do nothing</span>
            </button>
            <button
              @click="setQueueCompletionAction('play_sound')"
              class="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-lg transition text-left hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
              :style="{ color: 'var(--color-text-main)' }"
            >
              <Check v-if="queueCompletionAction === 'play_sound'" class="w-3.5 h-3.5 text-sky-400" />
              <span v-else class="w-3.5" />
              <span>Play notification sound</span>
            </button>
            <button
              @click="setQueueCompletionAction('disconnect')"
              class="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-lg transition text-left hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
              :style="{ color: 'var(--color-text-main)' }"
            >
              <Check v-if="queueCompletionAction === 'disconnect'" class="w-3.5 h-3.5 text-sky-400" />
              <span v-else class="w-3.5" />
              <span>Disconnect from server</span>
            </button>
            <button
              @click="setQueueCompletionAction('close')"
              class="w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-lg transition text-left hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
              :style="{ color: 'var(--color-text-main)' }"
            >
              <Check v-if="queueCompletionAction === 'close'" class="w-3.5 h-3.5 text-sky-400" />
              <span v-else class="w-3.5" />
              <span>Close TermSFTP</span>
            </button>
          </div>
        </div>

        <button
          @click="exportQueueTransfers('active')"
          class="w-full flex items-center space-x-2 px-3 py-1.5 rounded-lg transition text-left hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
          :style="{ color: 'var(--color-text-muted)' }"
        >
          <span class="w-4" />
          <span>Export...</span>
        </button>
      </template>

      <!-- Successful & Failed Tabs Context Menu (Screenshot 4) -->
      <template v-else>
        <button
          @click="handleRemoveAllInTab"
          class="w-full flex items-center space-x-2 px-3 py-1.5 rounded-lg transition text-left hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <span class="w-4" />
          <span>Remove all</span>
        </button>

        <button
          @click="handleResetAndRequeueAll"
          class="w-full flex items-center space-x-2 px-3 py-1.5 rounded-lg transition text-left hover:bg-black/10 dark:hover:bg-white/10 font-medium text-sky-400 cursor-pointer"
        >
          <span class="w-4" />
          <span>Reset and requeue all</span>
        </button>

        <div class="h-px my-1" :style="{ backgroundColor: 'var(--color-border)' }" />

        <button
          @click="handleRemoveSelectedQueue"
          :disabled="selectedQueueItemIds.size === 0"
          class="w-full flex items-center space-x-2 px-3 py-1.5 rounded-lg transition text-left"
          :class="selectedQueueItemIds.size > 0 ? 'hover:bg-black/10 dark:hover:bg-white/10 text-red-400 cursor-pointer' : 'opacity-40 cursor-not-allowed'"
          :style="selectedQueueItemIds.size > 0 ? {} : { color: 'var(--color-text-muted)' }"
        >
          <span class="w-4" />
          <span>Remove selected {{ selectedQueueItemIds.size > 0 ? `(${selectedQueueItemIds.size})` : '' }}</span>
        </button>

        <button
          @click="handleResetAndRequeueSelected"
          :disabled="selectedQueueItemIds.size === 0"
          class="w-full flex items-center space-x-2 px-3 py-1.5 rounded-lg transition text-left"
          :class="selectedQueueItemIds.size > 0 ? 'hover:bg-black/10 dark:hover:bg-white/10 text-sky-400 font-medium cursor-pointer' : 'opacity-40 cursor-not-allowed'"
          :style="selectedQueueItemIds.size > 0 ? {} : { color: 'var(--color-text-muted)' }"
        >
          <span class="w-4" />
          <span>Reset and requeue selected files</span>
        </button>

        <div class="h-px my-1" :style="{ backgroundColor: 'var(--color-border)' }" />

        <button
          @click="sftpStore.autoRemoveSuccessful = !sftpStore.autoRemoveSuccessful; closeQueueContextMenu()"
          class="w-full flex items-center space-x-2 px-3 py-1.5 rounded-lg transition text-left hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <span class="w-4 text-center font-bold text-emerald-400">
            <Check v-if="sftpStore.autoRemoveSuccessful" class="w-3.5 h-3.5" />
          </span>
          <span>Automatically remove successful transfers</span>
        </button>

        <button
          @click="exportQueueTransfers(queueContextMenu.tab)"
          class="w-full flex items-center space-x-2 px-3 py-1.5 rounded-lg transition text-left hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
          :style="{ color: 'var(--color-text-muted)' }"
        >
          <span class="w-4" />
          <span>Export...</span>
        </button>
      </template>
    </div>

    <!-- Default File Exists Action Modal -->
    <div
      v-if="showFileExistsModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      @click.self="showFileExistsModal = false"
    >
      <div
        class="w-full max-w-sm rounded-xl border shadow-2xl p-4 space-y-4 animate-in fade-in zoom-in-95 duration-100"
        :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
      >
        <h4 class="text-sm font-semibold" :style="{ color: 'var(--color-text-main)' }">
          Default file exists action
        </h4>
        <p class="text-xs" :style="{ color: 'var(--color-text-muted)' }">
          Select default action when target file already exists during transfer:
        </p>

        <div class="space-y-2 text-xs">
          <label
            class="flex items-center space-x-2.5 p-2 rounded-lg border cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition"
            :style="{ borderColor: selectedDefaultConflict === 'ask' ? 'var(--color-accent)' : 'var(--color-border)' }"
          >
            <input type="radio" value="ask" v-model="selectedDefaultConflict" class="text-sky-500" />
            <div>
              <div class="font-medium" :style="{ color: 'var(--color-text-main)' }">Ask for action (Prompt)</div>
              <div class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">Display prompt dialog asking whether to overwrite or skip</div>
            </div>
          </label>

          <label
            class="flex items-center space-x-2.5 p-2 rounded-lg border cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition"
            :style="{ borderColor: selectedDefaultConflict === 'overwrite' ? 'var(--color-accent)' : 'var(--color-border)' }"
          >
            <input type="radio" value="overwrite" v-model="selectedDefaultConflict" class="text-sky-500" />
            <div>
              <div class="font-medium" :style="{ color: 'var(--color-text-main)' }">Overwrite file</div>
              <div class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">Always overwrite existing file on destination</div>
            </div>
          </label>

          <label
            class="flex items-center space-x-2.5 p-2 rounded-lg border cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition"
            :style="{ borderColor: selectedDefaultConflict === 'skip' ? 'var(--color-accent)' : 'var(--color-border)' }"
          >
            <input type="radio" value="skip" v-model="selectedDefaultConflict" class="text-sky-500" />
            <div>
              <div class="font-medium" :style="{ color: 'var(--color-text-main)' }">Skip file</div>
              <div class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">Leave existing destination file untouched</div>
            </div>
          </label>
        </div>

        <div class="flex items-center justify-end space-x-2 pt-2 border-t" :style="{ borderColor: 'var(--color-border)' }">
          <button
            @click="showFileExistsModal = false"
            class="px-3 py-1.5 rounded-lg text-xs transition cursor-pointer hover:bg-black/10 dark:hover:bg-white/10"
            :style="{ color: 'var(--color-text-muted)' }"
          >
            Cancel
          </button>
          <button
            @click="saveDefaultConflictAction"
            class="px-4 py-1.5 rounded-lg text-xs font-semibold text-white shadow-sm transition cursor-pointer"
            :style="{ backgroundColor: 'var(--color-accent)' }"
          >
            OK
          </button>
        </div>
      </div>
    </div>

    <!-- Custom Right-Click Context Menu -->
    <div
      v-if="contextMenu.show"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px`, backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
      class="fixed z-50 min-w-[200px] backdrop-blur-md rounded-xl border shadow-2xl p-1 text-xs select-none animate-in fade-in zoom-in-95 duration-75"
      @click.stop
    >
      <!-- LOCAL PANE MENU -->
      <template v-if="contextMenu.pane === 'local'">
        <!-- Upload -->
        <button
          v-if="props.sessionId && selectedLocalFiles.length > 0"
          @click="handleBatchUpload(selectedLocalFiles)"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg font-medium transition text-left hover:opacity-90"
          :style="{ color: 'var(--color-accent)' }"
        >
          <CatppuccinIcon name="upload" :size="15" />
          <span>Upload {{ selectedLocalFiles.length > 1 ? `(${selectedLocalFiles.length})` : '' }}</span>
        </button>

        <!-- Quick Look (Single File) -->
        <button
          v-if="selectedLocalFiles.length === 1 && !selectedLocalFiles[0].is_dir"
          @click="openQuickLook('local', selectedLocalFiles[0])"
          class="w-full flex items-center justify-between px-3 py-1.5 rounded-lg font-medium transition text-left hover:opacity-90"
          :style="{ color: 'var(--color-accent)' }"
        >
          <div class="flex items-center space-x-2.5">
            <Eye :size="15" />
            <span>Quick Look</span>
          </div>
          <span class="font-mono text-[10px] text-zinc-500">Space</span>
        </button>

        <!-- View / Edit (Single File) -->
        <button
          v-if="selectedLocalFiles.length === 1 && !selectedLocalFiles[0].is_dir"
          @click="openEditor('local', selectedLocalFiles[0])"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg font-medium transition text-left hover:opacity-90"
          :style="{ color: 'var(--color-accent)' }"
        >
          <FileCode :size="15" />
          <span>View / Edit</span>
        </button>

        <!-- Open in Default App (Single File) -->
        <button
          v-if="selectedLocalFiles.length === 1 && !selectedLocalFiles[0].is_dir"
          @click="handleOpenInDefaultApp(selectedLocalFiles[0].path)"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left hover:opacity-80"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <ExternalLink :size="15" />
          <span>Open in Default App</span>
        </button>

        <!-- Archive Operations (Local) -->
        <template v-if="selectedLocalFiles.length === 1 && isArchiveFile(selectedLocalFiles[0].name)">
          <div class="h-px my-1" :style="{ backgroundColor: 'var(--color-border)' }" />
          <button
            @click="handleExtractArchiveHere('local', selectedLocalFiles[0])"
            class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg font-medium transition text-left hover:opacity-90 text-emerald-400"
          >
            <Package :size="15" />
            <span>Extract Archive Here</span>
          </button>
          <button
            @click="openExtractToFolderModal('local', selectedLocalFiles[0])"
            class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left hover:opacity-80"
            :style="{ color: 'var(--color-text-main)' }"
          >
            <Folder :size="15" class="text-amber-400" />
            <span>Extract to Folder...</span>
          </button>
        </template>

        <button
          v-if="selectedLocalFiles.length > 0"
          @click="openCompressModal('local')"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left hover:opacity-80"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <Package :size="15" class="text-amber-400" />
          <span>Compress to Archive (.tar.gz / .zip)...</span>
        </button>

        <div v-if="selectedLocalFiles.length > 0" class="h-px my-1" :style="{ backgroundColor: 'var(--color-border)' }" />

        <button
          @click="openNewFile('local')"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left hover:opacity-80"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <CatppuccinIcon name="file" :size="15" />
          <span>New File</span>
        </button>

        <button
          @click="openNewFolder('local')"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left hover:opacity-80"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <CatppuccinIcon name="folder" :size="15" />
          <span>New Directory</span>
        </button>

        <button
          v-if="selectedLocalFiles.length === 1"
          @click="openRename('local', selectedLocalFiles[0])"
          class="w-full flex items-center justify-between px-3 py-1.5 rounded-lg transition text-left hover:opacity-80"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <div class="flex items-center space-x-2.5">
            <CatppuccinIcon name="rename" :size="15" />
            <span>Rename</span>
          </div>
          <span class="text-[10px] opacity-40 font-mono">F2</span>
        </button>

        <button
          v-if="selectedLocalFiles.length === 1"
          @click="handleCopyPath(selectedLocalFiles[0].path)"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left hover:opacity-80"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <CatppuccinIcon name="copy" :size="15" />
          <span>Copy Path</span>
        </button>

        <!-- Bookmark Folder -->
        <button
          v-if="selectedLocalFiles.length === 1 && selectedLocalFiles[0].is_dir"
          @click="toggleLocalBookmark(selectedLocalFiles[0].path)"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left hover:opacity-80"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <CatppuccinIcon :name="localBookmarks.includes(selectedLocalFiles[0].path) ? 'bookmark-filled' : 'bookmark'" :size="15" />
          <span>{{ localBookmarks.includes(selectedLocalFiles[0].path) ? 'Remove Bookmark' : 'Bookmark Folder' }}</span>
        </button>
        <button
          v-else-if="selectedLocalFiles.length === 0"
          @click="toggleLocalBookmark(sftpStore.localPath)"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left hover:opacity-80"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <CatppuccinIcon :name="isLocalBookmarked ? 'bookmark-filled' : 'bookmark'" :size="15" />
          <span>{{ isLocalBookmarked ? 'Remove Current Folder from Bookmarks' : 'Bookmark Current Folder' }}</span>
        </button>

        <button
          v-if="props.sessionId"
          @click="toggleComparison(); closeContextMenu()"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left hover:opacity-80"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <GitCompare :size="15" class="text-indigo-400" />
          <span>{{ isComparing ? 'Exit Directory Comparison' : 'Compare Directories' }}</span>
        </button>

        <div class="h-px my-1" :style="{ backgroundColor: 'var(--color-border)' }" />

        <button
          @click="selectAll('local'); closeContextMenu()"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left hover:opacity-80"
          :style="{ color: 'var(--color-text-muted)' }"
        >
          <CatppuccinIcon name="select-all" :size="15" />
          <span>Select All (Ctrl+A)</span>
        </button>

        <div v-if="selectedLocalFiles.length > 0" class="h-px my-1" :style="{ backgroundColor: 'var(--color-border)' }" />

        <button
          v-if="selectedLocalFiles.length > 0"
          @click="handleBatchDeleteLocal(selectedLocalFiles)"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-red-400 hover:bg-red-950/60 transition text-left"
        >
          <CatppuccinIcon name="delete" :size="15" />
          <span>Delete {{ selectedLocalFiles.length > 1 ? `(${selectedLocalFiles.length})` : '' }}</span>
        </button>

        <div class="h-px my-1" :style="{ backgroundColor: 'var(--color-border)' }" />

        <button
          @click="sftpStore.fetchLocalDir(sftpStore.localPath, { force: true }); closeContextMenu()"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left hover:opacity-80"
          :style="{ color: 'var(--color-text-muted)' }"
        >
          <CatppuccinIcon name="refresh" :size="15" />
          <span>Refresh</span>
        </button>
      </template>

      <!-- REMOTE PANE MENU -->
      <template v-else>
        <!-- Download -->
        <button
          v-if="props.sessionId && selectedRemoteFiles.length > 0"
          @click="handleBatchDownload(selectedRemoteFiles)"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg font-medium transition text-left hover:opacity-90"
          :style="{ color: 'var(--color-accent-secondary)' }"
        >
          <CatppuccinIcon name="download" :size="15" />
          <span>Download {{ selectedRemoteFiles.length > 1 ? `(${selectedRemoteFiles.length})` : '' }}</span>
        </button>

        <!-- Quick Look (Single File) -->
        <button
          v-if="props.sessionId && selectedRemoteFiles.length === 1 && !selectedRemoteFiles[0].is_dir"
          @click="openQuickLook('remote', selectedRemoteFiles[0])"
          class="w-full flex items-center justify-between px-3 py-1.5 rounded-lg font-medium transition text-left hover:opacity-90"
          :style="{ color: 'var(--color-accent-secondary)' }"
        >
          <div class="flex items-center space-x-2.5">
            <Eye :size="15" />
            <span>Quick Look</span>
          </div>
          <span class="font-mono text-[10px] text-zinc-500">Space</span>
        </button>

        <!-- View / Edit (Single File) -->
        <button
          v-if="props.sessionId && selectedRemoteFiles.length === 1 && !selectedRemoteFiles[0].is_dir"
          @click="openEditor('remote', selectedRemoteFiles[0])"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg font-medium transition text-left hover:opacity-90"
          :style="{ color: 'var(--color-accent-secondary)' }"
        >
          <FileCode :size="15" />
          <span>View / Edit</span>
        </button>

        <!-- File Permissions (chmod)... (Single Item) -->
        <button
          v-if="props.sessionId && selectedRemoteFiles.length === 1"
          @click="openPermissions(selectedRemoteFiles[0])"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left hover:opacity-80"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <Shield :size="15" class="text-emerald-400" />
          <span>File Permissions (chmod)...</span>
        </button>

        <!-- Open in Terminal -->
        <button
          v-if="props.sessionId && (selectedRemoteFiles.length === 0 || (selectedRemoteFiles.length === 1 && selectedRemoteFiles[0].is_dir))"
          @click="handleOpenInTerminal(selectedRemoteFiles.length === 1 ? selectedRemoteFiles[0].path : sftpStore.remotePath)"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left hover:opacity-80"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <Terminal :size="15" class="text-cyan-400" />
          <span>Open in Terminal</span>
        </button>

        <!-- Archive Operations (Remote via SSH) -->
        <template v-if="props.sessionId && selectedRemoteFiles.length === 1 && isArchiveFile(selectedRemoteFiles[0].name)">
          <div class="h-px my-1" :style="{ backgroundColor: 'var(--color-border)' }" />
          <button
            @click="handleExtractArchiveHere('remote', selectedRemoteFiles[0])"
            class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg font-medium transition text-left hover:opacity-90 text-emerald-400"
          >
            <Package :size="15" />
            <span>Extract Archive Here</span>
          </button>
          <button
            @click="openExtractToFolderModal('remote', selectedRemoteFiles[0])"
            class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left hover:opacity-80"
            :style="{ color: 'var(--color-text-main)' }"
          >
            <Folder :size="15" class="text-amber-400" />
            <span>Extract to Folder...</span>
          </button>
        </template>

        <button
          v-if="props.sessionId && selectedRemoteFiles.length > 0"
          @click="openCompressModal('remote')"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left hover:opacity-80"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <Package :size="15" class="text-amber-400" />
          <span>Compress to Archive (.tar.gz / .zip)...</span>
        </button>

        <div v-if="props.sessionId && selectedRemoteFiles.length > 0" class="h-px my-1" :style="{ backgroundColor: 'var(--color-border)' }" />

        <button
          v-if="props.sessionId"
          @click="openNewFile('remote')"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left hover:opacity-80"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <CatppuccinIcon name="file" :size="15" />
          <span>New File</span>
        </button>

        <button
          v-if="props.sessionId"
          @click="openNewFolder('remote')"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left hover:opacity-80"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <CatppuccinIcon name="folder" :size="15" />
          <span>New Directory</span>
        </button>

        <button
          v-if="selectedRemoteFiles.length === 1"
          @click="openRename('remote', selectedRemoteFiles[0])"
          class="w-full flex items-center justify-between px-3 py-1.5 rounded-lg transition text-left hover:opacity-80"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <div class="flex items-center space-x-2.5">
            <CatppuccinIcon name="rename" :size="15" />
            <span>Rename</span>
          </div>
          <span class="text-[10px] opacity-40 font-mono">F2</span>
        </button>

        <button
          v-if="selectedRemoteFiles.length === 1"
          @click="handleCopyPath(selectedRemoteFiles[0].path)"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left hover:opacity-80"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <CatppuccinIcon name="copy" :size="15" />
          <span>Copy Path</span>
        </button>

        <!-- Bookmark Folder -->
        <button
          v-if="props.sessionId && selectedRemoteFiles.length === 1 && selectedRemoteFiles[0].is_dir"
          @click="toggleRemoteBookmark(selectedRemoteFiles[0].path)"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left hover:opacity-80"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <CatppuccinIcon :name="remoteBookmarks.includes(selectedRemoteFiles[0].path) ? 'bookmark-filled' : 'bookmark'" :size="15" />
          <span>{{ remoteBookmarks.includes(selectedRemoteFiles[0].path) ? 'Remove Bookmark' : 'Bookmark Folder' }}</span>
        </button>
        <button
          v-else-if="props.sessionId && selectedRemoteFiles.length === 0"
          @click="toggleRemoteBookmark(sftpStore.remotePath)"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left hover:opacity-80"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <CatppuccinIcon :name="isRemoteBookmarked ? 'bookmark-filled' : 'bookmark'" :size="15" />
          <span>{{ isRemoteBookmarked ? 'Remove Current Folder from Bookmarks' : 'Bookmark Current Folder' }}</span>
        </button>

        <button
          v-if="props.sessionId"
          @click="toggleComparison(); closeContextMenu()"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left hover:opacity-80"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <GitCompare :size="15" class="text-indigo-400" />
          <span>{{ isComparing ? 'Exit Directory Comparison' : 'Compare Directories' }}</span>
        </button>

        <div class="h-px my-1" :style="{ backgroundColor: 'var(--color-border)' }" />

        <button
          v-if="props.sessionId"
          @click="selectAll('remote'); closeContextMenu()"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left hover:opacity-80"
          :style="{ color: 'var(--color-text-muted)' }"
        >
          <CatppuccinIcon name="select-all" :size="15" />
          <span>Select All (Ctrl+A)</span>
        </button>

        <div v-if="selectedRemoteFiles.length > 0" class="h-px my-1" :style="{ backgroundColor: 'var(--color-border)' }" />

        <button
          v-if="selectedRemoteFiles.length > 0"
          @click="handleBatchDeleteRemote(selectedRemoteFiles)"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-red-400 hover:bg-red-950/60 transition text-left"
        >
          <CatppuccinIcon name="delete" :size="15" />
          <span>Delete {{ selectedRemoteFiles.length > 1 ? `(${selectedRemoteFiles.length})` : '' }}</span>
        </button>

        <div class="h-px my-1" :style="{ backgroundColor: 'var(--color-border)' }" />

        <button
          v-if="props.sessionId"
          @click="sftpStore.fetchRemoteDir(props.sessionId, sftpStore.remotePath, { force: true }); closeContextMenu()"
          class="w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left hover:opacity-80"
          :style="{ color: 'var(--color-text-muted)' }"
        >
          <CatppuccinIcon name="refresh" :size="15" />
          <span>Refresh</span>
        </button>
      </template>
    </div>

    <!-- Rename Modal -->
    <div
      v-if="showRenameModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      @click.self="showRenameModal = false"
    >
      <div
        class="w-full max-w-xs rounded-xl border shadow-2xl p-4 space-y-3 animate-in fade-in zoom-in-95 duration-100"
        :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
      >
        <h4 class="text-xs font-semibold flex items-center space-x-1.5" :style="{ color: 'var(--color-text-main)' }">
          <CatppuccinIcon name="rename" :size="14" />
          <span>Rename Item ({{ renameTarget === 'local' ? 'Local' : 'Remote' }})</span>
        </h4>
        <input
          ref="renameInputRef"
          v-model="renameNewName"
          @keydown.enter.prevent="submitRename"
          @keyup.enter="submitRename"
          @keydown.esc="showRenameModal = false"
          placeholder="New name"
          class="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none"
          :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
        />
        <div class="flex justify-end space-x-2 pt-1">
          <button
            @click="showRenameModal = false"
            class="px-2.5 py-1 rounded text-xs transition"
            :style="{ color: 'var(--color-text-muted)' }"
          >
            Cancel
          </button>
          <button
            @click="submitRename"
            class="px-3 py-1 rounded text-white text-xs font-medium shadow"
            :style="{ backgroundColor: 'var(--color-accent)' }"
          >
            Rename
          </button>
        </div>
      </div>
    </div>

    <!-- Compress Archive Modal -->
    <div
      v-if="showCompressModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      @click.self="showCompressModal = false"
    >
      <div
        class="w-full max-w-sm rounded-xl border shadow-2xl p-4 space-y-3.5 animate-in fade-in zoom-in-95 duration-100"
        :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-2">
            <Package class="w-4 h-4 text-amber-400" />
            <h4 class="text-xs font-semibold" :style="{ color: 'var(--color-text-main)' }">
              Compress to Archive ({{ compressTarget === 'local' ? 'Local' : 'Remote' }})
            </h4>
          </div>
          <button @click="showCompressModal = false" class="opacity-60 hover:opacity-100 p-0.5">
            <X class="w-3.5 h-3.5" />
          </button>
        </div>

        <div class="text-[11px] opacity-75 truncate" :style="{ color: 'var(--color-text-muted)' }">
          Archiving {{ compressSelectedItems.length }} item{{ compressSelectedItems.length > 1 ? 's' : '' }} in {{ compressTarget === 'local' ? sftpStore.localPath : sftpStore.remotePath }}
        </div>

        <!-- Format selector tabs/pills -->
        <div class="space-y-1">
          <label class="text-[11px] font-medium" :style="{ color: 'var(--color-text-muted)' }">Archive Format</label>
          <div class="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              @click="selectCompressFormat('.tar.gz')"
              class="px-2.5 py-1.5 rounded-lg border text-left text-xs transition"
              :class="compressFormat === '.tar.gz' ? 'border-sky-500 bg-sky-500/10 text-sky-300 font-semibold ring-1 ring-sky-500/30' : 'border-zinc-700/50 hover:bg-white/5 text-zinc-300'"
            >
              <div class="flex items-center justify-between">
                <span>.tar.gz</span>
                <span class="text-[9px] px-1 py-0.5 rounded bg-sky-500/20 text-sky-300">Linux / Server</span>
              </div>
            </button>
            <button
              type="button"
              @click="selectCompressFormat('.zip')"
              class="px-2.5 py-1.5 rounded-lg border text-left text-xs transition"
              :class="compressFormat === '.zip' ? 'border-sky-500 bg-sky-500/10 text-sky-300 font-semibold ring-1 ring-sky-500/30' : 'border-zinc-700/50 hover:bg-white/5 text-zinc-300'"
            >
              <div class="flex items-center justify-between">
                <span>.zip</span>
                <span class="text-[9px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-300">Universal</span>
              </div>
            </button>
          </div>
        </div>

        <div class="space-y-1">
          <label class="text-[11px] font-medium" :style="{ color: 'var(--color-text-muted)' }">Archive Name</label>
          <input
            ref="compressInputRef"
            v-model="compressArchiveName"
            @keyup.enter="submitCompress"
            @keydown.esc="showCompressModal = false"
            placeholder="archive.tar.gz"
            class="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none font-mono"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
          />
        </div>

        <div class="flex justify-end space-x-2 pt-1">
          <button
            @click="showCompressModal = false"
            class="px-2.5 py-1 rounded text-xs transition"
            :style="{ color: 'var(--color-text-muted)' }"
          >
            Cancel
          </button>
          <button
            @click="submitCompress"
            :disabled="isCompressingArchive"
            class="px-3.5 py-1 rounded text-white text-xs font-medium shadow flex items-center space-x-1.5"
            :style="{ backgroundColor: 'var(--color-accent)' }"
          >
            <RotateCw v-if="isCompressingArchive" class="w-3.5 h-3.5 animate-spin" />
            <span>{{ isCompressingArchive ? 'Compressing...' : 'Create Archive' }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Extract to Subfolder Modal -->
    <div
      v-if="showExtractModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      @click.self="showExtractModal = false"
    >
      <div
        class="w-full max-w-sm rounded-xl border shadow-2xl p-4 space-y-3.5 animate-in fade-in zoom-in-95 duration-100"
        :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-2">
            <Package class="w-4 h-4 text-emerald-400" />
            <h4 class="text-xs font-semibold" :style="{ color: 'var(--color-text-main)' }">
              Extract to Subfolder ({{ extractTarget === 'local' ? 'Local' : 'Remote' }})
            </h4>
          </div>
          <button @click="showExtractModal = false" class="opacity-60 hover:opacity-100 p-0.5">
            <X class="w-3.5 h-3.5" />
          </button>
        </div>

        <div class="space-y-1">
          <label class="text-[11px] font-medium" :style="{ color: 'var(--color-text-muted)' }">Subfolder Name</label>
          <input
            ref="extractInputRef"
            v-model="extractSubfolderName"
            @keyup.enter="submitExtractToFolder"
            @keydown.esc="showExtractModal = false"
            placeholder="folder-name"
            class="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none font-mono"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
          />
        </div>

        <div class="flex justify-end space-x-2 pt-1">
          <button
            @click="showExtractModal = false"
            class="px-2.5 py-1 rounded text-xs transition"
            :style="{ color: 'var(--color-text-muted)' }"
          >
            Cancel
          </button>
          <button
            @click="submitExtractToFolder"
            :disabled="isExtractingArchive"
            class="px-3.5 py-1 rounded text-white text-xs font-medium shadow flex items-center space-x-1.5"
            :style="{ backgroundColor: 'var(--color-accent)' }"
          >
            <RotateCw v-if="isExtractingArchive" class="w-3.5 h-3.5 animate-spin" />
            <span>{{ isExtractingArchive ? 'Extracting...' : 'Extract' }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- New Directory Modal -->
    <div
      v-if="showNewFolderModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      @click.self="showNewFolderModal = false"
    >
      <div
        class="w-full max-w-xs rounded-xl border shadow-2xl p-4 space-y-3"
        :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
      >
        <div class="flex items-center space-x-2">
          <CatppuccinIcon name="folder" :size="16" />
          <h4 class="text-xs font-semibold" :style="{ color: 'var(--color-text-main)' }">
            Create New Directory ({{ newFolderTarget === 'local' ? 'Local' : 'Remote' }})
          </h4>
        </div>
        <input
          ref="newFolderInputRef"
          v-model="newFolderName"
          @keyup.enter="submitNewFolder"
          @keydown.esc="showNewFolderModal = false"
          placeholder="Directory name"
          class="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none"
          :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
        />
        <div class="flex justify-end space-x-2 pt-1">
          <button
            @click="showNewFolderModal = false"
            class="px-2.5 py-1 rounded text-xs transition"
            :style="{ color: 'var(--color-text-muted)' }"
          >
            Cancel
          </button>
          <button
            @click="submitNewFolder"
            class="px-3 py-1 rounded text-white text-xs font-medium shadow btn-accent"
          >
            Create
          </button>
        </div>
      </div>
    </div>

    <!-- New File Modal -->
    <div
      v-if="showNewFileModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      @click.self="showNewFileModal = false"
    >
      <div
        class="w-full max-w-xs rounded-xl border shadow-2xl p-4 space-y-3"
        :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
      >
        <div class="flex items-center space-x-2">
          <CatppuccinIcon name="file" :size="16" />
          <h4 class="text-xs font-semibold" :style="{ color: 'var(--color-text-main)' }">
            Create New File ({{ newFileTarget === 'local' ? 'Local' : 'Remote' }})
          </h4>
        </div>
        <input
          ref="newFileInputRef"
          v-model="newFileName"
          @keyup.enter="submitNewFile"
          @keydown.esc="showNewFileModal = false"
          placeholder="e.g. index.ts, config.json"
          class="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none"
          :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
        />
        <div class="flex justify-end space-x-2 pt-1">
          <button
            @click="showNewFileModal = false"
            class="px-2.5 py-1 rounded text-xs transition"
            :style="{ color: 'var(--color-text-muted)' }"
          >
            Cancel
          </button>
          <button
            @click="submitNewFile"
            class="px-3 py-1 rounded text-white text-xs font-medium shadow btn-accent"
          >
            Create
          </button>
        </div>
      </div>
    </div>
    <!-- Conflict Resolution Modal -->
    <div
      v-if="sftpStore.activeConflictDialog?.show"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div
        class="w-full max-w-md rounded-2xl border shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95 duration-100"
        :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
      >
        <div class="flex items-start space-x-3">
          <div class="w-10 h-10 rounded-xl bg-amber-950/60 border border-amber-600/40 flex items-center justify-center text-xl flex-shrink-0">
            ⚠️
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="text-sm font-semibold" :style="{ color: 'var(--color-text-main)' }">
              File Already Exists
            </h3>
            <p class="text-xs mt-0.5" :style="{ color: 'var(--color-text-muted)' }">
              An existing file was detected while {{ sftpStore.activeConflictDialog.direction === 'download' ? 'downloading to local' : 'uploading to remote' }}.
            </p>
          </div>
        </div>

        <div class="rounded-xl border p-3 space-y-2.5" :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }">
          <div class="font-mono text-xs font-semibold text-amber-300 truncate">
            {{ sftpStore.activeConflictDialog.fileName }}
          </div>

          <div class="grid grid-cols-2 gap-3 pt-1 border-t text-[11px]" :style="{ borderColor: 'var(--color-border)' }">
            <!-- Source Details -->
            <div class="space-y-1">
              <span class="font-medium uppercase tracking-wider text-[10px]" :style="{ color: 'var(--color-text-muted)' }">
                Source ({{ sftpStore.activeConflictDialog.direction === 'download' ? 'Remote' : 'Local' }})
              </span>
              <div class="font-mono" :style="{ color: 'var(--color-text-main)' }">
                {{ formatBytes(sftpStore.activeConflictDialog.source.size) }}
              </div>
              <div class="text-[10px]" :style="{ color: 'var(--color-text-muted)' }">
                {{ formatDate(sftpStore.activeConflictDialog.source.modified) }}
              </div>
            </div>

            <!-- Destination Details -->
            <div class="space-y-1 border-l pl-3" :style="{ borderColor: 'var(--color-border)' }">
              <span class="text-amber-500/90 font-medium uppercase tracking-wider text-[10px]">
                Target (Existing)
              </span>
              <div class="font-mono" :style="{ color: 'var(--color-text-main)' }">
                {{ formatBytes(sftpStore.activeConflictDialog.destination.size) }}
              </div>
              <div class="text-[10px]" :style="{ color: 'var(--color-text-muted)' }">
                {{ formatDate(sftpStore.activeConflictDialog.destination.modified) }}
              </div>
            </div>
          </div>
        </div>

        <!-- Buttons Actions -->
        <div class="flex items-center justify-between pt-1">
          <div class="flex items-center space-x-1.5">
            <button
              @click="sftpStore.resolveConflict('skip-all')"
              class="px-2.5 py-1.5 rounded-lg text-xs font-medium transition btn-theme-card"
              title="Skip this file and all subsequent existing files in this batch"
            >
              Skip All
            </button>
            <button
              @click="sftpStore.resolveConflict('skip')"
              class="px-3 py-1.5 rounded-lg text-xs font-medium transition btn-theme-card"
              title="Skip downloading/uploading this file"
            >
              Skip
            </button>
          </div>

          <div class="flex items-center space-x-1.5">
            <button
              @click="sftpStore.resolveConflict('overwrite-all')"
              class="px-2.5 py-1.5 rounded-lg text-xs font-medium transition border"
              :style="{ backgroundColor: 'var(--color-bg-hover)', borderColor: 'var(--color-border)', color: 'var(--color-accent-secondary)' }"
              title="Overwrite this file and all subsequent existing files in this batch"
            >
              Overwrite All
            </button>
            <button
              @click="sftpStore.resolveConflict('overwrite')"
              class="px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition btn-accent-secondary"
              title="Overwrite the existing file with the incoming file"
            >
              Overwrite
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Custom Delete Confirmation Lightbox Modal -->
    <div
      v-if="showDeleteConfirmModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150 select-none"
      @click.self="closeDeleteConfirm"
    >
      <div
        class="w-full max-w-sm border rounded-2xl shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150"
        :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
      >
        <div class="flex items-start space-x-3">
          <div class="w-10 h-10 rounded-xl bg-rose-950/60 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0 shadow-inner">
            <Trash2 class="w-5 h-5" />
          </div>
          <div class="flex-1 min-w-0">
            <h4 class="text-sm font-semibold" :style="{ color: 'var(--color-text-main)' }">
              {{
                deleteTarget?.files.length === 1
                  ? (deleteTarget.files[0].is_dir ? 'Delete Folder?' : 'Delete File?')
                  : `Delete ${deleteTarget?.files.length} Items?`
              }}
            </h4>
            <p class="text-xs mt-1 leading-relaxed" :style="{ color: 'var(--color-text-muted)' }">
              Are you sure you want to permanently delete
              <template v-if="deleteTarget?.files.length === 1">
                <span class="font-semibold text-rose-300">"{{ deleteTarget.files[0].name }}"</span>
              </template>
              <template v-else>
                these <span class="font-semibold text-rose-300">{{ deleteTarget?.files.length }} items</span>
              </template>
              from {{ deleteTarget?.pane === 'local' ? 'local disk' : 'the remote server' }}?
            </p>
          </div>
        </div>

        <!-- Selected Items Preview Box -->
        <div class="p-3 rounded-xl border space-y-2 text-xs" :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }">
          <!-- Single Item Details -->
          <div v-if="deleteTarget?.files.length === 1" class="space-y-1.5">
            <div class="flex items-center font-medium truncate" :style="{ color: 'var(--color-text-main)' }">
              <FileIcon :name="deleteTarget.files[0].name" :is-dir="deleteTarget.files[0].is_dir" :size="18" class="mr-2" />
              <span class="truncate font-mono text-[11px]">{{ deleteTarget.files[0].name }}</span>
            </div>
            <div class="flex items-center justify-between text-[11px] border-t pt-1.5" :style="{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }">
              <span>{{ getFileType(deleteTarget.files[0]) }}</span>
              <span class="font-mono">{{ deleteTarget.files[0].is_dir ? '-' : formatBytes(deleteTarget.files[0].size) }}</span>
            </div>
            <div class="text-[10px] font-mono truncate" :style="{ color: 'var(--color-text-muted)' }">
              {{ deleteTarget.files[0].path }}
            </div>
          </div>

          <!-- Multiple Items List Preview -->
          <div v-else class="space-y-1.5">
            <div class="text-[11px] font-semibold uppercase tracking-wider" :style="{ color: 'var(--color-text-muted)' }">
              Selected Items ({{ deleteTarget?.files.length }})
            </div>
            <div class="max-h-32 overflow-y-auto space-y-1 divide-y pr-1" :style="{ borderColor: 'var(--color-border)' }">
              <div
                v-for="item in deleteTarget?.files"
                :key="item.path"
                class="flex items-center justify-between pt-1 first:pt-0 text-[11px]"
              >
                <div class="flex items-center space-x-1.5 min-w-0 mr-2">
                  <FileIcon :name="item.name" :is-dir="item.is_dir" :size="14" />
                  <span class="truncate font-mono" :style="{ color: 'var(--color-text-main)' }">{{ item.name }}</span>
                </div>
                <span class="shrink-0 font-mono text-[10px]" :style="{ color: 'var(--color-text-muted)' }">
                  {{ item.is_dir ? 'Folder' : formatBytes(item.size) }}
                </span>
              </div>
            </div>
          </div>

          <!-- Directory Deletion Warning -->
          <div
            v-if="deleteTarget?.files.some(f => f.is_dir)"
            class="flex items-start text-amber-400/90 text-[11px] pt-1.5 border-t"
            :style="{ borderColor: 'var(--color-border)' }"
          >
            <AlertTriangle class="w-3.5 h-3.5 mr-1.5 shrink-0 mt-0.5 text-amber-400" />
            <span>Folder contents will also be recursively deleted. This cannot be undone.</span>
          </div>

          <!-- Fast rm -rf SSH option (Remote SFTP folders only) -->
          <label
            v-if="deleteTarget?.pane === 'remote' && deleteTarget?.files.some(f => f.is_dir)"
            class="flex items-start space-x-2 text-xs cursor-pointer select-none pt-2 border-t"
            :style="{ borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
          >
            <input
              type="checkbox"
              v-model="useFastRm"
              class="rounded border-zinc-700 bg-zinc-900 text-rose-500 focus:ring-0 cursor-pointer mt-0.5"
            />
            <div class="flex flex-col">
              <span class="font-medium text-[11px]">Use fast remote deletion (<code class="font-mono text-[10px] text-amber-300">rm -rf</code> via SSH)</span>
              <span class="text-[10px]" :style="{ color: 'var(--color-text-muted)' }">
                Recommended for massive directories (e.g. node_modules, vendor). Requires remote shell permissions.
              </span>
            </div>
          </label>
        </div>

        <!-- Action Buttons -->
        <div class="flex items-center justify-end space-x-2 pt-1">
          <button
            type="button"
            @click="closeDeleteConfirm"
            class="px-3.5 py-1.5 rounded-lg text-xs font-medium transition btn-theme-card cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            @click="executeDeleteFiles"
            class="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 shadow-md shadow-rose-950/50 flex items-center space-x-1.5 transition cursor-pointer"
          >
            <Trash2 class="w-3.5 h-3.5" />
            <span>{{ deleteTarget?.files.length === 1 ? 'Delete Permanently' : 'Delete All Selected' }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- File Editor Modal -->
  <FileEditorModal
    :show="showEditorModal"
    :session-id="props.sessionId"
    :target="editorTarget"
    :file-path="editorFilePath"
    :file-name="editorFileName"
    @close="showEditorModal = false"
    @saved="handleEditorSaved"
  />

  <!-- File Permissions (chmod) Modal -->
  <PermissionsModal
    :show="showPermissionsModal"
    :session-id="props.sessionId"
    :item="permissionsItem"
    @close="showPermissionsModal = false"
    @updated="handlePermissionsUpdated"
  />

  <SettingsModal :show="showSettingsModal" @close="showSettingsModal = false" />

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

