<template>
  <div class="page">
    <el-result :icon="notFound ? 'info' : 'warning'" :title="notFound ? t('forbidden.notFound') : t('forbidden.title')" :sub-title="notFound ? '' : t('forbidden.body')">
      <template #extra><el-button type="primary" @click="$router.push('/')">{{ t('forbidden.home') }}</el-button></template>
    </el-result>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { t } from '../core/i18n';
const route = useRoute();
const notFound = computed(() => !!route.meta.notFound);
</script>
