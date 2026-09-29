<template>
  <div class="cell-user">
    <el-avatar :size="size" :src="assetUrl(avatar)">{{ (name || '?').slice(0, 1) }}</el-avatar>
    <div class="meta">
      <router-link v-if="link && id" :to="'/users/' + id" class="name">{{ name || '—' }}</router-link>
      <span v-else class="name">{{ name || '—' }}</span>
      <small v-if="sub || displayId" class="num">{{ sub || 'ID ' + displayId }}</small>
    </div>
  </div>
</template>

<script setup>
import { assetUrl } from '../core/api';
defineProps({
  id: [Number, String], name: String, avatar: String, displayId: String, sub: String,
  size: { type: Number, default: 32 }, link: { type: Boolean, default: true },
});
</script>

<style scoped>
.name { color: var(--el-text-color-primary); text-decoration: none; font-weight: 500; }
a.name:hover { color: var(--el-color-primary); }
</style>
