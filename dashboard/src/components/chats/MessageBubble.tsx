import { useTranslation } from 'react-i18next';
import { CornerUpLeft, Smile, Trash2 } from 'lucide-react';
import MessageBody from './MessageBody';
import type { ChatMessageView } from '../../utils/chatMessages';
import type { LightboxItem } from './MediaLightbox';

interface MessageMedia {
  mimetype: string;
  filename?: string;
  data?: string;
  omitted?: boolean;
  sizeBytes?: number;
}

function getMediaSrc(media?: MessageMedia): string {
  if (!media || !media.data) return '';
  if (media.data.startsWith('data:') || media.data.startsWith('http://') || media.data.startsWith('https://')) {
    return media.data;
  }
  return `data:${media.mimetype};base64,${media.data}`;
}

interface MessageBubbleProps {
  msg: ChatMessageView;
  isMe: boolean;
  formattedTime: string;
  imageMedia: LightboxItem[];
  onReply: (msg: ChatMessageView) => void;
  onReact: (msg: ChatMessageView, emoji: string) => void;
  onDelete: (msg: ChatMessageView) => void;
  onImageClick: (index: number) => void;
}

export function MessageBubble({
  msg,
  isMe,
  formattedTime,
  imageMedia,
  onReply,
  onReact,
  onDelete,
  onImageClick,
}: MessageBubbleProps) {
  const { t } = useTranslation();

  const isRevoked = msg.type === 'revoked';
  const isMasked = msg.type === 'masked';
  const isMediaMessage = msg.type !== 'text';
  const mediaInfo = msg.metadata?.media as MessageMedia | undefined;
  const reactions = msg.metadata?.reactions || {};
  const hasReactions = Object.keys(reactions).length > 0;

  const renderMedia = () => {
    if (isRevoked) return null;
    if (msg.type === 'location') {
      const thumb = msg.body && msg.body.length > 100 ? `data:image/jpeg;base64,${msg.body}` : '';
      return (
        <div className="message-location">
          {thumb && (
            <img src={thumb} alt="" style={{ maxWidth: 220, borderRadius: 8, display: 'block', marginBottom: 4 }} />
          )}
          <span className="message-media-omitted">📍 {t('chats.media.location')}</span>
        </div>
      );
    }
    if (msg.type === 'call') {
      const call = msg.metadata?.call as { video: boolean; missed: boolean } | undefined;
      const callKey = call?.video
        ? call.missed ? 'callVideoMissed' : 'callVideo'
        : call?.missed ? 'callMissed' : 'call';
      return (
        <div className="message-media-omitted">
          {`${call?.video ? '📹' : '📞'} ${t(`chats.media.${callKey}`)}`}
        </div>
      );
    }
    if (!mediaInfo) return null;
    if (mediaInfo.omitted) {
      return <div className="message-media-omitted">📎 {t('chats.media.omitted')}</div>;
    }
    const mediaSrc = getMediaSrc(mediaInfo);
    if (!mediaSrc) return null;

    switch (msg.type) {
      case 'image':
      case 'sticker':
        return (
          <div className="message-media-image">
            <img
              src={mediaSrc}
              alt={mediaInfo.filename || t('chats.media.image')}
              className="chat-image-media"
              onClick={() => {
                const idx = imageMedia.findIndex(x => x.id === msg.id);
                if (idx >= 0) onImageClick(idx);
              }}
            />
          </div>
        );
      case 'video':
        return (
          <div className="message-media-video">
            <video src={mediaSrc} controls className="chat-video-media" />
          </div>
        );
      case 'audio':
      case 'voice':
        return (
          <div className="message-media-audio">
            <audio src={mediaSrc} controls className="chat-audio-media" />
          </div>
        );
      case 'document':
      default:
        return (
          <div className="message-media-document">
            <a href={mediaSrc} download={mediaInfo.filename || 'document'} className="chat-document-media">
              📎 {mediaInfo.filename || t('chats.downloadDocument')}
            </a>
          </div>
        );
    }
  };

  const showBody =
    !isRevoked &&
    !isMasked &&
    !!msg.body &&
    (!mediaInfo || msg.body !== mediaInfo.filename) &&
    msg.type !== 'location' &&
    msg.type !== 'call';

  return (
    <div className={`message-bubble-wrapper ${isMe ? 'outgoing' : 'incoming'}`}>
      <div className="message-bubble-container">
        <div
          className={`message-bubble ${isMe ? 'outgoing' : 'incoming'} ${msg.status} ${
            isMediaMessage ? 'media-type' : ''
          } ${isRevoked ? 'revoked-type' : ''}`}
        >
          {msg.metadata?.quotedMessage && (
            <div className="message-quote-box">
              <MessageBody text={msg.metadata.quotedMessage.body} className="quote-body" />
            </div>
          )}

          {renderMedia()}

          {isRevoked ? (
            <div className="message-text">{t('chats.messageDeleted')}</div>
          ) : isMasked ? (
            <div className="message-text message-masked">{t('chats.messageMasked')}</div>
          ) : (
            showBody && <MessageBody text={msg.body} className="message-text" />
          )}

          <div className="message-meta">
            <span className="message-time">{formattedTime}</span>
            {isMe && (
              <span className={`message-status-icon ${msg.status}`}>
                {msg.status === 'pending' && '🕒'}
                {msg.status === 'sent' && '✓'}
                {msg.status === 'delivered' && '✓✓'}
                {msg.status === 'read' && '✓✓'}
                {msg.status === 'failed' && '⚠️'}
              </span>
            )}
          </div>

          {hasReactions && (
            <div className="message-reactions-badge">
              {Object.values(reactions).slice(0, 3).map((emoji, idx) => (
                <span key={idx} className="reaction-emoji-span">{emoji as string}</span>
              ))}
              {Object.keys(reactions).length > 1 && (
                <span className="reactions-count-span">{Object.keys(reactions).length}</span>
              )}
            </div>
          )}
        </div>

        {!isRevoked && (
          <div className="message-actions-menu">
            <button type="button" className="action-btn" onClick={() => onReply(msg)} title={t('chats.actions.reply')}>
              <CornerUpLeft size={14} />
            </button>

            <div className="reaction-trigger-wrapper">
              <button type="button" className="action-btn reaction-btn" title={t('chats.actions.react')}>
                <Smile size={14} />
              </button>
              <div className="reaction-quick-popover">
                {['👍', '❤️', '😂', '😮', '😢', '🙏'].map(emoji => (
                  <button key={emoji} type="button" onClick={() => onReact(msg, emoji)}>
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            {isMe && msg.status !== 'pending' && (
              <button
                type="button"
                className="action-btn delete-btn"
                onClick={() => onDelete(msg)}
                title={t('chats.actions.delete')}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
