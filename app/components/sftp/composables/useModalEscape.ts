import { watch, onUnmounted, toValue, type MaybeRefOrGetter } from 'vue'

/**
 * Attaches a capturing 'Escape' keydown listener to window while the modal is shown,
 * calling onClose() when Escape is pressed. Automatically cleans up on modal close or unmount.
 */
export function useModalEscape(
  show: MaybeRefOrGetter<boolean>,
  onClose: () => void
): void {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && toValue(show)) {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }

  watch(
    () => toValue(show),
    (isOpen) => {
      if (isOpen) {
        window.addEventListener('keydown', handleKeyDown, true)
      } else {
        window.removeEventListener('keydown', handleKeyDown, true)
      }
    },
    { immediate: true }
  )

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyDown, true)
  })
}
