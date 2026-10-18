import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendMediaPage, fillMissingMedia, hasMediaPayload, mediaTileKind } from './chatMedia.ts';
import type { ChatMessage, EngineHistoryMessage } from '../services/api';

const row = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'row-1',
  waMessageId: 'wa-1',
  chatId: 'c@c.us',
  from: 'c@c.us',
  to: 'me@c.us',
  body: '',
  type: 'image',
  direction: 'incoming',
  status: 'read',
  timestamp: 1790000000,
  createdAt: '2026-09-21T00:00:00.000Z',
  ...over,
});

const hist = (over: Partial<EngineHistoryMessage> = {}): EngineHistoryMessage => ({
  id: 'wa-1',
  chatId: 'c@c.us',
  from: 'c@c.us',
  to: 'me@c.us',
  body: '',
  type: 'image',
  timestamp: 1790000000,
  ...over,
});

test('hasMediaPayload is true only when the row carries the bytes', () => {
  assert.equal(hasMediaPayload(row({ metadata: { media: { mimetype: 'image/jpeg', data: 'AAAA' } } })), true);
  assert.equal(hasMediaPayload(row({ metadata: { media: { mimetype: '', omitted: true } } })), false);
  assert.equal(hasMediaPayload(row({ metadata: undefined })), false);
});

test('mediaTileKind groups types by how the tile renders', () => {
  assert.equal(mediaTileKind('image'), 'image');
  assert.equal(mediaTileKind('sticker'), 'image');
  assert.equal(mediaTileKind('video'), 'video');
  assert.equal(mediaTileKind('voice'), 'audio');
  assert.equal(mediaTileKind('audio'), 'audio');
  assert.equal(mediaTileKind('document'), 'document');
});

test('fillMissingMedia fills a missing payload from history matched by WhatsApp id, keeping stored ones', () => {
  const stored = row({
    id: 'r-stored',
    waMessageId: 'wa-s',
    metadata: { media: { mimetype: 'image/png', data: 'KEEP' } },
  });
  const missing = row({ id: 'r-missing', waMessageId: 'wa-m', metadata: undefined });
  const untouched = row({ id: 'r-other', waMessageId: 'wa-x', metadata: { media: { mimetype: '', omitted: true } } });
  const out = fillMissingMedia(
    [stored, missing, untouched],
    [
      hist({ id: 'wa-s', media: { mimetype: 'image/png', data: 'OVERWRITE' } }),
      hist({ id: 'wa-m', media: { mimetype: 'image/jpeg', data: 'FILLED' } }),
      hist({ id: 'wa-unknown', media: { mimetype: 'image/jpeg', data: 'IGNORED' } }),
    ],
  );
  assert.equal(out.length, 3);
  assert.equal(out[0].metadata?.media?.data, 'KEEP');
  assert.deepEqual(out[1].metadata?.media, { mimetype: 'image/jpeg', data: 'FILLED' });
  assert.equal(out[2].metadata?.media?.omitted, true);
});

test('appendMediaPage drops rows already listed, so a page shifted by new arrivals does not repeat', () => {
  const a = row({ id: 'a', waMessageId: 'wa-a' });
  const b = row({ id: 'b', waMessageId: 'wa-b' });
  const c = row({ id: 'c', waMessageId: 'wa-c' });
  assert.deepEqual(
    appendMediaPage([a, b], [b, c]).map(m => m.id),
    ['a', 'b', 'c'],
  );
});
