<script setup lang="ts">
import { computed } from 'vue'
import { GitCompare, X } from 'lucide-vue-next'
import type { ComparisonResult, CompareCriteria } from './types'

const props = withDefaults(
  defineProps<{
    criteria?: CompareCriteria
    hideIdentical?: boolean
    comparisonResult: ComparisonResult | null
  }>(),
  {
    criteria: 'size_and_time',
    hideIdentical: false,
  }
)

const emit = defineEmits<{
  (e: 'update:criteria', val: CompareCriteria): void
  (e: 'update:hideIdentical', val: boolean): void
  (e: 'syncLocalToRemote'): void
  (e: 'syncRemoteToLocal'): void
  (e: 'close'): void
}>()

const localCriteria = computed({
  get: () => props.criteria,
  set: (val: CompareCriteria) => emit('update:criteria', val),
})

const localHideIdentical = computed({
  get: () => props.hideIdentical,
  set: (val: boolean) => emit('update:hideIdentical', val),
})
</script>

<template>
  <div
    class="border-b px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs shadow-md z-20 transition-all duration-150 animate-in slide-in-from-top-2"
    :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
  >
    <!-- Left: Title & Controls -->
    <div class="flex items-center space-x-3">
      <div class="flex items-center space-x-1.5 font-semibold" :style="{ color: 'var(--color-accent)' }">
        <GitCompare class="w-4 h-4" />
        <span>Directory Comparison</span>
      </div>

      <div class="h-4 w-px" :style="{ backgroundColor: 'var(--color-border)' }" />

      <!-- Criteria Selector -->
      <div class="flex items-center space-x-1">
        <span class="text-[11px]" :style="{ color: 'var(--color-text-muted)' }">Compare by:</span>
        <select
          v-model="localCriteria"
          class="px-2 py-0.5 rounded border text-[11px] font-medium bg-transparent focus:outline-none cursor-pointer"
          :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
        >
          <option value="size_and_time" class="bg-slate-900 text-slate-200">Size &amp; Modification Time</option>
          <option value="size_only" class="bg-slate-900 text-slate-200">File Size Only</option>
        </select>
      </div>

      <!-- Hide Identical Files Checkbox -->
      <label class="flex items-center space-x-1.5 cursor-pointer text-[11px] select-none text-slate-300 hover:text-white transition">
        <input
          type="checkbox"
          v-model="localHideIdentical"
          class="rounded border-slate-700 bg-slate-800 text-indigo-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
        />
        <span>Hide identical files</span>
        <span v-if="comparisonResult?.stats.identical" class="text-[10px] text-zinc-500 font-mono">
          ({{ comparisonResult.stats.identical }} hidden)
        </span>
      </label>
    </div>

    <!-- Center: Stats / Diffs Pill Counters -->
    <div v-if="comparisonResult" class="flex items-center space-x-1.5 flex-wrap">
      <template v-if="comparisonResult.stats.totalDiffs === 0">
        <span class="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center space-x-1">
          <span>✓ Both directories are in sync</span>
        </span>
      </template>
      <template v-else>
        <span
          v-if="comparisonResult.stats.localOnly > 0"
          class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
        >
          +{{ comparisonResult.stats.localOnly }} Local only
        </span>
        <span
          v-if="comparisonResult.stats.remoteOnly > 0"
          class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/15 text-blue-300 border border-blue-500/30"
        >
          +{{ comparisonResult.stats.remoteOnly }} Remote only
        </span>
        <span
          v-if="comparisonResult.stats.localNewer > 0"
          class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30"
        >
          ▲ {{ comparisonResult.stats.localNewer }} Local newer
        </span>
        <span
          v-if="comparisonResult.stats.remoteNewer > 0"
          class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/15 text-purple-300 border border-purple-500/30"
        >
          ▲ {{ comparisonResult.stats.remoteNewer }} Remote newer
        </span>
        <span
          v-if="comparisonResult.stats.sizeDifferent > 0"
          class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-500/15 text-rose-300 border border-rose-500/30"
        >
          ≠ {{ comparisonResult.stats.sizeDifferent }} Size diff
        </span>
      </template>
    </div>

    <!-- Right: Sync Buttons & Exit -->
    <div class="flex items-center space-x-2">
      <template v-if="comparisonResult && comparisonResult.stats.totalDiffs > 0">
        <button
          v-if="comparisonResult.stats.localOnly > 0 || comparisonResult.stats.localNewer > 0 || comparisonResult.stats.sizeDifferent > 0"
          @click="emit('syncLocalToRemote')"
          class="px-2.5 py-1 rounded text-xs font-semibold flex items-center space-x-1.5 transition shadow-sm btn-accent cursor-pointer"
          title="Upload all local-only, newer, and size-differing files to remote"
        >
          <span>↑ Sync to Remote</span>
        </button>
        <button
          v-if="comparisonResult.stats.remoteOnly > 0 || comparisonResult.stats.remoteNewer > 0 || comparisonResult.stats.sizeDifferent > 0"
          @click="emit('syncRemoteToLocal')"
          class="px-2.5 py-1 rounded text-xs font-semibold flex items-center space-x-1.5 transition shadow-sm btn-accent-secondary cursor-pointer"
          title="Download all remote-only, newer, and size-differing files to local"
        >
          <span>↓ Sync to Local</span>
        </button>
      </template>

      <button
        @click="emit('close')"
        class="p-1 rounded text-xs opacity-70 hover:opacity-100 transition hover:bg-white/10 cursor-pointer"
        :style="{ color: 'var(--color-text-muted)' }"
        title="Exit Directory Comparison (Esc)"
      >
        <X class="w-4 h-4" />
      </button>
    </div>
  </div>
</template>
