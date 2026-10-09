<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import {
  X,
  Save,
  ExternalLink,
  RotateCcw,
  Check,
  AlertCircle,
  FileCode,
  Terminal,
} from 'lucide-vue-next'
import { useSettingsStore } from '../stores/settings'
import { useThemeStore, isLightTheme } from '../stores/theme'
import FileIcon from './FileIcon.vue'

// CodeMirror 6 and Extensions
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Compartment, type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { languages } from '@codemirror/language-data'
import { LanguageDescription, HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { vim, Vim, getCM, CodeMirror } from '@replit/codemirror-vim'

const props = defineProps<{
  show: boolean
  sessionId: string | null
  target: 'local' | 'remote'
  filePath: string
  fileName: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved'): void
}>()

const settingsStore = useSettingsStore()
const themeStore = useThemeStore()

const editorContainerRef = ref<HTMLDivElement | null>(null)
let editorView: EditorView | null = null

// Editor state
const initialContent = ref('')
const isLoading = ref(true)
const isSaving = ref(false)
const isDirty = ref(false)
const errorMessage = ref<string | null>(null)
const successMessage = ref<string | null>(null)

// Stats
const cursorLine = ref(1)
const cursorCol = ref(1)
const lineCount = ref(1)
const docChars = ref(0)
const detectedLanguageName = ref('Plain Text')

// Vim Mode state & preference (synced with settings store)
const isVimMode = computed(() => settingsStore.editorVimMode)
const currentVimMode = ref('NORMAL')

// Compartments for dynamic reconfiguration
const vimCompartment = new Compartment()
const languageCompartment = new Compartment()
const themeCompartment = new Compartment()

// Toggle Vim mode
const toggleVimMode = () => {
  settingsStore.editorVimMode = !settingsStore.editorVimMode
  if (editorView) {
    editorView.dispatch({
      effects: vimCompartment.reconfigure(settingsStore.editorVimMode ? vim({ status: true }) : []),
    })
    hookVimModeListener()
    currentVimMode.value = settingsStore.editorVimMode ? 'NORMAL' : 'OFF'
  }
}

// Watch settingsStore.editorVimMode for changes
watch(
  () => settingsStore.editorVimMode,
  (active) => {
    if (editorView) {
      editorView.dispatch({
        effects: vimCompartment.reconfigure(active ? vim({ status: true }) : []),
      })
      hookVimModeListener()
      currentVimMode.value = active ? 'NORMAL' : 'OFF'
    }
  }
)

// Dynamic CodeMirror theme & syntax highlighting matching active App Theme
const buildThemeExtensions = (): Extension[] => {
  const theme = themeStore.currentTheme
  const ui = theme.ui
  const term = theme.terminal
  const fontSize = settingsStore.editorFontSize || 13
  const fontFamily = settingsStore.terminalFontFamily || '"JetBrains Mono", ui-monospace, monospace'

  const editorTheme = EditorView.theme(
    {
      '&': {
        height: '100%',
        fontSize: `${fontSize}px`,
        fontFamily: fontFamily,
        backgroundColor: ui.bgPane,
        color: term.foreground || ui.textMain,
      },
      '.cm-scroller': {
        overflow: 'auto',
        fontFamily: fontFamily,
        lineHeight: '1.55',
      },
      '.cm-content': {
        padding: '10px 0',
        caretColor: term.cursor || ui.accent,
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: term.cursor || ui.accent,
        borderLeftWidth: '2px',
      },
      '&.cm-focused .cm-cursor': {
        borderLeftColor: term.cursor || ui.accent,
      },
      '.cm-gutters': {
        backgroundColor: ui.bgPane,
        color: ui.textMuted,
        borderRight: `1px solid ${ui.border}`,
        paddingRight: '8px',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'transparent',
        color: ui.accent,
        fontWeight: 'bold',
      },
      '.cm-activeLine': {
        backgroundColor: ui.bgHover || (isLightTheme(theme) ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.04)'),
      },
      '.cm-selectionBackground, ::selection': {
        backgroundColor: `${term.selectionBackground || (isLightTheme(theme) ? 'rgba(99, 102, 241, 0.2)' : 'rgba(99, 102, 241, 0.3)')} !important`,
      },
      '&.cm-focused .cm-selectionBackground': {
        backgroundColor: `${term.selectionBackground || (isLightTheme(theme) ? 'rgba(99, 102, 241, 0.28)' : 'rgba(99, 102, 241, 0.38)')} !important`,
      },
      '.cm-searchMatch': {
        backgroundColor: 'rgba(234, 179, 8, 0.3)',
        outline: '1px solid rgba(234, 179, 8, 0.5)',
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: 'rgba(234, 179, 8, 0.5)',
      },
      '.cm-foldGutter': {
        paddingLeft: '4px',
        color: ui.textMuted,
      },
      '.cm-vim-panel': {
        padding: '4px 12px',
        fontFamily: fontFamily,
        fontSize: '12px',
        backgroundColor: ui.bgHeader,
        borderTop: `1px solid ${ui.border}`,
        color: ui.textMain,
        minHeight: '28px',
        display: 'flex',
        alignItems: 'center',
      },
      '.cm-vim-panel input': {
        border: 'none',
        outline: 'none',
        backgroundColor: 'transparent',
        color: ui.accent,
        fontFamily: fontFamily,
        fontSize: '12px',
        width: '100%',
      },
    },
    { dark: !isLightTheme(theme) }
  )

  const highlightStyle = HighlightStyle.define([
    { tag: [t.keyword, t.modifier], color: term.magenta || ui.accent, fontWeight: '600' },
    { tag: [t.name, t.deleted, t.character, t.macroName], color: term.foreground || ui.textMain },
    { tag: [t.propertyName], color: term.cyan || term.brightCyan || ui.accentSecondary },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: term.blue || term.brightBlue || ui.accentSecondary },
    { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: term.yellow || term.brightYellow },
    { tag: [t.definition(t.name), t.separator], color: term.cyan || ui.accent },
    { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.self, t.namespace], color: term.yellow || term.brightYellow },
    { tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)], color: term.cyan || ui.accentSecondary },
    { tag: [t.meta, t.comment, t.lineComment, t.blockComment, t.docComment], color: term.brightBlack || ui.textMuted, fontStyle: 'italic' },
    { tag: t.strong, fontWeight: 'bold' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: t.link, color: ui.accent, textDecoration: 'underline' },
    { tag: t.heading, fontWeight: 'bold', color: term.red || ui.accent },
    { tag: [t.atom, t.bool, t.special(t.variableName)], color: term.brightMagenta || term.magenta },
    { tag: [t.processingInstruction, t.string, t.inserted, t.special(t.string)], color: term.green || term.brightGreen },
    { tag: t.invalid, color: term.red || '#ff5555' },
  ])

  return [editorTheme, syntaxHighlighting(highlightStyle)]
}

