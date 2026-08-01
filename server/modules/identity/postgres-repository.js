'use strict';

const { createHash, randomUUID } = require('node:crypto');

const { requirePostgresPool, withPostgresTransaction } = require('../persistence/postgres-helpers');

function userRecord(row) {
  if (!row) return null;
  return {
    authorityRevision: row.authority_revision,
    avatarUrl: null,
    createdAt: row.created_at,
    displayName: row.display_name,
    email: row.email_display,
    emailVerifiedAt: row.email_verified_at,
    id: row.id,
    platformRole: row.platform_role,
    status: row.status,
    updatedAt: row.updated_at,
    username: row.username,
  };
}

function identityRecord(row) {
  if (!row) return null;
  return {
    createdAt: row.created_at,
    id: row.id,
    passwordHash: row.password_hash,
    provider: row.provider,
    providerSubject: row.provider_subject,
    updatedAt: row.updated_at,
    userId: row.user_id,
  };
}

function oneTimeTokenRecord(row) {
  if (!row) return null;
  return {
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    id: row.id,
    purpose: row.kind,
    tokenHash: row.token_hash,
    userId: row.user_id,
  };
}

function sessionRecord(row) {
  if (!row) return null;
  return {
    authenticatedAt: row.authenticated_at,
    client: row.client,
    compromisedAt: row.compromised_at,
    consumedTokenHashes: row.consumed_token_hashes || [],
    createdAt: row.created_at,
    csrfTokenHash: row.csrf_secret_hash,
    currentTokenHash: row.current_token_hash,
    expiresAt: row.absolute_expires_at,
    id: row.family_id,
    idleExpiresAt: row.idle_expires_at,
    ipHash: row.ip_prefix,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    updatedAt: row.updated_at,
    userAgent: row.device_label,
    userId: row.user_id,
  };
}

async function sessionByFamilyId(queryable, familyId, { lock = false } = {}) {
  const result = await queryable.query(
    `SELECT s.*,
            current_token.token_hash AS current_token_hash,
            COALESCE(
              (SELECT jsonb_agg(consumed.token_hash ORDER BY consumed.consumed_at, consumed.id)
                 FROM session_refresh_tokens consumed
                WHERE consumed.session_id = s.id
                  AND consumed.state = 'consumed'),
              '[]'::jsonb
            ) AS consumed_token_hashes
       FROM sessions s
       LEFT JOIN LATERAL (
         SELECT token_hash
           FROM session_refresh_tokens
          WHERE session_id = s.id AND state = 'current'
          LIMIT 1
       ) current_token ON TRUE
      WHERE s.family_id = $1
      ${lock ? 'FOR UPDATE OF s' : ''}`,
    [familyId],
  );
  return result.rows[0] || null;
}

function hashUserAgent(value) {
  if (!value) return null;
  return createHash('sha256').update(String(value)).digest('hex');
}

function duplicateIdentityError(error) {
  if (error?.code !== '23505') return error;
  if (error.constraint === 'users_email_normalized_key') error.code = 'duplicate_email';
  else error.code = 'duplicate_identity';
  return error;
}

