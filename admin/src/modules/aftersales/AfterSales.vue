<template>
  <div class="page">
    <div class="page-head"><h1>{{ shop ? t('as.shopTitle') : t('as.title') }}</h1></div>
    <div class="panel">
      <el-radio-group v-model="list.filters.status" class="status-tabs" @change="list.search">
        <el-radio-button value="">{{ t('common.all') }}</el-radio-button>
        <el-radio-button v-for="s in statuses" :key="s" :value="s">{{ t('cm.ticketStatus.' + s) }}<span v-if="counts[s]" class="count num">{{ counts[s] }}</span></el-radio-button>
      </el-radio-group>
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('as.q')" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-select v-model="list.filters.reason" clearable :placeholder="t('as.reason')" @change="list.search">
          <el-option v-for="r in reasons" :key="r" :value="r" :label="t('cm.asReason.' + r)" />
        </el-select>
        <MerchantSelect v-if="!shop" v-model="list.filters.merchantId" @update:model-value="list.search" />
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
      </div>
      <el-table v-loading="list.loading.value" :data="list.items.value" stripe>
        <el-table-column :label="t('as.ticket')" width="150">
          <template #default="{ row }"><span class="num">#{{ row.id }}</span><div class="muted small num">{{ dateTime(row.createdAt) }}</div></template>
        </el-table-column>
        <el-table-column :label="t('common.user')" min-width="150">
          <template #default="{ row }"><UserCell :id="shop ? null : row.user.id" :name="row.user.name" :avatar="row.user.avatar" :display-id="row.user.displayId" :link="!shop" /></template>
        </el-table-column>
        <el-table-column :label="t('as.order')" min-width="200">
          <template #default="{ row }">
            <router-link v-if="row.order" :to="(shop ? '/shop/orders/' : '/orders/') + row.order.id" class="num">{{ row.orderNo }}</router-link>
            <span v-else class="num">{{ row.orderNo }}</span>
            <div class="small">{{ row.order?.title }}</div>
            <small v-if="row.merchantName && !shop" class="muted">{{ row.merchantName }}</small>
          </template>
        </el-table-column>
        <el-table-column :label="t('as.problem')" min-width="240">
          <template #default="{ row }"><b>{{ t('cm.asReason.' + row.reason) }}</b><div class="clamp">{{ row.details }}</div></template>
        </el-table-column>
        <el-table-column :label="t('common.status')" width="100">
          <template #default="{ row }"><el-tag size="small" :type="ticketType(row.status)">{{ t('cm.ticketStatus.' + row.status) }}</el-tag></template>
        </el-table-column>
        <el-table-column :label="t('as.reply')" min-width="180">
          <template #default="{ row }"><span class="clamp muted">{{ row.reply || '—' }}</span><small v-if="row.handlerName" class="muted"> · {{ row.handlerName }}</small></template>
        </el-table-column>
        <el-table-column :label="t('common.actions')" width="90" fixed="right">
          <template #default="{ row }"><el-button link type="primary" @click="open(row)">{{ canHandle ? t('as.handle') : t('common.view') }}</el-button></template>
        </el-table-column>
      </el-table>
      <Pager :list="list" />
    </div>

    <el-drawer v-model="drawer" :title="current ? '#' + current.id + ' · ' + t('cm.asReason.' + current.reason) : ''" size="480px">
      <template v-if="current">
        <dl class="kv">
          <dt>{{ t('common.user') }}</dt><dd>{{ current.user.name }} <span class="muted num">{{ current.user.phone }}</span></dd>
          <dt>{{ t('as.order') }}</dt><dd class="num">{{ current.orderNo }}</dd>
          <template v-if="current.order">
            <dt>{{ t('cm.content') }}</dt><dd>{{ current.order.title }}</dd>
            <dt>{{ t('common.status') }}</dt><dd>{{ t('cm.status.' + current.order.status) }}</dd>
            <dt>{{ t('cm.payable') }}</dt><dd class="num">{{ money(current.order.payable) }}<span v-if="current.order.refunded" class="neg"> · {{ t('cm.refunded') }} {{ money(current.order.refunded) }}</span></dd>
          </template>
          <dt>{{ t('as.problem') }}</dt><dd>{{ current.details }}</dd>
          <dt>{{ t('common.createdAt') }}</dt><dd class="num">{{ dateTime(current.createdAt, true) }}</dd>
        </dl>
        <el-divider />
        <el-form label-position="top" :disabled="!canHandle">
          <el-form-item :label="t('common.status')">
            <el-radio-group v-model="form.status">
              <el-radio-button v-for="s in statuses" :key="s" :value="s">{{ t('cm.ticketStatus.' + s) }}</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item :label="t('as.reply')"><el-input v-model="form.reply" type="textarea" :rows="4" maxlength="1000" show-word-limit :placeholder="t('as.replyHint')" /></el-form-item>
          <el-form-item v-if="canRefund && current.order?.paid && current.order.refundable > 0" :label="t('as.refund', { max: money(current.order.refundable) })">
            <el-input-number v-model="form.refundAmount" :min="0" :max="current.order.refundable" :precision="2" :step="1" controls-position="right" />
            <el-button link type="primary" style="margin-left: 8px" @click="form.refundAmount = current.order.refundable">{{ t('cm.full') }}</el-button>
          </el-form-item>
          <el-form-item><el-checkbox v-model="form.notify">{{ t('as.notify') }}</el-checkbox></el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="drawer = false">{{ t('common.close') }}</el-button>
        <el-button v-if="canHandle" type="primary" :loading="busy" @click="save">{{ t('common.save') }}</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useList } from '../../core/list';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { can } from '../../core/auth';
