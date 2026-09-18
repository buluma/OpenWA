import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { AutomationRulesService } from './automation-rules.service';
import { AutomationRule } from './entities/automation-rule.entity';
import type { LidMappingStoreService } from '../../engine/identity/lid-mapping-store.service';

describe('AutomationRulesService', () => {
  let repository: jest.Mocked<Partial<Repository<AutomationRule>>>;
  let moduleRef: { get: jest.Mock };
  let lidStore: jest.Mocked<Partial<LidMappingStoreService>>;
  let configService: { get: jest.Mock };

  const makeRule = (overrides: Partial<AutomationRule> = {}): AutomationRule =>
    ({
      id: 'r1',
      sessionId: 's1',
      name: 'Greeter',
      enabled: true,
      conditions: null,
      replyText: 'Thanks for reaching out',
      cooldownSeconds: 60,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    }) as AutomationRule;

  const build = (): AutomationRulesService => {
    return new AutomationRulesService(
      repository as unknown as Repository<AutomationRule>,
      moduleRef as unknown as ConstructorParameters<typeof AutomationRulesService>[1],
      lidStore as unknown as LidMappingStoreService,
      configService as unknown as ConstructorParameters<typeof AutomationRulesService>[3],
    );
  };

  beforeEach(() => {
    repository = {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation((input: unknown) => input as AutomationRule),
      save: jest.fn().mockImplementation((input: unknown) => Promise.resolve(input as AutomationRule)),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      remove: jest.fn().mockImplementation((input: unknown) => Promise.resolve(input as AutomationRule)),
    };
    moduleRef = { get: jest.fn() };
    lidStore = { getCached: jest.fn().mockReturnValue(null) };
    configService = { get: jest.fn().mockImplementation((_key: string, def: number) => def) };
  });

  describe('create', () => {
    it('defaults cooldownSeconds and enabled, and passes conditions through', async () => {
      const service = build();
      await service.create('s1', { name: 'Greeter', replyText: 'Hi' });
      expect(repository.create).toHaveBeenCalledWith({
        sessionId: 's1',
        name: 'Greeter',
        replyText: 'Hi',
        conditions: null,
        cooldownSeconds: 60,
        enabled: true,
      });
    });

    it('refuses a new rule once the per-session cap is reached', async () => {
      repository.count = jest.fn().mockResolvedValue(32);
      const service = build();
      await expect(service.create('s1', { name: 'One too many', replyText: 'Hi' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('a cap of 0 disables the limit', async () => {
      configService.get = jest.fn().mockReturnValue(0);
      repository.count = jest.fn().mockResolvedValue(9999);
      const service = build();
      await expect(service.create('s1', { name: 'Fine', replyText: 'Hi' })).resolves.toBeDefined();
    });
  });

  describe('findAll / findOne / update / remove', () => {
    it('findAll orders by createdAt then id', async () => {
      const service = build();
      await service.findAll('s1');
      expect(repository.find).toHaveBeenCalledWith({
        where: { sessionId: 's1' },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
    });

    it('findOne throws NotFoundException when the rule is absent', async () => {
      const service = build();
      await expect(service.findOne('s1', 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('update only overwrites fields present on the patch', async () => {
      repository.findOne = jest.fn().mockResolvedValue(makeRule());
      const service = build();
      const out = await service.update('s1', 'r1', { cooldownSeconds: 120 });
      expect(out.cooldownSeconds).toBe(120);
      expect(out.name).toBe('Greeter');
    });

    it('remove deletes the rule after loading it (404 if absent)', async () => {
      const rule = makeRule();
      repository.findOne = jest.fn().mockResolvedValue(rule);
      const service = build();
      await service.remove('s1', 'r1');
      expect(repository.remove).toHaveBeenCalledWith(rule);
    });
  });

  describe('evaluateInbound', () => {
    const message = (overrides: Record<string, unknown> = {}) => ({
      fromMe: false,
      chatId: '628111@c.us',
      body: 'hello there',
      timestamp: Math.floor(Date.now() / 1000),
      ...overrides,
    });

    it('never replies to its own outbound echo', async () => {
      repository.find = jest.fn().mockResolvedValue([makeRule()]);
      const service = build();
      await service.evaluateInbound('s1', message({ fromMe: true }));
      expect(repository.find).not.toHaveBeenCalled();
    });

    it('skips a message with no chatId', async () => {
      repository.find = jest.fn().mockResolvedValue([makeRule()]);
      const service = build();
      await service.evaluateInbound('s1', message({ chatId: undefined }));
      expect(repository.find).not.toHaveBeenCalled();
    });

    it('ignores a message older than the freshness window', async () => {
      repository.find = jest.fn().mockResolvedValue([makeRule()]);
      const service = build();
      await service.evaluateInbound('s1', message({ timestamp: Math.floor(Date.now() / 1000) - 3600 }));
      expect(repository.find).not.toHaveBeenCalled();
    });

    it('replies through the lazily-resolved MessageService on first match', async () => {
      const sendText = jest.fn().mockResolvedValue(undefined);
      moduleRef.get.mockReturnValue({ sendText });
      repository.find = jest.fn().mockResolvedValue([makeRule()]);
      const service = build();
      await service.evaluateInbound('s1', message());
      expect(sendText).toHaveBeenCalledWith('s1', { chatId: '628111@c.us', text: 'Thanks for reaching out' });
    });

    it('a disabled/non-matching rule set never sends', async () => {
      moduleRef.get.mockReturnValue({ sendText: jest.fn() });
      repository.find = jest.fn().mockResolvedValue([]);
      const service = build();
      await service.evaluateInbound('s1', message());
      expect(moduleRef.get).not.toHaveBeenCalled();
    });

    it('stays quiet in the same chat for cooldownSeconds after replying', async () => {
      const sendText = jest.fn().mockResolvedValue(undefined);
      moduleRef.get.mockReturnValue({ sendText });
      repository.find = jest.fn().mockResolvedValue([makeRule({ cooldownSeconds: 300 })]);
      const service = build();
      await service.evaluateInbound('s1', message());
      await service.evaluateInbound('s1', message());
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    it('cooldownSeconds: 0 never suppresses a repeat match', async () => {
      const sendText = jest.fn().mockResolvedValue(undefined);
      moduleRef.get.mockReturnValue({ sendText });
      repository.find = jest.fn().mockResolvedValue([makeRule({ cooldownSeconds: 0 })]);
      const service = build();
      await service.evaluateInbound('s1', message());
      await service.evaluateInbound('s1', message());
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    it('swallows a repository failure instead of throwing into the receive path', async () => {
      repository.find = jest.fn().mockRejectedValue(new Error('db down'));
      const service = build();
      await expect(service.evaluateInbound('s1', message())).resolves.toBeUndefined();
    });

    it('swallows a send failure instead of throwing into the receive path', async () => {
      moduleRef.get.mockReturnValue({ sendText: jest.fn().mockRejectedValue(new Error('engine refused')) });
      repository.find = jest.fn().mockResolvedValue([makeRule()]);
      const service = build();
      await expect(service.evaluateInbound('s1', message())).resolves.toBeUndefined();
    });

    it('does nothing when no ModuleRef is available (unit-test-like context)', async () => {
      repository.find = jest.fn().mockResolvedValue([makeRule()]);
      const service = new AutomationRulesService(repository as unknown as Repository<AutomationRule>);
      await expect(service.evaluateInbound('s1', message())).resolves.toBeUndefined();
    });
  });
});
