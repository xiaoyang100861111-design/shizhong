<template>
  <el-table v-loading="loading" :data="items" size="small" stripe>
    <el-table-column :label="t('common.time')" width="150"><template #default="{ row }"><span class="num">{{ dateTime(row.createdAt, true) }}</span></template></el-table-column>
    <el-table-column :label="t('common.type')" width="110">
      <template #default="{ row }"><el-tag size="small" :type="tagType[row.kind]">{{ t('gifts.tx.kind.' + row.kind) }}</el-tag></template>
    </el-table-column>
    <el-table-column :label="t('gifts.tx.gift')" min-width="170">
      <template #default="{ row }"><div class="gift"><img class="thumb small" :src="assetUrl(row.art)" alt="" /><span>{{ row.giftName || row.giftId }} <b class="num">×{{ row.quantity }}</b></span></div></template>
    </el-table-column>
    <el-table-column :label="t('gifts.tx.from')" min-width="150"><template #default="{ row }"><UserCell :id="row.from.id" :name="row.from.name" :display-id="row.from.displayId" :size="24" /></template></el-table-column>
    <el-table-column :label="t('gifts.tx.to')" min-width="150">
      <template #default="{ row }"><UserCell v-if="row.to" :id="row.to.id" :name="row.to.name" :display-id="row.to.displayId" :size="24" /><span v-else class="muted">—</span></template>
    </el-table-column>
    <el-table-column :label="t('gifts.tx.value')" align="right" width="110"><template #default="{ row }"><span class="num">{{ number(row.totalBeans) }}</span></template></el-table-column>
    <el-table-column :label="t('gifts.tx.paid')" align="right" width="100"><template #default="{ row }"><span class="num">{{ number(row.paidBeans) }}</span></template></el-table-column>
    <el-table-column :label="t('gifts.tx.ref')" min-width="120">
      <template #default="{ row }">
        <span class="muted num">{{ row.refId || '' }}</span>
        <el-tag v-if="row.kind === 'send'" size="small" :type="row.status === 1 ? 'success' : 'warning'">{{ row.status === 1 ? t('gifts.tx.accepted') : t('gifts.tx.pending') }}</el-tag>
        <div v-if="row.note" class="muted">“{{ row.note }}”</div>
      </template>
    </el-table-column>
  </el-table>
</template>

<script setup>
import { assetUrl } from '../../core/api';
import { t } from '../../core/i18n';
import { dateTime, number } from '../../core/format';
import UserCell from '../../components/UserCell.vue';

defineProps({ items: { type: Array, default: () => [] }, loading: Boolean });
const tagType = { buy: 'info', send: 'success', live: 'danger', private: 'warning' };
</script>

<style scoped>
.gift { display: flex; align-items: center; gap: 8px; }
.thumb.small { width: 28px; height: 28px; }
</style>
