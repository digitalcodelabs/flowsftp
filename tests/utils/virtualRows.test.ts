import { describe, it, expect } from 'vitest'
import {
  computeVirtualWindow,
  computeScrollTopForIndex,
  estimateBrowserRowHeight,
} from '../../app/components/sftp/panes/useVirtualFileRows'

describe('Virtual file row calculations', () => {
  it('keeps small directories unvirtualized below threshold', () => {
    const win = computeVirtualWindow(120, 0, 600, 26)
    expect(win.isVirtualized).toBe(false)
    expect(win.startIndex).toBe(0)
    expect(win.endIndex).toBe(120)
    expect(win.topSpacerHeight).toBe(0)
    expect(win.bottomSpacerHeight).toBe(0)
  })

  it('virtualizes 25,000 files with bounded DOM window and exact total height', () => {
    const total = 25_000
    const rowHeight = 25
    const win = computeVirtualWindow(total, 125_000, 500, rowHeight, 150, 30)

    expect(win.isVirtualized).toBe(true)
    const renderedCount = win.endIndex - win.startIndex
    expect(renderedCount).toBeLessThanOrEqual(90)
    expect(win.startIndex).toBe(5000 - 30)

    // Total virtual height (top spacer + rendered rows + bottom spacer) equals total * rowHeight
    const totalHeight = win.topSpacerHeight + renderedCount * rowHeight + win.bottomSpacerHeight
    expect(totalHeight).toBe(total * rowHeight)
  })

  it('computes scroll adjustments for keyboard navigation (Home, End, PageDown)', () => {
    // Parent row (-1) scrolls back to 0
    expect(computeScrollTopForIndex(-1, 10_000, 800, 500, 25, 30)).toBe(0)
    expect(computeScrollTopForIndex(-1, 10_000, 0, 500, 25, 30)).toBeNull()

    // Visible row returns null (no scroll jump)
    expect(computeScrollTopForIndex(5, 10_000, 0, 500, 25, 30)).toBeNull()

    // End key (index 9999) scrolls down so final row enters viewport
    const endScroll = computeScrollTopForIndex(9999, 10_000, 0, 500, 25, 30)
    expect(endScroll).not.toBeNull()
    expect(endScroll!).toBeGreaterThan(240_000)
  })

  it('scales estimated row height with font size and row density', () => {
    const compact = estimateBrowserRowHeight(12, 'compact')
    const normal = estimateBrowserRowHeight(12, 'normal')
    const relaxed = estimateBrowserRowHeight(12, 'relaxed')
    const largeNormal = estimateBrowserRowHeight(18, 'normal')

    expect(compact).toBeLessThan(normal)
    expect(normal).toBeLessThan(relaxed)
    expect(largeNormal).toBeGreaterThan(normal)
  })
})

