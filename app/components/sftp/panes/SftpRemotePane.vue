<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
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
  Monitor,
  Globe,
  Check,
} from 'lucide-vue-next'
import { useSftpStore, type SftpFileEntry } from '../../../stores/sftp'
import { useSettingsStore } from '../../../stores/settings'
import { useSshStore } from '../../../stores/ssh'
import FileIcon from '../../FileIcon.vue'
import CatppuccinIcon from '../../CatppuccinIcon.vue'
import SftpBreadcrumbBar from './SftpBreadcrumbBar.vue'
import SftpComparisonBadge from '../compare/SftpComparisonBadge.vue'
import type { ComparisonResult } from '../compare/types'
import type { FileSortField, FileSortOrder } from './sorting'
import {
  formatBytes,
  formatDate,
  getFileType,
  formatPermissions,
  formatOctalPermissions,
  formatOwnerGroup,
  highlightMatch,
} from '../../../utils/formatters'

const props = defineProps<{
  active: boolean
  widthPercent: number
  sessionId: string | null
  isComparing: boolean
  hideIdenticalFiles: boolean
  comparisonResult: ComparisonResult | null
  showHiddenFiles: boolean
  selectedPaths: Set<string>
  selectedFiles: SftpFileEntry[]
  filteredFiles: SftpFileEntry[]
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
  remoteBookmarks: string[]
  currentPath: string
  getRowStyle: (isLocal: boolean, path: string, file: SftpFileEntry) => Record<string, any>
  getGitStatus: (isLocal: boolean, file: SftpFileEntry) => string | null
  allowSwitchSource?: boolean
  currentSource?: string
  isLeftPane?: boolean
  isLoading?: boolean
  remoteError?: string | null
  totalCount?: number
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
  (e: 'reconnect'): void
  (e: 'new-file'): void
  (e: 'new-folder'): void
  (e: 'open-search'): void
  (e: 'permissions', file: SftpFileEntry): void
  (e: 'batch-download', files: SftpFileEntry[]): void
  (e: 'batch-delete', files: SftpFileEntry[]): void
  (e: 'row-click', event: MouseEvent, file: SftpFileEntry, index: number): void
  (e: 'row-dblclick', file: SftpFileEntry): void
  (e: 'parent-click'): void
  (e: 'close-context-menu'): void
  (e: 'contextmenu', event: MouseEvent, file?: SftpFileEntry): void
  (e: 'dragstart', event: DragEvent, file: SftpFileEntry): void
  (e: 'dragend'): void
  (e: 'dragover', event: DragEvent): void
  (e: 'dragenter', event: DragEvent): void
  (e: 'dragleave', event: DragEvent): void
  (e: 'drop', event: DragEvent): void
  (e: 'folder-dragover', event: DragEvent, file: SftpFileEntry): void
  (e: 'folder-dragleave', file: SftpFileEntry): void
  (e: 'folder-drop', event: DragEvent, file: SftpFileEntry): void
  (e: 'parent-folder-dragover', event: DragEvent): void
  (e: 'parent-folder-dragleave'): void
  (e: 'parent-folder-drop', event: DragEvent): void
  (e: 'toggle-bookmark', path?: string): void
  (e: 'switch-source', source: 'local' | string): void
}>()

const sftpStore = useSftpStore()
const settingsStore = useSettingsStore()
const sshStore = useSshStore()

const showSourceDropdown = ref(false)
const sourceDropdownRef = ref<HTMLElement | null>(null)

const toggleSourceDropdown = () => {
  if (!props.allowSwitchSource) return
  showSourceDropdown.value = !showSourceDropdown.value
}

const handleSelectSource = (src: 'local' | string) => {
  showSourceDropdown.value = false
  emit('switch-source', src)
}

const handleDocumentClick = (e: MouseEvent) => {
  if (sourceDropdownRef.value && !sourceDropdownRef.value.contains(e.target as Node)) {
    showSourceDropdown.value = false
  }
}

onMounted(() => {
  window.addEventListener('click', handleDocumentClick)
})

