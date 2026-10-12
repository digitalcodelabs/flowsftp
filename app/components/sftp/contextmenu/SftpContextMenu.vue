<script setup lang="ts">
import { computed } from 'vue'
import {
  ExternalLink,
  Copy,
  Scissors,
  ClipboardPaste,
  Files,
  Hash,
  Link2,
  Calculator,
} from 'lucide-vue-next'
import { useSftpStore, type LocalFileEntry, type SftpFileEntry } from '../../../stores/sftp'
import { isArchiveFile } from '../../../utils/formatters'
import CatppuccinIcon from '../../CatppuccinIcon.vue'

const props = defineProps<{
  show: boolean
  x: number
  y: number
  pane: 'local' | 'remote'
  sessionId: string | null
  leftSessionId?: string | null
  selectedLocalFiles: LocalFileEntry[]
  selectedRemoteFiles: SftpFileEntry[]
  localBookmarks: string[]
  remoteBookmarks: string[]
  currentLocalPath: string
  currentRemotePath: string
  isComparing: boolean
  isLeftPaneRemote?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'batchUpload', files: LocalFileEntry[]): void
  (e: 'batchDownload', files: SftpFileEntry[]): void
  (e: 'quickLook', target: 'local' | 'remote', file: LocalFileEntry | SftpFileEntry): void
  (e: 'edit', target: 'local' | 'remote', file: LocalFileEntry | SftpFileEntry): void
  (e: 'openInExternalEditor', file: SftpFileEntry): void
  (e: 'pairFolder', localDir: string): void
  (e: 'searchRemote', remoteDir: string): void
  (e: 'openInDefaultApp', path: string): void
  (e: 'permissions', file: SftpFileEntry): void
  (e: 'openInTerminal', path: string): void
  (e: 'extractHere', target: 'local' | 'remote', file: LocalFileEntry | SftpFileEntry): void
  (e: 'extractToFolder', target: 'local' | 'remote', file: LocalFileEntry | SftpFileEntry): void
  (e: 'compress', target: 'local' | 'remote'): void
  (e: 'newFile', target: 'local' | 'remote'): void
  (e: 'newFolder', target: 'local' | 'remote'): void
  (e: 'newSymlink', target: 'local' | 'remote', item?: LocalFileEntry | SftpFileEntry): void
  (e: 'rename', target: 'local' | 'remote', file: LocalFileEntry | SftpFileEntry): void
  (e: 'copyPath', path: string): void
  (e: 'toggleBookmark', target: 'local' | 'remote', path?: string): void
  (e: 'toggleComparison'): void
  (e: 'selectAll', target: 'local' | 'remote'): void
  (e: 'batchDeleteLocal', files: LocalFileEntry[]): void
  (e: 'batchDeleteRemote', files: SftpFileEntry[]): void
  (e: 'refresh', target: 'local' | 'remote'): void
  (e: 'copy', target: 'local' | 'remote', files: (LocalFileEntry | SftpFileEntry)[]): void
  (e: 'cut', target: 'local' | 'remote', files: (LocalFileEntry | SftpFileEntry)[]): void
  (e: 'paste', target: 'local' | 'remote', targetDir?: string): void
  (e: 'duplicate', target: 'local' | 'remote', file: LocalFileEntry | SftpFileEntry): void
  (e: 'calculateDirSize', target: 'local' | 'remote', path: string): void
  (e: 'calculateChecksum', target: 'local' | 'remote', file: LocalFileEntry | SftpFileEntry): void
}>()

const sftpStore = useSftpStore()
const hasClipboard = computed(() => !!sftpStore.clipboard && sftpStore.clipboard.files.length > 0)
const clipboardDesc = computed(() => {
  if (!sftpStore.clipboard) return ''
  const count = sftpStore.clipboard.files.length
  return `(${count} item${count > 1 ? 's' : ''})`
})

const isTargetRemote = computed(() => props.pane === 'remote' || !!props.isLeftPaneRemote)
const activeRemoteFiles = computed(() =>
  props.pane === 'local'
    ? (props.selectedLocalFiles as unknown as SftpFileEntry[])
    : props.selectedRemoteFiles
)
const activeSessionId = computed(() =>
  props.pane === 'local'
    ? (props.isLeftPaneRemote ? (props.leftSessionId || props.sessionId) : null)
    : props.sessionId
)
const activePath = computed(() =>
  props.pane === 'local' ? props.currentLocalPath : props.currentRemotePath
)
const isFolderBookmarked = computed(() => {
  const bookmarks = props.pane === 'local' ? props.localBookmarks : props.remoteBookmarks
  return bookmarks.includes(activePath.value)
})

