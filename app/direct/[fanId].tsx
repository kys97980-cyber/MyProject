import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import ChatComposer from "@/components/ChatComposer";
import AuthenticatedImage from "@/components/AuthenticatedImage";
import ProfileHeaderButton from "@/components/ProfileHeaderButton";
import type { PendingImage } from "@/components/ChatComposer";
import MessageImages from "@/components/MessageImages";
import MessageMedia from "@/components/MessageMedia";
import { getLocalAccount, getLocalAccountByEmail, getLocalSession, type LocalAccount } from "@/lib/auth";
import { findAccountProfile, normalizeAccountEmail } from "@/lib/account-api";
import { appendMessage, getMessagesSnapshot, getNewMessages, getUnreadIncomingMessageIds, markMessagesRead, type ChatMessage } from "@/lib/chat-store";
import { getAccounts, getBlockedFans } from "@/lib/moderation-store";
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

const appendOnlyMessages = (currentMessages: ChatMessage[], incomingMessages: ChatMessage[]) => {
  const seenIds = new Set(currentMessages.map((message) => message.id));
  const newMessages: ChatMessage[] = [];
  for (const message of incomingMessages) {
    if (seenIds.has(message.id)) continue;
    seenIds.add(message.id);
    newMessages.push(message);
  }
  return newMessages.length ? [...currentMessages, ...newMessages] : currentMessages;
};

const addReadReceipt = (messages: ChatMessage[], messageIds: string[], readerId: string) => {
  const readIds = new Set(messageIds);
  return messages.map((message) => readIds.has(message.id)
    ? { ...message, readBy: [...new Set([...(message.readBy ?? []), readerId])] }
    : message);
};

