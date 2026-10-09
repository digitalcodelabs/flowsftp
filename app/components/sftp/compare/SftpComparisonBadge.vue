<script setup lang="ts">
import { formatBytes } from '../../../utils/formatters'
import type { ComparisonItemInfo } from './types'

defineProps<{
  info?: ComparisonItemInfo
  fileSize: number
  pane: 'local' | 'remote'
}>()
</script>

<template>
  <template v-if="info">
    <!-- Local Only -->
    <span
      v-if="info.status === 'local_only' && pane === 'local'"
      class="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex-shrink-0"
      title="Only exists on local"
    >
      + Local Only
    </span>

    <!-- Remote Only -->
    <span
      v-else-if="info.status === 'remote_only' && pane === 'remote'"
      class="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/40 flex-shrink-0"
      title="Only exists on remote"
    >
      + Remote Only
    </span>

    <!-- Local Newer -->
    <span
      v-else-if="info.status === 'local_newer' && pane === 'local'"
      class="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex-shrink-0"
      title="Local file is newer than remote"
    >
      ▲ Newer
    </span>
    <span
      v-else-if="info.status === 'local_newer' && pane === 'remote'"
      class="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-zinc-600/30 text-zinc-400 border border-zinc-600/40 flex-shrink-0"
      title="Local file is newer than remote"
    >
      ▼ Older
    </span>

    <!-- Remote Newer -->
    <span
      v-else-if="info.status === 'remote_newer' && pane === 'local'"
      class="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-zinc-600/30 text-zinc-400 border border-zinc-600/40 flex-shrink-0"
      title="Remote file is newer than local"
    >
      ▼ Older
    </span>
    <span
      v-else-if="info.status === 'remote_newer' && pane === 'remote'"
      class="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex-shrink-0"
      title="Remote file is newer than local"
    >
      ▲ Newer
    </span>

    <!-- Size Different -->
    <span
      v-else-if="info.status === 'size_different'"
      class="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/40 flex-shrink-0"
      :title="pane === 'local'
        ? `File size differs: Local is ${formatBytes(fileSize)}, Remote is ${formatBytes(info.counterpartSize || 0)}`
        : `File size differs: Remote is ${formatBytes(fileSize)}, Local is ${formatBytes(info.counterpartSize || 0)}`"
    >
      ≠ Size Diff
    </span>
  </template>
</template>
