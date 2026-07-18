import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { SessionService } from '../session/session.service';
import { IWhatsAppEngine } from '../../engine/interfaces/whatsapp-engine.interface';
import { paginate, ListOptions } from '../../common/utils/paginate';

/**
 * Owns engine access for contact operations so the "session not started" guard and
 * contact business rules (not-found mapping) live behind the service boundary.
 */
@Injectable()
export class ContactService {
  constructor(private readonly sessionService: SessionService) {}

  private getEngine(sessionId: string): IWhatsAppEngine {
    const engine = this.sessionService.getEngine(sessionId);
    if (!engine) {
      throw new BadRequestException('Session is not started');
    }
    return engine;
  }

  getContacts(sessionId: string, opts: ListOptions = {}) {
    // getEngine throws synchronously (keeps the "session not started" guard a sync 400); the
    // engine returns the full set and we bound the HTTP response window via paginate().
    return this.getEngine(sessionId)
      .getContacts()
      .then(contacts => paginate(contacts, opts.limit, opts.offset));
  }

  async getContactById(sessionId: string, contactId: string) {
    const contact = await this.getEngine(sessionId).getContactById(contactId);
    if (!contact) {
      throw new NotFoundException(`Contact ${contactId} not found`);
    }
    return contact;
  }

  checkNumberExists(sessionId: string, number: string) {
    return this.getEngine(sessionId).checkNumberExists(number);
  }

  getNumberId(sessionId: string, number: string) {
    return this.getEngine(sessionId).getNumberId(number);
  }

  resolveContactPhone(sessionId: string, contactId: string) {
    return this.getEngine(sessionId).resolveContactPhone(contactId);
  }

  getProfilePicture(sessionId: string, contactId: string) {
    return this.getEngine(sessionId).getProfilePicture(contactId);
  }

  /**
   * Read a cached profile picture from disk and return its buffer.
   * Calls getProfilePicture first to ensure the image is cached.
   */
  async readProfilePicture(sessionId: string, contactId: string): Promise<Buffer | null> {
    // Ensure the image is cached (downloads from WhatsApp if not already on disk)
    const key = await this.getEngine(sessionId).getProfilePicture(contactId);
    if (!key) return null;

    // key looks like: profiles/<sessionId>/<safeContactId>.jpg
    const filePath = path.join('data', key);
    try {
      return await fs.promises.readFile(filePath);
    } catch {
      return null;
    }
  }

  blockContact(sessionId: string, contactId: string) {
    return this.getEngine(sessionId).blockContact(contactId);
  }

  unblockContact(sessionId: string, contactId: string) {
    return this.getEngine(sessionId).unblockContact(contactId);
  }

  upsertContact(sessionId: string, contactId: string, details: { fullName?: string; firstName?: string }) {
    return this.getEngine(sessionId).upsertContact(contactId, details);
  }

  removeContact(sessionId: string, contactId: string) {
    return this.getEngine(sessionId).removeContact(contactId);
  }
}
