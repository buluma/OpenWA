import { AutomationRuleController } from './automation-rule.controller';
import { AutomationRulesService } from './automation-rules.service';
import { AutomationRule } from './entities/automation-rule.entity';

describe('AutomationRuleController', () => {
  const build = (service: Partial<Record<keyof AutomationRulesService, jest.Mock>>) => {
    const controller = new AutomationRuleController(service as unknown as AutomationRulesService);
    return { controller, service };
  };

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

  it('POST / creates a rule and maps it through the response DTO', async () => {
    const rule = makeRule();
    const { controller, service } = build({ create: jest.fn().mockResolvedValue(rule) });
    const dto = { name: 'Greeter', replyText: 'Thanks for reaching out' };
    const out = await controller.create('s1', dto);
    expect(service.create).toHaveBeenCalledWith('s1', dto);
    expect(out).toMatchObject({ id: 'r1', sessionId: 's1', name: 'Greeter', replyText: 'Thanks for reaching out' });
  });

  it('GET / lists rules in the order the service returns them', async () => {
    const rules = [makeRule({ id: 'r1' }), makeRule({ id: 'r2' })];
    const { controller, service } = build({ findAll: jest.fn().mockResolvedValue(rules) });
    const out = await controller.findAll('s1');
    expect(service.findAll).toHaveBeenCalledWith('s1');
    expect(out.map(r => r.id)).toEqual(['r1', 'r2']);
  });

  it('GET /:ruleId delegates to the service (404 mapping lives there)', async () => {
    const { controller, service } = build({ findOne: jest.fn().mockResolvedValue(makeRule()) });
    const out = await controller.findOne('s1', 'r1');
    expect(service.findOne).toHaveBeenCalledWith('s1', 'r1');
    expect(out.id).toBe('r1');
  });

  it('GET /:ruleId propagates a not-found rejection', async () => {
    const { controller } = build({ findOne: jest.fn().mockRejectedValue(new Error('Automation rule r1 not found')) });
    await expect(controller.findOne('s1', 'r1')).rejects.toThrow(/not found/);
  });

  it('PUT /:ruleId forwards the patch and returns the updated rule', async () => {
    const updated = makeRule({ name: 'Renamed' });
    const { controller, service } = build({ update: jest.fn().mockResolvedValue(updated) });
    const dto = { name: 'Renamed' };
    const out = await controller.update('s1', 'r1', dto);
    expect(service.update).toHaveBeenCalledWith('s1', 'r1', dto);
    expect(out.name).toBe('Renamed');
  });

  it('DELETE /:ruleId delegates to the service and returns nothing', async () => {
    const { controller, service } = build({ remove: jest.fn().mockResolvedValue(undefined) });
    await expect(controller.remove('s1', 'r1')).resolves.toBeUndefined();
    expect(service.remove).toHaveBeenCalledWith('s1', 'r1');
  });
});
