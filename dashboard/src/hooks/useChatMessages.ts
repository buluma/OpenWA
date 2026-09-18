import { useCallback, useRef, useState } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  mergeChatMessages,
  mapEngineHistoryMessage,
  mergeOrAppend,
  updateMessageById,
  removeMessageById,
  type ChatMessageView,
} from '../utils/chatMessages';
import { sessionApi } from '../services/api';

export type MessagesQueryKey = readonly ['messages', string, string];

export function messagesQueryKey(sessionId: string, chatId: string): MessagesQueryKey {
  return ['messages', sessionId, chatId] as const;
}

// Shared between the initial load and each older page, so a page boundary means the same thing on
// both ends of the fetch.
const MESSAGES_PAGE_SIZE = 100;

/**
 * Fetch messages for one (sessionId, chatId) and keep them cached (staleTime: Infinity); realtime
 * updates flow through useChatMessagesActions, not refetches. Engine history is fetched WITHOUT media
 * to keep the cache small — a single 50 MiB message would otherwise sit in heap as base64 (held twice
 * as a `data:` URI). Recent media still renders from the DB copy (which wins in mergeChatMessages);
 * older history media shows the omitted placeholder. Live/DB payloads that do arrive are additionally
 * bounded per slice: mergeChatMessages/mergeOrAppend run the result through capMediaPayloads, which
 * strips the oldest base64 beyond MEDIA_PAYLOAD_CACHE_LIMIT so a long media-heavy session can't grow
 * the tab's heap without bound. Cache eviction happens 5 min after the chat stops being observed
 * (gcTime), so browsing several media-rich chats doesn't accumulate large slices.
 */
export function useChatMessages(sessionId: string, chatId: string | null): UseQueryResult<ChatMessageView[], Error> {
  return useQuery<ChatMessageView[], Error>({
    queryKey: messagesQueryKey(sessionId, chatId ?? ''),
    queryFn: async () => {
      const [dbRes, historyRes] = await Promise.allSettled([
        sessionApi.getChatMessages(sessionId, chatId!, MESSAGES_PAGE_SIZE),
        sessionApi.getChatHistory(sessionId, chatId!, MESSAGES_PAGE_SIZE, false),
      ]);
      if (dbRes.status === 'rejected' && historyRes.status === 'rejected') throw dbRes.reason;
      const dbMessages = dbRes.status === 'fulfilled' ? dbRes.value.messages : [];
      const history = historyRes.status === 'fulfilled' ? historyRes.value.map(mapEngineHistoryMessage) : [];
      return mergeChatMessages(dbMessages, history);
    },
    enabled: Boolean(sessionId && chatId),
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
  });
}

/**
 * Mutation helpers that write directly to the React Query cache. Use these
 * from the WebSocket subscriber, the optimistic-send flow, and ACK handlers
 * instead of calling setMessages locally.
 */
export function useChatMessagesActions() {
  const qc = useQueryClient();

  return {
    appendMessage(sessionId: string, chatId: string, msg: ChatMessageView) {
      // Only append to a slice that already exists (a chat that has been opened). Do NOT seed a slice
      // for a never-opened chat: with staleTime: Infinity that phantom slice would be "fresh", so
      // opening the chat would skip the full-history queryFn and show only this one message (truncated
      // history). Returning undefined from the updater is a no-op when there is no cached data.
      qc.setQueryData<ChatMessageView[]>(messagesQueryKey(sessionId, chatId), old =>
        old === undefined ? undefined : mergeOrAppend(old, msg),
      );
    },
    updateMessage(sessionId: string, chatId: string, id: string, patch: Partial<ChatMessageView>) {
      qc.setQueryData<ChatMessageView[]>(messagesQueryKey(sessionId, chatId), (old = []) =>
        updateMessageById(old, id, patch),
      );
    },
    removeMessage(sessionId: string, chatId: string, id: string) {
      qc.setQueryData<ChatMessageView[]>(messagesQueryKey(sessionId, chatId), (old = []) => removeMessageById(old, id));
    },
  };
}

/**
 * Loads older DB-backed history a page at a time and prepends it into the same React Query cache
 * `useChatMessages` reads, so the merged slice a chat renders stays the single source of truth.
 *
 * The next offset to fetch is tracked per chat in a ref (not state — advancing it must not itself
 * trigger a render), seeded at MESSAGES_PAGE_SIZE because that's exactly how many DB rows the initial
 * load in useChatMessages already asked for. `total` from the DB response marks a chat exhausted once
 * the offset reaches it, so a chat with e.g. 40 messages never re-requests after the first empty page.
 * mergeChatMessages treats the already-cached slice as authoritative on any id collision (mirrors the
 * initial db/history merge), though a real collision here would mean the same row arrived twice across
 * pages — harmless either way since the map dedupes by id.
 */
export function useLoadOlderMessages() {
  const qc = useQueryClient();
  const offsets = useRef<Map<string, number>>(new Map());
  const exhausted = useRef<Set<string>>(new Set());
  const [loadingChatIds, setLoadingChatIds] = useState<Set<string>>(new Set());

  const loadOlder = useCallback(
    async (sessionId: string, chatId: string): Promise<boolean> => {
      const key = `${sessionId}:${chatId}`;
      if (exhausted.current.has(key) || loadingChatIds.has(key)) return false;

      setLoadingChatIds(prev => new Set(prev).add(key));
      try {
        const offset = offsets.current.get(key) ?? MESSAGES_PAGE_SIZE;
        const { messages, total } = await sessionApi.getChatMessages(sessionId, chatId, MESSAGES_PAGE_SIZE, offset);
        offsets.current.set(key, offset + messages.length);
        if (messages.length === 0 || offset + messages.length >= total) exhausted.current.add(key);
        if (messages.length === 0) return false;

        qc.setQueryData<ChatMessageView[]>(messagesQueryKey(sessionId, chatId), (old = []) =>
          mergeChatMessages(old, messages),
        );
        return true;
      } finally {
        setLoadingChatIds(prev => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [qc, loadingChatIds],
  );

  return {
    loadOlder,
    isLoadingOlder: (sessionId: string, chatId: string) => loadingChatIds.has(`${sessionId}:${chatId}`),
  };
}
