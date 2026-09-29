<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ pick($route.meta.title, 'zh') }}</h1>
      <div class="spacer" />
      <el-button v-can="'finance.export'" :icon="IconDownload" @click="list.exportCsv('finance/topups/export', 'offline-topups.csv')">{{ t('common.export') }}</el-button>
    </div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('fin.q')" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-select v-model="list.filters.status" clearable :placeholder="t('fin.status')" @change="list.search">
          <el-option v-for="s in ['pending', 'credited', 'rejected', 'cancelled']" :key="s" :value="s" :label="t('fin.tp.' + s)" />
        </el-select>
        <el-date-picker v-model="list.filters.range" type="daterange" :start-placeholder="t('common.from')" :end-placeholder="t('common.to')" @change="list.search" />
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
        <el-button @click="list.reset">{{ t('common.reset') }}</el-button>
      </div>
      <el-table v-loading="list.loading.value" :data="list.items.value" size="small" stripe>
        <el-table-column :label="t('common.time')" width="140"><template #default="{ row }"><span class="num">{{ dateTime(row.createdAt) }}</span></template></el-table-column>
        <el-table-column :label="t('common.user')" min-width="170"><template #default="{ row }"><UserCell :id="row.user.id" :name="row.user.name" :avatar="row.user.avatar" :display-id="row.user.displayId" :size="28" /></template></el-table-column>
        <el-table-column :label="t('common.amount')" align="right" width="120"><template #default="{ row }"><b class="num">{{ money(row.amount) }}</b><small v-if="row.credit != null && row.credit !== row.amount" class="muted block num">→ {{ money(row.credit) }}</small></template></el-table-column>
        <el-table-column :label="t('fin.reference')" min-width="150"><template #default="{ row }"><span class="mono">{{ row.reference || '—' }}</span><div v-if="row.note" class="muted small">{{ row.note }}</div></template></el-table-column>
        <el-table-column :label="t('fin.receipt')" width="90">
          <template #default="{ row }">
            <el-image v-if="row.receipt" :src="assetUrl(row.receipt)" :preview-src-list="[assetUrl(row.receipt)]" fit="cover" class="thumb" preview-teleported />
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('fin.status')" width="170">
          <template #default="{ row }">
            <el-tag :type="{ pending: 'warning', credited: 'success', rejected: 'danger' }[row.status] || 'info'" size="small">{{ t('fin.tp.' + row.status) }}</el-tag>
            <div v-if="row.reason" class="muted small">{{ row.reason }}</div>
            <small v-if="row.reviewer" class="muted">{{ row.reviewer }} · {{ dateTime(row.reviewedAt) }}</small>
          </template>
        </el-table-column>
        <el-table-column :label="t('common.actions')" width="150" fixed="right">
          <template #default="{ row }">
            <template v-if="row.status === 'pending'">
              <el-button v-can="'finance.review'" link type="success" @click="openApprove(row)">{{ t('fin.approveTopup') }}</el-button>
              <el-button v-can="'finance.review'" link type="danger" @click="openReject(row)">{{ t('fin.reject') }}</el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>
      <Pager :list="list" />
    </div>

    <el-dialog v-model="approveOpen" :title="t('fin.approveTopupTitle')" width="420px">
      <el-form label-position="top">
        <el-form-item :label="t('fin.creditAmount')" required><el-input-number v-model="form.amount" :min="0.01" :precision="2" style="width: 100%" /></el-form-item>
        <el-form-item :label="t('fin.note')"><el-input v-model="form.note" maxlength="400" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="approveOpen = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="busy" :disabled="!form.amount" @click="doApprove">{{ t('common.confirm') }}</el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="rejectOpen" :title="t('fin.rejectTopupTitle')" width="420px">
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
import { ElMessage } from 'element-plus';
import { Download as IconDownload } from '@element-plus/icons-vue';
import { api, assetUrl } from '../../core/api';
import { t, pick } from '../../core/i18n';
import { dateTime, money } from '../../core/format';
import UserCell from '../../components/UserCell.vue';
import Pager from '../../components/Pager.vue';
import { useFinList } from './finList';

const list = useFinList('finance/topups', { q: '', status: 'pending', range: null });
const busy = ref(false);
const current = ref(null);
const form = reactive({ amount: 0, note: '', reason: '' });
const approveOpen = ref(false);
const rejectOpen = ref(false);
function openApprove(row) {
  current.value = row;
  Object.assign(form, { amount: row.amount, note: '', reason: '' });
  approveOpen.value = true;
}
function openReject(row) {
  current.value = row;
  Object.assign(form, { amount: 0, note: '', reason: '' });
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
const doApprove = () => run(`finance/topups/${current.value.id}/approve`, { amount: form.amount, note: form.note }, approveOpen);
const doReject = () => run(`finance/topups/${current.value.id}/reject`, { reason: form.reason }, rejectOpen);
</script>

<style scoped>
.block { display: block; }
.small { font-size: 12px; }
.mono { font-family: var(--font-mono); font-size: 12px; word-break: break-all; }
</style>
