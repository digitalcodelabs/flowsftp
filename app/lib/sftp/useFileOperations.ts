import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import type { FileClipboardItem, LocalFileEntry, SftpFileEntry } from './types'
import { LOCAL_PANE, isRemotePane, paneFrom, remotePane, type PaneRef } from './pane'
import type { useDirectoryBrowser } from './useDirectoryBrowser'
import type { useTransferPipeline } from './useTransferPipeline'

type AnyEntry = LocalFileEntry | SftpFileEntry

export interface FileOperationsDeps {
  browser: ReturnType<typeof useDirectoryBrowser>
  pipeline: Pick<
    ReturnType<typeof useTransferPipeline>,
    'startBatchDownload' | 'startBatchUpload' | 'startBatchRemoteToRemoteTransfer'
  >
}

export interface DeleteOptions {
  /** Remote directories only: lets the backend report progress for this deletion. */
  deletionId?: string
  /** Do not reload the listing afterwards (the caller is deleting many items). */
  skipRefresh?: boolean
  /** Remote directories only: remove with a single remote `rm -rf`. */
  useFastRm?: boolean
}

function joinPath(base: string, name: string): string {
  return base.endsWith('/') ? `${base}${name}` : `${base}/${name}`
}

/**
 * File operations on either pane (create, delete, rename, duplicate, size, checksum,
 * symlink, archives, clipboard).
 *
 * The logic is written once against a PaneRef. The `by-pane` functions are the primary API;
 * the legacy `pane: 'local' | 'remote'` + `sessionId` signatures the UI still uses are thin
 * wrappers around them. Where an argument only makes sense for one kind of pane
 * (e.g. `parentDir`, which local panes ignore), that is stated on the function.
 */