function createPostgresIdentityRepository(pool) {
  requirePostgresPool(pool);
  return Object.freeze({
    async createUserWithIdentity({ identity, user }) {
      try {
        return await withPostgresTransaction(pool, async (client) => {
          const createdUser = await client.query(
            `INSERT INTO users
              (email_normalized, email_display, display_name, username, status, platform_role,
               email_verified_at, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             RETURNING *`,
            [
              user.email,
              user.email,
              user.displayName,
              user.username,
              user.status,
              user.platformRole,
              user.emailVerifiedAt,
            ],
          );
          const createdIdentity = await client.query(
            `INSERT INTO auth_identities
              (user_id, provider, provider_subject, password_hash)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [
              createdUser.rows[0].id,
              identity.provider,
              identity.providerSubject,
              identity.passwordHash,
            ],
          );
          return {
            identity: identityRecord(createdIdentity.rows[0]),
            user: userRecord(createdUser.rows[0]),
          };
        });
      } catch (error) {
        throw duplicateIdentityError(error);
      }
    },

    async findUserByEmail(normalizedEmail) {
      const result = await pool.query('SELECT * FROM users WHERE email_normalized = $1', [
        normalizedEmail,
      ]);
      return userRecord(result.rows[0]);
    },

    async findUserById(userId) {
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
      return userRecord(result.rows[0]);
    },

    async findIdentity(provider, providerSubject) {
      const result = await pool.query(
        'SELECT * FROM auth_identities WHERE provider = $1 AND provider_subject = $2',
        [provider, providerSubject],
      );
      return identityRecord(result.rows[0]);
    },

    async findIdentityForUser(provider, userId) {
      const result = await pool.query(
        'SELECT * FROM auth_identities WHERE provider = $1 AND user_id = $2',
        [provider, userId],
      );
      return identityRecord(result.rows[0]);
    },

    async findLegacyLocalIdentityByEmail() {
      return null;
    },

    async linkIdentity(identity) {
      try {
        const inserted = await pool.query(
          `INSERT INTO auth_identities
            (user_id, provider, provider_subject, password_hash)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (provider, provider_subject) DO NOTHING
           RETURNING *`,
          [identity.userId, identity.provider, identity.providerSubject, identity.passwordHash],
        );
        const row =
          inserted.rows[0] ||
          (
            await pool.query(
              'SELECT * FROM auth_identities WHERE provider = $1 AND provider_subject = $2',
              [identity.provider, identity.providerSubject],
            )
          ).rows[0];
        if (!row || row.user_id !== identity.userId) {
          const error = new Error('duplicate_identity');
          error.code = 'duplicate_identity';
          throw error;
        }
        return identityRecord(row);
      } catch (error) {
        throw duplicateIdentityError(error);
      }
    },

    async updateIdentityPassword(identityId, passwordHash) {
      const result = await pool.query(
        `UPDATE auth_identities
            SET password_hash = $2, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND provider = 'local'
          RETURNING *`,
        [identityId, passwordHash],
      );
      return identityRecord(result.rows[0]);
    },

    async markEmailVerified(userId, verifiedAt) {
      const result = await pool.query(
        `UPDATE users
            SET email_verified_at = $2, updated_at = $2
          WHERE id = $1
          RETURNING *`,
        [userId, verifiedAt],
      );
      return userRecord(result.rows[0]);
    },

    async updateUserStatus(userId, status) {
      const result = await pool.query(
        `UPDATE users
            SET status = $2, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING *`,
        [userId, status],
      );
      return userRecord(result.rows[0]);
    },

    async updateGoogleProfile(userId) {
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
      return userRecord(result.rows[0]);
    },

    async createSession(session) {
      await withPostgresTransaction(pool, async (client) => {
        await client.query(
          `INSERT INTO sessions
            (id, user_id, client, family_id, authenticated_at, absolute_expires_at,
             idle_expires_at, revoked_at, compromised_at, last_used_at, device_label,
             user_agent_hash, ip_prefix, csrf_secret_hash, created_at, updated_at)
           VALUES
            ($1, $2, $3, $1, $4, $5, $6, $7, $8, $9, NULL, $10, $11, $12, $13, $13)`,
          [
            session.id,
            session.userId,
            session.client,
            session.authenticatedAt,
            session.expiresAt,
            session.idleExpiresAt,
            session.revokedAt,
            session.compromisedAt,
            session.lastUsedAt,
            hashUserAgent(session.userAgent),
            session.ipHash,
            session.csrfTokenHash,
            session.createdAt,
          ],
        );
        await client.query(
          `INSERT INTO session_refresh_tokens
            (id, session_id, token_hash, state, issued_at, expires_at)
           VALUES ($1, $2, $3, 'current', $4, $5)`,
          [
            randomUUID(),
            session.id,
            session.currentTokenHash,
            session.createdAt,
            session.expiresAt,
          ],
        );
      });
      return sessionRecord(await sessionByFamilyId(pool, session.id));
    },

    async findSession(sessionId) {
      return sessionRecord(await sessionByFamilyId(pool, sessionId));
    },

    async rotateSession({
      currentTokenHash,
      idleExpiresAt,
      nextCsrfTokenHash,
      nextTokenHash,
      now,
      sessionId,
    }) {
      return withPostgresTransaction(pool, async (client) => {
        const existing = await sessionByFamilyId(client, sessionId, { lock: true });
        if (!existing) return { outcome: 'invalid', session: null };
        const current = await client.query(
          `SELECT *
             FROM session_refresh_tokens
            WHERE session_id = $1 AND token_hash = $2
            FOR UPDATE`,
          [existing.id, currentTokenHash],
        );
        const token = current.rows[0];
        const valid =
          token?.state === 'current' &&
          !existing.revoked_at &&
          existing.absolute_expires_at > now &&
          existing.idle_expires_at > now;
        if (valid) {
          await client.query(
            `UPDATE session_refresh_tokens
                SET state = 'consumed', consumed_at = $2
              WHERE id = $1`,
            [token.id, now],
          );
          const nextId = randomUUID();
          await client.query(
            `INSERT INTO session_refresh_tokens
              (id, session_id, token_hash, state, issued_at, expires_at)
             VALUES ($1, $2, $3, 'current', $4, $5)`,
            [nextId, existing.id, nextTokenHash, now, existing.absolute_expires_at],
          );
          await client.query(
            'UPDATE session_refresh_tokens SET replaced_by_token_id = $2 WHERE id = $1',
            [token.id, nextId],
          );
          await client.query(
            `UPDATE sessions
                SET csrf_secret_hash = $2, idle_expires_at = $3,
                    last_used_at = $4, updated_at = $4
              WHERE id = $1`,
            [existing.id, nextCsrfTokenHash, idleExpiresAt, now],
          );
          return {
            outcome: 'rotated',
            session: sessionRecord(await sessionByFamilyId(client, sessionId)),
          };
        }
        if (token?.state === 'consumed') {
          await client.query(
            `UPDATE sessions
                SET compromised_at = COALESCE(compromised_at, $2),
                    revoked_at = COALESCE(revoked_at, $2), updated_at = $2
              WHERE id = $1`,
            [existing.id, now],
          );
          return {
            outcome: 'reused',
            session: sessionRecord(await sessionByFamilyId(client, sessionId)),
          };
        }
        return { outcome: 'invalid', session: sessionRecord(existing) };
      });
    },

    async revokeSession(sessionId, revokedAt) {
      const result = await pool.query(
        `UPDATE sessions
            SET revoked_at = $2, updated_at = $2
          WHERE family_id = $1 AND revoked_at IS NULL`,
        [sessionId, revokedAt],
      );
      return result.rowCount > 0;
    },

    async revokeAllSessions(userId, revokedAt, exceptSessionId = null) {
      const result = await pool.query(
        `UPDATE sessions
            SET revoked_at = $2, updated_at = $2
          WHERE user_id = $1 AND revoked_at IS NULL
            AND ($3::uuid IS NULL OR family_id <> $3::uuid)`,
        [userId, revokedAt, exceptSessionId],
      );
      return result.rowCount;
    },

    async listSessionsForUser(userId) {
      const result = await pool.query(
        'SELECT family_id FROM sessions WHERE user_id = $1 ORDER BY created_at DESC, id DESC',
        [userId],
      );
      return Promise.all(
        result.rows.map(async (row) => sessionRecord(await sessionByFamilyId(pool, row.family_id))),
      );
    },

    async createOneTimeToken(token) {
      const result = await pool.query(
        `INSERT INTO identity_one_time_tokens
          (id, user_id, kind, token_hash, expires_at, consumed_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          token.id,
          token.userId,
          token.purpose,
          token.tokenHash,
          token.expiresAt,
          token.consumedAt,
          token.createdAt,
        ],
      );
      return oneTimeTokenRecord(result.rows[0]);
    },

    async invalidateOneTimeTokens(userId, purpose, invalidatedAt) {
      await pool.query(
        `UPDATE identity_one_time_tokens
            SET consumed_at = $3
          WHERE user_id = $1 AND kind = $2 AND consumed_at IS NULL`,
        [userId, purpose, invalidatedAt],
      );
    },

    async consumeOneTimeToken({ consumedAt, purpose, tokenHash, tokenId }) {
      const result = await pool.query(
        `UPDATE identity_one_time_tokens
            SET consumed_at = $1
          WHERE id = $2 AND kind = $3 AND token_hash = $4
            AND consumed_at IS NULL AND expires_at > $1
          RETURNING *`,
        [consumedAt, tokenId, purpose, tokenHash],
      );
      return oneTimeTokenRecord(result.rows[0]);
    },
  });
}

module.exports = {
  createPostgresIdentityRepository,
  identityRecord,
  oneTimeTokenRecord,
  sessionRecord,
  userRecord,
};
