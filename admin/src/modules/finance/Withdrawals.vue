<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ pick($route.meta.title, 'zh') }}</h1>
      <div class="spacer" />
      <el-button v-can="'finance.export'" :icon="IconDownload" @click="list.exportCsv('finance/withdrawals/export', 'withdrawals.csv')">{{ t('common.export') }}</el-button>
    </div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('fin.q')" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-select v-model="list.filters.status" clearable :placeholder="t('fin.status')" @change="list.search">
          <el-option v-for="s in ['pending', 'paid', 'rejected', 'cancelled']" :key="s" :value="s" :label="t('fin.wd.' + s)" />
        </el-select>
        <el-select v-model="list.filters.source" clearable :placeholder="t('fin.source')" @change="list.search">
          <el-option value="wallet" :label="t('fin.sourceWallet')" /><el-option value="income" :label="t('fin.sourceIncome')" />
        </el-select>
        <el-select v-model="list.filters.kind" clearable :placeholder="t('fin.account')" @change="list.search">
          <el-option value="bank" label="Bank" /><el-option value="ewallet" label="E-wallet" /><el-option value="crypto" label="Crypto" />
        </el-select>
        <el-date-picker v-model="list.filters.range" type="daterange" :start-placeholder="t('common.from')" :end-placeholder="t('common.to')" @change="list.search" />
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
        <el-button @click="list.reset">{{ t('common.reset') }}</el-button>
      </div>
      <p class="muted sums">{{ t('fin.sumAmount') }} <b class="num">{{ money(list.meta.value.sumAmount) }}</b> · {{ t('fin.sumNet') }} <b class="num">{{ money(list.meta.value.sumNet) }}</b> · {{ t('common.total', { n: list.total.value }) }}</p>
      <el-table v-loading="list.loading.value" :data="list.items.value" size="small" stripe>
        <el-table-column :label="t('common.time')" width="140"><template #default="{ row }"><span class="num">{{ dateTime(row.createdAt) }}</span></template></el-table-column>
        <el-table-column :label="t('common.user')" min-width="170">
          <template #default="{ row }">
            <UserCell :id="row.user.id" :name="row.user.name" :avatar="row.user.avatar" :display-id="row.user.displayId" :size="28" />
            <small class="muted num">{{ t('fin.memberBalance', { b: money(row.balance), i: money(row.income) }) }}</small>
          </template>
        </el-table-column>
        <el-table-column :label="t('fin.source')" width="70"><template #default="{ row }">{{ row.source === 'income' ? t('fin.sourceIncome') : t('fin.sourceWallet') }}</template></el-table-column>
        <el-table-column :label="t('common.amount')" align="right" width="150">
          <template #default="{ row }"><b class="num">{{ money(row.amount) }}</b><small class="muted num block">{{ t('fin.fee') }} {{ money(row.fee, '') }} · {{ t('fin.net') }} {{ money(row.net, '') }}</small></template>
        </el-table-column>
        <el-table-column :label="t('fin.account')" min-width="230">
          <template #default="{ row }">
            <div><el-tag size="small" effect="plain">{{ row.account?.kind }}</el-tag> {{ row.account?.provider }}</div>
            <div class="mono">{{ row.account?.accountNo }} <el-button link size="small" @click="copy(row.account?.accountNo)">{{ t('common.copy') }}</el-button></div>
            <small class="muted">{{ row.account?.accountName }}</small>
          </template>
        </el-table-column>
        <el-table-column :label="t('fin.status')" width="160">
          <template #default="{ row }">
            <el-tag :type="{ pending: 'warning', paid: 'success', rejected: 'danger' }[row.status] || 'info'" size="small">{{ t('fin.wd.' + row.status) }}</el-tag>
            <div v-if="row.payRef" class="mono small">{{ row.payRef }}</div>
            <div v-if="row.reason" class="muted small">{{ row.reason }}</div>
            <small v-if="row.reviewer" class="muted">{{ row.reviewer }} · {{ dateTime(row.reviewedAt) }}</small>
          </template>
        </el-table-column>
        <el-table-column :label="t('common.actions')" width="170" fixed="right">
          <template #default="{ row }">
            <template v-if="row.status === 'pending'">
              <el-button v-can="'finance.withdrawals'" link type="success" @click="openApprove(row)">{{ t('fin.approve') }}</el-button>
              <el-button v-can="'finance.withdrawals'" link type="danger" @click="openReject(row)">{{ t('fin.reject') }}</el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>
      <Pager :list="list" />
    </div>

    <el-dialog v-model="approveOpen" :title="t('fin.approveTitle')" width="460px">
      <dl v-if="current" class="kv">
        <dt>{{ t('common.user') }}</dt><dd>{{ current.user.name }} ({{ current.user.displayId }})</dd>
        <dt>{{ t('fin.net') }}</dt><dd><b class="num">{{ money(current.net) }}</b></dd>
        <dt>{{ t('fin.account') }}</dt><dd>{{ current.account?.provider }} · <span class="mono">{{ current.account?.accountNo }}</span> · {{ current.account?.accountName }}</dd>
      </dl>
      <el-form label-position="top" style="margin-top: 12px">
        <el-form-item :label="t('fin.referenceLabel')" required><el-input v-model="form.reference" maxlength="200" /></el-form-item>
        <el-form-item :label="t('fin.note')"><el-input v-model="form.note" maxlength="400" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="approveOpen = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="busy" :disabled="!form.reference.trim()" @click="doApprove">{{ t('common.confirm') }}</el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="rejectOpen" :title="t('fin.rejectTitle')" width="440px">
      <el-input v-model="form.reason" type="textarea" :rows="3" maxlength="400" show-word-limit :placeholder="t('fin.reasonLabel')" />
      <template #footer>
        <el-button @click="rejectOpen = false">{{ t('common.cancel') }}</el-button>
        <el-button type="danger" :loading="busy" :disabled="!form.reason.trim()" @click="doReject">{{ t('common.confirm') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Download as IconDownload } from '@element-plus/icons-vue';
import { api } from '../../core/api';
import { t, pick } from '../../core/i18n';
import { dateTime, money } from '../../core/format';
import UserCell from '../../components/UserCell.vue';
import Pager from '../../components/Pager.vue';
import { useFinList } from './finList';

const route = useRoute();
const list = useFinList('finance/withdrawals', { q: '', status: route.query.status ?? 'pending', source: route.query.source || '', kind: '', range: null });
const busy = ref(false);
const current = ref(null);
const form = reactive({ reference: '', note: '', reason: '' });
const approveOpen = ref(false);
const rejectOpen = ref(false);
function openApprove(row) {
  current.value = row;
  Object.assign(form, { reference: '', note: '', reason: '' });
  approveOpen.value = true;
}
function openReject(row) {
  current.value = row;
  Object.assign(form, { reference: '', note: '', reason: '' });
  rejectOpen.value = true;
}
async function run(path, body, close) {
  busy.value = true;
  try {
    await api.post(path, body);
    ElMessage.success(t('common.done'));
    close.value = false;
    list.load();
  } finally {
    busy.value = false;
  }
}
const doApprove = () => run(`finance/withdrawals/${current.value.id}/approve`, { reference: form.reference, note: form.note }, approveOpen);
const doReject = () => run(`finance/withdrawals/${current.value.id}/reject`, { reason: form.reason }, rejectOpen);
async function copy(v) {
  await navigator.clipboard?.writeText(v || '').catch(() => {});
  ElMessage.success(t('common.copied'));
}
</script>

<style scoped>
.sums { margin: 0 0 8px; font-size: 13px; }
.block { display: block; }
.small { font-size: 12px; }
.mono { font-family: var(--font-mono); font-size: 12px; word-break: break-all; }
</style>
