<script setup lang="ts">
import { ref, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import {
  Folder,
  X,
  Eye,
  EyeOff,
  GitBranch,
  Search,
  GitCompare,
  FolderSync,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
} from 'lucide-vue-next'
import { useSftpStore, type LocalFileEntry } from '../../../stores/sftp'
import { useSettingsStore } from '../../../stores/settings'
import FileIcon from '../../FileIcon.vue'
import CatppuccinIcon from '../../CatppuccinIcon.vue'
import SftpBreadcrumbBar from './SftpBreadcrumbBar.vue'
import SftpComparisonBadge from '../compare/SftpComparisonBadge.vue'
import type { ComparisonResult } from '../compare/types'
import { formatBytes, formatDate, getFileType, highlightMatch } from '../../../utils/formatters'
import { getWslDistroIcon } from '../../../utils/fileIcons'

const props = defineProps<{
  active: boolean
  widthPercent: number
  sessionId: string | null
  isComparing: boolean
  hideIdenticalFiles: boolean
  comparisonResult: ComparisonResult | null
  showHiddenFiles: boolean
  selectedPaths: Set<string>
  selectedFiles: LocalFileEntry[]
  filteredFiles: LocalFileEntry[]
  sortBy: FileSortField
  sortOrder: FileSortOrder
  showFilter: boolean
  searchQuery: string
  activeDropFolder: { pane: 'local' | 'remote'; path: string } | null
  canNavigateUp: boolean
  canNavigateBack?: boolean
  canNavigateForward?: boolean
  parentPath: string | null
  isParentSelected: boolean
  rowPaddingClass: string
  cellPaddingClass: string
  localBookmarks: string[]
  currentPath: string
  getRowStyle: (isLocal: boolean, path: string, file: LocalFileEntry) => Record<string, any>
  getGitStatus: (isLocal: boolean, file: LocalFileEntry) => string | null
}>()

const emit = defineEmits<{
  (e: 'select-pane'): void
  (e: 'empty-click', event: MouseEvent): void
  (e: 'update:showHiddenFiles', val: boolean): void
  (e: 'update:searchQuery', val: string): void
  (e: 'update:showFilter', val: boolean): void
  (e: 'sort', field: FileSortField): void
  (e: 'toggle-comparison'): void
  (e: 'toggle-filter'): void
  (e: 'filter-esc'): void
  (e: 'focus-first-item'): void
  (e: 'navigate-up'): void
  (e: 'navigate-back'): void
  (e: 'navigate-forward'): void
  (e: 'navigate-to', path: string): void
  (e: 'copy-path', pathStr: string): void
  (e: 'refresh'): void
  (e: 'new-file'): void
  (e: 'new-folder'): void
  (e: 'open-dir-watcher'): void
  (e: 'open-settings'): void
  (e: 'batch-upload', files: LocalFileEntry[]): void
  (e: 'batch-delete', files: LocalFileEntry[]): void
  (e: 'row-click', event: MouseEvent, file: LocalFileEntry, index: number): void
  (e: 'row-dblclick', file: LocalFileEntry): void
  (e: 'parent-click'): void
  (e: 'close-context-menu'): void
  (e: 'contextmenu', event: MouseEvent, file?: LocalFileEntry): void
  (e: 'dragstart', event: DragEvent, file: LocalFileEntry): void
  (e: 'dragend'): void
  (e: 'dragover', event: DragEvent): void
  (e: 'dragenter', event: DragEvent): void
  (e: 'dragleave', event: DragEvent): void
  (e: 'drop', event: DragEvent): void
  (e: 'folder-dragover', event: DragEvent, file: LocalFileEntry): void
  (e: 'folder-dragleave', file: LocalFileEntry): void
  (e: 'folder-drop', event: DragEvent, file: LocalFileEntry): void
  (e: 'parent-folder-dragover', event: DragEvent): void
  (e: 'parent-folder-dragleave'): void
  (e: 'parent-folder-drop', event: DragEvent): void
  (e: 'toggle-bookmark', path?: string): void
}>()

const sftpStore = useSftpStore()
const settingsStore = useSettingsStore()

const handleContainerClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement | null
  if (target?.closest('.file-row, thead, button, input, a, select, textarea, [role="button"]')) {
    return
  }
  emit('empty-click', e)
}

const handleContainerContextMenu = (e: MouseEvent) => {
  const target = e.target as HTMLElement | null
  if (target?.closest('.file-row')) {
    return
  }
  emit('contextmenu', e)
}

const rootEl = ref<HTMLElement | null>(null)
const filterInputRef = ref<HTMLInputElement | null>(null)

