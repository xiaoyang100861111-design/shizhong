<template>
  <el-dialog :model-value="modelValue" :title="t('pwd.title')" width="400px" @update:model-value="$emit('update:modelValue', $event)" @closed="reset">
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="save">
      <el-form-item :label="t('pwd.current')" prop="current"><el-input v-model="form.current" type="password" show-password /></el-form-item>
      <el-form-item :label="t('pwd.next')" prop="next"><el-input v-model="form.next" type="password" show-password /></el-form-item>
      <el-form-item :label="t('pwd.repeat')" prop="repeat"><el-input v-model="form.repeat" type="password" show-password /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="busy" @click="save">{{ t('common.save') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../core/api';
import { t } from '../core/i18n';

defineProps({ modelValue: Boolean });
const emit = defineEmits(['update:modelValue']);
const formRef = ref();
const busy = ref(false);
const form = reactive({ current: '', next: '', repeat: '' });
const rules = {
  current: [{ required: true, message: () => t('common.required') }],
  next: [{ required: true, min: 6, message: () => t('pwd.short') }],
  repeat: [{ validator: (_, v, cb) => (v === form.next ? cb() : cb(new Error(t('pwd.mismatch')))) }],
};
function reset() {
  Object.assign(form, { current: '', next: '', repeat: '' });
  formRef.value?.clearValidate();
}
async function save() {
  await formRef.value.validate();
  busy.value = true;
  try {
    await api.post('me/password', { current: form.current, next: form.next });
    ElMessage.success(t('pwd.saved'));
    emit('update:modelValue', false);
  } finally {
    busy.value = false;
  }
}
</script>
