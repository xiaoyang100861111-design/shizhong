// List-page state: filters + paging + loading, for endpoints returning { items, total, page, size }.
//   const list = useList('users', { q: '', status: null }, { size: 20 });
//   list.load(); list.search(); list.reset(); list.exportCsv('users/export', 'users.csv')
import { reactive, ref } from 'vue';
import { api } from './api';

export function useList(path, initialFilters = {}, { size = 20, auto = true, transform } = {}) {
  const filters = reactive({ ...initialFilters });
  const items = ref([]);
  const total = ref(0);
  const page = ref(1);
  const pageSize = ref(size);
  const loading = ref(false);
  let seq = 0;

  function query() {
    const q = { page: page.value, size: pageSize.value };
    for (const [k, v] of Object.entries(filters)) {
      if (Array.isArray(v) && v.length === 2 && (k === 'range' || k.endsWith('Range'))) {
        // date range [from, to] (Date objects or ms) → from / to epoch ms; "to" includes the whole day
        const [a, b] = v;
        if (a) q[k === 'range' ? 'from' : k.replace(/Range$/, 'From')] = +new Date(a);
        if (b) q[k === 'range' ? 'to' : k.replace(/Range$/, 'To')] = +new Date(b) + 86400000;
      } else if (v !== '' && v !== null && v !== undefined) q[k] = v;
    }
    return q;
  }

  async function load() {
    const my = ++seq;
    loading.value = true;
    try {
      const res = await api.get(typeof path === 'function' ? path() : path, query());
      if (my !== seq) return;
      const list = Array.isArray(res) ? res : res.items || [];
      items.value = transform ? list.map(transform) : list;
      total.value = Array.isArray(res) ? list.length : res.total ?? list.length;
    } finally {
      if (my === seq) loading.value = false;
    }
  }
  function search() {
    page.value = 1;
    return load();
  }
  function reset() {
    for (const k of Object.keys(filters)) filters[k] = Array.isArray(initialFilters[k]) ? [...initialFilters[k]] : initialFilters[k];
    return search();
  }
  function exportCsv(exportPath, filename) {
    const q = query();
    delete q.page;
    delete q.size;
    return api.download(exportPath, q, filename);
  }
  if (auto) load();
  return { filters, items, total, page, pageSize, loading, load, search, reset, exportCsv, query };
}
