<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import {
  X,
  FileCode,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Copy,
  Check,
  Music,
  Video,
  FileText,
  Eye,
  Code,
  Download,
  AlertCircle,
  Loader2,
} from 'lucide-vue-next'
import type { LocalFileEntry, SftpFileEntry } from '../stores/sftp'

const props = defineProps<{
  show: boolean
  file: LocalFileEntry | SftpFileEntry | null
  target: 'local' | 'remote'
  sessionId?: string | null
  currentIndex?: number
  totalCount?: number
}>()

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'open-editor', target: 'local' | 'remote', file: LocalFileEntry | SftpFileEntry): void
  (e: 'prev'): void
  (e: 'next'): void
}>()

// State
const isLoading = ref(false)
const error = ref<string | null>(null)
const textContent = ref('')
const blobUrl = ref<string | null>(null)
const imageDimensions = ref<{ width: number; height: number } | null>(null)
const zoomLevel = ref(1)
const showRawMarkdown = ref(false)
const copied = ref(false)

// Cleanup blob URL
const cleanupBlob = () => {
  if (blobUrl.value) {
    URL.revokeObjectURL(blobUrl.value)
    blobUrl.value = null
  }
}

// File extension & category
const fileExtension = computed(() => {
  if (!props.file?.name) return ''
  const parts = props.file.name.split('.')
  return parts.length > 1 ? parts.pop()!.toLowerCase() : ''
})

type PreviewType = 'image' | 'svg' | 'markdown' | 'json' | 'code' | 'text' | 'audio' | 'video' | 'pdf' | 'binary'

const previewType = computed<PreviewType>(() => {
  const ext = fileExtension.value
  const name = props.file?.name.toLowerCase() || ''

  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif'].includes(ext)) {
    return 'image'
  }
  if (ext === 'svg') {
    return 'svg'
  }
  if (['md', 'markdown', 'mdown', 'mkd'].includes(ext)) {
    return 'markdown'
  }
  if (['json', 'geojson', 'jsonld', 'map'].includes(ext)) {
    return 'json'
  }
  if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma'].includes(ext)) {
    return 'audio'
  }
  if (['mp4', 'webm', 'mov', 'mkv', 'ogv'].includes(ext)) {
    return 'video'
  }
  if (ext === 'pdf') {
    return 'pdf'
  }
  if (
    [
      'ts', 'js', 'jsx', 'tsx', 'vue', 'rs', 'py', 'go', 'html', 'htm',
      'css', 'scss', 'sass', 'less', 'yaml', 'yml', 'toml', 'xml',
      'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'sql', 'c', 'cpp', 'cc',
      'h', 'hpp', 'java', 'kt', 'php', 'rb', 'lua', 'swift', 'dart',
      'env', 'gitignore', 'dockerfile', 'makefile', 'lock', 'log',
      'txt', 'csv', 'tsv', 'conf', 'ini', 'diff', 'patch',
    ].includes(ext) ||
    name.startsWith('.') ||
    name === 'dockerfile' ||
    name === 'makefile' ||
    name === 'license'
  ) {
    return 'code'
  }
  return 'binary'
})

const typeBadgeText = computed(() => {
  const ext = fileExtension.value.toUpperCase()
  switch (previewType.value) {
    case 'image':
      return `${ext} Image`
    case 'svg':
      return 'SVG Vector'
    case 'markdown':
      return 'Markdown'
    case 'json':
      return 'JSON Data'
    case 'audio':
      return `${ext} Audio`
    case 'video':
      return `${ext} Video`
    case 'pdf':
      return 'PDF Document'
    case 'code':
      return `${ext || 'Source'} File`
    default:
      return 'Binary File'
  }
})

