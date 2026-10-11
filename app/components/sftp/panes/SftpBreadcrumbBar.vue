<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import {
  Copy,
  Check,
  Edit2,
  X,
  CornerDownLeft,
  GitBranch,
} from 'lucide-vue-next'
import CatppuccinIcon from '../../CatppuccinIcon.vue'
import { getWslDistroIcon } from '../../../utils/fileIcons'
import type { GitRepoStatus } from '../../../stores/sftp'

interface BreadcrumbItem {
  label: string
  path: string
  isLast: boolean
  icon?: string
}

const props = withDefaults(
  defineProps<{
    path: string
    pane: 'local' | 'remote'
    active?: boolean
    gitStatus?: GitRepoStatus | null
    placeholder?: string
  }>(),
  {
    active: false,
    gitStatus: null,
    placeholder: '',
  }
)

const emit = defineEmits<{
  (e: 'navigate-to', targetPath: string): void
  (e: 'copy-path', pathStr: string): void
}>()

const isEditing = ref(false)
const inputPath = ref(props.path)
const inputRef = ref<HTMLInputElement | null>(null)
const breadcrumbsScrollRef = ref<HTMLDivElement | null>(null)
const copied = ref(false)
let copyTimer: any = null

// Keep raw inputPath synced with incoming props.path when not actively typing
watch(
  () => props.path,
  (newPath) => {
    inputPath.value = newPath
    if (!isEditing.value) {
      scrollBreadcrumbsToEnd()
    }
  }
)

const scrollBreadcrumbsToEnd = () => {
  nextTick(() => {
    if (breadcrumbsScrollRef.value) {
      breadcrumbsScrollRef.value.scrollLeft = breadcrumbsScrollRef.value.scrollWidth
    }
  })
}

// Parse path into segmented interactive breadcrumb items
const breadcrumbs = computed<BreadcrumbItem[]>(() => {
  const raw = props.path || (props.pane === 'remote' ? '/' : 'C:/')
  let normalized = raw.replace(/\\/g, '/')

  // In remote Unix mode, collapse consecutive slashes (e.g. "//root" -> "/root")
  if (props.pane === 'remote') {
    normalized = normalized.replace(/\/+/g, '/')
  }

  // Preserve single '/' for filesystem root, trim trailing slashes otherwise
  if (normalized !== '/') {
    normalized = normalized.replace(/\/+$/, '')
  }

  // 1. WSL & Network UNC paths: //wsl.localhost/Distro/path... or //server/share/path...
  if (normalized.startsWith('//')) {
    const withoutPrefix = normalized.slice(2)
    const segments = withoutPrefix.split('/').filter(Boolean)
    if (segments.length >= 1) {
      const server = segments[0] // e.g. wsl.localhost, wsl$, or a server name
      const isWsl = server.toLowerCase().includes('wsl')

      if (isWsl && segments.length === 1) {
        return [
          {
            label: 'WSL',
            path: `//${server}`,
            isLast: true,
            icon: 'wsl',
          },
        ]
      }

      if (isWsl && segments.length >= 2) {
        const distro = segments[1] // e.g. Ubuntu-24.04
        const distroRoot = `//${server}/${distro}`
        const distroIcon = getWslDistroIcon(distro)
        const items: BreadcrumbItem[] = [
          {
            label: distro,
            path: distroRoot,
            isLast: segments.length === 2,
            icon: distroIcon,
          },
        ]

        let currentAcc = distroRoot
        for (let i = 2; i < segments.length; i++) {
          const seg = segments[i]
          currentAcc += `/${seg}`
          items.push({
            label: seg,
            path: currentAcc,
            isLast: i === segments.length - 1,
          })
        }
        return items
      }

      // Standard non-WSL UNC network share
      const shareRoot = `//${server}/${segments[1] || ''}`.replace(/\/$/, '')
      const items: BreadcrumbItem[] = [
        {
          label: shareRoot,
          path: shareRoot,
          isLast: segments.length <= 2,
          icon: 'server',
        },
      ]

      let currentAcc = shareRoot
      for (let i = 2; i < segments.length; i++) {
        const seg = segments[i]
        currentAcc += `/${seg}`
        items.push({
          label: seg,
          path: currentAcc,
          isLast: i === segments.length - 1,
        })
      }
      return items
    }
  }

  // 2. Windows Drive Root (e.g. C: or C:/)
  if (/^[a-zA-Z]:/.test(normalized)) {
    const drive = normalized.slice(0, 2).toUpperCase() // e.g. C:
    const rest = normalized.slice(2).replace(/^\/+/, '')
    const segments = rest.split('/').filter(Boolean)

    const items: BreadcrumbItem[] = [
      {
        label: segments.length === 0 ? `${drive}/` : drive,
        path: `${drive}/`,
        isLast: segments.length === 0,
      },
    ]

    let currentAcc = `${drive}/`
    segments.forEach((seg, idx) => {
      currentAcc = currentAcc.endsWith('/') ? `${currentAcc}${seg}` : `${currentAcc}/${seg}`
      items.push({
        label: seg,
        path: currentAcc,
        isLast: idx === segments.length - 1,
      })
    })
    return items
  }

  // 3. Unix / Linux / Remote Absolute paths (e.g. /var/www/html)
  if (normalized.startsWith('/')) {
    const segments = normalized.split('/').filter(Boolean)
    const items: BreadcrumbItem[] = [
      {
        label: '/',
        path: '/',
        isLast: segments.length === 0,
      },
    ]

    let currentAcc = ''
    segments.forEach((seg, idx) => {
      currentAcc += `/${seg}`
      items.push({
        label: seg,
        path: currentAcc,
        isLast: idx === segments.length - 1,
      })
    })
    return items
  }

  // 4. Relative paths (e.g. "." or "subfolder")
  const segments = normalized.split('/').filter(Boolean)
  const items: BreadcrumbItem[] = []
  let currentAcc = ''
  segments.forEach((seg, idx) => {
    currentAcc = currentAcc ? `${currentAcc}/${seg}` : seg
    items.push({
      label: seg,
      path: currentAcc,
      isLast: idx === segments.length - 1,
    })
  })

  return items.length > 0
    ? items
    : [{ label: normalized || '/', path: normalized || '/', isLast: true }]
})

