import { BaileysSessionStore } from './baileys-session-store';
import type { LidMappingStore } from '../identity/lid-mapping-store.service';
import { mergeTwinStates, type ChatStateValue } from './baileys-chat-state-store.service';

describe('BaileysSessionStore', () => {
  let store: BaileysSessionStore;
  beforeEach(() => {
    store = new BaileysSessionStore();
  });

  it('upserts contacts (full then partial merge) and maps to neutral', () => {
    store.upsertContacts([{ id: '628111@s.whatsapp.net', notify: 'Al', imgUrl: 'http://p/x.jpg' }]);
    store.upsertContacts([{ id: '628111@s.whatsapp.net', name: 'Alice' }]); // partial: name added, notify kept
    const c = store.findContact('628111@s.whatsapp.net');
    expect(c).toEqual({
      id: '628111@c.us', // listing ids are emitted in the neutral dialect

      name: 'Alice',
      pushName: 'Al',
      number: '628111',
      isMyContact: true,
      isBlocked: false,
      profilePicUrl: 'http://p/x.jpg',
    });
    expect(store.findContact('nope@s.whatsapp.net')).toBeNull();
    expect(store.listContacts()).toHaveLength(1);
  });

  it('does not let a later history row without a saved name erase the address-book name', () => {
    store.upsertContacts([{ id: '628111@s.whatsapp.net', name: 'Alice', notify: 'Al' }]);
    store.upsertContacts([{ id: '628111@s.whatsapp.net', name: undefined, notify: 'Al' }]);
    expect(store.findContact('628111@s.whatsapp.net')).toMatchObject({ name: 'Alice', pushName: 'Al' });
  });

  it('finds a saved contact keyed by LID through its phone number', () => {
    store.upsertContacts([{ lid: '111@lid', phoneNumber: '628111@s.whatsapp.net', name: 'Ada' }]);
    expect(store.findContact('111@lid')?.name).toBe('Ada');
    expect(store.findContact('628111@c.us')?.name).toBe('Ada');
  });

  it('keeps groups, newsletters and status out of the address book', () => {
    store.upsertContacts([
      { id: '120363-9@g.us', name: 'Team' },
      { id: '123@newsletter', name: 'Channel' },
      { id: 'status@broadcast' },
      { id: '628111@s.whatsapp.net', name: 'Alice' },
    ]);
    expect(store.listContacts()).toHaveLength(1);
    expect(store.findContact('120363-9@g.us')).toBeNull();
  });

  it('does not turn a chat partner into a saved contact', () => {
    store.upsertChats([{ id: '628111@s.whatsapp.net', name: 'Alice' }]);
    expect(store.findContact('628111@c.us')).toBeNull();
    expect(store.listContacts()).toHaveLength(0);
    expect(store.listChats()).toHaveLength(1);
  });

  it('records the newest message per chat and surfaces it in getChats', () => {
    store.upsertChats([{ id: '628111@s.whatsapp.net', name: 'Alice', unreadCount: 2 }]);
    store.recordMessage({
      key: { remoteJid: '628111@s.whatsapp.net', fromMe: false, id: 'OLD' },
      message: { conversation: 'old' },
      messageTimestamp: 100,
    });
    store.recordMessage({
      key: { remoteJid: '628111@s.whatsapp.net', fromMe: false, id: 'NEW' },
      message: { conversation: 'newest' },
      messageTimestamp: 200,
    });
    const chats = store.listChats();
    expect(chats).toEqual([
      {
        id: '628111@c.us', // listing ids are emitted in the neutral dialect
        name: 'Alice',
        isGroup: false,
        kind: 'individual',
        unreadCount: 2,
        timestamp: 200,
        lastMessage: 'newest',
        archived: false,
        pinned: false,
        muted: false,
        muteExpiration: undefined,
      },
    ]);
    expect(store.lastMessage('628111@s.whatsapp.net')).toEqual({
      key: { remoteJid: '628111@s.whatsapp.net', fromMe: false, id: 'NEW' },
      timestamp: 200,
      jid: '628111@s.whatsapp.net',
    });
  });

  it('does not overwrite a newer last-message with an older one', () => {
    store.recordMessage({
      key: { remoteJid: 'c@s.whatsapp.net', id: 'NEW' },
      message: {},
      messageTimestamp: 200,
    });
    store.recordMessage({
      key: { remoteJid: 'c@s.whatsapp.net', id: 'OLD' },
      message: {},
      messageTimestamp: 100,
    });
    expect(store.lastMessage('c@s.whatsapp.net')?.key.id).toBe('NEW');
  });

  it('updates the chat preview only when the edited message is the current last message', () => {
    store.upsertChats([{ id: '628111@s.whatsapp.net', name: 'Alice' }]);
    store.recordMessage({
      key: { remoteJid: '628111@s.whatsapp.net', id: 'LATEST' },
      message: { conversation: 'before edit' },
      messageTimestamp: 200,
    });

    store.recordMessageEdit('628111@c.us', 'OLDER', 'must not replace preview');
    expect(store.listChats()[0]).toEqual(expect.objectContaining({ lastMessage: 'before edit', timestamp: 200 }));

    store.recordMessageEdit('628111@c.us', 'LATEST', 'after edit');
    expect(store.listChats()[0]).toEqual(expect.objectContaining({ lastMessage: 'after edit', timestamp: 200 }));
  });

  it('flags a group chat by jid', () => {
    store.upsertChats([{ id: '123-456@g.us', name: 'Grp' }]);
    expect(store.listChats()[0].isGroup).toBe(true);
  });

  it('lastMessage returns null for an unknown chat', () => {
    expect(store.lastMessage('unknown@s.whatsapp.net')).toBeNull();
  });

  describe('getEphemeralExpiration (#473)', () => {
    it('returns the cached disappearing-messages timer for a chat', () => {
      store.upsertChats([{ id: '628111@s.whatsapp.net', ephemeralExpiration: 604800 }]);
      expect(store.getEphemeralExpiration('628111@s.whatsapp.net')).toBe(604800);
    });

    it('accepts a neutral @c.us id and folds it to the engine dialect for lookup', () => {
      store.upsertChats([{ id: '628111@s.whatsapp.net', ephemeralExpiration: 86400 }]);
      expect(store.getEphemeralExpiration('628111@c.us')).toBe(86400);
    });

    it('returns undefined when the chat is unknown, disabled (0), or null (no forced disappear)', () => {
      store.upsertChats([{ id: '628222@s.whatsapp.net', ephemeralExpiration: 0 }]);
      store.upsertChats([{ id: '628333@s.whatsapp.net', ephemeralExpiration: null }]);
      store.upsertChats([{ id: '628444@s.whatsapp.net' }]); // field absent
      expect(store.getEphemeralExpiration('628222@s.whatsapp.net')).toBeUndefined();
      expect(store.getEphemeralExpiration('628333@s.whatsapp.net')).toBeUndefined();
      expect(store.getEphemeralExpiration('628444@s.whatsapp.net')).toBeUndefined();
      expect(store.getEphemeralExpiration('nope@s.whatsapp.net')).toBeUndefined();
    });

    it('learns the timer from an inbound message ephemeralDuration without any chats.* upsert', () => {
      // The real-world case: Chat.ephemeralExpiration is never populated, but every inbound message in
      // a disappearing chat carries the live timer. A neutral @c.us send target must resolve it too.
      store.recordMessage({
        key: { remoteJid: '628111@s.whatsapp.net', fromMe: false, id: 'M1' },
        message: { conversation: 'hi' },
        messageTimestamp: 100,
        ephemeralDuration: 7776000,
      });
      expect(store.getEphemeralExpiration('628111@s.whatsapp.net')).toBe(7776000);
      expect(store.getEphemeralExpiration('628111@c.us')).toBe(7776000);
    });

    it('resolves a timer learned under @lid when the send targets the phone jid (#473 LID migration)', () => {
      store.addLidMappings([{ lid: '41562515988583@lid', pn: '5491169954736@s.whatsapp.net' }]);
      store.recordMessage({
        key: { remoteJid: '41562515988583@lid', fromMe: false, id: 'M2' },
        message: { conversation: 'hola' },
        messageTimestamp: 100,
        ephemeralDuration: 7776000,
      });
      // matchwa replies to the neutral phone jid OpenWA delivered on the webhook — the prior no-op case.
      expect(store.getEphemeralExpiration('5491169954736@c.us')).toBe(7776000);
      expect(store.getEphemeralExpiration('5491169954736@s.whatsapp.net')).toBe(7776000);
      expect(store.getEphemeralExpiration('41562515988583@lid')).toBe(7776000);
    });

    it('ignores a non-positive ephemeralDuration and never clears a known timer', () => {
      store.recordMessage({
        key: { remoteJid: '628111@s.whatsapp.net', fromMe: false, id: 'M1' },
        message: { conversation: 'hi' },
        messageTimestamp: 100,
        ephemeralDuration: 86400,
      });
      store.recordMessage({
        key: { remoteJid: '628111@s.whatsapp.net', fromMe: false, id: 'M2' },
        message: { conversation: 'later' },
        messageTimestamp: 200,
        ephemeralDuration: 0,
      });
      expect(store.getEphemeralExpiration('628111@s.whatsapp.net')).toBe(86400);
    });

    it('prefers the message-learned timer over a stale Chat.ephemeralExpiration', () => {
      store.upsertChats([{ id: '628111@s.whatsapp.net', ephemeralExpiration: 604800 }]);
      store.recordMessage({
        key: { remoteJid: '628111@s.whatsapp.net', fromMe: false, id: 'M1' },
        message: { conversation: 'hi' },
        messageTimestamp: 100,
        ephemeralDuration: 7776000,
      });
      expect(store.getEphemeralExpiration('628111@s.whatsapp.net')).toBe(7776000);
    });

    it('learns the timer from contextInfo.expiration when ephemeralDuration is absent (live 1:1)', () => {
      // WebMessageInfo.ephemeralDuration is empty on a live 1:1 upsert; the per-message expiration on the
      // content's contextInfo is the reliable source.
      store.recordMessage({
        key: { remoteJid: '628111@s.whatsapp.net', fromMe: false, id: 'M1' },
        message: { extendedTextMessage: { text: 'hi', contextInfo: { expiration: 7776000 } } },
        messageTimestamp: 100,
      });
      expect(store.getEphemeralExpiration('628111@s.whatsapp.net')).toBe(7776000);
    });

    it('unwraps an ephemeralMessage envelope to read contextInfo.expiration', () => {
      store.recordMessage({
        key: { remoteJid: '628111@s.whatsapp.net', fromMe: false, id: 'M2' },
        message: {
          ephemeralMessage: { message: { extendedTextMessage: { text: 'hi', contextInfo: { expiration: 86400 } } } },
        },
        messageTimestamp: 100,
      });
      expect(store.getEphemeralExpiration('628111@c.us')).toBe(86400);
    });
  });

  it('resolves a phone jid to its user-part, a lid via lidPnMappings, and a contact phoneNumber', () => {
    expect(store.resolvePhone('628111@s.whatsapp.net')).toBe('628111');
    store.addLidMappings([{ lid: '111@lid', pn: '628999@s.whatsapp.net' }]);
    expect(store.resolvePhone('111@lid')).toBe('628999');
    store.upsertContacts([{ id: '222@lid', phoneNumber: '628222@s.whatsapp.net' }]);
    expect(store.resolvePhone('222@lid')).toBe('628222');
    expect(store.resolvePhone('333@lid')).toBeNull();
  });

  it('returns the user-part of an already-neutral @c.us id (a resolved-lid sender arrives as @c.us)', () => {
    // Once inbound ids are canonicalized, a resolved lid reaches resolvePhone as <phone>@c.us. Without
    // this branch senderPhone regresses to null for exactly the case the feature exists to surface.
    expect(store.resolvePhone('628111@c.us')).toBe('628111');
    expect(store.resolvePhone('628111:5@c.us')).toBe('628111');
  });

  it('resolves a :device-suffixed lid via the device-stripped mapping', () => {
    store.addLidMappings([{ lid: '111@lid', pn: '628999@s.whatsapp.net' }]);
    expect(store.resolvePhone('111:7@lid')).toBe('628999');
  });

  describe('toNeutralChat contact-name resolution (#369)', () => {
    it('keeps the chat title when Baileys supplies one (it wins over the contact)', () => {
      store.upsertChats([{ id: '628111@s.whatsapp.net', name: 'Chat Title' }]);
      store.upsertContacts([{ id: '628111@s.whatsapp.net', name: 'Saved Name' }]);
      expect(store.listChats()[0].name).toBe('Chat Title');
    });

    it('falls back to the saved contact name for a titleless bare-number chat', () => {
      store.upsertChats([{ id: '628111@s.whatsapp.net' }]); // no chat title
      store.upsertContacts([{ id: '628111@s.whatsapp.net', name: 'Alice' }]);
      expect(store.listChats()[0].name).toBe('Alice');
    });

    it('resolves a saved name for a @lid chat via the lid->pn mapping', () => {
      store.upsertChats([{ id: '111@lid' }]); // titleless, lid-keyed
      store.addLidMappings([{ lid: '111@lid', pn: '628999@s.whatsapp.net' }]);
      store.upsertContacts([{ id: '628999@s.whatsapp.net', name: 'Carol' }]);
      expect(store.listChats()[0].name).toBe('Carol');
    });

    it('uses pushName (notify) when no saved/verified name exists', () => {
      store.upsertChats([{ id: '628222@s.whatsapp.net' }]);
      store.upsertContacts([{ id: '628222@s.whatsapp.net', notify: 'Dave' }]);
      expect(store.listChats()[0].name).toBe('Dave');
    });

    it('falls back to the raw user-part when nothing is known (last resort)', () => {
      store.upsertChats([{ id: '628333@s.whatsapp.net' }]);
      expect(store.listChats()[0].name).toBe('628333');
    });
  });

  describe('recordKeyLidMappings (#362)', () => {
    it('learns a lid->pn mapping from an inbound message key (remoteJid/remoteJidAlt)', () => {
      store.recordKeyLidMappings({ remoteJid: '111@lid', remoteJidAlt: '628999@s.whatsapp.net' });
      expect(store.resolvePhone('111@lid')).toBe('628999');
    });

    it('learns a group participant lid->pn mapping (participant/participantAlt)', () => {
      store.recordKeyLidMappings({ participant: '222@lid', participantAlt: '628222@s.whatsapp.net' });
      expect(store.resolvePhone('222@lid')).toBe('628222');
    });

    it('canonicalizes a @lid to <phone>@c.us once the key mapping is learned', () => {
      expect(store.toNeutralJid('111@lid')).toBe('111@lid'); // unknown yet
      store.recordKeyLidMappings({ remoteJid: '111@lid', remoteJidAlt: '628111@s.whatsapp.net' });
      expect(store.toNeutralJid('111@lid')).toBe('628111@c.us');
    });

    it('ignores a key with no lid/pn pair', () => {
      store.recordKeyLidMappings({});
      store.recordKeyLidMappings({ remoteJid: '333@lid' }); // lid without an Alt counterpart
      expect(store.resolvePhone('333@lid')).toBeNull();
    });
  });

  describe('toNeutralJid', () => {
    it('maps @s.whatsapp.net to @c.us and strips the device suffix', () => {
      expect(store.toNeutralJid('628111@s.whatsapp.net')).toBe('628111@c.us');
      expect(store.toNeutralJid('628111:12@s.whatsapp.net')).toBe('628111@c.us');
    });

    it('keeps groups as @g.us and passes status@broadcast / empty through', () => {
      expect(store.toNeutralJid('120363-456@g.us')).toBe('120363-456@g.us');
      expect(store.toNeutralJid('status@broadcast')).toBe('status@broadcast');
      expect(store.toNeutralJid('')).toBe('');
    });

    it('resolves a @lid to <phone>@c.us when known, else keeps the raw lid', () => {
      expect(store.toNeutralJid('111@lid')).toBe('111@lid'); // no mapping yet
      store.addLidMappings([{ lid: '111@lid', pn: '628999@s.whatsapp.net' }]);
      expect(store.toNeutralJid('111@lid')).toBe('628999@c.us');
    });

    it('is idempotent on an already-neutral @c.us id', () => {
      expect(store.toNeutralJid('628111@c.us')).toBe('628111@c.us');
    });
  });

  describe('neutral contact/chat ids (round-trip)', () => {
    it('emits @c.us listing ids and accepts a neutral id back on lookup', () => {
      store.upsertContacts([{ id: '628111@s.whatsapp.net', name: 'Alice' }]);
      store.upsertChats([{ id: '628111@s.whatsapp.net', name: 'Alice' }]);
      store.recordMessage({
        key: { remoteJid: '628111@s.whatsapp.net', fromMe: false, id: 'M1' },
        message: { conversation: 'hi' },
        messageTimestamp: 100,
      });
      // listing emits the neutral dialect
      expect(store.listContacts()[0].id).toBe('628111@c.us');
      expect(store.listChats()[0].id).toBe('628111@c.us');
      // and the read-back paths accept that same neutral id (folded to the engine dialect internally)
      expect(store.findContact('628111@c.us')?.id).toBe('628111@c.us');
      expect(store.lastMessage('628111@c.us')?.key.id).toBe('M1');
    });

    it('keeps group ids unchanged', () => {
      store.upsertChats([{ id: '120363-9@g.us', name: 'Team' }]);
      expect(store.listChats()[0].id).toBe('120363-9@g.us');
    });
  });

  describe('one preview per chat across id dialects', () => {
    const PHONE = '628111@s.whatsapp.net';
    const LID = '484848@lid';
    const msg = (remoteJid: string, id: string, ts: number, fromMe = false) => ({
      key: { remoteJid, fromMe, id },
      message: { conversation: id },
      messageTimestamp: ts,
    });

    it('files an own send addressed as @c.us under the chat Baileys keyed by phone', () => {
      store.upsertChats([{ id: PHONE, conversationTimestamp: 5 }]);
      store.recordMessage(msg('628111@c.us', 'OUT', 100, true));
      expect(store.listChats()).toEqual([
        expect.objectContaining({ id: '628111@c.us', timestamp: 100, lastMessage: 'OUT' }),
      ]);
      expect(store.lastMessage('628111@c.us')).toEqual(expect.objectContaining({ jid: PHONE }));
    });

    it('files a lid-addressed send under the phone-keyed chat once the mapping is known', () => {
      store.upsertChats([{ id: PHONE }]);
      store.addLidMappings([{ lid: LID, pn: PHONE }]);
      store.recordMessage(msg(LID, 'OUT', 100, true));
      expect(store.listChats()).toEqual([expect.objectContaining({ timestamp: 100, lastMessage: 'OUT' })]);
    });

    it('finds a lid-keyed chat from the @c.us id the listing publishes', () => {
      store.upsertChats([{ id: LID }]);
      store.recordKeyLidMappings({ remoteJid: LID, remoteJidAlt: PHONE });
      store.recordMessage(msg(LID, 'IN', 100));
      expect(store.listChats()[0].id).toBe('628111@c.us');
      expect(store.lastMessage('628111@c.us')).toEqual({
        key: { remoteJid: LID, fromMe: false, id: 'IN' },
        timestamp: 100,
        jid: LID,
      });
      store.recordMessageEdit('628111@c.us', 'IN', 'edited');
      expect(store.listChats()[0].lastMessage).toBe('edited');
    });

    it('finds the lid twin through the persisted table as well', () => {
      const lidStore = {
        getCached: jest.fn(() => undefined),
        resolveLid: jest.fn(() => null),
        lidsForPhone: jest.fn((phone: string) => (phone === '628111' ? ['484848'] : [])),
        remember: jest.fn(() => Promise.resolve()),
      };
      const s = new BaileysSessionStore(lidStore, 'sess-1');
      s.upsertChats([{ id: LID }]);
      s.recordMessage(msg(LID, 'IN', 100));
      expect(s.lastMessage('628111@c.us')?.jid).toBe(LID);
    });

    it('keeps one entry when a chat with no record yet is addressed in both dialects', () => {
      store.recordMessage(msg('628111@c.us', 'OUT', 100, true));
      store.recordKeyLidMappings({ remoteJid: LID, remoteJidAlt: PHONE });
      store.recordMessage(msg(LID, 'IN', 200));
      expect(store.lastMessage('628111@c.us')?.key.id).toBe('IN');
      expect(store.lastMessage(LID)?.key.id).toBe('IN');
    });

    it('still finds a message filed under the lid before the mapping to the phone chat was learned', () => {
      store.upsertChats([{ id: PHONE }]);
      store.recordMessage(msg(LID, 'IN', 100));
      store.addLidMappings([{ lid: LID, pn: PHONE }]);
      for (const id of [LID, '628111@c.us']) {
        expect(store.lastMessage(id)).toEqual({
          key: { remoteJid: LID, fromMe: false, id: 'IN' },
          timestamp: 100,
          jid: PHONE,
        });
      }
    });

    it('prefers the newest message across twins over an older one under the chat key', () => {
      store.upsertChats([{ id: PHONE }]);
      store.recordMessage(msg(PHONE, 'OUT', 100, true));
      store.recordMessage(msg(LID, 'IN', 200));
      store.addLidMappings([{ lid: LID, pn: PHONE }]);
      expect(store.lastMessage('628111@c.us')).toEqual(expect.objectContaining({ timestamp: 200, jid: PHONE }));
    });
  });

  describe('persistent lid->phone table', () => {
    const makeFakeLidStore = () => {
      const map = new Map<string, string | null>();
      return {
        map,
        getCached: jest.fn((lid: string) => map.get(lid)),
        lidsForPhone: jest.fn(() => [] as string[]),
        remember: jest.fn((lid: string, phone: string | null) => {
          map.set(lid, phone);
          return Promise.resolve();
        }),
      };
    };

    it('writes learned mappings through to the table (bare digits + session provenance)', () => {
      const lidStore = makeFakeLidStore();
      const s = new BaileysSessionStore(lidStore, 'sess-1');
      s.addLidMappings([{ lid: '111@lid', pn: '628999@s.whatsapp.net' }]);
      s.upsertContacts([{ id: '222@lid', lid: '222@lid', phoneNumber: '628222@s.whatsapp.net' }]);
      s.upsertContacts([{ id: '333@lid', lid: '333@lid', phoneNumber: '628333@s.whatsapp.net' }]);
      expect(lidStore.remember).toHaveBeenCalledWith('111', '628999', 'sess-1');
      expect(lidStore.remember).toHaveBeenCalledWith('222', '628222', 'sess-1');
      expect(lidStore.remember).toHaveBeenCalledWith('333', '628333', 'sess-1');
    });

    it('pairs a lid and phone that arrive in separate contact updates', () => {
      const lidStore = makeFakeLidStore();
      const s = new BaileysSessionStore(lidStore, 'sess-1');
      s.upsertContacts([{ id: 'c1', lid: '444@lid' }]); // lid first, no phone yet
      expect(lidStore.remember).not.toHaveBeenCalled();
      s.upsertContacts([{ id: 'c1', phoneNumber: '628444@s.whatsapp.net' }]); // phone arrives later
      expect(lidStore.remember).toHaveBeenCalledWith('444', '628444', 'sess-1');
    });

    it('resolves a lid via the persistent cache when the in-session map misses', () => {
      const lidStore = makeFakeLidStore();
      lidStore.map.set('444', '628777'); // known only to the cross-session table
      const s = new BaileysSessionStore(lidStore, 'sess-1');
      expect(s.resolvePhone('444@lid')).toBe('628777');
      expect(s.toNeutralJid('444@lid')).toBe('628777@c.us');
    });

    it('returns null for a cached-negative or unseen lid', () => {
      const lidStore = makeFakeLidStore();
      lidStore.map.set('555', null); // known-but-unresolved
      const s = new BaileysSessionStore(lidStore, 'sess-1');
      expect(s.resolvePhone('555@lid')).toBeNull();
      expect(s.resolvePhone('666@lid')).toBeNull();
    });
  });

  describe('map bounds (BAILEYS_SESSION_STORE_MAX_ENTRIES)', () => {
    const ENV = 'BAILEYS_SESSION_STORE_MAX_ENTRIES';
    const orig = process.env[ENV];
    afterEach(() => {
      if (orig === undefined) delete process.env[ENV];
      else process.env[ENV] = orig;
    });

    const storeWithCap = (cap: string, lidStore?: LidMappingStore) => {
      process.env[ENV] = cap;
      return new BaileysSessionStore(lidStore);
    };

    it('evicts the oldest contact once over the cap; the miss reads as "unknown"', () => {
      const s = storeWithCap('2');
      s.upsertContacts([{ id: '628111@s.whatsapp.net', name: 'A' }]);
      s.upsertContacts([{ id: '628222@s.whatsapp.net', name: 'B' }]);
      s.upsertContacts([{ id: '628333@s.whatsapp.net', name: 'C' }]);
      expect(s.listContacts()).toHaveLength(2);
      expect(s.findContact('628111@s.whatsapp.net')).toBeNull(); // evicted — same as never seen
      expect(s.findContact('628222@s.whatsapp.net')?.name).toBe('B');
      expect(s.findContact('628333@s.whatsapp.net')?.name).toBe('C');
    });

    it('treats a read as usage: a refreshed entry survives while a stale one is evicted (LRU)', () => {
      const s = storeWithCap('2');
      s.upsertContacts([{ id: '628111@s.whatsapp.net', name: 'A' }]);
      s.upsertContacts([{ id: '628222@s.whatsapp.net', name: 'B' }]);
      expect(s.findContact('628111@s.whatsapp.net')?.name).toBe('A'); // refresh A
      s.upsertContacts([{ id: '628333@s.whatsapp.net', name: 'C' }]); // evicts B, not A
      expect(s.findContact('628111@s.whatsapp.net')?.name).toBe('A');
      expect(s.findContact('628222@s.whatsapp.net')).toBeNull();
    });

    it('bounds chats: listChats stays at the cap and drops the oldest conversation', () => {
      const s = storeWithCap('2');
      s.upsertChats([{ id: '628111@s.whatsapp.net', name: 'A' }]);
      s.upsertChats([{ id: '628222@s.whatsapp.net', name: 'B' }]);
      s.upsertChats([{ id: '628333@s.whatsapp.net', name: 'C' }]);
      expect(s.listChats().map(c => c.id)).toEqual(['628222@c.us', '628333@c.us']);
    });

    it('bounds lastMessages: an evicted preview reads as the null miss callers already handle', () => {
      const s = storeWithCap('2');
      for (const [i, ts] of [
        ['628111', 100],
        ['628222', 200],
        ['628333', 300],
      ] as const) {
        s.recordMessage({
          key: { remoteJid: `${i}@s.whatsapp.net`, fromMe: false, id: `M-${i}` },
          message: { conversation: 'hi' },
          messageTimestamp: ts,
        });
      }
      expect(s.lastMessage('628111@s.whatsapp.net')).toBeNull(); // sendSeen/markUnread/deleteChat → false
      expect(s.lastMessage('628333@s.whatsapp.net')?.key.id).toBe('M-628333');
    });

    it('bounds lidToPn: an evicted mapping still resolves via the write-through persistent table', () => {
      const map = new Map<string, string | null>();
      const lidStore = {
        getCached: jest.fn((lid: string) => map.get(lid)),
        lidsForPhone: jest.fn(() => [] as string[]),
        remember: jest.fn((lid: string, phone: string | null) => {
          map.set(lid, phone);
          return Promise.resolve();
        }),
      };
      const s = storeWithCap('2', lidStore);
      s.addLidMappings([
        { lid: '111@lid', pn: '628111@s.whatsapp.net' },
        { lid: '222@lid', pn: '628222@s.whatsapp.net' },
        { lid: '333@lid', pn: '628333@s.whatsapp.net' },
      ]);
      // 111 was evicted from memory: resolution falls through to the persisted row (getCached hit).
      expect(s.resolvePhone('111@lid')).toBe('628111');
      expect(lidStore.getCached).toHaveBeenCalledWith('111');
      // 333 is still in memory: no persistent-table read needed.
      expect(s.resolvePhone('333@lid')).toBe('628333');
      expect(lidStore.getCached).not.toHaveBeenCalledWith('333');
    });

    it('bounds ephemeralByChat (two keys per chat): the oldest chat timer falls back to undefined', () => {
      const s = storeWithCap('2'); // timer map allows 2 × cap = 4 keys → two chats
      for (const i of ['628111', '628222', '628333']) {
        s.recordMessage({
          key: { remoteJid: `${i}@s.whatsapp.net`, fromMe: false, id: `M-${i}` },
          message: { conversation: 'hi' },
          messageTimestamp: 100,
          ephemeralDuration: 86400,
        });
      }
      expect(s.getEphemeralExpiration('628111@s.whatsapp.net')).toBeUndefined(); // evicted → no forced timer
      expect(s.getEphemeralExpiration('628222@s.whatsapp.net')).toBe(86400);
      expect(s.getEphemeralExpiration('628333@s.whatsapp.net')).toBe(86400);
    });

    it('treats 0 as unbounded (legacy behaviour)', () => {
      const s = storeWithCap('0');
      for (let i = 0; i < 100; i++) {
        s.upsertContacts([{ id: `62${1000 + i}@s.whatsapp.net`, name: 'x' }]);
      }
      expect(s.listContacts()).toHaveLength(100);
    });

    it('falls back to the 5000 default for a garbage override', () => {
      const s = storeWithCap('not-a-number');
      s.upsertContacts(Array.from({ length: 5001 }, (_, i) => ({ id: `62${100000 + i}@s.whatsapp.net`, name: 'x' })));
      expect(s.listContacts()).toHaveLength(5000);
      expect(s.findContact('62100000@s.whatsapp.net')).toBeNull(); // the oldest went first
      expect(s.findContact('62105000@s.whatsapp.net')).not.toBeNull();
    });

    it('treats a blank override as unset, not as 0 (unbounded)', () => {
      const s = storeWithCap('');
      s.upsertContacts(Array.from({ length: 5001 }, (_, i) => ({ id: `62${100000 + i}@s.whatsapp.net`, name: 'x' })));
      expect(s.listContacts()).toHaveLength(5000);
    });
  });

  describe('chat state (mute/archive/pin) persistence', () => {
    type StateValue = { muteEndTime: number | null; archived: boolean; pinned: boolean };
    const FIELDS = ['muteEndTime', 'archived', 'pinned'] as const;
    const DEFAULTS: StateValue = { muteEndTime: null, archived: false, pinned: false };

    /** A faithful in-memory ChatStateStore: remember/fold keep `observed` and honour `create`. */
    const fakeStore = () => {
      const states = new Map<string, ChatStateValue>();
      let clock = 0;
      const write = (
        sessionId: string,
        chatId: string,
        base: ChatStateValue | undefined,
        patch: Partial<StateValue>,
        create: boolean,
      ) => {
        const hasRow = base !== undefined;
        const isDefaultsOnly = FIELDS.every(f => !(f in patch) || patch[f] === DEFAULTS[f]);
        if (!hasRow && !create && isDefaultsOnly) return;
        const observed = new Set([...(base?.observed ?? []), ...FIELDS.filter(f => f in patch)]);
        states.set(`${sessionId} ${chatId}`, {
          ...DEFAULTS,
          ...base,
          ...patch,
          observed: [...observed],
          updatedAt: ++clock,
        });
      };
      return {
        get: jest.fn((sessionId: string, chatId: string) => states.get(`${sessionId} ${chatId}`)),
        chatIds: jest.fn((sessionId: string) =>
          [...states.keys()].filter(k => k.startsWith(`${sessionId} `)).map(k => k.slice(sessionId.length + 1)),
        ),
        remember: jest.fn((sessionId: string, chatId: string, patch: Partial<StateValue>, create: boolean = true) => {
          write(sessionId, chatId, states.get(`${sessionId} ${chatId}`), patch, create);
          return Promise.resolve();
        }),
        fold: jest.fn(
          (sessionId: string, chatId: string, twins: string[], patch: Partial<StateValue>, create: boolean = true) => {
            const rows = [chatId, ...twins].flatMap(k => states.get(`${sessionId} ${k}`) ?? []);
            write(sessionId, chatId, mergeTwinStates(rows), patch, create);
            for (const t of twins) states.delete(`${sessionId} ${t}`);
            return Promise.resolve();
          },
        ),
        reload: jest.fn().mockResolvedValue(undefined),
        clearSession: jest.fn().mockResolvedValue(undefined),
        forget: jest.fn().mockResolvedValue(undefined),
        refreshSession: jest.fn().mockResolvedValue(undefined),
        states,
      };
    };

    it('writes archived/pinned/muteEndTime through to the store when a live update carries them', () => {
      const chatStateStore = fakeStore();
      const s = new BaileysSessionStore(undefined, 'sess-1', chatStateStore);
      // pinned is Baileys' raw wire type: a truthy order number, not a boolean (see toNeutralChat).
      s.upsertChats([{ id: '628111@s.whatsapp.net', archived: true, pinned: 1, muteEndTime: 1800000000000 }]);
      expect(chatStateStore.remember).toHaveBeenCalledWith(
        'sess-1',
        '628111@s.whatsapp.net',
        { archived: true, pinned: true, muteEndTime: 1800000000000 },
        true,
      );
    });

    it('does not write keys the update omits (a name-only hydration must not reset mute/archive/pin)', () => {
      const chatStateStore = fakeStore();
      const s = new BaileysSessionStore(undefined, 'sess-1', chatStateStore);
      s.upsertChats([{ id: '628111@s.whatsapp.net', name: 'Alice' }]);
      expect(chatStateStore.remember).not.toHaveBeenCalled();
    });

    it('a live unmute (muteEndTime: null, key present) persists as null, not skipped', () => {
      const chatStateStore = fakeStore();
      const s = new BaileysSessionStore(undefined, 'sess-1', chatStateStore);
      s.upsertChats([{ id: '628111@s.whatsapp.net', muteEndTime: null }]);
      expect(chatStateStore.remember).toHaveBeenCalledWith(
        'sess-1',
        '628111@s.whatsapp.net',
        { muteEndTime: null },
        true,
      );
    });

    it('toNeutralChat prefers the persisted store state over the live record', () => {
      const chatStateStore = fakeStore();
      const s = new BaileysSessionStore(undefined, 'sess-1', chatStateStore);
      // Live record says unarchived/unpinned/unmuted...
      s.upsertChats([{ id: '628111@s.whatsapp.net', name: 'Alice', archived: false, pinned: 0 }]);
      // ...but the persisted store (survived a reconnect Baileys couldn't resync) says otherwise.
      chatStateStore.states.set('sess-1 628111@s.whatsapp.net', {
        muteEndTime: 4102444800000, // far future
        archived: true,
        pinned: true,
      });
      const [summary] = s.listChats();
      expect(summary).toMatchObject({ archived: true, pinned: true, muted: true, muteExpiration: 4102444800000 });
    });

    it('normalises a history-sync epoch-SECONDS muteEndTime to epoch-MILLISECONDS for isMuted/muteExpiration', () => {
      const s = new BaileysSessionStore();
      const futureSeconds = Math.floor(Date.now() / 1000) + 3600; // 1h from now, in seconds
      s.upsertChats([{ id: '628111@s.whatsapp.net', muteEndTime: futureSeconds }]);
      const [summary] = s.listChats();
      expect(summary.muted).toBe(true);
      expect(summary.muteExpiration).toBe(futureSeconds * 1000);
    });

    it('a past muteEndTime reports muted:false and muteExpiration:undefined', () => {
      const s = new BaileysSessionStore();
      s.upsertChats([{ id: '628111@s.whatsapp.net', muteEndTime: 1000 }]); // epoch ms, long past
      const [summary] = s.listChats();
      expect(summary.muted).toBe(false);
      expect(summary.muteExpiration).toBeUndefined();
    });

    it('reads a mute set to Always (WhatsApp sends muteEndTime -1) as muted indefinitely', () => {
      const s = new BaileysSessionStore();
      s.upsertChats([{ id: '628111@s.whatsapp.net', muteEndTime: -1 }]);
      expect(s.listChats()[0]).toMatchObject({ muted: true, muteExpiration: 0 });
    });

    it('persists a mute set to Always as -1 and reads it back as muted indefinitely', () => {
      const chatStateStore = fakeStore();
      const s = new BaileysSessionStore(undefined, 'sess-1', chatStateStore);
      s.upsertChats([{ id: '628111@s.whatsapp.net', muteEndTime: -1 }]);
      expect(chatStateStore.states.get('sess-1 628111@s.whatsapp.net')?.muteEndTime).toBe(-1);
      expect(s.listChats()[0]).toMatchObject({ muted: true, muteExpiration: 0 });
    });

    it('reads a mute Always persisted as -1000 by an earlier version as muted indefinitely', () => {
      const chatStateStore = fakeStore();
      const s = new BaileysSessionStore(undefined, 'sess-1', chatStateStore);
      s.upsertChats([{ id: '628111@s.whatsapp.net', name: 'Alice' }]);
      chatStateStore.states.set('sess-1 628111@s.whatsapp.net', { muteEndTime: -1000, archived: false, pinned: false });
      expect(s.listChats()[0]).toMatchObject({ muted: true, muteExpiration: 0 });
    });

    it('does not read the prototype defaults of a decoded history chunk as a reset of the state', () => {
      // History sync hands over proto.Conversation instances whose prototype defaults these fields to null.
      class DecodedConversation {
        constructor(public id: string) {}
      }
      Object.assign(DecodedConversation.prototype, { archived: null, pinned: null, muteEndTime: null });
      const chatStateStore = fakeStore();
      const s = new BaileysSessionStore(undefined, 'sess-1', chatStateStore);
      s.upsertChats([new DecodedConversation('628111@s.whatsapp.net')]);
      expect(chatStateStore.remember).not.toHaveBeenCalled();
    });

    it('lists a chat that only has a saved state, right after a restart', () => {
      const chatStateStore = fakeStore();
      chatStateStore.states.set('sess-1 628111@s.whatsapp.net', {
        muteEndTime: null,
        archived: false,
        pinned: true,
        observed: ['pinned'],
        updatedAt: 1,
      });
      const s = new BaileysSessionStore(undefined, 'sess-1', chatStateStore);
      expect(s.listChats()).toEqual([expect.objectContaining({ id: '628111@c.us', pinned: true })]);
    });

    describe('a lid-migrated contact (state synced under the lid, record keyed by phone)', () => {
      const PHONE = '628111@s.whatsapp.net';
      const LID = '484848@lid';
      const SID = 'sess-1';
      const lidStore = {
        getCached: jest.fn(() => undefined),
        resolveLid: jest.fn(() => null),
        lidsForPhone: jest.fn((phone: string) => (phone === '628111' ? ['484848'] : [])),
        remember: jest.fn(() => Promise.resolve()),
      };
      const stateFor = (chatStateStore: ReturnType<typeof fakeStore>) => {
        const s = new BaileysSessionStore(lidStore, SID, chatStateStore);
        s.addLidMappings([{ lid: LID, pn: PHONE }]);
        return s;
      };

      it('lists the conversation once, with the pin and mute held under the lid row', () => {
        const chatStateStore = fakeStore();
        chatStateStore.states.set(`${SID} ${LID}`, {
          muteEndTime: 4102444800000,
          archived: false,
          pinned: true,
          observed: ['muteEndTime', 'pinned'],
          updatedAt: 1,
        });
        const s = stateFor(chatStateStore);
        s.upsertChats([{ id: PHONE, name: 'Alice' }]);
        s.upsertChats([{ id: LID }]);
        expect(s.listChats()).toEqual([
          expect.objectContaining({ id: '628111@c.us', name: 'Alice', pinned: true, muted: true }),
        ]);
      });

      it('files a state update the lid carried under the phone jid and folds the lid row onto it', () => {
        const chatStateStore = fakeStore();
        chatStateStore.states.set(`${SID} ${LID}`, {
          muteEndTime: 4102444800000,
          archived: false,
          pinned: false,
          observed: ['muteEndTime'],
          updatedAt: 1,
        });
        const s = stateFor(chatStateStore);
        s.upsertChats([{ id: LID, pinned: 1 }]);
        expect(chatStateStore.fold).toHaveBeenCalledWith(SID, PHONE, [LID], { pinned: true }, true);
        expect(chatStateStore.states.has(`${SID} ${LID}`)).toBe(false);
        expect(chatStateStore.states.get(`${SID} ${PHONE}`)).toMatchObject({
          muteEndTime: 4102444800000,
          pinned: true,
        });
      });

      it('keeps a newer unpin from being overturned by an older pin on the lid row', () => {
        const chatStateStore = fakeStore();
        chatStateStore.states.set(`${SID} ${LID}`, {
          muteEndTime: null,
          archived: false,
          pinned: true,
          observed: ['pinned'],
          updatedAt: 1,
        });
        chatStateStore.states.set(`${SID} ${PHONE}`, {
          muteEndTime: null,
          archived: false,
          pinned: false,
          observed: ['pinned'],
          updatedAt: 2,
        });
        const s = stateFor(chatStateStore);
        s.upsertChats([{ id: PHONE }]);
        expect(s.listChats()[0]).toMatchObject({ pinned: false });
      });

      it('keys a lid update by the lid while the mapping is unknown', () => {
        const chatStateStore = fakeStore();
        const s = new BaileysSessionStore(undefined, SID, chatStateStore);
        s.upsertChats([{ id: LID, pinned: 1 }]);
        expect(chatStateStore.remember).toHaveBeenCalledWith(SID, LID, { pinned: true }, true);
      });

      it('creates no row for the unarchive a message carries on a chat that has none', () => {
        const chatStateStore = fakeStore();
        const s = stateFor(chatStateStore);
        s.upsertChats([{ id: PHONE, archived: false, unreadCount: 1 }]);
        expect(chatStateStore.states.size).toBe(0);
        s.upsertChats([{ id: PHONE, archived: false }]);
        expect(chatStateStore.states.get(`${SID} ${PHONE}`)).toMatchObject({ archived: false });
      });
    });

    it('is a no-op when no chatStateStore or sessionId is wired (unit tests, wwjs)', () => {
      const s = new BaileysSessionStore(); // no lidStore, no sessionId, no chatStateStore
      expect(() => s.upsertChats([{ id: '628111@s.whatsapp.net', archived: true }])).not.toThrow();
      const [summary] = s.listChats();
      expect(summary.archived).toBe(true); // still reflects the live record
    });
  });
});
