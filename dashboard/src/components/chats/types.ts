import type { MessageType } from '../../services/api';

export interface MessageMedia {
  mimetype: string;
  filename?: string;
  data?: string;
  omitted?: boolean;
  sizeBytes?: number;
}

export interface ChatMessageView {
  id: string;
  waMessageId?: string;
  chatId: string;
  from: string;
  to: string;
  body: string;
  type: MessageType;
  direction: 'incoming' | 'outgoing';
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  timestamp?: number;
  createdAt: string;
  metadata?: {
    media?: MessageMedia;
    quotedMessage?: { id: string; body: string };
    reactions?: Record<string, string>;
    call?: { video: boolean; missed: boolean };
  };
}

export interface LightboxItem {
  id: string;
  url: string;
  alt: string;
  senderName?: string;
  timestamp?: string;
}
