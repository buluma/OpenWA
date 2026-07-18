import { BadRequestException } from '@nestjs/common';
import { QuickReplyService } from './quick-reply.service';
import { SessionService } from '../session/session.service';
import { IWhatsAppEngine } from '../../engine/interfaces/whatsapp-engine.interface';

describe('QuickReplyService', () => {
  const makeService = (engine: Partial<IWhatsAppEngine> | undefined) => {
    const sessionService = { getEngine: jest.fn().mockReturnValue(engine) } as unknown as SessionService;
    return new QuickReplyService(sessionService);
  };

  it('throws 400 when the session is not started', () => {
    expect(() => makeService(undefined).upsert('s1', { shortcut: '/hi', message: 'Hello!' })).toThrow(
      BadRequestException,
    );
  });

  it('delegates upsert to the engine and returns its id', async () => {
    const upsertQuickReply = jest.fn().mockResolvedValue({ id: 'TS123' });
    const result = await makeService({ upsertQuickReply }).upsert('s1', { shortcut: '/hi', message: 'Hello!' });
    expect(upsertQuickReply).toHaveBeenCalledWith({ shortcut: '/hi', message: 'Hello!' });
    expect(result).toEqual({ id: 'TS123' });
  });

  it('delegates remove to the engine', async () => {
    const removeQuickReply = jest.fn().mockResolvedValue(undefined);
    await makeService({ removeQuickReply }).remove('s1', 'TS123');
    expect(removeQuickReply).toHaveBeenCalledWith('TS123');
  });
});
