<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { Lock, Shield, Check, AlertCircle, X } from 'lucide-vue-next'
import { type SftpFileEntry } from '../stores/sftp'
import FileIcon from './FileIcon.vue'

const props = defineProps<{
  show: boolean
  sessionId: string | null
  item: SftpFileEntry | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'updated'): void
}>()

// Owner
const ownerRead = ref(true)
const ownerWrite = ref(true)
const ownerExec = ref(false)

// Group
const groupRead = ref(true)
const groupWrite = ref(false)
const groupExec = ref(false)

// Public
const publicRead = ref(true)
const publicWrite = ref(false)
const publicExec = ref(false)

// Recursive options
const isRecursive = ref(false)
const recursiveTarget = ref<'all' | 'files' | 'dirs'>('all')

const isSaving = ref(false)
const errorMessage = ref<string | null>(null)
const successMessage = ref<string | null>(null)

// Compute octal number from checkboxes
const octalValue = computed(() => {
  const o = (ownerRead.value ? 4 : 0) + (ownerWrite.value ? 2 : 0) + (ownerExec.value ? 1 : 0)
  const g = (groupRead.value ? 4 : 0) + (groupWrite.value ? 2 : 0) + (groupExec.value ? 1 : 0)
  const p = (publicRead.value ? 4 : 0) + (publicWrite.value ? 2 : 0) + (publicExec.value ? 1 : 0)
  return `${o}${g}${p}`
})

// Numeric input model for two-way binding
const numericInput = ref('0644')

// Sync numeric input when checkboxes change
watch(octalValue, (val) => {
  numericInput.value = `0${val}`
})

// Parse numeric input to set checkboxes
const applyNumeric = (raw: string) => {
  let clean = raw.trim()
  if (clean.startsWith('0')) {
    clean = clean.slice(1)
  }
  if (!/^[0-7]{3}$/.test(clean)) return

  const [o, g, p] = clean.split('').map(Number)

  ownerRead.value = (o & 4) !== 0
  ownerWrite.value = (o & 2) !== 0
  ownerExec.value = (o & 1) !== 0

  groupRead.value = (g & 4) !== 0
  groupWrite.value = (g & 2) !== 0
  groupExec.value = (g & 1) !== 0

  publicRead.value = (p & 4) !== 0
  publicWrite.value = (p & 2) !== 0
  publicExec.value = (p & 1) !== 0
}

const handleNumericChange = () => {
  applyNumeric(numericInput.value)
}

// Symbolic string (e.g. -rwxr-xr-x)
const symbolicString = computed(() => {
  const typeChar = props.item?.is_dir ? 'd' : '-'
  const r1 = ownerRead.value ? 'r' : '-'
  const w1 = ownerWrite.value ? 'w' : '-'
  const x1 = ownerExec.value ? 'x' : '-'
  const r2 = groupRead.value ? 'r' : '-'
  const w2 = groupWrite.value ? 'w' : '-'
  const x2 = groupExec.value ? 'x' : '-'
  const r3 = publicRead.value ? 'r' : '-'
  const w3 = publicWrite.value ? 'w' : '-'
  const x3 = publicExec.value ? 'x' : '-'
  return `${typeChar}${r1}${w1}${x1}${r2}${w2}${x2}${r3}${w3}${x3}`
})

// Apply preset
const applyPreset = (preset: string) => {
  numericInput.value = preset.startsWith('0') ? preset : `0${preset}`
  applyNumeric(numericInput.value)
}

// Populate from item on show
watch(
  () => [props.show, props.item] as const,
  ([show, item]) => {
    if (show && item) {
      errorMessage.value = null
      successMessage.value = null
      isRecursive.value = false
      recursiveTarget.value = 'all'

      // Extract lower 9 bits (0o777) from item.permissions
      const perm = item.permissions ? item.permissions & 0o777 : (item.is_dir ? 0o755 : 0o644)
      const octStr = perm.toString(8).padStart(3, '0')
      applyPreset(`0${octStr}`)
    }
  },
  { immediate: true }
)

