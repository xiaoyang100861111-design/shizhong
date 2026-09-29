<template>
  <div class="page" v-loading="!info">
    <div class="page-head"><h1>{{ t('sys.info') }}</h1></div>
    <div v-if="info" class="panel">
      <dl class="kv">
        <dt>{{ t('sys.build') }}</dt><dd class="num">{{ info.build }}</dd>
        <dt>{{ t('sys.db') }}</dt><dd>{{ info.database.name }} · SQL Server {{ info.database.version }} · {{ info.database.collation }}</dd>
        <dt>{{ t('sys.online') }}</dt><dd class="num">{{ info.online }}</dd>
        <dt>{{ t('sys.serverTime') }}</dt><dd class="num">{{ dateTime(info.serverTime, true) }}</dd>
        <dt>{{ t('sys.modules') }}</dt><dd><div class="tag-list"><el-tag v-for="m in info.modules" :key="m" size="small" type="info">{{ m }}</el-tag></div></dd>
        <dt>{{ t('sys.migrations') }}</dt><dd><div v-for="m in info.migrations" :key="m" class="num">{{ m }}</div></dd>
      </dl>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { dateTime } from '../../core/format';

const info = ref(null);
api.get('system/info').then(r => (info.value = r));
</script>
