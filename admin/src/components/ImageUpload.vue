<template>
  <div class="img-up">
    <div v-if="modelValue" class="img-box" :style="{ width: width + 'px', height: height + 'px' }">
      <img :src="assetUrl(modelValue)" alt="" />
      <div class="img-actions">
        <el-button circle size="small" @click="pick"><el-icon><IconRefresh /></el-icon></el-button>
        <el-button circle size="small" type="danger" @click="$emit('update:modelValue', '')"><el-icon><IconDelete /></el-icon></el-button>
      </div>
    </div>
    <button v-else type="button" class="img-empty" :style="{ width: width + 'px', height: height + 'px' }" :disabled="busy" @click="pick">
      <el-icon v-if="!busy" :size="22"><IconPlus /></el-icon>
      <el-icon v-else class="is-loading" :size="22"><IconLoading /></el-icon>
      <span>{{ t('common.upload') }}</span>
    </button>
    <el-input v-if="allowPath" :model-value="modelValue" size="small" class="img-path" :placeholder="pathHint"
      @update:model-value="$emit('update:modelValue', $event)" />
    <input ref="file" type="file" :accept="accept" hidden @change="upload" />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { api, assetUrl } from '../core/api';
import { t } from '../core/i18n';

const props = defineProps({
  modelValue: String,
  width: { type: Number, default: 96 },
  height: { type: Number, default: 96 },
  accept: { type: String, default: 'image/jpeg,image/png,image/webp,image/gif,image/svg+xml' },
  purpose: { type: String, default: 'admin' },
  allowPath: { type: Boolean, default: false },
  pathHint: { type: String, default: 'assets/…' },
});
const emit = defineEmits(['update:modelValue']);
const file = ref();
const busy = ref(false);
function pick() {
  file.value.click();
}
async function upload(e) {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  busy.value = true;
  try {
    const res = await api.upload(f, props.purpose);
    emit('update:modelValue', res.ref);
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.img-up { display: flex; flex-direction: column; gap: 6px; }
.img-box { position: relative; border-radius: 8px; overflow: hidden; background: var(--el-fill-color-light); }
.img-box img { width: 100%; height: 100%; object-fit: cover; display: block; }
.img-actions { position: absolute; right: 4px; bottom: 4px; display: flex; gap: 4px; }
.img-empty { border: 1px dashed var(--el-border-color); border-radius: 8px; background: var(--el-fill-color-lighter); color: var(--el-text-color-secondary);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; cursor: pointer; font-size: 12px; }
.img-empty:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }
.img-path { max-width: 320px; }
</style>
