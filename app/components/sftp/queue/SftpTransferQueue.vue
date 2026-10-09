<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  Clock,
  Lock,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Check,
  CheckCircle2,
  Server,
  FileText,
} from 'lucide-vue-next'
import {
  useSftpStore,
  getServerUrlForSession,
  type TransferItem,
  type TransferPriority,
  type ConflictPolicy,
} from '../../../stores/sftp'
import { useSshStore } from '../../../stores/ssh'
import { formatBytes } from '../../../utils/formatters'
import SftpFileExistsModal from '../modals/SftpFileExistsModal.vue'

const props = withDefaults(
  defineProps<{
    sessionId: string | null
    show?: boolean
    tab?: 'active' | 'completed' | 'failed'
  }>(),
  {
    show: true,
    tab: 'active',
  }
)

const emit = defineEmits<{
  (e: 'update:show', val: boolean): void
  (e: 'update:tab', tab: 'active' | 'completed' | 'failed'): void
  (e: 'toast', message: string, isError?: boolean, isLoading?: boolean, duration?: number): void
}>()

const sftpStore = useSftpStore()
const sshStore = useSshStore()

const showTransferDrawer = computed({
  get: () => props.show,
  set: (val: boolean) => emit('update:show', val),
})

const transferTab = computed({
  get: () => props.tab,
  set: (val: 'active' | 'completed' | 'failed') => emit('update:tab', val),
})

// -------------------------------------------------------------
// Drawer Vertical Resize
// -------------------------------------------------------------
const DEFAULT_DRAWER_HEIGHT = 180
const MIN_DRAWER_HEIGHT = 80
const drawerHeight = ref(DEFAULT_DRAWER_HEIGHT)
const isResizingVertical = ref(false)

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
// Column Resizing
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

// -------------------------------------------------------------
// Virtual Scroller
// -------------------------------------------------------------
const isTransferActive = (item: TransferItem): boolean => {
  return !item.is_complete && (item.status === 'transferring' || (item.speed_bytes_per_sec || 0) > 0 || (item.bytes_transferred || 0) > 0)
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

const queueTimerTick = ref(Date.now())
let queueTimerInterval: any = null
let queueResizeObserver: ResizeObserver | null = null

const formatHms = (seconds: number): string => {
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
  return `${(bytesPerSec / (k * k * k)).toFixed(2)} GiB/s`
}

// -------------------------------------------------------------
// Row Selection & Context Menu
// -------------------------------------------------------------
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
  openSubmenuLeft?: boolean
}>({
  show: false,
  x: 0,
  y: 0,
  tab: 'active',
  activeSubmenu: null,
  openSubmenuLeft: false,
})

let queueSubmenuTimer: ReturnType<typeof setTimeout> | null = null

const setQueueSubmenu = (menu: 'priority' | 'completion' | null) => {
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
  }, 280)
}

const toggleQueueSubmenu = (menu: 'priority' | 'completion') => {
  if (queueSubmenuTimer) {
    clearTimeout(queueSubmenuTimer)
    queueSubmenuTimer = null
  }
  queueContextMenu.value.activeSubmenu = queueContextMenu.value.activeSubmenu === menu ? null : menu
}

const openQueueContextMenu = (e: MouseEvent, item?: TransferItem) => {
  e.preventDefault()
  e.stopPropagation()

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

// -------------------------------------------------------------
// Default File Exists Modal Triggered from Queue Menu
// -------------------------------------------------------------
const showFileExistsModal = ref(false)

const openFileExistsModal = () => {
  showFileExistsModal.value = true
  closeQueueContextMenu()
}

const handleSaveFileExistsAction = (policy: ConflictPolicy) => {
  sftpStore.conflictPolicy = policy
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
    emit('toast', 'Action after queue: Play notification sound', false, false, 2500)
  } else if (action === 'disconnect') {
    emit('toast', 'Action after queue: Disconnect from server', false, false, 2500)
  } else if (action === 'close') {
    emit('toast', 'Action after queue: Close Termsftp', false, false, 2500)
  } else {
    emit('toast', 'Action after queue: Do nothing', false, false, 2000)
  }
}

