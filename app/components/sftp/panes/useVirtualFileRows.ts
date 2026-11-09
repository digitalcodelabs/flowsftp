import { ref, computed, watch, onMounted, onUnmounted, nextTick, type Ref } from 'vue'

export const VIRTUAL_ROW_THRESHOLD = 150
export const VIRTUAL_ROW_OVERSCAN = 30

export interface VirtualWindowState {
  isVirtualized: boolean
  startIndex: number
  endIndex: number
  topSpacerHeight: number
  bottomSpacerHeight: number
}

export interface IndexedVirtualRow<T> {
  item: T
  index: number
}

export function estimateBrowserRowHeight(
  fontSize: number,
  density: 'compact' | 'normal' | 'relaxed' | string
): number {
  const safeFont = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 12
  const baseLine = Math.max(16, Math.round(safeFont * 1.45))
  if (density === 'compact') return baseLine + 4
  if (density === 'relaxed') return baseLine + 12
  return baseLine + 8
}

export function computeVirtualWindow(
  totalCount: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  threshold = VIRTUAL_ROW_THRESHOLD,
  overscan = VIRTUAL_ROW_OVERSCAN
): VirtualWindowState {
  if (totalCount <= threshold || rowHeight <= 0) {
    return {
      isVirtualized: false,
      startIndex: 0,
      endIndex: Math.max(0, totalCount),
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
    }
  }

  const safeScrollTop = Math.max(0, scrollTop)
  const effectiveViewport = Math.max(viewportHeight, 420)
  const rawStart = Math.max(0, Math.floor(safeScrollTop / rowHeight) - overscan)
  const visibleCount = Math.ceil(effectiveViewport / rowHeight) + overscan * 2

  const startIndex = Math.min(rawStart, Math.max(0, totalCount - 1))
  const endIndex = Math.min(totalCount, startIndex + visibleCount)

  return {
    isVirtualized: true,
    startIndex,
    endIndex,
    topSpacerHeight: Math.round(startIndex * rowHeight),
    bottomSpacerHeight: Math.max(0, Math.round((totalCount - endIndex) * rowHeight)),
  }
}

export function computeScrollTopForIndex(
  index: number,
  totalCount: number,
  currentScrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  headerOffset = 30
): number | null {
  if (index < 0) {
    return currentScrollTop > 0 ? 0 : null
  }
  if (totalCount <= 0 || rowHeight <= 0) {
    return null
  }

  const clampedIndex = Math.max(0, Math.min(index, totalCount - 1))
  const rowTop = headerOffset + clampedIndex * rowHeight
  const rowBottom = rowTop + rowHeight
  const effectiveViewport = Math.max(viewportHeight, rowHeight * 6)
  const visibleTop = currentScrollTop + headerOffset
  const visibleBottom = currentScrollTop + effectiveViewport

  if (rowTop < visibleTop) {
    return Math.max(0, Math.floor(rowTop - headerOffset))
  }
  if (rowBottom > visibleBottom) {
    return Math.max(0, Math.ceil(rowBottom - effectiveViewport))
  }
  return null
}

export function useVirtualFileRows<T>(options: {
  items: () => T[]
  scrollContainerRef: Ref<HTMLElement | null>
  estimatedRowHeight: () => number
  resetKey?: () => string
}) {
  const scrollTop = ref(0)
  const viewportHeight = ref(600)
  const measuredRowHeight = ref<number | null>(null)
  let resizeObserver: ResizeObserver | null = null

  const effectiveRowHeight = computed(() => {
    const measured = measuredRowHeight.value
    if (measured && measured >= 16 && measured <= 120) {
      return measured
    }
    return options.estimatedRowHeight()
  })

  const measureRenderedRow = () => {
    const container = options.scrollContainerRef.value
    if (!container) return
    const sampleRow = container.querySelector<HTMLElement>(
      'tbody tr.file-row:not(#local-row-parent):not(#remote-row-parent)'
    )
    if (sampleRow && sampleRow.offsetHeight > 0) {
      measuredRowHeight.value = sampleRow.offsetHeight
    }
  }

  const handleTableScroll = (e?: Event) => {
    const el = (e?.currentTarget as HTMLElement | null) || options.scrollContainerRef.value
    if (!el) return
    scrollTop.value = el.scrollTop
    if (el.clientHeight > 0) {
      viewportHeight.value = el.clientHeight
    }
    if (measuredRowHeight.value === null) {
      measureRenderedRow()
    }
  }

  const windowState = computed(() =>
    computeVirtualWindow(
      options.items().length,
      scrollTop.value,
      viewportHeight.value,
      effectiveRowHeight.value
    )
  )

  const visibleRows = computed<IndexedVirtualRow<T>[]>(() => {
    const list = options.items()
    const { isVirtualized, startIndex, endIndex } = windowState.value
    if (!isVirtualized) {
      return list.map((item, index) => ({ item, index }))
    }
    const slice: IndexedVirtualRow<T>[] = []
    for (let i = startIndex; i < endIndex; i++) {
      const item = list[i]
      if (item !== undefined) {
        slice.push({ item, index: i })
      }
    }
    return slice
  })

  const scrollToIndex = (index: number) => {
    const el = options.scrollContainerRef.value
    if (!el) return

    const totalCount = options.items().length
    if (!windowState.value.isVirtualized) {
      if (index < 0) {
        el.scrollTop = 0
        scrollTop.value = 0
      }
      return
    }

    const headerEl = el.querySelector('thead')
    const parentRowEl = el.querySelector<HTMLElement>('#local-row-parent, #remote-row-parent')
    const headerOffset = (headerEl?.offsetHeight || 28) + (parentRowEl?.offsetHeight || 0)
    const vh = el.clientHeight > 0 ? el.clientHeight : viewportHeight.value

    const nextTop = computeScrollTopForIndex(
      index,
      totalCount,
      el.scrollTop,
      vh,
      effectiveRowHeight.value,
      headerOffset
    )

    if (nextTop !== null) {
      el.scrollTop = nextTop
      scrollTop.value = nextTop
    }
  }

  watch(
    options.estimatedRowHeight,
    () => {
      measuredRowHeight.value = null
      nextTick(measureRenderedRow)
    }
  )

  if (options.resetKey) {
    watch(options.resetKey, () => {
      scrollTop.value = 0
      if (options.scrollContainerRef.value) {
        options.scrollContainerRef.value.scrollTop = 0
      }
      nextTick(measureRenderedRow)
    })
  }

  watch(
    () => options.items().length,
    (len) => {
      if (len > VIRTUAL_ROW_THRESHOLD && measuredRowHeight.value === null) {
        nextTick(measureRenderedRow)
      }
    }
  )

  onMounted(() => {
    const el = options.scrollContainerRef.value
    if (el) {
      if (el.clientHeight > 0) {
        viewportHeight.value = el.clientHeight
      }
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver((entries) => {
          const entry = entries[0]
          if (entry && entry.contentRect.height > 0) {
            viewportHeight.value = entry.contentRect.height
          }
        })
        resizeObserver.observe(el)
      }
    }
    nextTick(measureRenderedRow)
  })

  onUnmounted(() => {
    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
  })

  return {
    windowState,
    visibleRows,
    handleTableScroll,
    scrollToIndex,
  }
}

