<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import {
  Terminal,
  FolderSync,
  Folder,
  Settings,
  KeyRound,
  LogOut,
  X,
  Server,
} from 'lucide-vue-next'
import { useSshStore } from './stores/ssh'
import { useVaultStore } from './stores/vault'
import { useSftpStore } from './stores/sftp'
import { useSettingsStore } from './stores/settings'
import { useThemeStore } from './stores/theme'
import {
  getKeymapAction,
  onKeymapAction,
  matchesShortcut,
  isNormalEditable,
  isFileManagerAction,
  type KeymapAction,
} from './utils/keymap'
import SshTerminal from './components/SshTerminal.vue'
import SftpBrowser from './components/SftpBrowser.vue'
import ConnectionManagerModal from './components/ConnectionManagerModal.vue'
import SettingsModal from './components/SettingsModal.vue'
import MasterPasswordModal from './components/MasterPasswordModal.vue'
import CatppuccinIcon from './components/CatppuccinIcon.vue'
import WindowControls from './components/WindowControls.vue'
import appIcon from '~/assets/icon.png'

const sshStore = useSshStore()
const vaultStore = useVaultStore()
const sftpStore = useSftpStore()
const settingsStore = useSettingsStore()
const themeStore = useThemeStore()

// Navigation & Modal State
const currentTab = ref<'terminal' | 'sftp'>('terminal')
const showConnectModal = ref(false)
const showSettingsModal = ref(false)
const settingsInitialTab = ref<'themes' | 'appearance' | 'keymap' | 'transfers' | 'security' | 'protocols' | 'developer'>('keymap')
const tabsContainerRef = ref<HTMLDivElement | null>(null)

watch(
  () => settingsStore.isSettingsModalOpen,
  (isOpen) => {
    if (isOpen) {
      settingsInitialTab.value = settingsStore.settingsModalTab as any
      showSettingsModal.value = true
    }
  }
)

// Terminal status
const terminalDimensions = ref({ cols: 80, rows: 24 })

let unlistenKeymapBus: (() => void) | null = null

const handleTabWheel = (e: WheelEvent) => {
  if (tabsContainerRef.value) {
    tabsContainerRef.value.scrollLeft += e.deltaY
  }
}

const handleCloseSession = async (sessionId: string) => {
  sftpStore.clearSession(sessionId)
  await sshStore.disconnect(sessionId)
}

const handleDisconnect = async () => {
  if (sshStore.activeSessionId) {
    await handleCloseSession(sshStore.activeSessionId)
  }
}

const handleOpenTerminal = async (dirPath: string) => {
  if (sshStore.activeSessionId) {
    currentTab.value = 'terminal'
    await invoke('ssh_write_stdin', {
      sessionId: sshStore.activeSessionId,
      data: `cd "${dirPath}"\n`,
    })
  }
}


const scrollActiveTabIntoView = (sessionId: string) => {
  nextTick(() => {
    if (!tabsContainerRef.value) return
    const el = tabsContainerRef.value.querySelector(
      `[data-session-id="${sessionId}"]`
    ) as HTMLElement | null
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    }
  })
}

const selectSession = (sessionId: string) => {
  sshStore.setActiveSession(sessionId)
  sftpStore.switchSession(sessionId)
  const sess = sshStore.sessions.find((s) => s.sessionId === sessionId)
  if (sess && (sess.protocol === 'ftp' || sess.protocol === 'ftps')) {
    currentTab.value = 'sftp'
  }
  scrollActiveTabIntoView(sessionId)
}


const handleConnected = (sessionId: string) => {
  showConnectModal.value = false
  selectSession(sessionId)
}

const handleTerminalResize = (dims: { cols: number; rows: number }) => {
  terminalDimensions.value = dims
}

const handleTerminalExit = () => {
  if (sshStore.activeSessionId) {
    handleCloseSession(sshStore.activeSessionId)
  }
}

// Keymap Action Handlers
const toggleView = () => {
  if (
    sshStore.activeSession &&
    (sshStore.activeSession.protocol === 'ftp' || sshStore.activeSession.protocol === 'ftps')
  ) {
    currentTab.value = 'sftp'
    return
  }
  currentTab.value = currentTab.value === 'terminal' ? 'sftp' : 'terminal'
}

