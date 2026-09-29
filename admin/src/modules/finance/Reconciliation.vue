<template>
  <div class="page" v-loading="loading">
    <div class="page-head">
      <h1>{{ pick($route.meta.title, 'zh') }}</h1>
      <div class="spacer" />
      <el-select v-model="currency" style="width: 140px" @change="load">
        <el-option value="" :label="t('common.all')" /><el-option value="RM" :label="t('fin.rm')" /><el-option value="BEAN" :label="t('fin.bean')" /><el-option value="INCOME" :label="t('fin.income')" />
      </el-select>
      <el-date-picker v-model="range" type="daterange" :start-placeholder="t('common.from')" :end-placeholder="t('common.to')" @change="load" />
      <el-button v-can="'finance.export'" :icon="IconDownload" @click="exportCsv">{{ t('common.export') }}</el-button>
    </div>
    <div class="panel">
      <h3 class="panel-title">{{ t('fin.held') }}</h3>
      <div class="grid-cards">
        <StatCard :label="t('fin.balance')" :value="data.held?.balance ?? 0" unit="RM" />
        <StatCard :label="t('fin.frozen')" :value="data.held?.frozen ?? 0" unit="RM" />
        <StatCard :label="t('fin.incomeHeld')" :value="data.held?.income ?? 0" unit="RM" />
        <StatCard :label="t('fin.incomePending')" :value="data.held?.incomePending ?? 0" unit="RM" />
        <StatCard :label="t('fin.beans')" :value="data.held?.beans ?? 0" />
      </div>
    </div>
    <div class="panel">
      <h3 class="panel-title">{{ t('fin.byKind') }}</h3>
      <el-table :data="data.byKind || []" size="small" show-summary :summary-method="summary">
        <el-table-column prop="currency" :label="t('fin.currency')" width="90" />
        <el-table-column :label="t('fin.kind')"><template #default="{ row }">{{ kindLabel(row.kind) }}</template></el-table-column>
        <el-table-column prop="count" :label="t('fin.count')" width="90" align="right" />
        <el-table-column :label="t('fin.in')" align="right"><template #default="{ row }"><span class="num pos">{{ fmt(row, row.in) }}</span></template></el-table-column>
        <el-table-column :label="t('fin.out')" align="right"><template #default="{ row }"><span class="num neg">{{ fmt(row, row.out) }}</span></template></el-table-column>
      </el-table>
    </div>
    <div class="panel">
      <h3 class="panel-title">{{ t('fin.daily') }}</h3>
      <el-table :data="data.rows || []" size="small" max-height="520">
        <el-table-column prop="day" :label="t('fin.day')" width="110" />
        <el-table-column prop="currency" :label="t('fin.currency')" width="90" />
        <el-table-column :label="t('fin.kind')"><template #default="{ row }">{{ kindLabel(row.kind) }}</template></el-table-column>
        <el-table-column prop="count" :label="t('fin.count')" width="80" align="right" />
        <el-table-column :label="t('fin.in')" align="right"><template #default="{ row }"><span class="num">{{ fmt(row, row.in) }}</span></template></el-table-column>
        <el-table-column :label="t('fin.out')" align="right"><template #default="{ row }"><span class="num">{{ fmt(row, row.out) }}</span></template></el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { Download as IconDownload } from '@element-plus/icons-vue';
import { api } from '../../core/api';
import { t, pick } from '../../core/i18n';
import { money, number } from '../../core/format';
import StatCard from '../../components/StatCard.vue';

const currency = ref('RM');
const range = ref(null);
const loading = ref(false);
const data = ref({});
const kindLabel = k => (t('fin.kinds.' + k) === 'fin.kinds.' + k ? k : t('fin.kinds.' + k));
const fmt = (row, v) => (row.currency === 'BEAN' ? number(v) : money(v, ''));
function query() {
  const q = { currency: currency.value };
  if (range.value?.[0]) q.from = +new Date(range.value[0]);
  if (range.value?.[1]) q.to = +new Date(range.value[1]) + 86400000;
  return q;
}
async function load() {
  loading.value = true;
  try {
    data.value = await api.get('finance/reconciliation', query());
  } finally {
    loading.value = false;
  }
}
function summary({ data: rows }) {
  if (!currency.value) return ['', t('common.total', { n: rows.length })];
  const sum = k => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
  const f = v => (currency.value === 'BEAN' ? number(v) : money(v, ''));
  return [currency.value, '', String(sum('count')), f(sum('in')), f(sum('out'))];
}
const exportCsv = () => api.download('finance/reconciliation/export', query(), 'reconciliation.csv');
load();
</script>