// Address bar input path
const inputPath = ref(props.currentPath)

// Sync localInputPath when store changes
const syncInputPath = (p: string) => {
  inputPath.value = p
}

// WSL Submenu state
const wslDistros = ref<string[]>([])
const showWslMenu = ref(false)
const isLoadingWsl = ref(false)

const loadWslDistros = async () => {
  try {
    isLoadingWsl.value = true
    const distros = await invoke<string[]>('sftp_get_wsl_distros')
    wslDistros.value = distros
  } catch (err) {
    console.warn('Failed to get WSL distros:', err)
    wslDistros.value = []
  } finally {
    isLoadingWsl.value = false
  }
}

const toggleWslMenu = async (event: MouseEvent) => {
  event.stopPropagation()
  showWslMenu.value = !showWslMenu.value
  if (showWslMenu.value) {
    await loadWslDistros()
  }
}

const navigateToWslDistro = (distro: string) => {
  showWslMenu.value = false
  emit('navigate-to', `//wsl.localhost/${distro}`)
}

// Bookmarks Menu state
const showBookmarksMenu = ref(false)
const isBookmarked = computed(() => props.localBookmarks.includes(props.currentPath))

const closeAllDropdowns = () => {
  showWslMenu.value = false
  showBookmarksMenu.value = false
}

const breadcrumbBarRef = ref<InstanceType<typeof SftpBreadcrumbBar> | null>(null)
const startEditPath = () => {
  breadcrumbBarRef.value?.startEditing()
}

defineExpose({
  rootEl,
  filterInputRef,
  syncInputPath,
  closeAllDropdowns,
  startEditPath,
})
</script>

