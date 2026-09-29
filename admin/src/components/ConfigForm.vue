<template>
  <div v-loading="loading" class="config-form">
    <template v-for="g in shownGroups" :key="g.group">
      <section :id="'cfg-' + g.group" class="panel">
        <h3 class="panel-title">{{ pick(g.head) }}</h3>
        <p v-if="g.head?.help" class="muted help">{{ g.head.help }}</p>
        <el-form label-position="top" class="cfg-grid">
          <el-form-item v-for="item in g.items" :key="item.key" :class="{ wide: isWide(item) }">
            <template #label>
              <span class="lbl">{{ pick(item) }}</span>
              <el-tag v-if="item.public" size="small" effect="plain" class="pub" :title="t('cfg.publicHint')">App</el-tag>
              <el-tag v-if="dirty[item.key]" size="small" type="warning" effect="plain">{{ t('cfg.changed') }}</el-tag>
              <el-tag v-else-if="item.overridden" size="small" type="success" effect="plain">{{ t('cfg.custom') }}</el-tag>
            </template>
            <!-- number-like -->
            <el-input-number v-if="['int', 'number', 'money'].includes(item.type)" v-model="values[item.key]" :min="item.min ?? undefined"
              :max="item.max ?? undefined" :step="item.type === 'int' ? 1 : item.type === 'money' ? 1 : 0.01"
              :precision="item.type === 'int' ? 0 : item.type === 'money' ? 2 : undefined" controls-position="right" @change="touch(item)" />
            <el-switch v-else-if="item.type === 'bool'" v-model="values[item.key]" @change="touch(item)" />
            <el-select v-else-if="item.type === 'select'" v-model="values[item.key]" @change="touch(item)">
              <el-option v-for="o in item.options || []" :key="o.value ?? o" :label="pick(o) || o.value || o" :value="o.value ?? o" />
            </el-select>
            <el-input v-else-if="item.type === 'text'" v-model="values[item.key]" type="textarea" :autosize="{ minRows: 3, maxRows: 12 }" @input="touch(item)" />
            <el-input v-else-if="item.type === 'secret'" v-model="values[item.key]" type="password" show-password autocomplete="new-password"
              :placeholder="t('cfg.secretHint')" @input="touch(item)" />
            <el-select v-else-if="item.type === 'list'" v-model="values[item.key]" multiple filterable allow-create default-first-option
              :reserve-keyword="false" class="list-input" @change="touch(item)" />
            <div v-else-if="item.type === 'i18n'" class="i18n">
              <el-input v-model="values[item.key].zh" type="textarea" :autosize="{ minRows: 2, maxRows: 10 }" placeholder="中文" @input="touch(item)" />
              <el-input v-model="values[item.key].en" type="textarea" :autosize="{ minRows: 2, maxRows: 10 }" placeholder="English" @input="touch(item)" />
            </div>
            <div v-else-if="item.type === 'json'" class="json">
              <el-input v-model="jsonText[item.key]" type="textarea" :autosize="{ minRows: 3, maxRows: 16 }" class="mono" @input="touchJson(item)" />
              <small v-if="jsonError[item.key]" class="neg">{{ t('cfg.badJson') }}</small>
            </div>
            <el-input v-else v-model="values[item.key]" @input="touch(item)" />
            <div class="foot">
              <small v-if="item.help" class="muted">{{ item.help }}</small>
              <small class="muted key">{{ item.key }}</small>
              <el-button v-if="item.overridden && item.type !== 'secret'" link size="small" @click="restore(item)">{{ t('common.restoreDefault') }}</el-button>
            </div>
          </el-form-item>
        </el-form>
      </section>
    </template>
    <div v-if="dirtyCount" class="savebar">
      <span>{{ t('cfg.pending', { n: dirtyCount }) }}</span>
      <el-button @click="load">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" @click="save">{{ t('common.save') }}</el-button>
    </div>
  </div>
</template>

