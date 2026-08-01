'use strict';

function normalizeSyntheticBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('SYNTHETIC_BASE_URL must be an absolute URL.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Synthetic health URL cannot contain credentials, query, or fragment.');
  }
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Synthetic health URL must use HTTPS except on loopback.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}

async function runSyntheticHealth({ baseUrl, fetchImpl = fetch, timeoutMs = 3_000 }) {
  const target = normalizeSyntheticBaseUrl(baseUrl);
  const checks = [
    ['/api/v1/health/live', 200, 'ok'],
    ['/api/v1/health/ready', 200, 'ready'],
  ];
  const results = [];
  for (const [pathname, expectedStatus, expectedState] of checks) {
    const response = await fetchImpl(new URL(pathname, target), {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.json();
    if (response.status !== expectedStatus || body.status !== expectedState) {
      throw new Error(`Synthetic health check failed for ${pathname}.`);
    }
    results.push(Object.freeze({ pathname, status: response.status }));
  }
  return Object.freeze(results);
}

module.exports = { normalizeSyntheticBaseUrl, runSyntheticHealth };
