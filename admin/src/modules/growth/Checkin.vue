<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ pick($route.meta.title, 'zh') }}</h1>
      <div class="spacer" />
      <el-radio-group v-model="days" size="small" @change="loadStats">
        <el-radio-button :value="7">{{ t('common.last7') }}</el-radio-button>
        <el-radio-button :value="30">{{ t('common.last30') }}</el-radio-button>
        <el-radio-button :value="90">{{ t('common.last90') }}</el-radio-button>
      </el-radio-group>
    </div>
    <div class="grid-cards">
      <StatCard :label="t('growth.today')" :value="stats.today?.checkins ?? 0" />
      <StatCard :label="t('growth.streak7')" :value="stats.today?.streak7 ?? 0" />
    </div>
    <div class="charts">
      <div class="panel"><h3 class="panel-title">{{ t('growth.checkins') }}</h3><LineChart :series="[{ name: t('growth.checkins'), points: stats.checkins || [], type: 'bar' }]" :height="220" /></div>
      <div class="panel"><h3 class="panel-title">{{ t('growth.beans') }}</h3><LineChart :series="[{ name: t('growth.beans'), points: stats.beans || [] }]" :height="220" /></div>
    </div>
    <ConfigForm :groups="['checkin']" endpoint="growth/config" perm="marketing.checkin" />
    <div class="panel">
      <h3 class="panel-title">{{ t('growth.records') }}</h3>
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('fin.q')" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-date-picker v-model="list.filters.range" type="daterange" :start-placeholder="t('common.from')" :end-placeholder="t('common.to')" @change="list.search" />
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
      </div>
      <el-table v-loading="list.loading.value" :data="list.items.value" size="small" stripe>
        <el-table-column prop="day" :label="t('growth.day')" width="120" />
        <el-table-column :label="t('common.user')" min-width="170"><template #default="{ row }"><UserCell :id="row.user.id" :name="row.user.name" :avatar="row.user.avatar" :display-id="row.user.displayId" :size="28" /></template></el-table-column>
        <el-table-column prop="streak" :label="t('growth.streak')" width="100" />
        <el-table-column :label="t('growth.reward')" width="100" align="right"><template #default="{ row }"><span class="num">{{ number(row.reward) }}</span></template></el-table-column>
        <el-table-column :label="t('common.time')" width="150"><template #default="{ row }"><span class="num">{{ dateTime(row.at) }}</span></template></el-table-column>
      </el-table>
      <Pager :list="list" />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { api } from '../../core/api';
import { t, pick } from '../../core/i18n';
import { useList } from '../../core/list';
import { dateTime, number } from '../../core/format';
import StatCard from '../../components/StatCard.vue';
import LineChart from '../../components/LineChart.vue';
import ConfigForm from '../../components/ConfigForm.vue';
import UserCell from '../../components/UserCell.vue';
import Pager from '../../components/Pager.vue';

const days = ref(30);
const stats = ref({});
async function loadStats() {
  stats.value = await api.get('growth/stats', { days: days.value });
}
loadStats();
const list = useList('growth/checkins', { q: '', range: null });
</script>

<style scoped>
.charts { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 16px; }
@media (max-width: 768px) { .charts { grid-template-columns: 1fr; } }
</style>
