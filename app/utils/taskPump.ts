/**
 * Producer/consumer queue used by the folder-transfer batches (upload, download and
 * remote-to-remote). A scan produces tasks while a pool of workers consumes them, so
 * transfers start immediately instead of waiting for a whole directory tree to be crawled.
 *
 * Pure (no Vue / Pinia / Tauri) so it can be unit tested directly.
 */

export interface PumpTask {
  /** Unique id; a task whose id was already pushed is ignored. */
  transferId: string
}

export interface TaskPumpOptions<T extends PumpTask> {
  /** Called once for every newly accepted task (e.g. to show it in the queue UI). */
  onEnqueue?: (task: T) => void
  /** Called when the scan is finished, before waiting workers are woken. */
  onFinishScanning?: () => void
}

export interface WorkerHooks<T extends PumpTask> {
  /** Return true to stop all workers (e.g. user cancelled everything). */
  shouldStop: () => boolean
  /** Awaited before each task, e.g. to honour a paused queue. */
  beforeTask?: () => Promise<void>
  /** Called when `process` throws. The worker keeps going. */
  onTaskError?: (task: T, error: unknown) => void
}

export class TaskPump<T extends PumpTask> {
  private readonly queue: T[] = []
  private readonly seen = new Set<string>()
  private readonly waiting: Array<() => void> = []
  private scanning = true

  constructor(private readonly options: TaskPumpOptions<T> = {}) {}

  /** Number of tasks that are queued but not yet picked up by a worker. */
  get pending(): number {
    return this.queue.length
  }

  get isScanning(): boolean {
    return this.scanning
  }

  /** Adds a task. Returns false when a task with the same id was already added. */
  push(task: T): boolean {
    if (this.seen.has(task.transferId)) return false
    this.seen.add(task.transferId)
    this.queue.push(task)
    this.options.onEnqueue?.(task)
    this.notify()
    return true
  }

  /** Signals that no more tasks will be pushed; idle workers can exit once the queue drains. */
  finishScanning(): void {
    this.scanning = false
    this.options.onFinishScanning?.()
    this.notify()
  }

  /** Wakes every idle worker. An arrow function so it can be registered as a callback as-is. */
  notify = (): void => {
    while (this.waiting.length > 0) {
      const wake = this.waiting.shift()
      if (wake) wake()
    }
  }

  /**
   * Runs `count` workers until the scan has finished and the queue is empty (or
   * `shouldStop` returns true). Resolves when every worker has exited.
   */
  async runWorkers(
    count: number,
    process: (task: T) => Promise<void>,
    hooks: WorkerHooks<T>
  ): Promise<void> {
    const worker = async (): Promise<void> => {
      while (true) {
        if (hooks.shouldStop()) break
        if (hooks.beforeTask) await hooks.beforeTask()
        if (hooks.shouldStop()) break

        const task = this.queue.shift()
        if (task) {
          try {
            await process(task)
          } catch (error) {
            hooks.onTaskError?.(task, error)
          }
        } else if (!this.scanning) {
          break
        } else {
          await new Promise<void>((resolve) => this.waiting.push(resolve))
        }
      }
    }

    await Promise.all(Array.from({ length: Math.max(1, count) }, () => worker()))
  }
}
