import AsyncStorage from "@react-native-async-storage/async-storage";
import { getServerAccounts, type ServerAccountProfile } from "@/lib/account-api";
import { normalizeAccountEmail } from "@/lib/account-api";
import { getServerBaseUrl } from "@/lib/server-config";
import { getServerAuthHeaders } from "@/lib/server-auth";

const JOIN_OPEN_KEY = "artist-dm.join-open.v1";
const BLOCKED_FANS_KEY = "artist-dm.blocked-fans.v1";
const BLOCKED_FANS_SERVER_MIGRATED_KEY = "artist-dm.blocked-fans-server-migrated.v1";

export type AccountProfile = ServerAccountProfile;

export async function getAccounts(): Promise<AccountProfile[]> {
  return getServerAccounts();
}

export async function getJoinOpen() {
  const stored = await AsyncStorage.getItem(JOIN_OPEN_KEY);
  return stored === null ? true : stored === "true";
}
export async function setJoinOpen(value: boolean) { await AsyncStorage.setItem(JOIN_OPEN_KEY, String(value)); }

async function getCachedBlockedFans() {
  const stored = await AsyncStorage.getItem(BLOCKED_FANS_KEY);
  if (!stored) return [];
  try {
    const value: unknown = JSON.parse(stored);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").map(normalizeAccountEmail) : [];
  } catch { return []; }
}

async function cacheBlockedFans(blockedFanIds: string[]) {
  const serialized = JSON.stringify(blockedFanIds);
  if (await AsyncStorage.getItem(BLOCKED_FANS_KEY) !== serialized) {
    await AsyncStorage.setItem(BLOCKED_FANS_KEY, serialized);
  }
}

async function updateServerBlockedFans(blockedFanIds: string[], updatedByEmail: string) {
	const baseUrl = await getServerBaseUrl();
	if (!baseUrl) throw new Error("PC dm-media-server 주소가 설정되지 않았습니다.");
  let response: Response;
	  try {
	    const authHeaders = await getServerAuthHeaders();
			response = await fetch(`${baseUrl}/api/moderation/blocked-fans`, {
	      method: "PUT",
	      headers: { "content-type": "application/json", ...authHeaders },
      body: JSON.stringify({ blockedFans: blockedFanIds, updatedByEmail: normalizeAccountEmail(updatedByEmail) }),
    });
  } catch {
    throw new Error("차단 상태를 PC dm-media-server에 저장하지 못했습니다. 서버 연결을 확인해 주세요.");
  }
  if (response.status === 404) {
    throw new Error("PC dm-media-server에 차단 동기화 API가 없습니다. 최신 server.js를 적용하고 재시작해 주세요.");
  }
  const payload = await response.json().catch(() => ({})) as { blockedFans?: unknown; error?: string };
  if (!response.ok) throw new Error(payload.error || `차단 상태 저장에 실패했습니다. (${response.status})`);
  if (!Array.isArray(payload.blockedFans)) throw new Error("PC 서버가 차단 상태를 올바르게 반환하지 않았습니다.");
  return Array.from(new Set(payload.blockedFans.filter((id): id is string => typeof id === "string").map(normalizeAccountEmail)));
}

export async function getBlockedFans(updatedByEmail?: string, signal?: AbortSignal) {
	const cached = await getCachedBlockedFans();
  const baseUrl = await getServerBaseUrl();
  if (!baseUrl) return cached;

  let response: Response;
  try {
    const authHeaders = await getServerAuthHeaders();
    response = await fetch(`${baseUrl}/api/moderation/blocked-fans`, { headers: authHeaders, signal, cache: "no-store" });
  } catch {
    throw new Error("PC dm-media-server에서 차단 상태를 확인할 수 없습니다. 서버 연결을 확인해 주세요.");
  }
  if (response.status === 404) return cached;
  const payload = await response.json().catch(() => ({})) as { blockedFans?: unknown; error?: string };
  if (!response.ok) throw new Error(payload.error || `차단 상태 조회에 실패했습니다. (${response.status})`);
  if (!Array.isArray(payload.blockedFans)) throw new Error("PC 서버가 차단 상태를 올바르게 반환하지 않았습니다.");
  const remote = Array.from(new Set(payload.blockedFans.filter((id): id is string => typeof id === "string").map(normalizeAccountEmail)));

  const migrationDone = await AsyncStorage.getItem(BLOCKED_FANS_SERVER_MIGRATED_KEY);
  if (updatedByEmail && migrationDone !== "true" && remote.length === 0 && cached.length > 0) {
    const migrated = await updateServerBlockedFans(cached, updatedByEmail);
    await cacheBlockedFans(migrated);
    await AsyncStorage.setItem(BLOCKED_FANS_SERVER_MIGRATED_KEY, "true");
    return migrated;
  }

  await cacheBlockedFans(remote);
  if (updatedByEmail) await AsyncStorage.setItem(BLOCKED_FANS_SERVER_MIGRATED_KEY, "true");
  return remote;
}

export function subscribeToBlockedFans(listener: (blockedFanIds: string[]) => void) {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function" || typeof window.removeEventListener !== "function") {
    return () => undefined;
  }
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== BLOCKED_FANS_KEY) return;
    try {
      const value: unknown = JSON.parse(event.newValue ?? "[]");
      listener(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").map(normalizeAccountEmail) : []);
    } catch {
      listener([]);
    }
  };
  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
}

export async function setFanBlocked(fanId: string, blocked: boolean, updatedByEmail: string) {
  const normalizedFanId = normalizeAccountEmail(fanId);
  const current = await getBlockedFans(updatedByEmail);
  const next = blocked
    ? Array.from(new Set([...current, normalizedFanId]))
    : current.filter((id) => normalizeAccountEmail(id) !== normalizedFanId);
	if (!(await getServerBaseUrl())) {
    await cacheBlockedFans(next);
    return next;
  }
  const saved = await updateServerBlockedFans(next, updatedByEmail);
  await cacheBlockedFans(saved);
  await AsyncStorage.setItem(BLOCKED_FANS_SERVER_MIGRATED_KEY, "true");
  return saved;
}
