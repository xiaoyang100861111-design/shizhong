<template>
  <div class="page" v-loading="loading">
    <div class="page-head">
      <el-button :icon="IconBack" circle @click="$router.back()" />
      <h1 v-if="o">{{ o.orderNo }}</h1>
      <el-tag v-if="o" :type="statusType(o.status)">{{ statusLabel(o.status) }}</el-tag>
      <el-tag v-if="o?.demoSeed" type="info" effect="plain">{{ t('cm.demo') }}</el-tag>
      <div class="spacer" />
      <template v-if="o">
        <el-button v-if="o.status === 'pending' && canEdit" type="primary" @click="advance('confirm')">{{ t('cm.act.confirm') }}</el-button>
        <el-button v-if="o.status === 'confirmed' && paidFlow && canEdit" @click="advance('serve')">{{ t('cm.act.serve') }}</el-button>
        <el-button v-if="['confirmed', 'serving'].includes(o.status) && canEdit" @click="advance('complete')">{{ t('cm.act.complete') }}</el-button>
        <el-button v-if="['pending', 'confirmed', 'serving'].includes(o.status) && canEdit && (!o.paid || shop || can('orders.refund'))" type="danger" plain @click="cancelOpen = true">{{ t('cm.act.cancel') }}</el-button>
        <el-button v-if="!shop && o.paid && refundable > 0" v-can="'orders.refund'" type="warning" plain @click="openRefund">{{ t('cm.act.refund') }}</el-button>
        <el-button v-if="canEdit" @click="noteOpen = true">{{ t('cm.act.note') }}</el-button>
      </template>
    </div>

    <template v-if="o">
      <div class="grid-cards">
        <StatCard :label="t('cm.subtotal')" :value="o.subtotal" unit="RM" />
        <StatCard :label="t('cm.fee')" :value="o.fee" unit="RM" />
        <StatCard :label="t('cm.discount')" :value="o.discount" unit="RM" />
        <StatCard :label="t('cm.payable')" :value="o.payable" unit="RM" />
        <StatCard :label="t('cm.refunded')" :value="o.refunded" unit="RM" />
      </div>
      <div class="cols">
        <div class="panel">
          <h3 class="panel-title">{{ t('cm.summary') }}</h3>
          <dl class="kv">
            <dt>{{ t('common.user') }}</dt>
            <dd><UserCell :id="shop ? null : o.user.id" :name="o.user.name" :avatar="o.user.avatar" :display-id="o.user.displayId" :link="!shop" /> <span class="muted num">{{ o.user.phone }}</span></dd>
            <dt>{{ t('cm.content') }}</dt><dd>{{ o.title }}<span v-if="o.serviceId" class="muted num"> · {{ o.serviceId }}</span></dd>
            <dt>{{ t('cm.category') }}</dt><dd>{{ catName(o.category) }} · {{ flowLabel(o.flow) }}</dd>
            <dt>{{ t('cm.merchant') }}</dt><dd>{{ o.merchantName || '—' }}<span v-if="d.commissionRate != null" class="muted"> · {{ t('cm.commission') }} {{ percent(d.commissionRate) }}</span></dd>
            <dt>{{ t('common.city') }}</dt><dd>{{ o.city || '—' }}</dd>
            <dt>{{ t('cm.payMethod') }}</dt><dd>{{ t('cm.pay.' + o.payMethod) }} · {{ o.paid ? t('cm.paid') : t('cm.unpaid') }}</dd>
            <dt v-if="d.coupon">{{ t('cm.coupon') }}</dt><dd v-if="d.coupon">{{ d.coupon.name || d.coupon.code }} · -{{ money(d.coupon.amount) }}</dd>
            <dt v-if="o.cancelFee">{{ t('cm.cancelFee') }}</dt><dd v-if="o.cancelFee">{{ money(o.cancelFee) }}</dd>
            <dt>{{ t('common.createdAt') }}</dt><dd class="num">{{ dateTime(o.createdAt, true) }}</dd>
            <dt>{{ t('cm.scheduled') }}</dt><dd class="num">{{ o.scheduledAt ? dateTime(o.scheduledAt) : '—' }}</dd>
            <dt v-if="o.autoConfirmAt">{{ t('cm.autoConfirmAt') }}</dt><dd v-if="o.autoConfirmAt" class="num">{{ dateTime(o.autoConfirmAt, true) }}</dd>
            <dt v-if="o.cancelReason">{{ t('cm.cancelReason') }}</dt><dd v-if="o.cancelReason">{{ reasonLabel(o.cancelReason) }} <span class="muted">({{ d.cancelledBy }})</span></dd>
            <dt v-if="o.settlementId">{{ t('cm.settlement') }}</dt><dd v-if="o.settlementId">#{{ o.settlementId }}</dd>
            <dt v-if="o.adminNote">{{ t('cm.adminNote') }}</dt><dd v-if="o.adminNote">{{ o.adminNote }}</dd>
          </dl>
        </div>
        <div class="panel">
          <h3 class="panel-title">{{ t('cm.formData') }}</h3>
          <dl class="kv">
            <template v-for="k in shownKeys" :key="k"><dt>{{ dataLabel(k) }}</dt><dd>{{ dataValue(d.data[k]) }}</dd></template>
          </dl>
          <p v-if="!shownKeys.length" class="muted">—</p>
        </div>
      </div>
      <div v-if="d.items?.length" class="panel">
        <h3 class="panel-title">{{ t('cm.items') }}</h3>
        <el-table :data="d.items" size="small">
          <el-table-column :label="t('cm.content')" min-width="240">
            <template #default="{ row }"><div class="line"><img v-if="row.image" :src="assetUrl(row.image)" class="thumb" alt="" /><span>{{ row.title }}<br /><small class="muted num">{{ row.serviceId }}</small></span></div></template>
          </el-table-column>
          <el-table-column :label="t('cm.price')" align="right" width="110"><template #default="{ row }"><span class="num">{{ money(row.price, '') }}</span></template></el-table-column>
          <el-table-column :label="t('cm.qty')" align="right" width="80" prop="qty" />
          <el-table-column :label="t('cm.lineTotal')" align="right" width="120"><template #default="{ row }"><span class="num">{{ money(row.price * row.qty, '') }}</span></template></el-table-column>
        </el-table>
      </div>
      <div class="cols">
        <div class="panel">
          <h3 class="panel-title">{{ t('cm.timeline') }}</h3>
          <el-timeline>
            <el-timeline-item v-for="e in d.events" :key="e.id" :timestamp="dateTime(e.at, true)" :type="eventType(e)">
              <b v-if="e.kind === 'status'">{{ statusLabel(e.status) }}</b>
              <b v-else-if="e.kind === 'refund'" class="neg">{{ t('cm.ev.refund') }} {{ money(e.amount) }}</b>
              <b v-else-if="e.kind === 'payment'">{{ t('cm.ev.payment') }} {{ money(e.amount) }}</b>
              <b v-else>{{ t('cm.ev.note') }}</b>
              <span class="muted"> · {{ t('cm.actor.' + e.actorType) }}<template v-if="e.actorName"> {{ e.actorName }}</template></span>
              <div v-if="e.note && !['paid', 'placed', 'sent', 'auto', 'user', 'admin', 'merchant', 'customer'].includes(e.note)" class="note">{{ e.kind === 'status' && e.status === 'cancelled' ? reasonLabel(e.note) : e.note }}</div>
            </el-timeline-item>
          </el-timeline>
        </div>
        <div class="panel">
          <h3 class="panel-title">{{ t('cm.aftersales') }}</h3>
          <div v-for="tk in d.tickets" :key="tk.id" class="ticket">
            <el-tag size="small" :type="ticketType(tk.status)">{{ t('cm.ticketStatus.' + tk.status) }}</el-tag>
            <b>{{ t('cm.asReason.' + tk.reason) }}</b> <small class="muted num">{{ dateTime(tk.createdAt) }}</small>
            <p>{{ tk.details }}</p>
            <p v-if="tk.reply" class="muted">↳ {{ tk.reply }}</p>
          </div>
          <p v-if="!d.tickets?.length" class="muted">{{ t('common.noData') }}</p>
          <h3 class="panel-title" style="margin-top: 16px">{{ t('cm.review') }}</h3>
          <div v-if="d.review">
            <el-rate :model-value="d.review.stars" disabled />
            <div class="tag-list"><el-tag v-for="tg in d.review.tags" :key="tg" size="small">{{ t('cm.reviewTag.' + tg) }}</el-tag></div>
            <p>{{ d.review.text }}</p>
            <p v-if="d.review.reply" class="muted">↳ {{ d.review.reply }}</p>
          </div>
          <p v-else class="muted">{{ t('common.noData') }}</p>
          <template v-if="d.payments?.length">
            <h3 class="panel-title" style="margin-top: 16px">{{ t('cm.ledger') }}</h3>
            <div v-for="p in d.payments" :key="p.id" class="pay-row"><span>{{ p.title }}</span><span class="num" :class="p.amount >= 0 ? 'pos' : 'neg'">{{ money(p.amount) }}</span><small class="muted num">{{ dateTime(p.at) }}</small></div>
          </template>
        </div>
      </div>
    </template>

    <el-dialog v-model="cancelOpen" :title="t('cm.act.cancel')" width="440px">
      <p class="muted">{{ o?.paid ? t('cm.cancelRefundHint', { amount: money(refundable) }) : t('cm.cancelHint') }}</p>
      <el-input v-model="cancelNote" type="textarea" :rows="3" maxlength="400" :placeholder="t('cm.cancelNote')" />
      <template #footer>
        <el-button @click="cancelOpen = false">{{ t('common.cancel') }}</el-button>
        <el-button type="danger" :loading="busy" :disabled="shop && !cancelNote.trim()" @click="doCancel">{{ t('common.confirm') }}</el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="refundOpen" :title="t('cm.act.refund')" width="440px">
      <el-form label-position="top">
        <el-form-item :label="t('cm.refundAmount', { max: money(refundable) })">
          <el-input-number v-model="refundAmount" :min="0.01" :max="refundable" :precision="2" :step="1" controls-position="right" />
          <el-button link type="primary" style="margin-left: 8px" @click="refundAmount = refundable">{{ t('cm.full') }}</el-button>
        </el-form-item>
        <el-form-item :label="t('common.reason')" required><el-input v-model="refundNote" type="textarea" :rows="2" maxlength="400" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="refundOpen = false">{{ t('common.cancel') }}</el-button>
        <el-button type="warning" :loading="busy" :disabled="!refundNote.trim() || !(refundAmount > 0)" @click="doRefund">{{ t('common.confirm') }}</el-button>
      </template>
    </el-dialog>
    <el-dialog v-model="noteOpen" :title="t('cm.act.note')" width="440px">
      <el-input v-model="noteText" type="textarea" :rows="3" maxlength="400" />
      <template #footer>
        <el-button @click="noteOpen = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="busy" :disabled="!noteText.trim()" @click="doNote">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Back as IconBack } from '@element-plus/icons-vue';
