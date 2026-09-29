<template>
  <div class="page">
    <div class="page-head"><h1>{{ pick($route.meta.title, 'zh') }}</h1></div>
    <p class="page-sub">{{ t('growth.memberNote') }}</p>
    <div class="grid-cards">
      <StatCard :label="t('growth.members')" :value="count" />
    </div>
    <ConfigForm :groups="['member']" endpoint="growth/config" perm="marketing.member" />
    <ClaimsTable task="member" />
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { api } from '../../core/api';
import { t, pick } from '../../core/i18n';
import StatCard from '../../components/StatCard.vue';
import ConfigForm from '../../components/ConfigForm.vue';
import ClaimsTable from './ClaimsTable.vue';

const stats = ref({});
api.get('growth/stats', { days: 30 }).then(r => (stats.value = r));
const count = computed(() => stats.value.tasks?.find(x => x.task === 'member')?.count ?? 0);
</script>
