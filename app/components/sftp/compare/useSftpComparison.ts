import { ref, computed, type Ref } from 'vue'
import {
  useSftpStore,
  type SftpFileEntry,
  type LocalFileEntry,
} from '../../../stores/sftp'
import type {
  ComparisonItemInfo,
  ComparisonResult,
  CompareCriteria,
} from './types'

export interface UseSftpComparisonOptions {
  sessionId: Ref<string | null> | (() => string | null)
  onBatchUpload: (files: LocalFileEntry[]) => Promise<void>
  onBatchDownload: (files: SftpFileEntry[]) => Promise<void>
}

export function useSftpComparison(options: UseSftpComparisonOptions) {
  const sftpStore = useSftpStore()

  const isComparing = ref(false)
  const compareCriteria = ref<CompareCriteria>('size_and_time')
  const hideIdenticalFiles = ref(false)

  const getSessionId = (): string | null => {
    return typeof options.sessionId === 'function'
      ? options.sessionId()
      : options.sessionId.value
  }

  const toggleComparison = () => {
    if (!getSessionId()) return
    isComparing.value = !isComparing.value
  }

  const comparisonResult = computed<ComparisonResult | null>(() => {
    const sid = getSessionId()
    if (!isComparing.value || !sid) return null

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
          localMap.set(name, {
            status: 'identical',
            counterpartSize: rf.size,
            counterpartModified: rf.modified,
          })
          identical++
        } else if (!lf.is_dir && !rf.is_dir) {
          if (lf.size !== rf.size) {
            localMap.set(name, {
              status: 'size_different',
              counterpartSize: rf.size,
              counterpartModified: rf.modified,
            })
            sizeDifferent++
          } else if (compareCriteria.value === 'size_and_time') {
            const timeDiff = (lf.modified || 0) - (rf.modified || 0)
            if (timeDiff > 2) {
              localMap.set(name, {
                status: 'local_newer',
                counterpartSize: rf.size,
                counterpartModified: rf.modified,
              })
              localNewer++
            } else if (timeDiff < -2) {
              localMap.set(name, {
                status: 'remote_newer',
                counterpartSize: rf.size,
                counterpartModified: rf.modified,
              })
              remoteNewer++
            } else {
              localMap.set(name, {
                status: 'identical',
                counterpartSize: rf.size,
                counterpartModified: rf.modified,
              })
              identical++
            }
          } else {
            localMap.set(name, {
              status: 'identical',
              counterpartSize: rf.size,
              counterpartModified: rf.modified,
            })
            identical++
          }
        } else {
          localMap.set(name, {
            status: 'size_different',
            counterpartSize: rf.size,
            counterpartModified: rf.modified,
          })
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
        remoteMap.set(name, {
          status: localStatus,
          counterpartSize: lf.size,
          counterpartModified: lf.modified,
        })
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
    const sid = getSessionId()
    if (!comparisonResult.value || !sid) return
    const toUpload: LocalFileEntry[] = []
    for (const lf of sftpStore.localFiles) {
      const comp = comparisonResult.value.localMap.get(lf.name)
      if (
        comp &&
        (comp.status === 'local_only' ||
          comp.status === 'local_newer' ||
          comp.status === 'size_different')
      ) {
        toUpload.push(lf)
      }
    }
    if (toUpload.length > 0) {
      await options.onBatchUpload(toUpload)
    }
  }

  const syncRemoteToLocal = async () => {
    const sid = getSessionId()
    if (!comparisonResult.value || !sid) return
    const toDownload: SftpFileEntry[] = []
    for (const rf of sftpStore.remoteFiles) {
      const comp = comparisonResult.value.remoteMap.get(rf.name)
      if (
        comp &&
        (comp.status === 'remote_only' ||
          comp.status === 'remote_newer' ||
          comp.status === 'size_different')
      ) {
        toDownload.push(rf)
      }
    }
    if (toDownload.length > 0) {
      await options.onBatchDownload(toDownload)
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

  return {
    isComparing,
    compareCriteria,
    hideIdenticalFiles,
    toggleComparison,
    comparisonResult,
    syncLocalToRemote,
    syncRemoteToLocal,
    getLocalRowCompareStyle,
    getRemoteRowCompareStyle,
  }
}
