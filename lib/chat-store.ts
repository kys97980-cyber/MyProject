import AsyncStorage from "@react-native-async-storage/async-storage";
import { resolveMediaUrl } from "@/lib/media-api";
import { getServerBaseUrl } from "@/lib/server-config";
import { getServerAuthHeaders } from "@/lib/server-auth";

export type ChatScope = "global" | "direct";
export type SenderRole = "artist" | "fan";

export type ChatMessage = {
  id: string;
  serverSequence?: number;
  senderId: string;
  senderRole: SenderRole;
  senderName: string;
  senderAvatarUri?: string;
  scope: ChatScope;
  recipientFanId?: string;
  text?: string;
  imageUri?: string;
  imageUris?: string[];
  media?: { id: string; url: string; mediaType: "image" | "audio" | "video"; mimeType: string; fileSize: number; fileName?: string }[];
  createdAt: string;
  readBy?: string[];
};

export type DirectConversation = {
  id: string;
  fanId: string;
  artistId: string;
  createdAt: string;
};

const CONVERSATIONS_KEY = "artist-dm.direct-conversations.v1";
async function requireMessageApi() {
	const api = await getServerBaseUrl();
	if (!api) throw new Error("PC dm-media-server 주소가 설정되지 않았습니다. EXPO_PUBLIC_MEDIA_API_URL을 설정해 주세요.");
	return api;
}

function normalizeMessageMedia(message: ChatMessage): ChatMessage {
  return {
    ...message,
    imageUri: resolveMediaUrl(message.imageUri),
    imageUris: message.imageUris?.map((uri) => resolveMediaUrl(uri) ?? uri),
    media: message.media?.map((item) => ({ ...item, url: resolveMediaUrl(item.url) ?? item.url })),
  };
}

export async function getMessagesSnapshot(signal?: AbortSignal): Promise<{ messages: ChatMessage[]; nextCursor: number }> {
		const api = await requireMessageApi();
		  let response: Response;
			  try { response = await fetch(`${api}/api/messages`, { headers: await getServerAuthHeaders(), signal }); }
	  catch { throw new Error("PC 서버의 메시지를 불러오지 못했습니다. dm-media-server 연결과 주소를 확인해 주세요."); }
	  if (!response.ok) throw new Error(`PC 서버 메시지 조회에 실패했습니다. (${response.status})`);
	  const payload = await response.json() as { messages?: ChatMessage[]; nextCursor?: number };
	  const messages = (payload.messages ?? []).map(normalizeMessageMedia);
	  return { messages, nextCursor: Number.isSafeInteger(payload.nextCursor) ? payload.nextCursor! : messages.reduce((cursor, message) => Math.max(cursor, message.serverSequence ?? 0), 0) };
}

export async function getOfflineArtistMessageCount(signal?: AbortSignal): Promise<number> {
  const api = await requireMessageApi();
  let response: Response;
  try {
    response = await fetch(`${api}/api/messages/offline-count`, {
      headers: await getServerAuthHeaders(),
      cache: "no-store",
      signal,
    });
  } catch {
    throw new Error("오프라인 메시지 수를 PC 서버에서 불러오지 못했습니다.");
  }
  if (!response.ok) throw new Error(`오프라인 메시지 수 조회에 실패했습니다. (${response.status})`);
  const payload = await response.json().catch(() => null) as { count?: unknown } | null;
  return typeof payload?.count === "number" && Number.isSafeInteger(payload.count) && payload.count > 0
    ? payload.count
    : 0;
}

export async function getMessages(): Promise<ChatMessage[]> {
  return (await getMessagesSnapshot()).messages;
}

export async function getNewMessages(afterCursor: number, signal?: AbortSignal): Promise<{ messages: ChatMessage[]; nextCursor: number }> {
  const api = await requireMessageApi();
  let response: Response;
	try { response = await fetch(`${api}/api/messages/updates?after=${encodeURIComponent(String(afterCursor))}`, { headers: await getServerAuthHeaders(), signal }); }
  catch { throw new Error("PC 서버의 새 메시지를 불러오지 못했습니다. dm-media-server 연결과 주소를 확인해 주세요."); }
  if (!response.ok) throw new Error(`PC 서버 새 메시지 조회에 실패했습니다. (${response.status})`);
  const payload = await response.json() as { messages?: ChatMessage[]; nextCursor?: number };
  return { messages: (payload.messages ?? []).map(normalizeMessageMedia), nextCursor: Number.isSafeInteger(payload.nextCursor) ? payload.nextCursor! : afterCursor };
}

const normalizeReaderId = (value: string) => value.trim().toLowerCase();

export function getUnreadIncomingMessageIds(
  messages: ChatMessage[],
  readerEmail: string,
  readerRole: SenderRole,
  blockedFanIds: string[] = [],
) {
  const normalizedReader = normalizeReaderId(readerEmail);
  const blockedFans = new Set(blockedFanIds.map(normalizeReaderId));
  if (!normalizedReader || (readerRole === "fan" && blockedFans.has(normalizedReader))) return [];

  return messages.filter((message) => {
    if ((message.readBy ?? []).some((readerId) => normalizeReaderId(readerId) === normalizedReader)) return false;
    if (readerRole === "artist") {
      return message.senderRole === "fan" && !blockedFans.has(normalizeReaderId(message.senderId));
    }
    return message.senderRole === "artist"
      && message.scope === "direct"
      && normalizeReaderId(message.recipientFanId ?? "") === normalizedReader;
  }).map((message) => message.id);
}

