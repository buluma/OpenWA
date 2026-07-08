import { memo } from 'react';
import { useContactAvatar } from '../../hooks/useContactAvatar';

interface Props {
  sessionId: string | null | undefined;
  contactId: string | null | undefined;
  className?: string;
}

/** Renders a contact's cached profile picture (via {@link useContactAvatar}, which fetches it through
 * the authenticated API client rather than a bare `<img src>`) or nothing at all — the caller's own
 * fallback icon, already sitting behind this in the DOM (see `.chat-avatar`/`.room-avatar` in
 * Chats.css), shows through whenever there's no picture yet or none exists. */
function ContactAvatarImg({ sessionId, contactId, className }: Props) {
  const src = useContactAvatar(sessionId, contactId);
  if (!src) return null;
  return <img src={src} alt="" className={className} />;
}

export default memo(ContactAvatarImg);
