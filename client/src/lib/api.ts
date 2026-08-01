import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';

import { resolveBackendUrl, runtimeConfig } from '../config/runtime';
import { clearAccessToken, getAccessToken, setAccessToken } from './auth-session';

export interface AuthenticatedUser {
  avatarUrl: string | null;
  displayName: string;
  email: string;
  emailVerified: boolean;
  id: string;
  platformRole: 'learner' | 'moderator' | 'superadmin' | 'support';
  status: 'active' | 'suspended' | 'banned' | 'deletion_pending';
  username: string | null;
}

export interface AuthenticationResult {
  accessToken: string;
  session: Record<string, unknown>;
  user: AuthenticatedUser;
}

interface RetriableRequest extends InternalAxiosRequestConfig {
  _codeWithMeeRefreshAttempted?: boolean;
}

export function apiProblemCode(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;
  const data = error.response?.data;
  if (!data || typeof data !== 'object') return null;
  if ('code' in data && typeof data.code === 'string') return data.code;
  if ('error' in data && data.error && typeof data.error === 'object' && 'code' in data.error) {
    return typeof data.error.code === 'string' ? data.error.code : null;
  }
  return null;
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${encodeURIComponent(name)}=`;
  for (const item of document.cookie.split(';')) {
    const value = item.trim();
    if (value.startsWith(prefix)) return decodeURIComponent(value.slice(prefix.length));
  }
  return null;
}

function isUnsafeMethod(method?: string): boolean {
  return ['delete', 'patch', 'post', 'put'].includes(String(method || 'get').toLowerCase());
}

function isIdentityExchange(url?: string): boolean {
  return /^\/api\/v1\/auth\/(?:login|register|refresh|password\/|email\/verify\/confirm)/.test(
    String(url || ''),
  );
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: runtimeConfig.apiBaseUrl || undefined,
  withCredentials: true,
  headers: {
    Accept: 'application/json, application/problem+json',
  },
  timeout: runtimeConfig.apiTimeoutMs,
});

const refreshClient = axios.create({
  baseURL: runtimeConfig.apiBaseUrl || undefined,
  headers: { Accept: 'application/json, application/problem+json' },
  timeout: runtimeConfig.apiTimeoutMs,
  withCredentials: true,
});

let refreshPromise: Promise<AuthenticationResult> | null = null;

export async function refreshAuthentication(): Promise<AuthenticationResult> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const csrfToken = readCookie('cwm_csrf');
      const response = await refreshClient.post<AuthenticationResult>(
        '/api/v1/auth/refresh',
        undefined,
        { headers: csrfToken ? { 'x-csrf-token': csrfToken } : undefined },
      );
      setAccessToken(response.data.accessToken);
      return response.data;
    })()
      .catch((error: unknown) => {
        clearAccessToken();
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

apiClient.interceptors.request.use((config) => {
  const accessToken = getAccessToken();
  if (accessToken && !config.headers.has('Authorization')) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }
  if (isUnsafeMethod(config.method) && !config.headers.has('x-csrf-token')) {
    const csrfToken = readCookie('cwm_csrf');
    if (csrfToken) config.headers.set('x-csrf-token', csrfToken);
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const request = error.config as RetriableRequest | undefined;
    if (
      error.response?.status !== 401 ||
      !request ||
      request._codeWithMeeRefreshAttempted ||
      isIdentityExchange(request.url)
    ) {
      throw error;
    }
    request._codeWithMeeRefreshAttempted = true;
    await refreshAuthentication();
    const accessToken = getAccessToken();
    if (accessToken) request.headers.set('Authorization', `Bearer ${accessToken}`);
    return apiClient.request(request);
  },
);

export const assetUrl = resolveBackendUrl;

export default apiClient;
