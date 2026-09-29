<template>
  <el-dialog :model-value="modelValue" :title="editing ? t('risk.lists.editTitle') : t('risk.lists.addTitle')" width="480px" @update:model-value="$emit('update:modelValue', $event)">
    <el-form label-width="96px">
      <el-form-item :label="t('common.type')">
        <el-select v-model="form.kind" :disabled="editing || lockKind" style="width: 100%">
          <el-option v-for="k in LIST_KINDS" :key="k" :value="k" :label="t('risk.kind.' + k)" />
        </el-select>
      </el-form-item>
      <el-form-item :label="t('risk.lists.value')" required>
        <el-input v-model="form.value" :disabled="editing" :placeholder="t('risk.lists.placeholder.' + form.kind)" maxlength="254" />
      </el-form-item>
      <el-form-item :label="t('risk.lists.type')">
        <el-radio-group v-model="form.listType" :disabled="editing">
          <el-radio-button value="block">{{ t('risk.listType.block') }}</el-radio-button>
          <el-radio-button value="allow" :disabled="form.kind === 'nameKeyword'">{{ t('risk.listType.allow') }}</el-radio-button>
        </el-radio-group>
        <small v-if="form.listType === 'allow'" class="muted hint">{{ t('risk.lists.allowHint') }}</small>
      </el-form-item>
      <el-form-item :label="t('risk.lists.validity')">
        <div class="validity">
          <el-radio-group v-model="form.mode">
            <el-radio v-if="editing" value="keep">{{ t('risk.lists.keep', { time: entry?.expiresAt ? dateTime(entry.expiresAt) : t('risk.lists.permanent') }) }}</el-radio>
            <el-radio value="permanent">{{ t('risk.lists.permanent') }}</el-radio>
            <el-radio value="hours">
              <el-input-number v-model="form.hours" :min="1" :max="87600" size="small" controls-position="right" @focus="form.mode = 'hours'" />
              <span class="unit">{{ t('risk.lists.hours') }}</span>
            </el-radio>
          </el-radio-group>
          <div v-if="form.mode === 'hours'" class="presets">
            <el-button v-for="h in [1, 24, 168, 720]" :key="h" size="small" :type="form.hours === h ? 'primary' : ''" plain @click="form.hours = h">{{ t('risk.lists.presets.h' + h) }}</el-button>
          </div>
        </div>
      </el-form-item>
      <el-form-item :label="t('risk.lists.note')">
        <el-input v-model="form.note" type="textarea" :rows="2" maxlength="200" show-word-limit />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="busy" :disabled="!form.value.trim()" @click="save">{{ t('common.save') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
// Add a block / allow entry (optionally pre-filled: "封禁此 IP" from the overview or an event), or edit note and validity.
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { dateTime } from '../../core/format';
import { LIST_KINDS } from './common';

const props = defineProps({
  modelValue: Boolean,
  entry: { type: Object, default: null }, // existing row → edit
  preset: { type: Object, default: null }, // { kind, value, listType, note, hours }
  lockKind: Boolean,
});
const emit = defineEmits(['update:modelValue', 'saved']);
const editing = computed(() => !!props.entry?.id);
const busy = ref(false);
const form = reactive({ kind: 'ip', value: '', listType: 'block', note: '', mode: 'permanent', hours: 24 });

watch(() => props.modelValue, open => {
  if (!open) return;
  const src = props.entry || props.preset || {};
  Object.assign(form, {
    kind: src.kind || 'ip', value: src.value || '', listType: src.listType || 'block', note: src.note || '',
    mode: editing.value ? 'keep' : src.hours ? 'hours' : 'permanent', hours: src.hours || 24,
  });
});
watch(() => form.kind, k => { if (k === 'nameKeyword') form.listType = 'block'; });

async function save() {
  busy.value = true;
  try {
    const hours = form.mode === 'hours' ? form.hours : form.mode === 'permanent' ? 0 : null;
    if (editing.value) await api.put('risk/lists/' + props.entry.id, { note: form.note, hours });
    else await api.post('risk/lists', { kind: form.kind, value: form.value.trim(), listType: form.listType, note: form.note, hours: hours || null });
    ElMessage.success(t('common.saved'));
    emit('update:modelValue', false);
    emit('saved');
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.validity { display: flex; flex-direction: column; gap: 8px; }
.validity .el-radio-group { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.unit { margin-left: 6px; }
.presets { display: flex; gap: 6px; flex-wrap: wrap; }
.presets .el-button { margin: 0; }
.hint { display: block; line-height: 1.4; margin-top: 4px; width: 100%; }
</style>
