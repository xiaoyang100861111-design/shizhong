<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ pick($route.meta.title, 'zh') }}</h1>
      <div class="spacer" />
      <el-button v-can="'finance.export'" :icon="IconDownload" @click="list.exportCsv('finance/crypto/addresses/export', 'crypto-addresses.csv')">{{ t('common.export') }}</el-button>
    </div>
    <div class="panel">
      <h3 class="panel-title">{{ t('fin.summary') }}</h3>
      <div class="sum-grid">
        <div>
          <p class="muted">{{ t('fin.creditedAll') }}</p>
          <el-table :data="summary.credited || []" size="small">
            <el-table-column prop="asset" :label="t('fin.asset')" />
            <el-table-column prop="count" :label="t('fin.count')" width="70" />
            <el-table-column :label="t('fin.amount')" align="right"><template #default="{ row }"><span class="num">{{ row.amount }}</span></template></el-table-column>
            <el-table-column :label="t('fin.credit')" align="right"><template #default="{ row }"><span class="num">{{ money(row.rm) }}</span></template></el-table-column>
          </el-table>
        </div>
        <div>
          <p class="muted">{{ t('fin.heldOnChain') }}</p>
          <el-table :data="summary.held || []" size="small">
            <el-table-column prop="asset" :label="t('fin.asset')" />
            <el-table-column prop="addresses" :label="t('fin.count')" width="70" />
            <el-table-column :label="t('fin.chainBalance')" align="right"><template #default="{ row }"><span class="num">{{ row.balance }}</span></template></el-table-column>
          </el-table>
        </div>
      </div>
      <p class="muted small">{{ t('fin.sweepHint') }}</p>
    </div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('fin.addressQ')" clearable style="width: 320px" @keyup.enter="list.search" @clear="list.search" />
        <el-select v-model="list.filters.chain" clearable :placeholder="t('fin.chain')" @change="list.search">
          <el-option v-for="c in ['EVM', 'TRON', 'BTC']" :key="c" :value="c" :label="c" />
        </el-select>
        <el-checkbox v-model="list.filters.withFunds" @change="list.search">{{ t('fin.received') }}</el-checkbox>
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
        <el-button @click="list.reset">{{ t('common.reset') }}</el-button>
      </div>
      <el-table v-loading="list.loading.value" :data="list.items.value" size="small" stripe>
        <el-table-column :label="t('common.user')" min-width="160"><template #default="{ row }"><UserCell :id="row.user.id" :name="row.user.name" :avatar="row.user.avatar" :display-id="row.user.displayId" :size="28" /></template></el-table-column>
        <el-table-column :label="t('fin.chain')" width="80" prop="chain" />
        <el-table-column :label="t('fin.path')" width="150"><template #default="{ row }"><span class="mono">{{ paths[row.chain] }}/0/{{ row.index }}</span><small class="muted block">{{ t('fin.crypto.keyId') }} {{ row.keyId }}</small></template></el-table-column>
        <el-table-column :label="t('fin.to')" min-width="260">
          <template #default="{ row }">
            <span class="mono">{{ row.address }}</span>
            <el-button link size="small" @click="copy(row.address)">{{ t('common.copy') }}</el-button>
            <a v-for="l in links(row)" :key="l.n" :href="l.url" target="_blank" rel="noopener" class="small ml">{{ l.n }}</a>
          </template>
        </el-table-column>
        <el-table-column :label="t('fin.received')" min-width="140"><template #default="{ row }"><div v-for="r in row.received" :key="r.asset" class="num small">{{ r.asset }} {{ r.amount }} ×{{ r.count }}</div><span v-if="!row.received.length" class="muted">—</span></template></el-table-column>
        <el-table-column :label="t('fin.chainBalance')" min-width="150">
          <template #default="{ row }"><div v-for="b in row.balances" :key="b.asset" class="num small">{{ b.asset }} {{ b.balance }} <span class="muted">{{ dateTime(b.at) }}</span></div><span v-if="!row.balances.length" class="muted">—</span></template>
        </el-table-column>
        <el-table-column :label="t('fin.lastViewed')" width="140"><template #default="{ row }"><span class="num">{{ dateTime(row.lastViewedAt) }}</span></template></el-table-column>
        <el-table-column :label="t('common.actions')" width="120" fixed="right">
          <template #default="{ row }"><el-button link type="primary" :loading="reading === row.id" @click="readBalance(row)">{{ t('fin.readBalance') }}</el-button></template>
        </el-table-column>
      </el-table>
      <Pager :list="list" />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { ElMessage, ElNotification } from 'element-plus';
import { Download as IconDownload } from '@element-plus/icons-vue';
import { api } from '../../core/api';
import { t, pick } from '../../core/i18n';
import { dateTime, money } from '../../core/format';
import UserCell from '../../components/UserCell.vue';
import Pager from '../../components/Pager.vue';
import { useFinList } from './finList';

const paths = { EVM: "m/44'/60'/0'", TRON: "m/44'/195'/0'", BTC: "m/84'/0'/0'" };
const list = useFinList('finance/crypto/addresses', { q: '', chain: '', withFunds: false });
const summary = ref({});
api.get('finance/crypto/summary').then(r => (summary.value = r));
const reading = ref(0);
function links(row) {
  if (row.chain === 'EVM') return [{ n: 'Etherscan', url: 'https://etherscan.io/address/' + row.address }, { n: 'BscScan', url: 'https://bscscan.com/address/' + row.address }];
  if (row.chain === 'TRON') return [{ n: 'Tronscan', url: 'https://tronscan.org/#/address/' + row.address }];
  return [{ n: 'mempool', url: 'https://mempool.space/address/' + row.address }];
}
async function readBalance(row) {
  reading.value = row.id;
  try {
    const r = await api.post(`finance/crypto/addresses/${row.id}/balances`);
    const errors = r.items.filter(i => i.error);
    if (errors.length) ElNotification.warning({ title: t('fin.readBalance'), message: errors.map(e => `${e.asset}: ${e.error}`).join('\n') });
    else ElMessage.success(t('fin.balanceRead'));
    list.load();
  } finally {
    reading.value = 0;
  }
}
async function copy(v) {
  await navigator.clipboard?.writeText(v || '').catch(() => {});
  ElMessage.success(t('common.copied'));
}
</script>

<style scoped>
.sum-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.block { display: block; }
.small { font-size: 12px; }
.ml { margin-left: 6px; }
.mono { font-family: var(--font-mono); font-size: 12px; word-break: break-all; }
@media (max-width: 900px) { .sum-grid { grid-template-columns: 1fr; } }
</style>
