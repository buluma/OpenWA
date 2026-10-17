import type { Chat, Contact as BaileysContact, WAMessage, WAMessageKey } from '@whiskeysockets/baileys';
import { ChatSummary, Contact } from '../interfaces/whatsapp-engine.interface';
import { chatKind, parseWaId, toNeutralJid as canonicalizeWaId, userPart } from '../identity/wa-id';
import type { LidMappingStore } from '../identity/lid-mapping-store.service';
import { mergeTwinStates, type ChatStateStore, type ChatStateValue } from './baileys-chat-state-store.service';
import { resolveNonNegativeIntEnv } from '../../config/configuration';

/** Whether a raw chat id is in a phone dialect, as opposed to a lid or a group. */
function isPhoneKeyed(rawId: string): boolean {
  return rawId.endsWith('@s.whatsapp.net') || rawId.endsWith('@c.us');
}

interface LastMessage {
  key: WAMessageKey;
  timestamp: number;
  text: string;
}

// Default per-map entry cap, matching the other per-session bounds (LID_MAPPING_CACHE_MAX,
// BAILEYS_MESSAGE_STORE_LIMIT, the session lidPhoneCache — all 5000). Every read below has a defined
// miss path, so an eviction only costs a re-resolution/re-read, never data loss.
export const SESSION_STORE_MAP_CAP_DEFAULT = 5000;

/**
 * Insertion-ordered Map with an LRU cap, the same discipline as LidMappingStoreService: a read or
 * write re-inserts the key at the most-recent end, and a set evicts the least-recently-used entry
 * while over `max`. `max = 0` means unbounded.
 */
class LruMap<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly max: number) {}

  has(key: K): boolean {
    return this.map.has(key);
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) {
      return undefined;
    }
    const value = this.map.get(key) as V;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (!this.max) {
      return;
    }
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.map.delete(oldest);
    }
  }

  values(): IterableIterator<V> {
    return this.map.values();
  }

  /** LIVE iterator with the same caveat as {@link values}. */
  entries(): IterableIterator<[K, V]> {
    return this.map.entries();
  }
}

/**
 * Per-session, in-memory snapshot of Baileys contacts + chats, fed from `sock.ev` events. Baileys has
 * no fetch-all; this data arrives via `contacts.*`/`chats.*`/`messaging-history.set` (a full re-sync on
 * each connect) and is mapped to the neutral `Contact`/`ChatSummary` on read. Holds no socket — pure data.
 *
 * Every map is LRU-bounded (`BAILEYS_SESSION_STORE_MAX_ENTRIES`, default 5000 per map, 0 = unbounded)
 * because contacts/chats/lastMessages/lidToPn all grow from peer-controlled traffic — without a cap a
 * chatty account leaks one entry per distinct peer ever seen. Miss paths after an eviction:
 * `lidToPn` falls back to the contacts map and then the persisted cross-session lid->phone table (all
 * writes are written through), `lastMessage` reads null (callers treat it as "nothing known"),
 * `getEphemeralExpiration` falls back to `Chat.ephemeralExpiration` then undefined (never forces a
 * timer), and contact/name lookups degrade to the raw user-part. `ephemeralByChat` is keyed under both
 * the raw and neutral JID (two entries per chat), so its cap is doubled to cover the same number of
 * chats.
 */
export class BaileysSessionStore {
  private readonly contacts: LruMap<string, BaileysContact>;
  private readonly chats: LruMap<string, Chat>;
  private readonly lastMessages: LruMap<string, LastMessage>;
  private readonly lidToPn: LruMap<string, string>;
  /**
   * Per-chat disappearing-messages timer (seconds) learned from inbound messages (#473), the reliable
   * source for it: `Chat.ephemeralExpiration` (from `chats.*`/history sync) is empirically absent for a
   * long-standing timer after a reconnect (observed live: 0 of 159 cached chats carried it). Keyed by
   * both the raw and neutral JID so an outbound send addressed in either dialect (phone `@c.us` /
   * `@s.whatsapp.net` or `@lid`) resolves to the same entry. See {@link extractEphemeralDuration} for
   * which message field is read.
   */
  private readonly ephemeralByChat: LruMap<string, number>;

