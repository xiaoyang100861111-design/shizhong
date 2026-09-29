<template>
  <div class="page" v-loading="loading">
    <div class="page-head">
      <el-button :icon="IconBack" circle @click="$router.back()" />
      <el-avatar v-if="m" :size="44" :src="assetUrl(m.logo)" shape="square">{{ m.name.slice(0, 1) }}</el-avatar>
      <h1 v-if="m">{{ m.name }} <small class="muted">{{ m.nameEn }}</small></h1>
      <el-tag v-if="m" :type="m.status ? 'info' : 'success'">{{ m.status ? t('common.disabled') : t('common.enabled') }}</el-tag>
      <div class="spacer" />
      <template v-if="m">
        <el-button v-can="'merchants.edit'" @click="editOpen = true">{{ t('common.edit') }}</el-button>
        <el-button v-if="can('merchants.edit') || can('merchants.create')" @click="accountOpen = true">{{ t('mc.addLogin') }}</el-button>
        <el-button v-can="'merchants.settle'" type="primary" @click="generate">{{ t('mc.generate') }}</el-button>
      </template>
    </div>
    <template v-if="m">
      <div class="grid-cards">
        <StatCard :label="t('mc.services')" :value="`${m.onShelf} / ${m.services}`" :link="can('catalog.view') ? '/catalog/services?merchantId=' + m.id : undefined" />
        <StatCard :label="t('mc.orders')" :value="m.orders" :link="can('orders.view') ? '/orders?q=' + encodeURIComponent(m.name) : undefined" />
        <StatCard :label="t('mc.gmv30')" :value="m.gmv30" unit="RM" />
        <StatCard :label="t('mc.unsettled')" :value="unsettled.gross" unit="RM" />
        <StatCard :label="t('mc.unpaid')" :value="m.unpaid" unit="RM" />
      </div>
      <div class="cols">
        <div class="panel">
          <h3 class="panel-title">{{ t('mc.profile') }}</h3>
          <dl class="kv">
            <dt>ID</dt><dd class="num">#{{ m.id }}</dd>
            <dt>{{ t('cm.category') }}</dt><dd>{{ catName(m.category) }}</dd>
            <dt>{{ t('common.city') }}</dt><dd>{{ m.city || '—' }} {{ m.area }}</dd>
            <dt>{{ t('mc.contact') }}</dt><dd>{{ m.contact || '—' }} <span class="num muted">{{ m.phone }}</span></dd>
            <dt>{{ t('mc.agent') }}</dt><dd>{{ m.agentName || '—' }}</dd>
            <dt>{{ t('mc.applicant') }}</dt><dd><router-link v-if="m.userId && can('users.view')" :to="'/users/' + m.userId">{{ m.userName }} ({{ m.userDisplayId }})</router-link><span v-else>{{ m.userName || '—' }}</span></dd>
            <dt>{{ t('mc.rate') }}</dt><dd>{{ percent(m.effectiveRate) }}<small v-if="m.commissionRate == null" class="muted"> ({{ t('common.default') }})</small></dd>
            <dt>{{ t('mc.autoConfirm') }}</dt><dd>{{ m.autoConfirm == null ? t('mc.autoFollow') : m.autoConfirm ? t('mc.autoOn') : t('mc.autoOff') }}</dd>
            <dt>{{ t('mc.about') }}</dt><dd>{{ m.about || '—' }}</dd>
            <dt>{{ t('mc.license') }}</dt><dd><img v-if="m.license" :src="assetUrl(m.license)" class="lic" alt="" /><span v-else>—</span></dd>
            <dt>{{ t('common.remark') }}</dt><dd>{{ m.note || '—' }}</dd>
            <dt>{{ t('common.createdAt') }}</dt><dd class="num">{{ dateTime(m.createdAt) }}</dd>
          </dl>
        </div>
        <div class="panel">
          <h3 class="panel-title">{{ t('mc.logins') }}</h3>
          <el-table :data="accounts" size="small">
            <el-table-column :label="t('mc.username')" prop="username" />
            <el-table-column :label="t('common.name')" prop="name" />
            <el-table-column :label="t('common.status')" width="80"><template #default="{ row }"><el-tag size="small" :type="row.status ? 'info' : 'success'">{{ row.status ? t('common.disabled') : t('common.enabled') }}</el-tag></template></el-table-column>
            <el-table-column :label="t('mc.lastLogin')" width="140"><template #default="{ row }"><span class="num small">{{ dateTime(row.lastLoginAt) }}</span></template></el-table-column>
            <el-table-column v-if="can('merchants.edit')" width="140">
              <template #default="{ row }">
                <el-button link type="primary" @click="resetPwd(row)">{{ t('mc.resetPwd') }}</el-button>
                <el-button link :type="row.status ? 'success' : 'danger'" @click="toggleLogin(row)">{{ row.status ? t('common.enabled') : t('common.disabled') }}</el-button>
              </template>
            </el-table-column>
          </el-table>
          <p class="muted small">{{ t('mc.loginHint') }}</p>
        </div>
      </div>
      <div class="panel">
        <h3 class="panel-title">{{ t('mc.settlements') }} <router-link :to="'/merchants/settlements?merchantId=' + m.id" class="small">{{ t('common.more') }}</router-link></h3>
        <SettlementTable :rows="settlements" @changed="load" />
      </div>
    </template>
    <MerchantEdit v-model="editOpen" :merchant="m" @saved="load" />
    <el-dialog v-model="accountOpen" :title="t('mc.addLogin')" width="420px">
      <el-form label-width="90px">
        <el-form-item :label="t('mc.username')" required><el-input v-model="acc.username" maxlength="40" autocomplete="off" /></el-form-item>
        <el-form-item :label="t('mc.password')" required><el-input v-model="acc.password" type="password" show-password autocomplete="new-password" /></el-form-item>
        <el-form-item :label="t('common.name')"><el-input v-model="acc.name" maxlength="60" /></el-form-item>
        <el-form-item :label="t('common.phone')"><el-input v-model="acc.phone" maxlength="32" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="accountOpen = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :disabled="!acc.username || !acc.password" @click="addLogin">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Back as IconBack } from '@element-plus/icons-vue';
