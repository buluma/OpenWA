import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `automation_rules` table: single-message autoreply rules, evaluated against inbound
 * messages, matching the webhook filter shape (see `AutomationRule` entity).
 *
 * Hand-authored, not `migration:generate` — this worktree's freshly-migrated DB already carries the
 * pre-existing index-naming drift on unrelated tables (webhooks/sessions/message_batches/
 * baileys_stored_messages/templates/lid_mappings) that `CreateStatusUpdates1784822470680` and
 * `AddTemplates1779840000000` document and route around the same way. Hand-authoring keeps this
 * migration scoped to `automation_rules` only. Idempotent + cross-dialect.
 */
export class AddAutomationRules1789747962102 implements MigrationInterface {
  name = 'AddAutomationRules1789747962102';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.dataSource.options.type === 'postgres';

    const exists = await queryRunner.hasTable('automation_rules');
    if (exists) return;

    if (isPostgres) {
      await queryRunner.query(
        `CREATE TABLE "automation_rules" (` +
          `"id" varchar PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::varchar, "sessionId" varchar NOT NULL, ` +
          `"name" varchar(100) NOT NULL, "enabled" boolean NOT NULL DEFAULT true, "conditions" text, ` +
          `"replyText" text NOT NULL, "cooldownSeconds" integer NOT NULL DEFAULT 60, ` +
          `"createdAt" timestamp NOT NULL DEFAULT NOW(), "updatedAt" timestamp NOT NULL DEFAULT NOW(), ` +
          `CONSTRAINT "FK_automation_rules_sessionId" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
      );
    } else {
      await queryRunner.query(
        `CREATE TABLE "automation_rules" (` +
          `"id" varchar PRIMARY KEY NOT NULL, "sessionId" varchar NOT NULL, ` +
          `"name" varchar(100) NOT NULL, "enabled" boolean NOT NULL DEFAULT (1), "conditions" text, ` +
          `"replyText" text NOT NULL, "cooldownSeconds" integer NOT NULL DEFAULT (60), ` +
          `"createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), ` +
          `CONSTRAINT "FK_automation_rules_sessionId" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
      );
    }

    await queryRunner.query(`CREATE INDEX "IDX_automation_rules_sessionId" ON "automation_rules" ("sessionId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_automation_rules_sessionId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "automation_rules"`);
  }
}