// Format byte sizes
const formatBytes = (bytes?: number): string => {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

// Markdown parser
const renderedMarkdown = computed(() => {
  if (!textContent.value) return ''
  return parseSimpleMarkdown(textContent.value)
})

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function parseSimpleMarkdown(md: string): string {
  const lines = md.split('\n')
  let inCodeBlock = false
  let codeBuffer = ''
  let html = ''

  for (let line of lines) {
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        html += `<pre class="p-3 my-2 rounded-lg bg-black/40 font-mono text-xs overflow-x-auto border border-zinc-800"><code>${escapeHtml(codeBuffer.trimEnd())}</code></pre>`
        codeBuffer = ''
        inCodeBlock = false
      } else {
        inCodeBlock = true
        codeBuffer = ''
      }
      continue
    }

    if (inCodeBlock) {
      codeBuffer += line + '\n'
      continue
    }

    // Headings
    if (line.startsWith('# ')) {
      html += `<h1 class="text-xl font-bold mt-4 mb-2 pb-1 border-b border-zinc-700/60 text-zinc-100">${escapeHtml(line.slice(2))}</h1>`
      continue
    }
    if (line.startsWith('## ')) {
      html += `<h2 class="text-lg font-semibold mt-3 mb-1.5 pb-1 border-b border-zinc-800 text-zinc-200">${escapeHtml(line.slice(3))}</h2>`
      continue
    }
    if (line.startsWith('### ')) {
      html += `<h3 class="text-base font-semibold mt-2.5 mb-1 text-zinc-200">${escapeHtml(line.slice(4))}</h3>`
      continue
    }

    // Blockquote
    if (line.startsWith('> ')) {
      html += `<blockquote class="border-l-4 border-amber-500/70 pl-3 py-1 my-1.5 text-zinc-300 italic bg-amber-500/5 rounded-r">${escapeHtml(line.slice(2))}</blockquote>`
      continue
    }

    // Lists
    if (line.startsWith('- [ ] ') || line.startsWith('* [ ] ')) {
      html += `<div class="flex items-center space-x-2 my-0.5"><input type="checkbox" disabled class="rounded" /> <span class="text-zinc-300 text-xs">${escapeHtml(line.slice(6))}</span></div>`
      continue
    }
    if (line.startsWith('- [x] ') || line.startsWith('* [x] ')) {
      html += `<div class="flex items-center space-x-2 my-0.5"><input type="checkbox" checked disabled class="rounded" /> <span class="line-through text-zinc-500 text-xs">${escapeHtml(line.slice(6))}</span></div>`
      continue
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      html += `<li class="ml-4 list-disc text-xs text-zinc-300 my-0.5">${escapeHtml(line.slice(2))}</li>`
      continue
    }

    // Horizontal Rule
    if (line.trim() === '---' || line.trim() === '***') {
      html += `<hr class="my-3 border-zinc-800" />`
      continue
    }

    if (!line.trim()) {
      html += '<div class="h-2"></div>'
      continue
    }

    // Bold, inline code, and text
    let inline = escapeHtml(line)
    inline = inline.replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-black/40 text-amber-300 font-mono text-[11px] border border-zinc-800">$1</code>')
    inline = inline.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-bold text-zinc-100">$1</strong>')
    inline = inline.replace(/\*([^*]+)\*/g, '<em class="italic text-zinc-300">$1</em>')

    html += `<p class="text-xs text-zinc-300 leading-relaxed my-1">${inline}</p>`
  }

  if (inCodeBlock) {
    html += `<pre class="p-3 my-2 rounded-lg bg-black/40 font-mono text-xs overflow-x-auto border border-zinc-800"><code>${escapeHtml(codeBuffer.trimEnd())}</code></pre>`
  }

  return html
}

// Syntax-highlighted JSON
const formattedJsonHtml = computed(() => {
  if (!textContent.value) return ''
  try {
    const obj = JSON.parse(textContent.value)
    const formatted = JSON.stringify(obj, null, 2)
    return highlightJson(formatted)
  } catch {
    return escapeHtml(textContent.value)
  }
})

function highlightJson(json: string): string {
  const escaped = escapeHtml(json)
  return escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = 'text-amber-400' // number
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = 'text-cyan-400 font-semibold' // key
        } else {
          cls = 'text-emerald-400' // string
        }
      } else if (/true|false/.test(match)) {
        cls = 'text-purple-400' // boolean
      } else if (/null/.test(match)) {
        cls = 'text-rose-400' // null
      }
      return `<span class="${cls}">${match}</span>`
    }
  )
}

// Code line numbers
const codeLines = computed(() => {
  if (!textContent.value) return []
  return textContent.value.split('\n')
})

