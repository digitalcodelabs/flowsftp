<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import {
  Search,
  FileText,
  Folder,
  X,
  RotateCw,
  ExternalLink,
  ChevronRight,
  Filter,
  Check,
  Code2,
  CircleStop,
} from 'lucide-vue-next'
import { invoke } from '@tauri-apps/api/core'
import FileIcon from '../../FileIcon.vue'

export interface RemoteSearchResultItem {
  path: string
  filename: string
  line_number?: number | null
  line_content?: string | null
  is_dir: boolean
  size?: number | null
}

const props = defineProps<{
  show: boolean
  sessionId: string | null
  currentRemotePath: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'navigateTo', path: string): void
  (e: 'openEditor', filePath: string, fileName: string): void
  (e: 'quickLook', filePath: string, fileName: string): void
}>()

const searchInputRef = ref<HTMLInputElement | null>(null)
const query = ref('')
const searchType = ref<'filename' | 'content'>('filename')
const caseSensitive = ref(false)
const maxDepth = ref<number>(6)
const searchBasePath = ref('/')
const isSearching = ref(false)
const isStopping = ref(false)
const wasStopped = ref(false)
const currentSearchId = ref<string | null>(null)
const results = ref<RemoteSearchResultItem[]>([])
const searchError = ref<string | null>(null)
const searchDuration = ref<number | null>(null)

const handleStop = async () => {
  if (!isSearching.value) return
  isStopping.value = true
  wasStopped.value = true
  isSearching.value = false
  const sid = currentSearchId.value
  currentSearchId.value = null
  if (sid) {
    try {
      await invoke('sftp_cancel_search', { searchId: sid })
    } catch (err) {
      console.warn('Failed to cancel search:', err)
    }
  }
  isStopping.value = false
}

const handleClose = () => {
  if (isSearching.value) {
    handleStop()
  }
  emit('close')
}

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.stopPropagation()
    e.preventDefault()
    handleClose()
  }
}

const handleWindowKeydown = (e: KeyboardEvent) => {
  if (!props.show) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    handleClose()
  }
}

watch(
  () => props.show,
  (isOpen) => {
    if (isOpen) {
      window.addEventListener('keydown', handleWindowKeydown, true)
      searchBasePath.value = props.currentRemotePath || '/'
      results.value = []
      searchError.value = null
      searchDuration.value = null
      wasStopped.value = false
      nextTick(() => {
        searchInputRef.value?.focus()
        searchInputRef.value?.select()
      })
    } else {
      window.removeEventListener('keydown', handleWindowKeydown, true)
      if (isSearching.value) {
        handleStop()
      }
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  window.removeEventListener('keydown', handleWindowKeydown, true)
  if (isSearching.value && currentSearchId.value) {
    invoke('sftp_cancel_search', { searchId: currentSearchId.value }).catch(() => {})
  }
})

const handleSearch = async () => {
  const q = query.value.trim()
  if (!q || !props.sessionId || isSearching.value) return

  const searchId = 'srch-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7)
  currentSearchId.value = searchId
  isSearching.value = true
  isStopping.value = false
  wasStopped.value = false
  searchError.value = null
  results.value = []
  const startTime = performance.now()

  try {
    const res = await invoke<RemoteSearchResultItem[]>('sftp_search_remote', {
      query: {
        search_id: searchId,
        session_id: props.sessionId,
        base_path: searchBasePath.value,
        query: q,
        search_type: searchType.value,
        case_sensitive: caseSensitive.value,
        max_depth: maxDepth.value,
        max_results: 200,
      },
    })
    results.value = res
    searchDuration.value = Math.round(performance.now() - startTime)
  } catch (err: any) {
    if (!wasStopped.value) {
      console.error('Remote search error:', err)
      searchError.value = err?.message || String(err)
    }
  } finally {
    isSearching.value = false
    isStopping.value = false
    currentSearchId.value = null
  }
}

const handleResultClick = (item: RemoteSearchResultItem) => {
  if (item.is_dir) {
    emit('navigateTo', item.path)
    emit('close')
  } else {
    emit('openEditor', item.path, item.filename)
  }
}

const handleJumpToFolder = (item: RemoteSearchResultItem) => {
  const parent = item.path.substring(0, item.path.lastIndexOf('/')) || '/'
  emit('navigateTo', parent)
  emit('close')
}

const highlightSnippet = (content: string, term: string) => {
  if (!term || !content) return content
  const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, caseSensitive.value ? 'g' : 'gi')
  return content.replace(regex, '<mark class="bg-amber-500/25 text-amber-800 dark:text-amber-200 px-0.5 rounded font-bold border border-amber-500/35">$1</mark>')
}
</script>

