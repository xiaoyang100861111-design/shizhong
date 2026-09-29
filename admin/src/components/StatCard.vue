<template>
  <component :is="link ? 'router-link' : 'div'" :to="link" class="stat" :class="{ clickable: !!link }">
    <div class="label">{{ label }}</div>
    <div class="value num">{{ display }}</div>
    <div v-if="delta !== undefined && delta !== null" class="delta num" :class="Number(delta) >= 0 ? 'pos' : 'neg'">
      {{ Number(delta) >= 0 ? '▲' : '▼' }} {{ Math.abs(Number(delta)).toLocaleString() }} <span class="muted">{{ deltaLabel }}</span>
    </div>
  </component>
</template>

<script setup>
import { computed } from 'vue';
import { money, number } from '../core/format';
const props = defineProps({ label: String, value: [Number, String], unit: String, delta: [Number, String], deltaLabel: String, link: String });
const display = computed(() => (props.unit === 'RM' ? money(props.value) : typeof props.value === 'number' ? number(props.value, 2) : props.value) + (props.unit && props.unit !== 'RM' ? ' ' + props.unit : ''));
</script>

<style scoped>
.stat { display: block; background: var(--el-bg-color); border-radius: 10px; padding: 14px 16px; text-decoration: none; color: inherit; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
.stat.clickable:hover { box-shadow: 0 2px 10px rgba(0,0,0,.08); }
.label { color: var(--el-text-color-secondary); font-size: 13px; }
.value { font-size: 24px; font-weight: 600; margin-top: 6px; }
.delta { font-size: 12px; margin-top: 4px; }
</style>
