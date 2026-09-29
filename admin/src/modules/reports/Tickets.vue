<template>
  <div class="page">
    <div class="page-head"><h1>{{ t(kind === 'report' ? 'reports.reports' : 'reports.feedback') }}</h1></div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('common.keyword')" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-select v-model="list.filters.status" clearable :placeholder="t('common.status')" @change="list.search">
          <el-option v-for="s in ['received', 'processing', 'resolved', 'rejected']" :key="s" :value="s" :label="t('reports.status.' + s)" />
        </el-select>
        <el-select v-if="kind === 'report'" v-model="list.filters.targetType" clearable :placeholder="t('reports.target')" @change="list.search">
          <el-option v-for="s in ['person', 'post', 'comment', 'group', 'message', 'live-room']" :key="s" :value="s" :label="t('reports.targetType.' + s)" />
        </el-select>
        <el-date-picker v-model="list.filters.range" type="daterange" :start-placeholder="t('common.from')" :end-placeholder="t('common.to')" @change="list.search" />
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
        <el-button @click="list.reset">{{ t('common.reset') }}</el-button>
      </div>
      <el-table v-loading="list.loading.value" :data="list.items.value" stripe>
        <el-table-column :label="t(kind === 'report' ? 'reports.reporter' : 'reports.member')" min-width="160">
          <template #default="{ row }"><UserCell :id="row.user.id" :name="row.user.name" :avatar="row.user.avatar" :display-id="row.user.displayId" /></template>
        </el-table-column>
        <el-table-column v-if="kind === 'report'" :label="t('reports.target')" min-width="220">
          <template #default="{ row }">
            <el-tag size="small">{{ t('reports.targetType.' + row.targetType) }}</el-tag> <small class="muted">{{ row.targetId }}</small>
            <div v-if="row.subject" class="subject">
              <UserCell :id="row.subject.persona ? null : row.subject.id" :name="row.subject.name" :avatar="row.subject.avatar" :display-id="row.subject.displayId" :size="24" />
              <el-tag v-if="row.subject.reports > 1" size="small" type="danger">{{ t('reports.times', { n: row.subject.reports }) }}</el-tag>
              <el-tag v-if="row.subject.status === 1" size="small" type="danger">{{ t('reports.banned') }}</el-tag>
              <el-tag v-else-if="row.subject.mutedUntil && row.subject.mutedUntil > Date.now()" size="small" type="warning">{{ t('reports.muted') }}</el-tag>
            </div>
            <div v-if="row.data?.snapshot" class="muted snap">“{{ row.data.snapshot }}”</div>
          </template>
        </el-table-column>
        <el-table-column :label="kind === 'report' ? t('reports.reason') : t('reports.type')" width="110">
          <template #default="{ row }">{{ kind === 'report' ? reasonName(row.reason) : t('reports.fbType.' + (row.reason || 'misc')) }}</template>
        </el-table-column>
        <el-table-column :label="t('reports.details')" min-width="220">
          <template #default="{ row }">
            <div class="pre">{{ row.details || '—' }}</div>
            <small v-if="row.data?.contact" class="muted">{{ t('reports.contact') }}: {{ row.data.contact }}</small>
            <div v-if="row.reply" class="reply">↳ {{ row.reply }}</div>
          </template>
        </el-table-column>
        <el-table-column :label="t('common.status')" width="120">
          <template #default="{ row }">
            <el-tag size="small" :type="{ received: 'warning', processing: 'warning', resolved: 'success' }[row.status] || 'info'">{{ t('reports.status.' + row.status) }}</el-tag>
            <div v-if="row.resolution" class="muted small">{{ t('reports.action.' + row.resolution) }}</div>
            <div v-if="row.handledBy" class="muted small">{{ row.handledBy }}</div>
          </template>
        </el-table-column>
        <el-table-column :label="t('common.createdAt')" width="150"><template #default="{ row }"><span class="num">{{ dateTime(row.createdAt) }}</span></template></el-table-column>
        <el-table-column v-if="can('reports.handle')" :label="t('common.actions')" width="90" fixed="right">
          <template #default="{ row }"><el-button link type="primary" @click="openHandle(row)">{{ t(kind === 'report' ? 'reports.handle' : 'reports.answer') }}</el-button></template>
        </el-table-column>
      </el-table>
      <Pager :list="list" />
    </div>

    <el-dialog v-model="open" :title="t(kind === 'report' ? 'reports.handle' : 'reports.answer')" width="540px">
      <el-form label-width="110px">
        <el-form-item :label="t('common.actions')">
          <el-radio-group v-model="form.action">
            <el-radio-button v-for="a in actions" :key="a" :value="a" :disabled="needsSubject(a) && !current?.subject">{{ t('reports.action.' + a) }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.action === 'mute'" :label="t('reports.hours')"><el-input-number v-model="form.hours" :min="1" :max="8760" /></el-form-item>
        <el-form-item v-if="kind === 'report' && ['post', 'comment', 'group', 'message'].includes(current?.targetType)" label=" ">
          <el-checkbox v-model="form.hideContent">{{ t('reports.hideContent') }}</el-checkbox>
        </el-form-item>
        <el-form-item :label="t('reports.reply')">
          <el-input v-model="form.reply" type="textarea" :rows="3" maxlength="1000" show-word-limit />
          <small class="muted">{{ t('reports.replyHint') }}</small>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="open = false">{{ t('common.cancel') }}</el-button><el-button type="primary" :loading="busy" @click="submit">{{ t('common.submit') }}</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { can } from '../../core/auth';
import { useList } from '../../core/list';
import { dateTime } from '../../core/format';
import Pager from '../../components/Pager.vue';
import UserCell from '../../components/UserCell.vue';

const props = defineProps({ kind: { type: String, default: 'report' } });
const list = useList(() => 'reports', { kind: props.kind, q: '', status: '', targetType: '', range: [] });
const actions = computed(() => (props.kind === 'report' ? ['resolve', 'warn', 'mute', 'ban', 'dismiss'] : ['resolve', 'dismiss']));
const needsSubject = a => ['warn', 'mute', 'ban'].includes(a);
const reasonName = r => { const k = 'reports.reasonName.' + r; const s = t(k); return s === k ? r : s; };
const open = ref(false);
const busy = ref(false);
const current = ref(null);
const form = reactive({ action: 'resolve', hours: 24, reply: '', hideContent: false });
function openHandle(row) {
  current.value = row;
  Object.assign(form, { action: 'resolve', hours: 24, reply: row.reply || '', hideContent: false });
  open.value = true;
}
async function submit() {
  busy.value = true;
  try {
    await api.post(`reports/${current.value.id}/handle`, { ...form });
    ElMessage.success(t('common.done'));
    open.value = false;
    list.load();
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.subject { display: flex; align-items: center; gap: 6px; margin-top: 4px; flex-wrap: wrap; }
.snap { margin-top: 4px; font-size: 12px; max-height: 3.2em; overflow: hidden; }
.pre { white-space: pre-wrap; word-break: break-word; }
.reply { color: var(--el-color-success); font-size: 12px; margin-top: 4px; }
.small { font-size: 12px; }
</style>
