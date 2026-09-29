<template>
  <div class="page">
    <div class="page-head"><h1>{{ t('mc.applications') }}</h1></div>
    <div class="panel">
      <el-radio-group v-model="list.filters.status" class="status-tabs" @change="list.search">
        <el-radio-button value="">{{ t('common.all') }}</el-radio-button>
        <el-radio-button v-for="s in ['received', 'processing', 'resolved', 'rejected']" :key="s" :value="s">{{ t('mc.appStatus.' + s) }}</el-radio-button>
      </el-radio-group>
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('mc.appQ')" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
      </div>
      <el-table v-loading="list.loading.value" :data="list.items.value" stripe>
        <el-table-column :label="t('mc.name')" min-width="200">
          <template #default="{ row }"><b>{{ row.data.name }}</b><div class="muted small">{{ catName(row.data.category) }} · {{ row.data.city }}</div></template>
        </el-table-column>
        <el-table-column :label="t('mc.contact')" width="160"><template #default="{ row }">{{ row.data.contact }}<div class="muted small num">{{ row.data.phone }}</div></template></el-table-column>
        <el-table-column :label="t('mc.applicant')" width="170">
          <template #default="{ row }"><UserCell :id="row.user.id" :name="row.user.name" :avatar="row.user.avatar" :display-id="row.user.displayId" /></template>
        </el-table-column>
        <el-table-column :label="t('mc.about')" min-width="220"><template #default="{ row }"><span class="clamp">{{ row.data.text || row.details }}</span></template></el-table-column>
        <el-table-column :label="t('common.createdAt')" width="140"><template #default="{ row }"><span class="num small">{{ dateTime(row.createdAt) }}</span></template></el-table-column>
        <el-table-column :label="t('common.status')" width="120">
          <template #default="{ row }">
            <el-tag size="small" :type="ticketType(row.status)">{{ t('mc.appStatus.' + row.status) }}</el-tag>
            <div v-if="row.reply" class="muted small clamp">{{ row.reply }}</div>
          </template>
        </el-table-column>
        <el-table-column :label="t('common.actions')" width="180" fixed="right">
          <template #default="{ row }">
            <template v-if="['received', 'processing'].includes(row.status)">
              <el-button v-can="'merchants.audit'" link type="success" @click="openApprove(row)">{{ t('mc.approve') }}</el-button>
              <el-button v-can="'merchants.audit'" link type="danger" @click="reject(row)">{{ t('mc.reject') }}</el-button>
              <el-button v-if="row.status === 'received'" v-can="'merchants.audit'" link @click="processing(row)">{{ t('mc.markProcessing') }}</el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>
      <Pager :list="list" />
    </div>

    <el-dialog v-model="approveOpen" :title="t('mc.approveTitle')" width="560px">
      <el-form label-width="120px">
        <el-form-item :label="t('mc.name')" required><div class="two"><el-input v-model="ap.name" maxlength="80" /><el-input v-model="ap.nameEn" maxlength="120" placeholder="English" /></div></el-form-item>
        <el-form-item :label="t('cm.category')">
          <el-select v-model="ap.category"><el-option v-for="c in meta.categories.filter(c => c.id !== 'all')" :key="c.id" :value="c.id" :label="catName(c.id)" /></el-select>
        </el-form-item>
        <el-form-item v-if="!scope.isAgent" :label="t('mc.agent')"><AgentSelect v-model="ap.agentId" /></el-form-item>
        <el-form-item v-if="!scope.isAgent" :label="t('mc.rate')">
          <el-input-number v-model="ap.commissionRate" :min="0" :max="1" :step="0.01" :precision="4" controls-position="right" />
          <small class="muted" style="margin-left: 8px">{{ t('mc.rateHint', { rate: percent(meta.defaultCommission ?? 0.1) }) }}</small>
        </el-form-item>
        <el-divider>{{ t('mc.loginOptional') }}</el-divider>
        <el-form-item :label="t('mc.username')"><el-input v-model="ap.username" maxlength="40" autocomplete="off" /></el-form-item>
        <el-form-item :label="t('mc.password')"><el-input v-model="ap.password" type="password" show-password autocomplete="new-password" /></el-form-item>
        <el-form-item :label="t('mc.replyToApplicant')"><el-input v-model="ap.reply" type="textarea" :rows="2" maxlength="1000" :placeholder="t('mc.approveReplyHint')" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="approveOpen = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="busy" :disabled="!ap.name" @click="approve">{{ t('mc.approve') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useList } from '../../core/list';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { scope } from '../../core/auth';
import { dateTime, percent } from '../../core/format';
import Pager from '../../components/Pager.vue';
import UserCell from '../../components/UserCell.vue';
import AgentSelect from '../../components/AgentSelect.vue';
import { meta, loadMeta, catName, ticketType } from '../orders/common';

const router = useRouter();
const list = useList('merchants/applications', { q: '', status: '' });
const approveOpen = ref(false);
const busy = ref(false);
const current = ref(null);
const ap = reactive({ name: '', nameEn: '', category: '', agentId: null, commissionRate: null, username: '', password: '', reply: '' });

function openApprove(row) {
  current.value = row;
  Object.assign(ap, { name: row.data.name, nameEn: '', category: row.data.category, agentId: null, commissionRate: null, username: '', password: '', reply: '' });
  approveOpen.value = true;
}
async function approve() {
  busy.value = true;
  try {
    const res = await api.post(`merchants/applications/${current.value.id}/approve`, ap);
    ElMessage.success(t('mc.approved'));
    approveOpen.value = false;
    list.load();
    router.push('/merchants/' + res.merchantId);
  } finally {
    busy.value = false;
  }
}
async function reject(row) {
  const { value } = await ElMessageBox.prompt(t('mc.rejectHint'), t('mc.reject'), { inputType: 'textarea', inputValidator: v => !!v?.trim() || t('common.required') });
  await api.post(`merchants/applications/${row.id}/reject`, { text: value });
  ElMessage.success(t('common.done'));
  list.load();
}
async function processing(row) {
  await api.post(`merchants/applications/${row.id}/processing`, {});
  list.load();
}
loadMeta();
</script>

<style scoped>
.status-tabs { margin-bottom: 12px; }
.small { font-size: 12px; }
.clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; }
</style>
