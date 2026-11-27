import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatDisplayName, chatHeaderDisplayName, savedChatName, shouldShowTechnicalChatId } from './chatIdentity.ts';
import { isolateNumber } from './formatPhone.ts';

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

// A privacy-id chat the session maps to a phone: that phone titles it, unless it has a name of its own.
const LID = '262813461250072@lid';
const PHONE = '15550006666';

test('an unnamed privacy-id chat is titled by its mapped phone, and degrades to its id digits without one', () => {
  assert.equal(chatDisplayName({ id: LID, name: '', phone: PHONE }), isolateNumber('+1 555 000 6666'));
  assert.equal(chatDisplayName({ id: LID, name: '262813461250072', phone: PHONE }), isolateNumber('+1 555 000 6666'));
  assert.equal(chatDisplayName({ id: LID, name: '262813461250072' }), '262813461250072');
  assert.equal(chatDisplayName({ id: LID, name: 'Lia', phone: PHONE }), 'Lia');
  // A WhatsApp username still wins over the number, as it does over the bare id.
  assert.equal(chatDisplayName({ id: LID, name: '', username: 'lia', phone: PHONE }), '@lia');
  assert.equal(
    chatHeaderDisplayName({ id: LID, name: '262813461250072', phone: PHONE }),
    isolateNumber('+1 555 000 6666'),
  );
});

test('a name that is only the mapped phone or the id number is no name; one with other words is', () => {
  for (const name of [PHONE, ' +1 555 000 6666 ', '+1 (555) 000-6666', `${LID}`]) {
    assert.equal(savedChatName({ id: LID, name, phone: PHONE }), undefined, name);
  }
  for (const name of ['Taxi 15550006666', 'Mom (15550006666)']) {
    assert.equal(savedChatName({ id: LID, name, phone: PHONE }), name);
  }
  // A phone id spelled out as the name, bare or with its suffix, is no name either.
  assert.equal(savedChatName({ id: '15550001111@c.us', name: '15550001111@c.us' }), undefined);
  assert.equal(chatDisplayName({ id: '15550001111@c.us', name: '15550001111@c.us' }), '15550001111');
});
