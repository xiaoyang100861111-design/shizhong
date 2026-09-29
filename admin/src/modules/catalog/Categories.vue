<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('cat.categories') }}</h1>
      <div class="spacer" />
      <el-button v-can="'catalog.edit'" type="primary" :icon="IconPlus" @click="edit()">{{ t('cat.newCategory') }}</el-button>
    </div>
    <p class="page-sub">{{ t('cat.categoriesSub') }}</p>
    <div class="panel">
      <el-table v-loading="loading" :data="rows" row-key="id">
        <el-table-column :label="t('cat.order')" width="90">
          <template #default="{ $index }">
            <el-button v-can="'catalog.edit'" link :disabled="$index === 0" @click="move($index, -1)">▲</el-button>
            <el-button v-can="'catalog.edit'" link :disabled="$index === rows.length - 1" @click="move($index, 1)">▼</el-button>
          </template>
        </el-table-column>
        <el-table-column :label="t('cm.category')" min-width="240">
          <template #default="{ row }">
            <div class="cat">
              <span class="icon" :style="{ color: row.color, background: row.bg }" v-html="appIconSvg(row.icon)" />
              <div>
                <b>{{ row.name }}</b> <span class="muted">{{ row.nameEn }}</span>
                <el-tag v-if="row.badge" size="small" type="danger" effect="plain" style="margin-left: 4px">{{ row.badge }}</el-tag>
                <div class="muted small">{{ row.hint }}</div>
                <small class="muted num">{{ row.id }}</small>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="t('cat.position')" width="120">
          <template #default="{ row }"><el-tag size="small" :type="row.onHome ? 'primary' : 'info'" effect="plain">{{ row.onHome ? t('cat.homeGrid') : t('cat.moreList') }}</el-tag></template>
        </el-table-column>
        <el-table-column :label="t('cat.count')" align="right" width="120">
          <template #default="{ row }"><router-link :to="'/catalog/services?cat=' + row.id" class="num">{{ row.onShelf }} / {{ row.total }}</router-link></template>
        </el-table-column>
        <el-table-column :label="t('common.status')" width="90">
          <template #default="{ row }"><el-switch :model-value="row.enabled" :disabled="!can('catalog.edit') || row.id === 'all'" @change="v => toggle(row, v)" /></template>
        </el-table-column>
        <el-table-column :label="t('common.actions')" width="140" fixed="right">
          <template #default="{ row }">
            <el-button v-can="'catalog.edit'" link type="primary" @click="edit(row)">{{ t('common.edit') }}</el-button>
            <el-button v-if="!row.builtIn" v-can="'catalog.delete'" link type="danger" @click="remove(row)">{{ t('common.delete') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="open" :title="editing ? t('cat.editCategory') : t('cat.newCategory')" width="560px">
      <el-form label-width="110px">
        <el-form-item :label="t('cat.categoryId')" required>
          <el-input v-model="form.id" :disabled="!!editing" maxlength="24" :placeholder="t('cat.categoryIdHint')" />
        </el-form-item>
        <el-form-item :label="t('common.name')" required><div class="two"><el-input v-model="form.name" maxlength="40" placeholder="中文" /><el-input v-model="form.nameEn" maxlength="60" placeholder="English" /></div></el-form-item>
        <el-form-item :label="t('cat.hint')"><div class="two"><el-input v-model="form.hint" maxlength="100" placeholder="中文" /><el-input v-model="form.hintEn" maxlength="160" placeholder="English" /></div></el-form-item>
        <el-form-item :label="t('cat.icon')">
          <div class="icons">
            <button v-for="name in iconNames" :key="name" type="button" class="icon-pick" :class="{ on: form.icon === name }" :title="name"
              :style="form.icon === name ? { color: form.color, background: form.bg } : {}" @click="form.icon = name" v-html="appIconSvg(name)" />
          </div>
        </el-form-item>
        <el-form-item :label="t('cat.colors')">
          <el-color-picker v-model="form.color" /> <span class="muted" style="margin: 0 12px 0 6px">{{ t('cat.iconColor') }}</span>
          <el-color-picker v-model="form.bg" /> <span class="muted" style="margin-left: 6px">{{ t('cat.bgColor') }}</span>
          <span class="icon preview" :style="{ color: form.color, background: form.bg }" v-html="appIconSvg(form.icon)" />
        </el-form-item>
        <el-form-item :label="t('cat.badge')"><el-input v-model="form.badge" maxlength="16" placeholder="24H" style="width: 120px" /></el-form-item>
        <el-form-item :label="t('cat.fallbackImage')"><ImageUpload v-model="form.image" :width="120" :height="80" allow-path path-hint="clean-home.webp" /></el-form-item>
        <el-form-item :label="t('cat.position')">
          <el-radio-group v-model="form.onHome"><el-radio :value="true">{{ t('cat.homeGrid') }}</el-radio><el-radio :value="false">{{ t('cat.moreList') }}</el-radio></el-radio-group>
        </el-form-item>
        <el-form-item :label="t('common.status')"><el-switch v-model="form.enabled" :disabled="form.id === 'all'" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="open = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="busy" :disabled="!form.id || !form.name" @click="save">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus as IconPlus } from '@element-plus/icons-vue';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { can } from '../../core/auth';
import ImageUpload from '../../components/ImageUpload.vue';
import { appIcons, appIconSvg } from './icons';
import { loadMeta } from '../orders/common';

const iconNames = Object.keys(appIcons);
const rows = ref([]);
const loading = ref(false);
const open = ref(false);
const busy = ref(false);
const editing = ref(null);
const blank = () => ({ id: '', name: '', nameEn: '', hint: '', hintEn: '', icon: 'grid', color: '#89829c', bg: '#f2eff7', badge: '', image: '', sortOrder: 0, onHome: false, enabled: true });
const form = reactive(blank());

async function load() {
  loading.value = true;
  try {
    rows.value = await api.get('catalog/categories');
  } finally {
    loading.value = false;
  }
}
function edit(row) {
  editing.value = row || null;
  Object.assign(form, blank(), row || { sortOrder: (rows.value.at(-1)?.sortOrder || 0) + 10 });
  open.value = true;
}
async function save() {
  busy.value = true;
  try {
    if (editing.value) await api.put('catalog/categories/' + editing.value.id, form);
    else await api.post('catalog/categories', form);
    ElMessage.success(t('common.saved'));
    open.value = false;
    load();
    loadMeta(true);
  } finally {
    busy.value = false;
  }
}
async function toggle(row, enabled) {
  await api.put('catalog/categories/' + row.id, { ...row, enabled });
  row.enabled = enabled;
}
async function move(i, delta) {
  const list = [...rows.value];
  const [x] = list.splice(i, 1);
  list.splice(i + delta, 0, x);
  rows.value = list;
  await api.post('catalog/categories/order', { ids: list.map(r => r.id) });
  load();
}
async function remove(row) {
  await ElMessageBox.confirm(t('common.confirmDelete'), { type: 'warning' });
  await api.del('catalog/categories/' + row.id);
  ElMessage.success(t('common.deleted'));
  load();
}
load();
</script>

<style scoped>
.cat { display: flex; gap: 10px; align-items: center; }
.icon { width: 40px; height: 40px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; flex: none; }
.icon :deep(svg), .icon-pick :deep(svg) { width: 22px; height: 22px; }
.icon.preview { margin-left: 16px; }
.icons { display: grid; grid-template-columns: repeat(auto-fill, 34px); gap: 6px; }
.icon-pick { width: 34px; height: 34px; border-radius: 8px; border: 1px solid var(--el-border-color-lighter); background: var(--el-fill-color-lighter); color: var(--el-text-color-regular); cursor: pointer; display: flex; align-items: center; justify-content: center; }
.icon-pick.on { border-color: var(--el-color-primary); }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; }
.small { font-size: 12px; }
</style>