<template>
  <div
    v-if="show"
    tabindex="-1"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-150 select-none outline-none"
    @click.self="handleClose"
    @keydown="handleKeydown"
  >
    <div
      class="w-full max-w-4xl h-[80vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 transition-colors"
      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
    >
      <!-- Header -->
      <div
        class="flex items-center justify-between px-6 py-3.5 border-b shrink-0 transition-colors"
        :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)' }"
      >
        <div class="flex items-center space-x-2.5">
          <div
            class="p-1.5 rounded-lg border transition-colors flex items-center justify-center shadow-sm"
            :style="{
              backgroundColor: 'var(--color-bg-pane)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-accent)'
            }"
          >
            <Search class="w-4 h-4" />
          </div>
          <div>
            <h3 class="font-semibold text-xs" :style="{ color: 'var(--color-text-main)' }">
              Remote Search & SSH Grep
            </h3>
            <span class="text-[10px]" :style="{ color: 'var(--color-text-muted)' }">
              Search by filename pattern or search text inside files with remote Linux grep
            </span>
          </div>
        </div>

        <button
          @click="handleClose"
          class="p-1.5 rounded-lg transition"
          :style="{ color: 'var(--color-text-muted)' }"
          title="Close (Esc)"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <!-- Controls & Search Bar -->
      <div
        class="p-4 border-b space-y-3 shrink-0"
        :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)' }"
      >
        <!-- Search Input Row -->
        <div class="flex items-center space-x-2">
          <div class="relative flex-1">
            <input
              ref="searchInputRef"
              v-model="query"
              type="text"
              :placeholder="searchType === 'content' ? 'Search text content inside files (grep)...' : 'Search filenames (e.g. *.vue, config.json)...'"
              class="w-full pl-9 pr-4 py-2 rounded-xl border text-xs font-mono focus:outline-none input-theme"
              :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
              @keydown.enter="handleSearch"
              @keydown.esc.prevent.stop="handleKeydown"
            />
            <Search class="w-4 h-4 absolute left-3 top-2.5 pointer-events-none transition-colors" :style="{ color: 'var(--color-text-muted)' }" />
          </div>

          <!-- Search / Stop Button -->
          <button
            v-if="!isSearching"
            @click="handleSearch"
            :disabled="!query.trim()"
            class="px-5 py-2 rounded-xl text-white font-semibold text-xs shadow-md transition btn-accent disabled:opacity-40 flex items-center space-x-1.5 cursor-pointer shrink-0"
          >
            <Search class="w-3.5 h-3.5" />
            <span>Search</span>
          </button>

          <button
            v-else
            @click="handleStop"
            :disabled="isStopping"
            class="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-semibold text-xs shadow-md shadow-rose-900/30 transition flex items-center space-x-1.5 cursor-pointer shrink-0 animate-pulse disabled:opacity-50"
            title="Stop search in progress (Esc)"
          >
            <RotateCw v-if="isStopping" class="w-3.5 h-3.5 animate-spin" />
            <CircleStop v-else class="w-3.5 h-3.5" />
            <span>{{ isStopping ? 'Stopping...' : 'Stop' }}</span>
          </button>
        </div>

        <!-- Filter Options Strip -->
        <div class="flex flex-wrap items-center justify-between gap-3 text-xs" :style="{ color: 'var(--color-text-muted)' }">
          <!-- Search Type Toggle -->
          <div
            class="flex items-center space-x-1 p-0.5 rounded-lg border transition-colors"
            :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
          >
            <button
              @click="searchType = 'filename'"
              class="px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer flex items-center space-x-1 border"
              :style="searchType === 'filename'
                ? {
                    backgroundColor: 'var(--color-bg-hover)',
                    color: 'var(--color-accent)',
                    borderColor: 'var(--color-border)',
                    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.08)'
                  }
                : {
                    color: 'var(--color-text-muted)',
                    borderColor: 'transparent'
                  }"
              :class="searchType === 'filename' ? 'font-semibold' : 'hover:text-[var(--color-text-main)] hover:bg-black/5 dark:hover:bg-white/5'"
            >
              <Folder class="w-3 h-3" />
              <span>Filename Find</span>
            </button>
            <button
              @click="searchType = 'content'"
              class="px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer flex items-center space-x-1 border"
              :style="searchType === 'content'
                ? {
                    backgroundColor: 'var(--color-bg-hover)',
                    color: 'var(--color-accent)',
                    borderColor: 'var(--color-border)',
                    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.08)'
                  }
                : {
                    color: 'var(--color-text-muted)',
                    borderColor: 'transparent'
                  }"
              :class="searchType === 'content' ? 'font-semibold' : 'hover:text-[var(--color-text-main)] hover:bg-black/5 dark:hover:bg-white/5'"
            >
              <FileText class="w-3 h-3" />
              <span>File Content (Grep)</span>
            </button>
          </div>

          <!-- Base Path -->
          <div class="flex items-center space-x-1.5">
            <span class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">In:</span>
            <input
              v-model="searchBasePath"
              type="text"
              class="px-2 py-0.5 rounded border text-[11px] font-mono focus:outline-none w-48 input-theme"
              :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
            />
          </div>

          <!-- Options -->
          <div class="flex items-center space-x-3 text-[11px]" :style="{ color: 'var(--color-text-main)' }">
            <label class="flex items-center space-x-1.5 cursor-pointer">
              <input v-model="caseSensitive" type="checkbox" class="rounded border-zinc-700 text-sky-500 focus:ring-0 cursor-pointer" />
              <span>Match case</span>
            </label>

            <div class="flex items-center space-x-1">
              <span :style="{ color: 'var(--color-text-muted)' }">Max depth:</span>
              <select
                v-model="maxDepth"
                class="px-1.5 py-0.5 rounded border text-[11px] focus:outline-none cursor-pointer"
                :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
              >
                <option :value="3" :style="{ backgroundColor: 'var(--color-bg-card)', color: 'var(--color-text-main)' }">3 levels</option>
                <option :value="6" :style="{ backgroundColor: 'var(--color-bg-card)', color: 'var(--color-text-main)' }">6 levels</option>
                <option :value="10" :style="{ backgroundColor: 'var(--color-bg-card)', color: 'var(--color-text-main)' }">10 levels</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <!-- Results View -->
      <div class="flex-1 overflow-y-auto p-4 space-y-1 text-xs" :style="{ color: 'var(--color-text-main)' }">
        <!-- Error banner -->
        <div v-if="searchError" class="p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs mb-3">
          Search Error: {{ searchError }}
        </div>

        <!-- Stopped banner -->
        <div v-if="wasStopped" class="p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs mb-3 flex items-center justify-between">
          <div class="flex items-center space-x-2">
            <CircleStop class="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              Search stopped.
              <span v-if="results.length > 0"> Showing {{ results.length }} match{{ results.length === 1 ? '' : 'es' }} found before stopping.</span>
              <span v-else> No matches were found before stopping.</span>
            </span>
          </div>
          <button
            @click="wasStopped = false"
            class="text-amber-400/70 hover:text-amber-200 p-0.5 rounded transition cursor-pointer"
            title="Dismiss"
          >
            <X class="w-3.5 h-3.5" />
          </button>
        </div>

        <!-- Summary header if results exist -->
        <div v-if="results.length > 0" class="flex items-center justify-between px-2 py-1 text-[11px] mb-1 border-b" :style="{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }">
          <div class="flex items-center space-x-2">
            <span>Found {{ results.length }} match{{ results.length === 1 ? '' : 'es' }}</span>
            <span v-if="wasStopped" class="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
              Stopped
            </span>
          </div>
          <span v-if="searchDuration !== null" class="font-mono" :style="{ color: 'var(--color-text-muted)' }">{{ searchDuration }}ms</span>
        </div>

        <!-- Empty state -->
        <div v-if="!isSearching && results.length === 0 && !searchError && !wasStopped" class="text-center py-16" :style="{ color: 'var(--color-text-muted)' }">
          <Search class="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p class="font-medium text-xs" :style="{ color: 'var(--color-text-main)' }">No search results</p>
          <p class="text-[11px] mt-0.5" :style="{ color: 'var(--color-text-muted)' }">Enter a search term and press Search</p>
        </div>

        <!-- Loading state -->
        <div v-if="isSearching" class="text-center py-16 space-y-3" :style="{ color: 'var(--color-text-muted)' }">
          <RotateCw class="w-8 h-8 mx-auto animate-spin" :style="{ color: 'var(--color-accent)' }" />
          <p class="text-xs" :style="{ color: 'var(--color-text-main)' }">Searching remote server...</p>
          <button
            @click="handleStop"
            :disabled="isStopping"
            class="px-4 py-1.5 rounded-xl bg-rose-600/80 hover:bg-rose-600 text-white font-medium text-xs shadow-md transition inline-flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
            title="Stop search in progress (Esc)"
          >
            <RotateCw v-if="isStopping" class="w-3 h-3 animate-spin" />
            <CircleStop v-else class="w-3 h-3" />
            <span>{{ isStopping ? 'Stopping search...' : 'Stop Search (Esc)' }}</span>
          </button>
        </div>

        <!-- Result rows -->
        <div
          v-for="(item, idx) in results"
          :key="idx"
          class="group p-2.5 rounded-xl border transition-all flex items-center justify-between gap-3 cursor-pointer"
          :style="{
            backgroundColor: 'var(--color-bg-card)',
            borderColor: 'var(--color-border)'
          }"
          :class="'hover:border-[var(--color-border-active)] hover:bg-[var(--color-bg-hover)]'"
          @click="handleResultClick(item)"
        >
          <div class="flex items-start space-x-2.5 min-w-0 flex-1">
            <FileIcon :name="item.filename" :size="16" class="mt-0.5 shrink-0" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center space-x-2">
                <span class="font-semibold text-xs truncate" :style="{ color: 'var(--color-text-main)' }">
                  {{ item.filename }}
                </span>
                <span
                  v-if="item.line_number"
                  class="px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold bg-sky-500/15 border border-sky-500/30 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300"
                >
                  Line {{ item.line_number }}
                </span>
              </div>

              <!-- Grep match snippet -->
              <div
                v-if="item.line_content"
                class="mt-1 p-1.5 rounded-lg font-mono text-[11px] overflow-x-auto border transition-colors"
                :style="{
                  backgroundColor: 'var(--color-bg-pane)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text-main)'
                }"
                v-html="highlightSnippet(item.line_content, query)"
              />

              <!-- Full file path -->
              <div class="text-[10px] font-mono truncate mt-0.5" :style="{ color: 'var(--color-text-muted)' }">
                {{ item.path }}
              </div>
            </div>
          </div>

          <!-- Actions on hover -->
          <div class="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition shrink-0">
            <button
              @click.stop="handleJumpToFolder(item)"
              class="px-2 py-1 rounded text-[11px] font-medium border transition cursor-pointer"
              :style="{
                backgroundColor: 'var(--color-bg-pane)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text-muted)'
              }"
              :class="'hover:text-[var(--color-text-main)] hover:border-[var(--color-accent)]'"
              title="Navigate remote browser to containing folder"
            >
              Go to folder
            </button>
            <button
              @click.stop="handleResultClick(item)"
              class="px-2 py-1 rounded text-[11px] font-medium transition cursor-pointer btn-accent"
            >
              Open
            </button>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div
        class="flex items-center justify-between px-6 py-2.5 border-t shrink-0 text-[11px]"
        :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
      >
        <span>
          Tip: Press
          <kbd
            class="px-1.5 py-0.5 rounded border font-mono text-[10px]"
            :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
          >Enter</kbd>
          to search,
          <kbd
            class="px-1.5 py-0.5 rounded border font-mono text-[10px]"
            :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
          >Esc</kbd>
          to stop / close
        </span>
        <button
          @click="handleClose"
          class="px-3.5 py-1 rounded-lg border text-xs transition btn-theme-card cursor-pointer"
        >
          Close
        </button>
      </div>
    </div>
  </div>
</template>
