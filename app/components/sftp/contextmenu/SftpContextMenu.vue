<script setup lang="ts">
import { computed } from 'vue'
import {
  Folder,
  FileCode,
  ExternalLink,
  Shield,
  Terminal,
  Package,
  GitCompare,
  Eye,
  FolderSync,
  Search,
} from 'lucide-vue-next'
import type { LocalFileEntry, SftpFileEntry } from '../../../stores/sftp'
import CatppuccinIcon from '../../CatppuccinIcon.vue'

const props = defineProps<{
  show: boolean
  x: number
  y: number
  pane: 'local' | 'remote'
  sessionId: string | null
  selectedLocalFiles: LocalFileEntry[]
  selectedRemoteFiles: SftpFileEntry[]
  localBookmarks: string[]
  remoteBookmarks: string[]
  currentLocalPath: string
  currentRemotePath: string
  isComparing: boolean
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
  (e: 'rename', target: 'local' | 'remote', file: LocalFileEntry | SftpFileEntry): void
  (e: 'copyPath', path: string): void
  (e: 'toggleBookmark', target: 'local' | 'remote', path?: string): void
  (e: 'toggleComparison'): void
  (e: 'selectAll', target: 'local' | 'remote'): void
  (e: 'batchDeleteLocal', files: LocalFileEntry[]): void
  (e: 'batchDeleteRemote', files: SftpFileEntry[]): void
  (e: 'refresh', target: 'local' | 'remote'): void
}>()

const isArchiveFile = (fileName: string) =>
  /\.(zip|tar|gz|tgz|tar\.gz|tar\.bz2|bz2|xz|7z)$/i.test(fileName)

