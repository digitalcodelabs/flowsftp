<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Channel, invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useSettingsStore } from '../stores/settings'
import { useThemeStore } from '../stores/theme'
import { getKeymapAction, emitKeymapAction, isFileManagerAction, type KeymapAction } from '../utils/keymap'

const props = withDefaults(
  defineProps<{
    sessionId: string
    autoFocus?: boolean
    active?: boolean
  }>(),
  {
    autoFocus: true,
    active: true,
  }
)

const emit = defineEmits<{
  (e: 'exit'): void
  (e: 'resize', dims: { cols: number; rows: number }): void
  (e: 'action', action: KeymapAction): void
}>()

const settingsStore = useSettingsStore()
const themeStore = useThemeStore()

const terminalEl = ref<HTMLDivElement | null>(null)
let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let webglAddon: WebglAddon | null = null
let resizeObserver: ResizeObserver | null = null
let resizeRafId: number | null = null
let unlistenStdoutFallback: UnlistenFn | null = null
let unlistenExit: UnlistenFn | null = null
let onDataDisposable: { dispose: () => void } | null = null
let onBinaryDisposable: { dispose: () => void } | null = null
let isUnmounted = false

// High-throughput binary output queue (backpressure-coupled to xterm's parser so fast Neovim
// redraws / scrolling never build rubber-band lag)
let writeInFlight = false
let pendingOutputChunks: Uint8Array[] = []
let pendingOutputBytes = 0

// Zero-latency coalescing STDIN sender (sends the first keystroke in 0ms and batches rapid
// Neovim key-repeat / mouse-motion bursts while an IPC call is in flight)
let stdinInFlight = false
let pendingStdin = ''

const SGR_PURE_HOVER_RE = /^(?:\x1b\[<35;\d+;\d+[Mm])+$/

function toUint8Array(raw: unknown): Uint8Array | null {
  if (!raw) return null
  if (raw instanceof Uint8Array) return raw.byteLength > 0 ? raw : null
  if (raw instanceof ArrayBuffer) return raw.byteLength > 0 ? new Uint8Array(raw) : null
  if (ArrayBuffer.isView(raw)) {
    return raw.byteLength > 0 ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) : null
  }
  if (Array.isArray(raw)) return raw.length > 0 ? new Uint8Array(raw) : null
  if (typeof raw === 'string') return raw.length > 0 ? new TextEncoder().encode(raw) : null
  return null
}

function flushPendingOutput() {
  if (isUnmounted || !terminal || pendingOutputChunks.length === 0) {
    writeInFlight = false
    pendingOutputChunks = []
    pendingOutputBytes = 0
    return
  }

  let batch: Uint8Array
  if (pendingOutputChunks.length === 1) {
    batch = pendingOutputChunks[0]!
  } else {
    batch = new Uint8Array(pendingOutputBytes)
    let offset = 0
    for (const part of pendingOutputChunks) {
      batch.set(part, offset)
      offset += part.byteLength
    }
  }
  pendingOutputChunks = []
  pendingOutputBytes = 0
  writeInFlight = true
  terminal.write(batch, flushPendingOutput)
}

function enqueueTerminalBytes(bytes: Uint8Array | null) {
  if (!bytes || bytes.byteLength === 0 || isUnmounted || !terminal) return
  if (!writeInFlight && pendingOutputChunks.length === 0) {
    writeInFlight = true
    terminal.write(bytes, flushPendingOutput)
  } else {
    pendingOutputChunks.push(bytes)
    pendingOutputBytes += bytes.byteLength
  }
}

function flushStdinQueue() {
  if (isUnmounted || !pendingStdin) {
    stdinInFlight = false
    pendingStdin = ''
    return
  }
  const chunk = pendingStdin
  pendingStdin = ''
  stdinInFlight = true
  invoke('ssh_write_stdin', {
    sessionId: props.sessionId,
    data: chunk,
  })
    .catch((err) => {
      console.error('Failed to write STDIN to SSH session:', err)
    })
    .finally(() => {
      if (pendingStdin && !isUnmounted) {
        flushStdinQueue()
      } else {
        stdinInFlight = false
      }
    })
}

function sendStdinFast(data: string) {
  if (!data || isUnmounted) return
  if (!stdinInFlight) {
    pendingStdin = data
    flushStdinQueue()
    return
  }
  // When Neovim `mousemoveevent` emits 120-240 pure hover coordinates/sec while an IPC call
  // is in flight, coalesce intermediate hover positions to the latest cursor cell.
  if (pendingStdin && SGR_PURE_HOVER_RE.test(pendingStdin) && SGR_PURE_HOVER_RE.test(data)) {
    pendingStdin = data
  } else {
    pendingStdin += data
  }
}

