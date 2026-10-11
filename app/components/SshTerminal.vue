<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { invoke } from '@tauri-apps/api/core'
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
let unlistenStdout: UnlistenFn | null = null
let unlistenExit: UnlistenFn | null = null

let lastCols = 0
let lastRows = 0

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
      setTimeout(() => {
        syncDimensions()
        if (props.autoFocus) {
          terminal?.focus()
        }
      }, 30)
    }
  }
)

const initTerminal = async () => {
  if (!terminalEl.value) return

  // 1. Instantiate xterm.js Terminal with modern dark palette
  terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: 'block',
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

  // Intercept application shortcuts before xterm processes them (e.g. Ctrl+Tab to cycle connections, Ctrl+` to toggle view)
  terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
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

  // 4. Stream STDIN from xterm -> Rust via Tauri invoke
  terminal.onData((data: string) => {
    invoke('ssh_write_stdin', {
      sessionId: props.sessionId,
      data,
    }).catch((err) => {
      console.error('Failed to write STDIN to SSH session:', err)
    })
  })

  // 5. Restore scrollback history from backend (preserves screen output across page refreshes)
  try {
    const history = await invoke<string>('ssh_get_history', {
      sessionId: props.sessionId,
    })
    if (history && terminal) {
      terminal.write(history)
    }
  } catch (err) {
    console.warn('Failed to load session history:', err)
  }

  // 6. Stream STDOUT from Rust -> xterm via Tauri bi-directional event
  unlistenStdout = await listen<string>(`ssh:stdout:${props.sessionId}`, (event) => {
    terminal?.write(event.payload)
  })

  // 7. Listen for remote exit
  unlistenExit = await listen(`ssh:exit:${props.sessionId}`, () => {
    terminal?.writeln('\r\n\x1b[31m[Session disconnected by remote host]\x1b[0m')
    emit('exit')
  })

  // Initial sync
  syncDimensions()

  // Auto-resize on pane or window resize
  resizeObserver = new ResizeObserver(() => {
    syncDimensions()
  })
  resizeObserver.observe(terminalEl.value)
}

onMounted(() => {
  initTerminal()
})

onBeforeUnmount(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (unlistenStdout) {
    unlistenStdout()
    unlistenStdout = null
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
    class="relative w-full h-full overflow-hidden flex flex-col transition-colors duration-150"
    :style="{ backgroundColor: 'var(--color-terminal-bg)' }"
  >
    <!-- Terminal Container -->
    <div
      ref="terminalEl"
      class="flex-1 w-full h-full overflow-hidden p-2 text-sm focus:outline-none"
      :style="{ backgroundColor: 'var(--color-terminal-bg)' }"
      tabindex="0"
    />
  </div>
</template>

<style scoped>
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
