<template>
  <div class="page" v-loading="!p">
    <div class="page-head">
      <h1>{{ t('risk.pol.title') }}</h1>
      <el-tag v-if="p" :type="levelType[p.level]" effect="dark">{{ t('risk.pol.current') }}：{{ levelName(p.level) }}</el-tag>
      <div class="spacer" />
      <el-radio-group v-model="view" size="small">
        <el-radio-button value="level">{{ t('risk.pol.byLevel') }}</el-radio-button>
        <el-radio-button value="compare">{{ t('risk.pol.compare') }}</el-radio-button>
      </el-radio-group>
    </div>

    <template v-if="p">
      <div class="levels">
        <div v-for="l in p.levels" :key="l.code" class="level-card" :class="['lv-' + l.code, { current: l.code === p.level, selected: l.code === selected && view === 'level' }]"
          @click="select(l.code)">
          <div class="lc-head">
            <b>{{ pick(l, 'name') }}</b>
            <el-tag v-if="l.code === p.level" size="small" :type="levelType[l.code]" effect="dark">{{ t('risk.pol.inUse') }}</el-tag>
          </div>
          <p class="desc">{{ pick(l, 'desc') }}</p>
          <div class="lc-foot">
            <small class="muted">{{ t('risk.pol.recommended') }}：{{ t('risk.pol.when.' + l.code) }}</small>
            <el-button v-if="can('risk.policy') && l.code !== p.level" size="small" :type="l.code === 'severe' ? 'danger' : 'primary'" plain @click.stop="use(l.code)">
              {{ t('risk.pol.use') }}
            </el-button>
          </div>
        </div>
      </div>

      <!-- rules of one level -->
      <div v-if="view === 'level'" class="panel">
        <h3 class="panel-title">
          {{ t('risk.pol.viewing', { level: levelName(selected) }) }}
          <div class="spacer" />
          <el-button v-can="'risk.policy'" type="primary" plain size="small" :icon="IconEdit" @click="openEditor(selected)">
            {{ selected === 'custom' ? t('risk.pol.editCustom') : t('risk.pol.customize') }}
          </el-button>
        </h3>
        <el-alert v-if="selected === 'custom' && !customDiffers" :title="t('risk.pol.noCustom')" type="info" :closable="false" show-icon class="mb" />
        <div class="scenes">
          <section v-for="s in p.schema" :key="s.scene" class="scene">
            <h4>{{ pick(s, 'name') }}<small class="muted">{{ pick(s, 'desc') }}</small></h4>
            <table class="rules">
              <tr v-for="f in s.fields" :key="f.key" :class="{ changed: selected === 'custom' && differs(s.scene, f.key) }">
                <td class="lbl">
                  {{ pick(f, 'label') }}
                  <el-tooltip v-if="pick(f, 'help')" :content="pick(f, 'help')" placement="top"><el-icon class="help"><IconQuestion /></el-icon></el-tooltip>
                </td>
                <td class="val" :class="{ off: isOff(f, rulesOf(selected)[s.scene]?.[f.key]) }">
                  {{ formatValue(f, rulesOf(selected)[s.scene]?.[f.key], rulesOf(selected)[s.scene]) }}
                  <el-tooltip v-if="selected === 'custom' && differs(s.scene, f.key)" :content="t('risk.pol.differsFrom', { level: levelName('light') }) + '：' + formatValue(f, p.presets.light[s.scene]?.[f.key], p.presets.light[s.scene])">
                    <span class="dot" />
                  </el-tooltip>
                </td>
              </tr>
            </table>
          </section>
        </div>
      </div>

      <!-- all levels side by side -->
      <div v-else class="panel">
        <p class="muted hint">{{ t('risk.pol.compareHint') }}</p>
        <div class="cmp-wrap">
          <table class="cmp">
            <thead>
              <tr>
                <th class="lbl">{{ t('risk.pol.field') }}</th>
                <th v-for="l in COLUMNS" :key="l" :class="{ cur: l === p.level }">
                  <el-tag size="small" :type="levelType[l]" :effect="l === p.level ? 'dark' : 'light'">{{ levelName(l) }}</el-tag>
                  <div class="when">{{ t('risk.pol.when.' + l) }}</div>
                </th>
              </tr>
            </thead>
            <tbody>
              <template v-for="s in p.schema" :key="s.scene">
                <tr class="scene-row">
                  <td :colspan="COLUMNS.length + 1"><b>{{ pick(s, 'name') }}</b><small class="muted">{{ pick(s, 'desc') }}</small></td>
                </tr>
                <tr v-for="f in s.fields" :key="s.scene + f.key">
                  <td class="lbl">
                    {{ pick(f, 'label') }}
                    <el-tooltip v-if="pick(f, 'help')" :content="pick(f, 'help')" placement="top"><el-icon class="help"><IconQuestion /></el-icon></el-tooltip>
                  </td>
                  <td v-for="(l, i) in COLUMNS" :key="l" :class="['s' + shade(s.scene, f)[i], { cur: l === p.level, bold: l === 'custom' && differs(s.scene, f.key) }]">
                    {{ formatValue(f, rulesOf(l)[s.scene]?.[f.key], rulesOf(l)[s.scene]) }}
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>

      <template v-if="can('risk.policy')">
        <ConfigForm :groups="['risk']" endpoint="risk/config" perm="risk.policy" />
      </template>
    </template>

    <el-drawer v-model="editorOpen" :title="t('risk.pol.customTitle', { level: levelName(editorBase) })" size="min(760px, 100%)" class="editor">
      <el-form v-if="draft" label-position="top">
        <section v-for="s in p.schema" :key="s.scene" class="ed-scene">
          <h4>{{ pick(s, 'name') }}<small class="muted">{{ pick(s, 'desc') }}</small></h4>
          <div class="ed-grid">
            <el-form-item v-for="f in s.fields" :key="f.key" :label="pick(f, 'label')">
              <el-select v-if="f.type === 'captcha'" v-model="draft[s.scene][f.key]" style="width: 100%">
                <el-option v-for="m in ['off', 'risky', 'always']" :key="m" :value="m" :label="t('risk.captchaMode.' + m)" />
              </el-select>
              <el-switch v-else-if="f.type === 'bool'" v-model="draft[s.scene][f.key]" />
              <div v-else class="int">
                <el-input-number v-model="draft[s.scene][f.key]" :min="0" :max="f.max" :step="1" :precision="0" controls-position="right" />
                <span class="unit">{{ pick(f, 'unit') }}</span>
                <small v-if="!draft[s.scene][f.key]" class="zero">= {{ zeroText(f.key) }}</small>
              </div>
              <small v-if="pick(f, 'help')" class="muted help-text">{{ pick(f, 'help') }}</small>
            </el-form-item>
          </div>
        </section>
      </el-form>
      <template #footer>
        <el-button @click="editorOpen = false">{{ t('common.cancel') }}</el-button>
        <el-button :loading="busy" @click="saveCustom(false)">{{ t('risk.pol.saveOnly') }}</el-button>
        <el-button type="primary" :loading="busy" @click="saveCustom(true)">{{ t('risk.pol.saveUse') }}</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Edit as IconEdit, QuestionFilled as IconQuestion } from '@element-plus/icons-vue';
