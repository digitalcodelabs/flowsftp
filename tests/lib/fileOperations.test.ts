import { describe, it, expect, beforeEach, vi } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

import { useDirectoryBrowser } from '../../app/lib/sftp/useDirectoryBrowser'
import { useFileOperations } from '../../app/lib/sftp/useFileOperations'
import { LOCAL_PANE, remotePane } from '../../app/lib/sftp/pane'

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
  const ops = useFileOperations({ browser, pipeline })
  invokeMock.mockClear()
  return { browser, pipeline, ops }
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

    it('downloads remote files to a local pane and clears the clipboard on cut', async () => {
      const { ops, pipeline } = await setup()
      ops.cutToClipboard('remote', [entry('/srv/a.txt')], 's1')

      await ops.byPane.paste(LOCAL_PANE)

      expect(pipeline.startBatchDownload).toHaveBeenCalledWith('s1', [expect.objectContaining({ path: '/srv/a.txt' })], '/home/a')
      expect(ops.clipboard.value).toBeNull()
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
