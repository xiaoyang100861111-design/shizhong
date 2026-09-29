<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ pick($route.meta.title, 'zh') }}</h1>
      <div class="spacer" />
      <el-button v-can="'finance.commission'" type="primary" :disabled="!selected.length" @click="payOpen = true">{{ t('fin.markPaid') }}（{{ selected.length }}）</el-button>
      <el-button v-can="'finance.export'" :icon="IconDownload" @click="list.exportCsv('finance/commissions/export', 'agent-commissions.csv')">{{ t('common.export') }}</el-button>
    </div>
    <el-alert :type="list.meta.value.enabled ? 'success' : 'info'" :closable="false" show-icon style="margin-bottom: 12px"
      :title="list.meta.value.enabled ? t('fin.commissionOn', { rate: percent(list.meta.value.defaultRate) }) : t('fin.commissionOff')" />
    <div class="grid-cards">
      <StatCard :label="t('fin.unpaid')" :value="list.meta.value.unpaid ?? 0" unit="RM" />
      <StatCard :label="t('fin.paid')" :value="list.meta.value.paid ?? 0" unit="RM" />
    </div>
    <div v-if="(list.meta.value.byAgent || []).length" class="panel">
      <h3 class="panel-title">{{ t('fin.byAgent') }}</h3>
      <el-table :data="list.meta.value.byAgent" size="small">
        <el-table-column :label="t('fin.agent')"><template #default="{ row }">{{ row.agentName }} <small class="muted">{{ row.agentCode }}</small></template></el-table-column>
        <el-table-column :label="t('fin.count')" prop="count" width="90" />
        <el-table-column :label="t('fin.unpaid')" align="right"><template #default="{ row }"><span class="num">{{ money(row.unpaid) }}</span></template></el-table-column>
        <el-table-column :label="t('fin.paid')" align="right"><template #default="{ row }"><span class="num">{{ money(row.paid) }}</span></template></el-table-column>
        <el-table-column width="100"><template #default="{ row }"><el-button link type="primary" @click="filterAgent(row.agentId)">{{ t('common.view') }}</el-button></template></el-table-column>
      </el-table>
    </div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('fin.q') + ' / ' + t('fin.agent')" clearable @keyup.enter="list.search" @clear="list.search" />
        <AgentSelect v-if="can('agents.view')" v-model="list.filters.agentId" @update:model-value="list.search" />
        <el-select v-model="list.filters.status" clearable :placeholder="t('fin.status')" @change="list.search">
          <el-option :value="0" :label="t('fin.unpaid')" /><el-option :value="1" :label="t('fin.paid')" /><el-option :value="2" :label="t('fin.void')" />
        </el-select>
        <el-date-picker v-model="list.filters.range" type="daterange" :start-placeholder="t('common.from')" :end-placeholder="t('common.to')" @change="list.search" />
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
      </div>
      <el-table v-loading="list.loading.value" :data="list.items.value" size="small" stripe @selection-change="rows => (selected = rows.filter(r => r.status === 0))">
        <el-table-column type="selection" width="40" :selectable="row => row.status === 0" />
        <el-table-column :label="t('common.time')" width="140"><template #default="{ row }"><span class="num">{{ dateTime(row.createdAt) }}</span></template></el-table-column>
        <el-table-column :label="t('fin.agent')" min-width="130"><template #default="{ row }">{{ row.agentName }} <small class="muted">{{ row.agentCode }}</small></template></el-table-column>
        <el-table-column :label="t('common.user')" min-width="130"><template #default="{ row }"><router-link :to="'/users/' + row.userId">{{ row.userName }}</router-link> <small class="muted">{{ row.displayId }}</small></template></el-table-column>
        <el-table-column :label="t('fin.source')" width="120"><template #default="{ row }">{{ t('fin.kinds.' + (row.source === 'crypto' ? 'crypto' : 'recharge')) }} #{{ row.sourceId }}</template></el-table-column>
        <el-table-column :label="t('fin.base')" align="right" width="110"><template #default="{ row }"><span class="num">{{ money(row.base, '') }}</span></template></el-table-column>
        <el-table-column :label="t('fin.ratio')" width="80"><template #default="{ row }">{{ percent(row.rate) }}</template></el-table-column>
        <el-table-column :label="t('common.amount')" align="right" width="110"><template #default="{ row }"><b class="num">{{ money(row.amount, '') }}</b></template></el-table-column>
        <el-table-column :label="t('fin.status')" width="170">
          <template #default="{ row }">
            <el-tag :type="['warning', 'success', 'info'][row.status]" size="small">{{ [t('fin.unpaid'), t('fin.paid'), t('fin.void')][row.status] }}</el-tag>
            <div v-if="row.payRef" class="muted small">{{ row.payRef }} <span v-if="row.paidBy">· {{ row.paidBy }}</span></div>
          </template>
        </el-table-column>
        <el-table-column :label="t('common.actions')" width="90">
          <template #default="{ row }"><el-button v-if="row.status === 0" v-can="'finance.commission'" link type="danger" @click="voidRow(row)">{{ t('fin.void') }}</el-button></template>
        </el-table-column>
      </el-table>
      <Pager :list="list" />
    </div>
    <div v-if="can('finance.settings')" class="panel-plain">
      <ConfigForm :groups="['agent']" endpoint="finance/config" perm="finance.settings" @saved="list.load" />
    </div>

    <el-dialog v-model="payOpen" :title="t('fin.payTitle', { n: selected.length })" width="420px">
      <p class="num">{{ money(selected.reduce((a, r) => a + r.amount, 0)) }}</p>
      <el-input v-model="payRef" :placeholder="t('fin.referenceLabel')" maxlength="200" />
      <template #footer>
        <el-button @click="payOpen = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :disabled="!payRef.trim()" @click="doPay">{{ t('common.confirm') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Download as IconDownload } from '@element-plus/icons-vue';
import { api } from '../../core/api';
import { t, pick } from '../../core/i18n';
import { can } from '../../core/auth';
import { dateTime, money, percent } from '../../core/format';
import StatCard from '../../components/StatCard.vue';
import Pager from '../../components/Pager.vue';
import AgentSelect from '../../components/AgentSelect.vue';
import ConfigForm from '../../components/ConfigForm.vue';
import { useFinList } from './finList';

const list = useFinList('finance/commissions', { q: '', agentId: null, status: 0, range: null });
const selected = ref([]);
const payOpen = ref(false);
const payRef = ref('');
function filterAgent(id) {
  list.filters.agentId = id;
  list.search();
}
async function doPay() {
  const r = await api.post('finance/commissions/pay', { ids: selected.value.map(x => x.id), reference: payRef.value });
  ElMessage.success(t('common.done') + ` (${r.count})`);
  payOpen.value = false;
  payRef.value = '';
  list.load();
}
async function voidRow(row) {
  const { value } = await ElMessageBox.prompt(t('fin.reasonLabel'), t('fin.void'), { inputValidator: v => !!v?.trim() });
  await api.post(`finance/commissions/${row.id}/void`, { reason: value });
  ElMessage.success(t('common.done'));
  list.load();
}
</script>

<style scoped>
.small { font-size: 12px; }
</style>
