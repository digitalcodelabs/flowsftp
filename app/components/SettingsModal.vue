<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import {
  Settings,
  Zap,
  Shield,
  Globe,
  Lock,
  Unlock,
  KeyRound,
  X,
  Type,
  Terminal,
  FolderSync,
  RotateCcw,
  Keyboard,
  Layers,
  ArrowLeftRight,
  Check,
  Edit2,
  Palette,
  Upload,
  Download,
  Trash2,
  FileCode,
  Sparkles,
  AlertTriangle,
} from 'lucide-vue-next'
import { invoke } from '@tauri-apps/api/core'
import { useSftpStore } from '../stores/sftp'
import { useVaultStore } from '../stores/vault'
import { useSettingsStore, TERMINAL_FONTS, BROWSER_FONTS } from '../stores/settings'
import { useThemeStore, type AppTheme } from '../stores/theme'
import FileIcon from './FileIcon.vue'
import {
  KEYMAP_ACTIONS_META,
  KEYMAP_PRESETS,
  splitShortcutParts,
  formatEventToShortcut,
  type KeymapAction,
} from '../utils/keymap'

const props = withDefaults(
  defineProps<{
    show?: boolean
  }>(),
  {
    show: true,
  }
)

const emit = defineEmits<{
  (e: 'close'): void
}>()

const sftpStore = useSftpStore()
const vaultStore = useVaultStore()
const settingsStore = useSettingsStore()
const themeStore = useThemeStore()

const activeTab = ref<'themes' | 'appearance' | 'keymap' | 'transfers' | 'security' | 'protocols'>('themes')

// Theme Import / Export state
const fileInputRef = ref<HTMLInputElement | null>(null)
const importStatus = ref<{ message: string; isError: boolean } | null>(null)
const showPasteModal = ref(false)
const pastedJson = ref('')

const handleThemeFileSelect = (e: Event) => {
  const input = e.target as HTMLInputElement
  if (!input.files || input.files.length === 0) return
  const file = input.files[0]
  const reader = new FileReader()
  reader.onload = (ev) => {
    const content = ev.target?.result as string
    if (content) {
      const res = themeStore.importThemeFromJson(content)
      importStatus.value = {
        message: res.message,
        isError: !res.success,
      }
      setTimeout(() => {
        importStatus.value = null
      }, 4000)
    }
  }
  reader.readAsText(file)
  input.value = ''
}

const triggerImportFile = async () => {
  try {
    const content = await invoke<string | null>('pick_and_read_file', {
      filterName: 'JSON Files (*.json)',
      filterExt: 'json',
    })
    if (content) {
      const res = themeStore.importThemeFromJson(content)
      importStatus.value = {
        message: res.message,
        isError: !res.success,
      }
      setTimeout(() => {
        importStatus.value = null
      }, 4000)
      return
    } else if (content === null) {
      return
    }
  } catch (err) {
    console.warn('Native file picker failed or unavailable, falling back to file input:', err)
  }
  fileInputRef.value?.click()
}

const handleExportTheme = async (theme: AppTheme) => {
  const res = await themeStore.exportThemeJson(theme)
  if (res.message && res.message !== 'Export cancelled') {
    importStatus.value = {
      message: res.message,
      isError: !res.success,
    }
    setTimeout(() => {
      importStatus.value = null
    }, 4500)
  }
}

const handleImportPasted = () => {
  if (!pastedJson.value.trim()) return
  const res = themeStore.importThemeFromJson(pastedJson.value)
  importStatus.value = {
    message: res.message,
    isError: !res.success,
  }
  if (res.success) {
    showPasteModal.value = false
    pastedJson.value = ''
  }
  setTimeout(() => {
    importStatus.value = null
  }, 4000)
}

// Keymap recording state
const recordingAction = ref<KeymapAction | null>(null)
const recordingPreview = ref<string>('')

const viewActions = computed(() =>
  KEYMAP_ACTIONS_META.filter((a) => a.category === 'view')
)

const connectionActions = computed(() =>
  KEYMAP_ACTIONS_META.filter((a) => a.category === 'connections')
)

const currentPresetId = computed(() => {
  for (const preset of KEYMAP_PRESETS) {
    const isMatch = Object.entries(preset.keymaps).every(
      ([k, v]) => settingsStore.keymaps[k as KeymapAction] === v
    )
    if (isMatch) return preset.id
  }
  return 'custom'
})

const startRecording = (action: KeymapAction) => {
  recordingAction.value = action
  recordingPreview.value = 'Press keys...'
  window.addEventListener('keydown', handleRecordingKeyDown, true)
}

const stopRecording = () => {
  recordingAction.value = null
  recordingPreview.value = ''
  window.removeEventListener('keydown', handleRecordingKeyDown, true)
}

const handleRecordingKeyDown = (e: KeyboardEvent) => {
  e.preventDefault()
  e.stopPropagation()

  if (e.key === 'Escape') {
    stopRecording()
    return
  }

  const result = formatEventToShortcut(e)
  if (result.isModifierOnly) {
    recordingPreview.value = result.display
    return
  }

  if (result.shortcut && recordingAction.value) {
    settingsStore.updateKeymap(recordingAction.value, result.shortcut)
    stopRecording()
  }
}

onBeforeUnmount(() => {
  stopRecording()
})

const handleLockVault = () => {
  vaultStore.lock()
}

const handleUnlockVault = async () => {
  await vaultStore.promptUnlock()
}

const handleChangeMasterPassword = () => {
  vaultStore.modalMode = 'change'
  vaultStore.showModal = true
}

const handleSetupMasterPassword = () => {
  vaultStore.modalMode = 'setup'
  vaultStore.showModal = true
}

const showResetVaultConfirm = ref(false)

const handleResetVault = async () => {
  await vaultStore.resetVault()
  showResetVaultConfirm.value = false
}
</script>

