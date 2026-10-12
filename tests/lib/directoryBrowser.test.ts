import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

import { useDirectoryBrowser } from '../../app/lib/sftp/useDirectoryBrowser'

const file = (path: string, size = 1) => ({
  name: path.split('/').pop()!,
  path,
  is_dir: false,
  is_symlink: false,
  size,
  modified: 0,
})

const remoteFile = (path: string) => ({ ...file(path), permissions: 0o644 })

/** Fake backend: every listing call is answered from `listings[path]`. */
function fakeBackend(opts: {
  local?: Record<string, ReturnType<typeof file>[]>
  remote?: Record<string, ReturnType<typeof remoteFile>[]>
}) {
  invokeMock.mockImplementation(async (cmd: string, args: any) => {
    if (cmd === 'sftp_list_local') {
      const entries = opts.local?.[args.dirPath]
      if (!entries) throw 'The system cannot find the path specified.'
      return [args.dirPath, entries]
    }
    if (cmd === 'sftp_list_remote') {
      const entries = opts.remote?.[`${args.sessionId}:${args.path}`]
      if (!entries) throw 'No such file'
      return [args.path, entries]
    }
    if (cmd === 'sftp_get_git_status' || cmd === 'sftp_get_remote_git_status') {
      throw 'not a repository'
    }
    throw new Error(`unexpected command ${cmd}`)
  })
}

const callsTo = (cmd: string) => invokeMock.mock.calls.filter((c) => c[0] === cmd)

describe('useDirectoryBrowser: local listing and cache', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('loads a directory and exposes its canonical path and entries', async () => {
    fakeBackend({ local: { '/home/a': [file('/home/a/x.txt')] } })
    const b = useDirectoryBrowser()

    const ok = await b.fetchLocalDir('/home/a')

    expect(ok).toBe(true)
    expect(b.localPath.value).toBe('/home/a')
    expect(b.localFiles.value.map((f) => f.name)).toEqual(['x.txt'])
    expect(b.isLoadingLocal.value).toBe(false)
  })

  it('serves a fresh cached directory without hitting the backend again', async () => {
    fakeBackend({ local: { '/home/a': [file('/home/a/x.txt')] } })
    const b = useDirectoryBrowser()

    await b.fetchLocalDir('/home/a')
    await b.fetchLocalDir('/home/a')

    expect(callsTo('sftp_list_local')).toHaveLength(1)
  })

  it('treats trailing slashes and backslashes as the same cache entry', async () => {
    fakeBackend({ local: { 'C:\\Users\\a': [file('C:/Users/a/x.txt')] } })
    const b = useDirectoryBrowser()

    await b.fetchLocalDir('C:\\Users\\a')
    await b.fetchLocalDir('C:/Users/a/')

    expect(callsTo('sftp_list_local')).toHaveLength(1)
  })

  it('force bypasses the cache', async () => {
    fakeBackend({ local: { '/home/a': [file('/home/a/x.txt')] } })
    const b = useDirectoryBrowser()

    await b.fetchLocalDir('/home/a')
    await b.fetchLocalDir('/home/a', { force: true })

    expect(callsTo('sftp_list_local')).toHaveLength(2)
  })

  it('invalidateLocalCache makes the next fetch hit the backend', async () => {
    fakeBackend({ local: { '/home/a': [file('/home/a/x.txt')] } })
    const b = useDirectoryBrowser()

    await b.fetchLocalDir('/home/a')
    b.invalidateLocalCache('/home/a')
    await b.fetchLocalDir('/home/a')

    expect(callsTo('sftp_list_local')).toHaveLength(2)
  })

  it('reports a listing error when nothing is cached', async () => {
    fakeBackend({ local: {} })
    const b = useDirectoryBrowser()

    const ok = await b.fetchLocalDir('/nope')

    expect(ok).toBe(false)
    expect(b.localError.value).toContain('cannot find the path')
    expect(b.isLoadingLocal.value).toBe(false)
  })

  describe('stale entries', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('shows the stale listing immediately, then replaces it with fresh data', async () => {
      const listings: Record<string, ReturnType<typeof file>[]> = { '/home/a': [file('/home/a/old.txt')] }
      fakeBackend({ local: listings })
      const b = useDirectoryBrowser()
      await b.fetchLocalDir('/home/a')

      vi.advanceTimersByTime(61_000)
      listings['/home/a'] = [file('/home/a/new.txt')]

      const pending = b.fetchLocalDir('/home/a')
      // The cached listing is on screen before the backend answers.
      expect(b.localFiles.value.map((f) => f.name)).toEqual(['old.txt'])
      expect(b.isBackgroundRefreshingLocal.value).toBe(true)

      await pending
      expect(b.localFiles.value.map((f) => f.name)).toEqual(['new.txt'])
      expect(b.isBackgroundRefreshingLocal.value).toBe(false)
    })

    it('keeps the stale listing and shows no error when the refresh fails', async () => {
      fakeBackend({ local: { '/home/a': [file('/home/a/old.txt')] } })
      const b = useDirectoryBrowser()
      await b.fetchLocalDir('/home/a')

      vi.advanceTimersByTime(61_000)
      fakeBackend({ local: {} })

      const ok = await b.fetchLocalDir('/home/a')

      expect(ok).toBe(false)
      expect(b.localError.value).toBeNull()
      expect(b.localFiles.value.map((f) => f.name)).toEqual(['old.txt'])
    })

    it('throttles background refreshes to one per 1.5 seconds', async () => {
      fakeBackend({ local: { '/home/a': [file('/home/a/x.txt')] } })
      const b = useDirectoryBrowser()
      await b.fetchLocalDir('/home/a')
      invokeMock.mockClear()

      vi.advanceTimersByTime(2_000)
      b.triggerBackgroundLocalRefresh()
      b.triggerBackgroundLocalRefresh()
      await vi.advanceTimersByTimeAsync(0)

      expect(callsTo('sftp_list_local')).toHaveLength(1)

      vi.advanceTimersByTime(2_000)
      b.triggerBackgroundLocalRefresh()
      await vi.advanceTimersByTimeAsync(0)

      expect(callsTo('sftp_list_local')).toHaveLength(2)
    })
  })
})