// WSL Path resolution for local pane
const isWslPath = computed(() => {
  if (props.pane !== 'local' || !props.path) return false
  const normalized = props.path.replace(/\\/g, '/')
  return normalized.startsWith('//wsl') || normalized.startsWith('//wsl.localhost') || normalized.startsWith('//wsl$')
})

const wslDistroName = computed<string | null>(() => {
  if (!isWslPath.value) return null
  const normalized = props.path.replace(/\\/g, '/')
  const segments = normalized.replace(/^\/\//, '').split('/').filter(Boolean)
  return segments.length >= 2 ? segments[1] : null
})

const paneIcon = computed(() => {
  if (props.pane === 'remote') return 'server'
  if (isWslPath.value) {
    if (wslDistroName.value) {
      return getWslDistroIcon(wslDistroName.value)
    }
    return 'wsl'
  }
  return 'laptop'
})

const paneTitle = computed(() => {
  if (props.pane === 'remote') return 'Remote Server'
  if (isWslPath.value) {
    return wslDistroName.value ? `WSL: ${wslDistroName.value}` : 'Windows Subsystem for Linux'
  }
  return 'Local File System'
})

// Determine whether a path divider slash '/' should be rendered before crumb at idx
const shouldShowDivider = (idx: number) => {
  if (idx === 0) return false
  // For Unix / remote absolute paths, crumb 0 is already '/' so omit divider before the first subfolder
  if (idx === 1 && breadcrumbs.value[0]?.label === '/') return false
  return true
}

const startEditing = () => {
  isEditing.value = true
  inputPath.value = props.path
  nextTick(() => {
    inputRef.value?.focus()
    inputRef.value?.select()
  })
}

const submitEdit = () => {
  const target = inputPath.value.trim()
  isEditing.value = false
  if (target && target !== props.path) {
    emit('navigate-to', target)
  }
}

const cancelEdit = () => {
  isEditing.value = false
  inputPath.value = props.path
}

const handleCrumbClick = (crumb: BreadcrumbItem) => {
  if (crumb.path !== props.path) {
    emit('navigate-to', crumb.path)
  }
}

const handleCopyPath = () => {
  if (!props.path) return
  navigator.clipboard.writeText(props.path)
  copied.value = true
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    copied.value = false
  }, 2000)
  emit('copy-path', props.path)
}

const handleWheel = (e: WheelEvent) => {
  if (breadcrumbsScrollRef.value) {
    breadcrumbsScrollRef.value.scrollLeft += e.deltaY || e.deltaX
  }
}

defineExpose({
  startEditing,
  isEditing,
})
</script>

