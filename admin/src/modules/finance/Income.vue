<template>
  <div class="page">
    <div class="page-head"><h1>{{ pick($route.meta.title, 'zh') }}</h1></div>
    <div class="grid-cards">
      <StatCard :label="t('fin.incomeHeld')" :value="list.meta.value.sumIncome ?? 0" unit="RM" />
      <StatCard :label="t('fin.incomePending')" :value="list.meta.value.sumPending ?? 0" unit="RM" />
      <StatCard :label="t('common.user')" :value="list.total.value" />
    </div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('fin.q')" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
        <router-link to="/finance/withdrawals?source=income"><el-button link type="primary">{{ pick({ zh: '收益提现审核', en: 'Earnings withdrawals' }) }}</el-button></router-link>
      </div>
      <el-table v-loading="list.loading.value" :data="list.items.value" size="small" stripe>
        <el-table-column :label="t('common.user')" min-width="180"><template #default="{ row }"><UserCell :id="row.user.id" :name="row.user.name" :avatar="row.user.avatar" :display-id="row.user.displayId" :size="28" /></template></el-table-column>
        <el-table-column :label="t('fin.incomeHeld')" align="right"><template #default="{ row }"><b class="num">{{ money(row.income) }}</b></template></el-table-column>
        <el-table-column :label="t('fin.incomePending')" align="right"><template #default="{ row }"><span class="num">{{ money(row.pending) }}</span></template></el-table-column>
        <el-table-column :label="t('fin.earned')" align="right"><template #default="{ row }"><span class="num">{{ money(row.earned) }}</span></template></el-table-column>
        <el-table-column :label="t('fin.inReview')" align="right"><template #default="{ row }"><span class="num">{{ money(row.inReview) }}</span></template></el-table-column>
        <el-table-column :label="t('fin.withdrawn')" align="right"><template #default="{ row }"><span class="num">{{ money(row.withdrawn) }}</span></template></el-table-column>
      </el-table>
      <Pager :list="list" />
    </div>
  </div>
</template>

<script setup>
import { t, pick } from '../../core/i18n';
import { money } from '../../core/format';
import UserCell from '../../components/UserCell.vue';
import StatCard from '../../components/StatCard.vue';
import Pager from '../../components/Pager.vue';
import { useFinList } from './finList';

const list = useFinList('finance/income', { q: '' });
</script>
