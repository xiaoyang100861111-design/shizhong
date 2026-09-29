<template>
  <div class="page">
    <div class="page-head"><h1>{{ t('content.groups') }}</h1></div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('content.group.name') + ' / ID'" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-select v-model="list.filters.status" clearable :placeholder="t('common.status')" @change="list.search">
          <el-option v-for="s in ['active', 'hidden', 'dissolved']" :key="s" :value="s" :label="t('content.group.status.' + s)" />
        </el-select>
        <el-select v-model="list.filters.kind" clearable :placeholder="t('common.type')" @change="list.search">
          <el-option value="imported" :label="t('content.group.imported')" /><el-option value="member" :label="t('content.group.created')" />
        </el-select>
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
        <el-button @click="list.reset">{{ t('common.reset') }}</el-button>
      </div>
      <el-table v-loading="list.loading.value" :data="list.items.value" stripe>
        <el-table-column :label="t('content.group.name')" min-width="240">
          <template #default="{ row }"><b>{{ row.icon && row.icon.length <= 2 ? row.icon + ' ' : '' }}{{ row.name }}</b><div class="muted">{{ row.desc }}</div><small class="muted">{{ row.id }} · {{ row.city }}</small></template>
        </el-table-column>
        <el-table-column :label="t('content.group.owner')" min-width="150">
          <template #default="{ row }"><UserCell v-if="row.owner" :id="row.owner.id" :name="row.owner.name" :display-id="row.owner.displayId" /><el-tag v-else size="small" type="info">{{ t('content.group.imported') }}</el-tag></template>
        </el-table-column>
        <el-table-column :label="t('content.group.members')" width="90" align="right">
          <template #default="{ row }"><el-button link type="primary" @click="openMembers(row)">{{ row.members }}{{ row.maxMembers ? ' / ' + row.maxMembers : '' }}</el-button></template>
        </el-table-column>
        <el-table-column :label="t('content.group.messages')" width="80" align="right"><template #default="{ row }"><span class="num">{{ row.messages }}</span></template></el-table-column>
        <el-table-column :label="t('common.status')" width="90">
          <template #default="{ row }"><el-tag size="small" :type="row.status === 'active' ? 'success' : row.status === 'hidden' ? 'warning' : 'info'">{{ t('content.group.status.' + row.status) }}</el-tag></template>
        </el-table-column>
        <el-table-column :label="t('common.createdAt')" width="150"><template #default="{ row }"><span class="num">{{ dateTime(row.createdAt) }}</span></template></el-table-column>
        <el-table-column v-if="can('content.groups')" :label="t('common.actions')" width="90" fixed="right">
          <template #default="{ row }"><el-button link type="primary" @click="edit(row)">{{ t('common.edit') }}</el-button></template>
        </el-table-column>
      </el-table>
      <Pager :list="list" />
    </div>

    <el-dialog v-model="editOpen" :title="t('content.group.edit')" width="520px">
      <el-form label-width="100px">
        <el-form-item :label="t('content.group.name')"><el-input v-model="form.name" maxlength="80" show-word-limit /></el-form-item>
        <el-form-item :label="t('content.group.desc')"><el-input v-model="form.desc" type="textarea" :rows="3" maxlength="600" show-word-limit /></el-form-item>
        <el-form-item :label="t('content.group.max')"><el-input-number v-model="form.maxMembers" :min="0" :max="5000" /><small class="muted" style="margin-left: 8px">{{ t('content.group.maxHint') }}</small></el-form-item>
        <el-form-item :label="t('common.status')">
          <el-radio-group v-model="form.status"><el-radio-button v-for="s in ['active', 'hidden', 'dissolved']" :key="s" :value="s">{{ t('content.group.status.' + s) }}</el-radio-button></el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="editOpen = false">{{ t('common.cancel') }}</el-button><el-button type="primary" @click="save">{{ t('common.save') }}</el-button></template>
    </el-dialog>

    <el-drawer v-model="membersOpen" :title="current?.name" size="420px">
      <el-table :data="members" size="small">
        <el-table-column :label="t('common.user')"><template #default="{ row }"><UserCell :id="row.persona ? null : row.id" :name="row.name" :avatar="row.avatar" :display-id="row.displayId" /></template></el-table-column>
        <el-table-column width="80"><template #default="{ row }"><el-tag size="small" :type="row.role === 'member' ? 'info' : 'warning'">{{ t('content.group.role.' + row.role) }}</el-tag></template></el-table-column>
        <el-table-column v-if="can('content.groups')" width="70"><template #default="{ row }"><el-button link type="danger" @click="kick(row)">{{ t('content.group.kick') }}</el-button></template></el-table-column>
      </el-table>
    </el-drawer>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { can } from '../../core/auth';
import { useList } from '../../core/list';
import { dateTime } from '../../core/format';
import Pager from '../../components/Pager.vue';
import UserCell from '../../components/UserCell.vue';

const list = useList('content/groups', { q: '', status: '', kind: '' });
const editOpen = ref(false);
const form = reactive({ id: '', name: '', desc: '', maxMembers: 0, status: 'active' });
function edit(row) {
  Object.assign(form, { id: row.id, name: row.name, desc: row.desc || '', maxMembers: row.maxMembers || 0, status: row.status });
  editOpen.value = true;
}
async function save() {
  await api.patch('content/groups/' + encodeURIComponent(form.id), { name: form.name, desc: form.desc, maxMembers: form.maxMembers || 0, status: form.status });
  editOpen.value = false;
  ElMessage.success(t('common.saved'));
  list.load();
}
const membersOpen = ref(false);
const members = ref([]);
const current = ref(null);
async function openMembers(row) {
  current.value = row;
  membersOpen.value = true;
  members.value = await api.get(`content/groups/${encodeURIComponent(row.id)}/members`);
}
async function kick(row) {
  await ElMessageBox.confirm(t('content.group.kick') + ' ' + row.name + '?', { type: 'warning' });
  await api.del(`content/groups/${encodeURIComponent(current.value.id)}/members/${row.id}`);
  members.value = members.value.filter(m => m.id !== row.id);
  list.load();
}
</script>