  /**
   * @param lidStore  optional persisted, cross-session lid->phone table that backs resolution beyond
   *                  this session's in-memory map (survives restarts, shared across sessions).
   * @param sessionId provenance recorded on rows this session writes to the table.
   * @param chatStateStore optional persisted per-session mute/archive/pin, so those chat fields survive
   *                       a reconnect Baileys cannot resync (it only re-emits mutations newer than the
   *                       persisted app-state version, never an already-applied one).
   */
  constructor(
    private readonly lidStore?: LidMappingStore,
    private readonly sessionId?: string,
    private readonly chatStateStore?: ChatStateStore,
  ) {
    // Mirrors LidMappingStoreService: a finite default, 0 opts back into unbounded, garbage falls back.
    const maxEntries = resolveNonNegativeIntEnv(
      process.env.BAILEYS_SESSION_STORE_MAX_ENTRIES,
      SESSION_STORE_MAP_CAP_DEFAULT,
    );
    this.contacts = new LruMap(maxEntries);
    this.chats = new LruMap(maxEntries);
    this.lastMessages = new LruMap(maxEntries);
    this.lidToPn = new LruMap(maxEntries);
    // Double-keyed (raw + neutral JID per chat), so it needs two slots per chat to cover the same span.
    this.ephemeralByChat = new LruMap(maxEntries * 2);
  }

  upsertContacts(records: Partial<BaileysContact>[] = []): void {
    for (const r of records) {
      // History-sync / app-state rows sometimes key the person as `lid` and leave `id` empty.
      const id = r.id ?? r.lid;
      if (!id) {
        continue;
      }
      // Groups/newsletters/status arrive in the same history-sync contact array as people; they
      // are not address-book entries and must not occupy the contact cap or GET /contacts.
      const kind = parseWaId(id).kind;
      if (kind === 'group' || kind === 'newsletter' || kind === 'broadcast' || kind === 'status') {
        continue;
      }
      const existing = this.contacts.get(id) ?? { id };
      const merged: BaileysContact = { id: existing.id };
      this.assignDefined(merged, existing);
      this.assignDefined(merged, { ...r, id });
      this.contacts.set(id, merged);
      // Capture a lid->phone pair from the merged record (lid + phone can arrive in separate updates).
      // `phoneNumber` is the authoritative PN field; fall back to `id` itself only when it's already
      // in the phone dialect (a lid-only contact's `id` is `<lid>@lid`, which is not a usable phone).
      // A record keyed by its lid carries the lid side in `id` and usually has no `lid` field.
      const phone = merged.phoneNumber ?? (merged.id.endsWith('@s.whatsapp.net') ? merged.id : undefined);
      const lid = merged.lid ?? (parseWaId(merged.id).kind === 'lid' ? merged.id : undefined);
      if (lid && phone) {
        this.lidToPn.set(lid, phone);
        this.persistLidMapping(lid, phone);
      }
    }
  }

  /**
   * Copy own enumerable fields whose value is not `undefined`. History-sync contacts always include
   * `name: displayName || name || username || undefined`, and a later `{ ...existing, ...partial }`
   * spread would wipe a saved address-book name that arrived first via `contacts.upsert`.
   */
  private assignDefined(target: BaileysContact, source: Partial<BaileysContact>): void {
    for (const key of Object.keys(source) as (keyof BaileysContact)[]) {
      const value = source[key];
      if (value !== undefined) {
        (target as unknown as Record<string, unknown>)[key] = value;
      }
    }
  }

  upsertChats(records: Partial<Chat>[] = []): void {
    for (const r of records) {
      if (!r.id) {
        continue;
      }
      const existing = this.chats.get(r.id) ?? { id: r.id };
      this.chats.set(r.id, { ...existing, ...r });
      this.persistChatState(r.id, r);
    }
  }