const handleSave = async () => {
  if (!props.item || !props.sessionId) return
  isSaving.value = true
  errorMessage.value = null
  successMessage.value = null

  try {
    const permInt = parseInt(octalValue.value, 8)
    await invoke('sftp_set_permissions', {
      sessionId: props.sessionId,
      path: props.item.path,
      permissions: permInt,
      recursive: isRecursive.value,
      targetType: isRecursive.value ? recursiveTarget.value : null,
    })

    successMessage.value = 'Permissions applied'
    emit('updated')
    setTimeout(() => {
      emit('close')
    }, 600)
  } catch (err: any) {
    console.error('Failed to set permissions:', err)
    errorMessage.value = err?.message || String(err)
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div
    v-if="show && item"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-150 select-none"
    @click.self="emit('close')"
  >
    <div
      class="w-full max-w-md rounded-2xl border shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150 transition-colors"
      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
    >
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-2.5">
          <div
            class="w-8 h-8 rounded-lg flex items-center justify-center border shadow-xs"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
          >
            <Shield class="w-4 h-4" :style="{ color: 'var(--color-accent)' }" />
          </div>
          <div>
            <h3 class="text-xs font-semibold" :style="{ color: 'var(--color-text-main)' }">
              File Permissions (chmod)
            </h3>
            <p class="text-[11px] font-mono truncate max-w-xs" :style="{ color: 'var(--color-text-muted)' }">
              {{ item.name }}
            </p>
          </div>
        </div>

        <button
          @click="emit('close')"
          class="p-1 rounded-lg text-slate-400 hover:text-slate-200 transition"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <!-- Item Preview Box -->
      <div
        class="flex items-center justify-between p-2.5 rounded-xl border text-xs font-mono"
        :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
      >
        <div class="flex items-center space-x-2 truncate mr-3">
          <FileIcon :name="item.name" :is-dir="item.is_dir" :size="16" />
          <span class="truncate" :style="{ color: 'var(--color-text-main)' }">{{ item.path }}</span>
        </div>
        <div class="shrink-0 flex items-center space-x-1 font-semibold" :style="{ color: 'var(--color-accent)' }">
          <span>{{ symbolicString }}</span>
        </div>
      </div>

      <!-- Permission Checkboxes Grid -->
      <div
        class="rounded-xl border p-3.5 space-y-3"
        :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
      >
        <div class="grid grid-cols-4 gap-2 text-center text-xs">
          <div></div>
          <div class="font-semibold text-[11px]" :style="{ color: 'var(--color-text-muted)' }">Read</div>
          <div class="font-semibold text-[11px]" :style="{ color: 'var(--color-text-muted)' }">Write</div>
          <div class="font-semibold text-[11px]" :style="{ color: 'var(--color-text-muted)' }">Execute</div>

          <!-- Owner / User -->
          <div class="text-left font-medium text-xs py-1" :style="{ color: 'var(--color-text-main)' }">
            Owner (User)
          </div>
          <div class="flex items-center justify-center">
            <input type="checkbox" v-model="ownerRead" class="rounded accent-indigo-500 w-4 h-4 cursor-pointer" />
          </div>
          <div class="flex items-center justify-center">
            <input type="checkbox" v-model="ownerWrite" class="rounded accent-indigo-500 w-4 h-4 cursor-pointer" />
          </div>
          <div class="flex items-center justify-center">
            <input type="checkbox" v-model="ownerExec" class="rounded accent-indigo-500 w-4 h-4 cursor-pointer" />
          </div>

          <!-- Group -->
          <div class="text-left font-medium text-xs py-1" :style="{ color: 'var(--color-text-main)' }">
            Group
          </div>
          <div class="flex items-center justify-center">
            <input type="checkbox" v-model="groupRead" class="rounded accent-indigo-500 w-4 h-4 cursor-pointer" />
          </div>
          <div class="flex items-center justify-center">
            <input type="checkbox" v-model="groupWrite" class="rounded accent-indigo-500 w-4 h-4 cursor-pointer" />
          </div>
          <div class="flex items-center justify-center">
            <input type="checkbox" v-model="groupExec" class="rounded accent-indigo-500 w-4 h-4 cursor-pointer" />
          </div>

          <!-- Public / Others -->
          <div class="text-left font-medium text-xs py-1" :style="{ color: 'var(--color-text-main)' }">
            Public (Others)
          </div>
          <div class="flex items-center justify-center">
            <input type="checkbox" v-model="publicRead" class="rounded accent-indigo-500 w-4 h-4 cursor-pointer" />
          </div>
          <div class="flex items-center justify-center">
            <input type="checkbox" v-model="publicWrite" class="rounded accent-indigo-500 w-4 h-4 cursor-pointer" />
          </div>
          <div class="flex items-center justify-center">
            <input type="checkbox" v-model="publicExec" class="rounded accent-indigo-500 w-4 h-4 cursor-pointer" />
          </div>
        </div>
      </div>

      <!-- Numeric Octal Input and Presets -->
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center space-x-2">
          <label class="text-xs font-semibold" :style="{ color: 'var(--color-text-main)' }">
            Numeric Value:
          </label>
          <input
            v-model="numericInput"
            @input="handleNumericChange"
            maxlength="4"
            class="w-18 px-2.5 py-1 rounded-lg border text-center font-mono text-xs font-semibold focus:outline-none focus:border-indigo-400"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
          />
        </div>

        <!-- Presets -->
        <div class="flex items-center space-x-1 text-[10px] font-mono">
          <button
            @click="applyPreset('644')"
            class="px-2 py-0.8 rounded border transition hover:opacity-80 btn-theme-card"
            :style="{ borderColor: 'var(--color-border)' }"
            title="Standard file (644)"
          >
            644
          </button>
          <button
            @click="applyPreset('755')"
            class="px-2 py-0.8 rounded border transition hover:opacity-80 btn-theme-card"
            :style="{ borderColor: 'var(--color-border)' }"
            title="Executable / Directory (755)"
          >
            755
          </button>
          <button
            @click="applyPreset('600')"
            class="px-2 py-0.8 rounded border transition hover:opacity-80 btn-theme-card"
            :style="{ borderColor: 'var(--color-border)' }"
            title="Private file (600)"
          >
            600
          </button>
          <button
            @click="applyPreset('777')"
            class="px-2 py-0.8 rounded border transition hover:opacity-80 btn-theme-card"
            :style="{ borderColor: 'var(--color-border)' }"
            title="Full permissions (777)"
          >
            777
          </button>
        </div>
      </div>

      <!-- Directory Recursive Option -->
      <div
        v-if="item.is_dir"
        class="rounded-xl border p-3 space-y-2 text-xs transition-colors"
        :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
      >
        <label class="flex items-center space-x-2 cursor-pointer font-medium" :style="{ color: 'var(--color-text-main)' }">
          <input type="checkbox" v-model="isRecursive" class="rounded accent-indigo-500 w-4 h-4 cursor-pointer" />
          <span>Recurse into subdirectories</span>
        </label>

        <div v-if="isRecursive" class="pl-6 space-y-1.5 pt-1 text-[11px]" :style="{ color: 'var(--color-text-muted)' }">
          <label class="flex items-center space-x-2 cursor-pointer">
            <input type="radio" value="all" v-model="recursiveTarget" class="accent-indigo-500" />
            <span>Apply to all files and directories</span>
          </label>
          <label class="flex items-center space-x-2 cursor-pointer">
            <input type="radio" value="files" v-model="recursiveTarget" class="accent-indigo-500" />
            <span>Apply to files only</span>
          </label>
          <label class="flex items-center space-x-2 cursor-pointer">
            <input type="radio" value="dirs" v-model="recursiveTarget" class="accent-indigo-500" />
            <span>Apply to directories only</span>
          </label>
        </div>
      </div>

      <!-- Notification Messages -->
      <div
        v-if="errorMessage"
        class="p-2.5 rounded-lg bg-red-950/80 border border-red-700/80 text-red-200 text-xs flex items-center space-x-2"
      >
        <AlertCircle class="w-4 h-4 shrink-0 text-red-400" />
        <span class="truncate">{{ errorMessage }}</span>
      </div>

      <div
        v-if="successMessage"
        class="p-2.5 rounded-lg bg-emerald-950/80 border border-emerald-700/80 text-emerald-200 text-xs flex items-center space-x-2"
      >
        <Check class="w-4 h-4 shrink-0 text-emerald-400" />
        <span class="truncate">{{ successMessage }}</span>
      </div>

      <!-- Action Buttons -->
      <div class="flex items-center justify-end space-x-2 pt-1">
        <button
          type="button"
          @click="emit('close')"
          class="px-3.5 py-1.5 rounded-lg text-xs font-medium transition btn-theme-card"
        >
          Cancel
        </button>
        <button
          type="button"
          @click="handleSave"
          :disabled="isSaving"
          class="px-4 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition btn-accent flex items-center space-x-1.5 disabled:opacity-50"
        >
          <span v-if="isSaving" class="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          <span>{{ isSaving ? 'Applying...' : 'Apply Permissions' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
