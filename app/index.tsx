
import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { loginLocalAccount, resetLocalPrototype } from "@/lib/auth";
import { getJoinOpen } from "@/lib/moderation-store";

const INK = "#191817";
const MUTED = "#77716a";
const PAPER = "#f5f1eb";
const LINE = "#d9d1c7";
const ACCENT = "#b36f4b";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingSignup, setIsCheckingSignup] = useState(false);
  const [signupBlockedVisible, setSignupBlockedVisible] = useState(false);

  const handleSignupPress = async () => {
    setError("");
    setIsCheckingSignup(true);
    try {
      if (await getJoinOpen()) {
        router.push("/signup");
      } else {
        setSignupBlockedVisible(true);
      }
    } catch {
      setError("가입 가능 여부를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setIsCheckingSignup(false);
    }
  };

  const handleLogin = async () => {
    setError("");
    if (!email.trim() || !password) {
      setError("이메일과 비밀번호를 입력해 주세요.");
      return;
    }

    setIsSubmitting(true);
    try {
      await loginLocalAccount(email, password);
      setPassword("");
      router.push("/chat");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "로그인에 실패했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <Image
        source={require("@/assets/images/login-bg.jpg")}
        style={styles.backgroundImage}
        resizeMethod="resize"
        resizeMode="contain"
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.brandBlock}>
            <Text style={styles.eyebrow}>PRIVATE ARTIST DM</Text>
            <Text style={styles.brand}>Only One</Text>
            <Text style={styles.title}>
              음악이 머문 자리{"\n"}당신의 밤이 되기를..
            </Text>
          </View>

          <View style={styles.form}>
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
                autoComplete="password"
                onChangeText={setPassword}
                placeholder="비밀번호를 입력해 주세요"
                placeholderTextColor="#aaa198"
                secureTextEntry
                style={styles.input}
                value={password}
              />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              accessibilityLabel="로그인"
              accessibilityRole="button"
              disabled={isSubmitting}
              onPress={handleLogin}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.pressed,
                isSubmitting && styles.disabled,
              ]}
            >
              {isSubmitting ? (
                <ActivityIndicator color={PAPER} />
              ) : (
                <Text style={styles.primaryButtonText}>로그인</Text>
              )}
            </Pressable>

            <View style={styles.signupRow}>
              <Text style={styles.signupHint}>아직 계정이 없나요?</Text>
              <Pressable
                accessibilityRole="button"
                disabled={isCheckingSignup}
                onPress={handleSignupPress}
              >
                <Text style={[styles.signupLink, isCheckingSignup && styles.linkPressed]}>
                  {isCheckingSignup ? "확인 중…" : "회원가입"}
                </Text>
              </Pressable>
            </View>
          </View>

          <Text style={styles.note}>
            신규 가입은 아티스트가 열어 둔 기간에만 가능합니다.
          </Text>

          <Pressable
            onPress={async () => {
              await resetLocalPrototype();
              setEmail("");
              setPassword("");
              setError("테스트 데이터가 초기화되었습니다.");
            }}
            style={({ pressed }) => [
              styles.resetButton,
              pressed && styles.linkPressed,
            ]}
          >
            <Text style={styles.resetText}>내부 테스트 데이터 초기화</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        animationType="fade"
        transparent
        visible={signupBlockedVisible}
        onRequestClose={() => setSignupBlockedVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            onPress={() => setSignupBlockedVisible(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.blockedDialog}>
            <Text style={styles.blockedEyebrow}>SIGN-UP CLOSED</Text>
            <Text style={styles.blockedTitle}>
              현재 신규 가입이 닫혀 있습니다
            </Text>
            <Text style={[styles.blockedMessage, { fontFamily: "GowunDodum" }]}>
              기존 회원은 계속 이용하실 수 있어요. 신규 가입은 아티스트가 다시 열어 주면 가능해요.
            </Text>
            <Pressable
              onPress={() => setSignupBlockedVisible(false)}
              style={styles.blockedConfirm}
            >
              <Text style={styles.blockedConfirmText}>확인</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: PAPER,
  },
  backgroundImage: {
    position: "absolute",
    width: 200,
    height: 200,
    top: 120,
    alignSelf: "center",
    opacity: 0.5,
  },
  keyboardView: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    justifyContent: "space-between",
    paddingHorizontal: 28,
    paddingVertical: 20,
  },
  brandBlock: {
    paddingTop: 36,
  },
  eyebrow: {
    color: ACCENT,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2.2,
    marginBottom: 16,
  },
  brand: {
    color: INK,
    fontFamily: "SpaceMono",
    fontSize: 28,
    letterSpacing: -1,
    marginBottom: 30,
  },
  title: {
    color: INK,
    fontSize: 31,
    fontWeight: "700",
    letterSpacing: -1.1,
    lineHeight: 40,
  },
  description: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 15,
  },
  form: {
    gap: 16,
    paddingBottom: 10,
  },
  fieldGroup: {
    gap: 8,
  },
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
    alignSelf: "center",
    backgroundColor: "#5a5959",
    borderRadius: 999,
    height: 52,
    minHeight: 52,
    justifyContent: "center",
    marginTop: 4,
    overflow: "hidden",
    paddingHorizontal: 28,
    width: 156,
  },
  webPrimaryButton: {
    alignSelf: "center",
    backgroundColor: "#5a5959",
    borderColor: "transparent",
    borderWidth: 0,
    color: PAPER,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: "700",
    height: 52,
    minHeight: 52,
    marginTop: 4,
    overflow: "hidden",
    paddingHorizontal: 28,
    paddingVertical: 0,
    textAlign: "center",
    width: 156,
  },
  primaryButtonText: {
    color: PAPER,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.4,
  },
  error: {
    color: "#a3493d",
    fontSize: 12,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.985 }],
  },
  disabled: {
    opacity: 0.65,
  },
  signupRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    paddingTop: 4,
  },
  signupHint: {
    color: MUTED,
    fontSize: 13,
  },
  signupLink: {
    color: ACCENT,
    fontSize: 13,
    fontWeight: "700",
  },
  linkPressed: {
    opacity: 0.55,
  },
  note: {
    color: "#a49b91",
    fontSize: 11,
    lineHeight: 17,
    textAlign: "center",
  },
  resetButton: {
    alignSelf: "center",
    marginTop: 10,
    padding: 6,
  },
  resetText: {
    color: "#a49b91",
    fontSize: 10,
    textDecorationLine: "underline",
  },
  modalBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(25, 24, 23, 0.48)",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  blockedDialog: {
    backgroundColor: PAPER,
    borderRadius: 16,
    maxWidth: 360,
    padding: 24,
    width: "100%",
  },
  blockedEyebrow: {
    color: ACCENT,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.6,
    marginBottom: 10,
  },
  blockedTitle: {
    color: INK,
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 28,
  },
  blockedMessage: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 10,
  },
  blockedConfirm: {
    alignItems: "center",
    backgroundColor: INK,
    marginTop: 22,
    paddingVertical: 14,
  },
  blockedConfirmText: {
    color: PAPER,
    fontSize: 12,
    fontWeight: "700",
  },
});
