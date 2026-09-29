<template>
  <div class="page" v-loading="!info">
    <div class="page-head">
      <h1>{{ t('seed.title') }}</h1>
      <div class="spacer" />
      <el-button :icon="Refresh" @click="load">{{ t('seed.refresh') }}</el-button>
    </div>

    <el-alert v-if="info && !info.enabled" type="warning" :closable="false" show-icon class="mb" :title="t('seed.disabled')" />

    <div v-if="info" class="panel">
      <h3 class="panel-title">{{ t('seed.actions') }}</h3>
      <p class="muted">{{ t('seed.intro') }}</p>
      <div class="actions">
        <span class="muted">{{ t('seed.scale') }}</span>
        <el-select v-model="scale" style="width: 150px" :disabled="running">
          <el-option v-for="s in scales" :key="s.value" :value="s.value" :label="s.label" />
        </el-select>
        <el-button type="primary" :loading="running && job?.kind === 'seed'" :disabled="running || !info.enabled" @click="run">
          {{ generated > 0 ? t('seed.regenerate') : t('seed.generate') }}
        </el-button>
        <el-button type="danger" plain :loading="running && job?.kind === 'clear'" :disabled="running || !info.enabled || generated === 0" @click="clear">
          {{ t('seed.clear') }}
        </el-button>
        <el-button :loading="verifying" :disabled="running" @click="verify">{{ t('seed.verify') }}</el-button>
      </div>
      <div v-if="job" class="job">
        <div class="job-line">
          <el-tag :type="job.status === 'done' ? 'success' : job.status === 'failed' ? 'danger' : 'primary'" size="small">{{ t('seed.status.' + job.status) }}</el-tag>
          <span>{{ job.step }}<template v-if="job.detail"> · {{ job.detail }}</template></span>
          <span class="muted num">{{ job.seconds }} s</span>
        </div>
        <el-progress :percentage="job.percent" :status="job.status === 'done' ? 'success' : job.status === 'failed' ? 'exception' : undefined" />
        <el-alert v-if="job.error" type="error" :closable="false" :title="job.error" class="mt" />
      </div>
      <p v-else-if="info.last" class="muted mt">
        {{ t('seed.last', { kind: t('seed.kind.' + info.last.kind), time: dateTime(info.last.finishedAt || info.last.startedAt), status: t('seed.runStatus.' + info.last.status) }) }}
        <template v-if="info.last.summary?.seconds"> · {{ t('seed.took', { s: info.last.summary.seconds }) }}</template>
      </p>
    </div>

    <div v-if="checks" class="panel">
      <h3 class="panel-title">{{ t('seed.checks') }} <span class="muted small">{{ checks.ms }} ms</span></h3>
      <el-table :data="checks.checks" size="small">
        <el-table-column width="70"><template #default="{ row }"><el-tag :type="row.problems ? 'danger' : 'success'" size="small">{{ row.problems ? t('seed.fail') : 'OK' }}</el-tag></template></el-table-column>
        <el-table-column :label="t('seed.check')" min-width="260"><template #default="{ row }">{{ lang === 'en' ? row.name : row.nameZh }}</template></el-table-column>
        <el-table-column :label="t('seed.problems')" width="110" align="right"><template #default="{ row }"><span class="num">{{ number(row.problems) }}</span></template></el-table-column>
        <el-table-column :label="t('seed.checked')" width="110" align="right"><template #default="{ row }"><span class="num">{{ number(row.checked) }}</span></template></el-table-column>
      </el-table>
    </div>

    <div v-if="info" class="grid-cards">
      <StatCard v-for="c in cards" :key="c.key" :label="t('seed.count.' + c.key)" :value="c.total" :delta-label="''" />
    </div>

    <div v-if="info" class="two">
      <div class="panel">
        <h3 class="panel-title">{{ t('seed.accounts') }}</h3>
        <dl class="kv">
          <dt>{{ t('seed.password') }}</dt><dd><code class="pw">{{ info.password }}</code> <span class="muted">{{ t('seed.passwordNote') }}</span></dd>
          <dt>{{ t('seed.demo') }}</dt><dd>{{ info.demo.phone }} / {{ info.demo.email }} · <code class="pw">{{ info.demo.password }}</code></dd>
          <dt>{{ t('seed.admin') }}</dt><dd><code class="pw">admin</code> / <code class="pw">123123</code></dd>
        </dl>
        <h4 class="sub">{{ t('seed.staff') }}</h4>
        <el-table :data="staff" size="small" max-height="360">
          <el-table-column prop="username" :label="t('seed.username')" width="130"><template #default="{ row }"><code>{{ row.username }}</code></template></el-table-column>
          <el-table-column prop="name" :label="t('seed.name')" min-width="160" show-overflow-tooltip />
          <el-table-column prop="roleName" :label="t('seed.role')" width="100" />
        </el-table>
        <p class="muted small">{{ t('seed.staffNote', { agents: countRole('agent'), shops: countRole('merchant') }) }}</p>
      </div>
      <div class="panel">
        <h3 class="panel-title">{{ t('seed.members') }}</h3>
        <el-table :data="info.members" size="small">
          <el-table-column prop="name" :label="t('seed.name')" min-width="130" />
          <el-table-column prop="phone" :label="t('seed.phone')" width="140"><template #default="{ row }"><span class="num">{{ row.phone }}</span></template></el-table-column>
          <el-table-column prop="city" :label="t('seed.city')" width="100" />
        </el-table>
        <p class="muted small">{{ t('seed.membersNote') }}</p>
      </div>
    </div>

    <div v-if="info" class="panel">
      <h3 class="panel-title">{{ t('seed.tables') }}</h3>
      <el-table :data="tables" size="small" max-height="420">
        <el-table-column prop="table" :label="t('seed.table')" min-width="180"><template #default="{ row }"><code>{{ row.table }}</code></template></el-table-column>
        <el-table-column :label="t('seed.generatedRows')" width="140" align="right"><template #default="{ row }"><span class="num">{{ number(row.n) }}</span></template></el-table-column>
      </el-table>
    </div>

    <ConfigForm :groups="['seed']" />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Refresh } from '@element-plus/icons-vue';