const isLocalBookmarked = computed(() => props.localBookmarks.includes(props.currentLocalPath))
const isRemoteBookmarked = computed(() => props.remoteBookmarks.includes(props.currentRemotePath))
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
    class="fixed z-50 min-w-[210px] backdrop-blur-md rounded-xl border shadow-2xl p-1 text-xs select-none animate-in fade-in zoom-in-95 duration-75"
    @click.stop
  >
    <!-- LOCAL PANE MENU -->
    <template v-if="pane === 'local'">
      <!-- Upload -->
      <button
        v-if="sessionId && selectedLocalFiles.length > 0"
        @click="emit('batchUpload', selectedLocalFiles); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg font-medium transition text-left"
        :style="{ color: 'var(--color-accent)' }"
      >
        <CatppuccinIcon name="upload" :size="15" />
        <span>Upload {{ selectedLocalFiles.length > 1 ? `(${selectedLocalFiles.length})` : '' }}</span>
      </button>

      <!-- Quick Look (Single File) -->
      <button
        v-if="selectedLocalFiles.length === 1 && !selectedLocalFiles[0].is_dir"
        @click="emit('quickLook', 'local', selectedLocalFiles[0]); emit('close')"
        class="context-menu-item w-full flex items-center justify-between px-3 py-1.5 rounded-lg font-medium transition text-left"
        :style="{ color: 'var(--color-accent)' }"
      >
        <div class="flex items-center space-x-2.5">
          <Eye :size="15" />
          <span>Quick Look</span>
        </div>
        <span class="font-mono text-[10px]" :style="{ color: 'var(--color-text-muted)' }">Space</span>
      </button>

      <!-- View / Edit (Single File) -->
      <button
        v-if="selectedLocalFiles.length === 1 && !selectedLocalFiles[0].is_dir"
        @click="emit('edit', 'local', selectedLocalFiles[0]); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg font-medium transition text-left"
        :style="{ color: 'var(--color-accent)' }"
      >
        <FileCode :size="15" />
        <span>View / Edit</span>
      </button>

      <!-- Open in Default App (Single File) -->
      <button
        v-if="selectedLocalFiles.length === 1 && !selectedLocalFiles[0].is_dir"
        @click="emit('openInDefaultApp', selectedLocalFiles[0].path); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left"
        :style="{ color: 'var(--color-text-main)' }"
      >
        <ExternalLink :size="15" />
        <span>Open in Default App</span>
      </button>

      <!-- Archive Operations (Local) -->
      <template v-if="selectedLocalFiles.length === 1 && isArchiveFile(selectedLocalFiles[0].name)">
        <div class="h-px my-1" :style="{ backgroundColor: 'var(--color-border)' }" />
        <button
          @click="emit('extractHere', 'local', selectedLocalFiles[0]); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg font-medium transition text-left text-emerald-600 dark:text-emerald-400"
        >
          <Package :size="15" />
          <span>Extract Archive Here</span>
        </button>
        <button
          @click="emit('extractToFolder', 'local', selectedLocalFiles[0]); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <Folder :size="15" class="text-amber-600 dark:text-amber-400" />
          <span>Extract to Folder...</span>
        </button>
      </template>

      <button
        v-if="selectedLocalFiles.length > 0"
        @click="emit('compress', 'local'); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left"
        :style="{ color: 'var(--color-text-main)' }"
      >
        <Package :size="15" class="text-amber-600 dark:text-amber-400" />
        <span>Compress to Archive (.tar.gz / .zip)...</span>
      </button>

      <div v-if="selectedLocalFiles.length > 0" class="h-px my-1" :style="{ backgroundColor: 'var(--color-border)' }" />

      <button
        @click="emit('newFile', 'local'); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left"
        :style="{ color: 'var(--color-text-main)' }"
      >
        <CatppuccinIcon name="file" :size="15" />
        <span>New File</span>
      </button>

      <button
        @click="emit('newFolder', 'local'); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left"
        :style="{ color: 'var(--color-text-main)' }"
      >
        <CatppuccinIcon name="folder" :size="15" />
        <span>New Directory</span>
      </button>

      <button
        v-if="selectedLocalFiles.length === 1"
        @click="emit('rename', 'local', selectedLocalFiles[0]); emit('close')"
        class="context-menu-item w-full flex items-center justify-between px-3 py-1.5 rounded-lg transition text-left"
        :style="{ color: 'var(--color-text-main)' }"
      >
        <div class="flex items-center space-x-2.5">
          <CatppuccinIcon name="rename" :size="15" />
          <span>Rename</span>
        </div>
        <span class="text-[10px] font-mono" :style="{ color: 'var(--color-text-muted)' }">F2</span>
      </button>

      <button
        v-if="selectedLocalFiles.length === 1"
        @click="emit('copyPath', selectedLocalFiles[0].path); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left"
        :style="{ color: 'var(--color-text-main)' }"
      >
        <CatppuccinIcon name="copy" :size="15" />
        <span>Copy Path</span>
      </button>

      <!-- Bookmark Folder -->
      <button
        v-if="selectedLocalFiles.length === 1 && selectedLocalFiles[0].is_dir"
        @click="emit('toggleBookmark', 'local', selectedLocalFiles[0].path); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left"
        :style="{ color: 'var(--color-text-main)' }"
      >
        <CatppuccinIcon :name="localBookmarks.includes(selectedLocalFiles[0].path) ? 'bookmark-filled' : 'bookmark'" :size="15" />
        <span>{{ localBookmarks.includes(selectedLocalFiles[0].path) ? 'Remove Bookmark' : 'Bookmark Folder' }}</span>
      </button>
      <button
        v-else-if="selectedLocalFiles.length === 0"
        @click="emit('toggleBookmark', 'local', currentLocalPath); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left"
        :style="{ color: 'var(--color-text-main)' }"
      >
        <CatppuccinIcon :name="isLocalBookmarked ? 'bookmark-filled' : 'bookmark'" :size="15" />
        <span>{{ isLocalBookmarked ? 'Remove Current Folder from Bookmarks' : 'Bookmark Current Folder' }}</span>
      </button>

      <button
        v-if="sessionId"
        @click="emit('toggleComparison'); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left"
        :style="{ color: 'var(--color-text-main)' }"
      >
        <GitCompare :size="15" class="text-indigo-600 dark:text-indigo-400 shrink-0" />
        <span>{{ isComparing ? 'Exit Directory Comparison' : 'Compare Directories' }}</span>
      </button>

      <!-- Pair Folder for Live Sync -->
      <button
        v-if="sessionId"
        @click="emit('pairFolder', selectedLocalFiles.length === 1 && selectedLocalFiles[0].is_dir ? selectedLocalFiles[0].path : currentLocalPath); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left text-sky-700 dark:text-sky-400 font-medium"
      >
        <FolderSync :size="15" class="shrink-0 text-sky-600 dark:text-sky-400" />
        <span>Pair with Remote (Live Auto-Sync)</span>
      </button>

      <div class="h-px my-1" :style="{ backgroundColor: 'var(--color-border)' }" />

      <button
        @click="emit('selectAll', 'local'); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left"
        :style="{ color: 'var(--color-text-muted)' }"
      >
        <CatppuccinIcon name="select-all" :size="15" />
        <span>Select All (Ctrl+A)</span>
      </button>

      <div v-if="selectedLocalFiles.length > 0" class="h-px my-1" :style="{ backgroundColor: 'var(--color-border)' }" />

      <button
        v-if="selectedLocalFiles.length > 0"
        @click="emit('batchDeleteLocal', selectedLocalFiles); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-500/15 transition text-left"
      >
        <CatppuccinIcon name="delete" :size="15" />
        <span>Delete {{ selectedLocalFiles.length > 1 ? `(${selectedLocalFiles.length})` : '' }}</span>
      </button>

      <div class="h-px my-1" :style="{ backgroundColor: 'var(--color-border)' }" />

      <button
        @click="emit('refresh', 'local'); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left"
        :style="{ color: 'var(--color-text-muted)' }"
      >
        <CatppuccinIcon name="refresh" :size="15" />
        <span>Refresh</span>
      </button>
    </template>

    <!-- REMOTE PANE MENU -->
    <template v-else>
      <!-- Download -->
      <button
        v-if="sessionId && selectedRemoteFiles.length > 0"
        @click="emit('batchDownload', selectedRemoteFiles); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg font-medium transition text-left"
        :style="{ color: 'var(--color-accent-secondary)' }"
      >
        <CatppuccinIcon name="download" :size="15" />
        <span>Download {{ selectedRemoteFiles.length > 1 ? `(${selectedRemoteFiles.length})` : '' }}</span>
      </button>

      <!-- Quick Look (Single File) -->
      <button
        v-if="sessionId && selectedRemoteFiles.length === 1 && !selectedRemoteFiles[0].is_dir"
        @click="emit('quickLook', 'remote', selectedRemoteFiles[0]); emit('close')"
        class="context-menu-item w-full flex items-center justify-between px-3 py-1.5 rounded-lg font-medium transition text-left"
        :style="{ color: 'var(--color-accent-secondary)' }"
      >
        <div class="flex items-center space-x-2.5">
          <Eye :size="15" />
          <span>Quick Look</span>
        </div>
        <span class="font-mono text-[10px]" :style="{ color: 'var(--color-text-muted)' }">Space</span>
      </button>

      <!-- View / Edit (Single File) -->
      <button
        v-if="sessionId && selectedRemoteFiles.length === 1 && !selectedRemoteFiles[0].is_dir"
        @click="emit('edit', 'remote', selectedRemoteFiles[0]); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg font-medium transition text-left"
        :style="{ color: 'var(--color-accent-secondary)' }"
      >
        <FileCode :size="15" />
        <span>View / Edit (Built-in)</span>
      </button>

      <!-- Edit in External Editor (Single File) -->
      <button
        v-if="sessionId && selectedRemoteFiles.length === 1 && !selectedRemoteFiles[0].is_dir"
        @click="emit('openInExternalEditor', selectedRemoteFiles[0]); emit('close')"
        class="context-menu-item w-full flex items-center justify-between px-3 py-1.5 rounded-lg transition text-left"
        :style="{ color: 'var(--color-text-main)' }"
        title="Open in external editor (VS Code / system default) with live auto-upload on save"
      >
        <div class="flex items-center space-x-2.5">
          <ExternalLink :size="15" class="text-sky-600 dark:text-sky-400 shrink-0" />
          <span>Edit in External Editor</span>
        </div>
        <span
          class="text-[9px] px-1.5 py-0.5 rounded font-mono font-semibold tracking-wide border bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/80 dark:text-sky-300 dark:border-sky-700/60 shrink-0 shadow-xs"
        >
          Live Sync
        </span>
      </button>

      <!-- File Permissions (chmod)... (Single Item) -->
      <button
        v-if="sessionId && selectedRemoteFiles.length === 1"
        @click="emit('permissions', selectedRemoteFiles[0]); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left"
        :style="{ color: 'var(--color-text-main)' }"
      >
        <Shield :size="15" class="text-emerald-600 dark:text-emerald-400 shrink-0" />
        <span>File Permissions (chmod)...</span>
      </button>

      <!-- Open in Terminal -->
      <button
        v-if="sessionId && (selectedRemoteFiles.length === 0 || (selectedRemoteFiles.length === 1 && selectedRemoteFiles[0].is_dir))"
        @click="emit('openInTerminal', selectedRemoteFiles.length === 1 ? selectedRemoteFiles[0].path : currentRemotePath); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left"
        :style="{ color: 'var(--color-text-main)' }"
      >
        <Terminal :size="15" class="text-cyan-600 dark:text-cyan-400 shrink-0" />
        <span>Open in Terminal</span>
      </button>

      <!-- Archive Operations (Remote via SSH) -->
      <template v-if="sessionId && selectedRemoteFiles.length === 1 && isArchiveFile(selectedRemoteFiles[0].name)">
        <div class="h-px my-1" :style="{ backgroundColor: 'var(--color-border)' }" />
        <button
          @click="emit('extractHere', 'remote', selectedRemoteFiles[0]); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg font-medium transition text-left text-emerald-600 dark:text-emerald-400"
        >
          <Package :size="15" />
          <span>Extract Archive Here</span>
        </button>
        <button
          @click="emit('extractToFolder', 'remote', selectedRemoteFiles[0]); emit('close')"
          class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left"
          :style="{ color: 'var(--color-text-main)' }"
        >
          <Folder :size="15" class="text-amber-600 dark:text-amber-400" />
          <span>Extract to Folder...</span>
        </button>
      </template>

      <button
        v-if="sessionId && selectedRemoteFiles.length > 0"
        @click="emit('compress', 'remote'); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left"
        :style="{ color: 'var(--color-text-main)' }"
      >
        <Package :size="15" class="text-amber-600 dark:text-amber-400" />
        <span>Compress to Archive (.tar.gz / .zip)...</span>
      </button>

      <div v-if="sessionId && selectedRemoteFiles.length > 0" class="h-px my-1" :style="{ backgroundColor: 'var(--color-border)' }" />

      <button
        v-if="sessionId"
        @click="emit('newFile', 'remote'); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left"
        :style="{ color: 'var(--color-text-main)' }"
      >
        <CatppuccinIcon name="file" :size="15" />
        <span>New File</span>
      </button>

      <button
        v-if="sessionId"
        @click="emit('newFolder', 'remote'); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left"
        :style="{ color: 'var(--color-text-main)' }"
      >
        <CatppuccinIcon name="folder" :size="15" />
        <span>New Directory</span>
      </button>

      <button
        v-if="selectedRemoteFiles.length === 1"
        @click="emit('rename', 'remote', selectedRemoteFiles[0]); emit('close')"
        class="context-menu-item w-full flex items-center justify-between px-3 py-1.5 rounded-lg transition text-left"
        :style="{ color: 'var(--color-text-main)' }"
      >
        <div class="flex items-center space-x-2.5">
          <CatppuccinIcon name="rename" :size="15" />
          <span>Rename</span>
        </div>
        <span class="text-[10px] font-mono" :style="{ color: 'var(--color-text-muted)' }">F2</span>
      </button>

      <button
        v-if="selectedRemoteFiles.length === 1"
        @click="emit('copyPath', selectedRemoteFiles[0].path); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left"
        :style="{ color: 'var(--color-text-main)' }"
      >
        <CatppuccinIcon name="copy" :size="15" />
        <span>Copy Path</span>
      </button>

      <!-- Bookmark Folder -->
      <button
        v-if="sessionId && selectedRemoteFiles.length === 1 && selectedRemoteFiles[0].is_dir"
        @click="emit('toggleBookmark', 'remote', selectedRemoteFiles[0].path); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left"
        :style="{ color: 'var(--color-text-main)' }"
      >
        <CatppuccinIcon :name="remoteBookmarks.includes(selectedRemoteFiles[0].path) ? 'bookmark-filled' : 'bookmark'" :size="15" />
        <span>{{ remoteBookmarks.includes(selectedRemoteFiles[0].path) ? 'Remove Bookmark' : 'Bookmark Folder' }}</span>
      </button>
      <button
        v-else-if="sessionId && selectedRemoteFiles.length === 0"
        @click="emit('toggleBookmark', 'remote', currentRemotePath); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left"
        :style="{ color: 'var(--color-text-main)' }"
      >
        <CatppuccinIcon :name="isRemoteBookmarked ? 'bookmark-filled' : 'bookmark'" :size="15" />
        <span>{{ isRemoteBookmarked ? 'Remove Current Folder from Bookmarks' : 'Bookmark Current Folder' }}</span>
      </button>

      <button
        v-if="sessionId"
        @click="emit('toggleComparison'); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left"
        :style="{ color: 'var(--color-text-main)' }"
      >
        <GitCompare :size="15" class="text-indigo-600 dark:text-indigo-400 shrink-0" />
        <span>{{ isComparing ? 'Exit Directory Comparison' : 'Compare Directories' }}</span>
      </button>

      <!-- Search & SSH Grep -->
      <button
        v-if="sessionId"
        @click="emit('searchRemote', selectedRemoteFiles.length === 1 && selectedRemoteFiles[0].is_dir ? selectedRemoteFiles[0].path : currentRemotePath); emit('close')"
        class="context-menu-item w-full flex items-center justify-between px-3 py-1.5 rounded-lg transition text-left text-sky-700 dark:text-sky-400 font-medium"
      >
        <div class="flex items-center space-x-2.5">
          <Search :size="15" class="shrink-0 text-sky-600 dark:text-sky-400" />
          <span>Search &amp; SSH Grep</span>
        </div>
        <span class="font-mono text-[10px]" :style="{ color: 'var(--color-text-muted)' }">Ctrl+Shift+F</span>
      </button>

      <div class="h-px my-1" :style="{ backgroundColor: 'var(--color-border)' }" />

      <button
        v-if="sessionId"
        @click="emit('selectAll', 'remote'); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left"
        :style="{ color: 'var(--color-text-muted)' }"
      >
        <CatppuccinIcon name="select-all" :size="15" />
        <span>Select All (Ctrl+A)</span>
      </button>

      <div v-if="selectedRemoteFiles.length > 0" class="h-px my-1" :style="{ backgroundColor: 'var(--color-border)' }" />

      <button
        v-if="selectedRemoteFiles.length > 0"
        @click="emit('batchDeleteRemote', selectedRemoteFiles); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-500/15 transition text-left"
      >
        <CatppuccinIcon name="delete" :size="15" />
        <span>Delete {{ selectedRemoteFiles.length > 1 ? `(${selectedRemoteFiles.length})` : '' }}</span>
      </button>

      <div class="h-px my-1" :style="{ backgroundColor: 'var(--color-border)' }" />

      <button
        v-if="sessionId"
        @click="emit('refresh', 'remote'); emit('close')"
        class="context-menu-item w-full flex items-center space-x-2.5 px-3 py-1.5 rounded-lg transition text-left"
        :style="{ color: 'var(--color-text-muted)' }"
      >
        <CatppuccinIcon name="refresh" :size="15" />
        <span>Refresh</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.context-menu-item {
  color: var(--color-text-main);
  transition: background-color 0.12s ease, color 0.12s ease;
}
.context-menu-item:hover {
  background-color: var(--color-bg-hover);
}
</style>
