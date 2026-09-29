<template>
  <div class="panel">
    <h3 class="panel-title">{{ t('growth.claims') }}</h3>
    <div class="filters">
      <el-input v-model="list.filters.q" :placeholder="t('fin.q')" clearable @keyup.enter="list.search" @clear="list.search" />
      <el-select v-if="!task" v-model="list.filters.task" clearable :placeholder="t('growth.task')" @change="list.search">
        <el-option v-for="k in ['profile', 'post', 'address']" :key="k" :value="k" :label="t('growth.tasks.' + k)" />
      </el-select>
      <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
    </div>
    <el-table v-loading="list.loading.value" :data="list.items.value" size="small" stripe>
      <el-table-column :label="t('common.time')" width="150"><template #default="{ row }"><span class="num">{{ dateTime(row.at) }}</span></template></el-table-column>
      <el-table-column :label="t('common.user')" min-width="170"><template #default="{ row }"><UserCell :id="row.user.id" :name="row.user.name" :avatar="row.user.avatar" :display-id="row.user.displayId" :size="28" /></template></el-table-column>
      <el-table-column :label="t('growth.task')" width="120"><template #default="{ row }">{{ t('growth.tasks.' + row.task) }}</template></el-table-column>
      <el-table-column v-if="task === 'invite'" :label="t('growth.invitee')" min-width="120" prop="invitee" />
      <el-table-column :label="t('growth.reward')" width="100" align="right"><template #default="{ row }"><span class="num">{{ number(row.reward) }}</span></template></el-table-column>
    </el-table>
    <Pager :list="list" />
  </div>
</template>

<script setup>
import { t } from '../../core/i18n';
import { useList } from '../../core/list';
import { dateTime, number } from '../../core/format';
import UserCell from '../../components/UserCell.vue';
import Pager from '../../components/Pager.vue';

const props = defineProps({ task: { type: String, default: '' } });
const list = useList('growth/claims', { q: '', task: props.task });
</script>
