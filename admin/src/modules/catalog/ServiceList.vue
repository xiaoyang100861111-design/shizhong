<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ shop ? t('cat.myProducts') : t('cat.services') }}</h1>
      <div class="spacer" />
      <template v-if="!shop">
        <el-button v-can="'catalog.import'" :icon="IconUpload" @click="fileEl.click()">{{ t('common.import') }}</el-button>
        <el-button v-can="'catalog.export'" :icon="IconDownload" @click="list.exportCsv('catalog/services/export', 'services.csv')">{{ t('common.export') }}</el-button>
      </template>
      <el-button v-if="shop ? can('shop.products') : can('catalog.edit')" type="primary" :icon="IconPlus" @click="$router.push(editBase + 'new' + (list.filters.cat ? '?cat=' + list.filters.cat : ''))">{{ t('cat.newService') }}</el-button>
      <input ref="fileEl" type="file" accept=".csv,text/csv" hidden @change="importCsv" />
    </div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('cat.q')" clearable @keyup.enter="list.search" @clear="list.search">
          <template #prefix><el-icon><IconSearch /></el-icon></template>
        </el-input>
        <el-select v-model="list.filters.cat" clearable :placeholder="t('cm.category')" @change="list.search">
          <el-option v-for="c in meta.categories.filter(c => c.id !== 'all')" :key="c.id" :value="c.id" :label="catName(c.id)" />
        </el-select>
        <el-select v-model="list.filters.type" clearable :placeholder="t('cat.type')" @change="list.search">
          <el-option v-for="ty in ['service', 'goods', 'job']" :key="ty" :value="ty" :label="t('cat.types.' + ty)" />
        </el-select>
        <el-select v-model="list.filters.status" clearable :placeholder="t('common.status')" @change="list.search">
          <el-option :value="0" :label="t('cat.onShelf')" /><el-option :value="1" :label="t('cat.offShelf')" />
        </el-select>
        <MerchantSelect v-if="!shop" v-model="list.filters.merchantId" @update:model-value="list.search" />
        <el-input v-model="list.filters.city" :placeholder="t('common.city')" clearable style="width: 120px" @keyup.enter="list.search" @clear="list.search" />
        <el-checkbox v-model="list.filters.lowStock" @change="list.search">{{ t('cat.lowStock') }}</el-checkbox>
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
        <el-button @click="list.reset">{{ t('common.reset') }}</el-button>
      </div>
      <div v-if="selected.length && !shop" class="bulk">
        <span>{{ t('cat.selected', { n: selected.length }) }}</span>
        <el-button v-can="'catalog.edit'" size="small" @click="bulk('on')">{{ t('cat.putOn') }}</el-button>
        <el-button v-can="'catalog.edit'" size="small" @click="bulk('off')">{{ t('cat.takeOff') }}</el-button>
        <el-select v-can="'catalog.edit'" size="small" :placeholder="t('cat.moveTo')" style="width: 150px" @change="v => bulk('category', v)">
          <el-option v-for="c in meta.categories.filter(c => c.id !== 'all')" :key="c.id" :value="c.id" :label="catName(c.id)" />
        </el-select>
        <el-button v-can="'catalog.delete'" size="small" type="danger" plain @click="bulk('delete')">{{ t('common.delete') }}</el-button>
      </div>
      <el-table v-loading="list.loading.value" :data="list.items.value" stripe @selection-change="rows => (selected = rows)" @sort-change="onSort">
        <el-table-column v-if="!shop" type="selection" width="40" />
        <el-table-column :label="t('cat.service')" min-width="280">
          <template #default="{ row }">
            <div class="svc">
              <img :src="assetUrl(row.image)" class="thumb" alt="" />
              <div>
                <router-link :to="editBase + row.id" class="name">{{ row.name }}</router-link>
                <div class="muted small">{{ row.nameEn }}</div>
                <small class="muted num">{{ row.id }} · {{ catName(row.cat) }} · {{ t('cat.types.' + row.type) }}</small>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column v-if="!shop" :label="t('cm.merchant')" min-width="130" prop="merchantName" />
        <el-table-column :label="t('common.city')" width="110"><template #default="{ row }">{{ row.city }}<div class="muted small">{{ row.area }}</div></template></el-table-column>
        <el-table-column :label="t('cat.price')" prop="price" sortable="custom" align="right" width="150">
          <template #default="{ row }">
            <template v-if="shop && editing === row.id + ':price'">
              <el-input-number v-model="quick" size="small" :min="0" :precision="2" controls-position="right" style="width: 110px" @keyup.enter="saveQuick(row, 'price')" />
              <el-button link type="primary" size="small" @click="saveQuick(row, 'price')">✓</el-button>
            </template>
            <span v-else class="num" :class="{ editable: shop }" @click="shop && startQuick(row, 'price')">{{ money(row.price, '') }}<small class="muted"> / {{ row.unit }}</small></span>
          </template>
        </el-table-column>
        <el-table-column :label="t('cat.stock')" prop="stock" sortable="custom" align="right" width="130">
          <template #default="{ row }">
            <template v-if="shop && editing === row.id + ':stock'">
              <el-input-number v-model="quick" size="small" :min="-1" controls-position="right" style="width: 90px" @keyup.enter="saveQuick(row, 'stock')" />
              <el-button link type="primary" size="small" @click="saveQuick(row, 'stock')">✓</el-button>
            </template>
            <span v-else class="num" :class="{ editable: shop, neg: row.stock !== null && row.stock <= 5 }" @click="shop && startQuick(row, 'stock')">{{ row.stock ?? '∞' }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('cat.rating')" prop="rating" sortable="custom" align="right" width="90">
          <template #default="{ row }"><span class="num">★ {{ row.rating.toFixed(1) }}</span><div class="muted small">{{ row.reviewCount }}</div></template>
        </el-table-column>
        <el-table-column :label="t('cat.soldCol')" prop="sold" sortable="custom" align="right" width="90"><template #default="{ row }"><span class="num">{{ row.sold }}</span></template></el-table-column>
        <el-table-column :label="t('common.status')" width="100">
          <template #default="{ row }">
            <el-switch :model-value="row.status === 0" :disabled="!(shop ? can('shop.products') : can('catalog.edit'))" @change="v => shelve(row, v)" />
          </template>
        </el-table-column>
        <el-table-column :label="t('common.updatedAt')" prop="updatedAt" sortable="custom" width="140"><template #default="{ row }"><span class="num small">{{ dateTime(row.updatedAt) }}</span></template></el-table-column>
        <el-table-column :label="t('common.actions')" width="80" fixed="right">
          <template #default="{ row }"><el-button link type="primary" @click="$router.push(editBase + row.id)">{{ t('common.edit') }}</el-button></template>
        </el-table-column>
      </el-table>
      <Pager :list="list" />
    </div>
    <el-dialog v-model="importOpen" :title="t('cat.importResult')" width="520px">
      <p>{{ t('cat.importLine', { created: importRes.created, updated: importRes.updated, errors: importRes.errors?.length || 0 }) }}</p>
      <el-table v-if="importRes.errors?.length" :data="importRes.errors" size="small" max-height="300">
        <el-table-column :label="t('cat.line')" prop="line" width="70" />
        <el-table-column :label="t('cat.error')"><template #default="{ row }">{{ errorText({ code: row.code, extra: { detail: row.detail } }) }}</template></el-table-column>
      </el-table>
      <p class="muted small">{{ t('cat.importHint') }}</p>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Download as IconDownload, Upload as IconUpload, Plus as IconPlus } from '@element-plus/icons-vue';