import { api } from '../../core/api';
import { t, pick } from '../../core/i18n';
import { can } from '../../core/auth';
import ConfigForm from '../../components/ConfigForm.vue';
import { formatValue, levelName, levelType, loadPolicy, policy, PRESETS, strictness, zeroText } from './common';

const COLUMNS = [...PRESETS, 'custom'];
const p = computed(() => policy.data);
const view = ref('level');
const selected = ref('light');
loadPolicy(true).then(d => (selected.value = d.level));

function rulesOf(level) {
  if (!p.value) return {};
  return level === 'custom' ? p.value.custom : p.value.presets[level] || {};
}
function select(level) {
  selected.value = level;
  view.value = 'level';
}
function differs(scene, key) {
  return JSON.stringify(p.value.custom?.[scene]?.[key]) !== JSON.stringify(p.value.presets.light?.[scene]?.[key]);
}
const customDiffers = computed(() => p.value?.schema.some(s => s.fields.some(f => differs(s.scene, f.key))));
function isOff(f, v) {
  return f.type === 'captcha' ? v === 'off' : f.type === 'bool' ? !v : !v && f.key !== 'newAccountDay';
}
/** Shade 0–4 per column of one rule row, by rank of strictness among the distinct values. */
function shade(scene, f) {
  const scores = COLUMNS.map(l => strictness(f, rulesOf(l)[scene]?.[f.key], rulesOf(l)[scene]));
  const distinct = [...new Set(scores)].sort((a, b) => a - b);
  return scores.map(s => {
    if (s === 0) return 0;
    const nonZero = distinct.filter(x => x > 0);
    return nonZero.length <= 1 ? 3 : 1 + Math.round((nonZero.indexOf(s) / (nonZero.length - 1)) * 3);
  });
}

async function use(level) {
  await ElMessageBox.confirm(t('risk.pol.confirmUse', { level: levelName(level) }), { type: level === 'severe' || level === 'off' ? 'warning' : 'info' });
  await api.put('risk/policy', { level });
  ElMessage.success(t('risk.pol.switched', { level: levelName(level) }));
  await loadPolicy(true);
  selected.value = level;
}

