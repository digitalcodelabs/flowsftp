<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { Link2 } from 'lucide-vue-next'
import CatppuccinIcon from '../../CatppuccinIcon.vue'
import { useModalEscape } from '../composables/useModalEscape'
import type { LocalFileEntry, SftpFileEntry } from '../../../stores/sftp'

const props = defineProps<{
  show: boolean
  target: 'local' | 'remote'
  currentPath: string
  selectedItem?: LocalFileEntry | SftpFileEntry | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submit', data: { target: string; linkName: string }): void
}>()

const linkName = ref('')
const targetPath = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

useModalEscape(() => props.show, () => emit('close'))

watch(
  () => props.show,
  (isOpen) => {
    if (isOpen) {
      if (props.selectedItem) {
        targetPath.value = props.selectedItem.name
        linkName.value = `${props.selectedItem.name}.link`
      } else {
        targetPath.value = ''
        linkName.value = ''
      }
      nextTick(() => {
        inputRef.value?.focus()
        inputRef.value?.select()
      })
    }
  },
  { immediate: true }
)

const isValid = computed(() => {
  return linkName.value.trim().length > 0 && targetPath.value.trim().length > 0
})

const handleSubmit = () => {
  if (!isValid.value) return
  emit('submit', {
    target: targetPath.value.trim(),
    linkName: linkName.value.trim(),
  })
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
      class="w-full max-w-md rounded-xl border shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95 duration-100"
      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
      @click.stop
    >
      <div class="flex items-center space-x-2">
        <Link2 :size="18" :style="{ color: 'var(--color-accent)' }" />
        <h4 class="text-sm font-semibold" :style="{ color: 'var(--color-text-main)' }">
          Create Symbolic Link ({{ target === 'local' ? 'Local' : 'Remote' }})
        </h4>
      </div>

      <div class="space-y-3 text-xs">
        <div>
          <label class="block font-medium mb-1" :style="{ color: 'var(--color-text-muted)' }">
            Symlink Name (created in <span class="font-mono text-[11px]">{{ currentPath || '/' }}</span>)
          </label>
          <input
            ref="inputRef"
            v-model="linkName"
            @keydown.enter.prevent="handleSubmit"
            @keydown.esc.prevent.stop="emit('close')"
            placeholder="e.g. current_version or link_name"
            class="w-full px-3 py-1.5 rounded-lg border focus:outline-none transition-colors"
            :style="{
              backgroundColor: 'var(--color-bg-pane)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-main)',
            }"
          />
        </div>

        <div>
          <label class="block font-medium mb-1" :style="{ color: 'var(--color-text-muted)' }">
            Target Path / Destination (path the link points to)
          </label>
          <input
            v-model="targetPath"
            @keydown.enter.prevent="handleSubmit"
            @keydown.esc.prevent.stop="emit('close')"
            placeholder="e.g. /var/www/release-1.2 or ./relative-file.txt"
            class="w-full px-3 py-1.5 rounded-lg border font-mono text-[11px] focus:outline-none transition-colors"
            :style="{
              backgroundColor: 'var(--color-bg-pane)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-main)',
            }"
          />
        </div>
      </div>

      <div class="flex items-center justify-end space-x-2 pt-2 border-t" :style="{ borderColor: 'var(--color-border)' }">
        <button
          type="button"
          @click="emit('close')"
          class="px-3 py-1.5 rounded-lg text-xs font-medium transition"
          :style="{
            backgroundColor: 'var(--color-bg-pane)',
            color: 'var(--color-text-muted)',
          }"
        >
          Cancel
        </button>
        <button
          type="button"
          :disabled="!isValid"
          @click="handleSubmit"
          class="px-4 py-1.5 rounded-lg text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
          :style="{
            backgroundColor: 'var(--color-accent)',
            color: 'var(--color-bg-app)',
          }"
        >
          Create Symlink
        </button>
      </div>
    </div>
  </div>
</template>
