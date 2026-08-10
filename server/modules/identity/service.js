'use strict';

const {
  AUTH_IDENTITY_PROVIDER,
  PLATFORM_ROLE,
  SESSION_CLIENT,
  USER_STATUS,
} = require('./contracts');
const { IdentityError } = require('./errors');
const {
  constantTimeEqual,
  createOpaqueToken,
  hashOpaqueToken,
  parseOpaqueToken,
} = require('./token-crypto');

const ONE_TIME_PURPOSE = Object.freeze({
  EMAIL_VERIFICATION: 'email_verification',
  PASSWORD_RESET: 'password_reset',
});

const THEME_PRESETS = new Set([
  'ocean',
  'midnight',
  'aurora',
  'sunset',
  'nebula',
  'forest',
  'monochrome',
  'ember',
  'custom',
]);
const THEME_COLOR = /^#[0-9a-f]{6}$/i;
const DEFAULT_THEME = Object.freeze({
  preset: 'ocean',
  color1: '#149ecc',
  color2: '#412ecc',
  color3: '#44cf87',
  customColors: false,
});

function normalizeThemePreferences(candidate, { rejectInvalid = false } = {}) {
  const valid =
    candidate &&
    typeof candidate === 'object' &&
    !Array.isArray(candidate) &&
    THEME_PRESETS.has(candidate.preset) &&
    THEME_COLOR.test(candidate.color1) &&
    THEME_COLOR.test(candidate.color2) &&
    THEME_COLOR.test(candidate.color3) &&
    typeof candidate.customColors === 'boolean' &&
    (candidate.preset === 'custom' ? candidate.customColors : !candidate.customColors);
  if (!valid) {
    if (rejectInvalid) throw new IdentityError('invalid_theme_preferences', 400);
    return { ...DEFAULT_THEME };
  }
  return {
    preset: candidate.preset,
    color1: candidate.color1.toLowerCase(),
    color2: candidate.color2.toLowerCase(),
    color3: candidate.color3.toLowerCase(),
    customColors: candidate.customColors,
  };
}

function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .normalize('NFKC')
    .toLowerCase();
}

function sanitizeDisplayName(value) {
  return String(value || '')
    .trim()
    .normalize('NFKC')
    .replace(/\s+/g, ' ');
}

function validateRegistration({ displayName, email, password }) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new IdentityError('invalid_registration', 400);
  }
  if (displayName.length < 1 || displayName.length > 80) {
    throw new IdentityError('invalid_registration', 400);
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw new IdentityError('password_policy_failed', 400);
  }
}

function userDto(user) {
  return Object.freeze({
    avatarUrl: user.avatarUrl || null,
    displayName: user.displayName,
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
    id: user.id,
    platformRole: user.platformRole,
    status: user.status,
    username: user.username || null,
  });
}

function sessionDto(session, currentSessionId) {
  return Object.freeze({
    authenticatedAt: session.authenticatedAt,
    client: session.client,
    createdAt: session.createdAt,
    current: session.id === currentSessionId,
    expiresAt: session.expiresAt,
    id: session.id,
    lastUsedAt: session.lastUsedAt,
    revokedAt: session.revokedAt || null,
    userAgent: session.userAgent || null,
  });
}

