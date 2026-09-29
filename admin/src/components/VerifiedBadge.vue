<template>
  <svg class="vbadge" :width="size" :height="size" viewBox="0 0 16 16" role="img" :aria-label="label || t('common.verified')">
    <title>{{ label || t('common.verified') }}</title>
    <circle cx="8" cy="8" r="8" fill="#1d9bf0" />
    <path d="M4.6 8.3l2.2 2.2 4.6-4.8" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
</template>

<script setup>
// Blue V (蓝V) check mark, as the app shows next to verified names. label = the verification label (tooltip).
import { t } from '../core/i18n';
defineProps({ size: { type: Number, default: 14 }, label: String });
</script>

<style scoped>
.vbadge { flex: none; vertical-align: -2px; }
</style>
