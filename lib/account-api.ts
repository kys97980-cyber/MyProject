import { resolveMediaUrl } from "@/lib/media-api";
import { getServerBaseUrl } from "@/lib/server-config";
import { clearServerAuthToken, getServerAuthHeaders, saveServerAuthToken } from "@/lib/server-auth";
import { getServerProfile, getServerProfiles, updateServerProfileRecord } from "@/lib/profile-api";

export type ServerAccountProfile = {
  email: string;
  displayName: string;
  role: "artist" | "fan";
  avatarUri?: string;
  profileUpdatedAt?: string;
};

export const normalizeAccountEmail = (email: string) => email.trim().toLowerCase();

export function findAccountProfile(accounts: ServerAccountProfile[], email: string, role: ServerAccountProfile["role"]) {
  const normalizedEmail = normalizeAccountEmail(email);
  const exactMatch = accounts.find((account) => normalizeAccountEmail(account.email) === normalizedEmail && account.role === role);
  if (exactMatch) return exactMatch;
  if (role === "artist") {
    const artists = accounts.filter((account) => account.role === "artist");
    if (artists.length === 1) return artists[0];
  }
  return undefined;
}

export class AccountApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AccountApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const apiBase = await getServerBaseUrl();
  if (!apiBase) throw new Error("서버 주소가 설정되지 않았습니다. EXPO_PUBLIC_MEDIA_API_URL을 확인해 주세요.");
  const publicAuthRoute = path === "/api/accounts/register" || path === "/api/accounts/migrate" || path === "/api/accounts/login";
  const authHeaders = publicAuthRoute ? {} : await getServerAuthHeaders();
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...init,
      cache: "no-store",
      headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...authHeaders, ...init?.headers },
    });
  } catch {
    throw new Error("계정 서버에 연결할 수 없습니다. PC 서버와 주소를 확인해 주세요.");
  }
  const payload = await response.json().catch(() => ({})) as { account?: ServerAccountProfile; accounts?: ServerAccountProfile[]; error?: string };
  if (!response.ok) throw new AccountApiError(response.status, payload.error || `서버 요청 실패 (${response.status})`);
  return payload as T;
}

const accountPath = (email: string) => `/api/accounts/${encodeURIComponent(normalizeAccountEmail(email))}`;

/** Auth/account endpoints identify the user; display name and avatar come only from profiles.json. */
async function attachSeparateProfile(account: ServerAccountProfile, accessToken?: string): Promise<ServerAccountProfile> {
  const profile = await getServerProfile(account.email, accessToken);
  if (!profile) {
    throw new Error(`분리된 프로필 레코드를 찾을 수 없습니다 (${normalizeAccountEmail(account.email)}). PC 서버 프로필 패치 적용 상태를 확인해 주세요.`);
  }
  return {
    ...account,
    displayName: profile.displayName,
    avatarUri: resolveMediaUrl(profile.avatarUri),
    profileUpdatedAt: profile.updatedAt,
  };
}

export async function registerServerAccount(input: ServerAccountProfile & { password: string }) {
  const result = await request<{ account: ServerAccountProfile; token: string }>("/api/accounts/register", { method: "POST", body: JSON.stringify(input) });
  await saveServerAuthToken(result.token);
  return attachSeparateProfile(result.account, result.token);
}

export async function loginServerAccount(email: string, password: string) {
  const result = await request<{ account: ServerAccountProfile; token: string }>("/api/accounts/login", { method: "POST", body: JSON.stringify({ email, password }) });
  await saveServerAuthToken(result.token);
  return attachSeparateProfile(result.account, result.token);
}

export async function migrateLegacyServerAccount(input: ServerAccountProfile & { password: string }) {
  const result = await request<{ account: ServerAccountProfile; token: string }>("/api/accounts/migrate", { method: "POST", body: JSON.stringify(input) });
  await saveServerAuthToken(result.token);
  return attachSeparateProfile(result.account, result.token);
}

export async function logoutServerSession() {
  try { await request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }); }
  finally { await clearServerAuthToken(); }
}

const serverAccountRequests = new Map<string, Promise<ServerAccountProfile>>();
let profileDataGeneration = 0;

function invalidateProfileLookups(email?: string) {
  profileDataGeneration += 1;
  serverAccountRequests.clear();
  serverAccountsRequest = null;
}

export async function getServerAccount(email: string): Promise<ServerAccountProfile> {
  const key = normalizeAccountEmail(email);
  const pending = serverAccountRequests.get(key);
  if (pending) return pending;
  const generation = profileDataGeneration;
  const requestPromise: Promise<ServerAccountProfile> = (async () => {
    const { account } = await request<{ account: ServerAccountProfile }>(accountPath(key));
    const profile = await attachSeparateProfile(account);
    return generation === profileDataGeneration ? profile : getServerAccount(key);
  })();
  serverAccountRequests.set(key, requestPromise);
  try {
    return await requestPromise;
  } finally {
    if (serverAccountRequests.get(key) === requestPromise) serverAccountRequests.delete(key);
  }
}

let serverAccountsRequest: Promise<ServerAccountProfile[]> | null = null;

export async function getServerAccounts(): Promise<ServerAccountProfile[]> {
  if (serverAccountsRequest) return serverAccountsRequest;
  const generation = profileDataGeneration;
  const requestPromise: Promise<ServerAccountProfile[]> = (async () => {
    const result = await request<{ accounts: ServerAccountProfile[] }>("/api/accounts");
    const profiles = await getServerProfiles();
    if (generation !== profileDataGeneration) return getServerAccounts();
    if (!profiles) {
      throw new Error("PC 서버가 분리 프로필 목록 API를 제공하지 않습니다. server-profile-record 패치를 적용한 서버를 사용해 주세요.");
    }
    const byEmail = new Map(profiles.map((profile) => [normalizeAccountEmail(profile.email), profile]));
    return result.accounts.map((account) => {
      const profile = byEmail.get(normalizeAccountEmail(account.email));
      if (!profile) {
        throw new Error(`분리된 프로필 레코드를 찾을 수 없습니다 (${normalizeAccountEmail(account.email)}).`);
      }
      return {
        ...account,
        displayName: profile.displayName,
        avatarUri: resolveMediaUrl(profile.avatarUri),
        profileUpdatedAt: profile.updatedAt,
      };
    });
  })();
  serverAccountsRequest = requestPromise;
  try {
    return await requestPromise;
  } finally {
    if (serverAccountsRequest === requestPromise) serverAccountsRequest = null;
  }
}

export async function updateServerProfile(email: string, profile: Pick<ServerAccountProfile, "displayName" | "avatarUri">) {
  const savedProfile = await updateServerProfileRecord(email, profile);
  if (!savedProfile) {
    throw new Error("PC 서버가 분리 프로필 저장 API를 제공하지 않습니다. server-profile-record 패치를 적용한 서버를 사용해 주세요.");
  }
  const normalizedEmail = normalizeAccountEmail(email);
  invalidateProfileLookups(normalizedEmail);
  return {
    email: normalizedEmail,
    role: "fan" as const,
    displayName: savedProfile.displayName,
    avatarUri: resolveMediaUrl(savedProfile.avatarUri),
    profileUpdatedAt: savedProfile.updatedAt,
  };
}

export async function updateServerPassword(email: string, currentPassword: string, nextPassword: string) {
  await request<{ ok: boolean }>(`${accountPath(email)}/password`, { method: "PUT", body: JSON.stringify({ currentPassword, nextPassword }) });
}
