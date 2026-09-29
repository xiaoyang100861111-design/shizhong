<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('sys.admins') }}</h1>
      <div class="spacer" />
      <el-button type="primary" :icon="IconPlus" @click="edit()">{{ t('sys.addAdmin') }}</el-button>
    </div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('common.keyword')" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-select v-model="list.filters.roleId" clearable :placeholder="t('sys.role')" @change="list.search">
          <el-option v-for="r in roles" :key="r.id" :value="r.id" :label="r.name" />
        </el-select>
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
      </div>
      <el-table v-loading="list.loading.value" :data="list.items.value">
        <el-table-column :label="t('sys.username')" min-width="150"><template #default="{ row }"><b>{{ row.username }}</b><div class="muted">{{ row.name }}</div></template></el-table-column>
        <el-table-column :label="t('sys.role')" width="130"><template #default="{ row }"><el-tag size="small">{{ row.roleName }}</el-tag></template></el-table-column>
        <el-table-column :label="t('sys.dataScope')" width="150"><template #default="{ row }">{{ t('layout.scope.' + row.dataScope) }}<div v-if="row.regions?.length" class="muted">{{ row.regions.join('、') }}</div></template></el-table-column>
        <el-table-column :label="t('sys.agent')" width="130"><template #default="{ row }">{{ row.agentName || '—' }}</template></el-table-column>
        <el-table-column :label="t('sys.merchant')" width="90"><template #default="{ row }">{{ row.merchantId || '—' }}</template></el-table-column>
        <el-table-column :label="t('common.status')" width="80"><template #default="{ row }"><el-tag :type="row.status ? 'info' : 'success'" size="small">{{ row.status ? t('common.disabled') : t('common.enabled') }}</el-tag></template></el-table-column>
        <el-table-column :label="t('sys.lastLogin')" width="170"><template #default="{ row }"><span class="num">{{ dateTime(row.lastLoginAt) }}</span><div class="muted num">{{ row.lastLoginIp }}</div></template></el-table-column>
        <el-table-column :label="t('common.actions')" width="130" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="edit(row)">{{ t('common.edit') }}</el-button>
            <el-button link type="danger" :disabled="row.id === session.me?.id" @click="remove(row)">{{ t('common.delete') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
      <Pager :list="list" />
    </div>

    <el-dialog v-model="open" :title="form.id ? t('sys.editAdmin') : t('sys.addAdmin')" width="520px">
      <el-form label-width="120px">
        <el-form-item :label="t('sys.username')" required><el-input v-model="form.username" :disabled="!!form.id" maxlength="40" autocomplete="off" /></el-form-item>
        <el-form-item :label="t('sys.password')" :required="!form.id">
          <el-input v-model="form.password" type="password" show-password autocomplete="new-password" :placeholder="form.id ? t('sys.passwordKeep') : ''" />
        </el-form-item>
        <el-form-item :label="t('common.name')"><el-input v-model="form.name" maxlength="60" /></el-form-item>
        <el-form-item :label="t('common.phone')"><el-input v-model="form.phone" maxlength="32" /></el-form-item>
        <el-form-item :label="t('sys.role')" required>
          <el-select v-model="form.roleId" style="width: 100%">
            <el-option v-for="r in roles" :key="r.id" :value="r.id" :label="`${r.name}（${t('layout.scope.' + r.dataScope)}）`" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('sys.scopeOverride')">
          <el-select v-model="form.dataScope" clearable :placeholder="t('sys.inherit')" style="width: 100%">
            <el-option v-for="s in scopes" :key="s" :value="s" :label="t('layout.scope.' + s)" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="effectiveScope === 'region'" :label="t('sys.regions')">
          <el-select v-model="form.regions" multiple filterable allow-create style="width: 100%" placeholder="吉隆坡、槟城…" />
        </el-form-item>
        <el-form-item v-if="['agent', 'agentTree'].includes(effectiveScope)" :label="t('sys.agent')"><AgentSelect v-model="form.agentId" style="width: 100%" /></el-form-item>
        <el-form-item v-if="effectiveScope === 'merchant'" :label="t('sys.merchant')"><el-input-number v-model="form.merchantId" :min="1" controls-position="right" /></el-form-item>
        <el-form-item v-if="form.id" :label="t('common.status')">
          <el-radio-group v-model="form.status"><el-radio :value="0">{{ t('common.enabled') }}</el-radio><el-radio :value="1">{{ t('common.disabled') }}</el-radio></el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="open = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="busy" :disabled="!form.username || !form.roleId || (!form.id && !form.password)" @click="save">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus as IconPlus } from '@element-plus/icons-vue';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { session } from '../../core/auth';
import { useList } from '../../core/list';
import { dateTime } from '../../core/format';
import Pager from '../../components/Pager.vue';
import AgentSelect from '../../components/AgentSelect.vue';

const list = useList('admins', { q: '', roleId: null });
const roles = ref([]);
const scopes = ref([]);
const open = ref(false);
const busy = ref(false);
const blank = () => ({ id: null, username: '', password: '', name: '', phone: '', roleId: null, dataScope: null, regions: [], agentId: null, merchantId: null, status: 0 });
const form = reactive(blank());
const effectiveScope = computed(() => form.dataScope || roles.value.find(r => r.id === form.roleId)?.dataScope || 'all');

async function loadMeta() {
  const [r, p] = await Promise.all([api.get('roles'), api.get('permissions')]);
  roles.value = r;
  scopes.value = p.scopes;
}
function edit(row) {
  Object.assign(form, blank(), row ? { ...row, password: '', dataScope: row.scopeOverride || null } : {});
  open.value = true;
}
async function save() {
  busy.value = true;
  try {
    const body = { ...form, password: form.password || null };
    if (form.id) await api.put('admins/' + form.id, body);
    else await api.post('admins', body);
    ElMessage.success(t('common.saved'));
    open.value = false;
    list.load();
  } finally {
    busy.value = false;
  }
}
async function remove(row) {
  await ElMessageBox.confirm(t('common.confirmDelete'), { type: 'warning' });
  await api.del('admins/' + row.id);
  ElMessage.success(t('common.deleted'));
  list.load();
}
loadMeta();
</script>
