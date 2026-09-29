import { createApp, watch } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import en from 'element-plus/es/locale/lang/en';
import * as Icons from '@element-plus/icons-vue';
import App from './App.vue';
import { router } from './core/router';
import { lang, setLang } from './core/i18n';
import { can } from './core/auth';
import { setUnauthorizedHandler } from './core/api';
import './core/messages';
import './styles.css';

const app = createApp(App);
for (const [name, comp] of Object.entries(Icons)) app.component('Icon' + name, comp);
app.use(router);
app.use(ElementPlus, { locale: lang.value === 'en' ? en : zhCn });
// v-can="'orders.refund'" removes the element when the admin lacks the permission.
app.directive('can', {
  mounted(el, binding) {
    const codes = Array.isArray(binding.value) ? binding.value : [binding.value];
    if (!codes.some(can)) el.remove();
  },
});
setLang(lang.value);
watch(lang, () => location.reload());
setUnauthorizedHandler(() => {
  if (router.currentRoute.value.path !== '/login') router.replace({ path: '/login', query: { next: router.currentRoute.value.fullPath } });
});
app.mount('#app');
