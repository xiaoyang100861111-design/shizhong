<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('agents.title') }}</h1>
      <div class="spacer" />
      <el-button v-can="'agents.create'" type="primary" :icon="IconPlus" @click="openEdit()">{{ t('agents.add') }}</el-button>
    </div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="q" :placeholder="t('agents.q')" clearable @keyup.enter="load" @clear="load" />
        <el-select v-model="status" clearable :placeholder="t('common.status')" @change="load">
          <el-option :value="0" :label="t('common.enabled')" /><el-option :value="1" :label="t('common.disabled')" />
        </el-select>
        <el-button type="primary" @click="load">{{ t('common.search') }}</el-button>
      </div>
      <el-table v-loading="loading" :data="tree" row-key="id" default-expand-all :tree-props="{ children: 'children' }">
        <el-table-column :label="t('agents.name')" min-width="200">
          <template #default="{ row }">
            <router-link :to="'/agents/' + row.id" class="name">{{ row.name }}</router-link>
            <el-tag size="small" effect="plain" style="margin-left: 6px">{{ t('agents.levelN', { n: row.level }) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('agents.code')" width="120"><template #default="{ row }"><span class="num">{{ row.code }}</span></template></el-table-column>
        <el-table-column :label="t('agents.contact')" width="150"><template #default="{ row }">{{ row.contact || '—' }}<br /><small class="muted num">{{ row.phone }}</small></template></el-table-column>
        <el-table-column prop="city" :label="t('agents.city')" width="90" />
        <el-table-column :label="t('agents.directUsers')" align="right" width="100"><template #default="{ row }"><span class="num">{{ number(row.directUsers) }}</span></template></el-table-column>
        <el-table-column :label="t('agents.treeUsers')" align="right" width="100"><template #default="{ row }"><span class="num">{{ number(row.treeUsers) }}</span></template></el-table-column>
        <el-table-column :label="t('agents.new30')" align="right" width="100"><template #default="{ row }"><span class="num">{{ number(row.newUsers30) }}</span></template></el-table-column>
        <el-table-column :label="t('agents.treeTopup')" align="right" width="130"><template #default="{ row }"><span class="num">{{ money(row.treeTopup) }}</span></template></el-table-column>
        <el-table-column :label="t('agents.rate')" width="90"><template #default="{ row }">{{ row.commissionRate != null ? percent(row.commissionRate) : '—' }}</template></el-table-column>
        <el-table-column :label="t('common.status')" width="80">
          <template #default="{ row }"><el-tag :type="row.status ? 'info' : 'success'" size="small">{{ row.status ? t('common.disabled') : t('common.enabled') }}</el-tag></template>
        </el-table-column>
        <el-table-column :label="t('common.actions')" width="170" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="copyLink(row)">{{ t('agents.link') }}</el-button>
            <el-button v-can="'agents.edit'" link type="primary" @click="openEdit(row)">{{ t('common.edit') }}</el-button>
            <el-button v-if="!row.status" v-can="'agents.delete'" link type="danger" @click="disable(row)">{{ t('common.disabled') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
    <AgentEdit v-model="editOpen" :agent="editing" :agents="rows" @saved="load" />
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus as IconPlus } from '@element-plus/icons-vue';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { money, number, percent } from '../../core/format';
import AgentEdit from './AgentEdit.vue';

const rows = ref([]);
const loading = ref(false);
const q = ref('');
const status = ref(null);
const editOpen = ref(false);
const editing = ref(null);

const tree = computed(() => {
  const byId = new Map(rows.value.map(r => [r.id, { ...r, children: [] }]));
  const roots = [];
  for (const r of byId.values()) {
    const parent = r.parentId && byId.get(r.parentId);
    if (parent) parent.children.push(r);
    else roots.push(r);
  }
  for (const r of byId.values()) if (!r.children.length) delete r.children;
  return roots;
});

async function load() {
  loading.value = true;
  try {
    rows.value = await api.get('agents', { q: q.value, status: status.value });
  } finally {
    loading.value = false;
  }
}
function openEdit(row) {
  editing.value = row || null;
  editOpen.value = true;
}
async function disable(row) {
  await ElMessageBox.confirm(t('agents.disableConfirm'), { type: 'warning' });
  await api.del('agents/' + row.id);
  ElMessage.success(t('common.done'));
  load();
}
async function copyLink(row) {
  const url = `${location.origin}/?invite=${encodeURIComponent(row.code)}`;
  await navigator.clipboard?.writeText(url).catch(() => {});
  ElMessage.success(t('common.copied') + '：' + url);
}
load();
</script>

<style scoped>
.name { color: var(--el-text-color-primary); font-weight: 500; text-decoration: none; }
.name:hover { color: var(--el-color-primary); }
</style>