<script setup>
// Renders admin-editable settings (ConfigDef on the server) grouped as declared by the modules.
// <ConfigForm :groups="['checkout', 'fees']" /> embeds only those groups in a domain page.
// endpoint / perm: a domain's own settings endpoint (same response shape as /config, e.g. 'finance/config')
// guarded by its own permission, so staff without system.config can edit their area's rules.
import { computed, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../core/api';
import { t, pick } from '../core/i18n';
import { can } from '../core/auth';

const props = defineProps({
  groups: { type: Array, default: null },
  filter: { type: String, default: '' },
  endpoint: { type: String, default: 'config' },
  perm: { type: [String, Array], default: 'system.config' },
});
const emit = defineEmits(['loaded', 'saved']);
const loading = ref(false);
const saving = ref(false);
const all = ref([]);
const values = reactive({});
const original = {};
const dirty = reactive({});
const jsonText = reactive({});
const jsonError = reactive({});

const shownGroups = computed(() => {
  let gs = all.value;
  if (props.groups) gs = gs.filter(g => props.groups.includes(g.group));
  const q = props.filter.trim().toLowerCase();
  if (q)
    gs = gs
      .map(g => ({ ...g, items: g.items.filter(i => [i.key, i.label, i.labelEn, i.help].some(s => s?.toLowerCase().includes(q))) }))
      .filter(g => g.items.length);
  return gs;
});
const dirtyCount = computed(() => Object.values(dirty).filter(Boolean).length);

const isWide = item => ['text', 'json', 'i18n', 'list'].includes(item.type);

async function load() {
  if (![].concat(props.perm).some(can)) return;
  loading.value = true;
  try {
    const res = await api.get(props.endpoint, props.endpoint === 'config' ? undefined : { groups: props.groups?.join(',') });
    all.value = res.groups;
    for (const g of res.groups)
      for (const i of g.items) {
        let v = i.value;
        if (i.type === 'i18n') v = { zh: v?.zh ?? '', en: v?.en ?? '' };
        if (i.type === 'list') v = Array.isArray(v) ? [...v] : [];
        if (i.type === 'json') jsonText[i.key] = JSON.stringify(v, null, 2);
        values[i.key] = v;
        original[i.key] = JSON.stringify(v);
        dirty[i.key] = false;
        jsonError[i.key] = false;
      }
    emit('loaded', res.groups);
  } finally {
    loading.value = false;
  }
}
function touch(item) {
  dirty[item.key] = JSON.stringify(values[item.key]) !== original[item.key];
}
function touchJson(item) {
  try {
    values[item.key] = JSON.parse(jsonText[item.key]);
    jsonError[item.key] = false;
    touch(item);
  } catch (_) {
    jsonError[item.key] = true;
    dirty[item.key] = true;
  }
}
async function save() {
  if (Object.entries(jsonError).some(([k, bad]) => bad && dirty[k])) return ElMessage.error(t('cfg.badJson'));
  const changes = {};
  for (const [k, d] of Object.entries(dirty)) if (d) changes[k] = values[k];
  saving.value = true;
  try {
    await api.put(props.endpoint, changes);
    ElMessage.success(t('common.saved'));
    await load();
    emit('saved', changes);
  } finally {
    saving.value = false;
  }
}
async function restore(item) {
  await ElMessageBox.confirm(t('cfg.restoreConfirm', { name: pick(item) }), { type: 'warning' });
  await api.post(props.endpoint + '/reset', { keys: [item.key] });
  ElMessage.success(t('common.done'));
  load();
}
load();
defineExpose({ load, groupsLoaded: all });
</script>

<style scoped>
.cfg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 4px 24px; }
.cfg-grid .wide { grid-column: 1 / -1; }
.lbl { margin-right: 6px; }
.pub { margin-right: 4px; }
.foot { display: flex; gap: 10px; align-items: center; width: 100%; flex-wrap: wrap; margin-top: 2px; line-height: 1.4; }
.key { font-family: var(--font-mono); opacity: .6; }
.help { margin: -6px 0 12px; font-size: 13px; }
.i18n { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; }
.json, .list-input { width: 100%; }
.mono :deep(textarea) { font-family: var(--font-mono); font-size: 12px; }
.savebar { position: sticky; bottom: 0; z-index: 5; display: flex; gap: 8px; align-items: center; justify-content: flex-end; padding: 10px 16px;
  background: var(--el-bg-color); border-top: 1px solid var(--el-border-color-lighter); box-shadow: 0 -4px 12px rgba(0,0,0,.05); border-radius: 10px; }
.savebar span { margin-right: auto; color: var(--el-color-warning); }
@media (max-width: 768px) { .i18n { grid-template-columns: 1fr; } }
</style>
