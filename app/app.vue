<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import {
  Terminal,
  FolderSync,
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
  isNormalEditable,
  type KeymapAction,
} from './utils/keymap'
import SshTerminal from './components/SshTerminal.vue'
import SftpBrowser from './components/SftpBrowser.vue'
import ConnectionManagerModal from './components/ConnectionManagerModal.vue'
import SettingsModal from './components/SettingsModal.vue'
import MasterPasswordModal from './components/MasterPasswordModal.vue'
import CatppuccinIcon from './components/CatppuccinIcon.vue'

const sshStore = useSshStore()
const vaultStore = useVaultStore()
const sftpStore = useSftpStore()
const settingsStore = useSettingsStore()
const themeStore = useThemeStore()

// Navigation & Modal State
const currentTab = ref<'terminal' | 'sftp'>('terminal')
const showConnectModal = ref(false)
const showSettingsModal = ref(false)
const tabsContainerRef = ref<HTMLDivElement | null>(null)

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
  // Do not navigate if modals are open (unless recording shortcut, which is handled inside modal)
  if (showConnectModal.value || showSettingsModal.value || vaultStore.showModal) {
    return
  }

  // If focus is in normal editable input (e.g. rename or search), only allow Ctrl+Tab session switching
  if (isNormalEditable(e.target)) {
    if (!e.ctrlKey || e.key !== 'Tab') {
      return
    }
  }

  // If we are in the SFTP browser view, do not intercept plain F2 (reserved for file rename)
  if (e.key === 'F2' && currentTab.value === 'sftp') {
    return
  }

  const action = getKeymapAction(e, settingsStore.keymaps)
  if (action) {
    e.preventDefault()
    e.stopPropagation()
    executeKeyAction(action)
  }
}

