export type AuthenticatedMediaEntry = {
  uri: string;
  blobUri?: string;
  headers: Record<string, string>;
  validUntil: number;
  references: number;
  retired: boolean;
};

const mediaCache = new Map<string, AuthenticatedMediaEntry>();
let cacheGeneration = 0;

function revokeWhenUnused(entry: AuthenticatedMediaEntry) {
  if (entry.retired && entry.references === 0 && entry.blobUri && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(entry.blobUri);
    entry.blobUri = undefined;
  }
}

function retire(entry: AuthenticatedMediaEntry) {
  entry.retired = true;
  revokeWhenUnused(entry);
}

export function getAuthenticatedMediaCacheGeneration() {
  return cacheGeneration;
}

export function getAuthenticatedMedia(key: string) {
  const entry = mediaCache.get(key);
  if (!entry) return undefined;
  if (entry.validUntil <= Date.now() + 5_000) {
    mediaCache.delete(key);
    retire(entry);
    return undefined;
  }
  mediaCache.delete(key);
  mediaCache.set(key, entry);
  return entry;
}

export function rememberAuthenticatedMedia(key: string, entry: AuthenticatedMediaEntry, generation: number) {
  if (generation !== cacheGeneration) {
    retire(entry);
    return;
  }
  const previous = mediaCache.get(key);
  if (previous && previous !== entry) retire(previous);
  mediaCache.delete(key);
  mediaCache.set(key, entry);
  while (mediaCache.size > 128) {
    const oldestKey = mediaCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = mediaCache.get(oldestKey);
    mediaCache.delete(oldestKey);
    if (oldest) retire(oldest);
  }
}

export function retainAuthenticatedMedia(entry: AuthenticatedMediaEntry) {
  entry.references += 1;
}

export function releaseAuthenticatedMedia(entry: AuthenticatedMediaEntry) {
  entry.references = Math.max(0, entry.references - 1);
  revokeWhenUnused(entry);
}

export function discardAuthenticatedMediaAfterPendingConsumers(entry: AuthenticatedMediaEntry) {
  setTimeout(() => {
    if (entry.references === 0) retire(entry);
  }, 0);
}

/** Clears runtime-only bytes; nothing is ever read from persistent device storage. */
export function clearAuthenticatedMediaCache() {
  cacheGeneration += 1;
  for (const entry of mediaCache.values()) retire(entry);
  mediaCache.clear();
}