describe('useDirectoryBrowser: remote sessions', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('shows the listing of the active session', async () => {
    fakeBackend({ remote: { 's1:/srv': [remoteFile('/srv/a.txt')] } })
    const b = useDirectoryBrowser()

    await b.switchSession('s1', '/srv')

    expect(b.currentSessionId.value).toBe('s1')
    expect(b.remotePath.value).toBe('/srv')
    expect(b.remoteFiles.value.map((f) => f.name)).toEqual(['a.txt'])
    expect(b.sessionRemotePaths.value['s1']).toBe('/srv')
  })

  it('does not display a listing that arrives for a session that is no longer active', async () => {
    fakeBackend({
      remote: { 's1:/one': [remoteFile('/one/a.txt')], 's2:/two': [remoteFile('/two/b.txt')] },
    })
    const b = useDirectoryBrowser()
    await b.switchSession('s1', '/one')

    b.currentSessionId.value = 's2'
    await b.fetchRemoteDir('s1', '/one', { force: true })

    // Remembered for s1, but the s2 view is untouched.
    expect(b.sessionRemoteFiles.value['s1']).toHaveLength(1)
    expect(b.remoteFiles.value.map((f) => f.name)).toEqual(['a.txt'])
    expect(b.remotePath.value).toBe('/one')
  })

  it('restores the remembered path and files when switching back to a session', async () => {
    fakeBackend({
      remote: { 's1:/one': [remoteFile('/one/a.txt')], 's2:/two': [remoteFile('/two/b.txt')] },
    })
    const b = useDirectoryBrowser()
    await b.switchSession('s1', '/one')
    await b.switchSession('s2', '/two')
    expect(b.remoteFiles.value.map((f) => f.name)).toEqual(['b.txt'])

    await b.switchSession('s1')

    expect(b.currentSessionId.value).toBe('s1')
    expect(b.remotePath.value).toBe('/one')
    expect(b.remoteFiles.value.map((f) => f.name)).toEqual(['a.txt'])
  })

  it('switching to an empty session id resets the remote pane', async () => {
    fakeBackend({ remote: { 's1:/one': [remoteFile('/one/a.txt')] } })
    const b = useDirectoryBrowser()
    await b.switchSession('s1', '/one')

    await b.switchSession('')

    expect(b.currentSessionId.value).toBeNull()
    expect(b.remoteFiles.value).toEqual([])
    expect(b.remotePath.value).toBe('.')
  })

  it('clearSession forgets the session and resets the pane only if it was active', async () => {
    fakeBackend({
      remote: { 's1:/one': [remoteFile('/one/a.txt')], 's2:/two': [remoteFile('/two/b.txt')] },
    })
    const b = useDirectoryBrowser()
    await b.switchSession('s1', '/one')
    await b.switchSession('s2', '/two')

    b.clearSession('s1')
    expect(b.sessionRemotePaths.value['s1']).toBeUndefined()
    expect(b.currentSessionId.value).toBe('s2')
    expect(b.remoteFiles.value).toHaveLength(1)

    b.clearSession('s2')
    expect(b.currentSessionId.value).toBeNull()
    expect(b.remoteFiles.value).toEqual([])
  })

  it('invalidateRemoteCache only drops the entries of the given session', async () => {
    fakeBackend({
      remote: { 's1:/d': [remoteFile('/d/a.txt')], 's2:/d': [remoteFile('/d/b.txt')] },
    })
    const b = useDirectoryBrowser()
    await b.fetchRemoteDir('s1', '/d')
    await b.fetchRemoteDir('s2', '/d')
    invokeMock.mockClear()

    b.invalidateRemoteCache('s1')
    await b.fetchRemoteDir('s1', '/d')
    await b.fetchRemoteDir('s2', '/d')

    const listed = callsTo('sftp_list_remote').map((c) => c[1].sessionId)
    expect(listed).toEqual(['s1'])
  })

  it('reports a remote listing error only for the active session', async () => {
    fakeBackend({ remote: {} })
    const b = useDirectoryBrowser()
    b.currentSessionId.value = 's1'

    await b.fetchRemoteDir('s1', '/missing')
    expect(b.remoteError.value).toBe('No such file')

    b.remoteError.value = null
    await b.fetchRemoteDir('s2', '/missing')
    expect(b.remoteError.value).toBeNull()
  })

  it('ignores fetches without a session id', async () => {
    fakeBackend({})
    const b = useDirectoryBrowser()

    await b.fetchRemoteDir('')

    expect(invokeMock).not.toHaveBeenCalled()
  })
})
