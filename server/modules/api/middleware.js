'use strict';

const { validateRequest } = require('../http/request-contract');
const { schemas } = require('./contracts');
const { getOperation } = require('./operations');

function operationContract(operationId) {
  const operation = getOperation(operationId);
  return validateRequest(operation.request, { components: { schemas } });
}

module.exports = { operationContract };
