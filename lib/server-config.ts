import AsyncStorage from "@react-native-async-storage/async-storage";
import { getServerAuthHeaders } from "@/lib/server-auth";

const SERVER_BASE_URL_KEY = "artist-dm.server-base-url.v1";
const DEFAULT_SERVER_BASE_URL = normalizeServerBaseUrl(process.env.EXPO_PUBLIC_MEDIA_API_URL ?? "") ?? "";
const REQUEST_TIMEOUT_MS = 3_000;
const TEST_TIMEOUT_MS = 6_000;
const SERVER_URL_FORMAT_ERROR = "IPv4는 포트를 포함해 http://192.168.0.10:8787 형식으로, 도메인은 https://api.example.com 형식으로 입력해 주세요. API 경로·쿼리·인증정보는 입력하지 않습니다.";

let currentServerBaseUrl = DEFAULT_SERVER_BASE_URL;
let initializationPromise: Promise<string> | null = null;
let refreshPromise: Promise<string> | null = null;
let localConfigRevision = 0;
const listeners = new Set<(url: string) => void>();

/** Accept only a clean HTTP(S) origin: IPv4 requires a port; DNS names may use one. */
export function normalizeServerBaseUrl(value: string): string | null {
  const input = value;
  if (!input || input !== input.trim() || /[\u0000-\u0020\u007f?#@\\]/.test(input)) return null;

  const match = input.match(/^(https?):\/\/([^/?#]+)\/?$/i);
  if (!match) return null;
  const authority = match[2];
  if (authority.includes("@") || authority.includes("[") || authority.includes("]") || authority.includes("\\")) return null;

  const colonIndex = authority.lastIndexOf(":");
  if (colonIndex >= 0 && authority.indexOf(":") !== colonIndex) return null;
  const rawHost = colonIndex >= 0 ? authority.slice(0, colonIndex) : authority;
  const rawPort = colonIndex >= 0 ? authority.slice(colonIndex + 1) : "";
  if (!rawHost || (colonIndex >= 0 && (!/^[1-9]\d{0,4}$/.test(rawPort) || Number(rawPort) > 65535))) return null;

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== "/" && parsed.pathname !== "")) return null;

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname.endsWith(".") || hostname.includes(":")) return null;
  const isIpv4Candidate = /^[\d.]+$/.test(rawHost);
  if (isIpv4Candidate) {
    const ipv4Parts = rawHost.split(".");
    if (!rawPort || ipv4Parts.length !== 4 || ipv4Parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) return null;
    const [first, second, third, fourth] = ipv4Parts.map(Number);
    if (first === 0 || first === 127 || first >= 224 || (first === 169 && second === 254) || (first === 255 && second === 255 && third === 255 && fourth === 255)) return null;
  } else {
    if (hostname.length > 253) return null;
    const labels = hostname.split(".");
    if (labels.length < 2 || labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) return null;
    if (!/[a-z]/i.test(labels[labels.length - 1])) return null;
  }

  return parsed.origin.replace(/\/$/, "");
}

export function getServerBaseUrlSync(): string {
  return currentServerBaseUrl;
}

export function getServerBaseUrl(): Promise<string> {
  return initializeServerConfig().then(() => currentServerBaseUrl);
}

export function initializeServerConfig(): Promise<string> {
  if (!initializationPromise) {
    initializationPromise = AsyncStorage.getItem(SERVER_BASE_URL_KEY)
      .then((stored) => {
        if (stored !== null) {
          const normalized = normalizeServerBaseUrl(stored);
          if (normalized) publishServerBaseUrl(normalized);
        }
        return currentServerBaseUrl;
      })
      .catch(() => currentServerBaseUrl);
  }
  return initializationPromise;
}

export function subscribeServerUrl(listener: (url: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publishServerBaseUrl(url: string) {
  if (url === currentServerBaseUrl) return;
  currentServerBaseUrl = url;
  for (const listener of listeners) {
    try { listener(url); } catch { /* A UI subscriber must not prevent other clients from updating. */ }
  }
}

async function persistServerBaseUrl(url: string) {
  await AsyncStorage.setItem(SERVER_BASE_URL_KEY, url);
  publishServerBaseUrl(url);
}

function requestWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

export async function saveServerBaseUrl(value: string, updatedByEmail: string): Promise<{ baseUrl: string; sharedFromActiveServer: boolean }> {
  const normalized = normalizeServerBaseUrl(value);
  if (!normalized) throw new Error(SERVER_URL_FORMAT_ERROR);

  const activeUrl = await getServerBaseUrl();
  if (!activeUrl) throw new Error("현재 서버 주소가 없어 새 주소를 다른 기기에 알릴 수 없습니다.");
  if (activeUrl === normalized) {
    await persistServerBaseUrl(normalized);
    return { baseUrl: normalized, sharedFromActiveServer: true };
  }

  const authHeaders = await getServerAuthHeaders();
  const saveAt = async (serverUrl: string) => {
    let response: Response;
    try {
      response = await requestWithTimeout(`${serverUrl}/api/server-config`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...authHeaders },
        body: JSON.stringify({ baseUrl: normalized, updatedByEmail }),
      }, REQUEST_TIMEOUT_MS);
    } catch {
      return { ok: false as const, reason: "network" as const };
    }
    if (response.ok) return { ok: true as const };
    const detail = await response.text().catch(() => "");
    return { ok: false as const, reason: "http" as const, status: response.status, detail };
  };

  let saved = await saveAt(activeUrl);
  let sharedFromActiveServer = saved.ok;
  if (!saved.ok && (saved.reason === "network" || saved.status === 404)) {
    // A previous switch may have left this device pointing at a server that can serve
    // /health but cannot host the shared URL setting. If the candidate was preflighted,
    // let it act as the recovery point so the user can switch back or move forward.
    saved = await saveAt(normalized);
    sharedFromActiveServer = false;
  }
  if (!saved.ok) {
    if (saved.reason === "http" && saved.status === 404) {
      throw new Error("현재 서버와 입력한 서버 모두 주소 공유 API를 찾을 수 없습니다. 두 서버에 최신 server.js가 적용되어 있는지 확인해 주세요.");
    }
    if (saved.reason === "network") {
      throw new Error("현재 서버와 입력한 서버에서 주소 공유 설정을 저장하지 못했습니다. 서버 연결을 확인해 주세요.");
    }
    throw new Error(saved.detail || `서버가 주소 변경을 거부했습니다 (HTTP ${saved.status}).`);
  }

  localConfigRevision += 1;
  await persistServerBaseUrl(normalized);
  return { baseUrl: normalized, sharedFromActiveServer };
}

export function refreshServerConfig(): Promise<string> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const revisionAtStart = localConfigRevision;
    const activeUrl = await getServerBaseUrl();
    if (!activeUrl) return currentServerBaseUrl;
    try {
      const response = await requestWithTimeout(`${activeUrl}/api/server-config`, { method: "GET" }, REQUEST_TIMEOUT_MS);
      if (!response.ok) return currentServerBaseUrl;
      const payload = await response.json().catch(() => null) as { baseUrl?: unknown } | null;
      if (typeof payload?.baseUrl !== "string" || !payload.baseUrl.trim()) return currentServerBaseUrl;
      const normalized = normalizeServerBaseUrl(payload.baseUrl);
      if (!normalized) return currentServerBaseUrl;
      if (revisionAtStart !== localConfigRevision) return currentServerBaseUrl;
      await persistServerBaseUrl(normalized);
      return normalized;
    } catch {
      return currentServerBaseUrl;
    }
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export async function testServerConnection(value: string): Promise<{ ok: boolean; status?: number; message: string }> {
  const candidate = normalizeServerBaseUrl(value);
  if (!candidate) return { ok: false, message: SERVER_URL_FORMAT_ERROR };
  try {
    const healthResponse = await requestWithTimeout(`${candidate}/health`, { method: "GET" }, TEST_TIMEOUT_MS);
    if (!healthResponse.ok) return { ok: false, status: healthResponse.status, message: `서버 상태 확인에 실패했습니다 (HTTP ${healthResponse.status}).` };

    const configResponse = await requestWithTimeout(`${candidate}/api/server-config`, { method: "GET" }, TEST_TIMEOUT_MS);
    if (configResponse.status === 404) {
      return { ok: false, status: 404, message: "서버는 연결되지만 주소 공유 API가 없습니다. 저장 전에 최신 server.js를 확인해 주세요." };
    }
    if (!configResponse.ok) {
      return { ok: false, status: configResponse.status, message: `서버 연결은 되었지만 주소 공유 확인에 실패했습니다 (HTTP ${configResponse.status}).` };
    }
    return { ok: true, status: healthResponse.status, message: "서버와 주소 공유 기능이 모두 연결되었습니다." };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return { ok: false, message: timedOut ? "6초 안에 응답이 없어 연결 시간이 초과되었습니다." : "서버에 연결할 수 없습니다. 주소와 네트워크를 확인해 주세요." };
  }
}