import { useList } from '../../core/list';
import { api, assetUrl, errorText } from '../../core/api';
import { t } from '../../core/i18n';
import { can } from '../../core/auth';
import { dateTime, money } from '../../core/format';
import Pager from '../../components/Pager.vue';
import MerchantSelect from '../merchants/MerchantSelect.vue';
import { meta, loadMeta, catName } from '../orders/common';

const props = defineProps({ shop: Boolean });
const base = computed(() => (props.shop ? 'shop/products' : 'catalog/services'));
const editBase = computed(() => (props.shop ? '/shop/products/' : '/catalog/services/'));
const route = useRoute();
const list = useList(() => base.value, { q: '', cat: String(route.query.cat || ''), type: '', status: null, merchantId: route.query.merchantId ? Number(route.query.merchantId) : null, city: '', lowStock: false, sort: '' });
const selected = ref([]);
const fileEl = ref();
const importOpen = ref(false);
const importRes = ref({});
const editing = ref('');
const quick = ref(0);

function onSort({ prop, order }) {
  list.filters.sort = order ? (order === 'descending' ? '-' : '') + prop : '';
  list.search();
}
async function bulk(action, value) {
  if (action === 'delete') await ElMessageBox.confirm(t('cat.deleteConfirm', { n: selected.value.length }), { type: 'warning' });
  const res = await api.post('catalog/services/bulk', { ids: selected.value.map(r => r.id), action, value });
  ElMessage.success(t('cat.bulkDone', { n: res.count }));
  list.load();
}
async function shelve(row, on) {
  if (props.shop) await api.patch('shop/products/' + row.id, { status: on ? 0 : 1 });
  else await api.post('catalog/services/bulk', { ids: [row.id], action: on ? 'on' : 'off' });
  row.status = on ? 0 : 1;
  ElMessage.success(on ? t('cat.onShelf') : t('cat.offShelf'));
}
function startQuick(row, field) {
  editing.value = row.id + ':' + field;
  quick.value = field === 'stock' ? row.stock ?? -1 : row.price;
}
async function saveQuick(row, field) {
  await api.patch('shop/products/' + row.id, { [field]: quick.value });
  editing.value = '';
  list.load();
}
async function importCsv(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  const { request } = await import('../../core/api');
  importRes.value = await request('POST', 'catalog/services/import', undefined, { form });
  importOpen.value = true;
  list.load();
}
loadMeta();
</script>

<style scoped>
.svc { display: flex; gap: 10px; align-items: center; }
.svc .thumb { flex: none; }
.name { color: var(--el-text-color-primary); font-weight: 500; text-decoration: none; }
.name:hover { color: var(--el-color-primary); }
.small { font-size: 12px; }
.bulk { display: flex; gap: 8px; align-items: center; padding: 8px 12px; margin-bottom: 8px; border-radius: 8px; background: var(--el-color-primary-light-9); }
.editable { cursor: pointer; border-bottom: 1px dashed var(--el-border-color); }
</style>
