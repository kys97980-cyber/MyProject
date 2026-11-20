import { AppState } from "react-native";
import type { ServerAccountProfile } from "@/lib/account-api";
import { getServerProfiles, type ServerProfileRecord } from "@/lib/profile-api";
import { getServerAuthToken } from "@/lib/server-auth";
import { getServerBaseUrl, getServerBaseUrlSync } from "@/lib/server-config";
import { resolveMediaUrl } from "@/lib/media-api";

const listeners = new Set<(profile: ServerAccountProfile) => void>();

/** Local save acknowledgement only; other devices synchronize through the server below. */
export function publishProfileChange(profile: ServerAccountProfile) {
  for (const listener of listeners) listener(profile);
}

export function subscribeToProfileChanges(listener: (profile: ServerAccountProfile) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function imageIdentity(uri?: string) {
  if (!uri) return "";
  try {
    const url = new URL(uri);
    return `${url.origin}${url.pathname}`;
  } catch {
    return uri;
  }
}

function imageSignatureExpiring(uri?: string) {
  if (!uri) return false;
  try {
    const expires = Number(new URL(uri).searchParams.get("e"));
    return expires > 0 && expires * 1000 <= Date.now() + 30_000;
  } catch {
    return false;
  }
}

/** Keep message objects untouched, and avoid reloading an unchanged photo for a renewed signature. */
export function applyServerProfile<T extends ServerAccountProfile>(current: T, profile?: ServerProfileRecord): T {
  if (!profile) return current;
  const currentTime = Date.parse(current.profileUpdatedAt ?? "");
  const incomingTime = Date.parse(profile.updatedAt ?? "");
  if (Number.isFinite(currentTime) && (!Number.isFinite(incomingTime) || incomingTime < currentTime)) return current;

  const incomingUri = resolveMediaUrl(profile.avatarUri);
  const sameImage = imageIdentity(current.avatarUri) === imageIdentity(incomingUri);
  const avatarUri = sameImage && !imageSignatureExpiring(current.avatarUri) ? current.avatarUri : incomingUri;
  if (current.displayName === profile.displayName && current.avatarUri === avatarUri && current.profileUpdatedAt === profile.updatedAt) return current;
  return { ...current, displayName: profile.displayName, avatarUri, profileUpdatedAt: profile.updatedAt };
}

/** Call only while a chat screen is focused. This works on native and Web, across independent devices. */
export function subscribeToServerProfiles(
  onProfiles: (profiles: ServerProfileRecord[]) => void,
  onError: (error: Error | null) => void,
) {
  let active = true;
  let foreground = AppState.currentState !== "background" && AppState.currentState !== "inactive";
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let foregroundGeneration = 0;

  const refresh = async () => {
    if (!active || !foreground || pending) return;
    pending = true;
    const generation = foregroundGeneration;
    try {
      const token = await getServerAuthToken();
      const server = await getServerBaseUrl();
      if (!active || !foreground || !token || !server) return;
      const profiles = await getServerProfiles();
      const latestToken = await getServerAuthToken();
      if (!active || !foreground || generation !== foregroundGeneration || token !== latestToken || server !== getServerBaseUrlSync()) return;
      if (!profiles) throw new Error("서버의 분리 프로필 조회 API를 사용할 수 없습니다.");
      onProfiles(profiles);
      onError(null);
    } catch (error) {
      if (active && foreground && generation === foregroundGeneration) {
        onError(error instanceof Error ? error : new Error("프로필 변경을 서버에서 확인하지 못했습니다."));
      }
    } finally {
      pending = false;
      if (active && foreground) timer = setTimeout(() => { void refresh(); }, 2000);
    }
  };

  const appStateSubscription = AppState.addEventListener("change", (state) => {
    foreground = state === "active";
    foregroundGeneration += 1;
    if (timer) clearTimeout(timer);
    if (foreground) void refresh();
  });
  void refresh();
  return () => {
    active = false;
    if (timer) clearTimeout(timer);
    appStateSubscription.remove();
  };
}
