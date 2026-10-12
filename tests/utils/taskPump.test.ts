import { describe, it, expect, vi } from 'vitest'
import { TaskPump } from '../../app/utils/taskPump'

const task = (id: string) => ({ transferId: id })
const never = () => false

describe('TaskPump', () => {
  it('ignores a task whose id was already pushed', () => {
    const onEnqueue = vi.fn()
    const pump = new TaskPump({ onEnqueue })

    expect(pump.push(task('a'))).toBe(true)
    expect(pump.push(task('a'))).toBe(false)

    expect(pump.pending).toBe(1)
    expect(onEnqueue).toHaveBeenCalledTimes(1)
  })

  it('processes every task exactly once across several workers', async () => {
    const pump = new TaskPump()
    for (let i = 0; i < 20; i++) pump.push(task(`t${i}`))
    pump.finishScanning()

    const seen: string[] = []
    await pump.runWorkers(4, async (t) => {
      await Promise.resolve()
      seen.push(t.transferId)
    }, { shouldStop: never })

    expect(seen.sort()).toEqual(Array.from({ length: 20 }, (_, i) => `t${i}`).sort())
    expect(pump.pending).toBe(0)
  })

  it('never runs more tasks at once than there are workers', async () => {
    const pump = new TaskPump()
    for (let i = 0; i < 10; i++) pump.push(task(`t${i}`))
    pump.finishScanning()

    let running = 0
    let peak = 0
    await pump.runWorkers(3, async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 2))
      running--
    }, { shouldStop: never })

    expect(peak).toBe(3)
  })

  it('keeps idle workers alive while scanning and picks up tasks that arrive later', async () => {
    const pump = new TaskPump()
    const seen: string[] = []
    const done = pump.runWorkers(2, async (t) => { seen.push(t.transferId) }, { shouldStop: never })

    // Workers are idle (queue empty, scan still running); give them a chance to park.
    await new Promise((r) => setTimeout(r, 5))
    expect(seen).toEqual([])

    pump.push(task('late-1'))
    pump.push(task('late-2'))
    await vi.waitFor(() => expect(seen.sort()).toEqual(['late-1', 'late-2']))

    pump.finishScanning()
    await done // must resolve, not hang
  })

  it('workers exit immediately when the scan finishes with nothing queued', async () => {
    const pump = new TaskPump()
    const done = pump.runWorkers(3, async () => {}, { shouldStop: never })
    pump.finishScanning()
    await done
  })

  it('a failing task is reported and does not stop the worker', async () => {
    const pump = new TaskPump()
    pump.push(task('bad'))
    pump.push(task('good'))
    pump.finishScanning()

    const ok: string[] = []
    const onTaskError = vi.fn()
    await pump.runWorkers(1, async (t) => {
      if (t.transferId === 'bad') throw new Error('boom')
      ok.push(t.transferId)
    }, { shouldStop: never, onTaskError })

    expect(ok).toEqual(['good'])
    expect(onTaskError).toHaveBeenCalledTimes(1)
    expect(onTaskError.mock.calls[0]![0]).toEqual({ transferId: 'bad' })
  })

  it('shouldStop halts workers, including ones parked waiting for tasks', async () => {
    const pump = new TaskPump()
    let stop = false
    const done = pump.runWorkers(2, async () => {}, { shouldStop: () => stop })

    await new Promise((r) => setTimeout(r, 5))
    stop = true
    pump.notify() // what cancel-all does to wake idle workers
    await done
  })

  it('shouldStop prevents further tasks from starting', async () => {
    const pump = new TaskPump()
    for (let i = 0; i < 5; i++) pump.push(task(`t${i}`))
    pump.finishScanning()

    let stop = false
    const seen: string[] = []
    await pump.runWorkers(1, async (t) => {
      seen.push(t.transferId)
      if (seen.length === 2) stop = true
    }, { shouldStop: () => stop })

    expect(seen).toEqual(['t0', 't1'])
    expect(pump.pending).toBe(3)
  })

  it('awaits beforeTask (e.g. a paused queue) before taking each task', async () => {
    const pump = new TaskPump()
    pump.push(task('a'))
    pump.finishScanning()

    let released = false
    const events: string[] = []
    const done = pump.runWorkers(1, async () => { events.push('process') }, {
      shouldStop: never,
      beforeTask: async () => {
        events.push('before')
        await vi.waitFor(() => expect(released).toBe(true))
      },
    })

    await new Promise((r) => setTimeout(r, 10))
    expect(events).toEqual(['before']) // paused: nothing processed yet
    released = true
    await done
    expect(events).toEqual(['before', 'process', 'before'])
  })

  it('calls onFinishScanning before waking workers', async () => {
    const order: string[] = []
    const pump = new TaskPump({ onFinishScanning: () => order.push('finish') })
    const done = pump.runWorkers(1, async () => {}, {
      shouldStop: never,
      beforeTask: async () => { order.push('worker-loop') },
    })
    await new Promise((r) => setTimeout(r, 5))
    pump.finishScanning()
    await done
    expect(order.indexOf('finish')).toBeGreaterThan(-1)
    expect(pump.isScanning).toBe(false)
  })
})
