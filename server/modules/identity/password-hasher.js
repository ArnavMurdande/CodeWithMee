'use strict';

const argon2 = require('argon2');
const bcrypt = require('bcryptjs');

const ARGON2_OPTIONS = Object.freeze({
  hashLength: 32,
  memoryCost: 19 * 1024,
  parallelism: 1,
  timeCost: 2,
  type: argon2.argon2id,
});

const BCRYPT_PREFIX = /^\$2[aby]\$/;
const ARGON2ID_PREFIX = /^\$argon2id\$/;

function createPasswordHasher() {
  const dummyHash = argon2.hash('CodeWithMee timing-only credential', ARGON2_OPTIONS);

  return Object.freeze({
    async hash(password) {
      return argon2.hash(password, ARGON2_OPTIONS);
    },

    async verify(passwordHash, candidate) {
      if (!passwordHash) {
        await argon2.verify(await dummyHash, candidate);
        return Object.freeze({ matches: false, needsRehash: false });
      }

      if (ARGON2ID_PREFIX.test(passwordHash)) {
        const matches = await argon2.verify(passwordHash, candidate);
        return Object.freeze({
          matches,
          needsRehash: matches && argon2.needsRehash(passwordHash, ARGON2_OPTIONS),
        });
      }

      if (BCRYPT_PREFIX.test(passwordHash)) {
        const matches = await bcrypt.compare(candidate, passwordHash);
        return Object.freeze({ matches, needsRehash: matches });
      }

      await argon2.verify(await dummyHash, candidate);
      return Object.freeze({ matches: false, needsRehash: false });
    },
  });
}

module.exports = { ARGON2_OPTIONS, createPasswordHasher };
