import type { ChatMessage } from "./chat-store";

export type SharedMessageSnapshot = {
  cacheKey: string;
  messages: ChatMessage[];
  cursor: number;
};

let currentSnapshot: SharedMessageSnapshot | null = null;

export function createMessageSnapshotKey(email: string, role: string, serverUrl: string) {
  return JSON.stringify([email.trim().toLowerCase(), role, serverUrl.trim()]);
}

export function getMessageSnapshot(cacheKey: string): SharedMessageSnapshot | null {
  if (currentSnapshot && currentSnapshot.cacheKey !== cacheKey) {
    currentSnapshot = null;
    return null;
  }
  return currentSnapshot;
}

export function replaceMessageSnapshot(cacheKey: string, messages: ChatMessage[], cursor: number) {
  currentSnapshot = { cacheKey, messages, cursor: Number.isSafeInteger(cursor) ? cursor : 0 };
  return currentSnapshot;
}

function combineReadBy(previous: string[] | undefined, incoming: string[] | undefined) {
  if (!incoming?.length) return previous;
  const seen = new Set((previous ?? []).map((id) => id.trim().toLowerCase()));
  const result = [...(previous ?? [])];
  for (const id of incoming) {
    const normalized = id.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(id);
  }
  return result.length ? result : undefined;
}

export function mergeMessageSnapshot(cacheKey: string, incoming: ChatMessage[], cursor: number) {
  const current = getMessageSnapshot(cacheKey);
  if (!current) return null;

  const indexById = new Map(current.messages.map((message, index) => [message.id, index]));
  let nextMessages: ChatMessage[] | null = null;
  for (const message of incoming) {
    const existingIndex = indexById.get(message.id);
    if (existingIndex === undefined) {
      if (!nextMessages) nextMessages = [...current.messages];
      indexById.set(message.id, nextMessages.length);
      nextMessages.push(message);
      continue;
    }

    const existing = (nextMessages ?? current.messages)[existingIndex];
    const readBy = combineReadBy(existing.readBy, message.readBy);
    if (readBy !== existing.readBy && (readBy?.length ?? 0) !== (existing.readBy?.length ?? 0)) {
      if (!nextMessages) nextMessages = [...current.messages];
      nextMessages[existingIndex] = { ...existing, readBy };
    }
  }

  const nextCursor = Number.isSafeInteger(cursor) ? Math.max(current.cursor, cursor) : current.cursor;
  if (!nextMessages && nextCursor === current.cursor) return current;
  currentSnapshot = { cacheKey, messages: nextMessages ?? current.messages, cursor: nextCursor };
  return currentSnapshot;
}

export function advanceMessageSnapshotCursor(cacheKey: string, cursor: number) {
  const current = getMessageSnapshot(cacheKey);
  if (!current || !Number.isSafeInteger(cursor) || cursor <= current.cursor) return current;
  currentSnapshot = { ...current, cursor };
  return currentSnapshot;
}

export function clearMessageSnapshotCache() {
  currentSnapshot = null;
}
