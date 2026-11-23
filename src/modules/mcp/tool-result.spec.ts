import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { LoggerService } from '../../common/services/logger.service';
import { capToolError, handleToolError, readMaxResultBytes, smartToolResult } from './tool-result';

describe('smartToolResult', () => {
  it('inlines a small object as JSON text', () => {
    expect(smartToolResult({ id: 1 }).content).toEqual([{ type: 'text', text: '{"id":1}' }]);
  });

  it('passes a string payload through as plain text', () => {
    expect(smartToolResult('done').content).toEqual([{ type: 'text', text: 'done' }]);
  });

  it('survives an undefined handler result instead of throwing after the write ran', () => {
    // JSON.stringify(undefined) is undefined; reading .length off it threw a TypeError that
    // handleToolError then reported as `Internal error` for an operation that had succeeded.
    const result = smartToolResult(undefined as unknown as object);
    expect(result.content).toEqual([{ type: 'text', text: 'null' }]);
  });

  it('offloads a payload over 4 KB to an embedded resource', () => {
    const big = { blob: 'x'.repeat(5000) };
    const result = smartToolResult(big);
    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe('text');
    expect(result.content[1]).toMatchObject({ type: 'resource', resource: { mimeType: 'application/json' } });
  });
});

describe('handleToolError logging', () => {
  let error: jest.SpyInstance;
  let warn: jest.SpyInstance;
  beforeEach(() => {
    error = jest.spyOn(LoggerService.prototype, 'error').mockImplementation(() => undefined);
    warn = jest.spyOn(LoggerService.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('logs a client-caused 4xx at warn without a stack, as REST leaves it unlogged', () => {
    handleToolError(new NotFoundException('Session x not found'));
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('MCP tool error 404: Session x not found');
  });

  it('keeps a 5xx at error with its stack', () => {
    const failure = new ServiceUnavailableException('engine down');
    handleToolError(failure);
    expect(error).toHaveBeenCalledWith('engine down', failure.stack);
    expect(warn).not.toHaveBeenCalled();
  });
});

// The fork offloads a result past 4096 characters to a blob (upstream's INLINE_RESULT_MAX_BYTES is 32 KiB).
const INLINE_LIMIT = 4096;

describe('smartToolResult with MCP_MAX_RESULT_BYTES (an opt-in cap that makes every result text)', () => {
  const note = (total: number): string =>
    `\n…[truncated: ${total} bytes in all; ` +
    'narrow the request, with limit and offset where the tool takes them, to see the rest]';
  const blobOf = (result: ReturnType<typeof smartToolResult>): string => {
    const resource = result.content[1];
    if (resource?.type !== 'resource' || !('blob' in resource.resource)) throw new Error('expected a blob resource');
    return Buffer.from(resource.resource.blob, 'base64').toString('utf8');
  };
  const big = 'x'.repeat(233 * 1000);

  it.each([undefined, 0])('is unchanged when the cap is %s: a 233 KB payload still becomes the blob', cap => {
    const result = cap === undefined ? smartToolResult(big) : smartToolResult(big, cap);
    expect(result.content).toHaveLength(2);
    expect((result.content[0] as { text: string }).text).toContain(`with ${big.length} bytes`);
    expect(blobOf(result)).toBe(big);
  });

  it('truncates a 233 KB payload at a cap of 100000, with the note and the byte count', () => {
    const result = smartToolResult(big, 100000);
    expect(result.content).toEqual([{ type: 'text', text: 'x'.repeat(100000) + note(233000) }]);
  });

  it('counts the cut in UTF-8 bytes of the serialized payload, for an object too', () => {
    const data = { rows: 'y'.repeat(5000) };
    const total = Buffer.byteLength(JSON.stringify(data));
    const result = smartToolResult(data, 1000);
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(data).slice(0, 1000) + note(total) }]);
  });

  it('never splits a multi-byte character at the cut', () => {
    // 3-byte characters: a cap of 100000 falls one byte into the 33334th, so the cut backs up to 99999.
    const euro = '\u20ac'.repeat(80000);
    const t3 = smartToolResult(euro, 100000).content[0];
    expect(t3).toEqual({ type: 'text', text: '\u20ac'.repeat(33333) + note(240000) });
    // 4-byte characters, and a 2-byte one, at every offset into a character.
    const emoji = '\ud83d\ude00'.repeat(100);
    for (const [cap, kept] of [
      [10, 2],
      [11, 2],
      [12, 3],
      [13, 3],
      [3, 0],
      [4, 1],
    ] as const) {
      expect(smartToolResult(emoji, cap).content).toEqual([
        { type: 'text', text: '\ud83d\ude00'.repeat(kept) + note(400) },
      ]);
    }
    const e = smartToolResult('\u00e9'.repeat(1000), 5).content[0];
    expect(e).toEqual({ type: 'text', text: '\u00e9\u00e9' + note(2000) });
    for (const cap of [1, 2, 3, 4, 5, 6, 7]) {
      const text = (smartToolResult(euro, cap).content[0] as { text: string }).text;
      expect(text).not.toContain('\ufffd');
    }
  });

  it('does not truncate a payload exactly at the cap, and does at one byte over', () => {
    const atCap = 'x'.repeat(40000); // over the 4096-character inline limit: text all the same, because a cap is set
    expect(smartToolResult(atCap, 40000).content).toEqual([{ type: 'text', text: atCap }]);
    expect(smartToolResult(atCap + 'x', 40000).content).toEqual([{ type: 'text', text: atCap + note(40001) }]);
    const small = 'x'.repeat(100);
    expect(smartToolResult(small, 100).content).toEqual([{ type: 'text', text: small }]);
  });

  // The blob of a payload under the cap is that payload in base64, a third larger: 120 kB under a 150000 cap would
  // reach the client as 160000 characters. And a client that shows the model text alone would show it none of it.
  it('returns text, never the blob, for a payload between the inline limit and the cap', () => {
    const mid = 'x'.repeat(50000);
    expect(smartToolResult(mid, 100000).content).toEqual([{ type: 'text', text: mid }]);
    const rows = Array.from({ length: 1200 }, (_, i) => ({ id: `chat-${i}`, name: 'n'.repeat(80) }));
    const json = JSON.stringify(rows);
    expect(Buffer.byteLength(json)).toBeGreaterThan(INLINE_LIMIT);
    expect(smartToolResult(rows, 150000).content).toEqual([{ type: 'text', text: json }]);
  });

  it('checks the cap first, so a cap below the inline limit truncates a payload that would have been text', () => {
    const text = 'x'.repeat(3000);
    expect(smartToolResult(text, 1000).content).toEqual([{ type: 'text', text: 'x'.repeat(1000) + note(3000) }]);
    expect(smartToolResult(text).content).toEqual([{ type: 'text', text }]);
  });
});

