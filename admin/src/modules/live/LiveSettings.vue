<template>
  <div class="page">
    <div class="page-head"><h1>{{ t('live.settings') }}</h1></div>
    <div class="panel">
      <h3 class="panel-title">{{ t('live.liveGroup') }}</h3>
      <AreaSettings perm="live.manage" :keys="['live.enabled', 'live.demoRooms', 'live.topics', 'live.titleMax', 'live.commentMax', 'live.comboMs', 'live.hostShare', 'live.maxMinutes', 'live.heartbeatSeconds', 'live.fanLevels', 'live.notifyFollowers']" />
    </div>
    <div class="panel">
      <h3 class="panel-title">{{ t('live.privateGroup') }}</h3>
      <AreaSettings perm="live.manage" :keys="['private.enabled', 'private.personaDemo', 'private.requireApproval', 'private.hostShare', 'private.minRate', 'private.maxRate', 'private.defaultRate', 'private.lowSeconds', 'private.maxMinutes', 'private.ringSeconds', 'private.minuteSeconds']" />
    </div>
    <div class="panel">
      <h3 class="panel-title">{{ t('live.hostGroup') }}</h3>
      <AreaSettings perm="live.manage" :keys="['host.holdDays']" />
    </div>
  </div>
</template>

<script setup>
import { t } from '../../core/i18n';
import AreaSettings from '../gifts/AreaSettings.vue';
</script>
