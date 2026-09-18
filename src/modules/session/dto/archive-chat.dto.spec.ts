import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ArchiveChatDto } from './archive-chat.dto';

const errors = (body: Record<string, unknown>): number => validateSync(plainToInstance(ArchiveChatDto, body)).length;

describe('ArchiveChatDto', () => {
  it('accepts a valid chatId with archive true or false', () => {
    expect(errors({ chatId: '1234567890-123@g.us', archive: true })).toBe(0);
    expect(errors({ chatId: '1234567890-123@g.us', archive: false })).toBe(0);
  });

  it('rejects a malformed chatId', () => {
    expect(errors({ chatId: 'not-a-jid', archive: true })).toBeGreaterThan(0);
  });

  // @ToStrictBoolean() reads the canonical string spellings a form-encoded body produces and maps
  // them correctly; without it, the global ValidationPipe's implicit conversion would cast the
  // string "false" to boolean true instead.
  it('maps the string "false" to false, not true', () => {
    const instance = plainToInstance(ArchiveChatDto, { chatId: '1234567890-123@g.us', archive: 'false' });
    expect(instance.archive).toBe(false);
    expect(errors({ chatId: '1234567890-123@g.us', archive: 'false' })).toBe(0);
  });

  it('rejects an ambiguous spelling instead of guessing', () => {
    expect(errors({ chatId: '1234567890-123@g.us', archive: 'yes' })).toBeGreaterThan(0);
  });

  it('rejects a missing archive field', () => {
    expect(errors({ chatId: '1234567890-123@g.us' })).toBeGreaterThan(0);
  });
});
