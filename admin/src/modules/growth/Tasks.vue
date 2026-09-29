<template>
  <div class="page">
    <div class="page-head"><h1>{{ pick($route.meta.title, 'zh') }}</h1></div>
    <p class="page-sub">{{ t('growth.taskNote') }}</p>
    <div class="panel">
      <el-table :data="rows" size="small">
        <el-table-column :label="t('growth.task')"><template #default="{ row }">{{ t('growth.tasks.' + row.task) }}</template></el-table-column>
        <el-table-column prop="count" :label="t('growth.count')" width="120" align="right" />
        <el-table-column prop="recent" :label="t('growth.recent') + ' (30d)'" width="140" align="right" />
        <el-table-column :label="t('growth.totalBeans')" width="140" align="right"><template #default="{ row }"><span class="num">{{ number(row.beans) }}</span></template></el-table-column>
      </el-table>
    </div>
    <ConfigForm :groups="['tasks']" endpoint="growth/config" perm="marketing.tasks" />
    <ClaimsTable />
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { api } from '../../core/api';
import { t, pick } from '../../core/i18n';
import { number } from '../../core/format';
import ConfigForm from '../../components/ConfigForm.vue';
import ClaimsTable from './ClaimsTable.vue';

const stats = ref({});
api.get('growth/stats', { days: 30 }).then(r => (stats.value = r));
const rows = computed(() => (stats.value.tasks || []).filter(x => ['profile', 'post', 'address'].includes(x.task)));
</script>
