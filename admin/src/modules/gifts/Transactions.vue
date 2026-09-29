<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('gifts.tx.title') }}</h1>
      <div class="spacer" />
      <el-button v-can="'gifts.export'" :icon="IconDownload" @click="list.exportCsv('gift-transactions/export', 'gift-transactions.csv')">{{ t('common.export') }}</el-button>
    </div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('common.keyword')" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-select v-model="list.filters.kind" clearable :placeholder="t('common.type')" @change="list.search">
          <el-option v-for="k in ['buy', 'send', 'live', 'private']" :key="k" :value="k" :label="t('gifts.tx.kind.' + k)" />
        </el-select>
        <el-date-picker v-model="list.filters.range" type="daterange" :start-placeholder="t('common.from')" :end-placeholder="t('common.to')" @change="list.search" />
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
        <el-button @click="list.reset">{{ t('common.reset') }}</el-button>
      </div>
      <p v-if="sums" class="muted">{{ t('gifts.tx.sum', { beans: number(sums.beans), paid: number(sums.paid) }) }}</p>
      <TxTable :items="list.items.value" :loading="list.loading.value" />
      <Pager :list="list" />
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { Download as IconDownload } from '@element-plus/icons-vue';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { useList } from '../../core/list';
import { number } from '../../core/format';
import Pager from '../../components/Pager.vue';
import TxTable from './TxTable.vue';

const sums = ref(null);
const list = useList('gift-transactions', { q: '', kind: '', range: [] }, { auto: false });
watch(list.items, async () => {
  const q = list.query();
  delete q.page;
  delete q.size;
  q.size = 1;
  sums.value = (await api.get('gift-transactions', q, { quiet: true }).catch(() => null))?.sums || null;
});
list.load();
</script>