import { api, assetUrl } from '../../core/api';
import { t } from '../../core/i18n';
import { can } from '../../core/auth';
import { dateTime, money, percent } from '../../core/format';
import StatCard from '../../components/StatCard.vue';
import UserCell from '../../components/UserCell.vue';
import { loadMeta, catName, statusType, ticketType, statusLabel, flowLabel, dataKeys, dataLabel, dataValue } from './common';

const props = defineProps({ shop: Boolean });
const route = useRoute();
const base = computed(() => (props.shop ? 'shop/orders/' : 'orders/') + route.params.id);
const loading = ref(false);
const busy = ref(false);
const d = ref({});
const o = computed(() => d.value.order);
const canEdit = computed(() => (props.shop ? can('shop.orders') : can('orders.edit')));
const paidFlow = computed(() => ['service', 'goods', 'topup'].includes(o.value?.flow));
const refundable = computed(() => (o.value ? Math.max(0, Math.round((o.value.payable - o.value.refunded) * 100) / 100) : 0));
const shownKeys = computed(() => dataKeys.filter(k => d.value.data && d.value.data[k] !== undefined && d.value.data[k] !== ''));
const cancelOpen = ref(false);
const cancelNote = ref('');
const refundOpen = ref(false);
const refundAmount = ref(0);
const refundNote = ref('');
const noteOpen = ref(false);
const noteText = ref('');

