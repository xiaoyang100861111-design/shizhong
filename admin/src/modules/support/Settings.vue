<template>
  <div class="page">
    <div class="page-head"><h1>{{ t('desk.settings') }}</h1></div>
    <ConfigForm :groups="['chat', 'chatplus', 'money', 'call', 'support']" />
  </div>
</template>

<script setup>
import { t } from '../../core/i18n';
import ConfigForm from '../../components/ConfigForm.vue';
</script>
