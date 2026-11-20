import { Link, router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { createLocalAccount } from "@/lib/auth";
import { getJoinOpen } from "@/lib/moderation-store";

const INK = "#191817";
const MUTED = "#77716a";
const PAPER = "#f5f1eb";
const LINE = "#d9d1c7";
const ACCENT = "#b36f4b";

export default function SignupScreen() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"artist" | "fan">("fan");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [signupBlockedVisible, setSignupBlockedVisible] = useState(false);
  const signupButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let active = true;
    getJoinOpen().then((joinOpen) => {
      if (active && !joinOpen) setSignupBlockedVisible(true);
    }).catch(() => {
      if (active) setError("가입 가능 여부를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const button = signupButtonRef.current;
    if (!button) return;
    const onNativeClick = (event: MouseEvent) => {
      event.preventDefault();
      void handleSignup();
    };
    button.onclick = onNativeClick;
    return () => {
      if (button.onclick === onNativeClick) button.onclick = null;
    };
  });

  const handleSignup = async () => {
    setError("");
    setIsSubmitting(true);
    try {
      if (!(await getJoinOpen())) {
        setSignupBlockedVisible(true);
        return;
      }
      if (!displayName.trim() || !email.trim() || !password) {
        setError("이름, 이메일, 비밀번호를 모두 입력해 주세요.");
        return;
      }
      if (password.length < 8) {
        setError("비밀번호는 8자 이상이어야 합니다.");
        return;
      }
      await createLocalAccount({ displayName, email, password, role });
      router.replace("/chat");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "가입에 실패했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardView}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <Link href="/" asChild>
              <Pressable accessibilityRole="button" hitSlop={12}>
                {({ pressed }) => (
                  <Text style={[styles.back, pressed && styles.linkPressed]}>
                    ← 돌아가기
                  </Text>
                )}
              </Pressable>
            </Link>
            <Text style={styles.eyebrow}>JOIN THE ROOM</Text>
            <Text style={styles.title}>계정 만들기</Text>
            <Text style={styles.description}>
              가입이 열려 있을 때 누구나 계정을 만들 수 있습니다.
            </Text>
          </View>

          <View style={styles.form}>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>DISPLAY NAME</Text>
              <TextInput
                autoCapitalize="words"
                onChangeText={setDisplayName}
                placeholder="채팅에서 사용할 이름"
                placeholderTextColor="#aaa198"
                style={styles.input}
                value={displayName}
              />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>ACCOUNT TYPE · TEST MODE</Text>
              <View style={styles.roleRow}>
                {(["fan", "artist"] as const).map((option) => (
                  <Pressable
                    key={option}
                    onPress={() => setRole(option)}
                    style={[styles.roleButton, role === option && styles.roleButtonActive]}
                  >
                    <Text style={[styles.roleText, role === option && styles.roleTextActive]}>
                      {option === "fan" ? "팬" : "아티스트"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>EMAIL</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor="#aaa198"
                style={styles.input}
                value={email}
              />
            </View>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>PASSWORD</Text>
              <TextInput
                autoCapitalize="none"
                autoComplete="new-password"
                onChangeText={setPassword}
                placeholder="8자 이상"
                placeholderTextColor="#aaa198"
                secureTextEntry
                style={styles.input}
                value={password}
              />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            {Platform.OS === "web" ? (
              <button
                disabled={isSubmitting}
                id="signup-submit"
                ref={signupButtonRef}
                style={styles.webPrimaryButton as any}
                type="button"
              >
                {isSubmitting ? "처리 중…" : "가입하고 시작하기"}
              </button>
            ) : (
              <Pressable
                accessibilityRole="button"
                disabled={isSubmitting}
                onPress={handleSignup}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.pressed,
                  isSubmitting && styles.disabled,
                ]}
              >
                {isSubmitting ? (
                  <ActivityIndicator color={PAPER} />
                ) : (
                  <Text style={styles.primaryButtonText}>가입하고 시작하기</Text>
                )}
              </Pressable>
            )}
          </View>

      <Text style={styles.note}>
        계정 정보는 이 앱의 로그인과 대화 참여를 위해 사용됩니다.
      </Text>
    </View>
  </KeyboardAvoidingView>
  <Modal
    animationType="fade"
    transparent
    visible={signupBlockedVisible}
    onRequestClose={() => router.replace("/")}
  >
    <View style={styles.modalBackdrop}>
      <Pressable onPress={() => router.replace("/")} style={StyleSheet.absoluteFill} />
      <View style={styles.blockedDialog}>
        <Text style={styles.blockedEyebrow}>SIGN-UP CLOSED</Text>
        <Text style={styles.blockedTitle}>현재 신규 가입이 닫혀 있습니다</Text>
        <Text style={[styles.blockedMessage, { fontFamily: "GowunDodum" }]}>기존 회원은 계속 이용하실 수 있어요. 신규 가입은 아티스트가 다시 열어 주면 가능해요.</Text>
        <Pressable onPress={() => router.replace("/")} style={styles.blockedConfirm}>
          <Text style={styles.blockedConfirmText}>로그인 화면으로</Text>
        </Pressable>
      </View>
    </View>
  </Modal>
</SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: PAPER },
  keyboardView: { flex: 1 },
  container: {
    flex: 1,
    justifyContent: "space-between",
    paddingHorizontal: 28,
    paddingVertical: 20,
  },
  header: { paddingTop: 8 },
  back: { color: ACCENT, fontSize: 13, marginBottom: 44 },
  eyebrow: {
    color: ACCENT,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2.2,
    marginBottom: 15,
  },
  title: {
    color: INK,
    fontSize: 31,
    fontWeight: "700",
    letterSpacing: -1.1,
  },
  description: { color: MUTED, fontSize: 14, lineHeight: 22, marginTop: 15 },
  form: { gap: 16, paddingBottom: 10 },
  fieldGroup: { gap: 8 },
  roleRow: { flexDirection: "row", gap: 8 },
  roleButton: { borderColor: LINE, borderWidth: 1, flex: 1, paddingVertical: 12 },
  roleButtonActive: { backgroundColor: INK, borderColor: INK },
  roleText: { color: MUTED, fontSize: 12, textAlign: "center" },
  roleTextActive: { color: PAPER, fontWeight: "700" },
  label: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.6,
  },
  input: {
    borderBottomColor: LINE,
    borderBottomWidth: 1,
    color: INK,
    fontSize: 16,
    paddingBottom: 12,
    paddingHorizontal: 0,
    paddingTop: 5,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: INK,
    minHeight: 52,
    justifyContent: "center",
    marginTop: 4,
  },
  webPrimaryButton: {
    backgroundColor: INK,
    borderWidth: 0,
    color: PAPER,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: "700",
    minHeight: 52,
    marginTop: 4,
    width: "100%",
  },
  primaryButtonText: {
    color: PAPER,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.1,
  },
  error: { color: "#a3493d", fontSize: 12, lineHeight: 18 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.65 },
  linkPressed: { opacity: 0.55 },
  note: { color: "#a49b91", fontSize: 11, lineHeight: 17, textAlign: "center" },
  modalBackdrop: { alignItems: "center", backgroundColor: "rgba(25, 24, 23, 0.48)", flex: 1, justifyContent: "center", padding: 24 },
  blockedDialog: { backgroundColor: PAPER, borderRadius: 16, maxWidth: 360, padding: 24, width: "100%" },
  blockedEyebrow: { color: ACCENT, fontSize: 9, fontWeight: "700", letterSpacing: 1.6, marginBottom: 10 },
  blockedTitle: { color: INK, fontSize: 20, fontWeight: "700", lineHeight: 28 },
  blockedMessage: { color: MUTED, fontSize: 13, lineHeight: 20, marginTop: 10 },
  blockedConfirm: { alignItems: "center", backgroundColor: INK, marginTop: 22, paddingVertical: 14 },
  blockedConfirmText: { color: PAPER, fontSize: 12, fontWeight: "700" },
});
