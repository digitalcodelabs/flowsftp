<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import CatppuccinIcon from '../../CatppuccinIcon.vue'

const props = defineProps<{
  show: boolean
  target: 'local' | 'remote'
  initialName: string
  isDir?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submit', newName: string): void
}>()

const newName = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

const focusInput = () => {
  const el = inputRef.value
  if (!el) return
  el.focus()
  const name = el.value
  if (props.isDir || !name.includes('.') || (name.startsWith('.') && name.indexOf('.', 1) === -1)) {
    el.select()
  } else {
    const lastDot = name.lastIndexOf('.')
    if (lastDot > 0) {
      el.setSelectionRange(0, lastDot)
    } else {
      el.select()
    }
  }
}

watch(
  () => props.show,
  (isOpen) => {
    if (isOpen) {
      newName.value = props.initialName
      nextTick(() => {
        focusInput()
        setTimeout(focusInput, 50)
      })
    }
  },
  { immediate: true }
)

const handleSubmit = () => {
  const trimmed = newName.value.trim()
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
      <h4 class="text-xs font-semibold flex items-center space-x-1.5" :style="{ color: 'var(--color-text-main)' }">
        <CatppuccinIcon name="rename" :size="14" />
        <span>Rename Item ({{ target === 'local' ? 'Local' : 'Remote' }})</span>
      </h4>
      <input
        ref="inputRef"
        v-model="newName"
        @keydown.enter.prevent="handleSubmit"
        @keyup.enter="handleSubmit"
        @keydown.esc="emit('close')"
        placeholder="New name"
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
          class="px-3 py-1 rounded text-white text-xs font-medium shadow cursor-pointer"
          :style="{ backgroundColor: 'var(--color-accent)' }"
        >
          Rename
        </button>
      </div>
    </div>
  </div>
</template>
