// useList plus the whole last response (finance lists return totals next to the page: sumIn, sumCredited…).
import { ref } from 'vue';
import { api } from '../../core/api';
import { useList } from '../../core/list';

export function useFinList(path, filters, opts = {}) {
  const list = useList(path, filters, { ...opts, auto: false });
  const meta = ref({});
  let seq = 0;
  const load = async () => {
    const my = ++seq;
    list.loading.value = true;
    try {
      const res = await api.get(typeof path === 'function' ? path() : path, list.query());
      if (my !== seq) return;
      meta.value = res || {};
      list.items.value = res?.items || [];
      list.total.value = res?.total ?? list.items.value.length;
    } finally {
      if (my === seq) list.loading.value = false;
    }
  };
  const search = () => {
    list.page.value = 1;
    return load();
  };
  const reset = () => {
    for (const k of Object.keys(list.filters)) list.filters[k] = Array.isArray(filters[k]) ? [...filters[k]] : filters[k];
    return search();
  };
  const wrapped = { ...list, meta, load, search, reset };
  if (opts.auto !== false) load();
  return wrapped;
}
