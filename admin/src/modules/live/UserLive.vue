<template>
  <div v-loading="loading">
    <div class="grid-cards">
      <StatCard :label="t('live.held')" :value="data.earnings?.held" unit="RM" />
      <StatCard :label="t('live.released')" :value="data.earnings?.released" unit="RM" />
      <StatCard :label="t('live.lives')" :value="(data.sessions || []).length" />
      <StatCard :label="t('live.calls')" :value="(data.calls || []).length" />
    </div>
    <template v-if="data.host">
      <h4>{{ t('live.user.hostProfile') }}</h4>
      <dl class="kv">
        <dt>{{ t('common.status') }}</dt><dd>{{ t('live.status.' + data.host.status) }}<span v-if="data.host.accepting"> · {{ t('live.accepting') }}</span></dd>
        <dt>{{ t('live.rate') }}</dt><dd class="num">{{ money(data.host.rate) }}</dd>
        <dt>{{ t('live.liveShare') }}</dt><dd>{{ pct(data.host.liveShare) }}</dd>
        <dt>{{ t('live.privateShare') }}</dt><dd>{{ pct(data.host.privateShare) }}</dd>
        <dt>{{ t('common.remark') }}</dt><dd>{{ data.host.intro || '—' }}</dd>
      </dl>
    </template>
    <h4>{{ t('live.user.sessions') }}</h4>
    <el-table :data="data.sessions || []" size="small">
      <el-table-column :label="t('live.title')" min-width="160"><template #default="{ row }">{{ row.title }} <small class="muted">{{ row.topic }}</small></template></el-table-column>
      <el-table-column :label="t('live.started')" width="150"><template #default="{ row }"><span class="num">{{ dateTime(row.startedAt) }}</span></template></el-table-column>
      <el-table-column :label="t('common.status')" width="110"><template #default="{ row }">{{ row.status === 0 ? t('live.live') : t('live.reason.' + (row.endReason || 'host')) }}</template></el-table-column>
      <el-table-column :label="t('live.peak')" width="70" align="right" prop="peakViewers" />
      <el-table-column :label="t('live.gifts')" width="100" align="right"><template #default="{ row }"><span class="num">{{ number(row.giftBeans) }}</span></template></el-table-column>
      <el-table-column :label="t('live.income')" width="100" align="right"><template #default="{ row }"><span class="num">{{ money(row.income, '') }}</span></template></el-table-column>
    </el-table>
    <h4>{{ t('live.user.calls') }}</h4>
    <el-table :data="data.calls || []" size="small">
      <el-table-column :label="t('common.time')" width="150"><template #default="{ row }"><span class="num">{{ dateTime(row.ringAt) }}</span></template></el-table-column>
      <el-table-column :label="t('common.type')" width="80"><template #default="{ row }">{{ t('live.user.role.' + row.role) }}</template></el-table-column>
      <el-table-column :label="t('common.user')" min-width="130"><template #default="{ row }">{{ row.otherName }} <small class="muted num">{{ row.otherDisplayId }}</small></template></el-table-column>
      <el-table-column :label="t('live.duration')" width="80" align="right"><template #default="{ row }"><span class="num">{{ Math.floor(row.seconds / 60) }}:{{ String(row.seconds % 60).padStart(2, '0') }}</span></template></el-table-column>
      <el-table-column :label="t('live.cost')" width="100" align="right"><template #default="{ row }"><span class="num">{{ money(row.cost, '') }}</span></template></el-table-column>
      <el-table-column :label="t('common.status')" width="110"><template #default="{ row }">{{ row.reason ? t('live.endReason.' + row.reason) : t('live.callStatus.' + row.status) }}</template></el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { dateTime, money, number } from '../../core/format';
import StatCard from '../../components/StatCard.vue';

const props = defineProps({ userId: [Number, String] });
const data = ref({});
const loading = ref(false);
const pct = v => (v === null || v === undefined ? t('live.defaultShare') : Math.round(v * 100) + '%');
(async () => {
  loading.value = true;
  try {
    data.value = await api.get(`users/${props.userId}/live`);
  } finally {
    loading.value = false;
  }
})();
</script>

<style scoped>
h4 { margin: 16px 0 8px; }
</style>
