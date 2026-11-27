// `/name` in the composer inserts the highlighted session template into the field; it never sends it. A draft that no
// template resolves is sent as typed.
import '../../test-helpers/register-hooks.ts';
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, useState, type ReactNode } from 'react';
import type { Chat } from '../../services/api.ts';
import type { ChatMessageView } from '../../utils/chatMessages.ts';
import type { StagedAttachment } from './ChatComposer.tsx';

let rtl: typeof import('@testing-library/react');
let ChatComposer: (typeof import('./ChatComposer.tsx'))['default'];
let wrap: (children: ReactNode) => ReactNode;
let queryClient: import('@tanstack/react-query').QueryClient;

const chat: Chat = {
  id: 'alice@c.us',
  name: 'Alice',
  isGroup: false,
  kind: 'individual',
  unreadCount: 0,
  timestamp: 0,
  archived: false,
  pinned: false,
  muted: false,
};

type TemplateRow = { id: string; name: string; body: string; header?: string | null; footer?: string | null };

const HOLA: TemplateRow = { id: 'h', name: 'hola', body: 'Hola! En que te ayudo?' };
const HORARIO: TemplateRow = { id: 'r', name: 'horario', body: 'Abrimos de 9 a 18.' };
const PEDIDO: TemplateRow = { id: 'p', name: 'pedido', header: 'Nucleo', body: 'Hi {{customer.name}}, order {otp}' };
const PEDIDO_TEXT = 'Nucleo\n\nHi {{customer.name}}, order {otp}';
const NEEDS_VARIABLES = "Fill in the template's placeholders before sending.";
// A condition is waited for up to this long, so a loaded machine makes the test slower and not wrong.
const DEADLINE = { timeout: 10_000 };

let templates: TemplateRow[] = [];
const sent: Array<{ path: string; text?: string }> = [];

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

before(async () => {
  const { installJsdomGlobals } = await import('../../test-helpers/jsdom.ts');
  await installJsdomGlobals();
  // jsdom has no layout, and so no scrollIntoView.
  Element.prototype.scrollIntoView = () => undefined;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(typeof input === 'string' ? input : input.toString(), 'http://localhost').pathname;
    if (path.includes('/templates')) return Promise.resolve(json(templates));
    sent.push({ path, text: (JSON.parse(String(init?.body ?? '{}')) as { text?: string }).text });
    return Promise.resolve(json({ messageId: `sent-${sent.length}` }));
  }) as typeof fetch;
  const { i18nReady } = await import('../../i18n/index.ts');
  await i18nReady;
  rtl = await import('@testing-library/react');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { ToastProvider } = await import('../Toast.tsx');
  const { RoleContext } = await import('../../hooks/useRole.tsx');
  // Short GC so the templates query does not keep the process alive after the last test.
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 1_000 } } });
  const role = {
    role: 'admin' as const,
    setRole: () => undefined,
    isAdmin: true,
    isOperator: false,
    isViewer: false,
    canWrite: true,
    engineType: null,
    setEngineType: () => undefined,
    scoped: false,
    setScoped: () => undefined,
  };
  wrap = children =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(RoleContext.Provider, { value: role }, createElement(ToastProvider, null, children)),
    );
  ({ default: ChatComposer } = await import('./ChatComposer.tsx'));
});

afterEach(() => {
  rtl.cleanup();
  queryClient.clear();
  templates = [];
  sent.length = 0;
});

after(() => {
  rtl?.cleanup();
  queryClient?.clear();
});

function Harness() {
  const [messageInput, setMessageInput] = useState('');
  const [attachment, setAttachment] = useState<StagedAttachment | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessageView | null>(null);
  return createElement(ChatComposer, {
    selectedSessionId: 'sess-1',
    activeChat: chat,
    replyingTo,
    setReplyingTo,
    onMessageAppended: () => undefined,
    onSent: () => undefined,
    messageInput,
    setMessageInput,
    attachment,
    setAttachment,
    previewUrl,
    setPreviewUrl,
  });
}

const field = () => document.querySelector('.message-text-input') as HTMLTextAreaElement;
const sendButton = () => rtl.screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
const options = () => Array.from(document.querySelectorAll('[role="option"]'));

// Renders the composer once the session's templates have loaded, with focus in the field.
async function renderComposer(): Promise<void> {
  rtl.render(wrap(createElement(Harness)));
  await rtl.waitFor(() => assert.ok(field().placeholder.includes('/template')), DEADLINE);
  rtl.fireEvent.focus(field());
}

