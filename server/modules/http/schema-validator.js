'use strict';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ContractValidationError extends Error {
  constructor(issues, location = 'request') {
    super('The request does not satisfy the published API contract.');
    this.code = 'invalid_request';
    this.issues = Object.freeze(issues.map((issue) => Object.freeze({ ...issue })));
    this.location = location;
    this.name = 'ContractValidationError';
    this.status = 400;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function escapePointer(value) {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1');
}

function typeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isPlainObject(value);
  if (type === 'integer') return Number.isSafeInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function validFormat(value, format) {
  if (format === 'date-time') {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  }
  if (format === 'email') return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (format === 'uuid') return UUID_PATTERN.test(value);
  if (format === 'uri') {
    try {
      const parsed = new URL(value);
      return Boolean(parsed.protocol);
    } catch {
      return false;
    }
  }
  return true;
}

function resolveReference(schema, components) {
  if (!schema?.$ref) return schema;
  const prefix = '#/components/schemas/';
  if (!schema.$ref.startsWith(prefix))
    throw new Error(`Unsupported schema reference: ${schema.$ref}`);
  const name = schema.$ref.slice(prefix.length);
  const resolved = components?.schemas?.[name];
  if (!resolved) throw new Error(`Unresolved schema reference: ${schema.$ref}`);
  return resolved;
}

function validateNode(value, rawSchema, context) {
  const schema = resolveReference(rawSchema, context.components);
  const { issues, path } = context;
  if (issues.length >= context.maxIssues) return;

  if (Array.isArray(schema.oneOf)) {
    const successes = schema.oneOf.filter((candidate) => {
      const candidateIssues = [];
      validateNode(value, candidate, { ...context, issues: candidateIssues });
      return candidateIssues.length === 0;
    });
    if (successes.length !== 1) issues.push({ code: 'one_of', keyword: 'oneOf', pointer: path });
    return;
  }

  if (schema.const !== undefined && !Object.is(value, schema.const)) {
    issues.push({ code: 'constant', keyword: 'const', pointer: path });
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    issues.push({ code: 'enum', keyword: 'enum', pointer: path });
    return;
  }

  const acceptedTypes = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (acceptedTypes.length && !acceptedTypes.some((type) => typeMatches(value, type))) {
    issues.push({ code: 'type', keyword: 'type', pointer: path });
    return;
  }
  if (value === null) return;

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      issues.push({ code: 'min_length', keyword: 'minLength', pointer: path });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      issues.push({ code: 'max_length', keyword: 'maxLength', pointer: path });
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) {
      issues.push({ code: 'pattern', keyword: 'pattern', pointer: path });
    }
    if (schema.format && !validFormat(value, schema.format)) {
      issues.push({ code: 'format', keyword: 'format', pointer: path });
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      issues.push({ code: 'minimum', keyword: 'minimum', pointer: path });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      issues.push({ code: 'maximum', keyword: 'maximum', pointer: path });
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      issues.push({ code: 'min_items', keyword: 'minItems', pointer: path });
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      issues.push({ code: 'max_items', keyword: 'maxItems', pointer: path });
    }
    if (schema.items) {
      value.forEach((item, index) =>
        validateNode(item, schema.items, { ...context, path: `${path}/${index}` }),
      );
    }
  }

  if (isPlainObject(value)) {
    const properties = schema.properties || {};
    for (const required of schema.required || []) {
      if (!Object.hasOwn(value, required)) {
        issues.push({
          code: 'required',
          keyword: 'required',
          pointer: `${path}/${escapePointer(required)}`,
        });
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) {
        validateNode(child, properties[key], {
          ...context,
          path: `${path}/${escapePointer(key)}`,
        });
      } else if (schema.additionalProperties === false) {
        issues.push({
          code: 'additional_property',
          keyword: 'additionalProperties',
          pointer: `${path}/${escapePointer(key)}`,
        });
      } else if (isPlainObject(schema.additionalProperties)) {
        validateNode(child, schema.additionalProperties, {
          ...context,
          path: `${path}/${escapePointer(key)}`,
        });
      }
    }
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) {
      issues.push({ code: 'min_properties', keyword: 'minProperties', pointer: path });
    }
    if (schema.maxProperties !== undefined && Object.keys(value).length > schema.maxProperties) {
      issues.push({ code: 'max_properties', keyword: 'maxProperties', pointer: path });
    }
  }
}

function validateSchema(value, schema, { components = {}, maxIssues = 20 } = {}) {
  const issues = [];
  validateNode(value, schema, { components, issues, maxIssues, path: '' });
  return Object.freeze({ issues: Object.freeze(issues), valid: issues.length === 0 });
}

function assertSchema(value, schema, options = {}) {
  const result = validateSchema(value, schema, options);
  if (!result.valid) throw new ContractValidationError(result.issues, options.location);
  return value;
}

module.exports = {
  ContractValidationError,
  assertSchema,
  isPlainObject,
  validateSchema,
};
