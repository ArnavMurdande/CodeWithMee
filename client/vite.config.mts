import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

import { sourceJavaScriptAsJsx } from './config/sourceJavaScriptAsJsx.ts';

function monacoLocalPlugin() {
  const vsDir = path.resolve(import.meta.dirname, 'node_modules/monaco-editor/min/vs');
  const handleMonacoRequest = (req: any, res: any, next: any) => {
    const urlPath = req.url.split('?')[0];
    const filePath = path.join(vsDir, urlPath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      if (urlPath.endsWith('loader.js')) {
        let content = fs.readFileSync(filePath, 'utf8');
        content = content.replace('const _amdLoaderGlobal =', 'var _amdLoaderGlobal =');
        res.setHeader('Content-Type', 'application/javascript');
        return res.end(content);
      }
      const ext = path.extname(filePath);
      if (ext === '.js') res.setHeader('Content-Type', 'application/javascript');
      else if (ext === '.css') res.setHeader('Content-Type', 'text/css');
      else if (ext === '.ttf') res.setHeader('Content-Type', 'font/ttf');
      return fs.createReadStream(filePath).pipe(res);
    }
    next();
  };

  return {
    name: 'monaco-local-plugin',
    configureServer(server: any) {
      server.middlewares.use('/monaco-vs', handleMonacoRequest);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use('/monaco-vs', handleMonacoRequest);
    },
  };
}

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
    optimizeDeps: {
      entries: ['index.html'],
      exclude: ['@monaco-editor/react'],
      rolldownOptions: {
        moduleTypes: {
          '.js': 'jsx',
        },
      },
    },
    plugins: [monacoLocalPlugin(), sourceJavaScriptAsJsx(), react({ include: /\.[jt]sx?$/ })],
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
