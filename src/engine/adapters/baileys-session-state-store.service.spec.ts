import { DataSource, Repository } from 'typeorm';
import { BaileysStoredChat } from './baileys-stored-chat.entity';
import { BaileysStoredContact } from './baileys-stored-contact.entity';
import { BaileysSessionStateStoreService } from './baileys-session-state-store.service';
import { Session, SessionStatus } from '../../modules/session/entities/session.entity';

describe('BaileysSessionStateStoreService', () => {
  let ds: DataSource;
  let chatRepo: Repository<BaileysStoredChat>;
  let contactRepo: Repository<BaileysStoredContact>;
  let service: BaileysSessionStateStoreService;

  const seedSession = async (id: string): Promise<void> => {
    await ds.getRepository(Session).save(
      ds.getRepository(Session).create({
        id,
        name: `session-${id}`,
        status: SessionStatus.READY,
        phone: null,
        pushName: null,
        config: {},
        proxyUrl: null,
        proxyType: null,
        connectedAt: null,
        lastActiveAt: null,
      }),
    );
  };

  beforeEach(async () => {
    ds = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: [BaileysStoredChat, BaileysStoredContact, Session],
      synchronize: true,
    });
    await ds.initialize();
    chatRepo = ds.getRepository(BaileysStoredChat);
    contactRepo = ds.getRepository(BaileysStoredContact);
    service = new BaileysSessionStateStoreService(chatRepo, contactRepo);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  describe('chats', () => {
    it('round-trips a batch of chats', async () => {
      await seedSession('s1');
      await service.saveChats('s1', [
        { id: '1@s.whatsapp.net', name: 'Alice' },
        { id: '2@g.us', name: 'Group' },
      ]);
      const loaded = await service.loadChats('s1');
      expect(loaded).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: '1@s.whatsapp.net', name: 'Alice' }),
          expect.objectContaining({ id: '2@g.us', name: 'Group' }),
        ]),
      );
      expect(loaded).toHaveLength(2);
    });

    it('is idempotent per (sessionId, id) and merges on re-save (upsert, not append)', async () => {
      await seedSession('s1');
      await service.saveChats('s1', [{ id: '1@s.whatsapp.net', name: 'Old Name' }]);
      await service.saveChats('s1', [{ id: '1@s.whatsapp.net', name: 'New Name' }]);
      const loaded = await service.loadChats('s1');
      expect(loaded).toHaveLength(1);
      expect(loaded[0].name).toBe('New Name');
    });

    it('skips entries with no id', async () => {
      await seedSession('s1');
      await service.saveChats('s1', [{ name: 'No id' }]);
      expect(await service.loadChats('s1')).toEqual([]);
    });

    it('no-ops on an empty array', async () => {
      await seedSession('s1');
      await expect(service.saveChats('s1', [])).resolves.toBeUndefined();
      expect(await chatRepo.count()).toBe(0);
    });

    it('is session-scoped', async () => {
      await seedSession('s1');
      await seedSession('s2');
      await service.saveChats('s1', [{ id: '1@s.whatsapp.net' }]);
      expect(await service.loadChats('s2')).toEqual([]);
    });
  });

  describe('contacts', () => {
    it('round-trips a batch of contacts', async () => {
      await seedSession('s1');
      await service.saveContacts('s1', [{ id: '1@s.whatsapp.net', name: 'Ada' }]);
      const loaded = await service.loadContacts('s1');
      expect(loaded).toEqual([expect.objectContaining({ id: '1@s.whatsapp.net', name: 'Ada' })]);
    });

    it('no-ops on an empty array', async () => {
      await seedSession('s1');
      await expect(service.saveContacts('s1', [])).resolves.toBeUndefined();
      expect(await contactRepo.count()).toBe(0);
    });
  });

  // Mirrors BaileysMessageStoreService's #319 handling — an orphaned adapter (its session was
  // deleted/recreated during reconnect churn) keeps emitting chats/contacts events under a
  // sessionId with no parent row. The FK must not throw on every batch.
  it('skips persisting (no throw) when the parent session row is absent (orphaned adapter)', async () => {
    await ds.query('PRAGMA foreign_keys = ON');
    await expect(service.saveChats('orphan', [{ id: '1@s.whatsapp.net' }])).resolves.toBeUndefined();
    await expect(service.saveContacts('orphan', [{ id: '1@s.whatsapp.net' }])).resolves.toBeUndefined();
    expect(await chatRepo.count({ where: { sessionId: 'orphan' } })).toBe(0);
    expect(await contactRepo.count({ where: { sessionId: 'orphan' } })).toBe(0);
  });

  it('still rethrows a non-FK persistence error (does not swallow real failures)', async () => {
    await seedSession('s1');
    const boom = Object.assign(new Error('disk full'), { code: 'SQLITE_FULL' });
    jest.spyOn(chatRepo, 'upsert').mockRejectedValueOnce(boom);
    await expect(service.saveChats('s1', [{ id: '1@s.whatsapp.net' }])).rejects.toThrow('disk full');
  });

  it('clearSession removes only that session, both chats and contacts', async () => {
    await seedSession('s1');
    await seedSession('s2');
    await service.saveChats('s1', [{ id: 'c1@s.whatsapp.net' }]);
    await service.saveChats('s2', [{ id: 'c2@s.whatsapp.net' }]);
    await service.saveContacts('s1', [{ id: 'c1@s.whatsapp.net' }]);
    await service.saveContacts('s2', [{ id: 'c2@s.whatsapp.net' }]);

    await service.clearSession('s1');

    expect(await service.loadChats('s1')).toEqual([]);
    expect(await service.loadContacts('s1')).toEqual([]);
    expect(await service.loadChats('s2')).toHaveLength(1);
    expect(await service.loadContacts('s2')).toHaveLength(1);
  });
});