async function type(value: string): Promise<void> {
  rtl.fireEvent.change(field(), { target: { value } });
  await rtl.act(async () => undefined);
}

test('a slash word lists the templates it matches, and Enter inserts the highlighted one without sending', async () => {
  templates = [HORARIO, HOLA, PEDIDO];
  await renderComposer();
  await type('/ho');
  assert.deepEqual(
    options().map(o => o.querySelector('.slash-template-name')?.textContent),
    ['/hola', '/horario'],
  );
  assert.equal(field().getAttribute('role'), 'combobox');
  assert.equal(options()[0].getAttribute('aria-selected'), 'true');

  rtl.fireEvent.keyDown(field(), { key: 'Enter' });
  await rtl.waitFor(() => assert.equal(field().value, HOLA.body), DEADLINE);
  assert.equal(sent.length, 0, 'the template was sent instead of inserted');
  assert.equal(options().length, 0, 'the picker stayed open over the inserted text');

  // The next Enter sends the text that is in the field.
  rtl.fireEvent.keyDown(field(), { key: 'Enter' });
  await rtl.waitFor(() => assert.equal(sent.length, 1), DEADLINE);
  assert.equal(sent[0].text, HOLA.body);
});

test('the arrow keys move the highlight, and a click on a row inserts that template', async () => {
  templates = [HOLA, HORARIO];
  await renderComposer();
  await type('/ho');
  rtl.fireEvent.keyDown(field(), { key: 'ArrowDown' });
  assert.equal(options()[1].getAttribute('aria-selected'), 'true');
  rtl.fireEvent.keyDown(field(), { key: 'Enter' });
  await rtl.waitFor(() => assert.equal(field().value, HORARIO.body), DEADLINE);

  await type('/hol');
  rtl.fireEvent.mouseDown(options()[0], { button: 0 });
  await rtl.waitFor(() => assert.equal(field().value, HOLA.body), DEADLINE);
  assert.equal(sent.length, 0);
});

test('Escape closes the picker, and the slash word is then sent as typed', async () => {
  templates = [HOLA];
  await renderComposer();
  await type('/hola');
  assert.equal(options().length, 1);
  rtl.fireEvent.keyDown(field(), { key: 'Escape' });
  assert.equal(options().length, 0);
  rtl.fireEvent.keyDown(field(), { key: 'Enter' });
  await rtl.waitFor(() => assert.equal(sent.length, 1), DEADLINE);
  assert.equal(sent[0].text, '/hola');
});

test('a slash word that no template matches is sent as typed', async () => {
  templates = [HOLA];
  await renderComposer();
  await type('/start');
  assert.equal(document.querySelector('.slash-template-empty')?.textContent, 'No template matches');
  rtl.fireEvent.keyDown(field(), { key: 'Enter' });
  await rtl.waitFor(() => assert.equal(sent.length, 1), DEADLINE);
  assert.equal(sent[0].text, '/start');
});

test('a template with placeholders is held until it is edited, and the composer says why', async () => {
  templates = [PEDIDO];
  await renderComposer();
  await type('/pedido');
  rtl.fireEvent.keyDown(field(), { key: 'Enter' });
  await rtl.waitFor(() => assert.equal(field().value, PEDIDO_TEXT), DEADLINE);
  // The first placeholder is selected, so typing replaces it.
  assert.equal(field().value.slice(field().selectionStart, field().selectionEnd), '{{customer.name}}');
  assert.equal(document.querySelector('.input-hint')?.textContent, NEEDS_VARIABLES);
  assert.equal(sendButton().disabled, true);

  // Whitespace around it edits nothing of what would go out.
  await type(`${PEDIDO_TEXT}\n`);
  rtl.fireEvent.keyDown(field(), { key: 'Enter' });
  await rtl.act(async () => undefined);
  assert.equal(sent.length, 0, 'the template went out with its placeholders unfilled');

  const filled = 'Nucleo\n\nHi Ana, order 1234';
  await type(filled);
  assert.equal(sendButton().disabled, false);
  rtl.fireEvent.keyDown(field(), { key: 'Enter' });
  await rtl.waitFor(() => assert.equal(sent.length, 1), DEADLINE);
  assert.equal(sent[0].text, filled);
});
