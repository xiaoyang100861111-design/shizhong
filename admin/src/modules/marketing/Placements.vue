<template>
  <div class="page">
    <div class="page-head"><h1>{{ t('mk.placements') }}</h1></div>
    <p class="page-sub">{{ t('mk.placementsSub') }}</p>
    <div class="panel">
      <h3 class="panel-title">{{ t('mk.searchStats') }}</h3>
      <el-table v-loading="loading" :data="stats" size="small" max-height="320">
        <el-table-column :label="t('mk.query')" prop="query" min-width="160" />
        <el-table-column :label="t('mk.times')" prop="times" align="right" width="90" />
        <el-table-column :label="t('mk.empty')" prop="empty" align="right" width="110" />
        <el-table-column :label="t('mk.lastAt')" width="150"><template #default="{ row }"><span class="num small">{{ dateTime(row.lastAt) }}</span></template></el-table-column>
      </el-table>
      <p class="muted small">{{ t('mk.searchStatsHint') }}</p>
    </div>
    <ConfigForm :groups="['catalog']" />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { dateTime } from '../../core/format';
import ConfigForm from '../../components/ConfigForm.vue';

const stats = ref([]);
const loading = ref(false);
async function load() {
  loading.value = true;
  try {
    stats.value = await api.get('marketing/search-stats', { days: 30 });
  } finally {
    loading.value = false;
  }
}
load();
</script>

<style scoped>
.small { font-size: 12px; }
</style>
