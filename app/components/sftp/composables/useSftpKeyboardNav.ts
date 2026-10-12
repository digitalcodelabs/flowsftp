import { onMounted, onUnmounted, type Ref } from 'vue'
import {
  useSftpStore,
  type LocalFileEntry,
  type SftpFileEntry,
} from '../../../stores/sftp'
import { useSettingsStore } from '../../../stores/settings'
import { matchesShortcut } from '../../../utils/keymap'

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
  onTogglePane?: () => void
  onEditPath?: () => void
  onRefresh?: (pane: 'local' | 'remote', both?: boolean) => void
  onTransferCopy?: () => void
  onTransferMove?: () => void
  onNewFolder?: (pane: 'local' | 'remote') => void
  onNavigateBack?: (pane: 'local' | 'remote') => void
  onNavigateForward?: (pane: 'local' | 'remote') => void
  isAnyModalOpen: () => boolean
}

export function isTypingInInput(e: KeyboardEvent | EventTarget | null): boolean {
  const target = (e && 'target' in e ? (e as KeyboardEvent).target : e) as HTMLElement | null
  if (!target) return false
  const tag = target.tagName?.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || target.isContentEditable) {
    return true
  }
  return (
    Boolean(target.closest?.('.cm-editor')) ||
    Boolean(target.closest?.('.monaco-editor')) ||
    Boolean(target.closest?.('.xterm')) ||
    Boolean(target.closest?.('.terminal'))
  )
}

