import { router, useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { BackHandler, FlatList, KeyboardAvoidingView, Modal, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, ToastAndroid, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";

import ChatComposer from "@/components/ChatComposer";
import ProfileHeaderButton from "@/components/ProfileHeaderButton";
import ServerProfileImage from "@/components/ServerProfileImage";
import type { PendingImage } from "@/components/ChatComposer";
import MessageImages from "@/components/MessageImages";
import MessageMedia from "@/components/MessageMedia";
import { getLocalAccount, getLocalAccountByEmail, getLocalSession, logoutLocalAccount, type LocalAccount } from "@/lib/auth";
import { findAccountProfile, normalizeAccountEmail } from "@/lib/account-api";
import {
  appendMessage,
  getDirectMessages,
  getOfflineArtistMessageCount,
  getMessages,
  getMessagesSnapshot,
  getNewMessages,
  getUnreadIncomingMessageIds,
  markMessagesRead,
  type ChatMessage,
} from "@/lib/chat-store";
import { getAccounts, getBlockedFans, getJoinOpen, setFanBlocked, setJoinOpen, subscribeToBlockedFans, type AccountProfile } from "@/lib/moderation-store";
import { uploadMedia } from "@/lib/media-api";
import { applyServerProfile, subscribeToProfileChanges, subscribeToServerProfiles } from "@/lib/profile-change-store";
import { getServerBaseUrlSync, subscribeServerUrl } from "@/lib/server-config";
import { advanceMessageSnapshotCursor, clearMessageSnapshotCache, createMessageSnapshotKey, getMessageSnapshot, mergeMessageSnapshot, replaceMessageSnapshot } from "@/lib/chat-snapshot-cache";

const INK = "#f1f1f1";
const MUTED = "#8a8a8a";
const PAPER = "#050505";
const LINE = "#262626";
const ACCENT = "#2bb673";

const getMessageWeekday = (date: Date) => {
  return ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"][date.getDay()];
};

const getMessageDateKey = (value: string) => {
  const date = new Date(value);
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const formatMessageDate = (value: string) => {
  const date = new Date(value);
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${getMessageWeekday(date)}`;
};

const formatMessageTime = (value: string) => {
  const date = new Date(value);
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const isFanBlocked = (blockedFanIds: string[], email: string) =>
  blockedFanIds.some((fanId) => normalizeAccountEmail(fanId) === normalizeAccountEmail(email));

const USER_JOSA_RULES: Record<string, { withBatchim: string; withoutBatchim: string; rieulUsesWithoutBatchim?: boolean }> = {
  "이": { withBatchim: "이", withoutBatchim: "가" },
  "가": { withBatchim: "이", withoutBatchim: "가" },
  "은": { withBatchim: "은", withoutBatchim: "는" },
  "는": { withBatchim: "은", withoutBatchim: "는" },
  "을": { withBatchim: "을", withoutBatchim: "를" },
  "를": { withBatchim: "을", withoutBatchim: "를" },
  "과": { withBatchim: "과", withoutBatchim: "와" },
  "와": { withBatchim: "과", withoutBatchim: "와" },
  "으로": { withBatchim: "으로", withoutBatchim: "로", rieulUsesWithoutBatchim: true },
  "로": { withBatchim: "으로", withoutBatchim: "로", rieulUsesWithoutBatchim: true },
  "이랑": { withBatchim: "이랑", withoutBatchim: "랑" },
  "랑": { withBatchim: "이랑", withoutBatchim: "랑" },
  "아": { withBatchim: "아", withoutBatchim: "야" },
  "야": { withBatchim: "아", withoutBatchim: "야" },
  "이에요": { withBatchim: "이에요", withoutBatchim: "예요" },
  "예요": { withBatchim: "이에요", withoutBatchim: "예요" },
  "이야": { withBatchim: "이야", withoutBatchim: "야" },
};

const getHangulJongseongIndex = (name: string) => {
  const lastSyllable = [...name.trim()].reverse().find((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 0xac00 && code <= 0xd7a3;
  });
  if (!lastSyllable) return 0;
  return ((lastSyllable.codePointAt(0) ?? 0) - 0xac00) % 28;
};

const chooseUserJosa = (name: string, typedJosa: string) => {
  const rule = USER_JOSA_RULES[typedJosa];
  if (!rule) return typedJosa;
  const jongseong = getHangulJongseongIndex(name);
  const useWithoutBatchim = jongseong === 0 || (rule.rieulUsesWithoutBatchim && jongseong === 8);
  return useWithoutBatchim ? rule.withoutBatchim : rule.withBatchim;
};

const renderArtistGlobalMessage = (text: string, fanName: string) =>
  text
    .replace(/\{user\}(이에요|예요|이야|이랑|랑|으로|로|은|는|이|가|을|를|과|와|아|야)/g, (_match, typedJosa: string) => `${fanName}${chooseUserJosa(fanName, typedJosa)}`)
    .replace(/\{user\}/g, fanName);

const mergeMessagesPreservingExisting = (currentMessages: ChatMessage[], nextMessages: ChatMessage[]) => {
  const seenIds = new Set(currentMessages.map((message) => message.id));
  const newlyAddedMessages: ChatMessage[] = [];
  for (const message of nextMessages) {
    if (seenIds.has(message.id)) continue;
    seenIds.add(message.id);
    newlyAddedMessages.push(message);
  }
  return newlyAddedMessages.length ? [...currentMessages, ...newlyAddedMessages] : currentMessages;
};

const readBySnapshot = (messages: ChatMessage[]) => Object.fromEntries(
  messages.filter((message) => message.readBy?.length).map((message) => [message.id, message.readBy ?? []]),
);

type StableMessageMedia = Pick<ChatMessage, "imageUri" | "imageUris" | "media">;

const messageMediaSnapshot = (messages: ChatMessage[]) => Object.fromEntries(
  messages
    .filter((message) => message.imageUri || message.imageUris?.length || message.media?.length)
    .map((message) => [message.id, {
      imageUri: message.imageUri,
      imageUris: message.imageUris,
      media: message.media,
    } satisfies StableMessageMedia]),
);

const mergeNewMessageMedia = (setMedia: Dispatch<SetStateAction<Record<string, StableMessageMedia>>>, messages: ChatMessage[]) => {
  setMedia((currentMedia) => {
    const nextMedia = { ...currentMedia };
    let changed = false;
    for (const message of messages) {
      if (!nextMedia[message.id] && (message.imageUri || message.imageUris?.length || message.media?.length)) {
        nextMedia[message.id] = { imageUri: message.imageUri, imageUris: message.imageUris, media: message.media };
        changed = true;
      }
    }
    return changed ? nextMedia : currentMedia;
  });
};

const updateReadByIfChanged = (setReadBy: Dispatch<SetStateAction<Record<string, string[]>>>, nextMessages: ChatMessage[]) => {
  const nextReadBy = readBySnapshot(nextMessages);
  setReadBy((currentReadBy) => {
    let changed = false;
    const mergedReadBy = { ...currentReadBy };
    for (const [messageId, readers] of Object.entries(nextReadBy)) {
      if (Object.prototype.hasOwnProperty.call(mergedReadBy, messageId)) continue;
      mergedReadBy[messageId] = readers;
      changed = true;
    }
    return changed ? mergedReadBy : currentReadBy;
  });
};

export default function ChatScreen() {
  const { account: accountParam } = useLocalSearchParams<{ account?: string }>();
  const navigation = useNavigation();
  const rootNavigation = navigation.getParent();
  const requestedEmail = accountParam ? decodeURIComponent(accountParam) : "";
  const messageListRef = useRef<FlatList<ChatMessage> | null>(null);
  const lastBackPressAt = useRef(0);
  const androidBackLogoutInProgress = useRef(false);
  const iosBackLogoutInProgress = useRef(false);
  const allowIosBackRemoval = useRef(false);
  const [account, setAccount] = useState<LocalAccount | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  const [messageCursor, setMessageCursor] = useState(0);
  const messageCursorRef = useRef(0);
  const messageSnapshotCacheKeyRef = useRef("");
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [stableMedia, setStableMedia] = useState<Record<string, StableMessageMedia>>({});
  const [menuVisible, setMenuVisible] = useState(false);
  const [memberManagementOpen, setMemberManagementOpen] = useState(false);
  const [joinOpen, setJoinOpenState] = useState(true);
  const [blockedFans, setBlockedFans] = useState<string[]>([]);
  const [members, setMembers] = useState<AccountProfile[]>([]);
  const [readBy, setReadBy] = useState<Record<string, string[]>>({});
  const [offlineArtistMessageCount, setOfflineArtistMessageCount] = useState(0);
  const offlineCountRequestVersion = useRef(0);
  const [offlineCountError, setOfflineCountError] = useState("");
  const [offlineCountStatus, setOfflineCountStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [memberSearch, setMemberSearch] = useState("");
  const [moderationError, setModerationError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [readSyncError, setReadSyncError] = useState("");
  const [profileSyncError, setProfileSyncError] = useState("");
  const [reloadCount, setReloadCount] = useState(0);
  const [messageAnchorWidths, setMessageAnchorWidths] = useState<Record<string, number>>({});
  const [activeServerBaseUrl, setActiveServerBaseUrl] = useState(() => getServerBaseUrlSync());
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);

  const handleMessageScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setShowScrollToLatest(event.nativeEvent.contentOffset.y > 80);
  }, []);

  const scrollToLatest = useCallback(() => {
    setShowScrollToLatest(false);
    messageListRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  useEffect(() => {
    messageCursorRef.current = messageCursor;
  }, [messageCursor]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return;
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        if (androidBackLogoutInProgress.current) return true;
        const now = Date.now();
        if (now - lastBackPressAt.current < 2000) {
          lastBackPressAt.current = 0;
          androidBackLogoutInProgress.current = true;
          void logoutLocalAccount()
            .catch(() => undefined)
            .finally(() => BackHandler.exitApp());
        } else {
          lastBackPressAt.current = now;
          ToastAndroid.show("한 번 더 누르면 앱이 종료됩니다.", ToastAndroid.SHORT);
        }
        return true;
      });
      return () => subscription.remove();
    }, []),
  );

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "ios" || !rootNavigation) return;
      allowIosBackRemoval.current = false;
      iosBackLogoutInProgress.current = false;
      return rootNavigation.addListener("beforeRemove", (event) => {
        const state = rootNavigation.getState();
        const activeRoute = state.routes[state.index];
        if (activeRoute?.name !== "(tabs)" || (event.target && event.target !== activeRoute.key)) return;
        if (allowIosBackRemoval.current) return;
        event.preventDefault();
        if (iosBackLogoutInProgress.current) return;
        iosBackLogoutInProgress.current = true;
        void logoutLocalAccount()
          .catch(() => undefined)
          .finally(() => {
            allowIosBackRemoval.current = true;
            rootNavigation.dispatch(event.data.action);
          });
      });
    }, [rootNavigation]),
  );

  useEffect(() => {
    setActiveServerBaseUrl(getServerBaseUrlSync());
    return subscribeServerUrl(setActiveServerBaseUrl);
  }, []);

  useFocusEffect(
    useCallback(() => subscribeToProfileChanges((profile) => {
      const changedEmail = normalizeAccountEmail(profile.email);
      setAccount((current) => current && normalizeAccountEmail(current.email) === changedEmail
        ? { ...current, ...profile }
        : current);
      setMembers((current) => {
        let changed = false;
        const next = current.map((member) => {
          if (normalizeAccountEmail(member.email) !== changedEmail) return member;
          changed = true;
          return { ...member, ...profile };
        });
        return changed ? next : current;
      });
    }), []),
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const controller = new AbortController();
      setSnapshotReady(false);
      setLoadError("");
      setReadBy({});
      setMessageAnchorWidths({});
      setMessages([]);
      setStableMedia({});
      setAccount(null);
      setMembers([]);
      setBlockedFans([]);

      const loadSnapshot = async () => {
        try {
          const localAccount = await (requestedEmail ? getLocalAccountByEmail(requestedEmail) : getLocalAccount());
          if (!active) return;
          const cacheKey = createMessageSnapshotKey(localAccount?.email ?? "", localAccount?.role ?? "", activeServerBaseUrl);
          const cachedSnapshot = localAccount ? getMessageSnapshot(cacheKey) : null;
          messageSnapshotCacheKeyRef.current = cacheKey;
          const snapshotPromise = cachedSnapshot
            ? Promise.resolve({ messages: cachedSnapshot.messages, nextCursor: cachedSnapshot.cursor })
            : getMessagesSnapshot(controller.signal);
          const [storedSnapshot, storedJoinOpen, storedBlockedFans, storedMembers] = await Promise.all([
            snapshotPromise,
            getJoinOpen(),
            getBlockedFans(localAccount?.role === "artist" ? localAccount.email : undefined, controller.signal),
            getAccounts(),
          ]);
          if (!active) return;
          const storedMessages = storedSnapshot.messages;
          messageCursorRef.current = storedSnapshot.nextCursor;
          replaceMessageSnapshot(cacheKey, storedMessages, storedSnapshot.nextCursor);
          setAccount(localAccount);
          setMessages(storedMessages);
          setMessageCursor(storedSnapshot.nextCursor);
          setStableMedia(messageMediaSnapshot(storedMessages));
          setJoinOpenState(storedJoinOpen);
          setBlockedFans(storedBlockedFans);
          setMembers(storedMembers);
          setSnapshotReady(true);
        } catch (error) {
          if (active) setLoadError(error instanceof Error ? error.message : "서버 데이터를 불러오지 못했습니다.");
        }
      };
      void loadSnapshot();
      return () => {
        active = false;
        controller.abort();
        setSnapshotReady(false);
        setMessages([]);
        setStableMedia({});
        setReadBy({});
        setMessageAnchorWidths({});
        setMembers([]);
        setBlockedFans([]);
        setAccount(null);
        messageCursorRef.current = 0;
        setMessageCursor(0);
        setOfflineArtistMessageCount(0);
        setOfflineCountError("");
        setOfflineCountStatus("idle");
      };
    }, [requestedEmail, reloadCount, activeServerBaseUrl]),
  );

  useFocusEffect(useCallback(() => {
    if (!account?.email) return;
    return subscribeToServerProfiles((profiles) => {
      const byEmail = new Map(profiles.map((profile) => [normalizeAccountEmail(profile.email), profile]));
      setAccount((current) => current ? applyServerProfile(current, byEmail.get(normalizeAccountEmail(current.email))) : current);
      setMembers((current) => {
        let changed = false;
        const next = current.map((member) => {
          const updated = applyServerProfile(member, byEmail.get(normalizeAccountEmail(member.email)));
          if (updated !== member) changed = true;
          return updated;
        });
        return changed ? next : current;
      });
    }, (error) => setProfileSyncError(error?.message ?? ""));
  }, [account?.email, activeServerBaseUrl]));

  useFocusEffect(
    useCallback(() => {
      if (account?.role !== "fan") return;
      let active = true;
      let refreshing = false;
      const controller = new AbortController();
      const applyBlockedFans = (currentBlockedFans: string[]) => {
        setBlockedFans((current) => current.length === currentBlockedFans.length && current.every((id, index) => id === currentBlockedFans[index]) ? current : currentBlockedFans);
      };
      const refreshBlockedFans = async () => {
        if (refreshing) return;
        refreshing = true;
        try {
          const currentBlockedFans = await getBlockedFans(undefined, controller.signal);
          if (active) applyBlockedFans(currentBlockedFans);
        } catch { /* Keep the last known state until the PC server is reachable again. */ }
        finally { refreshing = false; }
      };
      void refreshBlockedFans();
      const unsubscribe = subscribeToBlockedFans(applyBlockedFans);
      const timer = setInterval(() => { void refreshBlockedFans(); }, 1000);
      return () => {
        active = false;
        controller.abort();
        clearInterval(timer);
        unsubscribe();
      };
    }, [account?.role]),
  );

  useFocusEffect(
    useCallback(() => {
      if (account?.role !== "fan") {
        setOfflineArtistMessageCount(0);
        setOfflineCountError("");
        setOfflineCountStatus("idle");
        return;
      }
      setOfflineArtistMessageCount(0);
      setOfflineCountError("");
      setOfflineCountStatus("loading");
      let active = true;
      const controller = new AbortController();
      let refreshing = false;
      const refreshOfflineCount = async () => {
        if (refreshing) return;
        refreshing = true;
        const requestVersion = offlineCountRequestVersion.current;
        try {
          const count = await getOfflineArtistMessageCount(controller.signal);
          if (active && requestVersion === offlineCountRequestVersion.current) {
            setOfflineArtistMessageCount(count);
            setOfflineCountError("");
            setOfflineCountStatus("ready");
          }
        } catch (error) {
          if (active && requestVersion === offlineCountRequestVersion.current) {
            setOfflineCountError(error instanceof Error ? error.message : "오프라인 메시지 수를 PC 서버에서 불러오지 못했습니다.");
            setOfflineCountStatus("error");
          }
        } finally {
          refreshing = false;
        }
      };
      void refreshOfflineCount();
      const timer = setInterval(() => { void refreshOfflineCount(); }, 2000);
      return () => { active = false; controller.abort(); clearInterval(timer); };
    }, [account?.email, account?.role, activeServerBaseUrl]),
  );

  useFocusEffect(
    useCallback(() => {
      const cacheKey = messageSnapshotCacheKeyRef.current;
      if (!account || account.role !== "artist" || !snapshotReady || !cacheKey) return;
      let active = true;
      const controller = new AbortController();
      let refreshing = false;
      const refreshArtistGlobalMessages = async () => {
        if (refreshing) return;
        refreshing = true;
        try {
          const updates = await getNewMessages(messageCursorRef.current, controller.signal);
          if (!active) return;
          const nextCursor = Math.max(messageCursorRef.current, updates.nextCursor);
          messageCursorRef.current = nextCursor;
          setMessageCursor(nextCursor);
          if (updates.messages.length) {
            const mergedSnapshot = mergeMessageSnapshot(cacheKey, updates.messages, nextCursor);
            mergeNewMessageMedia(setStableMedia, updates.messages);
            if (mergedSnapshot) setMessages(mergedSnapshot.messages);
          } else {
            advanceMessageSnapshotCursor(cacheKey, nextCursor);
          }
          setLoadError("");
        } catch (error) {
          if (active) setLoadError(error instanceof Error ? error.message : "서버 메시지를 불러오지 못했습니다.");
        } finally {
          refreshing = false;
        }
      };
      void refreshArtistGlobalMessages();
      const timer = setInterval(() => { void refreshArtistGlobalMessages(); }, 2000);
      return () => { active = false; controller.abort(); clearInterval(timer); };
    }, [account?.email, account?.role, snapshotReady]),
  );

  useFocusEffect(
    useCallback(() => {
      const cacheKey = messageSnapshotCacheKeyRef.current;
      if (!account || account.role !== "fan" || !snapshotReady || !cacheKey) return;
      let active = true;
      const controller = new AbortController();
      let refreshing = false;
      const refreshFanDirectMessages = async () => {
        if (refreshing) return;
        refreshing = true;
        try {
          const [updates, sessionEmail] = await Promise.all([
            getNewMessages(messageCursorRef.current, controller.signal),
            getLocalSession(),
          ]);
          const remoteMessages = updates.messages;
          if (!remoteMessages.length) {
            if (active) {
              const nextCursor = Math.max(messageCursorRef.current, updates.nextCursor);
              messageCursorRef.current = nextCursor;
              setMessageCursor(nextCursor);
              advanceMessageSnapshotCursor(cacheKey, nextCursor);
            }
            return;
          }
          const hasActiveSession = Boolean(sessionEmail) && normalizeAccountEmail(sessionEmail!) === normalizeAccountEmail(account.email);
          const readIds = hasActiveSession
            ? getUnreadIncomingMessageIds(remoteMessages, account.email, "fan", blockedFans)
            : [];
          let nextMessages = remoteMessages;
          let advanceCursor = true;
          if (readIds.length) {
            try {
              await markMessagesRead(readIds, account.email, controller.signal);
              nextMessages = remoteMessages.map((message) => readIds.includes(message.id)
                ? { ...message, readBy: [...new Set([...(message.readBy ?? []), account.email])] }
                : message);
              if (active) setReadSyncError("");
            } catch (error) {
              advanceCursor = false;
              if (active) setReadSyncError(error instanceof Error ? error.message : "읽음 상태 동기화에 실패했습니다.");
            }
          }
          if (!active) return;
          const nextCursor = advanceCursor ? Math.max(messageCursorRef.current, updates.nextCursor) : messageCursorRef.current;
          const mergedSnapshot = mergeMessageSnapshot(cacheKey, nextMessages, nextCursor);
          if (advanceCursor) {
            messageCursorRef.current = nextCursor;
            setMessageCursor(nextCursor);
          }
          updateReadByIfChanged(setReadBy, nextMessages);
          mergeNewMessageMedia(setStableMedia, nextMessages);
          if (mergedSnapshot) setMessages(mergedSnapshot.messages);
          else setMessages((currentMessages) => mergeMessagesPreservingExisting(currentMessages, nextMessages));
          setLoadError("");
        } catch (error) {
          if (active) setLoadError(error instanceof Error ? error.message : "서버 메시지를 불러오지 못했습니다.");
        } finally {
          refreshing = false;
        }
      };
      void refreshFanDirectMessages();
      const timer = setInterval(() => { void refreshFanDirectMessages(); }, 2000);
      return () => { active = false; controller.abort(); clearInterval(timer); };
    }, [account?.email, account?.role, blockedFans, snapshotReady]),
  );

  const isCurrentFanBlocked = Boolean(account?.role === "fan" && isFanBlocked(blockedFans, account.email));

  const newestFirstMessages = useMemo(() => {
    if (!account) return [];
    if (account.role === "artist") {
      return messages.filter(
        (message) =>
          (message.scope === "global" || message.senderRole === "fan") &&
          !(message.senderRole === "fan" && isFanBlocked(blockedFans, message.senderId)),
      ).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    }
    const fanMessages = getDirectMessages(messages, account.email);
    const visible = isFanBlocked(blockedFans, account.email)
      ? fanMessages.filter((message) => message.scope === "global" || message.senderRole === "fan")
      : fanMessages;
    return visible.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }, [account, blockedFans, messages]);

  const profileRenderState = useMemo(() => ({ account, members }), [account, members]);

  const fanMembers = useMemo(() => {
    const memberMap = new Map<string, string>();
    members.filter((member) => member.role === "fan").forEach((member) => memberMap.set(normalizeAccountEmail(member.email), member.displayName));
    messages.forEach((message) => {
      if (message.senderRole === "fan") {
        const sender = findAccountProfile(members, message.senderId, "fan");
        const fallbackName = message.senderName?.trim();
        memberMap.set(normalizeAccountEmail(message.senderId), sender?.displayName ?? (fallbackName && !/^[^\s@]+@[^\s@]+$/.test(fallbackName) ? fallbackName : "회원"));
      }
      if (message.recipientFanId && message.senderRole === "artist") {
        const recipient = findAccountProfile(members, message.recipientFanId, "fan");
        memberMap.set(normalizeAccountEmail(message.recipientFanId), recipient?.displayName ?? "회원");
      }
    });
    blockedFans.forEach((fanId) => {
      if (!memberMap.has(normalizeAccountEmail(fanId))) {
        const blockedFan = findAccountProfile(members, fanId, "fan");
        memberMap.set(normalizeAccountEmail(fanId), blockedFan?.displayName ?? "회원");
      }
    });
    return Array.from(memberMap.entries()).map(([id, name]) => ({ id, name }));
  }, [blockedFans, members, messages]);

  const filteredFanMembers = useMemo(() => {
    const query = memberSearch.trim().toLocaleLowerCase();
    const sorted = [...fanMembers].sort((left, right) => {
      const groupFor = (name: string) => /^[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(name.trim()) ? 0 : /^[a-z]/i.test(name.trim()) ? 1 : 2;
      const leftGroup = groupFor(left.name);
      const rightGroup = groupFor(right.name);
      if (leftGroup !== rightGroup) return leftGroup - rightGroup;
      return left.name.localeCompare(right.name, leftGroup === 0 ? "ko" : "en", { sensitivity: "base", numeric: true });
    });
    if (!query) return sorted;
    return sorted.filter((member) => member.name.toLocaleLowerCase().includes(query));
  }, [fanMembers, memberSearch]);

  const sendMessage = async (payload: { text?: string; imageUris?: string[]; media?: PendingImage[] }) => {
    if (!account) return;
    if (account.role === "fan") {
      const latestBlockedFans = await getBlockedFans();
      setBlockedFans(latestBlockedFans);
      if (isFanBlocked(latestBlockedFans, account.email)) return;
    }
    const uploaded = payload.media?.length ? await Promise.all(payload.media.map((media) => uploadMedia(media))) : [];
    if (account.role === "fan") {
      const latestBlockedFans = await getBlockedFans();
      setBlockedFans(latestBlockedFans);
      if (isFanBlocked(latestBlockedFans, account.email)) return;
    }
    const message: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      senderId: account.email,
      senderRole: account.role,
      senderName: account.displayName,
      scope: account.role === "artist" ? "global" : "direct",
      recipientFanId: account.role === "fan" ? account.email : undefined,
      text: payload.text,
      imageUris: uploaded.filter((media) => media.mediaType === "image").map((media) => media.url),
      media: uploaded,
      createdAt: new Date().toISOString(),
    };
    const savedMessage = await appendMessage(message);
    if (account.role === "fan") {
      offlineCountRequestVersion.current += 1;
      setOfflineArtistMessageCount(0);
      setOfflineCountError("");
      setOfflineCountStatus("ready");
    }
    const nextCursor = Math.max(messageCursorRef.current, savedMessage.serverSequence ?? 0);
    if (savedMessage.serverSequence) {
      messageCursorRef.current = nextCursor;
      setMessageCursor((current) => Math.max(current, nextCursor));
    }
    const cacheKey = messageSnapshotCacheKeyRef.current;
    const mergedSnapshot = cacheKey ? mergeMessageSnapshot(cacheKey, [savedMessage], nextCursor) : null;
    if (mergedSnapshot) setMessages(mergedSnapshot.messages);
    else {
      setMessages((currentMessages) => currentMessages.some((current) => current.id === savedMessage.id)
        ? currentMessages
        : [...currentMessages, savedMessage]);
    }
    mergeNewMessageMedia(setStableMedia, [savedMessage]);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => messageListRef.current?.scrollToOffset({ offset: 0, animated: true }));
    });
  };

  if (!account) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingState}>
          <Text style={styles.loadingText}>{loadError || "대화방을 준비하고 있습니다."}</Text>
          {loadError ? <Pressable onPress={() => { clearMessageSnapshotCache(); setReloadCount((count) => count + 1); }}><Text style={styles.loadingText}>다시 시도</Text></Pressable> : null}
          {loadError ? <Pressable onPress={() => router.replace("/")}><Text style={styles.loadingText}>로그인 화면으로 돌아가기</Text></Pressable> : null}
        </View>
      </SafeAreaView>
    );
  }

  const isArtist = account.role === "artist";
  return (
    <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.keyboardAvoiding}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerTitleBlock}>
            {isArtist ? <Text style={styles.eyebrow}>ARTIST ROOM</Text> : null}
            {!isArtist ? <Text style={styles.eyebrow}>PRIVATE ROOM</Text> : null}
            <View style={styles.headerTitleRow}>
              <Text style={[styles.title, !isArtist && styles.fanRoomTitle]}>{isArtist ? "전체 대화방" : "우리만의 작은 우체통"}</Text>
              {isArtist ? (
                <Pressable accessibilityLabel="관리 메뉴" accessibilityRole="button" onPress={() => setMenuVisible(true)} style={styles.managementMenuTrigger}>
                  <MaterialIcons color={INK} name="settings" size={16} />
                  <Text style={styles.managementMenuLabel}>관리 메뉴</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
          <View style={styles.headerActions}>
            <ProfileHeaderButton
              email={account.email}
              displayName={account.displayName}
              initialAvatarUri={account.avatarUri}
              offlineCount={isArtist ? 0 : offlineArtistMessageCount}
              onPress={() => router.push(`/profile?account=${encodeURIComponent(account.email)}` as never)}
            />
          </View>
        </View>
        {!isArtist && offlineCountError ? <Text style={styles.offlineCountError}>{offlineCountError}</Text> : null}

        <View style={styles.divider} />
        {loadError ? <Pressable onPress={() => { clearMessageSnapshotCache(); setReloadCount((count) => count + 1); }} style={styles.serverError}><Text style={styles.serverErrorText}>{loadError} · 눌러 다시 시도</Text></Pressable> : null}
        {profileSyncError ? <Text style={styles.readSyncError}>{profileSyncError}</Text> : null}
        <FlatList
          ref={messageListRef}
          onScroll={handleMessageScroll}
          scrollEventThrottle={16}
          contentContainerStyle={styles.messageList}
          data={newestFirstMessages}
          extraData={profileRenderState}
          inverted
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          initialNumToRender={5}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<Text style={styles.emptyText}>아직 도착한 메시지가 없습니다.</Text>}
          maxToRenderPerBatch={3}
          removeClippedSubviews={Platform.OS === "android"}
          windowSize={5}
          renderItem={({ item, index }) => {
            const olderMessage = newestFirstMessages[index + 1];
            const showDateSeparator = !olderMessage || getMessageDateKey(olderMessage.createdAt) !== getMessageDateKey(item.createdAt);
            const isFanReply = isArtist && item.senderRole === "fan";
            const isRightAligned = isArtist ? item.senderRole === "artist" : item.senderRole === "fan";
            const artistOwnMessage = isArtist && item.senderRole === "artist";
            const media = stableMedia[item.id] ?? item;
            const hasMedia = Boolean(media.media?.length || media.imageUris?.length || media.imageUri);
            const hasImages = Boolean(media.imageUris?.length || media.imageUri);
            const hasFrameMedia = Boolean(media.media?.some((mediaItem) => mediaItem.mediaType === "audio" || mediaItem.mediaType === "video"));
            const hasReadReceipt = item.scope === "direct"
              && normalizeAccountEmail(item.senderId) === normalizeAccountEmail(account.email)
              && (readBy[item.id] ?? item.readBy ?? []).some((readerId) => normalizeAccountEmail(readerId) !== normalizeAccountEmail(account.email));
            const uniqueArtistAccount = account.role === "artist" && members.filter((member) => member.role === "artist").length === 1;
            const isCurrentAccount = item.senderRole === account.role && (normalizeAccountEmail(item.senderId) === normalizeAccountEmail(account.email) || uniqueArtistAccount);
            const registeredSender = findAccountProfile(members, item.senderId, item.senderRole);
            const senderName = isCurrentAccount ? account.displayName : registeredSender?.displayName ?? item.senderName;
            const senderAvatarUri = isCurrentAccount ? account.avatarUri : registeredSender?.avatarUri;
            const isIncomingArtistDirectMessage = !isArtist && item.senderRole === "artist" && item.scope === "direct";
            const displayText = item.text && !isArtist && item.senderRole === "artist"
              ? renderArtistGlobalMessage(item.text, account.displayName)
              : item.text;
            const bubbleAlignment = isRightAligned ? undefined : { marginLeft: 29 };
            const anchorWidth = messageAnchorWidths[item.id];
            const timestampAlignment = anchorWidth ? { width: anchorWidth, marginLeft: isRightAligned ? 0 : 29 } : bubbleAlignment;
            return (
              <View style={[styles.messageRow, isRightAligned && styles.messageRowRight]}>
                {showDateSeparator ? (
                  <View style={styles.dateSeparator}>
                    <View style={styles.dateSeparatorLine} />
                    <Text style={styles.dateSeparatorText}>{formatMessageDate(item.createdAt)}</Text>
                    <View style={styles.dateSeparatorLine} />
                  </View>
                ) : null}
                {isFanReply ? (
                  <Pressable
                    onPress={() => router.push(`/direct/${encodeURIComponent(item.senderId)}?account=${encodeURIComponent(account.email)}` as never)}
                    style={({ pressed }) => [styles.senderButton, pressed && styles.pressed]}
                  >
                    <ServerProfileImage email={item.senderId} initialUri={senderAvatarUri} resizeMode="cover" style={styles.senderAvatar} fallback={<View style={styles.senderAvatarPlaceholder}><Text style={styles.senderAvatarText}>{senderName.slice(0, 1)}</Text></View>} />
                    <View style={styles.senderCopy}>
                      <Text ellipsizeMode="tail" numberOfLines={1} style={styles.senderName}>{senderName}</Text>
                      <Text style={styles.directHint}>닉네임을 눌러 개인 대화</Text>
                    </View>
                  </Pressable>
                ) : null}
                <View style={[styles.messageContent, hasMedia && styles.mediaMessageContent, isRightAligned && styles.messageContentRight, isRightAligned && !hasMedia && styles.outgoingTextMessageContent]}>
                  {!isFanReply ? (
                    <View style={styles.identityRow}>
                      <ServerProfileImage email={item.senderId} initialUri={senderAvatarUri} resizeMode="cover" style={styles.senderAvatar} fallback={<View style={styles.senderAvatarPlaceholder}><Text style={styles.senderAvatarText}>{senderName.slice(0, 1)}</Text></View>} />
                      <Text ellipsizeMode="tail" numberOfLines={1} style={styles.senderName}>{senderName}</Text>
                    </View>
                  ) : null}
                  {hasMedia ? (
                    <View
                      onLayout={!hasImages && !hasFrameMedia && !item.text ? (event) => {
                        const width = event.nativeEvent.layout.width;
                        setMessageAnchorWidths((current) => current[item.id] === width ? current : { ...current, [item.id]: width });
                      } : undefined}
                      style={[styles.attachmentGroup, bubbleAlignment, isRightAligned ? styles.attachmentGroupRight : styles.attachmentGroupLeft]}
                    >
                      <MessageImages imageUris={media.imageUris} legacyImageUri={media.imageUri} roundedPopup align={isRightAligned ? "right" : "left"} privateMessage={!isArtist && item.senderRole === "artist" && item.scope === "direct"} onContentLayout={!item.text ? (width) => setMessageAnchorWidths((current) => current[item.id] === width ? current : { ...current, [item.id]: width }) : undefined} />
                      <MessageMedia media={media.media} align={isRightAligned ? "right" : "left"} privateMessage={!isArtist && item.senderRole === "artist" && item.scope === "direct"} onContentLayout={!hasImages && !item.text ? (width) => setMessageAnchorWidths((current) => current[item.id] === width ? current : { ...current, [item.id]: width }) : undefined} />
                    </View>
                  ) : null}
                  {item.text ? (
                    <View
                      style={[
                        styles.bubble,
                        isRightAligned && !hasMedia && styles.outgoingTextBubble,
                        bubbleAlignment,
                        hasMedia && styles.textBubbleAfterMedia,
                        isRightAligned ? styles.bubbleCornerRight : styles.bubbleCornerLeft,
                        isArtist
                          ? artistOwnMessage
                            ? styles.artistOwnBubble
                            : styles.artistOtherBubble
                          : item.senderRole === "fan"
                            ? styles.fanBubble
                          : item.scope === "direct"
                              ? styles.directBubble
                              : styles.artistBubble,
                        isRightAligned ? styles.rightBubble : isIncomingArtistDirectMessage ? undefined : styles.leftTextBubble,
                      ]}
                      onLayout={(event) => {
                        const width = event.nativeEvent.layout.width;
                        setMessageAnchorWidths((current) => current[item.id] === width ? current : { ...current, [item.id]: width });
                      }}
                    >
                      <Text
                        style={[
                          styles.messageText,
                          isArtist
                            ? artistOwnMessage
                              ? styles.artistOwnText
                              : styles.artistOtherText
                            : item.senderRole === "fan"
                              ? styles.fanMessageText
                            : item.scope === "direct"
                                ? styles.directMessageText
                                : null,
                          isRightAligned && styles.rightMessageText,
                        ]}
                      >{displayText}</Text>
                    </View>
                  ) : null}
                  <View style={[styles.timeRow, timestampAlignment]}>
                    {hasReadReceipt ? <Text style={styles.readText}>읽음</Text> : null}
                    <Text style={[styles.time, isRightAligned && styles.timeRight]}>{formatMessageTime(item.createdAt)}</Text>
                  </View>
                </View>
              </View>
            );
          }}
          showsVerticalScrollIndicator={false}
        />

        {showScrollToLatest ? (
          <Pressable accessibilityLabel="최신 메시지로 이동" accessibilityRole="button" onPress={scrollToLatest} style={styles.scrollToLatestButton}>
            <MaterialIcons color="#ffffff" name="keyboard-arrow-down" size={23} />
          </Pressable>
        ) : null}

        {isCurrentFanBlocked ? (
          <View style={styles.blockedNotice}>
            <Text style={styles.blockedNoticeText}>아티스트가 회원님을 차단했습니다.{"\n"}아티스트가 차단을 해제하면 다시 메시지를 보낼 수 있습니다.</Text>
          </View>
        ) : null}
        <ChatComposer disabled={isCurrentFanBlocked} enableUserToken={isArtist} onSend={sendMessage} />
        {readSyncError ? (
          <Text style={styles.readSyncError}>{readSyncError}</Text>
        ) : null}
        {isArtist ? (
          <Modal
            animationType="fade"
            transparent
            visible={menuVisible}
            onRequestClose={() => {
              setMemberManagementOpen(false);
              setMenuVisible(false);
            }}
          >
            <Pressable
              style={styles.modalBackdrop}
              onPress={() => {
                setMemberManagementOpen(false);
                setMenuVisible(false);
              }}
            >
              <Pressable
                style={[styles.menuSheet, memberManagementOpen && styles.memberManagementSheet]}
                onPress={() => undefined}
              >
                <View style={styles.sheetHandle} />
                {memberManagementOpen ? (
                  <>
                    <View style={styles.memberManagementHeader}>
                      <Pressable
                        accessibilityLabel="관리 메뉴로 돌아가기"
                        onPress={() => setMemberManagementOpen(false)}
                        style={styles.memberBackButton}
                      >
                        <Text style={styles.memberBackText}>←</Text>
                      </Pressable>
                      <View style={styles.memberManagementTitles}>
                        <Text style={styles.sheetEyebrow}>ROOM MEMBERS</Text>
                        <Text style={styles.memberSheetTitle}>전체 회원 관리</Text>
                      </View>
                      <View style={styles.memberHeaderSpacer} />
                    </View>
                    <Text style={styles.settingDescription}>닉네임과 상태를 확인하고 회원 카드를 눌러 차단을 전환합니다.</Text>
                    {moderationError ? <Text style={[styles.settingDescription, { color: "#e07b72" }]}>{moderationError}</Text> : null}
                    <TextInput
                      nativeID="dm-member-search-input"
                      onChangeText={setMemberSearch}
                      placeholder="닉네임 검색"
                      placeholderTextColor="#aaa198"
                      style={styles.memberSearch}
                      value={memberSearch}
                    />
                    <ScrollView
                      accessibilityLabel="전체 회원 목록"
                      contentContainerStyle={styles.memberGrid}
                      keyboardShouldPersistTaps="handled"
                      style={styles.memberListScroll}
                    >
                      {filteredFanMembers.length ? filteredFanMembers.map((member) => {
                        const blocked = blockedFans.some((fanId) => normalizeAccountEmail(fanId) === member.id);
                        return (
                          <Pressable
                            accessibilityLabel={`회원 ${member.name}, ${blocked ? "차단됨" : "참여 가능"}`}
                            key={member.id}
                            onPress={async () => {
                              try {
                                setBlockedFans(await setFanBlocked(member.id, !blocked, account.email));
                                setModerationError("");
                              } catch (error) {
                                setModerationError(error instanceof Error ? error.message : "차단 상태를 PC 서버에 저장하지 못했습니다.");
                              }
                            }}
                            style={styles.memberCard}
                          >
                            <Text numberOfLines={1} style={styles.memberName}>{member.name}</Text>
                            <Text style={[styles.memberStatus, blocked ? styles.memberStatusBlocked : styles.memberStatusActive]}>
                              {blocked ? "차단됨" : "참여 가능"}
                            </Text>
                          </Pressable>
                        );
                      }) : <Text style={styles.noMembers}>{memberSearch ? "검색된 회원이 없습니다." : "아직 가입한 회원이 없습니다."}</Text>}
                    </ScrollView>
                    <Pressable
                      onPress={() => {
                        setMemberManagementOpen(false);
                        setMenuVisible(false);
                      }}
                      style={styles.closeMenuButton}
                    >
                      <Text style={styles.closeMenuText}>닫기</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text style={styles.sheetEyebrow}>ROOM MANAGEMENT</Text>
                    <Text style={styles.adminMenuTitle}>관리 메뉴</Text>
                    <View style={styles.settingRow}>
                      <View style={styles.settingCopy}>
                        <Text style={styles.settingTitle}>신규 가입 허용</Text>
                        <Text style={styles.settingDescription}>허용할 때 팬이 계정을 만들 수 있습니다.</Text>
                      </View>
                      <Switch
                        onValueChange={async (value) => {
                          setJoinOpenState(value);
                          await setJoinOpen(value);
                        }}
                        value={joinOpen}
                      />
                    </View>
                    <Pressable
                      onPress={() => {
                        setMemberSearch("");
                        setMemberManagementOpen(true);
                      }}
                      style={styles.memberManagementButton}
                    >
                      <View style={styles.settingCopy}>
                        <Text style={styles.settingTitle}>전체 회원 관리</Text>
                        <Text style={styles.settingDescription}>닉네임 검색과 회원 상태를 확인합니다.</Text>
                      </View>
                      <Text style={styles.memberManagementArrow}>→</Text>
                    </Pressable>
                    <Pressable onPress={() => setMenuVisible(false)} style={styles.closeMenuButton}>
                      <Text style={styles.closeMenuText}>닫기</Text>
                    </Pressable>
                  </>
                )}
              </Pressable>
            </Pressable>
          </Modal>
        ) : null}
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: PAPER, flex: 1 },
  keyboardAvoiding: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 20 },
  loadingState: { alignItems: "center", flex: 1, justifyContent: "center" },
  loadingText: { color: MUTED, fontSize: 13 },
  header: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", paddingBottom: 4, paddingTop: 4 },
  eyebrow: { color: ACCENT, fontSize: 9, fontWeight: "700", letterSpacing: 1.5, marginBottom: 4 },
  title: { color: INK, fontSize: 18, fontWeight: "700", letterSpacing: -0.8 },
  fanRoomTitle: { fontStyle: "italic" },
  headerTitleBlock: { flexShrink: 1 },
  headerTitleRow: { alignItems: "center", flexDirection: "row", gap: 7 },
  managementMenuTrigger: { alignItems: "center", flexDirection: "row", gap: 3, paddingVertical: 3 },
  managementMenuLabel: { color: MUTED, fontSize: 9, fontWeight: "600" },
  headerActions: { alignItems: "flex-end", flexDirection: "row", gap: 4 },
  divider: { backgroundColor: LINE, height: 1 },
  messageList: { flexGrow: 1, gap: 14, paddingBottom: 18, paddingTop: 24 },
  messageRow: { alignItems: "flex-start" },
  messageRowRight: { alignItems: "flex-end" },
  dateSeparator: { alignSelf: "stretch", alignItems: "center", flexDirection: "row", gap: 10, marginBottom: 8, marginTop: 8, width: "100%" },
  dateSeparatorLine: { backgroundColor: "#333333", flex: 1, height: 1 },
  dateSeparatorText: { color: MUTED, fontSize: 11, fontWeight: "600", letterSpacing: 0.2 },
  messageContent: { alignItems: "flex-start", maxWidth: "82%" },
  messageContentRight: { alignItems: "flex-end" },
  outgoingTextMessageContent: { width: 240 },
  senderButton: { alignItems: "center", flexDirection: "row", gap: 7, marginBottom: 10, maxWidth: "82%" },
  senderCopy: { flexShrink: 0, width: 220 },
  identityRow: { alignItems: "center", flexDirection: "row", gap: 7, marginBottom: 10, maxWidth: "100%" },
  identityRowRight: { flexDirection: "row-reverse" },
  senderAvatar: { borderRadius: 11, height: 22, width: 22 },
  senderAvatarPlaceholder: { alignItems: "center", backgroundColor: "#d6bb45", borderRadius: 11, height: 22, justifyContent: "center", width: 22 },
  senderAvatarText: { color: "#151515", fontSize: 10, fontWeight: "800" },
  senderName: { color: ACCENT, flexShrink: 0, fontSize: 12, fontWeight: "700", maxWidth: 220, width: 220 },
  directHint: { color: MUTED, fontSize: 9, marginTop: 2 },
  bubble: { borderRadius: 16, maxWidth: "82%", paddingHorizontal: 15, paddingVertical: 12 },
  outgoingTextBubble: { maxWidth: "100%" },
  bubbleCornerLeft: { borderTopLeftRadius: 0 },
  bubbleCornerRight: { borderTopRightRadius: 0 },
  textBubbleAfterMedia: { marginTop: 6 },
  mediaMessageContent: { maxWidth: "82%", width: 270 },
  attachmentGroup: { maxWidth: "100%", width: "100%" },
  attachmentGroupLeft: { alignItems: "flex-start" },
  attachmentGroupRight: { alignItems: "flex-end" },
  artistBubble: { backgroundColor: "#16c5d4" },
  artistOwnBubble: { backgroundColor: "#d6bb45" },
  artistOtherBubble: { backgroundColor: "#16c5d4" },
  directBubble: { backgroundColor: "#d6bb45", borderColor: "#f0d96a", borderWidth: 1 },
  fanBubble: { backgroundColor: "rgba(230,230,230,0.7)" },
  leftTextBubble: { backgroundColor: ACCENT, borderColor: ACCENT },
  rightBubble: { backgroundColor: "rgba(58,58,58,0.7)" },
  messageText: { color: "#ffffff", fontFamily: "GowunDodum", fontSize: 15, lineHeight: 22 },
  fanMessageText: { color: "#151515" },
  directMessageText: { color: "#000000", fontWeight: "700" },
  rightMessageText: { color: "#ffffff" },
  artistOwnText: { color: "#151515" },
  artistOtherText: { color: "#ffffff" },
  messageImage: { borderRadius: 2, height: 180, marginBottom: 8, width: 180 },
  time: { color: "#8a8a8a", fontSize: 9, marginTop: 5 },
  timeRight: { textAlign: "right" },
  timeRow: { alignItems: "center", flexDirection: "row", gap: 5, justifyContent: "flex-end", marginTop: 5 },
  readText: { color: "#7bd7a7", fontSize: 9, fontWeight: "700" },
  emptyText: { color: MUTED, fontSize: 13, paddingTop: 30, textAlign: "center" },
  serverError: { borderColor: "#a3493d", borderWidth: 1, marginTop: 10, padding: 10 },
  serverErrorText: { color: "#e38b7d", fontSize: 11 },
  offlineCountError: { color: "#a3493d", fontSize: 10, paddingBottom: 8 },
  pressed: { opacity: 0.65 },
  readSyncError: { color: "#e38b7d", fontSize: 10, paddingBottom: 12, paddingHorizontal: 12, paddingTop: 8, textAlign: "center" },
  scrollToLatestButton: { alignItems: "center", backgroundColor: ACCENT, borderRadius: 18, bottom: 62, elevation: 4, height: 36, justifyContent: "center", position: "absolute", right: 8, shadowColor: "#000000", shadowOffset: { height: 2, width: 0 }, shadowOpacity: 0.35, shadowRadius: 4, width: 36, zIndex: 5 },
  blockedNotice: { alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, width: "100%" },
  blockedNoticeText: { color: "#d18478", fontFamily: "GowunDodum", fontSize: 13, lineHeight: 20, textAlign: "center" },
  modalBackdrop: { backgroundColor: "rgba(25, 24, 23, 0.32)", flex: 1, justifyContent: "flex-end" },
  menuSheet: { backgroundColor: PAPER, padding: 24, paddingBottom: 32 },
  memberManagementSheet: { maxHeight: "88%" },
  sheetHandle: { alignSelf: "center", backgroundColor: LINE, height: 4, marginBottom: 24, width: 40 },
  sheetEyebrow: { color: ACCENT, fontSize: 9, fontWeight: "700", letterSpacing: 1.6, marginBottom: 7 },
  adminMenuTitle: { color: INK, fontSize: 24, fontWeight: "700", marginBottom: 24 },
  sheetTitle: { color: INK, fontSize: 24, fontWeight: "700" },
  memberManagementHeader: { alignItems: "center", flexDirection: "row", marginBottom: 16 },
  memberBackButton: { alignItems: "center", borderColor: LINE, borderRadius: 10, borderWidth: 1, height: 40, justifyContent: "center", width: 40 },
  memberBackText: { color: INK, fontSize: 22 },
  memberManagementTitles: { alignItems: "center", flex: 1 },
  memberHeaderSpacer: { width: 40 },
  memberSheetTitle: { color: INK, fontSize: 22, fontWeight: "700" },
  settingRow: { alignItems: "center", borderBottomColor: LINE, borderBottomWidth: 1, flexDirection: "row", paddingBottom: 18 },
  settingCopy: { flex: 1, gap: 5 },
  settingTitle: { color: INK, fontSize: 14, fontWeight: "700" },
  settingDescription: { color: MUTED, fontSize: 11, lineHeight: 17 },
  memberManagementButton: { alignItems: "center", borderBottomColor: LINE, borderBottomWidth: 1, flexDirection: "row", marginTop: 8, paddingVertical: 18 },
  memberManagementArrow: { color: ACCENT, fontSize: 23, fontWeight: "500" },
  memberSearch: { borderBottomColor: LINE, borderBottomWidth: 1, color: INK, fontSize: 13, marginTop: 14, paddingBottom: 10, paddingTop: 12 },
  memberListScroll: { maxHeight: 400, minHeight: 120, width: "100%" },
  memberGrid: { alignContent: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 12 },
  memberCard: { alignItems: "center", backgroundColor: "#111111", borderColor: LINE, borderRadius: 12, borderWidth: 1, flexBasis: "30%", flexDirection: "row", flexGrow: 1, gap: 8, justifyContent: "space-between", minHeight: 64, minWidth: 130, paddingHorizontal: 12, paddingVertical: 12 },
  memberName: { color: INK, flex: 1, fontSize: 13, fontWeight: "700" },
  memberStatus: { borderRadius: 999, fontSize: 10, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 5 },
  memberStatusActive: { backgroundColor: "rgba(43, 182, 115, 0.14)", color: ACCENT },
  memberStatusBlocked: { backgroundColor: "rgba(163, 73, 61, 0.2)", color: "#e38b7d" },
  noMembers: { color: MUTED, fontSize: 11, paddingVertical: 15, textAlign: "center", width: "100%" },
  closeMenuButton: { alignItems: "center", backgroundColor: INK, marginTop: 20, paddingVertical: 15 },
  closeMenuText: { color: PAPER, fontSize: 12, fontWeight: "700", letterSpacing: 1 },
});
