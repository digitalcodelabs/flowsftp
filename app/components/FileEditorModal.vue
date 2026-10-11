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
  Maximize2,
  Minimize2,
  Scissors,
  Copy,
  ClipboardPaste,
  Undo2,
  Redo2,
  CheckSquare,
  Search,
  Code2,
} from 'lucide-vue-next'
import { selectAll, undo, redo, undoDepth, redoDepth, indentSelection } from '@codemirror/commands'
import { openSearchPanel } from '@codemirror/search'
import { useSettingsStore } from '../stores/settings'
import { useThemeStore, isLightTheme } from '../stores/theme'
import FileIcon from './FileIcon.vue'

// CodeMirror 6 and Extensions
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Compartment, Prec, type Extension } from '@codemirror/state'
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
const externalEditStore = useExternalEditStore()

const editorContainerRef = ref<HTMLDivElement | null>(null)
let editorView: EditorView | null = null

// Editor state
const initialContent = ref('')
const isLoading = ref(true)
const isSaving = ref(false)
const isDirty = ref(false)
const errorMessage = ref<string | null>(null)
const successMessage = ref<string | null>(null)
const isMaximized = ref(false)

watch(isMaximized, () => {
  nextTick(() => {
    editorView?.requestMeasure()
  })
})

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
      editorView.focus()
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
      '.cm-fat-cursor': {
        position: 'absolute',
        background: `${term.cursor || ui.accent} !important`,
        opacity: '0.75',
        border: 'none',
        whiteSpace: 'pre',
      },
      '&:not(.cm-focused) .cm-fat-cursor': {
        background: 'none !important',
        outline: `solid 1px ${term.cursor || ui.accent} !important`,
        color: 'transparent !important',
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

// Explicit Vim Escape handler: exits insertMode/visualMode and enters normal mode
const handleVimEscape = () => {
  if (!editorView) return
  const cm = getCM(editorView)
  if (!cm) return
  Vim.handleKey(cm, '<Esc>')
  editorView.focus()
  if (cm.state?.vim) {
    if (cm.state.vim.insertMode) {
      currentVimMode.value = 'INSERT'
    } else if (cm.state.vim.visualMode) {
      currentVimMode.value = 'VISUAL'
    } else {
      currentVimMode.value = 'NORMAL'
    }
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
    // Include vim compartment first before other keymaps as required by codemirror-vim
    vimCompartment.of(isVimMode.value ? vim({ status: true }) : []),
    basicSetup,
    themeCompartment.of(buildThemeExtensions()),
    languageCompartment.of([]),
    // Ensure Escape and Ctrl-[ immediately transition back to normal mode
    Prec.highest(
      keymap.of([
        {
          key: 'Escape',
          run: () => {
            if (isVimMode.value) {
              handleVimEscape()
              return true
            }
            return false
          },
        },
        {
          key: 'Ctrl-[',
          run: () => {
            if (isVimMode.value) {
              handleVimEscape()
              return true
            }
            return false
          },
        },
      ])
    ),
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
  currentVimMode.value = isVimMode.value ? 'NORMAL' : 'OFF'

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
      if (!props.sessionId) {
        throw new Error('No active session connected')
      }
      const editor = settingsStore.preferredExternalEditor === 'custom'
        ? settingsStore.customExternalEditorCommand
        : settingsStore.preferredExternalEditor
      await externalEditStore.startEdit(props.sessionId, props.filePath, editor)
      emit('close')
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

// Global modal keydown: intercept Ctrl+W, Escape, and Ctrl+[
const handleModalKeyDown = (e: KeyboardEvent) => {
  if (!props.show) return

  // Ctrl+W or Cmd+W to close editor modal
  // If custom context menu is open, Escape should close it first
  if (contextMenuVisible.value && (e.key === 'Escape' || (e.ctrlKey && e.key === '['))) {
    e.preventDefault()
    e.stopPropagation()
    closeContextMenu()
    return
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
    e.preventDefault()
    e.stopPropagation()
    handleClose()
    return
  }

  // Escape or Ctrl+[ handling
  if (e.key === 'Escape' || (e.ctrlKey && e.key === '[')) {
    if (isVimMode.value && editorView) {
      e.preventDefault()
      e.stopPropagation()
      handleVimEscape()
      return
    } else if (!isVimMode.value) {
      e.preventDefault()
      e.stopPropagation()
      handleClose()
      return
    }
  }
}

// Custom Right-Click Context Menu State & Handlers
const contextMenuVisible = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)
const hasSelection = ref(false)
const canUndoState = ref(false)
const canRedoState = ref(false)

const openContextMenu = (e: MouseEvent) => {
  e.preventDefault()
  e.stopPropagation()
  if (!editorView) return

  // Move cursor if clicked outside existing selection
  const pos = editorView.posAtCoords({ x: e.clientX, y: e.clientY })
  if (pos !== null) {
    const state = editorView.state
    const { from, to } = state.selection.main
    if (from === to || pos < from || pos > to) {
      editorView.dispatch({
        selection: { anchor: pos },
      })
    }
  }

  const state = editorView.state
  const { from, to } = state.selection.main
  hasSelection.value = from !== to
  canUndoState.value = undoDepth(state) > 0
  canRedoState.value = redoDepth(state) > 0

  // Clamping to screen boundaries
  const menuWidth = 220
  const menuHeight = 330
  const maxX = window.innerWidth - menuWidth - 12
  const maxY = window.innerHeight - menuHeight - 12

  contextMenuX.value = Math.max(12, Math.min(e.clientX, maxX))
  contextMenuY.value = Math.max(12, Math.min(e.clientY, maxY))
  contextMenuVisible.value = true
}

const closeContextMenu = () => {
  contextMenuVisible.value = false
}

const handleCut = async () => {
  closeContextMenu()
  if (!editorView) return
  const state = editorView.state
  const { from, to } = state.selection.main
  if (from !== to) {
    const text = state.sliceDoc(from, to)
    try {
      await navigator.clipboard.writeText(text)
      editorView.dispatch({
        changes: { from, to, insert: '' },
        selection: { anchor: from },
      })
      editorView.focus()
    } catch (err) {
      console.warn('Cut failed:', err)
    }
  }
}

const handleCopy = async () => {
  closeContextMenu()
  if (!editorView) return
  const state = editorView.state
  const { from, to } = state.selection.main
  if (from !== to) {
    const text = state.sliceDoc(from, to)
    try {
      await navigator.clipboard.writeText(text)
    } catch (err) {
      console.warn('Copy failed:', err)
    }
  }
}

const handlePaste = async () => {
  closeContextMenu()
  if (!editorView) return
  try {
    const text = await navigator.clipboard.readText()
    if (text) {
      const state = editorView.state
      const { from, to } = state.selection.main
      editorView.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
      })
      editorView.focus()
    }
  } catch (err) {
    console.warn('Paste failed:', err)
  }
}

