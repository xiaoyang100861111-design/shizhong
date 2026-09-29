<template>
  <div v-loading="loading" class="user-risk">
    <dl class="kv">
      <dt>{{ t('risk.user.state') }}</dt>
      <dd class="row">
        <template v-if="data.verified">
          <VerifiedBadge :size="16" :label="data.label" />
          <el-tag size="small" effect="plain" class="vlabel">{{ data.label }}</el-tag>
          <span class="muted small">{{ t('risk.source.' + (data.source || 'manual')) }} · {{ dateTime(data.verifiedAt) }}</span>
          <template v-if="can('risk.verify')">
            <el-button link type="primary" @click="editLabel">{{ t('risk.v.editLabel') }}</el-button>
            <el-button link type="danger" @click="revoke">{{ t('risk.v.revoke') }}</el-button>
          </template>
        </template>
        <template v-else>
          <span class="muted">{{ t('risk.user.notVerified') }}</span>
          <el-button v-can="'risk.verify'" size="small" type="primary" plain @click="grant">{{ t('risk.user.grant') }}</el-button>
        </template>
      </dd>
      <dt>{{ t('risk.user.muted') }}</dt>
      <dd>
        <el-tag v-if="data.mutedUntil && data.mutedUntil > Date.now()" type="warning" size="small">{{ dateTime(data.mutedUntil) }}</el-tag>
        <span v-else class="muted">{{ t('risk.user.notMuted') }}</span>
      </dd>
      <dt>{{ t('risk.user.account') }}</dt>
      <dd class="num">{{ data.account || t('risk.user.noAccount') }}</dd>
      <dt>{{ t('risk.user.attempts') }}</dt>
      <dd class="row">
        <template v-if="data.attemptsLeft === null || data.attemptsLeft === undefined"><span class="muted">{{ t('risk.user.noLock') }}</span></template>
        <template v-else>
          <span class="num" :class="{ neg: data.attemptsLeft === 0 }">{{ data.attemptsLeft }}{{ maxFailures ? ' / ' + maxFailures : '' }}</span>
          <el-tag v-if="data.attemptsLeft === 0" type="danger" size="small">{{ t('risk.user.locked') }}</el-tag>
        </template>
        <el-button v-if="data.account && can('risk.lists')" size="small" :disabled="data.attemptsLeft !== 0 && !(maxFailures && data.attemptsLeft < maxFailures)" @click="unlock">
          {{ t('risk.user.unlock') }}
        </el-button>
      </dd>
    </dl>

    <h4>{{ t('risk.user.last24h') }}</h4>
    <div class="scenes">
      <div v-for="s in SCENES.filter(s => s !== 'login')" :key="s" class="sc">
        <span class="muted">{{ sceneName(s) }}</span><b class="num">{{ data.last24h?.[s] || 0 }}</b>
      </div>
    </div>

    <h4>{{ t('risk.user.recent') }}
      <router-link :to="'/risk/events?userId=' + userId" class="more">{{ t('risk.viewEvents') }} ›</router-link>
    </h4>
    <el-table :data="data.events || []" size="small" max-height="420">
      <el-table-column :label="t('common.time')" width="150"><template #default="{ row }"><span class="num">{{ dateTime(row.at, true) }}</span></template></el-table-column>
      <el-table-column :label="t('risk.ov.scene')" width="100"><template #default="{ row }">{{ sceneName(row.scene) }}</template></el-table-column>
      <el-table-column :label="t('risk.ev.rule')" min-width="170"><template #default="{ row }">{{ ruleLabel(row.scene, row.rule) }}</template></el-table-column>
      <el-table-column :label="t('common.type')" width="100">
        <template #default="{ row }"><el-tag size="small" :type="actionType[row.action]">{{ t('risk.action.' + row.action) }}</el-tag></template>
      </el-table-column>
      <el-table-column label="IP" prop="ip" width="130" />
      <el-table-column :label="t('risk.ev.detail')" min-width="180"><template #default="{ row }">{{ detailText(row) }}</template></el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { can } from '../../core/auth';
import { dateTime } from '../../core/format';
import VerifiedBadge from '../../components/VerifiedBadge.vue';
import { SCENES, actionType, detailText, loadPolicy, policy, ruleLabel, sceneName } from './common';

const props = defineProps({ userId: [Number, String], user: Object });
const data = ref({});
const loading = ref(false);
const maxFailures = computed(() => policy.data?.active?.login?.maxFailures || 0);
async function load() {
  loading.value = true;
  try {
    data.value = await api.get(`users/${props.userId}/risk`);
  } finally {
    loading.value = false;
  }
}
load();
loadPolicy().catch(() => {});

async function setVerified(verified, label) {
  await api.post(`users/${props.userId}/verified`, { verified, label: label ?? null });
  ElMessage.success(t('common.done'));
  load();
}
async function grant() {
  const cfg = await api.get('risk/config', { groups: 'verified' }, { quiet: true }).catch(() => null);
  const def = cfg?.groups?.[0]?.items?.find(i => i.key === 'verified.defaultLabel')?.value || '';
  const { value } = await ElMessageBox.prompt(t('risk.v.label'), t('risk.user.grant'), { inputPlaceholder: t('risk.v.labelPlaceholder', { label: def }), inputPattern: /^.{0,40}$/ });
  await setVerified(true, value?.trim() || null);
}
async function editLabel() {
  const { value } = await ElMessageBox.prompt(t('risk.v.label'), t('risk.v.editLabel'), { inputValue: data.value.label, inputPattern: /^.{1,40}$/, inputErrorMessage: t('common.required') });
  await setVerified(true, value.trim());
}
async function revoke() {
  await ElMessageBox.confirm(t('risk.v.confirmRevoke', { name: props.user?.name || '' }), { type: 'warning' });
  await setVerified(false);
}
async function unlock() {
  const res = await api.post('risk/unlock', { account: data.value.account });
  ElMessage.success(t('risk.lists.unlockDone', { n: res.changed }));
  load();
}
</script>

<style scoped>
.kv { margin: 0 0 16px; }
.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.small { font-size: 12px; }
.vlabel { color: #1d9bf0; border-color: rgba(29, 155, 240, .35); }
h4 { font-size: 14px; margin: 16px 0 8px; display: flex; align-items: center; gap: 12px; }
.more { font-weight: normal; font-size: 13px; color: var(--el-color-primary); text-decoration: none; }
.scenes { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }
.sc { background: var(--el-fill-color-lighter); border-radius: 8px; padding: 8px 10px; display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
</style>
