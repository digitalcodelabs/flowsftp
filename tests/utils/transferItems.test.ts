import { describe, it, expect } from 'vitest'
import {
  buildQueuedItem,
  buildSkippedItem,
  buildIgnoredItem,
  ignoredToastMessage,
  folderBatchTitle,
  SKIPPED_MESSAGE,
  IGNORED_PREFIX,
  type TransferSpec,
} from '../../app/utils/transferItems'

const upload: TransferSpec = {
  id: 'ul-1',
  name: 'a.txt',
  direction: 'upload',
  size: 100,
  localPath: 'C:/src/a.txt',
  remotePath: '/dest/a.txt',
  sessionId: 'sess',
  serverUrl: 'sftp://u@host',
}

const r2r: TransferSpec = { ...upload, id: 'r2r-1', srcSessionId: 'src-sess' }

describe('transfer row factories', () => {
  it('queued rows start empty and waiting', () => {
    expect(buildQueuedItem(upload, 1234)).toEqual({
      transfer_id: 'ul-1',
      file_name: 'a.txt',
      direction: 'upload',
      bytes_transferred: 0,
      total_bytes: 100,
      speed_bytes_per_sec: 0,
      is_complete: false,
      local_path: 'C:/src/a.txt',
      remote_path: '/dest/a.txt',
      session_id: 'sess',
      server_url: 'sftp://u@host',
      priority: 'Normal',
      started_at: 1234,
      status: 'queued',
    })
  })

  it('only remote-to-remote rows carry a source session', () => {
    expect(buildQueuedItem(upload)).not.toHaveProperty('src_session_id')
    expect(buildQueuedItem(r2r).src_session_id).toBe('src-sess')
  })

  it('skipped rows are finished, show full progress and use the "Skipped" message', () => {
    const item = buildSkippedItem(upload, 5000)

    expect(item).toMatchObject({
      is_complete: true,
      bytes_transferred: 100,
      total_bytes: 100,
      error: SKIPPED_MESSAGE,
      status: 'failed',
      completed_at: 5000,
    })
  })

  it('the queue UI recognises skipped and ignored rows by their message prefix', () => {
    // SftpTransferQueue.vue uses startsWith('Skipped') / startsWith('Ignored') to colour them
    // amber instead of red. Changing these strings would silently turn them red.
    expect(SKIPPED_MESSAGE.startsWith('Skipped')).toBe(true)
    expect(buildIgnoredItem(upload, '*.log', false).error!.startsWith(IGNORED_PREFIX)).toBe(true)
  })

  it('ignored rows name the matching rule and keep the folder flag', () => {
    const file = buildIgnoredItem(upload, '*.log', false, 9)
    const dir = buildIgnoredItem({ ...upload, size: 0 }, 'node_modules', true, 9)

    expect(file).toMatchObject({
      is_complete: true,
      is_dir: false,
      error: 'Ignored (filter rule: *.log)',
      bytes_transferred: 0,
      status: 'failed',
    })
    expect(dir).toMatchObject({ is_dir: true, error: 'Ignored (filter rule: node_modules)', total_bytes: 0 })
  })

  it('formats the ignore toast for one and many items', () => {
    expect(ignoredToastMessage(1, 'a.log')).toBe('Transfer filter: Ignored 1 item (a.log)')
    expect(ignoredToastMessage(3, 'a.log')).toBe('Transfer filter: Ignored 3 items (a.log…)')
  })

  it('titles a folder batch by its first folder', () => {
    expect(folderBatchTitle([])).toBe('')
    expect(folderBatchTitle(['src'])).toBe('src')
    expect(folderBatchTitle(['src', 'docs', 'img'])).toBe('src (+2 folders)')
  })
})
