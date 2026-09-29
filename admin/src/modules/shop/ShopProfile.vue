<template>
  <div class="page" v-loading="loading">
    <el-alert v-if="!session.me?.merchantId" type="warning" :closable="false" :title="t('cm.noMerchant')" show-icon />
    <template v-else>
      <div class="page-head">
        <h1>{{ t('shop.profile') }}</h1>
        <div class="spacer" />
        <el-button type="primary" :loading="busy" :disabled="!form.name" @click="save">{{ t('common.save') }}</el-button>
      </div>
      <div class="panel">
        <el-form label-width="120px" style="max-width: 720px">
          <el-form-item :label="t('mc.name')" required><div class="two"><el-input v-model="form.name" maxlength="80" /><el-input v-model="form.nameEn" maxlength="120" placeholder="English" /></div></el-form-item>
          <el-form-item :label="t('mc.logo')"><ImageUpload v-model="form.logo" :width="80" :height="80" purpose="merchant" /></el-form-item>
          <el-form-item :label="t('mc.area')"><el-input v-model="form.area" maxlength="60" /></el-form-item>
          <el-form-item :label="t('mc.contact')"><div class="two"><el-input v-model="form.contact" maxlength="60" /><el-input v-model="form.phone" maxlength="32" :placeholder="t('common.phone')" /></div></el-form-item>
          <el-form-item :label="t('mc.about')"><el-input v-model="form.about" type="textarea" :rows="4" maxlength="1000" show-word-limit /></el-form-item>
          <el-form-item :label="t('mc.about') + ' (EN)'"><el-input v-model="form.aboutEn" type="textarea" :rows="3" maxlength="1500" /></el-form-item>
          <el-form-item :label="t('mc.autoConfirm')">
            <el-select v-model="form.autoConfirm" clearable :placeholder="t('mc.autoFollow')">
              <el-option :value="1" :label="t('mc.autoOn')" /><el-option :value="0" :label="t('mc.autoOff')" />
            </el-select>
            <small class="muted" style="margin-left: 8px">{{ t('shop.autoHint') }}</small>
          </el-form-item>
          <el-form-item :label="t('mc.rate')"><span>{{ percent(form.effectiveRate) }}</span><small class="muted" style="margin-left: 8px">{{ t('shop.rateHint') }}</small></el-form-item>
          <el-form-item :label="t('common.city')"><span>{{ form.city || '—' }}</span></el-form-item>
        </el-form>
      </div>
    </template>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { session } from '../../core/auth';
import { percent } from '../../core/format';
import ImageUpload from '../../components/ImageUpload.vue';

const loading = ref(false);
const busy = ref(false);
const form = reactive({ name: '', nameEn: '', logo: '', area: '', contact: '', phone: '', about: '', aboutEn: '', autoConfirm: null, effectiveRate: 0, city: '' });
async function load() {
  if (!session.me?.merchantId) return;
  loading.value = true;
  try {
    Object.assign(form, await api.get('shop/profile'));
  } finally {
    loading.value = false;
  }
}
async function save() {
  busy.value = true;
  try {
    await api.put('shop/profile', form);
    ElMessage.success(t('common.saved'));
  } finally {
    busy.value = false;
  }
}
load();
</script>

<style scoped>
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; }
</style>
