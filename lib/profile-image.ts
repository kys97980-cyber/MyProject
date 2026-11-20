import { getServerAccount } from "@/lib/account-api";
import { resolveMediaUrl } from "@/lib/media-api";

const profileImageRequests = new Map<string, Promise<string | undefined>>();
const normalizeEmail = (email: string) => email.trim().toLowerCase();

/**
 * Uses the current server profile response as the only source of truth.
 * Only concurrent requests are coalesced; resolved values are never cached.
 */
export async function loadServerProfileImage(email: string, currentServerUri?: string) {
  const key = normalizeEmail(email);
  if (currentServerUri) return resolveMediaUrl(currentServerUri) ?? currentServerUri;

  const pending = profileImageRequests.get(key);
  if (pending) return pending;

  const request = getServerAccount(key).then((account) =>
    account.avatarUri ? (resolveMediaUrl(account.avatarUri) ?? account.avatarUri) : undefined,
  ).finally(() => {
    if (profileImageRequests.get(key) === request) profileImageRequests.delete(key);
  });
  profileImageRequests.set(key, request);
  return request;
}
