<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('mk.coupons') }}</h1>
      <div class="spacer" />
      <el-button v-can="'marketing.coupons'" type="primary" :icon="IconPlus" @click="edit()">{{ t('mk.newCoupon') }}</el-button>
    </div>
    <p class="page-sub">{{ t('mk.couponsSub') }}</p>
    <div class="panel">
      <el-table v-loading="loading" :data="rows">
        <el-table-column :label="t('mk.coupon')" min-width="200">
          <template #default="{ row }"><b>{{ row.name }}</b> <span class="muted">{{ row.nameEn }}</span><div class="muted small num">{{ row.code }}</div></template>
        </el-table-column>
        <el-table-column :label="t('mk.rule')" min-width="190">
          <template #default="{ row }">{{ t('mk.ruleText', { amount: money(row.amount), min: row.min ? money(row.min) : t('mk.noMin') }) }}<div class="muted small">{{ row.category ? catName(row.category) : t('mk.allCats') }} · {{ row.days >= 0 ? t('mk.daysN', { n: row.days }) : t('mk.expiredDays', { n: -row.days }) }}</div></template>
        </el-table-column>
        <el-table-column :label="t('mk.limits')" width="140">
          <template #default="{ row }"><small>{{ t('mk.perUser', { n: row.perUserLimit || '∞' }) }}<br />{{ t('mk.total', { n: row.totalLimit || '∞' }) }}</small></template>
        </el-table-column>
        <el-table-column :label="t('mk.signup')" width="90"><template #default="{ row }"><el-tag v-if="row.autoOnSignup" size="small" type="success">{{ t('common.yes') }}</el-tag><span v-else class="muted">—</span></template></el-table-column>
        <el-table-column :label="t('mk.issuedUsed')" align="right" width="110"><template #default="{ row }"><el-button link @click="showIssued(row)">{{ row.issued }} / {{ row.used }}</el-button></template></el-table-column>
        <el-table-column :label="t('common.status')" width="80"><template #default="{ row }"><el-tag size="small" :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? t('common.enabled') : t('common.disabled') }}</el-tag></template></el-table-column>
        <el-table-column :label="t('common.actions')" width="140" fixed="right">
          <template #default="{ row }">
            <el-button v-can="'marketing.coupons'" link type="primary" @click="edit(row)">{{ t('common.edit') }}</el-button>
            <el-button v-if="row.enabled" v-can="'marketing.grant'" link type="primary" @click="openGrant(row)">{{ t('mk.grant') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-if="issuedFor" class="panel">
      <h3 class="panel-title">{{ t('mk.issuedOf', { name: issuedFor.name }) }} <el-button link @click="issuedFor = null">✕</el-button></h3>
      <UserCoupons :template-id="issuedFor.id" />
    </div>

    <el-dialog v-model="open" :title="editing ? t('mk.editCoupon') : t('mk.newCoupon')" width="560px">
      <el-form label-width="130px">
        <el-form-item :label="t('mk.code')" required><el-input v-model="form.code" :disabled="!!editing" maxlength="32" :placeholder="t('mk.codeHint')" /></el-form-item>
        <el-form-item :label="t('common.name')" required><div class="two"><el-input v-model="form.name" maxlength="60" placeholder="中文" /><el-input v-model="form.nameEn" maxlength="80" placeholder="English" /></div></el-form-item>
        <el-form-item :label="t('mk.amount')" required><el-input-number v-model="form.amount" :min="0.01" :max="100000" :precision="2" controls-position="right" /></el-form-item>
        <el-form-item :label="t('mk.min')"><el-input-number v-model="form.min" :min="0" :max="1000000" :precision="2" controls-position="right" /> <small class="muted" style="margin-left: 8px">{{ t('mk.minHint') }}</small></el-form-item>
        <el-form-item :label="t('mk.days')"><el-input-number v-model="form.days" :min="-3650" :max="3650" controls-position="right" /></el-form-item>
        <el-form-item :label="t('cm.category')">
          <el-select v-model="form.category" clearable :placeholder="t('mk.allCats')"><el-option v-for="c in meta.categories.filter(c => c.id !== 'all')" :key="c.id" :value="c.id" :label="catName(c.id)" /></el-select>
        </el-form-item>
        <el-form-item :label="t('mk.perUserLimit')"><el-input-number v-model="form.perUserLimit" :min="0" :max="1000" controls-position="right" /> <small class="muted" style="margin-left: 8px">0 = ∞</small></el-form-item>
        <el-form-item :label="t('mk.totalLimit')"><el-input-number v-model="form.totalLimit" :min="0" controls-position="right" /> <small class="muted" style="margin-left: 8px">0 = ∞</small></el-form-item>
        <el-form-item :label="t('mk.signup')"><el-switch v-model="form.autoOnSignup" /> <small class="muted" style="margin-left: 8px">{{ t('mk.signupHint') }}</small></el-form-item>
        <el-form-item :label="t('common.status')"><el-switch v-model="form.enabled" /></el-form-item>
        <el-form-item :label="t('common.remark')"><el-input v-model="form.note" type="textarea" :rows="2" maxlength="400" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="open = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="busy" :disabled="!form.code || !form.name || !(form.amount > 0)" @click="save">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="grantOpen" :title="t('mk.grantTitle', { name: granting?.name })" width="520px">
      <el-form label-position="top">
        <el-form-item :label="t('mk.target')">
          <el-radio-group v-model="grant.target"><el-radio value="users">{{ t('mk.targetUsers') }}</el-radio><el-radio value="all">{{ t('mk.targetAll') }}</el-radio></el-radio-group>
        </el-form-item>
        <el-form-item v-if="grant.target === 'users'" :label="t('mk.usersLabel')">
          <el-input v-model="grant.users" type="textarea" :rows="5" :placeholder="t('mk.usersHint')" />
        </el-form-item>
        <el-alert v-else type="warning" :closable="false" :title="t('mk.allWarn')" show-icon />
        <el-form-item><el-checkbox v-model="grant.notify">{{ t('mk.notify') }}</el-checkbox></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="grantOpen = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="busy" @click="doGrant">{{ t('mk.grant') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus as IconPlus } from '@element-plus/icons-vue';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { money } from '../../core/format';
import UserCoupons from './UserCoupons.vue';
import { meta, loadMeta, catName } from '../orders/common';

const rows = ref([]);
const loading = ref(false);
const open = ref(false);
const busy = ref(false);
const editing = ref(null);
const issuedFor = ref(null);
const blank = () => ({ code: '', name: '', nameEn: '', amount: 5, min: 0, days: 30, category: null, perUserLimit: 1, totalLimit: 0, autoOnSignup: false, enabled: true, note: '' });
const form = reactive(blank());
const grantOpen = ref(false);
const granting = ref(null);
const grant = reactive({ target: 'users', users: '', notify: true });

async function load() {
  loading.value = true;
  try {
    rows.value = await api.get('marketing/coupons');
  } finally {
    loading.value = false;
  }
}
function edit(row) {
  editing.value = row || null;
  Object.assign(form, blank(), row || {}, row ? { totalLimit: row.totalLimit || 0 } : {});
  open.value = true;
}
async function save() {
  busy.value = true;
  try {
    const body = { ...form, category: form.category || null };
    if (editing.value) await api.put('marketing/coupons/' + editing.value.id, body);
    else await api.post('marketing/coupons', body);
    ElMessage.success(t('common.saved'));
    open.value = false;
    load();
  } finally {
    busy.value = false;
  }
}
function openGrant(row) {
  granting.value = row;
  Object.assign(grant, { target: 'users', users: '', notify: true });
  grantOpen.value = true;
}
async function doGrant() {
  if (grant.target === 'all') await ElMessageBox.confirm(t('mk.allConfirm'), { type: 'warning' });
  busy.value = true;
  try {
    const users = grant.users.split(/[\s,，;；]+/).map(s => s.trim()).filter(Boolean);
    const res = await api.post(`marketing/coupons/${granting.value.id}/grant`, { target: grant.target, users, notify: grant.notify });
    ElMessage.success(t('mk.granted', { granted: res.granted, matched: res.matched }));
    grantOpen.value = false;
    load();
  } finally {
    busy.value = false;
  }
}
function showIssued(row) {
  issuedFor.value = row;
}
loadMeta();
load();
</script>

<style scoped>
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; }
.small { font-size: 12px; }
</style>
