<template>
  <div class="page" v-loading="loading">
    <div class="page-head">
      <h1>{{ t('dash.trends') }}</h1>
      <div class="spacer" />
      <el-radio-group v-model="days" size="small" @change="load">
        <el-radio-button :value="7">{{ t('common.last7') }}</el-radio-button>
        <el-radio-button :value="30">{{ t('common.last30') }}</el-radio-button>
        <el-radio-button :value="90">{{ t('common.last90') }}</el-radio-button>
      </el-radio-group>
      <el-button :icon="IconRefresh" circle size="small" @click="load" />
    </div>

    <div v-if="data.todos?.length" class="panel todos">
      <h3 class="panel-title">{{ t('dash.todos') }}</h3>
      <div class="todo-list">
        <router-link v-for="td in data.todos" :key="td.key" :to="td.link" class="todo">
          <span>{{ pick(td) }}</span>
          <el-badge :value="td.count" type="danger" />
        </router-link>
      </div>
    </div>

    <div class="grid-cards">
      <StatCard v-for="c in data.cards" :key="c.key" :label="pick(c)" :value="c.value" :unit="c.unit" :delta="c.delta"
        :delta-label="c.delta !== undefined && c.delta !== null ? t('common.yesterday') : ''" :link="c.link" />
    </div>

    <div class="charts">
      <div v-for="s in data.series" :key="s.key" class="panel">
        <h3 class="panel-title">{{ pick(s) }}<small v-if="s.unit" class="muted">（{{ s.unit }}）</small></h3>
        <LineChart :series="[{ name: pick(s), points: s.points, type: s.unit === 'RM' ? 'bar' : 'line' }]" :height="220" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { Refresh as IconRefresh } from '@element-plus/icons-vue';
import { api } from '../../core/api';
import { t, pick } from '../../core/i18n';
import StatCard from '../../components/StatCard.vue';
import LineChart from '../../components/LineChart.vue';

const days = ref(30);
const loading = ref(false);
const data = ref({ cards: [], series: [], todos: [] });
async function load() {
  loading.value = true;
  try {
    data.value = await api.get('dashboard', { days: days.value });
  } finally {
    loading.value = false;
  }
}
load();
</script>

<style scoped>
.charts { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 16px; }
.charts .panel { margin: 0; }
.todo-list { display: flex; flex-wrap: wrap; gap: 10px; }
.todo { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-radius: 8px; background: var(--el-fill-color-light); color: inherit; text-decoration: none; }
.todo:hover { background: var(--el-color-primary-light-9); }
@media (max-width: 768px) { .charts { grid-template-columns: 1fr; } }
</style>