const switchToTerminal = () => {
  if (
    sshStore.activeSession &&
    (sshStore.activeSession.protocol === 'ftp' || sshStore.activeSession.protocol === 'ftps')
  ) {
    return
  }
  currentTab.value = 'terminal'
}

const switchToFiles = () => {
  currentTab.value = 'sftp'
}

const nextSession = () => {
  if (sshStore.sessions.length <= 1) return
  const currentIndex = sshStore.sessions.findIndex(
    (s) => s.sessionId === sshStore.activeSessionId
  )
  const nextIndex = (currentIndex + 1) % sshStore.sessions.length
  const nextSessionId = sshStore.sessions[nextIndex].sessionId
  selectSession(nextSessionId)
}

const prevSession = () => {
  if (sshStore.sessions.length <= 1) return
  const currentIndex = sshStore.sessions.findIndex(
    (s) => s.sessionId === sshStore.activeSessionId
  )
  const prevIndex =
    (currentIndex - 1 + sshStore.sessions.length) % sshStore.sessions.length
  const prevSessionId = sshStore.sessions[prevIndex].sessionId
  selectSession(prevSessionId)
}

let lastActionTime = 0
let lastActionType = ''

const executeKeyAction = (action: KeymapAction) => {
  const now = Date.now()
  if (action === lastActionType && now - lastActionTime < 150) {
    return
  }
  lastActionTime = now
  lastActionType = action

  switch (action) {
    case 'openKeymap':
      settingsInitialTab.value = 'keymap'
      showSettingsModal.value = !showSettingsModal.value
      break
    case 'toggleView':
      toggleView()
      break
    case 'switchToTerminal':
      switchToTerminal()
      break
    case 'switchToFiles':
      switchToFiles()
      break
    case 'nextSession':
      nextSession()
      break
    case 'prevSession':
      prevSession()
      break
  }
}

const handleGlobalKeyDown = (e: KeyboardEvent) => {
  // Ctrl+, / Cmd+,: Open Keymap & Settings immediately from anywhere
  if (
    (settingsStore.keymaps.openKeymap && matchesShortcut(e, settingsStore.keymaps.openKeymap)) ||
    ((e.ctrlKey || e.metaKey) && (e.key === ',' || e.code === 'Comma'))
  ) {
    e.preventDefault()
    e.stopPropagation()
    settingsInitialTab.value = 'keymap'
    showSettingsModal.value = !showSettingsModal.value
    return
  }

  // Do not navigate if other modals are open (unless recording shortcut, which is handled inside modal)
  if (showConnectModal.value || showSettingsModal.value || vaultStore.showModal) {
    return
  }

  // If focus is in normal editable input (e.g. rename or search), only allow Ctrl+Tab session switching
  if (isNormalEditable(e.target)) {
    if (!e.ctrlKey || e.key !== 'Tab') {
      return
    }
  }

  // If we are in the SFTP browser view, do not intercept file manager actions or plain F2
  if (currentTab.value === 'sftp') {
    if (e.key === 'F2') return
    if (e.key === 'Tab' && !e.ctrlKey) return
  }

  const action = getKeymapAction(e, settingsStore.keymaps)
  if (action) {
    if (isFileManagerAction(action)) {
      // Let SftpBrowser / useSftpKeyboardNav handle file manager actions
      return
    }

    e.preventDefault()
    e.stopPropagation()
    executeKeyAction(action)
  }
}

const handleGlobalContextMenu = (e: MouseEvent) => {
  const target = e.target as HTMLElement | null
  // The code editor has its own custom themed right-click context menu; suppress the default browser menu
  if (target?.closest('.cm-editor')) {
    e.preventDefault()
    return
  }
  // If the user right-clicks on a normal editable input (e.g. search, settings input, or rename input),
  // allow the standard text context menu (Cut, Copy, Paste).
  // Everywhere else (top navigation header, tabs, buttons, empty canvas, terminal, toolbars),
  // suppress the default browser/webview context menu (Back, Refresh, Save as, Print, Inspect).
  if (isNormalEditable(target)) {
    return
  }
  e.preventDefault()
}

