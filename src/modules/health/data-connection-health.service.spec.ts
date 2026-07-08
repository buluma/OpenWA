import { DataConnectionHealthService, type DataConnectionHealthStatus } from './data-connection-health.service';

interface FakeDataSource {
  query: jest.Mock;
  destroy: jest.Mock;
  initialize: jest.Mock;
  isInitialized: boolean;
}

function makeDataSource(overrides: Partial<FakeDataSource> = {}): FakeDataSource {
  return {
    query: jest.fn().mockResolvedValue([{ 1: 1 }]),
    destroy: jest.fn().mockResolvedValue(undefined),
    initialize: jest.fn().mockResolvedValue(undefined),
    isInitialized: true,
    ...overrides,
  };
}

/** probeAndHeal is private — this test surface is deliberately narrow (only the members these
 * tests actually call) rather than intersected with the real class, which confuses eslint's type
 * resolution across the private/public boundary. Mirrors how whatsapp-web-js.adapter.spec.ts reaches
 * into adapter-private state for its own self-heal tests. */
interface TestableService {
  getStatus: () => DataConnectionHealthStatus;
  probeAndHeal: () => Promise<void>;
  onModuleInit: () => void;
  onModuleDestroy: () => void;
}

function service(dataSource: FakeDataSource): TestableService {
  return new DataConnectionHealthService(dataSource as never) as unknown as TestableService;
}

describe('DataConnectionHealthService', () => {
  it('reports healthy after a successful probe', async () => {
    const ds = makeDataSource();
    const svc = service(ds);

    await svc.probeAndHeal();

    expect(svc.getStatus()).toMatchObject({ healthy: true, lastError: null, reconnectAttempts: 0 });
    expect(ds.destroy).not.toHaveBeenCalled();
  });

  it('marks unhealthy and attempts a reconnect on a failed probe', async () => {
    const ds = makeDataSource({
      query: jest
        .fn()
        .mockRejectedValueOnce(new Error('SQLITE_CANTOPEN'))
        .mockResolvedValue([{ 1: 1 }]),
    });
    const svc = service(ds);

    await svc.probeAndHeal();

    expect(ds.destroy).toHaveBeenCalledTimes(1);
    expect(ds.initialize).toHaveBeenCalledTimes(1);
    // The reconnect's own verification query succeeded, so status is healthy again immediately —
    // no need to wait for the next scheduled probe.
    expect(svc.getStatus()).toMatchObject({ healthy: true, lastError: null, reconnectAttempts: 0 });
    expect(svc.getStatus().lastReconnectAt).not.toBeNull();
  });

  it('does not call destroy() on an already-uninitialized DataSource', async () => {
    const ds = makeDataSource({
      query: jest
        .fn()
        .mockRejectedValueOnce(new Error('SQLITE_CANTOPEN'))
        .mockResolvedValue([{ 1: 1 }]),
      isInitialized: false,
    });
    const svc = service(ds);

    await svc.probeAndHeal();

    expect(ds.destroy).not.toHaveBeenCalled();
    expect(ds.initialize).toHaveBeenCalledTimes(1);
  });

  it('tolerates destroy() throwing and still attempts initialize()', async () => {
    const ds = makeDataSource({
      query: jest
        .fn()
        .mockRejectedValueOnce(new Error('SQLITE_CANTOPEN'))
        .mockResolvedValue([{ 1: 1 }]),
      destroy: jest.fn().mockRejectedValue(new Error('already closed')),
    });
    const svc = service(ds);

    await svc.probeAndHeal();

    expect(ds.initialize).toHaveBeenCalledTimes(1);
    expect(svc.getStatus().healthy).toBe(true);
  });

  it('stays unhealthy and increments reconnectAttempts when the reconnect itself fails', async () => {
    const ds = makeDataSource({
      query: jest.fn().mockRejectedValue(new Error('SQLITE_CANTOPEN')),
      initialize: jest.fn().mockRejectedValue(new Error('still broken')),
    });
    const svc = service(ds);

    await svc.probeAndHeal();

    const status = svc.getStatus();
    expect(status.healthy).toBe(false);
    expect(status.reconnectAttempts).toBe(1);
  });

  it('gives up after the max consecutive reconnect attempts instead of retrying forever', async () => {
    const ds = makeDataSource({
      query: jest.fn().mockRejectedValue(new Error('SQLITE_CANTOPEN')),
      initialize: jest.fn().mockRejectedValue(new Error('still broken')),
    });
    const svc = service(ds);

    for (let i = 0; i < 5; i++) {
      await svc.probeAndHeal();
    }
    expect(svc.getStatus().reconnectAttempts).toBe(5);
    expect(ds.initialize).toHaveBeenCalledTimes(5);

    // A 6th failed probe must not attempt a 6th reconnect — the cap holds.
    await svc.probeAndHeal();
    expect(ds.initialize).toHaveBeenCalledTimes(5);
    expect(svc.getStatus()).toMatchObject({ healthy: false, reconnectAttempts: 5 });
  });

  it('resets reconnectAttempts to 0 once a probe succeeds again', async () => {
    const ds = makeDataSource({
      query: jest
        .fn()
        .mockRejectedValueOnce(new Error('SQLITE_CANTOPEN'))
        .mockResolvedValue([{ 1: 1 }]),
      initialize: jest.fn().mockRejectedValueOnce(new Error('still broken')).mockResolvedValue(undefined),
    });
    const svc = service(ds);

    await svc.probeAndHeal(); // fails, reconnect also fails -> reconnectAttempts=1
    expect(svc.getStatus().reconnectAttempts).toBe(1);

    await svc.probeAndHeal(); // this probe's own query() call now resolves -> back to healthy
    expect(svc.getStatus()).toMatchObject({ healthy: true, reconnectAttempts: 0 });
  });

  it('registers and clears a probe interval across the module lifecycle', () => {
    jest.useFakeTimers();
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    const ds = makeDataSource();
    const svc = service(ds);

    svc.onModuleInit();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    svc.onModuleDestroy();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    jest.useRealTimers();
  });
});