onUnmounted(() => {
  window.removeEventListener('click', handleDocumentClick)
})

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

const currentSession = computed(() => sshStore.sessions.find(s => s.sessionId === props.sessionId))
const protocolLabel = computed(() => {
  if (currentSession.value?.protocol === 'ftps') return 'Remote FTPS'
  if (currentSession.value?.protocol === 'ftp') return 'Remote FTP'
  return 'Remote SFTP'
})

const sessionDisplayLabel = computed(() => {
  if (!currentSession.value) return protocolLabel.value
  const s = currentSession.value
  return `${s.username}@${s.host}`
})

const rootEl = ref<HTMLElement | null>(null)
const filterInputRef = ref<HTMLInputElement | null>(null)

// Address bar input path
const inputPath = ref(props.currentPath)

const syncInputPath = (p: string) => {
  inputPath.value = p
}

// Bookmarks Menu state
const showBookmarksMenu = ref(false)
const isBookmarked = computed(() => props.remoteBookmarks.includes(props.currentPath))

const closeAllDropdowns = () => {
  showBookmarksMenu.value = false
}

const breadcrumbBarRef = ref<InstanceType<typeof SftpBreadcrumbBar> | null>(null)
const startEditPath = () => {
  breadcrumbBarRef.value?.startEditing()
}

const focusFilterInput = () => {
  filterInputRef.value?.focus()
  filterInputRef.value?.select()
}

defineExpose({
  rootEl,
  filterInputRef,
  syncInputPath,
  closeAllDropdowns,
  startEditPath,
  focusFilterInput,
})
</script>

