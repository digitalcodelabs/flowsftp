<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { Hash, Copy, Check, ShieldCheck, AlertCircle, RefreshCw } from 'lucide-vue-next'
import { useSftpStore, type LocalFileEntry, type SftpFileEntry } from '../../../stores/sftp'
import { formatBytes } from '../../../utils/formatters'
import { useModalEscape } from '../composables/useModalEscape'

const props = defineProps<{
  show: boolean
  target: 'local' | 'remote'
  file: LocalFileEntry | SftpFileEntry | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const sftpStore = useSftpStore()

const isLoadingMd5 = ref(false)
const isLoadingSha256 = ref(false)
const md5Hash = ref('')
const sha256Hash = ref('')
const error = ref<string | null>(null)
const copiedField = ref<'md5' | 'sha256' | null>(null)
const verificationInput = ref('')

useModalEscape(() => props.show, () => emit('close'))

async function calculateHashes() {
  if (!props.file) return
  error.value = null
  md5Hash.value = ''
  sha256Hash.value = ''
  verificationInput.value = ''

  isLoadingMd5.value = true
  isLoadingSha256.value = true

  // Compute MD5
  sftpStore
    .calculateChecksum(props.target, props.file.path, 'md5')
    .then((hash) => {
      md5Hash.value = hash
    })
    .catch((err) => {
      error.value = `MD5 failed: ${err?.message || err}`
    })
    .finally(() => {
      isLoadingMd5.value = false
    })

  // Compute SHA-256
  sftpStore
    .calculateChecksum(props.target, props.file.path, 'sha256')
    .then((hash) => {
      sha256Hash.value = hash
    })
    .catch((err) => {
      if (!error.value) {
        error.value = `SHA-256 failed: ${err?.message || err}`
      }
    })
    .finally(() => {
      isLoadingSha256.value = false
    })
}

watch(
  () => props.show,
  (isOpen) => {
    if (isOpen && props.file) {
      calculateHashes()
    }
  },
  { immediate: true }
)

async function copyToClipboard(text: string, field: 'md5' | 'sha256') {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    copiedField.value = field
    setTimeout(() => {
      if (copiedField.value === field) {
        copiedField.value = null
      }
    }, 2000)
  } catch (err) {
    console.error('Failed to copy to clipboard', err)
  }
}

const verificationStatus = computed(() => {
  const input = verificationInput.value.trim().toLowerCase()
  if (!input) return null
  const md5Match = md5Hash.value && md5Hash.value.toLowerCase() === input
  const sha256Match = sha256Hash.value && sha256Hash.value.toLowerCase() === input
  if (md5Match || sha256Match) {
    return {
      match: true,
      label: md5Match ? 'Match! (MD5 checksum matched)' : 'Match! (SHA-256 checksum matched)',
    }
  }
  return {
    match: false,
    label: 'Checksum does not match calculated hashes',
  }
})
</script>