<template>
  <div
    class="h-8 px-2.5 flex items-center space-x-1.5 transition-colors duration-150 select-none shrink-0"
    :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
  >
    <!-- Left Icon (Pane identifier) -->
    <div
      class="p-1 rounded shrink-0 flex items-center justify-center opacity-85 transition-opacity hover:opacity-100"
      :title="paneTitle"
    >
      <CatppuccinIcon
        :name="paneIcon"
        :size="15"
      />
    </div>

    <!-- Middle: Breadcrumb Pills OR Editable Input -->
    <div
      class="h-[26px] flex-1 min-w-0 flex items-center rounded-lg border px-2 transition-colors duration-150 group overflow-hidden"
      :style="{
        backgroundColor: 'var(--color-bg-pane)',
        borderColor: isEditing
          ? (pane === 'local' ? 'var(--color-accent)' : 'var(--color-accent-secondary)')
          : 'var(--color-border)',
      }"
    >
      <!-- Direct Editable Input Mode -->
      <div v-if="isEditing" class="flex-1 flex items-center space-x-1.5 min-w-0 h-full">
        <input
          ref="inputRef"
          v-model="inputPath"
          @keydown.enter.prevent="submitEdit"
          @keydown.esc.prevent="cancelEdit"
          @blur="submitEdit"
          :placeholder="placeholder || (pane === 'local' ? 'C:/Users/...' : '/var/www/...')"
          class="flex-1 bg-transparent text-xs font-mono focus:outline-none truncate h-full leading-none py-0 border-0 outline-none"
          :style="{ color: 'var(--color-text-main)' }"
        />
        <button
          type="button"
          @mousedown.prevent="submitEdit"
          class="p-0.5 rounded text-[11px] font-semibold opacity-70 hover:opacity-100 transition shrink-0"
          :style="{ color: pane === 'local' ? 'var(--color-accent)' : 'var(--color-accent-secondary)' }"
          title="Navigate (Enter)"
        >
          <CornerDownLeft class="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          @mousedown.prevent="cancelEdit"
          class="p-0.5 rounded text-[11px] opacity-50 hover:opacity-100 transition hover:text-red-400 shrink-0"
          title="Cancel (Esc)"
        >
          <X class="w-3.5 h-3.5" />
        </button>
      </div>

      <!-- Segmented Interactive Breadcrumbs Mode -->
      <div
        v-else
        ref="breadcrumbsScrollRef"
        @wheel.passive="handleWheel"
        @dblclick="startEditing"
        class="flex-1 min-w-0 flex items-center overflow-x-auto no-scrollbar h-full space-x-0.5 cursor-pointer py-0"
        title="Double-click or click pencil to edit full path"
      >
        <template v-for="(crumb, idx) in breadcrumbs" :key="crumb.path + idx">
          <!-- Path Slash Divider -->
          <span
            v-if="shouldShowDivider(idx)"
            class="text-xs select-none shrink-0 px-0.5 opacity-40 font-mono leading-none"
            :style="{ color: 'var(--color-text-muted)' }"
          >
            /
          </span>

          <!-- Clickable Breadcrumb Button -->
          <button
            type="button"
            @click.stop="handleCrumbClick(crumb)"
            class="px-1.5 rounded text-xs font-mono shrink-0 transition-all duration-100 flex items-center space-x-1 leading-none h-[20px]"
            :class="[
              crumb.isLast
                ? 'font-semibold cursor-default'
                : 'opacity-80 hover:opacity-100 cursor-pointer hover:bg-black/10 dark:hover:bg-white/10'
            ]"
            :style="crumb.isLast
              ? { color: pane === 'local' ? 'var(--color-accent)' : 'var(--color-accent-secondary)' }
              : { color: 'var(--color-text-main)' }"
            :title="crumb.isLast ? `Current folder: ${crumb.path}` : `Jump to: ${crumb.path}`"
          >
            <CatppuccinIcon
              v-if="crumb.icon"
              :name="crumb.icon"
              :size="13"
              class="shrink-0"
            />
            <span class="truncate max-w-[140px]">{{ crumb.label }}</span>
          </button>
        </template>
      </div>
    </div>

    <!-- Right Controls: Git Branch, Edit Path, Copy Path -->
    <div class="flex items-center space-x-1 shrink-0">
      <!-- Git Branch Pill (if repo) -->
      <div
        v-if="gitStatus?.is_repo && gitStatus.branch"
        class="hidden sm:flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-mono border bg-amber-500/10 text-amber-700 border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/35 h-[22px]"
        :title="`Git Branch: ${gitStatus.branch}`"
      >
        <GitBranch class="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
        <span class="font-semibold max-w-[80px] truncate">{{ gitStatus.branch }}</span>
      </div>

      <!-- Quick Edit Toggle (maintains stable width during editing) -->
      <button
        type="button"
        @click="startEditing"
        class="w-6 h-6 flex items-center justify-center rounded text-xs transition hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
        :class="isEditing ? 'invisible pointer-events-none' : 'opacity-60 hover:opacity-100'"
        :style="{ color: 'var(--color-text-muted)' }"
        title="Edit path directly (Ctrl+L or double-click)"
      >
        <Edit2 class="w-3.5 h-3.5" />
      </button>

      <!-- Quick Copy Path to Clipboard -->
      <button
        type="button"
        @click="handleCopyPath"
        class="w-6 h-6 flex items-center justify-center rounded text-xs transition hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
        :class="copied ? 'text-emerald-400 opacity-100' : 'opacity-60 hover:opacity-100'"
        :style="{ color: copied ? '#34d399' : 'var(--color-text-muted)' }"
        :title="copied ? 'Path copied to clipboard!' : 'Copy full path'"
      >
        <Check v-if="copied" class="w-3.5 h-3.5 text-emerald-400" />
        <Copy v-else class="w-3.5 h-3.5" />
      </button>
    </div>
  </div>

</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
