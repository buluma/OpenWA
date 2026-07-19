import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `baileys_stored_chats` and `baileys_stored_contacts` — persisted Baileys chat/contact
 * state backing the Chats/Contacts lists across a process restart (SHA-85). CASCADE-deleted with
 * their session. Hand-authored because `synchronize` is off for the `data` connection on Postgres
 * (and optional on SQLite), mirroring `AddBaileysStoredMessages1781000000000`.
 */
export class AddBaileysStoredChatsContacts1782500000000 implements MigrationInterface {
  name = 'AddBaileysStoredChatsContacts1782500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.connection.options.type === 'postgres';

    if (!(await queryRunner.hasTable('baileys_stored_chats'))) {
      if (isPostgres) {
        await queryRunner.query(
          `CREATE TABLE "baileys_stored_chats" ("id" varchar PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::varchar, "sessionId" varchar NOT NULL, "waId" varchar NOT NULL, "serializedChat" text NOT NULL, "updatedAt" timestamp NOT NULL DEFAULT NOW(), CONSTRAINT "FK_baileys_stored_chats_sessionId" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
        );
      } else {
        await queryRunner.query(
          `CREATE TABLE "baileys_stored_chats" ("id" varchar PRIMARY KEY NOT NULL, "sessionId" varchar NOT NULL, "waId" varchar NOT NULL, "serializedChat" text NOT NULL, "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "FK_baileys_stored_chats_sessionId" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
        );
      }
      await queryRunner.query(
        `CREATE UNIQUE INDEX "UQ_baileys_stored_chats_session_waid" ON "baileys_stored_chats" ("sessionId", "waId")`,
      );
    }

    if (!(await queryRunner.hasTable('baileys_stored_contacts'))) {
      if (isPostgres) {
        await queryRunner.query(
          `CREATE TABLE "baileys_stored_contacts" ("id" varchar PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::varchar, "sessionId" varchar NOT NULL, "waId" varchar NOT NULL, "serializedContact" text NOT NULL, "updatedAt" timestamp NOT NULL DEFAULT NOW(), CONSTRAINT "FK_baileys_stored_contacts_sessionId" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
        );
      } else {
        await queryRunner.query(
          `CREATE TABLE "baileys_stored_contacts" ("id" varchar PRIMARY KEY NOT NULL, "sessionId" varchar NOT NULL, "waId" varchar NOT NULL, "serializedContact" text NOT NULL, "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "FK_baileys_stored_contacts_sessionId" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
        );
      }
      await queryRunner.query(
        `CREATE UNIQUE INDEX "UQ_baileys_stored_contacts_session_waid" ON "baileys_stored_contacts" ("sessionId", "waId")`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // IF EXISTS so revert is idempotent on a synchronize-bootstrapped DB, where this migration was
    // recorded via the up() hasTable early-return and the named indexes were never created.
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_baileys_stored_contacts_session_waid"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "baileys_stored_contacts"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_baileys_stored_chats_session_waid"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "baileys_stored_chats"`);
  }
}
