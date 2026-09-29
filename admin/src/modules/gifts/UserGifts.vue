<template>
  <div v-loading="loading">
    <div class="grid-cards">
      <StatCard :label="t('gifts.user.sent')" :value="data.sentBeans" />
      <StatCard :label="t('gifts.user.received')" :value="data.receivedBeans" />
      <StatCard :label="t('gifts.user.inventory')" :value="(data.inventory || []).reduce((n, i) => n + i.quantity, 0)" />
    </div>
    <h4>{{ t('gifts.user.inventory') }}</h4>
    <div class="inv">
      <div v-for="i in data.inventory || []" :key="i.giftId" class="inv-item">
        <img class="thumb" :src="assetUrl(i.art)" alt="" />
        <span>{{ i.name || i.giftId }}</span><b class="num">×{{ i.quantity }}</b>
      </div>
      <span v-if="!data.inventory?.length" class="muted">{{ t('common.noData') }}</span>
    </div>
    <template v-if="data.decoration">
      <h4>{{ t('gifts.user.decoration') }}</h4>
      <dl class="kv">
        <dt>{{ t('gifts.user.background') }}</dt><dd>{{ data.decoration.backgroundId }}<a v-if="data.decoration.customImage" :href="assetUrl(data.decoration.customImage)" target="_blank"> ({{ t('common.view') }})</a></dd>
        <dt>{{ t('gifts.user.stickers') }}</dt><dd>{{ (data.decoration.stickers || []).map(s => s.giftId).join(', ') || '—' }}</dd>
        <dt>{{ t('gifts.user.frame') }}</dt><dd>{{ data.decoration.frame || '—' }}</dd>
      </dl>
    </template>
    <h4>{{ t('gifts.tx.title') }}</h4>
    <TxTable :items="data.transactions || []" />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { api, assetUrl } from '../../core/api';
import { t } from '../../core/i18n';
import StatCard from '../../components/StatCard.vue';
import TxTable from './TxTable.vue';

const props = defineProps({ userId: [Number, String] });
const data = ref({});
const loading = ref(false);
(async () => {
  loading.value = true;
  try {
    data.value = await api.get(`users/${props.userId}/gifts`);
  } finally {
    loading.value = false;
  }
})();
</script>

<style scoped>
h4 { margin: 16px 0 8px; }
.inv { display: flex; flex-wrap: wrap; gap: 8px; }
.inv-item { display: flex; align-items: center; gap: 6px; padding: 4px 10px 4px 4px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; font-size: 13px; }
.inv-item .thumb { width: 32px; height: 32px; }
</style>
