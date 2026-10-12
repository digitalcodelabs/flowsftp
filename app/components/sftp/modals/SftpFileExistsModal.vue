<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ConflictPolicy } from '../../../utils/conflict'

const props = defineProps<{
  show: boolean
  modelValue: ConflictPolicy
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', policy: ConflictPolicy): void
}>()

const selected = ref<ConflictPolicy>('ask')

watch(
  () => props.show,
  (isOpen) => {
    if (isOpen) {
      selected.value = props.modelValue || 'ask'
    }
  },
  { immediate: true }
)

const handleSave = () => {
  emit('save', selected.value)
}
</script>

<template>
  <div
    v-if="show"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-100"
    @click.self="emit('close')"
  >
    <div
      class="w-full max-w-sm rounded-xl border shadow-2xl p-4 space-y-4 animate-in fade-in zoom-in-95 duration-100"
      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
    >
      <h4 class="text-sm font-semibold" :style="{ color: 'var(--color-text-main)' }">
        Default file exists action
      </h4>
      <p class="text-xs" :style="{ color: 'var(--color-text-muted)' }">
        Select default action when target file already exists during transfer:
      </p>

      <div class="space-y-2 text-xs">
        <label
          class="flex items-center space-x-2.5 p-2 rounded-lg border cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition"
          :style="{ borderColor: selected === 'ask' ? 'var(--color-accent)' : 'var(--color-border)' }"
        >
          <input type="radio" value="ask" v-model="selected" class="text-sky-500" />
          <div>
            <div class="font-medium" :style="{ color: 'var(--color-text-main)' }">Ask for action (Prompt)</div>
            <div class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">Display prompt dialog asking whether to overwrite or skip</div>
          </div>
        </label>

        <label
          class="flex items-center space-x-2.5 p-2 rounded-lg border cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition"
          :style="{ borderColor: selected === 'overwrite' ? 'var(--color-accent)' : 'var(--color-border)' }"
        >
          <input type="radio" value="overwrite" v-model="selected" class="text-sky-500" />
          <div>
            <div class="font-medium" :style="{ color: 'var(--color-text-main)' }">Overwrite file</div>
            <div class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">Always overwrite existing file on destination</div>
          </div>
        </label>

        <label
          class="flex items-center space-x-2.5 p-2 rounded-lg border cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition"
          :style="{ borderColor: selected === 'skip' ? 'var(--color-accent)' : 'var(--color-border)' }"
        >
          <input type="radio" value="skip" v-model="selected" class="text-sky-500" />
          <div>
            <div class="font-medium" :style="{ color: 'var(--color-text-main)' }">Skip file</div>
            <div class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">Leave existing destination file untouched</div>
          </div>
        </label>
      </div>

      <div class="flex items-center justify-end space-x-2 pt-2 border-t" :style="{ borderColor: 'var(--color-border)' }">
        <button
          @click="emit('close')"
          class="px-3 py-1.5 rounded-lg text-xs transition cursor-pointer hover:bg-black/10 dark:hover:bg-white/10"
          :style="{ color: 'var(--color-text-muted)' }"
        >
          Cancel
        </button>
        <button
          @click="handleSave"
          class="px-4 py-1.5 rounded-lg text-xs font-semibold text-white shadow-sm transition cursor-pointer"
          :style="{ backgroundColor: 'var(--color-accent)' }"
        >
          OK
        </button>
      </div>
    </div>
  </div>
</template>
