import { Injectable, BadRequestException } from '@nestjs/common';
import { SessionService } from '../session/session.service';
import { IWhatsAppEngine } from '../../engine/interfaces/whatsapp-engine.interface';
import { UpdatePrivacySettingsDto } from './dto/update-privacy-settings.dto';

@Injectable()
export class PrivacyService {
  constructor(private readonly sessionService: SessionService) {}

  private getEngine(sessionId: string): IWhatsAppEngine {
    const engine = this.sessionService.getEngine(sessionId);
    if (!engine) {
      throw new BadRequestException('Session is not started');
    }
    return engine;
  }

  getSettings(sessionId: string) {
    return this.getEngine(sessionId).getPrivacySettings();
  }

  getBlocklist(sessionId: string) {
    return this.getEngine(sessionId).getBlocklist();
  }

  /** Only the fields present in `dto` are updated, each via its own engine call, run concurrently. */
  async updateSettings(sessionId: string, dto: UpdatePrivacySettingsDto): Promise<void> {
    const engine = this.getEngine(sessionId);
    const ops: Promise<void>[] = [];
    if (dto.lastSeen !== undefined) ops.push(engine.updateLastSeenPrivacy(dto.lastSeen));
    if (dto.online !== undefined) ops.push(engine.updateOnlinePrivacy(dto.online));
    if (dto.profilePicture !== undefined) ops.push(engine.updateProfilePicturePrivacy(dto.profilePicture));
    if (dto.status !== undefined) ops.push(engine.updateStatusPrivacy(dto.status));
    if (dto.readReceipts !== undefined) ops.push(engine.updateReadReceiptsPrivacy(dto.readReceipts));
    if (dto.groupsAdd !== undefined) ops.push(engine.updateGroupsAddPrivacy(dto.groupsAdd));
    if (dto.call !== undefined) ops.push(engine.updateCallPrivacy(dto.call));
    if (dto.messages !== undefined) ops.push(engine.updateMessagesPrivacy(dto.messages));
    if (dto.disableLinkPreviews !== undefined) {
      ops.push(engine.updateDisableLinkPreviewsPrivacy(dto.disableLinkPreviews));
    }
    if (dto.defaultDisappearingMode !== undefined) {
      ops.push(engine.updateDefaultDisappearingMode(dto.defaultDisappearingMode));
    }
    await Promise.all(ops);
  }
}
