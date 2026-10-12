/**
 * Factories for the rows shown in the transfer queue.
 *
 * Upload, download and remote-to-remote transfers all produce the same row shapes
 * (queued, skipped, ignored); building them in one place keeps them consistent.
 * Pure: the caller supplies the server URL and (optionally) the clock.
 */
import type { TransferItem } from '../stores/sftp'

/** Prefix is matched by the queue UI to colour these rows amber instead of red. */
export const SKIPPED_MESSAGE = 'Skipped (file exists)'
export const IGNORED_PREFIX = 'Ignored'

export interface TransferSpec {
  id: string
  name: string
  /** Direction as shown in the queue. Remote-to-remote transfers count as 'upload'. */
  direction: 'upload' | 'download'
  size: number
  localPath?: string
  remotePath?: string
  /** Session that owns the remote side (the destination for remote-to-remote). */
  sessionId: string
  /** Source session; only set for remote-to-remote transfers. */
  srcSessionId?: string
  serverUrl: string
}

function baseItem(spec: TransferSpec, now: number): TransferItem {
  const item: TransferItem = {
    transfer_id: spec.id,
    file_name: spec.name,
    direction: spec.direction,
    bytes_transferred: 0,
    total_bytes: spec.size,
    speed_bytes_per_sec: 0,
    is_complete: false,
    local_path: spec.localPath,
    remote_path: spec.remotePath,
    session_id: spec.sessionId,
    server_url: spec.serverUrl,
    priority: 'Normal',
    started_at: now,
  }
  if (spec.srcSessionId !== undefined) {
    item.src_session_id = spec.srcSessionId
  }
  return item
}

/** A waiting row. */
export function buildQueuedItem(spec: TransferSpec, now = Date.now()): TransferItem {
  return { ...baseItem(spec, now), status: 'queued' }
}

/** A finished row for a file that already existed and was skipped on purpose. */
export function buildSkippedItem(spec: TransferSpec, now = Date.now()): TransferItem {
  return {
    ...baseItem(spec, now),
    bytes_transferred: spec.size,
    is_complete: true,
    error: SKIPPED_MESSAGE,
    completed_at: now,
    status: 'failed',
  }
}

/** A finished row for an item excluded by the user's transfer ignore filter. */
export function buildIgnoredItem(
  spec: TransferSpec,
  matchedPattern: string,
  isDir: boolean,
  now = Date.now()
): TransferItem {
  return {
    ...baseItem(spec, now),
    is_complete: true,
    is_dir: isDir,
    error: `${IGNORED_PREFIX} (filter rule: ${matchedPattern})`,
    completed_at: now,
    status: 'failed',
  }
}

/** Toast text summarising items dropped by the ignore filter. */
export function ignoredToastMessage(count: number, sampleName: string): string {
  return `Transfer filter: Ignored ${count} item${count > 1 ? 's' : ''} (${sampleName}${count > 1 ? '…' : ''})`
}

/** Title for the folder-progress banner: "src (+2 folders)". */
export function folderBatchTitle(names: string[]): string {
  if (names.length === 0) return ''
  return names.length > 1 ? `${names[0]} (+${names.length - 1} folders)` : names[0]!
}
