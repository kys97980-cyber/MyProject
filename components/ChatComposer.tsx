import * as ImagePicker from "expo-image-picker";
import { File as ExpoFile } from "expo-file-system";
import { VideoView, useVideoPlayer } from "expo-video";
import { MaterialIcons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { Image, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

type ComposerProps = {
  onSend: (payload: { text?: string; imageUris?: string[]; media?: PendingImage[] }) => void | Promise<void>;
  disabled?: boolean;
  enableUserToken?: boolean;
  userTokenDisabled?: boolean;
  userTokenDisabledNotice?: string;
};

export type PendingImage = {
  uri: string;
  size: number;
  mediaType: "image" | "audio" | "video";
  mimeType: string;
  fileName: string;
  fileIdentity?: string;
  fileFingerprint?: string;
};
type AttachmentKind = PendingImage["mediaType"];
type TextSelection = { start: number; end: number };
const USER_TOKEN = "{user}";
const INK = "#f1f1f1";
const MUTED = "#8a8a8a";
const LINE = "#2b2b2b";
const ACCENT = "#2bb673";
const MAX_IMAGE_ATTACHMENTS = 4;
const ACTION_BUTTON_SIZE = 36;
const ACTION_ICON_SIZE = 28;

function PendingVideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.muted = true;
  });

  return (
    <View style={styles.videoPreview}>
      <VideoView player={player} contentFit="contain" nativeControls={false} playsInline style={styles.videoPreviewImage} />
      <View style={styles.videoPreviewBadge}><Text style={styles.videoPreviewPlay}>▶</Text></View>
    </View>
  );
}

function getWebFileType(file: File): AttachmentKind | null {
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  if (file.type === "image/jpeg" || /\.(jpe?g)$/i.test(file.name)) return "image";
  return null;
}

