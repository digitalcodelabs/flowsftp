<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { Package, X, RotateCw } from 'lucide-vue-next'
import type { LocalFileEntry, SftpFileEntry } from '../../../stores/sftp'

const props = defineProps<{
  show: boolean
  target: 'local' | 'remote'
  archiveFile: LocalFileEntry | SftpFileEntry | null
  isExtracting: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submit', subfolderName: string): void
}>()

const subfolderName = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

watch(
  () => [props.show, props.archiveFile] as const,
  ([isOpen, file]) => {
    if (isOpen && file) {
      const baseName = file.name.replace(/\.(zip|tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz|tar|7z)$/i, '')
      subfolderName.value = baseName
      nextTick(() => {
        inputRef.value?.focus()
        inputRef.value?.select()
        setTimeout(() => {
          inputRef.value?.focus()
          inputRef.value?.select()
        }, 50)
      })
    }
  },
  { immediate: true }
)

const handleSubmit = () => {
  const trimmed = subfolderName.value.trim()
  if (!trimmed || !props.archiveFile || props.isExtracting) return
  emit('submit', trimmed)
}
</script>

<template>
  <div
    v-if="show"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    @click.self="emit('close')"
  >
    <div
      class="w-full max-w-sm rounded-xl border shadow-2xl p-4 space-y-3.5 animate-in fade-in zoom-in-95 duration-100"
      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
    >
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-2">
          <Package class="w-4 h-4 text-emerald-400" />
          <h4 class="text-xs font-semibold" :style="{ color: 'var(--color-text-main)' }">
            Extract to Subfolder ({{ target === 'local' ? 'Local' : 'Remote' }})
          </h4>
        </div>
        <button @click="emit('close')" class="opacity-60 hover:opacity-100 p-0.5 cursor-pointer">
          <X class="w-3.5 h-3.5" />
        </button>
      </div>

      <div class="space-y-1">
        <label class="text-[11px] font-medium" :style="{ color: 'var(--color-text-muted)' }">Subfolder Name</label>
        <input
          ref="inputRef"
          v-model="subfolderName"
          @keydown.enter.prevent="handleSubmit"
          @keyup.enter="handleSubmit"
          @keydown.esc="emit('close')"
          placeholder="folder-name"
          class="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none font-mono"
          :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
        />
      </div>

      <div class="flex justify-end space-x-2 pt-1">
        <button
          @click="emit('close')"
          class="px-2.5 py-1 rounded text-xs transition cursor-pointer"
          :style="{ color: 'var(--color-text-muted)' }"
        >
          Cancel
        </button>
        <button
          @click="handleSubmit"
          :disabled="isExtracting"
          class="px-3.5 py-1 rounded text-white text-xs font-medium shadow flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
          :style="{ backgroundColor: 'var(--color-accent)' }"
        >
          <RotateCw v-if="isExtracting" class="w-3.5 h-3.5 animate-spin" />
          <span>{{ isExtracting ? 'Extracting...' : 'Extract' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
