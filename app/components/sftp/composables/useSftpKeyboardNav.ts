import { onMounted, onUnmounted, type Ref } from 'vue'
import {
  useSftpStore,
  type LocalFileEntry,
  type SftpFileEntry,
} from '../../../stores/sftp'

export interface UseSftpKeyboardNavOptions {
  active?: Ref<boolean | undefined> | (() => boolean | undefined)
  sessionId: Ref<string | null> | (() => string | null)
  activePane: Ref<'local' | 'remote'>
  selectedLocalFiles: Ref<LocalFileEntry[]>
  selectedRemoteFiles: Ref<SftpFileEntry[]>
  selectedLocalPaths: Ref<Set<string>>
  selectedRemotePaths: Ref<Set<string>>
  localSelectionAnchor: Ref<number | null>
  remoteSelectionAnchor: Ref<number | null>
  lastLocalClickedIndex: Ref<number | null>
  lastRemoteClickedIndex: Ref<number | null>
  isLocalParentSelected: Ref<boolean>
  isRemoteParentSelected: Ref<boolean>
  localParentPath: Ref<string | null>
  remoteParentPath: Ref<string | null>
  filteredLocalFiles: Ref<LocalFileEntry[]>
  filteredRemoteFiles: Ref<SftpFileEntry[]>
  canNavigateLocalUp: Ref<boolean>
  canNavigateRemoteUp: Ref<boolean>
  showQuickLook: Ref<boolean>
  quickLookFile: Ref<LocalFileEntry | SftpFileEntry | null>
  showEditorModal: Ref<boolean>
  showDeleteConfirmModal: Ref<boolean>
  showLocalFilter: Ref<boolean>
  showRemoteFilter: Ref<boolean>
  localSearchQuery: Ref<string>
  remoteSearchQuery: Ref<string>
  isComparing: Ref<boolean>
  hideIdenticalFiles: Ref<boolean>
  localFilterInputRef: Ref<HTMLInputElement | null>
  remoteFilterInputRef: Ref<HTMLInputElement | null>
  onRenameSelected: () => void
  onDeleteLocal: (files: LocalFileEntry[]) => void
  onDeleteRemote: (files: SftpFileEntry[]) => void
  onToggleComparison: () => void
  onToggleFilter: (pane: 'local' | 'remote') => void
  onSelectAll: (pane: 'local' | 'remote') => void
  onOpenQuickLook: () => void
  onCloseDeleteConfirm: () => void
  onCloseContextMenu: () => void
  onCloseOtherModals: () => void
  onNavigateLocalUp: () => void
  onNavigateRemoteUp: () => void
  onLocalRowDoubleClick: (entry: LocalFileEntry) => void
  onRemoteRowDoubleClick: (entry: SftpFileEntry) => void
  onScrollToRow: (pane: 'local' | 'remote', index: number) => void
  isAnyModalOpen: () => boolean
}

export function isTypingInInput(e: KeyboardEvent | EventTarget | null): boolean {
  const target = (e && 'target' in e ? (e as KeyboardEvent).target : e) as HTMLElement | null
  if (!target) return false
  const tag = target.tagName?.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || target.isContentEditable) {
    return true
  }
  return !!target.closest?.('.monaco-editor')
}