export async function appendMessage(message: ChatMessage): Promise<ChatMessage> {
	const api = await requireMessageApi();
  let response: Response;
	  try {
	    const authHeaders = await getServerAuthHeaders();
	    response = await fetch(`${api}/api/messages`, {
	      method: "POST",
	      headers: { "content-type": "application/json", ...authHeaders },
      body: JSON.stringify(normalizeMessageMedia(message)),
    });
  } catch {
    throw new Error("메시지를 PC dm-media-server에 저장하지 못했습니다. 서버 연결을 확인해 주세요.");
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: string; invalidFields?: string[] } | null;
    const invalidFields = detail?.invalidFields?.length ? ` [필드: ${detail.invalidFields.join(", ")}]` : "";
    throw new Error(`PC 서버 메시지 저장에 실패했습니다. (${response.status})${detail?.error ? `: ${detail.error}` : ""}${invalidFields}`);
  }

  if (message.scope === "direct" && message.recipientFanId) {
    const stored = await AsyncStorage.getItem(CONVERSATIONS_KEY);
    const conversations = stored ? (JSON.parse(stored) as DirectConversation[]) : [];
    const fanId = message.senderRole === "fan" ? message.senderId : message.recipientFanId;
    const exists = conversations.some((conversation) => conversation.fanId === fanId && conversation.artistId === "artist");
    if (!exists) {
      conversations.push({ id: `direct-${fanId}`, fanId, artistId: "artist", createdAt: new Date().toISOString() });
      await AsyncStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
    }
  }
  const payload = await response.json().catch(() => null) as { message?: ChatMessage } | null;
  return normalizeMessageMedia(payload?.message ?? message);
}

export async function markMessagesRead(messageIds: string[], readerId: string, signal?: AbortSignal): Promise<void> {
	if (!messageIds.length) return;
	const api = await requireMessageApi();
  let response: Response;
	  try {
	    const authHeaders = await getServerAuthHeaders();
	    response = await fetch(`${api}/api/messages/read`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders },
      body: JSON.stringify({ messageIds, readerId: normalizeReaderId(readerId) }),
      signal,
    });
  } catch {
    throw new Error("읽음 상태를 PC 서버에 저장하지 못했습니다. 서버 연결을 확인해 주세요.");
  }
  if (response.status === 404) throw new Error("읽음 API 경로가 없는 서버에서 HTTP 404를 받았습니다. 실행 중인 server.js와 주소/포트를 확인해 주세요.");
  if (response.status === 405) throw new Error("읽음 API가 POST 요청을 허용하지 않아 HTTP 405를 반환했습니다. 실행 중인 서버 파일과 주소를 확인해 주세요.");
  if (!response.ok) throw new Error(`읽음 상태 저장에 실패했습니다. (${response.status})`);
	await response.json().catch(() => null);
}

export type MessageReadStatus = { messageId: string; readBy: string[] };

export async function getMessageReadStatuses(messageIds: string[], signal?: AbortSignal): Promise<MessageReadStatus[]> {
  const uniqueIds = Array.from(new Set(messageIds.filter((id) => typeof id === "string" && id.length > 0))).slice(-500);
  if (!uniqueIds.length) return [];
  const api = await requireMessageApi();
  let response: Response;
  try {
    response = await fetch(`${api}/api/messages/read-status`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await getServerAuthHeaders()) },
      body: JSON.stringify({ messageIds: uniqueIds }),
      signal,
    });
  } catch {
    throw new Error("메시지 읽음 상태를 PC 서버에서 확인하지 못했습니다. 서버 연결을 확인해 주세요.");
  }
  if (response.status === 404) throw new Error("PC 서버에 읽음 상태 조회 API가 없습니다. 최신 읽음 상태 서버 패치를 적용해 주세요.");
  if (!response.ok) throw new Error(`메시지 읽음 상태 조회에 실패했습니다. (${response.status})`);
  const payload = await response.json().catch(() => null) as { readStatuses?: unknown } | null;
  if (!Array.isArray(payload?.readStatuses)) return [];
  return payload.readStatuses.flatMap((status) => {
    if (!status || typeof status !== "object") return [];
    const record = status as { messageId?: unknown; readBy?: unknown };
    if (typeof record.messageId !== "string" || !Array.isArray(record.readBy)) return [];
    return [{
      messageId: record.messageId,
      readBy: record.readBy.filter((readerId): readerId is string => typeof readerId === "string"),
    }];
  });
}

export async function updateSenderProfile(senderId: string, senderName: string, senderAvatarUri?: string) {
  const messages = await getMessages();
  return messages.map((message) => message.senderId === senderId ? { ...message, senderName, senderAvatarUri } : message);
}

export async function removeEmbeddedSenderAvatars() {
  const messages = await getMessages();
  return messages.map(({ senderAvatarUri: _senderAvatarUri, ...message }) => message);
}

export function getGlobalMessages(messages: ChatMessage[]) {
  return messages.filter((message) => message.scope === "global");
}

export function getDirectMessages(messages: ChatMessage[], fanId: string) {
  return messages.filter(
    (message) => message.scope === "global" || message.recipientFanId === fanId || (message.senderRole === "fan" && message.senderId === fanId),
  );
}
