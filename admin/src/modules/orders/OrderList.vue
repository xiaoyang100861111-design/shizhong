<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ shop ? t('cm.shopOrders') : t('cm.orders') }}</h1>
      <div class="spacer" />
      <el-button v-if="!shop" v-can="'orders.export'" :icon="IconDownload" @click="list.exportCsv('orders/export', 'orders.csv')">{{ t('common.export') }}</el-button>
    </div>
    <div class="panel">
      <el-radio-group v-model="list.filters.status" class="status-tabs" @change="list.search">
        <el-radio-button value="">{{ t('common.all') }}</el-radio-button>
        <el-radio-button v-for="s in statuses" :key="s" :value="s">
          {{ statusLabel(s) }}<span v-if="summary.counts?.[s]" class="count num">{{ summary.counts[s] }}</span>
        </el-radio-button>
      </el-radio-group>
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('cm.orderQ')" clearable @keyup.enter="list.search" @clear="list.search">
          <template #prefix><el-icon><IconSearch /></el-icon></template>
        </el-input>
        <el-select v-model="list.filters.flow" clearable :placeholder="t('cm.flowLabel')" @change="list.search">
          <el-option v-for="f in meta.flows" :key="f" :value="f" :label="flowLabel(f)" />
        </el-select>
        <el-select v-model="list.filters.cat" clearable :placeholder="t('cm.category')" @change="list.search">
          <el-option v-for="c in meta.categories.filter(c => c.id !== 'all')" :key="c.id" :value="c.id" :label="catName(c.id)" />
        </el-select>
        <MerchantSelect v-if="!shop" v-model="list.filters.merchantId" @update:model-value="list.search" />
        <el-select v-model="list.filters.paid" clearable :placeholder="t('cm.paidLabel')" @change="list.search">
          <el-option :value="true" :label="t('cm.paid')" /><el-option :value="false" :label="t('cm.unpaid')" />
        </el-select>
        <el-date-picker v-model="list.filters.range" type="daterange" :start-placeholder="t('common.from')" :end-placeholder="t('common.to')" @change="list.search" />
        <el-checkbox v-model="list.filters.openTickets" @change="list.search">{{ t('cm.withTickets') }}</el-checkbox>
        <el-checkbox v-model="hideDemo" @change="list.search">{{ t('cm.hideDemo') }}</el-checkbox>
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
        <el-button @click="reset">{{ t('common.reset') }}</el-button>
      </div>
      <p v-if="summary.gmv !== undefined" class="muted sum">{{ t('cm.gmvLine', { n: list.total.value, gmv: money(summary.gmv) }) }}</p>
      <el-table v-loading="list.loading.value" :data="list.items.value" stripe @row-click="open" @sort-change="onSort" class="clickable">
        <el-table-column :label="t('cm.orderNo')" min-width="170">
          <template #default="{ row }">
            <span class="num strong">{{ row.orderNo }}</span>
            <el-tag v-if="row.demoSeed" size="small" type="info" effect="plain" style="margin-left: 4px">{{ t('cm.demo') }}</el-tag>
            <div class="muted num small">{{ dateTime(row.createdAt) }}</div>
          </template>
        </el-table-column>
        <el-table-column :label="t('common.user')" min-width="160">
          <template #default="{ row }"><UserCell :id="shop ? null : row.user.id" :name="row.user.name" :avatar="row.user.avatar" :display-id="row.user.displayId" :link="!shop" /></template>
        </el-table-column>
        <el-table-column :label="t('cm.content')" min-width="220">
          <template #default="{ row }">
            <div class="title">{{ row.title }}</div>
            <small class="muted">{{ catName(row.category) }} · {{ flowLabel(row.flow) }}<template v-if="row.quantity > 1"> · ×{{ row.quantity }}</template></small>
          </template>
        </el-table-column>
        <el-table-column v-if="!shop" :label="t('cm.merchant')" min-width="140">
          <template #default="{ row }">
            <router-link v-if="row.merchantId && can('merchants.view')" :to="'/merchants/' + row.merchantId" @click.stop>{{ row.merchantName }}</router-link>
            <span v-else>{{ row.merchantName || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('cm.payable')" prop="payable" sortable="custom" align="right" width="120">
          <template #default="{ row }">
            <span class="num">{{ row.payable ? money(row.payable, '') : t('cm.free') }}</span>
            <div v-if="row.refunded" class="small neg num">-{{ money(row.refunded, '') }}</div>
          </template>
        </el-table-column>
        <el-table-column :label="t('common.status')" width="120">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
            <el-tag v-if="row.openTickets" type="danger" size="small" effect="plain" style="margin-left: 4px">{{ t('cm.ticket') }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('cm.scheduled')" prop="scheduledAt" sortable="custom" width="150">
          <template #default="{ row }"><span class="num">{{ row.scheduledAt ? dateTime(row.scheduledAt) : '—' }}</span></template>
        </el-table-column>
        <el-table-column :label="t('common.actions')" width="90" fixed="right">
          <template #default="{ row }"><el-button link type="primary" @click.stop="open(row)">{{ t('common.detail') }}</el-button></template>
        </el-table-column>
      </el-table>
      <Pager :list="list" />
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Download as IconDownload } from '@element-plus/icons-vue';
import { useList } from '../../core/list';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { can } from '../../core/auth';
import { dateTime, money } from '../../core/format';
import Pager from '../../components/Pager.vue';
import UserCell from '../../components/UserCell.vue';
import MerchantSelect from '../merchants/MerchantSelect.vue';
import { meta, loadMeta, catName, statusType, statusLabel, flowLabel } from './common';

const props = defineProps({ shop: Boolean });
const route = useRoute();
const router = useRouter();
const base = computed(() => (props.shop ? 'shop/orders' : 'orders'));
const statuses = ['pending', 'confirmed', 'serving', 'done', 'cancelled'];
const hideDemo = ref(false);
const initial = { q: '', status: '', flow: '', cat: '', merchantId: null, paid: null, range: [], openTickets: false, sort: '', demo: null };
const list = useList(() => base.value, { ...initial, status: String(route.query.status || ''), q: String(route.query.q || ''), userId: route.query.userId || null }, { auto: false });
const summary = ref({});
watch(hideDemo, v => (list.filters.demo = v ? false : null));

async function loadSummary() {
  if (props.shop) return;
  const q = list.query();
  delete q.page;
  delete q.size;
  delete q.status;
  summary.value = await api.get('orders/summary', q, { quiet: true }).catch(() => ({}));
}
// Status counts follow the other filters (search / reset / first load; paging keeps them).
const origSearch = list.search;
list.search = () => (loadSummary(), origSearch());
function reset() {
  hideDemo.value = false;
  list.reset().then(loadSummary);
}
function onSort({ prop, order }) {
  list.filters.sort = order ? (order === 'descending' ? '-' : '') + prop : '';
  list.search();
}
function open(row) {
  router.push((props.shop ? '/shop/orders/' : '/orders/') + row.id);
}
loadMeta();
list.load();
loadSummary();
</script>

<style scoped>
.status-tabs { margin-bottom: 12px; }
.count { margin-left: 6px; font-size: 12px; opacity: .75; }
.strong { font-weight: 600; }
.small { font-size: 12px; }
.title { font-weight: 500; }
.sum { margin: -4px 0 8px; font-size: 13px; }
.clickable :deep(tbody tr) { cursor: pointer; }
</style>
