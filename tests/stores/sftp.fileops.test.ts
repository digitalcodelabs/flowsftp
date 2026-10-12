import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}))

import { useSftpStore } from '../../app/stores/sftp'

const local = (path: string, is_dir = false) => ({
  name: path.split('/').pop()!,
  path,
  is_dir,
  is_symlink: false,
  size: 1,
  modified: 0,
})
const remote = (path: string, is_dir = false) => ({ ...local(path, is_dir), permissions: 0o644 })

function installBackend() {
  invokeMock.mockReset()
  invokeMock.mockImplementation(async (cmd: string, args: any) => {
    switch (cmd) {
      case 'sftp_list_local':
        return [args.dirPath, []]
      case 'sftp_list_remote':
        return [args.path, []]
      case 'sftp_get_git_status':
      case 'sftp_get_remote_git_status':
        throw 'not a repository'
      case 'sftp_get_local_dir_size':
        return 42
      case 'sftp_get_remote_dir_size':
        return 99
      case 'sftp_calculate_local_checksum':
        return 'local-sum'
      case 'sftp_calculate_remote_checksum':
        return 'remote-sum'
      case 'sftp_extract_local_archive':
      case 'sftp_extract_remote_archive':
      case 'sftp_compress_local_archive':
      case 'sftp_compress_remote_archive':
        return '/result/archive'
      default:
        return undefined
    }
  })
}

const commands = () => invokeMock.mock.calls.map((c) => c[0] as string)
const argsOf = (cmd: string) => invokeMock.mock.calls.find((c) => c[0] === cmd)?.[1]

