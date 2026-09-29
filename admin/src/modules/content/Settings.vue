<template>
  <div class="page">
    <div class="page-head"><h1>{{ t('content.settings') }}</h1></div>
    <ConfigForm :groups="['content', 'social', 'persona']" />
  </div>
</template>

<script setup>
import { t } from '../../core/i18n';
import ConfigForm from '../../components/ConfigForm.vue';
</script>
