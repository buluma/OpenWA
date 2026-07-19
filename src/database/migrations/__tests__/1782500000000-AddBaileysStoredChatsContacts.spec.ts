import { DataSource } from 'typeorm';
import { AddBaileysStoredChatsContacts1782500000000 } from '../1782500000000-AddBaileysStoredChatsContacts';

describe('AddBaileysStoredChatsContacts migration', () => {
  let ds: DataSource;

  beforeEach(async () => {
    // A `sessions` table must exist for the FK; create a minimal stand-in.
    ds = new DataSource({ type: 'sqlite', database: ':memory:' });
    await ds.initialize();
    await ds.query(`CREATE TABLE "sessions" ("id" varchar PRIMARY KEY NOT NULL)`);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('creates and drops both tables + indexes', async () => {
    const runner = ds.createQueryRunner();
    const migration = new AddBaileysStoredChatsContacts1782500000000();

    await migration.up(runner);
    expect(await runner.hasTable('baileys_stored_chats')).toBe(true);
    expect(await runner.hasTable('baileys_stored_contacts')).toBe(true);

    await migration.down(runner);
    expect(await runner.hasTable('baileys_stored_chats')).toBe(false);
    expect(await runner.hasTable('baileys_stored_contacts')).toBe(false);

    await runner.release();
  });

  it('up() is idempotent when a table already exists', async () => {
    const runner = ds.createQueryRunner();
    const migration = new AddBaileysStoredChatsContacts1782500000000();
    await migration.up(runner);
    await expect(migration.up(runner)).resolves.toBeUndefined();
    await runner.release();
  });

  it('down() does not throw when the named indexes were never created (synchronize-bootstrapped DB)', async () => {
    const runner = ds.createQueryRunner();
    // No up(): the named indexes never existed (a synchronize-built schema uses hash-named ones).
    await expect(new AddBaileysStoredChatsContacts1782500000000().down(runner)).resolves.toBeUndefined();
    await runner.release();
  });
});
