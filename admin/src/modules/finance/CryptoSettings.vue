<template>
  <div class="page" v-loading="loading">
    <div class="page-head">
      <h1>{{ pick($route.meta.title, 'zh') }}</h1>
      <el-tag :type="st.enabled ? 'success' : 'info'">{{ t('fin.crypto.enabled') }}：{{ st.enabled ? t('fin.crypto.on') : t('fin.crypto.off') }}</el-tag>
      <div class="spacer" />
      <el-button :icon="IconRefresh" @click="load">{{ t('common.refresh') }}</el-button>
      <el-button v-can="'finance.deposits'" type="primary" :loading="scanning" @click="scan">{{ t('fin.crypto.scan') }}</el-button>
    </div>

    <!-- wallet keys -->
    <div class="panel">
      <h3 class="panel-title">{{ t('fin.crypto.keys') }}</h3>
      <el-alert type="error" :closable="false" show-icon :title="t('fin.crypto.keysWarn')" style="margin-bottom: 14px" />
      <div class="keys">
        <div v-for="c in chains" :key="c.chain" class="key-card">
          <div class="key-head">
            <b>{{ c.title }}</b>
            <span class="mono muted">{{ st.keys?.[c.chain]?.path }}</span>
            <el-tag v-if="st.keys?.[c.chain]?.configured && st.keys[c.chain].valid" type="success" size="small">{{ t('fin.crypto.current') }}</el-tag>
            <el-tag v-else-if="st.keys?.[c.chain]?.configured" type="danger" size="small">{{ errText(st.keys[c.chain].error) }}</el-tag>
            <el-tag v-else type="info" size="small">{{ t('fin.crypto.notSet') }}</el-tag>
          </div>
          <template v-if="st.keys?.[c.chain]?.valid">
            <div class="mono small break">{{ st.keys[c.chain].value }}</div>
            <div class="small muted">{{ t('fin.crypto.keyId') }} {{ st.keys[c.chain].keyId }} · {{ t('fin.crypto.depth') }} {{ st.keys[c.chain].depth }}</div>
            <el-alert v-if="st.keys[c.chain].depth !== 3" type="warning" :closable="false" :title="t('fin.crypto.depthWarn', { path: st.keys[c.chain].path })" class="mt" />
            <div class="small">{{ t('fin.crypto.first') }}：</div>
            <div v-for="(a, i) in st.keys[c.chain].first" :key="a" class="mono small">0/{{ i }} {{ a }}</div>
          </template>
          <template v-if="can('finance.settings')">
            <el-input v-model="edit[c.chain]" type="textarea" :rows="2" class="mono mt" :placeholder="t('fin.crypto.replace') + ' (' + c.hint + ')'" autocomplete="off" spellcheck="false" />
            <div v-if="preview[c.chain]" class="preview">
              <div class="small muted">{{ t('fin.crypto.keyId') }} {{ preview[c.chain].keyId }} · {{ t('fin.crypto.depth') }} {{ preview[c.chain].depth }}</div>
              <div v-for="(a, i) in preview[c.chain].first" :key="a" class="mono small">0/{{ i }} {{ a }}</div>
            </div>
            <div class="key-actions">
              <el-button size="small" :disabled="!edit[c.chain]?.trim()" @click="doPreview(c.chain)">{{ t('fin.crypto.preview') }}</el-button>
              <el-button size="small" type="primary" :disabled="!edit[c.chain]?.trim()" @click="save(c.chain, edit[c.chain])">{{ t('fin.crypto.save') }}</el-button>
              <el-button v-if="st.keys?.[c.chain]?.configured" size="small" type="danger" plain @click="save(c.chain, '')">{{ t('fin.crypto.clear') }}</el-button>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- networks -->
    <div class="panel">
      <h3 class="panel-title">{{ t('fin.crypto.networks') }}</h3>
      <el-table :data="st.networks || []" size="small">
        <el-table-column prop="network" :label="t('fin.network')" width="90" />
        <el-table-column :label="t('fin.crypto.enabled')" width="80"><template #default="{ row }"><el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? t('fin.crypto.on') : t('fin.crypto.off') }}</el-tag></template></el-table-column>
        <el-table-column :label="t('fin.confirmations')" prop="confirmations" width="90" />
        <el-table-column :label="t('fin.crypto.key')" width="70"><template #default="{ row }">{{ row.keyConfigured ? '✓' : '—' }}</template></el-table-column>
        <el-table-column :label="t('fin.crypto.provider')" width="70"><template #default="{ row }">{{ row.providerConfigured ? '✓' : '—' }}</template></el-table-column>
        <el-table-column :label="t('fin.crypto.watched')" prop="watched" width="90" />
        <el-table-column :label="t('fin.crypto.open')" prop="open" width="80" />
        <el-table-column :label="t('fin.crypto.tip')" width="110"><template #default="{ row }"><span class="num">{{ row.tip || '—' }}</span></template></el-table-column>
        <el-table-column :label="t('fin.crypto.lastRun')" width="140"><template #default="{ row }"><span class="num">{{ dateTime(row.lastRunAt) }}</span></template></el-table-column>
        <el-table-column :label="t('fin.crypto.lastError')" min-width="220"><template #default="{ row }"><span class="neg small">{{ row.lastError === 'notConfigured' ? t('fin.crypto.needKey') : row.lastError }}</span></template></el-table-column>
      </el-table>
    </div>

    <!-- rates -->
    <div class="panel">
      <h3 class="panel-title">{{ t('fin.crypto.rates') }} <el-tag size="small">{{ t('fin.crypto.mode') }}：{{ st.rates?.mode === 'fixed' ? t('fin.crypto.fixed') : t('fin.crypto.market') }}</el-tag>
        <el-button size="small" link type="primary" @click="refreshRates">{{ t('fin.crypto.refresh') }}</el-button></h3>
      <el-table :data="st.rates?.items || []" size="small">
        <el-table-column prop="coin" :label="t('fin.asset')" width="90" />
        <el-table-column :label="t('fin.marketRate')" align="right"><template #default="{ row }"><span class="num">{{ row.market != null ? money(row.market) : '—' }}</span></template></el-table-column>
        <el-table-column :label="t('fin.crypto.used')" align="right"><template #default="{ row }"><span class="num">{{ row.used != null ? money(row.used) : '—' }}</span></template></el-table-column>
        <el-table-column :label="t('fin.rateSource')" prop="source" width="100" />
        <el-table-column :label="t('common.time')" width="150"><template #default="{ row }"><span class="num">{{ dateTime(row.at) }}</span></template></el-table-column>
      </el-table>
      <p v-if="st.rates?.lastError" class="neg small">{{ t('fin.crypto.lastError') }}：{{ st.rates.lastError }}</p>
    </div>

    <!-- assets -->
    <div class="panel">
      <h3 class="panel-title">{{ t('fin.crypto.assets') }}
        <el-button v-can="'finance.settings'" size="small" link type="primary" @click="addOpen = true">{{ t('fin.crypto.addAsset') }}</el-button></h3>
      <el-table :data="assets" size="small">
        <el-table-column prop="code" label="Code" width="120" />
        <el-table-column :label="t('fin.crypto.available')" width="70"><template #default="{ row }">{{ row.available ? '✓' : '—' }}</template></el-table-column>
        <el-table-column :label="t('fin.crypto.enabled')" width="70"><template #default="{ row }"><el-switch v-model="row.enabled" size="small" :disabled="!can('finance.settings')" /></template></el-table-column>
        <el-table-column :label="t('fin.contract')" min-width="230"><template #default="{ row }"><el-input v-model="row.contract" size="small" class="mono" :disabled="!can('finance.settings') || row.network === 'BTC'" /></template></el-table-column>
        <el-table-column :label="t('fin.decimals')" width="90"><template #default="{ row }"><el-input-number v-model="row.decimals" size="small" :min="0" :max="30" :controls="false" style="width: 60px" :disabled="!can('finance.settings')" /></template></el-table-column>
        <el-table-column :label="t('fin.crypto.minDeposit')" width="120"><template #default="{ row }"><el-input v-model="row.minDeposit" size="small" :disabled="!can('finance.settings')" /></template></el-table-column>
        <el-table-column :label="t('fin.crypto.feePct')" width="100"><template #default="{ row }"><el-input-number v-model="row.feePct" size="small" :min="0" :max="50" :precision="2" :controls="false" style="width: 70px" :disabled="!can('finance.settings')" /></template></el-table-column>
        <el-table-column :label="t('fin.crypto.priceId')" width="110"><template #default="{ row }"><el-input v-model="row.priceId" size="small" :disabled="!can('finance.settings')" /></template></el-table-column>
        <el-table-column :label="t('fin.crypto.stable')" width="70"><template #default="{ row }"><el-checkbox v-model="row.stable" :disabled="!can('finance.settings')" /></template></el-table-column>
        <el-table-column :label="t('fin.crypto.sort')" width="80"><template #default="{ row }"><el-input-number v-model="row.sortOrder" size="small" :controls="false" style="width: 56px" :disabled="!can('finance.settings')" /></template></el-table-column>
        <el-table-column width="80" fixed="right"><template #default="{ row }"><el-button v-can="'finance.settings'" size="small" type="primary" link @click="saveAsset(row)">{{ t('fin.crypto.saveRow') }}</el-button></template></el-table-column>
      </el-table>
    </div>

    <ConfigForm v-if="can('finance.settings')" :groups="['crypto', 'cryptoApi']" endpoint="finance/config" perm="finance.settings" @saved="load" />

    <el-dialog v-model="addOpen" :title="t('fin.crypto.addAsset')" width="440px">
      <el-form label-position="top">
        <el-form-item :label="t('fin.crypto.coin')"><el-input v-model="nw.coin" placeholder="USDT" /></el-form-item>
        <el-form-item :label="t('fin.network')"><el-select v-model="nw.network" style="width: 100%"><el-option v-for="n in ['ERC20', 'BEP20', 'TRC20', 'BTC']" :key="n" :value="n" :label="n" /></el-select></el-form-item>
        <el-form-item :label="t('fin.contract')"><el-input v-model="nw.contract" class="mono" /></el-form-item>
        <el-form-item :label="t('fin.decimals')"><el-input-number v-model="nw.decimals" :min="0" :max="30" /></el-form-item>
        <el-form-item :label="t('fin.crypto.minDeposit')"><el-input v-model="nw.minDeposit" /></el-form-item>
        <el-form-item :label="t('fin.crypto.priceId')"><el-input v-model="nw.priceId" placeholder="tether" /></el-form-item>
        <el-checkbox v-model="nw.stable">{{ t('fin.crypto.stable') }}</el-checkbox>
      </el-form>
      <template #footer>
        <el-button @click="addOpen = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :disabled="!nw.coin || !nw.network" @click="addAsset">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus';
