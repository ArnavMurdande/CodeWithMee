export interface RuntimeEnvironmentInput {
  apiBaseUrl?: string;
  apiTimeoutMs?: string;
}

export interface RuntimeConfig {
  apiBaseUrl: string;
  apiTimeoutMs: number;
}

interface ViteRuntimeEnvironment {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_API_TIMEOUT_MS?: string;
}

const DEFAULT_API_TIMEOUT_MS = 20_000;
const MIN_API_TIMEOUT_MS = 1_000;
const MAX_API_TIMEOUT_MS = 120_000;

function normalizeApiBaseUrl(rawValue: string | undefined): string {
  const value = rawValue?.trim() ?? '';
  if (!value) {
    return '';
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      'API base URL must be an absolute HTTP(S) origin or empty for same-origin mode.',
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('API base URL must use HTTP or HTTPS.');
  }

  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error(
      'API base URL must be an origin without credentials, a path, query, or fragment.',
    );
  }

  return url.origin;
}

function parseApiTimeout(rawValue: string | undefined): number {
  if (!rawValue?.trim()) {
    return DEFAULT_API_TIMEOUT_MS;
  }

  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < MIN_API_TIMEOUT_MS || value > MAX_API_TIMEOUT_MS) {
    throw new Error(
      `API timeout must be an integer between ${MIN_API_TIMEOUT_MS} and ${MAX_API_TIMEOUT_MS} milliseconds.`,
    );
  }

  return value;
}

export function createRuntimeConfig(input: RuntimeEnvironmentInput): Readonly<RuntimeConfig> {
  return Object.freeze({
    apiBaseUrl: normalizeApiBaseUrl(input.apiBaseUrl),
    apiTimeoutMs: parseApiTimeout(input.apiTimeoutMs),
  });
}

export function resolveBackendUrl(
  rawValue: string | null | undefined,
  apiBaseUrl = runtimeConfig.apiBaseUrl,
): string {
  const value = rawValue?.trim() ?? '';
  if (!value) {
    return '';
  }

  if (/^(?:https?:|blob:|data:)/i.test(value)) {
    return value;
  }

  const normalizedPath = value.startsWith('/') ? value : `/${value}`;
  return apiBaseUrl ? `${apiBaseUrl}${normalizedPath}` : normalizedPath;
}

const buildEnvironment =
  (import.meta as ImportMeta & { readonly env?: ViteRuntimeEnvironment }).env ?? {};

export const runtimeConfig = createRuntimeConfig({
  apiBaseUrl: buildEnvironment.VITE_API_BASE_URL,
  apiTimeoutMs: buildEnvironment.VITE_API_TIMEOUT_MS,
});
