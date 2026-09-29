<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ pick($route.meta.title, 'zh') }}</h1>
      <div class="spacer" />
      <el-button v-can="'finance.export'" :icon="IconDownload" @click="list.exportCsv('finance/transactions/export', 'transactions.csv')">{{ t('common.export') }}</el-button>
    </div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('fin.q')" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-select v-model="list.filters.currency" :placeholder="t('fin.currency')" @change="list.search">
          <el-option value="RM" :label="t('fin.rm')" /><el-option value="BEAN" :label="t('fin.bean')" /><el-option value="INCOME" :label="t('fin.income')" />
        </el-select>
        <el-select v-model="list.filters.kind" clearable filterable :placeholder="t('fin.kind')" @change="list.search">
          <el-option v-for="k in kinds" :key="k" :value="k" :label="kindLabel(k)" />
        </el-select>
        <el-select v-model="list.filters.direction" clearable :placeholder="t('fin.direction')" @change="list.search">
          <el-option value="in" :label="t('fin.in')" /><el-option value="out" :label="t('fin.out')" />
        </el-select>
        <AgentSelect v-if="can('agents.view')" v-model="list.filters.agentId" @update:model-value="list.search" />
        <el-date-picker v-model="list.filters.range" type="daterange" :start-placeholder="t('common.from')" :end-placeholder="t('common.to')" @change="list.search" />
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
        <el-button @click="list.reset">{{ t('common.reset') }}</el-button>
      </div>
      <p class="muted sums">
        {{ t('fin.sumIn') }} <b class="num pos">{{ fmt(list.meta.value.sumIn) }}</b> · {{ t('fin.sumOut') }} <b class="num neg">{{ fmt(list.meta.value.sumOut) }}</b>
      </p>
      <el-table v-loading="list.loading.value" :data="list.items.value" size="small" stripe>
        <el-table-column :label="t('common.time')" width="150"><template #default="{ row }"><span class="num">{{ dateTime(row.tx.createdAt, true) }}</span></template></el-table-column>
        <el-table-column :label="t('common.user')" min-width="170"><template #default="{ row }"><UserCell :id="row.user.id" :name="row.user.name" :avatar="row.user.avatar" :display-id="row.user.displayId" :size="28" /></template></el-table-column>
        <el-table-column :label="t('fin.kind')" width="120"><template #default="{ row }">{{ kindLabel(row.tx.kind) }}</template></el-table-column>
        <el-table-column :label="t('fin.title')" min-width="170" show-overflow-tooltip><template #default="{ row }">{{ row.tx.title || row.tx.titleKey }}</template></el-table-column>
        <el-table-column :label="t('common.amount')" align="right" width="120">
          <template #default="{ row }"><span class="num" :class="row.tx.amount >= 0 ? 'pos' : 'neg'">{{ row.tx.amount >= 0 ? '+' : '' }}{{ row.tx.currency === 'BEAN' ? number(row.tx.amount) : money(row.tx.amount, '') }}</span></template>
        </el-table-column>
        <el-table-column :label="t('fin.balanceAfter')" align="right" width="110">
          <template #default="{ row }"><span class="num">{{ row.tx.currency === 'BEAN' ? number(row.tx.balanceAfter) : money(row.tx.balanceAfter, '') }}</span></template>
        </el-table-column>
        <el-table-column :label="t('fin.method')" width="110" prop="tx.method" />
        <el-table-column :label="t('fin.ref')" width="120"><template #default="{ row }"><span class="muted">{{ row.tx.refType ? row.tx.refType + ':' + row.tx.refId : '' }}</span></template></el-table-column>
        <el-table-column :label="t('fin.note')" min-width="140" show-overflow-tooltip><template #default="{ row }">{{ row.tx.note }}<small v-if="row.tx.adminName" class="muted"> · {{ row.tx.adminName }}</small></template></el-table-column>
      </el-table>
      <Pager :list="list" />
    </div>
  </div>
</template>

<script setup>
import { Download as IconDownload } from '@element-plus/icons-vue';
import { t, pick } from '../../core/i18n';
import { can } from '../../core/auth';
import { dateTime, money, number } from '../../core/format';
import UserCell from '../../components/UserCell.vue';
import Pager from '../../components/Pager.vue';
import AgentSelect from '../../components/AgentSelect.vue';
import { useFinList } from './finList';

const kinds = ['recharge', 'crypto', 'withdraw', 'order', 'refund', 'grant', 'adjust', 'checkin', 'task', 'gift', 'live-gift', 'exchange', 'envelope', 'transfer', 'call', 'income'];
const kindLabel = k => (t('fin.kinds.' + k) === 'fin.kinds.' + k ? k : t('fin.kinds.' + k));
const list = useFinList('finance/transactions', { q: '', currency: 'RM', kind: '', direction: '', agentId: null, range: null });
const fmt = v => (list.filters.currency === 'BEAN' ? number(v) : money(v));
</script>

<style scoped>
.sums { margin: 0 0 8px; font-size: 13px; }
</style>
