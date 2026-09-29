<template>
  <div class="page">
    <div class="page-head"><h1>{{ t('agents.rulesTitle') }}</h1></div>
    <p class="page-sub">{{ t('agents.rulesSub') }}</p>
    <ConfigForm :groups="['agent']" />
  </div>
</template>

<script setup>
import { t } from '../../core/i18n';
import ConfigForm from '../../components/ConfigForm.vue';
</script>
