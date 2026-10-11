<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { Package, X, RotateCw } from 'lucide-vue-next'
import type { LocalFileEntry, SftpFileEntry } from '../../../stores/sftp'
import { useModalEscape } from '../composables/useModalEscape'

const props = defineProps<{
  show: boolean
  target: 'local' | 'remote'
  selectedItems: (LocalFileEntry | SftpFileEntry)[]
  currentPath: string
  isCompressing: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submit', archiveName: string, format: '.tar.gz' | '.zip'): void
}>()

const format = ref<'.tar.gz' | '.zip'>('.tar.gz')
const archiveName = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

useModalEscape(() => props.show, () => emit('close'))

watch(
  () => props.show,
  (isOpen) => {
    if (isOpen) {
      format.value = '.tar.gz'
      if (props.selectedItems.length === 1) {
        archiveName.value = `${props.selectedItems[0].name}.tar.gz`
      } else {
        archiveName.value = `archive-${new Date().toISOString().slice(0, 10)}.tar.gz`
      }
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

const selectFormat = (newFormat: '.tar.gz' | '.zip') => {
  format.value = newFormat
  let name = archiveName.value.trim()
  name = name.replace(/\.(zip|tar\.gz|tgz|tar\.bz2|tbz2|tar\.xz|txz|tar|7z)$/i, '')
  archiveName.value = `${name}${newFormat}`
}

const handleSubmit = () => {
  const trimmed = archiveName.value.trim()
  if (!trimmed || props.selectedItems.length === 0 || props.isCompressing) return
  emit('submit', trimmed, format.value)
}
</script>

<template>
  <div
    v-if="show"
    tabindex="-1"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 outline-none"
    @click.self="emit('close')"
    @keydown.esc.prevent.stop="emit('close')"
  >
    <div
      class="w-full max-w-sm rounded-xl border shadow-2xl p-4 space-y-3.5 animate-in fade-in zoom-in-95 duration-100"
      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
    >
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-2">
          <Package class="w-4 h-4 text-amber-400" />
          <h4 class="text-xs font-semibold" :style="{ color: 'var(--color-text-main)' }">
            Compress to Archive ({{ target === 'local' ? 'Local' : 'Remote' }})
          </h4>
        </div>
        <button @click="emit('close')" class="opacity-60 hover:opacity-100 p-0.5 cursor-pointer">
          <X class="w-3.5 h-3.5" />
        </button>
      </div>

      <div class="text-[11px] opacity-75 truncate" :style="{ color: 'var(--color-text-muted)' }">
        Archiving {{ selectedItems.length }} item{{ selectedItems.length > 1 ? 's' : '' }} in {{ currentPath }}
      </div>

      <!-- Format selector tabs/pills -->
      <div class="space-y-1">
        <label class="text-[11px] font-medium" :style="{ color: 'var(--color-text-muted)' }">Archive Format</label>
        <div class="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            @click="selectFormat('.tar.gz')"
            class="px-2.5 py-1.5 rounded-lg border text-left text-xs transition cursor-pointer"
            :class="format === '.tar.gz' ? 'border-sky-500 bg-sky-500/10 text-sky-300 font-semibold ring-1 ring-sky-500/30' : 'border-zinc-700/50 hover:bg-white/5 text-zinc-300'"
          >
            <div class="flex items-center justify-between">
              <span>.tar.gz</span>
              <span class="text-[9px] px-1 py-0.5 rounded bg-sky-500/20 text-sky-300">Linux / Server</span>
            </div>
          </button>
          <button
            type="button"
            @click="selectFormat('.zip')"
            class="px-2.5 py-1.5 rounded-lg border text-left text-xs transition cursor-pointer"
            :class="format === '.zip' ? 'border-sky-500 bg-sky-500/10 text-sky-300 font-semibold ring-1 ring-sky-500/30' : 'border-zinc-700/50 hover:bg-white/5 text-zinc-300'"
          >
            <div class="flex items-center justify-between">
              <span>.zip</span>
              <span class="text-[9px] px-1 py-0.5 rounded bg-amber-500/20 text-amber-300">Universal</span>
            </div>
          </button>
        </div>
      </div>

      <div class="space-y-1">
        <label class="text-[11px] font-medium" :style="{ color: 'var(--color-text-muted)' }">Archive Name</label>
        <input
          ref="inputRef"
          v-model="archiveName"
          @keydown.enter.prevent="handleSubmit"
          @keyup.enter="handleSubmit"
          @keydown.esc.prevent.stop="emit('close')"
          placeholder="archive.tar.gz"
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
          :disabled="isCompressing"
          class="px-3.5 py-1 rounded text-white text-xs font-medium shadow flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
          :style="{ backgroundColor: 'var(--color-accent)' }"
        >
          <RotateCw v-if="isCompressing" class="w-3.5 h-3.5 animate-spin" />
          <span>{{ isCompressing ? 'Compressing...' : 'Create Archive' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
