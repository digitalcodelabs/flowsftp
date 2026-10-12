import { ref, onMounted, onUnmounted, type Ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import {
  useSftpStore,
  type LocalFileEntry,
  type SftpFileEntry,
} from '../../../stores/sftp'

export interface DraggingState {
  source: 'local' | 'remote'
  files: (LocalFileEntry | SftpFileEntry)[]
}

export interface UseSftpDragDropOptions {
  active?: Ref<boolean | undefined> | (() => boolean | undefined)
  sessionId: Ref<string | null> | (() => string | null)
  localPaneRef: Ref<HTMLElement | null>
  remotePaneRef: Ref<HTMLElement | null>
  localParentPath: Ref<string | null>
  remoteParentPath: Ref<string | null>
  selectedLocalFiles: Ref<LocalFileEntry[]>
  selectedRemoteFiles: Ref<SftpFileEntry[]>
  selectedLocalPaths: Ref<Set<string>>
  selectedRemotePaths: Ref<Set<string>>
  lastLocalClickedIndex: Ref<number | null>
  lastRemoteClickedIndex: Ref<number | null>
  onBatchUpload: (files: LocalFileEntry[], destinationDir?: string) => Promise<void>
  onBatchDownload: (files: SftpFileEntry[], destinationDir?: string) => Promise<void>
}

export function useSftpDragDrop(options: UseSftpDragDropOptions) {
  const sftpStore = useSftpStore()

  const activeDragging = ref<DraggingState | null>(null)
  const isRemoteDragActive = ref(false)
  let remoteDragCounter = 0

  const isLocalDragActive = ref(false)
  let localDragCounter = 0

  const activeDropFolder = ref<{ pane: 'local' | 'remote'; path: string } | null>(null)
  let inMemoryDragPayload: DraggingState | null = null
  let unlistenDragDrop: (() => void) | null = null

  const getSessionId = (): string | null => {
    return typeof options.sessionId === 'function' ? options.sessionId() : options.sessionId.value
  }

  const isActive = (): boolean => {
    if (typeof options.active === 'function') {
      return options.active() !== false
    }
    if (options.active !== undefined) {
      return options.active.value !== false
    }
    return true
  }

  const createDragAvatar = (title: string, count: number, isUpload: boolean) => {
    const el = document.createElement('div')
    el.style.position = 'fixed'
    el.style.left = '-9999px'
    el.style.top = '-9999px'
    el.style.padding = '6px 12px'
    el.style.background = isUpload ? '#0284c7' : '#059669'
    el.style.color = '#ffffff'
    el.style.borderRadius = '6px'
    el.style.fontFamily = 'monospace'
    el.style.fontSize = '12px'
    el.style.fontWeight = 'bold'
    el.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)'
    el.style.display = 'flex'
    el.style.alignItems = 'center'
    el.style.gap = '6px'
    el.style.zIndex = '99999'
    el.style.pointerEvents = 'none'

    const arrow = isUpload ? '↑' : '↓'
    el.innerHTML = `<span>${arrow}</span><span>${title}</span>`
    if (count > 1) {
      el.innerHTML += `<span style="background:rgba(255,255,255,0.25);padding:1px 5px;border-radius:10px;font-size:10px;">+${count - 1}</span>`
    }
    document.body.appendChild(el)
    setTimeout(() => {
      if (document.body.contains(el)) {
        document.body.removeChild(el)
      }
    }, 100)
    return el
  }

  const handleLocalDragStart = (e: DragEvent, file: LocalFileEntry) => {
    if (!options.selectedLocalPaths.value.has(file.path)) {
      options.selectedLocalPaths.value = new Set([file.path])
      options.lastLocalClickedIndex.value = sftpStore.localFiles.findIndex((f) => f.path === file.path)
    }
    const filesToDrag =
      options.selectedLocalFiles.value.length > 0 && options.selectedLocalPaths.value.has(file.path)
        ? [...options.selectedLocalFiles.value]
        : [file]

    const payload: DraggingState = {
      source: 'local',
      files: filesToDrag,
    }
    activeDragging.value = payload
    inMemoryDragPayload = payload

    if (e.dataTransfer) {
      const jsonStr = JSON.stringify({
        type: 'flowsftp-drag',
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
    if (!options.selectedRemotePaths.value.has(file.path)) {
      options.selectedRemotePaths.value = new Set([file.path])
      options.lastRemoteClickedIndex.value = sftpStore.remoteFiles.findIndex((f) => f.path === file.path)
    }
    const filesToDrag =
      options.selectedRemoteFiles.value.length > 0 && options.selectedRemotePaths.value.has(file.path)
        ? [...options.selectedRemoteFiles.value]
        : [file]

    const payload: DraggingState = {
      source: 'remote',
      files: filesToDrag,
    }
    activeDragging.value = payload
    inMemoryDragPayload = payload

    if (e.dataTransfer) {
      const jsonStr = JSON.stringify({
        type: 'flowsftp-drag',
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
    if (options.remotePaneRef.value && related && options.remotePaneRef.value.contains(related)) {
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
    const sid = getSessionId()
    if (!sid) return

    const destDir = targetFolder?.pane === 'remote' ? targetFolder.path : sftpStore.remotePath

    // 1. In-memory drag state (100% reliable within webview)
    const dragPayload = activeDragging.value || inMemoryDragPayload
    if (dragPayload?.source === 'local') {
      const files = [...dragPayload.files] as LocalFileEntry[]
      activeDragging.value = null
      inMemoryDragPayload = null
      if (files.length > 0) {
        await options.onBatchUpload(files, destDir)
        return
      }
    }

    // 2. dataTransfer application/json or text/plain fallback
    const dataStr =
      e.dataTransfer?.getData('application/json') || e.dataTransfer?.getData('text/plain')
    if (dataStr) {
      try {
        const data = JSON.parse(dataStr)
        if (
          data.type === 'flowsftp-drag' &&
          data.source === 'local' &&
          Array.isArray(data.files) &&
          data.files.length > 0
        ) {
          await options.onBatchUpload(data.files, destDir)
          return
        }
      } catch {}
    }

    // 3. HTML5 files fallback (desktop files in WebView2)
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
          const entries = await invoke<LocalFileEntry[]>('sftp_get_paths_metadata', {
            paths: filePaths,
          })
          if (entries && entries.length > 0) {
            await options.onBatchUpload(entries, destDir)
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
    if (options.localPaneRef.value && related && options.localPaneRef.value.contains(related)) {
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

    const destDir = targetFolder?.pane === 'local' ? targetFolder.path : sftpStore.localPath

    // 1. In-memory drag state (100% reliable within webview)
    const dragPayload = activeDragging.value || inMemoryDragPayload
    if (dragPayload?.source === 'remote') {
      const files = [...dragPayload.files] as SftpFileEntry[]
      activeDragging.value = null
      inMemoryDragPayload = null
      if (files.length > 0 && getSessionId()) {
        await options.onBatchDownload(files, destDir)
        return
      }
    }

    // 2. dataTransfer fallback
    const dataStr =
      e.dataTransfer?.getData('application/json') || e.dataTransfer?.getData('text/plain')
    if (dataStr) {
      try {
        const data = JSON.parse(dataStr)
        if (
          data.type === 'flowsftp-drag' &&
          data.source === 'remote' &&
          Array.isArray(data.files) &&
          data.files.length > 0
        ) {
          if (getSessionId()) {
            await options.onBatchDownload(data.files, destDir)
          }
          return
        }
      } catch {}
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
  const handleFolderDragOver = (
    e: DragEvent,
    pane: 'local' | 'remote',
    entry: LocalFileEntry | SftpFileEntry
  ) => {
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

  const handleFolderDragLeave = (
    pane: 'local' | 'remote',
    entry: LocalFileEntry | SftpFileEntry
  ) => {
    if (
      activeDropFolder.value?.pane === pane &&
      activeDropFolder.value?.path === entry.path
    ) {
      activeDropFolder.value = null
    }
  }

  const handleParentFolderDragOver = (e: DragEvent, pane: 'local' | 'remote') => {
    const parentPath = pane === 'local' ? options.localParentPath.value : options.remoteParentPath.value
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
    const parentPath = pane === 'local' ? options.localParentPath.value : options.remoteParentPath.value
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
    const parentPath = pane === 'local' ? options.localParentPath.value : options.remoteParentPath.value
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

  const handleFolderDrop = async (
    e: DragEvent,
    pane: 'local' | 'remote',
    entry: LocalFileEntry | SftpFileEntry
  ) => {
    if (!entry.is_dir) return
    e.preventDefault()
    e.stopPropagation()
    activeDropFolder.value = null
    remoteDragCounter = 0
    localDragCounter = 0
    isRemoteDragActive.value = false
    isLocalDragActive.value = false

    const sid = getSessionId()

    // 1. In-memory drag state
    const dragPayload = activeDragging.value || inMemoryDragPayload
    if (dragPayload) {
      if (pane === 'remote' && dragPayload.source === 'local' && sid) {
        const files = [...dragPayload.files] as LocalFileEntry[]
        activeDragging.value = null
        inMemoryDragPayload = null
        await options.onBatchUpload(files, entry.path)
        return
      } else if (pane === 'local' && dragPayload.source === 'remote' && sid) {
        const files = [...dragPayload.files] as SftpFileEntry[]
        activeDragging.value = null
        inMemoryDragPayload = null
        await options.onBatchDownload(files, entry.path)
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
      } else if (pane === 'remote' && dragPayload.source === 'remote' && sid) {
        const files = [...dragPayload.files] as SftpFileEntry[]
        activeDragging.value = null
        inMemoryDragPayload = null
        const paths = files.map((f) => f.path)
        try {
          await invoke('sftp_move_remote_paths', {
            sessionId: sid,
            paths,
            targetDir: entry.path,
          })
          await sftpStore.fetchRemoteDir(sid, sftpStore.remotePath)
        } catch (err) {
          console.error('Failed to move remote files:', err)
        }
        return
      }
    }

    // 2. dataTransfer fallback
    const dataStr =
      e.dataTransfer?.getData('application/json') || e.dataTransfer?.getData('text/plain')
    if (dataStr) {
      try {
        const data = JSON.parse(dataStr)
        if (pane === 'remote' && sid) {
          if (
            data.type === 'flowsftp-drag' &&
            data.source === 'local' &&
            Array.isArray(data.files)
          ) {
            await options.onBatchUpload(data.files, entry.path)
            return
          } else if (
            data.type === 'flowsftp-drag' &&
            data.source === 'remote' &&
            Array.isArray(data.files)
          ) {
            const paths = data.files.map((f: any) => f.path).filter(Boolean)
            if (paths.length > 0) {
              await invoke('sftp_move_remote_paths', {
                sessionId: sid,
                paths,
                targetDir: entry.path,
              })
              await sftpStore.fetchRemoteDir(sid, sftpStore.remotePath)
            }
            return
          }
        } else if (pane === 'local') {
          if (
            data.type === 'flowsftp-drag' &&
            data.source === 'remote' &&
            Array.isArray(data.files)
          ) {
            if (sid) {
              await options.onBatchDownload(data.files, entry.path)
            }
            return
          } else if (
            data.type === 'flowsftp-drag' &&
            data.source === 'local' &&
            Array.isArray(data.files)
          ) {
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
      } catch {}
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
        } else if (pane === 'remote' && sid) {
          try {
            const entries = await invoke<LocalFileEntry[]>('sftp_get_paths_metadata', {
              paths: filePaths,
            })
            if (entries && entries.length > 0) {
              await options.onBatchUpload(entries, entry.path)
            }
          } catch (err) {
            console.error('Failed to upload files to folder:', err)
          }
        }
      }
    }
  }

  onMounted(() => {
    // Listen to OS desktop file drag & drop into webview
    try {
      getCurrentWebview()
        .onDragDropEvent(async (event) => {
          if (!isActive()) return

          const payload = event.payload
          if (payload.type === 'enter' || payload.type === 'over') {
            const cssX = payload.position.x / window.devicePixelRatio
            const cssY = payload.position.y / window.devicePixelRatio

            if (options.remotePaneRef.value) {
              const rect = options.remotePaneRef.value.getBoundingClientRect()
              if (
                cssX >= rect.left &&
                cssX <= rect.right &&
                cssY >= rect.top &&
                cssY <= rect.bottom
              ) {
                isRemoteDragActive.value = true
                isLocalDragActive.value = false
                return
              }
            }

            if (options.localPaneRef.value) {
              const rect = options.localPaneRef.value.getBoundingClientRect()
              if (
                cssX >= rect.left &&
                cssX <= rect.right &&
                cssY >= rect.top &&
                cssY <= rect.bottom
              ) {
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
              options.remotePaneRef.value &&
              (() => {
                const rect = options.remotePaneRef.value.getBoundingClientRect()
                return (
                  cssX >= rect.left &&
                  cssX <= rect.right &&
                  cssY >= rect.top &&
                  cssY <= rect.bottom
                )
              })()

            const isOverLocal =
              options.localPaneRef.value &&
              (() => {
                const rect = options.localPaneRef.value.getBoundingClientRect()
                return (
                  cssX >= rect.left &&
                  cssX <= rect.right &&
                  cssY >= rect.top &&
                  cssY <= rect.bottom
                )
              })()

            const targetFolder = activeDropFolder.value
              ? { ...activeDropFolder.value }
              : null

            isRemoteDragActive.value = false
            isLocalDragActive.value = false
            activeDropFolder.value = null

            const sid = getSessionId()

            if (isOverRemote && sid && payload.paths && payload.paths.length > 0) {
              try {
                const destDir =
                  targetFolder?.pane === 'remote' ? targetFolder.path : sftpStore.remotePath
                const entries = await invoke<LocalFileEntry[]>('sftp_get_paths_metadata', {
                  paths: payload.paths,
                })
                if (entries && entries.length > 0) {
                  await options.onBatchUpload(entries, destDir)
                }
              } catch (err) {
                console.error('Failed to resolve dropped desktop files:', err)
              }
            } else if (isOverLocal && payload.paths && payload.paths.length > 0) {
              try {
                const destDir =
                  targetFolder?.pane === 'local' ? targetFolder.path : sftpStore.localPath
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
  })

  onUnmounted(() => {
    if (unlistenDragDrop) {
      unlistenDragDrop()
      unlistenDragDrop = null
    }
  })

  return {
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
  }
}
