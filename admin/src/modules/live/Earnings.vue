<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('live.earnings') }}</h1>
      <el-radio-group v-model="list.filters.status" @change="list.search">
        <el-radio-button value="">{{ t('live.all') }}</el-radio-button>
        <el-radio-button value="held">{{ t('live.earnStatus.0') }}</el-radio-button>
        <el-radio-button value="released">{{ t('live.earnStatus.1') }}</el-radio-button>
      </el-radio-group>
      <div class="spacer" />
      <el-button v-can="'live.manage'" @click="releaseDue">{{ t('live.releaseDue') }}</el-button>
    </div>
    <div v-if="sums" class="grid-cards">
      <StatCard :label="t('live.sumHeld')" :value="sums.held" unit="RM" />
      <StatCard :label="t('live.sumReleased')" :value="sums.released" unit="RM" />
    </div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('common.keyword')" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-select v-model="list.filters.source" clearable :placeholder="t('common.type')" @change="list.search">
          <el-option v-for="s in ['live', 'private-gift', 'private-call']" :key="s" :value="s" :label="t('live.source.' + s)" />
        </el-select>
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
      </div>
      <el-table v-loading="list.loading.value" :data="list.items.value" stripe size="small">
        <el-table-column :label="t('live.host')" min-width="160"><template #default="{ row }"><UserCell :id="row.hostId" :name="row.hostName" :avatar="row.hostAvatar" :display-id="row.hostDisplayId" :size="24" /></template></el-table-column>
        <el-table-column :label="t('common.type')" width="110"><template #default="{ row }">{{ t('live.source.' + row.source) }}<div class="muted num">{{ row.sourceId }}</div></template></el-table-column>
        <el-table-column :label="t('live.from')" min-width="130"><template #default="{ row }">{{ row.fromName || '—' }}<small class="muted num"> {{ row.fromDisplayId }}</small></template></el-table-column>
        <el-table-column :label="t('live.gross')" width="120" align="right">
          <template #default="{ row }"><span class="num">{{ money(row.gross) }}</span><div v-if="row.grossBeans" class="muted num">{{ number(row.grossBeans) }} {{ t('live.beans') }}</div></template>
        </el-table-column>
        <el-table-column :label="t('live.share')" width="70" align="right"><template #default="{ row }"><span class="num">{{ Math.round(row.share * 100) }}%</span></template></el-table-column>
        <el-table-column :label="t('live.amount')" width="110" align="right"><template #default="{ row }"><b class="num">{{ money(row.amount) }}</b></template></el-table-column>
        <el-table-column :label="t('common.status')" width="100"><template #default="{ row }"><el-tag size="small" :type="row.status === 1 ? 'success' : row.status === 0 ? 'warning' : 'info'">{{ t('live.earnStatus.' + row.status) }}</el-tag></template></el-table-column>
        <el-table-column :label="t('common.createdAt')" width="140"><template #default="{ row }"><span class="num">{{ dateTime(row.createdAt) }}</span></template></el-table-column>
        <el-table-column :label="t('live.releaseAt')" width="140"><template #default="{ row }"><span class="num">{{ dateTime(row.releasedAt || row.releaseAt) }}</span></template></el-table-column>
      </el-table>
      <Pager :list="list" />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { useList } from '../../core/list';
import { dateTime, money, number } from '../../core/format';
import Pager from '../../components/Pager.vue';
import UserCell from '../../components/UserCell.vue';
import StatCard from '../../components/StatCard.vue';

const sums = ref(null);
const list = useList('live/earnings', { status: '', source: '', q: '' }, { auto: false });
const origLoad = list.load;
list.load = async () => {
  await origLoad();
  const q = list.query();
  q.size = 1;
  sums.value = (await api.get('live/earnings', q, { quiet: true }).catch(() => null))?.sums || null;
};
list.load();
async function releaseDue() {
  const res = await api.post('live/earnings/release-due');
  ElMessage.success(t('live.releasedN', { n: res.released }));
  list.load();
}
</script>
