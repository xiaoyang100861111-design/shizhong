<template>
  <div class="page">
    <div class="page-head"><h1>{{ t('cm.orderSettings') }}</h1></div>
    <p class="page-sub">{{ t('cm.orderSettingsSub') }}</p>
    <ConfigForm :groups="['checkout', 'orders', 'address']" />
  </div>
</template>

<script setup>
import { t } from '../../core/i18n';
import ConfigForm from '../../components/ConfigForm.vue';
</script>
