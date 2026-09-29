<template>
  <el-dialog :model-value="modelValue" :title="merchant ? t('mc.edit') : t('mc.add')" width="600px" @update:model-value="$emit('update:modelValue', $event)" @open="init">
    <el-form label-width="120px">
      <el-form-item :label="t('mc.name')" required><div class="two"><el-input v-model="form.name" maxlength="80" placeholder="中文" /><el-input v-model="form.nameEn" maxlength="120" placeholder="English" /></div></el-form-item>
      <el-form-item :label="t('cm.category')">
        <el-select v-model="form.category" clearable filterable><el-option v-for="c in meta.categories.filter(c => c.id !== 'all')" :key="c.id" :value="c.id" :label="catName(c.id)" /></el-select>
      </el-form-item>
      <el-form-item :label="t('common.city')"><div class="two"><el-input v-model="form.city" maxlength="60" /><el-input v-model="form.area" maxlength="60" :placeholder="t('mc.area')" /></div></el-form-item>
      <el-form-item :label="t('mc.contact')"><div class="two"><el-input v-model="form.contact" maxlength="60" /><el-input v-model="form.phone" maxlength="32" :placeholder="t('common.phone')" /></div></el-form-item>
      <el-form-item :label="t('mc.logo')"><ImageUpload v-model="form.logo" :width="80" :height="80" purpose="merchant" /></el-form-item>
      <el-form-item :label="t('mc.about')"><el-input v-model="form.about" type="textarea" :rows="3" maxlength="1000" /></el-form-item>
      <el-form-item :label="t('mc.about') + ' (EN)'"><el-input v-model="form.aboutEn" type="textarea" :rows="2" maxlength="1500" /></el-form-item>
      <el-form-item :label="t('mc.license')"><ImageUpload v-model="form.license" :width="120" :height="80" purpose="merchant" /></el-form-item>
      <el-form-item v-if="platform" :label="t('mc.agent')"><AgentSelect v-model="form.agentId" /></el-form-item>
      <el-form-item v-if="platform" :label="t('mc.rate')">
        <el-input-number v-model="form.commissionRate" :min="0" :max="1" :step="0.01" :precision="4" controls-position="right" />
        <small class="muted" style="margin-left: 8px">{{ t('mc.rateHint', { rate: percent(meta.defaultCommission ?? 0.1) }) }}</small>
      </el-form-item>
      <el-form-item :label="t('mc.autoConfirm')">
        <el-select v-model="form.autoConfirm" clearable :placeholder="t('mc.autoFollow')">
          <el-option :value="1" :label="t('mc.autoOn')" /><el-option :value="0" :label="t('mc.autoOff')" />
        </el-select>
      </el-form-item>
      <el-form-item v-if="merchant" :label="t('common.status')">
        <el-radio-group v-model="form.status"><el-radio :value="0">{{ t('common.enabled') }}</el-radio><el-radio :value="1">{{ t('common.disabled') }}</el-radio></el-radio-group>
      </el-form-item>
      <el-form-item :label="t('common.remark')"><el-input v-model="form.note" type="textarea" :rows="2" maxlength="400" /></el-form-item>
      <template v-if="!merchant">
        <el-divider>{{ t('mc.loginOptional') }}</el-divider>
        <el-form-item :label="t('mc.username')"><el-input v-model="form.username" maxlength="40" autocomplete="off" /></el-form-item>
        <el-form-item :label="t('mc.password')"><el-input v-model="form.password" type="password" show-password autocomplete="new-password" /></el-form-item>
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
import { scope } from '../../core/auth';
import { percent } from '../../core/format';
import ImageUpload from '../../components/ImageUpload.vue';
import AgentSelect from '../../components/AgentSelect.vue';
import { meta, loadMeta, catName } from '../orders/common';

const props = defineProps({ modelValue: Boolean, merchant: Object });
const emit = defineEmits(['update:modelValue', 'saved']);
const busy = ref(false);
const platform = computed(() => scope.isAll || !scope.isAgent);
const blank = () => ({ name: '', nameEn: '', category: '', city: '', area: '', contact: '', phone: '', logo: '', about: '', aboutEn: '', license: '', agentId: null, commissionRate: null, autoConfirm: null, status: 0, note: '', username: '', password: '' });
const form = reactive(blank());
function init() {
  loadMeta();
  Object.assign(form, blank(), props.merchant ? { ...props.merchant, username: '', password: '' } : {});
}
async function save() {
  busy.value = true;
  try {
    if (props.merchant) await api.put('merchants/' + props.merchant.id, form);
    else await api.post('merchants', form);
    ElMessage.success(t('common.saved'));
    emit('update:modelValue', false);
    emit('saved');
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; }
</style>
