<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('sys.roles') }}</h1>
      <div class="spacer" />
      <el-button type="primary" :icon="IconPlus" @click="edit()">{{ t('sys.addRole') }}</el-button>
    </div>
    <p class="page-sub">{{ t('sys.scopeHelp') }}</p>
    <div class="panel">
      <el-table v-loading="loading" :data="roles">
        <el-table-column :label="t('sys.roleName')" min-width="160">
          <template #default="{ row }"><b>{{ row.name }}</b> <el-tag v-if="row.builtIn" size="small" effect="plain">{{ t('sys.builtIn') }}</el-tag><div class="muted">{{ row.code }}</div></template>
        </el-table-column>
        <el-table-column prop="description" :label="t('sys.roleDesc')" min-width="200" />
        <el-table-column :label="t('sys.dataScope')" width="150"><template #default="{ row }"><el-tag type="warning" effect="plain">{{ t('layout.scope.' + row.dataScope) }}</el-tag></template></el-table-column>
        <el-table-column :label="t('sys.perms')" min-width="240">
          <template #default="{ row }">
            <span v-if="row.permissions.includes('*')" class="muted">*</span>
            <div v-else class="tag-list"><el-tag v-for="m in menusOf(row)" :key="m" size="small" type="info">{{ m }}</el-tag></div>
          </template>
        </el-table-column>
        <el-table-column prop="adminCount" :label="t('sys.adminCount')" width="90" align="right" />
        <el-table-column :label="t('common.actions')" width="140" fixed="right">
          <template #default="{ row }">
            <template v-if="row.code !== 'super'">
              <el-button link type="primary" @click="edit(row)">{{ t('common.edit') }}</el-button>
              <el-button link type="danger" :disabled="row.adminCount > 0" @click="remove(row)">{{ t('common.delete') }}</el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-drawer v-model="open" :title="form.id ? t('sys.editRole') : t('sys.addRole')" size="640px">
      <el-form label-width="100px">
        <el-form-item :label="t('sys.roleCode')" required><el-input v-model="form.code" :disabled="!!form.id" maxlength="40" /></el-form-item>
        <el-form-item :label="t('sys.roleName')" required><el-input v-model="form.name" maxlength="60" /></el-form-item>
        <el-form-item :label="t('sys.roleDesc')"><el-input v-model="form.description" maxlength="400" /></el-form-item>
        <el-form-item :label="t('sys.dataScope')">
          <el-select v-model="form.dataScope" style="width: 100%">
            <el-option v-for="s in scopes" :key="s" :value="s" :label="t('layout.scope.' + s)" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('sys.perms')">
          <div class="perm-tree">
            <div v-for="m in menus" :key="m.menu" class="perm-menu">
              <el-checkbox :model-value="menuState(m) === 'all'" :indeterminate="menuState(m) === 'some'" @change="v => toggleMenu(m, v)">
                <b>{{ pick(m) }}</b>
              </el-checkbox>
              <div class="perm-items">
                <el-checkbox v-for="p in m.permissions" :key="p.code" :model-value="has(p.code)" @change="v => toggle(p.code, v)">{{ pick(p) }}</el-checkbox>
              </div>
            </div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="open = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="busy" @click="save">{{ t('common.save') }}</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus as IconPlus } from '@element-plus/icons-vue';
import { api } from '../../core/api';
import { t, pick } from '../../core/i18n';

const roles = ref([]);
const menus = ref([]);
const scopes = ref([]);
const loading = ref(false);
const open = ref(false);
const busy = ref(false);
const form = reactive({ id: null, code: '', name: '', description: '', dataScope: 'all', permissions: [] });

async function load() {
  loading.value = true;
  try {
    const [r, p] = await Promise.all([api.get('roles'), api.get('permissions')]);
    roles.value = r;
    menus.value = p.menus;
    scopes.value = p.scopes;
  } finally {
    loading.value = false;
  }
}
function menusOf(row) {
  const set = new Set(row.permissions.map(p => p.split('.')[0]));
  return menus.value.filter(m => set.has(m.menu)).map(m => pick(m));
}
// Permissions are stored expanded; "menu.*" wildcards (built-in roles) are expanded when editing.
function expand(perms) {
  const out = new Set();
  for (const p of perms) {
    if (p.endsWith('.*')) menus.value.find(m => m.menu === p.slice(0, -2))?.permissions.forEach(x => out.add(x.code));
    else out.add(p);
  }
  return [...out];
}
const has = code => form.permissions.includes(code);
function toggle(code, on) {
  form.permissions = on ? [...new Set([...form.permissions, code])] : form.permissions.filter(c => c !== code);
}
function menuState(m) {
  const n = m.permissions.filter(p => has(p.code)).length;
  return n === 0 ? 'none' : n === m.permissions.length ? 'all' : 'some';
}
function toggleMenu(m, on) {
  const codes = m.permissions.map(p => p.code);
  form.permissions = on ? [...new Set([...form.permissions, ...codes])] : form.permissions.filter(c => !codes.includes(c));
}
function edit(row) {
  Object.assign(form, row ? { ...row, permissions: expand(row.permissions) } : { id: null, code: '', name: '', description: '', dataScope: 'all', permissions: [] });
  open.value = true;
}
async function save() {
  busy.value = true;
  try {
    const body = { code: form.code, name: form.name, description: form.description, dataScope: form.dataScope, permissions: form.permissions };
    if (form.id) await api.put('roles/' + form.id, body);
    else await api.post('roles', body);
    ElMessage.success(t('common.saved'));
    open.value = false;
    load();
  } finally {
    busy.value = false;
  }
}
async function remove(row) {
  await ElMessageBox.confirm(t('common.confirmDelete'), { type: 'warning' });
  await api.del('roles/' + row.id);
  ElMessage.success(t('common.deleted'));
  load();
}
load();
</script>

<style scoped>
.perm-tree { display: flex; flex-direction: column; gap: 10px; width: 100%; }
.perm-menu { border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 8px 12px; }
.perm-items { display: flex; flex-wrap: wrap; gap: 0 16px; padding-left: 24px; }
</style>
