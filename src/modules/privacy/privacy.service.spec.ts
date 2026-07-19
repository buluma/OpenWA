import { BadRequestException } from '@nestjs/common';
import { PrivacyService } from './privacy.service';
import { SessionService } from '../session/session.service';
import { IWhatsAppEngine } from '../../engine/interfaces/whatsapp-engine.interface';

describe('PrivacyService', () => {
  const makeService = (engine: Partial<IWhatsAppEngine> | undefined) => {
    const sessionService = { getEngine: jest.fn().mockReturnValue(engine) } as unknown as SessionService;
    return new PrivacyService(sessionService);
  };

  it('throws 400 when the session is not started', () => {
    expect(() => makeService(undefined).getSettings('s1')).toThrow(BadRequestException);
  });

  it('delegates getSettings to the engine', async () => {
    const getPrivacySettings = jest.fn().mockResolvedValue({ last: 'all' });
    await expect(makeService({ getPrivacySettings }).getSettings('s1')).resolves.toEqual({ last: 'all' });
  });

  it('delegates getBlocklist to the engine', async () => {
    const getBlocklist = jest.fn().mockResolvedValue(['628111@c.us']);
    await expect(makeService({ getBlocklist }).getBlocklist('s1')).resolves.toEqual(['628111@c.us']);
  });

  describe('updateSettings', () => {
    it('calls only the engine methods for fields present in the dto', async () => {
      const updateLastSeenPrivacy = jest.fn().mockResolvedValue(undefined);
      const updateOnlinePrivacy = jest.fn().mockResolvedValue(undefined);
      const updateProfilePicturePrivacy = jest.fn().mockResolvedValue(undefined);
      const updateStatusPrivacy = jest.fn().mockResolvedValue(undefined);
      const updateReadReceiptsPrivacy = jest.fn().mockResolvedValue(undefined);
      const updateGroupsAddPrivacy = jest.fn().mockResolvedValue(undefined);
      const updateCallPrivacy = jest.fn().mockResolvedValue(undefined);
      const updateMessagesPrivacy = jest.fn().mockResolvedValue(undefined);
      const updateDisableLinkPreviewsPrivacy = jest.fn().mockResolvedValue(undefined);
      const updateDefaultDisappearingMode = jest.fn().mockResolvedValue(undefined);
      const service = makeService({
        updateLastSeenPrivacy,
        updateOnlinePrivacy,
        updateProfilePicturePrivacy,
        updateStatusPrivacy,
        updateReadReceiptsPrivacy,
        updateGroupsAddPrivacy,
        updateCallPrivacy,
        updateMessagesPrivacy,
        updateDisableLinkPreviewsPrivacy,
        updateDefaultDisappearingMode,
      });

      await service.updateSettings('s1', { lastSeen: 'contacts', call: 'known' });

      expect(updateLastSeenPrivacy).toHaveBeenCalledWith('contacts');
      expect(updateCallPrivacy).toHaveBeenCalledWith('known');
      expect(updateOnlinePrivacy).not.toHaveBeenCalled();
      expect(updateProfilePicturePrivacy).not.toHaveBeenCalled();
      expect(updateStatusPrivacy).not.toHaveBeenCalled();
      expect(updateReadReceiptsPrivacy).not.toHaveBeenCalled();
      expect(updateGroupsAddPrivacy).not.toHaveBeenCalled();
      expect(updateMessagesPrivacy).not.toHaveBeenCalled();
      expect(updateDisableLinkPreviewsPrivacy).not.toHaveBeenCalled();
      expect(updateDefaultDisappearingMode).not.toHaveBeenCalled();
    });

    it('calls all ten engine methods when every field is present', async () => {
      const engine = {
        updateLastSeenPrivacy: jest.fn().mockResolvedValue(undefined),
        updateOnlinePrivacy: jest.fn().mockResolvedValue(undefined),
        updateProfilePicturePrivacy: jest.fn().mockResolvedValue(undefined),
        updateStatusPrivacy: jest.fn().mockResolvedValue(undefined),
        updateReadReceiptsPrivacy: jest.fn().mockResolvedValue(undefined),
        updateGroupsAddPrivacy: jest.fn().mockResolvedValue(undefined),
        updateCallPrivacy: jest.fn().mockResolvedValue(undefined),
        updateMessagesPrivacy: jest.fn().mockResolvedValue(undefined),
        updateDisableLinkPreviewsPrivacy: jest.fn().mockResolvedValue(undefined),
        updateDefaultDisappearingMode: jest.fn().mockResolvedValue(undefined),
      };
      const service = makeService(engine);

      await service.updateSettings('s1', {
        lastSeen: 'all',
        online: 'match_last_seen',
        profilePicture: 'none',
        status: 'contact_blacklist',
        readReceipts: 'none',
        groupsAdd: 'contacts',
        call: 'all',
        messages: 'contacts',
        disableLinkPreviews: true,
        defaultDisappearingMode: 604800,
      });

      expect(engine.updateLastSeenPrivacy).toHaveBeenCalledWith('all');
      expect(engine.updateOnlinePrivacy).toHaveBeenCalledWith('match_last_seen');
      expect(engine.updateProfilePicturePrivacy).toHaveBeenCalledWith('none');
      expect(engine.updateStatusPrivacy).toHaveBeenCalledWith('contact_blacklist');
      expect(engine.updateReadReceiptsPrivacy).toHaveBeenCalledWith('none');
      expect(engine.updateGroupsAddPrivacy).toHaveBeenCalledWith('contacts');
      expect(engine.updateCallPrivacy).toHaveBeenCalledWith('all');
      expect(engine.updateMessagesPrivacy).toHaveBeenCalledWith('contacts');
      expect(engine.updateDisableLinkPreviewsPrivacy).toHaveBeenCalledWith(true);
      expect(engine.updateDefaultDisappearingMode).toHaveBeenCalledWith(604800);
    });

    it('no-ops (no engine calls) when the dto is empty', async () => {
      const updateLastSeenPrivacy = jest.fn();
      const service = makeService({ updateLastSeenPrivacy });
      await service.updateSettings('s1', {});
      expect(updateLastSeenPrivacy).not.toHaveBeenCalled();
    });
  });
});
