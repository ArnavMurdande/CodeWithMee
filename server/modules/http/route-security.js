'use strict';

const express = require('express');

const { operations } = require('../api/operations');

const BODY_LIMIT = Object.freeze({
  DEFAULT: 64 * 1024,
  EXPENSIVE_LEGACY: 256 * 1024,
  NO_BODY: 8 * 1024,
  V1_JSON: 32 * 1024,
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const operationMatchers = operations.map((operation) => {
  const pattern = operation.path
    .split('/')
    .map((segment) => (/^\{[^}]+\}$/.test(segment) ? '[^/]+' : escapeRegex(segment)))
    .join('/');
  return Object.freeze({ operation, pattern: new RegExp(`^${pattern}/?$`) });
});

function operationProfile(method, path) {
  const match = operationMatchers.find(
    (candidate) =>
      candidate.operation.method === method.toLowerCase() && candidate.pattern.test(path),
  );
  if (!match) return null;
  const operation = match.operation;
  let rateClass = operation.method === 'get' ? 'read' : 'write';
  if (operation.path.startsWith('/auth/')) rateClass = 'authentication';
  if (operation.tags.includes('Administration')) rateClass = 'administration';
  if (operation.id === 'createFileUploadIntent') rateClass = 'upload';
  return Object.freeze({
    bodyLimitBytes: operation.acceptsBody ? BODY_LIMIT.V1_JSON : BODY_LIMIT.NO_BODY,
    operationId: operation.id,
    rateClass,
  });
}

function legacyProfile(method, path) {
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
  if (path.startsWith('/api/v1/')) {
    return Object.freeze({
      bodyLimitBytes: unsafe ? BODY_LIMIT.V1_JSON : BODY_LIMIT.NO_BODY,
      operationId: 'v1_unmatched',
      rateClass: unsafe ? 'write' : 'read',
    });
  }
  if (path.startsWith('/api/code') || /\/api\/challenges\/[^/]+\/(?:run|submit)/.test(path)) {
    return Object.freeze({
      bodyLimitBytes: BODY_LIMIT.EXPENSIVE_LEGACY,
      operationId: 'legacy_execution',
      rateClass: 'execution',
    });
  }
  if (
    path.startsWith('/api/ai') ||
    path.startsWith('/api/youtube') ||
    path.startsWith('/api/roadmap')
  ) {
    return Object.freeze({
      bodyLimitBytes: BODY_LIMIT.EXPENSIVE_LEGACY,
      operationId: 'legacy_external',
      rateClass: 'external',
    });
  }
  return Object.freeze({
    bodyLimitBytes: unsafe ? BODY_LIMIT.DEFAULT : BODY_LIMIT.NO_BODY,
    operationId: 'legacy_compatibility',
    rateClass: unsafe ? 'write' : 'read',
  });
}

function requestSecurityProfile(method, path) {
  const versionedPath = path.startsWith('/api/v1') ? path.slice('/api/v1'.length) || '/' : path;
  return operationProfile(method, versionedPath) || legacyProfile(method, path);
}

function createJsonBodyParser() {
  const parsers = new Map();
  return function boundedJsonBodyParser(request, response, next) {
    const profile = requestSecurityProfile(request.method, request.path);
    request.securityProfile = profile;
    const contentLength = Number(request.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > profile.bodyLimitBytes) {
      const error = new Error('Request body exceeds the route limit.');
      error.type = 'entity.too.large';
      return next(error);
    }
    let parser = parsers.get(profile.bodyLimitBytes);
    if (!parser) {
      parser = express.json({
        inflate: false,
        limit: profile.bodyLimitBytes,
        strict: true,
        type: ['application/json', 'application/*+json'],
      });
      parsers.set(profile.bodyLimitBytes, parser);
    }
    return parser(request, response, next);
  };
}

module.exports = {
  BODY_LIMIT,
  createJsonBodyParser,
  operationProfile,
  requestSecurityProfile,
};
