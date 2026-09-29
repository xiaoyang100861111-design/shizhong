import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

// Built into admin/dist and served by the API at /admin (see server Site.cs).
// `npm run dev` proxies /api and /hubs to the API on :5080.
export default defineConfig({
  base: '/admin/',
  // absolute URLs (e.g. /assets/… from the app) are served by the API, not bundled
  plugins: [vue({ template: { transformAssetUrls: { includeAbsolute: false } } })],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:5080',
      '/hubs': { target: 'http://127.0.0.1:5080', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: id => {
          if (id.includes('node_modules/echarts') || id.includes('node_modules/zrender')) return 'echarts';
          if (id.includes('node_modules/element-plus')) return 'element';
        },
      },
    },
  },
});
