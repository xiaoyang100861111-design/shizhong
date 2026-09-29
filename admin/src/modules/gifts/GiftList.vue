<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('gifts.title') }}</h1>
      <span class="muted">{{ t('common.total', { n: items.length }) }}</span>
      <div class="spacer" />
      <el-button v-can="'gifts.edit'" type="primary" :icon="IconPlus" @click="openEdit()">{{ t('gifts.add') }}</el-button>
    </div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="filters.q" :placeholder="t('gifts.q')" clearable @keyup.enter="load" @clear="load" />
        <el-select v-model="filters.context" clearable :placeholder="t('gifts.context')" @change="load">
          <el-option v-for="c in contexts" :key="c" :value="c" :label="t('gifts.ctx.' + c)" />
        </el-select>
        <el-select v-model="filters.category" clearable filterable :placeholder="t('gifts.category')" @change="load">
          <el-option v-for="c in allCategories" :key="c" :value="c" :label="c" />
        </el-select>
        <el-select v-model="filters.enabled" clearable :placeholder="t('common.status')" @change="load">
          <el-option :value="true" :label="t('gifts.enabledTag')" /><el-option :value="false" :label="t('gifts.disabledTag')" />
        </el-select>
        <el-button type="primary" @click="load">{{ t('common.search') }}</el-button>
      </div>
      <el-table v-loading="loading" :data="items" stripe>
        <el-table-column :label="t('gifts.art')" width="70">
          <template #default="{ row }"><img class="thumb" :src="assetUrl(row.artThumb || row.artFull)" alt="" /></template>
        </el-table-column>
        <el-table-column :label="t('gifts.name')" min-width="190">
          <template #default="{ row }">
            <b>{{ row.name }}</b> <span v-if="row.liveName" class="muted">/ {{ row.liveName }}</span>
            <div class="muted num">{{ row.id }} · {{ row.nameEn }}</div>
          </template>
        </el-table-column>
        <el-table-column :label="t('gifts.beans')" align="right" width="130">
          <template #default="{ row }"><b class="num">{{ number(row.beans) }}</b><div class="muted num">{{ t('gifts.rm', { n: money(row.beans / rate, '') }) }}</div></template>
        </el-table-column>
        <el-table-column :label="t('gifts.category')" min-width="150">
          <template #default="{ row }">
            <div v-if="row.category">{{ row.category }}<span v-if="row.subseries" class="muted"> · {{ row.subseries }}</span></div>
            <div v-if="row.liveCategory" class="muted">{{ t('gifts.ctx.live') }}: {{ row.liveCategory }}</div>
          </template>
        </el-table-column>
        <el-table-column :label="t('gifts.context')" min-width="170">
          <template #default="{ row }"><div class="tag-list"><el-tag v-for="c in row.contexts" :key="c" size="small" effect="plain">{{ t('gifts.ctx.' + c) }}</el-tag><el-tag v-if="row.wearable" size="small" type="warning">{{ t('gifts.wearable') }}</el-tag></div></template>
        </el-table-column>
        <el-table-column :label="t('gifts.uses')" align="right" width="100">
          <template #default="{ row }"><span class="num">{{ number(row.uses) }}</span><div class="muted num">{{ number(row.volumeBeans) }}</div></template>
        </el-table-column>
        <el-table-column :label="t('gifts.order')" prop="sortOrder" width="70" align="right" />
        <el-table-column :label="t('common.status')" width="90">
          <template #default="{ row }">
            <el-switch :model-value="row.enabled" :disabled="!can('gifts.edit')" @change="v => toggle(row, v)" />
          </template>
        </el-table-column>
        <el-table-column :label="t('common.actions')" width="130" fixed="right">
          <template #default="{ row }">
            <el-button v-can="'gifts.edit'" link type="primary" @click="openEdit(row)">{{ t('common.edit') }}</el-button>
            <el-button v-if="!row.uses" v-can="'gifts.edit'" link type="danger" @click="remove(row)">{{ t('common.delete') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="open" :title="form.isNew ? t('gifts.add') : t('common.edit') + ' · ' + form.id" width="760px" top="4vh">
      <el-form label-position="top" class="gift-form">
        <h4>{{ t('gifts.basic') }}</h4>
        <div class="grid2">
          <el-form-item :label="t('gifts.id')" required>
            <el-input v-model="form.id" :disabled="!form.isNew" :placeholder="t('gifts.idHint')" />
          </el-form-item>
          <el-form-item :label="t('gifts.beans')" required>
            <el-input-number v-model="form.beans" :min="1" :max="100000000" controls-position="right" />
            <small class="muted" style="margin-left: 8px">{{ t('gifts.rm', { n: money(form.beans / rate, '') }) }}</small>
          </el-form-item>
          <el-form-item :label="t('gifts.name')" required><el-input v-model="form.name" maxlength="60" /></el-form-item>
          <el-form-item :label="t('gifts.nameEn')"><el-input v-model="form.nameEn" maxlength="80" /></el-form-item>
          <el-form-item :label="t('gifts.liveName')"><el-input v-model="form.liveName" maxlength="60" /></el-form-item>
          <el-form-item :label="t('gifts.liveNameEn')"><el-input v-model="form.liveNameEn" maxlength="80" /></el-form-item>
          <el-form-item :label="t('gifts.desc')" class="wide"><el-input v-model="form.description" type="textarea" :rows="2" maxlength="400" /></el-form-item>
          <el-form-item :label="t('gifts.descEn')" class="wide"><el-input v-model="form.descriptionEn" type="textarea" :rows="2" maxlength="500" /></el-form-item>
        </div>
        <h4>{{ t('gifts.display') }}</h4>
        <div class="grid2">
          <el-form-item :label="t('gifts.context')" class="wide" required>
            <el-checkbox-group v-model="form.contexts"><el-checkbox v-for="c in contexts" :key="c" :value="c">{{ t('gifts.ctx.' + c) }}</el-checkbox></el-checkbox-group>
          </el-form-item>
          <el-form-item :label="t('gifts.category')"><el-select v-model="form.category" filterable allow-create clearable><el-option v-for="c in meta.categories" :key="c" :value="c" :label="c" /></el-select></el-form-item>
          <el-form-item :label="t('gifts.categoryEn')"><el-input v-model="form.categoryEn" /></el-form-item>
          <el-form-item :label="t('gifts.liveCategory')"><el-select v-model="form.liveCategory" filterable allow-create clearable><el-option v-for="c in meta.liveCategories" :key="c" :value="c" :label="c" /></el-select></el-form-item>
          <el-form-item :label="t('gifts.liveCategoryEn')"><el-input v-model="form.liveCategoryEn" /></el-form-item>
          <el-form-item :label="t('gifts.series')"><el-select v-model="form.series" filterable allow-create clearable><el-option v-for="c in meta.series" :key="c" :value="c" :label="c" /></el-select></el-form-item>
          <el-form-item :label="t('gifts.subseries')"><el-select v-model="form.subseries" filterable allow-create clearable><el-option v-for="c in meta.subseries" :key="c" :value="c" :label="c" /></el-select></el-form-item>
          <el-form-item :label="t('gifts.rarity')"><el-select v-model="form.rarity" filterable allow-create clearable><el-option v-for="c in meta.rarities" :key="c" :value="c" :label="c" /></el-select></el-form-item>
          <el-form-item :label="t('gifts.tier')"><el-select v-model="form.tier" filterable allow-create clearable><el-option v-for="c in meta.tiers" :key="c" :value="c" :label="c" /></el-select></el-form-item>
          <el-form-item :label="t('gifts.order')"><el-input-number v-model="form.sortOrder" :min="0" :max="100000" controls-position="right" /></el-form-item>
          <el-form-item :label="t('common.status')"><el-switch v-model="form.enabled" :active-text="t('gifts.enabledTag')" /></el-form-item>
        </div>
        <h4>{{ t('gifts.media') }}</h4>
        <div class="grid3">
          <el-form-item :label="t('gifts.artFull')" required><ImageUpload v-model="form.artFull" purpose="gift" allow-path path-hint="gift-art/…" /></el-form-item>
          <el-form-item :label="t('gifts.artThumb')"><ImageUpload v-model="form.artThumb" purpose="gift" allow-path path-hint="gift-art/…" /></el-form-item>
          <el-form-item :label="t('gifts.artCharm')"><ImageUpload v-model="form.artCharm" purpose="gift" :width="64" :height="64" allow-path path-hint="gift-art/…" /></el-form-item>
        </div>
        <div class="grid2">
          <el-form-item :label="t('gifts.accent')"><el-color-picker v-model="form.accent" /> <span class="num muted" style="margin-left: 8px">{{ form.accent }}</span></el-form-item>
          <el-form-item :label="t('gifts.wearable')"><el-switch v-model="form.wearable" /></el-form-item>
          <el-form-item :label="t('gifts.effect')"><el-select v-model="form.effect"><el-option v-for="e in meta.effects" :key="e" :value="e" :label="e" /></el-select></el-form-item>
          <el-form-item :label="t('gifts.liveEffect')"><el-select v-model="form.liveEffect"><el-option v-for="e in meta.liveEffects" :key="e" :value="e" :label="e" /></el-select></el-form-item>
          <el-form-item :label="t('gifts.oriental')"><el-select v-model="form.orientalEffect" clearable filterable><el-option v-for="e in meta.orientalEffects" :key="e" :value="e" :label="e" /></el-select></el-form-item>
          <el-form-item v-if="form.mallPriceRm" :label="t('gifts.legacyRm')"><span class="num">{{ money(form.mallPriceRm) }}</span></el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="open = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="busy" @click="save">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus as IconPlus } from '@element-plus/icons-vue';
import { api, assetUrl } from '../../core/api';
import { t } from '../../core/i18n';
import { can } from '../../core/auth';
import { money, number } from '../../core/format';
import ImageUpload from '../../components/ImageUpload.vue';

const contexts = ['mall', 'chat', 'live', 'private'];
const filters = reactive({ q: '', context: '', category: '', enabled: null });
const items = ref([]);
const loading = ref(false);
const meta = ref({ categories: [], liveCategories: [], series: [], subseries: [], rarities: [], tiers: [], effects: [], liveEffects: [], orientalEffects: [] });
const rate = ref(10);
const allCategories = computed(() => [...new Set([...meta.value.categories, ...meta.value.liveCategories, ...meta.value.series])]);

async function load() {
  loading.value = true;
  try {
    items.value = (await api.get('gifts', filters)).items;
  } finally {
    loading.value = false;
  }
}
async function loadMeta() {
  meta.value = await api.get('gifts/meta');
  const cfg = await api.get('gl-config', { keys: 'beans.rate' }, { quiet: true }).catch(() => null);
  rate.value = Number(cfg?.['beans.rate']?.value) || 10;
}
load();
loadMeta();

const blank = () => ({
  isNew: true, id: '', name: '', nameEn: '', liveName: '', liveNameEn: '', description: '', descriptionEn: '', beans: 100,
  category: '', categoryEn: '', liveCategory: '', liveCategoryEn: '', series: '', subseries: '', tier: '', rarity: '',
  accent: '#E9718F', effect: 'hearts', liveEffect: 'heart', orientalEffect: '', artFull: '', artThumb: '', artCharm: '',
  wearable: false, contexts: ['mall', 'chat', 'live', 'private'], enabled: true, sortOrder: 500, mallPriceRm: null,
});
const form = reactive(blank());
const open = ref(false);
const busy = ref(false);
function openEdit(row) {
  Object.assign(form, blank(), row ? { ...row, isNew: false, contexts: [...row.contexts] } : {});
  open.value = true;
}
async function save() {
  busy.value = true;
  const body = { ...form };
  delete body.isNew;
  try {
    if (form.isNew) await api.post('gifts', body);
    else await api.put('gifts/' + encodeURIComponent(form.id), body);
    ElMessage.success(t('gifts.saved'));
    open.value = false;
    load();
    loadMeta();
  } finally {
    busy.value = false;
  }
}
async function toggle(row, enabled) {
  await api.patch(`gifts/${encodeURIComponent(row.id)}/enabled`, { enabled });
  row.enabled = enabled;
}
async function remove(row) {
  await ElMessageBox.confirm(t('common.confirmDelete'), { type: 'warning' });
  await api.del('gifts/' + encodeURIComponent(row.id));
  ElMessage.success(t('common.deleted'));
  load();
}
</script>

<style scoped>
.gift-form h4 { margin: 8px 0 8px; font-size: 14px; color: var(--el-text-color-secondary); }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
.grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0 16px; }
.wide { grid-column: 1 / -1; }
@media (max-width: 768px) { .grid2, .grid3 { grid-template-columns: 1fr; } }
</style>
