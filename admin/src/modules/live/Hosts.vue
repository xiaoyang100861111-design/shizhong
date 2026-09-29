<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('live.hosts') }}</h1>
      <el-radio-group v-model="list.filters.status" @change="list.search">
        <el-radio-button value="pending">{{ t('live.pending') }}</el-radio-button>
        <el-radio-button value="approved">{{ t('live.approved') }}</el-radio-button>
        <el-radio-button value="rejected">{{ t('live.rejected') }}</el-radio-button>
        <el-radio-button value="suspended">{{ t('live.suspended') }}</el-radio-button>
        <el-radio-button value="">{{ t('live.all') }}</el-radio-button>
      </el-radio-group>
    </div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('common.keyword')" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
      </div>
      <el-table v-loading="list.loading.value" :data="list.items.value" stripe>
        <el-table-column :label="t('live.host')" min-width="170">
          <template #default="{ row }">
            <UserCell :id="row.userId" :name="row.name" :avatar="row.avatar" :display-id="row.displayId" />
            <el-tag v-if="row.online" size="small" type="success">{{ t('live.online') }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('common.status')" width="100">
          <template #default="{ row }"><el-tag size="small" :type="['warning', 'success', 'info', 'danger'][row.status]">{{ t('live.status.' + row.status) }}</el-tag></template>
        </el-table-column>
        <el-table-column :label="t('common.remark')" min-width="180">
          <template #default="{ row }">{{ row.intro || '—' }}<div v-if="row.note" class="muted">{{ row.note }}</div></template>
        </el-table-column>
        <el-table-column :label="t('live.rate')" width="100" align="right"><template #default="{ row }"><span class="num">{{ money(row.rate) }}</span></template></el-table-column>
        <el-table-column :label="t('live.liveShare') + ' / ' + t('live.privateShare')" width="130">
          <template #default="{ row }"><span class="num">{{ pct(row.liveShare) }} / {{ pct(row.privateShare) }}</span></template>
        </el-table-column>
        <el-table-column :label="t('live.lives') + ' / ' + t('live.calls')" width="100" align="right"><template #default="{ row }"><span class="num">{{ row.lives }} / {{ row.calls }}</span></template></el-table-column>
        <el-table-column :label="t('live.held') + ' / ' + t('live.released')" width="160" align="right">
          <template #default="{ row }"><span class="num">{{ money(row.held, '') }} / {{ money(row.released, '') }}</span></template>
        </el-table-column>
        <el-table-column :label="t('live.applied')" width="140"><template #default="{ row }"><span class="num">{{ dateTime(row.appliedAt) }}</span></template></el-table-column>
        <el-table-column :label="t('common.actions')" width="200" fixed="right">
          <template #default="{ row }">
            <template v-if="row.status === 0">
              <el-button v-can="'live.audit'" link type="success" @click="review(row, true)">{{ t('live.approve') }}</el-button>
              <el-button v-can="'live.audit'" link type="danger" @click="review(row, false)">{{ t('live.reject') }}</el-button>
            </template>
            <el-button v-can="'live.manage'" link type="primary" @click="openEdit(row)">{{ t('live.edit') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
      <Pager :list="list" />
    </div>

    <el-dialog v-model="open" :title="t('live.edit')" width="460px">
      <el-form label-width="120px">
        <el-form-item :label="t('live.rate')"><el-input-number v-model="form.rate" :min="0" :precision="2" :step="0.5" /> <span class="muted">RM</span></el-form-item>
        <el-form-item :label="t('live.liveShare')"><el-input-number v-model="form.liveShare" :min="0" :max="1" :step="0.05" :precision="2" :placeholder="t('live.defaultShare')" /></el-form-item>
        <el-form-item :label="t('live.privateShare')"><el-input-number v-model="form.privateShare" :min="0" :max="1" :step="0.05" :precision="2" :placeholder="t('live.defaultShare')" /></el-form-item>
        <p class="muted">{{ t('live.shareHint') }}</p>
        <el-form-item :label="t('common.status')">
          <el-select v-model="form.status"><el-option v-for="s in [0, 1, 2, 3]" :key="s" :value="s" :label="t('live.status.' + s)" /></el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="open = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="save">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { useList } from '../../core/list';
import { dateTime, money } from '../../core/format';
import Pager from '../../components/Pager.vue';
import UserCell from '../../components/UserCell.vue';

const list = useList('live/hosts', { status: 'pending', q: '' });
const pct = v => (v === null || v === undefined ? t('live.defaultShare') : Math.round(v * 100) + '%');
async function review(row, approve) {
  let note = '';
  if (!approve) note = (await ElMessageBox.prompt(t('live.rejectNote'), t('live.reject'), { type: 'warning' })).value || '';
  await api.post(`live/hosts/${row.userId}/review`, { approve, note });
  ElMessage.success(t('common.done'));
  list.load();
}
const open = ref(false);
const form = reactive({ userId: 0, rate: 2, liveShare: null, privateShare: null, status: 1 });
function openEdit(row) {
  Object.assign(form, { userId: row.userId, rate: row.rate, liveShare: row.liveShare, privateShare: row.privateShare, status: row.status });
  open.value = true;
}
async function save() {
  await api.put(`live/hosts/${form.userId}`, { rate: form.rate, liveShare: form.liveShare ?? null, privateShare: form.privateShare ?? null, status: form.status });
  ElMessage.success(t('common.saved'));
  open.value = false;
  list.load();
}
</script>
