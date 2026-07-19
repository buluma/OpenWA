/**
 * True when a write failed because the parent `sessions` row is absent (a foreign-key violation),
 * as opposed to any other persistence error. Covers SQLite (`SQLITE_CONSTRAINT[_FOREIGNKEY]`) and
 * Postgres (`23503`). TypeORM wraps the driver error in a QueryFailedError, so check both the
 * wrapper and `driverError`. Shared by every Baileys persistence service backed by a FK to
 * `sessions` (messages, chats, contacts) so an orphaned/recreated session is classified identically
 * everywhere instead of drifting between copy-pasted checks.
 */
export function isMissingParentSessionError(err: unknown): boolean {
  const e = err as { code?: string; driverError?: { code?: string }; message?: string };
  const code = e?.driverError?.code ?? e?.code;
  if (code === '23503') {
    return true; // Postgres foreign_key_violation
  }
  const message = e?.message ?? '';
  if (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT')) {
    return code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || /FOREIGN KEY/i.test(message);
  }
  return /FOREIGN KEY constraint failed/i.test(message);
}