const editorOpen = ref(false);
const editorBase = ref('light');
const draft = ref(null);
const busy = ref(false);
function openEditor(level) {
  editorBase.value = level;
  draft.value = JSON.parse(JSON.stringify(rulesOf(level)));
  editorOpen.value = true;
}
async function saveCustom(andUse) {
  if (andUse) await ElMessageBox.confirm(t('risk.pol.confirmCustom'), { type: 'warning' });
  busy.value = true;
  try {
    await api.put('risk/policy', { level: andUse ? 'custom' : p.value.level, custom: draft.value });
    ElMessage.success(andUse ? t('risk.pol.switched', { level: levelName('custom') }) : t('risk.pol.customSaved'));
    editorOpen.value = false;
    await loadPolicy(true);
    selected.value = 'custom';
    view.value = 'level';
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.levels { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; margin-bottom: 16px; }
.level-card {
  background: var(--el-bg-color); border-radius: 10px; padding: 12px 14px; cursor: pointer; display: flex; flex-direction: column; gap: 6px;
  border: 2px solid transparent; box-shadow: 0 1px 2px rgba(0, 0, 0, .04); border-top: 4px solid var(--lv);
}
.level-card:hover { box-shadow: 0 2px 10px rgba(0, 0, 0, .08); }
.level-card.selected { border-color: var(--lv); border-top-width: 4px; }
.level-card.current { background: color-mix(in srgb, var(--lv) 7%, var(--el-bg-color)); }
.lv-off { --lv: var(--el-color-info); }
.lv-light { --lv: var(--el-color-success); }
.lv-medium { --lv: #2f6fdb; }
.lv-heavy { --lv: var(--el-color-warning); }
.lv-severe { --lv: var(--el-color-danger); }
.lv-custom { --lv: #7b4bd6; }
.lc-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.desc { margin: 0; font-size: 13px; color: var(--el-text-color-regular); line-height: 1.5; flex: 1; }
.lc-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.panel-title .spacer { flex: 1; }
.mb { margin-bottom: 12px; }
.scenes { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 12px; }
.scene { border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 10px 12px; }
.scene h4, .ed-scene h4 { margin: 0 0 8px; font-size: 14px; display: flex; flex-direction: column; gap: 2px; }
.scene h4 small, .ed-scene h4 small, .section small { font-weight: normal; font-size: 12px; }
.rules { width: 100%; border-collapse: collapse; font-size: 13px; }
.rules td { padding: 5px 0; border-top: 1px dashed var(--el-border-color-lighter); vertical-align: top; }
.rules tr:first-child td { border-top: 0; }
.rules .lbl { color: var(--el-text-color-regular); padding-right: 12px; }
.rules .val { text-align: right; white-space: nowrap; font-weight: 500; }
.rules .val.off { color: var(--el-text-color-secondary); font-weight: normal; }
.rules tr.changed .val { color: #7b4bd6; }
.dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #7b4bd6; margin-left: 4px; vertical-align: middle; }
.help { color: var(--el-text-color-placeholder); vertical-align: -2px; cursor: help; }
.hint { margin: 0 0 10px; font-size: 13px; }
.cmp-wrap { overflow-x: auto; }
.cmp { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 860px; }
.cmp th, .cmp td { padding: 6px 8px; border-bottom: 1px solid var(--el-border-color-lighter); text-align: center; white-space: nowrap; }
.cmp th { vertical-align: top; font-weight: normal; }
.cmp th.lbl, .cmp td.lbl { text-align: left; white-space: normal; min-width: 220px; }
.cmp .when { font-size: 11px; color: var(--el-text-color-secondary); margin-top: 4px; white-space: normal; }
.cmp th.cur { background: var(--el-fill-color-light); }
.cmp td.cur { box-shadow: inset 2px 0 0 var(--el-color-primary), inset -2px 0 0 var(--el-color-primary); }
.cmp .scene-row td { text-align: left; background: var(--el-fill-color-lighter); }
.cmp .scene-row small { margin-left: 8px; }
.cmp td.s1 { background: rgba(200, 50, 61, .06); }
.cmp td.s2 { background: rgba(200, 50, 61, .13); }
.cmp td.s3 { background: rgba(200, 50, 61, .22); }
.cmp td.s4 { background: rgba(200, 50, 61, .34); }
.cmp td.bold { font-weight: 700; color: #7b4bd6; }
.section { font-size: 15px; font-weight: 600; margin: 8px 0 12px; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.ed-scene { margin-bottom: 18px; }
.ed-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 0 16px; }
.int { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.int .unit { min-width: 24px; }
.help-text { display: block; flex-basis: 100%; line-height: 1.4; margin-top: 2px; }
.zero { color: var(--el-color-warning); }
@media (max-width: 768px) { .scenes { grid-template-columns: 1fr; } }
</style>