onMounted(async () => {
  // Apply saved theme to DOM
  themeStore.applyThemeToDom(themeStore.currentTheme)

  // Register listeners immediately before any async restoration
  window.addEventListener('keydown', handleGlobalKeyDown, true)
  window.addEventListener('contextmenu', handleGlobalContextMenu)

  unlistenKeymapBus = onKeymapAction((action) => {
    if (showConnectModal.value || showSettingsModal.value || vaultStore.showModal) {
      return
    }
    executeKeyAction(action)
  })

  await sshStore.restoreSessions()
  if (sshStore.activeSessionId) {
    sftpStore.switchSession(sshStore.activeSessionId)
  }
  const savedTab = localStorage.getItem('flowsftp_active_tab') as 'terminal' | 'sftp' | null
  if (savedTab) {
    currentTab.value = savedTab
  }
  const sess = sshStore.activeSession
  if (sess && (sess.protocol === 'ftp' || sess.protocol === 'ftps')) {
    currentTab.value = 'sftp'
  }

  if (typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__)) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      isWindowMaximized.value = await win.isMaximized()
      win.listen('tauri://resize', async () => {
        isWindowMaximized.value = await win.isMaximized()
      })
    } catch (err) {
      console.warn('Failed to listen to window resize:', err)
    }
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeyDown, true)
  window.removeEventListener('contextmenu', handleGlobalContextMenu)
  if (unlistenKeymapBus) {
    unlistenKeymapBus()
    unlistenKeymapBus = null
  }
})

watch(currentTab, (tab) => {
  localStorage.setItem('flowsftp_active_tab', tab)
})

watch(
  () => sshStore.activeSessionId,
  (newSessionId) => {
    sftpStore.switchSession(newSessionId || '')
  }
)

const isWindowMaximized = ref(false)

const handleResizeStart = (
  direction: 'North' | 'South' | 'East' | 'West' | 'NorthEast' | 'NorthWest' | 'SouthEast' | 'SouthWest',
  e: MouseEvent
) => {
  e.preventDefault()
  if (typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__)) {
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      getCurrentWindow().startResizeDragging(direction).catch(() => {})
    })
  }
}

const handleHeaderMouseDown = async (e: MouseEvent) => {
  // Only trigger dragging on primary left mouse click
  if (e.button !== 0) return

  // Do not drag if clicking on interactive controls (buttons, inputs, session tabs)
  const target = e.target as HTMLElement | null
  if (target?.closest('button, input, a, select, textarea, [role="button"], [data-session-id], .no-drag')) {
    return
  }

  // Prevent drag if this is part of a double-click (maximize)
  if (e.detail > 1) {
    return
  }

  if (typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__)) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().startDragging()
    } catch (err) {
      console.warn('Failed to start window dragging:', err)
    }
  }
}

const handleHeaderDblClick = async (e: MouseEvent) => {
  const target = e.target as HTMLElement | null
  if (target?.closest('button, input, a, select, textarea, [role="button"], [data-session-id], .no-drag')) {
    return
  }
  if (typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__)) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().toggleMaximize()
    } catch (err) {
      console.warn('Failed to toggle maximize on header dblclick:', err)
    }
  }
}
</script>