describe('readMaxResultBytes', () => {
  it.each([undefined, '', ' ', '0', '-5', '1.5', '100k', 'abc', '1e5'])('reads %p as no cap', raw => {
    expect(readMaxResultBytes({ MCP_MAX_RESULT_BYTES: raw })).toBe(0);
  });

  it('reads a positive decimal integer', () => {
    expect(readMaxResultBytes({ MCP_MAX_RESULT_BYTES: '100000' })).toBe(100000);
    expect(readMaxResultBytes({ MCP_MAX_RESULT_BYTES: ' 100000 ' })).toBe(100000);
  });

  // Read as no cap, such a value would hand the client the base64 resource the operator set a cap to avoid.
  it.each(['9007199254740993', '99999999999999999999', '9'.repeat(400)])(
    'reads a count past what a number holds exactly (%p) as a cap no result reaches',
    raw => {
      const cap = readMaxResultBytes({ MCP_MAX_RESULT_BYTES: raw });
      expect(cap).toBe(Number.MAX_SAFE_INTEGER);
      expect(smartToolResult({ rows: 'x'.repeat(INLINE_LIMIT * 2) }, cap).content).toHaveLength(1);
    },
  );

  it('reads process.env by default', () => {
    const prev = process.env.MCP_MAX_RESULT_BYTES;
    try {
      process.env.MCP_MAX_RESULT_BYTES = '2048';
      expect(readMaxResultBytes()).toBe(2048);
      delete process.env.MCP_MAX_RESULT_BYTES;
      expect(readMaxResultBytes()).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.MCP_MAX_RESULT_BYTES;
      else process.env.MCP_MAX_RESULT_BYTES = prev;
    }
  });
});

describe('capToolError', () => {
  const refusal = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });

  it('leaves an error answer alone without a cap, and one that fits under it', () => {
    const long = refusal('x'.repeat(5000));
    expect(capToolError(long, 0)).toBe(long);
    expect(capToolError(refusal('short'), 1000)).toEqual(refusal('short'));
  });

  it('cuts an error answer past the cap at a character boundary, keeps it an error, and gives no paging advice', () => {
    const cut = capToolError(refusal('\u00e9'.repeat(3000)), 1001);
    expect(cut.isError).toBe(true);
    // 1001 falls inside a two-byte character, so the cut steps back to 1000 bytes: 500 whole characters.
    expect(cut.content).toEqual([
      { type: 'text', text: `${'\u00e9'.repeat(500)}\n\u2026[truncated: 6000 bytes in all]` },
    ]);
  });

  it('cuts the list of messages a service refuses a wide input with', () => {
    const messages = Array.from({ length: 400 }, (_, i) => `vars.v${i} must be a string`);
    const answer = handleToolError(new BadRequestException(messages));
    const whole = Buffer.byteLength((answer.content[0] as { text: string }).text);
    expect(whole).toBeGreaterThan(2000);
    const text = (capToolError(answer, 2000).content[0] as { text: string }).text;
    expect(Buffer.byteLength(text.split('\n\u2026')[0])).toBe(2000);
    expect(text.endsWith(`[truncated: ${whole} bytes in all]`)).toBe(true);
  });
});
