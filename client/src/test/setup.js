import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

import { createMatchMediaFactory } from './factories';

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: createMatchMediaFactory(),
    writable: true,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Unmocked network access is forbidden in client tests.');
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