export default function ChatComposer({ onSend, disabled = false, enableUserToken = false, userTokenDisabled = false, userTokenDisabledNotice = "1:1 대화에서는 전체 버튼을 사용할 수 없습니다." }: ComposerProps) {
  const [draft, setDraft] = useState("");
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [notice, setNotice] = useState("");
  const [pickerVisible, setPickerVisible] = useState(false);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<TextInput | null>(null);
  const draftRef = useRef("");
  const selectionRef = useRef<TextSelection>({ start: 0, end: 0 });
  const [selectionOverride, setSelectionOverride] = useState<TextSelection | undefined>(undefined);
  const insertedUserTokenRef = useRef<TextSelection | null>(null);
  const [userTokenActive, setUserTokenActive] = useState(false);
  const pendingFileIdentities = useRef(new Set<string>());
  const pendingFileFingerprints = useRef(new Set<string>());

  useEffect(() => {
    if (disabled) setPickerVisible(false);
  }, [disabled]);

  const reserveFile = (identity: string, fingerprint: string) => {
    if (pendingFileIdentities.current.has(identity) || pendingFileFingerprints.current.has(fingerprint)) return false;
    pendingFileIdentities.current.add(identity);
    pendingFileFingerprints.current.add(fingerprint);
    return true;
  };

  const releaseFile = (item: PendingImage) => {
    if (item.fileIdentity) pendingFileIdentities.current.delete(item.fileIdentity);
    if (item.fileFingerprint) pendingFileFingerprints.current.delete(item.fileFingerprint);
  };

  const clearPendingFiles = () => {
    pendingFileIdentities.current.clear();
    pendingFileFingerprints.current.clear();
  };

  const handleDraftChange = (nextDraft: string) => {
    const previousDraft = draftRef.current;
    const tokenRange = insertedUserTokenRef.current;
    if (tokenRange) {
      let commonPrefix = 0;
      while (commonPrefix < previousDraft.length && commonPrefix < nextDraft.length && previousDraft[commonPrefix] === nextDraft[commonPrefix]) commonPrefix += 1;
      let commonSuffix = 0;
      while (previousDraft.length - commonSuffix > commonPrefix && nextDraft.length - commonSuffix > commonPrefix && previousDraft[previousDraft.length - 1 - commonSuffix] === nextDraft[nextDraft.length - 1 - commonSuffix]) commonSuffix += 1;
      const previousChangedEnd = previousDraft.length - commonSuffix;
      const lengthDelta = nextDraft.length - previousDraft.length;
      if (previousChangedEnd <= tokenRange.start) {
        insertedUserTokenRef.current = { start: tokenRange.start + lengthDelta, end: tokenRange.end + lengthDelta };
      } else if (commonPrefix < tokenRange.end) {
        insertedUserTokenRef.current = null;
        setUserTokenActive(false);
      }
    }
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  };

  const handleSelectionChange = (event: { nativeEvent: { selection: TextSelection } }) => {
    const nextSelection = event.nativeEvent.selection;
    selectionRef.current = nextSelection;
    setSelectionOverride(undefined);
  };

  const toggleUserToken = () => {
    if (!enableUserToken || disabled || sending) return;
    if (userTokenDisabled) {
      setNotice(userTokenDisabledNotice);
      return;
    }
    const insertedRange = insertedUserTokenRef.current;
    const currentDraft = draftRef.current;
    if (insertedRange && currentDraft.slice(insertedRange.start, insertedRange.end) === USER_TOKEN) {
      const nextDraft = currentDraft.slice(0, insertedRange.start) + currentDraft.slice(insertedRange.end);
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      insertedUserTokenRef.current = null;
      setUserTokenActive(false);
      const restoredSelection = { start: insertedRange.start, end: insertedRange.start };
      selectionRef.current = restoredSelection;
      setSelectionOverride(restoredSelection);
    } else {
      const start = Math.min(currentDraft.length, Math.max(0, selectionRef.current.start));
      const end = Math.min(currentDraft.length, Math.max(start, selectionRef.current.end));
      const nextDraft = currentDraft.slice(0, start) + USER_TOKEN + currentDraft.slice(end);
      const insertedRange = { start, end: start + USER_TOKEN.length };
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      insertedUserTokenRef.current = insertedRange;
      setUserTokenActive(true);
      const nextSelection = { start: insertedRange.end, end: insertedRange.end };
      selectionRef.current = nextSelection;
      setSelectionOverride(nextSelection);
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const addWebFiles = (files: File[], requestedKind: AttachmentKind) => {
    const typedFiles = files.filter((file) => getWebFileType(file) === requestedKind);
    if (typedFiles.length !== files.length) setNotice("선택한 첨부 유형에 맞는 JPG, 오디오 또는 동영상 파일만 추가할 수 있습니다.");
    const selectedFiles = requestedKind === "image" ? typedFiles.slice(0, MAX_IMAGE_ATTACHMENTS) : typedFiles.slice(0, 1);
    if (requestedKind !== "image" && files.length > 1) {
      setNotice("보이스 또는 동영상은 한 번에 하나만 선택할 수 있어 첫 번째 파일만 선택했습니다.");
    }
    if (pendingImages.some((item) => item.mediaType !== requestedKind)) {
      setNotice("한 메시지에는 이미지·보이스·동영상 중 한 종류만 첨부할 수 있습니다. 기존 첨부를 제거하거나 전송한 뒤 다른 종류를 선택해 주세요.");
      return;
    }
    if (requestedKind !== "image" && pendingImages.length > 0) {
      setNotice("보이스 또는 동영상은 한 번에 하나만 첨부할 수 있습니다. 기존 첨부를 보내거나 제거한 뒤 다시 선택해 주세요.");
      return;
    }
    if (pendingImages.length >= MAX_IMAGE_ATTACHMENTS) {
      setNotice("이미지는 한 번에 최대 4장까지 첨부할 수 있습니다.");
      return;
    }

    const accepted: { file: File; identity: string; fingerprint: string; mediaType: AttachmentKind }[] = [];
    let duplicateCount = 0;
    for (const file of selectedFiles) {
      const mediaType = getWebFileType(file);
      if (!mediaType) continue;
      const identity = `web:${file.name.toLocaleLowerCase()}:${file.size}:${file.lastModified}:${file.type.toLocaleLowerCase()}`;
      const fingerprint = `web-file:${file.name.toLocaleLowerCase()}:${file.size}:${file.lastModified}:${file.type.toLocaleLowerCase()}`;
      if (!reserveFile(identity, fingerprint)) {
        duplicateCount += 1;
        continue;
      }
      accepted.push({ file, identity, fingerprint, mediaType });
    }
    if (duplicateCount) setNotice("같은 파일은 한 번만 첨부할 수 있어 중복 파일은 제외했습니다.");

    const availableSlots = Math.max(0, MAX_IMAGE_ATTACHMENTS - pendingImages.length);
    const filesToAdd = accepted.slice(0, availableSlots);
    accepted.slice(availableSlots).forEach(({ identity, fingerprint }) => {
      pendingFileIdentities.current.delete(identity);
      pendingFileFingerprints.current.delete(fingerprint);
    });
    if (filesToAdd.length < accepted.length) setNotice("이미지는 한 번에 최대 4장까지 첨부할 수 있습니다.");

    filesToAdd.forEach(({ file, identity, fingerprint, mediaType }) => {
      const limit = mediaType === "video" ? 100_000_000 : mediaType === "audio" ? 10_000_000 : 5_000_000;
      if (file.size >= limit) {
        pendingFileIdentities.current.delete(identity);
        pendingFileFingerprints.current.delete(fingerprint);
        setNotice("이미지는 5MB, 보이스는 10MB, 동영상은 100MB 미만이어야 합니다.");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setPendingImages((current) => {
            if (current.length >= MAX_IMAGE_ATTACHMENTS || current.some((item) => item.mediaType !== mediaType) || (mediaType !== "image" && current.length > 0)) {
              pendingFileIdentities.current.delete(identity);
              pendingFileFingerprints.current.delete(fingerprint);
              return current;
            }
            return [...current, { uri: reader.result as string, size: file.size, mediaType, mimeType: file.type || "image/jpeg", fileName: file.name, fileIdentity: identity, fileFingerprint: fingerprint }];
          });
        } else {
          pendingFileIdentities.current.delete(identity);
          pendingFileFingerprints.current.delete(fingerprint);
        }
      };
      reader.onerror = () => {
        pendingFileIdentities.current.delete(identity);
        pendingFileFingerprints.current.delete(fingerprint);
        setNotice("파일을 읽지 못했습니다. 다시 선택해 주세요.");
      };
      reader.readAsDataURL(file);
    });
  };

  const pickMedia = async (kind: AttachmentKind) => {
    setPickerVisible(false);
    setNotice("");
    if (pendingImages.length >= MAX_IMAGE_ATTACHMENTS) {
      setNotice("이미지는 한 번에 최대 4장까지 첨부할 수 있습니다.");
      return;
    }
    if (pendingImages.some((item) => item.mediaType !== kind)) {
      setNotice("한 메시지에는 이미지·보이스·동영상 중 한 종류만 첨부할 수 있습니다. 기존 첨부를 제거하거나 전송한 뒤 다른 종류를 선택해 주세요.");
      return;
    }
    if (kind !== "image" && pendingImages.length > 0) {
      setNotice("보이스 또는 동영상은 한 번에 하나만 첨부할 수 있습니다. 기존 첨부를 보내거나 제거한 뒤 다시 선택해 주세요.");
      return;
    }
    if (Platform.OS === "web") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = kind === "image" ? ".jpg,.jpeg,image/jpeg" : kind === "audio" ? ".mp3,.m4a,.wav,audio/*" : ".mp4,.mov,video/*";
      input.multiple = kind === "image";
      input.onchange = () => addWebFiles(Array.from(input.files ?? []), kind);
      input.click();
      return;
    }
    try {
      const selected: { uri: string; size: number; mimeType: string; fileName: string }[] = [];
      if (kind === "audio") {
        const result = await ExpoFile.pickFileAsync({ mimeTypes: ["audio/*"] });
        if (result.canceled) return;
        const asset = result.result;
        selected.push({ uri: asset.uri, size: asset.size, mimeType: asset.type || "audio/mpeg", fileName: asset.name || `voice-${Date.now()}.mp3` });
      } else {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: kind === "image" ? ["images"] : ["videos"],
          allowsMultipleSelection: kind === "image",
          selectionLimit: kind === "image" ? Math.min(MAX_IMAGE_ATTACHMENTS, MAX_IMAGE_ATTACHMENTS - pendingImages.length) : 1,
          quality: 1,
        });
        if (result.canceled) return;
        for (const asset of result.assets) {
          const fileName = asset.fileName || `${kind}-${Date.now()}.${kind === "image" ? "jpg" : "mp4"}`;
          const mimeType = asset.mimeType || (kind === "image" ? "image/jpeg" : "video/mp4");
          if (kind === "image" && mimeType.toLowerCase() !== "image/jpeg" && !/\.jpe?g$/i.test(fileName)) {
            setNotice("이미지 첨부는 JPG 파일만 지원합니다.");
            continue;
          }
          selected.push({ uri: asset.uri, size: asset.fileSize ?? 0, mimeType, fileName });
        }
      }
      const maxSize = kind === "video" ? 100_000_000 : kind === "audio" ? 10_000_000 : 5_000_000;
      if (selected.some((asset) => asset.size >= maxSize)) {
        setNotice("이미지는 5MB, 보이스는 10MB, 동영상은 100MB 미만이어야 합니다.");
        return;
      }

      const next: PendingImage[] = [];
      let duplicateCount = 0;
      for (const asset of selected) {
        const identity = `native:${asset.uri}`;
        const fingerprint = `native-file:${asset.fileName.toLocaleLowerCase()}:${asset.size}:${asset.mimeType.toLocaleLowerCase()}`;
        if (!reserveFile(identity, fingerprint)) {
          duplicateCount += 1;
          continue;
        }
        next.push({ ...asset, mediaType: kind, fileIdentity: identity, fileFingerprint: fingerprint });
      }
      if (duplicateCount) setNotice("같은 파일은 한 번만 첨부할 수 있어 중복 파일은 제외했습니다.");
      setPendingImages((current) => {
        if (current.some((item) => item.mediaType !== kind) || (kind !== "image" && current.length > 0)) {
          next.forEach(releaseFile);
          return current;
        }
        return [...current, ...next].slice(0, MAX_IMAGE_ATTACHMENTS);
      });
    } catch (error) {
      setNotice(error instanceof Error ? `파일을 선택하지 못했습니다: ${error.message}` : "파일을 선택하지 못했습니다. 다시 시도해 주세요.");
    }
  };

  const removePendingFile = (index: number) => {
    if (disabled || sending) return;
    setPendingImages((current) => {
      const item = current[index];
      if (item) releaseFile(item);
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  };

  const send = async () => {
    if (disabled || sending) return;
    const text = draft.trim();
    if (!text && !pendingImages.length) return;
    setSending(true);
    setNotice("");
    try {
      await onSend({ text: text || undefined, imageUris: pendingImages.filter((image) => image.mediaType === "image").map((image) => image.uri), media: pendingImages });
      draftRef.current = "";
      setDraft("");
      insertedUserTokenRef.current = null;
      setUserTokenActive(false);
      selectionRef.current = { start: 0, end: 0 };
      setSelectionOverride({ start: 0, end: 0 });
      setPendingImages([]);
      clearPendingFiles();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "메시지 또는 첨부파일을 전송하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setSending(false);
    }
  };
  const hasSendContent = Boolean(draft.trim()) || pendingImages.length > 0;
  const sendReady = !disabled && !sending && hasSendContent;
  const sendDisabled = !sendReady;

  return (
    <>
      {pendingImages.length ? (
        <View style={styles.previewShell}>
          <View style={styles.previewGrid}>
            {pendingImages.map((image, index) => (
              <View key={`${image.uri}-${index}`} style={[styles.previewItem, image.mediaType === "audio" && styles.audioPreviewItem]}>
                {image.mediaType === "image" ? (
                  <Image source={{ uri: image.uri }} resizeMode="contain" style={styles.previewImage} />
                ) : image.mediaType === "video" ? (
                  <PendingVideoPreview uri={image.uri} />
                ) : (
                  <View style={styles.audioPreview}><Text numberOfLines={1} ellipsizeMode="middle" style={styles.audioPreviewText}>{image.fileName}</Text></View>
                )}
                <Pressable disabled={disabled || sending} onPress={() => removePendingFile(index)} style={[styles.removePreview, (disabled || sending) && styles.disabledControl]}><Text style={styles.removePreviewText}>×</Text></Pressable>
              </View>
            ))}
          </View>
          <Text style={styles.previewMeta}>{pendingImages.length}개 선택됨 · 이미지는 최대 4장, 보이스/동영상은 1개</Text>
        </View>
      ) : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <View style={styles.composerShell}>
        <Pressable accessibilityLabel="첨부 유형 선택" accessibilityRole="button" disabled={disabled || sending} onPress={() => setPickerVisible(true)} style={[styles.attachButton, (disabled || sending) && styles.disabledControl]}><MaterialIcons color={ACCENT} name="add" size={ACTION_ICON_SIZE} /></Pressable>
        <View style={[styles.inputBox, disabled && styles.disabledInputBox]}>
          {enableUserToken ? (
            <Pressable accessibilityLabel={userTokenDisabled ? "1:1 대화에서는 전체 버튼을 사용할 수 없음" : userTokenActive ? "전체 사용자 토큰 제거" : "전체 사용자 토큰 삽입"} accessibilityRole="button" accessibilityState={{ checked: userTokenActive, disabled: userTokenDisabled || disabled || sending }} disabled={disabled || sending} onPress={toggleUserToken} style={[styles.userTokenButton, userTokenActive && styles.userTokenButtonActive, userTokenDisabled && styles.userTokenButtonUnavailable, (disabled || sending) && styles.disabledControl]}>
              <Text style={styles.userTokenText}>전체</Text>
            </Pressable>
          ) : null}
          <TextInput ref={inputRef} nativeID="dm-chat-composer-input" editable={!disabled && !sending} multiline={false} onChangeText={handleDraftChange} onSelectionChange={handleSelectionChange} onSubmitEditing={() => void send()} placeholder="메시지를 입력하세요" placeholderTextColor={disabled ? "#666666" : "#aaa198"} returnKeyType="send" selection={selectionOverride} style={[styles.composerInput, disabled && styles.disabledInput]} value={draft} />
        </View>
        <Pressable accessibilityLabel="메시지 보내기" accessibilityRole="button" disabled={sendDisabled} onPress={send} style={styles.sendButton}><MaterialIcons color={disabled || sending ? "#777777" : sendReady ? ACCENT : "#ffffff"} name="arrow-upward" size={ACTION_ICON_SIZE} /></Pressable>
      </View>
      <Modal animationType="fade" transparent visible={pickerVisible && !disabled} onRequestClose={() => setPickerVisible(false)}>
        <View style={styles.pickerBackdrop}>
          <Pressable accessibilityLabel="첨부 선택 닫기" onPress={() => setPickerVisible(false)} style={StyleSheet.absoluteFill} />
          <View style={styles.pickerPanel}>
            <Text style={styles.pickerTitle}>첨부할 파일 선택</Text>
            <Pressable onPress={() => void pickMedia("image")} style={styles.pickerOption}><Text style={styles.pickerOptionText}>이미지 · 최대 4장 선택</Text></Pressable>
            <Pressable onPress={() => void pickMedia("audio")} style={styles.pickerOption}><Text style={styles.pickerOptionText}>보이스 · 한 번에 1개</Text></Pressable>
            <Pressable onPress={() => void pickMedia("video")} style={styles.pickerOption}><Text style={styles.pickerOptionText}>동영상 · 한 번에 1개</Text></Pressable>
            <Pressable onPress={() => setPickerVisible(false)} style={styles.pickerCancel}><Text style={styles.pickerCancelText}>취소</Text></Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  composerShell: { alignItems: "center", flexDirection: "row", gap: 4, minHeight: 52 },
  attachButton: { alignItems: "center", height: ACTION_BUTTON_SIZE, justifyContent: "center", width: ACTION_BUTTON_SIZE },
  disabledControl: { opacity: 0.35 },
  inputBox: { alignItems: "center", borderColor: LINE, borderRadius: 22, borderWidth: 1, flex: 1, flexDirection: "row", minHeight: 44, paddingHorizontal: 8 },
  disabledInputBox: { borderColor: "#343434" },
  userTokenButton: { alignItems: "center", backgroundColor: "#454545", borderColor: "#747474", borderRadius: 8, borderWidth: 1, height: 28, justifyContent: "center", marginRight: 8, minWidth: 44, paddingHorizontal: 8 },
  userTokenButtonActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  userTokenButtonUnavailable: { backgroundColor: "#2e2e2e", borderColor: "#555555" },
  userTokenText: { color: "#ffffff", fontSize: 11, fontWeight: "700" },
  composerInput: { color: INK, flex: 1, fontFamily: "GowunDodum", fontSize: 14, maxHeight: 72, minHeight: 36, paddingVertical: 8 },
  disabledInput: { color: "#777777" },
  sendButton: { alignItems: "center", backgroundColor: "transparent", borderRadius: ACTION_BUTTON_SIZE / 2, height: ACTION_BUTTON_SIZE, justifyContent: "center", width: ACTION_BUTTON_SIZE },
  previewShell: { backgroundColor: "#181818", marginBottom: 8, padding: 8 },
  previewGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  previewItem: { height: 62, position: "relative", width: 62 },
  audioPreviewItem: { height: 48, width: 230 },
  previewImage: { backgroundColor: "#111111", height: "100%", width: "100%" },
  videoPreview: { alignItems: "center", backgroundColor: "#050505", flex: 1, justifyContent: "center", overflow: "hidden", position: "relative", width: "100%" },
  videoPreviewImage: { height: "100%", width: "100%" },
  videoPreviewBadge: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.9)", borderRadius: 15, height: 30, justifyContent: "center", left: 16, position: "absolute", top: 16, width: 30 },
  videoPreviewPlay: { color: "#111111", fontSize: 12, marginLeft: 2 },
  audioPreview: { alignItems: "center", backgroundColor: "#16c5d4", borderRadius: 8, flex: 1, flexDirection: "row", justifyContent: "flex-start", paddingLeft: 9, paddingRight: 30, width: "100%" },
  audioPreviewText: { color: "#ffffff", flex: 1, fontSize: 10, fontWeight: "700", minWidth: 0, textAlign: "left" },
  removePreview: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.7)", borderRadius: 12, height: 22, justifyContent: "center", position: "absolute", right: 2, top: 2, width: 22 },
  removePreviewText: { color: "#ffffff", fontSize: 18, lineHeight: 19 },
  previewMeta: { color: MUTED, fontSize: 10, marginTop: 6 },
  notice: { color: "#a3493d", fontSize: 11, paddingBottom: 8, paddingTop: 4 },
  pickerBackdrop: { backgroundColor: "rgba(0,0,0,0.68)", flex: 1, justifyContent: "flex-end", padding: 12 },
  pickerPanel: { backgroundColor: "#181818", borderColor: "#363636", borderRadius: 16, borderWidth: 1, gap: 8, padding: 16 },
  pickerTitle: { color: INK, fontSize: 15, fontWeight: "700", marginBottom: 4 },
  pickerOption: { backgroundColor: "#242424", borderRadius: 10, minHeight: 46, justifyContent: "center", paddingHorizontal: 14 },
  pickerOptionText: { color: INK, fontSize: 14, fontWeight: "600" },
  pickerCancel: { alignItems: "center", minHeight: 40, justifyContent: "center" },
  pickerCancelText: { color: MUTED, fontSize: 13, fontWeight: "600" },
});
