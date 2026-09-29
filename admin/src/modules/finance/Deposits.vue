<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ pick($route.meta.title, 'zh') }}</h1>
      <div class="spacer" />
      <el-button v-can="'finance.deposits'" @click="manualOpen = true">{{ t('fin.manualBtn') }}</el-button>
      <el-button v-can="'finance.simulate'" type="warning" plain @click="simOpen = true">{{ t('fin.simulate') }}</el-button>
      <el-button v-can="'finance.export'" :icon="IconDownload" @click="list.exportCsv('finance/deposits/export', 'crypto-deposits.csv')">{{ t('common.export') }}</el-button>
    </div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('fin.q')" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-select v-model="list.filters.status" clearable :placeholder="t('fin.status')" @change="list.search">
          <el-option value="attention" :label="t('fin.attention')" />
          <el-option v-for="s in statuses" :key="s" :value="s" :label="t('fin.dep.' + s)" />
        </el-select>
        <el-select v-model="list.filters.network" clearable :placeholder="t('fin.network')" @change="list.search">
          <el-option v-for="n in ['ERC20', 'BEP20', 'TRC20', 'BTC']" :key="n" :value="n" :label="n" />
        </el-select>
        <el-select v-model="list.filters.asset" clearable :placeholder="t('fin.asset')" @change="list.search">
          <el-option v-for="a in assets" :key="a" :value="a" :label="a" />
        </el-select>
        <el-input v-model="list.filters.tx" :placeholder="t('fin.tx') + ' / ' + t('fin.to')" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-select v-model="list.filters.simulated" clearable :placeholder="t('fin.simulated')" @change="list.search">
          <el-option :value="false" :label="t('fin.onlyReal')" /><el-option :value="true" :label="t('fin.onlySimulated')" />
        </el-select>
        <el-date-picker v-model="list.filters.range" type="daterange" :start-placeholder="t('common.from')" :end-placeholder="t('common.to')" @change="list.search" />
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
        <el-button @click="list.reset">{{ t('common.reset') }}</el-button>
      </div>
      <p class="muted sums">{{ t('fin.sumCredited') }} <b class="num">{{ money(list.meta.value.sumCredited) }}</b> · {{ t('common.total', { n: list.total.value }) }}</p>
      <el-table v-loading="list.loading.value" :data="list.items.value" size="small" stripe>
        <el-table-column :label="t('fin.detectedAt')" width="150"><template #default="{ row }"><span class="num">{{ dateTime(row.detectedAt, true) }}</span></template></el-table-column>
        <el-table-column :label="t('common.user')" min-width="160"><template #default="{ row }"><UserCell :id="row.user.id" :name="row.user.name" :avatar="row.user.avatar" :display-id="row.user.displayId" :size="28" /></template></el-table-column>
        <el-table-column :label="t('fin.asset')" width="130">
          <template #default="{ row }"><b>{{ row.coin || '?' }}</b> <small class="muted">{{ row.network }}</small>
            <el-tag v-if="row.simulated" size="small" type="warning" effect="plain" class="ml">{{ t('fin.simulated') }}</el-tag>
            <el-tag v-if="row.manual" size="small" effect="plain" class="ml">{{ t('fin.manual') }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('fin.amount')" align="right" width="130"><template #default="{ row }"><span class="num">{{ row.amount }}</span></template></el-table-column>
        <el-table-column :label="t('fin.status')" width="170">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ t('fin.dep.' + row.status) }}</el-tag>
            <span v-if="row.status === 'confirming' || row.status === 'detected'" class="num muted ml">{{ row.confirmations }}/{{ row.required }}</span>
            <div v-if="row.reason" class="muted small">{{ reasonLabel(row.reason) }}</div>
          </template>
        </el-table-column>
        <el-table-column :label="t('fin.credit')" align="right" width="120">
          <template #default="{ row }"><span v-if="row.credit != null" class="num pos">{{ money(row.credit) }}</span><small v-if="row.rate" class="muted block">@{{ number(row.rate, 4) }}</small></template>
        </el-table-column>
        <el-table-column :label="t('fin.tx')" min-width="150">
          <template #default="{ row }">
            <a v-if="row.txUrl" :href="row.txUrl" target="_blank" rel="noopener" class="num mono">{{ short(row.txHash) }}</a>
            <span v-else class="num mono muted">{{ short(row.txHash) }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('common.actions')" width="210" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">{{ t('common.detail') }}</el-button>
            <template v-if="row.status !== 'credited' && row.status !== 'closed'">
              <el-button v-if="row.status === 'detected' || row.status === 'confirming'" v-can="'finance.deposits'" link type="primary" @click="recheck(row)">{{ t('fin.recheck') }}</el-button>
              <el-button v-can="'finance.deposits'" link type="success" @click="openCredit(row)">{{ t('fin.creditBtn') }}</el-button>
              <el-button v-can="'finance.deposits'" link type="danger" @click="openClose(row)">{{ t('fin.closeBtn') }}</el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>
      <Pager :list="list" />
    </div>

    <el-drawer v-model="detailOpen" :title="t('fin.detail') + (detail ? ' #' + detail.deposit.id : '')" size="520px">
      <template v-if="detail">
        <dl class="kv">
          <dt>{{ t('common.user') }}</dt><dd><router-link :to="'/users/' + detail.deposit.user.id">{{ detail.deposit.user.name }} ({{ detail.deposit.user.displayId }})</router-link></dd>
          <dt>{{ t('fin.asset') }}</dt><dd>{{ detail.deposit.asset || '—' }} · {{ detail.deposit.network }}</dd>
          <dt>{{ t('fin.amount') }}</dt><dd class="num">{{ detail.deposit.amount }} {{ detail.deposit.coin }} <small class="muted">({{ t('fin.rawAmount') }} {{ detail.deposit.amountRaw }}, {{ t('fin.decimals') }} {{ detail.deposit.decimals }})</small></dd>
          <dt>{{ t('fin.status') }}</dt><dd><el-tag :type="statusType(detail.deposit.status)" size="small">{{ t('fin.dep.' + detail.deposit.status) }}</el-tag> <span class="muted">{{ reasonLabel(detail.deposit.reason) }}</span></dd>
          <dt>{{ t('fin.confirmations') }}</dt><dd class="num">{{ detail.deposit.confirmations }} / {{ detail.deposit.required }} · {{ t('fin.block') }} {{ detail.deposit.block ?? '—' }}</dd>
          <dt>{{ t('fin.tx') }}</dt><dd class="mono"><a v-if="detail.deposit.txUrl" :href="detail.deposit.txUrl" target="_blank" rel="noopener">{{ detail.deposit.txHash }}</a><span v-else>{{ detail.deposit.txHash }}</span> <small class="muted">#{{ detail.deposit.logIndex }}</small></dd>
          <dt>{{ t('fin.from') }}</dt><dd class="mono">{{ detail.deposit.from || '—' }}</dd>
          <dt>{{ t('fin.to') }}</dt><dd class="mono">{{ detail.deposit.to }}</dd>
          <dt>{{ t('fin.contract') }}</dt><dd class="mono">{{ detail.deposit.contract || '—' }}</dd>
          <dt>{{ t('fin.rate') }}</dt><dd class="num">{{ detail.deposit.rate ?? '—' }} <small class="muted">{{ t('fin.marketRate') }} {{ detail.deposit.marketRate ?? '—' }} · {{ detail.deposit.rateSource || '' }}</small></dd>
          <dt>{{ t('fin.credit') }}</dt><dd class="num">{{ detail.deposit.credit != null ? money(detail.deposit.credit) : '—' }} <small class="muted">{{ t('fin.fee') }} {{ detail.deposit.fee != null ? money(detail.deposit.fee) : '—' }}</small></dd>
          <dt>{{ t('fin.detectedAt') }}</dt><dd class="num">{{ dateTime(detail.deposit.detectedAt, true) }}</dd>
          <dt>{{ t('fin.creditedAt') }}</dt><dd class="num">{{ dateTime(detail.deposit.creditedAt, true) }}</dd>
          <dt>{{ t('fin.reviewer') }}</dt><dd>{{ detail.deposit.reviewer || '—' }} <span class="muted num">{{ dateTime(detail.deposit.reviewedAt) }}</span></dd>
          <dt>{{ t('fin.note') }}</dt><dd>{{ detail.deposit.note || '—' }}</dd>
          <dt>{{ t('fin.ledger') }}</dt><dd><div v-for="l in detail.ledger" :key="l.id" class="num">#{{ l.id }} +{{ money(l.amount) }} → {{ money(l.balanceAfter) }} · {{ dateTime(l.at) }}</div><span v-if="!detail.ledger.length">—</span></dd>
          <dt>{{ t('fin.commission') }}</dt><dd>{{ detail.commission ? money(detail.commission.amount) : '—' }}</dd>
        </dl>
      </template>
    </el-drawer>

    <el-dialog v-model="creditOpen" :title="t('fin.creditTitle')" width="440px">
      <p v-if="current" class="muted">#{{ current.id }} · {{ current.amount }} {{ current.coin }} · {{ current.user.name }}</p>
      <el-form label-position="top">
        <el-form-item :label="t('fin.creditRm')"><el-input-number v-model="creditForm.amountRm" :min="0" :precision="2" :step="10" style="width: 100%" /></el-form-item>
        <el-form-item :label="t('fin.reasonLabel')" required><el-input v-model="creditForm.reason" type="textarea" :rows="2" maxlength="400" show-word-limit /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="creditOpen = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="busy" :disabled="!creditForm.reason.trim()" @click="doCredit">{{ t('common.confirm') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="closeOpen" :title="t('fin.closeTitle')" width="440px">
      <el-input v-model="closeReason" type="textarea" :rows="3" maxlength="400" show-word-limit :placeholder="t('fin.reasonLabel')" />
      <template #footer>
        <el-button @click="closeOpen = false">{{ t('common.cancel') }}</el-button>
        <el-button type="danger" :loading="busy" :disabled="!closeReason.trim()" @click="doClose">{{ t('common.confirm') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="manualOpen" :title="t('fin.manualTitle')" width="480px">
      <el-form label-position="top">
        <el-form-item :label="t('fin.userId')" required><el-input-number v-model="manual.userId" :min="1" :controls="false" style="width: 100%" /></el-form-item>
        <el-form-item :label="t('fin.asset')" required><el-select v-model="manual.asset" style="width: 100%"><el-option v-for="a in assets" :key="a" :value="a" :label="a" /></el-select></el-form-item>
        <el-form-item :label="t('fin.tx')" required><el-input v-model="manual.txHash" class="mono" /></el-form-item>
        <el-form-item :label="t('fin.amount')" required><el-input-number v-model="manual.amount" :min="0" :precision="8" :controls="false" style="width: 100%" /></el-form-item>
        <el-form-item :label="t('fin.creditRm')"><el-input-number v-model="manual.amountRm" :min="0" :precision="2" :controls="false" style="width: 100%" /></el-form-item>
        <el-form-item :label="t('fin.reasonLabel')" required><el-input v-model="manual.reason" type="textarea" :rows="2" maxlength="400" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="manualOpen = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="busy" :disabled="!manual.userId || !manual.asset || !manual.txHash || !manual.amount || !manual.reason.trim()" @click="doManual">{{ t('common.confirm') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="simOpen" :title="t('fin.simulateTitle')" width="460px">
      <el-alert type="warning" :closable="false" show-icon :title="t('fin.simulateHint')" />
      <el-form label-position="top" style="margin-top: 12px">
        <el-form-item :label="t('fin.user')" required><el-input v-model="sim.user" placeholder="88002688" /></el-form-item>
        <el-form-item :label="t('fin.asset')" required><el-select v-model="sim.asset" style="width: 100%"><el-option v-for="a in assets" :key="a" :value="a" :label="a" /></el-select></el-form-item>
        <el-form-item :label="t('fin.amount')" required><el-input-number v-model="sim.amount" :min="0" :precision="8" :step="10" style="width: 100%" /></el-form-item>
        <el-checkbox v-model="sim.instant">{{ t('fin.instant') }}</el-checkbox>
      </el-form>
      <template #footer>
        <el-button @click="simOpen = false">{{ t('common.cancel') }}</el-button>
        <el-button type="warning" :loading="busy" :disabled="!sim.user || !sim.asset || !sim.amount" @click="doSimulate">{{ t('common.confirm') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onBeforeUnmount, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Download as IconDownload } from '@element-plus/icons-vue';
import { api } from '../../core/api';
import { t, pick } from '../../core/i18n';
import { dateTime, money, number } from '../../core/format';
import UserCell from '../../components/UserCell.vue';
import Pager from '../../components/Pager.vue';
import { useFinList } from './finList';

const route = useRoute();
const statuses = ['detected', 'confirming', 'credited', 'belowMinimum', 'unknown', 'review', 'closed'];
const assets = ref(['USDT-TRC20', 'USDT-ERC20', 'USDT-BEP20', 'USDC-ERC20', 'USDC-BEP20', 'ETH-ERC20', 'BTC-BTC']);
const list = useFinList('finance/deposits', { q: '', status: route.query.status || '', network: '', asset: '', tx: '', simulated: null, range: null });
api.get('finance/crypto/status', undefined, { quiet: true }).then(r => (assets.value = r.assets.map(a => a.code))).catch(() => {});
// Confirmations move while the page is open.
const timer = setInterval(() => {
  if (!document.hidden && list.items.value.some(r => r.status === 'detected' || r.status === 'confirming')) list.load();
}, 8000);
onBeforeUnmount(() => clearInterval(timer));

const statusType = s => ({ credited: 'success', confirming: 'primary', detected: 'primary', closed: 'info', belowMinimum: 'warning', unknown: 'danger', review: 'warning' })[s] || 'info';
const reasonLabel = r => (r ? (t('fin.reason.' + r) === 'fin.reason.' + r ? r : t('fin.reason.' + r)) : '');
const short = h => (h && h.length > 20 ? h.slice(0, 10) + '…' + h.slice(-8) : h);
const busy = ref(false);

const detailOpen = ref(false);
const detail = ref(null);
async function openDetail(row) {
  detail.value = await api.get('finance/deposits/' + row.id);
  detailOpen.value = true;
}
async function recheck(row) {
  const r = await api.post(`finance/deposits/${row.id}/recheck`);
  ElMessage.success(t('fin.recheckDone', { status: t('fin.dep.' + r.status), n: r.confirmations, m: r.required }));
  list.load();
}
const current = ref(null);
const creditOpen = ref(false);
const creditForm = reactive({ amountRm: undefined, reason: '' });
function openCredit(row) {
  current.value = row;
  Object.assign(creditForm, { amountRm: undefined, reason: '' });
  creditOpen.value = true;
}
async function doCredit() {
  busy.value = true;
  try {
    const r = await api.post(`finance/deposits/${current.value.id}/credit`, { amountRm: creditForm.amountRm || null, reason: creditForm.reason });
    ElMessage.success(t('fin.credited', { money: money(r.credit) }));
    creditOpen.value = false;
    list.load();
  } finally {
    busy.value = false;
  }
}
const closeOpen = ref(false);
const closeReason = ref('');
function openClose(row) {
  current.value = row;
  closeReason.value = '';
  closeOpen.value = true;
}
async function doClose() {
  busy.value = true;
  try {
    await api.post(`finance/deposits/${current.value.id}/close`, { reason: closeReason.value });
    ElMessage.success(t('common.done'));
    closeOpen.value = false;
    list.load();
  } finally {
    busy.value = false;
  }
}
const manualOpen = ref(false);
const manual = reactive({ userId: undefined, asset: 'USDT-TRC20', txHash: '', amount: undefined, amountRm: undefined, reason: '' });
async function doManual() {
  busy.value = true;
  try {
    const r = await api.post('finance/deposits/manual', { ...manual, amountRm: manual.amountRm || null });
    ElMessage.success(t('fin.credited', { money: money(r.credit) }));
    manualOpen.value = false;
    list.load();
  } finally {
    busy.value = false;
  }
}
const simOpen = ref(false);
const sim = reactive({ user: '', asset: 'USDT-TRC20', amount: 50, instant: false });
async function doSimulate() {
  busy.value = true;
  try {
    const r = await api.post('finance/deposits/simulate', { ...sim });
    ElMessage.success(t('fin.simulateDone', { id: r.id, status: t('fin.dep.' + r.status) }));
    simOpen.value = false;
    list.load();
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.sums { margin: 0 0 8px; font-size: 13px; }
.ml { margin-left: 6px; }
.small { font-size: 12px; }
.block { display: block; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; word-break: break-all; }
</style>
