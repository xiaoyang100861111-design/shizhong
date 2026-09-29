<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('risk.ev.title') }}</h1>
      <el-tag v-if="list.filters.ip" closable @close="clearFilter('ip')">{{ t('risk.ev.filterIp', { ip: list.filters.ip }) }}</el-tag>
      <el-tag v-if="list.filters.userId" closable @close="clearFilter('userId')">{{ t('risk.ev.filterUser', { id: list.filters.userId }) }}</el-tag>
      <div class="spacer" />
      <el-button v-can="'risk.export'" :icon="IconDownload" @click="list.exportCsv('risk/events/export', 'risk-events.csv')">{{ t('common.export') }}</el-button>
    </div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('risk.ev.q')" clearable @keyup.enter="list.search" @clear="list.search">
          <template #prefix><el-icon><IconSearch /></el-icon></template>
        </el-input>
        <el-select v-model="list.filters.scene" clearable :placeholder="t('risk.ov.scene')" @change="list.search">
          <el-option v-for="s in [...SCENES, 'captcha']" :key="s" :value="s" :label="sceneName(s)" />
        </el-select>
        <el-select v-model="list.filters.action" clearable :placeholder="t('common.type')" @change="list.search">
          <el-option v-for="a in ACTIONS" :key="a" :value="a" :label="t('risk.action.' + a)" />
        </el-select>
        <el-select v-model="list.filters.handled" clearable :placeholder="t('common.status')" @change="list.search">
          <el-option :value="false" :label="t('risk.ev.unhandled')" />
          <el-option :value="true" :label="t('risk.ev.handled')" />
        </el-select>
        <el-date-picker v-model="list.filters.range" type="daterange" :start-placeholder="t('common.from')" :end-placeholder="t('common.to')" @change="list.search" />
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
        <el-button @click="reset">{{ t('common.reset') }}</el-button>
      </div>
      <el-table v-loading="list.loading.value" :data="list.items.value" stripe>
        <el-table-column :label="t('common.time')" width="100">
          <template #default="{ row }"><span class="num">{{ dateTime(row.at, true) }}</span></template>
        </el-table-column>
        <el-table-column :label="t('risk.ov.scene')" width="90">
          <template #default="{ row }">{{ sceneName(row.scene) }}</template>
        </el-table-column>
        <el-table-column :label="t('risk.ev.rule')" min-width="170">
          <template #default="{ row }">
            <span>{{ ruleLabel(row.scene, row.rule) }}</span>
            <el-tag v-if="row.level && row.level !== 'light'" size="small" :type="levelType[row.level]" effect="plain" class="ml">{{ levelName(row.level) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('common.type')" width="96">
          <template #default="{ row }">
            <el-tag size="small" :type="actionType[row.action]" :effect="row.action === 'lock' ? 'dark' : 'light'">{{ t('risk.action.' + row.action) }}</el-tag>
            <div class="small" :class="row.handled ? 'pos' : 'muted'">{{ row.handled ? '✓ ' + t('risk.ev.handled') : t('risk.ev.unhandled') }}</div>
          </template>
        </el-table-column>
        <el-table-column :label="t('risk.ev.member')" min-width="170">
          <template #default="{ row }">
            <UserCell v-if="row.userId" :id="row.userId" :name="row.name" :avatar="row.avatar" :display-id="row.displayId" :verified="row.verified === 1"
              :sub="row.account || undefined" :size="28" />
            <span v-else class="num">{{ row.account || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('risk.ev.ip')" width="125">
          <template #default="{ row }">
            <el-button v-if="row.ip" link class="num" @click="filterBy('ip', row.ip)">{{ row.ip }}</el-button>
          </template>
        </el-table-column>
        <el-table-column :label="t('risk.ev.device')" width="130" show-overflow-tooltip>
          <template #default="{ row }"><span class="num small">{{ row.deviceId || '—' }}</span><div class="muted small">{{ row.platform }}</div></template>
        </el-table-column>
        <el-table-column :label="t('risk.ev.detail')" min-width="180">
          <template #default="{ row }">
            <el-tooltip v-if="row.detail && detailText(row) !== row.detail" :content="row.detail" placement="top"><span>{{ detailText(row) }}</span></el-tooltip>
            <span v-else>{{ row.detail || '' }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('common.actions')" width="90" fixed="right">
          <template #default="{ row }">
            <el-dropdown trigger="click" @command="cmd => onCommand(cmd, row)">
              <el-button link type="primary">{{ t('common.more') }}<el-icon class="el-icon--right"><IconArrowDown /></el-icon></el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-if="can('risk.lists')" command="handle" :disabled="row.handled">{{ t('risk.ev.markHandled') }}</el-dropdown-item>
                  <el-dropdown-item v-if="can('risk.lists')" command="ip" :disabled="!row.ip">{{ t('risk.blockIp') }}</el-dropdown-item>
                  <el-dropdown-item v-if="can('risk.lists')" command="device" :disabled="!row.deviceId">{{ t('risk.blockDevice') }}</el-dropdown-item>
                  <el-dropdown-item command="member" :disabled="!row.userId" :divided="can('risk.lists')">{{ t('risk.viewMember') }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </el-table-column>
      </el-table>
      <Pager :list="list" />
    </div>

    <ListEntryDialog v-model="blockOpen" :preset="blockPreset" lock-kind @saved="list.load" />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Download as IconDownload } from '@element-plus/icons-vue';
import { api } from '../../core/api';
import { useList } from '../../core/list';
import { t } from '../../core/i18n';
import { can } from '../../core/auth';
import { dateTime } from '../../core/format';
import Pager from '../../components/Pager.vue';
import UserCell from '../../components/UserCell.vue';
import ListEntryDialog from './ListEntryDialog.vue';
import { ACTIONS, SCENES, actionType, detailText, levelName, levelType, loadPolicy, ruleLabel, sceneName } from './common';

const route = useRoute();
const router = useRouter();
const q = route.query;
const list = useList('risk/events', {
  q: q.q || '', scene: q.scene || '', action: q.action || '', handled: null, range: [], ip: q.ip || '', userId: q.userId || '',
});
loadPolicy().catch(() => {});

function filterBy(key, value) {
  list.filters[key] = value;
  list.search();
}
function clearFilter(key) {
  list.filters[key] = '';
  router.replace({ query: { ...route.query, [key]: undefined } });
  list.search();
}
function reset() {
  router.replace({ query: {} });
  Object.assign(list.filters, { q: '', scene: '', action: '', handled: null, range: [], ip: '', userId: '' });
  list.search();
}

const blockOpen = ref(false);
const blockPreset = ref(null);
async function onCommand(cmd, row) {
  if (cmd === 'handle') {
    await api.post(`risk/events/${row.id}/handle`);
    row.handled = true;
    ElMessage.success(t('common.done'));
  } else if (cmd === 'ip' || cmd === 'device') {
    const note = `${sceneName(row.scene)} · ${ruleLabel(row.scene, row.rule)} · #${row.id}`;
    blockPreset.value = { kind: cmd, value: cmd === 'ip' ? row.ip : row.deviceId, listType: 'block', hours: cmd === 'ip' ? 24 * 7 : 0, note };
    blockOpen.value = true;
  } else if (cmd === 'member' && row.userId) router.push('/users/' + row.userId);
}
</script>

<style scoped>
.ml { margin-left: 4px; }
.small { font-size: 12px; }
</style>
