import type { Chat } from '../services/api';
import { formatPhoneForDisplay, isolateNumber, parsePhoneFromJid } from './formatPhone.ts';
import { phoneQueryDigits } from './phone.ts';

type ChatNaming = Pick<Chat, 'id' | 'name' | 'username' | 'phone'>;

export function formatWhatsAppUsername(username?: string): string | undefined {
  const value = username?.trim().replace(/^@+/, '');
  return value ? `@${value}` : undefined;
}

/**
 * A saved name or a push name. The digits of the chat's own id are not one: a privacy id's, where WhatsApp shows the
 * phone number, and a phone id's, which the engines list for a chat they have no name for, bare or with its suffix.
 * Nor is the mapped phone written as a number, with spaces, signs or direction marks around its digits; a name with
 * other words is one.
 */
export function savedChatName(chat: Pick<Chat, 'id' | 'name' | 'phone'>): string | undefined {
  const name = chat.name?.trim();
  if (!name) return undefined;
  const [user, host] = chat.id.split('@');
  const bare = user.split(':')[0];
  if (host?.split(':')[0] === 'lid' && (name === bare || name === `${bare}@lid`)) return undefined;
  const own = parsePhoneFromJid(chat.id);
  if (own && parsePhoneFromJid(name) === own) return undefined;
  const phone = chat.phone?.replace(/\D/g, '');
  if (phone && phoneQueryDigits(name) === phone) return undefined;
  return name;
}

/**
 * Prefer an actual contact name; else the username; else the phone a privacy id maps to, isolated left to right; else
 * the bare id. A privacy id's own digits are never formatted as a phone.
 */
export function chatDisplayName(chat: ChatNaming): string {
  const fallback = chat.id.split('@')[0];
  const username = formatWhatsAppUsername(chat.username);
  const name = savedChatName(chat);
  if (!name || (chat.username && name === chat.username)) {
    const phone = chat.phone ? formatPhoneForDisplay(chat.phone) : null;
    return username ?? (phone ? isolateNumber(phone) : fallback);
  }
  return name;
}

/** A resolved LID is an internal address; prefer WhatsApp's public username in the room heading. */
export function chatHeaderDisplayName(chat: ChatNaming): string {
  const username = formatWhatsAppUsername(chat.username);
  return chat.id.endsWith('@lid') && username ? username : chatDisplayName(chat);
}

/** Keep a LID visible only while the header has no username-and-phone pair to identify the contact. */
export function shouldShowTechnicalChatId(chat: Pick<Chat, 'id' | 'username'>, hasPhone: boolean): boolean {
  return !(chat.id.endsWith('@lid') && Boolean(formatWhatsAppUsername(chat.username)) && hasPhone);
}
