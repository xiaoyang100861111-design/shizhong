<template>
  <div class="page">
    <div class="page-head"><h1>{{ pick($route.meta.title, 'zh') }}</h1></div>
    <p class="page-sub">{{ t('fin.settingsSub') }}</p>
    <ConfigForm :groups="['recharge', 'withdraw']" endpoint="finance/config" perm="finance.settings" />
  </div>
</template>

<script setup>
import { t, pick } from '../../core/i18n';
import ConfigForm from '../../components/ConfigForm.vue';
</script>
