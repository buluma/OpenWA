import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatHeaderDisplayName, shouldShowTechnicalChatId } from './chatIdentity.ts';

test('a resolved privacy-id chat uses its WhatsApp username in the room heading', () => {
  assert.equal(
    chatHeaderDisplayName({ id: '111931729912054@lid', name: '111931729912054', username: 'call_me_kira' }),
    '@call_me_kira',
  );
});

test('hide a privacy id when the username and resolved phone identify the contact', () => {
  assert.equal(shouldShowTechnicalChatId({ id: '111931729912054@lid', username: '@call_me_kira' }, true), false);
  assert.equal(shouldShowTechnicalChatId({ id: '111931729912054@lid', username: 'call_me_kira' }, false), true);
  assert.equal(shouldShowTechnicalChatId({ id: '628123456789@c.us', username: 'call_me_kira' }, true), true);
});
