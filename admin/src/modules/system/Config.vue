<template>
  <div class="page cfg-page">
    <div class="page-head">
      <h1>{{ t('sys.config') }}</h1>
      <div class="spacer" />
      <el-input v-model="filter" :placeholder="t('cfg.search')" clearable style="width: 260px">
        <template #prefix><el-icon><IconSearch /></el-icon></template>
      </el-input>
    </div>
    <p class="page-sub">{{ t('sys.configSub') }}</p>
    <div class="layout">
      <nav class="toc panel">
        <a v-for="g in groups" :key="g.group" :href="'#cfg-' + g.group" @click.prevent="jump(g.group)">{{ pick(g.head) }}</a>
      </nav>
      <div class="body">
        <ConfigForm :filter="filter" @loaded="groups = $event" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { t, pick } from '../../core/i18n';
import ConfigForm from '../../components/ConfigForm.vue';

const filter = ref('');
const groups = ref([]);
function jump(g) {
  document.getElementById('cfg-' + g)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
</script>

<style scoped>
.layout { display: grid; grid-template-columns: 200px 1fr; gap: 16px; align-items: start; }
.toc { position: sticky; top: 12px; display: flex; flex-direction: column; gap: 2px; max-height: calc(100vh - 120px); overflow: auto; padding: 10px; }
.toc a { padding: 6px 10px; border-radius: 6px; color: var(--el-text-color-regular); text-decoration: none; font-size: 13px; }
.toc a:hover { background: var(--el-fill-color-light); color: var(--el-color-primary); }
.body { min-width: 0; }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } .toc { display: none; } }
</style>