export function useSftpKeyboardNav(options: UseSftpKeyboardNavOptions) {
  const sftpStore = useSftpStore()
  const settingsStore = useSettingsStore()

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

    // Ctrl+L / Cmd+L / editPath: Focus address/location bar for editing
    if (
      (settingsStore.keymaps.editPath && matchesShortcut(e, settingsStore.keymaps.editPath)) ||
      (!settingsStore.keymaps.editPath && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l')
    ) {
      if (options.isAnyModalOpen()) return

      e.preventDefault()
      e.stopPropagation()
      options.onEditPath?.()
      return
    }

    // Tab / Toggle Active Pane
    if (
      (settingsStore.keymaps.togglePane && matchesShortcut(e, settingsStore.keymaps.togglePane)) ||
      (!settingsStore.keymaps.togglePane && e.key === 'Tab')
    ) {
      if (isTypingInInput(e)) return
      if (options.isAnyModalOpen()) return

      e.preventDefault()
      e.stopPropagation()
      if (options.onTogglePane) {
        options.onTogglePane()
      } else {
        const sid = typeof options.sessionId === 'function' ? options.sessionId() : options.sessionId.value
        if (sid) {
          options.activePane.value = options.activePane.value === 'local' ? 'remote' : 'local'
        } else {
          options.activePane.value = 'local'
        }
      }
      return
    }

    // Refresh Active Pane (F5 / Ctrl+R / settingsStore.keymaps.refresh)
    const isRefreshKey =
      (settingsStore.keymaps.refresh && matchesShortcut(e, settingsStore.keymaps.refresh)) ||
      (!settingsStore.keymaps.refresh && e.key === 'F5') ||
      e.key === 'F5' ||
      ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r')

    if (isRefreshKey) {
      if (options.isAnyModalOpen()) return

      e.preventDefault()
      e.stopPropagation()
      const both = Boolean(e.ctrlKey || e.metaKey || e.shiftKey)
      options.onRefresh?.(options.activePane.value, both)
      return
    }

    // Transfer Copy to opposite pane
    if (
      settingsStore.keymaps.transferCopy &&
      matchesShortcut(e, settingsStore.keymaps.transferCopy)
    ) {
      if (isTypingInInput(e)) return
      if (options.isAnyModalOpen()) return

      e.preventDefault()
      e.stopPropagation()
      options.onTransferCopy?.()
      return
    }

    // F6 / Transfer Move to opposite pane
    if (
      (settingsStore.keymaps.transferMove && matchesShortcut(e, settingsStore.keymaps.transferMove)) ||
      (!settingsStore.keymaps.transferMove && e.key === 'F6')
    ) {
      if (isTypingInInput(e)) return
      if (options.isAnyModalOpen()) return

      e.preventDefault()
      e.stopPropagation()
      options.onTransferMove?.()
      return
    }

    // F7 / New Folder
    if (
      (settingsStore.keymaps.newFolder && matchesShortcut(e, settingsStore.keymaps.newFolder)) ||
      (!settingsStore.keymaps.newFolder && e.key === 'F7')
    ) {
      if (isTypingInInput(e)) return
      if (options.isAnyModalOpen()) return

      e.preventDefault()
      e.stopPropagation()
      options.onNewFolder?.(options.activePane.value)
      return
    }

    // History: Back (Alt+Left)
    if (
      (settingsStore.keymaps.navBack && matchesShortcut(e, settingsStore.keymaps.navBack)) ||
      (!settingsStore.keymaps.navBack && e.altKey && (e.key === 'ArrowLeft' || e.key === 'Left'))
    ) {
      if (isTypingInInput(e)) return
      if (options.isAnyModalOpen()) return

      e.preventDefault()
      e.stopPropagation()
      options.onNavigateBack?.(options.activePane.value)
      return
    }

    // History: Forward (Alt+Right)
    if (
      (settingsStore.keymaps.navForward && matchesShortcut(e, settingsStore.keymaps.navForward)) ||
      (!settingsStore.keymaps.navForward && e.altKey && (e.key === 'ArrowRight' || e.key === 'Right'))
    ) {
      if (isTypingInInput(e)) return
      if (options.isAnyModalOpen()) return

      e.preventDefault()
      e.stopPropagation()
      options.onNavigateForward?.(options.activePane.value)
      return
    }

    // Nav Up / Parent directory (Backspace / Alt+Up)
    if (
      (settingsStore.keymaps.navUp && matchesShortcut(e, settingsStore.keymaps.navUp)) ||
      (!settingsStore.keymaps.navUp && (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowUp')))
    ) {
      if (isTypingInInput(e)) return
      if (options.isAnyModalOpen()) return

      e.preventDefault()
      e.stopPropagation()
      if (options.activePane.value === 'local' && options.canNavigateLocalUp.value) {
        options.onNavigateLocalUp()
      } else if (options.activePane.value === 'remote' && options.canNavigateRemoteUp.value) {
        options.onNavigateRemoteUp()
      }
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

    // Delete / Del / F8: Delete selected item(s) in active pane
    if (
      (settingsStore.keymaps.deleteFiles && matchesShortcut(e, settingsStore.keymaps.deleteFiles)) ||
      (!settingsStore.keymaps.deleteFiles && (e.key === 'Delete' || e.key === 'Del' || e.key === 'F8')) ||
      e.key === 'Delete' || e.key === 'Del'
    ) {
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

    // Ctrl+C / Cmd+C: Copy selected files to clipboard
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'c') {
      if (isTypingInInput(e)) return
      if (options.isAnyModalOpen()) return
      e.preventDefault()
      e.stopPropagation()
      const pane = options.activePane.value
      const files = pane === 'local' ? options.selectedLocalFiles.value : options.selectedRemoteFiles.value
      if (files.length > 0) {
        sftpStore.copyToClipboard(pane, files)
        sftpStore.triggerTransferToast(`Copied ${files.length} item${files.length > 1 ? 's' : ''} to clipboard`)
      }
      return
    }

    // Ctrl+X / Cmd+X: Cut selected files to clipboard
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
      if (isTypingInInput(e)) return
      if (options.isAnyModalOpen()) return
      e.preventDefault()
      e.stopPropagation()
      const pane = options.activePane.value
      const files = pane === 'local' ? options.selectedLocalFiles.value : options.selectedRemoteFiles.value
      if (files.length > 0) {
        sftpStore.cutToClipboard(pane, files)
        sftpStore.triggerTransferToast(`Cut ${files.length} item${files.length > 1 ? 's' : ''} to clipboard`)
      }
      return
    }

    // Ctrl+V / Cmd+V: Paste from clipboard
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      if (isTypingInInput(e)) return
      if (options.isAnyModalOpen()) return
      e.preventDefault()
      e.stopPropagation()
      if (sftpStore.clipboard && sftpStore.clipboard.files.length > 0) {
        const pane = options.activePane.value
        sftpStore.pasteFromClipboard(pane).then(() => {
          sftpStore.triggerTransferToast('Pasted items successfully')
        }).catch((err: any) => {
          sftpStore.triggerTransferToast(`Paste failed: ${err?.message || err}`)
        })
      }
      return
    }

    // Ctrl+D / Cmd+D: Duplicate selected item
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      if (isTypingInInput(e)) return
      if (options.isAnyModalOpen()) return
      e.preventDefault()
      e.stopPropagation()
      const pane = options.activePane.value
      const files = pane === 'local' ? options.selectedLocalFiles.value : options.selectedRemoteFiles.value
      if (files.length === 1) {
        sftpStore.duplicateItem(pane, files[0]).then(() => {
          sftpStore.triggerTransferToast(`Duplicated ${files[0].name}`)
        }).catch((err: any) => {
          sftpStore.triggerTransferToast(`Duplicate failed: ${err?.message || err}`)
        })
      }
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
      if (options.isAnyModalOpen()) {
        options.onCloseOtherModals()
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
      if (options.activePane.value === 'local') {
        if (options.selectedLocalPaths.value.size > 0 || options.isLocalParentSelected.value) {
          options.selectedLocalPaths.value = new Set()
          sftpStore.selectedLocalPath = null
          options.isLocalParentSelected.value = false
          options.lastLocalClickedIndex.value = null
        }
      } else {
        if (options.selectedRemotePaths.value.size > 0 || options.isRemoteParentSelected.value) {
          options.selectedRemotePaths.value = new Set()
          sftpStore.selectedRemotePath = null
          options.isRemoteParentSelected.value = false
          options.lastRemoteClickedIndex.value = null
        }
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