<template>
  <div
    ref="rootEl"
    class="flex flex-col h-full overflow-hidden relative transition-colors duration-150 shrink-0 min-w-0"
    :style="{
      width: `${widthPercent}%`,
      backgroundColor: 'var(--color-bg-pane)',
    }"
    @click="emit('select-pane')"
    @dragover="emit('dragover', $event)"
    @dragenter="emit('dragenter', $event)"
    @dragleave="emit('dragleave', $event)"
    @drop="emit('drop', $event)"
    @contextmenu.self="emit('contextmenu', $event)"
  >
    <!-- Local Header Toolbar -->
    <div
      class="flex items-center justify-between px-3 h-9 border-b transition-colors duration-150 shrink-0"
      :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)' }"
    >
      <div class="flex items-center space-x-2">
        <span
          class="w-2 h-2 rounded-full transition-all duration-150 shrink-0"
          :class="active ? 'opacity-100 scale-100 ring-2 ring-emerald-500/40 shadow-sm shadow-emerald-500/20' : 'opacity-25 scale-75'"
          :style="{ backgroundColor: 'var(--color-accent)' }"
          title="Active navigation pane"
        />
        <span
          class="text-xs font-semibold transition-colors duration-150"
          :style="{ color: active ? 'var(--color-accent)' : 'var(--color-text-main)' }"
        >
          Local Files
        </span>
        <span class="text-[11px] font-mono" :style="{ color: 'var(--color-text-muted)' }">
          ({{ selectedPaths.size > 0 ? `${selectedPaths.size} of ` : '' }}{{ searchQuery || (isComparing && hideIdenticalFiles) ? `${filteredFiles.length} of ${sftpStore.localFiles.length}` : `${filteredFiles.length}` }} items)
        </span>
      </div>

      <div class="flex items-center space-x-1.5">
        <!-- Batch Actions for Local Selection -->
        <template v-if="selectedFiles.length > 0">
          <button
            v-if="sessionId"
            @click="emit('batch-upload', selectedFiles)"
            :title="`Upload ${selectedFiles.length} selected item(s) to remote (Alt+F5)`"
            class="h-6 px-1.5 rounded text-xs transition flex items-center justify-center bg-sky-500/15 hover:bg-sky-500/30 text-sky-700 dark:text-sky-400 border border-sky-500/30 shadow-sm"
          >
            <CatppuccinIcon name="upload" :size="15" />
          </button>
          <button
            @click="emit('batch-delete', selectedFiles)"
            :title="`Delete ${selectedFiles.length} selected item(s) (F8 / Delete)`"
            class="h-6 px-1.5 rounded text-red-400 hover:bg-red-950/60 text-xs transition flex items-center justify-center border border-transparent hover:border-red-500/30"
          >
            <CatppuccinIcon name="delete" :size="15" />
          </button>
          <div class="h-3.5 w-px mx-0.5" :style="{ backgroundColor: 'var(--color-border)' }" />
        </template>

        <!-- Toggle Directory Comparison -->
        <button
          v-if="sessionId"
          @click="emit('toggle-comparison')"
          :title="isComparing ? 'Exit Directory Comparison (Ctrl+Shift+C)' : 'Compare with Remote Directory (Ctrl+Shift+C)'"
          class="p-1 rounded text-xs transition hover:opacity-80"
          :class="isComparing ? 'text-indigo-400 bg-indigo-500/10' : ''"
          :style="{ color: isComparing ? 'var(--color-accent)' : 'var(--color-text-muted)' }"
        >
          <GitCompare class="w-4 h-4" />
        </button>

        <!-- Toggle Synchronized Browsing -->
        <button
          v-if="sessionId"
          @click="sftpStore.toggleSynchronizedBrowsing()"
          :title="sftpStore.isSynchronizedBrowsing ? 'Synchronized Browsing is ON (Lockstep Navigation)' : 'Turn ON Synchronized Browsing (Lockstep Navigation)'"
          class="p-1 rounded text-xs transition hover:opacity-80 relative"
          :class="sftpStore.isSynchronizedBrowsing ? 'text-sky-700 dark:text-sky-400 bg-sky-500/15 ring-1 ring-sky-400/40' : ''"
          :style="{ color: sftpStore.isSynchronizedBrowsing ? 'var(--color-accent)' : 'var(--color-text-muted)' }"
        >
          <FolderSync class="w-4 h-4" />
          <span v-if="sftpStore.isSynchronizedBrowsing" class="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-sky-500 dark:bg-sky-400 animate-pulse" />
        </button>

        <!-- Toggle In-Pane Search Filter (Ctrl+F) -->
        <button
          @click="emit('toggle-filter')"
          :title="showFilter ? 'Close Filter (Ctrl+F)' : 'Filter files (Ctrl+F)'"
          class="p-1 rounded text-xs transition hover:opacity-80"
          :class="showFilter || searchQuery ? 'text-emerald-400' : ''"
          :style="{ color: showFilter || searchQuery ? 'var(--color-accent)' : 'var(--color-text-muted)' }"
        >
          <Search class="w-4 h-4" />
        </button>

        <!-- Folder History: Back (Alt+Left) -->
        <button
          @click="emit('navigate-back')"
          :disabled="!canNavigateBack"
          :class="{ 'opacity-30 cursor-not-allowed': !canNavigateBack }"
          title="Go back (Alt+Left)"
          class="p-1 rounded text-xs transition hover:opacity-80"
          :style="{ color: 'var(--color-text-muted)' }"
        >
          <ChevronLeft class="w-4 h-4" />
        </button>

        <!-- Folder History: Forward (Alt+Right) -->
        <button
          @click="emit('navigate-forward')"
          :disabled="!canNavigateForward"
          :class="{ 'opacity-30 cursor-not-allowed': !canNavigateForward }"
          title="Go forward (Alt+Right)"
          class="p-1 rounded text-xs transition hover:opacity-80"
          :style="{ color: 'var(--color-text-muted)' }"
        >
          <ChevronRight class="w-4 h-4" />
        </button>

        <!-- Parent Directory: Up (Backspace) -->
        <button
          @click="emit('navigate-up')"
          :disabled="!canNavigateUp"
          :class="{ 'opacity-30 cursor-not-allowed': !canNavigateUp }"
          title="Go to parent directory (Backspace)"
          class="p-1 rounded text-xs transition hover:opacity-80"
          :style="{ color: 'var(--color-text-muted)' }"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        </button>
        <button
          @click="emit('refresh')"
          title="Refresh (F5)"
          class="p-1 rounded text-xs transition hover:opacity-80 flex items-center justify-center"
          :style="{ color: 'var(--color-text-muted)' }"
        >
          <CatppuccinIcon
            name="refresh"
            :size="15"
            :class="{ 'animate-spin': sftpStore.isBackgroundRefreshingLocal || sftpStore.isLoadingLocal }"
          />
        </button>

        <!-- Toggle Hidden Files -->
        <button
          @click="emit('update:showHiddenFiles', !showHiddenFiles)"
          :title="showHiddenFiles ? 'Hide dotfiles' : 'Show hidden dotfiles (.env, .git, etc.)'"
          class="p-1 rounded text-xs transition hover:opacity-80"
          :class="showHiddenFiles ? 'text-indigo-400' : ''"
          :style="{ color: showHiddenFiles ? 'var(--color-accent)' : 'var(--color-text-muted)' }"
        >
          <Eye v-if="showHiddenFiles" class="w-4 h-4" />
          <EyeOff v-else class="w-4 h-4" />
        </button>

        <button
          @click="emit('new-file')"
          title="New File"
          class="p-1 rounded text-xs transition hover:opacity-80"
          :style="{ color: 'var(--color-text-muted)' }"
        >
          <CatppuccinIcon name="file" :size="15" />
        </button>
        <button
          @click="emit('new-folder')"
          title="New Directory"
          class="p-1 rounded text-xs transition hover:opacity-80"
          :style="{ color: 'var(--color-text-muted)' }"
        >
          <CatppuccinIcon name="folder" :size="15" />
        </button>
        <button
          v-if="sessionId"
          @click="emit('open-dir-watcher')"
          title="Directory Watcher & Live Auto-Upload (Folder Pairing)"
          class="p-1 rounded text-xs transition hover:opacity-80 text-sky-600 dark:text-sky-400"
        >
          <FolderSync class="w-4 h-4" />
        </button>

        <div class="h-3.5 w-px mx-0.5" :style="{ backgroundColor: 'var(--color-border)' }" />

        <!-- Settings button -->
        <button
          @click="emit('open-settings')"
          title="Settings (Transfers, Master Password, Protocols)"
          class="p-1 rounded text-xs transition hover:opacity-80"
          :style="{ color: 'var(--color-text-muted)' }"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>

        <!-- WSL Shortcut Menu -->
        <div class="relative">
          <button
            @click="toggleWslMenu"
            title="Browse WSL Linux distributions"
            class="px-2 py-0.5 rounded border text-xs font-medium flex items-center space-x-1.5 transition btn-theme-card"
          >
            <span>WSL</span>
            <span class="text-[9px]" :style="{ color: 'var(--color-text-muted)' }">▼</span>
          </button>

          <div
            v-if="showWslMenu"
            class="absolute right-0 mt-1.5 z-50 w-60 backdrop-blur-md rounded-xl border shadow-2xl p-1.5 text-xs select-none animate-in fade-in zoom-in-95 duration-75"
            :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
            @click.stop
          >
            <div
              class="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider border-b mb-1 flex items-center justify-between"
              :style="{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
            >
              <span>WSL Distributions</span>
            </div>

            <div v-if="isLoadingWsl" class="px-3 py-2 text-xs flex items-center space-x-2" :style="{ color: 'var(--color-text-muted)' }">
              <span class="animate-spin w-3 h-3 border rounded-full" :style="{ borderColor: 'var(--color-border)', borderTopColor: 'var(--color-accent)' }" />
              <span>Scanning distros...</span>
            </div>

            <div v-else-if="wslDistros.length === 0" class="px-3 py-2 text-xs space-y-1.5" :style="{ color: 'var(--color-text-muted)' }">
              <div>No running WSL distros detected.</div>
              <button
                @click="navigateToWslDistro('Ubuntu-24.04')"
                class="flex items-center space-x-1.5 hover:underline text-[11px] pt-1"
                :style="{ color: 'var(--color-accent)' }"
              >
                <CatppuccinIcon :name="getWslDistroIcon('Ubuntu')" :size="14" />
                <span>Open //wsl.localhost/Ubuntu-24.04</span>
              </button>
            </div>

            <template v-else>
              <button
                v-for="distro in wslDistros"
                :key="distro"
                @click="navigateToWslDistro(distro)"
                class="w-full flex items-center space-x-2.5 px-2 py-1.5 rounded-lg transition text-left hover:bg-[var(--color-bg-hover)] group cursor-pointer"
                :style="{ color: 'var(--color-text-main)' }"
              >
                <div class="w-6 h-6 rounded-md flex items-center justify-center shrink-0 bg-black/5 dark:bg-white/5 border border-[var(--color-border)] group-hover:scale-105 transition-transform shadow-2xs">
                  <CatppuccinIcon :name="getWslDistroIcon(distro)" :size="15" />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="font-medium truncate text-xs">{{ distro }}</div>
                  <div class="text-[10px] font-mono truncate opacity-65">//wsl.localhost/{{ distro }}</div>
                </div>
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- Local Path Breadcrumb Bar & Bookmarks -->
    <div
      class="h-8 flex items-center pr-2 transition-colors duration-150 shrink-0"
      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
    >
      <div class="flex-1 min-w-0">
        <SftpBreadcrumbBar
          ref="breadcrumbBarRef"
          :path="currentPath"
          pane="local"
          :active="active"
          :git-status="sftpStore.localGitStatus"
          :placeholder="currentPath?.startsWith('/') ? '/home/...' : 'C:/Users/...'"
          @navigate-to="emit('navigate-to', $event)"
          @copy-path="emit('copy-path', $event)"
        />
      </div>

      <!-- Local Bookmark Toggle & Dropdown -->
      <div class="relative flex items-center space-x-1 shrink-0 pl-1.5">
        <button
          @click="emit('toggle-bookmark')"
          :title="isBookmarked ? 'Remove Bookmark' : 'Bookmark this folder'"
          class="p-1.5 rounded-lg border text-xs transition btn-theme-card flex items-center justify-center"
          :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
        >
          <CatppuccinIcon
            :name="isBookmarked ? 'bookmark-filled' : 'bookmark'"
            :size="14"
          />
        </button>
        <button
          @click.stop="showBookmarksMenu = !showBookmarksMenu"
          title="Saved Local Bookmarks"
          class="p-1.5 rounded-lg border text-xs transition btn-theme-card"
          :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
        >
          <ChevronDown class="w-3.5 h-3.5 text-slate-400" />
        </button>

        <!-- Bookmarks Dropdown Menu -->
        <div
          v-if="showBookmarksMenu"
          class="absolute right-0 top-full mt-1.5 z-50 w-64 backdrop-blur-md rounded-xl border shadow-2xl p-1.5 text-xs select-none animate-in fade-in zoom-in-95 duration-100"
          :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
          @click.stop
        >
          <div
            class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider border-b mb-1 flex items-center justify-between"
            :style="{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
          >
            <span>Local Bookmarks</span>
            <span class="text-[10px] lowercase opacity-70">{{ localBookmarks.length }} saved</span>
          </div>
          <div v-if="localBookmarks.length === 0" class="px-3 py-2 text-xs italic" :style="{ color: 'var(--color-text-muted)' }">
            No bookmarks yet. Click bookmark icon to save current folder.
          </div>
          <div v-else class="max-h-48 overflow-y-auto space-y-0.5">
            <div
              v-for="b in localBookmarks"
              :key="b"
              class="flex items-center justify-between px-2 py-1.5 rounded-lg group hover:bg-slate-700/40 transition cursor-pointer"
              @click="emit('navigate-to', b); showBookmarksMenu = false"
            >
              <div class="flex items-center space-x-2 min-w-0 mr-1">
                <Folder class="w-3.5 h-3.5 shrink-0 text-amber-400" />
                <span class="font-mono text-[11px] truncate" :style="{ color: 'var(--color-text-main)' }">{{ b }}</span>
              </div>
              <button
                @click.stop="emit('toggle-bookmark', b)"
                title="Remove"
                class="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 text-slate-400 transition"
              >
                <X class="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Local In-Pane Live Filter Bar (Ctrl+F) -->
    <div
      v-if="showFilter"
      class="px-3 py-1.5 border-b flex items-center space-x-2 transition-all duration-150 animate-in fade-in slide-in-from-top-1"
      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
    >
      <div
        class="flex-1 flex items-center space-x-2 px-2.5 py-1 rounded-lg border transition-colors duration-150"
        :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
      >
        <Search class="w-3.5 h-3.5 shrink-0 select-none opacity-60" :style="{ color: 'var(--color-accent)' }" />
        <input
          ref="filterInputRef"
          :value="searchQuery"
          @input="emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
          @keydown.esc.stop="emit('filter-esc')"
          @keydown.down.prevent="emit('focus-first-item')"
          @keydown.enter.prevent="emit('focus-first-item')"
          placeholder="Filter files by name... (Esc to clear, ↓ to select)"
          class="flex-1 bg-transparent text-xs font-mono focus:outline-none truncate"
          :style="{ color: 'var(--color-text-main)' }"
        />
        <button
          v-if="searchQuery"
          @click="emit('update:searchQuery', ''); filterInputRef?.focus()"
          class="p-0.5 rounded text-xs opacity-60 hover:opacity-100 transition"
          :style="{ color: 'var(--color-text-muted)' }"
          title="Clear filter"
        >
          <X class="w-3.5 h-3.5" />
        </button>
      </div>
      <div class="flex items-center space-x-1.5 shrink-0">
        <span
          v-if="searchQuery"
          class="text-[10px] font-mono px-1.5 py-0.5 rounded border"
          :style="{
            backgroundColor: filteredFiles.length > 0 ? 'var(--color-bg-pane)' : 'rgba(239, 68, 68, 0.1)',
            borderColor: filteredFiles.length > 0 ? 'var(--color-border)' : 'rgba(239, 68, 68, 0.3)',
            color: filteredFiles.length > 0 ? 'var(--color-text-muted)' : '#f87171'
          }"
        >
          {{ filteredFiles.length }} found
        </span>
        <button
          @click="emit('update:showFilter', false); emit('update:searchQuery', '')"
          class="p-1 rounded text-xs opacity-60 hover:opacity-100 transition hover:bg-white/5"
          :style="{ color: 'var(--color-text-muted)' }"
          title="Close filter (Esc)"
        >
          <X class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>

    <!-- Local File List Table -->
    <div
      class="flex-1 overflow-auto"
      @click="handleContainerClick"
      @dragover="emit('dragover', $event)"
      @drop="emit('drop', $event)"
      @contextmenu="handleContainerContextMenu"
    >
      <div v-if="sftpStore.isLoadingLocal" class="flex items-center justify-center p-8 text-xs" :style="{ color: 'var(--color-text-muted)' }">
        <span class="animate-spin w-4 h-4 border-2 border-slate-600 rounded-full mr-2" :style="{ borderTopColor: 'var(--color-accent)' }" />
        Reading local directory...
      </div>
      <div v-else-if="sftpStore.localError" class="flex flex-col items-center justify-center p-8 text-center">
        <div class="w-10 h-10 rounded-xl bg-red-950/60 border border-red-800/60 flex items-center justify-center text-red-400 mb-2">
          ⚠️
        </div>
        <p class="text-xs font-semibold text-red-300 mb-1">Failed to read local directory</p>
        <p class="text-[11px] text-red-400/80 max-w-sm mb-4 font-mono break-all">{{ sftpStore.localError }}</p>
        <button
          @click="emit('refresh')"
          class="px-3 py-1.5 rounded-lg border text-xs font-medium transition"
          :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
        >
          🔄 Retry
        </button>
      </div>
      <table
        v-else
        class="min-w-[620px] w-full text-left border-collapse select-none"
        @dragover="emit('dragover', $event)"
        @drop="emit('drop', $event)"
        :style="{
          fontFamily: settingsStore.browserFontFamily,
          fontSize: `${settingsStore.browserFontSize}px`,
        }"
      >
        <thead
          class="sticky top-0 backdrop-blur-sm border-b text-[0.88em] z-10 shadow-sm transition-colors duration-150"
          :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
        >
          <tr>
            <th
              :class="[rowPaddingClass, 'font-medium min-w-[220px] cursor-pointer select-none hover:text-[var(--color-text-main)] transition-colors']"
              :style="sortBy === 'name' ? { color: 'var(--color-accent)' } : undefined"
              @click="emit('sort', 'name')"
              :title="sortBy === 'name' ? (sortOrder === 'asc' ? 'Sorted by Name (Ascending) - Click to sort Descending' : 'Sorted by Name (Descending) - Click to sort Ascending') : 'Sort by Name'"
            >
              <div class="flex items-center gap-1.5">
                <span :class="{ 'font-semibold': sortBy === 'name' }">Name</span>
                <ArrowUp v-if="sortBy === 'name' && sortOrder === 'asc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent)' }" />
                <ArrowDown v-else-if="sortBy === 'name' && sortOrder === 'desc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent)' }" />
              </div>
            </th>
            <th
              :class="[cellPaddingClass, 'w-28 min-w-[90px] font-medium whitespace-nowrap cursor-pointer select-none hover:text-[var(--color-text-main)] transition-colors']"
              :style="sortBy === 'type' ? { color: 'var(--color-accent)' } : undefined"
              @click="emit('sort', 'type')"
              :title="sortBy === 'type' ? (sortOrder === 'asc' ? 'Sorted by Type (Ascending) - Click to sort Descending' : 'Sorted by Type (Descending) - Click to sort Ascending') : 'Sort by Type'"
            >
              <div class="flex items-center gap-1.5">
                <span :class="{ 'font-semibold': sortBy === 'type' }">Type</span>
                <ArrowUp v-if="sortBy === 'type' && sortOrder === 'asc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent)' }" />
                <ArrowDown v-else-if="sortBy === 'type' && sortOrder === 'desc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent)' }" />
              </div>
            </th>
            <th
              :class="[cellPaddingClass, 'w-24 min-w-[85px] font-medium text-right whitespace-nowrap cursor-pointer select-none hover:text-[var(--color-text-main)] transition-colors']"
              :style="sortBy === 'size' ? { color: 'var(--color-accent)' } : undefined"
              @click="emit('sort', 'size')"
              :title="sortBy === 'size' ? (sortOrder === 'asc' ? 'Sorted by Size (Ascending) - Click to sort Descending' : 'Sorted by Size (Descending) - Click to sort Ascending') : 'Sort by Size'"
            >
              <div class="flex items-center justify-end gap-1.5">
                <ArrowUp v-if="sortBy === 'size' && sortOrder === 'asc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent)' }" />
                <ArrowDown v-else-if="sortBy === 'size' && sortOrder === 'desc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent)' }" />
                <span :class="{ 'font-semibold': sortBy === 'size' }">Size</span>
              </div>
            </th>
            <th
              :class="[cellPaddingClass, 'w-36 min-w-[130px] font-medium whitespace-nowrap cursor-pointer select-none hover:text-[var(--color-text-main)] transition-colors']"
              :style="sortBy === 'modified' ? { color: 'var(--color-accent)' } : undefined"
              @click="emit('sort', 'modified')"
              :title="sortBy === 'modified' ? (sortOrder === 'asc' ? 'Sorted by Modified (Ascending) - Click to sort Descending' : 'Sorted by Modified (Descending) - Click to sort Ascending') : 'Sort by Modified'"
            >
              <div class="flex items-center gap-1.5">
                <span :class="{ 'font-semibold': sortBy === 'modified' }">Modified</span>
                <ArrowUp v-if="sortBy === 'modified' && sortOrder === 'asc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent)' }" />
                <ArrowDown v-else-if="sortBy === 'modified' && sortOrder === 'desc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: 'var(--color-accent)' }" />
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <!-- FileZilla-style Parent Directory Entry (📁 ..) -->
          <tr
            v-if="canNavigateUp"
            id="local-row-parent"
            @dblclick="emit('navigate-up')"
            @click="emit('parent-click')"
            @contextmenu.prevent.stop="emit('close-context-menu')"
            @dragover="emit('parent-folder-dragover', $event)"
            @dragleave="emit('parent-folder-dragleave')"
            @drop="emit('parent-folder-drop', $event)"
            class="group cursor-pointer select-none file-row"
            :style="activeDropFolder?.pane === 'local' && activeDropFolder?.path === parentPath
              ? { backgroundColor: 'var(--color-bg-hover)', borderLeft: '3px solid var(--color-accent)', color: 'var(--color-text-main)' }
              : isParentSelected
              ? { backgroundColor: 'var(--color-bg-hover)', borderLeft: '3px solid var(--color-accent)', color: 'var(--color-text-main)' }
              : { borderLeft: '3px solid transparent', color: 'var(--color-text-main)' }"
            title="Double-click or press Enter to go to parent directory"
          >
            <td :class="[rowPaddingClass, 'whitespace-nowrap']">
              <div class="flex items-center space-x-1.5 leading-none">
                <FileIcon name=".." :is-dir="true" :is-open="activeDropFolder?.pane === 'local' && activeDropFolder?.path === parentPath" :size="15" />
                <span class="font-bold text-sm tracking-wide leading-tight" :style="{ color: 'var(--color-text-main)' }">..</span>
              </div>
            </td>
            <td :class="[cellPaddingClass, 'text-[0.92em] whitespace-nowrap']" :style="{ color: 'var(--color-text-muted)' }">
              Folder
            </td>
            <td :class="[cellPaddingClass, 'text-right font-mono text-[0.92em] whitespace-nowrap']" :style="{ color: 'var(--color-text-muted)' }">
              -
            </td>
            <td :class="[cellPaddingClass, 'text-[0.92em] whitespace-nowrap']" :style="{ color: 'var(--color-text-muted)' }">
              -
            </td>
          </tr>

          <tr v-if="filteredFiles.length === 0" @dragover="emit('dragover', $event)" @drop="emit('drop', $event)">
            <td colspan="4" class="py-8 text-center italic" :style="{ color: 'var(--color-text-muted)' }">
              <template v-if="searchQuery">
                No files matching "<span class="font-semibold text-amber-300 font-mono">{{ searchQuery }}</span>"
                <button @click="emit('update:searchQuery', '')" class="ml-2 underline text-xs not-italic cursor-pointer hover:opacity-80" :style="{ color: 'var(--color-accent)' }">
                  Clear filter
                </button>
              </template>
              <template v-else-if="isComparing && hideIdenticalFiles">
                All {{ sftpStore.localFiles.length }} files match remote (identical files are hidden)
                <button @click="$emit('toggle-comparison')" class="ml-2 underline text-xs not-italic cursor-pointer hover:opacity-80" :style="{ color: 'var(--color-accent)' }">
                  Show all files
                </button>
              </template>
              <template v-else>
                Folder is empty
              </template>
            </td>
          </tr>
          <tr
            v-for="(file, index) in filteredFiles"
            :key="file.path"
            :id="`local-row-${index}`"
            draggable="true"
            @dragstart="emit('dragstart', $event, file)"
            @dragend="emit('dragend')"
            @click="emit('row-click', $event, file, index)"
            @contextmenu="emit('contextmenu', $event, file)"
            @dblclick="emit('row-dblclick', file)"
            @dragover="file.is_dir ? emit('folder-dragover', $event, file) : emit('dragover', $event)"
            @dragleave="file.is_dir ? emit('folder-dragleave', file) : undefined"
            @drop="file.is_dir ? emit('folder-drop', $event, file) : emit('drop', $event)"
            class="group cursor-pointer select-none file-row"
            :style="getRowStyle(true, file.path, file)"
          >
            <td :class="[rowPaddingClass, 'whitespace-nowrap']" :title="file.name">
              <div class="flex items-center space-x-1.5 leading-none">
                <FileIcon :name="file.name" :is-dir="file.is_dir" :is-open="activeDropFolder?.path === file.path" :size="15" />
                <span v-if="searchQuery && highlightMatch(file.name, searchQuery)" class="font-normal truncate leading-tight" :style="{ color: 'var(--color-text-main)' }">
                  <span>{{ highlightMatch(file.name, searchQuery)!.before }}</span>
                  <span class="bg-amber-400/30 text-amber-300 font-semibold rounded px-0.5">{{ highlightMatch(file.name, searchQuery)!.match }}</span>
                  <span>{{ highlightMatch(file.name, searchQuery)!.after }}</span>
                </span>
                <span v-else class="font-normal truncate leading-tight" :style="{ color: 'var(--color-text-main)' }">{{ file.name }}</span>

                <!-- Symlink Target Indicator -->
                <span
                  v-if="file.is_symlink"
                  class="text-[10px] font-mono opacity-70 flex items-center gap-1 shrink-0"
                  :style="{ color: 'var(--color-accent)' }"
                  :title="file.symlink_target ? `Symlink to: ${file.symlink_target}` : 'Symbolic Link'"
                >
                  <span class="opacity-60">➔</span>
                  <span v-if="file.symlink_target" class="truncate max-w-[140px] underline decoration-dotted">{{ file.symlink_target }}</span>
                </span>

                <!-- Comparison Status Badge -->
                <SftpComparisonBadge
                  v-if="isComparing"
                  :info="comparisonResult?.localMap.get(file.name)"
                  :file-size="file.size"
                  pane="local"
                />

                <!-- Git Status Overlay Badge -->
                <span
                  v-if="getGitStatus(true, file)"
                  class="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold flex-shrink-0"
                  :class="{
                    'text-amber-400 bg-amber-950/60 border border-amber-800/60': getGitStatus(true, file) === 'modified',
                    'text-emerald-400 bg-emerald-950/60 border border-emerald-800/60': getGitStatus(true, file) === 'untracked',
                    'text-cyan-400 bg-cyan-950/60 border border-cyan-800/60': getGitStatus(true, file) === 'staged',
                    'text-red-400 bg-red-950/60 border border-red-800/60': getGitStatus(true, file) === 'deleted',
                    'text-purple-400 bg-purple-950/60 border border-purple-800/60': getGitStatus(true, file) === 'renamed',
                    'text-amber-300/80 bg-amber-950/30 border border-amber-900/40': getGitStatus(true, file) === 'has-changes',
                  }"
                  :title="`Git: ${getGitStatus(true, file)}`"
                >
                  {{ getGitStatus(true, file) === 'modified' ? 'M' : getGitStatus(true, file) === 'untracked' ? 'U' : getGitStatus(true, file) === 'staged' ? 'S' : getGitStatus(true, file) === 'deleted' ? 'D' : getGitStatus(true, file) === 'renamed' ? 'R' : '●' }}
                </span>
              </div>
            </td>
            <td :class="[cellPaddingClass, 'text-[0.92em] whitespace-nowrap']" :style="{ color: 'var(--color-text-muted)' }">
              {{ getFileType(file) }}
            </td>
            <td :class="[cellPaddingClass, 'text-right font-mono text-[0.92em] whitespace-nowrap']" :style="{ color: 'var(--color-text-muted)' }">
              <span
                v-if="file.is_dir && sftpStore.calculatedDirSizes[file.path] !== undefined"
                :title="`Calculated Directory Size: ${formatBytes(sftpStore.calculatedDirSizes[file.path])}`"
                :style="{ color: 'var(--color-accent)' }"
                class="font-semibold"
              >
                {{ formatBytes(sftpStore.calculatedDirSizes[file.path]) }}
              </span>
              <span v-else>
                {{ file.is_dir ? '-' : formatBytes(file.size) }}
              </span>
            </td>
            <td :class="[cellPaddingClass, 'text-[0.92em] whitespace-nowrap']" :style="{ color: 'var(--color-text-muted)' }">
              {{ formatDate(file.modified) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
