<template>
  <div class="page">
    <div class="page-head"><h1>{{ t('content.posts') }}</h1></div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('content.q')" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-select v-model="list.filters.status" clearable :placeholder="t('common.status')" @change="list.search">
          <el-option v-for="s in ['pending', 'visible', 'hidden', 'deleted']" :key="s" :value="s" :label="t('content.status.' + s)" />
        </el-select>
        <el-select v-model="list.filters.kind" clearable :placeholder="t('content.allKinds')" @change="list.search">
          <el-option value="member" :label="t('content.member')" /><el-option value="persona" :label="t('content.persona')" />
        </el-select>
        <el-date-picker v-model="list.filters.range" type="daterange" :start-placeholder="t('common.from')" :end-placeholder="t('common.to')" @change="list.search" />
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
        <el-button @click="list.reset">{{ t('common.reset') }}</el-button>
      </div>
      <el-table v-loading="list.loading.value" :data="list.items.value" stripe>
        <el-table-column :label="t('content.author')" min-width="170">
          <template #default="{ row }">
            <UserCell :id="row.user.persona ? null : row.user.id" :name="row.user.name" :avatar="row.user.avatar" :display-id="row.user.displayId" />
            <el-tag v-if="row.user.persona" size="small" type="info">{{ t('content.persona') }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('content.text')" min-width="320">
          <template #default="{ row }">
            <div class="post-cell">
              <el-image v-if="row.image" :src="assetUrl(row.image)" class="thumb" fit="cover" :preview-src-list="[assetUrl(row.image)]" preview-teleported />
              <div>
                <div class="post-text">{{ row.text }}</div>
                <small class="muted">#{{ row.topic || '—' }} · {{ row.place || row.city || '' }} · {{ row.id }}</small>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="t('content.likes')" width="70" align="right"><template #default="{ row }"><span class="num">{{ row.likes }}</span></template></el-table-column>
        <el-table-column :label="t('content.commentsN')" width="70" align="right">
          <template #default="{ row }"><router-link :to="'/content/comments?post=' + row.id" class="num">{{ row.comments }}</router-link></template>
        </el-table-column>
        <el-table-column :label="t('content.visibility')" width="80"><template #default="{ row }">{{ t('content.' + row.visibility) }}</template></el-table-column>
        <el-table-column :label="t('common.status')" width="100">
          <template #default="{ row }"><el-tag size="small" :type="tagType(row.status)">{{ t('content.status.' + row.status) }}</el-tag></template>
        </el-table-column>
        <el-table-column :label="t('common.createdAt')" width="150"><template #default="{ row }"><span class="num">{{ dateTime(row.createdAt) }}</span></template></el-table-column>
        <el-table-column v-if="can('content.edit')" :label="t('common.actions')" width="170" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'pending'" link type="success" @click="setStatus(row, 'approve')">{{ t('content.approve') }}</el-button>
            <el-button v-if="row.status === 'visible' || row.status === 'pending'" link type="warning" @click="setStatus(row, 'hidden')">{{ t('content.hide') }}</el-button>
            <el-button v-if="row.status === 'hidden' || row.status === 'deleted'" link type="primary" @click="setStatus(row, 'visible')">{{ t('content.restore') }}</el-button>
            <el-button v-if="row.status !== 'deleted'" link type="danger" @click="setStatus(row, 'deleted')">{{ t('content.remove') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
      <Pager :list="list" />
    </div>
  </div>
</template>

<script setup>
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, assetUrl } from '../../core/api';
import { t } from '../../core/i18n';
import { can } from '../../core/auth';
import { useList } from '../../core/list';
import { dateTime } from '../../core/format';
import Pager from '../../components/Pager.vue';
import UserCell from '../../components/UserCell.vue';

const route = useRoute();
const list = useList('content/posts', { q: '', status: route.query.status || '', kind: '', range: [] });
const tagType = s => ({ pending: 'warning', hidden: 'info', deleted: 'danger' })[s] || 'success';

async function setStatus(row, status) {
  let reason = '';
  if (status === 'hidden' || status === 'deleted') {
    const res = await ElMessageBox.prompt(t('content.reason'), status === 'deleted' ? t('content.remove') : t('content.hide'), {
      type: 'warning', inputValue: '', confirmButtonText: t('common.confirm'), cancelButtonText: t('common.cancel'),
    });
    reason = res.value || '';
  }
  await api.post(`content/posts/${encodeURIComponent(row.id)}/status`, { status, reason });
  ElMessage.success(t('common.done'));
  list.load();
}
</script>

<style scoped>
.post-cell { display: flex; gap: 10px; align-items: flex-start; }
.post-text { white-space: pre-wrap; word-break: break-word; max-height: 4.8em; overflow: hidden; }
</style>