// Watch theme & font changes to update CodeMirror theme on the fly
watch(
  [() => themeStore.currentTheme, () => settingsStore.editorFontSize, () => settingsStore.terminalFontFamily],
  () => {
    if (editorView) {
      editorView.dispatch({
        effects: themeCompartment.reconfigure(buildThemeExtensions()),
      })
    }
  },
  { deep: true }
)

// Language detection
const detectAndLoadLanguage = async () => {
  if (!props.fileName) return
  const desc = LanguageDescription.matchFilename(languages, props.fileName)
  if (desc) {
    detectedLanguageName.value = desc.name
    try {
      const support = await desc.load()
      if (editorView && support) {
        editorView.dispatch({
          effects: languageCompartment.reconfigure(support),
        })
      }
    } catch (err) {
      console.warn('Failed to load language grammar:', err)
    }
  } else {
    detectedLanguageName.value = 'Plain Text'
    if (editorView) {
      editorView.dispatch({
        effects: languageCompartment.reconfigure([]),
      })
    }
  }
}

// Hook Vim mode change events
const hookVimModeListener = () => {
  if (!editorView || !isVimMode.value) return
  const cm = getCM(editorView)
  if (cm) {
    CodeMirror.on(cm, 'vim-mode-change', (data: { mode: string; subMode?: string }) => {
      if (data && data.mode) {
        currentVimMode.value = data.mode.toUpperCase()
      }
    })
  }
}

// Register Vim Ex commands (:w, :wq, :x, :q, :q!)
const setupVimExCommands = () => {
  try {
    Vim.defineEx('w', 'w', () => {
      handleSave()
    })
    Vim.defineEx('write', 'write', () => {
      handleSave()
    })
    Vim.defineEx('wq', 'wq', async () => {
      await handleSave()
      emit('close')
    })
    Vim.defineEx('x', 'x', async () => {
      await handleSave()
      emit('close')
    })
    Vim.defineEx('q', 'q', () => {
      handleClose()
    })
    Vim.defineEx('quit', 'quit', () => {
      handleClose()
    })
    Vim.defineEx('q!', 'q!', () => {
      emit('close')
    })
  } catch (err) {
    console.warn('Failed to register Vim Ex commands:', err)
  }
}

