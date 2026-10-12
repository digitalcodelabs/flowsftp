import { ref, shallowRef, triggerRef, computed, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { TransferItem, TransferPriority } from './types'

export interface TransferQueueDeps {
  /** Clears the folder-scan progress banners; called when every transfer is cancelled. */
  clearFolderProgress: () => void
}

/**
 * The transfer queue: row buckets (active / completed / failed), progress flushing,
 * pause/resume, the concurrency limit, and cancel / clear / remove / priority helpers.
 * It knows nothing about how a transfer is executed; see the pipeline for that.
 */
export function useTransferQueue(deps: TransferQueueDeps) {
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
        const item = items[index++] as T
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
      for (const t of newTransfers) {
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
    for (const t of list) {
      if (t.speed_bytes_per_sec) sum += t.speed_bytes_per_sec
    }
    return sum
  })

  const totalActiveBytes = computed(() => {
    let sum = 0
    const list = activeTransfers.value
    for (const t of list) {
      sum += (t.total_bytes || 0)
    }
    return sum
  })

  const totalTransferredBytes = computed(() => {
    let sum = 0
    const list = activeTransfers.value
    for (const t of list) {
      sum += (t.bytes_transferred || 0)
    }
    return sum
  })

  const overallProgressPercent = computed(() => {
    if (totalActiveBytes.value <= 0) return 0
    return Math.min(100, Math.round((totalTransferredBytes.value / totalActiveBytes.value) * 100))
  })

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
    deps.clearFolderProgress()
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

  return {
    // state
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
    // settings & processing state
    maxSimultaneousTransfers,
    isQueueProcessing,
    autoRemoveSuccessful,
    isCancellingAll,
    activeWorkersNotifiers,
    // row bookkeeping
    flushNewTransfersNow,
    scheduleNewTransfersFlush,
    scheduleProgressFlush,
    completeTransferItem,
    failTransferItem,
    // processing control
    waitIfQueuePaused,
    pauseQueue,
    processQueue,
    toggleProcessQueue,
    runWithConcurrency,
    // clear / remove / cancel
    clearCompletedTransfers,
    clearFailedTransfers,
    clearAllTransfers,
    removeTransfer,
    removeTransfers,
    cancelTransfer,
    cancelAllTransfers,
    setPriority,
    stopAndRemoveAllQueued,
  }
}
