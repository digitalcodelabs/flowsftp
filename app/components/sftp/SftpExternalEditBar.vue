<script setup lang="ts">
import { computed } from 'vue'
import {
  FileEdit,
  ExternalLink,
  RotateCw,
  CheckCircle2,
  AlertTriangle,
  X,
  RefreshCw,
  FolderSync,
} from 'lucide-vue-next'
import { useExternalEditStore, type ExternalEditInfo } from '../../stores/externalEdit'
import { useSettingsStore } from '../../stores/settings'
import FileIcon from '../FileIcon.vue'

const props = defineProps<{
  sessionId: string | null
}>()

const externalEditStore = useExternalEditStore()
const settingsStore = useSettingsStore()

const sessionEdits = computed<ExternalEditInfo[]>(() => {
  if (!props.sessionId) {
    return externalEditStore.activeEdits
  }
  return externalEditStore.activeEdits.filter((e) => e.session_id === props.sessionId)
})

const handleStopEdit = async (editId: string) => {
  await externalEditStore.stopEdit(editId)
}

const handleStopAll = async () => {
  const ids = sessionEdits.value.map((e) => e.id)
  for (const id of ids) {
    await externalEditStore.stopEdit(id)
  }
}

const handleRetry = async (editId: string) => {
  await externalEditStore.retryUpload(editId)
}

const handleReopen = async (edit: ExternalEditInfo) => {
  try {
    const editor = settingsStore.preferredExternalEditor === 'custom'
      ? settingsStore.customExternalEditorCommand
      : settingsStore.preferredExternalEditor
    await externalEditStore.startEdit(edit.session_id, edit.remote_path, editor)
  } catch (err) {
    console.error('Failed to reopen external editor:', err)
  }
}
</script>

<template>
  <div
    v-if="sessionEdits.length > 0"
    class="border-b px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs shadow-md z-20 transition-all duration-150 animate-in slide-in-from-top-2 select-none"
    :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
  >
    <!-- Left: Header info -->
    <div class="flex items-center space-x-3 shrink-0">
      <div class="flex items-center space-x-1.5 font-semibold text-sky-600 dark:text-sky-400">
        <span class="relative flex h-2 w-2">
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
          <span class="relative inline-flex rounded-full h-2 w-2 bg-sky-500" />
        </span>
        <FileEdit class="w-3.5 h-3.5 ml-1" />
        <span>Live Sync Active</span>
      </div>

      <span
        class="px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold border bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/60 dark:border-sky-500/30 dark:text-sky-300 shadow-xs"
      >
        {{ sessionEdits.length }} {{ sessionEdits.length === 1 ? 'file' : 'files' }}
      </span>

      <div class="h-3.5 w-px hidden sm:block" :style="{ backgroundColor: 'var(--color-border)' }" />

      <span class="text-[11px] hidden md:inline" :style="{ color: 'var(--color-text-muted)' }">
        Changes saved in external editor (<kbd class="px-1 py-0.2 rounded border font-mono text-[10px]" :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }">Ctrl+S</kbd>) auto-upload immediately
      </span>
    </div>

    <!-- Center/Right: List of watched file pills -->
    <div class="flex items-center space-x-2 overflow-x-auto no-scrollbar max-w-full py-0.5">
      <div
        v-for="edit in sessionEdits"
        :key="edit.id"
        class="flex items-center space-x-2 px-2.5 py-1 rounded-lg border text-xs shadow-sm transition-colors duration-150 shrink-0"
        :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
      >
        <FileIcon :name="edit.filename" :size="14" />
        <span class="font-medium max-w-[130px] truncate" :style="{ color: 'var(--color-text-main)' }" :title="edit.remote_path">
          {{ edit.filename }}
        </span>

        <!-- Status Tag -->
        <span
          v-if="edit.status === 'watching'"
          class="flex items-center space-x-1 text-[10px] font-mono text-emerald-700 bg-emerald-100 border-emerald-300 dark:text-emerald-400 dark:bg-emerald-950/40 dark:border-emerald-500/30 border px-1.5 py-0.2 rounded font-medium"
          title="Watching file on disk for changes"
        >
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>Watching</span>
        </span>

        <span
          v-else-if="edit.status === 'syncing'"
          class="flex items-center space-x-1 text-[10px] font-mono text-sky-700 bg-sky-100 border-sky-300 dark:text-sky-400 dark:bg-sky-950/40 dark:border-sky-500/30 border px-1.5 py-0.2 rounded font-medium"
        >
          <RotateCw class="w-2.5 h-2.5 animate-spin" />
          <span>Uploading...</span>
        </span>

        <span
          v-else-if="edit.status === 'synced'"
          class="flex items-center space-x-1 text-[10px] font-mono text-emerald-700 bg-emerald-100 border-emerald-300 dark:text-emerald-400 dark:bg-emerald-950/40 dark:border-emerald-500/30 border px-1.5 py-0.2 rounded font-medium"
          title="File synced successfully"
        >
          <CheckCircle2 class="w-2.5 h-2.5" />
          <span>Synced</span>
        </span>

        <span
          v-else-if="edit.status === 'error'"
          class="flex items-center space-x-1 text-[10px] font-mono text-rose-700 bg-rose-100 border-rose-300 dark:text-rose-400 dark:bg-rose-950/50 dark:border-rose-500/40 border px-1.5 py-0.2 rounded cursor-pointer font-medium"
          :title="edit.error || 'Upload failed'"
          @click="handleRetry(edit.id)"
        >
          <AlertTriangle class="w-2.5 h-2.5" />
          <span>Failed</span>
          <RefreshCw class="w-2.5 h-2.5 hover:rotate-180 transition-transform ml-0.5" />
        </span>

        <!-- Actions -->
        <div class="flex items-center space-x-1 pl-1 border-l" :style="{ borderColor: 'var(--color-border)' }">
          <button
            @click="handleReopen(edit)"
            class="p-1 rounded transition hover:text-sky-600 dark:hover:text-sky-300 hover:bg-sky-500/15"
            :style="{ color: 'var(--color-text-muted)' }"
            title="Re-focus or re-open in external editor"
          >
            <ExternalLink class="w-3 h-3" />
          </button>
          <button
            @click="handleStopEdit(edit.id)"
            class="p-1 rounded transition hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/15"
            :style="{ color: 'var(--color-text-muted)' }"
            title="Stop watching and detach live sync"
          >
            <X class="w-3 h-3" />
          </button>
        </div>
      </div>

      <!-- Stop All Button -->
      <button
        v-if="sessionEdits.length > 1"
        @click="handleStopAll"
        class="px-2 py-1 rounded text-[11px] font-medium transition shrink-0 hover:text-rose-600 dark:hover:text-rose-300 hover:bg-rose-500/15 border border-transparent hover:border-rose-500/30"
        :style="{ color: 'var(--color-text-muted)' }"
        title="Stop all live sync sessions"
      >
        Stop All
      </button>
    </div>
  </div>
</template>
