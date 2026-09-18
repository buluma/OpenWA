import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `chat_states` - persisted per-session Baileys chat mute/archive/pin app-state on the `data`
 * connection, keyed by (sessionId, chatId). Baileys cannot re-deliver these on a reconnect (history
 * sync is skipped once paired and it keeps no queryable copy), so {@link BaileysChatStateStoreService}
 * persists and rehydrates them here.
 *
 * Hand-authored (not `migration:generate`) because the dev SQLite DB in this worktree already carries
 * pre-existing schema drift on unrelated tables (webhooks/sessions/message_batches/
 * baileys_stored_messages/templates/lid_mappings) — confirmed by running a dry-run generate WITHOUT
 * this entity registered, which reproduced the identical multi-table rebuild cascade. Hand-authoring
 * keeps this migration scoped to `chat_states` only, matching the repo's convention for recent
 * additions (e.g. `CreateStatusUpdates`, `AddLidMappings`). Idempotent + cross-dialect.
 */
export class AddChatStates1789748519372 implements MigrationInterface {
  name = 'AddChatStates1789748519372';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('chat_states')) return;
    const isPostgres = queryRunner.dataSource.options.type === 'postgres';
    const boolFalse = isPostgres ? 'false' : '0';
    const updatedAtColumn = isPostgres
      ? `"updatedAt" timestamp NOT NULL DEFAULT NOW()`
      : `"updatedAt" datetime NOT NULL DEFAULT (datetime('now'))`;

    await queryRunner.query(
      `CREATE TABLE "chat_states" (` +
        `"sessionId" varchar NOT NULL, "chatId" varchar NOT NULL, "muteEndTime" bigint, ` +
        `"archived" boolean NOT NULL DEFAULT ${boolFalse}, "pinned" boolean NOT NULL DEFAULT ${boolFalse}, ` +
        `${updatedAtColumn}, PRIMARY KEY ("sessionId", "chatId"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_states"`);
  }
}
