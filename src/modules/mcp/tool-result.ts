import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { createLogger } from '../../common/services/logger.service';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const logger = createLogger('Mcp');

/**
 * The opt-in cap on a result, from `MCP_MAX_RESULT_BYTES`: a positive decimal integer in UTF-8 bytes. Unset, blank,
 * `0` or anything else reads as 0, no cap, which is the behaviour before the knob existed. Boot validation rejects
 * a malformed value, so the lenient read only covers a process that skipped it. A count past what a number holds
 * exactly is still a cap, one no result reaches: read as no cap it would bring the base64 resource back.
 */
export function readMaxResultBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env['MCP_MAX_RESULT_BYTES']?.trim();
  if (!raw || !/^\d+$/.test(raw)) return 0;
  return Math.min(Number(raw), Number.MAX_SAFE_INTEGER);
}

/** The end of the longest prefix of `bytes` that is at most `max` bytes and does not end inside a UTF-8 character. */
function utf8SafeEnd(bytes: Buffer, max: number): number {
  let end = max;
  // A continuation byte (10xxxxxx) at the cut means the character that owns it started before the cut.
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return end;
}

/**
 * `text` whole when it fits `maxResultBytes`, else its longest prefix that does, never cut inside a character,
 * and a note with the full size and `advice`.
 */
function cutToCap(text: string, maxResultBytes: number, advice = ''): string {
  const buffer = Buffer.from(text);
  if (buffer.byteLength <= maxResultBytes) return text;
  const head = buffer.subarray(0, utf8SafeEnd(buffer, maxResultBytes)).toString('utf8');
  return `${head}\n…[truncated: ${buffer.byteLength} bytes in all${advice}]`;
}

/**
 * An error answer under the cap, which {@link smartToolResult} applies to the others. A refusal is short as a
 * rule, but one that lists each invalid value grows with the arguments sent: the SDK's own answer to arguments
 * its schema refuses, and a service's list of validation messages.
 */
export function capToolError(result: CallToolResult, maxResultBytes: number): CallToolResult {
  if (maxResultBytes <= 0) return result;
  return {
    ...result,
    content: result.content.map(item =>
      item.type === 'text' ? { ...item, text: cutToCap(item.text, maxResultBytes) } : item,
    ),
  };
}

/**
 * Format a tool result.
 *
 * With `maxResultBytes` above 0 (the operator's `MCP_MAX_RESULT_BYTES`), the result is always ONE text item, for the
 * clients that put a whole result in the model's context (claude.ai, ChatGPT) and fail past a size: a payload at or
 * under the cap whole, a larger one as its first `maxResultBytes` bytes, cut at a character boundary, and a note
 * with the full size. Nothing is offloaded, because the blob is the same data in base64: a third larger, so a
 * payload under the cap could still pass the size the cap was set for, and unreadable to a client that shows the
 * model text alone.
 *
 * Without a cap, small payloads are inlined as text and large ones (> 4 KB) are offloaded to an embedded base64
 * resource so the response stays compact.
 */
export function smartToolResult(data: string | object | object[], maxResultBytes = 0): CallToolResult {
  // JSON.stringify(undefined) is undefined, not a string — a handler that resolves void would turn
  // a completed write into a thrown TypeError here, reported to the agent as a failure it retries.
  const text = typeof data === 'string' ? data : (JSON.stringify(data) ?? 'null');
  if (maxResultBytes > 0) {
    const advice = '; narrow the request, with limit and offset where the tool takes them, to see the rest';
    return { content: [{ type: 'text', text: cutToCap(text, maxResultBytes, advice) }] };
  }
  const mimeType = typeof data === 'string' ? 'text/plain' : 'application/json';
  const ext = typeof data === 'string' ? 'txt' : 'json';
  if (text.length > 4096) {
    const uri = `mcp://toolResult/${randomUUID()}.${ext}`;
    const buffer = Buffer.from(text);
    return {
      content: [
        { type: 'text', text: `Received resource ${uri} with ${buffer.byteLength} bytes` },
        { type: 'resource', resource: { uri, mimeType, blob: buffer.toString('base64') } },
      ],
    };
  }
  return { content: [{ type: 'text', text }] };
}

/** Format a tool result as compact JSON text. */
export function jsonToolResult(data: object, isError = false): CallToolResult {
  const result: CallToolResult = { content: [{ type: 'text', text: JSON.stringify(data) }] };
  if (isError) {
    result.isError = true;
  }
  return result;
}

/**
 * Map a thrown error to a tool-error result. Stack traces and raw thrown values
 * are logged server-side only — never put on the wire, where they would leak
 * server internals to the MCP client.
 *
 * HttpExceptions carry client-safe messages (they mirror REST error responses).
 * All other errors get a generic wire message to avoid leaking internals.
 */
export function handleToolError(error: unknown): CallToolResult {
  if (error instanceof HttpException) {
    // A 4xx is the client's mistake (unknown session, bad input, missing role), which REST does not
    // log at all: a warn line without a stack, so error-level alerting fires on server faults only.
    if (error.getStatus() >= 500) logger.error(error.message, error.stack);
    else logger.warn(`MCP tool error ${error.getStatus()}: ${error.message}`);
    const res = error.getResponse();
    const message =
      typeof res === 'object' && res !== null && 'message' in res
        ? (res as Record<string, unknown>)['message']
        : error.message;
    return jsonToolResult({ success: false, name: error.name, message }, true);
  }
  if (error instanceof Error) {
    logger.error(error.message, error.stack);
    return jsonToolResult({ success: false, name: error.name, message: 'Internal error' }, true);
  }
  logger.error('Unknown tool error', String(error));
  return jsonToolResult({ success: false, name: 'Unknown error', message: 'Internal error' }, true);
}
