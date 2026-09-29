<template>
  <div class="page" v-loading="loading">
    <el-alert v-if="!session.me?.merchantId" type="warning" :closable="false" :title="t('cm.noMerchant')" show-icon />
    <template v-else>
      <div class="page-head">
        <h1>{{ t('shop.stats') }}</h1>
        <div class="spacer" />
        <el-radio-group v-model="days" size="small" @change="load">
          <el-radio-button :value="7">{{ t('common.last7') }}</el-radio-button>
          <el-radio-button :value="30">{{ t('common.last30') }}</el-radio-button>
          <el-radio-button :value="90">{{ t('common.last90') }}</el-radio-button>
        </el-radio-group>
      </div>
      <div class="grid-cards">
        <StatCard :label="t('shop.ordersToday')" :value="c.ordersToday" link="/shop/orders" />
        <StatCard :label="t('shop.gmvToday')" :value="c.gmvToday" unit="RM" />
        <StatCard :label="t('shop.pending')" :value="c.pending" link="/shop/orders?status=pending" />
        <StatCard :label="t('shop.inProgress')" :value="c.inProgress" />
        <StatCard :label="t('shop.gmvN', { n: days })" :value="c.gmv" unit="RM" />
        <StatCard :label="t('shop.ordersN', { n: days })" :value="c.orders" />
        <StatCard :label="t('shop.tickets')" :value="c.tickets" link="/shop/aftersales" />
        <StatCard :label="t('shop.rating')" :value="c.rating ?? '—'" :unit="c.reviews ? '(' + c.reviews + ')' : ''" />
      </div>
      <div class="charts">
        <div v-for="s in data.series" :key="s.key" class="panel">
          <h3 class="panel-title">{{ pick(s) }}<small v-if="s.unit" class="muted">（{{ s.unit }}）</small></h3>
          <LineChart :series="[{ name: pick(s), points: s.points, type: s.unit === 'RM' ? 'bar' : 'line' }]" :height="220" />
        </div>
      </div>
      <div class="panel">
        <h3 class="panel-title">{{ t('shop.top') }}</h3>
        <el-table :data="data.top || []" size="small">
          <el-table-column :label="t('cat.service')" prop="title" min-width="220" />
          <el-table-column :label="t('cm.qty')" prop="qty" align="right" width="90" />
          <el-table-column :label="t('shop.amount')" align="right" width="120"><template #default="{ row }"><span class="num">{{ money(row.amount, '') }}</span></template></el-table-column>
        </el-table>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { api } from '../../core/api';
import { t, pick } from '../../core/i18n';
import { session } from '../../core/auth';
import { money } from '../../core/format';
import StatCard from '../../components/StatCard.vue';
import LineChart from '../../components/LineChart.vue';

const days = ref(30);
const loading = ref(false);
const data = ref({});
const c = computed(() => data.value.cards || {});
async function load() {
  if (!session.me?.merchantId) return;
  loading.value = true;
  try {
    data.value = await api.get('shop/stats', { days: days.value });
  } finally {
    loading.value = false;
  }
}
load();
</script>

<style scoped>
.charts { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 16px; margin-bottom: 16px; }
.charts .panel { margin: 0; }
@media (max-width: 768px) { .charts { grid-template-columns: 1fr; } }
</style>
