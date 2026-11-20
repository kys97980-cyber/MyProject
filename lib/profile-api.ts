import { getServerBaseUrl } from "@/lib/server-config";
import { getServerAuthHeaders } from "@/lib/server-auth";

export type ServerProfileRecord = {
  email: string;
  displayName: string;
  avatarUri?: string;
  updatedAt?: string;
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

async function profileRequest<T>(path: string, init?: RequestInit, accessToken?: string): Promise<{ status: number; payload: T | null }> {
  const baseUrl = await getServerBaseUrl();
  if (!baseUrl) throw new Error("서버 주소가 설정되지 않았습니다.");
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : await getServerAuthHeaders()),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => null) as T | null;
  return { status: response.status, payload };
}

export async function getServerProfile(email: string, accessToken?: string) {
  const normalizedEmail = normalizeEmail(email);
  const pending = profileRequests.get(normalizedEmail);
  if (pending) return pending;
  const requestPromise = (async () => {
    const result = await profileRequest<{ profile?: ServerProfileRecord; error?: string }>(`/api/profiles/${encodeURIComponent(normalizedEmail)}`, undefined, accessToken);
    if (result.status === 404 || result.status === 405) return null;
    if (result.status < 200 || result.status >= 300 || !result.payload?.profile) {
      const detail = typeof result.payload?.error === "string" ? `: ${result.payload.error}` : "";
      throw new Error(`프로필 조회 실패 (${result.status})${detail}`);
    }
    return result.payload.profile;
  })();
  profileRequests.set(normalizedEmail, requestPromise);
  try {
    return await requestPromise;
  } finally {
    if (profileRequests.get(normalizedEmail) === requestPromise) profileRequests.delete(normalizedEmail);
  }
}

const profileRequests = new Map<string, Promise<ServerProfileRecord | null>>();
let profilesRequest: Promise<ServerProfileRecord[] | null> | null = null;

export async function getServerProfiles() {
  if (profilesRequest) return profilesRequest;
  const requestPromise = (async () => {
    const result = await profileRequest<{ profiles?: ServerProfileRecord[] }>("/api/profiles");
    if (result.status === 404 || result.status === 405) return null;
    if (result.status < 200 || result.status >= 300) throw new Error(`프로필 목록 조회 실패 (${result.status})`);
    return result.payload?.profiles ?? [];
  })();
  profilesRequest = requestPromise;
  try {
    return await requestPromise;
  } finally {
    if (profilesRequest === requestPromise) profilesRequest = null;
  }
}

export async function updateServerProfileRecord(email: string, profile: Pick<ServerProfileRecord, "displayName" | "avatarUri">) {
  const normalizedEmail = normalizeEmail(email);
  const result = await profileRequest<{ profile?: ServerProfileRecord }>(`/api/profiles/${encodeURIComponent(normalizedEmail)}`, {
    method: "PUT",
    body: JSON.stringify(profile),
  });
  if (result.status === 404 || result.status === 405) return null;
  if (result.status < 200 || result.status >= 300 || !result.payload?.profile) throw new Error(`프로필 저장 실패 (${result.status})`);
  profileRequests.delete(normalizedEmail);
  profilesRequest = null;
  return result.payload.profile;
}