export function useSftpKeyboardNav(options: UseSftpKeyboardNavOptions) {
  const sftpStore = useSftpStore()

  const isActive = (): boolean => {
    if (typeof options.active === 'function') {
      return options.active() !== false
    }
    if (options.active !== undefined) {
      return options.active.value !== false
    }
    return true
  }

  const applySelection = (
    isLocal: boolean,
    nextIndex: number,
    prevIndex: number | null,
    isShift: boolean
  ) => {
    const files = isLocal ? options.filteredLocalFiles.value : options.filteredRemoteFiles.value

    if (nextIndex === -1) {
      if (isLocal) {
        options.isLocalParentSelected.value = true
        options.selectedLocalPaths.value = new Set()
        options.lastLocalClickedIndex.value = -1
        options.localSelectionAnchor.value = -1
        sftpStore.selectedLocalPath = options.localParentPath.value || ''
        options.onScrollToRow('local', -1)
      } else {
        options.isRemoteParentSelected.value = true
        options.selectedRemotePaths.value = new Set()
        options.lastRemoteClickedIndex.value = -1
        options.remoteSelectionAnchor.value = -1
        sftpStore.selectedRemotePath = options.remoteParentPath.value || ''
        options.onScrollToRow('remote', -1)
      }
      return
    }

    if (nextIndex >= 0 && nextIndex < files.length) {
      const file = files[nextIndex]
      if (isLocal) {
        options.isLocalParentSelected.value = false
        if (isShift && prevIndex !== null && prevIndex >= 0) {
          const anchor = options.localSelectionAnchor.value ?? prevIndex
          const start = Math.min(anchor, nextIndex)
          const end = Math.max(anchor, nextIndex)
          const newSet = new Set<string>()
          for (let i = start; i <= end; i++) {
            if (files[i]) newSet.add(files[i].path)
          }
          options.selectedLocalPaths.value = newSet
          options.lastLocalClickedIndex.value = nextIndex
        } else {
          options.localSelectionAnchor.value = nextIndex
          options.selectedLocalPaths.value = new Set([file.path])
          options.lastLocalClickedIndex.value = nextIndex
        }
        sftpStore.selectedLocalPath = file.path
        options.onScrollToRow('local', nextIndex)
      } else {
        options.isRemoteParentSelected.value = false
        if (isShift && prevIndex !== null && prevIndex >= 0) {
          const anchor = options.remoteSelectionAnchor.value ?? prevIndex
          const start = Math.min(anchor, nextIndex)
          const end = Math.max(anchor, nextIndex)
          const newSet = new Set<string>()
          for (let i = start; i <= end; i++) {
            if (files[i]) newSet.add(files[i].path)
          }
          options.selectedRemotePaths.value = newSet
          options.lastRemoteClickedIndex.value = nextIndex
        } else {
          options.remoteSelectionAnchor.value = nextIndex
          options.selectedRemotePaths.value = new Set([file.path])
          options.lastRemoteClickedIndex.value = nextIndex
        }
        sftpStore.selectedRemotePath = file.path
        options.onScrollToRow('remote', nextIndex)
      }
    }
  }

  const focusFirstItem = (pane: 'local' | 'remote') => {
    const isLocal = pane === 'local'
    const files = isLocal ? options.filteredLocalFiles.value : options.filteredRemoteFiles.value
    if (files.length > 0) {
      applySelection(isLocal, 0, null, false)
      options.onScrollToRow(pane, 0)
      if (isLocal) {
        options.localFilterInputRef.value?.blur()
      } else {
        options.remoteFilterInputRef.value?.blur()
      }
    }
  }

  const handleKeyNavigation = (e: KeyboardEvent) => {
    if (!isActive()) return
    if (isTypingInInput(e) || options.isAnyModalOpen()) return

    // Tab: toggle active pane
    if (e.key === 'Tab') {
      e.preventDefault()
      const sid = typeof options.sessionId === 'function' ? options.sessionId() : options.sessionId.value
      if (sid) {
        options.activePane.value = options.activePane.value === 'local' ? 'remote' : 'local'
      } else {
        options.activePane.value = 'local'
      }
      return
    }

    // Backspace or Alt+ArrowUp: go to parent directory
    if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowUp')) {
      e.preventDefault()
      if (options.activePane.value === 'local' && options.canNavigateLocalUp.value) {
        options.onNavigateLocalUp()
      } else if (options.activePane.value === 'remote' && options.canNavigateRemoteUp.value) {
        options.onNavigateRemoteUp()
      }
      return
    }

    const isLocal = options.activePane.value === 'local'
    const files = isLocal ? options.filteredLocalFiles.value : options.filteredRemoteFiles.value
    const hasParent = isLocal ? options.canNavigateLocalUp.value : options.canNavigateRemoteUp.value

    if (files.length === 0 && !hasParent) return

    const minIndex = hasParent ? -1 : 0
    const maxIndex = files.length - 1

    let curr: number | null = null
    const isParentSelected = isLocal
      ? options.isLocalParentSelected.value
      : options.isRemoteParentSelected.value
    const lastIndex = isLocal
      ? options.lastLocalClickedIndex.value
      : options.lastRemoteClickedIndex.value
    const selectedPaths = isLocal
      ? options.selectedLocalPaths.value
      : options.selectedRemotePaths.value

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
      if (options.showQuickLook.value && files[nextIndex] && !files[nextIndex].is_dir) {
        options.quickLookFile.value = files[nextIndex]
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
      if (options.showQuickLook.value && files[nextIndex] && !files[nextIndex].is_dir) {
        options.quickLookFile.value = files[nextIndex]
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
          options.onNavigateLocalUp()
        } else {
          options.onNavigateRemoteUp()
        }
      } else if (curr !== null && files[curr]) {
        const entry = files[curr]
        if (isLocal) {
          options.onLocalRowDoubleClick(entry as LocalFileEntry)
        } else {
          options.onRemoteRowDoubleClick(entry as SftpFileEntry)
        }
      }
      return
    }
  }

  const handleGlobalKeyDown = (e: KeyboardEvent) => {
    if (!isActive()) return
    if (options.showEditorModal.value) {
      return
    }

    // F2: Rename selected item in active pane
    if (e.key === 'F2') {
      if (isTypingInInput(e)) return
      if (options.isAnyModalOpen()) return

      e.preventDefault()
      e.stopPropagation()
      options.onRenameSelected()
      return
    }

    // Delete / Del: Delete selected item(s) in active pane
    if (e.key === 'Delete' || e.key === 'Del') {
      if (isTypingInInput(e)) return
      if (options.isAnyModalOpen()) return

      e.preventDefault()
      e.stopPropagation()

      if (options.activePane.value === 'local' && options.selectedLocalFiles.value.length > 0) {
        options.onDeleteLocal(options.selectedLocalFiles.value)
      } else if (options.activePane.value === 'remote' && options.selectedRemoteFiles.value.length > 0) {
        options.onDeleteRemote(options.selectedRemoteFiles.value)
      }
      return
    }

    // Ctrl+Shift+C / Cmd+Shift+C: Toggle Directory Comparison
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
      e.preventDefault()
      e.stopPropagation()
      options.onToggleComparison()
      return
    }

    // Ctrl+F / Cmd+F: Toggle In-Pane Instant Live Filter
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      e.stopPropagation()
      options.onToggleFilter(options.activePane.value || 'remote')
      return
    }

    // Ctrl+A / Cmd+A: Select All in active pane
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      if (isTypingInInput(e)) return
      e.preventDefault()
      e.stopPropagation()
      options.onSelectAll(options.activePane.value || 'local')
      return
    }

    // Spacebar macOS-style Quick Look Trigger
    if (e.code === 'Space') {
      if (isTypingInInput(e)) return

      e.preventDefault()
      if (options.showQuickLook.value) {
        options.showQuickLook.value = false
      } else {
        options.onOpenQuickLook()
      }
      return
    }

    if (e.key === 'Escape') {
      if (options.showQuickLook.value) {
        options.showQuickLook.value = false
        return
      }
      if (options.showDeleteConfirmModal.value) {
        options.onCloseDeleteConfirm()
        return
      }
      if (options.showLocalFilter.value && options.localSearchQuery.value) {
        options.localSearchQuery.value = ''
        return
      }
      if (options.showRemoteFilter.value && options.remoteSearchQuery.value) {
        options.remoteSearchQuery.value = ''
        return
      }
      if (options.showLocalFilter.value) {
        options.showLocalFilter.value = false
        return
      }
      if (options.showRemoteFilter.value) {
        options.showRemoteFilter.value = false
        return
      }
      if (options.isComparing.value && options.hideIdenticalFiles.value) {
        options.hideIdenticalFiles.value = false
        return
      }
      if (options.isComparing.value) {
        options.isComparing.value = false
        return
      }
      options.onCloseContextMenu()
      options.onCloseOtherModals()
      if (sftpStore.activeConflictDialog?.show) {
        sftpStore.resolveConflict('skip')
      }
      return
    }

    handleKeyNavigation(e)
  }

  onMounted(() => {
    window.addEventListener('keydown', handleGlobalKeyDown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleGlobalKeyDown)
  })

  return {
    handleGlobalKeyDown,
    handleKeyNavigation,
    applySelection,
    focusFirstItem,
  }
}
