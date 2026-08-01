import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

import { sourceJavaScriptAsJsx } from './config/sourceJavaScriptAsJsx.ts';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  const developmentProxyTarget = environment.VITE_DEV_API_PROXY_TARGET ?? 'http://127.0.0.1:5001';

  return {
    base: '/',
    build: {
      emptyOutDir: true,
      manifest: true,
      outDir: 'dist',
      sourcemap: false,
    },
    plugins: [sourceJavaScriptAsJsx(), react({ include: /\.[jt]sx?$/ })],
    preview: {
      host: '127.0.0.1',
      port: 4173,
    },
    server: {
      host: '127.0.0.1',
      port: 3000,
      proxy: {
        '/api': developmentProxyTarget,
        '/uploads': developmentProxyTarget,
      },
    },
  };
});
