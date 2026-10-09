<script setup lang="ts">
import { formatBytes, formatDate } from '../../../utils/formatters'

interface ConflictDialogData {
  show: boolean
  fileName: string
  direction: 'upload' | 'download'
  source: { size: number; modified: number }
  destination: { size: number; modified: number }
}

const props = defineProps<{
  show: boolean
  dialog: ConflictDialogData | null
}>()

const emit = defineEmits<{
  (e: 'resolve', resolution: 'skip' | 'skip-all' | 'overwrite' | 'overwrite-all'): void
}>()
</script>

<template>
  <div
    v-if="show && dialog"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-100"
  >
    <div
      class="w-full max-w-md rounded-2xl border shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95 duration-100"
      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
    >
      <div class="flex items-start space-x-3">
        <div class="w-10 h-10 rounded-xl bg-amber-950/60 border border-amber-600/40 flex items-center justify-center text-xl flex-shrink-0">
          ⚠️
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="text-sm font-semibold" :style="{ color: 'var(--color-text-main)' }">
            File Already Exists
          </h3>
          <p class="text-xs mt-0.5" :style="{ color: 'var(--color-text-muted)' }">
            An existing file was detected while {{ dialog.direction === 'download' ? 'downloading to local' : 'uploading to remote' }}.
          </p>
        </div>
      </div>

      <div class="rounded-xl border p-3 space-y-2.5" :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }">
        <div class="font-mono text-xs font-semibold text-amber-300 truncate">
          {{ dialog.fileName }}
        </div>

        <div class="grid grid-cols-2 gap-3 pt-1 border-t text-[11px]" :style="{ borderColor: 'var(--color-border)' }">
          <!-- Source Details -->
          <div class="space-y-1">
            <span class="font-medium uppercase tracking-wider text-[10px]" :style="{ color: 'var(--color-text-muted)' }">
              Source ({{ dialog.direction === 'download' ? 'Remote' : 'Local' }})
            </span>
            <div class="font-mono" :style="{ color: 'var(--color-text-main)' }">
              {{ formatBytes(dialog.source.size) }}
            </div>
            <div class="text-[10px]" :style="{ color: 'var(--color-text-muted)' }">
              {{ formatDate(dialog.source.modified) }}
            </div>
          </div>

          <!-- Destination Details -->
          <div class="space-y-1 border-l pl-3" :style="{ borderColor: 'var(--color-border)' }">
            <span class="text-amber-500/90 font-medium uppercase tracking-wider text-[10px]">
              Target (Existing)
            </span>
            <div class="font-mono" :style="{ color: 'var(--color-text-main)' }">
              {{ formatBytes(dialog.destination.size) }}
            </div>
            <div class="text-[10px]" :style="{ color: 'var(--color-text-muted)' }">
              {{ formatDate(dialog.destination.modified) }}
            </div>
          </div>
        </div>
      </div>

      <!-- Buttons Actions -->
      <div class="flex items-center justify-between pt-1">
        <div class="flex items-center space-x-1.5">
          <button
            @click="emit('resolve', 'skip-all')"
            class="px-2.5 py-1.5 rounded-lg text-xs font-medium transition btn-theme-card cursor-pointer"
            title="Skip this file and all subsequent existing files in this batch"
          >
            Skip All
          </button>
          <button
            @click="emit('resolve', 'skip')"
            class="px-3 py-1.5 rounded-lg text-xs font-medium transition btn-theme-card cursor-pointer"
            title="Skip downloading/uploading this file"
          >
            Skip
          </button>
        </div>

        <div class="flex items-center space-x-1.5">
          <button
            @click="emit('resolve', 'overwrite-all')"
            class="px-2.5 py-1.5 rounded-lg text-xs font-medium transition border cursor-pointer"
            :style="{ backgroundColor: 'var(--color-bg-hover)', borderColor: 'var(--color-border)', color: 'var(--color-accent-secondary)' }"
            title="Overwrite this file and all subsequent existing files in this batch"
          >
            Overwrite All
          </button>
          <button
            @click="emit('resolve', 'overwrite')"
            class="px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition btn-accent-secondary cursor-pointer"
            title="Overwrite the existing file with the incoming file"
          >
            Overwrite
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