<template>
  <div
    class="flex flex-col h-screen w-screen select-none overflow-hidden font-sans transition-colors duration-150 relative"
    :style="{ backgroundColor: currentTab === 'terminal' ? 'var(--color-terminal-bg)' : 'var(--color-bg-app)', color: 'var(--color-text-main)' }"
  >
    <!-- Invisible Window Edge Resize Grips (Frameless Custom Window) -->
    <template v-if="!isWindowMaximized">
      <div @mousedown="handleResizeStart('North', $event)" class="fixed top-0 left-2 right-2 h-1 cursor-n-resize z-50 pointer-events-auto" />
      <div @mousedown="handleResizeStart('South', $event)" class="fixed bottom-0 left-2 right-2 h-1 cursor-s-resize z-50 pointer-events-auto" />
      <div @mousedown="handleResizeStart('West', $event)" class="fixed top-2 bottom-2 left-0 w-1 cursor-w-resize z-50 pointer-events-auto" />
      <div @mousedown="handleResizeStart('East', $event)" class="fixed top-2 bottom-2 right-0 w-1 cursor-e-resize z-50 pointer-events-auto" />
      <div @mousedown="handleResizeStart('NorthWest', $event)" class="fixed top-0 left-0 w-2.5 h-2.5 cursor-nwse-resize z-50 pointer-events-auto" />
      <div @mousedown="handleResizeStart('NorthEast', $event)" class="fixed top-0 right-0 w-2.5 h-2.5 cursor-nesw-resize z-50 pointer-events-auto" />
      <div @mousedown="handleResizeStart('SouthWest', $event)" class="fixed bottom-0 left-0 w-2.5 h-2.5 cursor-nesw-resize z-50 pointer-events-auto" />
      <div @mousedown="handleResizeStart('SouthEast', $event)" class="fixed bottom-0 right-0 w-2.5 h-2.5 cursor-nwse-resize z-50 pointer-events-auto" />
    </template>

    <!-- Top Navigation Header with Custom Integrated Window Titlebar & Drag Region -->
    <header
      @contextmenu.prevent
      data-tauri-drag-region
      @mousedown="handleHeaderMouseDown"
      @dblclick="handleHeaderDblClick"
      class="flex items-center justify-between pl-3 pr-0 h-10 border-b gap-2 transition-colors duration-150 select-none relative z-40 cursor-default"
      :style="{
        backgroundColor: currentTab === 'terminal' ? 'var(--color-terminal-bg)' : 'var(--color-bg-header)',
        borderColor: 'var(--color-border)'
      }"
    >
      <!-- Left: Logo & View Switcher -->
      <div class="flex items-center space-x-2.5 shrink-0" data-tauri-drag-region>
        <!-- App Logo -->
        <div class="flex items-center select-none" title="FlowSFTP" data-tauri-drag-region>
          <img :src="appIcon" alt="FlowSFTP" class="w-6 h-6 rounded-md object-contain shrink-0 pointer-events-none drop-shadow-xs" />
        </div>

        <!-- View Switcher Tabs -->
        <div
          class="flex items-center space-x-1 p-0.5 rounded-lg border shrink-0 transition-colors"
          :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
        >
          <button
            @click="currentTab = 'terminal'"
            class="px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150 flex items-center space-x-1.5 cursor-pointer border"
            :style="currentTab === 'terminal'
              ? {
                  backgroundColor: 'var(--color-bg-hover)',
                  color: 'var(--color-accent)',
                  borderColor: 'var(--color-border)',
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.08)'
                }
              : {
                  color: 'var(--color-text-muted)',
                  borderColor: 'transparent'
                }"
            :class="[
              currentTab === 'terminal'
                ? 'font-semibold'
                : 'hover:text-[var(--color-text-main)] hover:bg-black/5 dark:hover:bg-white/5'
            ]"
            :title="`SSH Terminal (${settingsStore.keymaps.switchToTerminal} or ${settingsStore.keymaps.toggleView})`"
          >
            <Terminal class="w-3.5 h-3.5 shrink-0" />
            <span class="hidden sm:inline">Terminal</span>
          </button>
          <button
            @click="currentTab = 'sftp'"
            class="px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150 flex items-center space-x-1.5 cursor-pointer border"
            :style="currentTab === 'sftp'
              ? {
                  backgroundColor: 'var(--color-bg-hover)',
                  color: 'var(--color-accent-secondary)',
                  borderColor: 'var(--color-border)',
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.08)'
                }
              : {
                  color: 'var(--color-text-muted)',
                  borderColor: 'transparent'
                }"
            :class="[
              currentTab === 'sftp'
                ? 'font-semibold'
                : 'hover:text-[var(--color-text-main)] hover:bg-black/5 dark:hover:bg-white/5'
            ]"
            :title="`SFTP / FTP Browser (${settingsStore.keymaps.switchToFiles} or ${settingsStore.keymaps.toggleView})`"
          >
            <Folder class="w-3.5 h-3.5 shrink-0" />
            <span class="hidden sm:inline">Files</span>
          </button>
        </div>
      </div>

      <!-- Middle: Centered Draggable Space when no active sessions -->
      <div
        v-if="sshStore.sessions.length === 0"
        data-tauri-drag-region
        class="flex-1 flex items-center justify-center min-w-0 h-full cursor-default select-none"
      />

      <!-- Middle: Active Sessions Tabs (Scrollable + Overflow Menu) -->
      <div
        v-if="sshStore.sessions.length > 0"
        data-tauri-drag-region
        class="flex-1 min-w-0 flex items-center space-x-1.5 overflow-hidden h-full"
      >
        <!-- Scrollable tab strip with wheel navigation -->
        <div
          ref="tabsContainerRef"
          @wheel.passive="handleTabWheel"
          data-tauri-drag-region
          class="flex-1 min-w-0 flex items-center space-x-1 overflow-x-auto no-scrollbar py-1 h-full"
        >
          <div
            v-for="sess in sshStore.sessions"
            :key="sess.sessionId"
            :data-session-id="sess.sessionId"
            @click="selectSession(sess.sessionId)"
            :title="`${sess.username}@${sess.host}:${sess.port} (${sess.protocol?.toUpperCase() || 'SFTP'}) • ${settingsStore.keymaps.nextSession} to switch`"
            class="group flex items-center space-x-1.5 px-2 py-1 rounded-md text-xs cursor-pointer border transition-all shrink-0 max-w-[140px] sm:max-w-[180px] no-drag"
            :style="sess.sessionId === sshStore.activeSessionId
              ? { backgroundColor: 'var(--color-bg-hover)', borderColor: 'var(--color-border-active)', color: 'var(--color-text-main)' }
              : { backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
          >
            <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="sess.status === 'connected' ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'" />
            <span
              v-if="sess.protocol === 'ftp' || sess.protocol === 'ftps'"
              class="px-1 py-0.2 rounded text-[9px] font-mono uppercase tracking-wider font-semibold bg-amber-500/15 text-amber-700 border border-amber-500/30 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800/60 shrink-0"
            >
              {{ sess.protocol.toUpperCase() }}
            </span>
            <span class="truncate min-w-0 flex-1 text-[11px] font-mono">{{ sess.username }}@{{ sess.host }}</span>
            <button
              @click.stop="handleCloseSession(sess.sessionId)"
              class="opacity-0 group-hover:opacity-100 hover:text-red-500 dark:hover:text-red-400 p-0.5 rounded text-xs leading-none transition shrink-0"
              title="Close connection"
            >
              <X class="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      <!-- Right: Action Buttons (Always Preserved and Visible) -->
      <div class="flex items-center space-x-1.5 shrink-0 h-full no-drag" data-tauri-drag-region="false">
        <div v-if="sshStore.activeSession && currentTab === 'terminal' && (!sshStore.activeSession.protocol || sshStore.activeSession.protocol === 'sftp')" class="text-[11px] font-mono hidden xl:inline pr-1" :style="{ color: 'var(--color-text-muted)' }">
          PTY: {{ terminalDimensions.cols }}x{{ terminalDimensions.rows }}
        </div>

        <button
          v-if="sshStore.activeSession"
          @click="handleDisconnect"
          class="flex items-center space-x-1.5 px-2.5 py-1 text-xs rounded-lg font-medium border shadow-sm transition-all duration-150 cursor-pointer bg-red-500/10 text-red-600 border-red-500/30 hover:bg-red-600 hover:text-white hover:border-red-600 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800/60 dark:hover:bg-red-900/80 dark:hover:text-white dark:hover:border-red-500"
          title="Disconnect active connection"
        >
          <LogOut class="w-3.5 h-3.5 shrink-0" />
          <span class="hidden sm:inline font-medium">Disconnect</span>
        </button>

        <button
          @click="showSettingsModal = true"
          class="flex items-center space-x-1.5 px-2.5 py-1 text-xs rounded-lg font-medium border shadow-sm transition-colors duration-150 btn-theme-card cursor-pointer"
          title="Open Settings"
        >
          <Settings class="w-3.5 h-3.5 shrink-0" />
          <span class="hidden sm:inline">Settings</span>
        </button>

        <button
          @click="showConnectModal = true"
          class="flex items-center space-x-1.5 px-2.5 py-1 text-xs rounded-lg font-medium border shadow-sm transition-colors duration-150 btn-theme-card cursor-pointer"
          title="Open Connection Manager"
        >
          <Server class="w-3.5 h-3.5 shrink-0" />
          <span>Connections</span>
        </button>

        <!-- Vertical Separator before Window Controls -->
        <div class="h-4 w-px mx-1" :style="{ backgroundColor: 'var(--color-border)' }" />

        <!-- Integrated Custom Title Bar Window Controls -->
        <WindowControls />
      </div>
    </header>

    <!-- Main Workspace Area -->
    <main
      class="flex-1 relative overflow-hidden transition-colors duration-150"
      :style="{ backgroundColor: currentTab === 'terminal' ? 'var(--color-terminal-bg)' : 'var(--color-bg-pane)' }"
    >
      <!-- Terminal View -->
      <div
        :class="[
          'w-full h-full flex flex-col',
          currentTab === 'terminal'
            ? 'relative z-10'
            : 'invisible absolute inset-0 pointer-events-none -z-10'
        ]"
      >
        <!-- Notice if active session is FTP/FTPS -->
        <template v-if="sshStore.activeSession && (sshStore.activeSession.protocol === 'ftp' || sshStore.activeSession.protocol === 'ftps')">
          <div class="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div class="w-14 h-14 rounded-2xl bg-amber-950/40 border border-amber-700/40 flex items-center justify-center text-amber-400 mb-4 shadow-xl">
              <Server class="w-7 h-7" />
            </div>
            <h2 class="text-base font-semibold mb-1" :style="{ color: 'var(--color-text-main)' }">
              {{ sshStore.activeSession.protocol.toUpperCase() }} Session Active
            </h2>
            <p class="text-xs max-w-sm mb-5" :style="{ color: 'var(--color-text-muted)' }">
              Command line shell is only supported for SSH connections. Use the dual-pane browser to list, upload, and download files over FTP.
            </p>
            <button
              @click="currentTab = 'sftp'"
              class="px-4 py-2 rounded-lg text-white text-xs font-semibold shadow-md flex items-center space-x-2 transition btn-accent-secondary"
            >
              <FolderSync class="w-3.5 h-3.5" />
              <span>Switch to SFTP / FTP Browser</span>
            </button>
          </div>
        </template>

        <!-- Active SSH sessions: each gets its own kept-alive SshTerminal component -->
        <template v-else-if="sshStore.sessions.length > 0">
          <div
            v-for="sess in sshStore.sessions"
            :key="sess.sessionId"
            v-show="sess.sessionId === sshStore.activeSessionId"
            class="w-full h-full flex flex-col"
          >
            <SshTerminal
              v-if="!sess.protocol || sess.protocol === 'sftp'"
              :session-id="sess.sessionId"
              :active="currentTab === 'terminal' && sess.sessionId === sshStore.activeSessionId"
              @resize="handleTerminalResize"
              @exit="handleTerminalExit"
              @action="executeKeyAction"
            />
          </div>
        </template>

        <template v-else>
          <!-- Empty State (No active sessions) -->
          <div class="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div
              class="w-14 h-14 rounded-2xl border flex items-center justify-center mb-4 shadow-xl transition-colors duration-150"
              :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-accent)' }"
            >
              <svg class="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 class="text-base font-medium mb-1" :style="{ color: 'var(--color-text-main)' }">No Active SSH / FTP Session</h2>
            <p class="text-xs max-w-sm mb-5" :style="{ color: 'var(--color-text-muted)' }">
              Connect to a remote server using Keychain credentials or private keys to begin interactive terminal and file transfer operations.
            </p>
            <button
              @click="showConnectModal = true"
              class="px-4 py-2 rounded-lg text-xs font-semibold shadow-md transition-all btn-accent flex items-center space-x-2 cursor-pointer"
            >
              <Server class="w-3.5 h-3.5 shrink-0" />
              <span>Open Connection Manager</span>
            </button>
          </div>
        </template>
      </div>

      <!-- SFTP Browser View (Dual Pane) -->
      <div
        :class="[
          'w-full h-full flex flex-col overflow-hidden',
          currentTab === 'sftp'
            ? 'relative z-10'
            : 'invisible absolute inset-0 pointer-events-none -z-10'
        ]"
      >
        <SftpBrowser
          :session-id="sshStore.activeSessionId"
          :active="currentTab === 'sftp'"
          @open-terminal="handleOpenTerminal"
        />
      </div>
    </main>

    <!-- Keychain & Saved Connection Profiles Modal -->
    <ConnectionManagerModal
      v-if="showConnectModal"
      @close="showConnectModal = false"
      @connected="handleConnected"
    />

    <!-- Settings Modal -->
    <SettingsModal
      v-if="showSettingsModal"
      :initial-tab="settingsInitialTab"
      @close="showSettingsModal = false; settingsStore.closeSettings()"
    />

    <!-- Master Password Modal (Global Prompt) -->
    <MasterPasswordModal />
  </div>
</template>