// Load file content
const loadContent = async () => {
  if (!props.show || !props.file) return
  cleanupBlob()
  isLoading.value = true
  error.value = null
  textContent.value = ''
  imageDimensions.value = null
  zoomLevel.value = 1
  copied.value = false

  const path = props.file.path
  const type = previewType.value

  try {
    if (type === 'image' || type === 'audio' || type === 'video' || type === 'pdf') {
      let bytes: number[] = []
      if (props.target === 'local') {
        bytes = await invoke<number[]>('sftp_read_local_file_binary', { path })
      } else {
        if (!props.sessionId) throw new Error('No active SFTP session')
        bytes = await invoke<number[]>('sftp_read_file_binary', { sessionId: props.sessionId, path })
      }

      const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        bmp: 'image/bmp',
        ico: 'image/x-icon',
        svg: 'image/svg+xml',
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        ogg: 'audio/ogg',
        flac: 'audio/flac',
        aac: 'audio/aac',
        m4a: 'audio/mp4',
        mp4: 'video/mp4',
        webm: 'video/webm',
        pdf: 'application/pdf',
      }
      const mime = mimeMap[fileExtension.value] || 'application/octet-stream'
      const blob = new Blob([new Uint8Array(bytes)], { type: mime })
      blobUrl.value = URL.createObjectURL(blob)
    } else {
      // Text, Markdown, JSON, Code, SVG
      let content = ''
      if (props.target === 'local') {
        content = await invoke<string>('sftp_read_local_file_text', { path })
      } else {
        if (!props.sessionId) throw new Error('No active SFTP session')
        content = await invoke<string>('sftp_read_file_text', { sessionId: props.sessionId, path })
      }
      textContent.value = content

      // If SVG, also create Blob for visual rendering
      if (type === 'svg') {
        const blob = new Blob([content], { type: 'image/svg+xml' })
        blobUrl.value = URL.createObjectURL(blob)
      }
    }
  } catch (err: any) {
    console.error('Quick Look load error:', err)
    error.value = typeof err === 'string' ? err : err?.message || 'Failed to preview file'
  } finally {
    isLoading.value = false
  }
}

// Watch file changes
watch(
  () => [props.show, props.file?.path],
  ([show, path]) => {
    if (show && path) {
      loadContent()
    } else if (!show) {
      cleanupBlob()
    }
  },
  { immediate: true }
)

const handleImageLoaded = (e: Event) => {
  const img = e.target as HTMLImageElement
  if (img) {
    imageDimensions.value = {
      width: img.naturalWidth,
      height: img.naturalHeight,
    }
  }
}

const copyToClipboard = async () => {
  if (!textContent.value) return
  try {
    await navigator.clipboard.writeText(textContent.value)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch (err) {
    console.error('Failed to copy to clipboard:', err)
  }
}

const openInSystem = async () => {
  if (props.target === 'local' && props.file?.path) {
    try {
      await invoke('sftp_open_in_default_app', { path: props.file.path })
    } catch (err) {
      console.error('Failed to open file in system app:', err)
    }
  }
}

const close = () => {
  emit('update:show', false)
}

// Global keyboard navigation while modal is open
const handleKeyDown = (e: KeyboardEvent) => {
  if (!props.show) return

  if (e.key === 'Escape' || e.code === 'Space') {
    e.preventDefault()
    e.stopPropagation()
    close()
    return
  }

  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
    e.preventDefault()
    e.stopPropagation()
    emit('prev')
    return
  }

  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
    e.preventDefault()
    e.stopPropagation()
    emit('next')
    return
  }

  if (e.key === 'Enter') {
    e.preventDefault()
    e.stopPropagation()
    if (props.file) {
      emit('open-editor', props.target, props.file)
      close()
    }
    return
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown, true)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown, true)
  cleanupBlob()
})
</script>

