<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { ShieldQuestion, ShieldAlert } from 'lucide-vue-next'

interface HostKeyPrompt {
  request_id: string
  host: string
  port: number
  algorithm: string
  fingerprint: string
  status: 'unknown' | 'changed'
  old_fingerprint?: string | null
}

// Several connections can ask at once; show them one at a time.
const queue = ref<HostKeyPrompt[]>([])
const current = computed(() => queue.value[0] ?? null)
const isChanged = computed(() => current.value?.status === 'changed')
const rejectButtonRef = ref<HTMLButtonElement | null>(null)
const acceptButtonRef = ref<HTMLButtonElement | null>(null)

let unlisten: (() => void) | null = null

const focusSafeButton = () => {
  nextTick(() => {
    // A changed key may be an attack, so default focus to the safe choice.
    const target = isChanged.value ? rejectButtonRef.value : acceptButtonRef.value
    target?.focus()
  })
}

const respond = async (accept: boolean) => {
  const prompt = current.value
  if (!prompt) return
  queue.value = queue.value.slice(1)
  try {
    await invoke('ssh_host_key_respond', { requestId: prompt.request_id, accept })
  } catch (err) {
    console.warn('Failed to deliver host key decision:', err)
  }
  if (queue.value.length > 0) focusSafeButton()
}

onMounted(async () => {
  try {
    unlisten = await listen<HostKeyPrompt>('ssh:host_key_prompt', (event) => {
      queue.value.push(event.payload)
      if (queue.value.length === 1) focusSafeButton()
    })
  } catch (err) {
    console.warn('Failed to listen to ssh:host_key_prompt', err)
  }
})

onUnmounted(() => {
  if (unlisten) {
    unlisten()
    unlisten = null
  }
})
</script>

<template>
  <div
    v-if="current"
    class="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    @keydown.esc.stop="respond(false)"
  >
    <div
      class="w-full max-w-md rounded-2xl border shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95 duration-100"
      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: isChanged ? 'rgb(220 38 38 / 0.6)' : 'var(--color-border)' }"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="host-key-title"
    >
      <div class="flex items-start space-x-3">
        <div
          class="w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0"
          :class="isChanged ? 'bg-red-950/60 border-red-600/50 text-red-400' : 'bg-amber-950/60 border-amber-600/40 text-amber-400'"
        >
          <ShieldAlert v-if="isChanged" class="w-5 h-5" />
          <ShieldQuestion v-else class="w-5 h-5" />
        </div>
        <div class="flex-1 min-w-0">
          <h3 id="host-key-title" class="text-sm font-semibold" :style="{ color: 'var(--color-text-main)' }">
            {{ isChanged ? 'Host Key Has Changed' : 'Unknown Host Key' }}
          </h3>
          <p class="text-xs mt-0.5" :style="{ color: 'var(--color-text-muted)' }">
            <template v-if="isChanged">
              The key for <span class="font-mono">{{ current.host }}:{{ current.port }}</span> does not match the one
              you trusted before. This can mean the server was reinstalled, or that someone is intercepting your connection.
            </template>
            <template v-else>
              This is the first time you are connecting to
              <span class="font-mono">{{ current.host }}:{{ current.port }}</span>. Verify the fingerprint with your
              server administrator before continuing.
            </template>
          </p>
        </div>
      </div>

      <div
        class="rounded-xl border p-3 space-y-2.5 text-[11px] select-text"
        :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
      >
        <div class="space-y-0.5">
          <div class="uppercase tracking-wider text-[10px] font-medium" :style="{ color: 'var(--color-text-muted)' }">
            Key type
          </div>
          <div class="font-mono" :style="{ color: 'var(--color-text-main)' }">{{ current.algorithm }}</div>
        </div>

        <div v-if="isChanged && current.old_fingerprint" class="space-y-0.5">
          <div class="uppercase tracking-wider text-[10px] font-medium" :style="{ color: 'var(--color-text-muted)' }">
            Previously trusted fingerprint
          </div>
          <div class="font-mono break-all line-through opacity-70" :style="{ color: 'var(--color-text-main)' }">
            {{ current.old_fingerprint }}
          </div>
        </div>

        <div class="space-y-0.5">
          <div
            class="uppercase tracking-wider text-[10px] font-medium"
            :class="isChanged ? 'text-red-400' : 'text-amber-500/90'"
          >
            {{ isChanged ? 'New fingerprint (SHA256)' : 'Fingerprint (SHA256)' }}
          </div>
          <div class="font-mono break-all" :style="{ color: 'var(--color-text-main)' }">{{ current.fingerprint }}</div>
        </div>
      </div>

      <p v-if="queue.length > 1" class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">
        {{ queue.length - 1 }} more connection{{ queue.length > 2 ? 's are' : ' is' }} waiting for a decision.
      </p>

      <div class="flex items-center justify-end space-x-2 pt-1">
        <button
          ref="rejectButtonRef"
          type="button"
          @click="respond(false)"
          class="px-3 py-1.5 rounded-lg border text-xs font-medium transition btn-theme-card cursor-pointer"
          :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
        >
          Cancel
        </button>
        <button
          ref="acceptButtonRef"
          type="button"
          @click="respond(true)"
          class="px-3.5 py-1.5 rounded-lg text-white text-xs font-semibold shadow-sm transition cursor-pointer"
          :class="isChanged ? 'bg-red-600 hover:bg-red-700' : 'btn-accent'"
        >
          {{ isChanged ? 'Replace Key & Connect' : 'Trust & Connect' }}
        </button>
      </div>
    </div>
  </div>
</template>
