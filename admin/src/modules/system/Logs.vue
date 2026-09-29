<template>
  <div class="page">
    <div class="page-head"><h1>{{ t('sys.logs') }}</h1></div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('common.keyword')" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-input v-model="list.filters.action" :placeholder="t('sys.action')" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-date-picker v-model="list.filters.range" type="daterange" :start-placeholder="t('common.from')" :end-placeholder="t('common.to')" @change="list.search" />
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
      </div>
      <el-table v-loading="list.loading.value" :data="list.items.value" size="small">
        <el-table-column :label="t('common.time')" width="170"><template #default="{ row }"><span class="num">{{ dateTime(row.at, true) }}</span></template></el-table-column>
        <el-table-column prop="adminName" :label="t('common.operator')" width="120" />
        <el-table-column prop="action" :label="t('sys.action')" width="160" />
        <el-table-column prop="target" :label="t('sys.target')" width="160" show-overflow-tooltip />
        <el-table-column :label="t('sys.detail')" min-width="260">
          <template #default="{ row }">
            <el-popover v-if="row.detail" trigger="click" width="520">
              <template #reference><el-button link type="primary">{{ t('common.view') }}</el-button></template>
              <pre class="json">{{ JSON.stringify(row.detail, null, 2) }}</pre>
            </el-popover>
          </template>
        </el-table-column>
        <el-table-column prop="ip" label="IP" width="140" />
      </el-table>
      <Pager :list="list" />
    </div>
  </div>
</template>

<script setup>
import { t } from '../../core/i18n';
import { useList } from '../../core/list';
import { dateTime } from '../../core/format';
import Pager from '../../components/Pager.vue';

const list = useList('logs', { q: '', action: '', range: [] }, { size: 50 });
</script>

<style scoped>
.json { max-height: 420px; overflow: auto; font-size: 12px; margin: 0; white-space: pre-wrap; word-break: break-all; }
</style>
