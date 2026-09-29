<template>
  <div class="page" v-loading="loading">
    <div class="page-head">
      <el-button :icon="IconBack" circle @click="$router.back()" />
      <UserCell v-if="u" :name="u.name" :avatar="u.avatar" :display-id="u.displayId" :size="44" :link="false" />
      <el-tag v-if="u?.status === 1" type="danger">{{ t('users.disabledTag') }}</el-tag>
      <el-tag v-if="u?.mutedUntil && u.mutedUntil > Date.now()" type="warning">{{ t('users.muted', { time: dateTime(u.mutedUntil) }) }}</el-tag>
      <el-tag v-if="u?.online" type="success">{{ t('users.online') }}</el-tag>
      <div class="spacer" />
      <template v-if="u">
        <el-button v-can="'users.balance'" type="primary" @click="adjustOpen = true">{{ t('users.adjust') }}</el-button>
        <el-button v-can="'users.password'" @click="resetPassword">{{ t('users.resetPwd') }}</el-button>
        <el-dropdown v-can="'users.edit'" trigger="click" @command="onCommand">
          <el-button>{{ t('common.more') }}<el-icon class="el-icon--right"><IconArrowDown /></el-icon></el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item :command="u.status === 1 ? 'enable' : 'disable'">{{ u.status === 1 ? t('users.enable') : t('users.disable') }}</el-dropdown-item>
              <el-dropdown-item command="mute24">{{ t('users.mute') }} 24h</el-dropdown-item>
              <el-dropdown-item command="mute168">{{ t('users.mute') }} 7d</el-dropdown-item>
              <el-dropdown-item v-if="u.mutedUntil" command="unmute">{{ t('users.unmute') }}</el-dropdown-item>
              <el-dropdown-item command="logout" divided>{{ t('users.logoutAll') }}</el-dropdown-item>
              <el-dropdown-item v-if="u.kind === 1" command="hide">{{ t('users.hidden') }}: {{ u.hidden ? t('common.yes') : t('common.no') }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </template>
    </div>

    <template v-if="u">
      <div class="grid-cards">
        <StatCard :label="t('users.balance')" :value="u.balance" unit="RM" />
        <StatCard :label="t('users.frozen')" :value="u.frozen" unit="RM" />
        <StatCard :label="t('users.beans')" :value="u.beans" />
        <StatCard :label="t('users.income')" :value="u.income" unit="RM" />
      </div>

      <el-tabs v-model="tab" class="panel">
        <el-tab-pane :label="t('users.profile')" name="profile">
          <dl class="kv">
            <dt>{{ t('common.id') }}</dt><dd class="num">{{ u.id }} · {{ u.publicId }} · {{ u.displayId }}</dd>
            <dt>{{ t('common.phone') }}</dt><dd class="num">{{ u.phone || '—' }}</dd>
            <dt>{{ t('common.email') }}</dt><dd>{{ u.email || '—' }}</dd>
            <dt>{{ t('common.city') }}</dt><dd>{{ u.city || '—' }}</dd>
            <dt>{{ t('users.bio') }}</dt><dd>{{ profile.bio || '—' }}</dd>
            <dt>{{ t('users.gender') }} / {{ t('users.age') }}</dt><dd>{{ profile.gender || '—' }} / {{ profile.age || '—' }}</dd>
            <dt>{{ t('users.occupation') }}</dt><dd>{{ profile.occupation || '—' }}</dd>
            <dt>{{ t('users.language') }}</dt><dd>{{ profile.language || '—' }}</dd>
            <dt>{{ t('users.interests') }}</dt><dd><div class="tag-list"><el-tag v-for="i in profile.interests || []" :key="i" size="small">{{ i }}</el-tag></div></dd>
            <dt>{{ t('users.agent') }}</dt>
            <dd>
              {{ u.agentName ? `${u.agentName} (${u.agentCode})` : t('users.noAgent') }}
              <el-button v-can="'users.agent'" link type="primary" @click="agentOpen = true">{{ t('users.changeAgent') }}</el-button>
            </dd>
            <dt>{{ t('users.inviter') }}</dt>
            <dd>
              <router-link v-if="detail.inviter" :to="'/users/' + detail.inviter.Id">{{ detail.inviter.Name }} ({{ detail.inviter.DisplayId }})</router-link>
              <span v-else>—</span>
              <span class="muted" style="margin-left: 8px">{{ t('users.invited', { n: detail.invitedCount }) }}</span>
            </dd>
            <dt>{{ t('users.platform') }}</dt><dd>{{ u.platform || '—' }} · {{ u.registerMethod || '—' }}</dd>
            <dt>{{ t('users.registerIp') }}</dt><dd class="num">{{ profile.registerIp || '—' }}</dd>
            <dt>{{ t('users.marketing') }}</dt><dd>{{ profile.marketing ? t('common.yes') : t('common.no') }}</dd>
            <dt>{{ t('users.registered') }}</dt><dd class="num">{{ dateTime(u.createdAt, true) }}</dd>
            <dt>{{ t('users.lastLogin') }}</dt><dd class="num">{{ dateTime(u.lastLoginAt, true) }} · {{ t('users.sessions', { n: detail.activeSessions }) }}</dd>
          </dl>
        </el-tab-pane>

        <el-tab-pane :label="t('users.transactions')" name="tx" lazy>
          <div class="filters">
            <el-radio-group v-model="tx.filters.currency" size="small" @change="tx.search">
              <el-radio-button value="">{{ t('common.all') }}</el-radio-button>
              <el-radio-button value="RM">{{ t('users.rm') }}</el-radio-button>
              <el-radio-button value="BEAN">{{ t('users.bean') }}</el-radio-button>
              <el-radio-button value="INCOME">{{ t('users.incomeC') }}</el-radio-button>
            </el-radio-group>
          </div>
          <el-table :data="tx.items.value" v-loading="tx.loading.value" size="small">
            <el-table-column :label="t('common.time')" width="150"><template #default="{ row }"><span class="num">{{ dateTime(row.createdAt, true) }}</span></template></el-table-column>
            <el-table-column :label="t('users.currency')" prop="currency" width="80" />
            <el-table-column :label="t('common.type')" prop="kind" width="110" />
            <el-table-column :label="t('common.name')" min-width="160"><template #default="{ row }">{{ row.title || row.titleKey }}</template></el-table-column>
            <el-table-column :label="t('common.amount')" align="right" width="120">
              <template #default="{ row }"><span class="num" :class="row.amount >= 0 ? 'pos' : 'neg'">{{ row.amount >= 0 ? '+' : '' }}{{ row.currency === 'BEAN' ? number(row.amount) : money(row.amount, '') }}</span></template>
            </el-table-column>
            <el-table-column :label="t('users.balanceAfter')" align="right" width="120">
              <template #default="{ row }"><span class="num">{{ row.currency === 'BEAN' ? number(row.balanceAfter) : money(row.balanceAfter, '') }}</span></template>
            </el-table-column>
            <el-table-column :label="t('users.ref')" width="140"><template #default="{ row }"><span class="muted">{{ row.refType ? row.refType + ':' + row.refId : '' }}</span></template></el-table-column>
            <el-table-column :label="t('users.note')" min-width="140"><template #default="{ row }">{{ row.note }}<small v-if="row.adminName" class="muted"> · {{ row.adminName }}</small></template></el-table-column>
          </el-table>
          <Pager :list="tx" />
        </el-tab-pane>

        <el-tab-pane :label="t('users.logins')" name="logins" lazy>
          <el-table :data="detail.logins" size="small">
            <el-table-column :label="t('common.time')" width="160"><template #default="{ row }"><span class="num">{{ dateTime(row.at, true) }}</span></template></el-table-column>
            <el-table-column :label="t('common.status')" width="90"><template #default="{ row }"><el-tag :type="row.Success ? 'success' : 'danger'" size="small">{{ row.Success ? t('users.success') : t('users.failure') }}</el-tag></template></el-table-column>
            <el-table-column prop="Reason" :label="t('common.reason')" width="120" />
            <el-table-column prop="Ip" label="IP" width="140" />
            <el-table-column prop="Platform" :label="t('users.platform')" width="90" />
            <el-table-column prop="UserAgent" label="UA" min-width="220" show-overflow-tooltip />
          </el-table>
        </el-tab-pane>

        <!-- tabs contributed by other modules (orders, gifts, social…) -->
        <el-tab-pane v-for="x in extraTabs" :key="x.key" :label="pick(x.title, 'zh')" :name="x.key" lazy>
          <component :is="x.component" :user-id="u.id" :user="u" />
        </el-tab-pane>
      </el-tabs>
    </template>

    <el-dialog v-model="adjustOpen" :title="t('users.adjustTitle')" width="440px">
      <el-form label-position="top">
        <el-form-item :label="t('users.currency')">
          <el-radio-group v-model="adj.currency">
            <el-radio-button value="RM">{{ t('users.rm') }}</el-radio-button>
            <el-radio-button value="BEAN">{{ t('users.bean') }}</el-radio-button>
            <el-radio-button value="INCOME">{{ t('users.incomeC') }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="adj.currency === 'RM'" :label="t('users.adjustKind')">
          <el-radio-group v-model="adj.kind">
            <el-radio value="adjust">{{ t('users.kindAdjust') }}</el-radio>
            <el-radio value="recharge">{{ t('users.kindRecharge') }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="t('users.adjustAmount')">
          <el-input-number v-model="adj.amount" :precision="adj.currency === 'BEAN' ? 0 : 2" :step="adj.currency === 'BEAN' ? 100 : 10" style="width: 100%" />
        </el-form-item>
        <el-form-item :label="t('common.reason')" required>
          <el-input v-model="adj.reason" type="textarea" :rows="2" maxlength="400" show-word-limit />
        </el-form-item>
        <el-checkbox v-model="adj.notify">{{ t('users.notifyUser') }}</el-checkbox>
      </el-form>
      <template #footer>
        <el-button @click="adjustOpen = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="busy" :disabled="!adj.amount || !adj.reason.trim()" @click="doAdjust">{{ t('common.confirm') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="agentOpen" :title="t('users.changeAgent')" width="400px">
      <AgentSelect v-model="newAgent" allow-none style="width: 100%" />
      <template #footer>
        <el-button @click="agentOpen = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="saveAgent">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Back as IconBack } from '@element-plus/icons-vue';
import { api } from '../../core/api';
import { t, pick } from '../../core/i18n';
import { can } from '../../core/auth';
import { modules } from '../../core/modules';
import { useList } from '../../core/list';
import { dateTime, money, number } from '../../core/format';
import UserCell from '../../components/UserCell.vue';
import StatCard from '../../components/StatCard.vue';
import Pager from '../../components/Pager.vue';
import AgentSelect from '../../components/AgentSelect.vue';

const route = useRoute();
const id = route.params.id;
const loading = ref(false);
const busy = ref(false);
const detail = ref({});
const u = computed(() => detail.value.user);
const profile = computed(() => detail.value.profile || {});
const tab = ref('profile');
const tx = useList(() => `users/${id}/transactions`, { currency: '' }, { auto: false });
const extraTabs = computed(() => modules.flatMap(m => m.userTabs || []).filter(x => can(x.perm)));

async function load() {
  loading.value = true;
  try {
    detail.value = await api.get('users/' + id);
  } finally {
    loading.value = false;
  }
}
load();
watch(tab, v => v === 'tx' && tx.load(), { immediate: false });

const adjustOpen = ref(false);
const adj = reactive({ currency: 'RM', kind: 'adjust', amount: 0, reason: '', notify: true });
async function doAdjust() {
  busy.value = true;
  try {
    await api.post(`users/${id}/adjust`, { ...adj });
    ElMessage.success(t('common.done'));
    adjustOpen.value = false;
    Object.assign(adj, { amount: 0, reason: '' });
    load();
    if (tab.value === 'tx') tx.load();
  } finally {
    busy.value = false;
  }
}

async function resetPassword() {
  const { value } = await ElMessageBox.prompt(t('users.newPwd'), t('users.resetPwd'), { inputType: 'text', inputPattern: /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/, inputErrorMessage: t('err.auth.passwordWeak') });
  await api.post(`users/${id}/password`, { password: value });
  ElMessage.success(t('common.done'));
}

async function onCommand(cmd) {
  if (cmd === 'disable') await ElMessageBox.confirm(t('users.confirmDisable'), { type: 'warning' });
  const body =
    cmd === 'disable' ? { status: 1 } : cmd === 'enable' ? { status: 0 } : cmd === 'mute24' ? { muteHours: 24 } : cmd === 'mute168' ? { muteHours: 168 } :
    cmd === 'unmute' ? { muteHours: 0 } : cmd === 'hide' ? { hidden: !u.value.hidden } : null;
  if (cmd === 'logout') {
    await api.post(`users/${id}/logout`);
    ElMessage.success(t('users.logoutDone'));
    return;
  }
  if (!body) return;
  await api.patch('users/' + id, body);
  ElMessage.success(t('common.done'));
  load();
}

const agentOpen = ref(false);
const newAgent = ref(null);
async function saveAgent() {
  await api.patch('users/' + id, { agentId: newAgent.value || 0 });
  agentOpen.value = false;
  ElMessage.success(t('common.saved'));
  load();
}
</script>
