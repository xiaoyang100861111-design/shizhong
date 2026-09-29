<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('users.title') }}</h1>
      <div class="spacer" />
      <el-button v-can="'users.export'" :icon="IconDownload" @click="list.exportCsv('users/export', 'users.csv')">{{ t('common.export') }}</el-button>
    </div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('users.q')" clearable @keyup.enter="list.search" @clear="list.search">
          <template #prefix><el-icon><IconSearch /></el-icon></template>
        </el-input>
        <el-select v-model="list.filters.kind" @change="list.search">
          <el-option value="" :label="t('users.kind.member')" />
          <el-option value="demo" :label="t('users.kind.demo')" />
          <el-option value="persona" :label="t('users.kind.persona')" />
          <el-option value="all" :label="t('users.kind.all')" />
        </el-select>
        <el-select v-model="list.filters.status" clearable :placeholder="t('common.status')" @change="list.search">
          <el-option :value="0" :label="t('common.normal')" />
          <el-option :value="1" :label="t('users.disabledTag')" />
        </el-select>
        <AgentSelect v-if="can('agents.view')" v-model="list.filters.agentId" @update:model-value="list.search" />
        <el-select v-model="list.filters.platform" clearable :placeholder="t('users.platform')" @change="list.search">
          <el-option value="web" label="Web" /><el-option value="android" label="Android" /><el-option value="ios" label="iOS" />
        </el-select>
        <el-date-picker v-model="list.filters.range" type="daterange" :start-placeholder="t('common.from')" :end-placeholder="t('common.to')" @change="list.search" />
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
        <el-button @click="list.reset">{{ t('common.reset') }}</el-button>
      </div>
      <el-table v-loading="list.loading.value" :data="list.items.value" stripe @sort-change="onSort">
        <el-table-column :label="t('common.user')" min-width="200">
          <template #default="{ row }">
            <UserCell :id="row.id" :name="row.name" :avatar="row.avatar" :display-id="row.displayId" />
          </template>
        </el-table-column>
        <el-table-column :label="t('common.phone') + ' / ' + t('common.email')" min-width="180">
          <template #default="{ row }"><div class="num">{{ row.phone || '—' }}</div><small class="muted">{{ row.email }}</small></template>
        </el-table-column>
        <el-table-column prop="city" :label="t('common.city')" width="100" />
        <el-table-column :label="t('users.balance')" prop="balance" sortable="custom" align="right" width="120">
          <template #default="{ row }"><span class="num">{{ money(row.balance, '') }}</span></template>
        </el-table-column>
        <el-table-column :label="t('users.beans')" prop="beans" sortable="custom" align="right" width="110">
          <template #default="{ row }"><span class="num">{{ number(row.beans) }}</span></template>
        </el-table-column>
        <el-table-column v-if="can('agents.view')" :label="t('users.agent')" width="130">
          <template #default="{ row }">{{ row.agentName || '—' }}</template>
        </el-table-column>
        <el-table-column :label="t('common.status')" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.status === 1" type="danger" size="small">{{ t('users.disabledTag') }}</el-tag>
            <el-tag v-else-if="row.online" type="success" size="small">{{ t('users.online') }}</el-tag>
            <el-tag v-else size="small" type="info">{{ t('common.normal') }}</el-tag>
            <el-tag v-if="row.kind === 2" size="small" type="warning" style="margin-left: 4px">{{ t('users.kind.demo') }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('users.registered')" prop="createdAt" sortable="custom" width="150">
          <template #default="{ row }"><span class="num">{{ dateTime(row.createdAt) }}</span></template>
        </el-table-column>
        <el-table-column :label="t('users.lastSeen')" prop="lastSeenAt" sortable="custom" width="150">
          <template #default="{ row }"><span class="num">{{ dateTime(row.lastSeenAt) }}</span></template>
        </el-table-column>
        <el-table-column :label="t('common.actions')" width="90" fixed="right">
          <template #default="{ row }"><el-button link type="primary" @click="$router.push('/users/' + row.id)">{{ t('common.detail') }}</el-button></template>
        </el-table-column>
      </el-table>
      <Pager :list="list" />
    </div>
  </div>
</template>

<script setup>
import { Download as IconDownload } from '@element-plus/icons-vue';
import { useList } from '../../core/list';
import { t } from '../../core/i18n';
import { can } from '../../core/auth';
import { dateTime, money, number } from '../../core/format';
import Pager from '../../components/Pager.vue';
import UserCell from '../../components/UserCell.vue';
import AgentSelect from '../../components/AgentSelect.vue';

const list = useList('users', { q: '', kind: '', status: null, agentId: null, platform: '', range: [], sort: '' });
function onSort({ prop, order }) {
  list.filters.sort = order ? (order === 'descending' ? '-' : '') + prop : '';
  list.search();
}
</script>
