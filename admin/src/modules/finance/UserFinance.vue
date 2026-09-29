<template>
  <div v-loading="loading" class="user-fin">
    <h4>{{ t('fin.tab.deposits') }}</h4>
    <el-table :data="d.deposits || []" size="small" empty-text="—">
      <el-table-column :label="t('common.time')" width="140"><template #default="{ row }"><span class="num">{{ dateTime(row.time) }}</span></template></el-table-column>
      <el-table-column :label="t('fin.asset')" width="140"><template #default="{ row }">{{ row.amount }} {{ row.coin }} <small class="muted">{{ row.network }}</small></template></el-table-column>
      <el-table-column :label="t('fin.status')" width="140"><template #default="{ row }">{{ t('fin.dep.' + row.status) }} <small class="muted">{{ row.confirmations }}/{{ row.required }}</small></template></el-table-column>
      <el-table-column :label="t('fin.credit')" align="right"><template #default="{ row }"><span class="num">{{ row.credit != null ? money(row.credit) : '—' }}</span></template></el-table-column>
      <el-table-column :label="t('fin.tx')" min-width="160"><template #default="{ row }"><a v-if="row.txUrl" :href="row.txUrl" target="_blank" rel="noopener" class="mono">{{ row.txHash }}</a><span v-else class="mono muted">{{ row.txHash }}</span></template></el-table-column>
    </el-table>

    <h4>{{ t('fin.tab.withdrawals') }}</h4>
    <el-table :data="d.withdrawals || []" size="small" empty-text="—">
      <el-table-column :label="t('common.time')" width="140"><template #default="{ row }"><span class="num">{{ dateTime(row.time) }}</span></template></el-table-column>
      <el-table-column :label="t('common.amount')" align="right" width="110"><template #default="{ row }"><span class="num">{{ money(row.amount) }}</span></template></el-table-column>
      <el-table-column :label="t('fin.source')" width="70"><template #default="{ row }">{{ row.source === 'income' ? t('fin.sourceIncome') : t('fin.sourceWallet') }}</template></el-table-column>
      <el-table-column :label="t('fin.account')" min-width="200"><template #default="{ row }">{{ row.account?.provider }} <span class="mono">{{ row.account?.accountNo }}</span></template></el-table-column>
      <el-table-column :label="t('fin.status')" width="150"><template #default="{ row }">{{ t('fin.wd.' + row.status) }} <small class="muted">{{ row.payRef || row.reason }}</small></template></el-table-column>
    </el-table>

    <h4>{{ t('fin.tab.topups') }}</h4>
    <el-table :data="d.topups || []" size="small" empty-text="—">
      <el-table-column :label="t('common.time')" width="140"><template #default="{ row }"><span class="num">{{ dateTime(row.time) }}</span></template></el-table-column>
      <el-table-column :label="t('common.amount')" align="right" width="110"><template #default="{ row }"><span class="num">{{ money(row.amount) }}</span></template></el-table-column>
      <el-table-column :label="t('fin.reference')" min-width="140" prop="reference" />
      <el-table-column :label="t('fin.status')" width="140"><template #default="{ row }">{{ t('fin.tp.' + row.status) }}</template></el-table-column>
    </el-table>

    <div class="two">
      <div>
        <h4>{{ t('fin.tab.addresses') }}</h4>
        <el-table :data="d.addresses || []" size="small" empty-text="—">
          <el-table-column prop="chain" :label="t('fin.chain')" width="70" />
          <el-table-column :label="t('fin.index')" width="60" prop="index" />
          <el-table-column :label="t('fin.to')"><template #default="{ row }"><span class="mono">{{ row.address }}</span></template></el-table-column>
        </el-table>
        <h4>{{ t('fin.tab.accounts') }}</h4>
        <el-table :data="d.accounts || []" size="small" empty-text="—">
          <el-table-column prop="kind" :label="t('fin.kind')" width="80" />
          <el-table-column prop="provider" :label="t('fin.account')" width="130" />
          <el-table-column :label="t('fin.to')"><template #default="{ row }"><span class="mono">{{ row.accountNo }}</span> <small class="muted">{{ row.accountName }}</small></template></el-table-column>
        </el-table>
      </div>
      <div>
        <h4>{{ t('fin.tab.checkins') }}</h4>
        <el-table :data="d.checkins || []" size="small" empty-text="—" max-height="260">
          <el-table-column prop="day" :label="t('fin.day')" width="110" />
          <el-table-column prop="streak" label="Streak" width="80" />
          <el-table-column prop="reward" :label="t('fin.bean')" />
        </el-table>
        <h4>{{ t('fin.tab.claims') }}</h4>
        <el-table :data="d.claims || []" size="small" empty-text="—">
          <el-table-column prop="task" :label="t('fin.kind')" width="90" />
          <el-table-column prop="reward" :label="t('fin.bean')" width="80" />
          <el-table-column :label="t('common.time')"><template #default="{ row }"><span class="num">{{ dateTime(row.at) }}</span></template></el-table-column>
        </el-table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { dateTime, money } from '../../core/format';

const props = defineProps({ userId: [Number, String] });
const d = ref({});
const loading = ref(false);
async function load() {
  loading.value = true;
  try {
    d.value = await api.get('finance/users/' + props.userId);
  } finally {
    loading.value = false;
  }
}
load();
</script>

<style scoped>
h4 { margin: 16px 0 8px; font-size: 14px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.mono { font-family: var(--font-mono); font-size: 12px; word-break: break-all; }
@media (max-width: 900px) { .two { grid-template-columns: 1fr; } }
</style>
