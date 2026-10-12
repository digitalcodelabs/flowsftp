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
import { createConflictBatch, type ConflictBatch } from '../../app/utils/conflict'

const SRC = { size: 10, modified: 1000, path: '/src/file.txt' }

const existing = { exists: true, size: 5, modified: 500 }
const missing = { exists: false, size: 0, modified: 0 }

/** Resolves the next conflict dialog the way the UI would. */
async function answerDialog(store: ReturnType<typeof useSftpStore>, decision: Parameters<typeof store.resolveConflict>[0]) {
  await vi.waitFor(() => expect(store.activeConflictDialog?.show).toBe(true))
  store.resolveConflict(decision)
}

describe('SFTP store conflict resolution', () => {
  let store: ReturnType<typeof useSftpStore>
  let batch: ConflictBatch

  beforeEach(() => {
    invokeMock.mockReset()
    setActivePinia(createPinia())
    store = useSftpStore()
    store.conflictPolicy = 'ask'
    batch = createConflictBatch()
  })

  /** determineConflictAction as a batch of files would call it. */
  const decide = (
    direction: 'download' | 'upload' | 'transfer',
    name: string,
    dest: string,
    sessionId?: string,
    destIsRemote?: boolean,
    b: ConflictBatch = batch
  ) => store.determineConflictAction(direction, name, SRC, dest, sessionId, destIsRemote, b)

  it('overwrites without prompting when the destination does not exist', async () => {
    invokeMock.mockResolvedValue(missing)

    const action = await decide('upload', 'file.txt', '/dest/file.txt', 'sess-1')

    expect(action).toBe('overwrite')
    expect(store.activeConflictDialog).toBeNull()
  })

  it('prompts when the destination exists and honours "Skip" for that file only', async () => {
    invokeMock.mockResolvedValue(existing)

    const pending = decide('upload', 'file.txt', '/dest/file.txt', 'sess-1')
    await answerDialog(store, 'skip')

    expect(await pending).toBe('skip')
    expect(batch.override).toBeNull()
  })

  it('shows the transfer direction and both file details in the dialog', async () => {
    invokeMock.mockResolvedValue(existing)

    const pending = decide('transfer', 'file.txt', '/dest/file.txt', 'dest-sess', true)
    await vi.waitFor(() => expect(store.activeConflictDialog?.show).toBe(true))

    expect(store.activeConflictDialog).toMatchObject({
      fileName: 'file.txt',
      direction: 'transfer',
      source: SRC,
      destination: { size: 5, modified: 500, path: '/dest/file.txt' },
    })

    store.resolveConflict('overwrite')
    expect(await pending).toBe('overwrite')
  })

  it('"Skip All" skips later existing files without prompting but still transfers new ones', async () => {
    invokeMock.mockResolvedValue(existing)
    const first = decide('transfer', 'a.txt', '/dest/a.txt', 'dest', true)
    await answerDialog(store, 'skip-all')
    expect(await first).toBe('skip')
    expect(batch.override).toBe('skip')

    // Another existing file: skipped silently.
    expect(await decide('transfer', 'b.txt', '/dest/b.txt', 'dest', true)).toBe('skip')
    expect(store.activeConflictDialog).toBeNull()

    // A file that does not exist at the destination must still go through.
    invokeMock.mockResolvedValue(missing)
    expect(await decide('transfer', 'c.txt', '/dest/c.txt', 'dest', true)).toBe('overwrite')
  })

  it('"Overwrite All" overwrites later files without even checking the destination', async () => {
    invokeMock.mockResolvedValue(existing)
    const first = decide('transfer', 'a.txt', '/dest/a.txt', 'dest', true)
    await answerDialog(store, 'overwrite-all')
    expect(await first).toBe('overwrite')
    expect(batch.override).toBe('overwrite')

    invokeMock.mockClear()
    expect(await decide('transfer', 'b.txt', '/dest/b.txt', 'dest', true)).toBe('overwrite')
    expect(invokeMock).not.toHaveBeenCalled()
  })

  describe('batches are isolated from each other', () => {
    it('"Skip All" in one batch does not silence prompts in another batch', async () => {
      invokeMock.mockResolvedValue(existing)
      const other = createConflictBatch()

      const first = decide('upload', 'a.txt', '/dest/a.txt', 'sess-1')
      await answerDialog(store, 'skip-all')
      expect(await first).toBe('skip')
      expect(batch.override).toBe('skip')
      expect(other.override).toBeNull()

      // The other batch must still ask the user.
      const second = decide('upload', 'b.txt', '/dest/b.txt', 'sess-1', undefined, other)
      await vi.waitFor(() => expect(store.activeConflictDialog?.show).toBe(true))
      store.resolveConflict('overwrite')
      expect(await second).toBe('overwrite')
    })

    it('a prompt already waiting in the queue is answered by its own batch\'s "All" choice', async () => {
      invokeMock.mockResolvedValue(existing)

      const first = decide('upload', 'a.txt', '/dest/a.txt', 'sess-1')
      const second = decide('upload', 'b.txt', '/dest/b.txt', 'sess-1')
      // Both checks are in flight; only the first dialog is shown.
      await answerDialog(store, 'skip-all')

      expect(await first).toBe('skip')
      expect(await second).toBe('skip')
      // The second one never needed its own dialog.
      expect(store.activeConflictDialog).toBeNull()
    })

    it('a prompt waiting in the queue from a DIFFERENT batch still gets its own dialog', async () => {
      invokeMock.mockResolvedValue(existing)
      const other = createConflictBatch()

      const first = decide('upload', 'a.txt', '/dest/a.txt', 'sess-1')
      const second = decide('upload', 'b.txt', '/dest/b.txt', 'sess-1', undefined, other)
      await answerDialog(store, 'skip-all')
      expect(await first).toBe('skip')

      await vi.waitFor(() => expect(store.activeConflictDialog?.show).toBe(true))
      expect(store.activeConflictDialog?.fileName).toBe('b.txt')
      store.resolveConflict('overwrite')
      expect(await second).toBe('overwrite')
    })

    it('callers that pass no batch get a fresh one every time (nothing sticks)', async () => {
      invokeMock.mockResolvedValue(existing)

      const first = store.determineConflictAction('upload', 'a.txt', SRC, '/dest/a.txt', 'sess-1')
      await answerDialog(store, 'skip-all')
      expect(await first).toBe('skip')

      const second = store.determineConflictAction('upload', 'b.txt', SRC, '/dest/b.txt', 'sess-1')
      await vi.waitFor(() => expect(store.activeConflictDialog?.show).toBe(true))
      store.resolveConflict('overwrite')
      expect(await second).toBe('overwrite')
    })
  })

  it('policy "skip" skips existing files silently', async () => {
    store.conflictPolicy = 'skip'
    invokeMock.mockResolvedValue(existing)

    expect(await decide('upload', 'file.txt', '/dest/file.txt', 'sess-1')).toBe('skip')
    expect(store.activeConflictDialog).toBeNull()
  })

  it('policy "overwrite" overwrites without checking the destination', async () => {
    store.conflictPolicy = 'overwrite'

    expect(await decide('upload', 'file.txt', '/dest/file.txt', 'sess-1')).toBe('overwrite')
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('falls back to overwrite when the existence check fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    invokeMock.mockRejectedValue(new Error('network down'))

    expect(await decide('upload', 'file.txt', '/dest/file.txt', 'sess-1')).toBe('overwrite')
    warn.mockRestore()
  })

  describe('which side is checked for each direction', () => {
    beforeEach(() => invokeMock.mockResolvedValue(missing))

    it('upload checks the remote destination on the given session', async () => {
      await decide('upload', 'f', '/remote/f', 'sess-1')
      expect(invokeMock).toHaveBeenCalledWith('sftp_check_conflict', {
        sessionId: 'sess-1',
        path: '/remote/f',
        isRemote: true,
      })
    })

    it('download checks the local destination and ignores the session', async () => {
      await decide('download', 'f', 'C:/local/f', 'sess-1')
      expect(invokeMock).toHaveBeenCalledWith('sftp_check_conflict', {
        sessionId: null,
        path: 'C:/local/f',
        isRemote: false,
      })
    })

    it('remote-to-remote transfer checks the destination server, not the source', async () => {
      await decide('transfer', 'f', '/dest/f', 'dest-sess', true)
      expect(invokeMock).toHaveBeenCalledWith('sftp_check_conflict', {
        sessionId: 'dest-sess',
        path: '/dest/f',
        isRemote: true,
      })
    })
  })
})
