export type AccessTokenListener = (accessToken: string | null) => void;

let currentAccessToken: string | null = null;
const listeners = new Set<AccessTokenListener>();

export function getAccessToken(): string | null {
  return currentAccessToken;
}

export function setAccessToken(accessToken: string | null): void {
  if (currentAccessToken === accessToken) return;
  currentAccessToken = accessToken;
  for (const listener of listeners) listener(currentAccessToken);
}

export function clearAccessToken(): void {
  setAccessToken(null);
}

export function subscribeToAccessToken(listener: AccessTokenListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
