<template>
  <el-select :model-value="modelValue" filterable remote clearable :remote-method="search" :loading="loading" :placeholder="placeholder || t('cm.merchant')"
    class="merchant-select" @update:model-value="$emit('update:modelValue', $event ?? null)" @visible-change="v => v && !options.length && search('')">
    <el-option v-for="m in options" :key="m.id" :value="m.id" :label="`${m.name}${m.city ? ' · ' + m.city : ''}`" />
  </el-select>
</template>

<script setup>
// Remote merchant picker (scoped: agents only see their merchants).
import { ref, watch } from 'vue';
import { api } from '../../core/api';
import { t } from '../../core/i18n';

const props = defineProps({ modelValue: [Number, String], placeholder: String, label: String });
defineEmits(['update:modelValue']);
const options = ref([]);
const loading = ref(false);
async function search(q) {
  loading.value = true;
  try {
    options.value = await api.get('merchants/options', { q }, { quiet: true });
  } catch (_) {
    options.value = [];
  } finally {
    loading.value = false;
  }
}
// Show the current value's name even before the dropdown opens.
watch(
  () => props.modelValue,
  v => {
    if (v && !options.value.some(o => o.id === v)) {
      if (props.label) options.value = [{ id: v, name: props.label }, ...options.value];
      else search('');
    }
  },
  { immediate: true }
);
</script>

<style scoped>
.merchant-select { min-width: 180px; }
</style>
