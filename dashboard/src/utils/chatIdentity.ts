import type { Chat } from '../services/api';

export function formatWhatsAppUsername(username?: string): string | undefined {
  const value = username?.trim().replace(/^@+/, '');
  return value ? `@${value}` : undefined;
}

/** Prefer an actual contact name; use the username instead of a bare LID/phone fallback. */
export function chatDisplayName(chat: Pick<Chat, 'id' | 'name' | 'username'>): string {
  const fallback = chat.id.split('@')[0];
  const username = formatWhatsAppUsername(chat.username);
  const name = chat.name?.trim();
  if (!name || name === fallback || (chat.username && name === chat.username)) {
    return username ?? (name || fallback);
  }
  return name;
}

/** A resolved LID is an internal address; prefer WhatsApp's public username in the room heading. */
export function chatHeaderDisplayName(chat: Pick<Chat, 'id' | 'name' | 'username'>): string {
  const username = formatWhatsAppUsername(chat.username);
  return chat.id.endsWith('@lid') && username ? username : chatDisplayName(chat);
}

/** Keep a LID visible only while the header has no username-and-phone pair to identify the contact. */
export function shouldShowTechnicalChatId(chat: Pick<Chat, 'id' | 'username'>, hasPhone: boolean): boolean {
  return !(chat.id.endsWith('@lid') && Boolean(formatWhatsAppUsername(chat.username)) && hasPhone);
}
