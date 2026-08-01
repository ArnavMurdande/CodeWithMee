import { uuidV5 } from './canonical-json.mjs';

export const TARGET_NAMESPACE = '8f5ed0d7-4f62-5d0d-91bc-8af3ce4fac17';

/**
 * @param {string} collectionName
 * @param {string} sourceId
 * @param {string} target
 */
export function migrationTargetId(collectionName, sourceId, target) {
  return uuidV5(TARGET_NAMESPACE, `${collectionName}:${sourceId}:${target}`);
}

/**
 * Stable child identifiers never depend on database sequence state or import order.
 *
 * @param {string} collectionName
 * @param {string} sourceId
 * @param {string} childType
 * @param {...(string | number)} pathParts
 */
export function migrationChildId(collectionName, sourceId, childType, ...pathParts) {
  const path = pathParts.map((part) => String(part)).join(':');
  return migrationTargetId(collectionName, sourceId, path ? `${childType}:${path}` : childType);
}
