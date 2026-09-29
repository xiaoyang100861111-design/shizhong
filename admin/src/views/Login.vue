<template>
  <div class="login">
    <div class="card">
      <div class="brand">
        <img src="/assets/optimized/logo.webp" alt="" />
        <div>
          <h1>{{ t('app.name') }}</h1>
          <p>{{ t('login.welcome') }}</p>
        </div>
      </div>
      <el-form :model="form" size="large" @submit.prevent="submit">
        <el-form-item>
          <el-input v-model="form.username" :placeholder="t('login.username')" autocomplete="username" autofocus>
            <template #prefix><el-icon><IconUser /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-form-item>
          <el-input v-model="form.password" type="password" show-password :placeholder="t('login.password')" autocomplete="current-password">
            <template #prefix><el-icon><IconLock /></el-icon></template>
          </el-input>
        </el-form-item>
        <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="err" />
        <el-button type="primary" native-type="submit" :loading="busy" class="submit" :disabled="!form.username || !form.password">
          {{ t('login.submit') }}
        </el-button>
      </el-form>
      <p class="hint">{{ t('login.hint') }}</p>
      <div class="lang"><el-button text size="small" @click="setLang(lang === 'en' ? 'zh' : 'en')">{{ t('layout.lang') }}</el-button></div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { login } from '../core/auth';
import { errorText } from '../core/api';
import { t, lang, setLang } from '../core/i18n';

const router = useRouter();
const route = useRoute();
const form = reactive({ username: '', password: '' });
const busy = ref(false);
const error = ref('');

async function submit() {
  busy.value = true;
  error.value = '';
  try {
    await login(form.username.trim(), form.password);
    router.replace(typeof route.query.next === 'string' ? route.query.next : '/');
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.login { min-height: 100vh; display: grid; place-items: center; padding: 16px;
  background: radial-gradient(1200px 600px at 10% -10%, #f9d9dc 0, transparent 60%), radial-gradient(900px 500px at 110% 110%, #f3e6d5 0, transparent 60%), var(--sz-bg); }
html.dark .login { background: var(--sz-bg); }
.card { width: 100%; max-width: 380px; background: var(--el-bg-color); border-radius: 16px; padding: 28px 28px 16px; box-shadow: 0 10px 40px rgba(0,0,0,.08); }
.brand { display: flex; gap: 14px; align-items: center; margin-bottom: 24px; }
.brand img { width: 52px; height: 52px; border-radius: 12px; }
.brand h1 { font-size: 20px; margin: 0; }
.brand p { margin: 4px 0 0; color: var(--el-text-color-secondary); }
.submit { width: 100%; }
.err { margin-bottom: 14px; }
.hint { color: var(--el-text-color-secondary); font-size: 12px; margin: 16px 0 0; text-align: center; }
.lang { text-align: center; margin-top: 4px; }
</style>