import { dateTime, money } from '../../core/format';
import Pager from '../../components/Pager.vue';
import UserCell from '../../components/UserCell.vue';
import MerchantSelect from '../merchants/MerchantSelect.vue';
import { ticketType } from '../orders/common';

const props = defineProps({ shop: Boolean });
const base = computed(() => (props.shop ? 'shop/aftersales' : 'aftersales'));
const statuses = ['received', 'processing', 'resolved', 'rejected'];
const reasons = ['reschedule', 'refund', 'quality', 'missing', 'misc'];
const list = useList(() => base.value, { q: '', status: '', reason: '', merchantId: null });
const counts = ref({});
const drawer = ref(false);
const current = ref(null);
const busy = ref(false);
const form = reactive({ status: 'processing', reply: '', refundAmount: 0, notify: true });
const canHandle = computed(() => (props.shop ? can('shop.aftersales') : can('aftersales.handle')));
const canRefund = computed(() => !props.shop && (can('aftersales.refund') || can('orders.refund')));

async function loadCounts() {
  if (props.shop) return;
  counts.value = await api.get('aftersales/counts', undefined, { quiet: true }).catch(() => ({}));
}
function open(row) {
  current.value = row;
  Object.assign(form, { status: row.status === 'received' ? 'processing' : row.status, reply: row.reply || '', refundAmount: 0, notify: true });
  drawer.value = true;
}
async function save() {
  if (form.refundAmount > 0) await ElMessageBox.confirm(t('as.refundConfirm', { amount: money(form.refundAmount) }), { type: 'warning' });
  busy.value = true;
  try {
    const res = await api.post(base.value + '/' + current.value.id, { status: form.status, reply: form.reply, refundAmount: form.refundAmount || null, notify: form.notify });
    ElMessage.success(res.refunded ? t('cm.refundedMsg', { amount: money(res.refunded) }) : t('common.saved'));
    drawer.value = false;
    list.load();
    loadCounts();
  } finally {
    busy.value = false;
  }
}
loadCounts();
</script>

<style scoped>
.status-tabs { margin-bottom: 12px; }
.count { margin-left: 6px; font-size: 12px; opacity: .75; }
.small { font-size: 12px; }
.clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
</style>