  /**
   * Write mute/archive/pin through to the persisted store when a chat update carries them. Own-key
   * presence, not truthiness, is the trigger: a history-sync or name-hydration partial that omits these
   * keys must not overwrite persisted state, and a live unmute arrives as `muteEndTime: null` (an own
   * key) that must persist as null. It has to be an OWN key: history sync hands over decoded
   * `proto.Conversation` instances, whose prototype defaults all three fields to null, so the `in`
   * operator would read every history chunk as a reset to unpinned, unarchived and unmuted. A no-op
   * when this session has no store wired (unit tests, wwjs).
   */
  private persistChatState(id: string, r: Partial<Chat>): void {
    if (!this.chatStateStore || !this.sessionId) return;
    const patch: Partial<ChatStateValue> = {};
    if (Object.hasOwn(r, 'muteEndTime')) patch.muteEndTime = this.normalizeMuteEndTime(r.muteEndTime);
    if (Object.hasOwn(r, 'archived')) patch.archived = Boolean(r.archived);
    if (Object.hasOwn(r, 'pinned')) patch.pinned = Boolean(r.pinned);
    if (Object.keys(patch).length) {
      // A row still filed under a lid twin is folded onto the state key here, on a real change, never
      // on a read: the store picks the newest row from the table, so a twin the cache happens to hold
      // cannot overwrite a newer row it does not.
      const key = this.stateKey(id);
      const twins = this.stateTwins([id], key);
      // Only an app-state action (the update holds the state fields alone) may create a row to hold a
      // default, like an unpin that must outweigh a pin on a twin row. A message carries `archived:
      // false` when the account unarchives on new messages, and a history chat carries its other fields
      // too; a default in either creating a row would leave one row per chat ever messaged.
      const create = Object.keys(r).every(f => f === 'id' || f === 'conditional' || Object.hasOwn(patch, f));
      void (twins.length
        ? this.chatStateStore.fold(this.sessionId, key, twins, patch, create)
        : this.chatStateStore.remember(this.sessionId, key, patch, create));
    }
  }

  /**
   * The one key a chat's persisted state lives under, whatever spelling the update carried: the phone
   * JID once the lid resolves, else the device-stripped lid, and anything else (a group) as is.
   * WhatsApp syncs a lid-migrated contact's pin, mute and archive under the lid while the chat record
   * may be keyed by phone, so keying the row by the raw id split one chat's state across two rows and
   * the listing read the one that never changed.
   */
  private stateKey(id: string): string {
    const parsed = parseWaId(id);
    if (parsed.kind === 'lid') {
      const phone = this.resolvePhone(id);
      return phone ? `${phone}@s.whatsapp.net` : `${parsed.userPart}@lid`;
    }
    return this.toEngineJid(id);
  }

  /**
   * The chat's persisted state. A row may still sit under a lid twin of the state key: written before
   * the mapping was learned, or by an earlier version that keyed rows by the raw id. The rows merge
   * field by field, as the fold does (see {@link mergeTwinStates}). A read never writes: the twin rows
   * are folded onto the state key on the chat's next change (see {@link persistChatState}). `recordIds`
   * are the raw ids of every chat record merged into the row, whose lids are twins too.
   */
  private chatState(rawId: string, recordIds: string[], lidIndex: Map<string, string[]>): ChatStateValue | undefined {
    const store = this.chatStateStore;
    const sid = this.sessionId;
    if (!store || !sid) return undefined;
    const key = this.stateKey(rawId);
    return mergeTwinStates([key, ...this.stateTwins(recordIds, key, lidIndex)].flatMap(k => store.get(sid, k) ?? []));
  }

  /**
   * The lid spellings of a phone-keyed state key: the lids among the chat's own record ids, and the
   * ones this session's mappings and the persisted table pair with the phone. The own lids matter when
   * only the contact record resolves them, which neither mapping source holds.
   */
  private stateTwins(rawIds: string[], key: string, lidIndex?: Map<string, string[]>): string[] {
    const parsed = parseWaId(key);
    if (parsed.kind !== 'user') return [];
    // A single update scans the mappings for this one phone; building the whole index per update
    // blocked the event loop for seconds when a first sync carried thousands of state fields.
    const twins = new Set(lidIndex?.get(parsed.userPart));
    if (!lidIndex) {
      for (const [lid, pn] of this.lidToPn.entries()) {
        if (userPart(pn) === parsed.userPart) twins.add(`${userPart(lid)}@lid`);
      }
    }
    for (const lid of this.lidStore?.lidsForPhone(parsed.userPart) ?? []) twins.add(`${lid}@lid`);
    for (const rawId of rawIds) {
      const raw = parseWaId(rawId);
      if (raw.kind === 'lid') twins.add(`${raw.userPart}@lid`);
    }
    return [...twins];
  }

  /** Phone digits to the lid JIDs this session maps to them, built once per listing. */
  private lidsByPhone(): Map<string, string[]> {
    const index = new Map<string, string[]>();
    for (const [lid, pn] of [...this.lidToPn.entries()]) {
      const phone = userPart(pn);
      index.set(phone, [...(index.get(phone) ?? []), `${userPart(lid)}@lid`]);
    }
    return index;
  }

