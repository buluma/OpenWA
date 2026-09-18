import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PinChatDto } from './pin-chat.dto';

const errors = (body: Record<string, unknown>): number => validateSync(plainToInstance(PinChatDto, body)).length;

describe('PinChatDto', () => {
  it('accepts a valid chatId with pin true or false', () => {
    expect(errors({ chatId: '1234567890-123@g.us', pin: true })).toBe(0);
    expect(errors({ chatId: '1234567890-123@g.us', pin: false })).toBe(0);
  });

  it('rejects a malformed chatId', () => {
    expect(errors({ chatId: 'not-a-jid', pin: true })).toBeGreaterThan(0);
  });

  // @ToStrictBoolean() reads the canonical string spellings a form-encoded body produces and maps
  // them correctly; without it, the global ValidationPipe's implicit conversion would cast the
  // string "false" to boolean true instead.
  it('maps the string "false" to false, not true', () => {
    const instance = plainToInstance(PinChatDto, { chatId: '1234567890-123@g.us', pin: 'false' });
    expect(instance.pin).toBe(false);
    expect(errors({ chatId: '1234567890-123@g.us', pin: 'false' })).toBe(0);
  });

  it('rejects an ambiguous spelling instead of guessing', () => {
    expect(errors({ chatId: '1234567890-123@g.us', pin: 'yes' })).toBeGreaterThan(0);
  });

  it('rejects a missing pin field', () => {
    expect(errors({ chatId: '1234567890-123@g.us' })).toBeGreaterThan(0);
  });
});
