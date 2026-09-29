<template>
  <!-- Settings of the gifts / live / VIP area, editable with the area's own permission (no system.config needed). -->
  <div v-loading="loading" class="area-settings">
    <el-form label-position="top" class="cfg-grid">
      <el-form-item v-for="item in items" :key="item.key" :class="{ wide: ['json', 'list', 'text'].includes(item.type) }">
        <template #label>
          <span>{{ pick(item) }}</span>
          <el-tag v-if="dirty[item.key]" size="small" type="warning" effect="plain">{{ t('cfg.changed') }}</el-tag>
          <el-tag v-else-if="item.overridden" size="small" type="success" effect="plain">{{ t('cfg.custom') }}</el-tag>
        </template>
        <el-input-number v-if="['int', 'number', 'money'].includes(item.type)" v-model="values[item.key]" :min="item.min ?? undefined" :max="item.max ?? undefined"
          :step="item.type === 'int' ? 1 : item.type === 'money' ? 0.5 : 0.05" :precision="item.type === 'int' ? 0 : 2" controls-position="right" :disabled="!writable" @change="touch(item)" />
        <el-switch v-else-if="item.type === 'bool'" v-model="values[item.key]" :disabled="!writable" @change="touch(item)" />
        <el-select v-else-if="item.type === 'list'" v-model="values[item.key]" multiple filterable allow-create default-first-option :disabled="!writable" style="width: 100%" @change="touch(item)" />
        <div v-else-if="item.type === 'json'" style="width: 100%">
          <el-input v-model="jsonText[item.key]" type="textarea" :autosize="{ minRows: 2, maxRows: 12 }" class="mono" :disabled="!writable" @input="touchJson(item)" />
          <small v-if="jsonError[item.key]" class="neg">{{ t('cfg.badJson') }}</small>
        </div>
        <el-input v-else v-model="values[item.key]" :disabled="!writable" @input="touch(item)" />
        <div class="foot">
          <small v-if="item.help" class="muted">{{ item.help }}</small>
          <small class="muted key">{{ item.key }}</small>
          <el-button v-if="item.overridden && writable" link size="small" @click="restore(item)">{{ t('common.restoreDefault') }}</el-button>
        </div>
      </el-form-item>
    </el-form>
    <div v-if="dirtyCount" class="savebar">
      <span>{{ t('cfg.pending', { n: dirtyCount }) }}</span>
      <el-button @click="load">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" @click="save">{{ t('common.save') }}</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../../core/api';
import { t, pick } from '../../core/i18n';
import { can } from '../../core/auth';

const props = defineProps({ keys: { type: Array, required: true }, perm: { type: String, required: true } });
const emit = defineEmits(['saved']);
const writable = computed(() => can(props.perm));
const loading = ref(false);
const saving = ref(false);
const items = ref([]);
const values = reactive({});
const dirty = reactive({});
const jsonText = reactive({});
const jsonError = reactive({});
const dirtyCount = computed(() => Object.values(dirty).filter(Boolean).length);

async function load() {
  loading.value = true;
  try {
    const res = await api.get('gl-config', { keys: props.keys.join(',') });
    items.value = props.keys.map(k => res[k]).filter(Boolean);
    for (const item of items.value) {
      values[item.key] = item.type === 'list' ? [...(item.value || [])] : item.value;
      if (item.type === 'json') jsonText[item.key] = JSON.stringify(item.value, null, 1);
      dirty[item.key] = false;
      jsonError[item.key] = false;
    }
  } finally {
    loading.value = false;
  }
}
load();
function touch(item) {
  dirty[item.key] = true;
}
function touchJson(item) {
  try {
    values[item.key] = JSON.parse(jsonText[item.key]);
    jsonError[item.key] = false;
  } catch (_) {
    jsonError[item.key] = true;
  }
  dirty[item.key] = true;
}
async function save() {
  if (Object.values(jsonError).some(Boolean)) return ElMessage.error(t('cfg.badJson'));
  const body = {};
  for (const [k, d] of Object.entries(dirty)) if (d) body[k] = values[k];
  saving.value = true;
  try {
    await api.put('gl-config', body);
    ElMessage.success(t('common.saved'));
    await load();
    emit('saved');
  } finally {
    saving.value = false;
  }
}
async function restore(item) {
  await api.put('gl-config', { [item.key]: '__default__' });
  await load();
  emit('saved');
}
defineExpose({ load });
</script>

<style scoped>
.cfg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 0 20px; }
.wide { grid-column: 1 / -1; }
.foot { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; width: 100%; }
.key { font-family: var(--font-mono); }
.mono :deep(textarea) { font-family: var(--font-mono); font-size: 12px; }
.savebar { position: sticky; bottom: 0; display: flex; gap: 8px; align-items: center; justify-content: flex-end; padding: 10px 0; background: var(--el-bg-color); }
</style>
