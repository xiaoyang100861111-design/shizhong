<template>
  <el-dialog :model-value="modelValue" :title="agent ? t('agents.edit') : t('agents.add')" width="520px" @update:model-value="$emit('update:modelValue', $event)" @open="init">
    <el-form ref="formRef" :model="form" label-width="110px">
      <el-form-item :label="t('agents.name')" required><el-input v-model="form.name" maxlength="60" /></el-form-item>
      <el-form-item v-if="!agent" :label="t('agents.code')">
        <el-input v-model="form.code" maxlength="20" :placeholder="t('agents.codeHint')" />
      </el-form-item>
      <el-form-item v-if="!agent" :label="t('agents.parent')">
        <el-select v-model="form.parentId" clearable filterable :placeholder="t('agents.root')" style="width: 100%">
          <el-option v-for="a in agents.filter(x => !x.status)" :key="a.id" :value="a.id" :label="`${a.name} (${a.code})`" />
        </el-select>
      </el-form-item>
      <el-form-item :label="t('agents.contact')"><el-input v-model="form.contact" maxlength="60" /></el-form-item>
      <el-form-item :label="t('common.phone')"><el-input v-model="form.phone" maxlength="32" /></el-form-item>
      <el-form-item :label="t('agents.city')"><el-input v-model="form.city" maxlength="60" /></el-form-item>
      <el-form-item v-if="!isSelf" :label="t('agents.rate')">
        <el-input-number v-model="form.commissionRate" :min="0" :max="1" :step="0.01" :precision="4" controls-position="right" />
        <small class="muted" style="margin-left: 8px">{{ t('agents.rateHint') }}</small>
      </el-form-item>
      <el-form-item v-if="!isSelf" label=" ">
        <el-checkbox v-model="form.canCreateMerchant">{{ t('agents.canMerchant') }}</el-checkbox>
        <el-checkbox v-model="form.canCreateAgent">{{ t('agents.canAgent') }}</el-checkbox>
      </el-form-item>
      <el-form-item v-if="agent && !isSelf" :label="t('common.status')">
        <el-radio-group v-model="form.status"><el-radio :value="0">{{ t('common.enabled') }}</el-radio><el-radio :value="1">{{ t('common.disabled') }}</el-radio></el-radio-group>
      </el-form-item>
      <el-form-item :label="t('common.remark')"><el-input v-model="form.note" type="textarea" :rows="2" maxlength="400" /></el-form-item>
      <template v-if="!agent">
        <el-divider>{{ t('agents.login') }}</el-divider>
        <el-form-item :label="t('agents.username')"><el-input v-model="form.username" maxlength="40" autocomplete="off" /></el-form-item>
        <el-form-item :label="t('agents.password')"><el-input v-model="form.password" type="password" show-password autocomplete="new-password" /></el-form-item>
      </template>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="busy" :disabled="!form.name" @click="save">{{ t('common.save') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { session } from '../../core/auth';

const props = defineProps({ modelValue: Boolean, agent: Object, agents: { type: Array, default: () => [] } });
const emit = defineEmits(['update:modelValue', 'saved']);
const formRef = ref();
const busy = ref(false);
const blank = () => ({ name: '', code: '', parentId: null, contact: '', phone: '', city: '', commissionRate: null, canCreateMerchant: true, canCreateAgent: false, status: 0, note: '', username: '', password: '' });
const form = reactive(blank());
const isSelf = computed(() => props.agent && props.agent.id === session.me?.agentId);
function init() {
  Object.assign(form, blank(), props.agent ? { ...props.agent, username: '', password: '' } : { parentId: session.me?.agentId || null });
}
async function save() {
  busy.value = true;
  try {
    const body = { ...form };
    if (props.agent) await api.put('agents/' + props.agent.id, body);
    else {
      const res = await api.post('agents', body);
      ElMessage.success(`${t('agents.code')}: ${res.code}`);
    }
    emit('update:modelValue', false);
    emit('saved');
  } finally {
    busy.value = false;
  }
}
</script>