const handleSelectAll = () => {
  closeContextMenu()
  if (editorView) {
    selectAll(editorView)
    editorView.focus()
  }
}

const handleUndo = () => {
  closeContextMenu()
  if (editorView) {
    undo(editorView)
    editorView.focus()
  }
}

const handleRedo = () => {
  closeContextMenu()
  if (editorView) {
    redo(editorView)
    editorView.focus()
  }
}

const handleFind = () => {
  closeContextMenu()
  if (editorView) {
    openSearchPanel(editorView)
  }
}

const handleIndentSelection = () => {
  closeContextMenu()
  if (editorView) {
    indentSelection(editorView)
    editorView.focus()
  }
}

const handleSaveFromMenu = () => {
  closeContextMenu()
  handleSave()
}

const handleToggleVimFromMenu = () => {
  closeContextMenu()
  toggleVimMode()
}

watch(
  () => [props.show, props.filePath],
  ([show]) => {
    closeContextMenu()
    if (show) {
      isMaximized.value = false
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
  window.addEventListener('resize', closeContextMenu)
})

onBeforeUnmount(() => {
  closeContextMenu()
  window.removeEventListener('keydown', handleModalKeyDown, true)
  window.removeEventListener('resize', closeContextMenu)
  if (editorView) {
    editorView.destroy()
    editorView = null
  }
})
</script>

<template>
  <div
    v-if="show"
    class="fixed top-10 inset-x-0 bottom-0 z-[70] flex items-center justify-center bg-black/75 backdrop-blur-md animate-in fade-in duration-150 select-none"
    :class="isMaximized ? 'p-0' : 'p-2 sm:p-3.5'"
    @click.self="handleClose"
  >
    <div
      class="flex flex-col border shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 transition-all"
      :class="
        isMaximized
          ? 'w-full h-full rounded-none border-0'
          : 'w-[96vw] max-w-[1550px] h-[calc(100%-1rem)] max-h-[calc(100%-1rem)] rounded-2xl'
      "
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
                class="px-2 py-0.5 rounded text-[10px] uppercase font-mono font-semibold border"
                :class="
                  target === 'remote'
                    ? 'bg-sky-500/15 border-sky-500/30 text-sky-700 dark:bg-sky-950/60 dark:border-sky-500/40 dark:text-sky-300'
                    : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:bg-emerald-950/60 dark:border-emerald-500/40 dark:text-emerald-300'
                "
              >
                {{ target }}
              </span>

              <!-- Dirty / Unsaved Indicator -->
              <span
                v-if="isDirty"
                class="flex items-center space-x-1 text-[11px] font-medium text-amber-500 dark:text-amber-400 animate-pulse"
                title="Unsaved changes (Ctrl+S or :w to save)"
              >
                <span>●</span>
                <span>Unsaved</span>
              </span>
              <span
                v-else-if="successMessage"
                class="flex items-center space-x-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
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
            class="px-2.5 py-1.5 rounded-lg border text-xs font-mono font-semibold flex items-center space-x-1.5 transition cursor-pointer shadow-sm"
            :class="
              isVimMode
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:bg-emerald-950/60 dark:border-emerald-500/50 dark:text-emerald-300'
                : 'hover:bg-black/5 dark:hover:bg-white/5'
            "
            :style="
              isVimMode
                ? {}
                : { backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }
            "
          >
            <span class="text-[10px] font-bold">VIM</span>
            <span
              class="w-2 h-2 rounded-full"
              :class="isVimMode ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50 animate-pulse' : 'bg-zinc-400 dark:bg-zinc-600'"
            />
          </button>

          <button
            @click="handleOpenInDefaultApp"
            :title="target === 'local' ? 'Open in system default text editor' : 'Open in external editor with live auto-upload sync'"
            class="px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center space-x-1.5 transition btn-theme-card cursor-pointer"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
          >
            <ExternalLink class="w-3.5 h-3.5" />
            <span>{{ target === 'local' ? 'Default App' : 'External Editor' }}</span>
          </button>

          <button
            @click="loadContent"
            :disabled="isLoading || isSaving"
            title="Reload content from server"
            class="p-1.5 rounded-lg border text-xs transition btn-theme-card disabled:opacity-50 cursor-pointer"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
          >
            <RotateCcw class="w-3.5 h-3.5" :class="{ 'animate-spin': isLoading }" />
          </button>

          <!-- Maximize / Restore Toggle Button -->
          <button
            @click="isMaximized = !isMaximized"
            :title="isMaximized ? 'Restore editor size' : 'Maximize editor (Fullscreen)'"
            class="p-1.5 rounded-lg border text-xs transition btn-theme-card cursor-pointer"
            :style="{ backgroundColor: 'var(--color-bg-pane)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
          >
            <Minimize2 v-if="isMaximized" class="w-3.5 h-3.5" />
            <Maximize2 v-else class="w-3.5 h-3.5" />
          </button>

          <button
            @click="handleSave"
            :disabled="isSaving || isLoading || !isDirty"
            title="Save file (Ctrl+S or :w)"
            class="px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow-sm transition btn-accent disabled:opacity-40 cursor-pointer"
          >
            <Save class="w-3.5 h-3.5" :class="{ 'animate-pulse': isSaving }" />
            <span>{{ isSaving ? 'Saving...' : 'Save' }}</span>
          </button>

          <div class="h-4 w-px mx-0.5" :style="{ backgroundColor: 'var(--color-border)' }" />

          <button
            @click="handleClose"
            title="Close editor (Ctrl+W or :q)"
            class="p-1.5 rounded-lg text-xs transition hover:bg-red-500/15 cursor-pointer"
            :style="{ color: 'var(--color-text-muted)' }"
            :class="'hover:text-red-500 dark:hover:text-red-300'"
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
      <div
        class="flex-1 relative flex overflow-hidden min-h-0 select-text"
        @contextmenu.prevent="openContextMenu"
      >
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
              class="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border"
              :class="{
                'bg-emerald-500/15 border-emerald-500/35 text-emerald-700 dark:bg-emerald-950/80 dark:border-emerald-500/50 dark:text-emerald-300': currentVimMode === 'NORMAL',
                'bg-sky-500/15 border-sky-500/35 text-sky-700 dark:bg-sky-950/80 dark:border-sky-500/50 dark:text-sky-300': currentVimMode === 'INSERT',
                'bg-purple-500/15 border-purple-500/35 text-purple-700 dark:bg-purple-950/80 dark:border-purple-500/50 dark:text-purple-300': currentVimMode === 'VISUAL',
                'bg-rose-500/15 border-rose-500/35 text-rose-700 dark:bg-rose-950/80 dark:border-rose-500/50 dark:text-rose-300': currentVimMode === 'REPLACE',
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
            <span class="text-[10px] flex items-center space-x-1.5">
              <span><span class="text-amber-600 dark:text-amber-300 font-semibold">:w</span> save</span>
              <span>•</span>
              <span><span class="text-amber-600 dark:text-amber-300 font-semibold">:wq</span> save & quit</span>
              <span>•</span>
              <span><span class="text-amber-600 dark:text-amber-300 font-semibold">:q</span> quit</span>
              <span>•</span>
              <span class="flex items-center space-x-1 inline-flex">
                <kbd
                  class="px-1 py-0.5 rounded text-[10px] border font-mono"
                  :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
                >Ctrl+W</kbd>
                <span>Close</span>
              </span>
            </span>
          </template>
          <template v-else>
            <span class="flex items-center space-x-1">
              <kbd
                class="px-1 py-0.5 rounded text-[10px] border font-mono"
                :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
              >Ctrl+S</kbd>
              <span>Save</span>
            </span>
            <span>•</span>
            <span class="flex items-center space-x-1">
              <kbd
                class="px-1 py-0.5 rounded text-[10px] border font-mono"
                :style="{ backgroundColor: 'var(--color-bg-card)', borderColor: 'var(--color-border)', color: 'var(--color-text-main)' }"
              >Ctrl+W</kbd>
              <span>Close</span>
            </span>
          </template>
        </div>
      </div>
    </div>

    <!-- Custom Themed Editor Context Menu -->
    <Teleport to="body">
      <div
        v-if="show && contextMenuVisible"
        class="fixed inset-0 z-[9999]"
        @click="closeContextMenu"
        @contextmenu.prevent="closeContextMenu"
      >
        <div
          :style="{
            left: `${contextMenuX}px`,
            top: `${contextMenuY}px`,
            backgroundColor: 'var(--color-bg-card)',
            borderColor: 'var(--color-border)',
            boxShadow: '0 20px 40px -8px rgba(0, 0, 0, 0.45), 0 0 0 1px var(--color-border)',
          }"
          class="fixed min-w-[210px] backdrop-blur-md rounded-xl border p-1 text-xs select-none animate-in fade-in zoom-in-95 duration-75 shadow-2xl"
          @click.stop
        >
          <!-- Cut -->
          <button
            type="button"
            @click="handleCut"
            :disabled="!hasSelection"
            class="editor-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left cursor-pointer"
            :class="{ 'opacity-40 pointer-events-none cursor-not-allowed': !hasSelection }"
          >
            <div class="flex items-center space-x-2">
              <Scissors class="w-3.5 h-3.5" :style="{ color: 'var(--color-text-muted)' }" />
              <span>Cut</span>
            </div>
            <span class="text-[10px] font-mono opacity-50">Ctrl+X</span>
          </button>

          <!-- Copy -->
          <button
            type="button"
            @click="handleCopy"
            :disabled="!hasSelection"
            class="editor-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left cursor-pointer"
            :class="{ 'opacity-40 pointer-events-none cursor-not-allowed': !hasSelection }"
          >
            <div class="flex items-center space-x-2">
              <Copy class="w-3.5 h-3.5" :style="{ color: 'var(--color-text-muted)' }" />
              <span>Copy</span>
            </div>
            <span class="text-[10px] font-mono opacity-50">Ctrl+C</span>
          </button>

          <!-- Paste -->
          <button
            type="button"
            @click="handlePaste"
            class="editor-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left cursor-pointer"
          >
            <div class="flex items-center space-x-2">
              <ClipboardPaste class="w-3.5 h-3.5" :style="{ color: 'var(--color-text-muted)' }" />
              <span>Paste</span>
            </div>
            <span class="text-[10px] font-mono opacity-50">Ctrl+V</span>
          </button>

          <div class="h-px my-1" :style="{ backgroundColor: 'var(--color-border)' }" />

          <!-- Undo -->
          <button
            type="button"
            @click="handleUndo"
            :disabled="!canUndoState"
            class="editor-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left cursor-pointer"
            :class="{ 'opacity-40 pointer-events-none cursor-not-allowed': !canUndoState }"
          >
            <div class="flex items-center space-x-2">
              <Undo2 class="w-3.5 h-3.5" :style="{ color: 'var(--color-text-muted)' }" />
              <span>Undo</span>
            </div>
            <span class="text-[10px] font-mono opacity-50">Ctrl+Z</span>
          </button>

          <!-- Redo -->
          <button
            type="button"
            @click="handleRedo"
            :disabled="!canRedoState"
            class="editor-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left cursor-pointer"
            :class="{ 'opacity-40 pointer-events-none cursor-not-allowed': !canRedoState }"
          >
            <div class="flex items-center space-x-2">
              <Redo2 class="w-3.5 h-3.5" :style="{ color: 'var(--color-text-muted)' }" />
              <span>Redo</span>
            </div>
            <span class="text-[10px] font-mono opacity-50">Ctrl+Y</span>
          </button>

          <div class="h-px my-1" :style="{ backgroundColor: 'var(--color-border)' }" />

          <!-- Select All -->
          <button
            type="button"
            @click="handleSelectAll"
            class="editor-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left cursor-pointer"
          >
            <div class="flex items-center space-x-2">
              <CheckSquare class="w-3.5 h-3.5" :style="{ color: 'var(--color-text-muted)' }" />
              <span>Select All</span>
            </div>
            <span class="text-[10px] font-mono opacity-50">Ctrl+A</span>
          </button>

          <!-- Find / Search -->
          <button
            type="button"
            @click="handleFind"
            class="editor-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left cursor-pointer"
          >
            <div class="flex items-center space-x-2">
              <Search class="w-3.5 h-3.5" :style="{ color: 'var(--color-text-muted)' }" />
              <span>Find in File</span>
            </div>
            <span class="text-[10px] font-mono opacity-50">Ctrl+F</span>
          </button>

          <!-- Indent Selection -->
          <button
            type="button"
            @click="handleIndentSelection"
            class="editor-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left cursor-pointer"
          >
            <div class="flex items-center space-x-2">
              <Code2 class="w-3.5 h-3.5" :style="{ color: 'var(--color-text-muted)' }" />
              <span>Indent Selection</span>
            </div>
            <span class="text-[10px] font-mono opacity-50">Tab</span>
          </button>

          <div class="h-px my-1" :style="{ backgroundColor: 'var(--color-border)' }" />

          <!-- Toggle Vim Mode -->
          <button
            type="button"
            @click="handleToggleVimFromMenu"
            class="editor-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left cursor-pointer"
          >
            <div class="flex items-center space-x-2">
              <Terminal class="w-3.5 h-3.5" :style="{ color: isVimMode ? 'var(--color-accent)' : 'var(--color-text-muted)' }" />
              <span>Vim Mode</span>
            </div>
            <span
              class="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border"
              :class="isVimMode ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400' : 'text-zinc-500 border-zinc-700'"
            >
              {{ isVimMode ? 'ON' : 'OFF' }}
            </span>
          </button>

          <!-- Save File -->
          <button
            type="button"
            @click="handleSaveFromMenu"
            :disabled="!isDirty || isSaving"
            class="editor-menu-item w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition text-left cursor-pointer"
            :class="{ 'opacity-40 pointer-events-none cursor-not-allowed': !isDirty || isSaving }"
          >
            <div class="flex items-center space-x-2">
              <Save class="w-3.5 h-3.5" :style="{ color: isDirty ? 'var(--color-accent)' : 'var(--color-text-muted)' }" />
              <span>Save File</span>
            </div>
            <span class="text-[10px] font-mono opacity-50">Ctrl+S</span>
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.editor-menu-item {
  color: var(--color-text-main);
  transition: background-color 0.12s ease, color 0.12s ease;
}
.editor-menu-item:hover {
  background-color: var(--color-bg-hover);
  color: var(--color-text-main);
}

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
