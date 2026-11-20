import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { Image as ExpoImage, type ImageSource } from "expo-image";
import { Platform } from "react-native";
import { getServerAuthHeaders } from "@/lib/server-auth";
import { resolveMediaUrl } from "@/lib/media-api";
import {
  discardAuthenticatedMediaAfterPendingConsumers,
  getAuthenticatedMedia,
  getAuthenticatedMediaCacheGeneration,
  rememberAuthenticatedMedia,
  retainAuthenticatedMedia,
  releaseAuthenticatedMedia,
  type AuthenticatedMediaEntry,
} from "@/lib/authenticated-media-cache";

type MediaSource = { uri: string | undefined; headers?: Record<string, string> };
const pendingWebMedia = new Map<string, Promise<AuthenticatedMediaEntry>>();

function getRequestKey(uri: string, authorization: string) {
  return `${authorization}|${uri}`;
}

function getMediaExpiry(uri: string) {
  try {
    const expiresAt = Number(new URL(uri).searchParams.get("e"));
    if (Number.isFinite(expiresAt) && expiresAt > 0) return expiresAt * 1000;
  } catch { /* use a short in-memory lifetime for non-signed URLs */ }
  return Date.now() + 5 * 60_000;
}

async function downloadWebMedia(key: string, uri: string, headers: Record<string, string>) {
  const existingRequest = pendingWebMedia.get(key);
  if (existingRequest) return existingRequest;

  const request = (async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(uri, { headers, cache: "no-store" });
        if (!response.ok) throw new Error(`미디어 요청 실패 (${response.status})`);
        const blobUri = URL.createObjectURL(await response.blob());
        return { uri, headers, blobUri, validUntil: getMediaExpiry(uri), references: 0, retired: false };
      } catch (error) {
        lastError = error;
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("미디어 요청에 실패했습니다.");
  })();
  pendingWebMedia.set(key, request);
  try {
    return await request;
  } finally {
    if (pendingWebMedia.get(key) === request) pendingWebMedia.delete(key);
  }
}

/**
 * Protected image bytes always use the current server-issued URL. Web may reuse
 * authenticated media only in the current in-memory session; native images are
 * passed directly to Expo Image with the current auth header and no image cache.
 */
export function useAuthenticatedMediaSource(uri?: string): MediaSource {
  const resolvedUri = uri ? resolveMediaUrl(uri) ?? uri : undefined;
  const [source, setSource] = useState<MediaSource>({ uri: undefined });

  useEffect(() => {
    let active = true;
    let retainedMedia: AuthenticatedMediaEntry | undefined;
    if (!resolvedUri) {
      setSource({ uri: undefined });
      return () => { active = false; };
    }

    void (async () => {
      const isRemote = /^https?:\/\//i.test(resolvedUri);
      if (!isRemote) {
        setSource({ uri: resolvedUri });
        return;
      }

      const headers = await getServerAuthHeaders();
      if (!active) return;
      const authorization = headers.authorization;
      if (!authorization) {
        setSource({ uri: undefined });
        return;
      }

      if (Platform.OS !== "web") {
        const latestHeaders = await getServerAuthHeaders();
        if (!active || latestHeaders.authorization !== authorization) return;
        setSource({ uri: resolvedUri, headers });
        return;
      }

      const key = getRequestKey(resolvedUri, authorization);
      const cached = getAuthenticatedMedia(key);
      if (cached?.blobUri) {
        retainAuthenticatedMedia(cached);
        retainedMedia = cached;
        setSource({ uri: cached.blobUri });
        return;
      }

      const generation = getAuthenticatedMediaCacheGeneration();
      setSource({ uri: undefined });
      const media = await downloadWebMedia(key, resolvedUri, headers);
      const latestHeaders = await getServerAuthHeaders();
      if (!active || latestHeaders.authorization !== authorization) {
        discardAuthenticatedMediaAfterPendingConsumers(media);
        return;
      }
      rememberAuthenticatedMedia(key, media, generation);
      retainAuthenticatedMedia(media);
      retainedMedia = media;
      setSource({ uri: media.blobUri });
    })().catch(() => {
      if (active) setSource({ uri: undefined });
    });

    return () => {
      active = false;
      if (retainedMedia) releaseAuthenticatedMedia(retainedMedia);
    };
  }, [resolvedUri]);

  if (resolvedUri && !/^https?:\/\//i.test(resolvedUri)) return { uri: resolvedUri };
  return source;
}

type AuthenticatedImageProps = Omit<
  ComponentProps<typeof ExpoImage>,
  "source" | "cachePolicy" | "allowDownscaling"
> & { uri: string };

const EMPTY_IMAGE = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

export default function AuthenticatedImage({ uri, ...props }: AuthenticatedImageProps) {
  const source = useAuthenticatedMediaSource(uri);
  const imageSource = useMemo<ImageSource>(() => ({
    uri: source.uri ?? EMPTY_IMAGE,
    headers: source.headers,
  }), [source.uri, source.headers]);

  return (
    <ExpoImage
      {...props}
      source={imageSource}
      cachePolicy="none"
      allowDownscaling
      transition={0}
    />
  );
}