// Create CodeMirror Editor
const initEditor = (docContent: string) => {
  if (!editorContainerRef.value) return

  if (editorView) {
    editorView.destroy()
    editorView = null
  }

  const extensions: Extension[] = [
    basicSetup,
    themeCompartment.of(buildThemeExtensions()),
    languageCompartment.of([]),
    vimCompartment.of(isVimMode.value ? vim({ status: true }) : []),
    keymap.of([
      {
        key: 'Mod-s',
        run: () => {
          handleSave()
          return true
        },
      },
      {
        key: 'Mod-w',
        run: () => {
          handleClose()
          return true
        },
      },
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const text = update.state.doc.toString()
        isDirty.value = text !== initialContent.value
        docChars.value = update.state.doc.length
        lineCount.value = update.state.doc.lines
      }
      if (update.selectionSet || update.docChanged) {
        const pos = update.state.selection.main.head
        const line = update.state.doc.lineAt(pos)
        cursorLine.value = line.number
        cursorCol.value = pos - line.from + 1
      }
    }),
  ]

  const state = EditorState.create({
    doc: docContent,
    extensions,
  })

  editorView = new EditorView({
    state,
    parent: editorContainerRef.value,
  })

  docChars.value = state.doc.length
  lineCount.value = state.doc.lines
  cursorLine.value = 1
  cursorCol.value = 1

  hookVimModeListener()
  detectAndLoadLanguage()

  editorView.focus()
}

// Fetch file content
const loadContent = async () => {
  if (!props.filePath) return
  isLoading.value = true
  errorMessage.value = null
  successMessage.value = null

  try {
    let text = ''
    if (props.target === 'remote') {
      if (!props.sessionId) {
        throw new Error('No active SSH session')
      }
      text = await invoke<string>('sftp_read_file_text', {
        sessionId: props.sessionId,
        path: props.filePath,
      })
    } else {
      text = await invoke<string>('sftp_read_local_file_text', {
        path: props.filePath,
      })
    }

    initialContent.value = text
    isDirty.value = false

    if (editorView) {
      editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: text },
      })
      detectAndLoadLanguage()
      editorView.focus()
    } else {
      await nextTick()
      initEditor(text)
    }
  } catch (err: any) {
    console.error('Failed to load file content:', err)
    errorMessage.value = err?.message || String(err)
  } finally {
    isLoading.value = false
  }
}

// Save file content
const handleSave = async () => {
  if (isSaving.value || !editorView) return
  isSaving.value = true
  errorMessage.value = null
  successMessage.value = null

  const currentText = editorView.state.doc.toString()

  try {
    if (props.target === 'remote') {
      if (!props.sessionId) {
        throw new Error('No active SSH session')
      }
      await invoke('sftp_write_file_text', {
        sessionId: props.sessionId,
        path: props.filePath,
        content: currentText,
      })
    } else {
      await invoke('sftp_write_local_file_text', {
        path: props.filePath,
        content: currentText,
      })
    }

    initialContent.value = currentText
    isDirty.value = false
    successMessage.value = 'Saved successfully'
    emit('saved')

    setTimeout(() => {
      if (successMessage.value === 'Saved successfully') {
        successMessage.value = null
      }
    }, 2500)
  } catch (err: any) {
    console.error('Failed to save file content:', err)
    errorMessage.value = `Save failed: ${err?.message || String(err)}`
  } finally {
    isSaving.value = false
  }
}

const handleOpenInDefaultApp = async () => {
  try {
    if (props.target === 'local') {
      await invoke('sftp_open_in_default_app', { path: props.filePath })
    } else {
      successMessage.value = 'Opening in external editor is supported for local files'
      setTimeout(() => {
        if (successMessage.value) successMessage.value = null
      }, 3000)
    }
  } catch (err: any) {
    errorMessage.value = `Failed to open file: ${err?.message || err}`
  }
}

const handleClose = () => {
  if (isDirty.value) {
    const confirmClose = window.confirm(
      'You have unsaved changes in this file. Are you sure you want to close without saving?'
    )
    if (!confirmClose) return
  }
  emit('close')
}

// Global modal keydown: intercept Ctrl+W to close editor modal
const handleModalKeyDown = (e: KeyboardEvent) => {
  if (!props.show) return

  // Ctrl+W or Cmd+W to close editor modal
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
    e.preventDefault()
    e.stopPropagation()
    handleClose()
    return
  }
}

