import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { MuteChatDto } from './mute-chat.dto';

const errors = (body: Record<string, unknown>): number => validateSync(plainToInstance(MuteChatDto, body)).length;

describe('MuteChatDto', () => {
  it('accepts a valid chatId with a future epoch-ms muteUntil', () => {
    expect(errors({ chatId: '1234567890-123@g.us', muteUntil: 1800000000000 })).toBe(0);
  });

  it('accepts null muteUntil (unmute)', () => {
    expect(errors({ chatId: '1234567890-123@g.us', muteUntil: null })).toBe(0);
  });

  it('rejects a missing muteUntil — omission is not the same instruction as null', () => {
    expect(errors({ chatId: '1234567890-123@g.us' })).toBeGreaterThan(0);
  });

  it('rejects a non-positive muteUntil', () => {
    expect(errors({ chatId: '1234567890-123@g.us', muteUntil: 0 })).toBeGreaterThan(0);
    expect(errors({ chatId: '1234567890-123@g.us', muteUntil: -5 })).toBeGreaterThan(0);
  });

  it('rejects a non-integer muteUntil', () => {
    expect(errors({ chatId: '1234567890-123@g.us', muteUntil: 1.5 })).toBeGreaterThan(0);
  });

  it('rejects a malformed chatId', () => {
    expect(errors({ chatId: 'not-a-jid', muteUntil: 1800000000000 })).toBeGreaterThan(0);
  });
});
