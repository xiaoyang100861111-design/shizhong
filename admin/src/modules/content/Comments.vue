<template>
  <div class="page">
    <div class="page-head"><h1>{{ t('content.comments') }}</h1></div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('content.q')" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-input v-model="list.filters.post" :placeholder="t('content.post') + ' ID'" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-select v-model="list.filters.status" clearable :placeholder="t('common.status')" @change="list.search">
          <el-option v-for="s in ['pending', 'visible', 'hidden', 'deleted']" :key="s" :value="s" :label="t('content.status.' + s)" />
        </el-select>
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
        <el-button @click="list.reset">{{ t('common.reset') }}</el-button>
      </div>
      <el-table v-loading="list.loading.value" :data="list.items.value" stripe>
        <el-table-column :label="t('content.author')" min-width="170">
          <template #default="{ row }"><UserCell :id="row.user.persona ? null : row.user.id" :name="row.user.name" :avatar="row.user.avatar" :display-id="row.user.displayId" /></template>
        </el-table-column>
        <el-table-column :label="t('content.text')" min-width="260"><template #default="{ row }"><div style="white-space: pre-wrap">{{ row.text }}</div></template></el-table-column>
        <el-table-column :label="t('content.post')" min-width="200">
          <template #default="{ row }"><small class="muted">{{ row.post.id }}</small><div class="muted">{{ row.post.text }}</div></template>
        </el-table-column>
        <el-table-column :label="t('common.status')" width="100">
          <template #default="{ row }"><el-tag size="small" :type="{ pending: 'warning', hidden: 'info', deleted: 'danger' }[row.status] || 'success'">{{ t('content.status.' + row.status) }}</el-tag></template>
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
import { ElMessage } from 'element-plus';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { can } from '../../core/auth';
import { useList } from '../../core/list';
import { dateTime } from '../../core/format';
import Pager from '../../components/Pager.vue';
import UserCell from '../../components/UserCell.vue';

const route = useRoute();
const list = useList('content/comments', { q: '', post: route.query.post || '', status: route.query.status || '' });
async function setStatus(row, status) {
  await api.post(`content/comments/${row.id}/status`, { status });
  ElMessage.success(t('common.done'));
  list.load();
}
</script>
