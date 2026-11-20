import AsyncStorage from "@react-native-async-storage/async-storage";
import { getJoinOpen } from "@/lib/moderation-store";
import {
  AccountApiError,
  getServerAccount,
  loginServerAccount,
  logoutServerSession,
  migrateLegacyServerAccount,
  registerServerAccount,
  updateServerPassword,
  updateServerProfile,
  type ServerAccountProfile,
} from "@/lib/account-api";
import { clearServerAuthToken, getServerAuthToken } from "@/lib/server-auth";
import { getSessionValue, removeSessionValue, setSessionValue } from "@/lib/session-storage";
import { clearAuthenticatedMediaCache } from "@/lib/authenticated-media-cache";
import { publishProfileChange } from "@/lib/profile-change-store";
import { clearMessageSnapshotCache } from "@/lib/chat-snapshot-cache";

export type LocalAccount = ServerAccountProfile & { password?: string };

const ACCOUNT_KEY = "artist-dm.accounts.v2";
const LEGACY_ACCOUNT_KEY = "artist-dm.account";
const SESSION_KEY = "artist-dm.session";
const LOCAL_DATA_KEYS = [ACCOUNT_KEY, LEGACY_ACCOUNT_KEY, SESSION_KEY, "artist-dm.server-session-token.v1", "artist-dm.messages.v2", "artist-dm.direct-conversations.v1", "artist-dm.join-open.v1", "artist-dm.blocked-fans.v1", "artist-dm.members.v1"];
const normalizeEmail = (email: string) => email.trim().toLowerCase();

async function readAccounts(): Promise<LocalAccount[]> {
  const stored = await AsyncStorage.getItem(ACCOUNT_KEY);
  if (stored) {
    try { return JSON.parse(stored) as LocalAccount[]; } catch { return []; }
  }
  const legacy = await AsyncStorage.getItem(LEGACY_ACCOUNT_KEY);
  if (!legacy) return [];
  try { return [{ role: "fan", ...JSON.parse(legacy) }] as LocalAccount[]; } catch { return []; }
}

async function writeAccountCache(account: ServerAccountProfile) {
  const accounts = await readAccounts();
  const next = [...accounts.filter((item) => normalizeEmail(item.email) !== normalizeEmail(account.email)), { ...account }];
  await AsyncStorage.setItem(ACCOUNT_KEY, JSON.stringify(next));
}

async function getCachedAccount(email: string) {
  const account = (await readAccounts()).find((candidate) => normalizeEmail(candidate.email) === normalizeEmail(email));
  if (!account) return null;
  return { ...account };
}

async function refreshAccount(email: string) {
  try {
    const account = await getServerAccount(email);
    await writeAccountCache(account);
    return account as LocalAccount;
  } catch (error) {
    const cached = await getCachedAccount(email);
    if (error instanceof AccountApiError && error.status === 404 && cached?.password) {
      try {
        const migrated = await migrateLegacyServerAccount({
          email: normalizeEmail(cached.email),
          displayName: cached.displayName,
          role: cached.role,
          avatarUri: cached.avatarUri,
          password: cached.password,
        });
        await writeAccountCache(migrated);
        return migrated as LocalAccount;
      } catch {
        try {
          const migratedByOtherRequest = await getServerAccount(email);
          await writeAccountCache(migratedByOtherRequest);
          return migratedByOtherRequest as LocalAccount;
        } catch {
          throw new Error("이 계정이 서버에 아직 저장되지 않았습니다. 기존 계정 로그인 또는 계정 이전을 확인해 주세요.");
        }
      }
    }
    if (error instanceof AccountApiError && error.status === 404) {
      if (cached) throw new Error("이 계정이 서버에 등록되어 있지 않습니다. 기존 계정으로 다시 로그인해 주세요.");
      return null;
    }
    throw error;
  }
}

export async function createLocalAccount(account: LocalAccount) {
  if (account.role === "fan" && !(await getJoinOpen())) throw new Error("현재는 신규 가입이 닫혀 있습니다.");
  const normalized = {
    email: normalizeEmail(account.email),
    displayName: account.displayName.trim(),
    role: account.role,
    avatarUri: account.avatarUri,
    password: account.password ?? "",
  };
  if (!normalized.displayName || !normalized.email || normalized.password.length < 8) throw new Error("이름, 이메일, 8자 이상 비밀번호를 확인해 주세요.");
  const saved = await registerServerAccount(normalized);
  await writeAccountCache(saved);
  await setLocalSession(saved.email);
  return saved as LocalAccount;
}

export async function loginLocalAccount(email: string, password: string) {
  const normalizedEmail = normalizeEmail(email);
  let account: ServerAccountProfile;
  try {
    account = await loginServerAccount(normalizedEmail, password);
  } catch (error) {
    const cached = await getCachedAccount(normalizedEmail);
    if (!(error instanceof AccountApiError && error.status === 404) || !cached || cached.password !== password) throw error;
    account = await migrateLegacyServerAccount({
      email: normalizedEmail,
      displayName: cached.displayName,
      role: cached.role,
      avatarUri: cached.avatarUri,
      password,
    });
  }
  await writeAccountCache(account);
  await setLocalSession(account.email);
  return account as LocalAccount;
}

export async function getLocalAccount() {
  const session = await getLocalSession();
  if (!session) return null;
  if (!(await getServerAuthToken())) {
    await clearLocalSession();
    return null;
  }
  try { return await refreshAccount(session); }
  catch (error) {
    if (error instanceof AccountApiError && error.status === 401) {
      await clearServerAuthToken();
      await clearLocalSession();
      return null;
    }
    throw error;
  }
}

export async function getLocalAccountByEmail(email: string) {
  return refreshAccount(normalizeEmail(email));
}

export async function getLocalSession() { return getSessionValue(SESSION_KEY); }
export async function setLocalSession(email: string) {
  clearMessageSnapshotCache();
  await setSessionValue(SESSION_KEY, normalizeEmail(email));
}
async function clearLocalSession() {
  clearMessageSnapshotCache();
  await removeSessionValue(SESSION_KEY);
}
export async function logoutLocalAccount() {
  try { await logoutServerSession(); }
  finally { await clearLocalSession(); }
}

export async function updateLocalProfile(displayName: string, avatarUri?: string, accountEmail?: string) {
  const current = accountEmail ? await getLocalAccountByEmail(accountEmail) : await getLocalAccount();
  if (!current) throw new Error("로그인 정보가 없습니다.");
  const normalizedName = displayName.trim();
  if (!normalizedName) throw new Error("닉네임을 입력해 주세요.");
  const updated = await updateServerProfile(current.email, { displayName: normalizedName, avatarUri });
  clearAuthenticatedMediaCache();
  const saved = { ...updated, role: current.role };
  await writeAccountCache(saved);
  publishProfileChange(saved);
  return saved as LocalAccount;
}

export async function changeLocalPassword(currentPassword: string, nextPassword: string, accountEmail?: string) {
  const current = accountEmail ? await getLocalAccountByEmail(accountEmail) : await getLocalAccount();
  if (!current) throw new Error("로그인 정보가 없습니다.");
  if (nextPassword.length < 8) throw new Error("새 비밀번호는 8자 이상이어야 합니다.");
  await updateServerPassword(current.email, currentPassword, nextPassword);
}

export async function resetLocalPrototype() {
  await AsyncStorage.multiRemove(LOCAL_DATA_KEYS);
  await clearLocalSession();
  await clearServerAuthToken();
}
