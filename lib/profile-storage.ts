import AsyncStorage from "@react-native-async-storage/async-storage";

const AVATAR_PREFIX = "artist-dm.profile-avatar.";

const keyFor = (accountId: string) => `${AVATAR_PREFIX}${accountId}`;

export async function getStoredAvatar(accountId: string) {
  return AsyncStorage.getItem(keyFor(accountId));
}

export async function setStoredAvatar(accountId: string, avatarUri?: string) {
  if (avatarUri) {
    await AsyncStorage.setItem(keyFor(accountId), avatarUri);
  } else {
    await AsyncStorage.removeItem(keyFor(accountId));
  }
}

export async function removeStoredAvatar(accountId: string) {
  await AsyncStorage.removeItem(keyFor(accountId));
}
