'use strict';

function createDisabledIdentityMailer({ logger = console } = {}) {
  return Object.freeze({
    async send(message) {
      logger.warn('identity_delivery_unavailable', { purpose: message.purpose });
      return Object.freeze({ delivered: false, providerMessageId: null });
    },
  });
}

function createCaptureIdentityMailer() {
  const messages = [];
  return Object.freeze({
    async send(message) {
      const captured = structuredClone(message);
      messages.push(captured);
      return Object.freeze({
        delivered: true,
        providerMessageId: `capture-${messages.length}`,
      });
    },
    messages,
  });
}

module.exports = { createCaptureIdentityMailer, createDisabledIdentityMailer };
