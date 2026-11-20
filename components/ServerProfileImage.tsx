import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import AuthenticatedImage from "@/components/AuthenticatedImage";
import { loadServerProfileImage } from "@/lib/profile-image";

type ServerProfileImageProps = Omit<ComponentProps<typeof AuthenticatedImage>, "uri"> & {
  email: string;
  initialUri?: string;
  fallback?: ReactNode;
};

export default function ServerProfileImage({ email, initialUri, fallback = null, ...imageProps }: ServerProfileImageProps) {
  const [uri, setUri] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setUri(undefined);
    void loadServerProfileImage(email, initialUri)
      .then((serverUri) => {
        if (active) setUri(serverUri);
      })
      .catch(() => {
        if (active) setUri(undefined);
      });
    return () => { active = false; };
  }, [email, initialUri]);

  return uri ? <AuthenticatedImage {...imageProps} uri={uri} /> : <>{fallback}</>;
}
