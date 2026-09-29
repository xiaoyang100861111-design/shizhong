<template>
  <div class="page" v-loading="loading">
    <div class="page-head">
      <el-button :icon="IconBack" circle @click="$router.back()" />
      <h1>{{ isNew ? t('cat.newService') : f.name || id }}</h1>
      <el-tag v-if="!isNew" :type="f.status ? 'info' : 'success'">{{ f.status ? t('cat.offShelf') : t('cat.onShelf') }}</el-tag>
      <div class="spacer" />
      <a v-if="!isNew && !f.status" :href="'/#service/' + id" target="_blank" class="el-button el-button--default is-link">{{ t('cat.openInApp') }}</a>
      <el-button type="primary" :loading="busy" :disabled="!f.name || !f.cat" @click="save">{{ t('common.save') }}</el-button>
    </div>
    <p v-if="!isNew" class="page-sub num">{{ id }} · {{ t('cat.soldLine', { orders: stats.orders, gmv: money(stats.gmv), sold: stats.sold, reviews: stats.reviewCount }) }}</p>

    <el-tabs v-model="tab" class="panel">
      <!-- ------------------------------------------------ basics -->
      <el-tab-pane :label="t('cat.tabBasic')" name="basic">
        <el-form label-position="top" class="grid">
          <el-form-item v-if="isNew && !shop" :label="t('cat.serviceId')"><el-input v-model="f.id" maxlength="40" :placeholder="t('cat.serviceIdHint')" /></el-form-item>
          <el-form-item :label="t('cat.name')" required class="wide"><el-input v-model="f.name" maxlength="200" show-word-limit /></el-form-item>
          <el-form-item :label="t('cat.sub')" class="wide"><el-input v-model="f.sub" maxlength="300" /></el-form-item>
          <el-form-item :label="t('cm.category')" required>
            <el-select v-model="f.cat" filterable><el-option v-for="c in meta.categories.filter(c => c.id !== 'all')" :key="c.id" :value="c.id" :label="catName(c.id)" /></el-select>
          </el-form-item>
          <el-form-item :label="t('cat.type')">
            <el-select v-model="f.type"><el-option v-for="ty in ['service', 'goods', 'job']" :key="ty" :value="ty" :label="t('cat.types.' + ty)" /></el-select>
          </el-form-item>
          <el-form-item v-if="!shop" :label="t('cm.merchant')"><MerchantSelect v-model="f.merchantId" :label="f.merchantName" /></el-form-item>
          <el-form-item :label="t('cat.price')" required>
            <el-input-number v-model="f.price" :min="0" :max="1000000" :precision="2" :step="1" controls-position="right" />
          </el-form-item>
          <el-form-item :label="t('cat.unit')"><el-input v-model="f.unit" maxlength="20" :placeholder="t('cat.unitHint')" /></el-form-item>
          <el-form-item :label="t('cat.stock')">
            <div class="row"><el-switch v-model="trackStock" /><el-input-number v-if="trackStock" v-model="f.stock" :min="0" :max="1000000" controls-position="right" /><span v-else class="muted">{{ t('cat.unlimited') }}</span></div>
          </el-form-item>
          <el-form-item :label="t('common.status')">
            <el-radio-group v-model="f.status"><el-radio :value="0">{{ t('cat.onShelf') }}</el-radio><el-radio :value="1">{{ t('cat.offShelf') }}</el-radio></el-radio-group>
          </el-form-item>
          <el-form-item :label="t('common.city')"><el-input v-model="f.city" maxlength="60" /></el-form-item>
          <el-form-item :label="t('cat.area')"><el-input v-model="f.area" maxlength="60" /></el-form-item>
          <el-form-item :label="t('cat.country')"><el-input v-model="f.countryCode" maxlength="4" /></el-form-item>
          <el-form-item :label="t('cat.badge')"><el-input v-model="f.badge" maxlength="40" /></el-form-item>
          <template v-if="!shop">
            <el-form-item :label="t('cat.store')"><el-input v-model="f.store" maxlength="80" :placeholder="t('cat.storeHint')" /></el-form-item>
            <el-form-item :label="t('cat.sortOrder')"><el-input-number v-model="f.sortOrder" :min="-100000" :max="100000" controls-position="right" /></el-form-item>
            <el-form-item :label="t('cat.rating')"><el-input-number v-model="f.rating" :min="0" :max="5" :step="0.1" :precision="1" controls-position="right" /></el-form-item>
            <el-form-item :label="t('cat.ratingVotes')"><el-input-number v-model="f.ratingVotes" :min="0" :max="100000" controls-position="right" /></el-form-item>
            <el-form-item :label="t('cat.sales')"><el-input v-model="f.sales" maxlength="60" :placeholder="t('cat.salesHint')" /></el-form-item>
          </template>
          <el-form-item :label="t('cat.image')" class="wide">
            <ImageUpload v-model="f.image" :width="200" :height="140" purpose="service" allow-path path-hint="photos/xxx.webp" />
          </el-form-item>
          <template v-if="f.cat === 'phone'">
            <el-divider class="wide">{{ t('cat.phoneBlock') }}</el-divider>
            <el-form-item :label="t('cat.phoneKind')"><el-select v-model="f.phoneKind" clearable><el-option value="topup" label="topup" /><el-option value="consultation" label="consultation" /></el-select></el-form-item>
            <el-form-item :label="t('cm.field.operator')"><el-input v-model="d.operator" maxlength="40" /></el-form-item>
            <el-form-item :label="t('cm.field.faceValue')"><el-input-number v-model="d.faceValue" :min="0" :precision="2" controls-position="right" /></el-form-item>
            <el-form-item :label="t('cm.field.serviceFee')"><el-input-number v-model="d.serviceFee" :min="0" :precision="2" controls-position="right" /></el-form-item>
          </template>
          <template v-if="f.type === 'job'">
            <el-divider class="wide">{{ t('cat.jobBlock') }}</el-divider>
            <el-form-item :label="t('cat.salaryMin')"><el-input-number v-model="f.salaryMin" :min="0" controls-position="right" /></el-form-item>
            <el-form-item :label="t('cat.salaryMax')"><el-input-number v-model="f.salaryMax" :min="0" controls-position="right" /></el-form-item>
            <el-form-item :label="t('cat.employment')"><el-input v-model="f.employment" maxlength="20" placeholder="全职 / 兼职" /></el-form-item>
          </template>
        </el-form>
      </el-tab-pane>

      <!-- ------------------------------------------------ details (zh + en side by side) -->
      <el-tab-pane :label="t('cat.tabDetail')" name="detail">
        <p class="muted">{{ t('cat.detailHint') }}</p>
        <el-form label-position="top">
          <div v-for="k in textKeys" :key="k" class="pair">
            <el-form-item :label="t('cat.fields.' + k)"><el-input v-model="d[k]" type="textarea" :autosize="{ minRows: k === 'description' ? 4 : 1, maxRows: 12 }" /></el-form-item>
            <el-form-item :label="t('cat.fields.' + k) + ' (EN)'"><el-input v-model="e[k]" type="textarea" :autosize="{ minRows: k === 'description' ? 4 : 1, maxRows: 12 }" /></el-form-item>
          </div>
          <div v-for="k in listKeys" :key="k" class="pair">
            <el-form-item :label="t('cat.fields.' + k) + ' · ' + t('cat.onePerLine')"><el-input v-model="d[k]" type="textarea" :autosize="{ minRows: 2, maxRows: 10 }" /></el-form-item>
            <el-form-item :label="t('cat.fields.' + k) + ' (EN)'"><el-input v-model="e[k]" type="textarea" :autosize="{ minRows: 2, maxRows: 10 }" /></el-form-item>
          </div>
          <div class="pair">
            <el-form-item :label="t('cat.fields.languages') + ' · ' + t('cat.onePerLine')"><el-input v-model="d.languages" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" /></el-form-item>
          </div>
        </el-form>
        <h3 class="panel-title">{{ t('cat.fields.details') }}</h3>
        <el-table :data="details" size="small" class="rows">
          <el-table-column :label="t('cat.label')"><template #default="{ row }"><el-input v-model="row.label" size="small" /></template></el-table-column>
          <el-table-column :label="t('cat.value')"><template #default="{ row }"><el-input v-model="row.value" size="small" /></template></el-table-column>
          <el-table-column :label="t('cat.label') + ' (EN)'"><template #default="{ row }"><el-input v-model="row.labelEn" size="small" /></template></el-table-column>
          <el-table-column :label="t('cat.value') + ' (EN)'"><template #default="{ row }"><el-input v-model="row.valueEn" size="small" /></template></el-table-column>
          <el-table-column width="60"><template #default="{ $index }"><el-button link type="danger" @click="details.splice($index, 1)">✕</el-button></template></el-table-column>
        </el-table>
        <el-button size="small" @click="details.push({ label: '', value: '', labelEn: '', valueEn: '' })">+ {{ t('common.add') }}</el-button>

        <h3 class="panel-title">FAQ</h3>
        <el-table :data="faq" size="small" class="rows">
          <el-table-column :label="t('cat.question')"><template #default="{ row }"><el-input v-model="row.q" size="small" type="textarea" autosize /></template></el-table-column>
          <el-table-column :label="t('cat.answer')"><template #default="{ row }"><el-input v-model="row.a" size="small" type="textarea" autosize /></template></el-table-column>
          <el-table-column :label="t('cat.question') + ' (EN)'"><template #default="{ row }"><el-input v-model="row.qEn" size="small" type="textarea" autosize /></template></el-table-column>
          <el-table-column :label="t('cat.answer') + ' (EN)'"><template #default="{ row }"><el-input v-model="row.aEn" size="small" type="textarea" autosize /></template></el-table-column>
          <el-table-column width="60"><template #default="{ $index }"><el-button link type="danger" @click="faq.splice($index, 1)">✕</el-button></template></el-table-column>
        </el-table>
        <el-button size="small" @click="faq.push({ q: '', a: '', qEn: '', aEn: '' })">+ {{ t('common.add') }}</el-button>

        <h3 class="panel-title">{{ t('cat.sampleReviews') }}</h3>
        <p class="muted small">{{ t('cat.sampleReviewsHint') }}</p>
        <el-table :data="samples" size="small" class="rows">
          <el-table-column :label="t('cat.author')" width="130"><template #default="{ row }"><el-input v-model="row.author" size="small" /></template></el-table-column>
          <el-table-column :label="t('cat.stars')" width="90"><template #default="{ row }"><el-input-number v-model="row.stars" :min="1" :max="5" size="small" controls-position="right" /></template></el-table-column>
          <el-table-column :label="t('cat.reviewText')"><template #default="{ row }"><el-input v-model="row.text" size="small" type="textarea" autosize /></template></el-table-column>
          <el-table-column :label="t('cat.author') + ' (EN)'" width="130"><template #default="{ row }"><el-input v-model="row.authorEn" size="small" /></template></el-table-column>
          <el-table-column :label="t('cat.reviewText') + ' (EN)'"><template #default="{ row }"><el-input v-model="row.textEn" size="small" type="textarea" autosize /></template></el-table-column>
          <el-table-column :label="t('common.time')" width="140"><template #default="{ row }"><el-input v-model="row.date" size="small" placeholder="2026-09-01" /></template></el-table-column>
          <el-table-column width="60"><template #default="{ $index }"><el-button link type="danger" @click="samples.splice($index, 1)">✕</el-button></template></el-table-column>
        </el-table>
        <el-button size="small" @click="samples.push({ author: '', stars: 5, text: '', authorEn: '', textEn: '', date: '' })">+ {{ t('common.add') }}</el-button>
      </el-tab-pane>

      <!-- ------------------------------------------------ English card texts -->
      <el-tab-pane :label="t('cat.tabEnglish')" name="en">
        <p class="muted">{{ t('cat.englishHint') }}</p>
        <el-form label-position="top" class="grid">
          <el-form-item :label="t('cat.name') + ' (EN)'" class="wide"><el-input v-model="e.name" maxlength="300" /></el-form-item>
          <el-form-item :label="t('cat.sub') + ' (EN)'" class="wide"><el-input v-model="e.sub" maxlength="400" /></el-form-item>
          <el-form-item :label="t('cat.area') + ' (EN)'"><el-input v-model="e.area" /></el-form-item>
          <el-form-item :label="t('cat.unit') + ' (EN)'"><el-input v-model="e.unit" /></el-form-item>
          <el-form-item :label="t('cat.badge') + ' (EN)'"><el-input v-model="e.badge" /></el-form-item>
          <el-form-item v-if="!shop" :label="t('cat.sales') + ' (EN)'"><el-input v-model="e.sales" /></el-form-item>
          <el-form-item v-if="!shop" :label="t('cat.store') + ' (EN)'"><el-input v-model="e.store" :placeholder="t('cat.storeHint')" /></el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Back as IconBack } from '@element-plus/icons-vue';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { money } from '../../core/format';
