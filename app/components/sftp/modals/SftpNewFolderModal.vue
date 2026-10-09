<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import CatppuccinIcon from '../../CatppuccinIcon.vue'

const props = defineProps<{
  show: boolean
  target: 'local' | 'remote'
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submit', name: string): void
}>()

const folderName = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

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

const handleSubmit = () => {
  const trimmed = folderName.value.trim()
  if (!trimmed) return
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
      class="w-full max-w-xs rounded-xl border shadow-2xl p-4 space-y-3 animate-in fade-in zoom-in-95 duration-100"
      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
    >
      <div class="flex items-center space-x-2">
        <CatppuccinIcon name="folder" :size="16" />
        <h4 class="text-xs font-semibold" :style="{ color: 'var(--color-text-main)' }">
          Create New Directory ({{ target === 'local' ? 'Local' : 'Remote' }})
        </h4>
      </div>
      <input
        ref="inputRef"
        v-model="folderName"
        @keydown.enter.prevent="handleSubmit"
        @keyup.enter="handleSubmit"
        @keydown.esc="emit('close')"
        placeholder="Directory name"
        class="w-full px-3 py-1.5 rounded-lg border text-xs focus:outline-none"
        :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
      />
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
          class="px-3 py-1 rounded text-white text-xs font-medium shadow btn-accent cursor-pointer"
        >
          Create
        </button>
      </div>
    </div>
  </div>
</template>