const handleQueueCompleted = async () => {
  if (queueCompletionAction.value === 'play_sound') {
    playNotificationSound()
    emit('toast', 'All transfers completed successfully!', false, false, 3500)
  } else if (queueCompletionAction.value === 'disconnect') {
    playNotificationSound()
    emit('toast', 'Queue complete: Disconnecting from server...', false, false, 3500)
    if (props.sessionId) {
      await sshStore.disconnect(props.sessionId)
    }
  } else if (queueCompletionAction.value === 'close') {
    playNotificationSound()
    emit('toast', 'Queue complete: Closing TermSFTP in 2 seconds...', false, false, 2000)
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

const handleWindowClick = () => {
  if (queueContextMenu.value.show) {
    closeQueueContextMenu()
  }
}

onMounted(() => {
  loadQueueColWidths()
  const savedHeight = localStorage.getItem('termsftp_drawer_height')
  if (savedHeight) {
    const h = parseInt(savedHeight, 10)
    if (!isNaN(h) && h >= MIN_DRAWER_HEIGHT) {
      drawerHeight.value = h
    }
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

  window.addEventListener('click', handleWindowClick)
})

onUnmounted(() => {
  if (queueTimerInterval) clearInterval(queueTimerInterval)
  if (queueResizeObserver) {
    queueResizeObserver.disconnect()
    queueResizeObserver = null
  }
  window.removeEventListener('click', handleWindowClick)
})

defineExpose({
  closeContextMenu: closeQueueContextMenu,
})
</script>

<template>
  <!-- Global Drag/Resize Overlays -->
  <div
    v-if="isResizingVertical"
    class="fixed inset-0 z-[99999] cursor-row-resize select-none pointer-events-auto"
  />
  <div
    v-if="isResizingQueueCol"
    class="fixed inset-0 z-[99999] cursor-col-resize select-none pointer-events-auto"
  />

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
      <!-- 1. QUEUED FILES TAB -->
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

      <!-- 2. FAILED TRANSFERS TAB -->
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

      <!-- 3. SUCCESSFUL TRANSFERS TAB -->
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

    <!-- FileZilla-Exact Bottom Tab & Status Bar -->
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

  <!-- FileZilla Queue Context Menu -->
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
    <!-- Queued Files Tab Context Menu -->
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
        @mouseenter="setQueueSubmenu('priority')"
        @mouseleave="scheduleQueueSubmenuClose"
      >
        <div
          @click.stop="toggleQueueSubmenu('priority')"
          class="w-full flex items-center justify-between px-3 py-1.5 rounded-lg transition text-left hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
          :class="queueContextMenu.activeSubmenu === 'priority' ? 'bg-black/10 dark:bg-white/10 font-medium' : ''"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <div class="flex items-center space-x-2">
            <span class="w-4" />
            <span>Set Priority</span>
          </div>
          <ChevronRight class="w-3.5 h-3.5 text-zinc-400" />
        </div>

        <div
          v-if="queueContextMenu.activeSubmenu === 'priority'"
          class="absolute top-0 w-36 rounded-lg border shadow-xl p-1 text-xs select-none backdrop-blur-md z-50 animate-in fade-in zoom-in-95 duration-75"
          :class="queueContextMenu.openSubmenuLeft ? 'right-full mr-1' : 'left-full ml-1'"
          :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
        >
          <div
            class="absolute top-0 bottom-0 w-3 pointer-events-auto"
            :class="queueContextMenu.openSubmenuLeft ? 'left-full' : 'right-full'"
          />
          <button
            v-for="prio in (['Highest', 'High', 'Normal', 'Low', 'Lowest'] as TransferPriority[])"
            :key="prio"
            @click="handleSetPriority(prio)"
            class="w-full flex items-center space-x-2 px-2.5 py-1 rounded-md transition text-left hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
            :style="{ color: 'var(--color-text-main)' }"
          >
            <span class="w-3.5 text-center text-sky-400 font-bold" />
            <span>{{ prio }}</span>
          </button>
        </div>
      </div>

      <!-- Action After Queue Completion Submenu -->
      <div
        class="relative"
        @mouseenter="setQueueSubmenu('completion')"
        @mouseleave="scheduleQueueSubmenuClose"
      >
        <div
          @click.stop="toggleQueueSubmenu('completion')"
          class="w-full flex items-center justify-between px-3 py-1.5 rounded-lg transition text-left hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
          :class="queueContextMenu.activeSubmenu === 'completion' ? 'bg-black/10 dark:bg-white/10 font-medium' : ''"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <div class="flex items-center space-x-2">
            <span class="w-4" />
            <span>Action after queue completion</span>
          </div>
          <ChevronRight class="w-3.5 h-3.5 text-zinc-400" />
        </div>

        <div
          v-if="queueContextMenu.activeSubmenu === 'completion'"
          class="absolute top-0 w-48 rounded-lg border shadow-xl p-1 text-xs select-none backdrop-blur-md z-50 animate-in fade-in zoom-in-95 duration-75"
          :class="queueContextMenu.openSubmenuLeft ? 'right-full mr-1' : 'left-full ml-1'"
          :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
        >
          <div
            class="absolute top-0 bottom-0 w-3 pointer-events-auto"
            :class="queueContextMenu.openSubmenuLeft ? 'left-full' : 'right-full'"
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
            <span>Play sound</span>
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

    <!-- Successful & Failed Tabs Context Menu -->
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
  <SftpFileExistsModal
    :show="showFileExistsModal"
    :model-value="sftpStore.conflictPolicy"
    @close="showFileExistsModal = false"
    @save="handleSaveFileExistsAction"
  />
</template>
