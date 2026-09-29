<template>
  <el-container class="shell">
    <el-aside :width="collapsed ? '64px' : '220px'" class="aside" :class="{ mobileOpen }">
      <div class="brand" @click="$router.push('/')">
        <img src="/assets/optimized/logo.jpg" alt="" />
        <span v-if="!collapsed">{{ t('app.name') }}</span>
      </div>
      <el-scrollbar>
        <el-menu :default-active="activeMenu" :collapse="collapsed" router background-color="transparent"
          text-color="var(--sz-sidebar-text)" active-text-color="#fff" class="menu" @select="mobileOpen = false">
          <template v-for="m in menus" :key="m.key">
            <el-menu-item v-if="m.items.length === 1" :index="m.items[0].path">
              <el-icon><component :is="'Icon' + m.icon" /></el-icon>
              <template #title>{{ pick(m.title, 'zh') }}</template>
            </el-menu-item>
            <el-sub-menu v-else :index="m.key">
              <template #title>
                <el-icon><component :is="'Icon' + m.icon" /></el-icon>
                <span>{{ pick(m.title, 'zh') }}</span>
              </template>
              <el-menu-item v-for="i in m.items" :key="i.path" :index="i.path">{{ pick(i.title, 'zh') }}</el-menu-item>
            </el-sub-menu>
          </template>
        </el-menu>
      </el-scrollbar>
    </el-aside>
    <div v-if="mobileOpen" class="scrim" @click="mobileOpen = false" />
    <el-container direction="vertical" class="main">
      <el-header class="header">
        <el-button text circle class="toggle" @click="toggleMenu">
          <el-icon :size="18"><IconFold v-if="!collapsed" /><IconExpand v-else /></el-icon>
        </el-button>
        <el-breadcrumb separator="/" class="crumbs">
          <el-breadcrumb-item v-if="current?.module">{{ pick(current.module.title, 'zh') }}</el-breadcrumb-item>
          <el-breadcrumb-item v-if="current?.title">{{ pick(current.title, 'zh') }}</el-breadcrumb-item>
        </el-breadcrumb>
        <div class="spacer" />
        <el-tag v-if="session.me && session.me.scope !== 'all'" type="warning" effect="plain" class="scope-tag">
          {{ t('layout.scope.' + session.me.scope) }}
        </el-tag>
        <el-tooltip :content="t('layout.theme')">
          <el-switch v-model="dark" inline-prompt active-text="🌙" inactive-text="☀" @change="applyDark" />
        </el-tooltip>
        <el-button text @click="setLang(lang === 'en' ? 'zh' : 'en')">{{ t('layout.lang') }}</el-button>
        <el-button text tag="a" href="/" target="_blank">{{ t('layout.openApp') }}</el-button>
        <el-dropdown trigger="click" @command="onCommand">
          <span class="who">
            <el-avatar :size="28">{{ (session.me?.name || '?').slice(0, 1) }}</el-avatar>
            <span class="who-text">
              <b>{{ session.me?.name }}</b>
              <small>{{ session.me?.role?.name }}</small>
            </span>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="password">{{ t('layout.password') }}</el-dropdown-item>
              <el-dropdown-item command="logout" divided>{{ t('layout.logout') }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </el-header>
      <el-main class="content">
        <router-view v-slot="{ Component, route }">
          <component :is="Component" :key="route.fullPath" />
        </router-view>
      </el-main>
    </el-container>
    <PasswordDialog v-model="pwdOpen" />
  </el-container>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { modules } from '../core/modules';
import { session, can, logout } from '../core/auth';
import { t, pick, lang, setLang } from '../core/i18n';
import PasswordDialog from '../components/PasswordDialog.vue';

const route = useRoute();
const router = useRouter();
const collapsed = ref(localStorage.getItem('sz-admin-collapsed') === '1');
const mobileOpen = ref(false);
const pwdOpen = ref(false);
const dark = ref(localStorage.getItem('sz-admin-dark') === '1');
applyDark(dark.value);

function applyDark(v) {
  document.documentElement.classList.toggle('dark', !!v);
  localStorage.setItem('sz-admin-dark', v ? '1' : '0');
}
function toggleMenu() {
  if (window.innerWidth < 768) mobileOpen.value = !mobileOpen.value;
  else {
    collapsed.value = !collapsed.value;
    localStorage.setItem('sz-admin-collapsed', collapsed.value ? '1' : '0');
  }
}

const menus = computed(() => {
  const allowed = new Set(session.me?.menus || []);
  return modules
    .filter(m => m.menu === null || allowed.has(m.menu))
    .map(m => ({
      key: (m.menu || '') + ':' + (m.title?.en || m.title?.zh || ''),
      icon: m.icon || 'Menu',
      title: m.title,
      items: (m.routes || []).filter(r => r.menu && can(r.meta?.perm)).map(r => ({ path: r.path, title: r.meta?.title || m.title })),
    }))
    .filter(m => m.items.length);
});

const current = computed(() => {
  const matched = route.matched[route.matched.length - 1];
  return matched ? { title: matched.meta?.title, module: matched.meta?.module } : null;
});
const activeMenu = computed(() => {
  // detail pages highlight their list entry (longest menu path that prefixes the current path)
  const paths = menus.value.flatMap(m => m.items.map(i => i.path));
  return paths.filter(p => route.path === p || route.path.startsWith(p + '/')).sort((a, b) => b.length - a.length)[0] || route.path;
});

async function onCommand(cmd) {
  if (cmd === 'password') pwdOpen.value = true;
  if (cmd === 'logout') {
    await logout();
    router.replace('/login');
  }
}
</script>

<style scoped>
.shell { height: 100vh; }
.aside { background: var(--sz-sidebar); transition: width .2s; overflow: hidden; display: flex; flex-direction: column; }
.brand { display: flex; align-items: center; gap: 10px; height: 56px; padding: 0 16px; color: #fff; font-weight: 600; cursor: pointer; white-space: nowrap; flex: none; }
.brand img { width: 30px; height: 30px; border-radius: 8px; }
.menu { border-right: none; }
.menu :deep(.el-menu-item.is-active) { background: var(--el-color-primary) !important; border-radius: 8px; }
.menu :deep(.el-menu-item), .menu :deep(.el-sub-menu__title) { margin: 2px 8px; border-radius: 8px; height: 44px; }
.menu :deep(.el-menu-item:hover), .menu :deep(.el-sub-menu__title:hover) { background: rgba(255,255,255,.07) !important; }
.main { min-width: 0; }
.header { display: flex; align-items: center; gap: 8px; background: var(--el-bg-color); border-bottom: 1px solid var(--el-border-color-lighter); height: 56px; padding: 0 12px; }
.spacer { flex: 1; }
.crumbs { margin-left: 4px; }
.who { display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 4px 6px; border-radius: 8px; }
.who:hover { background: var(--el-fill-color-light); }
.who-text { display: flex; flex-direction: column; line-height: 1.2; }
.who-text small { color: var(--el-text-color-secondary); font-size: 12px; }
.content { padding: 0; background: var(--sz-bg); }
.scope-tag { margin-right: 4px; }
.scrim { display: none; }
@media (max-width: 768px) {
  .aside { position: fixed; z-index: 2000; left: 0; top: 0; bottom: 0; width: 240px !important; transform: translateX(-100%); transition: transform .2s; }
  .aside.mobileOpen { transform: none; }
  .scrim { display: block; position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 1999; }
  .crumbs, .who-text, .scope-tag { display: none; }
}
</style>
