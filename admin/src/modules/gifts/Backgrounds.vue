<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('gifts.bg.title') }}</h1>
      <div class="spacer" />
      <el-button v-can="'gifts.edit'" type="primary" :icon="IconPlus" @click="openEdit()">{{ t('gifts.bg.add') }}</el-button>
    </div>
    <div class="panel">
      <div class="bg-grid">
        <div v-for="b in items" :key="b.id" class="bg-card" :class="{ off: !b.enabled }">
          <div class="bg-swatch" :style="swatch(b)"><span :style="{ color: b.ink || (b.tone === 'dark' ? '#fff' : '#333') }">{{ b.name }}</span></div>
          <div class="bg-meta">
            <b>{{ b.name }}</b> <small class="muted">{{ b.nameEn }}</small>
            <div class="muted num">{{ b.id }} · {{ b.kind === 'photo' ? t('gifts.bg.photo') : t('gifts.bg.gradient') }} · {{ b.tone === 'dark' ? t('gifts.bg.dark') : t('gifts.bg.light') }}</div>
            <div class="muted">{{ b.description }}</div>
            <div class="bg-actions">
              <el-tag v-if="!b.enabled" size="small" type="info">{{ t('common.disabled') }}</el-tag>
              <el-button v-can="'gifts.edit'" link type="primary" @click="openEdit(b)">{{ t('common.edit') }}</el-button>
              <el-button v-if="b.enabled" v-can="'gifts.edit'" link type="danger" @click="disable(b)">{{ t('common.disabled') }}</el-button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <el-dialog v-model="open" :title="form.isNew ? t('gifts.bg.add') : t('common.edit')" width="600px">
      <el-form label-position="top">
        <el-form-item :label="t('gifts.id')" required><el-input v-model="form.id" :disabled="!form.isNew" :placeholder="t('gifts.idHint')" /></el-form-item>
        <el-form-item :label="t('gifts.name')" required><el-input v-model="form.name" maxlength="40" /></el-form-item>
        <el-form-item :label="t('gifts.nameEn')"><el-input v-model="form.nameEn" maxlength="60" /></el-form-item>
        <el-form-item :label="t('gifts.desc')"><el-input v-model="form.description" maxlength="200" /></el-form-item>
        <el-form-item :label="t('gifts.descEn')"><el-input v-model="form.descriptionEn" maxlength="300" /></el-form-item>
        <el-form-item :label="t('gifts.bg.kind')">
          <el-radio-group v-model="form.kind"><el-radio-button value="gradient">{{ t('gifts.bg.gradient') }}</el-radio-button><el-radio-button value="photo">{{ t('gifts.bg.photo') }}</el-radio-button></el-radio-group>
        </el-form-item>
        <el-form-item :label="t('gifts.bg.tone')">
          <el-radio-group v-model="form.tone"><el-radio-button value="light">{{ t('gifts.bg.light') }}</el-radio-button><el-radio-button value="dark">{{ t('gifts.bg.dark') }}</el-radio-button></el-radio-group>
        </el-form-item>
        <el-form-item :label="t('gifts.bg.ink')"><el-color-picker v-model="form.ink" /></el-form-item>
        <el-form-item v-if="form.kind === 'gradient'" :label="t('gifts.bg.css')" required><el-input v-model="form.css" type="textarea" :rows="3" class="mono" placeholder="linear-gradient(145deg, #FFF5F5 0%, #FCE7EC 100%)" /></el-form-item>
        <el-form-item v-else :label="t('gifts.bg.image')" required><ImageUpload v-model="form.image" purpose="gift" :width="200" :height="100" allow-path path-hint="city-kl.webp" /></el-form-item>
        <div class="bg-swatch big" :style="swatch(form)" />
        <el-form-item :label="t('gifts.order')"><el-input-number v-model="form.sortOrder" :min="0" /></el-form-item>
        <el-form-item :label="t('common.status')"><el-switch v-model="form.enabled" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="open = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="busy" @click="save">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus as IconPlus } from '@element-plus/icons-vue';
import { api, assetUrl } from '../../core/api';
import { t } from '../../core/i18n';
import ImageUpload from '../../components/ImageUpload.vue';

const items = ref([]);
async function load() {
  items.value = (await api.get('gift-backgrounds')).items;
}
load();
const swatch = b => (b.kind === 'photo' ? { backgroundImage: `url("${assetUrl(b.image)}")`, backgroundSize: 'cover' } : { background: b.css });
const blank = () => ({ isNew: true, id: '', name: '', nameEn: '', description: '', descriptionEn: '', kind: 'gradient', tone: 'light', ink: '', css: '', image: '', enabled: true, sortOrder: 100 });
const form = reactive(blank());
const open = ref(false);
const busy = ref(false);
function openEdit(b) {
  Object.assign(form, blank(), b ? { ...b, isNew: false } : {});
  open.value = true;
}
async function save() {
  busy.value = true;
  const body = { ...form };
  delete body.isNew;
  try {
    if (form.isNew) await api.post('gift-backgrounds', body);
    else await api.put('gift-backgrounds/' + encodeURIComponent(form.id), body);
    ElMessage.success(t('common.saved'));
    open.value = false;
    load();
  } finally {
    busy.value = false;
  }
}
async function disable(b) {
  await ElMessageBox.confirm(t('gifts.bg.disableConfirm'), { type: 'warning' });
  await api.del('gift-backgrounds/' + encodeURIComponent(b.id));
  load();
}
</script>

<style scoped>
.bg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.bg-card { border: 1px solid var(--el-border-color-lighter); border-radius: 10px; overflow: hidden; }
.bg-card.off { opacity: 0.55; }
.bg-swatch { height: 90px; display: flex; align-items: center; justify-content: center; font-weight: 600; }
.bg-swatch.big { height: 120px; border-radius: 8px; margin-bottom: 12px; }
.bg-meta { padding: 10px 12px; font-size: 13px; }
.bg-actions { display: flex; gap: 8px; align-items: center; margin-top: 6px; }
.mono :deep(textarea) { font-family: var(--font-mono); font-size: 12px; }
</style>
