import { Injectable, BadRequestException } from '@nestjs/common';
import { SessionService } from '../session/session.service';
import { IWhatsAppEngine } from '../../engine/interfaces/whatsapp-engine.interface';

@Injectable()
export class QuickReplyService {
  constructor(private readonly sessionService: SessionService) {}

  private getEngine(sessionId: string): IWhatsAppEngine {
    const engine = this.sessionService.getEngine(sessionId);
    if (!engine) {
      throw new BadRequestException('Session is not started');
    }
    return engine;
  }

  upsert(sessionId: string, quickReply: { id?: string; shortcut: string; message: string; keywords?: string[] }) {
    return this.getEngine(sessionId).upsertQuickReply(quickReply);
  }

  remove(sessionId: string, id: string) {
    return this.getEngine(sessionId).removeQuickReply(id);
  }
}