<template>
  <div
    v-if="show && file"
    class="fixed top-10 inset-x-0 bottom-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md select-none animate-in fade-in duration-100"
    @click.self="close"
  >
    <div
      class="relative w-full max-w-4xl max-h-[85vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden transition-all duration-150"
      :style="{
        backgroundColor: 'var(--color-bg-card)',
        borderColor: 'var(--color-border)',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)'
      }"
      @click.stop
    >
      <!-- Quick Look Header -->
      <div
        class="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
        :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)' }"
      >
        <!-- File Info -->
        <div class="flex items-center space-x-3 min-w-0 flex-1 mr-4">
          <div
            class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            :style="{ backgroundColor: 'var(--color-bg-hover)' }"
          >
            <span class="text-base font-bold" :style="{ color: 'var(--color-accent)' }">
              {{ previewType === 'image' || previewType === 'svg' ? '🖼️' : previewType === 'markdown' ? '📝' : previewType === 'json' ? '{ }' : previewType === 'audio' ? '🎵' : previewType === 'video' ? '🎬' : '📄' }}
            </span>
          </div>

          <div class="min-w-0 flex-1">
            <div class="flex items-center space-x-2">
              <h2
                class="font-mono font-semibold text-sm truncate"
                :style="{ color: 'var(--color-text-main)' }"
                :title="file.name"
              >
                {{ file.name }}
              </h2>
              <span
                class="px-2 py-0.5 rounded-full text-[10px] font-mono border flex-shrink-0"
                :style="{
                  backgroundColor: 'var(--color-bg-hover)',
                  color: 'var(--color-accent)',
                  borderColor: 'var(--color-border)'
                }"
              >
                {{ typeBadgeText }}
              </span>
            </div>
            <div class="flex items-center space-x-2 text-[11px] font-mono mt-0.5" :style="{ color: 'var(--color-text-muted)' }">
              <span>{{ formatBytes(file.size) }}</span>
              <span v-if="imageDimensions">· {{ imageDimensions.width }} × {{ imageDimensions.height }} px</span>
              <span v-if="codeLines.length > 0">· {{ codeLines.length }} lines</span>
              <span>· {{ target === 'local' ? 'Local' : 'Remote SFTP' }}</span>
            </div>
          </div>
        </div>

        <!-- Header Actions -->
        <div class="flex items-center space-x-2 flex-shrink-0">
          <!-- Copy Button (Text / Code / JSON) -->
          <button
            v-if="textContent"
            @click="copyToClipboard"
            class="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition cursor-pointer"
            :style="{
              backgroundColor: 'var(--color-bg-card)',
              borderColor: 'var(--color-border)',
              color: copied ? '#10b981' : 'var(--color-text-main)'
            }"
            title="Copy content to clipboard"
          >
            <Check v-if="copied" class="w-3.5 h-3.5 text-emerald-400" />
            <Copy v-else class="w-3.5 h-3.5" />
            <span>{{ copied ? 'Copied!' : 'Copy' }}</span>
          </button>

          <!-- Toggle Markdown Raw/Rendered -->
          <button
            v-if="previewType === 'markdown'"
            @click="showRawMarkdown = !showRawMarkdown"
            class="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition cursor-pointer"
            :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
            title="Toggle between rendered preview and source text"
          >
            <Code v-if="!showRawMarkdown" class="w-3.5 h-3.5" />
            <Eye v-else class="w-3.5 h-3.5" />
            <span>{{ showRawMarkdown ? 'Preview' : 'Raw' }}</span>
          </button>

          <!-- Open in System (Local) -->
          <button
            v-if="target === 'local'"
            @click="openInSystem"
            class="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition cursor-pointer hover:opacity-90"
            :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
            title="Open in system default application"
          >
            <ExternalLink class="w-3.5 h-3.5" />
            <span class="hidden sm:inline">System App</span>
          </button>

          <!-- Open in Full Editor -->
          <button
            @click="emit('open-editor', target, file); close()"
            class="flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-semibold shadow-sm transition cursor-pointer hover:opacity-95"
            :style="{ backgroundColor: 'var(--color-accent)', color: '#ffffff' }"
            title="Open file in full code editor (Enter)"
          >
            <FileCode class="w-3.5 h-3.5" />
            <span>Open in Editor</span>
          </button>

          <!-- Close (Esc / Space) -->
          <button
            @click="close"
            class="p-1.5 rounded-lg transition hover:bg-black/20 text-zinc-400 hover:text-zinc-200 cursor-pointer ml-1"
            title="Close Quick Look (Space or Esc)"
          >
            <X class="w-4 h-4" />
          </button>
        </div>
      </div>

      <!-- Quick Look Body -->
      <div
        class="flex-1 relative overflow-hidden flex flex-col min-h-[300px] max-h-[68vh] min-h-0 select-text"
        :style="{ backgroundColor: 'var(--color-bg-card)' }"
      >
        <!-- Loading State -->
        <div v-if="isLoading" class="flex-1 w-full flex flex-col items-center justify-center py-12 space-y-3">
          <Loader2 class="w-8 h-8 animate-spin" :style="{ color: 'var(--color-accent)' }" />
          <p class="text-xs font-mono" :style="{ color: 'var(--color-text-muted)' }">Loading preview...</p>
        </div>

        <!-- Error State -->
        <div v-else-if="error" class="flex-1 w-full flex flex-col items-center justify-center py-12 px-4 space-y-3 text-center max-w-md mx-auto">
          <AlertCircle class="w-10 h-10 text-red-400" />
          <p class="text-sm font-semibold text-red-400">Failed to load preview</p>
          <p class="text-xs font-mono text-zinc-400">{{ error }}</p>
        </div>

        <!-- 1. IMAGE & SVG PREVIEW -->
        <div
          v-else-if="(previewType === 'image' || previewType === 'svg') && blobUrl"
          class="flex-1 w-full flex flex-col items-center justify-center relative overflow-hidden p-4"
        >
          <!-- Checkerboard container for transparency support -->
          <div
            class="relative max-w-full max-h-full flex items-center justify-center rounded-xl overflow-hidden p-2"
            style="background-image: linear-gradient(45deg, rgba(255,255,255,0.04) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,0.04) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.04) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.04) 75%); background-size: 16px 16px; background-position: 0 0, 0 8px, 8px -8px, -8px 0px;"
          >
            <img
              :src="blobUrl"
              :alt="file.name"
              @load="handleImageLoaded"
              class="max-w-full max-h-[60vh] object-contain rounded-lg shadow-lg transition-transform duration-150"
              :style="{ transform: `scale(${zoomLevel})` }"
            />
          </div>

          <!-- Image Zoom Controls -->
          <div class="absolute bottom-2 flex items-center space-x-1.5 px-3 py-1 rounded-full bg-black/70 backdrop-blur-md border border-zinc-700/60 shadow-lg text-xs font-mono">
            <button
              @click="zoomLevel = Math.max(0.25, zoomLevel - 0.25)"
              class="p-1 text-zinc-400 hover:text-zinc-100 transition cursor-pointer"
              title="Zoom out"
            >
              <ZoomOut class="w-3.5 h-3.5" />
            </button>
            <span class="text-[11px] text-zinc-300 w-12 text-center">{{ Math.round(zoomLevel * 100) }}%</span>
            <button
              @click="zoomLevel = Math.min(4, zoomLevel + 0.25)"
              class="p-1 text-zinc-400 hover:text-zinc-100 transition cursor-pointer"
              title="Zoom in"
            >
              <ZoomIn class="w-3.5 h-3.5" />
            </button>
            <div class="h-3 w-px bg-zinc-700 mx-1" />
            <button
              @click="zoomLevel = 1"
              class="px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-100 transition cursor-pointer"
              title="Reset Zoom"
            >
              100%
            </button>
          </div>
        </div>

        <!-- 2. MARKDOWN PREVIEW -->
        <div v-else-if="previewType === 'markdown'" class="flex-1 w-full flex flex-col min-h-0 overflow-hidden">
          <div
            v-if="!showRawMarkdown"
            class="flex-1 w-full overflow-y-auto px-6 py-4 max-w-3xl mx-auto"
            v-html="renderedMarkdown"
          />
          <pre
            v-else
            class="flex-1 w-full p-4 font-mono text-xs overflow-auto text-zinc-200"
          ><code>{{ textContent }}</code></pre>
        </div>

        <!-- 3. JSON PREVIEW -->
        <div v-else-if="previewType === 'json'" class="flex-1 w-full overflow-auto p-4 select-text min-h-0">
          <pre
            class="font-mono text-xs leading-relaxed text-zinc-200"
            v-html="formattedJsonHtml"
          />
        </div>

        <!-- 4. CODE & TEXT PREVIEW -->
        <div
          v-else-if="previewType === 'code' || previewType === 'text'"
          class="flex-1 w-full overflow-auto select-text min-h-0"
        >
          <div class="inline-flex min-w-full font-mono text-xs leading-5 py-3">
            <!-- Line Numbers (sticky to left on horizontal scroll) -->
            <div
              class="sticky left-0 select-none pl-4 pr-3 text-right text-zinc-500 border-r border-zinc-800/80 mr-3 flex flex-col font-mono text-xs leading-5 shrink-0 z-10"
              :style="{ minWidth: '48px', backgroundColor: 'var(--color-bg-card)' }"
            >
              <span v-for="n in codeLines.length" :key="n" class="h-5 leading-5 block">{{ n }}</span>
            </div>
            <!-- Code Lines -->
            <div class="flex-1 pr-4 text-zinc-200 leading-5">
              <div v-for="(line, idx) in codeLines" :key="idx" class="h-5 leading-5 whitespace-pre hover:bg-white/5 px-1 rounded">
                {{ line || ' ' }}
              </div>
            </div>
          </div>
        </div>

        <!-- 5. AUDIO PREVIEW -->
        <div v-else-if="previewType === 'audio' && blobUrl" class="flex-1 w-full flex flex-col items-center justify-center py-10 px-4 space-y-6 max-w-md mx-auto">
          <div class="w-24 h-24 rounded-2xl flex items-center justify-center shadow-2xl border" :style="{ backgroundColor: 'var(--color-bg-hover)', borderColor: 'var(--color-border)' }">
            <Music class="w-12 h-12" :style="{ color: 'var(--color-accent)' }" />
          </div>
          <div class="text-center">
            <h3 class="font-mono font-medium text-sm text-zinc-100">{{ file.name }}</h3>
            <p class="text-xs font-mono text-zinc-400 mt-1">{{ formatBytes(file.size) }}</p>
          </div>
          <audio controls autoplay :src="blobUrl" class="w-full rounded-xl shadow-lg" />
        </div>

        <!-- 6. VIDEO PREVIEW -->
        <div v-else-if="previewType === 'video' && blobUrl" class="flex-1 w-full flex items-center justify-center p-4">
          <video controls autoplay :src="blobUrl" class="max-w-full max-h-[60vh] rounded-xl shadow-2xl" />
        </div>

        <!-- 7. BINARY / OTHER PREVIEW -->
        <div v-else class="flex-1 w-full flex flex-col items-center justify-center py-12 px-4 space-y-4 text-center max-w-sm mx-auto">
          <div class="w-20 h-20 rounded-2xl flex items-center justify-center border shadow-xl" :style="{ backgroundColor: 'var(--color-bg-hover)', borderColor: 'var(--color-border)' }">
            <FileText class="w-10 h-10" :style="{ color: 'var(--color-accent)' }" />
          </div>
          <div>
            <h3 class="font-mono font-semibold text-sm text-zinc-200">{{ file.name }}</h3>
            <p class="text-xs font-mono text-zinc-400 mt-1">{{ formatBytes(file.size) }} · Binary File</p>
          </div>
          <p class="text-xs text-zinc-400 leading-relaxed">
            This file type cannot be previewed directly in Quick Look. You can open it in an external application or code editor.
          </p>
          <div class="flex items-center space-x-2 pt-2">
            <button
              v-if="target === 'local'"
              @click="openInSystem"
              class="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border text-zinc-200 border-zinc-700 hover:bg-zinc-800 transition cursor-pointer"
            >
              <ExternalLink class="w-3.5 h-3.5" />
              <span>Open with System</span>
            </button>
            <button
              @click="emit('open-editor', target, file); close()"
              class="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border text-zinc-200 border-zinc-700 hover:bg-zinc-800 transition cursor-pointer"
            >
              <FileCode class="w-3.5 h-3.5" />
              <span>Try in Editor</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Quick Look Footer Navigation & Hints -->
      <div
        class="flex items-center justify-between px-4 py-2 border-t text-xs select-none flex-shrink-0"
        :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
      >
        <!-- Left: Navigation Arrows -->
        <div class="flex items-center space-x-1">
          <button
            @click="emit('prev')"
            class="p-1 rounded hover:bg-black/20 text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
            title="Previous file (ArrowUp / ArrowLeft)"
          >
            <ChevronLeft class="w-4 h-4" />
          </button>
          <button
            @click="emit('next')"
            class="p-1 rounded hover:bg-black/20 text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
            title="Next file (ArrowDown / ArrowRight)"
          >
            <ChevronRight class="w-4 h-4" />
          </button>
          <span v-if="currentIndex !== undefined && totalCount" class="font-mono text-[11px] ml-2 text-zinc-400">
            {{ currentIndex + 1 }} of {{ totalCount }}
          </span>
        </div>

        <!-- Right: Keyboard Shortcuts -->
        <div class="hidden sm:flex items-center space-x-3 text-[11px] font-mono text-zinc-400">
          <span><kbd class="px-1 py-0.5 rounded bg-black/40 border border-zinc-700 text-zinc-300">↑</kbd> <kbd class="px-1 py-0.5 rounded bg-black/40 border border-zinc-700 text-zinc-300">↓</kbd> Navigate</span>
          <span><kbd class="px-1 py-0.5 rounded bg-black/40 border border-zinc-700 text-zinc-300">Space</kbd> / <kbd class="px-1 py-0.5 rounded bg-black/40 border border-zinc-700 text-zinc-300">Esc</kbd> Close</span>
          <span><kbd class="px-1 py-0.5 rounded bg-black/40 border border-zinc-700 text-zinc-300">↵</kbd> Edit</span>
        </div>
      </div>
    </div>
  </div>
</template>
