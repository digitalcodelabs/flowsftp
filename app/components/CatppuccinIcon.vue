<script setup lang="ts">
import { Icon } from '@iconify/vue'
import '../utils/fileIcons'

defineProps<{
  name: string
  size?: number | string
}>()
</script>

<template>
  <Icon
    :icon="name.startsWith('catppuccin:') ? name : `catppuccin:${name}`"
    :width="size || 16"
    :height="size || 16"
    class="shrink-0 inline-block align-middle select-none"
  />
</template>