  /**
   * Normalise a raw muteEndTime to canonical epoch ms, or null (0/absent = unmuted). A mute with no end
   * keeps the -1 sentinel rather than scaling it. See {@link isMuted}.
   */
  private normalizeMuteEndTime(v: number | { toNumber(): number } | null | undefined): number | null {
    const n = this.toUnixSeconds(v);
    if (!n) return null;
    if (n < 0) return -1;
    return n < 1e12 ? n * 1000 : n;
  }

  /**
   * Whether a Baileys `muteEndTime` is still in the future. The value arrives in two units: an
   * app-state `chatModify({ mute })` write echoes epoch MILLISECONDS, while a history-sync
   * `Conversation.muteEndTime` is seconds like the `conversationTimestamp` beside it. Normalised by
   * magnitude: below 1e12 is seconds (an epoch-ms stamp below 1e12 predates 2001-09). A negative value
   * is WhatsApp's "Always" sentinel (-1, the value WhatsApp Web sends too), a mute with no end.
   */
  private isMuted(muteEndTime: number | { toNumber(): number } | null | undefined): boolean {
    const raw = this.toUnixSeconds(muteEndTime);
    if (!raw) return false;
    if (raw < 0) return true;
    const endMs = raw < 1e12 ? raw * 1000 : raw;
    return endMs > Date.now();
  }

  /**
   * The expiry instant (epoch ms) for {@link ChatSummary.muteExpiration}, or undefined when the chat
   * is not muted. Same normalisation as {@link isMuted}, so the two agree. A mute with no end reads 0,
   * the contract's "muted indefinitely".
   */
  private muteExpirationMs(muteEndTime: number | { toNumber(): number } | null | undefined): number | undefined {
    const raw = this.toUnixSeconds(muteEndTime);
    if (!raw) return undefined;
    if (raw < 0) return 0;
    const endMs = raw < 1e12 ? raw * 1000 : raw;
    return endMs > Date.now() ? endMs : undefined;
  }

  addLidMappings(mappings: { lid?: string; pn?: string }[] = []): void {
    for (const m of mappings) {
      if (m.lid && m.pn) {
        this.lidToPn.set(m.lid, m.pn);
        this.persistLidMapping(m.lid, m.pn);
      }
    }
  }

  /**
   * Learn lid->pn mappings from an inbound message key (#362). Baileys v7 replaced the 6.7.x
   * `senderLid`/`senderPn`/`participantLid`/`participantPn` fields with `remoteJidAlt` (DM) and
   * `participantAlt` (group) — the "Alt" is always the other dialect of the same field
   * (`remoteJid`/`participant`): if one side is `@lid`, the Alt is the phone JID, and vice versa. This
   * is still the only place a fresh `@lid` sender's number is revealed on the message key itself; the
   * pairs flow through addLidMappings, so they also write through to the persistent table.
   */
  recordKeyLidMappings(key: Pick<WAMessageKey, 'remoteJid' | 'remoteJidAlt' | 'participant' | 'participantAlt'>): void {
    this.addLidMappings([
      this.lidPnPair(key.remoteJid, key.remoteJidAlt),
      this.lidPnPair(key.participant, key.participantAlt),
    ]);
  }

  /** Sorts a JID and its WhatsApp-supplied "Alt" counterpart into { lid, pn } by @lid suffix. */
  private lidPnPair(jid?: string | null, alt?: string | null): { lid?: string; pn?: string } {
    if (!jid || !alt) {
      return {};
    }
    if (jid.endsWith('@lid')) {
      return { lid: jid, pn: alt };
    }
    if (alt.endsWith('@lid')) {
      return { lid: alt, pn: jid };
    }
    return {};
  }

  /** Write a learned lid->phone pair through to the persistent table (bare digits, fire-and-forget). */
  private persistLidMapping(lidJid: string, pnJid: string): void {
    void this.lidStore?.remember(userPart(lidJid), userPart(pnJid), this.sessionId);
  }

  recordMessage(msg: WAMessage): void {
    const chatId = msg.key?.remoteJid;
    if (!chatId || !msg.key) {
      return;
    }
    // Learn the chat's disappearing-messages timer from the message itself (#473). This runs before the
    // newest-message guard so every inbound refreshes it; the timer is cached under both the raw and
    // neutral JID so an outbound send addressed in either dialect (phone or @lid) finds it.
    this.recordEphemeralFromMessage(chatId, msg);
    const key = this.chatKey(chatId);
    const timestamp = this.toUnixSeconds(msg.messageTimestamp);
    const existing = this.lastMessages.get(key);
    if (existing && existing.timestamp >= timestamp) {
      return; // keep the newest
    }
    const text = msg.message?.conversation ?? msg.message?.extendedTextMessage?.text ?? '';
    this.lastMessages.set(key, { key: msg.key, timestamp, text });
  }