<template>
  <div
    ref="rootEl"
    class="flex flex-col h-full overflow-hidden relative transition-colors duration-150 flex-1 min-w-0"
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
    <!-- Remote Header Toolbar -->
    <div
      class="flex items-center justify-between px-3 h-9 border-b transition-colors duration-150 shrink-0"
      :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)' }"
    >
      <div class="flex items-center space-x-2">
        <span
          class="w-2 h-2 rounded-full transition-all duration-150 shrink-0"
          :class="active ? 'opacity-100 scale-100 ring-2 ring-sky-500/40 shadow-sm shadow-sky-500/20' : 'opacity-25 scale-75'"
          :style="{ backgroundColor: 'var(--color-accent-secondary)' }"
          title="Active navigation pane"
        />
        <!-- Source Switcher Dropdown Button -->
        <div class="relative inline-block text-left" ref="sourceDropdownRef">
          <button
            @click.stop="toggleSourceDropdown"
            class="flex items-center gap-1.5 px-1.5 py-0.5 rounded transition hover:bg-zinc-500/10 focus:outline-none group select-none"
            :class="{ 'cursor-pointer': allowSwitchSource }"
            :title="allowSwitchSource ? 'Switch pane source (Local Files / Remote Sessions)' : ''"
          >
            <Globe class="w-3.5 h-3.5 opacity-80" :style="{ color: active ? 'var(--color-accent-secondary)' : 'var(--color-text-main)' }" />
            <span
              class="text-xs font-semibold transition-colors duration-150 truncate max-w-[160px]"
              :style="{ color: active ? 'var(--color-accent-secondary)' : 'var(--color-text-main)' }"
            >
              {{ sessionDisplayLabel }}
            </span>
            <ChevronDown
              v-if="allowSwitchSource && (isLeftPane || sshStore.sessions.length > 1)"
              class="w-3 h-3 transition-transform duration-200 opacity-60 group-hover:opacity-100"
              :class="{ 'rotate-180': showSourceDropdown }"
            />
          </button>

          <!-- Dropdown Menu -->
          <div
            v-if="showSourceDropdown"
            class="absolute left-0 mt-1 w-64 rounded-lg shadow-xl border py-1.5 z-50 text-xs backdrop-blur-md"
            :style="{
              backgroundColor: 'var(--color-bg-pane)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-main)'
            }"
            @click.stop
          >
            <div class="px-2.5 py-1 text-[10px] font-bold tracking-wider uppercase opacity-50">
              Select Pane Source
            </div>

            <!-- Option: Local Files (if allowed on this pane, e.g. left pane) -->
            <button
              v-if="isLeftPane"
              @click="handleSelectSource('local')"
              class="w-full text-left px-3 py-1.5 flex items-center justify-between transition hover:bg-sky-500/15"
              :class="{ 'font-semibold text-sky-500': currentSource === 'local' }"
            >
              <div class="flex items-center gap-2">
                <Monitor class="w-3.5 h-3.5 text-emerald-400" />
                <span>Local Files</span>
              </div>
              <Check v-if="currentSource === 'local'" class="w-3.5 h-3.5 text-sky-500" />
            </button>

            <!-- Remote Sessions -->
            <template v-if="sshStore.sessions.length > 0">
              <div
                v-if="isLeftPane"
                class="mt-1 pt-1 border-t px-2.5 py-1 text-[10px] font-bold tracking-wider uppercase opacity-50"
                :style="{ borderColor: 'var(--color-border)' }"
              >
                Remote Sessions
              </div>

              <button
                v-for="sess in sshStore.sessions"
                :key="sess.sessionId"
                @click="handleSelectSource(sess.sessionId)"
                class="w-full text-left px-3 py-1.5 flex items-center justify-between transition hover:bg-sky-500/15"
                :class="{ 'font-semibold text-sky-500': (currentSource || sessionId) === sess.sessionId }"
              >
                <div class="flex items-center gap-2 truncate">
                  <Globe class="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <span class="truncate">
                    {{ sess.username }}@{{ sess.host }}
                    <span class="text-[10px] opacity-60">({{ (sess.protocol || 'sftp').toUpperCase() }})</span>
                  </span>
                </div>
                <Check v-if="(currentSource || sessionId) === sess.sessionId" class="w-3.5 h-3.5 text-sky-500 shrink-0" />
              </button>
            </template>
          </div>
        </div>

        <span v-if="sessionId" class="text-[11px] font-mono" :style="{ color: 'var(--color-text-muted)' }">
          ({{ selectedPaths.size > 0 ? `${selectedPaths.size} of ` : '' }}{{ searchQuery || (isComparing && hideIdenticalFiles) ? `${filteredFiles.length} of ${totalCount ?? (isLeftPane ? filteredFiles.length : sftpStore.remoteFiles.length)}` : `${totalCount ?? filteredFiles.length}` }} items)
        </span>
        <span v-else class="text-[11px] text-amber-500 font-medium">(Disconnected)</span>
      </div>

      <div v-if="sessionId" class="flex items-center space-x-1.5">
        <!-- Batch Actions for Remote Selection -->
        <template v-if="selectedFiles.length > 0">
          <button
            @click="emit('batch-download', selectedFiles)"
            :title="isLeftPane ? `Transfer ${selectedFiles.length} selected item(s) to right pane` : `Download ${selectedFiles.length} selected item(s) to local (Alt+F5)`"
            class="h-6 px-1.5 rounded text-xs transition flex items-center justify-center bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 shadow-sm"
          >
            <CatppuccinIcon name="download" :size="15" />
          </button>
          <button
            @click="emit('batch-delete', selectedFiles)"
            :title="`Delete ${selectedFiles.length} selected item(s) from server (F8 / Delete)`"
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
          :title="isComparing ? 'Exit Directory Comparison (Ctrl+Shift+C)' : 'Compare with Local Directory (Ctrl+Shift+C)'"
          class="p-1 rounded text-xs transition hover:opacity-80"
          :class="isComparing ? 'text-indigo-400 bg-indigo-500/10' : ''"
          :style="{ color: isComparing ? 'var(--color-accent-secondary)' : 'var(--color-text-muted)' }"
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
          :style="{ color: sftpStore.isSynchronizedBrowsing ? 'var(--color-accent-secondary)' : 'var(--color-text-muted)' }"
        >
          <FolderSync class="w-4 h-4" />
          <span v-if="sftpStore.isSynchronizedBrowsing" class="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-sky-500 dark:bg-sky-400 animate-pulse" />
        </button>

        <!-- Toggle In-Pane Search Filter (Ctrl+F) -->
        <button
          v-if="sessionId"
          @click="emit('toggle-filter')"
          :title="showFilter ? 'Close Filter (Ctrl+F)' : 'Filter remote files (Ctrl+F)'"
          class="p-1 rounded text-xs transition hover:opacity-80"
          :class="showFilter || searchQuery ? 'text-blue-400' : ''"
          :style="{ color: showFilter || searchQuery ? 'var(--color-accent-secondary)' : 'var(--color-text-muted)' }"
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
            :class="{ 'animate-spin': isLeftPane ? isLoading : (sftpStore.isBackgroundRefreshingRemote || sftpStore.isLoadingRemote) }"
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
          v-if="sessionId"
          @click="emit('new-file')"
          title="New File"
          class="p-1 rounded text-xs transition hover:opacity-80"
          :style="{ color: 'var(--color-text-muted)' }"
        >
          <CatppuccinIcon name="file" :size="15" />
        </button>
        <button
          v-if="sessionId"
          @click="emit('new-folder')"
          title="New Directory"
          class="p-1 rounded text-xs transition hover:opacity-80"
          :style="{ color: 'var(--color-text-muted)' }"
        >
          <CatppuccinIcon name="folder" :size="15" />
        </button>
        <button
          v-if="sessionId"
          @click="emit('open-search')"
          title="Recursive Remote Search & SSH Grep (Ctrl+Shift+F)"
          class="p-1 rounded text-xs transition hover:opacity-80 text-sky-600 dark:text-sky-400"
        >
          <Search class="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- Remote Path Breadcrumb Bar & Bookmarks -->
    <div
      class="h-8 flex items-center pr-2 transition-colors duration-150 shrink-0"
      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
    >
      <div class="flex-1 min-w-0">
        <SftpBreadcrumbBar
          v-if="sessionId"
          ref="breadcrumbBarRef"
          :path="currentPath"
          pane="remote"
          :active="active"
          :git-status="sftpStore.remoteGitStatus"
          placeholder="/var/www/..."
          @navigate-to="emit('navigate-to', $event)"
          @copy-path="emit('copy-path', $event)"
        />
        <div v-else class="px-3 py-2 text-xs italic flex items-center space-x-2" :style="{ color: 'var(--color-text-muted)' }">
          <CatppuccinIcon name="globe" :size="15" class="shrink-0 select-none opacity-50" />
          <span>Connect an SSH session to access remote SFTP files</span>
        </div>
      </div>

      <!-- Remote Bookmark Toggle & Dropdown -->
      <div v-if="sessionId" class="relative flex items-center space-x-1 shrink-0 pl-1.5">
        <button
          @click="emit('toggle-bookmark')"
          :title="isBookmarked ? 'Remove Bookmark' : 'Bookmark this remote folder'"
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
          title="Saved Remote Bookmarks"
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
            <span>Remote Bookmarks</span>
            <span class="text-[10px] lowercase opacity-70">{{ remoteBookmarks.length }} saved</span>
          </div>
          <div v-if="remoteBookmarks.length === 0" class="px-3 py-2 text-xs italic" :style="{ color: 'var(--color-text-muted)' }">
            No bookmarks yet. Click bookmark icon to save current folder.
          </div>
          <div v-else class="max-h-48 overflow-y-auto space-y-0.5">
            <div
              v-for="b in remoteBookmarks"
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

    <!-- Remote In-Pane Live Filter Bar (Ctrl+F) -->
    <div
      v-if="sessionId && showFilter"
      class="px-3 py-1.5 border-b flex items-center space-x-2 transition-all duration-150 animate-in fade-in slide-in-from-top-1"
      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
    >
      <div
        class="flex-1 flex items-center space-x-2 px-2.5 py-1 rounded-lg border transition-colors duration-150"
        :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
      >
        <Search class="w-3.5 h-3.5 shrink-0 select-none opacity-60" :style="{ color: 'var(--color-accent-secondary)' }" />
        <input
          ref="filterInputRef"
          :value="searchQuery"
          @input="emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
          @keydown.esc.stop="emit('filter-esc')"
          @keydown.down.prevent="emit('focus-first-item')"
          @keydown.enter.prevent="emit('focus-first-item')"
          placeholder="Filter remote files by name... (Esc to clear, ↓ to select)"
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

    <!-- Remote File List Table -->
    <div
      class="flex-1 overflow-auto"
      @click="handleContainerClick"
      @dragover="emit('dragover', $event)"
      @drop="emit('drop', $event)"
      @contextmenu="handleContainerContextMenu"
    >
      <div v-if="!sessionId" class="flex flex-col items-center justify-center p-12 text-center">
        <div
          class="w-12 h-12 rounded-2xl flex items-center justify-center mb-3 border shadow-sm"
          :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
        >
          <CatppuccinIcon name="lock" :size="24" />
        </div>
        <p class="text-xs font-medium" :style="{ color: 'var(--color-text-muted)' }">No active remote session</p>
        <p class="text-[11px] max-w-xs mt-1" :style="{ color: 'var(--color-text-muted)' }">
          Start or select an active SSH connection to browse and manage remote SFTP files.
        </p>
      </div>
      <div v-else-if="isLeftPane ? isLoading : sftpStore.isLoadingRemote" class="flex items-center justify-center p-8 text-xs" :style="{ color: 'var(--color-text-muted)' }">
        <span class="animate-spin w-4 h-4 border-2 border-slate-600 rounded-full mr-2" :style="{ borderTopColor: 'var(--color-accent-secondary)' }" />
        Reading remote directory...
      </div>
      <div v-else-if="isLeftPane ? remoteError : sftpStore.remoteError" class="flex flex-col items-center justify-center p-8 text-center">
        <div class="w-10 h-10 rounded-xl bg-red-950/60 border border-red-800/60 flex items-center justify-center text-red-400 mb-2">
          ⚠️
        </div>
        <p class="text-xs font-semibold text-red-300 mb-1">Failed to read remote directory</p>
        <p class="text-[11px] text-red-400/80 max-w-sm mb-4 font-mono break-all">{{ isLeftPane ? remoteError : sftpStore.remoteError }}</p>
        <div class="flex items-center space-x-2">
          <button
            @click="emit('reconnect')"
            class="px-3 py-1.5 rounded-lg border text-xs font-semibold transition flex items-center space-x-1.5 shadow-sm hover:opacity-90 cursor-pointer text-amber-200 bg-amber-900/50 border-amber-600/60"
          >
            <span>🔄</span>
            <span>Reconnect Now</span>
          </button>
          <button
            @click="emit('refresh')"
            class="px-3 py-1.5 rounded-lg border text-xs font-medium transition cursor-pointer"
            :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
          >
            Retry
          </button>
        </div>
      </div>
      <table
        v-else
        class="min-w-[760px] w-full text-left border-collapse select-none"
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
              :class="[rowPaddingClass, 'font-medium min-w-[190px] cursor-pointer select-none hover:text-[var(--color-text-main)] transition-colors']"
              :style="sortBy === 'name' ? { color: isLeftPane ? 'var(--color-accent)' : 'var(--color-accent-secondary)' } : undefined"
              @click="emit('sort', 'name')"
              :title="sortBy === 'name' ? (sortOrder === 'asc' ? 'Sorted by Name (Ascending) - Click to sort Descending' : 'Sorted by Name (Descending) - Click to sort Ascending') : 'Sort by Name'"
            >
              <div class="flex items-center gap-1.5">
                <span :class="{ 'font-semibold': sortBy === 'name' }">Name</span>
                <ArrowUp v-if="sortBy === 'name' && sortOrder === 'asc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: isLeftPane ? 'var(--color-accent)' : 'var(--color-accent-secondary)' }" />
                <ArrowDown v-else-if="sortBy === 'name' && sortOrder === 'desc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: isLeftPane ? 'var(--color-accent)' : 'var(--color-accent-secondary)' }" />
              </div>
            </th>
            <th
              :class="[cellPaddingClass, 'w-24 min-w-[75px] font-medium whitespace-nowrap cursor-pointer select-none hover:text-[var(--color-text-main)] transition-colors']"
              :style="sortBy === 'type' ? { color: isLeftPane ? 'var(--color-accent)' : 'var(--color-accent-secondary)' } : undefined"
              @click="emit('sort', 'type')"
              :title="sortBy === 'type' ? (sortOrder === 'asc' ? 'Sorted by Type (Ascending) - Click to sort Descending' : 'Sorted by Type (Descending) - Click to sort Ascending') : 'Sort by Type'"
            >
              <div class="flex items-center gap-1.5">
                <span :class="{ 'font-semibold': sortBy === 'type' }">Type</span>
                <ArrowUp v-if="sortBy === 'type' && sortOrder === 'asc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: isLeftPane ? 'var(--color-accent)' : 'var(--color-accent-secondary)' }" />
                <ArrowDown v-else-if="sortBy === 'type' && sortOrder === 'desc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: isLeftPane ? 'var(--color-accent)' : 'var(--color-accent-secondary)' }" />
              </div>
            </th>
            <th
              :class="[cellPaddingClass, 'w-24 min-w-[80px] font-medium text-right whitespace-nowrap cursor-pointer select-none hover:text-[var(--color-text-main)] transition-colors']"
              :style="sortBy === 'size' ? { color: isLeftPane ? 'var(--color-accent)' : 'var(--color-accent-secondary)' } : undefined"
              @click="emit('sort', 'size')"
              :title="sortBy === 'size' ? (sortOrder === 'asc' ? 'Sorted by Size (Ascending) - Click to sort Descending' : 'Sorted by Size (Descending) - Click to sort Ascending') : 'Sort by Size'"
            >
              <div class="flex items-center justify-end gap-1.5">
                <ArrowUp v-if="sortBy === 'size' && sortOrder === 'asc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: isLeftPane ? 'var(--color-accent)' : 'var(--color-accent-secondary)' }" />
                <ArrowDown v-else-if="sortBy === 'size' && sortOrder === 'desc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: isLeftPane ? 'var(--color-accent)' : 'var(--color-accent-secondary)' }" />
                <span :class="{ 'font-semibold': sortBy === 'size' }">Size</span>
              </div>
            </th>
            <th
              :class="[cellPaddingClass, 'w-36 min-w-[125px] font-medium whitespace-nowrap cursor-pointer select-none hover:text-[var(--color-text-main)] transition-colors']"
              :style="sortBy === 'modified' ? { color: isLeftPane ? 'var(--color-accent)' : 'var(--color-accent-secondary)' } : undefined"
              @click="emit('sort', 'modified')"
              :title="sortBy === 'modified' ? (sortOrder === 'asc' ? 'Sorted by Modified (Ascending) - Click to sort Descending' : 'Sorted by Modified (Descending) - Click to sort Ascending') : 'Sort by Modified'"
            >
              <div class="flex items-center gap-1.5">
                <span :class="{ 'font-semibold': sortBy === 'modified' }">Modified</span>
                <ArrowUp v-if="sortBy === 'modified' && sortOrder === 'asc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: isLeftPane ? 'var(--color-accent)' : 'var(--color-accent-secondary)' }" />
                <ArrowDown v-else-if="sortBy === 'modified' && sortOrder === 'desc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: isLeftPane ? 'var(--color-accent)' : 'var(--color-accent-secondary)' }" />
              </div>
            </th>
            <th
              :class="[cellPaddingClass, 'w-28 min-w-[105px] font-medium whitespace-nowrap font-mono cursor-pointer select-none hover:text-[var(--color-text-main)] transition-colors']"
              :style="sortBy === 'permissions' ? { color: isLeftPane ? 'var(--color-accent)' : 'var(--color-accent-secondary)' } : undefined"
              @click="emit('sort', 'permissions')"
              :title="sortBy === 'permissions' ? (sortOrder === 'asc' ? 'Sorted by Permissions (Ascending) - Click to sort Descending' : 'Sorted by Permissions (Descending) - Click to sort Ascending') : 'Sort by Permissions'"
            >
              <div class="flex items-center gap-1.5">
                <span :class="{ 'font-semibold': sortBy === 'permissions' }">Permissions</span>
                <ArrowUp v-if="sortBy === 'permissions' && sortOrder === 'asc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: isLeftPane ? 'var(--color-accent)' : 'var(--color-accent-secondary)' }" />
                <ArrowDown v-else-if="sortBy === 'permissions' && sortOrder === 'desc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: isLeftPane ? 'var(--color-accent)' : 'var(--color-accent-secondary)' }" />
              </div>
            </th>
            <th
              :class="[cellPaddingClass, 'w-28 min-w-[95px] font-medium whitespace-nowrap cursor-pointer select-none hover:text-[var(--color-text-main)] transition-colors']"
              :style="sortBy === 'owner' ? { color: isLeftPane ? 'var(--color-accent)' : 'var(--color-accent-secondary)' } : undefined"
              @click="emit('sort', 'owner')"
              :title="sortBy === 'owner' ? (sortOrder === 'asc' ? 'Sorted by Owner / Group (Ascending) - Click to sort Descending' : 'Sorted by Owner / Group (Descending) - Click to sort Ascending') : 'Sort by Owner / Group'"
            >
              <div class="flex items-center gap-1.5">
                <span :class="{ 'font-semibold': sortBy === 'owner' }">Owner / Group</span>
                <ArrowUp v-if="sortBy === 'owner' && sortOrder === 'asc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: isLeftPane ? 'var(--color-accent)' : 'var(--color-accent-secondary)' }" />
                <ArrowDown v-else-if="sortBy === 'owner' && sortOrder === 'desc'" class="w-3.5 h-3.5 shrink-0" :style="{ color: isLeftPane ? 'var(--color-accent)' : 'var(--color-accent-secondary)' }" />
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <!-- FileZilla-style Parent Directory Entry (📁 ..) -->
          <tr
            v-if="canNavigateUp"
            :id="isLeftPane ? 'local-row-parent' : 'remote-row-parent'"
            @dblclick="emit('navigate-up')"
            @click="emit('parent-click')"
            @contextmenu.prevent.stop="emit('close-context-menu')"
            @dragover="emit('parent-folder-dragover', $event)"
            @dragleave="emit('parent-folder-dragleave')"
            @drop="emit('parent-folder-drop', $event)"
            class="group cursor-pointer select-none file-row"
            :style="activeDropFolder?.pane === (isLeftPane ? 'local' : 'remote') && activeDropFolder?.path === parentPath
              ? { backgroundColor: 'var(--color-bg-hover)', borderLeft: `3px solid ${isLeftPane ? 'var(--color-accent)' : 'var(--color-accent-secondary)'}`, color: 'var(--color-text-main)' }
              : isParentSelected
              ? { backgroundColor: 'var(--color-bg-hover)', borderLeft: `3px solid ${isLeftPane ? 'var(--color-accent)' : 'var(--color-accent-secondary)'}`, color: 'var(--color-text-main)' }
              : { borderLeft: '3px solid transparent', color: 'var(--color-text-main)' }"
            title="Double-click or press Enter to go to parent directory"
          >
            <td :class="[rowPaddingClass, 'whitespace-nowrap']">
              <div class="flex items-center space-x-1.5 leading-none">
                <FileIcon name=".." :is-dir="true" :is-open="activeDropFolder?.pane === (isLeftPane ? 'local' : 'remote') && activeDropFolder?.path === parentPath" :size="15" />
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
            <td :class="[cellPaddingClass, 'text-[0.88em] font-mono whitespace-nowrap']" :style="{ color: 'var(--color-text-muted)' }">
              -
            </td>
            <td :class="[cellPaddingClass, 'text-[0.88em] font-mono whitespace-nowrap']" :style="{ color: 'var(--color-text-muted)' }">
              -
            </td>
          </tr>

          <tr v-if="filteredFiles.length === 0" @dragover="emit('dragover', $event)" @drop="emit('drop', $event)">
            <td colspan="6" class="py-8 text-center italic" :style="{ color: 'var(--color-text-muted)' }">
              <template v-if="searchQuery">
                No files matching "<span class="font-semibold text-amber-300 font-mono">{{ searchQuery }}</span>"
                <button @click="emit('update:searchQuery', '')" class="ml-2 underline text-xs not-italic cursor-pointer hover:opacity-80" :style="{ color: isLeftPane ? 'var(--color-accent)' : 'var(--color-accent-secondary)' }">
                  Clear filter
                </button>
              </template>
              <template v-else-if="isComparing && hideIdenticalFiles">
                All {{ totalCount ?? (isLeftPane ? filteredFiles.length : sftpStore.remoteFiles.length) }} files match local (identical files are hidden)
                <button @click="$emit('toggle-comparison')" class="ml-2 underline text-xs not-italic cursor-pointer hover:opacity-80" :style="{ color: isLeftPane ? 'var(--color-accent)' : 'var(--color-accent-secondary)' }">
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
            :id="isLeftPane ? `local-row-${index}` : `remote-row-${index}`"
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
            :style="getRowStyle(!!isLeftPane, file.path, file)"
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
                  :style="{ color: 'var(--color-accent-secondary)' }"
                  :title="file.symlink_target ? `Symlink to: ${file.symlink_target}` : 'Symbolic Link'"
                >
                  <span class="opacity-60">➔</span>
                  <span v-if="file.symlink_target" class="truncate max-w-[140px] underline decoration-dotted">{{ file.symlink_target }}</span>
                </span>

                <!-- Comparison Status Badge -->
                <SftpComparisonBadge
                  v-if="isComparing"
                  :info="comparisonResult?.remoteMap.get(file.name)"
                  :file-size="file.size"
                  pane="remote"
                />

                <!-- Remote Git Status Overlay Badge -->
                <span
                  v-if="getGitStatus(false, file)"
                  class="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold flex-shrink-0"
                  :class="{
                    'text-amber-400 bg-amber-950/60 border border-amber-800/60': getGitStatus(false, file) === 'modified',
                    'text-emerald-400 bg-emerald-950/60 border border-emerald-800/60': getGitStatus(false, file) === 'untracked',
                    'text-cyan-400 bg-cyan-950/60 border border-cyan-800/60': getGitStatus(false, file) === 'staged',
                    'text-red-400 bg-red-950/60 border border-red-800/60': getGitStatus(false, file) === 'deleted',
                    'text-purple-400 bg-purple-950/60 border border-purple-800/60': getGitStatus(false, file) === 'renamed',
                    'text-amber-300/80 bg-amber-950/30 border border-amber-900/40': getGitStatus(false, file) === 'has-changes',
                  }"
                  :title="`Git: ${getGitStatus(false, file)}`"
                >
                  {{ getGitStatus(false, file) === 'modified' ? 'M' : getGitStatus(false, file) === 'untracked' ? 'U' : getGitStatus(false, file) === 'staged' ? 'S' : getGitStatus(false, file) === 'deleted' ? 'D' : getGitStatus(false, file) === 'renamed' ? 'R' : '●' }}
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
                :style="{ color: 'var(--color-accent-secondary)' }"
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
            <td
              :class="[cellPaddingClass, 'text-[0.88em] font-mono whitespace-nowrap cursor-pointer hover:underline']"
              :style="{ color: 'var(--color-text-muted)' }"
              @click.stop="emit('permissions', file)"
              :title="`Click to edit: chmod ${formatOctalPermissions(file.permissions, file.is_dir)} (${formatPermissions(file.permissions, file.is_dir, file.is_symlink)})`"
            >
              <span class="opacity-90">{{ formatPermissions(file.permissions, file.is_dir, file.is_symlink) }}</span>
            </td>
            <td
              :class="[cellPaddingClass, 'text-[0.88em] font-mono whitespace-nowrap truncate max-w-[130px]']"
              :style="{ color: 'var(--color-text-muted)' }"
              :title="formatOwnerGroup(file)"
            >
              {{ formatOwnerGroup(file) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