describe('SFTP store file operations', () => {
  let store: ReturnType<typeof useSftpStore>

  /** Local pane at /home/a, remote pane (session s1) at /srv. */
  async function openBothPanes() {
    await store.fetchLocalDir('/home/a')
    await store.switchSession('s1', '/srv')
    invokeMock.mockClear()
  }

  beforeEach(async () => {
    installBackend()
    setActivePinia(createPinia())
    store = useSftpStore()
  })

  describe('create', () => {
    it('creates a remote folder under the current path and refreshes the listing', async () => {
      await openBothPanes()

      await store.createRemoteFolder('s1', 'docs')

      expect(argsOf('sftp_create_remote_dir')).toEqual({ sessionId: 's1', path: '/srv/docs' })
      expect(argsOf('sftp_list_remote')).toEqual({ sessionId: 's1', path: '/srv' })
    })

    it('creates a remote folder in an explicit parent, with or without a trailing slash', async () => {
      await openBothPanes()

      await store.createRemoteFolder('s1', 'a', '/other')
      await store.createRemoteFolder('s1', 'b', '/other/')

      const paths = invokeMock.mock.calls.filter((c) => c[0] === 'sftp_create_remote_dir').map((c) => c[1].path)
      expect(paths).toEqual(['/other/a', '/other/b'])
    })

    it('creates a remote file and passes the overwrite flag (default false)', async () => {
      await openBothPanes()

      await store.createRemoteFile('s1', 'a.txt')
      await store.createRemoteFile('s1', 'b.txt', true, '/other')

      const calls = invokeMock.mock.calls.filter((c) => c[0] === 'sftp_create_remote_file').map((c) => c[1])
      expect(calls).toEqual([
        { sessionId: 's1', path: '/srv/a.txt', overwrite: false },
        { sessionId: 's1', path: '/other/b.txt', overwrite: true },
      ])
    })

    it('creates local folders and files in the current local directory', async () => {
      await openBothPanes()

      await store.createLocalFolder('docs')
      await store.createLocalFile('a.txt')
      await store.createLocalFile('b.txt', true)

      expect(argsOf('sftp_create_local_dir')).toEqual({ path: '/home/a/docs' })
      const files = invokeMock.mock.calls.filter((c) => c[0] === 'sftp_create_local_file').map((c) => c[1])
      expect(files).toEqual([
        { path: '/home/a/a.txt', overwrite: false },
        { path: '/home/a/b.txt', overwrite: true },
      ])
      expect(commands()).toContain('sftp_list_local')
    })
  })

  describe('delete', () => {
    it('deletes a remote directory with the deletion id and fast-rm flag', async () => {
      await openBothPanes()

      await store.deleteRemoteItem('s1', remote('/srv/old', true), 'del-1', false, true)

      expect(argsOf('sftp_remove_remote_dir')).toEqual({
        sessionId: 's1',
        path: '/srv/old',
        deletionId: 'del-1',
        useFastRm: true,
      })
      expect(commands()).toContain('sftp_list_remote')
    })

    it('deletes a remote file and defaults the deletion id to null', async () => {
      await openBothPanes()

      await store.deleteRemoteItem('s1', remote('/srv/a.txt'))

      expect(argsOf('sftp_remove_remote_file')).toEqual({ sessionId: 's1', path: '/srv/a.txt', deletionId: null })
    })

    it('skips the refresh when asked to', async () => {
      await openBothPanes()

      await store.deleteRemoteItem('s1', remote('/srv/a.txt'), undefined, true)
      await store.deleteLocalItem(local('/home/a/b.txt'), true)

      expect(commands()).not.toContain('sftp_list_remote')
      expect(commands()).not.toContain('sftp_list_local')
    })

    it('rethrows a remote delete failure and does not refresh', async () => {
      await openBothPanes()
      invokeMock.mockImplementationOnce(async () => {
        throw new Error('permission denied')
      })

      await expect(store.deleteRemoteItem('s1', remote('/srv/a.txt'))).rejects.toThrow('permission denied')
      expect(commands()).not.toContain('sftp_list_remote')
    })

    it('deletes a local item and refreshes the local listing', async () => {
      await openBothPanes()

      await store.deleteLocalItem(local('/home/a/dir', true))

      expect(argsOf('sftp_remove_local')).toEqual({ path: '/home/a/dir' })
      expect(argsOf('sftp_list_local')).toEqual({ dirPath: '/home/a' })
    })
  })

  describe('rename', () => {
    it('renames a remote item and refreshes the containing directory', async () => {
      await openBothPanes()

      await store.renameRemoteItem('s1', '/srv/a.txt', '/srv/b.txt')

      expect(argsOf('sftp_rename_remote')).toEqual({ sessionId: 's1', oldPath: '/srv/a.txt', newPath: '/srv/b.txt' })
      expect(argsOf('sftp_list_remote')).toEqual({ sessionId: 's1', path: '/srv' })
    })

    it('renames a local item and refreshes the local listing', async () => {
      await openBothPanes()

      await store.renameLocalItem('/home/a/a.txt', '/home/a/b.txt')

      expect(argsOf('sftp_rename_local')).toEqual({ oldPath: '/home/a/a.txt', newPath: '/home/a/b.txt' })
      expect(argsOf('sftp_list_local')).toEqual({ dirPath: '/home/a' })
    })
  })

  describe('duplicate, size, checksum, symlink', () => {
    it('duplicates a local item', async () => {
      await openBothPanes()

      await store.duplicateItem('local', local('/home/a/a.txt'))

      expect(argsOf('sftp_duplicate_local_path')).toEqual({ path: '/home/a/a.txt', newName: null })
      expect(commands()).toContain('sftp_list_local')
    })

    it('duplicates a remote item using the current session by default', async () => {
      await openBothPanes()

      await store.duplicateItem('remote', remote('/srv/a.txt'))

      expect(argsOf('sftp_duplicate_remote_path')).toEqual({ sessionId: 's1', path: '/srv/a.txt', newName: null })
      expect(argsOf('sftp_list_remote')).toEqual({ sessionId: 's1', path: '/srv' })
    })

    it('does nothing for a remote item when there is no session', async () => {
      await store.duplicateItem('remote', remote('/srv/a.txt'))

      expect(invokeMock).not.toHaveBeenCalled()
    })

    it('calculates and remembers directory sizes for both panes', async () => {
      await openBothPanes()

      expect(await store.calculateDirSize('local', '/home/a/x')).toBe(42)
      expect(await store.calculateDirSize('remote', '/srv/y')).toBe(99)

      expect(store.calculatedDirSizes).toEqual({ '/home/a/x': 42, '/srv/y': 99 })
    })

    it('returns 0 for a remote directory size without a session', async () => {
      expect(await store.calculateDirSize('remote', '/srv/y')).toBe(0)
      expect(invokeMock).not.toHaveBeenCalled()
    })

    it('calculates checksums and fails clearly when there is no remote session', async () => {
      await openBothPanes()
      expect(await store.calculateChecksum('local', '/home/a/a', 'md5')).toBe('local-sum')
      expect(await store.calculateChecksum('remote', '/srv/a', 'sha256')).toBe('remote-sum')
      expect(argsOf('sftp_calculate_remote_checksum')).toEqual({ sessionId: 's1', path: '/srv/a', algorithm: 'sha256' })

      const fresh = (setActivePinia(createPinia()), useSftpStore())
      await expect(fresh.calculateChecksum('remote', '/srv/a', 'md5')).rejects.toThrow('No active session')
    })

    it('creates symlinks in both panes', async () => {
      await openBothPanes()

      await store.createSymlink('local', '/t', '/home/a/link')
      await store.createSymlink('remote', '/t', '/srv/link')

      expect(argsOf('sftp_create_local_symlink')).toEqual({ target: '/t', linkPath: '/home/a/link' })
      expect(argsOf('sftp_create_remote_symlink')).toEqual({ sessionId: 's1', target: '/t', linkPath: '/srv/link' })
    })
  })

  describe('archives', () => {
    it('extracts and compresses locally and refreshes the local listing', async () => {
      await openBothPanes()

      expect(await store.extractLocalArchive('/home/a/x.zip')).toBe('/result/archive')
      expect(argsOf('sftp_extract_local_archive')).toEqual({ archivePath: '/home/a/x.zip', targetDir: null })

      await store.compressLocalArchive('/home/a', ['a', 'b'], 'ab.zip')
      expect(argsOf('sftp_compress_local_archive')).toEqual({ parentDir: '/home/a', items: ['a', 'b'], archiveName: 'ab.zip' })
      expect(commands().filter((c) => c === 'sftp_list_local')).toHaveLength(2)
    })

    it('extracts and compresses remotely and refreshes the remote listing', async () => {
      await openBothPanes()

      await store.extractRemoteArchive('s1', '/srv/x.zip', '/srv/out')
      expect(argsOf('sftp_extract_remote_archive')).toEqual({ sessionId: 's1', archivePath: '/srv/x.zip', targetDir: '/srv/out' })

      await store.compressRemoteArchive('s1', '/srv', ['a'], 'a.zip')
      expect(argsOf('sftp_compress_remote_archive')).toEqual({ sessionId: 's1', parentDir: '/srv', items: ['a'], archiveName: 'a.zip' })
      expect(commands().filter((c) => c === 'sftp_list_remote')).toHaveLength(2)
    })
  })

  describe('clipboard', () => {
    it('ignores an empty copy', async () => {
      store.copyToClipboard('local', [])
      expect(store.clipboard).toBeNull()
    })

    it('remembers files, mode and source pane; remote falls back to the current session', async () => {
      await openBothPanes()

      store.copyToClipboard('local', [local('/home/a/a.txt')])
      expect(store.clipboard).toMatchObject({ sourcePane: 'local', mode: 'copy', sessionId: undefined })

      store.cutToClipboard('remote', [remote('/srv/a.txt')])
      expect(store.clipboard).toMatchObject({ sourcePane: 'remote', mode: 'cut', sessionId: 's1' })

      store.copyToClipboard('remote', [remote('/srv/a.txt')], 's2')
      expect(store.clipboard?.sessionId).toBe('s2')
    })

    it('pastes local to local: copy keeps the clipboard, cut moves and clears it', async () => {
      await openBothPanes()

      store.copyToClipboard('local', [local('/home/a/a.txt')])
      await store.pasteFromClipboard('local', '/home/b')
      expect(argsOf('sftp_copy_local_paths')).toEqual({ paths: ['/home/a/a.txt'], targetDir: '/home/b' })
      expect(store.clipboard).not.toBeNull()

      store.cutToClipboard('local', [local('/home/a/a.txt')])
      await store.pasteFromClipboard('local')
      expect(argsOf('sftp_move_local_paths')).toEqual({ paths: ['/home/a/a.txt'], targetDir: '/home/a' })
      expect(store.clipboard).toBeNull()
    })

    it('moves within one remote session on cut, then clears the clipboard', async () => {
      await openBothPanes()

      store.cutToClipboard('remote', [remote('/srv/a.txt')])
      await store.pasteFromClipboard('remote', '/srv/sub')

      expect(argsOf('sftp_move_remote_paths')).toEqual({ sessionId: 's1', paths: ['/srv/a.txt'], targetDir: '/srv/sub' })
      expect(argsOf('sftp_list_remote')).toEqual({ sessionId: 's1', path: '/srv/sub' })
      expect(store.clipboard).toBeNull()
    })

    it('does nothing when pasting into a remote pane without a session', async () => {
      await store.fetchLocalDir('/home/a')
      store.copyToClipboard('local', [local('/home/a/a.txt')])
      invokeMock.mockClear()

      await store.pasteFromClipboard('remote')

      expect(invokeMock).not.toHaveBeenCalled()
    })

    it('does nothing when the clipboard is empty', async () => {
      await openBothPanes()

      await store.pasteFromClipboard('local')

      expect(invokeMock).not.toHaveBeenCalled()
    })
  })
})