  /**
   * Refresh the chat preview when (and only when) the edited message is still the latest message in
   * that chat. Editing an older message must not replace the preview or reorder the conversation.
   */
  recordMessageEdit(chatId: string, messageId: string, text: string): void {
    if (!messageId) return;
    const key = this.chatKey(chatId);
    const existing = this.lastMessages.get(key);
    if (!existing || existing.key.id !== messageId) return;
    this.lastMessages.set(key, { ...existing, text });
  }

  /**
   * The key a chat's preview is kept under, for an id in any dialect. One conversation reaches this
   * store as `<phone>@c.us` (the API and the listing), `<phone>@s.whatsapp.net` and `<lid>@lid`
   * (Baileys, which addresses a lid-migrated contact by its lid and sends to whatever it is given).
   * Keying each spelling separately left an API send or an inbound message on a twin the chat row
   * never reads, so the chat showed no preview and chat actions found no history. The chat record
   * decides: the twin Baileys keyed the chat under wins, then a twin that already holds a preview,
   * and a chat known under neither falls back to the engine dialect.
   */
  private chatKey(jid: string): string {
    if (this.chats.has(jid)) return jid;
    const twins = this.chatTwins(jid);
    return twins.find(k => this.chats.has(k)) ?? twins.find(k => this.lastMessages.has(k)) ?? this.toEngineJid(jid);
  }

  /** Every spelling of one chat this session can connect: the id, its engine form, and its lid or phone twin. */
  private chatTwins(jid: string): string[] {
    const parsed = parseWaId(jid);
    const twins = [jid, this.toEngineJid(jid)];
    if (parsed.kind === 'lid') {
      twins.push(`${parsed.userPart}@lid`);
      const phone = this.resolvePhone(jid);
      if (phone) twins.push(`${phone}@s.whatsapp.net`);
    } else if (parsed.kind === 'user') {
      for (const [lid, pn] of this.lidToPn.entries()) {
        if (userPart(pn) === parsed.userPart) twins.push(lid);
      }
      for (const lid of this.lidStore?.lidsForPhone(parsed.userPart) ?? []) twins.push(`${lid}@lid`);
    }
    return twins;
  }

  /**
   * Cache a positive disappearing-messages timer learned from an inbound message under both the raw chat
   * JID and its neutral form, so {@link getEphemeralExpiration} hits regardless of which dialect the caller
   * sends to. A non-positive/absent value means "no live timer on this message" and is left untouched (a
   * single non-ephemeral message must not clear a known timer; WhatsApp keeps stamping it while on).
   */
  private recordEphemeralFromMessage(chatId: string, msg: WAMessage): void {
    const duration = this.extractEphemeralDuration(msg);
    if (duration === undefined) {
      return;
    }
    this.ephemeralByChat.set(chatId, duration);
    this.ephemeralByChat.set(this.toNeutralJid(chatId), duration);
  }

  /**
   * Best-effort read of a message's disappearing timer (seconds). `WebMessageInfo.ephemeralDuration` is
   * populated on history-synced messages but is typically ABSENT on a live 1:1 `messages.upsert`, so fall
   * back to the per-message `contextInfo.expiration` WhatsApp stamps on every message in a disappearing
   * chat — read after unwrapping the ephemeral / view-once / document-with-caption envelope. Exposed so
   * the history-backfill mapper can populate the same signal the live path uses, without duplicating the
   * extraction.
   */
  extractEphemeralDuration(msg: WAMessage): number | undefined {
    const fromInfo = msg.ephemeralDuration;
    if (typeof fromInfo === 'number' && fromInfo > 0) {
      return fromInfo;
    }
    const fromContext = this.contextExpiration(msg.message);
    return typeof fromContext === 'number' && fromContext > 0 ? fromContext : undefined;
  }

  /** Walk a message's content (unwrapping known envelopes) and return the first positive `contextInfo.expiration`. */
  private contextExpiration(content: WAMessage['message'], depth = 0): number | undefined {
    if (!content || typeof content !== 'object' || depth > 4) {
      return undefined;
    }
    const nodes = content as Record<
      string,
      { contextInfo?: { expiration?: number | null }; message?: WAMessage['message'] } | undefined
    >;
    for (const node of Object.values(nodes)) {
      const exp = node?.contextInfo?.expiration;
      if (typeof exp === 'number' && exp > 0) {
        return exp;
      }
      if (node?.message) {
        const nested = this.contextExpiration(node.message, depth + 1);
        if (nested !== undefined) {
          return nested;
        }
      }
    }
    return undefined;
  }