import ImageUpload from '../../components/ImageUpload.vue';
import MerchantSelect from '../merchants/MerchantSelect.vue';
import { meta, loadMeta, catName } from '../orders/common';

const props = defineProps({ shop: Boolean });
const route = useRoute();
const router = useRouter();
const id = computed(() => route.params.id);
const isNew = computed(() => id.value === 'new');
const base = computed(() => (props.shop ? 'shop/products' : 'catalog/services'));
const loading = ref(false);
const busy = ref(false);
const tab = ref('basic');
const stats = reactive({ orders: 0, gmv: 0, sold: 0, reviewCount: 0 });
const textKeys = ['description', 'duration', 'availability', 'pricingNote', 'notice'];
const listKeys = ['includes', 'excludes', 'requirements', 'benefits'];
const blank = () => ({
  id: '', cat: route.query.cat || 'clean', type: 'service', merchantId: null, merchantName: '', name: '', sub: '', city: '吉隆坡', area: '', countryCode: 'MY',
  price: 0, unit: '次', store: '', rating: 4.6, ratingVotes: 5, sales: '', badge: '', image: '', phoneKind: null, salaryMin: null, salaryMax: null,
  employment: '', stock: null, status: 0, sortOrder: 0,
});
const f = reactive(blank());
const d = reactive({});
const e = reactive({});
const details = ref([]);
const faq = ref([]);
const samples = ref([]);
const trackStock = ref(false);
let doc0 = {};

