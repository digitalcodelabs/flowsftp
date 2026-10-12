import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

/**
 * End-to-end tests of the three transfer pipelines (upload, download, remote-to-remote)
 * against a fake Tauri backend. They pin the behaviour the shared pipeline must keep:
 * what gets invoked, what shows up in the queue, how conflicts and failures are handled.
 */

type Call = { cmd: string; args: any }

const calls: Call[] = []
let existingPaths = new Set<string>()
let failTransfersFor = new Set<string>()
let crawlRemote: any[] = []
let crawlLocal: any = { files: [], directories: [], ignored: [] }

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args: any) => {
    calls.push({ cmd, args })
    switch (cmd) {
      case 'sftp_check_conflict':
        return { exists: existingPaths.has(args.path), size: 5, modified: 500 }
      case 'sftp_upload':
        if (failTransfersFor.has(args.remotePath)) throw new Error(`upload failed: ${args.remotePath}`)
        return undefined
      case 'sftp_download':
        if (failTransfersFor.has(args.localPath)) throw new Error(`download failed: ${args.localPath}`)
        return undefined
      case 'sftp_transfer_remote_to_remote':
        if (failTransfersFor.has(args.destPath)) throw new Error(`r2r failed: ${args.destPath}`)
        return undefined
      case 'sftp_crawl_remote_paths':
        return crawlRemote
      case 'sftp_crawl_local_paths':
        return crawlLocal
      case 'sftp_list_local':
        return [args.dirPath ?? 'C:/local', []]
      case 'sftp_list_remote':
        return [args.path ?? '/remote', []]
      case 'sftp_get_git_status':
      case 'sftp_get_remote_git_status':
        return null
      default:
        return undefined
    }
  },
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}))

import { useSftpStore, type SftpFileEntry, type LocalFileEntry } from '../../app/stores/sftp'
import { useSettingsStore } from '../../app/stores/settings'
import { SKIPPED_MESSAGE } from '../../app/utils/transferItems'

const remoteFile = (name: string, dir = '/src', size = 10): SftpFileEntry => ({
  name, path: `${dir}/${name}`, is_dir: false, is_symlink: false, size, modified: 1, permissions: 0o644,
})
const remoteDir = (name: string, dir = '/src'): SftpFileEntry => ({ ...remoteFile(name, dir, 0), is_dir: true })
const localFile = (name: string, dir = 'C:/src', size = 10): LocalFileEntry => ({
  name, path: `${dir}/${name}`, is_dir: false, is_symlink: false, size, modified: 1,
})
const localDir = (name: string, dir = 'C:/src'): LocalFileEntry => ({ ...localFile(name, dir, 0), is_dir: true })

const callsTo = (cmd: string) => calls.filter((c) => c.cmd === cmd).map((c) => c.args)
const checkedPaths = () => callsTo('sftp_check_conflict').map((a) => a.path)

