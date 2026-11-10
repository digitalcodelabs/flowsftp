<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import appIcon from '~/assets/icon.png'
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
  Folder,
  Filter,
  Plus,
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
  Code2,
  Search,
  Info,
  ExternalLink,
  Mail,
  Loader2,
  CheckCircle2,
  RefreshCw,
} from 'lucide-vue-next'
import { invoke } from '@tauri-apps/api/core'
import { useSftpStore } from '../stores/sftp'
import { useVaultStore } from '../stores/vault'
import { useKeychainStore } from '../stores/keychain'
import { useSettingsStore, TERMINAL_FONTS, BROWSER_FONTS } from '../stores/settings'
import { useThemeStore, isLightTheme, type AppTheme } from '../stores/theme'
import { useDirWatcherStore } from '../stores/dirWatcher'
import { useUpdaterStore } from '../stores/updater'
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
    initialTab?: 'themes' | 'appearance' | 'keymap' | 'transfers' | 'security' | 'protocols' | 'developer' | 'about'
  }>(),
  {
    show: true,
    initialTab: 'themes',
  }
)

const emit = defineEmits<{
  (e: 'close'): void
}>()

const sftpStore = useSftpStore()
const vaultStore = useVaultStore()
const keychainStore = useKeychainStore()
const settingsStore = useSettingsStore()
const themeStore = useThemeStore()
const dirWatcherStore = useDirWatcherStore()
const updaterStore = useUpdaterStore()

const formatUpdaterBytes = (bytes: number): string => {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let val = bytes
  let idx = 0
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024
    idx++
  }
  return `${val.toFixed(idx > 1 ? 1 : 0)} ${units[idx]}`
}

const activeTab = ref<'themes' | 'appearance' | 'keymap' | 'transfers' | 'security' | 'protocols' | 'developer' | 'about'>(props.initialTab || 'themes')

const openExternalUrl = async (url: string) => {
  try {
    await invoke('sftp_open_in_default_app', { path: url })
  } catch {
    window.open(url, '_blank')
  }
}

watch(
  () => props.initialTab,
  (newTab) => {
    if (newTab) {
      activeTab.value = newTab
    }
  },
  { immediate: true }
)

watch(
  () => settingsStore.settingsModalTab,
  (newTab) => {
    if (newTab) {
      activeTab.value = newTab
    }
  }
)

watch(activeTab, (tab) => {
  if (tab && settingsStore.settingsModalTab !== tab) {
    settingsStore.settingsModalTab = tab
  }
})

// Ignore Filter state & presets
const newIgnorePatternInput = ref('')
const ignorePatternError = ref<string | null>(null)

const handleAddIgnorePattern = () => {
  const val = newIgnorePatternInput.value.trim()
  if (!val) return
  ignorePatternError.value = null
  const added = settingsStore.addIgnorePattern(val)
  if (added) {
    newIgnorePatternInput.value = ''
  } else {
    ignorePatternError.value = `Pattern "${val}" is already in the list.`
    setTimeout(() => {
      ignorePatternError.value = null
    }, 3000)
  }
}

const COMMON_IGNORE_PRESETS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'target',
  'vendor',
  '__pycache__',
  '.venv',
  '.turbo',
  '.cache',
  'coverage',
  '*.log',
  '*.tmp',
  '*.bak',
  '*.swp',
]

// Theme Import / Export state
const fileInputRef = ref<HTMLInputElement | null>(null)
const importStatus = ref<{ message: string; isError: boolean } | null>(null)
const showPasteModal = ref(false)
const pastedJson = ref('')

const handleThemeFileSelect = (e: Event) => {
  const input = e.target as HTMLInputElement
  if (!input.files || input.files.length === 0) return
  const file = input.files[0]
  if (!file) return
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

const fileManagerActions = computed(() =>
  KEYMAP_ACTIONS_META.filter((a) => a.category === 'fileManager')
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

const handleGlobalModalKeyDown = (e: KeyboardEvent) => {
  if (recordingAction.value || vaultStore.showModal) return // Don't close while recording shortcut or unlocking vault

  if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && (e.key === ',' || e.code === 'Comma'))) {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleGlobalModalKeyDown, true)
})