watch(
  () => [props.show, props.filePath],
  ([show]) => {
    if (show) {
      setupVimExCommands()
      nextTick(() => {
        loadContent()
      })
    } else {
      if (editorView) {
        editorView.destroy()
        editorView = null
      }
    }
  },
  { immediate: true }
)

onMounted(() => {
  setupVimExCommands()
  window.addEventListener('keydown', handleModalKeyDown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleModalKeyDown, true)
  if (editorView) {
    editorView.destroy()
    editorView = null
  }
})
</script>

<template>
  <div
    v-if="show"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-150 select-none"
    @click.self="handleClose"
  >
    <div
      class="w-full max-w-5xl h-[85vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 transition-colors"
      :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)' }"
    >
      <!-- Header -->
      <div
        class="flex items-center justify-between px-4 py-2.5 border-b shrink-0 transition-colors"
        :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)' }"
      >
        <div class="flex items-center space-x-3 min-w-0">
          <FileIcon :name="fileName" :size="18" />
          <div class="min-w-0">
            <div class="flex items-center space-x-2">
              <span class="text-xs font-semibold truncate" :style="{ color: 'var(--color-text-main)' }">
                {{ fileName }}
              </span>
              <span
                class="px-1.5 py-0.2 rounded text-[10px] uppercase font-mono font-medium border"
                :class="
                  target === 'remote'
                    ? 'bg-sky-950/60 border-sky-500/40 text-sky-300'
                    : 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                "
              >
                {{ target }}
              </span>

              <!-- Dirty / Unsaved Indicator -->
              <span
                v-if="isDirty"
                class="flex items-center space-x-1 text-[11px] font-medium text-amber-400 animate-pulse"
                title="Unsaved changes (Ctrl+S or :w to save)"
              >
                <span>●</span>
                <span>Unsaved</span>
              </span>
              <span
                v-else-if="successMessage"
                class="flex items-center space-x-1 text-[11px] font-medium text-emerald-400"
              >
                <Check class="w-3.5 h-3.5" />
                <span>{{ successMessage }}</span>
              </span>
            </div>
            <div class="text-[10px] font-mono truncate max-w-xl mt-0.5" :style="{ color: 'var(--color-text-muted)' }">
              {{ filePath }}
            </div>
          </div>
        </div>

        <div class="flex items-center space-x-2 shrink-0">
          <!-- Vim Mode Toggle Button -->
          <button
            @click="toggleVimMode"
            :title="isVimMode ? 'Vim Keybindings Active (Click to switch to Standard Mode)' : 'Standard Keybindings Active (Click to switch to Vim Mode)'"
            class="px-2.5 py-1.5 rounded-lg border text-xs font-mono font-semibold flex items-center space-x-1.5 transition"
            :class="
              isVimMode
                ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300 shadow-sm'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            "
            :style="{ borderColor: isVimMode ? undefined : 'var(--color-border)' }"
          >
            <span class="text-[10px] font-bold">VIM</span>
            <span
              class="w-2 h-2 rounded-full"
              :class="isVimMode ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50 animate-pulse' : 'bg-slate-600'"
            />
          </button>

          <button
            v-if="target === 'local'"
            @click="handleOpenInDefaultApp"
            title="Open in system default text editor"
            class="px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center space-x-1.5 transition btn-theme-card"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
          >
            <ExternalLink class="w-3.5 h-3.5" />
            <span>Default App</span>
          </button>

          <button
            @click="loadContent"
            :disabled="isLoading || isSaving"
            title="Reload content from server"
            class="p-1.5 rounded-lg border text-xs transition btn-theme-card disabled:opacity-50"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
          >
            <RotateCcw class="w-3.5 h-3.5" :class="{ 'animate-spin': isLoading }" />
          </button>

          <button
            @click="handleSave"
            :disabled="isSaving || isLoading || !isDirty"
            title="Save file (Ctrl+S or :w)"
            class="px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow-sm transition btn-accent disabled:opacity-40"
          >
            <Save class="w-3.5 h-3.5" :class="{ 'animate-pulse': isSaving }" />
            <span>{{ isSaving ? 'Saving...' : 'Save' }}</span>
          </button>

          <div class="h-4 w-px mx-0.5" :style="{ backgroundColor: 'var(--color-border)' }" />

          <button
            @click="handleClose"
            title="Close editor (Ctrl+W or :q)"
            class="p-1.5 rounded-lg text-xs transition hover:bg-red-500/20 text-slate-400 hover:text-red-300"
          >
            <X class="w-4 h-4" />
          </button>
        </div>
      </div>

      <!-- Error notification -->
      <div
        v-if="errorMessage"
        class="px-4 py-2 bg-red-950/80 border-b border-red-700/80 text-red-200 text-xs flex items-center space-x-2 shrink-0 animate-in fade-in"
      >
        <AlertCircle class="w-4 h-4 shrink-0 text-red-400" />
        <span class="truncate">{{ errorMessage }}</span>
      </div>

      <!-- Main Editor Body -->
      <div class="flex-1 relative flex overflow-hidden min-h-0 select-text">
        <!-- Loading Spinner -->
        <div
          v-if="isLoading"
          class="absolute inset-0 z-20 flex flex-col items-center justify-center backdrop-blur-xs"
          :style="{ backgroundColor: 'rgba(0,0,0,0.5)' }"
        >
          <div class="w-7 h-7 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mb-2" />
          <span class="text-xs font-mono text-slate-300">Loading file content...</span>
        </div>

        <!-- CodeMirror 6 Container -->
        <div
          ref="editorContainerRef"
          class="w-full h-full overflow-hidden"
          :style="{ backgroundColor: 'var(--color-bg-pane)' }"
        />
      </div>

      <!-- Status Footer Bar -->
      <div
        class="flex items-center justify-between px-4 py-1.5 border-t text-[11px] font-mono shrink-0 select-none transition-colors"
        :style="{ backgroundColor: 'var(--color-bg-header)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }"
      >
        <div class="flex items-center space-x-3">
          <!-- Vim Mode Indicator -->
          <div v-if="isVimMode" class="flex items-center space-x-1.5">
            <span
              class="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
              :class="{
                'bg-emerald-950/80 border border-emerald-500/50 text-emerald-300': currentVimMode === 'NORMAL',
                'bg-sky-950/80 border border-sky-500/50 text-sky-300': currentVimMode === 'INSERT',
                'bg-purple-950/80 border border-purple-500/50 text-purple-300': currentVimMode === 'VISUAL',
                'bg-rose-950/80 border border-rose-500/50 text-rose-300': currentVimMode === 'REPLACE',
              }"
            >
              -- {{ currentVimMode }} --
            </span>
          </div>

          <span>Ln {{ cursorLine }}, Col {{ cursorCol }}</span>
          <span>•</span>
          <span>{{ lineCount }} lines</span>
          <span>•</span>
          <span>{{ docChars }} chars</span>
        </div>

        <div class="flex items-center space-x-3">
          <!-- Syntax / Language Tag -->
          <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold border" :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-accent)' }">
            {{ detectedLanguageName }}
          </span>
          <span>•</span>
          <span>UTF-8</span>
          <span>•</span>

          <!-- Shortcuts Hint -->
          <template v-if="isVimMode">
            <span class="text-[10px] opacity-80 flex items-center space-x-1.5">
              <span><span class="text-amber-300 font-semibold">:w</span> save</span>
              <span>•</span>
              <span><span class="text-amber-300 font-semibold">:wq</span> save & quit</span>
              <span>•</span>
              <span><span class="text-amber-300 font-semibold">:q</span> quit</span>
              <span>•</span>
              <span class="flex items-center space-x-1 inline-flex">
                <kbd class="px-1 py-0.5 rounded text-[10px] border" :style="{ borderColor: 'var(--color-border)' }">Ctrl+W</kbd>
                <span>Close</span>
              </span>
            </span>
          </template>
          <template v-else>
            <span class="flex items-center space-x-1">
              <kbd class="px-1 py-0.5 rounded text-[10px] border" :style="{ borderColor: 'var(--color-border)' }">Ctrl+S</kbd>
              <span>Save</span>
            </span>
            <span>•</span>
            <span class="flex items-center space-x-1">
              <kbd class="px-1 py-0.5 rounded text-[10px] border" :style="{ borderColor: 'var(--color-border)' }">Ctrl+W</kbd>
              <span>Close</span>
            </span>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
:deep(.cm-editor) {
  height: 100% !important;
  outline: none !important;
}

:deep(.cm-scroller) {
  scrollbar-width: thin;
  scrollbar-color: var(--color-border) transparent;
}

:deep(.cm-scroller::-webkit-scrollbar) {
  width: 8px;
  height: 8px;
}

:deep(.cm-scroller::-webkit-scrollbar-track) {
  background-color: transparent !important;
}

:deep(.cm-scroller::-webkit-scrollbar-thumb) {
  background-color: var(--color-border) !important;
  border-radius: 4px;
}

:deep(.cm-scroller::-webkit-scrollbar-thumb:hover) {
  background-color: var(--color-bg-hover) !important;
}
</style>
