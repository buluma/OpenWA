import type { ChatMessage, EngineHistoryMessage, MessageType } from '../services/api';

/** How a media row renders as a tile in the chat's Media tab. */
export type MediaTileKind = 'image' | 'video' | 'audio' | 'document';

export function mediaTileKind(type: MessageType | string): MediaTileKind {
  if (type === 'video') return 'video';
  if (type === 'audio' || type === 'voice') return 'audio';
  if (type === 'document') return 'document';
  return 'image'; // image + sticker
}

/** A media row only renders when it carries the bytes; a missing one is no metadata or the omitted marker. */
export function hasMediaPayload(m: ChatMessage): boolean {
  return Boolean(m.metadata?.media?.data);
}

const msgKey = (m: ChatMessage): string => m.waMessageId ?? m.id;

/**
 * Fill rows whose payload was never stored from a live WhatsApp history fetch, matched by WhatsApp id
 * (engine `id` == DB `waMessageId`). A stored payload is kept, and history the list doesn't already
 * hold is ignored: the list is a DB page walk, and an extra row would shift what the next page repeats.
 */
export function fillMissingMedia(items: ChatMessage[], history: EngineHistoryMessage[]): ChatMessage[] {
  const fetched = new Map<string, NonNullable<EngineHistoryMessage['media']>>();
  for (const h of history) if (h.media?.data) fetched.set(h.id, h.media);
  return items.map(m => {
    if (hasMediaPayload(m)) return m;
    const media = fetched.get(msgKey(m));
    return media ? { ...m, metadata: { ...m.metadata, media } } : m;
  });
}

/**
 * Append the next DB page. The walk is offset-based, so a message arriving mid-walk pushes older rows
 * down and the next page re-serves one already listed; drop those instead of rendering a duplicate.
 */
export function appendMediaPage(existing: ChatMessage[], page: ChatMessage[]): ChatMessage[] {
  const seen = new Set(existing.map(msgKey));
  return [...existing, ...page.filter(m => !seen.has(msgKey(m)))];
}
