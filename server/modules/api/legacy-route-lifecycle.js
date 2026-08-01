'use strict';

const LEGACY_ROUTE_STATE = Object.freeze({
  COMPATIBILITY: 'compatibility',
  TOMBSTONE: 'tombstone',
});

function route({ finalOwner, modulePath, mount, replacement, state }) {
  return Object.freeze({ finalOwner, modulePath, mount, replacement, state });
}

const LEGACY_ROUTE_LIFECYCLE = Object.freeze([
  route({
    finalOwner: 'P0D-S6',
    modulePath: './routes/auth',
    mount: '/api/auth',
    replacement: '/api/v1/auth',
    state: LEGACY_ROUTE_STATE.TOMBSTONE,
  }),
  route({
    finalOwner: 'P1B',
    modulePath: './routes/code',
    mount: '/api/code',
    replacement: '/api/v1/executions',
    state: LEGACY_ROUTE_STATE.COMPATIBILITY,
  }),
  route({
    finalOwner: 'P1B',
    modulePath: './routes/ai',
    mount: '/api/ai',
    replacement: '/api/v1/learning-assistant',
    state: LEGACY_ROUTE_STATE.COMPATIBILITY,
  }),
  route({
    finalOwner: 'P1C',
    modulePath: './routes/youtube',
    mount: '/api/youtube',
    replacement: '/api/v1/videos',
    state: LEGACY_ROUTE_STATE.COMPATIBILITY,
  }),
  route({
    finalOwner: 'P1C',
    modulePath: './routes/roadmap',
    mount: '/api/roadmap',
    replacement: '/api/v1/learning-paths',
    state: LEGACY_ROUTE_STATE.COMPATIBILITY,
  }),
  route({
    finalOwner: 'P1C',
    modulePath: './routes/user',
    mount: '/api/user',
    replacement: '/api/v1/me',
    state: LEGACY_ROUTE_STATE.COMPATIBILITY,
  }),
  route({
    finalOwner: 'P1B',
    modulePath: './routes/challenges',
    mount: '/api/challenges',
    replacement: '/api/v1/challenges',
    state: LEGACY_ROUTE_STATE.COMPATIBILITY,
  }),
  route({
    finalOwner: 'P1C',
    modulePath: './routes/courses',
    mount: '/api/courses',
    replacement: '/api/v1/courses',
    state: LEGACY_ROUTE_STATE.COMPATIBILITY,
  }),
  route({
    finalOwner: 'P0B-S6',
    modulePath: './routes/admin',
    mount: '/api/admin',
    replacement: '/api/v1/admin',
    state: LEGACY_ROUTE_STATE.TOMBSTONE,
  }),
  route({
    finalOwner: 'P4C',
    modulePath: './routes/space',
    mount: '/api/space',
    replacement: '/api/v1/space',
    state: LEGACY_ROUTE_STATE.COMPATIBILITY,
  }),
]);

module.exports = { LEGACY_ROUTE_LIFECYCLE, LEGACY_ROUTE_STATE };
