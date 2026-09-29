<template>
  <div class="page" v-loading="loading">
    <div class="page-head">
      <el-button :icon="IconBack" circle @click="$router.back()" />
      <h1>{{ agent?.name }}</h1>
      <el-tag v-if="agent" effect="plain">{{ t('agents.code') }} {{ agent.code }}</el-tag>
      <div class="spacer" />
      <el-radio-group v-model="days" size="small" @change="loadStats">
        <el-radio-button :value="30">{{ t('common.last30') }}</el-radio-button>
        <el-radio-button :value="90">{{ t('common.last90') }}</el-radio-button>
      </el-radio-group>
    </div>
    <div v-if="agent" class="grid-cards">
      <StatCard :label="t('agents.directUsers')" :value="agent.directUsers" />
      <StatCard :label="t('agents.treeUsers')" :value="agent.treeUsers" />
      <StatCard :label="t('agents.new30')" :value="agent.newUsers30" />
      <StatCard :label="t('agents.treeTopup')" :value="agent.treeTopup" unit="RM" />
    </div>
    <div class="charts">
      <div class="panel"><h3 class="panel-title">{{ t('agents.newUsers') }}</h3><LineChart v-if="stats" :series="[{ name: t('agents.newUsers'), points: stats.newUsers }]" /></div>
      <div class="panel"><h3 class="panel-title">{{ t('agents.topups') }}（RM）</h3><LineChart v-if="stats" :series="[{ name: t('agents.topups'), points: stats.topups, type: 'bar' }]" /></div>
    </div>
    <div class="panel">
      <h3 class="panel-title">{{ t('agents.members') }}</h3>
      <el-table :data="members.items.value" v-loading="members.loading.value" size="small">
        <el-table-column :label="t('common.user')" min-width="200"><template #default="{ row }"><UserCell :id="row.id" :name="row.name" :avatar="row.avatar" :display-id="row.displayId" /></template></el-table-column>
        <el-table-column prop="phone" :label="t('common.phone')" width="150" />
        <el-table-column :label="t('users.balance')" align="right" width="120"><template #default="{ row }">{{ money(row.balance, '') }}</template></el-table-column>
        <el-table-column :label="t('users.registered')" width="150"><template #default="{ row }">{{ dateTime(row.createdAt) }}</template></el-table-column>
      </el-table>
      <Pager :list="members" />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRoute } from 'vue-router';
import { Back as IconBack } from '@element-plus/icons-vue';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { useList } from '../../core/list';
import { dateTime, money } from '../../core/format';
import StatCard from '../../components/StatCard.vue';
import LineChart from '../../components/LineChart.vue';
import UserCell from '../../components/UserCell.vue';
import Pager from '../../components/Pager.vue';

const id = Number(useRoute().params.id);
const agent = ref(null);
const stats = ref(null);
const loading = ref(false);
const days = ref(30);
const members = useList('users', { agentId: id });

async function load() {
  loading.value = true;
  try {
    const all = await api.get('agents');
    agent.value = all.find(a => a.id === id) || null;
  } finally {
    loading.value = false;
  }
}
async function loadStats() {
  stats.value = await api.get(`agents/${id}/stats`, { days: days.value });
}
load();
loadStats();
</script>

<style scoped>
.charts { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 900px) { .charts { grid-template-columns: 1fr; } }
</style>