function reasonLabel(r) {
  const key = 'cm.cancelReasons.' + r;
  const v = t(key);
  return v === key ? r : v;
}
const eventType = e => (e.kind === 'refund' ? 'warning' : e.kind === 'note' ? 'info' : e.status === 'cancelled' ? 'danger' : e.status === 'done' ? 'success' : 'primary');

async function load() {
  loading.value = true;
  try {
    d.value = await api.get(base.value);
  } finally {
    loading.value = false;
  }
}
async function advance(action) {
  await ElMessageBox.confirm(t('cm.act.confirmAsk', { action: t('cm.act.' + action) }), { type: 'info' });
  await api.post(base.value + '/' + action, {});
  ElMessage.success(t('common.done'));
  load();
}
async function doCancel() {
  busy.value = true;
  try {
    const res = await api.post(base.value + '/cancel', { note: cancelNote.value });
    ElMessage.success(res.refund ? t('cm.refundedMsg', { amount: money(res.refund) }) : t('common.done'));
    cancelOpen.value = false;
    cancelNote.value = '';
    load();
  } finally {
    busy.value = false;
  }
}
function openRefund() {
  refundAmount.value = refundable.value;
  refundNote.value = '';
  refundOpen.value = true;
}
async function doRefund() {
  busy.value = true;
  try {
    const res = await api.post(base.value + '/refund', { amount: refundAmount.value, note: refundNote.value });
    ElMessage.success(t('cm.refundedMsg', { amount: money(res.refunded) }));
    refundOpen.value = false;
    load();
  } finally {
    busy.value = false;
  }
}
async function doNote() {
  busy.value = true;
  try {
    await api.post(base.value + '/note', { text: noteText.value });
    noteOpen.value = false;
    noteText.value = '';
    load();
  } finally {
    busy.value = false;
  }
}
loadMeta();
load();
</script>

<style scoped>
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.cols .panel { margin-bottom: 16px; }
.line { display: flex; gap: 8px; align-items: center; }
.note { color: var(--el-text-color-regular); margin-top: 2px; }
.ticket { border-bottom: 1px solid var(--el-border-color-lighter); padding: 8px 0; }
.ticket p { margin: 4px 0; }
.pay-row { display: grid; grid-template-columns: 1fr auto auto; gap: 12px; padding: 4px 0; }
@media (max-width: 900px) { .cols { grid-template-columns: 1fr; } }
</style>
