/**
 * Overwrite / skip handling for transfers.
 *
 * Owns the user's conflict policy, the dialog shown when a destination file already exists,
 * and the decision logic. "Skip All" / "Overwrite All" is NOT kept here: it lives in the
 * ConflictBatch owned by each transfer operation, so concurrent batches can't affect each other.
 */
import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import {
  getPreCheckAction,
  getExistingAction,
  resolveDecision,
  createConflictBatch,
  type ConflictPolicy,
  type ConflictDecision,
  type ConflictAction,
  type ConflictBatch,
} from '../../utils/conflict'
import type { ConflictDialogState, FileConflictInfo } from './types'

export function useConflictResolution() {
  const conflictPolicy = ref<ConflictPolicy>('ask')
  const activeConflictDialog = ref<ConflictDialogState | null>(null)

  function resolveConflict(decision: ConflictDecision) {
    // The dialog's resolver also applies "All" decisions to the batch that asked.
    activeConflictDialog.value?.resolveDecision?.(decision)
    activeConflictDialog.value = null
  }

  let conflictQueue: Promise<void> = Promise.resolve()

  async function promptConflictDialog(
    data: Omit<ConflictDialogState, 'show' | 'resolveDecision'>,
    batch: ConflictBatch
  ): Promise<ConflictDecision> {
    if (batch.override === 'overwrite') return 'overwrite'
    if (batch.override === 'skip') return 'skip'

    return new Promise<ConflictDecision>((resolve) => {
      conflictQueue = conflictQueue.then(async () => {
        // The user may have answered "All" for this batch while this prompt was waiting.
        if (batch.override === 'overwrite') {
          resolve('overwrite')
          return
        }
        if (batch.override === 'skip') {
          resolve('skip')
          return
        }
        await new Promise<void>((dialogDone) => {
          activeConflictDialog.value = {
            ...data,
            show: true,
            resolveDecision: (decision) => {
              // Set synchronously, before the next queued prompt is looked at.
              const { batchOverride } = resolveDecision(decision)
              if (batchOverride) batch.override = batchOverride
              resolve(decision)
              dialogDone()
            },
          }
        })
      })
    })
  }

  /**
   * Decides whether to overwrite or skip a file that is about to be transferred, prompting
   * the user when needed. `batch` carries the sticky "All" answer for the current operation;
   * callers that transfer several files should share one, single transfers may omit it.
   */
  async function determineConflictAction(
    direction: 'download' | 'upload' | 'transfer',
    fileName: string,
    sourceMeta: { size: number; modified: number; path: string },
    destinationPath: string,
    sessionId?: string,
    destinationIsRemote?: boolean,
    batch: ConflictBatch = createConflictBatch()
  ): Promise<ConflictAction> {
    const known = getPreCheckAction(conflictPolicy.value, batch.override)
    if (known) {
      return known
    }

    try {
      const isRemote = destinationIsRemote !== undefined
        ? destinationIsRemote
        : (direction === 'upload' || direction === 'transfer')
      const conflictInfo = await invoke<FileConflictInfo>('sftp_check_conflict', {
        sessionId: isRemote ? (sessionId || null) : null,
        path: destinationPath,
        isRemote,
      })

      if (!conflictInfo.exists) {
        return 'overwrite'
      }

      const existing = getExistingAction(conflictPolicy.value, batch.override)
      if (existing !== 'ask') {
        return existing
      }

      const decision = await promptConflictDialog(
        {
          fileName,
          direction,
          source: sourceMeta,
          destination: {
            size: conflictInfo.size,
            modified: conflictInfo.modified,
            path: destinationPath,
          },
        },
        batch
      )

      // A sticky "All" answer was already stored on `batch` by the dialog's resolver.
      return resolveDecision(decision).action
    } catch (err) {
      console.warn('Failed to check conflict, defaulting to overwrite:', err)
      return 'overwrite'
    }
  }

  return { conflictPolicy, activeConflictDialog, resolveConflict, determineConflictAction }
}
