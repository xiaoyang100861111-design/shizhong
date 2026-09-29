<template>
  <div>
    <div class="filters">
      <el-radio-group v-model="list.filters.status" size="small" @change="list.search">
        <el-radio-button :value="null">{{ t('common.all') }}</el-radio-button>
        <el-radio-button :value="0">{{ t('mk.cs.0') }}</el-radio-button>
        <el-radio-button :value="1">{{ t('mk.cs.1') }}</el-radio-button>
        <el-radio-button :value="2">{{ t('mk.cs.2') }}</el-radio-button>
      </el-radio-group>
      <el-input v-if="!userId" v-model="list.filters.q" size="small" :placeholder="t('mk.userQ')" clearable style="width: 200px" @keyup.enter="list.search" @clear="list.search" />
      <el-button v-if="userId && can('marketing.grant')" size="small" type="primary" @click="grantOpen = true">{{ t('mk.grantToUser') }}</el-button>
    </div>
    <el-table v-loading="list.loading.value" :data="list.items.value" size="small">
      <el-table-column v-if="!userId" :label="t('common.user')" min-width="150">
        <template #default="{ row }"><UserCell :id="row.user.id" :name="row.user.name" :avatar="row.user.avatar" :display-id="row.user.displayId" :size="24" /></template>
      </el-table-column>
      <el-table-column :label="t('mk.coupon')" min-width="150"><template #default="{ row }">{{ row.name || row.code }}<div class="muted small">{{ money(row.amount) }} · {{ row.min ? t('mk.minN', { min: money(row.min) }) : t('mk.noMin') }}</div></template></el-table-column>
      <el-table-column :label="t('mk.expires')" width="140"><template #default="{ row }"><span class="num small">{{ dateTime(row.expiresAt) }}</span></template></el-table-column>
      <el-table-column :label="t('common.status')" width="110">
        <template #default="{ row }"><el-tag size="small" :type="['success', 'info', 'warning', 'danger'][row.status]">{{ t('mk.cs.' + row.status) }}</el-tag><div v-if="row.orderNo" class="muted small num">{{ row.orderNo }}</div></template>
      </el-table-column>
      <el-table-column :label="t('mk.source')" width="90"><template #default="{ row }">{{ row.source }}</template></el-table-column>
      <el-table-column :label="t('common.createdAt')" width="140"><template #default="{ row }"><span class="num small">{{ dateTime(row.createdAt) }}</span></template></el-table-column>
      <el-table-column v-if="can('marketing.grant')" width="80">
        <template #default="{ row }"><el-button v-if="row.status === 0" link type="danger" @click="revoke(row)">{{ t('mk.revoke') }}</el-button></template>
      </el-table-column>
    </el-table>
    <Pager :list="list" />
    <el-dialog v-model="grantOpen" :title="t('mk.grantToUser')" width="400px" append-to-body>
      <el-select v-model="templateId" style="width: 100%" :placeholder="t('mk.coupon')">
        <el-option v-for="tp in templates.filter(x => x.enabled)" :key="tp.id" :value="tp.id" :label="`${tp.name} · ${money(tp.amount)}`" />
      </el-select>
      <template #footer>
        <el-button @click="grantOpen = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :disabled="!templateId" @click="doGrant">{{ t('mk.grant') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
// Issued coupons: per template (marketing) or per member (member detail tab).
import { ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useList } from '../../core/list';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { can } from '../../core/auth';
import { dateTime, money } from '../../core/format';
import Pager from '../../components/Pager.vue';
import UserCell from '../../components/UserCell.vue';

const props = defineProps({ userId: [Number, String], templateId: [Number, String] });
const list = useList('marketing/user-coupons', { userId: props.userId || null, templateId: props.templateId || null, status: null, q: '' }, { size: 10 });
watch(() => props.templateId, v => { list.filters.templateId = v; list.search(); });
const grantOpen = ref(false);
const templateId = ref(null);
const templates = ref([]);
watch(grantOpen, async v => {
  if (v && !templates.value.length) templates.value = await api.get('marketing/coupons');
});
async function doGrant() {
  const res = await api.post(`marketing/coupons/${templateId.value}/grant`, { target: 'users', users: [String(props.userId)], notify: true });
  ElMessage.success(res.granted ? t('common.done') : t('mk.limitReached'));
  grantOpen.value = false;
  list.load();
}
async function revoke(row) {
  await ElMessageBox.confirm(t('mk.revokeConfirm'), { type: 'warning' });
  await api.post(`marketing/user-coupons/${row.id}/revoke`, {});
  list.load();
}
</script>

<style scoped>
.small { font-size: 12px; }
</style>
