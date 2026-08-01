'use strict';

const { randomUUID } = require('node:crypto');

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function identityKey(provider, providerSubject) {
  return `${provider}:${providerSubject}`;
}

function createMemoryIdentityRepository(seed = {}) {
  const users = new Map((seed.users || []).map((user) => [user.id, clone(user)]));
  const identities = new Map(
    (seed.identities || []).map((identity) => [
      identityKey(identity.provider, identity.providerSubject),
      clone(identity),
    ]),
  );
  const sessions = new Map((seed.sessions || []).map((session) => [session.id, clone(session)]));
  const oneTimeTokens = new Map(
    (seed.oneTimeTokens || []).map((token) => [token.id, clone(token)]),
  );

  function findStoredUserByEmail(normalizedEmail) {
    return [...users.values()].find((user) => user.email === normalizedEmail) || null;
  }

  return Object.freeze({
    async createUserWithIdentity({ identity, user }) {
      if (findStoredUserByEmail(user.email)) {
        const error = new Error('duplicate_email');
        error.code = 'duplicate_email';
        throw error;
      }
      if (identities.has(identityKey(identity.provider, identity.providerSubject))) {
        const error = new Error('duplicate_identity');
        error.code = 'duplicate_identity';
        throw error;
      }

      const createdUser = {
        authorityRevision: 1,
        ...clone(user),
        createdAt: user.createdAt || new Date(),
        id: user.id || randomUUID(),
        updatedAt: user.updatedAt || new Date(),
      };
      const createdIdentity = {
        ...clone(identity),
        createdAt: identity.createdAt || new Date(),
        id: identity.id || randomUUID(),
        userId: createdUser.id,
        updatedAt: identity.updatedAt || new Date(),
      };
      users.set(createdUser.id, createdUser);
      identities.set(
        identityKey(createdIdentity.provider, createdIdentity.providerSubject),
        createdIdentity,
      );
      return clone({ identity: createdIdentity, user: createdUser });
    },

    async findUserByEmail(normalizedEmail) {
      return clone(findStoredUserByEmail(normalizedEmail));
    },

    async findUserById(userId) {
      return clone(users.get(userId) || null);
    },

    async findIdentity(provider, providerSubject) {
      return clone(identities.get(identityKey(provider, providerSubject)) || null);
    },

    async findIdentityForUser(provider, userId) {
      return clone(
        [...identities.values()].find(
          (identity) => identity.provider === provider && identity.userId === userId,
        ) || null,
      );
    },

    async findLegacyLocalIdentityByEmail() {
      return null;
    },

    async linkIdentity(identity) {
      const key = identityKey(identity.provider, identity.providerSubject);
      const existing = identities.get(key);
      if (existing && existing.userId !== identity.userId) {
        const error = new Error('duplicate_identity');
        error.code = 'duplicate_identity';
        throw error;
      }
      const linked = {
        ...clone(identity),
        createdAt: identity.createdAt || new Date(),
        id: identity.id || existing?.id || randomUUID(),
        updatedAt: new Date(),
      };
      identities.set(key, linked);
      return clone(linked);
    },

    async updateIdentityPassword(identityId, passwordHash) {
      const entry = [...identities.entries()].find(([, identity]) => identity.id === identityId);
      if (!entry) return null;
      const [key, identity] = entry;
      const updated = { ...identity, passwordHash, updatedAt: new Date() };
      identities.set(key, updated);
      return clone(updated);
    },

    async markEmailVerified(userId, verifiedAt) {
      const user = users.get(userId);
      if (!user) return null;
      const updated = { ...user, emailVerifiedAt: verifiedAt, updatedAt: verifiedAt };
      users.set(userId, updated);
      return clone(updated);
    },

    async updateUserStatus(userId, status) {
      const user = users.get(userId);
      if (!user) return null;
      const updated = { ...user, status, updatedAt: new Date() };
      users.set(userId, updated);
      return clone(updated);
    },

    async updateGoogleProfile(userId, { avatarUrl, displayName }) {
      const user = users.get(userId);
      if (!user) return null;
      const updated = {
        ...user,
        avatarUrl: user.avatarUrl || avatarUrl || null,
        displayName: user.displayName || displayName,
        updatedAt: new Date(),
      };
      users.set(userId, updated);
      return clone(updated);
    },

    async createSession(session) {
      if (sessions.has(session.id)) throw new Error('duplicate_session');
      sessions.set(session.id, clone(session));
      return clone(session);
    },

    async findSession(sessionId) {
      return clone(sessions.get(sessionId) || null);
    },

    async rotateSession({
      currentTokenHash,
      idleExpiresAt,
      nextCsrfTokenHash,
      nextTokenHash,
      now,
      sessionId,
    }) {
      const session = sessions.get(sessionId);
      if (
        !session ||
        session.revokedAt ||
        session.expiresAt <= now ||
        session.idleExpiresAt <= now
      ) {
        return clone({ outcome: 'invalid', session: session || null });
      }

      if (session.currentTokenHash === currentTokenHash) {
        const updated = {
          ...session,
          consumedTokenHashes: [...session.consumedTokenHashes, currentTokenHash],
          csrfTokenHash: nextCsrfTokenHash,
          currentTokenHash: nextTokenHash,
          idleExpiresAt,
          lastUsedAt: now,
        };
        sessions.set(sessionId, updated);
        return clone({ outcome: 'rotated', session: updated });
      }

      if (session.consumedTokenHashes.includes(currentTokenHash)) {
        const updated = { ...session, compromisedAt: now, revokedAt: now };
        sessions.set(sessionId, updated);
        return clone({ outcome: 'reused', session: updated });
      }

      return clone({ outcome: 'invalid', session });
    },

    async revokeSession(sessionId, revokedAt) {
      const session = sessions.get(sessionId);
      if (!session) return false;
      sessions.set(sessionId, { ...session, revokedAt: session.revokedAt || revokedAt });
      return true;
    },

    async revokeAllSessions(userId, revokedAt, exceptSessionId = null) {
      let count = 0;
      for (const [sessionId, session] of sessions) {
        if (session.userId === userId && sessionId !== exceptSessionId && !session.revokedAt) {
          sessions.set(sessionId, { ...session, revokedAt });
          count += 1;
        }
      }
      return count;
    },

    async listSessionsForUser(userId) {
      return clone(
        [...sessions.values()]
          .filter((session) => session.userId === userId)
          .sort((left, right) => right.createdAt - left.createdAt),
      );
    },

    async createOneTimeToken(token) {
      oneTimeTokens.set(token.id, clone(token));
      return clone(token);
    },

    async invalidateOneTimeTokens(userId, purpose, invalidatedAt) {
      for (const [tokenId, token] of oneTimeTokens) {
        if (token.userId === userId && token.purpose === purpose && !token.consumedAt) {
          oneTimeTokens.set(tokenId, { ...token, consumedAt: invalidatedAt });
        }
      }
    },

    async consumeOneTimeToken({ consumedAt, purpose, tokenHash, tokenId }) {
      const token = oneTimeTokens.get(tokenId);
      if (
        !token ||
        token.purpose !== purpose ||
        token.tokenHash !== tokenHash ||
        token.consumedAt ||
        token.expiresAt <= consumedAt
      ) {
        return null;
      }
      oneTimeTokens.set(tokenId, { ...token, consumedAt });
      return clone(token);
    },

    snapshot() {
      return clone({
        identities: [...identities.values()],
        oneTimeTokens: [...oneTimeTokens.values()],
        sessions: [...sessions.values()],
        users: [...users.values()],
      });
    },
  });
}

module.exports = { createMemoryIdentityRepository };
