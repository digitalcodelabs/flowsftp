import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

import { useDirectoryBrowser } from '../../app/lib/sftp/useDirectoryBrowser'
import { useFileOperations } from '../../app/lib/sftp/useFileOperations'
import { LOCAL_PANE, remotePane } from '../../app/lib/sftp/pane'
import type { TransferProgressEvent } from '../../app/lib/sftp/types'

const entry = (path: string, is_dir = false) => ({
  name: path.split('/').pop()!,
  path,
  is_dir,
  is_symlink: false,
  size: 1,
  modified: 0,
})

/** Browser at /home/a (local) and /srv (session s1), plus a pipeline stub that records batch calls. */
async function setup() {
  invokeMock.mockReset()
  invokeMock.mockImplementation(async (cmd: string, args: any) => {
    if (cmd === 'sftp_list_local') return [args.dirPath, []]
    if (cmd === 'sftp_list_remote') return [args.path, []]
    if (cmd.includes('git_status')) throw 'not a repository'
    return undefined
  })
  const browser = useDirectoryBrowser()
  await browser.fetchLocalDir('/home/a')
  await browser.switchSession('s1', '/srv')
  const pipeline = {
    startBatchDownload: vi.fn(async () => {}),
    startBatchUpload: vi.fn(async () => {}),
    startBatchRemoteToRemoteTransfer: vi.fn(async () => {}),
  }
  const failedTransfers = ref<TransferProgressEvent[]>([])
  const isCancellingAll = ref(false)
  const ops = useFileOperations({ browser, pipeline, queue: { failedTransfers, isCancellingAll } })
  invokeMock.mockClear()
  return { browser, pipeline, ops, failedTransfers, isCancellingAll }
}

const calls = (cmd: string) => invokeMock.mock.calls.filter((c) => c[0] === cmd).map((c) => c[1])