const handleGlobalContextMenu = (e: MouseEvent) => {
  // If the user right-clicks on a normal editable input (e.g. search, settings input, or rename input),
  // allow the standard text context menu (Cut, Copy, Paste).
  // Everywhere else (top navigation header, tabs, buttons, empty canvas, terminal, toolbars),
  // suppress the default browser/webview context menu (Back, Refresh, Save as, Print, Inspect).
  if (isNormalEditable(e.target)) {
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
  const savedTab = localStorage.getItem('termsftp_active_tab') as 'terminal' | 'sftp' | null
  if (savedTab) {
    currentTab.value = savedTab
  }
  const sess = sshStore.activeSession
  if (sess && (sess.protocol === 'ftp' || sess.protocol === 'ftps')) {
    currentTab.value = 'sftp'
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
  localStorage.setItem('termsftp_active_tab', tab)
})

watch(
  () => sshStore.activeSessionId,
  (newSessionId) => {
    sftpStore.switchSession(newSessionId || '')
  }
)
</script>

<template>
  <div
    class="flex flex-col h-screen w-screen select-none overflow-hidden font-sans transition-colors duration-150"
    :style="{ backgroundColor: currentTab === 'terminal' ? 'var(--color-terminal-bg)' : 'var(--color-bg-app)', color: 'var(--color-text-main)' }"
  >
    <!-- Top Navigation Header with Overflow Guard and Responsive Layout -->
    <header
      @contextmenu.prevent
      class="flex items-center justify-between px-3 h-12 border-b gap-2 transition-colors duration-150"
      :style="{
        backgroundColor: currentTab === 'terminal' ? 'var(--color-terminal-bg)' : 'var(--color-bg-header)',
        borderColor: 'var(--color-border)'
      }"
    >
      <!-- Left: View Switcher -->
      <div class="flex items-center shrink-0">
        <!-- View Switcher Tabs -->
        <div
          class="flex items-center space-x-0.5 p-0.5 rounded-lg border shrink-0 transition-colors"
          :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
        >
          <button
            @click="currentTab = 'terminal'"
            class="px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150 flex items-center space-x-1.5"
            :style="currentTab === 'terminal'
              ? { backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-accent)' }
              : { color: 'var(--color-text-muted)' }"
            :title="`SSH Terminal (${settingsStore.keymaps.switchToTerminal} or ${settingsStore.keymaps.toggleView})`"
          >
            <CatppuccinIcon name="bash" :size="14" />
            <span class="hidden sm:inline">Terminal</span>
          </button>
          <button
            @click="currentTab = 'sftp'"
            class="px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150 flex items-center space-x-1.5"
            :style="currentTab === 'sftp'
              ? { backgroundColor: 'var(--color-bg-hover)', color: 'var(--color-accent-secondary)' }
              : { color: 'var(--color-text-muted)' }"
            :title="`SFTP / FTP Browser (${settingsStore.keymaps.switchToFiles} or ${settingsStore.keymaps.toggleView})`"
          >
            <CatppuccinIcon name="folder" :size="14" />
            <span class="hidden sm:inline">Files</span>
          </button>
        </div>
      </div>

      <!-- Middle: Active Sessions Tabs (Scrollable + Overflow Menu) -->
      <div v-if="sshStore.sessions.length > 0" class="flex-1 min-w-0 flex items-center space-x-1.5 overflow-hidden">
        <!-- Scrollable tab strip with wheel navigation -->
        <div
          ref="tabsContainerRef"
          @wheel.passive="handleTabWheel"
          class="flex-1 min-w-0 flex items-center space-x-1 overflow-x-auto no-scrollbar py-1"
        >
          <div
            v-for="sess in sshStore.sessions"
            :key="sess.sessionId"
            :data-session-id="sess.sessionId"
            @click="selectSession(sess.sessionId)"
            :title="`${sess.username}@${sess.host}:${sess.port} (${sess.protocol?.toUpperCase() || 'SFTP'}) • ${settingsStore.keymaps.nextSession} to switch`"
            class="group flex items-center space-x-1.5 px-2 py-1 rounded-md text-xs cursor-pointer border transition-all shrink-0 max-w-[140px] sm:max-w-[180px]"
            :style="sess.sessionId === sshStore.activeSessionId
              ? { backgroundColor: 'var(--color-bg-hover)', borderColor: 'var(--color-border-active)', color: 'var(--color-text-main)' }
              : { backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
          >
            <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="sess.status === 'connected' ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'" />
            <span
              v-if="sess.protocol === 'ftp' || sess.protocol === 'ftps'"
              class="px-1 py-0.2 rounded text-[9px] font-mono uppercase tracking-wider font-semibold bg-amber-950/70 text-amber-300 border border-amber-800/60 shrink-0"
            >
              {{ sess.protocol.toUpperCase() }}
            </span>
            <span class="truncate min-w-0 flex-1 text-[11px] font-mono">{{ sess.username }}@{{ sess.host }}</span>
            <button
              @click.stop="handleCloseSession(sess.sessionId)"
              class="opacity-0 group-hover:opacity-100 hover:text-red-400 p-0.5 rounded text-xs leading-none transition shrink-0"
              title="Close connection"
            >
              <X class="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      <!-- Right: Action Buttons (Always Preserved and Visible) -->
      <div class="flex items-center space-x-2 shrink-0">
        <div v-if="sshStore.activeSession && currentTab === 'terminal' && (!sshStore.activeSession.protocol || sshStore.activeSession.protocol === 'sftp')" class="text-[11px] font-mono hidden xl:inline" :style="{ color: 'var(--color-text-muted)' }">
          PTY: {{ terminalDimensions.cols }}x{{ terminalDimensions.rows }}
        </div>

        <button
          v-if="sshStore.activeSession"
          @click="handleDisconnect"
          class="flex items-center space-x-1.5 px-3 py-1.5 text-xs rounded-lg bg-red-950/40 text-red-300 hover:bg-red-900/80 hover:text-white border border-red-800/60 hover:border-red-500 shadow-sm transition-colors duration-150 cursor-pointer"
          title="Disconnect active connection"
        >
          <CatppuccinIcon name="disconnect" :size="14" />
          <span class="hidden sm:inline font-medium">Disconnect</span>
        </button>

        <button
          @click="showSettingsModal = true"
          class="flex items-center space-x-1.5 px-3 py-1.5 text-xs rounded-lg font-medium border shadow-sm transition-colors duration-150 btn-theme-card cursor-pointer"
          title="Open Settings"
        >
          <CatppuccinIcon name="settings" :size="14" />
          <span class="hidden sm:inline">Settings</span>
        </button>

        <button
          @click="showConnectModal = true"
          class="flex items-center space-x-1.5 px-3 py-1.5 text-xs rounded-lg font-medium border shadow-sm transition-colors duration-150 btn-theme-card cursor-pointer"
          title="Open Connection Manager"
        >
          <CatppuccinIcon name="server" :size="15" />
          <span>Connections</span>
        </button>
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
              <CatppuccinIcon name="server" :size="15" />
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
      @close="showSettingsModal = false"
    />

    <!-- Master Password Modal (Global Prompt) -->
    <MasterPasswordModal />
  </div>
</template>
