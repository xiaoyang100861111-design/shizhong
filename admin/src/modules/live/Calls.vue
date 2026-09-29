<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('live.callsTitle') }}</h1>
      <el-radio-group v-model="list.filters.status" @change="list.search">
        <el-radio-button value="">{{ t('live.all') }}</el-radio-button>
        <el-radio-button value="active">{{ t('live.active') }}</el-radio-button>
        <el-radio-button value="ended">{{ t('live.ended') }}</el-radio-button>
      </el-radio-group>
      <div class="spacer" />
      <span v-if="sums" class="muted">{{ t('live.cost') }} {{ money(sums.cost) }} · {{ number(sums.beans) }} {{ t('live.beans') }}</span>
    </div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('common.keyword')" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
      </div>
      <el-table v-loading="list.loading.value" :data="list.items.value" stripe>
        <el-table-column :label="t('live.caller')" min-width="160"><template #default="{ row }"><UserCell :id="row.caller.id" :name="row.caller.name" :avatar="row.caller.avatar" :display-id="row.caller.displayId" /></template></el-table-column>
        <el-table-column :label="t('live.host')" min-width="160">
          <template #default="{ row }"><UserCell :id="row.host.id" :name="row.host.name" :avatar="row.host.avatar" :display-id="row.host.displayId" /><el-tag v-if="row.demo" size="small" type="info">{{ t('live.demo') }}</el-tag></template>
        </el-table-column>
        <el-table-column :label="t('common.status')" width="120">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 2 ? 'info' : 'danger'">{{ t('live.callStatus.' + row.status) }}</el-tag>
            <div v-if="row.reason" class="muted">{{ t('live.endReason.' + row.reason) }}</div>
          </template>
        </el-table-column>
        <el-table-column :label="t('common.time')" width="150"><template #default="{ row }"><span class="num">{{ dateTime(row.ringAt) }}</span></template></el-table-column>
        <el-table-column :label="t('live.duration')" width="90" align="right"><template #default="{ row }"><span class="num">{{ clock(row.seconds) }}</span></template></el-table-column>
        <el-table-column :label="t('live.rate')" width="100" align="right"><template #default="{ row }"><span class="num">{{ money(row.rate, '') }}</span></template></el-table-column>
        <el-table-column :label="t('live.minutes')" width="90" align="right" prop="minutesPaid" />
        <el-table-column :label="t('live.cost')" width="110" align="right"><template #default="{ row }"><span class="num">{{ money(row.cost) }}</span></template></el-table-column>
        <el-table-column :label="t('live.gifts')" width="110" align="right"><template #default="{ row }"><span class="num">{{ number(row.giftBeans) }}</span></template></el-table-column>
        <el-table-column :label="t('common.actions')" width="100" fixed="right">
          <template #default="{ row }"><el-button v-if="row.status !== 2" v-can="'live.manage'" link type="danger" @click="end(row)">{{ t('live.end') }}</el-button></template>
        </el-table-column>
      </el-table>
      <Pager :list="list" />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { useList } from '../../core/list';
import { dateTime, money, number } from '../../core/format';
import Pager from '../../components/Pager.vue';
import UserCell from '../../components/UserCell.vue';

const sums = ref(null);
const list = useList('live/calls', { status: '', q: '' }, { auto: false });
const origLoad = list.load;
list.load = async () => {
  await origLoad();
  const q = list.query();
  q.size = 1;
  sums.value = (await api.get('live/calls', q, { quiet: true }).catch(() => null))?.sums || null;
};
list.load();
const clock = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
async function end(row) {
  await ElMessageBox.confirm(t('live.endConfirm'), { type: 'warning' });
  await api.post(`live/calls/${row.id}/end`);
  ElMessage.success(t('common.done'));
  list.load();
}
</script>
