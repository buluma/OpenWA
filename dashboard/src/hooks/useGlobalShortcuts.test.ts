import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchShortcut, type ShortcutAction } from './useGlobalShortcuts.ts';

function event(overrides: Partial<{
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  tagName: string;
  contentEditable: boolean;
}> = {}): Parameters<typeof matchShortcut>[0] {
  return {
    key: overrides.key ?? '',
    ctrlKey: overrides.ctrlKey ?? false,
    metaKey: overrides.metaKey ?? false,
    target: {
      tagName: overrides.tagName ?? 'BODY',
      isContentEditable: overrides.contentEditable ?? false,
    },
  };
}

function assertAction(ev: ReturnType<typeof event>, expected: ShortcutAction) {
  assert.equal(matchShortcut(ev), expected);
}

test('Escape from body: fires escape', () => {
  assertAction(event({ key: 'Escape' }), 'escape');
});

test('Escape from inside an input: still fires escape (never suppressed)', () => {
  assertAction(event({ key: 'Escape', tagName: 'INPUT' }), 'escape');
  assertAction(event({ key: 'Escape', tagName: 'TEXTAREA' }), 'escape');
  assertAction(event({ key: 'Escape', tagName: 'SELECT' }), 'escape');
});

test('Ctrl+K from body: fires palette', () => {
  assertAction(event({ key: 'k', ctrlKey: true }), 'palette');
});

test('Cmd+K (metaKey): fires palette', () => {
  assertAction(event({ key: 'k', metaKey: true }), 'palette');
});

test('Ctrl+K inside an input: suppressed (null)', () => {
  assertAction(event({ key: 'k', ctrlKey: true, tagName: 'INPUT' }), null);
});

test('Ctrl+N: fires newItem', () => {
  assertAction(event({ key: 'n', ctrlKey: true }), 'newItem');
});

test('Ctrl+,: fires settings', () => {
  assertAction(event({ key: ',', ctrlKey: true }), 'settings');
});

test('plain letter key: returns null', () => {
  assertAction(event({ key: 'a' }), null);
});

test('Ctrl+Shift+K: still fires palette (ctrlKey alone is enough)', () => {
  assertAction(event({ key: 'k', ctrlKey: true }), 'palette');
});

test('contentEditable element: suppresses non-Escape shortcuts', () => {
  assertAction(event({ key: 'k', ctrlKey: true, contentEditable: true }), null);
  assertAction(event({ key: 'Escape', contentEditable: true }), 'escape');
});

test('unknown modifier+key combo: returns null', () => {
  assertAction(event({ key: 'x', ctrlKey: true }), null);
});
