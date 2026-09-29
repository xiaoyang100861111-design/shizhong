<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('personas.title') }}</h1>
      <div class="spacer" />
      <template v-if="can('personas.edit')">
        <el-button @click="bulk(true, true)">{{ t('personas.hideAll') }}</el-button>
        <el-button @click="bulk(false, true)">{{ t('personas.showAll') }}</el-button>
        <el-button type="primary" @click="openEdit(null)">{{ t('personas.add') }}</el-button>
      </template>
    </div>
    <p class="page-sub">{{ t('personas.sub') }}</p>
    <div class="panel">
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('personas.q')" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-input v-model="list.filters.city" :placeholder="t('personas.city')" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-select v-model="list.filters.hidden" clearable :placeholder="t('common.status')" @change="list.search">
          <el-option :value="false" :label="t('personas.visible')" /><el-option :value="true" :label="t('personas.hidden')" />
        </el-select>
        <el-select v-model="list.filters.liveMode" clearable :placeholder="t('personas.liveMode')" @change="list.search">
          <el-option value="public" label="public" /><el-option value="private" label="private" />
        </el-select>
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
        <el-button @click="list.reset">{{ t('common.reset') }}</el-button>
        <template v-if="can('personas.edit') && selected.length">
          <el-button type="warning" @click="bulk(true)">{{ t('personas.hideSel') }} ({{ selected.length }})</el-button>
          <el-button @click="bulk(false)">{{ t('personas.showSel') }}</el-button>
        </template>
      </div>
      <el-table v-loading="list.loading.value" :data="list.items.value" stripe @selection-change="rows => (selected = rows)">
        <el-table-column type="selection" width="40" />
        <el-table-column :label="t('personas.name')" min-width="200">
          <template #default="{ row }"><UserCell :name="row.name" :avatar="row.avatar" :sub="row.publicId + ' · ' + row.displayId" :link="false" /></template>
        </el-table-column>
        <el-table-column :label="t('personas.city')" width="150"><template #default="{ row }">{{ row.city }} {{ row.area }}</template></el-table-column>
        <el-table-column :label="t('personas.occupation')" min-width="140" prop="occupation" />
        <el-table-column :label="t('personas.liveMode')" width="90" prop="liveMode" />
        <el-table-column :label="t('personas.fans')" width="70" align="right" prop="fans" />
        <el-table-column :label="t('personas.posts')" width="70" align="right" prop="posts" />
        <el-table-column :label="t('personas.chats')" width="70" align="right" prop="chats" />
        <el-table-column :label="t('common.status')" width="90">
          <template #default="{ row }"><el-tag size="small" :type="row.hidden ? 'info' : 'success'">{{ row.hidden ? t('personas.hidden') : t('personas.visible') }}</el-tag></template>
        </el-table-column>
        <el-table-column v-if="can('personas.edit')" :label="t('common.actions')" width="130" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">{{ t('common.edit') }}</el-button>
            <el-button link :type="row.hidden ? 'success' : 'warning'" @click="toggle(row)">{{ row.hidden ? t('personas.show') : t('personas.hide') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
      <Pager :list="list" />
    </div>

    <el-dialog v-model="editOpen" :title="form.id ? t('personas.edit') : t('personas.add')" width="760px" top="4vh">
      <el-form label-width="90px">
        <div class="two">
          <div>
            <el-form-item :label="t('personas.avatar')"><ImageUpload v-model="form.avatar" purpose="avatar" allow-path path-hint="avatars/women-000.jpg" /></el-form-item>
            <el-form-item :label="t('personas.name')"><el-input v-model="form.name" maxlength="40" /></el-form-item>
            <el-form-item :label="t('personas.age')"><el-input-number v-model="form.age" :min="18" :max="99" /></el-form-item>
            <el-form-item :label="t('personas.gender')"><el-radio-group v-model="form.gender"><el-radio-button value="女">女</el-radio-button><el-radio-button value="男">男</el-radio-button></el-radio-group></el-form-item>
          </div>
          <div>
            <el-form-item :label="t('personas.city')"><el-input v-model="form.city" /></el-form-item>
            <el-form-item :label="t('personas.area')"><el-input v-model="form.area" /></el-form-item>
            <el-form-item :label="t('personas.occupation')"><el-input v-model="form.occupation" /></el-form-item>
            <el-form-item :label="t('common.status')"><el-switch v-model="form.hidden" :active-text="t('personas.hidden')" :inactive-text="t('personas.visible')" /></el-form-item>
          </div>
        </div>
        <el-form-item :label="t('personas.bio')"><el-input v-model="form.bio" type="textarea" :rows="3" maxlength="400" show-word-limit /></el-form-item>
        <el-form-item :label="t('personas.extra')">
          <el-input v-model="form.extra" type="textarea" :autosize="{ minRows: 6, maxRows: 14 }" class="mono" />
          <small class="muted">{{ t('personas.extraHint') }}</small>
        </el-form-item>
        <el-form-item :label="t('personas.extraEn')"><el-input v-model="form.extraEn" type="textarea" :autosize="{ minRows: 3, maxRows: 10 }" class="mono" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="editOpen = false">{{ t('common.cancel') }}</el-button><el-button type="primary" :loading="busy" @click="save">{{ t('common.save') }}</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { can } from '../../core/auth';
import { useList } from '../../core/list';
import Pager from '../../components/Pager.vue';
import UserCell from '../../components/UserCell.vue';
import ImageUpload from '../../components/ImageUpload.vue';

const list = useList('personas', { q: '', city: '', hidden: '', liveMode: '' }, { size: 50 });
const selected = ref([]);
const editOpen = ref(false);
const busy = ref(false);
const form = reactive({ id: null, name: '', age: 25, gender: '女', city: '', area: '', occupation: '', bio: '', avatar: '', hidden: false, extra: '{}', extraEn: '{}' });

async function openEdit(row) {
  if (!row) Object.assign(form, { id: null, name: '', age: 25, gender: '女', city: '吉隆坡', area: '', occupation: '', bio: '', avatar: '', hidden: false,
    extra: JSON.stringify({ tags: [], language: '中文', online: true, liveMode: 'public', distanceKm: 3 }, null, 2), extraEn: '{}' });
  else {
    const p = await api.get('personas/' + row.id);
    Object.assign(form, { id: p.id, name: p.name, age: p.age || 25, gender: p.gender || '女', city: p.city || '', area: p.area || '', occupation: p.occupation || '',
      bio: p.bio || '', avatar: p.avatar || '', hidden: p.hidden, extra: JSON.stringify(p.extra || {}, null, 2), extraEn: JSON.stringify(p.extraEn || {}, null, 2) });
  }
  editOpen.value = true;
}
async function save() {
  let extra, extraEn;
  try {
    extra = JSON.parse(form.extra || '{}');
    extraEn = JSON.parse(form.extraEn || '{}');
  } catch (_) {
    return ElMessage.error(t('personas.badJson'));
  }
  const body = { name: form.name, age: form.age, gender: form.gender, city: form.city, area: form.area, occupation: form.occupation, bio: form.bio, avatar: form.avatar, hidden: form.hidden, extra, extraEn };
  busy.value = true;
  try {
    if (form.id) await api.put('personas/' + form.id, body);
    else await api.post('personas', body);
    ElMessage.success(t('common.saved'));
    editOpen.value = false;
    list.load();
  } finally {
    busy.value = false;
  }
}
async function toggle(row) {
  await api.post('personas/hide', { ids: [row.id], hidden: !row.hidden });
  row.hidden = !row.hidden;
}
async function bulk(hidden, all = false) {
  if (all) await ElMessageBox.confirm(t('personas.confirmAll', { action: hidden ? t('personas.hide') : t('personas.show') }), { type: 'warning' });
  const res = await api.post('personas/hide', { ids: all ? [] : selected.value.map(r => r.id), hidden, all });
  ElMessage.success(t('common.done') + ' (' + res.count + ')');
  list.load();
}
</script>

<style scoped>
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
.mono :deep(textarea) { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
</style>