  listContacts(): Contact[] {
    // GET /contacts is the address book, not "everyone this session has ever seen". Baileys
    // documents `name` as the one YOU saved; `notify` is only the pushname they set themselves.
    return [...this.contacts.values()].filter(c => c.name).map(c => this.toNeutralContact(c));
  }

  findContact(id: string): Contact | null {
    const parsed = parseWaId(id);
    const keys = [id, this.toEngineJid(id)];
    if (parsed.kind === 'lid') {
      keys.push(`${parsed.userPart}@lid`);
    }
    if (parsed.kind === 'user') {
      keys.push(`${parsed.userPart}@s.whatsapp.net`, `${parsed.userPart}@c.us`);
    }
    for (const key of keys) {
      const direct = this.contacts.get(key);
      if (direct) {
        return this.toNeutralContact(direct);
      }
    }
    if (parsed.kind !== 'user' && parsed.kind !== 'lid') {
      return null;
    }
    const want = parsed.userPart;
    for (const c of this.contacts.values()) {
      const phone = c.phoneNumber
        ? userPart(c.phoneNumber)
        : c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@c.us')
          ? userPart(c.id)
          : '';
      const lid = c.lid ? userPart(c.lid) : c.id.endsWith('@lid') ? userPart(c.id) : '';
      if (phone === want || lid === want) {
        return this.toNeutralContact(c);
      }
    }
    return null;
  }

  /**
   * One row per conversation. A contact WhatsApp migrated to a lid can hold two records, one keyed by
   * phone and one by lid (Baileys files an update under whichever id its source carried, and a record
   * created before the lid->phone mapping was learned stays where it is), and both project to the same
   * neutral id; listing each put two rows sharing one id into the answer. They fold like contacts do:
   * the phone-keyed record is primary, the twin {@link chatJid} routes app-state writes to, and a field
   * the primary lacks comes from the other. The preview is the newest message filed under any key that
   * projects to the row, indexed in one pass rather than a twin scan per chat.
   *
   * Every loop is over a SNAPSHOT: projecting an id resolves a lid through maps whose read moves the
   * entry to the most-recent end, so a live iterator would hand the same entry back forever.
   */
  listChats(): ChatSummary[] {
    const lidIndex = this.lidsByPhone();
    const previews = new Map<string, LastMessage>();
    for (const [key, m] of [...this.lastMessages.entries()]) {
      const id = this.toNeutralJid(key);
      const seen = previews.get(id);
      if (!seen || m.timestamp > seen.timestamp) previews.set(id, m);
    }
    const byId = new Map<string, Chat[]>();
    for (const c of [...this.chats.values()]) {
      const id = this.toNeutralJid(c.id!);
      byId.set(id, [...(byId.get(id) ?? []), c]);
    }
    // A new engine starts with no chats, but a chat with a persisted state is known to exist: a deleted
    // chat loses its row. So it is listed before its next message arrives.
    if (this.chatStateStore && this.sessionId) {
      for (const chatId of this.chatStateStore.chatIds(this.sessionId)) {
        const id = this.toNeutralJid(chatId);
        if (!byId.has(id)) byId.set(id, [{ id: chatId }]);
      }
    }
    return [...byId].map(([id, records]) => this.toNeutralChat(id, records, previews.get(id), lidIndex));
  }

  /**
   * The id the chat is keyed under, for an app-state write addressed with any spelling of it (the
   * listing's @c.us id of a lid-keyed chat resolves to the lid). Baileys indexes the patch by this jid
   * and replays it locally under the same id, so any other spelling names a chat the phone does not
   * hold and lands the echo on a second record.
   */
  chatJid(chatId: string): string {
    return this.chatKey(chatId);
  }

  /** The chat's newest message, with `jid`, the id the chat itself is keyed under. */
  lastMessage(chatId: string): { key: WAMessageKey; timestamp: number; jid: string } | null {
    const m = this.newestAcrossTwins(this.lastMessages, chatId);
    return m ? { key: m.key, timestamp: m.timestamp, jid: this.chatJid(chatId) } : null;
  }

