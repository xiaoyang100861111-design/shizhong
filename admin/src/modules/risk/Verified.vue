<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('risk.v.title') }}</h1>
      <VerifiedBadge :size="18" />
      <span class="muted hint">{{ t('risk.blueVHint') }}</span>
      <div class="spacer" />
      <el-button v-if="tab === 'accounts'" v-can="'risk.verify'" type="primary" :icon="IconPlus" @click="openAdd">{{ t('risk.v.add') }}</el-button>
      <el-button v-else v-can="'risk.verify'" type="primary" :icon="IconPlus" @click="domainOpen = true">{{ t('risk.v.domainAdd') }}</el-button>
    </div>

    <el-tabs v-model="tab" class="panel">
      <el-tab-pane :label="t('risk.v.accounts')" name="accounts">
        <div class="filters">
          <el-input v-model="list.filters.q" :placeholder="t('risk.v.q')" clearable @keyup.enter="list.search" @clear="list.search">
            <template #prefix><el-icon><IconSearch /></el-icon></template>
          </el-input>
          <el-select v-model="list.filters.source" clearable :placeholder="t('risk.v.source')" @change="list.search">
            <el-option value="manual" :label="t('risk.source.manual')" />
            <el-option value="domain" :label="t('risk.source.domain')" />
          </el-select>
          <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
          <el-button @click="list.reset">{{ t('common.reset') }}</el-button>
        </div>
        <el-table v-loading="list.loading.value" :data="list.items.value" stripe>
          <el-table-column :label="t('common.user')" min-width="200">
            <template #default="{ row }">
              <UserCell :id="row.id" :name="row.name" :avatar="row.avatar" :display-id="row.displayId" verified :verified-label="row.label" />
            </template>
          </el-table-column>
          <el-table-column :label="t('common.phone') + ' / ' + t('common.email')" min-width="190">
            <template #default="{ row }">
              <el-tag v-if="row.kind === 1" size="small" type="info">{{ t('risk.v.kindPersona') }}</el-tag>
              <template v-else><div class="num">{{ row.phone || '—' }}</div><small class="muted">{{ row.email }}</small></template>
            </template>
          </el-table-column>
          <el-table-column :label="t('risk.v.label')" min-width="130">
            <template #default="{ row }"><el-tag size="small" effect="plain" class="vlabel">{{ row.label }}</el-tag></template>
          </el-table-column>
          <el-table-column :label="t('risk.v.source')" width="100">
            <template #default="{ row }"><el-tag size="small" :type="row.source === 'domain' ? 'success' : 'info'" effect="plain">{{ t('risk.source.' + row.source) }}</el-tag></template>
          </el-table-column>
          <el-table-column :label="t('common.city')" prop="city" width="100" />
          <el-table-column :label="t('risk.v.verifiedAt')" width="170">
            <template #default="{ row }"><span class="num">{{ dateTime(row.verifiedAt) }}</span><div class="muted small">{{ row.verifiedBy || '—' }}</div></template>
          </el-table-column>
          <el-table-column v-if="can('risk.verify')" :label="t('common.actions')" width="190" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="editLabel(row)">{{ t('risk.v.editLabel') }}</el-button>
              <el-button link type="danger" @click="revoke(row)">{{ t('risk.v.revoke') }}</el-button>
            </template>
          </el-table-column>
        </el-table>
        <Pager :list="list" />
      </el-tab-pane>

      <el-tab-pane :label="t('risk.v.domains')" name="domains" lazy>
        <p class="muted hint block">{{ t('risk.v.domainHint') }}</p>
        <el-table v-loading="domainsLoading" :data="domains" stripe>
          <el-table-column :label="t('risk.v.domain')" min-width="180"><template #default="{ row }"><b class="num">@{{ row.domain }}</b></template></el-table-column>
          <el-table-column :label="t('risk.v.label')" min-width="130"><template #default="{ row }"><el-tag size="small" effect="plain">{{ row.label }}</el-tag></template></el-table-column>
          <el-table-column :label="t('risk.v.enabled')" width="90">
            <template #default="{ row }"><el-switch v-model="row.enabled" :disabled="!can('risk.verify')" @change="toggle(row)" /></template>
          </el-table-column>
          <el-table-column :label="t('risk.v.users')" width="110" align="right"><template #default="{ row }"><span class="num">{{ row.users }}</span></template></el-table-column>
          <el-table-column :label="t('risk.v.verifiedUsers')" width="100" align="right">
            <template #default="{ row }">
              <el-button v-if="row.verifiedUsers" link type="primary" class="num" @click="showDomain(row)">{{ row.verifiedUsers }}</el-button>
              <span v-else class="num muted">0</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('risk.lists.note')" prop="note" min-width="180" show-overflow-tooltip />
          <el-table-column :label="t('common.createdAt')" width="170">
            <template #default="{ row }"><span class="num">{{ dateTime(row.createdAt) }}</span><div class="muted small">{{ row.createdBy || '—' }}</div></template>
          </el-table-column>
          <el-table-column v-if="can('risk.verify')" :label="t('common.actions')" width="170" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" :disabled="row.users <= row.verifiedUsers" @click="apply(row)">{{ t('risk.v.apply') }}</el-button>
              <el-button link type="danger" @click="askDelete(row)">{{ t('common.delete') }}</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <template v-if="can('risk.verify')">
      <ConfigForm :groups="['verified']" endpoint="risk/config" perm="risk.verify" />
    </template>

    <!-- grant -->
    <el-dialog v-model="addOpen" :title="t('risk.v.addTitle')" width="480px">
      <el-form label-position="top">
        <el-form-item :label="t('common.user')" required>
          <el-select v-model="pickId" filterable remote :remote-method="searchMembers" :loading="searching" :placeholder="t('risk.v.search')" style="width: 100%">
            <el-option v-for="m in found" :key="m.id" :value="m.id" :label="`${m.name} · ${m.displayId}`" :disabled="m.verified">
              <div class="opt">
                <span>{{ m.name }}</span><VerifiedBadge v-if="m.verified" :size="13" />
                <small class="muted num">{{ m.displayId }} · {{ m.phone || m.email || '' }}</small>
                <small v-if="m.verified" class="muted">{{ t('risk.v.granted') }}</small>
              </div>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item :label="t('risk.v.label')">
          <el-input v-model="newLabel" maxlength="40" show-word-limit :placeholder="t('risk.v.labelPlaceholder', { label: defaultLabel })" />
          <div class="presets">
            <el-button v-for="l in labelPresets" :key="l" size="small" plain @click="newLabel = l">{{ l }}</el-button>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addOpen = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="busy" :disabled="!pickId" @click="grant">{{ t('common.confirm') }}</el-button>
      </template>
    </el-dialog>

    <!-- domain add -->
    <el-dialog v-model="domainOpen" :title="t('risk.v.domainTitle')" width="440px">
      <el-form label-position="top">
        <el-form-item :label="t('risk.v.domain')" required><el-input v-model="domainForm.domain" placeholder="example.com.my"><template #prepend>@</template></el-input></el-form-item>
        <el-form-item :label="t('risk.v.label')"><el-input v-model="domainForm.label" maxlength="40" :placeholder="t('risk.v.labelPlaceholder', { label: defaultLabel })" /></el-form-item>
        <el-form-item :label="t('risk.lists.note')"><el-input v-model="domainForm.note" maxlength="200" /></el-form-item>
        <el-checkbox v-model="domainForm.enabled">{{ t('risk.v.enabled') }}</el-checkbox>
      </el-form>
      <template #footer>
        <el-button @click="domainOpen = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="busy" :disabled="!domainForm.domain.trim()" @click="addDomain">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <!-- domain delete -->
    <el-dialog v-model="deleteOpen" :title="t('risk.v.deleteTitle', { domain: deleting?.domain })" width="420px">
      <p>{{ t('common.confirmDelete') }}</p>
      <el-checkbox v-model="alsoRevoke" :disabled="!deleting?.verifiedUsers">{{ t('risk.v.alsoRevoke') }}（{{ deleting?.verifiedUsers || 0 }}）</el-checkbox>
      <template #footer>
        <el-button @click="deleteOpen = false">{{ t('common.cancel') }}</el-button>
        <el-button type="danger" :loading="busy" @click="doDelete">{{ t('common.delete') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus as IconPlus } from '@element-plus/icons-vue';
import { api } from '../../core/api';
import { useList } from '../../core/list';
import { t } from '../../core/i18n';
import { can } from '../../core/auth';
import { dateTime } from '../../core/format';
import Pager from '../../components/Pager.vue';
import UserCell from '../../components/UserCell.vue';
import VerifiedBadge from '../../components/VerifiedBadge.vue';
import ConfigForm from '../../components/ConfigForm.vue';

const tab = ref('accounts');
const list = useList('risk/verified', { q: '', source: '' });

// default label (setting verified.defaultLabel) for placeholders
const defaultLabel = ref('官方认证');
const labelPresets = ['官方认证', '官方账号', '商家认证', '认证主播', '适中员工', '合作伙伴'];
if (can('risk.verify'))
  api.get('risk/config', { groups: 'verified' }, { quiet: true }).then(r => {
    const item = r.groups?.[0]?.items?.find(i => i.key === 'verified.defaultLabel');
    if (item?.value) defaultLabel.value = item.value;
  }).catch(() => {});

// ---------------------------------------------------------------- accounts
const addOpen = ref(false);
const pickId = ref(null);
const newLabel = ref('');
const found = ref([]);
const searching = ref(false);
const busy = ref(false);
function openAdd() {
  pickId.value = null;
  newLabel.value = '';
  found.value = [];
  addOpen.value = true;
}
async function searchMembers(q) {
  if (!q?.trim()) return;
  searching.value = true;
  try {
    const res = await api.get('users', { q: q.trim(), kind: 'all', size: 20 });
    found.value = res.items || [];
  } finally {
    searching.value = false;
  }
}
async function grant() {
  busy.value = true;
  try {
    await api.post(`users/${pickId.value}/verified`, { verified: true, label: newLabel.value.trim() || null });
    ElMessage.success(t('common.done'));
    addOpen.value = false;
    list.search();
  } finally {
    busy.value = false;
  }
}
async function editLabel(row) {
  const { value } = await ElMessageBox.prompt(t('risk.v.label'), t('risk.v.editLabel'), { inputValue: row.label, inputPattern: /^.{1,40}$/, inputErrorMessage: t('common.required') });
  await api.post(`users/${row.id}/verified`, { verified: true, label: value.trim() });
  ElMessage.success(t('common.saved'));
  list.load();
}
async function revoke(row) {
  await ElMessageBox.confirm(t('risk.v.confirmRevoke', { name: row.name }), { type: 'warning' });
  await api.post(`users/${row.id}/verified`, { verified: false });
  ElMessage.success(t('common.done'));
  list.load();
}

// ---------------------------------------------------------------- domains
const domains = ref([]);
const domainsLoading = ref(false);
async function loadDomains() {
  domainsLoading.value = true;
  try {
    domains.value = (await api.get('risk/domains')).items || [];
  } finally {
    domainsLoading.value = false;
  }
}
watch(tab, v => v === 'domains' && loadDomains());

const domainOpen = ref(false);
const domainForm = reactive({ domain: '', label: '', note: '', enabled: true });
async function addDomain() {
  busy.value = true;
  try {
    await api.post('risk/domains', { domain: domainForm.domain.trim(), label: domainForm.label.trim() || null, note: domainForm.note || null, enabled: domainForm.enabled });
    ElMessage.success(t('common.saved'));
    domainOpen.value = false;
    Object.assign(domainForm, { domain: '', label: '', note: '', enabled: true });
    tab.value = 'domains';
    loadDomains();
  } finally {
    busy.value = false;
  }
}
async function toggle(row) {
  try {
    await api.put('risk/domains/' + row.id, { enabled: row.enabled });
    ElMessage.success(t('common.saved'));
  } catch (e) {
    row.enabled = !row.enabled;
  }
}
async function apply(row) {
  await ElMessageBox.confirm(t('risk.v.applyConfirm', { domain: row.domain, label: row.label }), { type: 'info' });
  const res = await api.post(`risk/domains/${row.id}/apply`);
  ElMessage.success(t('risk.v.applied', { n: res.verified }));
  loadDomains();
  list.load();
}
function showDomain(row) {
  list.filters.q = '@' + row.domain;
  list.filters.source = '';
  tab.value = 'accounts';
  list.search();
}
const deleteOpen = ref(false);
const deleting = ref(null);
const alsoRevoke = ref(false);
function askDelete(row) {
  deleting.value = row;
  alsoRevoke.value = false;
  deleteOpen.value = true;
}
async function doDelete() {
  busy.value = true;
  try {
    const res = await api.del(`risk/domains/${deleting.value.id}?revoke=${alsoRevoke.value}`);
    ElMessage.success(t('risk.v.deleted', { n: res.revoked }));
    deleteOpen.value = false;
    loadDomains();
    list.load();
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.hint { font-size: 13px; }
.hint.block { margin: 0 0 12px; line-height: 1.5; }
.small { font-size: 12px; }
.opt { display: flex; align-items: center; gap: 6px; }
.opt small { margin-left: auto; }
.presets { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.presets .el-button { margin: 0; }
.vlabel { color: #1d9bf0; border-color: rgba(29, 155, 240, .35); }
</style>
