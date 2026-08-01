const DEFAULT_PORT = 5001;
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PISTON_API_URL = 'http://127.0.0.1:2000/api/v2/execute';
const DEFAULT_DNS_SERVERS = ['8.8.8.8', '1.1.1.1'];

function parsePort(rawValue, nodeEnv) {
  if (rawValue === undefined || rawValue === '') return DEFAULT_PORT;
  const value = Number(rawValue);
  const minimum = nodeEnv === 'test' ? 0 : 1;
  if (!Number.isInteger(value) || value < minimum || value > 65535) {
    throw new Error(`PORT must be an integer between ${minimum} and 65535.`);
  }
  return value;
}

function parseHttpUrl(name, rawValue, fallback) {
  const value = rawValue?.trim() || fallback;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must use HTTP or HTTPS.`);
  }
  if (url.username || url.password) {
    throw new Error(`${name} must not contain embedded credentials.`);
  }
  return url.toString();
}

function parseOrigins(rawValue) {
  if (!rawValue?.trim()) return [];
  return rawValue.split(',').map((entry) => {
    const value = entry.trim();
    const url = new URL(value);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.origin !== value.replace(/\/$/, '')
    ) {
      throw new Error('CORS_ALLOWED_ORIGINS entries must be HTTP(S) origins without paths.');
    }
    return url.origin;
  });
}

function parseDnsServers(rawValue) {
  if (rawValue === undefined) return [...DEFAULT_DNS_SERVERS];
  return rawValue
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseBoolean(name, rawValue, fallback = false) {
  if (rawValue === undefined || rawValue === '') return fallback;
  if (rawValue === 'true') return true;
  if (rawValue === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

function parseTrustedProxies(rawValue) {
  if (!rawValue?.trim()) return [];
  const entries = rawValue
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length > 50 || entries.length !== new Set(entries).size) {
    throw new Error('TRUSTED_PROXY_CIDRS must contain at most 50 unique entries.');
  }
  for (const entry of entries) {
    const separator = entry.lastIndexOf('/');
    const address = separator === -1 ? entry : entry.slice(0, separator);
    const version = isIP(address);
    if (!version) throw new Error('TRUSTED_PROXY_CIDRS entries must be IP addresses or CIDRs.');
    if (separator !== -1) {
      const prefix = Number(entry.slice(separator + 1));
      const maximum = version === 4 ? 32 : 128;
      if (!Number.isInteger(prefix) || prefix < 1 || prefix > maximum) {
        throw new Error('TRUSTED_PROXY_CIDRS cannot contain a wildcard or invalid prefix.');
      }
    }
  }
  return entries;
}

function parsePostgresUrl(rawValue) {
  if (!rawValue?.trim()) return '';
  let url;
  try {
    url = new URL(rawValue.trim());
  } catch {
    throw new Error('DATABASE_URL must be an absolute PostgreSQL URL.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.pathname ||
    url.pathname === '/'
  ) {
    throw new Error('DATABASE_URL must name a PostgreSQL database.');
  }
  return rawValue.trim();
}

function loadRuntimeConfig(environment = process.env) {
  const nodeEnv = environment.NODE_ENV?.trim() || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production.');
  }
  const localUploadServing = parseBoolean(
    'LOCAL_UPLOAD_SERVING',
    environment.LOCAL_UPLOAD_SERVING,
    nodeEnv !== 'production',
  );
  if (nodeEnv === 'production' && localUploadServing) {
    throw new Error('LOCAL_UPLOAD_SERVING cannot be enabled in production.');
  }
  return Object.freeze({
    corsAllowedOrigins: Object.freeze(parseOrigins(environment.CORS_ALLOWED_ORIGINS)),
    databaseUrl: parsePostgresUrl(environment.DATABASE_URL),
    dnsServers: Object.freeze(parseDnsServers(environment.DNS_SERVERS)),
    host: environment.HOST?.trim() || DEFAULT_HOST,
    localUploadServing,
    mongoUri: environment.MONGO_URI?.trim() || '',
    nodeEnv,
    pistonApiUrl: parseHttpUrl(
      'PISTON_API_URL',
      environment.PISTON_API_URL,
      DEFAULT_PISTON_API_URL,
    ),
    port: parsePort(environment.PORT, nodeEnv),
    trustedProxies: Object.freeze(parseTrustedProxies(environment.TRUSTED_PROXY_CIDRS)),
  });
}

let cachedRuntimeConfig;

function getRuntimeConfig() {
  cachedRuntimeConfig ??= loadRuntimeConfig();
  return cachedRuntimeConfig;
}

function resetRuntimeConfigForTests() {
  cachedRuntimeConfig = undefined;
}

module.exports = {
  getRuntimeConfig,
  loadRuntimeConfig,
  parseTrustedProxies,
  resetRuntimeConfigForTests,
};
const { isIP } = require('node:net');