const scheduleSyncDimensions = () => {
  if (resizeRafId !== null) return
  resizeRafId = requestAnimationFrame(() => {
    resizeRafId = null
    if (!isUnmounted) {
      syncDimensions()
    }
  })
}

let lastCols = 0
let lastRows = 0
let lastClipboardPasteAt = 0

const copyTerminalSelection = () => {
  const selection = terminal?.getSelection()
  if (!selection) return
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(selection).catch((err) => {
      console.warn('Failed to copy terminal selection to clipboard:', err)
    })
  }
}

const pasteClipboardIntoTerminal = () => {
  if (!navigator.clipboard?.readText) return
  lastClipboardPasteAt = Date.now()
  navigator.clipboard
    .readText()
    .then((text) => {
      if (text && terminal) {
        terminal.paste(text)
      }
    })
    .catch((err) => {
      console.warn('Failed to read clipboard for terminal paste:', err)
    })
}

const handleNativePaste = (e: ClipboardEvent) => {
  // Prevent duplicate paste if our Ctrl+Shift+V / Cmd+V keydown handler already invoked terminal.paste()
  if (Date.now() - lastClipboardPasteAt < 150) {
    e.preventDefault()
    e.stopPropagation()
  }
}

const handleTerminalWheel = (e: WheelEvent) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault()
    if (e.deltaY < 0) {
      settingsStore.zoomInTerminal()
    } else if (e.deltaY > 0) {
      settingsStore.zoomOutTerminal()
    }
  }
}

// Watch for live font/size setting changes
watch(
  () => [settingsStore.terminalFontFamily, settingsStore.terminalFontSize, settingsStore.terminalLineHeight] as const,
  ([font, size, lh]) => {
    if (terminal) {
      terminal.options.fontFamily = font
      terminal.options.fontSize = size
      terminal.options.lineHeight = lh
      fitAddon?.fit()
      syncDimensions()
    }
  }
)

// Watch for live theme changes
watch(
  () => themeStore.currentTheme.terminal,
  (newTermTheme) => {
    if (terminal && newTermTheme) {
      terminal.options.theme = { ...newTermTheme }
    }
  },
  { deep: true }
)

// 7. Synchronize terminal dimensions with Rust PTY with safety guards
const syncDimensions = () => {
  if (!terminal || !fitAddon || !terminalEl.value) return

  // Guard against hidden or 0x0 collapsed elements
  const width = terminalEl.value.clientWidth
  const height = terminalEl.value.clientHeight
  if (width <= 0 || height <= 0) return

  try {
    fitAddon.fit()
  } catch {
    return
  }

  const { cols, rows } = terminal
  if (cols <= 10 || rows <= 2) return

  // Prevent sending redundant resize SIGWINCH if dimensions haven't changed
  if (cols === lastCols && rows === lastRows) return
  lastCols = cols
  lastRows = rows

  emit('resize', { cols, rows })

  invoke('ssh_resize_pty', {
    sessionId: props.sessionId,
    cols,
    rows,
  }).catch((err) => {
    console.warn('Failed to resize PTY:', err)
  })
}

// Watch for tab visibility changes
watch(
  () => props.active,
  (isActive) => {
    if (isActive) {
      requestAnimationFrame(() => {
        if (isUnmounted) return
        syncDimensions()
        if (props.autoFocus) {
          terminal?.focus()
        }
      })
    }
  }
)

