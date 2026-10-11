<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import CatppuccinIcon from '../../CatppuccinIcon.vue'
import { useModalEscape } from '../composables/useModalEscape'
import type { LocalFileEntry, SftpFileEntry } from '../../../stores/sftp'

const props = defineProps<{
  show: boolean
  target: 'local' | 'remote'
  existingItems?: (LocalFileEntry | SftpFileEntry)[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submit', name: string): void
}>()

const folderName = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

useModalEscape(() => props.show, () => emit('close'))

watch(
  () => props.show,
  (isOpen) => {
    if (isOpen) {
      folderName.value = ''
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

const matchingItem = computed(() => {
  const trimmed = folderName.value.trim()
  if (!trimmed || !props.existingItems) return null
  return (
    props.existingItems.find((item) => {
      if (item.name === '..') return false
      if (item.name === trimmed) return true
      if (props.target === 'local' && item.name.toLowerCase() === trimmed.toLowerCase()) return true
      return false
    }) || null
  )
})

const hasConflict = computed(() => !!matchingItem.value)

const handleSubmit = () => {
  const trimmed = folderName.value.trim()
  if (!trimmed || hasConflict.value) return
  emit('submit', trimmed)
}
</script>

<template>
  <div
    v-if="show"
    tabindex="-1"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 outline-none select-none"
    @click.self="emit('close')"
    @keydown.esc.prevent.stop="emit('close')"
  >
    <div
      class="w-full max-w-sm rounded-xl border shadow-2xl p-4 space-y-3 animate-in fade-in zoom-in-95 duration-100"
      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
      @click.stop
    >
      <div class="flex items-center space-x-2">
        <CatppuccinIcon name="folder" :size="16" />
        <h4 class="text-xs font-semibold" :style="{ color: 'var(--color-text-main)' }">
          Create New Directory ({{ target === 'local' ? 'Local' : 'Remote' }})
        </h4>
      </div>

      <div class="space-y-1.5">
        <input
          ref="inputRef"
          v-model="folderName"
          @keydown.enter.prevent="handleSubmit"
          @keyup.enter="handleSubmit"
          @keydown.esc.prevent.stop="emit('close')"
          placeholder="Directory name"
          class="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none transition-colors"
          :class="{
            'border-red-500/70 focus:border-red-500': hasConflict,
          }"
          :style="{
            backgroundColor: 'var(--color-bg-pane)',
            borderColor: hasConflict ? undefined : 'var(--color-border)',
            color: 'var(--color-text-main)',
          }"
        />

        <!-- Conflict Warning -->
        <div
          v-if="hasConflict"
          class="px-2.5 py-1.5 rounded-md bg-red-500/10 border border-red-500/25 text-[11px] text-red-400 flex items-start space-x-1.5"
        >
          <span class="shrink-0">🚫</span>
          <span>A {{ matchingItem?.is_dir ? 'directory' : 'file' }} named <strong>"{{ folderName.trim() }}"</strong> already exists.</span>
        </div>
      </div>

      <div class="flex justify-end space-x-2 pt-1">
        <button
          type="button"
          @click="emit('close')"
          class="px-2.5 py-1 rounded text-xs transition cursor-pointer"
          :style="{ color: 'var(--color-text-muted)' }"
        >
          Cancel
        </button>
        <button
          type="button"
          @click="handleSubmit"
          :disabled="hasConflict || !folderName.trim()"
          class="px-3 py-1 rounded text-white text-xs font-medium shadow btn-accent cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Create
        </button>
      </div>
    </div>
  </div>
</template>
