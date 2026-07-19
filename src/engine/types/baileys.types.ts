import type { Chat, Contact, WAMessage } from '@whiskeysockets/baileys';
import type { LidMappingStore } from '../identity/lid-mapping-store.service';

/**
 * Persistence boundary for the Baileys engine's message store. The adapter depends on this narrow
 * interface (not the concrete Nest service) so it stays unit-testable with a fake.
 */
export interface BaileysMessageStore {
  /** Persist a message (idempotent on the same id) so it can be referenced by reply/forward/react/delete. */
  put(sessionId: string, msg: WAMessage): Promise<void>;
  /** Look up a previously-seen message by its id, or null. */
  getMessage(sessionId: string, messageId: string): Promise<WAMessage | null>;
  /** Remove all stored messages for a session (called on logout). */
  clearSession(sessionId: string): Promise<void>;
}

/**
 * Persistence boundary for the Baileys engine's chat/contact snapshot (SHA-85). Baileys has no
 * fetch-all for either — both arrive only via the live event stream into an in-memory map, wiped by
 * every process restart. The adapter depends on this narrow interface (not the concrete Nest
 * service) so it stays unit-testable with a fake, mirroring {@link BaileysMessageStore}.
 */
export interface BaileysSessionStateStore {
  /** Persist/merge a batch of chats (idempotent per `id`). No-ops on an empty array. */
  saveChats(sessionId: string, chats: Partial<Chat>[]): Promise<void>;
  /** Persist/merge a batch of contacts (idempotent per `id`). No-ops on an empty array. */
  saveContacts(sessionId: string, contacts: Partial<Contact>[]): Promise<void>;
  /** Load every previously-persisted chat for a session, to seed the in-memory store on reconnect. */
  loadChats(sessionId: string): Promise<Partial<Chat>[]>;
  /** Load every previously-persisted contact for a session, to seed the in-memory store on reconnect. */
  loadContacts(sessionId: string): Promise<Partial<Contact>[]>;
  /** Remove all stored chats/contacts for a session (called on logout). */
  clearSession(sessionId: string): Promise<void>;
}

/**
 * Per-call construction config for {@link BaileysAdapter}. Engine-neutral fields come from the
 * factory; `authDir` is the base multi-file auth directory from the opaque `engine.baileys.*` blob
 * (the adapter appends the session id to isolate each session).
 */
export interface BaileysAdapterConfig {
  /** Session NAME — keys the on-disk auth directory and LID-mapping provenance. */
  sessionId: string;
  /** Session UUID (Session.id) — keys the FK-bound baileys_stored_messages rows via messageStore. */
  dbSessionId: string;
  authDir: string;
  proxyUrl?: string;
  proxyType?: 'http' | 'https' | 'socks4' | 'socks5';
  /** Persisted store for reply/forward/react/delete. Provided by the plugin; the four ops require it. */
  messageStore?: BaileysMessageStore;
  /** Persisted, cross-session lid->phone resolution table. Backs lid resolution beyond the in-memory map. */
  lidMappingStore?: LidMappingStore;
  /** Persisted chat/contact snapshot (SHA-85), reloaded on connect so restarts don't lose them. */
  sessionStateStore?: BaileysSessionStateStore;
  /** Directory to cache profile pictures (default: ./data/profiles/<sessionId>). */
  profilesDir?: string;
}

/**
 * The minimal pino-compatible logger Baileys' `makeWASocket` expects. Declared locally so we can
 * pass a fully silent logger without taking a direct `pino` dependency.
 *
 * Matches the Baileys `ILogger` contract: each log method receives `(obj: unknown, msg?: string)`.
 */
export interface BaileysLogger {
  level: string;
  child: (bindings: Record<string, unknown>) => BaileysLogger;
  trace: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}
