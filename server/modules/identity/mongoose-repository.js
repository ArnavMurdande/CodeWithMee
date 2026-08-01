'use strict';

const AuthIdentity = require('../../models/AuthIdentity');
const AuthSession = require('../../models/AuthSession');
const IdentityOneTimeToken = require('../../models/IdentityOneTimeToken');
const User = require('../../models/User');

function userRecord(document) {
  if (!document) return null;
  return {
    authorityRevision: document.authorityRevision || 1,
    avatarUrl: document.profilePictureUrl || null,
    createdAt: document.createdAt,
    displayName: document.displayName || document.username || document.email.split('@')[0],
    email: document.email,
    emailVerifiedAt: document.emailVerifiedAt || null,
    id: document._id.toString(),
    platformRole: document.platformRole || document.role || 'learner',
    status: document.isBanned ? 'banned' : document.status || 'active',
    updatedAt: document.updatedAt || document.createdAt,
    username: document.username || null,
  };
}

function identityRecord(document) {
  if (!document) return null;
  return {
    createdAt: document.createdAt,
    id: document._id.toString(),
    passwordHash: document.passwordHash || null,
    provider: document.provider,
    providerSubject: document.providerSubject,
    updatedAt: document.updatedAt,
    userId: document.user.toString(),
  };
}

function sessionRecord(document) {
  if (!document) return null;
  return {
    authenticatedAt: document.authenticatedAt,
    client: document.client,
    compromisedAt: document.compromisedAt || null,
    consumedTokenHashes: document.consumedTokenHashes || [],
    createdAt: document.createdAt,
    csrfTokenHash: document.csrfTokenHash,
    currentTokenHash: document.currentTokenHash,
    expiresAt: document.expiresAt,
    id: document.sessionId,
    idleExpiresAt: document.idleExpiresAt,
    ipHash: document.ipHash || null,
    lastUsedAt: document.lastUsedAt,
    revokedAt: document.revokedAt || null,
    updatedAt: document.updatedAt,
    userAgent: document.userAgent || null,
    userId: document.user.toString(),
  };
}

function oneTimeTokenRecord(document) {
  if (!document) return null;
  return {
    consumedAt: document.consumedAt || null,
    createdAt: document.createdAt,
    expiresAt: document.expiresAt,
    id: document.tokenId,
    purpose: document.purpose,
    tokenHash: document.tokenHash,
    userId: document.user.toString(),
  };
}

function secretSessionSelection(query) {
  return query.select('+consumedTokenHashes +csrfTokenHash +currentTokenHash +ipHash');
}

