import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { changeLocalPassword, getLocalAccount, getLocalAccountByEmail, updateLocalProfile, type LocalAccount } from "@/lib/auth";
import AuthenticatedImage from "@/components/AuthenticatedImage";
import { uploadMedia } from "@/lib/media-api";
import { getServerBaseUrlSync, subscribeServerUrl } from "@/lib/server-config";

const PAPER = "#050505";
const INK = "#f1f1f1";
const MUTED = "#8a8a8a";
const LINE = "#2b2b2b";
const ACCENT = "#2bb673";
const YELLOW = "#d6bb45";

export default function ProfileScreen() {
  const { account: accountParam } = useLocalSearchParams<{ account?: string }>();
  const [account, setAccount] = useState<LocalAccount | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [avatarUri, setAvatarUri] = useState<string | undefined>();
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordNotice, setPasswordNotice] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);
  const profileDraftDirty = useRef(false);
  const [serverBaseUrl, setServerBaseUrl] = useState(() => getServerBaseUrlSync());

  useEffect(() => subscribeServerUrl(setServerBaseUrl), []);

  useEffect(() => {
    let active = true;
    const requestedEmail = accountParam ? decodeURIComponent(accountParam) : "";
    (requestedEmail ? getLocalAccountByEmail(requestedEmail) : getLocalAccount()).then((current) => {
      if (!active) return;
      if (!current) {
        router.replace("/");
        return;
      }
      setAccount(current);
      if (!profileDraftDirty.current) {
        setDisplayName(current.displayName);
        setAvatarUri(current.avatarUri);
      }
    });
    return () => { active = false; };
  }, [accountParam, serverBaseUrl]);

  const pickAvatar = async () => {
    setNotice("");
    if (Platform.OS === "web") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".jpg,.jpeg,image/jpeg";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        if (file.type !== "image/jpeg" && !/\.jpe?g$/i.test(file.name)) {
          setNotice("프로필 사진은 JPG만 사용할 수 있습니다.");
          return;
        }
        if (file.size >= 5_000_000) {
          setNotice("프로필 사진은 5MB 미만이어야 합니다.");
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result !== "string") return;
          const source = new window.Image();
          source.onload = () => {
            const longestSide = Math.max(source.naturalWidth, source.naturalHeight);
            const scale = Math.min(1, 512 / longestSide);
            const width = Math.max(1, Math.round(source.naturalWidth * scale));
            const height = Math.max(1, Math.round(source.naturalHeight * scale));
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext("2d");
            if (!context) return;
            context.drawImage(source, 0, 0, width, height);
          profileDraftDirty.current = true;
          setAvatarUri(canvas.toDataURL("image/jpeg", 0.82));
          };
          source.src = reader.result;
        };
        reader.readAsDataURL(file);
      };
      input.click();
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
      selectionLimit: 1,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if (asset.mimeType !== "image/jpeg" && !/\.jpe?g$/i.test(asset.fileName ?? "")) {
      setNotice("프로필 사진은 JPG만 사용할 수 있습니다.");
      return;
    }
    if (asset.fileSize && asset.fileSize >= 5_000_000) {
      setNotice("프로필 사진은 5MB 미만이어야 합니다.");
      return;
    }
    profileDraftDirty.current = true;
    setAvatarUri(asset.uri);
  };

  const save = async () => {
    if (!account) return;
    setNotice("");
    setSaved(false);
    try {
      let avatarToSave = avatarUri;
		if (avatarUri && getServerBaseUrlSync() && !/^https?:\/\//i.test(avatarUri)) {
        const uploaded = await uploadMedia({
          uri: avatarUri,
          mimeType: "image/jpeg",
          fileName: `profile-${Date.now()}.jpg`,
          mediaType: "image",
        });
        avatarToSave = uploaded.url;
      }
      const updated = await updateLocalProfile(displayName, avatarToSave, account.email);
      setAccount(updated);
      setDisplayName(updated.displayName);
      setAvatarUri(updated.avatarUri);
      profileDraftDirty.current = false;
      setSaved(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "프로필 저장에 실패했습니다.");
    }
  };

  const savePassword = async () => {
    if (!account) return;
    setPasswordNotice("");
    setPasswordSaved(false);
    if (nextPassword !== confirmPassword) {
      setPasswordNotice("새 비밀번호가 서로 일치하지 않습니다.");
      return;
    }
    try {
      await changeLocalPassword(currentPassword, nextPassword, account.email);
      setCurrentPassword("");
      setNextPassword("");
      setConfirmPassword("");
      setPasswordSaved(true);
    } catch (error) {
      setPasswordNotice(error instanceof Error ? error.message : "비밀번호 변경에 실패했습니다.");
    }
  };

  if (!account) {
    return <SafeAreaView style={styles.safeArea}><Text style={styles.loading}>프로필을 준비하고 있습니다.</Text></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.replace(`/chat?account=${encodeURIComponent(account.email)}` as never)} style={styles.backButton}><Text style={styles.backText}>←</Text></Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>MY PROFILE</Text>
            <Text style={styles.title}>프로필 설정</Text>
          </View>
        </View>
        <View style={styles.divider} />

        <View style={styles.form}>
          <Pressable onPress={pickAvatar} style={styles.avatarButton}>
            {avatarUri ? <AuthenticatedImage uri={avatarUri} resizeMode="cover" style={styles.avatar} /> : <View style={styles.avatarPlaceholder}><Text style={styles.avatarInitial}>{displayName.slice(0, 1) || "?"}</Text></View>}
            <Text style={styles.changePhoto}>프로필 사진 변경</Text>
          </Pressable>

          <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>프로필 정보</Text>
          <Text style={styles.label}>닉네임</Text>
          <TextInput autoCapitalize="words" onChangeText={(value) => { profileDraftDirty.current = true; setDisplayName(value); }} placeholder="닉네임" placeholderTextColor="#777" style={styles.input} value={displayName} />
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          {saved ? <Text style={styles.saved}>저장되었습니다.</Text> : null}

          <Pressable onPress={save} style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}><Text style={styles.saveText}>프로필 저장</Text></Pressable>
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>비밀번호 변경</Text>
            <TextInput secureTextEntry onChangeText={setCurrentPassword} placeholder="현재 비밀번호" placeholderTextColor="#777" style={styles.input} value={currentPassword} />
            <TextInput secureTextEntry onChangeText={setNextPassword} placeholder="새 비밀번호 (8자 이상)" placeholderTextColor="#777" style={styles.input} value={nextPassword} />
            <TextInput secureTextEntry onChangeText={setConfirmPassword} placeholder="새 비밀번호 확인" placeholderTextColor="#777" style={styles.input} value={confirmPassword} />
            {passwordNotice ? <Text style={styles.notice}>{passwordNotice}</Text> : null}
            {passwordSaved ? <Text style={styles.saved}>비밀번호가 변경되었습니다.</Text> : null}
            <Pressable onPress={savePassword} style={({ pressed }) => [styles.passwordButton, pressed && styles.pressed]}><Text style={styles.passwordButtonText}>비밀번호 변경</Text></Pressable>
          </View>
          <Pressable onPress={() => router.replace(`/chat?account=${encodeURIComponent(account.email)}` as never)} style={({ pressed }) => [styles.backToChatButton, pressed && styles.pressed]}><Text style={styles.backToChatText}>채팅방으로 돌아가기</Text></Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: PAPER, flex: 1 },
  container: { flex: 1, paddingHorizontal: 20 },
  loading: { color: MUTED, flex: 1, paddingTop: 50, textAlign: "center" },
  header: { alignItems: "center", flexDirection: "row", paddingBottom: 18, paddingTop: 12 },
  backButton: { height: 38, justifyContent: "center", width: 34 },
  backText: { color: ACCENT, fontSize: 26 },
  headerCopy: { flex: 1 },
  eyebrow: { color: ACCENT, fontSize: 9, fontWeight: "700", letterSpacing: 1.5, marginBottom: 4 },
  title: { color: INK, fontSize: 22, fontWeight: "700" },
  divider: { backgroundColor: LINE, height: 1 },
  form: { alignItems: "stretch", paddingTop: 34 },
  avatarButton: { alignItems: "center", marginBottom: 32 },
  avatar: { backgroundColor: "#111111", borderRadius: 44, height: 88, width: 88 },
  avatarPlaceholder: { alignItems: "center", backgroundColor: YELLOW, borderRadius: 44, height: 88, justifyContent: "center", width: 88 },
  avatarInitial: { color: "#151515", fontSize: 34, fontWeight: "800" },
  changePhoto: { color: ACCENT, fontSize: 12, marginTop: 12 },
  label: { color: MUTED, fontSize: 10, fontWeight: "700", letterSpacing: 1.4, marginBottom: 8 },
  input: { borderBottomColor: LINE, borderBottomWidth: 1, color: INK, fontSize: 16, paddingBottom: 12, paddingTop: 8 },
  accountType: { color: MUTED, fontSize: 11, marginTop: 12 },
  notice: { color: "#e38b7d", fontSize: 12, marginTop: 16 },
  saved: { color: ACCENT, fontSize: 12, marginTop: 16 },
  sectionCard: { backgroundColor: "#101010", borderColor: LINE, borderRadius: 16, borderWidth: 1, marginBottom: 14, padding: 16 },
  saveButton: { alignItems: "center", backgroundColor: ACCENT, borderRadius: 12, marginTop: 18, paddingVertical: 13 },
  saveText: { color: "#07140d", fontSize: 14, fontWeight: "800" },
  backToChatButton: { alignItems: "center", borderColor: LINE, borderRadius: 12, borderWidth: 1, marginTop: 4, paddingVertical: 14 },
  backToChatText: { color: INK, fontSize: 14, fontWeight: "700" },
  sectionTitle: { color: INK, fontSize: 15, fontWeight: "700", marginBottom: 16 },
  passwordButton: { alignItems: "center", borderColor: ACCENT, borderRadius: 12, borderWidth: 1, marginTop: 18, paddingVertical: 13 },
  passwordButtonText: { color: ACCENT, fontSize: 14, fontWeight: "800" },
  pressed: { opacity: 0.75 },
});