const initTerminal = async () => {
  if (!terminalEl.value) return

  // 1. Instantiate xterm.js Terminal tuned for low-latency TUI apps (Neovim / tmux / htop)
  terminal = new Terminal({
    allowProposedApi: true,
    cursorBlink: true,
    cursorStyle: 'block',
    customGlyphs: true,
    rescaleOverlappingGlyphs: true,
    minimumContrastRatio: 1,
    fastScrollSensitivity: 5,
    scrollSensitivity: 1,
    smoothScrollDuration: 0,
    fontSize: settingsStore.terminalFontSize,
    fontFamily: settingsStore.terminalFontFamily,
    lineHeight: settingsStore.terminalLineHeight,
    scrollback: 5000,
    theme: { ...themeStore.currentTheme.terminal },
  })

  // 2. Attach FitAddon
  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)

  // 3. Open in DOM & attach WebGL GPU-accelerated renderer
  terminal.open(terminalEl.value)
  fitAddon.fit()

  try {
    webglAddon = new WebglAddon()
    webglAddon.onContextLoss(() => {
      webglAddon?.dispose()
      webglAddon = null
    })
    terminal.loadAddon(webglAddon)
  } catch (err) {
    console.warn('WebGL renderer unavailable, falling back to DOM renderer:', err)
  }

  // Intercept application shortcuts before xterm processes them (e.g. Ctrl+Tab to cycle connections, Ctrl+` to toggle view, zoom, copy/paste)
  terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
    const isCtrlOrCmd = event.ctrlKey || event.metaKey

    // Copy selected terminal text: Ctrl+Shift+C (or Cmd+C on macOS)
    const isCopyShortcut =
      (event.ctrlKey && event.shiftKey && !event.altKey && (event.key.toLowerCase() === 'c' || event.code === 'KeyC')) ||
      (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && (event.key.toLowerCase() === 'c' || event.code === 'KeyC'))
    if (isCopyShortcut) {
      event.preventDefault()
      event.stopPropagation()
      if (event.type === 'keydown') {
        copyTerminalSelection()
      }
      return false
    }

    // Paste clipboard text into terminal: Ctrl+Shift+V (or Cmd+V on macOS)
    const isPasteShortcut =
      (event.ctrlKey && event.shiftKey && !event.altKey && (event.key.toLowerCase() === 'v' || event.code === 'KeyV')) ||
      (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && (event.key.toLowerCase() === 'v' || event.code === 'KeyV'))
    if (isPasteShortcut) {
      event.preventDefault()
      event.stopPropagation()
      if (event.type === 'keydown') {
        pasteClipboardIntoTerminal()
      }
      return false
    }

    // Terminal Zoom shortcuts: Ctrl + (zoom in), Ctrl - (zoom out), Ctrl 0 (reset zoom)
    if (isCtrlOrCmd && !event.altKey) {
      if (event.key === '+' || event.key === '=' || event.code === 'Equal' || event.code === 'NumpadAdd') {
        event.preventDefault()
        event.stopPropagation()
        if (event.type === 'keydown') {
          settingsStore.zoomInTerminal()
        }
        return false
      }
      if (event.key === '-' || event.key === '_' || event.code === 'Minus' || event.code === 'NumpadSubtract') {
        event.preventDefault()
        event.stopPropagation()
        if (event.type === 'keydown') {
          settingsStore.zoomOutTerminal()
        }
        return false
      }
      if (!event.shiftKey && (event.key === '0' || event.code === 'Digit0' || event.code === 'Numpad0')) {
        event.preventDefault()
        event.stopPropagation()
        if (event.type === 'keydown') {
          settingsStore.resetTerminalZoom()
        }
        return false
      }
    }

    if (event.type === 'keydown') {
      // Standard terminal editing keys must always go directly to xterm
      if (
        event.key === 'Backspace' ||
        event.key === 'Enter' ||
        (event.key === 'Tab' && !event.ctrlKey)
      ) {
        return true
      }

      const action = getKeymapAction(event, settingsStore.keymaps)
      // Only intercept application-level actions (view toggle, tab cycle, settings), never file manager navigation
      if (action && !isFileManagerAction(action)) {
        event.preventDefault()
        event.stopPropagation()
        emit('action', action)
        emitKeymapAction(action)
        return false
      }
    }
    return true
  })

  if (props.autoFocus) {
    terminal.focus()
  }

  // 4. Stream STDIN from xterm -> Rust with 0ms first-byte dispatch & burst coalescing
  onDataDisposable = terminal.onData((data: string) => {
    sendStdinFast(data)
  })
  onBinaryDisposable = terminal.onBinary((binaryStr: string) => {
    const bytes = new Array<number>(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i) & 0xff
    }
    invoke('ssh_write_stdin_bytes', {
      sessionId: props.sessionId,
      data: bytes,
    }).catch((err) => {
      console.error('Failed to write binary STDIN to SSH session:', err)
    })
  })

  // 5. Attach raw binary Tauri IPC Channel (`ArrayBuffer` -> `Uint8Array`) so PTY output
  //    streams straight into xterm's UTF-8 byte parser without JSON escaping or split-UTF-8 loss
  let historyApplied = false
  const earlyLiveChunks: Uint8Array[] = []
  const stdoutChannel = new Channel<ArrayBuffer | Uint8Array | number[]>((chunk) => {
    const bytes = toUint8Array(chunk)
    if (!bytes) return
    if (!historyApplied) {
      earlyLiveChunks.push(bytes)
    } else {
      enqueueTerminalBytes(bytes)
    }
  })

  try {
    const historyRaw = await invoke<ArrayBuffer | Uint8Array | number[] | string>(
      'ssh_attach_stdout',
      {
        sessionId: props.sessionId,
        onData: stdoutChannel,
      }
    )
    if (isUnmounted) return
    const historyBytes = toUint8Array(historyRaw)
    if (historyBytes) {
      enqueueTerminalBytes(historyBytes)
    }
    historyApplied = true
    for (const queued of earlyLiveChunks) {
      enqueueTerminalBytes(queued)
    }
    earlyLiveChunks.length = 0
  } catch (err) {
    if (isUnmounted) return
    console.warn('Binary stdout channel unavailable, falling back to event stream:', err)
    historyApplied = true
    try {
      const history = await invoke<string>('ssh_get_history', {
        sessionId: props.sessionId,
      })
      if (isUnmounted) return
      if (history && terminal) {
        terminal.write(history)
      }
    } catch {}

    const stdoutUnlisten = await listen<string>(`ssh:stdout:${props.sessionId}`, (event) => {
      enqueueTerminalBytes(toUint8Array(event.payload))
    })
    if (isUnmounted) {
      stdoutUnlisten()
      return
    }
    unlistenStdoutFallback = stdoutUnlisten
  }

  // 6. Listen for remote exit
  const exitUnlisten = await listen(`ssh:exit:${props.sessionId}`, () => {
    terminal?.writeln('\r\n\x1b[31m[Session disconnected by remote host]\x1b[0m')
    emit('exit')
  })
  if (isUnmounted) {
    exitUnlisten()
    return
  }
  unlistenExit = exitUnlisten

  // Initial sync
  syncDimensions()

  // Auto-resize on pane or window resize (rAF-coalesced so Neovim isn't spammed with SIGWINCH)
  if (terminalEl.value) {
    resizeObserver = new ResizeObserver(() => {
      scheduleSyncDimensions()
    })
    resizeObserver.observe(terminalEl.value)
  }
}