import { api, assetUrl } from '../../core/api';
import { t } from '../../core/i18n';
import { can } from '../../core/auth';
import { dateTime, percent } from '../../core/format';
import StatCard from '../../components/StatCard.vue';
import MerchantEdit from './MerchantEdit.vue';
import SettlementTable from './SettlementTable.vue';
import { loadMeta, catName } from '../orders/common';

const route = useRoute();
const loading = ref(false);
const data = ref({});
const m = computed(() => data.value.merchant);
const accounts = computed(() => data.value.accounts || []);
const settlements = computed(() => data.value.settlements || []);
const unsettled = computed(() => data.value.unsettled || { gross: 0, count: 0 });
const editOpen = ref(false);
const accountOpen = ref(false);
const acc = reactive({ username: '', password: '', name: '', phone: '' });

async function load() {
  loading.value = true;
  try {
    data.value = await api.get('merchants/' + route.params.id);
  } finally {
    loading.value = false;
  }
}
async function addLogin() {
  await api.post(`merchants/${m.value.id}/accounts`, acc);
  ElMessage.success(t('common.saved'));
  Object.assign(acc, { username: '', password: '', name: '', phone: '' });
  accountOpen.value = false;
  load();
}
async function resetPwd(row) {
  const { value } = await ElMessageBox.prompt(t('mc.newPwd'), t('mc.resetPwd'), { inputType: 'password' });
  await api.put(`merchants/${m.value.id}/accounts/${row.id}`, { password: value });
  ElMessage.success(t('common.done'));
}
async function toggleLogin(row) {
  await api.put(`merchants/${m.value.id}/accounts/${row.id}`, { status: row.status ? 0 : 1 });
  load();
}
async function generate() {
  const res = await api.post('merchants/settlements/generate', { merchantId: m.value.id });
  ElMessage.success(t('mc.generated', { n: res.created }));
  load();
}
loadMeta();
load();
</script>

<style scoped>
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.cols .panel { margin-bottom: 16px; }
.small { font-size: 12px; font-weight: normal; }
.lic { max-width: 160px; border-radius: 6px; }
@media (max-width: 900px) { .cols { grid-template-columns: 1fr; } }
</style>
