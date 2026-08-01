export const SUPPORTED_NODE_MAJOR = 24;
export const SUPPORTED_NPM_MAJOR = 11;

/**
 * @param {string} version
 * @returns {number | null}
 */
export function parseMajor(version) {
  const match = String(version)
    .trim()
    .match(/^v?(\d+)(?:\.|$)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

/**
 * @param {{ nodeVersion: string, npmUserAgent?: string }} runtime
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateRuntime({ nodeVersion, npmUserAgent = '' }) {
  const errors = [];
  const warnings = [];
  const nodeMajor = parseMajor(nodeVersion);

  if (nodeMajor !== SUPPORTED_NODE_MAJOR) {
    errors.push(
      `Node ${SUPPORTED_NODE_MAJOR}.x is required; received ${nodeVersion || 'an unknown version'}.`,
    );
  }

  if (npmUserAgent) {
    const npmToken = npmUserAgent.split(' ').find((token) => token.startsWith('npm/'));
    const npmMajor = npmToken ? parseMajor(npmToken.slice('npm/'.length)) : null;

    if (npmMajor !== SUPPORTED_NPM_MAJOR) {
      errors.push(
        `npm ${SUPPORTED_NPM_MAJOR}.x is required; received ${npmToken ?? 'an unknown npm version'}.`,
      );
    }
  } else {
    warnings.push('npm version could not be inferred because npm_config_user_agent is not set.');
  }

  return { errors, warnings };
}
