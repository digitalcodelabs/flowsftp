<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { getFileIconName } from '../utils/fileIcons'

const props = withDefaults(
  defineProps<{
    name: string
    isDir?: boolean
    isOpen?: boolean
    size?: number | string
  }>(),
  {
    isDir: false,
    isOpen: false,
    size: 15,
  }
)

const iconName = computed(() => {
  return getFileIconName(props.name, props.isDir, props.isOpen)
})
</script>

<template>
  <Icon
    :icon="iconName"
    :width="size"
    :height="size"
    class="shrink-0 inline-block align-middle select-none transition-transform"
  />
</template>
