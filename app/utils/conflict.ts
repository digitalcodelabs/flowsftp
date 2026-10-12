/**
 * Pure decision rules for file-conflict handling (overwrite / skip) during transfers.
 *
 * These are kept free of Vue, Pinia and Tauri so they can be unit tested directly.
 * The SFTP store owns the reactive state and I/O and delegates the decisions here.
 */

export type ConflictPolicy = 'ask' | 'overwrite' | 'skip'
export type ConflictDecision = 'overwrite' | 'skip' | 'overwrite-all' | 'skip-all'
export type ConflictAction = 'overwrite' | 'skip'
/** "Overwrite All" / "Skip All" choice that sticks for the rest of the current batch. */
export type BatchConflictOverride = 'overwrite' | 'skip' | null

/**
 * Conflict state owned by ONE transfer operation (a drag-drop batch, a retry-all, ...).
 *
 * Every operation creates its own, so a sticky "Skip All" chosen in one batch can never
 * silently apply to another batch that happens to be running at the same time.
 */
export interface ConflictBatch {
  override: BatchConflictOverride
}

export function createConflictBatch(): ConflictBatch {
  return { override: null }
}

/**
 * Answer that is already known without looking at the destination, or `null` when the
 * destination has to be checked first.
 *
 * A sticky batch "skip" is intentionally *not* answered here: files that do not exist at
 * the destination must still be transferred.
 */
export function getPreCheckAction(
  policy: ConflictPolicy,
  batchOverride: BatchConflictOverride
): ConflictAction | null {
  if (batchOverride === 'overwrite') return 'overwrite'
  if (policy === 'overwrite' && !batchOverride) return 'overwrite'
  return null
}

/** What to do once the destination is known to exist: skip silently, or ask the user. */
export function getExistingAction(
  policy: ConflictPolicy,
  batchOverride: BatchConflictOverride
): ConflictAction | 'ask' {
  if (batchOverride === 'skip') return 'skip'
  if (policy === 'skip') return 'skip'
  return 'ask'
}

/**
 * Translates the user's dialog choice into the action for the current file and, for the
 * "All" variants, the sticky override to apply to the rest of the batch.
 */
export function resolveDecision(decision: ConflictDecision): {
  action: ConflictAction
  batchOverride: Exclude<BatchConflictOverride, null> | null
} {
  switch (decision) {
    case 'overwrite-all':
      return { action: 'overwrite', batchOverride: 'overwrite' }
    case 'skip-all':
      return { action: 'skip', batchOverride: 'skip' }
    case 'skip':
      return { action: 'skip', batchOverride: null }
    default:
      return { action: 'overwrite', batchOverride: null }
  }
}

/** True when `path` is one of `roots` or lives inside one of them (either slash style). */
export function isPathUnderRoots(path: string, roots: Iterable<string>): boolean {
  for (const root of roots) {
    if (path === root || path.startsWith(root + '/') || path.startsWith(root + '\\')) {
      return true
    }
  }
  return false
}

/**
 * Whether the per-file destination existence check can be skipped entirely:
 * the file lives in a folder that did not exist before the transfer started (so nothing
 * can collide), or the user already decided to overwrite everything.
 */
export function canSkipConflictCheck(opts: {
  isChildOfBrandNew: boolean
  policy: ConflictPolicy
  batchOverride: BatchConflictOverride
}): boolean {
  return opts.isChildOfBrandNew || opts.policy === 'overwrite' || opts.batchOverride === 'overwrite'
}
