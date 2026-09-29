<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('mk.banners') }}</h1>
      <div class="spacer" />
      <el-button v-can="'marketing.banners'" type="primary" :icon="IconPlus" @click="edit()">{{ t('mk.newBanner') }}</el-button>
    </div>
    <p class="page-sub">{{ t('mk.bannersSub') }}</p>
    <div class="panel">
      <el-table v-loading="loading" :data="rows">
        <el-table-column :label="t('mk.image')" width="190"><template #default="{ row }"><img :src="assetUrl(row.image)" class="banner" alt="" /></template></el-table-column>
        <el-table-column :label="t('mk.copy')" min-width="240">
          <template #default="{ row }">
            <small class="muted">{{ row.kicker }}</small>
            <div><b>{{ row.title }}</b> <span class="muted">{{ row.titleEn }}</span></div>
            <div class="muted small">{{ row.sub }}</div>
          </template>
        </el-table-column>
        <el-table-column :label="t('mk.action')" width="200">
          <template #default="{ row }">{{ t('mk.actions.' + row.actionName) }}<span v-if="row.actionId" class="muted small"> · {{ row.actionId }}</span>
            <div v-if="row.actionName === 'campaign'" class="muted small">{{ row.campaignIds.length ? t('mk.pickedN', { n: row.campaignIds.length }) : row.campaignCats.length ? row.campaignCats.map(catName).join('、') : t('mk.defaultCats') }}</div>
          </template>
        </el-table-column>
        <el-table-column :label="t('mk.window')" width="200">
          <template #default="{ row }"><span class="num small">{{ row.startAt ? dateTime(row.startAt) : t('mk.now') }} – {{ row.endAt ? dateTime(row.endAt) : t('mk.forever') }}</span></template>
        </el-table-column>
        <el-table-column :label="t('cat.order')" prop="sortOrder" width="70" />
        <el-table-column :label="t('common.status')" width="100">
          <template #default="{ row }"><el-tag size="small" :type="row.live ? 'success' : 'info'">{{ row.live ? t('mk.live') : !row.enabled ? t('common.disabled') : row.endAt && row.endAt <= Date.now() ? t('mk.ended') : t('mk.scheduled') }}</el-tag></template>
        </el-table-column>
        <el-table-column :label="t('common.actions')" width="130" fixed="right">
          <template #default="{ row }">
            <el-button v-can="'marketing.banners'" link type="primary" @click="edit(row)">{{ t('common.edit') }}</el-button>
            <el-button v-can="'marketing.banners'" link type="danger" @click="remove(row)">{{ t('common.delete') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="open" :title="editing ? t('mk.editBanner') : t('mk.newBanner')" width="640px">
      <el-form label-width="110px">
        <el-form-item :label="t('mk.image')" required><ImageUpload v-model="form.image" :width="280" :height="150" purpose="banner" allow-path path-hint="hero.webp" /></el-form-item>
        <el-form-item :label="t('mk.kicker')"><div class="two"><el-input v-model="form.kicker" maxlength="80" placeholder="中文" /><el-input v-model="form.kickerEn" maxlength="120" placeholder="English" /></div></el-form-item>
        <el-form-item :label="t('mk.titleLabel')" required><div class="two"><el-input v-model="form.title" maxlength="120" placeholder="中文" /><el-input v-model="form.titleEn" maxlength="160" placeholder="English" /></div></el-form-item>
        <el-form-item :label="t('mk.sub')"><div class="two"><el-input v-model="form.sub" maxlength="200" placeholder="中文" /><el-input v-model="form.subEn" maxlength="260" placeholder="English" /></div></el-form-item>
        <el-form-item :label="t('mk.subAbroad')"><div class="two"><el-input v-model="form.subAbroad" maxlength="200" placeholder="中文" /><el-input v-model="form.subAbroadEn" maxlength="260" placeholder="English" /></div></el-form-item>
        <el-form-item :label="t('mk.cta')"><div class="two"><el-input v-model="form.cta" maxlength="40" placeholder="中文" /><el-input v-model="form.ctaEn" maxlength="60" placeholder="English" /></div></el-form-item>
        <el-form-item :label="t('mk.action')">
          <el-select v-model="form.actionName" style="width: 160px"><el-option v-for="a in actions" :key="a" :value="a" :label="t('mk.actions.' + a)" /></el-select>
          <el-select v-if="form.actionName === 'category'" v-model="form.actionId" style="width: 200px; margin-left: 8px">
            <el-option v-for="c in meta.categories" :key="c.id" :value="c.id" :label="catName(c.id)" />
          </el-select>
          <el-input v-else-if="['service', 'search', 'url'].includes(form.actionName)" v-model="form.actionId" style="width: 260px; margin-left: 8px" :placeholder="t('mk.actionHint.' + form.actionName)" />
        </el-form-item>
        <template v-if="form.actionName === 'campaign'">
          <el-form-item :label="t('mk.campaignCats')">
            <el-select v-model="form.campaignCats" multiple style="width: 100%" :placeholder="t('mk.defaultCats')">
              <el-option v-for="c in meta.categories.filter(c => c.id !== 'all')" :key="c.id" :value="c.id" :label="catName(c.id)" />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('mk.campaignIds')">
            <el-select v-model="form.campaignIds" multiple filterable allow-create default-first-option style="width: 100%" :placeholder="t('mk.campaignIdsHint')" />
          </el-form-item>
        </template>
        <el-form-item :label="t('mk.window')">
          <el-date-picker v-model="range" type="datetimerange" :start-placeholder="t('mk.now')" :end-placeholder="t('mk.forever')" />
        </el-form-item>
        <el-form-item :label="t('cat.order')"><el-input-number v-model="form.sortOrder" :min="-1000" :max="1000" controls-position="right" /></el-form-item>
        <el-form-item :label="t('common.status')"><el-switch v-model="form.enabled" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="open = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="busy" :disabled="!form.title || !form.image" @click="save">{{ t('common.save') }}</el-button>
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
import { dateTime } from '../../core/format';
import ImageUpload from '../../components/ImageUpload.vue';
import { meta, loadMeta, catName } from '../orders/common';

const actions = ['campaign', 'category', 'service', 'search', 'url', 'none'];
const rows = ref([]);
const loading = ref(false);
const open = ref(false);
const busy = ref(false);
const editing = ref(null);
const range = ref([]);
const blank = () => ({ position: 'home', image: '', kicker: '', kickerEn: '', title: '', titleEn: '', sub: '', subEn: '', subAbroad: '', subAbroadEn: '', cta: '', ctaEn: '', actionName: 'campaign', actionId: '', campaignCats: [], campaignIds: [], sortOrder: 10, enabled: true });
const form = reactive(blank());

async function load() {
  loading.value = true;
  try {
    rows.value = await api.get('marketing/banners');
  } finally {
    loading.value = false;
  }
}
function edit(row) {
  editing.value = row || null;
  Object.assign(form, blank(), row || {});
  range.value = row?.startAt || row?.endAt ? [row.startAt ? new Date(row.startAt) : null, row.endAt ? new Date(row.endAt) : null] : [];
  open.value = true;
}
async function save() {
  busy.value = true;
  try {
    const [a, b] = range.value || [];
    const body = { ...form, startAt: a ? +new Date(a) : null, endAt: b ? +new Date(b) : null };
    if (editing.value) await api.put('marketing/banners/' + editing.value.id, body);
    else await api.post('marketing/banners', body);
    ElMessage.success(t('common.saved'));
    open.value = false;
    load();
  } finally {
    busy.value = false;
  }
}
async function remove(row) {
  await ElMessageBox.confirm(t('common.confirmDelete'), { type: 'warning' });
  await api.del('marketing/banners/' + row.id);
  load();
}
loadMeta();
load();
</script>

<style scoped>
.banner { width: 170px; height: 90px; object-fit: cover; border-radius: 8px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; }
.small { font-size: 12px; }
</style>