  /**
   * The newest entry `map` holds for a chat under any of its spellings. A message recorded under the
   * contact's lid before the lid->phone mapping was learned stays on the lid twin while the chat key
   * moves to the phone-keyed chat record, so reading the chat key alone would lose it.
   */
  private newestAcrossTwins<T extends { timestamp: number }>(map: LruMap<string, T>, chatId: string): T | undefined {
    let newest: T | undefined;
    for (const k of [this.chatKey(chatId), ...this.chatTwins(chatId)]) {
      const v = map.get(k);
      if (v && (!newest || v.timestamp > newest.timestamp)) newest = v;
    }
    return newest;
  }

  /**
   * The chat's disappearing-messages timer in seconds (#473), or `undefined` when no timer is known.
   * Only a positive value is returned: `0` / `null` / absent all mean "no known timer", so the caller
   * omits the per-message `ephemeralExpiration` and reproduces today's send behavior (Baileys' own send
   * guard is truthy). This keeps a stale-empty or boot-window cache from ever forcing a message to
   * disappear. Folds a neutral `@c.us` id to the engine dialect first, like the other chat lookups.
   */
  getEphemeralExpiration(chatId: string): number | undefined {
    // Prefer the timer learned from inbound messages (reliably present); try the raw, engine, and
    // neutral keys so an @lid-keyed entry and a phone-dialect send target resolve to the same value.
    const fromMessage =
      this.ephemeralByChat.get(chatId) ??
      this.ephemeralByChat.get(this.toEngineJid(chatId)) ??
      this.ephemeralByChat.get(this.toNeutralJid(chatId));
    if (typeof fromMessage === 'number' && fromMessage > 0) {
      return fromMessage;
    }
    // Fallback to the chat object's own timer for sessions/engines that do surface it on `chats.*`.
    const chat =
      this.chats.get(chatId) ??
      this.chats.get(this.toEngineJid(chatId)) ??
      this.chats.get(this.toNeutralJid(chatId)) ??
      this.chats.get(this.chatKey(chatId));
    const exp = chat?.ephemeralExpiration;
    return typeof exp === 'number' && exp > 0 ? exp : undefined;
  }

  resolvePhone(id: string): string | null {
    const parsed = parseWaId(id);
    // A user id (@c.us / @s.whatsapp.net) already carries the phone as its user-part. The @c.us case
    // matters once inbound ids are canonicalized: a resolved-lid sender arrives as <phone>@c.us.
    if (parsed.kind === 'user') {
      return parsed.userPart;
    }
    if (parsed.kind === 'lid') {
      // Look up by the device-stripped lid; mappings/contacts are keyed without a :device suffix.
      const lidJid = `${parsed.userPart}@lid`;
      const pn = this.lidToPn.get(lidJid) ?? this.lidToPn.get(id);
      if (pn) {
        return userPart(pn);
      }
      const contactPhone = (this.contacts.get(lidJid) ?? this.contacts.get(id))?.phoneNumber;
      if (contactPhone) {
        return userPart(contactPhone);
      }
      // Fall back to the persistent, cross-session table (in-memory cache, keyed by bare lid digits).
      // `null` means a cached negative (known-unresolved); `undefined` means never seen - both -> null.
      return this.lidStore?.getCached(parsed.userPart) ?? null;
    }
    return null;
  }

  /**
   * Canonicalize a Baileys JID to the neutral dialect (see {@link canonicalizeWaId} / wa-id.ts),
   * resolving a lid to its phone via this session's lid->pn map when the mapping is known.
   */
  toNeutralJid(jid: string): string {
    return canonicalizeWaId(jid, id => this.resolvePhone(id));
  }

  /**
   * Fold an app-facing neutral id back to the engine's raw dialect. The contacts / chats / lastMessages
   * maps are keyed by Baileys' raw `@s.whatsapp.net`, but the app now hands us the neutral `@c.us`
   * (contact/chat ids are emitted neutral), so map lookups must fold first. The outbound group-participant
   * ops fold for the same reason: only `@s.whatsapp.net` encodes to the single-byte protocol token, whereas
   * a raw `c.us` server suffix would go on the wire as an unknown string. Groups/lids/others share the
   * dialect, so pass them through unchanged.
   */
  toEngineJid(jid: string): string {
    const parsed = parseWaId(jid);
    return parsed.kind === 'user' ? `${parsed.userPart}@s.whatsapp.net` : jid;
  }