function createMongooseIdentityRepository() {
  return Object.freeze({
    async createUserWithIdentity({ identity, user }) {
      let createdUser;
      try {
        createdUser = await User.create({
          displayName: user.displayName,
          email: user.email,
          emailVerifiedAt: user.emailVerifiedAt,
          platformRole: user.platformRole,
          profilePictureUrl: user.avatarUrl,
          status: user.status,
          username: user.username,
        });
        const createdIdentity = await AuthIdentity.create({
          passwordHash: identity.passwordHash,
          provider: identity.provider,
          providerSubject: identity.providerSubject,
          user: createdUser._id,
        });
        const identityWithSecret = await AuthIdentity.findById(createdIdentity._id)
          .select('+passwordHash')
          .lean();
        return {
          identity: identityRecord(identityWithSecret),
          user: userRecord(createdUser.toObject()),
        };
      } catch (error) {
        if (createdUser?._id) await User.deleteOne({ _id: createdUser._id });
        throw error;
      }
    },

    async findUserByEmail(normalizedEmail) {
      return userRecord(await User.findOne({ email: normalizedEmail }).lean());
    },

    async findUserById(userId) {
      return userRecord(await User.findById(userId).lean());
    },

    async findIdentity(provider, providerSubject) {
      const identity = await AuthIdentity.findOne({ provider, providerSubject })
        .select('+passwordHash')
        .lean();
      return identityRecord(identity);
    },

    async findIdentityForUser(provider, userId) {
      const identity = await AuthIdentity.findOne({ provider, user: userId })
        .select('+passwordHash')
        .lean();
      return identityRecord(identity);
    },

    async findLegacyLocalIdentityByEmail(normalizedEmail) {
      const legacyUser = await User.findOne({
        authMethod: { $ne: 'google' },
        email: normalizedEmail,
        password: { $exists: true, $ne: null },
      }).lean();
      if (!legacyUser?.password) return null;
      return {
        id: `legacy-${legacyUser._id}`,
        legacy: true,
        passwordHash: legacyUser.password,
        provider: 'local',
        providerSubject: normalizedEmail,
        userId: legacyUser._id.toString(),
      };
    },

    async linkIdentity(identity) {
      const created = await AuthIdentity.findOneAndUpdate(
        { provider: identity.provider, providerSubject: identity.providerSubject },
        {
          $setOnInsert: {
            passwordHash: identity.passwordHash,
            provider: identity.provider,
            providerSubject: identity.providerSubject,
            user: identity.userId,
          },
        },
        { new: true, setDefaultsOnInsert: true, upsert: true },
      )
        .select('+passwordHash')
        .lean();
      if (created.user.toString() !== identity.userId) {
        const error = new Error('duplicate_identity');
        error.code = 'duplicate_identity';
        throw error;
      }
      return identityRecord(created);
    },

    async updateIdentityPassword(identityId, passwordHash) {
      return identityRecord(
        await AuthIdentity.findOneAndUpdate(
          { _id: identityId, provider: 'local' },
          { $set: { passwordHash } },
          { new: true, runValidators: true },
        )
          .select('+passwordHash')
          .lean(),
      );
    },

    async markEmailVerified(userId, verifiedAt) {
      return userRecord(
        await User.findByIdAndUpdate(
          userId,
          { $set: { emailVerifiedAt: verifiedAt, updatedAt: verifiedAt } },
          { new: true },
        ).lean(),
      );
    },

    async updateUserStatus(userId, status) {
      return userRecord(
        await User.findByIdAndUpdate(
          userId,
          { $set: { status, updatedAt: new Date() } },
          { new: true },
        ).lean(),
      );
    },

    async updateGoogleProfile(userId, { avatarUrl, displayName }) {
      const user = await User.findById(userId).lean();
      if (!user) return null;
      const updates = { updatedAt: new Date() };
      if (!user.profilePictureUrl && avatarUrl) updates.profilePictureUrl = avatarUrl;
      if (!user.displayName && displayName) updates.displayName = displayName;
      return userRecord(
        await User.findByIdAndUpdate(userId, { $set: updates }, { new: true }).lean(),
      );
    },

    async createSession(session) {
      const created = await AuthSession.create({
        authenticatedAt: session.authenticatedAt,
        client: session.client,
        compromisedAt: session.compromisedAt,
        consumedTokenHashes: session.consumedTokenHashes,
        csrfTokenHash: session.csrfTokenHash,
        currentTokenHash: session.currentTokenHash,
        expiresAt: session.expiresAt,
        idleExpiresAt: session.idleExpiresAt,
        ipHash: session.ipHash,
        lastUsedAt: session.lastUsedAt,
        revokedAt: session.revokedAt,
        sessionId: session.id,
        user: session.userId,
        userAgent: session.userAgent,
      });
      return sessionRecord(await secretSessionSelection(AuthSession.findById(created._id)).lean());
    },

    async findSession(sessionId) {
      return sessionRecord(await secretSessionSelection(AuthSession.findOne({ sessionId })).lean());
    },

    async rotateSession({
      currentTokenHash,
      idleExpiresAt,
      nextCsrfTokenHash,
      nextTokenHash,
      now,
      sessionId,
    }) {
      const rotated = await secretSessionSelection(
        AuthSession.findOneAndUpdate(
          {
            currentTokenHash,
            expiresAt: { $gt: now },
            idleExpiresAt: { $gt: now },
            revokedAt: null,
            sessionId,
          },
          {
            $push: { consumedTokenHashes: currentTokenHash },
            $set: {
              csrfTokenHash: nextCsrfTokenHash,
              currentTokenHash: nextTokenHash,
              idleExpiresAt,
              lastUsedAt: now,
            },
          },
          { new: true },
        ),
      ).lean();
      if (rotated) return { outcome: 'rotated', session: sessionRecord(rotated) };

      const existing = await secretSessionSelection(AuthSession.findOne({ sessionId })).lean();
      if (existing?.consumedTokenHashes?.includes(currentTokenHash)) {
        const compromised = await secretSessionSelection(
          AuthSession.findOneAndUpdate(
            { revokedAt: null, sessionId },
            { $set: { compromisedAt: now, revokedAt: now } },
            { new: true },
          ),
        ).lean();
        return { outcome: 'reused', session: sessionRecord(compromised || existing) };
      }
      return { outcome: 'invalid', session: sessionRecord(existing) };
    },

    async revokeSession(sessionId, revokedAt) {
      const result = await AuthSession.updateOne(
        { revokedAt: null, sessionId },
        { $set: { revokedAt } },
      );
      return result.matchedCount > 0;
    },

    async revokeAllSessions(userId, revokedAt, exceptSessionId = null) {
      const query = { revokedAt: null, user: userId };
      if (exceptSessionId) query.sessionId = { $ne: exceptSessionId };
      const result = await AuthSession.updateMany(query, { $set: { revokedAt } });
      return result.modifiedCount;
    },

    async listSessionsForUser(userId) {
      const documents = await AuthSession.find({ user: userId }).sort({ createdAt: -1 }).lean();
      return documents.map(sessionRecord);
    },

    async createOneTimeToken(token) {
      const created = await IdentityOneTimeToken.create({
        consumedAt: token.consumedAt,
        expiresAt: token.expiresAt,
        purpose: token.purpose,
        tokenHash: token.tokenHash,
        tokenId: token.id,
        user: token.userId,
      });
      return oneTimeTokenRecord(
        await IdentityOneTimeToken.findById(created._id).select('+tokenHash').lean(),
      );
    },

    async invalidateOneTimeTokens(userId, purpose, invalidatedAt) {
      await IdentityOneTimeToken.updateMany(
        { consumedAt: null, purpose, user: userId },
        { $set: { consumedAt: invalidatedAt } },
      );
    },

    async consumeOneTimeToken({ consumedAt, purpose, tokenHash, tokenId }) {
      return oneTimeTokenRecord(
        await IdentityOneTimeToken.findOneAndUpdate(
          {
            consumedAt: null,
            expiresAt: { $gt: consumedAt },
            purpose,
            tokenHash,
            tokenId,
          },
          { $set: { consumedAt } },
          { new: true },
        )
          .select('+tokenHash')
          .lean(),
      );
    },
  });
}

module.exports = { createMongooseIdentityRepository, userRecord };