export default function DirectChatScreen() {
  const { fanId: rawFanId, account: accountParam } = useLocalSearchParams<{ fanId: string; account?: string }>();
  const fanId = normalizeAccountEmail(decodeURIComponent(rawFanId ?? ""));
  const requestedArtistEmail = accountParam ? decodeURIComponent(accountParam) : "";
  const messageListRef = useRef<FlatList<ChatMessage> | null>(null);
  const [account, setAccount] = useState<LocalAccount | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageCursor, setMessageCursor] = useState(0);
  const messageCursorRef = useRef(0);
  const messageSnapshotCacheKeyRef = useRef("");
  const [isBlocked, setIsBlocked] = useState(false);
  const [moderationLoaded, setModerationLoaded] = useState(false);
  const [readSyncError, setReadSyncError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [profileSyncError, setProfileSyncError] = useState("");
  const [fanName, setFanName] = useState("회원");
  const [fanAvatarUri, setFanAvatarUri] = useState<string | undefined>();
  const [accounts, setAccounts] = useState<Awaited<ReturnType<typeof getAccounts>>>([]);
  const [messageAnchorWidths, setMessageAnchorWidths] = useState<Record<string, number>>({});
  const [serverBaseUrl, setServerBaseUrl] = useState(() => getServerBaseUrlSync());

  useEffect(() => {
    messageCursorRef.current = messageCursor;
  }, [messageCursor]);

  useEffect(() => subscribeServerUrl(setServerBaseUrl), []);

  useFocusEffect(
    useCallback(() => subscribeToProfileChanges((profile) => {
      const changedEmail = normalizeAccountEmail(profile.email);
      setAccount((current) => current && normalizeAccountEmail(current.email) === changedEmail
        ? { ...current, ...profile }
        : current);
      if (changedEmail !== fanId) return;
      setFanName(profile.displayName);
      setFanAvatarUri(profile.avatarUri);
      setAccounts((current) => current.map((member) => normalizeAccountEmail(member.email) === changedEmail
        ? { ...member, ...profile }
        : member));
    }), [fanId]),
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const controller = new AbortController();
      setModerationLoaded(false);
      setLoadError("");
      setReadSyncError("");
      setProfileSyncError("");
      setMessages([]);
      setAccounts([]);
      setAccount(null);
      setFanName("회원");
      setFanAvatarUri(undefined);
      setMessageAnchorWidths({});

      const loadSnapshot = async () => {
        try {
          const localAccount = await (requestedArtistEmail ? getLocalAccountByEmail(requestedArtistEmail) : getLocalAccount());
          if (!active) return;
          if (!localAccount || localAccount.role !== "artist") {
            clearMessageSnapshotCache();
            router.replace("/");
            return;
          }
          const cacheKey = createMessageSnapshotKey(localAccount.email, localAccount.role, serverBaseUrl);
          const cachedSnapshot = getMessageSnapshot(cacheKey);
          messageSnapshotCacheKeyRef.current = cacheKey;
          const snapshotPromise = cachedSnapshot
            ? Promise.resolve({ messages: cachedSnapshot.messages, nextCursor: cachedSnapshot.cursor })
            : getMessagesSnapshot(controller.signal);
          const [snapshot, blockedFans, members, sessionEmail] = await Promise.all([
            snapshotPromise,
            getBlockedFans(requestedArtistEmail || undefined),
            getAccounts(),
            getLocalSession(),
          ]);
          if (!active) return;
          const threadMessages = snapshot.messages.filter((message) =>
            message.scope === "direct"
            && (normalizeAccountEmail(message.senderId) === fanId || normalizeAccountEmail(message.recipientFanId ?? "") === fanId),
          );
          let sharedMessages = snapshot.messages;
          const incomingConversationMessages = threadMessages.filter((message) => message.senderRole === "fan");
          const blocked = blockedFans.includes(fanId);
          const hasActiveSession = Boolean(sessionEmail) && normalizeAccountEmail(sessionEmail!) === normalizeAccountEmail(localAccount.email);
          const readIds = hasActiveSession && !blocked
            ? getUnreadIncomingMessageIds(incomingConversationMessages, localAccount.email, "artist")
            : [];
          let storedMessages = threadMessages;
          let nextCursor = snapshot.nextCursor;
          if (readIds.length) {
            try {
              await markMessagesRead(readIds, localAccount.email, controller.signal);
              sharedMessages = addReadReceipt(sharedMessages, readIds, localAccount.email);
              storedMessages = sharedMessages.filter((message) =>
                message.scope === "direct"
                && (normalizeAccountEmail(message.senderId) === fanId || normalizeAccountEmail(message.recipientFanId ?? "") === fanId),
              );
              if (active) setReadSyncError("");
            } catch (error) {
              if (active) setReadSyncError(error instanceof Error ? error.message : "읽음 상태 동기화에 실패했습니다.");
              const earliestUnreadSequence = threadMessages
                .filter((message) => readIds.includes(message.id))
                .reduce((minimum, message) => Math.min(minimum, message.serverSequence ?? 0), Number.POSITIVE_INFINITY);
              if (Number.isFinite(earliestUnreadSequence)) nextCursor = Math.min(nextCursor, Math.max(0, earliestUnreadSequence - 1));
            }
          }
          if (!active) return;
          messageCursorRef.current = nextCursor;
          replaceMessageSnapshot(cacheKey, sharedMessages, nextCursor);
          setAccount(localAccount);
          setMessages(storedMessages);
          setMessageCursor(nextCursor);
          setIsBlocked(blocked);
          setModerationLoaded(true);
          setAccounts(members);
          const registeredMember = findAccountProfile(members, fanId, "fan");
          const messageMember = storedMessages.find((message) => normalizeAccountEmail(message.senderId) === fanId && message.senderRole === "fan");
          setFanName(registeredMember?.displayName ?? messageMember?.senderName ?? "회원");
          setFanAvatarUri(registeredMember?.avatarUri);
        } catch (error) {
          if (active) setLoadError(error instanceof Error ? error.message : "개인 대화방을 불러오지 못했습니다.");
        }
      };
      void loadSnapshot();
      return () => {
        active = false;
        controller.abort();
        setModerationLoaded(false);
        setMessages([]);
        messageCursorRef.current = 0;
        setMessageCursor(0);
        setAccounts([]);
        setAccount(null);
        setIsBlocked(false);
        setFanName("회원");
        setFanAvatarUri(undefined);
        setMessageAnchorWidths({});
        setReadSyncError("");
        setProfileSyncError("");
      };
    }, [fanId, requestedArtistEmail, serverBaseUrl]),
  );

  useFocusEffect(useCallback(() => {
    if (!account?.email) return;
    return subscribeToServerProfiles((profiles) => {
      const byEmail = new Map(profiles.map((profile) => [normalizeAccountEmail(profile.email), profile]));
      setAccount((current) => current ? applyServerProfile(current, byEmail.get(normalizeAccountEmail(current.email))) : current);
      setAccounts((current) => {
        let changed = false;
        const next = current.map((member) => {
          const updated = applyServerProfile(member, byEmail.get(normalizeAccountEmail(member.email)));
          if (updated !== member) changed = true;
          return updated;
        });
        return changed ? next : current;
      });
    }, (error) => setProfileSyncError(error?.message ?? ""));
  }, [account?.email, serverBaseUrl]));

  useEffect(() => {
    const member = findAccountProfile(accounts, fanId, "fan");
    if (!member) return;
    setFanName(member.displayName);
    setFanAvatarUri(member.avatarUri);
  }, [accounts, fanId]);

  useFocusEffect(
    useCallback(() => {
      const cacheKey = messageSnapshotCacheKeyRef.current;
      if (!account || !moderationLoaded || !cacheKey) return;
      let active = true;
      const controller = new AbortController();
      let refreshing = false;
      const refreshMessages = async () => {
        if (refreshing) return;
        refreshing = true;
        try {
          const [updates, sessionEmail] = await Promise.all([getNewMessages(messageCursorRef.current, controller.signal), getLocalSession()]);
          const remoteMessages = updates.messages;
          const threadMessages = remoteMessages.filter((message) =>
            message.scope === "direct"
            && (normalizeAccountEmail(message.senderId) === fanId || normalizeAccountEmail(message.recipientFanId ?? "") === fanId),
          );
          const hasActiveSession = Boolean(sessionEmail) && normalizeAccountEmail(sessionEmail!) === normalizeAccountEmail(account.email);
          const conversationMessages = threadMessages.filter((message) => message.senderRole === "fan");
          const readIds = hasActiveSession && !isBlocked
            ? getUnreadIncomingMessageIds(conversationMessages, account.email, "artist")
            : [];
          let nextMessages = threadMessages;
          let advanceCursor = true;
          if (readIds.length) {
            try {
              await markMessagesRead(readIds, account.email, controller.signal);
              nextMessages = addReadReceipt(threadMessages, readIds, account.email);
              if (active) setReadSyncError("");
            } catch (error) {
              advanceCursor = false;
              if (active) setReadSyncError(error instanceof Error ? error.message : "읽음 상태 동기화에 실패했습니다.");
            }
          }
          if (!active) return;
          const nextCursor = advanceCursor ? Math.max(messageCursorRef.current, updates.nextCursor) : messageCursorRef.current;
          const sharedUpdates = readIds.length && advanceCursor
            ? addReadReceipt(remoteMessages, readIds, account.email)
            : remoteMessages;
          if (remoteMessages.length) mergeMessageSnapshot(cacheKey, sharedUpdates, nextCursor);
          else advanceMessageSnapshotCursor(cacheKey, nextCursor);
          if (nextMessages.length) setMessages((currentMessages) => appendOnlyMessages(currentMessages, nextMessages));
          if (advanceCursor) {
            messageCursorRef.current = nextCursor;
            setMessageCursor(nextCursor);
          }
        } catch { /* Keep the latest messages already loaded while the PC server is unavailable. */ }
        finally { refreshing = false; }
      };
      void refreshMessages();
      const timer = setInterval(() => { void refreshMessages(); }, 2000);
      return () => { active = false; controller.abort(); clearInterval(timer); };
    }, [account?.email, account?.role, fanId, isBlocked, moderationLoaded, serverBaseUrl]),
  );

  const newestFirstMessages = useMemo(
    () =>
      messages.filter(
        (message) =>
          message.scope === "direct" &&
          (normalizeAccountEmail(message.recipientFanId ?? "") === fanId || normalizeAccountEmail(message.senderId) === fanId),
      ).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)),
    [fanId, messages],
  );

  const profileRenderState = useMemo(() => ({ account, accounts, fanName, fanAvatarUri }), [account, accounts, fanName, fanAvatarUri]);

  const sendMessage = async (payload: { text?: string; imageUris?: string[]; media?: PendingImage[] }) => {
    if (!account || isBlocked) return;
    const uploaded = payload.media?.length ? await Promise.all(payload.media.map((media) => uploadMedia(media))) : [];
    const message: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      senderId: account.email,
      senderRole: "artist",
      senderName: account.displayName,
      scope: "direct",
      recipientFanId: fanId,
      text: payload.text,
      imageUris: uploaded.filter((media) => media.mediaType === "image").map((media) => media.url),
      media: uploaded,
      createdAt: new Date().toISOString(),
    };
    const savedMessage = await appendMessage(message);
    setMessages((currentMessages) => appendOnlyMessages(currentMessages, [savedMessage]));
    const nextCursor = Math.max(messageCursorRef.current, savedMessage.serverSequence ?? 0);
    if (savedMessage.serverSequence) {
      messageCursorRef.current = nextCursor;
      setMessageCursor((current) => Math.max(current, nextCursor));
    }
    const cacheKey = messageSnapshotCacheKeyRef.current;
    if (cacheKey) mergeMessageSnapshot(cacheKey, [savedMessage], nextCursor);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => messageListRef.current?.scrollToOffset({ offset: 0, animated: true }));
    });
  };

  if (!account) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingState}><Text style={styles.loadingText}>{loadError || "개인 대화방을 준비하고 있습니다."}</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top", "left", "right", "bottom"]} style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.keyboardAvoiding}>
        <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>PRIVATE MESSAGE</Text>
            <View style={styles.titleRow}>
              <Pressable onPress={() => router.replace(`/chat?account=${encodeURIComponent(account.email)}` as never)} style={styles.backButton}><Text style={styles.backText}>←</Text></Pressable>
              <Text style={styles.title}>{fanName}</Text>
            </View>
          </View>
          <ProfileHeaderButton
            email={account.email}
            displayName={account.displayName}
            initialAvatarUri={account.avatarUri}
            onPress={() => router.push(`/profile?account=${encodeURIComponent(account.email)}` as never)}
          />
        </View>
        <View style={styles.divider} />
        {profileSyncError ? <Text style={styles.loadingText}>{profileSyncError}</Text> : null}
        <FlatList
          ref={messageListRef}
          contentContainerStyle={styles.messageList}
          data={newestFirstMessages}
          extraData={profileRenderState}
          inverted
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          initialNumToRender={5}
          maxToRenderPerBatch={3}
          removeClippedSubviews={Platform.OS === "android"}
          windowSize={5}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<Text style={styles.emptyText}>아직 이 팬과의 개인 메시지가 없습니다.</Text>}
          renderItem={({ item, index }) => {
            const olderMessage = newestFirstMessages[index + 1];
            const showDateSeparator = !olderMessage || getMessageDateKey(olderMessage.createdAt) !== getMessageDateKey(item.createdAt);
            const uniqueArtistAccount = account.role === "artist" && accounts.filter((candidate) => candidate.role === "artist").length === 1;
            const isCurrentAccount = item.senderRole === account.role && (normalizeAccountEmail(item.senderId) === normalizeAccountEmail(account.email) || uniqueArtistAccount);
            const senderAvatarUri = isCurrentAccount ? account.avatarUri : fanAvatarUri;
            const senderName = isCurrentAccount ? account.displayName : fanName;
            const isRightAligned = item.senderRole === "artist";
            const hasImages = Boolean(item.imageUris?.length || item.imageUri);
            const hasFrameMedia = Boolean(item.media?.some((media) => media.mediaType === "audio" || media.mediaType === "video"));
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
              <View style={[styles.messageContent, (item.media?.length || item.imageUris?.length || item.imageUri) ? styles.mediaMessageContent : null, isRightAligned && styles.messageContentRight, isRightAligned && !item.media?.length && !item.imageUris?.length && !item.imageUri && styles.outgoingTextMessageContent]}>
                <View style={styles.identityRow}>
                  {senderAvatarUri ? <AuthenticatedImage uri={senderAvatarUri} resizeMode="cover" style={styles.senderAvatar} /> : <View style={styles.senderAvatarPlaceholder}><Text style={styles.senderAvatarText}>{senderName.slice(0, 1)}</Text></View>}
                  <Text style={styles.senderName}>{senderName}</Text>
                </View>
                {(item.media?.length || item.imageUris?.length || item.imageUri) ? (
                  <View
                    onLayout={!hasImages && !hasFrameMedia && !item.text ? (event) => {
                      const width = event.nativeEvent.layout.width;
                      setMessageAnchorWidths((current) => current[item.id] === width ? current : { ...current, [item.id]: width });
                    } : undefined}
                    style={[styles.attachmentGroup, bubbleAlignment, isRightAligned ? styles.attachmentGroupRight : styles.attachmentGroupLeft]}
                  >
                    <MessageImages imageUris={item.imageUris} legacyImageUri={item.imageUri} roundedPopup align={isRightAligned ? "right" : "left"} onContentLayout={!item.text ? (width) => setMessageAnchorWidths((current) => current[item.id] === width ? current : { ...current, [item.id]: width }) : undefined} />
                    <MessageMedia media={item.media} align={isRightAligned ? "right" : "left"} onContentLayout={!hasImages && !item.text ? (width) => setMessageAnchorWidths((current) => current[item.id] === width ? current : { ...current, [item.id]: width }) : undefined} />
                  </View>
                ) : null}
                {item.text ? (
                  <View
                    onLayout={(event) => {
                      const width = event.nativeEvent.layout.width;
                      setMessageAnchorWidths((current) => current[item.id] === width ? current : { ...current, [item.id]: width });
                    }}
                    style={[styles.bubble, isRightAligned && !item.media?.length && !item.imageUris?.length && !item.imageUri && styles.outgoingTextBubble, bubbleAlignment, (item.media?.length || item.imageUris?.length || item.imageUri) ? styles.textBubbleAfterMedia : null, isRightAligned ? styles.bubbleCornerRight : styles.bubbleCornerLeft, item.senderRole === "artist" ? styles.artistOwnBubble : styles.artistOtherBubble, isRightAligned ? styles.rightBubble : styles.leftTextBubble]}
                  >
                    <Text style={[styles.messageText, item.senderRole === "artist" ? styles.artistOwnText : styles.artistOtherText, isRightAligned && styles.rightMessageText]}>{item.text}</Text>
                  </View>
                ) : null}
                <View style={[styles.timeRow, timestampAlignment]}>
                  {normalizeAccountEmail(item.senderId) === normalizeAccountEmail(account.email) && (item.readBy ?? []).some((readerId) => normalizeAccountEmail(readerId) !== normalizeAccountEmail(account.email)) ? <Text style={styles.readText}>읽음</Text> : null}
                  <Text style={[styles.time, item.senderRole === "artist" && styles.timeRight]}>{formatMessageTime(item.createdAt)}</Text>
                </View>
              </View>
            </View>
            );
          }}
          showsVerticalScrollIndicator={false}
        />
        {isBlocked ? (
          <View style={styles.blockedNotice}><Text style={styles.blockedNoticeText}>차단된 회원이라 메시지를 보낼 수 없습니다.</Text></View>
        ) : <ChatComposer enableUserToken onSend={sendMessage} />}
        {readSyncError ? <Text style={styles.readSyncError}>{readSyncError}</Text> : null}
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
  backButton: { height: 18, justifyContent: "center", width: 28 },
  backText: { color: ACCENT, fontSize: 10 },
  headerCopy: { flex: 1 },
  titleRow: { alignItems: "center", flexDirection: "row", gap: 1 },
  eyebrow: { color: ACCENT, fontSize: 9, fontWeight: "700", letterSpacing: 1.5, marginBottom: 4 },
  title: { color: INK, fontSize: 20, fontWeight: "700" },
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
  identityRow: { alignItems: "center", flexDirection: "row", gap: 7, marginBottom: 10 },
  identityRowRight: { flexDirection: "row-reverse" },
  senderAvatar: { borderRadius: 11, height: 22, width: 22 },
  senderAvatarPlaceholder: { alignItems: "center", backgroundColor: "#d6bb45", borderRadius: 11, height: 22, justifyContent: "center", width: 22 },
  senderAvatarText: { color: "#151515", fontSize: 10, fontWeight: "800" },
  senderName: { color: ACCENT, fontSize: 12, fontWeight: "700" },
  bubble: { borderRadius: 16, maxWidth: "82%", paddingHorizontal: 15, paddingVertical: 12 },
  outgoingTextBubble: { maxWidth: "100%" },
  bubbleCornerLeft: { borderTopLeftRadius: 0 },
  bubbleCornerRight: { borderTopRightRadius: 0 },
  textBubbleAfterMedia: { marginTop: 6 },
  mediaMessageContent: { maxWidth: "82%", width: 270 },
  attachmentGroup: { maxWidth: "100%", width: "100%" },
  attachmentGroupLeft: { alignItems: "flex-start" },
  attachmentGroupRight: { alignItems: "flex-end" },
  artistOwnBubble: { backgroundColor: "#d6bb45" },
  artistOtherBubble: { backgroundColor: "#16c5d4" },
  leftTextBubble: { backgroundColor: ACCENT, borderColor: ACCENT },
  rightBubble: { backgroundColor: "rgba(58,58,58,0.7)" },
  messageText: { fontFamily: "GowunDodum", fontSize: 15, lineHeight: 22 },
  artistOwnText: { color: "#151515", fontWeight: "700" },
  artistOtherText: { color: "#ffffff" },
  rightMessageText: { color: "#ffffff" },
  messageImage: { borderRadius: 2, height: 180, marginBottom: 8, width: 180 },
  time: { color: "#8a8a8a", fontSize: 9, marginTop: 5 },
  timeRight: { textAlign: "right" },
  timeRow: { alignItems: "center", flexDirection: "row", gap: 5, justifyContent: "flex-end", marginTop: 5 },
  readText: { color: "#7bd7a7", fontSize: 9, fontWeight: "700" },
  emptyText: { color: MUTED, fontSize: 13, paddingTop: 30, textAlign: "center" },
  readSyncError: { color: "#e38b7d", fontSize: 10, paddingBottom: 12, paddingHorizontal: 12, paddingTop: 8, textAlign: "center" },
  blockedNotice: { alignItems: "center", borderColor: "#d7b4ad", borderWidth: 1, paddingVertical: 15 },
  blockedNoticeText: { color: "#a3493d", fontSize: 12 },
});