const isLocalBookmarked = computed(() => props.localBookmarks.includes(props.currentLocalPath))

const selectedCount = computed(() =>
  props.pane === 'local' ? props.selectedLocalFiles.length : props.selectedRemoteFiles.length
)

const currentFolderBasename = computed(() => {
  const p = activePath.value
  if (!p || p === '/' || p === 'C:/' || p === 'C:\\') return p || 'Root'
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || p
})

const menuHeaderTitle = computed(() => {
  if (selectedCount.value === 0) {
    return currentFolderBasename.value
  }
  if (selectedCount.value === 1) {
    const file = props.pane === 'local' ? props.selectedLocalFiles[0] : props.selectedRemoteFiles[0]
    return file?.name || '1 item'
  }
  return `${selectedCount.value} items selected`
})

const menuHeaderBadge = computed(() => {
  if (selectedCount.value === 0) {
    return isTargetRemote.value ? 'Remote Folder' : 'Local Folder'
  }
  if (selectedCount.value === 1) {
    const file = props.pane === 'local' ? props.selectedLocalFiles[0] : props.selectedRemoteFiles[0]
    return file?.is_dir ? 'Directory' : 'File'
  }
  return 'Selection'
})
</script>

<template>
  <!-- Custom Right-Click Context Menu -->
  <div
    v-if="show"
    :style="{
      left: `${x}px`,
      top: `${y}px`,
      backgroundColor: 'var(--color-bg-card)',
      borderColor: 'var(--color-border)',
    }"
    class="context-menu-box fixed z-[90] min-w-[250px] max-w-[285px] backdrop-blur-xl rounded-2xl border p-1.5 text-xs select-none animate-in fade-in zoom-in-95 duration-75 shadow-2xl"
    @click.stop
  >
    <!-- Context Menu Header: Context / Path Identifier -->
    <div
      class="px-2.5 py-1 mb-1 border-b flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider select-none"
      :style="{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
    >
      <div class="flex items-center space-x-1.5 min-w-0 truncate mr-2">
        <CatppuccinIcon :name="isTargetRemote ? 'server' : 'laptop'" :size="12" class="opacity-75 shrink-0" />
        <span class="truncate font-mono">{{ menuHeaderTitle }}</span>
      </div>
      <span class="text-[9px] font-medium tracking-normal opacity-65 shrink-0">{{ menuHeaderBadge }}</span>
    </div>

    <!-- ============================================================== -->
    <!-- LOCAL PANE MENU                                                -->
    <!-- ============================================================== -->
    <template v-if="!isTargetRemote">
      <!-- --- CASE A: ITEMS ARE SELECTED IN LOCAL PANE --- -->
      <template v-if="selectedLocalFiles.length > 0">
        <!-- 1. Primary Actions on selection -->
        <button
          v-if="sessionId"
          @click="emit('batchUpload', selectedLocalFiles); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg font-medium transition text-left"
          :style="{ color: 'var(--color-accent)' }"
        >
          <CatppuccinIcon :name="isLeftPaneRemote ? 'network' : 'upload'" :size="15" />
          <span class="truncate">{{ isLeftPaneRemote ? 'Transfer to Remote Server' : 'Upload' }} {{ selectedLocalFiles.length > 1 ? `(${selectedLocalFiles.length} items)` : '' }}</span>
        </button>

        <!-- Quick Look (Single File) -->
        <button
          v-if="selectedLocalFiles.length === 1 && !selectedLocalFiles[0].is_dir"
          @click="emit('quickLook', 'local', selectedLocalFiles[0]); emit('close')"
          class="context-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg font-medium transition text-left"
          :style="{ color: 'var(--color-accent)' }"
        >
          <div class="flex items-center space-x-2.5 min-w-0">
            <CatppuccinIcon name="eye" :size="15" />
            <span class="truncate">Quick Look</span>
          </div>
          <span class="menu-shortcut">Space</span>
        </button>

        <!-- View / Edit (Single File) -->
        <button
          v-if="selectedLocalFiles.length === 1 && !selectedLocalFiles[0].is_dir"
          @click="emit('edit', 'local', selectedLocalFiles[0]); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg font-medium transition text-left"
          :style="{ color: 'var(--color-accent)' }"
        >
          <CatppuccinIcon name="code" :size="15" />
          <span class="truncate">View / Edit</span>
        </button>

        <!-- Open in Default App (Single File) -->
        <button
          v-if="selectedLocalFiles.length === 1 && !selectedLocalFiles[0].is_dir"
          @click="emit('openInDefaultApp', selectedLocalFiles[0].path); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <ExternalLink :size="15" class="shrink-0 opacity-80" />
          <span class="truncate">Open in Default App</span>
        </button>

        <!-- Archive Operations (Local Selection) -->
        <template v-if="selectedLocalFiles.length === 1 && isArchiveFile(selectedLocalFiles[0].name)">
          <div class="h-px my-1 mx-1.5" :style="{ backgroundColor: 'var(--color-border)' }" />
          <button
            @click="emit('extractHere', 'local', selectedLocalFiles[0]); emit('close')"
            class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg font-medium transition text-left"
            :style="{ color: 'var(--color-success, #a6e3a1)' }"
          >
            <CatppuccinIcon name="package" :size="15" />
            <span class="truncate">Extract Archive Here</span>
          </button>
          <button
            @click="emit('extractToFolder', 'local', selectedLocalFiles[0]); emit('close')"
            class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
          >
            <CatppuccinIcon name="folder" :size="15" />
            <span class="truncate">Extract to Folder...</span>
          </button>
        </template>

        <button
          @click="emit('compress', 'local'); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <CatppuccinIcon name="package" :size="15" />
          <span class="truncate">Compress to Archive...</span>
        </button>

        <div class="h-px my-1 mx-1.5" :style="{ backgroundColor: 'var(--color-border)' }" />

        <!-- Pair with Remote (if 1 folder selected) -->
        <button
          v-if="sessionId && selectedLocalFiles.length === 1 && selectedLocalFiles[0].is_dir"
          @click="emit('pairFolder', selectedLocalFiles[0].path); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
          :style="{ color: 'var(--color-accent)' }"
        >
          <CatppuccinIcon name="sync" :size="15" />
          <span class="truncate">Pair Folder (Live Auto-Sync)</span>
        </button>

        <!-- Bookmark Folder (if 1 folder selected) -->
        <button
          v-if="selectedLocalFiles.length === 1 && selectedLocalFiles[0].is_dir"
          @click="emit('toggleBookmark', 'local', selectedLocalFiles[0].path); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <CatppuccinIcon :name="localBookmarks.includes(selectedLocalFiles[0].path) ? 'bookmark-filled' : 'bookmark'" :size="15" />
          <span class="truncate">{{ localBookmarks.includes(selectedLocalFiles[0].path) ? 'Remove Bookmark' : 'Bookmark Folder' }}</span>
        </button>

        <div class="h-px my-1 mx-1.5" :style="{ backgroundColor: 'var(--color-border)' }" />

        <!-- Duplicate (Single item) -->
        <button
          v-if="selectedLocalFiles.length === 1"
          @click="emit('duplicate', 'local', selectedLocalFiles[0]); emit('close')"
          class="context-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <div class="flex items-center space-x-2.5 min-w-0">
            <Files :size="15" class="opacity-80" />
            <span class="truncate">Duplicate</span>
          </div>
          <span class="menu-shortcut">Ctrl+D</span>
        </button>

        <!-- Copy -->
        <button
          @click="emit('copy', 'local', selectedLocalFiles); emit('close')"
          class="context-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <div class="flex items-center space-x-2.5 min-w-0">
            <Copy :size="15" class="opacity-80" />
            <span class="truncate">Copy</span>
          </div>
          <span class="menu-shortcut">Ctrl+C</span>
        </button>

        <!-- Cut -->
        <button
          @click="emit('cut', 'local', selectedLocalFiles); emit('close')"
          class="context-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <div class="flex items-center space-x-2.5 min-w-0">
            <Scissors :size="15" class="opacity-80" />
            <span class="truncate">Cut</span>
          </div>
          <span class="menu-shortcut">Ctrl+X</span>
        </button>

        <!-- Paste into Folder (if 1 folder selected and clipboard has items) -->
        <button
          v-if="hasClipboard && selectedLocalFiles.length === 1 && selectedLocalFiles[0].is_dir"
          @click="emit('paste', 'local', selectedLocalFiles[0].path); emit('close')"
          class="context-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left"
          :style="{ color: 'var(--color-accent)' }"
        >
          <div class="flex items-center space-x-2.5 min-w-0">
            <ClipboardPaste :size="15" class="opacity-80" />
            <span class="truncate">Paste into Folder {{ clipboardDesc }}</span>
          </div>
          <span class="menu-shortcut">Ctrl+V</span>
        </button>

        <!-- Calculate Directory Size (Single Folder) -->
        <button
          v-if="selectedLocalFiles.length === 1 && selectedLocalFiles[0].is_dir"
          @click="emit('calculateDirSize', 'local', selectedLocalFiles[0].path); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <Calculator :size="15" class="opacity-80" />
          <span class="truncate">Calculate Directory Size</span>
        </button>

        <!-- Calculate Checksum / Hash (Single File) -->
        <button
          v-if="selectedLocalFiles.length === 1 && !selectedLocalFiles[0].is_dir"
          @click="emit('calculateChecksum', 'local', selectedLocalFiles[0]); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <Hash :size="15" class="opacity-80" />
          <span class="truncate">Checksum (MD5 / SHA-256)...</span>
        </button>

        <!-- Create Symlink pointing to this item -->
        <button
          v-if="selectedLocalFiles.length === 1"
          @click="emit('newSymlink', 'local', selectedLocalFiles[0]); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <Link2 :size="15" class="opacity-80" />
          <span class="truncate">Create Symbolic Link...</span>
        </button>

        <!-- Rename (Single item) -->
        <button
          v-if="selectedLocalFiles.length === 1"
          @click="emit('rename', 'local', selectedLocalFiles[0]); emit('close')"
          class="context-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <div class="flex items-center space-x-2.5 min-w-0">
            <CatppuccinIcon name="rename" :size="15" />
            <span class="truncate">Rename</span>
          </div>
          <span class="menu-shortcut">F2</span>
        </button>

        <!-- Copy Path (Single item) -->
        <button
          v-if="selectedLocalFiles.length === 1"
          @click="emit('copyPath', selectedLocalFiles[0].path); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <CatppuccinIcon name="copy" :size="15" />
          <span class="truncate">Copy Path</span>
        </button>

        <!-- Delete Selected -->
        <button
          @click="emit('batchDeleteLocal', selectedLocalFiles); emit('close')"
          class="context-menu-item context-menu-item-danger w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left font-medium"
        >
          <div class="flex items-center space-x-2.5 min-w-0">
            <CatppuccinIcon name="delete" :size="15" />
            <span class="truncate">Delete {{ selectedLocalFiles.length > 1 ? `(${selectedLocalFiles.length})` : '' }}</span>
          </div>
          <span class="menu-shortcut" :style="{ color: 'var(--color-danger, #f38ba8)' }">F8</span>
        </button>
      </template>

      <!-- --- CASE B: EMPTY SPACE RIGHT-CLICKED IN LOCAL PANE --- -->
      <template v-else>
        <!-- 1. Creation -->
        <button
          @click="emit('newFile', 'local'); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <CatppuccinIcon name="new-file" :size="15" />
          <span class="truncate">New File</span>
        </button>

        <button
          @click="emit('newFolder', 'local'); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <CatppuccinIcon name="new-folder" :size="15" />
          <span class="truncate">New Directory</span>
        </button>

        <button
          @click="emit('newSymlink', 'local'); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <Link2 :size="15" class="opacity-80" />
          <span class="truncate">Create Symbolic Link...</span>
        </button>

        <!-- Paste into current directory if clipboard has items -->
        <button
          v-if="hasClipboard"
          @click="emit('paste', 'local'); emit('close')"
          class="context-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left font-medium"
          :style="{ color: 'var(--color-accent)' }"
        >
          <div class="flex items-center space-x-2.5 min-w-0">
            <ClipboardPaste :size="15" class="opacity-80" />
            <span class="truncate">Paste {{ clipboardDesc }}</span>
          </div>
          <span class="menu-shortcut">Ctrl+V</span>
        </button>

        <div class="h-px my-1 mx-1.5" :style="{ backgroundColor: 'var(--color-border)' }" />

        <!-- 2. Folder Navigation & Tools -->
        <button
          v-if="!isLeftPaneRemote"
          @click="emit('openInDefaultApp', currentLocalPath); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <ExternalLink :size="15" class="shrink-0 opacity-80" />
          <span class="truncate">Reveal in File Explorer</span>
        </button>

        <!-- Pair Current Folder for Live Sync -->
        <button
          v-if="sessionId && !isLeftPaneRemote"
          @click="emit('pairFolder', currentLocalPath); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
          :style="{ color: 'var(--color-accent)' }"
        >
          <CatppuccinIcon name="sync" :size="15" />
          <span class="truncate">Pair with Remote (Live Auto-Sync)</span>
        </button>

        <!-- Directory Comparison -->
        <button
          v-if="sessionId"
          @click="emit('toggleComparison'); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <CatppuccinIcon name="compare" :size="15" />
          <span class="truncate">{{ isComparing ? 'Exit Directory Comparison' : 'Compare Directories' }}</span>
        </button>

        <!-- Bookmark Current Folder -->
        <button
          @click="emit('toggleBookmark', 'local', currentLocalPath); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <CatppuccinIcon :name="isLocalBookmarked ? 'bookmark-filled' : 'bookmark'" :size="15" />
          <span class="truncate">{{ isLocalBookmarked ? 'Remove from Bookmarks' : 'Bookmark Current Folder' }}</span>
        </button>
      </template>

      <!-- Selection & View Common Group -->
      <div class="h-px my-1 mx-1.5" :style="{ backgroundColor: 'var(--color-border)' }" />

      <button
        @click="emit('selectAll', 'local'); emit('close')"
        class="context-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left"
      >
        <div class="flex items-center space-x-2.5 min-w-0">
          <CatppuccinIcon name="select-all" :size="15" />
          <span class="truncate">Select All</span>
        </div>
        <span class="menu-shortcut">Ctrl+A</span>
      </button>

      <button
        @click="emit('refresh', 'local'); emit('close')"
        class="context-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left"
      >
        <div class="flex items-center space-x-2.5 min-w-0">
          <CatppuccinIcon name="refresh" :size="15" />
          <span class="truncate">Refresh</span>
        </div>
        <span class="menu-shortcut">F5</span>
      </button>
    </template>

    <!-- ============================================================== -->
    <!-- REMOTE PANE MENU                                               -->
    <!-- ============================================================== -->
    <template v-else>
      <!-- --- CASE A: ITEMS ARE SELECTED IN REMOTE PANE --- -->
      <template v-if="activeRemoteFiles.length > 0">
        <!-- 1. Primary Actions on selection -->
        <button
          v-if="activeSessionId"
          @click="pane === 'local' ? emit('batchUpload', activeRemoteFiles as any) : emit('batchDownload', activeRemoteFiles); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg font-medium transition text-left"
          :style="{ color: 'var(--color-accent-secondary)' }"
        >
          <CatppuccinIcon :name="pane === 'local' ? 'network' : (isLeftPaneRemote ? 'network' : 'download')" :size="15" />
          <span class="truncate">
            {{ pane === 'local' ? 'Transfer to Remote Server' : (isLeftPaneRemote ? 'Transfer to Left Server' : 'Download') }}
            {{ activeRemoteFiles.length > 1 ? `(${activeRemoteFiles.length} items)` : '' }}
          </span>
        </button>

        <!-- Quick Look (Single File) -->
        <button
          v-if="activeSessionId && activeRemoteFiles.length === 1 && !activeRemoteFiles[0].is_dir"
          @click="emit('quickLook', pane, activeRemoteFiles[0]); emit('close')"
          class="context-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg font-medium transition text-left"
          :style="{ color: 'var(--color-accent-secondary)' }"
        >
          <div class="flex items-center space-x-2.5 min-w-0">
            <CatppuccinIcon name="eye" :size="15" />
            <span class="truncate">Quick Look</span>
          </div>
          <span class="menu-shortcut">Space</span>
        </button>

        <!-- View / Edit (Single File) -->
        <button
          v-if="activeSessionId && activeRemoteFiles.length === 1 && !activeRemoteFiles[0].is_dir"
          @click="emit('edit', pane, activeRemoteFiles[0]); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg font-medium transition text-left"
          :style="{ color: 'var(--color-accent-secondary)' }"
        >
          <CatppuccinIcon name="code" :size="15" />
          <span class="truncate">View / Edit (Built-in)</span>
        </button>

        <!-- Edit in External Editor (Single File) -->
        <button
          v-if="activeSessionId && activeRemoteFiles.length === 1 && !activeRemoteFiles[0].is_dir"
          @click="emit('openInExternalEditor', activeRemoteFiles[0]); emit('close')"
          class="context-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left"
          title="Open in external editor (VS Code / system default) with live auto-upload on save"
        >
          <div class="flex items-center space-x-2.5 min-w-0">
            <ExternalLink :size="15" class="shrink-0 opacity-80" />
            <span class="truncate">External Editor</span>
          </div>
          <span
            class="text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold tracking-wide border shrink-0"
            :style="{
              backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)',
              borderColor: 'color-mix(in srgb, var(--color-accent) 40%, transparent)',
              color: 'var(--color-accent)'
            }"
          >
            Live Sync
          </span>
        </button>

        <!-- File Permissions (chmod)... (Single Item) -->
        <button
          v-if="activeSessionId && activeRemoteFiles.length === 1"
          @click="emit('permissions', activeRemoteFiles[0]); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <CatppuccinIcon name="shield" :size="15" />
          <span class="truncate">Permissions (chmod)...</span>
        </button>

        <!-- Archive Operations (Remote Selection) -->
        <template v-if="activeSessionId && activeRemoteFiles.length === 1 && isArchiveFile(activeRemoteFiles[0].name)">
          <div class="h-px my-1 mx-1.5" :style="{ backgroundColor: 'var(--color-border)' }" />
          <button
            @click="emit('extractHere', pane, activeRemoteFiles[0]); emit('close')"
            class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg font-medium transition text-left"
            :style="{ color: 'var(--color-success, #a6e3a1)' }"
          >
            <CatppuccinIcon name="package" :size="15" />
            <span class="truncate">Extract Archive Here</span>
          </button>
          <button
            @click="emit('extractToFolder', pane, activeRemoteFiles[0]); emit('close')"
            class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
          >
            <CatppuccinIcon name="folder" :size="15" />
            <span class="truncate">Extract to Folder...</span>
          </button>
        </template>

        <button
          v-if="activeSessionId"
          @click="emit('compress', pane); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <CatppuccinIcon name="package" :size="15" />
          <span class="truncate">Compress to Archive...</span>
        </button>

        <div class="h-px my-1 mx-1.5" :style="{ backgroundColor: 'var(--color-border)' }" />

        <!-- Open in Terminal (if single folder selected) -->
        <button
          v-if="activeSessionId && activeRemoteFiles.length === 1 && activeRemoteFiles[0].is_dir"
          @click="emit('openInTerminal', activeRemoteFiles[0].path); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <CatppuccinIcon name="terminal" :size="15" />
          <span class="truncate">Open in Terminal</span>
        </button>

        <!-- Search & SSH Grep (if single folder selected) -->
        <button
          v-if="activeSessionId && activeRemoteFiles.length === 1 && activeRemoteFiles[0].is_dir"
          @click="emit('searchRemote', activeRemoteFiles[0].path); emit('close')"
          class="context-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <div class="flex items-center space-x-2.5 min-w-0">
            <CatppuccinIcon name="search" :size="15" />
            <span class="truncate">Search &amp; SSH Grep</span>
          </div>
          <span class="menu-shortcut">Ctrl+Shift+F</span>
        </button>

        <!-- Bookmark Folder (if single folder selected) -->
        <button
          v-if="activeSessionId && activeRemoteFiles.length === 1 && activeRemoteFiles[0].is_dir"
          @click="emit('toggleBookmark', pane, activeRemoteFiles[0].path); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <CatppuccinIcon :name="(pane === 'local' ? localBookmarks : remoteBookmarks).includes(activeRemoteFiles[0].path) ? 'bookmark-filled' : 'bookmark'" :size="15" />
          <span class="truncate">{{ (pane === 'local' ? localBookmarks : remoteBookmarks).includes(activeRemoteFiles[0].path) ? 'Remove Bookmark' : 'Bookmark Folder' }}</span>
        </button>

        <div class="h-px my-1 mx-1.5" :style="{ backgroundColor: 'var(--color-border)' }" />

        <!-- Duplicate (Single item) -->
        <button
          v-if="activeSessionId && activeRemoteFiles.length === 1"
          @click="emit('duplicate', pane, activeRemoteFiles[0]); emit('close')"
          class="context-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <div class="flex items-center space-x-2.5 min-w-0">
            <Files :size="15" class="opacity-80" />
            <span class="truncate">Duplicate</span>
          </div>
          <span class="menu-shortcut">Ctrl+D</span>
        </button>

        <!-- Copy -->
        <button
          v-if="activeSessionId"
          @click="emit('copy', pane, activeRemoteFiles); emit('close')"
          class="context-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <div class="flex items-center space-x-2.5 min-w-0">
            <Copy :size="15" class="opacity-80" />
            <span class="truncate">Copy</span>
          </div>
          <span class="menu-shortcut">Ctrl+C</span>
        </button>

        <!-- Cut -->
        <button
          v-if="activeSessionId"
          @click="emit('cut', pane, activeRemoteFiles); emit('close')"
          class="context-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <div class="flex items-center space-x-2.5 min-w-0">
            <Scissors :size="15" class="opacity-80" />
            <span class="truncate">Cut</span>
          </div>
          <span class="menu-shortcut">Ctrl+X</span>
        </button>

        <!-- Paste into Folder (if 1 folder selected and clipboard has items) -->
        <button
          v-if="activeSessionId && hasClipboard && activeRemoteFiles.length === 1 && activeRemoteFiles[0].is_dir"
          @click="emit('paste', pane, activeRemoteFiles[0].path); emit('close')"
          class="context-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left"
          :style="{ color: 'var(--color-accent-secondary)' }"
        >
          <div class="flex items-center space-x-2.5 min-w-0">
            <ClipboardPaste :size="15" class="opacity-80" />
            <span class="truncate">Paste into Folder {{ clipboardDesc }}</span>
          </div>
          <span class="menu-shortcut">Ctrl+V</span>
        </button>

        <!-- Calculate Directory Size (Single Folder) -->
        <button
          v-if="activeSessionId && activeRemoteFiles.length === 1 && activeRemoteFiles[0].is_dir"
          @click="emit('calculateDirSize', pane, activeRemoteFiles[0].path); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <Calculator :size="15" class="opacity-80" />
          <span class="truncate">Calculate Directory Size</span>
        </button>

        <!-- Calculate Checksum / Hash (Single File) -->
        <button
          v-if="activeSessionId && activeRemoteFiles.length === 1 && !activeRemoteFiles[0].is_dir"
          @click="emit('calculateChecksum', pane, activeRemoteFiles[0]); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <Hash :size="15" class="opacity-80" />
          <span class="truncate">Checksum (MD5 / SHA-256)...</span>
        </button>

        <!-- Create Symlink pointing to this item -->
        <button
          v-if="activeSessionId && activeRemoteFiles.length === 1"
          @click="emit('newSymlink', pane, activeRemoteFiles[0]); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <Link2 :size="15" class="opacity-80" />
          <span class="truncate">Create Symbolic Link...</span>
        </button>

        <!-- Rename (Single item) -->
        <button
          v-if="activeRemoteFiles.length === 1"
          @click="emit('rename', pane, activeRemoteFiles[0]); emit('close')"
          class="context-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <div class="flex items-center space-x-2.5 min-w-0">
            <CatppuccinIcon name="rename" :size="15" />
            <span class="truncate">Rename</span>
          </div>
          <span class="menu-shortcut">F2</span>
        </button>

        <!-- Copy Path (Single item) -->
        <button
          v-if="activeRemoteFiles.length === 1"
          @click="emit('copyPath', activeRemoteFiles[0].path); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <CatppuccinIcon name="copy" :size="15" />
          <span class="truncate">Copy Path</span>
        </button>

        <!-- Delete Selected -->
        <button
          @click="pane === 'local' ? emit('batchDeleteLocal', activeRemoteFiles as any) : emit('batchDeleteRemote', activeRemoteFiles); emit('close')"
          class="context-menu-item context-menu-item-danger w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left font-medium"
        >
          <div class="flex items-center space-x-2.5 min-w-0">
            <CatppuccinIcon name="delete" :size="15" />
            <span class="truncate">Delete {{ activeRemoteFiles.length > 1 ? `(${activeRemoteFiles.length})` : '' }}</span>
          </div>
          <span class="menu-shortcut" :style="{ color: 'var(--color-danger, #f38ba8)' }">F8</span>
        </button>
      </template>

      <!-- --- CASE B: EMPTY SPACE RIGHT-CLICKED IN REMOTE PANE --- -->
      <template v-else>
        <!-- 1. Creation Group (Prominent at top) -->
        <button
          v-if="activeSessionId"
          @click="emit('newFile', pane); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <CatppuccinIcon name="new-file" :size="15" />
          <span class="truncate">New File</span>
        </button>

        <button
          v-if="activeSessionId"
          @click="emit('newFolder', pane); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <CatppuccinIcon name="new-folder" :size="15" />
          <span class="truncate">New Directory</span>
        </button>

        <button
          v-if="activeSessionId"
          @click="emit('newSymlink', pane); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <Link2 :size="15" class="opacity-80" />
          <span class="truncate">Create Symbolic Link...</span>
        </button>

        <!-- Paste into current directory if clipboard has items -->
        <button
          v-if="activeSessionId && hasClipboard"
          @click="emit('paste', pane); emit('close')"
          class="context-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left font-medium"
          :style="{ color: 'var(--color-accent-secondary)' }"
        >
          <div class="flex items-center space-x-2.5 min-w-0">
            <ClipboardPaste :size="15" class="opacity-80" />
            <span class="truncate">Paste {{ clipboardDesc }}</span>
          </div>
          <span class="menu-shortcut">Ctrl+V</span>
        </button>

        <div class="h-px my-1 mx-1.5" :style="{ backgroundColor: 'var(--color-border)' }" />

        <!-- 2. Remote Navigation & Tools in current directory -->
        <button
          v-if="activeSessionId"
          @click="emit('openInTerminal', activePath); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <CatppuccinIcon name="terminal" :size="15" />
          <span class="truncate">Open in Terminal</span>
        </button>

        <button
          v-if="activeSessionId"
          @click="emit('searchRemote', activePath); emit('close')"
          class="context-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <div class="flex items-center space-x-2.5 min-w-0">
            <CatppuccinIcon name="search" :size="15" />
            <span class="truncate">Search &amp; SSH Grep</span>
          </div>
          <span class="menu-shortcut">Ctrl+Shift+F</span>
        </button>

        <button
          v-if="activeSessionId"
          @click="emit('toggleComparison'); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <CatppuccinIcon name="compare" :size="15" />
          <span class="truncate">{{ isComparing ? 'Exit Directory Comparison' : 'Compare Directories' }}</span>
        </button>

        <button
          v-if="activeSessionId"
          @click="emit('toggleBookmark', pane, activePath); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg transition text-left"
        >
          <CatppuccinIcon :name="isFolderBookmarked ? 'bookmark-filled' : 'bookmark'" :size="15" />
          <span class="truncate">{{ isFolderBookmarked ? 'Remove from Bookmarks' : 'Bookmark Current Folder' }}</span>
        </button>
      </template>

      <!-- Selection & View Common Group -->
      <div v-if="activeSessionId" class="h-px my-1 mx-1.5" :style="{ backgroundColor: 'var(--color-border)' }" />

      <button
        v-if="activeSessionId"
        @click="emit('selectAll', pane); emit('close')"
        class="context-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left"
      >
        <div class="flex items-center space-x-2.5 min-w-0">
          <CatppuccinIcon name="select-all" :size="15" />
          <span class="truncate">Select All</span>
        </div>
        <span class="menu-shortcut">Ctrl+A</span>
      </button>

      <button
        v-if="activeSessionId"
        @click="emit('refresh', pane); emit('close')"
        class="context-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left"
      >
        <div class="flex items-center space-x-2.5 min-w-0">
          <CatppuccinIcon name="refresh" :size="15" />
          <span class="truncate">Refresh</span>
        </div>
        <span class="menu-shortcut">F5</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.context-menu-box {
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35), 0 0 0 1px color-mix(in srgb, var(--color-border) 60%, transparent);
}

.context-menu-item {
  color: var(--color-text-main);
  transition: background-color 0.12s ease, color 0.12s ease;
}

.context-menu-item:hover {
  background-color: var(--color-bg-hover);
  color: var(--color-text-main);
}

.context-menu-item:active {
  filter: brightness(0.95);
}

.menu-shortcut {
  margin-left: auto;
  padding-left: 0.75rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  color: var(--color-text-muted);
  opacity: 0.65;
  flex-shrink: 0;
  transition: opacity 0.12s ease;
}

.context-menu-item:hover .menu-shortcut {
  opacity: 1;
}

.context-menu-item-danger {
  color: var(--color-danger, #f38ba8) !important;
}

.context-menu-item-danger:hover {
  background-color: color-mix(in srgb, var(--color-danger, #f38ba8) 16%, transparent) !important;
  color: var(--color-danger, #f38ba8) !important;
}
</style>