const lines = v => String(v || '').split('\n').map(x => x.trim()).filter(Boolean);
const unlines = v => (Array.isArray(v) ? v.join('\n') : v || '');

async function load() {
  await loadMeta();
  if (isNew.value) return;
  loading.value = true;
  try {
    const r = await api.get(base.value + '/' + id.value);
    Object.assign(f, blank(), r, { store: r.store || '', merchantName: r.merchantName || '' });
    Object.assign(stats, { orders: r.orders, gmv: r.gmv, sold: r.sold, reviewCount: r.reviewCount });
    trackStock.value = r.stock !== null && r.stock !== undefined;
    doc0 = r.doc || {};
    const en = r.en || {};
    for (const k of textKeys) {
      d[k] = doc0[k] || '';
      e[k] = en[k] || '';
    }
    for (const k of listKeys) {
      d[k] = unlines(doc0[k]);
      e[k] = unlines(en[k]);
    }
    d.languages = unlines(doc0.languages);
    for (const k of ['operator', 'faceValue', 'serviceFee']) d[k] = doc0[k] ?? (k === 'operator' ? '' : null);
    for (const k of ['name', 'sub', 'area', 'unit', 'badge', 'sales', 'store']) e[k] = en[k] || '';
    details.value = (doc0.details || []).map((x, i) => ({ label: x.label, value: x.value, labelEn: en.detailLabels?.[i] || '', valueEn: en.detailValues?.[i] || '' }));
    faq.value = (doc0.faq || []).map((x, i) => ({ q: x.q, a: x.a, qEn: en.faqQ?.[i] || '', aEn: en.faqA?.[i] || '' }));
    samples.value = (doc0.reviews || []).map((x, i) => ({ author: x.author, stars: x.stars, text: x.text, date: x.date || '', authorEn: en.reviewAuthors?.[i] || '', textEn: en.reviewTexts?.[i] || '' }));
  } finally {
    loading.value = false;
  }
}

