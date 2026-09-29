<template>
  <div v-loading="loading">
    <div class="grid-cards">
      <StatCard :label="t('vip.level')" :value="'V' + (data.level || 1)" />
      <StatCard :label="t('vip.xp')" :value="data.xp" />
      <StatCard :label="t('vip.next')" :value="data.next ?? '—'" />
      <StatCard :label="t('vip.bonus')" :value="data.bonusXp" />
    </div>
    <dl class="kv">
      <dt>{{ t('vip.themeId') }}</dt><dd>{{ t('vip.theme.' + (data.theme || 'gold')) }} · {{ data.entranceEnabled ? t('common.enabled') : t('common.disabled') }}</dd>
      <dt>{{ t('vip.sources') }}</dt><dd>{{ (data.sources || []).map(s => t('vip.src.' + s)).join('、') }}</dd>
      <dt>{{ t('vip.bySource') }}</dt>
      <dd><span v-for="(v, k) in data.bySource || {}" :key="k" class="src">{{ t('vip.src.' + k) }} <b class="num">{{ number(v) }}</b></span></dd>
    </dl>
    <div v-can="'vip.edit'" class="edit">
      <span>{{ t('vip.editBonus') }}</span>
      <el-input-number v-model="bonus" :min="0" :step="100" />
      <el-button type="primary" @click="saveBonus">{{ t('common.save') }}</el-button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { number } from '../../core/format';
import StatCard from '../../components/StatCard.vue';

const props = defineProps({ userId: [Number, String] });
const data = ref({});
const bonus = ref(0);
const loading = ref(false);
async function load() {
  loading.value = true;
  try {
    data.value = await api.get(`users/${props.userId}/vip`);
    bonus.value = data.value.bonusXp || 0;
  } finally {
    loading.value = false;
  }
}
load();
async function saveBonus() {
  await api.put(`users/${props.userId}/vip`, { bonusXp: bonus.value });
  ElMessage.success(t('common.saved'));
  load();
}
</script>

<style scoped>
.src { margin-right: 12px; }
.edit { display: flex; gap: 8px; align-items: center; margin-top: 16px; }
</style>
