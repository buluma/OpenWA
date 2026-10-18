import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CloudDownload, FileText, Loader2, Music, Play } from 'lucide-react';
import { sessionApi, type ChatMessage } from '../../services/api';
import { getMediaSrc } from '../../utils/chatMessages';
import { appendMediaPage, fillMissingMedia, hasMediaPayload, mediaTileKind } from '../../utils/chatMedia';
import MediaLightbox, { type LightboxItem } from './MediaLightbox';

// Small pages: every stored row carries its base64 payload, so a 100-row page could be hundreds of MB.
const PAGE_SIZE = 30;
// The live history endpoint caps one call at 100 messages (and a 25 MiB media budget server-side).
const HISTORY_FETCH_LIMIT = 100;

interface ChatMediaPanelProps {
  sessionId: string;
  chatId: string;
  /** Live history with media is whatsapp-web.js only; Baileys has no history fetch. */
  canFetchFromWhatsApp: boolean;
  formatTime: (timestamp?: number) => string;
}

const rowTime = (m: ChatMessage): number => m.timestamp || Math.floor(new Date(m.createdAt).getTime() / 1000);

// The chat's media as a grid, newest first, paged from the DB. A row whose payload was never stored
// shows a placeholder; on whatsapp-web.js the recent ones can be re-fetched from WhatsApp.
export default function ChatMediaPanel({ sessionId, chatId, canFetchFromWhatsApp, formatTime }: ChatMediaPanelProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ChatMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    sessionApi
      .getChatMedia(sessionId, chatId, PAGE_SIZE, 0)
      .then(res => {
        if (cancelled) return;
        setItems(res.messages);
        setTotal(res.total);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, chatId]);

  const loadMore = useCallback(async () => {
    setLoading(true);
    try {
      const res = await sessionApi.getChatMedia(sessionId, chatId, PAGE_SIZE, items.length);
      setItems(prev => appendMediaPage(prev, res.messages));
      setTotal(res.total);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [sessionId, chatId, items.length]);

  const fetchFromWhatsApp = useCallback(async () => {
    setFetching(true);
    setFetchError(false);
    try {
      const history = await sessionApi.getChatHistory(sessionId, chatId, HISTORY_FETCH_LIMIT, true);
      setItems(prev => fillMissingMedia(prev, history));
    } catch {
      setFetchError(true);
    } finally {
      setFetching(false);
    }
  }, [sessionId, chatId]);

  const missingCount = items.filter(m => !hasMediaPayload(m)).length;

  // Only stored images/stickers open in the lightbox; the index maps a tile to its slide.
  const lightboxItems = useMemo<LightboxItem[]>(
    () =>
      items
        .filter(m => mediaTileKind(m.type) === 'image' && hasMediaPayload(m))
        .map(m => ({
          id: m.id,
          url: getMediaSrc(m.metadata?.media),
          alt: m.body || m.metadata?.media?.filename || '',
          timestamp: formatTime(rowTime(m)),
        })),
    [items, formatTime],
  );

  const renderTile = (m: ChatMessage) => {
    const media = m.metadata?.media;
    const kind = mediaTileKind(m.type);
    const time = formatTime(rowTime(m));
    if (!hasMediaPayload(m)) {
      return (
        <div key={m.id} className="media-tile media-tile-missing" title={t('chats.mediaTab.notStored')}>
          <span className="media-tile-type">{t(`chats.mediaTab.type.${kind}`)}</span>
          <span className="media-tile-missing-label">{t('chats.mediaTab.notStored')}</span>
          <span className="media-tile-time">{time}</span>
        </div>
      );
    }
    const src = getMediaSrc(media);
    if (kind === 'image') {
      return (
        <button
          key={m.id}
          type="button"
          className="media-tile"
          onClick={() => setLightboxIndex(lightboxItems.findIndex(x => x.id === m.id))}
        >
          <img src={src} alt={m.body || media?.filename || t('chats.media.image')} loading="lazy" />
          <span className="media-tile-time">{time}</span>
        </button>
      );
    }
    if (kind === 'video') {
      return (
        <div key={m.id} className="media-tile">
          <video src={src} controls preload="metadata" />
          <Play size={16} className="media-tile-badge" aria-hidden="true" />
          <span className="media-tile-time">{time}</span>
        </div>
      );
    }
    if (kind === 'audio') {
      return (
        <div key={m.id} className="media-tile media-tile-wide">
          <Music size={18} aria-hidden="true" />
          <audio src={src} controls preload="none" />
          <span className="media-tile-time">{time}</span>
        </div>
      );
    }
    return (
      <a key={m.id} href={src} download={media?.filename || 'document'} className="media-tile media-tile-wide">
        <FileText size={18} aria-hidden="true" />
        <span className="media-tile-filename">{media?.filename || t('chats.downloadDocument')}</span>
        <span className="media-tile-time">{time}</span>
      </a>
    );
  };

  return (
    <div className="chat-media-panel">
      <div className="chat-media-toolbar">
        <span className="chat-media-count">{t('chats.mediaTab.count', { count: total })}</span>
        {missingCount > 0 && (
          <span className="chat-media-missing">{t('chats.mediaTab.missing', { count: missingCount })}</span>
        )}
        {canFetchFromWhatsApp && missingCount > 0 && (
          <button type="button" className="chat-media-fetch" onClick={fetchFromWhatsApp} disabled={fetching}>
            {fetching ? <Loader2 size={14} className="animate-spin" /> : <CloudDownload size={14} />}
            {t('chats.mediaTab.fetch')}
          </button>
        )}
      </div>
      {fetchError && <div className="chat-media-notice">{t('chats.mediaTab.fetchError')}</div>}

      {error ? (
        <div className="chat-media-notice">{t('chats.mediaTab.loadError')}</div>
      ) : items.length === 0 && !loading ? (
        <div className="chat-media-notice">{t('chats.mediaTab.empty')}</div>
      ) : (
        <div className="chat-media-grid">{items.map(renderTile)}</div>
      )}

      {loading ? (
        <div className="chat-media-notice">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : (
        !error &&
        items.length < total && (
          <button type="button" className="chat-media-more" onClick={loadMore}>
            {t('chats.mediaTab.loadMore')}
          </button>
        )
      )}

      <MediaLightbox
        items={lightboxItems}
        index={lightboxIndex !== null && lightboxIndex >= 0 ? lightboxIndex : null}
        onClose={() => setLightboxIndex(null)}
        onNavigate={setLightboxIndex}
      />
    </div>
  );
}
