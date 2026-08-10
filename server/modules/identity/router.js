'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const { operationContract } = require('../api/middleware');
const { IdentityError } = require('./errors');

function parseCookies(headerValue) {
  const cookies = {};
  for (const item of String(headerValue || '').split(';')) {
    const separator = item.indexOf('=');
    if (separator < 1) continue;
    const name = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

function bearerToken(request) {
  const authorization = request.get('authorization') || '';
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  return match?.[1] || null;
}

function requestMetadata(request) {
  return Object.freeze({
    client: 'web',
    ipAddress: request.ip,
    userAgent: request.get('user-agent') || '',
  });
}

function createIdentityHttpGuards({ config, service }) {
  function requireTrustedOrigin(request, _response, next) {
    const origin = request.get('origin');
    if (!origin || !config.trustedOrigins.includes(origin)) {
      return next(new IdentityError('origin_not_allowed', 403));
    }
    return next();
  }

  async function authenticate(request, _response, next) {
    try {
      const token = bearerToken(request);
      if (!token) throw new IdentityError('authentication_required', 401);
      request.identityAuthentication = await service.authenticate(token);
      next();
    } catch (error) {
      next(error);
    }
  }

  async function optionalAuthenticate(request, _response, next) {
    try {
      const token = bearerToken(request);
      request.identityAuthentication = token ? await service.authenticate(token) : null;
      next();
    } catch (error) {
      next(error);
    }
  }

  return Object.freeze({ authenticate, optionalAuthenticate, requireTrustedOrigin });
}

function createIdentityRouter({ config, googleClient, logger = console, service }) {
  const router = express.Router();
  const { authenticate, requireTrustedOrigin } = createIdentityHttpGuards({ config, service });
  const refreshCookieOptions = Object.freeze({
    httpOnly: true,
    maxAge: config.session.absoluteTtlMs,
    path: '/api/v1/auth',
    sameSite: 'lax',
    secure: config.cookies.secure,
  });
  const csrfCookieOptions = Object.freeze({
    httpOnly: false,
    maxAge: config.session.absoluteTtlMs,
    path: '/',
    sameSite: 'strict',
    secure: config.cookies.secure,
  });
  const oauthCookieOptions = Object.freeze({
    httpOnly: true,
    path: '/api/v1/auth/google/callback',
    sameSite: 'lax',
    secure: config.cookies.secure,
  });

  function setSessionCookies(response, result) {
    response.cookie(config.cookies.refreshName, result.refreshToken, refreshCookieOptions);
    response.cookie(config.cookies.csrfName, result.csrfToken, csrfCookieOptions);
  }

  function clearSessionCookies(response) {
    response.clearCookie(config.cookies.refreshName, refreshCookieOptions);
    response.clearCookie(config.cookies.csrfName, csrfCookieOptions);
  }

  router.post(
    '/auth/register',
    requireTrustedOrigin,
    operationContract('register'),
    async (request, response, next) => {
      try {
        const result = await service.register({
          displayName: request.body?.displayName,
          email: request.body?.email,
          metadata: requestMetadata(request),
          password: request.body?.password,
        });
        setSessionCookies(response, result);
        response.status(201).json({
          accessToken: result.accessToken,
          session: result.session,
          user: result.user,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/auth/login',
    requireTrustedOrigin,
    operationContract('login'),
    async (request, response, next) => {
      try {
        const result = await service.login({
          email: request.body?.email,
          metadata: requestMetadata(request),
          password: request.body?.password,
        });
        setSessionCookies(response, result);
        response.json({
          accessToken: result.accessToken,
          session: result.session,
          user: result.user,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/auth/refresh',
    requireTrustedOrigin,
    operationContract('refreshSession'),
    async (request, response, next) => {
      try {
        const cookies = parseCookies(request.get('cookie'));
        const result = await service.refresh({
          csrfCookie: cookies[config.cookies.csrfName],
          csrfHeader: request.get('x-csrf-token'),
          metadata: requestMetadata(request),
          refreshToken: cookies[config.cookies.refreshName],
        });
        setSessionCookies(response, result);
        response.json({
          accessToken: result.accessToken,
          session: result.session,
          user: result.user,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/auth/logout',
    requireTrustedOrigin,
    operationContract('logout'),
    async (request, response, next) => {
      try {
        const cookies = parseCookies(request.get('cookie'));
        await service.logout({
          csrfCookie: cookies[config.cookies.csrfName],
          csrfHeader: request.get('x-csrf-token'),
          refreshToken: cookies[config.cookies.refreshName],
        });
        clearSessionCookies(response);
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/auth/logout-all',
    requireTrustedOrigin,
    authenticate,
    operationContract('logoutAll'),
    async (request, response, next) => {
      try {
        await service.logoutAll(request.identityAuthentication);
        clearSessionCookies(response);
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/auth/email/verify/request',
    requireTrustedOrigin,
    authenticate,
    operationContract('requestEmailVerification'),
    async (request, response, next) => {
      try {
        await service.requestEmailVerification(request.identityAuthentication);
        response.status(202).json({ message: 'If verification is needed, delivery was queued.' });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/auth/email/verify/confirm',
    requireTrustedOrigin,
    operationContract('confirmEmailVerification'),
    async (request, response, next) => {
      try {
        const user = await service.confirmEmailVerification(request.body?.token);
        response.json({ user });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/auth/password/forgot',
    requireTrustedOrigin,
    operationContract('requestPasswordReset'),
    async (request, response, next) => {
      try {
        await service.requestPasswordReset(request.body?.email);
        response.status(202).json({ message: 'If the account is eligible, delivery was queued.' });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/auth/password/reset',
    requireTrustedOrigin,
    operationContract('resetPassword'),
    async (request, response, next) => {
      try {
        await service.resetPassword({
          password: request.body?.password,
          token: request.body?.token,
        });
        clearSessionCookies(response);
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/auth/google/start',
    operationContract('startGoogleLogin'),
    (request, response, next) => {
      try {
        if (!googleClient.enabled) throw new IdentityError('google_auth_unavailable', 503);
        const result = googleClient.begin(request.query.returnTo);
        response.cookie(config.cookies.oauthTransactionName, result.transactionCookie, {
          ...oauthCookieOptions,
          maxAge: result.maxAgeMs,
        });
        response.redirect(302, result.authorizationUrl);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/auth/google/callback',
    operationContract('completeGoogleLogin'),
    async (request, response) => {
      try {
        if (!googleClient.enabled) throw new IdentityError('google_auth_unavailable', 503);
        const cookies = parseCookies(request.get('cookie'));
        const completed = await googleClient.complete({
          code: request.query.code,
          state: request.query.state,
          transactionCookie: cookies[config.cookies.oauthTransactionName],
        });
        const result = await service.loginWithGoogle({
          metadata: requestMetadata(request),
          profile: completed.profile,
        });
        response.clearCookie(config.cookies.oauthTransactionName, oauthCookieOptions);
        setSessionCookies(response, result);
        const redirect = new URL(completed.returnTo, config.webAppOrigin);
        redirect.searchParams.set('auth', 'complete');
        response.redirect(302, redirect.toString());
      } catch (error) {
        logger.warn('google_authentication_callback_failed', {
          errorCode: error.code || 'internal_error',
        });
        response.clearCookie(config.cookies.oauthTransactionName, oauthCookieOptions);
        const redirect = new URL('/auth', config.webAppOrigin);
        redirect.searchParams.set('error', 'google_auth_failed');
        response.redirect(302, redirect.toString());
      }
    },
  );

  router.get('/me', authenticate, operationContract('getMe'), (request, response) => {
    response.json({ user: service.userDto(request.identityAuthentication.user) });
  });

  router.get(
    '/me/preferences/theme',
    authenticate,
    operationContract('getMyTheme'),
    async (request, response, next) => {
      try {
        response.json({ theme: await service.getThemePreferences(request.identityAuthentication) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    '/me/preferences/theme',
    requireTrustedOrigin,
    authenticate,
    operationContract('updateMyTheme'),
    async (request, response, next) => {
      try {
        response.json({
          theme: await service.setThemePreferences(
            request.identityAuthentication,
            request.body,
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.put('/me/privacy', requireTrustedOrigin, authenticate, async (request, response, next) => {
    try {
      const privacySettings = await service.setPrivacySettings(request.identityAuthentication, request.body);
      response.json({ ...service.userDto(request.identityAuthentication.user), privacySettings });
    } catch (error) { next(error); }
  });
  router.get('/me/privacy', authenticate, async (request, response, next) => {
    try { response.json({ privacySettings: await service.getPrivacySettings(request.identityAuthentication) }); }
    catch (error) { next(error); }
  });

  router.put('/me/profile', requireTrustedOrigin, authenticate, async (request, response, next) => {
    try {
      const updatedUser = await service.updateUserProfile(request.identityAuthentication, {
        displayName: request.body?.displayName || request.body?.username,
        username: request.body?.username,
        avatarUrl: request.body?.avatarUrl,
      });
      response.json({ user: updatedUser });
    } catch (error) {
      next(error);
    }
  });

  const uploadsDir = path.join(__dirname, '../../uploads');
  const avatarStorage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdir(uploadsDir, { recursive: true }, (err) => cb(err, uploadsDir));
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      const userId = req.identityAuthentication?.user?.id || 'user';
      cb(null, `avatar-${userId}-${Date.now()}${ext}`);
    },
  });
  const avatarUpload = multer({
    storage: avatarStorage,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const isAllowed =
        file.mimetype.startsWith('image/') ||
        ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg', '.bmp', '.heic', '.jfif'].includes(ext);
      if (isAllowed) {
        return cb(null, true);
      }
      cb(new Error('Only image files (JPG, PNG, WEBP, GIF, AVIF) are allowed.'));
    },
  }).any();

  router.post(
    '/me/avatar',
    requireTrustedOrigin,
    authenticate,
    avatarUpload,
    async (request, response, next) => {
      const uploadedFile = request.file || (request.files && request.files[0]);
      if (!uploadedFile) {
        return response.status(400).json({ message: 'No image file selected.' });
      }
      try {
        const avatarUrl = `/uploads/${uploadedFile.filename}`;
        const updatedUser = await service.updateUserProfile(request.identityAuthentication, {
          avatarUrl,
        });
        response.json({
          message: 'Profile picture updated successfully!',
          avatarUrl,
          profilePictureUrl: avatarUrl,
          user: updatedUser,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/me/sessions',
    authenticate,
    operationContract('listMySessions'),
    async (request, response, next) => {
      try {
        response.json({ sessions: await service.listSessions(request.identityAuthentication) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    '/me/sessions/:sessionId',
    requireTrustedOrigin,
    authenticate,
    operationContract('revokeMySession'),
    async (request, response, next) => {
      try {
        await service.revokeSession(request.identityAuthentication, request.params.sessionId);
        if (request.params.sessionId === request.identityAuthentication.session.id) {
          clearSessionCookies(response);
        }
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

function createUnavailableIdentityRouter({ reason = 'identity_not_configured' } = {}) {
  const router = express.Router();
  router.use((_request, _response, next) => {
    next(new IdentityError(reason, 503));
  });
  return router;
}

module.exports = {
  bearerToken,
  createIdentityHttpGuards,
  createIdentityRouter,
  createUnavailableIdentityRouter,
  parseCookies,
  requestMetadata,
};
