import { useEffect, useState } from 'react';
import { contactApi } from '../services/api';

/**
 * Fetches a contact's cached profile picture through the authenticated API client and exposes it as
 * an object URL. The profile-picture endpoint requires the `X-API-Key` header like every other API
 * route (it deliberately isn't `@Public()` — it's the same private contact-photo data as the rest of
 * the contact record), so a plain `<img src="/api/...">` can't be pointed at it directly: a browser
 * `<img>` tag has no way to attach a custom header, so that request 401s every time.
 *
 * `enabled` (default true) gates the fetch — pass `false` to defer it (e.g. until the row scrolls
 * into view; see ContactAvatarImg). The chat list isn't virtualized, so every row mounts at once;
 * without this every row fired its avatar fetch immediately regardless of visibility, storming the
 * API with far more concurrent requests than there were on-screen avatars to show and tripping the
 * rate limiter on any list with more than a handful of chats.
 *
 * Returns `null` while loading/disabled, once there's no picture (204), or if the fetch fails —
 * callers should render their normal placeholder/icon in all cases rather than distinguishing them.
 */
export function useContactAvatar(
  sessionId: string | null | undefined,
  contactId: string | null | undefined,
  enabled = true,
): string | null {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !sessionId || !contactId) {
      setSrc(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    void contactApi.getProfilePicture(sessionId, contactId).then(blob => {
      if (cancelled) return;
      if (!blob) {
        setSrc(null);
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setSrc(objectUrl);
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sessionId, contactId, enabled]);

  return src;
}
