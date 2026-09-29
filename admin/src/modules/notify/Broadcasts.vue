<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('notify.title') }}</h1>
      <div class="spacer" />
      <el-button v-can="'notify.send'" type="primary" :icon="IconPromotion" @click="open = true">{{ t('notify.send') }}</el-button>
    </div>
    <div class="panel">
      <el-table v-loading="list.loading.value" :data="list.items.value">
        <el-table-column :label="t('common.type')" width="80"><template #default="{ row }"><el-tag size="small">{{ t('notify.type.' + row.type) }}</el-tag></template></el-table-column>
        <el-table-column :label="t('notify.titleL')" min-width="220"><template #default="{ row }"><b>{{ row.title }}</b><div class="muted">{{ row.body }}</div></template></el-table-column>
        <el-table-column :label="t('notify.audience')" width="160"><template #default="{ row }">{{ t('notify.aud.' + (row.audience?.kind || 'all')) }}</template></el-table-column>
        <el-table-column :label="t('notify.sentCount')" align="right" width="90"><template #default="{ row }">{{ number(row.sentCount) }}</template></el-table-column>
        <el-table-column :label="t('notify.sentAt')" width="160">
          <template #default="{ row }"><span v-if="row.sentAt" class="num">{{ dateTime(row.sentAt) }}</span><el-tag v-else type="warning" size="small">{{ t('notify.pending') }} {{ dateTime(row.scheduledAt) }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="adminName" :label="t('common.operator')" width="110" />
      </el-table>
      <Pager :list="list" />
    </div>

    <el-dialog v-model="open" :title="t('notify.send')" width="560px">
      <el-form label-width="100px">
        <el-form-item :label="t('common.type')">
          <el-radio-group v-model="form.type">
            <el-radio-button v-for="k in ['system', 'promo', 'order', 'social']" :key="k" :value="k">{{ t('notify.type.' + k) }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="t('notify.audience')">
          <el-select v-model="form.kind" style="width: 100%">
            <el-option v-for="k in ['all', 'users', 'agent', 'city', 'marketing']" :key="k" :value="k" :label="t('notify.aud.' + k)" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="form.kind === 'users'" :label="t('notify.ids')"><el-input v-model="form.ids" type="textarea" :rows="3" /></el-form-item>
        <el-form-item v-if="form.kind === 'agent'" :label="t('notify.agent')"><AgentSelect v-model="form.agentId" style="width: 100%" /></el-form-item>
        <el-form-item v-if="form.kind === 'city'" :label="t('notify.city')"><el-input v-model="form.city" placeholder="吉隆坡" /></el-form-item>
        <el-form-item :label="t('notify.titleL')" required><el-input v-model="form.title" maxlength="200" show-word-limit /></el-form-item>
        <el-form-item :label="t('notify.body')"><el-input v-model="form.body" type="textarea" :rows="3" maxlength="1000" show-word-limit /></el-form-item>
        <el-form-item :label="t('notify.action')">
          <el-input v-model="form.actionName" :placeholder="t('notify.actionHint')" style="width: 60%" />
          <el-input v-model="form.actionId" :placeholder="t('notify.actionId')" style="width: 38%; margin-left: 2%" />
        </el-form-item>
        <el-form-item :label="t('notify.schedule')"><el-date-picker v-model="form.scheduledAt" type="datetime" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="open = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="busy" :disabled="!form.title.trim()" @click="send">{{ t('notify.send') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Promotion as IconPromotion } from '@element-plus/icons-vue';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { useList } from '../../core/list';
import { dateTime, number } from '../../core/format';
import Pager from '../../components/Pager.vue';
import AgentSelect from '../../components/AgentSelect.vue';

const list = useList('broadcasts');
const open = ref(false);
const busy = ref(false);
const form = reactive({ type: 'system', kind: 'all', ids: '', agentId: null, city: '', title: '', body: '', actionName: '', actionId: '', scheduledAt: null });

async function send() {
  await ElMessageBox.confirm(t('notify.confirm'), { type: 'warning' });
  const audience = { kind: form.kind };
  if (form.kind === 'users') audience.ids = form.ids.split(/[\s,，]+/).filter(Boolean);
  if (form.kind === 'agent') audience.agentId = form.agentId;
  if (form.kind === 'city') audience.city = form.city;
  busy.value = true;
  try {
    const res = await api.post('broadcasts', {
      type: form.type, title: form.title, body: form.body, actionName: form.actionName, actionId: form.actionId, audience,
      scheduledAt: form.scheduledAt ? +new Date(form.scheduledAt) : null,
    });
    ElMessage.success(form.scheduledAt ? t('common.done') : t('notify.sentDone', { n: res.sent }));
    open.value = false;
    Object.assign(form, { title: '', body: '', ids: '', scheduledAt: null });
    list.search();
  } finally {
    busy.value = false;
  }
}
</script>
