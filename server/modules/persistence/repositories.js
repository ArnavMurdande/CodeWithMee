'use strict';

const { createMongooseAuthorityRepository } = require('../authority/mongoose-repository');
const { createPostgresAuthorityRepository } = require('../authority/postgres-repository');
const { createMongooseIdentityRepository } = require('../identity/mongoose-repository');
const { createPostgresIdentityRepository } = require('../identity/postgres-repository');
const { createMongooseOrganizationRepository } = require('../organizations/mongoose-repository');
const { createPostgresOrganizationRepository } = require('../organizations/postgres-repository');
const { PERSISTENCE_DOMAIN, PERSISTENCE_STORE } = require('./contracts');
const { createShadowReadRepository } = require('./shadow-repository');

const SHADOW_METHODS = Object.freeze({
  [PERSISTENCE_DOMAIN.AUTHORITY]: Object.freeze(['listUsers']),
  [PERSISTENCE_DOMAIN.IDENTITY]: Object.freeze(['findIdentity', 'findUserByEmail']),
  [PERSISTENCE_DOMAIN.ORGANIZATIONS]: Object.freeze(['findOrganizationBySlug']),
});

function repositoriesForStore(store, postgresPool) {
  if (store === PERSISTENCE_STORE.POSTGRES) {
    if (!postgresPool) throw new Error('PostgreSQL repositories require an active pool.');
    return {
      authority: createPostgresAuthorityRepository(postgresPool),
      identity: createPostgresIdentityRepository(postgresPool),
      organizations: createPostgresOrganizationRepository(postgresPool),
    };
  }
  return {
    authority: createMongooseAuthorityRepository(),
    identity: createMongooseIdentityRepository(),
    organizations: createMongooseOrganizationRepository(),
  };
}

function createRuntimeRepositories({ logger = console, persistence, postgresPool }) {
  const store = persistence.stores.identity;
  const primary = repositoriesForStore(store, postgresPool);
  if (!persistence.shadowDomains.length) {
    return Object.freeze({ ...primary, async drainShadowReads() {} });
  }
  const secondaryStore =
    store === PERSISTENCE_STORE.POSTGRES ? PERSISTENCE_STORE.MONGOOSE : PERSISTENCE_STORE.POSTGRES;
  const secondary = repositoriesForStore(secondaryStore, postgresPool);
  const selected = { ...primary };
  for (const domain of persistence.shadowDomains) {
    selected[domain] = createShadowReadRepository({
      domain,
      logger,
      methods: SHADOW_METHODS[domain],
      primary: primary[domain],
      secondary: secondary[domain],
    });
  }
  return Object.freeze({
    ...selected,
    async drainShadowReads() {
      await Promise.all(
        persistence.shadowDomains.map((domain) => selected[domain].$drainShadowReads()),
      );
    },
  });
}

module.exports = { SHADOW_METHODS, createRuntimeRepositories };
