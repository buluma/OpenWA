import { Test, TestingModule } from '@nestjs/testing';
import { SessionController } from './session.controller';
import { SessionService } from './session.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-log.entity';
import { SessionStatus } from './entities/session.entity';

// Minimal, focused spec: this controller has no other unit coverage (pre-existing gap, e2e-only
// elsewhere), so this deliberately only covers the one behavior this file changes rather than
// scaffolding a full controller test suite as a side effect.
describe('SessionController.getQRCode', () => {
  let controller: SessionController;
  const getQRCode = jest.fn();
  const findOne = jest.fn();
  const logInfo = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionController],
      providers: [
        { provide: SessionService, useValue: { getQRCode, findOne } },
        { provide: AuditService, useValue: { logInfo } },
      ],
    }).compile();

    controller = module.get<SessionController>(SessionController);
  });

  afterEach(() => {
    getQRCode.mockReset();
    findOne.mockReset();
    logInfo.mockReset();
  });

  it('audit-logs the session name alongside the id, not just the id', async () => {
    getQRCode.mockResolvedValue({ qrCode: 'qr-data', status: SessionStatus.QR_READY });
    findOne.mockResolvedValue({ id: 'sess-1', name: 'walker' });

    await controller.getQRCode('sess-1');

    expect(logInfo).toHaveBeenCalledWith(AuditAction.SESSION_QR_GENERATED, {
      sessionId: 'sess-1',
      sessionName: 'walker',
    });
  });
});