onBeforeUnmount(() => {
  stopRecording()
  window.removeEventListener('keydown', handleGlobalModalKeyDown, true)
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

// Encrypted Backup Export / Import State
const backupPanelMode = ref<'none' | 'export' | 'import'>('none')
const backupPassword = ref('')
const backupPasswordConfirm = ref('')
const pendingImportRawJson = ref<string | null>(null)
const backupImportReplace = ref(false)
const isProcessingBackup = ref(false)
const backupStatus = ref<{ message: string; isError: boolean } | null>(null)

const resetBackupForm = () => {
  backupPanelMode.value = 'none'
  backupPassword.value = ''
  backupPasswordConfirm.value = ''
  pendingImportRawJson.value = null
}

const openExportBackupPanel = () => {
  backupStatus.value = null
  backupPassword.value = ''
  backupPasswordConfirm.value = ''
  pendingImportRawJson.value = null
  backupPanelMode.value = backupPanelMode.value === 'export' ? 'none' : 'export'
}

const handlePickBackupFileForImport = async () => {
  backupStatus.value = null
  try {
    const raw = await invoke<string | null>('pick_and_read_file', {
      filterName: 'FlowSFTP Encrypted Backup (*.json)',
      filterExt: 'json',
    })
    if (!raw) return
    pendingImportRawJson.value = raw
    backupPassword.value = ''
    backupPasswordConfirm.value = ''
    backupImportReplace.value = false
    backupPanelMode.value = 'import'
  } catch (err: any) {
    backupStatus.value = {
      message: err?.message || String(err) || 'Failed to read backup file.',
      isError: true,
    }
  }
}

const handleExecuteExportBackup = async () => {
  backupStatus.value = null
  if (!backupPassword.value || backupPassword.value.length < 4) {
    backupStatus.value = { message: 'Backup password must be at least 4 characters long.', isError: true }
    return
  }
  if (backupPassword.value !== backupPasswordConfirm.value) {
    backupStatus.value = { message: 'Backup passwords do not match.', isError: true }
    return
  }

  isProcessingBackup.value = true
  try {
    const result = await vaultStore.exportEncryptedBackup(backupPassword.value)
    if (!result.savedPath) {
      backupStatus.value = null
      return
    }
    resetBackupForm()
    backupStatus.value = {
      message: `Exported ${result.profileCount} profile${result.profileCount === 1 ? '' : 's'} and ${result.secretCount} vault credential${result.secretCount === 1 ? '' : 's'}.`,
      isError: false,
    }
  } catch (err: any) {
    backupStatus.value = {
      message: err?.message || String(err) || 'Failed to export backup.',
      isError: true,
    }
  } finally {
    isProcessingBackup.value = false
  }
}

const handleExecuteImportBackup = async () => {
  if (!pendingImportRawJson.value) return
  backupStatus.value = null
  if (!backupPassword.value) {
    backupStatus.value = { message: 'Please enter the backup password.', isError: true }
    return
  }

  isProcessingBackup.value = true
  try {
    const result = await vaultStore.importEncryptedBackup(
      pendingImportRawJson.value,
      backupPassword.value,
      backupImportReplace.value
    )
    await keychainStore.loadProfiles()
    resetBackupForm()
    backupStatus.value = {
      message: `Restored ${result.profileCount} profile${result.profileCount === 1 ? '' : 's'} and ${result.secretCount} vault credential${result.secretCount === 1 ? '' : 's'}.`,
      isError: false,
    }
  } catch (err: any) {
    backupStatus.value = {
      message: err?.message || String(err) || 'Failed to decrypt or restore backup.',
      isError: true,
    }
  } finally {
    isProcessingBackup.value = false
  }
}

// System Fonts Management & Filtering
const terminalFontSearch = ref('')
const browserFontSearch = ref('')
const isManualTerminalFont = ref(false)
const isManualBrowserFont = ref(false)

onMounted(() => {
  settingsStore.loadSystemFonts()
})

watch(
  () => props.show,
  (val) => {
    if (val) {
      settingsStore.loadSystemFonts()
    }
  }
)

const extractBaseFontName = (stack: string) => {
  if (!stack) return ''
  const first = (stack.split(',')[0] ?? '').trim()
  return first.replace(/^["']|["']$/g, '').trim()
}

const formatFontValue = (name: string, isMonospace: boolean) => {
  const quoted = name.includes(' ') ? `"${name}"` : name
  return isMonospace ? `${quoted}, monospace` : `${quoted}, sans-serif`
}

const selectedTerminalFontName = computed({
  get() {
    return extractBaseFontName(settingsStore.terminalFontFamily)
  },
  set(name: string) {
    if (!name) return
    const isMono = settingsStore.systemFonts.find((f) => f.name === name)?.is_monospace ?? true
    settingsStore.terminalFontFamily = formatFontValue(name, isMono)
  },
})

const selectedBrowserFontName = computed({
  get() {
    return extractBaseFontName(settingsStore.browserFontFamily)
  },
  set(name: string) {
    if (!name) return
    const isMono = settingsStore.systemFonts.find((f) => f.name === name)?.is_monospace ?? false
    settingsStore.browserFontFamily = formatFontValue(name, isMono)
  },
})

const isCurrentTerminalFontInList = computed(() => {
  const currentBase = selectedTerminalFontName.value.toLowerCase()
  return settingsStore.systemFonts.some((f) => f.name.toLowerCase() === currentBase)
})

const isCurrentBrowserFontInList = computed(() => {
  const currentBase = selectedBrowserFontName.value.toLowerCase()
  return settingsStore.systemFonts.some((f) => f.name.toLowerCase() === currentBase)
})

const terminalMonospaceFonts = computed(() => {
  const query = terminalFontSearch.value.trim().toLowerCase()
  return settingsStore.systemFonts
    .filter((f) => f.is_monospace)
    .filter((f) => !query || f.name.toLowerCase().includes(query))
})

const terminalOtherFonts = computed(() => {
  const query = terminalFontSearch.value.trim().toLowerCase()
  return settingsStore.systemFonts
    .filter((f) => !f.is_monospace)
    .filter((f) => !query || f.name.toLowerCase().includes(query))
})

const browserUiFonts = computed(() => {
  const query = browserFontSearch.value.trim().toLowerCase()
  const commonUi = [
    'inter',
    'segoe ui',
    'system-ui',
    'roboto',
    'arial',
    'helvetica',
    'sf pro',
    'cantarell',
    'ubuntu',
    'noto sans',
    'calibri',
  ]
  return settingsStore.systemFonts
    .filter((f) => !f.is_monospace && commonUi.some((ui) => f.name.toLowerCase().includes(ui)))
    .filter((f) => !query || f.name.toLowerCase().includes(query))
})

const browserMonospaceFonts = computed(() => {
  const query = browserFontSearch.value.trim().toLowerCase()
  return settingsStore.systemFonts
    .filter((f) => f.is_monospace)
    .filter((f) => !query || f.name.toLowerCase().includes(query))
})

const browserOtherFonts = computed(() => {
  const query = browserFontSearch.value.trim().toLowerCase()
  const commonUi = [
    'inter',
    'segoe ui',
    'system-ui',
    'roboto',
    'arial',
    'helvetica',
    'sf pro',
    'cantarell',
    'ubuntu',
    'noto sans',
    'calibri',
  ]
  return settingsStore.systemFonts
    .filter((f) => !f.is_monospace && !commonUi.some((ui) => f.name.toLowerCase().includes(ui)))
    .filter((f) => !query || f.name.toLowerCase().includes(query))
})
</script>

<template>
  <div
    v-if="props.show"
    @click.self="emit('close')"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 select-none"
  >
    <div
      class="w-full max-w-4xl h-[680px] max-h-[92vh] rounded-2xl border shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100 transition-colors duration-150"
      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'color-mix(in srgb, var(--color-border) 65%, transparent)' }"
    >
      <!-- Header -->
      <div
        class="flex items-center justify-between px-6 py-4 border-b shrink-0 transition-colors duration-150"
        :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'color-mix(in srgb, var(--color-border) 60%, transparent)' }"
      >
        <div class="flex items-center space-x-2.5 select-none">
          <!-- <img :src="appIcon" alt="FlowSFTP" class="w-5 h-5 rounded-md object-contain shrink-0" /> -->
          <h3 class="text-sm font-semibold" :style="{ color: 'var(--color-text-main)' }">Settings</h3>
        </div>
        <button
          @click="emit('close')"
          class="btn-flat-ghost w-7 h-7 flex items-center justify-center rounded-lg cursor-pointer"
          title="Close"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <!-- Tabs Navigation -->
      <div
        class="flex border-b px-6 pt-2.5 space-x-4 text-xs font-medium overflow-x-auto no-scrollbar shrink-0 transition-colors duration-150"
        :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'color-mix(in srgb, var(--color-border) 60%, transparent)' }"
      >
        <button
          @click="activeTab = 'themes'"
          class="pb-2 border-b-2 transition-colors flex items-center space-x-1.5 shrink-0 cursor-pointer hover:text-[var(--color-text-main)]"
          :class="{ 'font-semibold': activeTab === 'themes' }"
          :style="activeTab === 'themes' ? { borderColor: 'color-mix(in srgb, var(--color-accent) 70%, var(--color-border))', color: 'var(--color-accent)' } : { borderColor: 'transparent', color: 'var(--color-text-muted)' }"
        >
          <Palette class="w-3.5 h-3.5" />
          <span>Themes & Colors</span>
        </button>
        <button
          @click="activeTab = 'appearance'"
          class="pb-2 border-b-2 transition-colors flex items-center space-x-1.5 shrink-0 cursor-pointer hover:text-[var(--color-text-main)]"
          :class="{ 'font-semibold': activeTab === 'appearance' }"
          :style="activeTab === 'appearance' ? { borderColor: 'color-mix(in srgb, var(--color-accent) 70%, var(--color-border))', color: 'var(--color-accent)' } : { borderColor: 'transparent', color: 'var(--color-text-muted)' }"
        >
          <Type class="w-3.5 h-3.5" />
          <span>Fonts & Sizing</span>
        </button>
        <button
          @click="activeTab = 'keymap'"
          class="pb-2 border-b-2 transition-colors flex items-center space-x-1.5 shrink-0 cursor-pointer hover:text-[var(--color-text-main)]"
          :class="{ 'font-semibold': activeTab === 'keymap' }"
          :style="activeTab === 'keymap' ? { borderColor: 'color-mix(in srgb, var(--color-accent) 70%, var(--color-border))', color: 'var(--color-accent)' } : { borderColor: 'transparent', color: 'var(--color-text-muted)' }"
        >
          <Keyboard class="w-3.5 h-3.5" />
          <span>Keymap & Shortcuts</span>
        </button>
        <button
          @click="activeTab = 'transfers'"
          class="pb-2 border-b-2 transition-colors flex items-center space-x-1.5 shrink-0 cursor-pointer hover:text-[var(--color-text-main)]"
          :class="{ 'font-semibold': activeTab === 'transfers' }"
          :style="activeTab === 'transfers' ? { borderColor: 'color-mix(in srgb, var(--color-accent) 70%, var(--color-border))', color: 'var(--color-accent)' } : { borderColor: 'transparent', color: 'var(--color-text-muted)' }"
        >
          <Zap class="w-3.5 h-3.5" />
          <span>Transfers</span>
        </button>
        <button
          @click="activeTab = 'security'"
          class="pb-2 border-b-2 transition-colors flex items-center space-x-1.5 shrink-0 cursor-pointer hover:text-[var(--color-text-main)]"
          :class="{ 'font-semibold': activeTab === 'security' }"
          :style="activeTab === 'security' ? { borderColor: 'color-mix(in srgb, var(--color-accent) 70%, var(--color-border))', color: 'var(--color-accent)' } : { borderColor: 'transparent', color: 'var(--color-text-muted)' }"
        >
          <Shield class="w-3.5 h-3.5" />
          <span>Password Vault</span>
        </button>
        <button
          @click="activeTab = 'protocols'"
          class="pb-2 border-b-2 transition-colors flex items-center space-x-1.5 shrink-0 cursor-pointer hover:text-[var(--color-text-main)]"
          :class="{ 'font-semibold': activeTab === 'protocols' }"
          :style="activeTab === 'protocols' ? { borderColor: 'color-mix(in srgb, var(--color-accent) 70%, var(--color-border))', color: 'var(--color-accent)' } : { borderColor: 'transparent', color: 'var(--color-text-muted)' }"
        >
          <Globe class="w-3.5 h-3.5" />
          <span>Protocols</span>
        </button>
        <button
          @click="activeTab = 'developer'"
          class="pb-2 border-b-2 transition-colors flex items-center space-x-1.5 shrink-0 cursor-pointer hover:text-[var(--color-text-main)]"
          :class="{ 'font-semibold': activeTab === 'developer' }"
          :style="activeTab === 'developer' ? { borderColor: 'color-mix(in srgb, var(--color-accent) 70%, var(--color-border))', color: 'var(--color-accent)' } : { borderColor: 'transparent', color: 'var(--color-text-muted)' }"
        >
          <Code2 class="w-3.5 h-3.5" />
          <span>Developer</span>
        </button>
        <button
          @click="activeTab = 'about'"
          class="pb-2 border-b-2 transition-colors flex items-center space-x-1.5 shrink-0 cursor-pointer hover:text-[var(--color-text-main)]"
          :class="{ 'font-semibold': activeTab === 'about' }"
          :style="activeTab === 'about' ? { borderColor: 'color-mix(in srgb, var(--color-accent) 70%, var(--color-border))', color: 'var(--color-accent)' } : { borderColor: 'transparent', color: 'var(--color-text-muted)' }"
        >
          <Info class="w-3.5 h-3.5" />
          <span>About</span>
          <span
            v-if="updaterStore.updateAvailable"
            class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"
            :title="`Update v${updaterStore.latestVersion} available`"
          />
        </button>
      </div>

      <!-- Tab Content Body -->
      <div class="p-6 overflow-y-auto space-y-5 text-xs flex-1" :style="{ color: 'var(--color-text-main)' }">
        <!-- 0. THEMES & COLORS TAB -->
        <div v-if="activeTab === 'themes'" class="space-y-4">
          <!-- Top Toolbar: Status, Import from JSON, Export JSON -->
          <div
            class="rounded-xl border p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition-colors duration-150"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
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
                class="px-2.5 py-1.5 rounded-lg border text-xs font-medium transition flex items-center space-x-1.5 cursor-pointer btn-theme-card"
                title="Select a JSON theme file from disk"
              >
                <Upload class="w-3.5 h-3.5" :style="{ color: 'var(--color-accent)' }" />
                <span>Load JSON File</span>
              </button>

              <button
                @click="showPasteModal = true"
                class="px-2.5 py-1.5 rounded-lg border text-xs font-medium transition flex items-center space-x-1.5 cursor-pointer btn-theme-card"
                title="Paste theme JSON text directly"
              >
                <FileCode class="w-3.5 h-3.5" :style="{ color: 'var(--color-text-muted)' }" />
                <span>Paste JSON</span>
              </button>

              <button
                @click="handleExportTheme(themeStore.currentTheme)"
                class="px-2.5 py-1.5 rounded-lg border text-xs font-medium transition flex items-center space-x-1.5 cursor-pointer btn-theme-card"
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
              class="p-3.5 rounded-xl border text-left cursor-pointer transition-all duration-150 flex flex-col justify-between group relative"
              :style="{
                backgroundColor: themeStore.currentThemeId === theme.id ? theme.ui.bgCard : theme.ui.bgApp,
                borderColor: themeStore.currentThemeId === theme.id
                  ? `color-mix(in srgb, ${theme.ui.accent} 42%, ${theme.ui.border})`
                  : `color-mix(in srgb, ${theme.ui.border} 55%, transparent)`,
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
                      :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)', color: 'var(--color-accent)' }"
                    >
                      Default
                    </span>
                    <span
                      v-else-if="theme.isCustom"
                      class="px-1.5 py-0.2 rounded text-[9px] font-mono uppercase tracking-wider font-semibold border shrink-0"
                      :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)', color: 'var(--color-accent-secondary)' }"
                    >
                      Custom JSON
                    </span>
                    <span
                      v-else
                      class="px-1.5 py-0.2 rounded text-[9px] font-mono uppercase tracking-wider font-semibold border shrink-0"
                      :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)', color: 'var(--color-text-muted)' }"
                    >
                      Preset
                    </span>
                    <span
                      v-if="isLightTheme(theme)"
                      class="px-1.5 py-0.2 rounded text-[9px] font-mono tracking-wider font-semibold border shrink-0"
                      :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)', color: theme.ui.accent }"
                    >
                      ☀️ Light
                    </span>
                  </div>

                  <div class="flex items-center space-x-1 shrink-0 ml-2">
                    <div
                      v-if="themeStore.currentThemeId === theme.id"
                      class="w-4 h-4 rounded-full flex items-center justify-center font-bold text-[10px]"
                      :style="{ backgroundColor: `color-mix(in srgb, ${theme.ui.accent} 20%, ${theme.ui.bgCard})`, color: theme.ui.accent }"
                    >
                      ✓
                    </div>

                    <!-- Custom theme delete action -->
                    <button
                      v-if="theme.isCustom"
                      @click.stop="themeStore.deleteCustomTheme(theme.id)"
                      class="btn-flat-ghost-danger p-1 rounded cursor-pointer"
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
              <div class="mt-3 pt-2.5 border-t flex items-center justify-between" :style="{ borderColor: `color-mix(in srgb, ${theme.ui.border} 55%, transparent)` }">
                <div class="flex items-center space-x-1.5">
                  <div
                    class="w-3.5 h-3.5 rounded-full border"
                    :style="{ backgroundColor: theme.ui.bgApp, borderColor: theme.ui.border }"
                    title="App Background"
                  />
                  <div
                    class="w-3.5 h-3.5 rounded-full border"
                    :style="{ backgroundColor: theme.ui.accent, borderColor: theme.ui.border }"
                    title="Primary Accent"
                  />
                  <div
                    class="w-3.5 h-3.5 rounded-full border"
                    :style="{ backgroundColor: theme.ui.accentSecondary, borderColor: theme.ui.border }"
                    title="Secondary Accent"
                  />
                  <div
                    class="w-3.5 h-3.5 rounded-full border"
                    :style="{ backgroundColor: theme.terminal.green, borderColor: theme.ui.border }"
                    title="Terminal Green"
                  />
                  <div
                    class="w-3.5 h-3.5 rounded-full border"
                    :style="{ backgroundColor: theme.terminal.yellow, borderColor: theme.ui.border }"
                    title="Terminal Yellow"
                  />
                  <div
                    class="w-3.5 h-3.5 rounded-full border"
                    :style="{ backgroundColor: theme.terminal.cyan, borderColor: theme.ui.border }"
                    title="Terminal Cyan"
                  />
                </div>

                <button
                  @click.stop="handleExportTheme(theme)"
                  class="btn-flat-ghost px-1.5 py-0.5 rounded text-[10px] flex items-center space-x-1 cursor-pointer"
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
                <span class="text-[10px] ml-1" :style="{ color: 'var(--color-text-muted)' }">flowsftp-shell — 80x24</span>
              </div>

              <div>
                <span :style="{ color: themeStore.currentTheme.terminal.green }">user@flowsftp</span>
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
                <span :style="{ color: themeStore.currentTheme.terminal.green }">user@flowsftp</span>
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



        <!-- 2. FONTS & APPEARANCE TAB -->
        <div v-if="activeTab === 'appearance'" class="space-y-4">
          <!-- Interface & Dialogs Font Size (Settings, Connection Manager, Menus & Descriptions) -->
          <div
            class="rounded-xl border p-4 space-y-3"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-2">
                <Type class="w-4 h-4" :style="{ color: 'var(--color-accent)' }" />
                <div>
                  <h4 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">
                    Interface & Dialogs Text Size
                  </h4>
                  <p class="text-[11px] mt-0.5" :style="{ color: 'var(--color-text-muted)' }">
                    Scales text across Settings, Connection Manager, buttons, labels, and helper descriptions.
                  </p>
                </div>
              </div>
              <button
                @click="settingsStore.resetUiFontDefaults()"
                class="btn-flat-ghost px-2 py-0.5 rounded text-[11px] flex items-center space-x-1 cursor-pointer shrink-0"
                title="Reset Interface Text Size to Default (13px)"
              >
                <RotateCcw class="w-3 h-3" />
                <span>Reset</span>
              </button>
            </div>

            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="block text-[11px] font-medium" :style="{ color: 'var(--color-text-muted)' }">
                  UI & Modal Text Scale
                </label>
                <span class="text-[11px] font-mono font-semibold" :style="{ color: 'var(--color-accent)' }">
                  {{ settingsStore.uiFontSize }}px ({{ Math.round((settingsStore.uiFontSize / 12) * 100) }}%)
                </span>
              </div>
              <div class="flex items-center space-x-2 pt-0.5">
                <input
                  type="range"
                  v-model.number="settingsStore.uiFontSize"
                  min="11"
                  max="18"
                  step="1"
                  class="flex-1 cursor-pointer"
                  :style="{ accentColor: 'var(--color-accent)' }"
                />
              </div>
            </div>
          </div>

          <!-- Terminal Font & Size Settings -->
          <div
            class="rounded-xl border p-4 space-y-3.5"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-2">
                <Terminal class="w-4 h-4" :style="{ color: 'var(--color-accent)' }" />
                <h4 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">SSH Terminal Font & Sizing</h4>
              </div>
              <button
                @click="settingsStore.resetTerminalDefaults()"
                class="btn-flat-ghost px-2 py-0.5 rounded text-[11px] flex items-center space-x-1 cursor-pointer"
                title="Reset Terminal Font Defaults"
              >
                <RotateCcw class="w-3 h-3" />
                <span>Reset</span>
              </button>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <!-- Terminal Font Family Selection -->
              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="block text-[11px] font-medium" :style="{ color: 'var(--color-text-muted)' }">
                    Font Family
                    <span v-if="settingsStore.systemFonts.length > 0" class="text-[10px] opacity-60 ml-1">
                      ({{ settingsStore.systemFonts.length }} available)
                    </span>
                  </label>
                  <button
                    type="button"
                    @click="isManualTerminalFont = !isManualTerminalFont"
                    class="text-[10px] underline opacity-70 hover:opacity-100 transition cursor-pointer"
                    :style="{ color: 'var(--color-text-muted)' }"
                  >
                    {{ isManualTerminalFont ? 'Choose from list' : 'Custom' }}
                  </button>
                </div>

                <!-- Custom manual font input mode -->
                <div v-if="isManualTerminalFont">
                  <input
                    v-model="settingsStore.terminalFontFamily"
                    type="text"
                    placeholder='e.g. "JetBrainsMono NF", monospace'
                    class="w-full px-3 py-1.5 rounded-lg border text-xs font-mono input-theme"
                  />
                </div>

                <!-- Dropdown mode with live search -->
                <div v-else class="space-y-1">
                  <!-- Search Filter -->
                  <div v-if="settingsStore.systemFonts.length > 15" class="relative">
                    <Search class="w-3 h-3 absolute left-2.5 top-2 opacity-40 pointer-events-none" :style="{ color: 'var(--color-text-muted)' }" />
                    <input
                      v-model="terminalFontSearch"
                      type="text"
                      placeholder="Search installed fonts..."
                      class="w-full pl-7 pr-6 py-1 rounded-md border text-[11px] input-theme"
                    />
                    <button
                      v-if="terminalFontSearch"
                      type="button"
                      @click="terminalFontSearch = ''"
                      class="absolute right-2 top-1.5 text-[10px] opacity-40 hover:opacity-100"
                      :style="{ color: 'var(--color-text-muted)' }"
                    >
                      <X class="w-2.5 h-2.5" />
                    </button>
                  </div>

                  <select
                    v-model="selectedTerminalFontName"
                    class="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none cursor-pointer input-theme"
                  >
                    <!-- Current custom selection if not matched -->
                    <option v-if="!isCurrentTerminalFontInList && selectedTerminalFontName" :value="selectedTerminalFontName">
                      Current: {{ selectedTerminalFontName }}
                    </option>

                    <!-- Fallback default list if system fonts haven't loaded yet -->
                    <template v-if="settingsStore.systemFonts.length === 0">
                      <option
                        v-for="font in TERMINAL_FONTS"
                        :key="font.value"
                        :value="extractBaseFontName(font.value)"
                      >
                        {{ font.label }}
                      </option>
                    </template>

                    <!-- Monospace & Coding System Fonts -->
                    <optgroup
                      v-if="terminalMonospaceFonts.length > 0"
                      :label="`Monospace & Coding Fonts (${terminalMonospaceFonts.length})`"
                    >
                      <option
                        v-for="font in terminalMonospaceFonts"
                        :key="font.name"
                        :value="font.name"
                      >
                        {{ font.name }}
                      </option>
                    </optgroup>

                    <!-- All Other System Fonts -->
                    <optgroup
                      v-if="terminalOtherFonts.length > 0"
                      :label="`All Other System Fonts (${terminalOtherFonts.length})`"
                    >
                      <option
                        v-for="font in terminalOtherFonts"
                        :key="font.name"
                        :value="font.name"
                      >
                        {{ font.name }}
                      </option>
                    </optgroup>
                  </select>
                </div>
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
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-2">
                <FolderSync class="w-4 h-4" :style="{ color: 'var(--color-accent-secondary)' }" />
                <h4 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">File Browser (FTP Preview) Font & Density</h4>
              </div>
              <button
                @click="settingsStore.resetBrowserDefaults()"
                class="btn-flat-ghost px-2 py-0.5 rounded text-[11px] flex items-center space-x-1 cursor-pointer"
                title="Reset File Browser Font Defaults"
              >
                <RotateCcw class="w-3 h-3" />
                <span>Reset</span>
              </button>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <!-- Browser Font Family Selection -->
              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="block text-[11px] font-medium" :style="{ color: 'var(--color-text-muted)' }">
                    Font Family
                    <span v-if="settingsStore.systemFonts.length > 0" class="text-[10px] opacity-60 ml-1">
                      ({{ settingsStore.systemFonts.length }} available)
                    </span>
                  </label>
                  <button
                    type="button"
                    @click="isManualBrowserFont = !isManualBrowserFont"
                    class="text-[10px] underline opacity-70 hover:opacity-100 transition cursor-pointer"
                    :style="{ color: 'var(--color-text-muted)' }"
                  >
                    {{ isManualBrowserFont ? 'Choose from list' : 'Custom' }}
                  </button>
                </div>

                <!-- Custom manual font input mode -->
                <div v-if="isManualBrowserFont">
                  <input
                    v-model="settingsStore.browserFontFamily"
                    type="text"
                    placeholder='e.g. "Segoe UI", sans-serif'
                    class="w-full px-3 py-1.5 rounded-lg border text-xs font-mono input-theme"
                  />
                </div>

                <!-- Dropdown mode with live search -->
                <div v-else class="space-y-1">
                  <!-- Search Filter -->
                  <div v-if="settingsStore.systemFonts.length > 15" class="relative">
                    <Search class="w-3 h-3 absolute left-2.5 top-2 opacity-40 pointer-events-none" :style="{ color: 'var(--color-text-muted)' }" />
                    <input
                      v-model="browserFontSearch"
                      type="text"
                      placeholder="Search installed fonts..."
                      class="w-full pl-7 pr-6 py-1 rounded-md border text-[11px] input-theme"
                    />
                    <button
                      v-if="browserFontSearch"
                      type="button"
                      @click="browserFontSearch = ''"
                      class="absolute right-2 top-1.5 text-[10px] opacity-40 hover:opacity-100"
                      :style="{ color: 'var(--color-text-muted)' }"
                    >
                      <X class="w-2.5 h-2.5" />
                    </button>
                  </div>

                  <select
                    v-model="selectedBrowserFontName"
                    class="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none cursor-pointer input-theme"
                  >
                    <!-- Current custom selection if not matched -->
                    <option v-if="!isCurrentBrowserFontInList && selectedBrowserFontName" :value="selectedBrowserFontName">
                      Current: {{ selectedBrowserFontName }}
                    </option>

                    <!-- Fallback default list if system fonts haven't loaded yet -->
                    <template v-if="settingsStore.systemFonts.length === 0">
                      <option
                        v-for="font in BROWSER_FONTS"
                        :key="font.value"
                        :value="extractBaseFontName(font.value)"
                      >
                        {{ font.label }}
                      </option>
                    </template>

                    <!-- UI & Clean Fonts -->
                    <optgroup
                      v-if="browserUiFonts.length > 0"
                      :label="`Recommended UI Fonts (${browserUiFonts.length})`"
                    >
                      <option
                        v-for="font in browserUiFonts"
                        :key="font.name"
                        :value="font.name"
                      >
                        {{ font.name }}
                      </option>
                    </optgroup>

                    <!-- Monospace Fonts -->
                    <optgroup
                      v-if="browserMonospaceFonts.length > 0"
                      :label="`Monospace Fonts (${browserMonospaceFonts.length})`"
                    >
                      <option
                        v-for="font in browserMonospaceFonts"
                        :key="font.name"
                        :value="font.name"
                      >
                        {{ font.name }}
                      </option>
                    </optgroup>

                    <!-- All Other System Fonts -->
                    <optgroup
                      v-if="browserOtherFonts.length > 0"
                      :label="`All Other Fonts (${browserOtherFonts.length})`"
                    >
                      <option
                        v-for="font in browserOtherFonts"
                        :key="font.name"
                        :value="font.name"
                      >
                        {{ font.name }}
                      </option>
                    </optgroup>
                  </select>
                </div>
              </div>

              <!-- Browser Font Size Slider -->
              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="block text-[11px] font-medium" :style="{ color: 'var(--color-text-muted)' }">Font Size</label>
                  <span class="text-[11px] font-mono font-semibold" :style="{ color: 'var(--color-accent)' }">{{ settingsStore.browserFontSize }}px</span>
                </div>
                <div class="flex items-center space-x-2 pt-0.5">
                  <input
                    type="range"
                    v-model.number="settingsStore.browserFontSize"
                    min="10"
                    max="20"
                    step="1"
                    class="flex-1 cursor-pointer"
                    :style="{ accentColor: 'var(--color-accent)' }"
                  />
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
                  class="btn-flat-choice py-1.5 text-xs rounded-lg font-medium text-center cursor-pointer"
                  :class="{ 'btn-flat-choice--active font-semibold': settingsStore.browserRowDensity === 'compact' }"
                >
                  Compact
                </button>
                <button
                  type="button"
                  @click="settingsStore.browserRowDensity = 'normal'"
                  class="btn-flat-choice py-1.5 text-xs rounded-lg font-medium text-center cursor-pointer"
                  :class="{ 'btn-flat-choice--active font-semibold': settingsStore.browserRowDensity === 'normal' }"
                >
                  Normal
                </button>
                <button
                  type="button"
                  @click="settingsStore.browserRowDensity = 'relaxed'"
                  class="btn-flat-choice py-1.5 text-xs rounded-lg font-medium text-center cursor-pointer"
                  :class="{ 'btn-flat-choice--active font-semibold': settingsStore.browserRowDensity === 'relaxed' }"
                >
                  Relaxed
                </button>
              </div>
            </div>

            <!-- Live Browser Font Preview Box -->
            <div
              class="mt-2 p-3 rounded-lg border"
              :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
            >
              <div class="text-[10px] uppercase font-mono tracking-wider mb-1.5" :style="{ color: 'var(--color-text-muted)' }">Live File Preview</div>
              <div
                class="rounded border overflow-hidden transition-all duration-150"
                :style="{
                  backgroundColor: 'var(--color-bg-pane)',
                  borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)',
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
                    <FileIcon name="public_html" :is-dir="true" :size="Math.max(13, Math.round(settingsStore.browserFontSize * 1.2))" />
                    <span class="font-medium truncate" :style="{ color: 'var(--color-text-main)' }">public_html</span>
                  </span>
                  <span class="text-[0.92em]" :style="{ color: 'var(--color-text-muted)' }">Folder</span>
                  <span class="font-mono text-[0.92em]" :style="{ color: 'var(--color-text-muted)' }">-</span>
                </div>
                <div
                  :class="[
                    'flex items-center justify-between',
                    settingsStore.browserRowDensity === 'compact' ? 'py-0 px-2' : settingsStore.browserRowDensity === 'relaxed' ? 'py-1 px-2.5' : 'py-0.5 px-2'
                  ]"
                >
                  <span class="flex items-center space-x-1.5 leading-none">
                    <FileIcon name="config.production.json" :is-dir="false" :size="Math.max(13, Math.round(settingsStore.browserFontSize * 1.2))" />
                    <span :style="{ color: 'var(--color-text-main)' }">config.production.json</span>
                  </span>
                  <span class="text-[0.92em]" :style="{ color: 'var(--color-text-muted)' }">JSON</span>
                  <span class="font-mono text-[0.92em]" :style="{ color: 'var(--color-text-muted)' }">4.2 KB</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Code Editor (CodeMirror 6) Settings -->
          <div
            class="rounded-xl border p-4 space-y-3.5"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
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
                class="px-3 py-1.5 rounded-lg border text-xs font-mono font-medium flex items-center space-x-1.5 transition cursor-pointer"
                :class="settingsStore.editorVimMode ? 'btn-success' : 'btn-flat-choice'"
              >
                <span>{{ settingsStore.editorVimMode ? 'Vim Enabled' : 'Standard Mode' }}</span>
                <span class="w-2 h-2 rounded-full" :class="settingsStore.editorVimMode ? 'bg-emerald-400' : 'bg-zinc-500'" />
              </button>
            </div>

            <!-- Editor Font Size -->
            <div class="pt-2 border-t" :style="{ borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }">
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
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
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
                class="btn-flat-ghost px-2 py-0.5 rounded text-[11px] flex items-center space-x-1 shrink-0 cursor-pointer"
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
                class="btn-flat-choice p-2.5 rounded-lg text-left flex flex-col justify-between cursor-pointer"
                :class="{ 'btn-flat-choice--active': currentPresetId === preset.id }"
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
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
          >
            <div class="flex items-center space-x-2">
              <div
                class="w-5 h-5 rounded-md border flex items-center justify-center"
                :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)', color: 'var(--color-accent)' }"
              >
                <Layers class="w-3.5 h-3.5" />
              </div>
              <div>
                <h4 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">Connection Tabs Navigation</h4>
                <p class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">Switch rapidly between active SSH and FTP connection tabs.</p>
              </div>
            </div>

            <div class="divide-y pt-1" :style="{ borderColor: 'color-mix(in srgb, var(--color-border) 50%, transparent)' }">
              <div
                v-for="action in connectionActions"
                :key="action.id"
                class="py-2.5 flex items-center justify-between gap-3"
                :style="{ borderColor: 'color-mix(in srgb, var(--color-border) 50%, transparent)' }"
              >
                <div class="min-w-0 flex-1">
                  <div class="font-medium text-xs" :style="{ color: 'var(--color-text-main)' }">{{ action.title }}</div>
                  <div class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">{{ action.description }}</div>
                </div>

                <div class="flex items-center space-x-2 shrink-0">
                  <!-- Recording State -->
                  <div v-if="recordingAction === action.id" class="flex items-center space-x-2">
                    <span class="px-2.5 py-1 rounded-md bg-amber-950/80 border border-amber-600/50 text-amber-300 font-mono text-xs animate-pulse flex items-center space-x-1.5">
                      <span class="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                      <span>{{ recordingPreview || 'Press keys...' }}</span>
                    </span>
                    <button
                      @click="stopRecording"
                      class="px-2 py-1 text-[11px] rounded border transition cursor-pointer btn-theme-card"
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
                          class="px-2 py-0.5 text-xs rounded border font-semibold"
                          :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)', color: 'var(--color-accent)' }"
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
                      class="px-2 py-1 text-[11px] font-medium rounded border transition flex items-center space-x-1 cursor-pointer btn-theme-card"
                      title="Record new shortcut"
                    >
                      <Edit2 class="w-3 h-3" />
                      <span>Edit</span>
                    </button>

                    <button
                      v-if="settingsStore.keymaps[action.id] !== action.defaultShortcut"
                      @click="settingsStore.resetKeymapAction(action.id)"
                      class="btn-flat-ghost p-1 rounded cursor-pointer"
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
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
          >
            <div class="flex items-center space-x-2">
              <div
                class="w-5 h-5 rounded-md border flex items-center justify-center"
                :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)', color: 'var(--color-accent-secondary)' }"
              >
                <ArrowLeftRight class="w-3.5 h-3.5" />
              </div>
              <div>
                <h4 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">Terminal & Files View Switching</h4>
                <p class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">Switch between interactive terminal shell and dual-pane SFTP/FTP file browser.</p>
              </div>
            </div>

            <div class="divide-y pt-1" :style="{ borderColor: 'color-mix(in srgb, var(--color-border) 50%, transparent)' }">
              <div
                v-for="action in viewActions"
                :key="action.id"
                class="py-2.5 flex items-center justify-between gap-3"
                :style="{ borderColor: 'color-mix(in srgb, var(--color-border) 50%, transparent)' }"
              >
                <div class="min-w-0 flex-1">
                  <div class="font-medium text-xs" :style="{ color: 'var(--color-text-main)' }">{{ action.title }}</div>
                  <div class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">{{ action.description }}</div>
                </div>

                <div class="flex items-center space-x-2 shrink-0">
                  <!-- Recording State -->
                  <div v-if="recordingAction === action.id" class="flex items-center space-x-2">
                    <span class="px-2.5 py-1 rounded-md bg-amber-950/80 border border-amber-600/50 text-amber-300 font-mono text-xs animate-pulse flex items-center space-x-1.5">
                      <span class="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                      <span>{{ recordingPreview || 'Press keys...' }}</span>
                    </span>
                    <button
                      @click="stopRecording"
                      class="px-2 py-1 text-[11px] rounded border transition cursor-pointer btn-theme-card"
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
                          class="px-2 py-0.5 text-xs rounded border font-semibold"
                          :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)', color: 'var(--color-accent)' }"
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
                      class="px-2 py-1 text-[11px] font-medium rounded border transition flex items-center space-x-1 cursor-pointer btn-theme-card"
                      title="Record new shortcut"
                    >
                      <Edit2 class="w-3 h-3" />
                      <span>Edit</span>
                    </button>

                    <button
                      v-if="settingsStore.keymaps[action.id] !== action.defaultShortcut"
                      @click="settingsStore.resetKeymapAction(action.id)"
                      class="btn-flat-ghost p-1 rounded cursor-pointer"
                      title="Reset to default"
                    >
                      <RotateCcw class="w-3 h-3" />
                    </button>
                  </template>
                </div>
              </div>
            </div>
          </div>

          <!-- Dual-Pane File Manager Navigation & Operations -->
          <div
            class="rounded-xl border p-4 space-y-3"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
          >
            <div class="flex items-center space-x-2">
              <div
                class="w-5 h-5 rounded-md border flex items-center justify-center"
                :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)', color: 'var(--color-accent)' }"
              >
                <FolderSync class="w-3.5 h-3.5" />
              </div>
              <div>
                <h4 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">Dual-Pane File Manager &amp; Navigation</h4>
                <p class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">Switch active pane with Tab, refresh (F5), transfer items (Alt+F5/F6), create folders (F7), delete (F8), and navigate folder history.</p>
              </div>
            </div>

            <div class="divide-y pt-1" :style="{ borderColor: 'color-mix(in srgb, var(--color-border) 50%, transparent)' }">
              <div
                v-for="action in fileManagerActions"
                :key="action.id"
                class="py-2.5 flex items-center justify-between gap-3"
                :style="{ borderColor: 'color-mix(in srgb, var(--color-border) 50%, transparent)' }"
              >
                <div class="min-w-0 flex-1">
                  <div class="font-medium text-xs" :style="{ color: 'var(--color-text-main)' }">{{ action.title }}</div>
                  <div class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">{{ action.description }}</div>
                </div>

                <div class="flex items-center space-x-2 shrink-0">
                  <!-- Recording State -->
                  <div v-if="recordingAction === action.id" class="flex items-center space-x-2">
                    <span class="px-2.5 py-1 rounded-md bg-amber-950/80 border border-amber-600/50 text-amber-300 font-mono text-xs animate-pulse flex items-center space-x-1.5">
                      <span class="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                      <span>{{ recordingPreview || 'Press keys...' }}</span>
                    </span>
                    <button
                      @click="stopRecording"
                      class="px-2 py-1 text-[11px] rounded border transition cursor-pointer btn-theme-card"
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
                          class="px-2 py-0.5 text-xs rounded border font-semibold"
                          :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)', color: 'var(--color-accent)' }"
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
                      class="px-2 py-1 text-[11px] font-medium rounded border transition flex items-center space-x-1 cursor-pointer btn-theme-card"
                      title="Record new shortcut"
                    >
                      <Edit2 class="w-3 h-3" />
                      <span>Edit</span>
                    </button>

                    <button
                      v-if="settingsStore.keymaps[action.id] !== action.defaultShortcut"
                      @click="settingsStore.resetKeymapAction(action.id)"
                      class="btn-flat-ghost p-1 rounded cursor-pointer"
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

        <!-- 3. TRANSFERS & INTELLIGENT IGNORE FILTER TAB -->
        <div v-if="activeTab === 'transfers'" class="space-y-5">
          <!-- Top Card: Transfer Queue & Concurrency Controls -->
          <div
            class="rounded-xl border p-4 space-y-4 transition-colors"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
          >
            <div class="flex items-center space-x-2">
              <div
                class="w-6 h-6 rounded-lg border flex items-center justify-center"
                :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)', color: 'var(--color-accent)' }"
              >
                <Zap class="w-3.5 h-3.5" />
              </div>
              <div>
                <h4 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">Queue Concurrency &amp; Conflict Policy</h4>
                <p class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">Manage parallel connections, transfer throughput, and collision behavior.</p>
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <!-- Concurrency Slider -->
              <div
                class="p-3 rounded-lg border space-y-2"
                :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
              >
                <div class="flex items-center justify-between">
                  <span class="text-xs font-medium" :style="{ color: 'var(--color-text-main)' }">Simultaneous Transfers</span>
                  <span
                    class="px-2 py-0.5 rounded text-xs font-mono font-semibold border"
                    :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)', color: 'var(--color-accent)' }"
                  >
                    {{ sftpStore.maxSimultaneousTransfers }} connection{{ sftpStore.maxSimultaneousTransfers > 1 ? 's' : '' }}
                  </span>
                </div>
                <input
                  v-model.number="sftpStore.maxSimultaneousTransfers"
                  type="range"
                  min="1"
                  max="10"
                  step="1"
                  class="w-full accent-[var(--color-accent)] cursor-pointer"
                />
                <div class="flex justify-between text-[10px]" :style="{ color: 'var(--color-text-muted)' }">
                  <span>1 (Sequential)</span>
                  <span>5 (Balanced)</span>
                  <span>10 (High Bandwidth)</span>
                </div>
              </div>

              <!-- Conflict Resolution Policy -->
              <div
                class="p-3 rounded-lg border space-y-2"
                :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
              >
                <span class="text-xs font-medium block" :style="{ color: 'var(--color-text-main)' }">Default File Conflict Action</span>
                <select
                  v-model="sftpStore.conflictPolicy"
                  class="w-full px-2.5 py-1.5 rounded-lg border text-xs focus:outline-none input-theme font-medium cursor-pointer"
                >
                  <option value="ask">Ask / Prompt Dialog (Compare size &amp; date)</option>
                  <option value="overwrite">Overwrite Destination File</option>
                  <option value="skip">Skip Transfer (Leave destination untouched)</option>
                </select>
                <p class="text-[10px]" :style="{ color: 'var(--color-text-muted)' }">
                  Triggered when an uploading or downloading file already exists at the destination.
                </p>
              </div>
            </div>

            <!-- Auto-remove completed toggle -->
            <div
              class="flex items-center justify-between pt-2 border-t"
              :style="{ borderColor: 'color-mix(in srgb, var(--color-border) 50%, transparent)' }"
            >
              <div>
                <span class="text-xs font-medium block" :style="{ color: 'var(--color-text-main)' }">Auto-remove Successful Transfers from Queue</span>
                <span class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">Clean up completed items automatically from the transfer queue drawer.</span>
              </div>
              <button
                type="button"
                @click="sftpStore.autoRemoveSuccessful = !sftpStore.autoRemoveSuccessful"
                class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border transition-colors duration-200 ease-in-out focus:outline-none"
                :style="sftpStore.autoRemoveSuccessful
                  ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 45%, var(--color-bg-card))', borderColor: 'color-mix(in srgb, var(--color-accent) 55%, var(--color-border))' }
                  : { backgroundColor: 'var(--color-bg-card)', borderColor: 'color-mix(in srgb, var(--color-border) 65%, transparent)' }"
              >
                <span
                  class="pointer-events-none inline-block h-3.5 w-3.5 mt-[2px] ml-[2px] transform rounded-full transition duration-200 ease-in-out"
                  :style="{ backgroundColor: sftpStore.autoRemoveSuccessful ? 'var(--color-text-main)' : 'var(--color-text-muted)' }"
                  :class="sftpStore.autoRemoveSuccessful ? 'translate-x-4' : 'translate-x-0'"
                />
              </button>
            </div>
          </div>

          <!-- Bottom Card: Intelligent Ignore Filter (Upload & Download) -->
          <div
            class="rounded-xl border p-4 space-y-4 transition-colors"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
          >
            <!-- Card Header with Master Toggle -->
            <div class="flex items-start justify-between gap-4">
              <div class="flex items-start space-x-2.5">
                <div
                  class="w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 mt-0.5"
                  :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)', color: 'var(--color-accent)' }"
                >
                  <Filter class="w-3.5 h-3.5" />
                </div>
                <div>
                  <div class="flex items-center space-x-2">
                    <h4 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">
                      Intelligent Ignore Filtering (Upload &amp; Download)
                    </h4>
                    <span
                      class="px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold uppercase tracking-wider"
                      :style="settingsStore.enableTransferIgnoreFilter
                        ? { backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.25)' }
                        : { backgroundColor: 'var(--color-bg-card)', color: 'var(--color-text-muted)', border: '1px solid color-mix(in srgb, var(--color-border) 55%, transparent)' }"
                    >
                      {{ settingsStore.enableTransferIgnoreFilter ? 'Active' : 'Disabled' }}
                    </span>
                  </div>
                  <p class="text-[11px] mt-0.5 leading-relaxed" :style="{ color: 'var(--color-text-muted)' }">
                    Automatically skip bulky build directories, dependencies, and temporary files when uploading, downloading, or recursively crawling folders. You can add any custom folder names or glob patterns.
                  </p>
                </div>
              </div>

              <!-- Master Toggle Switch -->
              <div class="shrink-0 flex items-center space-x-2">
                <button
                  type="button"
                  @click="settingsStore.enableTransferIgnoreFilter = !settingsStore.enableTransferIgnoreFilter"
                  class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border transition-colors duration-200 ease-in-out focus:outline-none"
                  :style="settingsStore.enableTransferIgnoreFilter
                    ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 45%, var(--color-bg-card))', borderColor: 'color-mix(in srgb, var(--color-accent) 55%, var(--color-border))' }
                    : { backgroundColor: 'var(--color-bg-card)', borderColor: 'color-mix(in srgb, var(--color-border) 65%, transparent)' }"
                >
                  <span
                    class="pointer-events-none inline-block h-3.5 w-3.5 mt-[2px] ml-[2px] transform rounded-full transition duration-200 ease-in-out"
                    :style="{ backgroundColor: settingsStore.enableTransferIgnoreFilter ? 'var(--color-text-main)' : 'var(--color-text-muted)' }"
                    :class="settingsStore.enableTransferIgnoreFilter ? 'translate-x-4' : 'translate-x-0'"
                  />
                </button>
              </div>
            </div>

            <!-- Ignore Rules Content (Shown when filter is enabled) -->
            <div v-if="settingsStore.enableTransferIgnoreFilter" class="space-y-3.5 pt-1">
              <!-- Add Rule Form -->
              <div class="space-y-1.5">
                <label class="text-[11px] font-medium block" :style="{ color: 'var(--color-text-main)' }">
                  Add Folder to Ignore or Wildcard Pattern:
                </label>
                <div class="flex items-center space-x-2">
                  <div class="relative flex-1">
                    <input
                      v-model="newIgnorePatternInput"
                      type="text"
                      placeholder="e.g. vendor, __pycache__, .env.*, custom-cache, *.bak"
                      @keydown.enter.prevent="handleAddIgnorePattern"
                      class="w-full pl-8 pr-3 py-1.5 rounded-lg border font-mono text-xs focus:outline-none input-theme"
                    />
                    <Folder class="w-3.5 h-3.5 absolute left-2.5 top-2.5 opacity-40 pointer-events-none" />
                  </div>
                  <button
                    type="button"
                    @click="handleAddIgnorePattern"
                    :disabled="!newIgnorePatternInput.trim()"
                    class="px-3 py-1.5 rounded-lg font-medium text-xs transition flex items-center space-x-1.5 cursor-pointer btn-accent disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  >
                    <Plus class="w-3.5 h-3.5" />
                    <span>Add Pattern</span>
                  </button>
                </div>
                <!-- Inline Error Toast -->
                <p v-if="ignorePatternError" class="text-[11px] text-amber-400 mt-1 flex items-center space-x-1">
                  <AlertTriangle class="w-3 h-3 shrink-0" />
                  <span>{{ ignorePatternError }}</span>
                </p>
              </div>

              <!-- Active Ignore Rules Badges Grid -->
              <div class="space-y-1.5">
                <div class="flex items-center justify-between text-[11px]">
                  <span class="font-medium" :style="{ color: 'var(--color-text-main)' }">
                    Active Ignore Patterns ({{ settingsStore.transferIgnorePatterns.length }}):
                  </span>
                  <button
                    type="button"
                    @click="settingsStore.resetIgnorePatterns()"
                    class="btn-flat-ghost px-2 py-0.5 rounded text-[10px] flex items-center space-x-1 cursor-pointer"
                    title="Restore default ignore rules"
                  >
                    <RotateCcw class="w-3 h-3" />
                    <span>Reset to Defaults</span>
                  </button>
                </div>

                <div
                  class="p-2.5 rounded-lg border min-h-[70px] max-h-[160px] overflow-y-auto flex flex-wrap gap-1.5 items-start"
                  :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
                >
                  <span
                    v-for="pat in settingsStore.transferIgnorePatterns"
                    :key="pat"
                    class="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md font-mono text-[11px] border transition group hover:border-red-400/40"
                    :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)', color: 'var(--color-text-main)' }"
                  >
                    <Folder v-if="!pat.includes('*')" class="w-3 h-3 opacity-50 shrink-0" />
                    <FileCode v-else class="w-3 h-3 opacity-50 shrink-0" />
                    <span class="font-semibold">{{ pat }}</span>
                    <button
                      type="button"
                      @click="settingsStore.removeIgnorePattern(pat)"
                      class="ml-0.5 p-0.5 rounded hover:bg-red-500/15 hover:text-red-400 opacity-60 hover:opacity-100 transition cursor-pointer"
                      title="Remove this ignore rule"
                    >
                      <X class="w-3 h-3" />
                    </button>
                  </span>
                </div>
              </div>

              <!-- Quick Suggestion Presets -->
              <div class="space-y-1.5 pt-1">
                <span class="text-[10px] font-medium uppercase tracking-wider block" :style="{ color: 'var(--color-text-muted)' }">
                  Quick Add Common Presets:
                </span>
                <div class="flex flex-wrap gap-1.5">
                  <button
                    v-for="preset in COMMON_IGNORE_PRESETS.filter((p) => !settingsStore.transferIgnorePatterns.some((cur) => cur.toLowerCase() === p.toLowerCase()))"
                    :key="preset"
                    type="button"
                    @click="settingsStore.addIgnorePattern(preset)"
                    class="px-2 py-0.5 rounded border text-[10px] font-mono transition flex items-center space-x-1 cursor-pointer btn-theme-card"
                    :title="`Add ${preset} to ignore patterns`"
                  >
                    <Plus class="w-2.5 h-2.5 opacity-60" />
                    <span>{{ preset }}</span>
                  </button>
                  <span
                    v-if="COMMON_IGNORE_PRESETS.every((p) => settingsStore.transferIgnorePatterns.some((cur) => cur.toLowerCase() === p.toLowerCase()))"
                    class="text-[10px] italic opacity-50"
                    :style="{ color: 'var(--color-text-muted)' }"
                  >
                    All common presets are currently active.
                  </span>
                </div>
              </div>
            </div>

            <!-- Disabled Warning State -->
            <div
              v-else
              class="p-3 rounded-lg border text-xs flex items-center space-x-2.5"
              :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)', color: 'var(--color-text-muted)' }"
            >
              <AlertTriangle class="w-4 h-4 text-amber-500 shrink-0" />
              <span>
                Ignore filtering is disabled. All files and subdirectories (including <code class="font-mono text-amber-400">node_modules</code> and <code class="font-mono text-amber-400">.git</code>) will be uploaded and downloaded.
              </span>
            </div>
          </div>
        </div>

        <!-- 4. SECURITY & MASTER PASSWORD TAB -->
        <div v-if="activeTab === 'security'" class="space-y-4">
          <div
            class="rounded-xl border p-4 space-y-3"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
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
                :style="{ backgroundColor: 'var(--color-bg-card)', color: 'var(--color-text-muted)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
              >
                Not Configured
              </span>
              <span
                v-else-if="vaultStore.isUnlocked"
                class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950/50 text-emerald-300 border border-emerald-700/40 flex items-center space-x-1"
              >
                <Unlock class="w-3 h-3 text-emerald-400" />
                <span>Unlocked</span>
              </span>
              <span
                v-else
                class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-950/50 text-amber-300 border border-amber-700/40 flex items-center space-x-1"
              >
                <Lock class="w-3 h-3 text-amber-400" />
                <span>Locked</span>
              </span>
            </div>

            <!-- Actions -->
            <div class="pt-2 border-t flex items-center space-x-2" :style="{ borderColor: 'color-mix(in srgb, var(--color-border) 50%, transparent)' }">
              <template v-if="!vaultStore.isInitialized">
                <button
                  @click="handleSetupMasterPassword"
                  class="px-3 py-1.5 rounded-lg font-medium text-xs transition flex items-center space-x-1.5 cursor-pointer btn-accent"
                >
                  <KeyRound class="w-3.5 h-3.5" />
                  <span>Set Up Master Password</span>
                </button>
              </template>
              <template v-else>
                <button
                  v-if="vaultStore.isUnlocked"
                  @click="handleLockVault"
                  class="px-3 py-1.5 rounded-lg border font-medium text-xs transition flex items-center space-x-1.5 cursor-pointer btn-theme-card"
                >
                  <Lock class="w-3.5 h-3.5" />
                  <span>Lock Vault Now</span>
                </button>
                <button
                  v-else
                  @click="handleUnlockVault"
                  class="px-3 py-1.5 rounded-lg font-medium text-xs transition flex items-center space-x-1.5 cursor-pointer btn-accent"
                >
                  <Unlock class="w-3.5 h-3.5" />
                  <span>Unlock Vault</span>
                </button>

                <button
                  @click="handleChangeMasterPassword"
                  class="px-3 py-1.5 rounded-lg border font-medium text-xs transition flex items-center space-x-1.5 cursor-pointer btn-theme-card"
                >
                  <KeyRound class="w-3.5 h-3.5" />
                  <span>Change Master Password</span>
                </button>

                <button
                  @click="showResetVaultConfirm = true"
                  class="px-3 py-1.5 rounded-lg border font-medium text-xs transition flex items-center space-x-1.5 cursor-pointer btn-danger"
                  title="Clear encrypted vault if master password is forgotten"
                >
                  <Trash2 class="w-3.5 h-3.5" />
                  <span>Reset Vault</span>
                </button>
              </template>
            </div>

            <!-- Inline reset confirmation -->
            <div
              v-if="showResetVaultConfirm"
              class="p-3 rounded-lg bg-red-950/25 border border-red-900/40 text-xs space-y-2 mt-2"
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
                  class="px-2.5 py-1 rounded text-[11px] border cursor-pointer btn-theme-card"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  @click="handleResetVault"
                  class="px-2.5 py-1 rounded text-[11px] font-medium cursor-pointer btn-danger"
                >
                  Confirm Reset
                </button>
              </div>
            </div>
          </div>

          <!-- Encrypted Backup & Migration Card -->
          <div
            class="rounded-xl border p-4 space-y-3"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
          >
            <div class="flex items-start justify-between gap-3">
              <div>
                <h4 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">Encrypted Profile &amp; Vault Backup</h4>
                <p class="text-[11px] mt-0.5 leading-relaxed" :style="{ color: 'var(--color-text-muted)' }">
                  Export or restore saved servers, folders, vault passwords, and bookmarks in a single <span class="font-mono" :style="{ color: 'var(--color-accent)' }">AES-256-GCM</span> encrypted file.
                </p>
              </div>
            </div>

            <div class="pt-2 border-t flex flex-wrap items-center gap-2" :style="{ borderColor: 'color-mix(in srgb, var(--color-border) 50%, transparent)' }">
              <button
                type="button"
                @click="openExportBackupPanel"
                :disabled="isProcessingBackup"
                class="px-3 py-1.5 rounded-lg font-medium text-xs transition flex items-center space-x-1.5 cursor-pointer btn-accent"
              >
                <Download class="w-3.5 h-3.5" />
                <span>Export Encrypted Backup</span>
              </button>

              <button
                type="button"
                @click="handlePickBackupFileForImport"
                :disabled="isProcessingBackup"
                class="px-3 py-1.5 rounded-lg border font-medium text-xs transition flex items-center space-x-1.5 cursor-pointer btn-theme-card"
              >
                <Upload class="w-3.5 h-3.5" />
                <span>Import Backup...</span>
              </button>
            </div>

            <!-- Inline Export Form -->
            <form
              v-if="backupPanelMode === 'export'"
              @submit.prevent="handleExecuteExportBackup"
              class="p-3 rounded-xl border space-y-2.5 text-xs"
              :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
            >
              <div class="font-medium text-xs" :style="{ color: 'var(--color-text-main)' }">
                Choose a password to encrypt this backup file
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <input
                  v-model="backupPassword"
                  type="password"
                  placeholder="Backup password (min 4 chars)"
                  autocomplete="new-password"
                  class="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none input-theme"
                />
                <input
                  v-model="backupPasswordConfirm"
                  type="password"
                  placeholder="Confirm backup password"
                  autocomplete="new-password"
                  class="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none input-theme"
                />
              </div>
              <div class="flex items-center justify-end space-x-2 pt-0.5">
                <button
                  type="button"
                  @click="resetBackupForm"
                  :disabled="isProcessingBackup"
                  class="px-2.5 py-1 rounded-lg text-[11px] border cursor-pointer btn-theme-card"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  :disabled="isProcessingBackup"
                  class="px-3 py-1 rounded-lg text-[11px] font-medium flex items-center space-x-1.5 cursor-pointer btn-accent"
                >
                  <Loader2 v-if="isProcessingBackup" class="w-3 h-3 animate-spin" />
                  <Download v-else class="w-3 h-3" />
                  <span>{{ isProcessingBackup ? 'Encrypting...' : 'Save Backup File...' }}</span>
                </button>
              </div>
            </form>

            <!-- Inline Import Form -->
            <form
              v-else-if="backupPanelMode === 'import'"
              @submit.prevent="handleExecuteImportBackup"
              class="p-3 rounded-xl border space-y-2.5 text-xs"
              :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
            >
              <div class="font-medium text-xs" :style="{ color: 'var(--color-text-main)' }">
                Enter backup password to decrypt and restore
              </div>
              <input
                v-model="backupPassword"
                type="password"
                placeholder="Enter backup file password"
                autocomplete="current-password"
                class="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none input-theme"
              />
              <div class="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  @click="backupImportReplace = false"
                  class="py-1.5 px-2.5 rounded-lg text-[11px] font-medium cursor-pointer btn-flat-choice"
                  :class="{ 'btn-flat-choice--active font-semibold': !backupImportReplace }"
                >
                  Merge with Existing
                </button>
                <button
                  type="button"
                  @click="backupImportReplace = true"
                  class="py-1.5 px-2.5 rounded-lg text-[11px] font-medium cursor-pointer btn-flat-choice"
                  :class="{ 'btn-flat-choice--active font-semibold': backupImportReplace }"
                >
                  Replace Existing
                </button>
              </div>
              <div class="flex items-center justify-end space-x-2 pt-0.5">
                <button
                  type="button"
                  @click="resetBackupForm"
                  :disabled="isProcessingBackup"
                  class="px-2.5 py-1 rounded-lg text-[11px] border cursor-pointer btn-theme-card"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  :disabled="isProcessingBackup"
                  class="px-3 py-1 rounded-lg text-[11px] font-medium flex items-center space-x-1.5 cursor-pointer btn-accent"
                >
                  <Loader2 v-if="isProcessingBackup" class="w-3 h-3 animate-spin" />
                  <Upload v-else class="w-3 h-3" />
                  <span>{{ isProcessingBackup ? 'Restoring...' : 'Decrypt & Restore' }}</span>
                </button>
              </div>
            </form>

            <!-- Backup Status Toast -->
            <div
              v-if="backupStatus"
              class="p-2.5 rounded-lg border text-[11px] flex items-center justify-between gap-2"
              :style="backupStatus.isError
                ? {
                    backgroundColor: 'color-mix(in srgb, var(--color-danger, #f38ba8) 12%, var(--color-bg-card))',
                    borderColor: 'color-mix(in srgb, var(--color-danger, #f38ba8) 38%, var(--color-border))',
                    color: 'var(--color-danger, #f38ba8)',
                  }
                : {
                    backgroundColor: 'color-mix(in srgb, var(--color-success, #a6e3a1) 12%, var(--color-bg-card))',
                    borderColor: 'color-mix(in srgb, var(--color-success, #a6e3a1) 38%, var(--color-border))',
                    color: 'var(--color-success, #a6e3a1)',
                  }"
            >
              <div class="flex items-center space-x-2">
                <AlertTriangle v-if="backupStatus.isError" class="w-3.5 h-3.5 shrink-0" />
                <CheckCircle2 v-else class="w-3.5 h-3.5 shrink-0" />
                <span>{{ backupStatus.message }}</span>
              </div>
              <button type="button" @click="backupStatus = null" class="p-0.5 opacity-70 hover:opacity-100 cursor-pointer">
                <X class="w-3 h-3" />
              </button>
            </div>
          </div>

          <div
            class="p-3 rounded-xl border text-[11px] space-y-1.5"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)', color: 'var(--color-text-muted)' }"
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
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
          >
            <div class="flex items-center justify-between">
              <div>
                <h4 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">Supported Transfer Protocols</h4>
                <p class="text-[11px] mt-0.5" :style="{ color: 'var(--color-text-muted)' }">
                  All connection protocols currently supported in FlowSFTP.
                </p>
              </div>
            </div>

            <div class="divide-y pt-1" :style="{ borderColor: 'color-mix(in srgb, var(--color-border) 50%, transparent)' }">
              <!-- SFTP -->
              <div class="py-2.5 flex items-center justify-between">
                <div class="space-y-0.5">
                  <div class="font-medium flex items-center space-x-2" :style="{ color: 'var(--color-text-main)' }">
                    <span>SFTP (SSH File Transfer Protocol)</span>
                    <span
                      class="px-1.5 py-0.2 rounded text-[10px] border font-semibold"
                      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)', color: 'var(--color-accent)' }"
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
                      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)', color: 'var(--color-accent)' }"
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

        <!-- 6. DEVELOPER TAB -->
        <div v-if="activeTab === 'developer'" class="space-y-4">
          <!-- External Editor Section -->
          <div
            class="rounded-xl border p-4 space-y-4"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
          >
            <div class="flex items-center space-x-2.5">
              <Code2 class="w-4 h-4" :style="{ color: 'var(--color-accent)' }" />
              <div>
                <h4 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">External Editor Live Sync</h4>
                <p class="text-[11px] mt-0.5" :style="{ color: 'var(--color-text-muted)' }">
                  Choose which editor to open when selecting "Edit in External Editor (Live Sync)" on remote files.
                </p>
              </div>
            </div>

            <!-- Radio choices for preferred editor -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                @click="settingsStore.preferredExternalEditor = 'default'"
                class="btn-flat-choice flex items-center space-x-3 p-3 rounded-lg text-left cursor-pointer"
                :class="{ 'btn-flat-choice--active': settingsStore.preferredExternalEditor === 'default' }"
              >
                <div
                  class="w-4 h-4 rounded-full border flex items-center justify-center shrink-0"
                  :style="settingsStore.preferredExternalEditor === 'default'
                    ? { borderColor: 'var(--color-accent)', backgroundColor: 'color-mix(in srgb, var(--color-accent) 22%, transparent)' }
                    : { borderColor: 'color-mix(in srgb, var(--color-border) 75%, transparent)' }"
                >
                  <div v-if="settingsStore.preferredExternalEditor === 'default'" class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: 'var(--color-accent)' }" />
                </div>
                <div>
                  <div class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">System Default App</div>
                  <div class="text-[10px]" :style="{ color: 'var(--color-text-muted)' }">Uses your operating system's registered file associations</div>
                </div>
              </button>

              <button
                type="button"
                @click="settingsStore.preferredExternalEditor = 'code'"
                class="btn-flat-choice flex items-center space-x-3 p-3 rounded-lg text-left cursor-pointer"
                :class="{ 'btn-flat-choice--active': settingsStore.preferredExternalEditor === 'code' }"
              >
                <div
                  class="w-4 h-4 rounded-full border flex items-center justify-center shrink-0"
                  :style="settingsStore.preferredExternalEditor === 'code'
                    ? { borderColor: 'var(--color-accent)', backgroundColor: 'color-mix(in srgb, var(--color-accent) 22%, transparent)' }
                    : { borderColor: 'color-mix(in srgb, var(--color-border) 75%, transparent)' }"
                >
                  <div v-if="settingsStore.preferredExternalEditor === 'code'" class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: 'var(--color-accent)' }" />
                </div>
                <div>
                  <div class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">Visual Studio Code</div>
                  <div class="text-[10px]" :style="{ color: 'var(--color-text-muted)' }">Launches <code class="font-mono" :style="{ color: 'var(--color-accent)' }">code &lt;file&gt;</code> on PATH</div>
                </div>
              </button>

              <button
                type="button"
                @click="settingsStore.preferredExternalEditor = 'cursor'"
                class="btn-flat-choice flex items-center space-x-3 p-3 rounded-lg text-left cursor-pointer"
                :class="{ 'btn-flat-choice--active': settingsStore.preferredExternalEditor === 'cursor' }"
              >
                <div
                  class="w-4 h-4 rounded-full border flex items-center justify-center shrink-0"
                  :style="settingsStore.preferredExternalEditor === 'cursor'
                    ? { borderColor: 'var(--color-accent)', backgroundColor: 'color-mix(in srgb, var(--color-accent) 22%, transparent)' }
                    : { borderColor: 'color-mix(in srgb, var(--color-border) 75%, transparent)' }"
                >
                  <div v-if="settingsStore.preferredExternalEditor === 'cursor'" class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: 'var(--color-accent)' }" />
                </div>
                <div>
                  <div class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">Cursor AI</div>
                  <div class="text-[10px]" :style="{ color: 'var(--color-text-muted)' }">Launches <code class="font-mono" :style="{ color: 'var(--color-accent)' }">cursor &lt;file&gt;</code> on PATH</div>
                </div>
              </button>

              <button
                type="button"
                @click="settingsStore.preferredExternalEditor = 'subl'"
                class="btn-flat-choice flex items-center space-x-3 p-3 rounded-lg text-left cursor-pointer"
                :class="{ 'btn-flat-choice--active': settingsStore.preferredExternalEditor === 'subl' }"
              >
                <div
                  class="w-4 h-4 rounded-full border flex items-center justify-center shrink-0"
                  :style="settingsStore.preferredExternalEditor === 'subl'
                    ? { borderColor: 'var(--color-accent)', backgroundColor: 'color-mix(in srgb, var(--color-accent) 22%, transparent)' }
                    : { borderColor: 'color-mix(in srgb, var(--color-border) 75%, transparent)' }"
                >
                  <div v-if="settingsStore.preferredExternalEditor === 'subl'" class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: 'var(--color-accent)' }" />
                </div>
                <div>
                  <div class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">Sublime Text</div>
                  <div class="text-[10px]" :style="{ color: 'var(--color-text-muted)' }">Launches <code class="font-mono" :style="{ color: 'var(--color-accent)' }">subl &lt;file&gt;</code> on PATH</div>
                </div>
              </button>

              <button
                type="button"
                @click="settingsStore.preferredExternalEditor = 'notepad++'"
                class="btn-flat-choice flex items-center space-x-3 p-3 rounded-lg text-left cursor-pointer"
                :class="{ 'btn-flat-choice--active': settingsStore.preferredExternalEditor === 'notepad++' }"
              >
                <div
                  class="w-4 h-4 rounded-full border flex items-center justify-center shrink-0"
                  :style="settingsStore.preferredExternalEditor === 'notepad++'
                    ? { borderColor: 'var(--color-accent)', backgroundColor: 'color-mix(in srgb, var(--color-accent) 22%, transparent)' }
                    : { borderColor: 'color-mix(in srgb, var(--color-border) 75%, transparent)' }"
                >
                  <div v-if="settingsStore.preferredExternalEditor === 'notepad++'" class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: 'var(--color-accent)' }" />
                </div>
                <div>
                  <div class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">Notepad++</div>
                  <div class="text-[10px]" :style="{ color: 'var(--color-text-muted)' }">Launches Notepad++ executable on PATH</div>
                </div>
              </button>

              <button
                type="button"
                @click="settingsStore.preferredExternalEditor = 'custom'"
                class="btn-flat-choice flex items-center space-x-3 p-3 rounded-lg text-left cursor-pointer"
                :class="{ 'btn-flat-choice--active': settingsStore.preferredExternalEditor === 'custom' }"
              >
                <div
                  class="w-4 h-4 rounded-full border flex items-center justify-center shrink-0"
                  :style="settingsStore.preferredExternalEditor === 'custom'
                    ? { borderColor: 'var(--color-accent)', backgroundColor: 'color-mix(in srgb, var(--color-accent) 22%, transparent)' }
                    : { borderColor: 'color-mix(in srgb, var(--color-border) 75%, transparent)' }"
                >
                  <div v-if="settingsStore.preferredExternalEditor === 'custom'" class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: 'var(--color-accent)' }" />
                </div>
                <div>
                  <div class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">Custom Command / Path</div>
                  <div class="text-[10px]" :style="{ color: 'var(--color-text-muted)' }">Specify executable path or CLI name</div>
                </div>
              </button>
            </div>

            <!-- Custom Command Input -->
            <div v-if="settingsStore.preferredExternalEditor === 'custom'" class="pt-2">
              <label class="block text-[11px] font-medium mb-1" :style="{ color: 'var(--color-text-muted)' }">
                Executable or Command Path:
              </label>
              <input
                v-model="settingsStore.customExternalEditorCommand"
                type="text"
                placeholder="e.g. C:\Program Files\Zed\zed.exe or nvim"
                class="w-full px-3 py-2 rounded-lg border text-xs font-mono focus:outline-none input-theme"
              />
            </div>

            <!-- Info box -->
            <div class="p-3 rounded-lg bg-sky-500/8 border border-sky-500/20 text-sky-900 dark:text-sky-200 text-[11px] leading-relaxed">
              <span class="font-semibold text-sky-700 dark:text-sky-300">How Live Sync Works:</span>
              When you open a remote file in an external editor, FlowSFTP downloads a temporary staging copy, preserves its file extension for syntax highlighting, and watches it with a real-time filesystem watcher. Whenever you save in your editor (<kbd class="px-1 py-0.2 rounded border bg-sky-500/15 text-sky-950 dark:text-sky-100 border-sky-500/25 font-mono text-[10px]">Ctrl+S</kbd>), FlowSFTP automatically debounces and uploads your changes back to the remote server.
            </div>
          </div>

          <!-- Directory Watchers & Auto-Upload Section -->
          <div
            class="rounded-xl border p-4 space-y-4"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-2.5">
                <FolderSync class="w-4 h-4 text-sky-600 dark:text-sky-400" />
                <div>
                  <h4 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">Live Directory Watcher & Auto-Upload</h4>
                  <p class="text-[11px] mt-0.5" :style="{ color: 'var(--color-text-muted)' }">
                    Active pairings between local project folders and remote server directories.
                  </p>
                </div>
              </div>
            </div>

            <div v-if="dirWatcherStore.pairings.length === 0" class="p-4 rounded-lg border border-dashed text-center text-xs" :style="{ borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)', color: 'var(--color-text-muted)' }">
              No folder pairings active. Right-click any local folder in the file browser and choose "Pair with Remote (Live Auto-Sync)" to start.
            </div>

            <div v-else class="space-y-2">
              <div
                v-for="p in dirWatcherStore.pairings"
                :key="p.id"
                class="p-3 rounded-lg border flex items-center justify-between text-xs"
                :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
              >
                <div class="space-y-1 min-w-0 flex-1 pr-3">
                  <div class="flex items-center space-x-2 font-mono text-[11px]">
                    <span class="text-amber-700 dark:text-amber-300 truncate max-w-[200px]" :title="p.local_dir">{{ p.local_dir }}</span>
                    <span :style="{ color: 'var(--color-text-muted)' }">➔</span>
                    <span class="text-sky-700 dark:text-sky-300 truncate max-w-[200px]" :title="p.remote_dir">{{ p.remote_dir }}</span>
                  </div>
                  <div class="text-[10px]" :style="{ color: 'var(--color-text-muted)' }">
                    Status: <span class="text-emerald-700 dark:text-emerald-400 font-semibold">{{ p.status }}</span> • {{ p.files_uploaded }} files synced
                  </div>
                </div>

                <div class="flex items-center space-x-1.5 shrink-0">
                  <button
                    @click="dirWatcherStore.toggleWatcher(p.id, !p.enabled)"
                    class="px-2.5 py-1 rounded-md border text-xs cursor-pointer btn-theme-card"
                  >
                    {{ p.enabled ? 'Pause' : 'Resume' }}
                  </button>
                  <button
                    @click="dirWatcherStore.stopWatcher(p.id)"
                    class="btn-flat-ghost-danger p-1.5 rounded-md cursor-pointer"
                    title="Remove pairing"
                  >
                    <Trash2 class="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Remote Search & Grep Section -->
          <div
            class="rounded-xl border p-4 space-y-3"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
          >
            <div class="flex items-center space-x-2.5">
              <Search class="w-4 h-4 text-sky-400" />
              <div>
                <h4 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">Recursive Remote Search & SSH Grep</h4>
                <p class="text-[11px] mt-0.5" :style="{ color: 'var(--color-text-muted)' }">
                  Instant search across deeply nested remote directories and files.
                </p>
              </div>
            </div>

            <div class="p-3 rounded-lg bg-sky-950/20 border border-sky-500/20 text-sky-200/90 text-[11px] leading-relaxed space-y-1">
              <div>
                <span class="font-semibold text-sky-300">Keyboard Shortcut:</span>
                Press <kbd class="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-200 font-mono text-[10px]">Ctrl+Shift+F</kbd> anywhere in the file browser.
              </div>
              <div>
                <span class="font-semibold text-sky-300">Native Server Speed:</span>
                SSH sessions execute native Linux <code class="font-mono text-sky-300">find</code> and <code class="font-mono text-sky-300">grep</code> directly on the server host, returning matching lines and line numbers instantly without downloading files.
              </div>
            </div>
          </div>
        </div>

        <!-- 7. ABOUT TAB -->
        <div v-if="activeTab === 'about'" class="space-y-5 max-w-xl mx-auto py-2">
          <!-- App Header Card -->
          <div
            class="rounded-xl border p-6 flex flex-col items-center text-center space-y-3"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
          >
            <img :src="appIcon" alt="FlowSFTP" class="w-20 h-20 object-contain" />
            <div>
              <h3 class="text-lg font-bold tracking-tight" :style="{ color: 'var(--color-text-main)' }">FlowSFTP</h3>
              <p class="text-xs font-mono mt-0.5" :style="{ color: 'var(--color-text-muted)' }">
                v{{ updaterStore.currentVersion || '0.9.1' }}
              </p>
            </div>
            <p class="text-xs max-w-md leading-relaxed" :style="{ color: 'var(--color-text-muted)' }">
              A modern, blazing-fast, and secure dual-pane SFTP / FTP / FTPS client with an integrated hardware-accelerated SSH terminal.
            </p>
          </div>

          <!-- Software Updates Card (flowsftp.com) -->
          <div
            class="rounded-xl border p-5 space-y-4"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
          >
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div class="flex items-center space-x-2">
                  <h4 class="text-xs font-semibold" :style="{ color: 'var(--color-text-main)' }">
                    Software Updates
                  </h4>
                  <span
                    v-if="updaterStore.updateAvailable"
                    class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30"
                  >
                    v{{ updaterStore.latestVersion }} Available
                  </span>
                  <span
                    v-else-if="updaterStore.lastCheckedAt"
                    class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-sky-500/12 text-sky-600 dark:text-sky-300 border border-sky-500/25"
                  >
                    Up to Date
                  </span>
                </div>
                <p class="text-[11px] mt-0.5" :style="{ color: 'var(--color-text-muted)' }">
                  {{ updaterStore.statusMessage || 'Checks flowsftp.com for the latest release and installs updates in-place.' }}
                </p>
              </div>

              <button
                @click="updaterStore.checkForUpdates({ silent: false })"
                :disabled="updaterStore.checking || updaterStore.downloading || updaterStore.installing"
                class="px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center space-x-1.5 transition btn-theme-card cursor-pointer disabled:opacity-50 shrink-0"
              >
                <RefreshCw class="w-3.5 h-3.5" :class="{ 'animate-spin': updaterStore.checking }" :style="{ color: 'var(--color-accent)' }" />
                <span>{{ updaterStore.checking ? 'Checking...' : 'Check for Updates' }}</span>
              </button>
            </div>

            <!-- Error Banner -->
            <div
              v-if="updaterStore.errorMessage"
              class="p-3 rounded-lg bg-red-500/10 border border-red-500/25 text-red-600 dark:text-red-300 text-xs flex items-center space-x-2"
            >
              <AlertTriangle class="w-4 h-4 shrink-0" />
              <span>{{ updaterStore.errorMessage }}</span>
            </div>

            <!-- Available Update Action & Release Notes -->
            <div
              v-if="updaterStore.updateAvailable"
              class="rounded-lg border p-4 space-y-3"
              :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'color-mix(in srgb, var(--color-accent) 35%, var(--color-border))' }"
            >
              <div class="flex items-center justify-between gap-2">
                <div class="text-xs font-semibold" :style="{ color: 'var(--color-text-main)' }">
                  FlowSFTP v{{ updaterStore.latestVersion }} is ready to install
                </div>
                <span v-if="updaterStore.pubDate" class="text-[10px] font-mono" :style="{ color: 'var(--color-text-muted)' }">
                  {{ new Date(updaterStore.pubDate).toLocaleDateString() }}
                </span>
              </div>

              <div
                v-if="updaterStore.releaseNotes"
                class="text-[11px] leading-relaxed whitespace-pre-line max-h-36 overflow-y-auto p-2.5 rounded-md border font-mono"
                :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 50%, transparent)', color: 'var(--color-text-muted)' }"
              >
                {{ updaterStore.releaseNotes }}
              </div>

              <!-- Download / Install Progress -->
              <div v-if="updaterStore.downloading || updaterStore.installing" class="space-y-2 pt-1">
                <div class="flex items-center justify-between text-[11px] font-mono">
                  <span :style="{ color: 'var(--color-text-main)' }">
                    {{ updaterStore.installing ? 'Installing update & restarting...' : `Downloading (${updaterStore.progressPercent}%)` }}
                  </span>
                  <span v-if="updaterStore.totalBytes > 0" :style="{ color: 'var(--color-text-muted)' }">
                    {{ formatUpdaterBytes(updaterStore.downloadedBytes) }} / {{ formatUpdaterBytes(updaterStore.totalBytes) }}
                  </span>
                </div>
                <div
                  class="w-full h-2 rounded-full overflow-hidden border"
                  :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 50%, transparent)' }"
                >
                  <div
                    class="h-full transition-all duration-150 rounded-full"
                    :style="{ width: `${Math.max(4, updaterStore.progressPercent)}%`, backgroundColor: 'var(--color-accent)' }"
                  />
                </div>
                <div v-if="updaterStore.downloading" class="flex justify-end pt-1">
                  <button
                    @click="updaterStore.cancelDownload()"
                    class="px-3 py-1 rounded-md text-xs btn-theme-card cursor-pointer"
                  >
                    Cancel Download
                  </button>
                </div>
              </div>

              <!-- Install Update Button -->
              <div v-else class="flex items-center justify-end gap-2 pt-1">
                <button
                  @click="updaterStore.downloadAndInstallUpdate()"
                  class="px-4 py-2 rounded-lg text-xs font-medium flex items-center space-x-2 btn-accent cursor-pointer"
                >
                  <Download class="w-3.5 h-3.5" />
                  <span>Download & Install v{{ updaterStore.latestVersion }}</span>
                </button>
              </div>
            </div>

            <!-- Auto-Check on Startup Toggle -->
            <div
              class="pt-3 border-t flex items-center justify-between"
              :style="{ borderColor: 'color-mix(in srgb, var(--color-border) 45%, transparent)' }"
            >
              <div>
                <div class="text-xs font-medium" :style="{ color: 'var(--color-text-main)' }">
                  Automatically check for updates on startup
                </div>
                <div class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">
                  Notifies you in the top bar when a new version is published on flowsftp.com.
                </div>
              </div>
              <button
                type="button"
                role="switch"
                :aria-checked="updaterStore.autoCheckOnStartup"
                @click="updaterStore.autoCheckOnStartup = !updaterStore.autoCheckOnStartup"
                class="w-9 h-5 rounded-full transition-colors relative cursor-pointer shrink-0 border"
                :style="{
                  backgroundColor: updaterStore.autoCheckOnStartup
                    ? 'color-mix(in srgb, var(--color-accent) 35%, var(--color-bg-card))'
                    : 'var(--color-bg-card)',
                  borderColor: updaterStore.autoCheckOnStartup
                    ? 'color-mix(in srgb, var(--color-accent) 65%, var(--color-border))'
                    : 'var(--color-border)',
                }"
              >
                <span
                  class="w-3.5 h-3.5 rounded-full transition-transform absolute top-0.5 left-0.5"
                  :class="updaterStore.autoCheckOnStartup ? 'translate-x-4' : 'translate-x-0'"
                  :style="{
                    backgroundColor: updaterStore.autoCheckOnStartup
                      ? 'var(--color-accent)'
                      : 'var(--color-text-muted)',
                  }"
                />
              </button>
            </div>
          </div>

          <!-- Company & Contact Card -->
          <div
            class="rounded-xl border p-5 space-y-4"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
          >
            <div class="flex items-center justify-between border-b pb-3" :style="{ borderColor: 'color-mix(in srgb, var(--color-border) 50%, transparent)' }">
              <div>
                <div class="text-[11px] font-semibold uppercase tracking-wider" :style="{ color: 'var(--color-text-muted)' }">
                  Developed & Maintained By
                </div>
                <div class="text-sm font-bold mt-0.5" :style="{ color: 'var(--color-text-main)' }">
                  digital code labs s.r.l.
                </div>
              </div>
              <button
                @click="openExternalUrl('https://digitalcodelabs.dev')"
                class="px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center space-x-1.5 transition btn-theme-card cursor-pointer"
              >
                <Globe class="w-3.5 h-3.5" :style="{ color: 'var(--color-accent)' }" />
                <span>digitalcodelabs.dev</span>
                <ExternalLink class="w-3 h-3 ml-0.5 opacity-70" />
              </button>
            </div>

            <!-- Contact Emails -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div
                class="btn-flat-choice rounded-lg p-3 flex flex-col justify-between space-y-2 cursor-pointer"
                @click="openExternalUrl('mailto:contact@digitalcodelabs.dev')"
              >
                <div class="flex items-center space-x-2 text-[11px]" :style="{ color: 'var(--color-text-muted)' }">
                  <Mail class="w-3.5 h-3.5" :style="{ color: 'var(--color-accent)' }" />
                  <span class="font-medium">Business & Inquiries</span>
                </div>
                <span class="font-mono text-xs select-all truncate" :style="{ color: 'var(--color-text-main)' }">
                  contact@digitalcodelabs.dev
                </span>
              </div>

              <div
                class="btn-flat-choice rounded-lg p-3 flex flex-col justify-between space-y-2 cursor-pointer"
                @click="openExternalUrl('mailto:dan@spiral8.net')"
              >
                <div class="flex items-center space-x-2 text-[11px]" :style="{ color: 'var(--color-text-muted)' }">
                  <Mail class="w-3.5 h-3.5" :style="{ color: 'var(--color-accent)' }" />
                  <span class="font-medium">Direct Contact</span>
                </div>
                <span class="font-mono text-xs select-all truncate" :style="{ color: 'var(--color-text-main)' }">
                  dan@spiral8.net
                </span>
              </div>
            </div>
          </div>

          <!-- License & Tech Specs Card -->
          <div
            class="rounded-xl border p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'color-mix(in srgb, var(--color-border) 55%, transparent)' }"
          >
            <div>
              <span class="font-medium" :style="{ color: 'var(--color-text-main)' }">License:</span>
              <span class="ml-1" :style="{ color: 'var(--color-text-muted)' }">MIT License — Copyright &copy; 2026 digital code labs s.r.l.</span>
            </div>
            <div class="text-[11px] font-mono" :style="{ color: 'var(--color-text-muted)' }">
              Tauri v2 • Nuxt 4 • Rust
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div
        class="flex items-center justify-end px-6 py-3.5 border-t shrink-0 transition-colors duration-150"
        :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'color-mix(in srgb, var(--color-border) 60%, transparent)' }"
      >
        <button
          @click="emit('close')"
          class="px-5 py-1.5 rounded-lg text-xs font-medium transition-colors btn-theme-card cursor-pointer"
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
        :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'color-mix(in srgb, var(--color-border) 65%, transparent)' }"
      >
        <div class="flex items-center justify-between">
          <h4 class="font-semibold text-sm flex items-center space-x-2" :style="{ color: 'var(--color-text-main)' }">
            <FileCode class="w-4 h-4" :style="{ color: 'var(--color-accent)' }" />
            <span>Import Theme from JSON</span>
          </h4>
          <button
            @click="showPasteModal = false"
            class="btn-flat-ghost w-7 h-7 flex items-center justify-center rounded-lg cursor-pointer"
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
          placeholder='{ "name": "My Custom Theme", "ui": { ... }, "terminal": { ... } }'
        />

        <div class="flex items-center justify-end space-x-2">
          <button
            @click="showPasteModal = false"
            class="px-3 py-1.5 rounded-lg border text-xs transition cursor-pointer btn-theme-card"
          >
            Cancel
          </button>
          <button
            @click="handleImportPasted"
            class="px-4 py-1.5 rounded-lg font-medium text-xs transition cursor-pointer btn-accent"
          >
            Import & Apply
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
