<template>
  <div v-loading="loading">
    <div class="grid-cards">
      <div v-for="k in keys" :key="k" class="panel stat"><small class="muted">{{ t('content.user.' + k) }}</small><b class="num">{{ data.stats?.[k] ?? '—' }}</b></div>
    </div>
    <h3 class="panel-title">{{ t('content.user.recentPosts') }}</h3>
    <el-table :data="data.posts || []" size="small">
      <el-table-column :label="t('content.text')" min-width="260"><template #default="{ row }">{{ row.text }}</template></el-table-column>
      <el-table-column :label="t('content.likes')" prop="likes" width="70" />
      <el-table-column :label="t('content.commentsN')" prop="comments" width="70" />
      <el-table-column :label="t('common.status')" width="100"><template #default="{ row }">{{ t('content.status.' + row.status) }}</template></el-table-column>
      <el-table-column :label="t('common.createdAt')" width="150"><template #default="{ row }">{{ dateTime(row.createdAt) }}</template></el-table-column>
    </el-table>
    <h3 class="panel-title" style="margin-top: 16px">{{ t('content.user.reports') }}</h3>
    <el-table :data="data.reports || []" size="small">
      <el-table-column width="90"><template #default="{ row }"><el-tag size="small" :type="row.direction === 'made' ? 'info' : 'danger'">{{ t('content.user.' + row.direction) }}</el-tag></template></el-table-column>
      <el-table-column :label="t('common.type')" width="120"><template #default="{ row }">{{ row.targetType }} · {{ row.targetId }}</template></el-table-column>
      <el-table-column :label="t('common.reason')" prop="reason" />
      <el-table-column :label="t('common.status')" prop="status" width="100" />
      <el-table-column :label="t('common.createdAt')" width="150"><template #default="{ row }">{{ dateTime(row.createdAt) }}</template></el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { dateTime } from '../../core/format';

const props = defineProps({ userId: [Number, String] });
const keys = ['posts', 'comments', 'follows', 'fans', 'visitors', 'contacts', 'groups', 'messages', 'blocks', 'reportsMade', 'reportsAgainst'];
const data = ref({});
const loading = ref(false);
async function load() {
  if (!props.userId) return;
  loading.value = true;
  try {
    data.value = await api.get(`users/${props.userId}/social`);
  } finally {
    loading.value = false;
  }
}
watch(() => props.userId, load, { immediate: true });
</script>

<style scoped>
.stat { display: flex; flex-direction: column; gap: 4px; margin: 0; }
.stat b { font-size: 20px; }
</style>