onMounted(() => {
  initTerminal()
})

onBeforeUnmount(() => {
  isUnmounted = true
  pendingOutputChunks = []
  pendingOutputBytes = 0
  pendingStdin = ''
  if (resizeRafId !== null) {
    cancelAnimationFrame(resizeRafId)
    resizeRafId = null
  }
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (onDataDisposable) {
    onDataDisposable.dispose()
    onDataDisposable = null
  }
  if (onBinaryDisposable) {
    onBinaryDisposable.dispose()
    onBinaryDisposable = null
  }
  if (unlistenStdoutFallback) {
    unlistenStdoutFallback()
    unlistenStdoutFallback = null
  }
  if (unlistenExit) {
    unlistenExit()
    unlistenExit = null
  }
  if (webglAddon) {
    webglAddon.dispose()
    webglAddon = null
  }
  if (terminal) {
    terminal.dispose()
    terminal = null
  }
})

// Expose terminal methods if parent needs to write or focus
defineExpose({
  focus: () => terminal?.focus(),
  clear: () => terminal?.clear(),
  write: (data: string) => terminal?.write(data),
})
</script>

<template>
  <div
    class="terminal-contain relative w-full h-full overflow-hidden flex flex-col transition-colors duration-150"
    :style="{ backgroundColor: 'var(--color-terminal-bg)' }"
  >
    <!-- Terminal Container -->
    <div
      ref="terminalEl"
      @paste.capture="handleNativePaste"
      @wheel="handleTerminalWheel"
      class="flex-1 w-full h-full overflow-hidden p-2 text-sm focus:outline-none"
      :style="{ backgroundColor: 'var(--color-terminal-bg)' }"
      tabindex="0"
    />
  </div>
</template>

<style scoped>
.terminal-contain {
  contain: strict;
}
:deep(.xterm) {
  height: 100%;
  padding: 4px;
  background-color: var(--color-terminal-bg) !important;
}
:deep(.xterm-screen) {
  background-color: var(--color-terminal-bg) !important;
}
:deep(.xterm-viewport) {
  background-color: var(--color-terminal-bg) !important;
}
:deep(.xterm-viewport)::-webkit-scrollbar {
  width: 7px;
}
:deep(.xterm-viewport)::-webkit-scrollbar-track {
  background-color: transparent !important;
}
:deep(.xterm-viewport)::-webkit-scrollbar-thumb {
  background-color: var(--color-border) !important;
  border-radius: 4px;
}
:deep(.xterm-viewport)::-webkit-scrollbar-thumb:hover {
  background-color: var(--color-bg-hover) !important;
}
</style>