describe('transfer pipelines', () => {
  let store: ReturnType<typeof useSftpStore>

  beforeEach(() => {
    calls.length = 0
    existingPaths = new Set()
    failTransfersFor = new Set()
    crawlRemote = []
    crawlLocal = { files: [], directories: [], ignored: [] }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    setActivePinia(createPinia())
    store = useSftpStore()
    store.conflictPolicy = 'ask'
    store.localPath = 'C:/local'
    store.remotePath = '/remote'
    const settings = useSettingsStore()
    settings.enableTransferIgnoreFilter = false
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const answerNextDialog = async (decision: Parameters<typeof store.resolveConflict>[0]) => {
    await vi.waitFor(() => expect(store.activeConflictDialog?.show).toBe(true))
    const name = store.activeConflictDialog!.fileName
    store.resolveConflict(decision)
    return name
  }

  describe('upload', () => {
    it('uploads every root file to the right place and records them as completed', async () => {
      await store.startBatchUpload('s1', [localFile('a.txt'), localFile('b.txt')], '/remote/dir')

      const uploads = callsTo('sftp_upload')
      expect(uploads.map((u) => u.remotePath).sort()).toEqual(['/remote/dir/a.txt', '/remote/dir/b.txt'])
      expect(uploads[0]).toMatchObject({ sessionId: 's1', localPath: expect.stringContaining('C:/src/'), fileSize: 10, conflictAction: 'overwrite' })

      expect(store.completedTransfers.map((t) => t.file_name).sort()).toEqual(['a.txt', 'b.txt'])
      expect(store.completedTransfers.every((t) => t.direction === 'upload' && t.session_id === 's1')).toBe(true)
      expect(store.failedTransfers).toHaveLength(0)
    })

    it('leaves nothing behind in the active list once the batch is done', async () => {
      // Invariant guarding the debounced "new rows" flush: a row that finished before the
      // flush ran must not be re-added to the active list.
      await store.startBatchUpload('s1', [localFile('a.txt'), localFile('b.txt'), localFile('c.txt')], '/remote')

      expect(store.activeTransfers).toHaveLength(0)
      expect(store.completedTransfers).toHaveLength(3)
    })

    it('skips an existing file under policy "skip" and still uploads the rest', async () => {
      store.conflictPolicy = 'skip'
      existingPaths.add('/remote/a.txt')

      await store.startBatchUpload('s1', [localFile('a.txt'), localFile('b.txt')], '/remote')

      expect(callsTo('sftp_upload').map((u) => u.remotePath)).toEqual(['/remote/b.txt'])
      expect(store.failedTransfers).toHaveLength(1)
      expect(store.failedTransfers[0]).toMatchObject({ file_name: 'a.txt', error: SKIPPED_MESSAGE, is_complete: true })
      expect(store.completedTransfers.map((t) => t.file_name)).toEqual(['b.txt'])
      expect(store.activeTransfers).toHaveLength(0)
    })

    it('overwrites without checking the destination under policy "overwrite"', async () => {
      store.conflictPolicy = 'overwrite'
      existingPaths.add('/remote/a.txt')

      await store.startBatchUpload('s1', [localFile('a.txt')], '/remote')

      expect(checkedPaths()).toEqual([])
      expect(callsTo('sftp_upload')).toHaveLength(1)
    })

    it('"Skip All" asks once, skips the other existing files, and still uploads new ones', async () => {
      existingPaths.add('/remote/a.txt')
      existingPaths.add('/remote/b.txt')

      const batch = store.startBatchUpload('s1', [localFile('a.txt'), localFile('b.txt'), localFile('c.txt')], '/remote')
      await answerNextDialog('skip-all')
      await batch

      expect(callsTo('sftp_upload').map((u) => u.remotePath)).toEqual(['/remote/c.txt'])
      expect(store.failedTransfers.map((t) => t.file_name).sort()).toEqual(['a.txt', 'b.txt'])
      expect(store.activeConflictDialog).toBeNull()
    })

    it('"Overwrite All" asks once and uploads everything', async () => {
      existingPaths.add('/remote/a.txt')
      existingPaths.add('/remote/b.txt')

      const batch = store.startBatchUpload('s1', [localFile('a.txt'), localFile('b.txt')], '/remote')
      await answerNextDialog('overwrite-all')
      await batch

      expect(callsTo('sftp_upload')).toHaveLength(2)
      expect(store.failedTransfers).toHaveLength(0)
    })

    it('a failing file is reported as failed and does not stop the others', async () => {
      failTransfersFor.add('/remote/bad.txt')

      await expect(
        store.startBatchUpload('s1', [localFile('bad.txt'), localFile('ok.txt')], '/remote')
      ).resolves.toBeUndefined()

      expect(store.failedTransfers).toHaveLength(1)
      expect(store.failedTransfers[0]).toMatchObject({ file_name: 'bad.txt', error: 'upload failed: /remote/bad.txt' })
      expect(store.completedTransfers.map((t) => t.file_name)).toEqual(['ok.txt'])
    })

    it('records ignored root files and folders without transferring them', async () => {
      const settings = useSettingsStore()
      settings.enableTransferIgnoreFilter = true
      settings.transferIgnorePatterns = ['*.log', 'node_modules']

      await store.startBatchUpload('s1', [localFile('a.txt'), localFile('debug.log'), localDir('node_modules')], '/remote')

      expect(callsTo('sftp_upload').map((u) => u.remotePath)).toEqual(['/remote/a.txt'])
      expect(callsTo('sftp_crawl_local_paths')).toHaveLength(0) // the ignored folder is never crawled
      const ignored = store.failedTransfers.filter((t) => t.error?.startsWith('Ignored'))
      expect(ignored.map((t) => t.file_name).sort()).toEqual(['debug.log', 'node_modules'])
      expect(ignored.find((t) => t.file_name === 'node_modules')?.is_dir).toBe(true)
      expect(store.transferToast?.message).toContain('Ignored 2 items')
    })

    it('uploads a folder into a brand-new remote folder without per-file conflict checks', async () => {
      crawlLocal = {
        files: [
          { local_path: 'C:/src/proj/a.txt', remote_path: '/remote/proj/a.txt', file_name: 'a.txt', size: 1 },
          { local_path: 'C:/src/proj/sub/b.txt', remote_path: '/remote/proj/sub/b.txt', file_name: 'b.txt', size: 2 },
        ],
        directories: [{ local_path: 'C:/src/proj/empty', remote_path: '/remote/proj/empty', dir_name: 'empty' }],
        ignored: [],
      }

      await store.startBatchUpload('s1', [localDir('proj')], '/remote')

      // Only the root folder itself was checked; its children are known to be new.
      expect(checkedPaths()).toEqual(['/remote/proj'])
      expect(callsTo('sftp_upload').map((u) => u.remotePath).sort()).toEqual(['/remote/proj/a.txt', '/remote/proj/sub/b.txt'])
      expect(callsTo('sftp_batch_create_remote_dirs')[0]).toMatchObject({ sessionId: 's1', paths: ['/remote/proj/empty'] })
      expect(store.completedTransfers).toHaveLength(2)
    })

    it('checks every file when the remote folder already exists', async () => {
      existingPaths.add('/remote/proj')
      existingPaths.add('/remote/proj/a.txt')
      store.conflictPolicy = 'skip'
      crawlLocal = {
        files: [
          { local_path: 'C:/src/proj/a.txt', remote_path: '/remote/proj/a.txt', file_name: 'a.txt', size: 1 },
          { local_path: 'C:/src/proj/b.txt', remote_path: '/remote/proj/b.txt', file_name: 'b.txt', size: 2 },
        ],
        directories: [],
        ignored: [],
      }

      await store.startBatchUpload('s1', [localDir('proj')], '/remote')

      expect(checkedPaths()).toEqual(expect.arrayContaining(['/remote/proj/a.txt', '/remote/proj/b.txt']))
      expect(callsTo('sftp_upload').map((u) => u.remotePath)).toEqual(['/remote/proj/b.txt'])
      expect(store.failedTransfers.map((t) => t.file_name)).toEqual(['a.txt'])
    })

    it('shows folder progress and marks it complete', async () => {
      crawlLocal = {
        files: [{ local_path: 'C:/src/proj/a.txt', remote_path: '/remote/proj/a.txt', file_name: 'a.txt', size: 1 }],
        directories: [],
        ignored: [],
      }

      await store.startBatchUpload('s1', [localDir('proj')], '/remote')

      expect(store.activeFolderUpload).toMatchObject({
        folderName: 'proj',
        totalFiles: 1,
        completedFiles: 1,
        isScanning: false,
        isComplete: true,
      })
    })

    it('survives a crawl failure: root files still upload and the banner is reset', async () => {
      crawlLocal = null // makes `crawled.files` throw inside the scan
      await store.startBatchUpload('s1', [localFile('a.txt'), localDir('proj')], '/remote')

      expect(callsTo('sftp_upload').map((u) => u.remotePath)).toEqual(['/remote/a.txt'])
      expect(store.activeFolderUpload?.isScanning).toBe(false)
    })

    it('single-file upload creates its own row and refreshes the folder', async () => {
      await store.startUpload('s1', localFile('solo.txt'), '/remote')

      expect(callsTo('sftp_upload')).toHaveLength(1)
      expect(callsTo('sftp_list_remote').length).toBeGreaterThan(0)
      expect(store.completedTransfers.map((t) => t.file_name)).toEqual(['solo.txt'])
    })
  })

  describe('download', () => {
    it('downloads root files into the destination folder', async () => {
      await store.startBatchDownload('s1', [remoteFile('a.txt'), remoteFile('b.txt')], 'C:/dl')

      const downloads = callsTo('sftp_download')
      expect(downloads.map((d) => d.localPath).sort()).toEqual(['C:/dl/a.txt', 'C:/dl/b.txt'])
      expect(downloads[0]).toMatchObject({ sessionId: 's1', fileSize: 10, conflictAction: 'overwrite' })
      expect(store.completedTransfers.every((t) => t.direction === 'download')).toBe(true)
      expect(store.activeTransfers).toHaveLength(0)
    })

    it('checks the LOCAL side for conflicts and skips existing files', async () => {
      store.conflictPolicy = 'skip'
      existingPaths.add('C:/dl/a.txt')

      await store.startBatchDownload('s1', [remoteFile('a.txt'), remoteFile('b.txt')], 'C:/dl')

      expect(callsTo('sftp_check_conflict')[0]).toMatchObject({ isRemote: false, sessionId: null })
      expect(callsTo('sftp_download').map((d) => d.localPath)).toEqual(['C:/dl/b.txt'])
      expect(store.failedTransfers[0]).toMatchObject({ file_name: 'a.txt', error: SKIPPED_MESSAGE, direction: 'download' })
    })

    it('"Skip All" applies to the rest of the batch', async () => {
      existingPaths.add('C:/dl/a.txt')
      existingPaths.add('C:/dl/b.txt')

      const batch = store.startBatchDownload('s1', [remoteFile('a.txt'), remoteFile('b.txt')], 'C:/dl')
      await answerNextDialog('skip-all')
      await batch

      expect(callsTo('sftp_download')).toHaveLength(0)
      expect(store.failedTransfers).toHaveLength(2)
    })

    it('downloads a crawled folder to the local paths the crawler reports', async () => {
      crawlRemote = [
        { remote_path: '/src/proj/a.txt', local_path: 'C:/dl/proj/a.txt', file_name: 'a.txt', size: 1 },
        { remote_path: '/src/proj/sub/b.txt', local_path: 'C:/dl/proj/sub/b.txt', file_name: 'b.txt', size: 2 },
      ]

      await store.startBatchDownload('s1', [remoteDir('proj')], 'C:/dl')

      expect(callsTo('sftp_crawl_remote_paths')[0]).toMatchObject({ sessionId: 's1', paths: ['/src/proj'], targetLocalDir: 'C:/dl' })
      expect(callsTo('sftp_download').map((d) => d.localPath).sort()).toEqual(['C:/dl/proj/a.txt', 'C:/dl/proj/sub/b.txt'])
      // Brand-new local folder: only the root was checked.
      expect(checkedPaths()).toEqual(['C:/dl/proj'])
      expect(store.activeFolderDownload).toMatchObject({ completedFiles: 2, isComplete: true })
    })

    it('a failing download is reported and does not stop the batch', async () => {
      failTransfersFor.add('C:/dl/bad.txt')

      await store.startBatchDownload('s1', [remoteFile('bad.txt'), remoteFile('ok.txt')], 'C:/dl')

      expect(store.failedTransfers.map((t) => t.file_name)).toEqual(['bad.txt'])
      expect(store.completedTransfers.map((t) => t.file_name)).toEqual(['ok.txt'])
    })
  })

  describe('remote to remote', () => {
    it('transfers root files between the two sessions and shows them as uploads to the destination', async () => {
      await store.startBatchRemoteToRemoteTransfer('src', 'dst', [remoteFile('a.txt')], '/dest')

      expect(callsTo('sftp_transfer_remote_to_remote')).toEqual([
        expect.objectContaining({ srcSessionId: 'src', destSessionId: 'dst', srcPath: '/src/a.txt', destPath: '/dest/a.txt' }),
      ])
      expect(store.completedTransfers[0]).toMatchObject({
        direction: 'upload',
        session_id: 'dst',
        src_session_id: 'src',
        local_path: '/src/a.txt',
        remote_path: '/dest/a.txt',
      })
    })

    it('checks conflicts on the DESTINATION server', async () => {
      store.conflictPolicy = 'skip'
      existingPaths.add('/dest/a.txt')

      await store.startBatchRemoteToRemoteTransfer('src', 'dst', [remoteFile('a.txt'), remoteFile('b.txt')], '/dest')

      expect(callsTo('sftp_check_conflict')[0]).toMatchObject({ sessionId: 'dst', isRemote: true })
      expect(callsTo('sftp_transfer_remote_to_remote').map((c) => c.destPath)).toEqual(['/dest/b.txt'])
      expect(store.failedTransfers[0]).toMatchObject({ file_name: 'a.txt', error: SKIPPED_MESSAGE, src_session_id: 'src', session_id: 'dst' })
    })

    it('"Skip All" asks once for the whole batch', async () => {
      existingPaths.add('/dest/a.txt')
      existingPaths.add('/dest/b.txt')

      const batch = store.startBatchRemoteToRemoteTransfer('src', 'dst', [remoteFile('a.txt'), remoteFile('b.txt')], '/dest')
      await answerNextDialog('skip-all')
      await batch

      expect(callsTo('sftp_transfer_remote_to_remote')).toHaveLength(0)
      expect(store.failedTransfers).toHaveLength(2)
    })

    it('crawls folders on the source session and writes to the paths the crawler reports', async () => {
      crawlRemote = [{ remote_path: '/src/proj/a.txt', local_path: '/dest/proj/a.txt', file_name: 'a.txt', size: 3 }]

      await store.startBatchRemoteToRemoteTransfer('src', 'dst', [remoteDir('proj')], '/dest')

      expect(callsTo('sftp_crawl_remote_paths')[0]).toMatchObject({ sessionId: 'src', paths: ['/src/proj'] })
      expect(callsTo('sftp_transfer_remote_to_remote')[0]).toMatchObject({ srcPath: '/src/proj/a.txt', destPath: '/dest/proj/a.txt' })
      // Brand-new destination folder: only the folder itself is checked, on the destination.
      expect(callsTo('sftp_check_conflict')).toEqual([{ sessionId: 'dst', path: '/dest/proj', isRemote: true }])
    })

    it('reports success with a non-error toast', async () => {
      await store.startBatchRemoteToRemoteTransfer('src', 'dst', [remoteFile('a.txt')], '/dest')

      expect(store.transferToast?.message).toContain('Finished remote-to-remote transfer of 1 item')
      // Regression: this used to be called with the string 'success', which is truthy and
      // therefore rendered as an ERROR toast.
      expect(store.transferToast?.isError).toBe(false)
    })

    it('a failing transfer is reported and does not stop the batch', async () => {
      failTransfersFor.add('/dest/bad.txt')

      await store.startBatchRemoteToRemoteTransfer('src', 'dst', [remoteFile('bad.txt'), remoteFile('ok.txt')], '/dest')

      expect(store.failedTransfers.map((t) => t.file_name)).toEqual(['bad.txt'])
      expect(store.completedTransfers.map((t) => t.file_name)).toEqual(['ok.txt'])
    })
  })

  describe('concurrent batches', () => {
    it('"Skip All" chosen in one batch does not skip files in another batch', async () => {
      existingPaths.add('/remote/a.txt')
      existingPaths.add('/remote/b.txt')

      const batchA = store.startBatchUpload('s1', [localFile('a.txt')], '/remote')
      const batchB = store.startBatchUpload('s1', [localFile('b.txt')], '/remote')

      const first = await answerNextDialog('skip-all')
      // The other batch is NOT covered by that answer and must ask for itself.
      const second = await answerNextDialog('overwrite')
      expect(new Set([first, second])).toEqual(new Set(['a.txt', 'b.txt']))

      await Promise.all([batchA, batchB])

      const uploaded = callsTo('sftp_upload').map((u) => u.remotePath)
      const skipped = store.failedTransfers.map((t) => t.file_name)
      expect(uploaded).toHaveLength(1)
      expect(skipped).toHaveLength(1)
      // whichever batch got "skip-all" skipped; the other overwrote
      expect(skipped[0]).toBe(first)
      expect(uploaded[0]).toBe(`/remote/${second}`)
    })
  })

  describe('retry and requeue', () => {
    it('retry-all re-runs a failed remote-to-remote transfer as a remote-to-remote transfer', async () => {
      failTransfersFor.add('/dest/a.txt')
      await store.startBatchRemoteToRemoteTransfer('src', 'dst', [remoteFile('a.txt')], '/dest')
      expect(store.failedTransfers).toHaveLength(1)

      failTransfersFor.clear()
      await store.retryAllFailed()

      // Regression: it used to be retried as a LOCAL upload of the remote source path.
      expect(callsTo('sftp_transfer_remote_to_remote')).toHaveLength(2)
      expect(callsTo('sftp_upload')).toHaveLength(0)
      expect(store.failedTransfers).toHaveLength(0)
      expect(store.completedTransfers.map((t) => t.file_name)).toEqual(['a.txt'])
    })

    it('retry-all asks the conflict question once for the whole retry', async () => {
      failTransfersFor.add('/remote/a.txt')
      failTransfersFor.add('/remote/b.txt')
      await store.startBatchUpload('s1', [localFile('a.txt'), localFile('b.txt')], '/remote')
      expect(store.failedTransfers).toHaveLength(2)

      failTransfersFor.clear()
      existingPaths.add('/remote/a.txt')
      existingPaths.add('/remote/b.txt')
      const retry = store.retryAllFailed()
      await answerNextDialog('overwrite-all')
      await retry

      expect(store.activeConflictDialog).toBeNull()
      expect(store.completedTransfers).toHaveLength(2)
    })

    it('requeue keeps the existing queue row instead of adding a new one', async () => {
      failTransfersFor.add('/remote/a.txt')
      await store.startBatchUpload('s1', [localFile('a.txt')], '/remote')
      const row = store.failedTransfers[0]!

      failTransfersFor.clear()
      await store.requeueTransfers([row])

      expect(store.transfers.filter((t) => t.file_name === 'a.txt')).toHaveLength(1)
      expect(store.completedTransfers[0]).toBe(row)
      expect(row.error).toBeUndefined()
    })
  })
})
