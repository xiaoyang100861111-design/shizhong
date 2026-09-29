<template>
  <el-table :data="rows" size="small" stripe>
    <el-table-column label="#" width="70"><template #default="{ row }"><span class="num">{{ row.id }}</span></template></el-table-column>
    <el-table-column v-if="showMerchant" :label="t('cm.merchant')" min-width="140">
      <template #default="{ row }"><router-link v-if="can('merchants.view')" :to="'/merchants/' + row.merchantId">{{ row.merchantName }}</router-link><span v-else>{{ row.merchantName }}</span></template>
    </el-table-column>
    <el-table-column :label="t('mc.period')" width="200"><template #default="{ row }"><span class="num small">{{ date(row.periodFrom) }} – {{ date(row.periodTo) }}</span></template></el-table-column>
    <el-table-column :label="t('mc.orders')" align="right" width="80">
      <template #default="{ row }"><el-button link type="primary" @click="showOrders(row)">{{ row.orderCount }}</el-button></template>
    </el-table-column>
    <el-table-column :label="t('mc.gross')" align="right" width="110"><template #default="{ row }"><span class="num">{{ money(row.gross, '') }}</span></template></el-table-column>
    <el-table-column :label="t('mc.commissionCol')" align="right" width="110"><template #default="{ row }"><span class="num neg">-{{ money(row.commission, '') }}</span></template></el-table-column>
    <el-table-column :label="t('mc.net')" align="right" width="110"><template #default="{ row }"><b class="num">{{ money(row.net, '') }}</b></template></el-table-column>
    <el-table-column :label="t('common.status')" width="180">
      <template #default="{ row }">
        <el-tag size="small" :type="row.status ? 'success' : 'warning'">{{ row.status ? t('mc.paidOut') : t('mc.toPay') }}</el-tag>
        <div v-if="row.status" class="muted small">{{ dateTime(row.paidAt) }} · {{ row.reference || '—' }}</div>
      </template>
    </el-table-column>
    <el-table-column v-if="!readonly" :label="t('common.actions')" width="110" fixed="right">
      <template #default="{ row }"><el-button v-if="!row.status" v-can="'merchants.settle'" link type="primary" @click="markPaid(row)">{{ t('mc.markPaid') }}</el-button></template>
    </el-table-column>
  </el-table>
  <el-dialog v-model="ordersOpen" :title="t('mc.settlementOrders', { id: current?.id })" width="720px">
    <el-table :data="orders" size="small" max-height="420">
      <el-table-column :label="t('cm.orderNo')" width="170"><template #default="{ row }"><span class="num">{{ row.orderNo }}</span></template></el-table-column>
      <el-table-column :label="t('cm.content')" prop="title" min-width="180" />
      <el-table-column :label="t('cm.payable')" align="right" width="100"><template #default="{ row }"><span class="num">{{ money(row.total, '') }}</span></template></el-table-column>
      <el-table-column :label="t('cm.refunded')" align="right" width="100"><template #default="{ row }"><span class="num">{{ row.refunded ? money(row.refunded, '') : '—' }}</span></template></el-table-column>
      <el-table-column :label="t('mc.doneAt')" width="140"><template #default="{ row }"><span class="num small">{{ dateTime(row.doneAt) }}</span></template></el-table-column>
    </el-table>
  </el-dialog>
</template>

<script setup>
import { ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { can } from '../../core/auth';
import { date, dateTime, money } from '../../core/format';

defineProps({ rows: { type: Array, default: () => [] }, showMerchant: Boolean, readonly: Boolean });
const emit = defineEmits(['changed']);
const ordersOpen = ref(false);
const orders = ref([]);
const current = ref(null);
async function markPaid(row) {
  const { value } = await ElMessageBox.prompt(t('mc.referenceHint', { amount: money(row.net) }), t('mc.markPaid'), { inputPlaceholder: t('mc.reference') });
  await api.post(`merchants/settlements/${row.id}/paid`, { reference: value || '' });
  ElMessage.success(t('common.done'));
  emit('changed');
}
async function showOrders(row) {
  current.value = row;
  orders.value = await api.get(`merchants/settlements/${row.id}/orders`);
  ordersOpen.value = true;
}
</script>

<style scoped>
.small { font-size: 12px; }
</style>
