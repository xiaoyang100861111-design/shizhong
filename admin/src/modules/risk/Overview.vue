<template>
  <div class="page" v-loading="loading">
    <div class="page-head">
      <h1>{{ t('risk.ov.title') }}</h1>
      <div class="level">
        <span class="muted">{{ t('risk.ov.level') }}</span>
        <el-tag :type="levelType[data.level] || 'info'" effect="dark" size="large">{{ data.level ? pick({ label: data.levelName, labelEn: data.levelNameEn }) : '—' }}</el-tag>
        <el-button size="small" @click="$router.push('/risk/policy')">{{ t('risk.ov.changePolicy') }}</el-button>
      </div>
      <div class="spacer" />
      <el-radio-group v-model="days" size="small" @change="load">
        <el-radio-button :value="7">{{ t('common.last7') }}</el-radio-button>
        <el-radio-button :value="30">{{ t('common.last30') }}</el-radio-button>
      </el-radio-group>
      <el-button :icon="IconRefresh" circle size="small" @click="load" />
    </div>

    <h3 class="section">{{ t('risk.ov.today') }}</h3>
    <div class="grid-cards">
      <StatCard :label="t('risk.ov.captcha')" :value="data.today?.captcha || 0" link="/risk/events?action=captcha" />
      <StatCard :label="t('risk.ov.block')" :value="data.today?.block || 0" link="/risk/events?action=block" />
      <StatCard :label="t('risk.ov.lock')" :value="data.today?.lock || 0" link="/risk/events?action=lock" />
      <StatCard :label="t('risk.ov.mute')" :value="data.today?.mute || 0" link="/risk/events?action=mute" />
      <StatCard :label="t('risk.ov.fail')" :value="data.slider?.failedToday || 0" link="/risk/events?action=fail" />
    </div>
    <div class="grid-cards">
      <StatCard :label="t('risk.ov.verified')" :value="data.verified || 0" link="/risk/verified" />
      <StatCard :label="t('risk.ov.blockList')" :value="data.lists?.block || 0" link="/risk/lists" />
      <StatCard :label="t('risk.ov.allowList')" :value="data.lists?.allow || 0" link="/risk/lists" />
      <StatCard :label="t('risk.ov.muted')" :value="data.muted || 0" />
    </div>
    <p class="muted small">
      {{ t('risk.ov.autoBlocks', { n: data.lists?.auto || 0 }) }} ·
      {{ t('risk.ov.slider', { issued: data.slider?.issued || 0, solved: data.slider?.solved || 0, failed: data.slider?.failed || 0 }) }}
    </p>

    <div class="charts">
      <div class="panel">
        <h3 class="panel-title">{{ t('risk.ov.actionsTrend') }}</h3>
        <LineChart :series="actionSeries" :height="240" />
      </div>
      <div class="panel">
        <h3 class="panel-title">{{ t('risk.ov.eventsTrend') }}</h3>
        <LineChart :series="eventSeries" :height="240" />
      </div>
    </div>

    <div class="panel">
      <h3 class="panel-title">{{ t('risk.ov.scenes') }}<small class="muted">{{ periodLabel }}</small></h3>
      <el-table :data="data.scenes || []" size="small">
        <el-table-column :label="t('risk.ov.scene')" min-width="200">
          <template #default="{ row }">
            <router-link :to="'/risk/events?scene=' + row.scene" class="scene">{{ pick({ label: row.name, labelEn: row.nameEn }) }}</router-link>
            <div class="muted small">{{ sceneDesc(row.scene) }}</div>
          </template>
        </el-table-column>
        <el-table-column :label="t('risk.ov.sceneActions')" align="right" width="110"><template #default="{ row }"><span class="num">{{ number(row.actions) }}</span></template></el-table-column>
        <el-table-column v-for="a in ACTIONS" :key="a" :label="t('risk.action.' + a)" align="right" width="100">
          <template #default="{ row }">
            <router-link v-if="row.events?.[a]" :to="`/risk/events?scene=${row.scene}&action=${a}`" class="num" :class="{ neg: a === 'block' || a === 'lock' }">{{ number(row.events[a]) }}</router-link>
            <span v-else class="muted">0</span>
          </template>
        </el-table-column>
        <el-table-column align="right" width="110">
          <template #header><el-tooltip :content="t('risk.ov.blockRateHint')"><span>{{ t('risk.ov.blockRate') }}</span></el-tooltip></template>
          <template #default="{ row }"><span class="num">{{ blockRate(row) }}</span></template>
        </el-table-column>
      </el-table>
    </div>

    <div class="charts">
      <div class="panel">
        <h3 class="panel-title">{{ t('risk.ov.topIps') }}<small class="muted">{{ periodLabel }}</small></h3>
        <el-table :data="data.topIps || []" size="small">
          <el-table-column label="IP" min-width="130">
            <template #default="{ row }">
              <span class="num">{{ row.ip }}</span>
              <el-tag v-if="row.listed" size="small" :type="row.listed === 'block' ? 'danger' : 'success'" class="ml">{{ t('risk.ov.listed.' + row.listed) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="t('risk.ov.events')" align="right" width="58"><template #default="{ row }"><span class="num">{{ row.events }}</span></template></el-table-column>
          <el-table-column :label="t('risk.ov.blocks')" align="right" width="58"><template #default="{ row }"><span class="num">{{ row.blocks }}</span></template></el-table-column>
          <el-table-column :label="t('risk.ov.users')" align="right" width="76"><template #default="{ row }"><span class="num">{{ row.users }}</span></template></el-table-column>
          <el-table-column :label="t('risk.ov.lastAt')" width="100"><template #default="{ row }"><span class="num">{{ shortTime(row.lastAt) }}</span></template></el-table-column>
          <el-table-column :label="t('common.actions')" width="118">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="$router.push('/risk/events?ip=' + encodeURIComponent(row.ip))">{{ t('risk.ov.evShort') }}</el-button>
              <el-button v-if="can('risk.lists') && !row.listed" link type="danger" size="small" @click="blockIp(row.ip, row)">{{ t('risk.ov.blockShort') }}</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <div class="panel">
        <h3 class="panel-title">{{ t('risk.ov.topUsers') }}<small class="muted">{{ periodLabel }}</small></h3>
        <el-table :data="data.topUsers || []" size="small">
          <el-table-column :label="t('common.user')" min-width="170">
            <template #default="{ row }">
              <UserCell :id="row.id" :name="row.name" :avatar="row.avatar" :display-id="row.displayId" :verified="row.verified === 1" :size="28" />
            </template>
          </el-table-column>
          <el-table-column :label="t('risk.ov.events')" align="right" width="70"><template #default="{ row }"><span class="num">{{ row.events }}</span></template></el-table-column>
          <el-table-column :label="t('risk.ov.blocks')" align="right" width="70"><template #default="{ row }"><span class="num">{{ row.blocks }}</span></template></el-table-column>
          <el-table-column :label="t('risk.ov.lastAt')" width="140">
            <template #default="{ row }">
              <span class="num">{{ shortTime(row.lastAt) }}</span>
              <el-tag v-if="row.mutedUntil && row.mutedUntil > Date.now()" size="small" type="warning" class="ml">{{ t('risk.ov.mutedNow') }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="t('common.actions')" width="80">
            <template #default="{ row }"><el-button link type="primary" size="small" @click="$router.push('/risk/events?userId=' + row.id)">{{ t('risk.ov.evShort') }}</el-button></template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <ListEntryDialog v-model="blockOpen" :preset="blockPreset" lock-kind @saved="load" />
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { Refresh as IconRefresh } from '@element-plus/icons-vue';
import { api } from '../../core/api';
import { t, pick, lang } from '../../core/i18n';
import { can } from '../../core/auth';
import { number, percent } from '../../core/format';
import StatCard from '../../components/StatCard.vue';
import LineChart from '../../components/LineChart.vue';
import UserCell from '../../components/UserCell.vue';
import ListEntryDialog from './ListEntryDialog.vue';
import { ACTIONS, levelType, loadPolicy, policy } from './common';

const days = ref(7);
const loading = ref(false);
const data = ref({});
async function load() {
  loading.value = true;
  try {
    data.value = await api.get('risk/overview', { days: days.value });
  } finally {
    loading.value = false;
  }
}
load();
loadPolicy().catch(() => {});

const periodLabel = computed(() => (days.value === 30 ? t('common.last30') : t('common.last7')));
const trend = computed(() => data.value.trend || []);
const actionSeries = computed(() => [{ name: t('risk.ov.actions'), type: 'bar', points: trend.value.map(d => ({ day: d.day, value: d.actions })) }]);
const eventSeries = computed(() =>
  ['captcha', 'block', 'fail', 'mute'].map(k => ({ name: t('risk.action.' + k), points: trend.value.map(d => ({ day: d.day, value: d[k] })) }))
);
const shortTime = ms => ms
  ? new Intl.DateTimeFormat(lang.value === 'en' ? 'en-MY' : 'zh-CN', { timeZone: 'Asia/Kuala_Lumpur', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms))
  : '—';
function sceneDesc(scene) {
  const s = policy.data?.schema?.find(x => x.scene === scene);
  return s ? pick(s, 'desc') : '';
}
function blockRate(row) {
  if (row.scene === 'login') return '—'; // sign-ins are not counted as actions
  const refused = (row.events?.block || 0) + (row.events?.lock || 0);
  const all = (row.actions || 0) + refused;
  return all ? percent(refused / all) : '—';
}

const blockOpen = ref(false);
const blockPreset = ref(null);
function blockIp(ip, row) {
  blockPreset.value = { kind: 'ip', value: ip, listType: 'block', hours: 24 * 7, note: t('risk.ov.blockNote', { period: periodLabel.value, events: row.events, blocks: row.blocks }) };
  blockOpen.value = true;
}
</script>

<style scoped>
.level { display: flex; align-items: center; gap: 8px; }
.section { font-size: 14px; font-weight: 600; margin: 0 0 8px; color: var(--el-text-color-regular); }
.small { font-size: 12px; }
p.small { margin: -6px 0 16px; }
.charts { display: grid; grid-template-columns: repeat(auto-fill, minmax(460px, 1fr)); gap: 16px; margin-bottom: 16px; }
.charts .panel { margin: 0; min-width: 0; }
.scene { font-weight: 500; color: var(--el-text-color-primary); text-decoration: none; }
.scene:hover { color: var(--el-color-primary); }
a.num { text-decoration: none; color: inherit; }
a.num.neg { color: var(--el-color-danger); }
a.num:hover { text-decoration: underline; }
.ml { margin-left: 6px; }
@media (max-width: 768px) { .charts { grid-template-columns: 1fr; } }
</style>
