import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

function getBrowserSessionStorage(): Storage | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  try { return window.sessionStorage; } catch { return null; }
}

export async function getSessionValue(key: string): Promise<string | null> {
  const storage = getBrowserSessionStorage();
  if (Platform.OS === "web") return storage?.getItem(key) ?? null;
  return AsyncStorage.getItem(key);
}

export async function setSessionValue(key: string, value: string): Promise<void> {
  const storage = getBrowserSessionStorage();
  if (Platform.OS === "web") {
    if (!storage) throw new Error("브라우저에서 탭별 로그인 세션을 저장할 수 없습니다. 사이트 저장 권한을 확인해 주세요.");
    storage.setItem(key, value);
    return;
  }
  await AsyncStorage.setItem(key, value);
}

export async function removeSessionValue(key: string): Promise<void> {
  const storage = getBrowserSessionStorage();
  if (Platform.OS === "web") {
    storage?.removeItem(key);
    return;
  }
  await AsyncStorage.removeItem(key);
}
