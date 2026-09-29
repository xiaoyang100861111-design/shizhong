<template>
  <div class="page">
    <div class="page-head"><h1>{{ pick($route.meta.title, 'zh') }}</h1></div>
    <p class="page-sub">{{ t('growth.inviteNote') }}</p>
    <div class="grid-cards">
      <StatCard :label="t('growth.invitedRecent') + ' (30d)'" :value="stats.invitedRecent ?? 0" />
      <StatCard :label="t('growth.tasks.invite')" :value="rewarded" />
    </div>
    <div class="panel">
      <h3 class="panel-title">{{ t('growth.inviters') }}</h3>
      <el-table :data="stats.inviters || []" size="small">
        <el-table-column type="index" width="50" />
        <el-table-column :label="t('common.user')" min-width="180"><template #default="{ row }"><UserCell :id="row.id" :name="row.name" :avatar="row.avatar" :display-id="row.displayId" :size="28" /></template></el-table-column>
        <el-table-column :label="t('growth.invited')" prop="count" width="120" align="right" />
        <el-table-column :label="t('growth.lastAt')" width="160"><template #default="{ row }"><span class="num">{{ dateTime(row.lastAt) }}</span></template></el-table-column>
      </el-table>
    </div>
    <ConfigForm :groups="['invite']" endpoint="growth/config" perm="marketing.invite" />
    <ClaimsTable task="invite" />
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { api } from '../../core/api';
import { t, pick } from '../../core/i18n';
import { dateTime } from '../../core/format';
import StatCard from '../../components/StatCard.vue';
import ConfigForm from '../../components/ConfigForm.vue';
import UserCell from '../../components/UserCell.vue';
import ClaimsTable from './ClaimsTable.vue';

const stats = ref({});
api.get('growth/stats', { days: 30 }).then(r => (stats.value = r));
const rewarded = computed(() => stats.value.tasks?.find(x => x.task === 'invite')?.count ?? 0);
</script>
