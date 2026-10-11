<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import {
  FolderSync,
  X,
  Play,
  Pause,
  Trash2,
  Folder,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  RotateCw,
  Plus,
} from 'lucide-vue-next'
import { useDirWatcherStore, type DirWatcherPairing } from '../../../stores/dirWatcher'

const props = defineProps<{
  show: boolean
  sessionId: string | null
  initialLocalDir?: string
  initialRemoteDir?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'toast', msg: string, isError?: boolean): void
}>()

const dirWatcherStore = useDirWatcherStore()

const localDirInput = ref('')
const remoteDirInput = ref('')
const ignorePatternsInput = ref('.git, node_modules, .vscode, .idea, dist, build, target, *.log')
const isStarting = ref(false)
const errorMessage = ref<string | null>(null)

const handleWindowKeyDown = (e: KeyboardEvent) => {
  if (!props.show) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
  }
}

watch(
  () => [props.show, props.initialLocalDir, props.initialRemoteDir] as const,
  ([isOpen, local, remote]) => {
    if (isOpen) {
      window.addEventListener('keydown', handleWindowKeyDown, true)
      localDirInput.value = local || ''
      remoteDirInput.value = remote || ''
      errorMessage.value = null
      if (props.sessionId) {
        dirWatcherStore.loadPairings(props.sessionId)
      }
    } else {
      window.removeEventListener('keydown', handleWindowKeyDown, true)
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  window.removeEventListener('keydown', handleWindowKeyDown, true)
})

const activePairings = computed(() => {
  if (!props.sessionId) return dirWatcherStore.pairings
  return dirWatcherStore.pairings.filter((p) => p.session_id === props.sessionId)
})

const handleStartPairing = async () => {
  const local = localDirInput.value.trim()
  const remote = remoteDirInput.value.trim()

  if (!local) {
    errorMessage.value = 'Please specify a local folder path'
    return
  }
  if (!remote) {
    errorMessage.value = 'Please specify a remote folder path'
    return
  }
  if (!props.sessionId) {
    errorMessage.value = 'No active connection session'
    return
  }

  isStarting.value = true
  errorMessage.value = null

  try {
    const patterns = ignorePatternsInput.value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    await dirWatcherStore.startWatcher(props.sessionId, local, remote, patterns)
    emit('toast', `Directory auto-sync activated: ${local} ➔ ${remote}`)
    localDirInput.value = ''
    remoteDirInput.value = ''
  } catch (err: any) {
    console.error('Failed to start folder sync watcher:', err)
    errorMessage.value = err?.message || String(err)
  } finally {
    isStarting.value = false
  }
}

const handleToggle = async (pairing: DirWatcherPairing) => {
  await dirWatcherStore.toggleWatcher(pairing.id, !pairing.enabled)
}

const handleStop = async (pairing: DirWatcherPairing) => {
  await dirWatcherStore.stopWatcher(pairing.id)
  emit('toast', `Folder pairing detached: ${pairing.local_dir}`)
}
</script>

<template>
  <div
    v-if="show"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-150 select-none"
    @click.self="emit('close')"
  >
    <div
      class="w-full max-w-3xl flex flex-col rounded-2xl border shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 transition-colors"
      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
    >
      <!-- Header -->
      <div
        class="flex items-center justify-between px-6 py-4 border-b shrink-0 transition-colors"
        :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)' }"
      >
        <div class="flex items-center space-x-2.5">
          <div
            class="p-2 rounded-xl border transition-colors flex items-center justify-center shadow-sm"
            :style="{
              backgroundColor: 'var(--color-bg-pane)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-accent)'
            }"
          >
            <FolderSync class="w-5 h-5" />
          </div>
          <div>
            <h3 class="font-semibold text-sm" :style="{ color: 'var(--color-text-main)' }">
              Live Directory Watcher & Auto-Upload (Folder Pairing)
            </h3>
            <p class="text-[11px] mt-0.5" :style="{ color: 'var(--color-text-muted)' }">
              Pair a local project folder with a remote directory. Any saved edits locally will auto-upload in real-time.
            </p>
          </div>
        </div>

        <button
          @click="emit('close')"
          class="p-1.5 rounded-lg transition"
          :style="{ color: 'var(--color-text-muted)' }"
          title="Close"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <!-- Body -->
      <div class="p-6 overflow-y-auto space-y-6 text-xs max-h-[75vh]" :style="{ color: 'var(--color-text-main)' }">
        <!-- New Pairing Creation Form -->
        <div
          class="rounded-xl border p-4 space-y-3.5 transition-colors"
          :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
        >
          <div class="flex items-center justify-between font-semibold text-xs" :style="{ color: 'var(--color-accent)' }">
            <span class="flex items-center space-x-1.5">
              <Plus class="w-3.5 h-3.5" />
              <span>Create New Folder Pairing</span>
            </span>
            <span class="text-[10px] font-normal" :style="{ color: 'var(--color-text-muted)' }">Debounced 500ms auto-upload</span>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label class="block text-[11px] font-medium mb-1" :style="{ color: 'var(--color-text-main)' }">
                Local Folder Path:
              </label>
              <input
                v-model="localDirInput"
                type="text"
                placeholder="e.g. C:\projects\my-app"
                class="w-full px-3 py-2 rounded-lg border font-mono text-xs focus:outline-none input-theme"
                :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
              />
            </div>

            <div>
              <label class="block text-[11px] font-medium mb-1" :style="{ color: 'var(--color-text-main)' }">
                Remote Destination Folder:
              </label>
              <input
                v-model="remoteDirInput"
                type="text"
                placeholder="e.g. /var/www/my-app"
                class="w-full px-3 py-2 rounded-lg border font-mono text-xs focus:outline-none input-theme"
                :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
              />
            </div>
          </div>

          <div>
            <label class="block text-[11px] font-medium mb-1" :style="{ color: 'var(--color-text-main)' }">
              Ignore Patterns (comma-separated):
            </label>
            <input
              v-model="ignorePatternsInput"
              type="text"
              class="w-full px-3 py-2 rounded-lg border font-mono text-xs focus:outline-none input-theme"
              :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
            />
            <span class="text-[10px] mt-1 block" :style="{ color: 'var(--color-text-muted)' }">
              Files matching these patterns (or in these subdirectories) will not trigger uploads.
            </span>
          </div>

          <div v-if="errorMessage" class="p-2.5 rounded-lg bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs flex items-center space-x-2">
            <AlertTriangle class="w-4 h-4 shrink-0 text-rose-400" />
            <span>{{ errorMessage }}</span>
          </div>

          <div class="flex justify-end pt-1">
            <button
              @click="handleStartPairing"
              :disabled="isStarting || !localDirInput.trim() || !remoteDirInput.trim()"
              class="px-4 py-2 rounded-lg text-white font-semibold text-xs shadow-md transition btn-accent disabled:opacity-40 flex items-center space-x-1.5 cursor-pointer"
            >
              <RotateCw v-if="isStarting" class="w-3.5 h-3.5 animate-spin" />
              <FolderSync v-else class="w-3.5 h-3.5" />
              <span>{{ isStarting ? 'Starting Watcher...' : 'Start Live Auto-Sync' }}</span>
            </button>
          </div>
        </div>

        <!-- Active Pairings List -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <h4 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">
              Active Folder Pairings ({{ activePairings.length }})
            </h4>
          </div>

          <div v-if="activePairings.length === 0" class="text-center py-8 rounded-xl border border-dashed text-xs" :style="{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }">
            <FolderSync class="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p>No active directory pairings yet.</p>
            <p class="text-[11px] mt-1" :style="{ color: 'var(--color-text-muted)' }">Set up a pairing above to watch local changes and auto-upload files.</p>
          </div>

          <div v-else class="space-y-2.5">
            <div
              v-for="pairing in activePairings"
              :key="pairing.id"
              class="rounded-xl border p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition-colors"
              :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
            >
              <div class="space-y-1.5 min-w-0 flex-1">
                <div class="flex items-center space-x-2">
                  <span
                    class="px-1.5 py-0.2 rounded text-[10px] font-mono font-medium border"
                    :class="
                      pairing.status === 'watching'
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:bg-emerald-950/60 dark:border-emerald-500/40 dark:text-emerald-300'
                        : pairing.status === 'syncing'
                        ? 'bg-sky-500/15 border-sky-500/30 text-sky-700 dark:bg-sky-950/60 dark:border-sky-500/40 dark:text-sky-300'
                        : pairing.status === 'error'
                        ? 'bg-rose-500/15 border-rose-500/30 text-rose-700 dark:bg-rose-950/60 dark:border-rose-500/40 dark:text-rose-300'
                        : 'bg-zinc-500/10 border-zinc-500/20 text-zinc-500 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-400'
                    "
                  >
                    <span v-if="pairing.status === 'watching'" class="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse" />
                    <span v-else-if="pairing.status === 'syncing'" class="inline-block w-1.5 h-1.5 rounded-full bg-sky-500 mr-1" />
                    {{ pairing.status.toUpperCase() }}
                  </span>

                  <span class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">
                    {{ pairing.files_uploaded }} {{ pairing.files_uploaded === 1 ? 'file' : 'files' }} synced
                  </span>

                  <span v-if="pairing.last_synced_file" class="text-[10px] truncate max-w-xs font-mono" :style="{ color: 'var(--color-text-muted)' }">
                    Last: {{ pairing.last_synced_file }}
                  </span>
                </div>

                <div class="flex items-center space-x-2 font-mono text-[11px] truncate" :style="{ color: 'var(--color-text-main)' }">
                  <span class="text-amber-600 dark:text-amber-300 truncate max-w-[200px]" :title="pairing.local_dir">{{ pairing.local_dir }}</span>
                  <ArrowRight class="w-3 h-3 shrink-0" :style="{ color: 'var(--color-text-muted)' }" />
                  <span class="text-sky-600 dark:text-sky-300 truncate max-w-[200px]" :title="pairing.remote_dir">{{ pairing.remote_dir }}</span>
                </div>

                <div v-if="pairing.error" class="text-[10px] text-rose-400 font-mono">
                  Error: {{ pairing.error }}
                </div>
              </div>

              <!-- Controls -->
              <div class="flex items-center space-x-2 shrink-0">
                <button
                  @click="handleToggle(pairing)"
                  class="px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center space-x-1 transition cursor-pointer"
                  :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
                  :title="pairing.enabled ? 'Pause watcher' : 'Resume watcher'"
                >
                  <Pause v-if="pairing.enabled" class="w-3 h-3 text-amber-400" />
                  <Play v-else class="w-3 h-3 text-emerald-400" />
                  <span>{{ pairing.enabled ? 'Pause' : 'Resume' }}</span>
                </button>

                <button
                  @click="handleStop(pairing)"
                  class="p-1.5 rounded-lg border text-xs text-rose-400 hover:bg-rose-950/40 hover:border-rose-500/40 transition cursor-pointer"
                  :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
                  title="Remove this folder pairing"
                >
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div
        class="flex items-center justify-end px-6 py-3 border-t shrink-0 transition-colors"
        :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)' }"
      >
        <button
          @click="emit('close')"
          class="px-4 py-1.5 rounded-lg border text-xs transition btn-theme-card cursor-pointer"
          :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
        >
          Close
        </button>
      </div>
    </div>
  </div>
</template>
