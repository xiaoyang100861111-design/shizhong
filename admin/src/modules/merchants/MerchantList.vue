<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('mc.title') }}</h1>
      <div class="spacer" />
      <el-button v-can="'merchants.create'" type="primary" :icon="IconPlus" @click="openEdit()">{{ t('mc.add') }}</el-button>
    </div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('mc.q')" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-select v-model="list.filters.category" clearable :placeholder="t('cm.category')" @change="list.search">
          <el-option v-for="c in meta.categories.filter(c => c.id !== 'all')" :key="c.id" :value="c.id" :label="catName(c.id)" />
        </el-select>
        <el-select v-model="list.filters.status" clearable :placeholder="t('common.status')" @change="list.search">
          <el-option :value="0" :label="t('common.enabled')" /><el-option :value="1" :label="t('common.disabled')" />
        </el-select>
        <AgentSelect v-if="can('agents.view')" v-model="list.filters.agentId" @update:model-value="list.search" />
        <el-input v-model="list.filters.city" :placeholder="t('common.city')" clearable style="width: 120px" @keyup.enter="list.search" @clear="list.search" />
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
      </div>
      <el-table v-loading="list.loading.value" :data="list.items.value" stripe>
        <el-table-column :label="t('mc.name')" min-width="220">
          <template #default="{ row }">
            <div class="m">
              <el-avatar :size="36" :src="assetUrl(row.logo)" shape="square">{{ row.name.slice(0, 1) }}</el-avatar>
              <div>
                <router-link :to="'/merchants/' + row.id" class="name">{{ row.name }}</router-link>
                <el-tag v-if="row.isDemo" size="small" type="info" effect="plain" style="margin-left: 4px">{{ t('cm.demo') }}</el-tag>
                <div class="muted small">#{{ row.id }} · {{ catName(row.category) }} · {{ row.city || '—' }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="t('mc.contact')" width="150"><template #default="{ row }">{{ row.contact || '—' }}<div class="muted small num">{{ row.phone }}</div></template></el-table-column>
        <el-table-column v-if="can('agents.view')" :label="t('mc.agent')" width="120" prop="agentName" />
        <el-table-column :label="t('mc.services')" align="right" width="100"><template #default="{ row }"><span class="num">{{ row.onShelf }} / {{ row.services }}</span></template></el-table-column>
        <el-table-column :label="t('mc.orders')" align="right" width="110"><template #default="{ row }"><span class="num">{{ row.orders }}</span><div v-if="row.pending" class="small warn">{{ t('mc.pendingN', { n: row.pending }) }}</div></template></el-table-column>
        <el-table-column :label="t('mc.gmv30')" align="right" width="120"><template #default="{ row }"><span class="num">{{ money(row.gmv30, '') }}</span></template></el-table-column>
        <el-table-column :label="t('mc.rate')" width="90"><template #default="{ row }">{{ percent(row.effectiveRate) }}<small v-if="row.commissionRate == null" class="muted"> *</small></template></el-table-column>
        <el-table-column :label="t('mc.unpaid')" align="right" width="110"><template #default="{ row }"><span class="num">{{ row.unpaid ? money(row.unpaid, '') : '—' }}</span></template></el-table-column>
        <el-table-column :label="t('common.status')" width="80">
          <template #default="{ row }"><el-tag size="small" :type="row.status ? 'info' : 'success'">{{ row.status ? t('common.disabled') : t('common.enabled') }}</el-tag></template>
        </el-table-column>
        <el-table-column :label="t('common.actions')" width="130" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="$router.push('/merchants/' + row.id)">{{ t('common.detail') }}</el-button>
            <el-button v-can="'merchants.edit'" link type="primary" @click="openEdit(row)">{{ t('common.edit') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
      <Pager :list="list" />
      <p class="muted small">{{ t('mc.rateFootnote') }}</p>
    </div>
    <MerchantEdit v-model="editOpen" :merchant="editing" @saved="list.load" />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { Plus as IconPlus } from '@element-plus/icons-vue';
import { useList } from '../../core/list';
import { assetUrl } from '../../core/api';
import { t } from '../../core/i18n';
import { can } from '../../core/auth';
import { money, percent } from '../../core/format';
import Pager from '../../components/Pager.vue';
import AgentSelect from '../../components/AgentSelect.vue';
import MerchantEdit from './MerchantEdit.vue';
import { meta, loadMeta, catName } from '../orders/common';

const list = useList('merchants', { q: '', category: '', status: null, agentId: null, city: '' });
const editOpen = ref(false);
const editing = ref(null);
function openEdit(row) {
  editing.value = row || null;
  editOpen.value = true;
}
loadMeta();
</script>

<style scoped>
.m { display: flex; gap: 10px; align-items: center; }
.name { color: var(--el-text-color-primary); font-weight: 500; text-decoration: none; }
.name:hover { color: var(--el-color-primary); }
.small { font-size: 12px; }
.warn { color: var(--el-color-warning); }
</style>
