import { File as ExpoFile, UploadType } from "expo-file-system";
import { Platform } from "react-native";
import { getServerBaseUrl, getServerBaseUrlSync } from "@/lib/server-config";
import { getServerAuthHeaders } from "@/lib/server-auth";

export type UploadMediaType = "image" | "audio" | "video";
export type UploadMedia = { uri: string; mimeType: string; fileName: string; mediaType: UploadMediaType };

/** Convert an old server host to the current server, retaining the canonical physical subfolder path. */
export function resolveMediaUrl(value?: string) {
  if (!value) return value;
  const raw = value.trim();
  const baseUrl = getServerBaseUrlSync();
  if (!raw || /^(data:|blob:|file:)/i.test(raw) || !baseUrl) return raw;
  try {
    const parsed = new URL(raw, `${baseUrl}/`);
    const pathname = parsed.pathname.replace(/\/{2,}/g, "/");
    const markerIndex = pathname.indexOf("/media/");
    if (markerIndex < 0) return raw;
    const parts = pathname.slice(markerIndex + "/media/".length).split("/").filter(Boolean);
    if (parts.length < 2 || !["image", "voice", "video"].includes(parts[0])) return raw;
    return `${baseUrl}/media/${parts.join("/")}${parsed.search}${parsed.hash}`;
  } catch {
    return raw;
  }
}

export async function uploadMedia(media: UploadMedia) {
  const baseUrl = await getServerBaseUrl();
  if (!baseUrl) {
    throw new Error("PC dm-media-server 주소가 없습니다. .env의 EXPO_PUBLIC_MEDIA_API_URL을 설정해 주세요.");
  }
  const uploadUrl = `${baseUrl}/api/media/upload`;
  const authHeaders = await getServerAuthHeaders();
  let result: { id: string; url: string; mediaType: UploadMediaType; mimeType: string; fileSize: number };

  if (Platform.OS === "web") {
    const formData = new FormData();
    formData.append("mediaType", media.mediaType);
    formData.append("mimeType", media.mimeType);
    const blob = await (await fetch(media.uri)).blob();
    formData.append("file", blob, media.fileName);
    const response = await fetch(uploadUrl, { method: "POST", headers: authHeaders, body: formData });
    const body = await response.text().catch(() => "");
    if (!response.ok) throw new Error(body || "PC 서버 미디어 폴더에 업로드하지 못했습니다.");
    try {
      result = JSON.parse(body) as typeof result;
    } catch {
      throw new Error("PC 서버의 미디어 업로드 응답을 읽지 못했습니다.");
    }
  } else {
    const uploadFile = new ExpoFile(media.uri);
    const response = await uploadFile.upload(uploadUrl, {
      httpMethod: "POST",
      uploadType: UploadType.MULTIPART,
      fieldName: "file",
      mimeType: media.mimeType,
      parameters: { mediaType: media.mediaType, mimeType: media.mimeType },
      headers: authHeaders,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(response.body || `PC 서버 미디어 업로드 실패 (${response.status}).`);
    }
    try {
      result = JSON.parse(response.body) as typeof result;
    } catch {
      throw new Error("PC 서버의 미디어 업로드 응답을 읽지 못했습니다.");
    }
  }

  const url = resolveMediaUrl(result.url);
  if (!url || !/\/media\/(image|voice|video)\//.test(url)) {
    throw new Error("PC 서버가 반환한 URL이 media 하위 폴더 경로가 아닙니다.");
  }
  return { ...result, fileName: media.fileName, url };
}
