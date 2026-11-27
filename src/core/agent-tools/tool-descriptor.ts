import { z } from 'zod';
import type { ApiKey } from '../../modules/auth/entities/api-key.entity';
import type { ApiKeyRole } from '../../modules/auth/entities/api-key.entity';
import type { ChatScopeService } from '../../modules/auth/chat-scope.service';

/** The longest session id a tool takes: the cap the realtime subscribe applies to the same ids. */
export const MAX_SESSION_ID_LENGTH = 128;

/**
 * A session id taken by a tool: letters, digits and hyphens (the only key the engine factory runs a session under; a
 * restored id is not a UUID), at most MAX_SESSION_ID_LENGTH characters. The tools call the services directly, so no
 * pipe runs, and any other id would reach the lookup, which has to cut what it quotes in its not-found answer.
 */
export const sessionIdSchema = z
  .string()
  .min(1)
  .max(MAX_SESSION_ID_LENGTH)
  .regex(/^[A-Za-z0-9-]+$/, 'a session id holds only letters, digits and hyphens')
  .describe('Session UUID (the session id, not the name)');

/** A single agent-invocable capability. Protocol-neutral: no MCP types here. */
export interface ToolDescriptor<I = unknown> {
  /** Explicit, stable public name, e.g. 'MessageSendText'. */
  name: string;
  /** Agent-legible description: what it does, when to use it, preconditions. */
  description: string;
  /** Input contract: validates the call AND is advertised to the agent. */
  inputSchema: z.ZodType<I>;
  /** Human-readable name shown to the user (MCP `title`). Defaults to the name split into words: 'Message send text'. */
  title?: string;
  tier: 'read' | 'write';
  /** True for irreversible or state-overwriting ops; surfaced to MCP clients as destructiveHint. */
  destructive?: boolean;
  /** Safe to repeat without additional effect. Defaults to (tier === 'read'). */
  idempotent?: boolean;
  /** Minimum role; checked via AuthService.hasPermission. */
  requiredRole?: ApiKeyRole;
  /** If true, input MUST carry `sessionId`, checked against the key's allowedSessions. */
  sessionScoped?: boolean;
  /** Allowed chat input fields, a filtered list, or a chat-independent operation. Unmarked tools deny restricted keys. */
  chatScope?: readonly string[] | 'filtered' | 'agnostic';
  /** The quote resolves within the authorized chat, as it does on the REST reply route. */
  chatQuotedAllowed?: boolean;
  /** Calls the service. Receives validated input + the resolved, scoped key. */
  handler: (input: I, apiKey: ApiKey, chatScope?: ChatScopeService) => Promise<unknown>;
}

/**
 * A descriptor with its input type erased, for storing tools of different shapes in one list.
 *
 * The handler parameter is `never`, not `unknown`. Under `strictFunctionTypes` parameters are checked
 * CONTRAVARIANTLY, so a handler that accepts a specific validated shape is assignable to one
 * accepting `never` but not to one accepting `unknown` — and `unknown` would be the wrong promise
 * anyway, since the registry cannot hand a handler just anything.
 *
 * What makes the erasure sound is the invoker: it parses `inputSchema` first, so a handler only ever
 * receives a value its own schema accepted. The one cast that bridges the two lives there, next to
 * the parse that justifies it, rather than being spread across every tool definition.
 */
export type AnyToolDescriptor = Omit<ToolDescriptor, 'inputSchema' | 'handler'> & {
  inputSchema: z.ZodType;
  handler: (input: never, apiKey: ApiKey, chatScope?: ChatScopeService) => Promise<unknown>;
};

/**
 * Declare one tool, tying its handler to its own schema.
 *
 * Annotating a list as `ToolDescriptor[]` cannot do this: it pins `I` to `unknown` for every entry,
 * so each tool's schema and handler are only ever checked against `unknown` and never against each
 * other. Inferring `I` per tool here means a handler that reads a field its schema does not declare
 * is a compile error, and the handler's parameter no longer has to be written out by hand — it is
 * whatever the schema produces, so the two cannot drift apart.
 */
export function defineTool<I>(descriptor: ToolDescriptor<I>): AnyToolDescriptor {
  return descriptor;
}