describe('useFileOperations (by-pane API)', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('a remote pane acts on its own session, not the active one', async () => {
    const { browser, ops } = await setup()
    // A second session exists in the background; the active one is s1.
    expect(browser.currentSessionId.value).toBe('s1')

    await ops.byPane.createFolder(remotePane('s2'), 'x', '/other')

    expect(calls('sftp_create_remote_dir')).toEqual([{ sessionId: 's2', path: '/other/x' }])
    expect(calls('sftp_create_local_dir')).toEqual([])
  })

  it('a local pane never touches a remote session', async () => {
    const { ops } = await setup()

    await ops.byPane.createFolder(LOCAL_PANE, 'x')
    await ops.byPane.createFile(LOCAL_PANE, 'y.txt')
    await ops.byPane.renameItem(LOCAL_PANE, '/home/a/y.txt', '/home/a/z.txt')
    await ops.byPane.deleteItem(LOCAL_PANE, entry('/home/a/z.txt'))

    const names = invokeMock.mock.calls.map((c) => c[0] as string)
    expect(names.filter((n) => n.includes('remote'))).toEqual([])
  })

  it('parentDir is ignored by local panes, as before', async () => {
    const { ops } = await setup()

    await ops.byPane.createFolder(LOCAL_PANE, 'x', '/somewhere/else')

    expect(calls('sftp_create_local_dir')).toEqual([{ path: '/home/a/x' }])
  })

  it('the legacy wrappers delegate to the same behaviour', async () => {
    const { ops } = await setup()

    await ops.createRemoteFolder('s1', 'x')
    await ops.byPane.createFolder(remotePane('s1'), 'x')

    const [legacy, byPane] = calls('sftp_create_remote_dir')
    expect(legacy).toEqual(byPane)
  })

  it('legacy remote operations without any session do nothing', async () => {
    const { browser, ops } = await setup()
    browser.clearSession('s1')
    invokeMock.mockClear()

    await ops.duplicateItem('remote', entry('/srv/a'))
    await ops.createSymlink('remote', '/t', '/srv/l')
    expect(await ops.calculateDirSize('remote', '/srv')).toBe(0)
    await expect(ops.calculateChecksum('remote', '/srv/a', 'md5')).rejects.toThrow('No active session')

    expect(invokeMock).not.toHaveBeenCalled()
  })

  describe('paste', () => {
    it('uploads local files to a remote pane through the pipeline', async () => {
      const { ops, pipeline } = await setup()
      ops.copyToClipboard('local', [entry('/home/a/a.txt')])

      await ops.byPane.paste(remotePane('s1'), '/srv/in')

      expect(pipeline.startBatchUpload).toHaveBeenCalledWith('s1', [expect.objectContaining({ path: '/home/a/a.txt' })], '/srv/in')
      expect(ops.clipboard.value).not.toBeNull()
    })

    it('downloads remote files to a local pane, deletes cut source files on success, and clears the clipboard', async () => {
      const { ops, pipeline } = await setup()
      ops.cutToClipboard('remote', [entry('/srv/a.txt')], 's1')

      await ops.byPane.paste(LOCAL_PANE)

      expect(pipeline.startBatchDownload).toHaveBeenCalledWith('s1', [expect.objectContaining({ path: '/srv/a.txt' })], '/home/a')
      expect(calls('sftp_remove_remote_file')).toEqual([{ sessionId: 's1', path: '/srv/a.txt', deletionId: null }])
      expect(ops.clipboard.value).toBeNull()
    })

    it('uploads local files to a remote pane, deletes cut local source files on success, and clears the clipboard', async () => {
      const { ops, pipeline } = await setup()
      ops.cutToClipboard('local', [entry('/home/a/a.txt'), entry('/home/a/folder', true)])

      await ops.byPane.paste(remotePane('s1'), '/srv/in')

      expect(pipeline.startBatchUpload).toHaveBeenCalledWith(
        's1',
        [expect.objectContaining({ path: '/home/a/a.txt' }), expect.objectContaining({ path: '/home/a/folder' })],
        '/srv/in'
      )
      expect(calls('sftp_remove_local')).toEqual([
        { path: '/home/a/a.txt' },
        { path: '/home/a/folder' },
      ])
      expect(ops.clipboard.value).toBeNull()
    })

    it('preserves cut source files when a cross-endpoint transfer fails or is skipped', async () => {
      const { ops, pipeline, failedTransfers } = await setup()
      pipeline.startBatchUpload.mockImplementationOnce(async () => {
        failedTransfers.value.push({
          transfer_id: 't1',
          session_id: 's1',
          file_name: 'bad.txt',
          local_path: '/home/a/bad.txt',
          remote_path: '/srv/in/bad.txt',
          bytes_transferred: 0,
          total_bytes: 1,
          direction: 'upload',
          is_complete: true,
          error: 'Skipped (file already exists)',
        })
      })

      ops.cutToClipboard('local', [entry('/home/a/bad.txt'), entry('/home/a/good.txt')])
      await ops.byPane.paste(remotePane('s1'), '/srv/in')

      // Only the succeeded file is deleted; the skipped/failed file is kept safe and remains in clipboard
      expect(calls('sftp_remove_local')).toEqual([{ path: '/home/a/good.txt' }])
      expect(ops.clipboard.value?.files.map((f) => f.path)).toEqual(['/home/a/bad.txt'])
    })

    it('preserves all cut source files when the transfer batch is cancelled', async () => {
      const { ops, pipeline, isCancellingAll } = await setup()
      pipeline.startBatchRemoteToRemoteTransfer.mockImplementationOnce(async () => {
        isCancellingAll.value = true
      })

      ops.cutToClipboard('remote', [entry('/srv/a.txt')], 's1')
      await ops.byPane.paste(remotePane('s2'), '/dst')

      expect(calls('sftp_remove_remote_file')).toHaveLength(0)
      expect(ops.clipboard.value?.files.map((f) => f.path)).toEqual(['/srv/a.txt'])
    })

    it('preserves all cut source files even if isCancellingAll resets to false before paste finishes unwinding', async () => {
      const { ops, pipeline, isCancellingAll } = await setup()
      pipeline.startBatchRemoteToRemoteTransfer.mockImplementationOnce(async () => {
        isCancellingAll.value = true
        // Simulate the 350ms timer resetting isCancellingAll before the batch promise resolves
        isCancellingAll.value = false
      })

      ops.cutToClipboard('remote', [entry('/srv/a.txt')], 's1')
      await ops.byPane.paste(remotePane('s2'), '/dst')

      expect(calls('sftp_remove_remote_file')).toHaveLength(0)
      expect(ops.clipboard.value?.files.map((f) => f.path)).toEqual(['/srv/a.txt'])
    })

    it('invalidates the source directory cache after a same-endpoint cut and paste', async () => {
      const { browser, ops } = await setup()
      await browser.fetchRemoteDir('s1', '/srv/from')
      await browser.fetchRemoteDir('s1', '/srv/to')
      ops.cutToClipboard('remote', [entry('/srv/from/a.txt')], 's1')
      invokeMock.mockClear()

      await ops.byPane.paste(remotePane('s1'), '/srv/to')

      expect(calls('sftp_move_remote_paths')).toEqual([
        { sessionId: 's1', paths: ['/srv/from/a.txt'], targetDir: '/srv/to' },
      ])
      // Re-fetching /srv/from should hit backend because its cache was invalidated by cut-paste
      invokeMock.mockClear()
      await browser.fetchRemoteDir('s1', '/srv/from')
      expect(calls('sftp_list_remote')).toEqual([{ sessionId: 's1', path: '/srv/from' }])
    })

    it('copies between two remote sessions through the pipeline', async () => {
      const { ops, pipeline } = await setup()
      ops.copyToClipboard('remote', [entry('/srv/a.txt')], 's1')

      await ops.byPane.paste(remotePane('s2'), '/dst')

      expect(pipeline.startBatchRemoteToRemoteTransfer).toHaveBeenCalledWith(
        's1',
        's2',
        [expect.objectContaining({ path: '/srv/a.txt' })],
        '/dst'
      )
    })

    it('on a cross-session cut, deletes the source after the transfer and clears the clipboard', async () => {
      const { ops } = await setup()
      ops.cutToClipboard('remote', [entry('/srv/a.txt')], 's1')

      await ops.byPane.paste(remotePane('s2'), '/dst')

      expect(calls('sftp_remove_remote_file')).toEqual([{ sessionId: 's1', path: '/srv/a.txt', deletionId: null }])
      expect(ops.clipboard.value).toBeNull()
    })

    it('keeps going when deleting a source file after a cut fails', async () => {
      const { ops } = await setup()
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === 'sftp_remove_remote_file') throw new Error('denied')
        return undefined
      })
      ops.cutToClipboard('remote', [entry('/srv/a.txt'), entry('/srv/b.txt')], 's1')

      await ops.byPane.paste(remotePane('s2'), '/dst')

      expect(calls('sftp_remove_remote_file')).toHaveLength(2)
      expect(ops.clipboard.value).toBeNull()
    })
  })
})