<template>
  <div
    v-if="show && file"
    tabindex="-1"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 outline-none select-none"
    @click.self="emit('close')"
    @keydown.esc.prevent.stop="emit('close')"
  >
    <div
      class="w-full max-w-lg rounded-xl border shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95 duration-100"
      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
      @click.stop
    >
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-2">
          <Hash :size="18" :style="{ color: 'var(--color-accent)' }" />
          <div>
            <h4 class="text-sm font-semibold" :style="{ color: 'var(--color-text-main)' }">
              File Checksum Verification
            </h4>
            <div class="text-[11px] font-mono truncate max-w-md" :style="{ color: 'var(--color-text-muted)' }">
              {{ file.name }} ({{ formatBytes(file.size) }}) &bull; {{ target === 'local' ? 'Local' : 'Remote' }}
            </div>
          </div>
        </div>
        <button
          type="button"
          @click="calculateHashes"
          title="Recalculate"
          class="p-1.5 rounded-lg border hover:bg-[var(--color-bg-hover)] transition"
          :style="{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
        >
          <RefreshCw :size="14" :class="{ 'animate-spin': isLoadingMd5 || isLoadingSha256 }" />
        </button>
      </div>

      <!-- Error banner if any -->
      <div
        v-if="error"
        class="p-2.5 rounded-lg border text-xs flex items-center space-x-2"
        :style="{
          backgroundColor: 'color-mix(in srgb, var(--color-danger, #f38ba8) 12%, transparent)',
          borderColor: 'var(--color-danger, #f38ba8)',
          color: 'var(--color-danger, #f38ba8)',
        }"
      >
        <AlertCircle :size="16" class="shrink-0" />
        <span class="truncate">{{ error }}</span>
      </div>

      <!-- Hashes -->
      <div class="space-y-3">
        <!-- MD5 Hash -->
        <div
          class="p-3 rounded-lg border space-y-1.5"
          :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
        >
          <div class="flex items-center justify-between text-[11px] font-semibold tracking-wider uppercase" :style="{ color: 'var(--color-text-muted)' }">
            <span>MD5 Checksum</span>
            <button
              v-if="md5Hash"
              type="button"
              @click="copyToClipboard(md5Hash, 'md5')"
              class="flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-medium border transition"
              :style="{
                backgroundColor: 'var(--color-bg-card)',
                borderColor: 'var(--color-border)',
                color: copiedField === 'md5' ? 'var(--color-success, #a6e3a1)' : 'var(--color-text-main)',
              }"
            >
              <Check v-if="copiedField === 'md5'" :size="12" />
              <Copy v-else :size="12" />
              <span>{{ copiedField === 'md5' ? 'Copied' : 'Copy' }}</span>
            </button>
          </div>
          <div class="font-mono text-xs select-all break-all" :style="{ color: 'var(--color-text-main)' }">
            <span v-if="isLoadingMd5" class="opacity-60 italic text-[11px]">Computing MD5 hash...</span>
            <span v-else-if="md5Hash">{{ md5Hash }}</span>
            <span v-else class="opacity-40">&mdash;</span>
          </div>
        </div>

        <!-- SHA-256 Hash -->
        <div
          class="p-3 rounded-lg border space-y-1.5"
          :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
        >
          <div class="flex items-center justify-between text-[11px] font-semibold tracking-wider uppercase" :style="{ color: 'var(--color-text-muted)' }">
            <span>SHA-256 Checksum</span>
            <button
              v-if="sha256Hash"
              type="button"
              @click="copyToClipboard(sha256Hash, 'sha256')"
              class="flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-medium border transition"
              :style="{
                backgroundColor: 'var(--color-bg-card)',
                borderColor: 'var(--color-border)',
                color: copiedField === 'sha256' ? 'var(--color-success, #a6e3a1)' : 'var(--color-text-main)',
              }"
            >
              <Check v-if="copiedField === 'sha256'" :size="12" />
              <Copy v-else :size="12" />
              <span>{{ copiedField === 'sha256' ? 'Copied' : 'Copy' }}</span>
            </button>
          </div>
          <div class="font-mono text-xs select-all break-all" :style="{ color: 'var(--color-text-main)' }">
            <span v-if="isLoadingSha256" class="opacity-60 italic text-[11px]">Computing SHA-256 hash...</span>
            <span v-else-if="sha256Hash">{{ sha256Hash }}</span>
            <span v-else class="opacity-40">&mdash;</span>
          </div>
        </div>

        <!-- Compare / Verify with expected hash -->
        <div class="pt-1">
          <label class="block text-xs font-medium mb-1" :style="{ color: 'var(--color-text-muted)' }">
            Verify with Expected Checksum:
          </label>
          <input
            v-model="verificationInput"
            placeholder="Paste expected MD5 or SHA-256 hash to compare..."
            class="w-full px-3 py-1.5 rounded-lg border font-mono text-xs focus:outline-none transition-colors"
            :style="{
              backgroundColor: 'var(--color-bg-pane)',
              borderColor: verificationStatus
                ? verificationStatus.match
                  ? 'var(--color-success, #a6e3a1)'
                  : 'var(--color-danger, #f38ba8)'
                : 'var(--color-border)',
              color: 'var(--color-text-main)',
            }"
          />
          <div
            v-if="verificationStatus"
            class="mt-1.5 flex items-center space-x-1.5 text-xs font-medium"
            :style="{
              color: verificationStatus.match
                ? 'var(--color-success, #a6e3a1)'
                : 'var(--color-danger, #f38ba8)',
            }"
          >
            <ShieldCheck v-if="verificationStatus.match" :size="14" />
            <AlertCircle v-else :size="14" />
            <span>{{ verificationStatus.label }}</span>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-end pt-2 border-t" :style="{ borderColor: 'var(--color-border)' }">
        <button
          type="button"
          @click="emit('close')"
          class="px-4 py-1.5 rounded-lg text-xs font-semibold transition"
          :style="{
            backgroundColor: 'var(--color-bg-pane)',
            color: 'var(--color-text-main)',
          }"
        >
          Close
        </button>
      </div>
    </div>
  </div>
</template>