function createIdentityService({
  accessTokens,
  mailer,
  now = () => new Date(),
  passwordHasher,
  passwordRiskChecker,
  refreshTokenPepper,
  repository,
  sessionConfig,
}) {
  function requireActiveUser(user, errorCode = 'invalid_credentials') {
    if (!user || user.status !== USER_STATUS.ACTIVE) {
      throw new IdentityError(errorCode, 401);
    }
  }

  function createCsrfToken(sessionId) {
    return createOpaqueToken('c1', sessionId).raw;
  }

  async function issueSession(user, metadata = {}) {
    requireActiveUser(user, 'account_unavailable');
    const createdAt = now();
    const refresh = createOpaqueToken('r1');
    const csrfToken = createCsrfToken(refresh.id);
    const expiresAt = new Date(createdAt.getTime() + sessionConfig.absoluteTtlMs);
    const idleExpiresAt = new Date(
      Math.min(createdAt.getTime() + sessionConfig.idleTtlMs, expiresAt.getTime()),
    );
    const session = await repository.createSession({
      authenticatedAt: createdAt,
      client: metadata.client || SESSION_CLIENT.WEB,
      compromisedAt: null,
      consumedTokenHashes: [],
      createdAt,
      csrfTokenHash: hashOpaqueToken(csrfToken, refreshTokenPepper),
      currentTokenHash: hashOpaqueToken(refresh.raw, refreshTokenPepper),
      expiresAt,
      id: refresh.id,
      idleExpiresAt,
      ipHash: metadata.ipAddress ? hashOpaqueToken(metadata.ipAddress, refreshTokenPepper) : null,
      lastUsedAt: createdAt,
      revokedAt: null,
      userAgent: String(metadata.userAgent || '').slice(0, 300) || null,
      userId: user.id,
    });
    return Object.freeze({
      accessToken: accessTokens.issue({ sessionId: session.id, userId: user.id }),
      csrfToken,
      refreshToken: refresh.raw,
      session: sessionDto(session, session.id),
      user: userDto(user),
    });
  }

  async function issueOneTimeToken({ purpose, user }) {
    const issuedAt = now();
    const prefix = purpose === ONE_TIME_PURPOSE.EMAIL_VERIFICATION ? 'ev1' : 'pr1';
    const opaque = createOpaqueToken(prefix);
    await repository.invalidateOneTimeTokens(user.id, purpose, issuedAt);
    await repository.createOneTimeToken({
      consumedAt: null,
      createdAt: issuedAt,
      expiresAt: new Date(
        issuedAt.getTime() +
          (purpose === ONE_TIME_PURPOSE.EMAIL_VERIFICATION ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000),
      ),
      id: opaque.id,
      purpose,
      tokenHash: hashOpaqueToken(opaque.raw, refreshTokenPepper),
      userId: user.id,
    });
    await mailer.send({ purpose, to: user.email, token: opaque.raw });
  }

  async function consumeOneTimeToken(rawToken, purpose) {
    const prefix = purpose === ONE_TIME_PURPOSE.EMAIL_VERIFICATION ? 'ev1' : 'pr1';
    const parsed = parseOpaqueToken(rawToken, prefix);
    if (!parsed) throw new IdentityError('invalid_or_expired_token', 400);
    const consumedAt = now();
    const token = await repository.consumeOneTimeToken({
      consumedAt,
      purpose,
      tokenHash: hashOpaqueToken(rawToken, refreshTokenPepper),
      tokenId: parsed.id,
    });
    if (!token) throw new IdentityError('invalid_or_expired_token', 400);
    return Object.freeze({ consumedAt, token });
  }

  async function authenticate(accessToken) {
    const claims = accessTokens.verify(accessToken);
    const [session, user] = await Promise.all([
      repository.findSession(claims.sessionId),
      repository.findUserById(claims.userId),
    ]);
    const currentTime = now();
    if (
      !session ||
      session.userId !== claims.userId ||
      session.revokedAt ||
      session.compromisedAt ||
      session.expiresAt <= currentTime ||
      session.idleExpiresAt <= currentTime
    ) {
      throw new IdentityError('invalid_access_token', 401);
    }
    requireActiveUser(user, 'invalid_access_token');
    return Object.freeze({
      principal: Object.freeze({
        emailVerified: Boolean(user.emailVerifiedAt),
        platformRole: user.platformRole,
        sessionId: session.id,
        status: user.status,
        userId: user.id,
      }),
      session,
      user,
    });
  }

  function requireRecentAuthentication(session) {
    if (
      now().getTime() - session.authenticatedAt.getTime() >
      sessionConfig.recentAuthenticationMs
    ) {
      throw new IdentityError('recent_authentication_required', 403);
    }
  }

  return Object.freeze({
    async authenticate(accessToken) {
      return authenticate(accessToken);
    },

    async register({ displayName: rawDisplayName, email: rawEmail, metadata, password }) {
      const email = normalizeEmail(rawEmail);
      const displayName = sanitizeDisplayName(rawDisplayName);
      validateRegistration({ displayName, email, password });
      await passwordRiskChecker.assertAllowed(password);
      if (await repository.findUserByEmail(email)) {
        throw new IdentityError('registration_unavailable', 409);
      }

      const passwordHash = await passwordHasher.hash(password);
      let created;
      try {
        created = await repository.createUserWithIdentity({
          identity: {
            passwordHash,
            provider: AUTH_IDENTITY_PROVIDER.LOCAL,
            providerSubject: email,
          },
          user: {
            avatarUrl: null,
            displayName,
            email,
            emailVerifiedAt: null,
            platformRole: PLATFORM_ROLE.LEARNER,
            status: USER_STATUS.ACTIVE,
            username: null,
          },
        });
      } catch (error) {
        if (['duplicate_email', 'duplicate_identity', 11000].includes(error.code)) {
          throw new IdentityError('registration_unavailable', 409);
        }
        throw error;
      }

      await issueOneTimeToken({
        purpose: ONE_TIME_PURPOSE.EMAIL_VERIFICATION,
        user: created.user,
      });
      return issueSession(created.user, metadata);
    },

    async login({ email: rawEmail, metadata, password }) {
      const email = normalizeEmail(rawEmail);
      let identity = await repository.findIdentity(AUTH_IDENTITY_PROVIDER.LOCAL, email);
      if (!identity) identity = await repository.findLegacyLocalIdentityByEmail(email);

      const verification = await passwordHasher.verify(
        identity?.passwordHash,
        String(password || ''),
      );
      if (!identity || !verification.matches) {
        throw new IdentityError('invalid_credentials', 401);
      }

      const user = await repository.findUserById(identity.userId);
      requireActiveUser(user);

      if (verification.needsRehash) {
        const passwordHash = await passwordHasher.hash(password);
        if (identity.legacy) {
          await repository.linkIdentity({
            passwordHash,
            provider: AUTH_IDENTITY_PROVIDER.LOCAL,
            providerSubject: email,
            userId: user.id,
          });
        } else {
          await repository.updateIdentityPassword(identity.id, passwordHash);
        }
      }

      return issueSession(user, metadata);
    },

    async loginWithGoogle({ metadata, profile }) {
      const email = normalizeEmail(profile.email);
      if (
        !profile.subject ||
        !email ||
        profile.emailVerified !== true ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ) {
        throw new IdentityError('invalid_google_identity', 401);
      }

      const googleIdentity = await repository.findIdentity(
        AUTH_IDENTITY_PROVIDER.GOOGLE,
        profile.subject,
      );
      let user = googleIdentity ? await repository.findUserById(googleIdentity.userId) : null;

      if (!user) {
        user = await repository.findUserByEmail(email);
        if (user) {
          await repository.linkIdentity({
            passwordHash: null,
            provider: AUTH_IDENTITY_PROVIDER.GOOGLE,
            providerSubject: profile.subject,
            userId: user.id,
          });
        } else {
          const created = await repository.createUserWithIdentity({
            identity: {
              passwordHash: null,
              provider: AUTH_IDENTITY_PROVIDER.GOOGLE,
              providerSubject: profile.subject,
            },
            user: {
              avatarUrl: profile.picture || null,
              displayName: sanitizeDisplayName(profile.name) || email.split('@')[0],
              email,
              emailVerifiedAt: now(),
              platformRole: PLATFORM_ROLE.LEARNER,
              status: USER_STATUS.ACTIVE,
              username: null,
            },
          });
          user = created.user;
        }
      }

      requireActiveUser(user, 'invalid_google_identity');
      if (!user.emailVerifiedAt) user = await repository.markEmailVerified(user.id, now());
      user =
        (await repository.updateGoogleProfile(user.id, {
          avatarUrl: profile.picture || null,
          displayName: sanitizeDisplayName(profile.name),
        })) || user;
      return issueSession(user, metadata);
    },

    async refresh({ csrfCookie, csrfHeader, metadata, refreshToken }) {
      const parsed = parseOpaqueToken(refreshToken, 'r1');
      if (!parsed) throw new IdentityError('invalid_refresh_token', 401);
      const session = await repository.findSession(parsed.id);
      if (!session) throw new IdentityError('invalid_refresh_token', 401);

      const presentedHash = hashOpaqueToken(refreshToken, refreshTokenPepper);
      if (session.currentTokenHash !== presentedHash) {
        const reuseResult = await repository.rotateSession({
          currentTokenHash: presentedHash,
          idleExpiresAt: session.idleExpiresAt,
          nextCsrfTokenHash: session.csrfTokenHash,
          nextTokenHash: session.currentTokenHash,
          now: now(),
          sessionId: session.id,
        });
        if (reuseResult.outcome === 'reused') {
          throw new IdentityError('refresh_token_reuse_detected', 401);
        }
        throw new IdentityError('invalid_refresh_token', 401);
      }

      if (
        !csrfCookie ||
        !csrfHeader ||
        !constantTimeEqual(csrfCookie, csrfHeader) ||
        hashOpaqueToken(csrfHeader, refreshTokenPepper) !== session.csrfTokenHash
      ) {
        throw new IdentityError('csrf_validation_failed', 403);
      }

      const currentTime = now();
      const nextRefresh = createOpaqueToken('r1', session.id);
      const nextCsrfToken = createCsrfToken(session.id);
      const idleExpiresAt = new Date(
        Math.min(currentTime.getTime() + sessionConfig.idleTtlMs, session.expiresAt.getTime()),
      );
      const rotation = await repository.rotateSession({
        currentTokenHash: presentedHash,
        idleExpiresAt,
        nextCsrfTokenHash: hashOpaqueToken(nextCsrfToken, refreshTokenPepper),
        nextTokenHash: hashOpaqueToken(nextRefresh.raw, refreshTokenPepper),
        now: currentTime,
        sessionId: session.id,
      });
      if (rotation.outcome === 'reused') {
        throw new IdentityError('refresh_token_reuse_detected', 401);
      }
      if (rotation.outcome !== 'rotated') {
        throw new IdentityError('invalid_refresh_token', 401);
      }

      const user = await repository.findUserById(rotation.session.userId);
      requireActiveUser(user, 'invalid_refresh_token');
      return Object.freeze({
        accessToken: accessTokens.issue({ sessionId: rotation.session.id, userId: user.id }),
        csrfToken: nextCsrfToken,
        refreshToken: nextRefresh.raw,
        session: sessionDto(rotation.session, rotation.session.id),
        user: userDto(user),
        metadata,
      });
    },

    async logout({ csrfCookie, csrfHeader, refreshToken }) {
      const parsed = parseOpaqueToken(refreshToken, 'r1');
      if (!parsed) return;
      const session = await repository.findSession(parsed.id);
      if (!session) return;
      if (
        !csrfCookie ||
        !csrfHeader ||
        !constantTimeEqual(csrfCookie, csrfHeader) ||
        hashOpaqueToken(csrfHeader, refreshTokenPepper) !== session.csrfTokenHash ||
        hashOpaqueToken(refreshToken, refreshTokenPepper) !== session.currentTokenHash
      ) {
        throw new IdentityError('csrf_validation_failed', 403);
      }
      await repository.revokeSession(session.id, now());
    },

    async logoutAll(authentication) {
      requireRecentAuthentication(authentication.session);
      await repository.revokeAllSessions(authentication.user.id, now());
    },

    async listSessions(authentication) {
      const sessions = await repository.listSessionsForUser(authentication.user.id);
      return sessions.map((session) => sessionDto(session, authentication.session.id));
    },

    async revokeSession(authentication, sessionId) {
      requireRecentAuthentication(authentication.session);
      const sessions = await repository.listSessionsForUser(authentication.user.id);
      if (!sessions.some((session) => session.id === sessionId)) {
        throw new IdentityError('session_not_found', 404);
      }
      await repository.revokeSession(sessionId, now());
    },

    async requestEmailVerification(authentication) {
      if (authentication.user.emailVerifiedAt) return;
      await issueOneTimeToken({
        purpose: ONE_TIME_PURPOSE.EMAIL_VERIFICATION,
        user: authentication.user,
      });
    },

    async confirmEmailVerification(rawToken) {
      const { consumedAt, token } = await consumeOneTimeToken(
        rawToken,
        ONE_TIME_PURPOSE.EMAIL_VERIFICATION,
      );
      const user = await repository.markEmailVerified(token.userId, consumedAt);
      if (!user) throw new IdentityError('invalid_or_expired_token', 400);
      return userDto(user);
    },

    async requestPasswordReset(rawEmail) {
      const email = normalizeEmail(rawEmail);
      const user = await repository.findUserByEmail(email);
      let identity = user
        ? await repository.findIdentityForUser(AUTH_IDENTITY_PROVIDER.LOCAL, user.id)
        : null;
      if (user && !identity) {
        const legacyIdentity = await repository.findLegacyLocalIdentityByEmail(email);
        if (legacyIdentity?.userId === user.id) {
          identity = await repository.linkIdentity({
            passwordHash: legacyIdentity.passwordHash,
            provider: AUTH_IDENTITY_PROVIDER.LOCAL,
            providerSubject: email,
            userId: user.id,
          });
        }
      }
      if (user?.status === USER_STATUS.ACTIVE && identity) {
        await issueOneTimeToken({ purpose: ONE_TIME_PURPOSE.PASSWORD_RESET, user });
      }
    },

    async resetPassword({ password, token: rawToken }) {
      validateRegistration({
        displayName: 'Password reset',
        email: 'valid@example.test',
        password,
      });
      await passwordRiskChecker.assertAllowed(password);
      const { consumedAt, token } = await consumeOneTimeToken(
        rawToken,
        ONE_TIME_PURPOSE.PASSWORD_RESET,
      );
      const identity = await repository.findIdentityForUser(
        AUTH_IDENTITY_PROVIDER.LOCAL,
        token.userId,
      );
      if (!identity) throw new IdentityError('invalid_or_expired_token', 400);
      await repository.updateIdentityPassword(identity.id, await passwordHasher.hash(password));
      await repository.revokeAllSessions(token.userId, consumedAt);
    },

    async updateUserProfile(authentication, { avatarUrl, displayName, username } = {}) {
      const updatedUser = await repository.updateUserProfile(authentication.user.id, {
        avatarUrl,
        displayName: displayName ? sanitizeDisplayName(displayName) : undefined,
        username,
      });
      return userDto(updatedUser || authentication.user);
    },

    async getThemePreferences(authentication) {
      const stored = await repository.getThemePreferences(authentication.user.id);
      return normalizeThemePreferences(stored);
    },

    async setThemePreferences(authentication, candidate) {
      const theme = normalizeThemePreferences(candidate, { rejectInvalid: true });
      return repository.setThemePreferences(authentication.user.id, theme);
    },

    async setPrivacySettings(authentication, candidate) {
      const choices = new Set(['everyone', 'followers', 'friends', 'nobody']);
      const keys = ['whoCanFollow', 'whoCanViewPosts', 'whoCanViewComments', 'whoCanViewProfileInfo'];
      const settings = {};
      for (const key of keys) {
        if (!choices.has(candidate?.[key])) throw new IdentityError('invalid_privacy_settings', 400);
        settings[key] = candidate[key];
      }
      return repository.setPrivacySettings(authentication.user.id, settings);
    },

    async getPrivacySettings(authentication) {
      return (await repository.getPrivacySettings(authentication.user.id)) || {
        whoCanFollow: 'everyone',
        whoCanViewPosts: 'everyone',
        whoCanViewComments: 'everyone',
        whoCanViewProfileInfo: 'everyone',
      };
    },

    userDto,
  });
}

module.exports = { ONE_TIME_PURPOSE, createIdentityService, normalizeEmail, userDto };