const orNull = v => (v === '' || v === undefined ? null : v);
const listOrNull = v => (lines(v).length ? lines(v) : null);
const arrOrNull = a => (a.some(x => x) ? a.map(x => x || null) : null);

async function save() {
  const detailRows = details.value.filter(x => x.label || x.value);
  const faqRows = faq.value.filter(x => x.q || x.a);
  const sampleRows = samples.value.filter(x => x.text || x.author);
  const doc = {
    description: orNull(d.description), duration: orNull(d.duration), availability: orNull(d.availability), pricingNote: orNull(d.pricingNote), notice: orNull(d.notice),
    includes: listOrNull(d.includes), excludes: listOrNull(d.excludes), requirements: listOrNull(d.requirements), benefits: listOrNull(d.benefits),
    languages: listOrNull(d.languages),
    details: detailRows.length ? detailRows.map(x => ({ label: x.label, value: x.value })) : null,
    faq: faqRows.length ? faqRows.map(x => ({ q: x.q, a: x.a })) : null,
    reviews: sampleRows.length ? sampleRows.map(x => ({ author: x.author, stars: Number(x.stars) || 5, text: x.text, date: x.date || undefined })) : null,
  };
  if (f.cat === 'phone') Object.assign(doc, { operator: orNull(d.operator), faceValue: d.faceValue ?? null, serviceFee: d.serviceFee ?? null });
  const en = {
    name: orNull(e.name), sub: orNull(e.sub), area: orNull(e.area), unit: orNull(e.unit), badge: orNull(e.badge), sales: orNull(e.sales), store: orNull(e.store),
    description: orNull(e.description), duration: orNull(e.duration), availability: orNull(e.availability), pricingNote: orNull(e.pricingNote), notice: orNull(e.notice),
    includes: listOrNull(e.includes), excludes: listOrNull(e.excludes), requirements: listOrNull(e.requirements), benefits: listOrNull(e.benefits),
    detailLabels: arrOrNull(detailRows.map(x => x.labelEn)), detailValues: arrOrNull(detailRows.map(x => x.valueEn)),
    faqQ: arrOrNull(faqRows.map(x => x.qEn)), faqA: arrOrNull(faqRows.map(x => x.aEn)),
    reviewAuthors: arrOrNull(sampleRows.map(x => x.authorEn)), reviewTexts: arrOrNull(sampleRows.map(x => x.textEn)),
  };
  const body = { ...f, stock: trackStock.value ? f.stock ?? 0 : null, store: orNull(f.store), id: isNew.value ? orNull(f.id) : undefined, doc, en };
  busy.value = true;
  try {
    if (isNew.value) {
      const res = await api.post(base.value, body);
      ElMessage.success(t('common.saved'));
      router.replace((props.shop ? '/shop/products/' : '/catalog/services/') + res.id);
    } else {
      await api.put(base.value + '/' + id.value, body);
      ElMessage.success(t('common.saved'));
      load();
    }
  } finally {
    busy.value = false;
  }
}
load();
</script>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 0 20px; }
.grid .wide { grid-column: 1 / -1; }
.grid .el-select, .grid .el-input-number { width: 100%; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
.row { display: flex; gap: 10px; align-items: center; }
.rows { margin-bottom: 8px; }
.small { font-size: 12px; }
.panel-title { margin-top: 20px; }
@media (max-width: 768px) { .pair { grid-template-columns: 1fr; } }
</style>
