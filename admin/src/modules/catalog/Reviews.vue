<template>
  <div class="page">
    <div class="page-head"><h1>{{ shop ? t('cat.shopReviews') : t('cat.reviews') }}</h1></div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('cat.reviewQ')" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-select v-model="list.filters.stars" clearable :placeholder="t('cat.stars')" @change="list.search">
          <el-option v-for="n in [5, 4, 3, 2, 1]" :key="n" :value="n" :label="'★'.repeat(n)" />
        </el-select>
        <el-select v-if="!shop" v-model="list.filters.hidden" clearable :placeholder="t('common.status')" @change="list.search">
          <el-option :value="false" :label="t('cat.visible')" /><el-option :value="true" :label="t('cat.hidden')" />
        </el-select>
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
      </div>
      <el-table v-loading="list.loading.value" :data="list.items.value" stripe>
        <el-table-column :label="t('common.user')" width="170">
          <template #default="{ row }"><UserCell :id="shop ? null : row.user.id" :name="row.user.name" :avatar="row.user.avatar" :display-id="row.user.displayId" :link="!shop" /></template>
        </el-table-column>
        <el-table-column :label="t('cat.service')" min-width="180">
          <template #default="{ row }">{{ row.serviceName }}<div class="muted small num">{{ row.serviceId }} · {{ row.orderNo }}</div></template>
        </el-table-column>
        <el-table-column :label="t('cat.review')" min-width="280">
          <template #default="{ row }">
            <el-rate :model-value="row.stars" disabled size="small" />
            <div class="tag-list"><el-tag v-for="tg in row.tags" :key="tg" size="small">{{ t('cm.reviewTag.' + tg) }}</el-tag></div>
            <div>{{ row.text }}</div>
            <div v-if="row.reply" class="muted">↳ {{ row.reply }}</div>
          </template>
        </el-table-column>
        <el-table-column :label="t('common.time')" width="140"><template #default="{ row }"><span class="num small">{{ dateTime(row.createdAt) }}</span></template></el-table-column>
        <el-table-column v-if="!shop" :label="t('common.status')" width="90">
          <template #default="{ row }"><el-tag size="small" :type="row.hidden ? 'info' : 'success'">{{ row.hidden ? t('cat.hidden') : t('cat.visible') }}</el-tag></template>
        </el-table-column>
        <el-table-column :label="t('common.actions')" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="reply(row)">{{ t('cat.reply') }}</el-button>
            <el-button v-if="!shop" link :type="row.hidden ? 'success' : 'danger'" @click="hide(row, !row.hidden)">{{ row.hidden ? t('cat.show') : t('cat.hide') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
      <Pager :list="list" />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useList } from '../../core/list';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { dateTime } from '../../core/format';
import Pager from '../../components/Pager.vue';
import UserCell from '../../components/UserCell.vue';

const props = defineProps({ shop: Boolean });
const base = computed(() => (props.shop ? 'shop/reviews' : 'catalog/reviews'));
const list = useList(() => base.value, { q: '', stars: null, hidden: null });
async function reply(row) {
  const { value } = await ElMessageBox.prompt(t('cat.replyHint'), t('cat.reply'), { inputValue: row.reply || '', inputType: 'textarea' });
  await api.patch(base.value + '/' + row.id, { reply: value || '' });
  ElMessage.success(t('common.saved'));
  list.load();
}
async function hide(row, hidden) {
  await api.patch(base.value + '/' + row.id, { hidden });
  list.load();
}
</script>

<style scoped>
.small { font-size: 12px; }
</style>
