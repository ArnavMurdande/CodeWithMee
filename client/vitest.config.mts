import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import { sourceJavaScriptAsJsx } from './config/sourceJavaScriptAsJsx.ts';

export default defineConfig({
  plugins: [sourceJavaScriptAsJsx(), react({ include: /\.[jt]sx?$/ })],
  test: {
    clearMocks: true,
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        pretendToBeVisual: true,
        url: 'https://codewithmee.test/',
      },
    },
    include: ['src/**/*.test.js'],
    restoreMocks: true,
    setupFiles: ['./src/test/setup.js'],
    unstubGlobals: true,
  },
});