  private toNeutralContact(c: BaileysContact): Contact {
    const number = c.phoneNumber ? userPart(c.phoneNumber) : c.id.endsWith('@s.whatsapp.net') ? userPart(c.id) : '';
    return {
      id: this.toNeutralJid(c.id),
      name: c.name ?? c.verifiedName,
      pushName: c.notify,
      number,
      // Baileys `name` is the saved address-book name; `notify` is only their pushname.
      isMyContact: Boolean(c.name),
      isBlocked: false, // best-effort: blocklist state is not tracked in this slice
      profilePicUrl: c.imgUrl ?? undefined,
    };
  }

  /**
   * Project the records that share neutral `id` (usually one) into a row. `last` is the newest preview
   * filed under any of their keys.
   */
  private toNeutralChat(
    id: string,
    records: Chat[],
    last: LastMessage | undefined,
    lidIndex: Map<string, string[]>,
  ): ChatSummary {
    // Chat.id is nullable on Baileys' own type (it's the raw proto.IConversation field), but
    // upsertChats() only ever stores a record under a truthy r.id, so every value in `this.chats`
    // is provably keyed by a real id. Phone-keyed first, then the lower raw id: stable across calls.
    const [c, ...others] = [...records].sort((a, b) =>
      isPhoneKeyed(a.id!) !== isPhoneKeyed(b.id!) ? (isPhoneKeyed(a.id!) ? -1 : 1) : a.id! < b.id! ? -1 : 1,
    );
    const rawId = c.id!;
    // Mute/archive/pin come from the persisted store when it has this chat (it survives a reconnect
    // Baileys cannot resync), else from the primary's live record. A `null` muteEndTime means unmuted.
    const st = this.chatState(
      rawId,
      records.map(r => r.id!),
      lidIndex,
    );
    return {
      id,
      name: c.name ?? others.find(o => o.name)?.name ?? this.resolveContactName(rawId),
      isGroup: rawId.endsWith('@g.us'),
      kind: chatKind(id),
      // From the most recently active record that has one: new messages to a lid-migrated contact
      // count on the lid record while the phone one keeps a stale 0.
      unreadCount:
        [c, ...others]
          .filter(r => r.unreadCount != null)
          .sort((a, b) => this.toUnixSeconds(b.conversationTimestamp) - this.toUnixSeconds(a.conversationTimestamp))[0]
          ?.unreadCount ?? 0,
      timestamp: last?.timestamp ?? Math.max(...records.map(r => this.toUnixSeconds(r.conversationTimestamp))),
      lastMessage: last?.text,
      archived: st ? st.archived : (c.archived ?? false),
      // Baileys reports a pin as an ORDER, not a flag: 0/absent means unpinned.
      pinned: st ? st.pinned : Boolean(c.pinned),
      muted: this.isMuted(st ? st.muteEndTime : c.muteEndTime),
      muteExpiration: this.muteExpirationMs(st ? st.muteEndTime : c.muteEndTime),
    };
  }

  /**
   * Best-known display name for a chat id when Baileys gave the chat no title (#369). Prefers the saved
   * contact name, then verifiedName, then pushName (`notify`); for a @lid chat it also tries the contact
   * behind the resolved phone. Falls back to the raw user-part so a number/lid is never shown as a JID.
   */
  private resolveContactName(id: string): string {
    const direct = this.contactDisplayName(id);
    if (direct) {
      return direct;
    }
    const parsed = parseWaId(id);
    if (parsed.kind === 'lid') {
      const lidJid = `${parsed.userPart}@lid`;
      const pn =
        this.lidToPn.get(lidJid) ??
        this.lidToPn.get(id) ??
        (this.contacts.get(lidJid) ?? this.contacts.get(id))?.phoneNumber;
      if (pn) {
        const viaPhone =
          this.contactDisplayName(pn) ??
          this.contactDisplayName(`${userPart(pn)}@s.whatsapp.net`) ??
          this.contactDisplayName(`${userPart(pn)}@c.us`);
        if (viaPhone) {
          return viaPhone;
        }
      }
    }
    return userPart(id);
  }

  private contactDisplayName(id: string): string | undefined {
    const c = this.contacts.get(id);
    return c ? (c.name ?? c.verifiedName ?? c.notify ?? undefined) : undefined;
  }

  private toUnixSeconds(ts: number | { toNumber(): number } | null | undefined): number {
    if (ts == null) {
      return 0;
    }
    return typeof ts === 'number' ? ts : ts.toNumber();
  }
}
