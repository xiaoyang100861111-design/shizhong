<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('risk.lists.title') }}</h1>
      <div class="spacer" />
      <el-button v-can="'risk.lists'" :icon="IconUnlock" @click="unlockOpen = true">{{ t('risk.lists.unlock') }}</el-button>
      <el-button v-can="'risk.lists'" type="primary" :icon="IconPlus" @click="add">{{ t('risk.lists.add') }}</el-button>
    </div>
    <div class="panel">
      <el-tabs v-model="list.filters.kind" @tab-change="list.search">
        <el-tab-pane :label="t('risk.lists.all')" name="" />
        <el-tab-pane v-for="k in LIST_KINDS" :key="k" :label="t('risk.kind.' + k)" :name="k" />
      </el-tabs>
      <div class="filters">
        <el-radio-group v-model="list.filters.type" @change="list.search">
          <el-radio-button value="">{{ t('common.all') }}</el-radio-button>
          <el-radio-button value="block">{{ t('risk.listType.block') }}</el-radio-button>
          <el-radio-button value="allow">{{ t('risk.listType.allow') }}</el-radio-button>
        </el-radio-group>
        <el-input v-model="list.filters.q" :placeholder="t('risk.lists.value') + ' / ' + t('risk.lists.note')" clearable @keyup.enter="list.search" @clear="list.search">
          <template #prefix><el-icon><IconSearch /></el-icon></template>
        </el-input>
        <el-checkbox v-model="list.filters.active" :true-value="true" :false-value="null" @change="list.search">{{ t('risk.lists.onlyActive') }}</el-checkbox>
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
      </div>
      <el-table v-loading="list.loading.value" :data="list.items.value" stripe>
        <el-table-column :label="t('common.type')" width="110">
          <template #default="{ row }">{{ t('risk.kind.' + row.kind) }}</template>
        </el-table-column>
        <el-table-column :label="t('risk.lists.value')" min-width="200">
          <template #default="{ row }">
            <span class="num value">{{ row.value }}</span>
            <el-button v-if="row.kind === 'ip' || row.kind === 'device'" link type="primary" size="small" class="ml"
              @click="$router.push('/risk/events?' + (row.kind === 'ip' ? 'ip=' + encodeURIComponent(row.value) : 'q=' + encodeURIComponent(row.value)))">{{ t('risk.viewEvents') }}</el-button>
          </template>
        </el-table-column>
        <el-table-column :label="t('risk.lists.type')" width="90">
          <template #default="{ row }"><el-tag size="small" :type="row.listType === 'block' ? 'danger' : 'success'">{{ t('risk.listType.' + row.listType) }}</el-tag></template>
        </el-table-column>
        <el-table-column :label="t('risk.lists.note')" min-width="220" show-overflow-tooltip prop="note" />
        <el-table-column :label="t('risk.v.source')" width="80">
          <template #default="{ row }"><el-tag size="small" :type="row.source === 'auto' ? 'warning' : 'info'" effect="plain">{{ t('risk.source.' + row.source) }}</el-tag></template>
        </el-table-column>
        <el-table-column :label="t('risk.lists.expiresAt')" width="170">
          <template #default="{ row }">
            <span v-if="!row.expiresAt" class="muted">{{ t('risk.lists.permanent') }}</span>
            <span v-else class="num">{{ dateTime(row.expiresAt) }}</span>
            <el-tag v-if="!row.active" size="small" type="info" class="ml">{{ t('risk.lists.expired') }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('risk.lists.createdBy')" width="170">
          <template #default="{ row }"><span class="num">{{ dateTime(row.createdAt) }}</span><div class="muted small">{{ row.createdBy || t('risk.source.auto') }}</div></template>
        </el-table-column>
        <el-table-column v-if="can('risk.lists')" :label="t('common.actions')" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="edit(row)">{{ t('common.edit') }}</el-button>
            <el-button link type="danger" @click="remove(row)">{{ t('common.delete') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
      <Pager :list="list" />
    </div>

    <ListEntryDialog v-model="dialogOpen" :entry="entry" :preset="preset" @saved="list.load" />

    <el-dialog v-model="unlockOpen" :title="t('risk.lists.unlockTitle')" width="440px">
      <p class="muted hint">{{ t('risk.lists.unlockHint') }}</p>
      <el-form label-position="top">
        <el-form-item :label="t('risk.lists.account')"><el-input v-model="unlock.account" placeholder="+60 12-345 6789 / name@example.com" clearable /></el-form-item>
        <el-form-item label="IP"><el-input v-model="unlock.ip" placeholder="175.139.12.34" clearable /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="unlockOpen = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="busy" :disabled="!unlock.account.trim() && !unlock.ip.trim()" @click="doUnlock">{{ t('common.confirm') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus as IconPlus, Unlock as IconUnlock } from '@element-plus/icons-vue';
import { api } from '../../core/api';
import { useList } from '../../core/list';
import { t } from '../../core/i18n';
import { can } from '../../core/auth';
import { dateTime } from '../../core/format';
import Pager from '../../components/Pager.vue';
import ListEntryDialog from './ListEntryDialog.vue';
import { LIST_KINDS } from './common';

const route = useRoute();
const list = useList('risk/lists', { kind: route.query.kind || '', type: '', q: '', active: null });

const dialogOpen = ref(false);
const entry = ref(null);
const preset = ref(null);
function add() {
  entry.value = null;
  preset.value = { kind: list.filters.kind || 'ip', listType: list.filters.type || 'block' };
  dialogOpen.value = true;
}
function edit(row) {
  entry.value = row;
  preset.value = null;
  dialogOpen.value = true;
}
async function remove(row) {
  await ElMessageBox.confirm(t('risk.lists.confirmDelete', { value: row.value }), { type: 'warning' });
  await api.del('risk/lists/' + row.id);
  ElMessage.success(t('common.deleted'));
  list.load();
}

const unlockOpen = ref(false);
const busy = ref(false);
const unlock = reactive({ account: '', ip: '' });
async function doUnlock() {
  busy.value = true;
  try {
    const res = await api.post('risk/unlock', { account: unlock.account.trim() || null, ip: unlock.ip.trim() || null });
    ElMessage.success(t('risk.lists.unlockDone', { n: res.changed }));
    unlockOpen.value = false;
    Object.assign(unlock, { account: '', ip: '' });
    list.load();
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.ml { margin-left: 6px; }
.small { font-size: 12px; }
.value { word-break: break-all; }
.hint { margin: 0 0 12px; font-size: 13px; line-height: 1.5; }
:deep(.el-tabs__header) { margin-bottom: 12px; }
</style>