import { Refresh as IconRefresh } from '@element-plus/icons-vue';
import { api, errorText } from '../../core/api';
import { t, pick } from '../../core/i18n';
import { can } from '../../core/auth';
import { dateTime, money } from '../../core/format';
import ConfigForm from '../../components/ConfigForm.vue';

const chains = [
  { chain: 'EVM', title: 'ETH / BSC（ERC-20、BEP-20）', hint: 'xpub…' },
  { chain: 'TRON', title: 'TRON（TRC-20）', hint: 'xpub…' },
  { chain: 'BTC', title: 'Bitcoin（bc1…）', hint: 'zpub…' },
];
const loading = ref(false);
const scanning = ref(false);
const st = ref({});
const assets = ref([]);
const edit = reactive({ EVM: '', TRON: '', BTC: '' });
const preview = reactive({});
const errText = code => errorText({ code });

async function load() {
  loading.value = true;
  try {
    st.value = await api.get('finance/crypto/status');
    assets.value = st.value.assets.map(a => ({ ...a }));
  } finally {
    loading.value = false;
  }
}
async function doPreview(chain) {
  preview[chain] = await api.post('finance/crypto/preview', { chain, xpub: edit[chain].trim() });
}
async function save(chain, value) {
  if (st.value.keys?.[chain]?.configured)
    await ElMessageBox.confirm(t('fin.crypto.changeWarn'), { type: 'warning' });
  await api.put('finance/crypto/keys', { [chain.toLowerCase()]: value.trim() });
  ElMessage.success(t('fin.crypto.saved', { days: 7 }));
  edit[chain] = '';
  delete preview[chain];
  load();
}
async function saveAsset(row) {
  await api.put('finance/crypto/assets/' + row.code, {
    contract: row.contract || null, decimals: row.decimals, minDeposit: Number(row.minDeposit), feePct: row.feePct,
    priceId: row.priceId, stable: row.stable, enabled: row.enabled, sortOrder: row.sortOrder,
  });
  ElMessage.success(t('common.saved'));
  load();
}
const addOpen = ref(false);
const nw = reactive({ coin: '', network: 'TRC20', contract: '', decimals: 6, minDeposit: '10', priceId: '', stable: true });
async function addAsset() {
  const code = `${nw.coin.trim().toUpperCase()}-${nw.network}`;
  await api.put('finance/crypto/assets/' + code, { ...nw, coin: nw.coin.trim().toUpperCase(), minDeposit: Number(nw.minDeposit), contract: nw.contract || null, enabled: false });
  ElMessage.success(t('common.saved'));
  addOpen.value = false;
  load();
}
async function scan() {
  scanning.value = true;
  try {
    const r = await api.post('finance/crypto/scan', {});
    ElNotification.info({ title: t('fin.crypto.scanDone'), message: r.report.map(x => `${x.network}: ${x.error || (x.idle ? 'idle' : `${x.scanned ?? 0} / ${x.found ?? 0}`)}`).join('\n') });
    load();
  } finally {
    scanning.value = false;
  }
}
async function refreshRates() {
  const r = await api.post('finance/crypto/rates/refresh');
  if (!r.ok) ElMessage.warning(r.error || 'error');
  load();
}
load();
</script>

<style scoped>
.keys { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
.key-card { border: 1px solid var(--el-border-color-lighter); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.key-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.key-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.preview { background: var(--el-fill-color-light); border-radius: 6px; padding: 6px 8px; }
.mono { font-family: var(--font-mono); }
.mono :deep(textarea), .mono :deep(input) { font-family: var(--font-mono); font-size: 12px; }
.small { font-size: 12px; }
.break { word-break: break-all; }
.mt { margin-top: 6px; }
</style>
