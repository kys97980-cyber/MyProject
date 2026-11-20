import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { getSessionValue, removeSessionValue, setSessionValue } from "@/lib/session-storage";
import { clearAuthenticatedMediaCache } from "@/lib/authenticated-media-cache";

const AUTH_TOKEN_KEY = "artist-dm.server-session-token.v1";

export async function getServerAuthToken() {
  return getSessionValue(AUTH_TOKEN_KEY);
}

export async function saveServerAuthToken(token: string) {
  if (!token || token.length < 40) throw new Error("서버가 유효한 로그인 세션을 반환하지 않았습니다.");
  clearAuthenticatedMediaCache();
  await setSessionValue(AUTH_TOKEN_KEY, token);
  // Remove the old shared web token so it cannot be reused by another tab.
  if (Platform.OS === "web") await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
}

export async function clearServerAuthToken() {
  clearAuthenticatedMediaCache();
  await removeSessionValue(AUTH_TOKEN_KEY);
  await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
}

export async function getServerAuthHeaders(): Promise<Record<string, string>> {
  const token = await getServerAuthToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}
