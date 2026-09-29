<template>
  <el-select :model-value="modelValue" filterable clearable :placeholder="placeholder || t('agentSel.placeholder')" :loading="loading"
    @update:model-value="$emit('update:modelValue', $event)" @visible-change="v => v && !loaded && load()">
    <el-option v-if="allowNone" :value="0" :label="t('agentSel.none')" />
    <el-option v-for="a in agents" :key="a.id" :value="a.id" :label="label(a)">
      <span :style="{ paddingLeft: (a.level - 1) * 14 + 'px' }">{{ a.name }}</span>
      <small class="muted" style="margin-left: 8px">{{ a.code }}</small>
    </el-option>
  </el-select>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../core/api';
import { t, addMessages } from '../core/i18n';
import { can } from '../core/auth';

addMessages({ zh: { agentSel: { placeholder: '选择代理', none: '无（直属平台）' } }, en: { agentSel: { placeholder: 'Agent', none: 'None (platform)' } } });
const props = defineProps({ modelValue: [Number, String], placeholder: String, allowNone: Boolean });
defineEmits(['update:modelValue']);
const agents = ref([]);
const loading = ref(false);
const loaded = ref(false);
const label = a => `${a.name} (${a.code})`;
async function load() {
  if (!can('agents.view')) return;
  loading.value = true;
  try {
    agents.value = await api.get('agents', undefined, { quiet: true });
    loaded.value = true;
  } finally {
    loading.value = false;
  }
}
onMounted(() => props.modelValue && load());
</script>