<template>
  <div
    v-if="props.show"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 select-none"
  >
    <div
      class="w-full max-w-4xl h-[680px] max-h-[92vh] rounded-2xl border shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100 transition-colors duration-150"
      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
    >
      <!-- Header -->
      <div
        class="flex items-center justify-between px-6 py-4 border-b shrink-0 transition-colors duration-150"
        :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)' }"
      >
        <div class="flex items-center space-x-2.5">
          <Settings class="w-4 h-4" :style="{ color: 'var(--color-accent)' }" />
          <h3 class="text-sm font-semibold" :style="{ color: 'var(--color-text-main)' }">Settings</h3>
        </div>
        <button
          @click="emit('close')"
          class="p-1.5 rounded-lg transition"
          :style="{ color: 'var(--color-text-muted)' }"
          title="Close"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <!-- Tabs Navigation -->
      <div
        class="flex border-b px-6 pt-2.5 space-x-4 text-xs font-medium overflow-x-auto no-scrollbar shrink-0 transition-colors duration-150"
        :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)' }"
      >
        <button
          @click="activeTab = 'themes'"
          class="pb-2 border-b-2 transition-colors flex items-center space-x-1.5 shrink-0"
          :class="{ 'font-semibold': activeTab === 'themes' }"
          :style="activeTab === 'themes' ? { borderColor: 'var(--color-accent)', color: 'var(--color-accent)' } : { borderColor: 'transparent', color: 'var(--color-text-muted)' }"
        >
          <Palette class="w-3.5 h-3.5" />
          <span>Themes & Colors</span>
        </button>
        <button
          @click="activeTab = 'appearance'"
          class="pb-2 border-b-2 transition-colors flex items-center space-x-1.5 shrink-0"
          :class="{ 'font-semibold': activeTab === 'appearance' }"
          :style="activeTab === 'appearance' ? { borderColor: 'var(--color-accent)', color: 'var(--color-accent)' } : { borderColor: 'transparent', color: 'var(--color-text-muted)' }"
        >
          <Type class="w-3.5 h-3.5" />
          <span>Fonts & Sizing</span>
        </button>
        <button
          @click="activeTab = 'keymap'"
          class="pb-2 border-b-2 transition-colors flex items-center space-x-1.5 shrink-0"
          :class="{ 'font-semibold': activeTab === 'keymap' }"
          :style="activeTab === 'keymap' ? { borderColor: 'var(--color-accent)', color: 'var(--color-accent)' } : { borderColor: 'transparent', color: 'var(--color-text-muted)' }"
        >
          <Keyboard class="w-3.5 h-3.5" />
          <span>Keymap & Shortcuts</span>
        </button>
        <button
          @click="activeTab = 'transfers'"
          class="pb-2 border-b-2 transition-colors flex items-center space-x-1.5 shrink-0"
          :class="{ 'font-semibold': activeTab === 'transfers' }"
          :style="activeTab === 'transfers' ? { borderColor: 'var(--color-accent)', color: 'var(--color-accent)' } : { borderColor: 'transparent', color: 'var(--color-text-muted)' }"
        >
          <Zap class="w-3.5 h-3.5" />
          <span>Transfers</span>
        </button>
        <button
          @click="activeTab = 'security'"
          class="pb-2 border-b-2 transition-colors flex items-center space-x-1.5 shrink-0"
          :class="{ 'font-semibold': activeTab === 'security' }"
          :style="activeTab === 'security' ? { borderColor: 'var(--color-accent)', color: 'var(--color-accent)' } : { borderColor: 'transparent', color: 'var(--color-text-muted)' }"
        >
          <Shield class="w-3.5 h-3.5" />
          <span>Password Vault</span>
        </button>
        <button
          @click="activeTab = 'protocols'"
          class="pb-2 border-b-2 transition-colors flex items-center space-x-1.5 shrink-0"
          :class="{ 'font-semibold': activeTab === 'protocols' }"
          :style="activeTab === 'protocols' ? { borderColor: 'var(--color-accent)', color: 'var(--color-accent)' } : { borderColor: 'transparent', color: 'var(--color-text-muted)' }"
        >
          <Globe class="w-3.5 h-3.5" />
          <span>Protocols</span>
        </button>
      </div>

      <!-- Tab Content Body -->
      <div class="p-6 overflow-y-auto space-y-5 text-xs flex-1" :style="{ color: 'var(--color-text-main)' }">
        <!-- 0. THEMES & COLORS TAB -->
        <div v-if="activeTab === 'themes'" class="space-y-4">
          <!-- Top Toolbar: Status, Import from JSON, Export JSON -->
          <div
            class="rounded-xl border p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition-colors duration-150"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
          >
            <div>
              <div class="flex items-center space-x-2">
                <Palette class="w-4 h-4" :style="{ color: 'var(--color-accent)' }" />
                <h4 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">Application & Terminal Themes</h4>
              </div>
              <p class="text-[11px] mt-0.5" :style="{ color: 'var(--color-text-muted)' }">
                Themes are loaded from JSON files. Choose a preset or load any custom JSON theme file.
              </p>
            </div>

            <!-- Import / Export Actions -->
            <div class="flex items-center space-x-2 shrink-0">
              <!-- Hidden File Input for .json selection -->
              <input
                ref="fileInputRef"
                type="file"
                accept=".json,application/json"
                class="hidden"
                @change="handleThemeFileSelect"
              />

              <button
                @click="triggerImportFile"
                class="px-2.5 py-1.5 rounded-lg border text-xs font-medium transition flex items-center space-x-1.5 shadow-sm btn-theme-card"
                :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
                title="Select a JSON theme file from disk"
              >
                <Upload class="w-3.5 h-3.5" :style="{ color: 'var(--color-accent)' }" />
                <span>Load JSON File</span>
              </button>

              <button
                @click="showPasteModal = true"
                class="px-2.5 py-1.5 rounded-lg border text-xs font-medium transition flex items-center space-x-1.5 shadow-sm btn-theme-card"
                :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
                title="Paste theme JSON text directly"
              >
                <FileCode class="w-3.5 h-3.5" :style="{ color: 'var(--color-text-muted)' }" />
                <span>Paste JSON</span>
              </button>

              <button
                @click="handleExportTheme(themeStore.currentTheme)"
                class="px-2.5 py-1.5 rounded-lg border text-xs font-medium transition flex items-center space-x-1.5 shadow-sm btn-theme-card"
                :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
                title="Export current active theme as a JSON file"
              >
                <Download class="w-3.5 h-3.5" :style="{ color: 'var(--color-accent)' }" />
                <span>Export JSON</span>
              </button>
            </div>
          </div>

          <!-- Notification / Toast for import feedback -->
          <div
            v-if="importStatus"
            :class="[
              'p-2.5 rounded-lg text-xs flex items-center space-x-2 border transition-all animate-in fade-in',
              importStatus.isError
                ? 'bg-red-950/80 border-red-700/80 text-red-200'
                : 'bg-emerald-950/80 border-emerald-700/80 text-emerald-200'
            ]"
          >
            <span>{{ importStatus.isError ? '⚠️' : '✅' }}</span>
            <span>{{ importStatus.message }}</span>
          </div>

          <!-- Theme Cards Grid -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div
              v-for="theme in themeStore.allThemes"
              :key="theme.id"
              @click="themeStore.setTheme(theme.id)"
              :class="[
                'p-3.5 rounded-xl border text-left cursor-pointer transition-all duration-150 flex flex-col justify-between group relative shadow-sm',
                themeStore.currentThemeId === theme.id ? 'shadow-md' : ''
              ]"
              :style="{
                backgroundColor: themeStore.currentThemeId === theme.id ? theme.ui.bgCard : theme.ui.bgApp,
                borderColor: themeStore.currentThemeId === theme.id ? theme.ui.borderActive : theme.ui.border,
                boxShadow: themeStore.currentThemeId === theme.id ? `0 0 0 2px ${theme.ui.accent}` : undefined,
              }"
            >
              <!-- Card Top Row: Title, Tag, Check -->
              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <div class="flex items-center space-x-2 min-w-0">
                    <span class="font-semibold text-xs truncate" :style="{ color: theme.ui.textMain }">
                      {{ theme.name }}
                    </span>
                    <span
                      v-if="theme.id === 'default'"
                      class="px-1.5 py-0.2 rounded text-[9px] font-mono uppercase tracking-wider font-semibold border shrink-0"
                      :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-accent)' }"
                    >
                      Default
                    </span>
                    <span
                      v-else-if="theme.isCustom"
                      class="px-1.5 py-0.2 rounded text-[9px] font-mono uppercase tracking-wider font-semibold border shrink-0"
                      :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-accent-secondary)' }"
                    >
                      Custom JSON
                    </span>
                    <span
                      v-else
                      class="px-1.5 py-0.2 rounded text-[9px] font-mono uppercase tracking-wider font-semibold border shrink-0"
                      :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
                    >
                      Preset
                    </span>
                  </div>

                  <div class="flex items-center space-x-1 shrink-0 ml-2">
                    <div
                      v-if="themeStore.currentThemeId === theme.id"
                      class="w-4 h-4 rounded-full flex items-center justify-center font-bold text-[10px]"
                      :style="{ backgroundColor: theme.ui.accent, color: theme.ui.bgApp }"
                    >
                      ✓
                    </div>

                    <!-- Custom theme delete action -->
                    <button
                      v-if="theme.isCustom"
                      @click.stop="themeStore.deleteCustomTheme(theme.id)"
                      class="p-1 rounded transition hover:text-red-400"
                      :style="{ color: 'var(--color-text-muted)' }"
                      title="Delete this custom theme"
                    >
                      <Trash2 class="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <p class="text-[11px] leading-relaxed line-clamp-2" :style="{ color: theme.ui.textMuted }">
                  {{ theme.description || 'Custom user color scheme.' }}
                </p>
              </div>

              <!-- Color Palette Swatches Strip -->
              <div class="mt-3 pt-2.5 border-t flex items-center justify-between" :style="{ borderColor: theme.ui.border }">
                <div class="flex items-center space-x-1.5">
                  <div
                    class="w-3.5 h-3.5 rounded-full border shadow-sm"
                    :style="{ backgroundColor: theme.ui.bgApp, borderColor: theme.ui.border }"
                    title="App Background"
                  />
                  <div
                    class="w-3.5 h-3.5 rounded-full border shadow-sm"
                    :style="{ backgroundColor: theme.ui.accent, borderColor: theme.ui.border }"
                    title="Primary Accent"
                  />
                  <div
                    class="w-3.5 h-3.5 rounded-full border shadow-sm"
                    :style="{ backgroundColor: theme.ui.accentSecondary, borderColor: theme.ui.border }"
                    title="Secondary Accent"
                  />
                  <div
                    class="w-3.5 h-3.5 rounded-full border shadow-sm"
                    :style="{ backgroundColor: theme.terminal.green, borderColor: theme.ui.border }"
                    title="Terminal Green"
                  />
                  <div
                    class="w-3.5 h-3.5 rounded-full border shadow-sm"
                    :style="{ backgroundColor: theme.terminal.yellow, borderColor: theme.ui.border }"
                    title="Terminal Yellow"
                  />
                  <div
                    class="w-3.5 h-3.5 rounded-full border shadow-sm"
                    :style="{ backgroundColor: theme.terminal.cyan, borderColor: theme.ui.border }"
                    title="Terminal Cyan"
                  />
                </div>

                <button
                  @click.stop="handleExportTheme(theme)"
                  class="text-[10px] transition flex items-center space-x-1"
                  :style="{ color: 'var(--color-text-muted)' }"
                  title="Export this theme to JSON file"
                >
                  <Download class="w-3 h-3" />
                  <span>JSON</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Live Theme & Terminal Preview -->
          <div
            class="rounded-xl border p-4 space-y-3 transition-colors duration-150"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-2">
                <Sparkles class="w-4 h-4" :style="{ color: 'var(--color-accent)' }" />
                <h4 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">Active Theme Live Preview</h4>
              </div>
              <span class="text-[11px] font-mono font-semibold" :style="{ color: 'var(--color-accent)' }">
                {{ themeStore.currentTheme.name }}
              </span>
            </div>

            <!-- Terminal Mock Preview rendered with active theme colors -->
            <div
              class="p-3.5 rounded-lg border shadow-inner transition-colors duration-150 overflow-hidden font-mono text-xs"
              :style="{
                backgroundColor: themeStore.currentTheme.terminal.background,
                borderColor: themeStore.currentTheme.ui.border,
                fontFamily: settingsStore.terminalFontFamily,
                lineHeight: settingsStore.terminalLineHeight,
              }"
            >
              <div class="flex items-center space-x-2 mb-2 pb-1.5 border-b" :style="{ borderColor: themeStore.currentTheme.ui.border }">
                <span class="w-2.5 h-2.5 rounded-full bg-red-500/80 inline-block" />
                <span class="w-2.5 h-2.5 rounded-full bg-yellow-500/80 inline-block" />
                <span class="w-2.5 h-2.5 rounded-full bg-green-500/80 inline-block" />
                <span class="text-[10px] ml-1" :style="{ color: 'var(--color-text-muted)' }">termsftp-shell — 80x24</span>
              </div>

              <div>
                <span :style="{ color: themeStore.currentTheme.terminal.green }">user@termsftp</span>
                <span :style="{ color: themeStore.currentTheme.terminal.foreground }">:</span>
                <span :style="{ color: themeStore.currentTheme.terminal.blue }">~/projects/web</span>
                <span :style="{ color: themeStore.currentTheme.terminal.foreground }">$ </span>
                <span :style="{ color: themeStore.currentTheme.terminal.foreground }">ls -la</span>
              </div>
              <div :style="{ color: themeStore.currentTheme.terminal.brightBlack }">total 48</div>
              <div>
                <span :style="{ color: themeStore.currentTheme.terminal.blue }">drwxr-xr-x</span>
                <span :style="{ color: themeStore.currentTheme.terminal.foreground }"> 6 deploy staff  4096 Oct 06 15:30 </span>
                <span :style="{ color: themeStore.currentTheme.terminal.cyan }">src/</span>
              </div>
              <div>
                <span :style="{ color: themeStore.currentTheme.terminal.yellow }">-rw-r--r--</span>
                <span :style="{ color: themeStore.currentTheme.terminal.foreground }"> 1 deploy staff  1284 Oct 06 15:31 </span>
                <span :style="{ color: themeStore.currentTheme.terminal.green }">package.json</span>
              </div>
              <div class="mt-1">
                <span :style="{ color: themeStore.currentTheme.terminal.green }">user@termsftp</span>
                <span :style="{ color: themeStore.currentTheme.terminal.foreground }">:</span>
                <span :style="{ color: themeStore.currentTheme.terminal.blue }">~/projects/web</span>
                <span :style="{ color: themeStore.currentTheme.terminal.foreground }">$ </span>
                <span
                  class="inline-block w-2 h-3.5 align-middle animate-pulse"
                  :style="{ backgroundColor: themeStore.currentTheme.terminal.cursor }"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- 1. TRANSFERS TAB -->
        <div v-if="activeTab === 'transfers'" class="space-y-4">
          <!-- Maximum Simultaneous Transfers -->
          <div
            class="rounded-xl border p-4 space-y-3"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
          >
            <div class="flex items-center justify-between">
              <div>
                <h4 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">Maximum Simultaneous Transfers</h4>
                <p class="text-[11px] mt-0.5" :style="{ color: 'var(--color-text-muted)' }">
                  Controls how many files are downloaded or uploaded in parallel during batch transfers.
                </p>
              </div>
              <div
                class="px-2.5 py-1 rounded-lg border font-mono font-bold text-xs"
                :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-accent)' }"
              >
                {{ sftpStore.maxSimultaneousTransfers }} concurrent
              </div>
            </div>

            <div class="flex items-center space-x-3 pt-1">
              <span class="text-[11px] font-mono" :style="{ color: 'var(--color-text-muted)' }">1</span>
              <input
                type="range"
                v-model.number="sftpStore.maxSimultaneousTransfers"
                min="1"
                max="10"
                class="flex-1 cursor-pointer"
                :style="{ accentColor: 'var(--color-accent)' }"
              />
              <span class="text-[11px] font-mono" :style="{ color: 'var(--color-text-muted)' }">10</span>
            </div>

            <div class="flex items-center justify-between text-[10px]" :style="{ color: 'var(--color-text-muted)' }">
              <span>Conservative (1-2)</span>
              <span>Recommended (3-5)</span>
              <span>High Throughput (6-10)</span>
            </div>
          </div>

          <!-- Conflict Resolution Default -->
          <div
            class="rounded-xl border p-4 space-y-2.5"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
          >
            <h4 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">Default File Conflict Policy</h4>
            <p class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">
              Action to take when a file already exists at the transfer destination.
            </p>

            <select
              v-model="sftpStore.conflictPolicy"
              class="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none cursor-pointer input-theme"
              :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
            >
              <option value="ask">Prompt (Ask every time a conflict occurs)</option>
              <option value="overwrite">Overwrite (Always replace existing files)</option>
              <option value="skip">Skip (Never overwrite existing files)</option>
            </select>
          </div>
        </div>

        <!-- 2. FONTS & APPEARANCE TAB -->
        <div v-if="activeTab === 'appearance'" class="space-y-4">
          <!-- Terminal Font & Size Settings -->
          <div
            class="rounded-xl border p-4 space-y-3.5"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-2">
                <Terminal class="w-4 h-4" :style="{ color: 'var(--color-accent)' }" />
                <h4 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">SSH Terminal Font & Sizing</h4>
              </div>
              <button
                @click="settingsStore.resetTerminalDefaults()"
                class="text-[11px] flex items-center space-x-1 transition"
                :style="{ color: 'var(--color-text-muted)' }"
                title="Reset Terminal Font Defaults"
              >
                <RotateCcw class="w-3 h-3" />
                <span>Reset</span>
              </button>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <!-- Terminal Font Family Dropdown -->
              <div>
                <label class="block text-[11px] font-medium mb-1" :style="{ color: 'var(--color-text-muted)' }">Font Family</label>
                <select
                  v-model="settingsStore.terminalFontFamily"
                  class="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none cursor-pointer input-theme"
                  :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
                >
                  <option
                    v-for="font in TERMINAL_FONTS"
                    :key="font.value"
                    :value="font.value"
                  >
                    {{ font.label }}
                  </option>
                </select>
              </div>

              <!-- Terminal Font Size -->
              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="block text-[11px] font-medium" :style="{ color: 'var(--color-text-muted)' }">Font Size</label>
                  <span class="text-[11px] font-mono font-semibold" :style="{ color: 'var(--color-accent)' }">{{ settingsStore.terminalFontSize }}px</span>
                </div>
                <div class="flex items-center space-x-2 pt-0.5">
                  <input
                    type="range"
                    v-model.number="settingsStore.terminalFontSize"
                    min="11"
                    max="22"
                    step="1"
                    class="flex-1 cursor-pointer"
                    :style="{ accentColor: 'var(--color-accent)' }"
                  />
                </div>
              </div>
            </div>

            <!-- Terminal Line Height -->
            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="block text-[11px] font-medium" :style="{ color: 'var(--color-text-muted)' }">Line Height / Row Spacing</label>
                <span class="text-[11px] font-mono" :style="{ color: 'var(--color-text-muted)' }">{{ settingsStore.terminalLineHeight }}</span>
              </div>
              <div class="flex items-center space-x-2">
                <input
                  type="range"
                  v-model.number="settingsStore.terminalLineHeight"
                  min="1.0"
                  max="1.6"
                  step="0.05"
                  class="flex-1 cursor-pointer"
                  :style="{ accentColor: 'var(--color-accent)' }"
                />
              </div>
            </div>

            <!-- Live Terminal Font Preview Box -->
            <div
              class="mt-2 p-3 rounded-lg border shadow-inner"
              :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
            >
              <div class="text-[10px] uppercase font-mono tracking-wider mb-1" :style="{ color: 'var(--color-text-muted)' }">Live Terminal Preview</div>
              <div
                class="leading-tight transition-all duration-150 overflow-hidden"
                :style="{
                  fontFamily: settingsStore.terminalFontFamily,
                  fontSize: settingsStore.terminalFontSize + 'px',
                  lineHeight: settingsStore.terminalLineHeight,
                  color: 'var(--color-accent)',
                }"
              >
                <div>user@remote-server:~$ ls -la /var/www</div>
                <div :style="{ color: 'var(--color-text-muted)' }">drwxr-xr-x 4 root root  4096 Oct 05 19:45 .</div>
                <div :style="{ color: 'var(--color-accent-secondary)' }">-rw-r--r-- 1 root root 14280 Oct 05 19:48 index.html</div>
              </div>
            </div>
          </div>

          <!-- File Browser (FTP Preview) Font Settings -->
          <div
            class="rounded-xl border p-4 space-y-3.5"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-2">
                <FolderSync class="w-4 h-4" :style="{ color: 'var(--color-accent-secondary)' }" />
                <h4 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">File Browser (FTP Preview) Font & Density</h4>
              </div>
              <button
                @click="settingsStore.resetBrowserDefaults()"
                class="text-[11px] flex items-center space-x-1 transition"
                :style="{ color: 'var(--color-text-muted)' }"
                title="Reset File Browser Font Defaults"
              >
                <RotateCcw class="w-3 h-3" />
                <span>Reset</span>
              </button>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <!-- Browser Font Family -->
              <div>
                <label class="block text-[11px] font-medium mb-1" :style="{ color: 'var(--color-text-muted)' }">Font Family</label>
                <select
                  v-model="settingsStore.browserFontFamily"
                  class="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none cursor-pointer input-theme"
                  :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
                >
                  <option
                    v-for="font in BROWSER_FONTS"
                    :key="font.value"
                    :value="font.value"
                  >
                    {{ font.label }}
                  </option>
                </select>
              </div>

              <!-- Browser Font Size (Quick Segmented Picker) -->
              <div>
                <label class="block text-[11px] font-medium mb-1" :style="{ color: 'var(--color-text-muted)' }">Font Size</label>
                <div class="grid grid-cols-4 gap-1">
                  <button
                    v-for="sz in [11, 12, 13, 14]"
                    :key="sz"
                    type="button"
                    @click="settingsStore.browserFontSize = sz"
                    class="py-1 text-center rounded-md border text-xs font-mono font-medium transition"
                    :style="settingsStore.browserFontSize === sz ? { backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-accent-secondary)', color: 'var(--color-accent-secondary)', fontWeight: 'bold' } : { backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
                  >
                    {{ sz }}px
                  </button>
                </div>
              </div>
            </div>

            <!-- Row Density / Padding -->
            <div>
              <label class="block text-[11px] font-medium mb-1" :style="{ color: 'var(--color-text-muted)' }">Row Density / Spacing</label>
              <div class="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  @click="settingsStore.browserRowDensity = 'compact'"
                  class="py-1.5 text-xs rounded-lg border font-medium transition text-center"
                  :style="settingsStore.browserRowDensity === 'compact' ? { backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-accent-secondary)', color: 'var(--color-accent-secondary)', fontWeight: 'bold' } : { backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
                >
                  Compact
                </button>
                <button
                  type="button"
                  @click="settingsStore.browserRowDensity = 'normal'"
                  class="py-1.5 text-xs rounded-lg border font-medium transition text-center"
                  :style="settingsStore.browserRowDensity === 'normal' ? { backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-accent-secondary)', color: 'var(--color-accent-secondary)', fontWeight: 'bold' } : { backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
                >
                  Normal
                </button>
                <button
                  type="button"
                  @click="settingsStore.browserRowDensity = 'relaxed'"
                  class="py-1.5 text-xs rounded-lg border font-medium transition text-center"
                  :style="settingsStore.browserRowDensity === 'relaxed' ? { backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-accent-secondary)', color: 'var(--color-accent-secondary)', fontWeight: 'bold' } : { backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
                >
                  Relaxed
                </button>
              </div>
            </div>

            <!-- Live Browser Font Preview Box -->
            <div
              class="mt-2 p-3 rounded-lg border shadow-inner"
              :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
            >
              <div class="text-[10px] uppercase font-mono tracking-wider mb-1.5" :style="{ color: 'var(--color-text-muted)' }">Live File Preview</div>
              <div
                class="rounded border overflow-hidden transition-all duration-150"
                :style="{
                  backgroundColor: 'var(--color-bg-pane)',
                  borderColor: 'var(--color-border)',
                  fontFamily: settingsStore.browserFontFamily,
                  fontSize: settingsStore.browserFontSize + 'px',
                }"
              >
                <div
                  :class="[
                    'flex items-center justify-between',
                    settingsStore.browserRowDensity === 'compact' ? 'py-0 px-2' : settingsStore.browserRowDensity === 'relaxed' ? 'py-1 px-2.5' : 'py-0.5 px-2'
                  ]"
                >
                  <span class="flex items-center space-x-1.5 leading-none">
                    <FileIcon name="public_html" :is-dir="true" :size="14" />
                    <span class="font-medium truncate" :style="{ color: 'var(--color-text-main)' }">public_html</span>
                  </span>
                  <span class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">Folder</span>
                  <span class="font-mono text-[11px]" :style="{ color: 'var(--color-text-muted)' }">-</span>
                </div>
                <div
                  :class="[
                    'flex items-center justify-between',
                    settingsStore.browserRowDensity === 'compact' ? 'py-0 px-2' : settingsStore.browserRowDensity === 'relaxed' ? 'py-1 px-2.5' : 'py-0.5 px-2'
                  ]"
                >
                  <span class="flex items-center space-x-1.5 leading-none">
                    <FileIcon name="config.production.json" :is-dir="false" :size="14" />
                    <span :style="{ color: 'var(--color-text-main)' }">config.production.json</span>
                  </span>
                  <span class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">JSON</span>
                  <span class="font-mono text-[11px]" :style="{ color: 'var(--color-text-muted)' }">4.2 KB</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Code Editor (CodeMirror 6) Settings -->
          <div
            class="rounded-xl border p-4 space-y-3.5"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-2">
                <FileCode class="w-4 h-4" :style="{ color: 'var(--color-accent)' }" />
                <h4 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">Code Editor (CodeMirror 6)</h4>
              </div>
            </div>

            <!-- Vim Mode Option -->
            <div class="flex items-center justify-between pt-1">
              <div>
                <label class="block text-[11px] font-medium" :style="{ color: 'var(--color-text-main)' }">Vim Keybindings Mode</label>
                <p class="text-[10px] mt-0.5" :style="{ color: 'var(--color-text-muted)' }">
                  Enables modal Vim navigation (Normal, Insert, Visual) and commands (:w, :wq, :q).
                </p>
              </div>
              <button
                type="button"
                @click="settingsStore.editorVimMode = !settingsStore.editorVimMode"
                class="px-3 py-1.5 rounded-lg border text-xs font-mono font-semibold flex items-center space-x-1.5 transition"
                :class="settingsStore.editorVimMode ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300' : 'bg-slate-800/40 border-slate-700/60 text-slate-400'"
              >
                <span>{{ settingsStore.editorVimMode ? 'Vim Enabled' : 'Standard Mode' }}</span>
                <span class="w-2 h-2 rounded-full" :class="settingsStore.editorVimMode ? 'bg-emerald-400' : 'bg-slate-600'" />
              </button>
            </div>

            <!-- Editor Font Size -->
            <div class="pt-2 border-t" :style="{ borderColor: 'var(--color-border)' }">
              <div class="flex items-center justify-between mb-1">
                <label class="block text-[11px] font-medium" :style="{ color: 'var(--color-text-muted)' }">Editor Font Size</label>
                <span class="text-[11px] font-mono" :style="{ color: 'var(--color-text-muted)' }">{{ settingsStore.editorFontSize }}px</span>
              </div>
              <div class="flex items-center space-x-2">
                <input
                  type="range"
                  v-model.number="settingsStore.editorFontSize"
                  min="10"
                  max="20"
                  step="1"
                  class="flex-1 cursor-pointer"
                  :style="{ accentColor: 'var(--color-accent)' }"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- 3. KEYMAP & SHORTCUTS TAB -->
        <div v-if="activeTab === 'keymap'" class="space-y-4">
          <!-- Preset Selector -->
          <div
            class="rounded-xl border p-4 space-y-3"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
          >
            <div class="flex items-center justify-between">
              <div>
                <h4 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">Keyboard Shortcuts Scheme</h4>
                <p class="text-[11px] mt-0.5" :style="{ color: 'var(--color-text-muted)' }">
                  Select a predefined scheme or customize individual shortcuts below.
                </p>
              </div>
              <button
                @click="settingsStore.resetAllKeymaps()"
                class="text-[11px] flex items-center space-x-1 transition shrink-0"
                :style="{ color: 'var(--color-text-muted)' }"
                title="Reset All Shortcuts to Defaults"
              >
                <RotateCcw class="w-3 h-3" />
                <span>Reset Defaults</span>
              </button>
            </div>

            <div class="grid grid-cols-3 gap-2 pt-1">
              <button
                v-for="preset in KEYMAP_PRESETS"
                :key="preset.id"
                type="button"
                @click="settingsStore.applyKeymapPreset(preset.id)"
                class="p-2.5 rounded-lg border text-left transition flex flex-col justify-between"
                :style="currentPresetId === preset.id ? { backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-accent)', color: 'var(--color-text-main)' } : { backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
              >
                <div class="flex items-center justify-between mb-1">
                  <span class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">{{ preset.name }}</span>
                  <Check v-if="currentPresetId === preset.id" class="w-3.5 h-3.5" :style="{ color: 'var(--color-accent)' }" />
                </div>
                <p class="text-[10px] leading-snug" :style="{ color: 'var(--color-text-muted)' }">{{ preset.description }}</p>
              </button>
            </div>
          </div>

          <!-- Connection Tabs Navigation -->
          <div
            class="rounded-xl border p-4 space-y-3"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
          >
            <div class="flex items-center space-x-2">
              <div
                class="w-5 h-5 rounded-md border flex items-center justify-center"
                :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-accent)' }"
              >
                <Layers class="w-3.5 h-3.5" />
              </div>
              <div>
                <h4 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">Connection Tabs Navigation</h4>
                <p class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">Switch rapidly between active SSH and FTP connection tabs.</p>
              </div>
            </div>

            <div class="divide-y pt-1" :style="{ borderColor: 'var(--color-border)' }">
              <div
                v-for="action in connectionActions"
                :key="action.id"
                class="py-2.5 flex items-center justify-between gap-3"
                :style="{ borderColor: 'var(--color-border)' }"
              >
                <div class="min-w-0 flex-1">
                  <div class="font-medium text-xs" :style="{ color: 'var(--color-text-main)' }">{{ action.title }}</div>
                  <div class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">{{ action.description }}</div>
                </div>

                <div class="flex items-center space-x-2 shrink-0">
                  <!-- Recording State -->
                  <div v-if="recordingAction === action.id" class="flex items-center space-x-2">
                    <span class="px-2.5 py-1 rounded-md bg-amber-950/80 border border-amber-600/70 text-amber-300 font-mono text-xs animate-pulse flex items-center space-x-1.5">
                      <span class="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                      <span>{{ recordingPreview || 'Press keys...' }}</span>
                    </span>
                    <button
                      @click="stopRecording"
                      class="px-2 py-1 text-[11px] rounded border transition btn-theme-card"
                      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
                    >
                      Cancel (Esc)
                    </button>
                  </div>

                  <!-- Normal Display -->
                  <template v-else>
                    <div class="flex items-center space-x-1 font-mono">
                      <template
                        v-for="(part, idx) in splitShortcutParts(settingsStore.keymaps[action.id])"
                        :key="idx"
                      >
                        <kbd
                          class="px-2 py-0.5 text-xs rounded border font-semibold shadow-sm"
                          :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-accent)' }"
                        >
                          {{ part }}
                        </kbd>
                        <span
                          v-if="idx < splitShortcutParts(settingsStore.keymaps[action.id]).length - 1"
                          class="text-[10px]"
                          :style="{ color: 'var(--color-text-muted)' }"
                        >
                          +
                        </span>
                      </template>
                    </div>

                    <button
                      @click="startRecording(action.id)"
                      class="px-2 py-1 text-[11px] font-medium rounded border transition flex items-center space-x-1 btn-theme-card"
                      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
                      title="Record new shortcut"
                    >
                      <Edit2 class="w-3 h-3" :style="{ color: 'var(--color-text-muted)' }" />
                      <span>Edit</span>
                    </button>

                    <button
                      v-if="settingsStore.keymaps[action.id] !== action.defaultShortcut"
                      @click="settingsStore.resetKeymapAction(action.id)"
                      class="p-1 rounded transition"
                      :style="{ color: 'var(--color-text-muted)' }"
                      title="Reset to default"
                    >
                      <RotateCcw class="w-3 h-3" />
                    </button>
                  </template>
                </div>
              </div>
            </div>
          </div>

          <!-- View Switcher (Terminal ↔ Files) -->
          <div
            class="rounded-xl border p-4 space-y-3"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
          >
            <div class="flex items-center space-x-2">
              <div
                class="w-5 h-5 rounded-md border flex items-center justify-center"
                :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-accent-secondary)' }"
              >
                <ArrowLeftRight class="w-3.5 h-3.5" />
              </div>
              <div>
                <h4 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">Terminal & Files View Switching</h4>
                <p class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">Switch between interactive terminal shell and dual-pane SFTP/FTP file browser.</p>
              </div>
            </div>

            <div class="divide-y pt-1" :style="{ borderColor: 'var(--color-border)' }">
              <div
                v-for="action in viewActions"
                :key="action.id"
                class="py-2.5 flex items-center justify-between gap-3"
                :style="{ borderColor: 'var(--color-border)' }"
              >
                <div class="min-w-0 flex-1">
                  <div class="font-medium text-xs" :style="{ color: 'var(--color-text-main)' }">{{ action.title }}</div>
                  <div class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">{{ action.description }}</div>
                </div>

                <div class="flex items-center space-x-2 shrink-0">
                  <!-- Recording State -->
                  <div v-if="recordingAction === action.id" class="flex items-center space-x-2">
                    <span class="px-2.5 py-1 rounded-md bg-amber-950/80 border border-amber-600/70 text-amber-300 font-mono text-xs animate-pulse flex items-center space-x-1.5">
                      <span class="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                      <span>{{ recordingPreview || 'Press keys...' }}</span>
                    </span>
                    <button
                      @click="stopRecording"
                      class="px-2 py-1 text-[11px] rounded border transition btn-theme-card"
                      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
                    >
                      Cancel (Esc)
                    </button>
                  </div>

                  <!-- Normal Display -->
                  <template v-else>
                    <div class="flex items-center space-x-1 font-mono">
                      <template
                        v-for="(part, idx) in splitShortcutParts(settingsStore.keymaps[action.id])"
                        :key="idx"
                      >
                        <kbd
                          class="px-2 py-0.5 text-xs rounded border font-semibold shadow-sm"
                          :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-accent)' }"
                        >
                          {{ part }}
                        </kbd>
                        <span
                          v-if="idx < splitShortcutParts(settingsStore.keymaps[action.id]).length - 1"
                          class="text-[10px]"
                          :style="{ color: 'var(--color-text-muted)' }"
                        >
                          +
                        </span>
                      </template>
                    </div>

                    <button
                      @click="startRecording(action.id)"
                      class="px-2 py-1 text-[11px] font-medium rounded border transition flex items-center space-x-1 btn-theme-card"
                      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
                      title="Record new shortcut"
                    >
                      <Edit2 class="w-3 h-3" :style="{ color: 'var(--color-text-muted)' }" />
                      <span>Edit</span>
                    </button>

                    <button
                      v-if="settingsStore.keymaps[action.id] !== action.defaultShortcut"
                      @click="settingsStore.resetKeymapAction(action.id)"
                      class="p-1 rounded transition"
                      :style="{ color: 'var(--color-text-muted)' }"
                      title="Reset to default"
                    >
                      <RotateCcw class="w-3 h-3" />
                    </button>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 4. SECURITY & MASTER PASSWORD TAB -->
        <div v-if="activeTab === 'security'" class="space-y-4">
          <div
            class="rounded-xl border p-4 space-y-3"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
          >
            <div class="flex items-start justify-between">
              <div>
                <h4 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">Encrypted JSON Password Vault</h4>
                <p class="text-[11px] mt-0.5" :style="{ color: 'var(--color-text-muted)' }">
                  Saved connection passwords are encrypted with AES-256-GCM and stored in <span class="font-mono" :style="{ color: 'var(--color-accent)' }">vault.json</span>.
                </p>
              </div>

              <!-- Status Badge -->
              <span
                v-if="!vaultStore.isInitialized"
                class="px-2 py-0.5 rounded-full text-[10px] font-semibold border"
                :style="{ backgroundColor: 'var(--color-bg-card)', color: 'var(--color-text-muted)', borderColor: 'var(--color-border)' }"
              >
                Not Configured
              </span>
              <span
                v-else-if="vaultStore.isUnlocked"
                class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 flex items-center space-x-1"
              >
                <Unlock class="w-3 h-3 text-emerald-400" />
                <span>Unlocked</span>
              </span>
              <span
                v-else
                class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-950/80 text-amber-300 border border-amber-700/60 flex items-center space-x-1"
              >
                <Lock class="w-3 h-3 text-amber-400" />
                <span>Locked</span>
              </span>
            </div>

            <!-- Actions -->
            <div class="pt-2 border-t flex items-center space-x-2" :style="{ borderColor: 'var(--color-border)' }">
              <template v-if="!vaultStore.isInitialized">
                <button
                  @click="handleSetupMasterPassword"
                  class="px-3 py-1.5 rounded-lg text-white font-medium text-xs transition flex items-center space-x-1.5 btn-accent"
                >
                  <KeyRound class="w-3.5 h-3.5" />
                  <span>Set Up Master Password</span>
                </button>
              </template>
              <template v-else>
                <button
                  v-if="vaultStore.isUnlocked"
                  @click="handleLockVault"
                  class="px-3 py-1.5 rounded-lg border font-medium text-xs transition flex items-center space-x-1.5 btn-theme-card"
                  :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
                >
                  <Lock class="w-3.5 h-3.5" :style="{ color: 'var(--color-text-muted)' }" />
                  <span>Lock Vault Now</span>
                </button>
                <button
                  v-else
                  @click="handleUnlockVault"
                  class="px-3 py-1.5 rounded-lg text-white font-medium text-xs transition flex items-center space-x-1.5 btn-accent"
                >
                  <Unlock class="w-3.5 h-3.5" />
                  <span>Unlock Vault</span>
                </button>

                <button
                  @click="handleChangeMasterPassword"
                  class="px-3 py-1.5 rounded-lg border font-medium text-xs transition flex items-center space-x-1.5 btn-theme-card"
                  :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
                >
                  <KeyRound class="w-3.5 h-3.5" :style="{ color: 'var(--color-text-muted)' }" />
                  <span>Change Master Password</span>
                </button>

                <button
                  @click="showResetVaultConfirm = true"
                  class="px-3 py-1.5 rounded-lg border font-medium text-xs transition flex items-center space-x-1.5 text-red-400 hover:text-red-300 hover:border-red-800/80"
                  :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
                  title="Clear encrypted vault if master password is forgotten"
                >
                  <Trash2 class="w-3.5 h-3.5 text-red-400" />
                  <span>Reset Vault</span>
                </button>
              </template>
            </div>

            <!-- Inline reset confirmation -->
            <div
              v-if="showResetVaultConfirm"
              class="p-3 rounded-lg bg-red-950/30 border border-red-900/60 text-xs space-y-2 mt-2"
            >
              <div class="flex items-center space-x-2 text-red-300 font-medium">
                <AlertTriangle class="w-4 h-4 text-red-400 shrink-0" />
                <span>Reset Master Password Vault?</span>
              </div>
              <p class="text-[11px] text-red-200/80 leading-relaxed">
                This will delete <code class="font-mono text-red-300">vault.json</code> and clear all saved passwords. Your saved connection profiles (hosts, ports, usernames, groups, SSH key paths) will <strong>not</strong> be affected.
              </p>
              <div class="flex items-center justify-end space-x-2 pt-1">
                <button
                  type="button"
                  @click="showResetVaultConfirm = false"
                  class="px-2.5 py-1 rounded text-[11px] border btn-theme-card"
                  :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  @click="handleResetVault"
                  class="px-2.5 py-1 rounded text-[11px] bg-red-600 hover:bg-red-700 text-white font-medium transition"
                >
                  Confirm Reset
                </button>
              </div>
            </div>
          </div>

          <div
            class="p-3 rounded-xl border text-[11px] space-y-1.5"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
          >
            <div class="font-semibold flex items-center space-x-1.5" :style="{ color: 'var(--color-text-main)' }">
              <span>🛡️</span>
              <span>Vault Security Details</span>
            </div>
            <div>
              &bull; Algorithm: <span class="font-mono" :style="{ color: 'var(--color-text-main)' }">AES-256-GCM</span> with unique random 96-bit IVs per credential.
            </div>
            <div>
              &bull; Key Derivation: <span class="font-mono" :style="{ color: 'var(--color-text-main)' }">PBKDF2-HMAC-SHA256</span> (100,000 iterations + cryptographic salt).
            </div>
            <div>
              &bull; Unlocked passwords remain safely in memory for your current session and are discarded upon locking or app exit.
            </div>
          </div>
        </div>

        <!-- 5. PROTOCOLS TAB -->
        <div v-if="activeTab === 'protocols'" class="space-y-4">
          <div
            class="rounded-xl border p-4 space-y-3"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
          >
            <div class="flex items-center justify-between">
              <div>
                <h4 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">Supported Transfer Protocols</h4>
                <p class="text-[11px] mt-0.5" :style="{ color: 'var(--color-text-muted)' }">
                  All connection protocols currently supported in TermSFTP.
                </p>
              </div>
            </div>

            <div class="divide-y pt-1" :style="{ borderColor: 'var(--color-border)' }">
              <!-- SFTP -->
              <div class="py-2.5 flex items-center justify-between">
                <div class="space-y-0.5">
                  <div class="font-medium flex items-center space-x-2" :style="{ color: 'var(--color-text-main)' }">
                    <span>SFTP (SSH File Transfer Protocol)</span>
                    <span
                      class="px-1.5 py-0.2 rounded text-[10px] border font-semibold"
                      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-accent)' }"
                    >
                      Active
                    </span>
                  </div>
                  <div class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">
                    Encrypted over SSH (Port 22). Supports interactive terminal shell + dual-pane file management.
                  </div>
                </div>
              </div>

              <!-- Plain FTP & FTPS -->
              <div class="py-2.5 flex items-center justify-between">
                <div class="space-y-0.5">
                  <div class="font-medium flex items-center space-x-2" :style="{ color: 'var(--color-text-main)' }">
                    <span>FTP & FTPS (Native TLS)</span>
                    <span
                      class="px-1.5 py-0.2 rounded text-[10px] border font-semibold"
                      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-accent)' }"
                    >
                      Active
                    </span>
                  </div>
                  <div class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">
                    Plain FTP (Port 21) & Secure FTPS with TLS encryption. Directory listing, upload/download queue with live progress.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div
        class="flex items-center justify-end px-6 py-3.5 border-t shrink-0 transition-colors duration-150"
        :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)' }"
      >
        <button
          @click="emit('close')"
          class="px-5 py-2 rounded-lg text-xs font-semibold shadow-sm transition-colors btn-theme-card cursor-pointer"
        >
          Done
        </button>
      </div>
    </div>

    <!-- Paste JSON Theme Dialog Modal -->
    <div
      v-if="showPasteModal"
      class="fixed inset-0 z-60 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
    >
      <div
        class="w-full max-w-lg rounded-xl border shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95 duration-100"
        :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
      >
        <div class="flex items-center justify-between">
          <h4 class="font-semibold text-sm flex items-center space-x-2" :style="{ color: 'var(--color-text-main)' }">
            <FileCode class="w-4 h-4" :style="{ color: 'var(--color-accent)' }" />
            <span>Import Theme from JSON</span>
          </h4>
          <button
            @click="showPasteModal = false"
            class="p-1 rounded transition"
            :style="{ color: 'var(--color-text-muted)' }"
          >
            <X class="w-4 h-4" />
          </button>
        </div>

        <p class="text-xs" :style="{ color: 'var(--color-text-muted)' }">
          Paste the raw JSON content of your theme below (must include <code :style="{ color: 'var(--color-accent)' }">name</code>, <code :style="{ color: 'var(--color-accent)' }">ui</code>, and <code :style="{ color: 'var(--color-accent)' }">terminal</code> objects):
        </p>

        <textarea
          v-model="pastedJson"
          rows="10"
          class="w-full font-mono text-xs p-3 rounded-lg border focus:outline-none input-theme"
          :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
          placeholder='{ "name": "My Custom Theme", "ui": { ... }, "terminal": { ... } }'
        />

        <div class="flex items-center justify-end space-x-2">
          <button
            @click="showPasteModal = false"
            class="px-3 py-1.5 rounded-lg border text-xs transition btn-theme-card"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
          >
            Cancel
          </button>
          <button
            @click="handleImportPasted"
            class="px-4 py-1.5 rounded-lg text-white font-semibold text-xs shadow transition btn-accent"
          >
            Import & Apply
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
