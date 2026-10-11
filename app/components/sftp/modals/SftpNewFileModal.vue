<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import CatppuccinIcon from '../../CatppuccinIcon.vue'
import { useModalEscape } from '../composables/useModalEscape'
import { formatBytes, formatDate } from '../../../utils/formatters'
import type { LocalFileEntry, SftpFileEntry } from '../../../stores/sftp'

const props = defineProps<{
  show: boolean
  target: 'local' | 'remote'
  existingItems?: (LocalFileEntry | SftpFileEntry)[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submit', name: string, overwrite?: boolean): void
}>()

const fileName = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
const showOverwriteConfirmation = ref(false)

useModalEscape(() => props.show, () => {
  if (showOverwriteConfirmation.value) {
    showOverwriteConfirmation.value = false
    nextTick(() => inputRef.value?.focus())
  } else {
    emit('close')
  }
})

watch(
  () => props.show,
  (isOpen) => {
    if (isOpen) {
      fileName.value = ''
      showOverwriteConfirmation.value = false
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
  const trimmed = fileName.value.trim()
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

const isDirConflict = computed(() => matchingItem.value?.is_dir ?? false)
const isFileConflict = computed(() => !!matchingItem.value && !matchingItem.value.is_dir)

const handleSubmit = () => {
  const trimmed = fileName.value.trim()
  if (!trimmed) return
  if (isDirConflict.value) return

  if (isFileConflict.value) {
    if (!showOverwriteConfirmation.value) {
      showOverwriteConfirmation.value = true
      return
    }
    emit('submit', trimmed, true)
    return
  }

  emit('submit', trimmed, false)
}

const cancelOverwrite = () => {
  showOverwriteConfirmation.value = false
  nextTick(() => {
    inputRef.value?.focus()
    inputRef.value?.select()
  })
}
</script>

<template>
  <div
    v-if="show"
    tabindex="-1"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 outline-none select-none"
    @click.self="emit('close')"
    @keydown.esc.prevent.stop="showOverwriteConfirmation ? cancelOverwrite() : emit('close')"
  >
    <!-- State 1: File Input Modal -->
    <div
      v-if="!showOverwriteConfirmation"
      class="w-full max-w-sm rounded-xl border shadow-2xl p-4 space-y-3 animate-in fade-in zoom-in-95 duration-100"
      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
      @click.stop
    >
      <div class="flex items-center space-x-2">
        <CatppuccinIcon name="file" :size="16" />
        <h4 class="text-xs font-semibold" :style="{ color: 'var(--color-text-main)' }">
          Create New File ({{ target === 'local' ? 'Local' : 'Remote' }})
        </h4>
      </div>

      <div class="space-y-1.5">
        <input
          ref="inputRef"
          v-model="fileName"
          @keydown.enter.prevent="handleSubmit"
          @keyup.enter="handleSubmit"
          @keydown.esc.prevent.stop="emit('close')"
          placeholder="e.g. index.ts, config.json"
          class="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none transition-colors"
          :class="{
            'border-red-500/70 focus:border-red-500': isDirConflict,
            'border-amber-500/70 focus:border-amber-500': isFileConflict,
          }"
          :style="{
            backgroundColor: 'var(--color-bg-pane)',
            borderColor: isDirConflict ? undefined : isFileConflict ? undefined : 'var(--color-border)',
            color: 'var(--color-text-main)',
          }"
        />

        <!-- Conflict Warnings -->
        <div
          v-if="isDirConflict"
          class="px-2.5 py-1.5 rounded-md bg-red-500/10 border border-red-500/25 text-[11px] text-red-400 flex items-start space-x-1.5"
        >
          <span class="shrink-0">🚫</span>
          <span>A folder named <strong>"{{ fileName.trim() }}"</strong> already exists. Folders cannot be overwritten with a file.</span>
        </div>

        <div
          v-else-if="isFileConflict"
          class="px-2.5 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/25 text-[11px] text-amber-300 flex items-start space-x-1.5"
        >
          <span class="shrink-0">⚠️</span>
          <div class="space-y-0.5">
            <div>A file named <strong>"{{ fileName.trim() }}"</strong> already exists ({{ formatBytes(matchingItem?.size) }}).</div>
            <div class="text-[10px] text-amber-400/80">Submitting will ask for overwrite confirmation.</div>
          </div>
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
          :disabled="isDirConflict || !fileName.trim()"
          class="px-3 py-1 rounded text-white text-xs font-medium shadow transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          :class="isFileConflict ? 'bg-amber-600 hover:bg-amber-500' : 'btn-accent'"
        >
          {{ isFileConflict ? 'Overwrite...' : 'Create' }}
        </button>
      </div>
    </div>

    <!-- State 2: Explicit Overwrite Confirmation Modal -->
    <div
      v-else
      class="w-full max-w-sm rounded-xl border shadow-2xl p-4 space-y-3 animate-in fade-in zoom-in-95 duration-100"
      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
      @click.stop
    >
      <div class="flex items-center space-x-2 text-amber-400">
        <svg class="w-5 h-5 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <h4 class="text-xs font-bold text-amber-400">
          File Already Exists
        </h4>
      </div>

      <p class="text-xs leading-relaxed" :style="{ color: 'var(--color-text-main)' }">
        A file named <span class="font-mono font-semibold text-amber-300">"{{ fileName.trim() }}"</span> already exists on {{ target === 'local' ? 'the local file system' : 'the remote server' }}.
      </p>

      <!-- Existing File Specs -->
      <div
        v-if="matchingItem"
        class="px-3 py-2 rounded-lg border text-[11px] space-y-1 font-mono"
        :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
      >
        <div class="flex justify-between">
          <span>Current Size:</span>
          <span class="font-semibold" :style="{ color: 'var(--color-text-main)' }">{{ formatBytes(matchingItem.size) }}</span>
        </div>
        <div class="flex justify-between" v-if="matchingItem.modified">
          <span>Modified:</span>
          <span>{{ formatDate(matchingItem.modified) }}</span>
        </div>
      </div>

      <!-- Danger Alert -->
      <div class="p-2.5 rounded-lg bg-red-500/10 border border-red-500/25 text-[11px] text-red-300 space-y-0.5">
        <div class="font-semibold flex items-center space-x-1">
          <span>⚠️ Warning</span>
        </div>
        <p class="text-[10.5px] leading-tight text-red-300/90">
          Overwriting will replace the existing file with an empty file. All current contents will be permanently lost.
        </p>
      </div>

      <!-- Buttons -->
      <div class="flex justify-end space-x-2 pt-1.5">
        <button
          type="button"
          @click="cancelOverwrite"
          class="px-3 py-1 rounded text-xs transition cursor-pointer hover:underline"
          :style="{ color: 'var(--color-text-muted)' }"
        >
          Back / Rename
        </button>
        <button
          type="button"
          @click="handleSubmit"
          class="px-3 py-1 rounded text-white text-xs font-semibold shadow-md bg-red-600 hover:bg-red-500 transition cursor-pointer"
        >
          Overwrite File
        </button>
      </div>
    </div>
  </div>
</template>
