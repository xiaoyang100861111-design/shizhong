<template>
  <div class="page">
    <div class="page-head"><h1>{{ t('content.profiles') }}</h1></div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('content.q')" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-select v-model="list.filters.kind" @change="list.search">
          <el-option value="" :label="t('content.member')" /><el-option value="persona" :label="t('content.persona')" />
        </el-select>
        <el-checkbox v-model="list.filters.withAvatar" @change="list.search">{{ t('content.profile.withAvatar') }}</el-checkbox>
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
      </div>
      <div v-loading="list.loading.value" class="profile-grid">
        <div v-for="u in list.items.value" :key="u.id" class="profile-card">
          <el-image :src="assetUrl(u.avatar || 'ui/avatar-default.svg')" fit="cover" class="profile-photo" :preview-src-list="u.avatar ? [assetUrl(u.avatar)] : []" preview-teleported />
          <div class="profile-meta">
            <router-link v-if="!u.persona" :to="'/users/' + u.id"><b>{{ u.name }}</b></router-link><b v-else>{{ u.name }}</b>
            <small class="muted num">ID {{ u.displayId }}</small>
            <p class="profile-bio">{{ u.bio || '—' }}</p>
          </div>
          <el-dropdown v-if="can('content.edit')" trigger="click" @command="cmd => reset(u, cmd)">
            <el-button size="small">{{ t('content.profile.reset') }}</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="avatar">{{ t('content.profile.resetAvatar') }}</el-dropdown-item>
                <el-dropdown-item command="name">{{ t('content.profile.resetName') }}</el-dropdown-item>
                <el-dropdown-item command="bio">{{ t('content.profile.resetBio') }}</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
      <Pager :list="list" />
    </div>
  </div>
</template>

<script setup>
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, assetUrl } from '../../core/api';
import { t } from '../../core/i18n';
import { can } from '../../core/auth';
import { useList } from '../../core/list';
import Pager from '../../components/Pager.vue';

const list = useList('content/profiles', { q: '', kind: '', withAvatar: false }, { size: 24 });
async function reset(u, what) {
  const { value } = await ElMessageBox.prompt(t('content.reason'), t('content.profile.confirm'), { type: 'warning', inputValue: '' });
  await api.post(`content/profiles/${u.id}/reset`, { avatar: what === 'avatar', name: what === 'name', bio: what === 'bio', reason: value || '' });
  ElMessage.success(t('common.done'));
  list.load();
}
</script>

<style scoped>
.profile-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; min-height: 120px; }
.profile-card { display: flex; gap: 10px; align-items: flex-start; padding: 10px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; }
.profile-photo { width: 64px; height: 64px; border-radius: 8px; flex: none; }
.profile-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.profile-bio { margin: 4px 0 0; font-size: 12px; color: var(--el-text-color-secondary); max-height: 3.2em; overflow: hidden; }
</style>
