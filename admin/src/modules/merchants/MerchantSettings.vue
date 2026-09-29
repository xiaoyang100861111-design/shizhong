<template>
  <div class="page">
    <div class="page-head"><h1>{{ t('mc.settings') }}</h1></div>
    <p class="page-sub">{{ t('mc.settingsSub') }}</p>
    <ConfigForm :groups="['merchant']" />
  </div>
</template>

<script setup>
import { t } from '../../core/i18n';
import ConfigForm from '../../components/ConfigForm.vue';
</script>
