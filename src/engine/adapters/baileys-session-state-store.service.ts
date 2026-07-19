import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Chat, Contact } from '@whiskeysockets/baileys';
import { BaileysStoredChat } from './baileys-stored-chat.entity';
import { BaileysStoredContact } from './baileys-stored-contact.entity';
import { BaileysSessionStateStore } from '../types/baileys.types';
import { createLogger } from '../../common/services/logger.service';
import { isMissingParentSessionError } from './baileys-persistence-errors';

@Injectable()
export class BaileysSessionStateStoreService implements BaileysSessionStateStore {
  private readonly logger = createLogger('BaileysSessionStateStore');
  /** Sessions already warned about a missing parent row — keeps the orphan log to once per session. */
  private readonly orphanWarnedSessions = new Set<string>();

  constructor(
    @InjectRepository(BaileysStoredChat, 'data')
    private readonly chatRepo: Repository<BaileysStoredChat>,
    @InjectRepository(BaileysStoredContact, 'data')
    private readonly contactRepo: Repository<BaileysStoredContact>,
  ) {}

  async saveChats(sessionId: string, chats: Partial<Chat>[]): Promise<void> {
    const rows = (chats ?? [])
      .filter((c): c is Partial<Chat> & { id: string } => Boolean(c.id))
      .map(c => ({ sessionId, waId: c.id, serializedChat: JSON.stringify(c) }));
    if (!rows.length) return;
    await this.withOrphanHandling(sessionId, () => this.chatRepo.upsert(rows, ['sessionId', 'waId']));
  }

  async saveContacts(sessionId: string, contacts: Partial<Contact>[]): Promise<void> {
    const rows = (contacts ?? [])
      .filter((c): c is Partial<Contact> & { id: string } => Boolean(c.id))
      .map(c => ({ sessionId, waId: c.id, serializedContact: JSON.stringify(c) }));
    if (!rows.length) return;
    await this.withOrphanHandling(sessionId, () => this.contactRepo.upsert(rows, ['sessionId', 'waId']));
  }

  async loadChats(sessionId: string): Promise<Partial<Chat>[]> {
    const rows = await this.chatRepo.find({ where: { sessionId } });
    return rows.map(r => JSON.parse(r.serializedChat) as Partial<Chat>);
  }

  async loadContacts(sessionId: string): Promise<Partial<Contact>[]> {
    const rows = await this.contactRepo.find({ where: { sessionId } });
    return rows.map(r => JSON.parse(r.serializedContact) as Partial<Contact>);
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.chatRepo.delete({ sessionId });
    await this.contactRepo.delete({ sessionId });
  }

  /** Shared orphaned-session handling for both repos (SHA-85, mirrors BaileysMessageStoreService). */
  private async withOrphanHandling(sessionId: string, upsert: () => Promise<unknown>): Promise<void> {
    try {
      await upsert();
    } catch (err) {
      if (isMissingParentSessionError(err)) {
        // Orphaned adapter: the sessions row was deleted/recreated (reconnect churn) while this
        // adapter kept emitting chats/contacts events. There is no valid parent to store under, so
        // drop the write instead of throwing on every batch. Warn once per session so the orphan
        // stays visible without per-event log noise.
        if (!this.orphanWarnedSessions.has(sessionId)) {
          this.orphanWarnedSessions.add(sessionId);
          this.logger.warn(
            `No parent session row for "${sessionId}" — skipping Baileys chat/contact persistence ` +
              `(orphaned/recreated session). Chats/contacts will not survive a restart under this id.`,
          );
        }
        return;
      }
      throw err;
    }
  }
}
