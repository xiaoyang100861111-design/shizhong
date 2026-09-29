<template>
  <div class="page">
    <div class="page-head"><h1>{{ t('gifts.settings.title') }}</h1></div>
    <div v-loading="loading" class="panel">
      <h3 class="panel-title">{{ t('gifts.settings.packs') }}</h3>
      <el-table :data="packs" size="small">
        <el-table-column :label="t('gifts.settings.packId')" width="130"><template #default="{ row }"><el-input v-model="row.id" size="small" :disabled="!writable" /></template></el-table-column>
        <el-table-column :label="t('gifts.settings.beans')" width="150"><template #default="{ row }"><el-input-number v-model="row.beans" size="small" :min="1" :disabled="!writable" controls-position="right" /></template></el-table-column>
        <el-table-column :label="t('gifts.settings.bonus')" width="140"><template #default="{ row }"><el-input-number v-model="row.bonus" size="small" :min="0" :disabled="!writable" controls-position="right" /></template></el-table-column>
        <el-table-column v-for="p in platforms" :key="p" :label="t('gifts.settings.' + p)" width="150">
          <template #default="{ row }"><el-input-number v-model="row.price[p]" size="small" :min="0" :precision="2" :step="1" :disabled="!writable" controls-position="right" /></template>
        </el-table-column>
        <el-table-column :label="t('gifts.settings.rate')" min-width="120">
          <template #default="{ row }"><span class="muted num">{{ row.price.web ? number((row.beans + (row.bonus || 0)) / row.price.web, 2) : '—' }} / RM</span></template>
        </el-table-column>
        <el-table-column width="70">
          <template #default="{ $index }"><el-button v-if="writable" link type="danger" @click="packs.splice($index, 1)">{{ t('common.delete') }}</el-button></template>
        </el-table-column>
      </el-table>
      <div v-if="writable" class="actions">
        <el-button @click="add">{{ t('gifts.settings.addPack') }}</el-button>
        <el-button type="primary" :loading="saving" @click="savePacks">{{ t('gifts.settings.save') }}</el-button>
      </div>
    </div>
    <div class="panel">
      <h3 class="panel-title">{{ t('gifts.settings.other') }}</h3>
      <AreaSettings :keys="['beans.rate', 'beans.exchangeEnabled', 'gifts.quantities', 'gifts.noteMax', 'gifts.confirmFrom', 'gifts.stickerMax', 'gifts.buyMax']" perm="gifts.edit" />
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { can } from '../../core/auth';
import { number } from '../../core/format';
import AreaSettings from './AreaSettings.vue';

const platforms = ['web', 'android', 'ios'];
const writable = computed(() => can('gifts.edit'));
const packs = ref([]);
const loading = ref(false);
const saving = ref(false);
async function load() {
  loading.value = true;
  try {
    const res = await api.get('gl-config', { keys: 'beans.packs' });
    packs.value = (res['beans.packs']?.value || []).map(p => ({ id: p.id, beans: p.beans, bonus: p.bonus || 0, price: { web: 0, android: 0, ios: 0, ...(p.price || {}) } }));
  } finally {
    loading.value = false;
  }
}
load();
function add() {
  const last = packs.value[packs.value.length - 1];
  const beans = last ? last.beans * 2 : 100;
  packs.value.push({ id: 'b' + beans, beans, bonus: 0, price: { web: beans / 10, android: beans / 10, ios: beans / 10 } });
}
async function savePacks() {
  saving.value = true;
  try {
    await api.put('gl-config', { 'beans.packs': packs.value });
    ElMessage.success(t('common.saved'));
    load();
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
</style>
