import { memo, useEffect, useRef, useState } from 'react';
import { useContactAvatar } from '../../hooks/useContactAvatar';

interface Props {
  sessionId: string | null | undefined;
  contactId: string | null | undefined;
  className?: string;
}

/** Renders a contact's cached profile picture (via {@link useContactAvatar}, which fetches it through
 * the authenticated API client rather than a bare `<img src>`) or nothing at all — the caller's own
 * fallback icon, already sitting behind this in the DOM (see `.chat-avatar`/`.room-avatar` in
 * Chats.css), shows through whenever there's no picture yet or none exists.
 *
 * Defers the fetch until this row is within 200px of the viewport. The chat list isn't virtualized —
 * every row mounts at once — so without this, opening a long chat list fired an avatar fetch per row
 * simultaneously regardless of what was actually on screen, storming the API and tripping its rate
 * limiter. `display: contents` keeps the observed wrapper out of the box model entirely so it can't
 * disturb the existing avatar sizing/layout. */
function ContactAvatarImg({ sessionId, contactId, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return; // already triggered — no need to keep observing
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  const src = useContactAvatar(sessionId, contactId, visible);

  return <span ref={ref} style={{ display: 'contents' }}>{src && <img src={src} alt="" className={className} />}</span>;
}

export default memo(ContactAvatarImg);
