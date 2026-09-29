<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ shop ? t('mc.mySettlements') : t('mc.settlements') }}</h1>
      <div class="spacer" />
      <el-button v-if="!shop && scope.isAll" v-can="'merchants.settle'" type="primary" @click="generate">{{ t('mc.generateAll') }}</el-button>
    </div>
    <p class="page-sub">{{ t('mc.settleRule') }}</p>
    <div class="grid-cards">
      <StatCard :label="t('mc.toPay')" :value="sums.unpaid" unit="RM" />
      <StatCard :label="t('mc.paidOut')" :value="sums.paid" unit="RM" />
    </div>
    <div class="panel">
      <div class="filters">
        <MerchantSelect v-if="!shop" v-model="filters.merchantId" @update:model-value="load(1)" />
        <el-select v-model="filters.status" clearable :placeholder="t('common.status')" @change="load(1)">
          <el-option :value="0" :label="t('mc.toPay')" /><el-option :value="1" :label="t('mc.paidOut')" />
        </el-select>
      </div>
      <SettlementTable v-loading="loading" :rows="rows" :show-merchant="!shop" :readonly="shop" @changed="load()" />
      <div class="table-foot">
        <el-pagination v-model:current-page="page" :page-size="20" :total="total" layout="total, prev, pager, next" background small @current-change="load()" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { scope } from '../../core/auth';
import StatCard from '../../components/StatCard.vue';
import MerchantSelect from './MerchantSelect.vue';
import SettlementTable from './SettlementTable.vue';

const props = defineProps({ shop: Boolean });
const route = useRoute();
const filters = reactive({ merchantId: route.query.merchantId ? Number(route.query.merchantId) : null, status: null });
const rows = ref([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const sums = reactive({ unpaid: 0, paid: 0 });
async function load(p) {
  if (p) page.value = p;
  loading.value = true;
  try {
    const res = await api.get(props.shop ? 'shop/settlements' : 'merchants/settlements', { ...filters, page: page.value, size: 20 });
    rows.value = res.items;
    total.value = res.total;
    Object.assign(sums, { unpaid: res.unpaid, paid: res.paid });
  } finally {
    loading.value = false;
  }
}
async function generate() {
  const res = await api.post('merchants/settlements/generate', {});
  ElMessage.success(t('mc.generated', { n: res.created }));
  load(1);
}
load();
</script>