export function useFileOperations(deps: FileOperationsDeps) {
  const {
    currentSessionId,
    remotePath,
    sessionRemotePaths,
    localPath,
    invalidateRemoteCache,
    invalidateLocalCache,
    fetchRemoteDir,
    fetchLocalDir,
  } = deps.browser
  const { startBatchDownload, startBatchUpload, startBatchRemoteToRemoteTransfer } = deps.pipeline

  /** The directory a remote pane is showing for a session. */
  function remoteDirOf(sessionId: string): string {
    return sessionRemotePaths.value[sessionId] || remotePath.value
  }

  /** Resolves the legacy pane + session pair, falling back to the active session. */
  function resolvePane(pane: 'local' | 'remote', sessionId?: string | null): PaneRef | null {
    return paneFrom(pane, sessionId || currentSessionId.value)
  }

  // ---------------------------------------------------------------------------
  // By-pane API
  // ---------------------------------------------------------------------------

  /** `parentDir` applies to remote panes only; a local folder is created in the current directory. */
  async function createFolder(pane: PaneRef, name: string, parentDir?: string) {
    if (isRemotePane(pane)) {
      const sessionId = pane.sessionId
      const basePath = parentDir || remoteDirOf(sessionId)
      await invoke('sftp_create_remote_dir', { sessionId, path: joinPath(basePath, name) })
      invalidateRemoteCache(sessionId, basePath)
      await fetchRemoteDir(sessionId, basePath, { force: true })
    } else {
      await invoke('sftp_create_local_dir', { path: joinPath(localPath.value, name) })
      invalidateLocalCache(localPath.value)
      await fetchLocalDir(localPath.value, { force: true })
    }
  }

  /** `parentDir` applies to remote panes only; a local file is created in the current directory. */
  async function createFile(pane: PaneRef, name: string, overwrite: boolean = false, parentDir?: string) {
    if (isRemotePane(pane)) {
      const sessionId = pane.sessionId
      const basePath = parentDir || remoteDirOf(sessionId)
      await invoke('sftp_create_remote_file', { sessionId, path: joinPath(basePath, name), overwrite })
      invalidateRemoteCache(sessionId, basePath)
      await fetchRemoteDir(sessionId, basePath, { force: true })
    } else {
      await invoke('sftp_create_local_file', { path: joinPath(localPath.value, name), overwrite })
      invalidateLocalCache(localPath.value)
      await fetchLocalDir(localPath.value, { force: true })
    }
  }

  async function deleteItem(pane: PaneRef, item: AnyEntry, opts: DeleteOptions = {}) {
    const { deletionId, skipRefresh = false, useFastRm = false } = opts
    if (isRemotePane(pane)) {
      const sessionId = pane.sessionId
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
    } else {
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
  }

  /** `parentDir` applies to remote panes only; a local rename refreshes the current directory. */
  async function renameItem(pane: PaneRef, oldPath: string, newPath: string, parentDir?: string) {
    if (isRemotePane(pane)) {
      const sessionId = pane.sessionId
      await invoke('sftp_rename_remote', { sessionId, oldPath, newPath })
      const basePath = parentDir || remoteDirOf(sessionId)
      invalidateRemoteCache(sessionId, basePath)
      invalidateRemoteCache(sessionId, oldPath)
      invalidateRemoteCache(sessionId, newPath)
      await fetchRemoteDir(sessionId, basePath, { force: true })
    } else {
      await invoke('sftp_rename_local', { oldPath, newPath })
      invalidateLocalCache(localPath.value)
      invalidateLocalCache(oldPath)
      invalidateLocalCache(newPath)
      await fetchLocalDir(localPath.value, { force: true })
    }
  }

  async function extractArchive(pane: PaneRef, archivePath: string, targetDir?: string): Promise<string> {
    if (isRemotePane(pane)) {
      const sessionId = pane.sessionId
      const res = await invoke<string>('sftp_extract_remote_archive', {
        sessionId,
        archivePath,
        targetDir: targetDir || null,
      })
      invalidateRemoteCache(sessionId, remotePath.value)
      await fetchRemoteDir(sessionId, remotePath.value, { force: true })
      return res
    }
    const res = await invoke<string>('sftp_extract_local_archive', {
      archivePath,
      targetDir: targetDir || null,
    })
    invalidateLocalCache(localPath.value)
    await fetchLocalDir(localPath.value, { force: true })
    return res
  }

  async function compressArchive(
    pane: PaneRef,
    parentDir: string,
    items: string[],
    archiveName: string
  ): Promise<string> {
    if (isRemotePane(pane)) {
      const sessionId = pane.sessionId
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
    const res = await invoke<string>('sftp_compress_local_archive', {
      parentDir,
      items,
      archiveName,
    })
    invalidateLocalCache(localPath.value)
    await fetchLocalDir(localPath.value, { force: true })
    return res
  }

  /** `parentDir` applies to remote panes only. */
  async function duplicate(pane: PaneRef, item: AnyEntry, parentDir?: string) {
    if (isRemotePane(pane)) {
      const sessionId = pane.sessionId
      await invoke('sftp_duplicate_remote_path', { sessionId, path: item.path, newName: null })
      const dir = parentDir || remoteDirOf(sessionId)
      invalidateRemoteCache(sessionId, dir)
      await fetchRemoteDir(sessionId, dir, { force: true })
    } else {
      await invoke('sftp_duplicate_local_path', { path: item.path, newName: null })
      await fetchLocalDir(localPath.value, { force: true })
    }
  }

  // Calculated Directory Sizes
  const calculatedDirSizes = ref<Record<string, number>>({})

  async function dirSize(pane: PaneRef, path: string): Promise<number> {
    const size = isRemotePane(pane)
      ? await invoke<number>('sftp_get_remote_dir_size', { sessionId: pane.sessionId, path })
      : await invoke<number>('sftp_get_local_dir_size', { path })
    calculatedDirSizes.value[path] = size
    return size
  }

  async function checksum(pane: PaneRef, path: string, algorithm: 'md5' | 'sha256'): Promise<string> {
    if (isRemotePane(pane)) {
      return await invoke<string>('sftp_calculate_remote_checksum', { sessionId: pane.sessionId, path, algorithm })
    }
    return await invoke<string>('sftp_calculate_local_checksum', { path, algorithm })
  }

  async function symlink(pane: PaneRef, target: string, linkPath: string): Promise<void> {
    if (isRemotePane(pane)) {
      const sessionId = pane.sessionId
      await invoke('sftp_create_remote_symlink', { sessionId, target, linkPath })
      const dir = remoteDirOf(sessionId)
      invalidateRemoteCache(sessionId, dir)
      await fetchRemoteDir(sessionId, dir, { force: true })
    } else {
      await invoke('sftp_create_local_symlink', { target, linkPath })
      await fetchLocalDir(localPath.value, { force: true })
    }
  }

  // File Clipboard (Copy / Cut / Paste)
  const clipboard = ref<FileClipboardItem | null>(null)

  function setClipboard(
    mode: 'copy' | 'cut',
    pane: 'local' | 'remote',
    files: AnyEntry[],
    sessionId?: string
  ) {
    if (!files || files.length === 0) return
    clipboard.value = {
      files: [...files],
      sourcePane: pane,
      mode,
      sessionId: pane === 'remote' ? (sessionId || currentSessionId.value) : undefined,
    }
  }

  /** Pastes the clipboard into `target`. `targetDir` defaults to the pane's current directory. */
  async function paste(target: PaneRef, targetDir?: string) {
    if (!clipboard.value || clipboard.value.files.length === 0) return
    const clip = clipboard.value
    const dest = targetDir || (isRemotePane(target) ? remoteDirOf(target.sessionId) : localPath.value)
    if (!dest) return

    try {
      if (clip.sourcePane === 'local' && !isRemotePane(target)) {
        const paths = clip.files.map((f) => f.path)
        if (clip.mode === 'cut') {
          await invoke('sftp_move_local_paths', { paths, targetDir: dest })
          clipboard.value = null
        } else {
          await invoke('sftp_copy_local_paths', { paths, targetDir: dest })
        }
        await fetchLocalDir(localPath.value, { force: true })
      } else if (clip.sourcePane === 'remote' && isRemotePane(target)) {
        const destSessionId = target.sessionId
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
                await deleteItem(remotePane(srcSessionId), f)
              } catch (delErr) {
                console.warn('Failed to delete source file after cut transfer:', delErr)
              }
            }
            clipboard.value = null
          }
        }
      } else if (clip.sourcePane === 'local' && isRemotePane(target)) {
        await startBatchUpload(target.sessionId, clip.files as LocalFileEntry[], dest)
        if (clip.mode === 'cut') {
          clipboard.value = null
        }
      } else if (clip.sourcePane === 'remote' && !isRemotePane(target)) {
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

  // ---------------------------------------------------------------------------
  // Legacy signatures (`pane: 'local' | 'remote'` + optional sessionId), kept so the UI
  // does not have to change. A remote pane without any session keeps its old meaning:
  // a silent no-op, except checksum (throws) and size (returns 0).
  // ---------------------------------------------------------------------------

  const createRemoteFolder = (sessionId: string, name: string, parentDir?: string) =>
    createFolder(remotePane(sessionId), name, parentDir)
  const createRemoteFile = (sessionId: string, name: string, overwrite: boolean = false, parentDir?: string) =>
    createFile(remotePane(sessionId), name, overwrite, parentDir)
  const createLocalFolder = (name: string) => createFolder(LOCAL_PANE, name)
  const createLocalFile = (name: string, overwrite: boolean = false) => createFile(LOCAL_PANE, name, overwrite)

  const deleteRemoteItem = (
    sessionId: string,
    item: SftpFileEntry,
    deletionId?: string,
    skipRefresh: boolean = false,
    useFastRm: boolean = false
  ) => deleteItem(remotePane(sessionId), item, { deletionId, skipRefresh, useFastRm })
  const deleteLocalItem = (item: LocalFileEntry, skipRefresh: boolean = false) =>
    deleteItem(LOCAL_PANE, item, { skipRefresh })

  const renameRemoteItem = (sessionId: string, oldPath: string, newPath: string, parentDir?: string) =>
    renameItem(remotePane(sessionId), oldPath, newPath, parentDir)
  const renameLocalItem = (oldPath: string, newPath: string) => renameItem(LOCAL_PANE, oldPath, newPath)

  const extractRemoteArchive = (sessionId: string, archivePath: string, targetDir?: string) =>
    extractArchive(remotePane(sessionId), archivePath, targetDir)
  const compressRemoteArchive = (sessionId: string, parentDir: string, items: string[], archiveName: string) =>
    compressArchive(remotePane(sessionId), parentDir, items, archiveName)
  const extractLocalArchive = (archivePath: string, targetDir?: string) =>
    extractArchive(LOCAL_PANE, archivePath, targetDir)
  const compressLocalArchive = (parentDir: string, items: string[], archiveName: string) =>
    compressArchive(LOCAL_PANE, parentDir, items, archiveName)

  function copyToClipboard(pane: 'local' | 'remote', files: AnyEntry[], sessionId?: string) {
    setClipboard('copy', pane, files, sessionId)
  }

  function cutToClipboard(pane: 'local' | 'remote', files: AnyEntry[], sessionId?: string) {
    setClipboard('cut', pane, files, sessionId)
  }

  async function pasteFromClipboard(targetPane: 'local' | 'remote', targetDir?: string, targetSessionId?: string) {
    const target = resolvePane(targetPane, targetSessionId)
    if (!target) return
    await paste(target, targetDir)
  }

  async function duplicateItem(pane: 'local' | 'remote', item: AnyEntry, sessionId?: string, parentDir?: string) {
    const target = resolvePane(pane, sessionId)
    if (target) await duplicate(target, item, parentDir)
  }

  async function calculateDirSize(pane: 'local' | 'remote', path: string, sessionId?: string): Promise<number> {
    const target = resolvePane(pane, sessionId)
    return target ? dirSize(target, path) : 0
  }

  async function calculateChecksum(
    pane: 'local' | 'remote',
    path: string,
    algorithm: 'md5' | 'sha256',
    sessionId?: string
  ): Promise<string> {
    const target = resolvePane(pane, sessionId)
    if (!target) throw new Error('No active session')
    return checksum(target, path, algorithm)
  }

  async function createSymlink(
    pane: 'local' | 'remote',
    target: string,
    linkPath: string,
    sessionId?: string
  ): Promise<void> {
    const resolved = resolvePane(pane, sessionId)
    if (resolved) await symlink(resolved, target, linkPath)
  }

  return {
    // by-pane API
    byPane: {
      createFolder,
      createFile,
      deleteItem,
      renameItem,
      extractArchive,
      compressArchive,
      duplicate,
      dirSize,
      checksum,
      symlink,
      paste,
    },
    // state
    clipboard,
    calculatedDirSizes,
    // legacy signatures
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
  }
}
