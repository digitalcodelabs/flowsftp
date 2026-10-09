<script setup lang="ts">
import { ref, watch } from 'vue'
import { Trash2, AlertTriangle } from 'lucide-vue-next'
import FileIcon from '../../FileIcon.vue'
import { formatBytes, getFileType } from '../../../utils/formatters'
import type { LocalFileEntry, SftpFileEntry } from '../../../stores/sftp'

interface DeleteTarget {
  pane: 'local' | 'remote'
  files: (LocalFileEntry | SftpFileEntry)[]
}

const props = defineProps<{
  show: boolean
  target: DeleteTarget | null
  initialFastRm?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'confirm', useFastRm: boolean): void
}>()

const useFastRm = ref(false)

watch(
  () => props.show,
  (isOpen) => {
    if (isOpen) {
      useFastRm.value = props.initialFastRm || false
    }
  },
  { immediate: true }
)

const handleConfirm = () => {
  emit('confirm', useFastRm.value)
}
</script>

<template>
  <div
    v-if="show && target"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150 select-none"
    @click.self="emit('close')"
  >
    <div
      class="w-full max-w-sm border rounded-2xl shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150"
      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
    >
      <div class="flex items-start space-x-3">
        <div class="w-10 h-10 rounded-xl bg-rose-950/60 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0 shadow-inner">
          <Trash2 class="w-5 h-5" />
        </div>
        <div class="flex-1 min-w-0">
          <h4 class="text-sm font-semibold" :style="{ color: 'var(--color-text-main)' }">
            {{
              target.files.length === 1
                ? (target.files[0].is_dir ? 'Delete Folder?' : 'Delete File?')
                : `Delete ${target.files.length} Items?`
            }}
          </h4>
          <p class="text-xs mt-1 leading-relaxed" :style="{ color: 'var(--color-text-muted)' }">
            Are you sure you want to permanently delete
            <template v-if="target.files.length === 1">
              <span class="font-semibold text-rose-300">"{{ target.files[0].name }}"</span>
            </template>
            <template v-else>
              these <span class="font-semibold text-rose-300">{{ target.files.length }} items</span>
            </template>
            from {{ target.pane === 'local' ? 'local disk' : 'the remote server' }}?
          </p>
        </div>
      </div>

      <!-- Selected Items Preview Box -->
      <div class="p-3 rounded-xl border space-y-2 text-xs" :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }">
        <!-- Single Item Details -->
        <div v-if="target.files.length === 1" class="space-y-1.5">
          <div class="flex items-center font-medium truncate" :style="{ color: 'var(--color-text-main)' }">
            <FileIcon :name="target.files[0].name" :is-dir="target.files[0].is_dir" :size="18" class="mr-2" />
            <span class="truncate font-mono text-[11px]">{{ target.files[0].name }}</span>
          </div>
          <div class="flex items-center justify-between text-[11px] border-t pt-1.5" :style="{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }">
            <span>{{ getFileType(target.files[0]) }}</span>
            <span class="font-mono">{{ target.files[0].is_dir ? '-' : formatBytes(target.files[0].size) }}</span>
          </div>
          <div class="text-[10px] font-mono truncate" :style="{ color: 'var(--color-text-muted)' }">
            {{ target.files[0].path }}
          </div>
        </div>

        <!-- Multiple Items List Preview -->
        <div v-else class="space-y-1.5">
          <div class="text-[11px] font-semibold uppercase tracking-wider" :style="{ color: 'var(--color-text-muted)' }">
            Selected Items ({{ target.files.length }})
          </div>
          <div class="max-h-32 overflow-y-auto space-y-1 divide-y pr-1" :style="{ borderColor: 'var(--color-border)' }">
            <div
              v-for="item in target.files"
              :key="item.path"
              class="flex items-center justify-between pt-1 first:pt-0 text-[11px]"
            >
              <div class="flex items-center space-x-1.5 min-w-0 mr-2">
                <FileIcon :name="item.name" :is-dir="item.is_dir" :size="14" />
                <span class="truncate font-mono" :style="{ color: 'var(--color-text-main)' }">{{ item.name }}</span>
              </div>
              <span class="shrink-0 font-mono text-[10px]" :style="{ color: 'var(--color-text-muted)' }">
                {{ item.is_dir ? 'Folder' : formatBytes(item.size) }}
              </span>
            </div>
          </div>
        </div>

        <!-- Directory Deletion Warning -->
        <div
          v-if="target.files.some(f => f.is_dir)"
          class="flex items-start text-amber-400/90 text-[11px] pt-1.5 border-t"
          :style="{ borderColor: 'var(--color-border)' }"
        >
          <AlertTriangle class="w-3.5 h-3.5 mr-1.5 shrink-0 mt-0.5 text-amber-400" />
          <span>Folder contents will also be recursively deleted. This cannot be undone.</span>
        </div>

        <!-- Fast rm -rf SSH option (Remote SFTP folders only) -->
        <label
          v-if="target.pane === 'remote' && target.files.some(f => f.is_dir)"
          class="flex items-start space-x-2 text-xs cursor-pointer select-none pt-2 border-t"
          :style="{ borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
        >
          <input
            type="checkbox"
            v-model="useFastRm"
            class="rounded border-zinc-700 bg-zinc-900 text-rose-500 focus:ring-0 cursor-pointer mt-0.5"
          />
          <div class="flex flex-col">
            <span class="font-medium text-[11px]">Use fast remote deletion (<code class="font-mono text-[10px] text-amber-300">rm -rf</code> via SSH)</span>
            <span class="text-[10px]" :style="{ color: 'var(--color-text-muted)' }">
              Recommended for massive directories (e.g. node_modules, vendor). Requires remote shell permissions.
            </span>
          </div>
        </label>
      </div>

      <!-- Action Buttons -->
      <div class="flex items-center justify-end space-x-2 pt-1">
        <button
          type="button"
          @click="emit('close')"
          class="px-3.5 py-1.5 rounded-lg text-xs font-medium transition btn-theme-card cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          @click="handleConfirm"
          class="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 shadow-md shadow-rose-950/50 flex items-center space-x-1.5 transition cursor-pointer"
        >
          <Trash2 class="w-3.5 h-3.5" />
          <span>{{ target.files.length === 1 ? 'Delete Permanently' : 'Delete All Selected' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
