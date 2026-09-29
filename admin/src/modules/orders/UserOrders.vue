<template>
  <div>
    <div class="filters">
      <el-radio-group v-model="list.filters.status" size="small" @change="list.search">
        <el-radio-button value="">{{ t('common.all') }}</el-radio-button>
        <el-radio-button v-for="s in ['pending', 'confirmed', 'serving', 'done', 'cancelled']" :key="s" :value="s">{{ statusLabel(s) }}</el-radio-button>
      </el-radio-group>
    </div>
    <el-table v-loading="list.loading.value" :data="list.items.value" size="small" @row-click="row => $router.push('/orders/' + row.id)">
      <el-table-column :label="t('cm.orderNo')" width="170"><template #default="{ row }"><span class="num">{{ row.orderNo }}</span></template></el-table-column>
      <el-table-column :label="t('cm.content')" min-width="200"><template #default="{ row }">{{ row.title }}<small class="muted"> · {{ catName(row.category) }}</small></template></el-table-column>
      <el-table-column :label="t('cm.merchant')" min-width="120" prop="merchantName" />
      <el-table-column :label="t('cm.payable')" align="right" width="100"><template #default="{ row }"><span class="num">{{ money(row.payable, '') }}</span></template></el-table-column>
      <el-table-column :label="t('common.status')" width="90"><template #default="{ row }"><el-tag size="small" :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
      <el-table-column :label="t('common.createdAt')" width="150"><template #default="{ row }"><span class="num">{{ dateTime(row.createdAt) }}</span></template></el-table-column>
    </el-table>
    <Pager :list="list" />
  </div>
</template>

<script setup>
// Member detail tab: the member's orders (scope applies on the server).
import { useList } from '../../core/list';
import { t } from '../../core/i18n';
import { dateTime, money } from '../../core/format';
import Pager from '../../components/Pager.vue';
import { loadMeta, catName, statusType, statusLabel } from './common';

const props = defineProps({ userId: [Number, String] });
const list = useList('orders', { userId: props.userId, status: '' }, { size: 10 });
loadMeta();
</script>
