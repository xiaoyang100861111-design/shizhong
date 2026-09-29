<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('vip.title') }}</h1>
      <div class="spacer" />
      <el-button v-can="'vip.edit'" @click="recalc">{{ t('vip.recalc') }}</el-button>
    </div>
    <div class="cols">
      <div class="panel" v-loading="loading">
        <h3 class="panel-title">{{ t('vip.table') }}</h3>
        <p class="muted">{{ t('vip.tableHint') }}</p>
        <el-table :data="anchors" size="small" max-height="420">
          <el-table-column :label="t('vip.level')" width="130"><template #default="{ row }"><el-input-number v-model="row[0]" size="small" :min="1" :max="500" :disabled="!writable" controls-position="right" /></template></el-table-column>
          <el-table-column :label="t('vip.xp')"><template #default="{ row }"><el-input-number v-model="row[1]" size="small" :min="0" :step="100" :disabled="!writable" controls-position="right" style="width: 180px" /></template></el-table-column>
          <el-table-column width="70"><template #default="{ $index }"><el-button v-if="writable && anchors.length > 2" link type="danger" @click="anchors.splice($index, 1)">{{ t('common.delete') }}</el-button></template></el-table-column>
        </el-table>
        <div v-if="writable" class="actions"><el-button size="small" @click="anchors.push([anchors[anchors.length - 1][0] + 5, anchors[anchors.length - 1][1] * 2])">{{ t('vip.addAnchor') }}</el-button></div>

        <h3 class="panel-title">{{ t('vip.ranks') }}</h3>
        <p class="muted">{{ t('vip.rankHint') }}</p>
        <el-table :data="ranks" size="small">
          <el-table-column :label="t('vip.minLevel')" width="130"><template #default="{ row }"><el-input-number v-model="row.min" size="small" :min="1" :disabled="!writable" controls-position="right" /></template></el-table-column>
          <el-table-column :label="t('vip.rankId')" width="120"><template #default="{ row }"><el-input v-model="row.id" size="small" :disabled="!writable" /></template></el-table-column>
          <el-table-column :label="t('vip.nameZh')"><template #default="{ row }"><el-input v-model="row.zh" size="small" :disabled="!writable" /></template></el-table-column>
          <el-table-column :label="t('vip.nameEn')"><template #default="{ row }"><el-input v-model="row.en" size="small" :disabled="!writable" /></template></el-table-column>
          <el-table-column width="60"><template #default="{ $index }"><el-button v-if="writable" link type="danger" @click="ranks.splice($index, 1)">×</el-button></template></el-table-column>
        </el-table>
        <div v-if="writable" class="actions"><el-button size="small" @click="ranks.push({ min: 1, id: 'custom', zh: '', en: '' })">{{ t('common.add') }}</el-button></div>

        <h3 class="panel-title">{{ t('vip.themes') }}</h3>
        <el-table :data="themes" size="small">
          <el-table-column :label="t('vip.themeId')"><template #default="{ row }">{{ t('vip.theme.' + row.id) }} <small class="muted">{{ row.id }}</small></template></el-table-column>
          <el-table-column :label="t('vip.unlock')" width="160"><template #default="{ row }"><el-input-number v-model="row.level" size="small" :min="1" :disabled="!writable" controls-position="right" /></template></el-table-column>
        </el-table>
        <el-form label-width="170px" class="mini">
          <el-form-item :label="t('vip.entrance')"><el-input-number v-model="entrance" :min="1" :disabled="!writable" /></el-form-item>
          <el-form-item :label="t('vip.gold')"><el-input-number v-model="tiers.gold" :min="1" :disabled="!writable" /></el-form-item>
          <el-form-item :label="t('vip.royal')"><el-input-number v-model="tiers.royal" :min="1" :disabled="!writable" /></el-form-item>
        </el-form>
        <div v-if="writable" class="actions"><el-button type="primary" :loading="saving" @click="save">{{ t('vip.save') }}</el-button></div>
      </div>

      <div>
        <div class="panel">
          <h3 class="panel-title">{{ t('vip.preview') }}</h3>
          <div class="levels">
            <div v-for="(xp, i) in preview" :key="i" class="lv"><b>V{{ i + 1 }}</b><span class="num">{{ number(xp) }}</span><small class="muted">{{ rankOf(i + 1) }}</small></div>
          </div>
        </div>
        <div class="panel" v-loading="overviewLoading">
          <h3 class="panel-title">{{ t('vip.top') }}</h3>
          <el-table :data="overview.top || []" size="small" max-height="360">
            <el-table-column :label="t('common.user')"><template #default="{ row }"><UserCell :id="row.userId" :name="row.name" :avatar="row.avatar" :display-id="row.displayId" :size="24" /></template></el-table-column>
            <el-table-column :label="t('vip.level')" width="70" align="right"><template #default="{ row }">V{{ row.level }}</template></el-table-column>
            <el-table-column :label="t('vip.xp')" width="120" align="right"><template #default="{ row }"><span class="num">{{ number(row.xp) }}</span></template></el-table-column>
          </el-table>
          <h3 class="panel-title" style="margin-top: 16px">{{ t('vip.dist') }}</h3>
          <div class="tag-list"><el-tag v-for="d in overview.distribution || []" :key="d.level" size="small">V{{ d.level }} · {{ d.users }}</el-tag></div>
        </div>
        <div class="panel">
          <h3 class="panel-title">{{ t('vip.other') }}</h3>
          <AreaSettings perm="vip.edit" :keys="['vip.demoGrant', 'vip.xpSources']" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../../core/api';
