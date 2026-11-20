import { Pressable, StyleSheet, Text, View } from "react-native";
import ServerProfileImage from "@/components/ServerProfileImage";

const INK = "#f1f1f1";
const MUTED = "#8a8a8a";
const AVATAR_SIZE = 34;
const IDENTITY_HEIGHT = 40;

type ProfileHeaderButtonProps = {
  email: string;
  displayName: string;
  initialAvatarUri?: string;
  onPress: () => void;
  offlineCount?: number;
};

export default function ProfileHeaderButton({
  email,
  displayName,
  initialAvatarUri,
  onPress,
  offlineCount = 0,
}: ProfileHeaderButtonProps) {
  const fallbackLetter = displayName.trim().slice(0, 1) || "?";

  return (
    <Pressable
      accessibilityLabel={`${displayName} 프로필 변경`}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={styles.button}
    >
      <View style={styles.row}>
        <View style={styles.avatarWrap}>
          <ServerProfileImage
            email={email}
            initialUri={initialAvatarUri}
            resizeMode="cover"
            style={styles.avatar}
            fallback={(
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>{fallbackLetter}</Text>
              </View>
            )}
          />
          {offlineCount > 0 ? (
            <View style={styles.countBadge}>
              <Text
                accessibilityLabel={`${offlineCount}개의 오프라인 새 아티스트 메시지`}
                style={styles.countText}
              >
                {offlineCount > 99 ? "99+" : offlineCount}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.textColumn}>
          <Text ellipsizeMode="tail" numberOfLines={1} style={styles.name}>
            {displayName}
          </Text>
          <Text numberOfLines={1} style={styles.hint}>
            프로필 변경
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    width: 156,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    height: IDENTITY_HEIGHT,
    width: 156,
  },
  avatarWrap: {
    height: AVATAR_SIZE,
    position: "relative",
    width: AVATAR_SIZE,
  },
  avatar: {
    borderRadius: AVATAR_SIZE / 2,
    height: AVATAR_SIZE,
    width: AVATAR_SIZE,
  },
  avatarPlaceholder: {
    alignItems: "center",
    backgroundColor: "#d6bb45",
    borderRadius: AVATAR_SIZE / 2,
    height: AVATAR_SIZE,
    justifyContent: "center",
    width: AVATAR_SIZE,
  },
  avatarText: {
    color: "#151515",
    fontSize: 14,
    fontWeight: "800",
  },
  countBadge: {
    alignItems: "center",
    backgroundColor: "#d84b4b",
    borderRadius: 6,
    bottom: -1,
    height: 12,
    justifyContent: "center",
    minWidth: 12,
    paddingHorizontal: 1,
    position: "absolute",
    right: -1,
    zIndex: 2,
  },
  countText: {
    color: "#ffffff",
    fontSize: 7,
    fontWeight: "800",
    lineHeight: 9,
  },
  textColumn: {
    alignItems: "flex-start",
    flexShrink: 0,
    height: IDENTITY_HEIGHT,
    justifyContent: "flex-start",
    width: 115,
  },
  name: {
    color: INK,
    flexShrink: 1,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 19,
    marginBottom: 4,
    maxWidth: 112,
  },
  hint: {
    color: MUTED,
    fontSize: 10,
    lineHeight: 12,
  },
});
