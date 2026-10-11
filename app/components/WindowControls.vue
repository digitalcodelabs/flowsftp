<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'

const isMaximized = ref(false)
let appWindow: any = null
let unlistenResize: (() => void) | null = null

const updateMaximizedState = async () => {
  if (appWindow) {
    try {
      isMaximized.value = await appWindow.isMaximized()
    } catch (err) {
      console.warn('Failed to check maximized state:', err)
    }
  }
}

const minimizeWindow = async () => {
  if (appWindow) {
    try {
      await appWindow.minimize()
    } catch (err) {
      console.warn('Failed to minimize window:', err)
    }
  }
}

const toggleMaximizeWindow = async () => {
  if (appWindow) {
    try {
      await appWindow.toggleMaximize()
      await updateMaximizedState()
    } catch (err) {
      console.warn('Failed to toggle maximize window:', err)
    }
  }
}

const closeWindow = async () => {
  if (appWindow) {
    try {
      await appWindow.close()
    } catch (err) {
      console.warn('Failed to close window:', err)
    }
  }
}

onMounted(async () => {
  if (typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__)) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      appWindow = getCurrentWindow()
      await updateMaximizedState()

      unlistenResize = await appWindow.listen('tauri://resize', () => {
        updateMaximizedState()
      })
    } catch (err) {
      console.warn('WindowControls initialization error:', err)
    }
  }
})

onBeforeUnmount(() => {
  if (unlistenResize) {
    unlistenResize()
    unlistenResize = null
  }
})

defineExpose({
  isMaximized,
})
</script>

<template>
  <div
    class="flex items-stretch h-full shrink-0 select-none"
    data-tauri-drag-region="false"
  >
    <!-- Minimize Button -->
    <button
      type="button"
      @click.stop="minimizeWindow"
      class="w-11 h-full flex items-center justify-center transition-colors duration-100 cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] hover:bg-[var(--color-bg-hover)] active:bg-black/10 dark:active:bg-white/10"
      title="Minimize"
      aria-label="Minimize"
    >
      <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
        <rect x="2.5" y="7.5" width="11" height="1.2" rx="0.6" />
      </svg>
    </button>

    <!-- Maximize / Restore Button -->
    <button
      type="button"
      @click.stop="toggleMaximizeWindow"
      class="w-11 h-full flex items-center justify-center transition-colors duration-100 cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] hover:bg-[var(--color-bg-hover)] active:bg-black/10 dark:active:bg-white/10"
      :title="isMaximized ? 'Restore' : 'Maximize'"
      :aria-label="isMaximized ? 'Restore' : 'Maximize'"
    >
      <!-- Restore Icon (Two overlapping squares) -->
      <svg
        v-if="isMaximized"
        class="w-3.5 h-3.5"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.25"
      >
        <rect x="4.5" y="2" width="9.5" height="9.5" rx="1" />
        <path d="M2 4.5v9a1 1 0 0 0 1 1h9" stroke-linecap="round" />
      </svg>
      <!-- Maximize Icon (Single square) -->
      <svg
        v-else
        class="w-3.5 h-3.5"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.25"
      >
        <rect x="2.5" y="2.5" width="11" height="11" rx="1.2" />
      </svg>
    </button>

    <!-- Close Button -->
    <button
      type="button"
      @click.stop="closeWindow"
      class="w-11 h-full flex items-center justify-center transition-colors duration-100 cursor-pointer text-[var(--color-text-muted)] hover:!bg-[#e81123] hover:!text-white active:!bg-[#c4101e] active:!text-white"
      title="Close"
      aria-label="Close"
    >
      <svg
        class="w-3.5 h-3.5"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.25"
        stroke-linecap="round"
      >
        <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
      </svg>
    </button>
  </div>
</template>