import { t, lang } from '../../core/i18n';
import { can } from '../../core/auth';
import { number } from '../../core/format';
import UserCell from '../../components/UserCell.vue';
import AreaSettings from '../gifts/AreaSettings.vue';

const writable = computed(() => can('vip.edit'));
const loading = ref(false);
const saving = ref(false);
const anchors = ref([]);
const ranks = ref([]);
const themes = ref([]);
const entrance = ref(10);
const tiers = reactive({ gold: 10, royal: 50 });
// The app's built-in rank names (locales vip.rank.*), shown when no custom name is set.
const builtIn = {
  legend: ['璀璨传奇', 'Legend'], crimson: ['赤金荣耀', 'Crimson Gold'], galaxy: ['星河尊享', 'Galaxy'],
  radiant: ['流光尊贵', 'Radiant'], crown: ['金冠贵宾', 'Gold Crown'], first: ['初遇之光', 'First Light'],
};

async function load() {
  loading.value = true;
  try {
    const res = await api.get('gl-config', { keys: 'vip.anchors,vip.ranks,vip.themes,vip.entranceLevel,vip.badgeTiers' });
    anchors.value = (res['vip.anchors'].value || []).map(a => [a[0], a[1]]);
    ranks.value = (res['vip.ranks'].value || []).map(r => ({ min: r.min, id: r.id, zh: r.zh || '', en: r.en || '' }));
    themes.value = (res['vip.themes'].value || []).map(x => ({ ...x }));
    entrance.value = res['vip.entranceLevel'].value;
    Object.assign(tiers, res['vip.badgeTiers'].value || {});
  } finally {
    loading.value = false;
  }
}
load();

const preview = computed(() => {
  const list = [...anchors.value].filter(a => a[0] > 0).sort((a, b) => a[0] - b[0]);
  if (list.length < 2) return [];
  const max = list[list.length - 1][0];
  return Array.from({ length: max }, (_, i) => {
    const level = i + 1;
    const upper = list.findIndex(a => a[0] >= level);
    if (upper <= 0) return upper === 0 ? list[0][1] : 0;
    const [hl, h] = list[upper];
    const [ll, l] = list[upper - 1];
    return Math.round(l + ((h - l) * (level - ll)) / (hl - ll));
  });
});
function rankOf(level) {
  const r = [...ranks.value].sort((a, b) => b.min - a.min).find(x => level >= x.min);
  if (!r) return '';
  const custom = lang.value === 'en' ? r.en || r.zh : r.zh || r.en;
  return custom || (builtIn[r.id] ? builtIn[r.id][lang.value === 'en' ? 1 : 0] : r.id);
}
async function save() {
  saving.value = true;
  try {
    await api.put('gl-config', {
      'vip.anchors': [...anchors.value].sort((a, b) => a[0] - b[0]),
      'vip.ranks': ranks.value.map(r => ({ min: r.min, id: r.id, ...(r.zh ? { zh: r.zh } : {}), ...(r.en ? { en: r.en } : {}) })),
      'vip.themes': themes.value,
      'vip.entranceLevel': entrance.value,
      'vip.badgeTiers': { ...tiers },
    });
    ElMessage.success(t('common.saved'));
    load();
    loadOverview();
  } finally {
    saving.value = false;
  }
}

const overview = ref({});
const overviewLoading = ref(false);
async function loadOverview() {
  overviewLoading.value = true;
  try {
    overview.value = await api.get('vip/overview');
  } finally {
    overviewLoading.value = false;
  }
}
loadOverview();
async function recalc() {
  const res = await api.post('vip/recalculate');
  ElMessage.success(t('vip.recalcDone', { n: res.updated }));
  loadOverview();
}
</script>

<style scoped>
.cols { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 16px; }
.actions { display: flex; justify-content: flex-end; margin: 8px 0 16px; }
.levels { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 6px; max-height: 320px; overflow: auto; }
.lv { display: flex; flex-direction: column; padding: 6px 8px; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; font-size: 12px; }
.mini { margin-top: 12px; }
@media (max-width: 1100px) { .cols { grid-template-columns: 1fr; } }
</style>