import { api } from '../../core/api';
import { t, lang } from '../../core/i18n';
import { dateTime, number } from '../../core/format';
import StatCard from '../../components/StatCard.vue';
import ConfigForm from '../../components/ConfigForm.vue';

const info = ref(null);
const job = ref(null);
const checks = ref(null);
const verifying = ref(false);
const scale = ref(1);
const scales = [
  { value: 0.1, label: '0.1×' },
  { value: 0.25, label: '0.25×' },
  { value: 0.5, label: '0.5×' },
  { value: 1, label: '1×' },
  { value: 2, label: '2×' },
];
let timer = 0;

const running = computed(() => job.value?.status === 'running');
const generated = computed(() => info.value?.counts?.generated?.Users ?? 0);
const staff = computed(() => (info.value?.accounts || []).filter(a => a.role !== 'agent' && a.role !== 'merchant').concat(
  (info.value?.accounts || []).filter(a => a.role === 'agent').slice(0, 4),
  (info.value?.accounts || []).filter(a => a.role === 'merchant').slice(0, 4)));
const countRole = role => (info.value?.accounts || []).filter(a => a.role === role).length;
const cardKeys = ['members', 'agents', 'orders', 'reviews', 'posts', 'comments', 'follows', 'messages', 'liveSessions', 'giftTransactions', 'privateCalls',
  'cryptoDeposits', 'withdrawals', 'tickets', 'ledger', 'notifications', 'broadcasts', 'banners', 'couponTemplates', 'giftBackgrounds', 'liveNow', 'cryptoBalances',
  'hostApplications', 'merchantApplications', 'riskEvents', 'riskLists', 'verified', 'verifiedDomains'];
const cards = computed(() => cardKeys.map(key => ({ key, total: info.value?.counts?.totals?.[key] ?? 0 })));
const tables = computed(() => Object.entries(info.value?.counts?.generated || {}).map(([table, n]) => ({ table, n })).sort((a, b) => b.n - a.n));

async function load() {
  info.value = await api.get('seed');
  job.value = info.value.job || null;
  if (running.value) poll();
}

function poll() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const res = await api.get('seed', undefined, { quiet: true }).catch(() => null);
    if (res) {
      info.value = res;
      job.value = res.job || job.value;
      if (job.value?.status === 'done') ElMessage.success(t('seed.done'));
    }
    if (running.value) poll();
  }, 1500);
}

async function run() {
  if (generated.value > 0) await ElMessageBox.confirm(t('seed.confirmRegenerate'), t('seed.regenerate'), { type: 'warning' });
  const res = await api.post('seed/run', { scale: scale.value, reset: true });
  job.value = res.job;
  checks.value = null;
  poll();
}

async function clear() {
  await ElMessageBox.confirm(t('seed.confirmClear'), t('seed.clear'), { type: 'warning' });
  const res = await api.post('seed/clear');
  job.value = res.job;
  checks.value = null;
  poll();
}

async function verify() {
  verifying.value = true;
  try {
    checks.value = await api.get('seed/verify');
  } finally {
    verifying.value = false;
  }
}

load();
onBeforeUnmount(() => clearTimeout(timer));
</script>

<style scoped>
.actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.job { margin-top: 14px; display: grid; gap: 8px; }
.job-line { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.two { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; }
.two .panel { margin-bottom: 16px; }
.pw { background: var(--el-fill-color-light); padding: 1px 6px; border-radius: 4px; }
.sub { margin: 16px 0 8px; font-size: 14px; }
.small { font-size: 12px; }
.mt { margin-top: 10px; }
.mb { margin-bottom: 16px; }
</style>
