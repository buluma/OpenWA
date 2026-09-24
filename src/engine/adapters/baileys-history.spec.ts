import type { WASocket } from '@whiskeysockets/baileys';
import { BaileysHistory, BaileysHistoryHost } from './baileys-history';

/**
 * `groupFetchAllParticipating` yields `{}` for BOTH an unanswered query and an account with no groups —
 * the same ambiguity `getGroups` is bounded against in baileys-groups.ts. Nothing in the VALUE separates
 * them, so only a clock we own can.
 *
 * That makes the stub shape load-bearing: a stub resolving `{}` immediately models the BENIGN case, and
 * a test built on it passes with or without a deadline. The unanswered case has to be modelled as a
 * promise that does not settle, with the clock advanced past the budget.
 */

const PATCH_NAMES = ['critical_block', 'regular'] as const;

function history(sock: Record<string, unknown> = {}, opts: { contactCount?: number } = {}) {
  const logger = { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() };
  const upsertChats = jest.fn();
  const socket = {
    authState: {
      creds: { accountSyncCounter: 0 },
      keys: { set: jest.fn().mockResolvedValue(undefined) },
    },
    resyncAppState: jest.fn().mockResolvedValue(undefined),
    ...sock,
  };
  const host = {
    getSocket: () => socket as unknown as WASocket,
    logger,
    upsertChats,
    contactCount: () => opts.contactCount ?? 0,
    loadLib: () => Promise.resolve({ ALL_WA_PATCH_NAMES: [...PATCH_NAMES] }),
  } as unknown as BaileysHistoryHost;
  return { history: new BaileysHistory(host), logger, upsertChats, socket };
}

describe('hydrateNames', () => {
  afterEach(() => jest.useRealTimers());

  it('re-pulls the address-book snapshot on reconnect when the in-memory store is empty', async () => {
    // Baileys skips history + app-state snapshot once accountSyncCounter > 0. The gateway store is
    // in-memory, so a process restart would otherwise leave GET /contacts empty forever.
    const set = jest.fn().mockResolvedValue(undefined);
    const resyncAppState = jest.fn().mockResolvedValue(undefined);
    const { history: h } = history(
      {
        groupFetchAllParticipating: jest.fn().mockResolvedValue({}),
        resyncAppState,
        authState: { creds: { accountSyncCounter: 1 }, keys: { set } },
      },
      { contactCount: 0 },
    );

    await h.hydrateNames();

    // Only the contact collection is snapshotted; the others keep their versions and the ordinary
    // incremental resync still runs afterwards.
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ 'app-state-sync-version': { critical_unblock_low: null } });
    expect(resyncAppState.mock.calls).toEqual([
      [['critical_unblock_low'], true],
      [[...PATCH_NAMES], false],
    ]);
  });

  it('keeps the incremental resync on reconnect when contacts are already in memory', async () => {
    const set = jest.fn().mockResolvedValue(undefined);
    const resyncAppState = jest.fn().mockResolvedValue(undefined);
    const { history: h } = history(
      {
        groupFetchAllParticipating: jest.fn().mockResolvedValue({}),
        resyncAppState,
        authState: { creds: { accountSyncCounter: 3 }, keys: { set } },
      },
      { contactCount: 12 },
    );

    await h.hydrateNames();

    expect(set).not.toHaveBeenCalled();
    expect(resyncAppState).toHaveBeenCalledWith([...PATCH_NAMES], false);
  });

  it('uses the incremental resync on a first link (accountSyncCounter is still 0)', async () => {
    // First connect still has Baileys' own snapshot path in flight; forcing another snapshot would
    // race it. Empty contacts here are the boot window, not a missed reconnect.
    const set = jest.fn().mockResolvedValue(undefined);
    const resyncAppState = jest.fn().mockResolvedValue(undefined);
    const { history: h } = history(
      {
        groupFetchAllParticipating: jest.fn().mockResolvedValue({}),
        resyncAppState,
        authState: { creds: { accountSyncCounter: 0 }, keys: { set } },
      },
      { contactCount: 0 },
    );

    await h.hydrateNames();

    expect(set).not.toHaveBeenCalled();
    expect(resyncAppState).toHaveBeenCalledWith([...PATCH_NAMES], false);
  });
});
