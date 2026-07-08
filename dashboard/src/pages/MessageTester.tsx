import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, CheckCircle, XCircle, Loader2, Clock, Trash2 } from 'lucide-react';
import { messageApi, contactApi } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks';
import { useSessionsQuery, useSessionGroupsQuery } from '../hooks/queries';
import { PageHeader } from '../components/PageHeader';
import './MessageTester.css';

interface ApiResponse {
  success: boolean;
  messageId?: string;
  timestamp: string;
  error?: string;
}

interface HistoryEntry {
  id: string;
  sessionName: string;
  recipient: string;
  type: string;
  content: string;
  response: ApiResponse;
  time: number;
}

const messageTypes = ['text', 'image', 'video', 'audio', 'document'] as const;

// Keep last 20 sends in memory (session-scoped, resets on page reload as intended).
const MAX_HISTORY = 20;

export function MessageTester() {
  const { t } = useTranslation();
  useDocumentTitle(t('messageTester.title'));
  const { canWrite } = useRole();
  const { data: allSessions = [], isLoading: loadingSessions } = useSessionsQuery();
  const sessions = allSessions.filter(s => s.status === 'ready');
  const [session, setSession] = useState('');
  const [recipient, setRecipient] = useState('');
  const [recipientType, setRecipientType] = useState<'personal' | 'group'>('personal');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [messageType, setMessageType] = useState<typeof messageTypes[number]>('text');
  const [content, setContent] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const { data: groups = [], isLoading: loadingGroups } = useSessionGroupsQuery(
    session,
    recipientType === 'group',
  );

  useEffect(() => {
    if (sessions.length > 0 && !session) {
      setSession(sessions[0].id);
    }
  }, [sessions, session]);

  // Clear the group selection when the session changes so a stale group id from the previous session
  // can't be sent to; the effect below then re-seeds groups[0].id once the new session's groups load.
  useEffect(() => {
    setSelectedGroup('');
  }, [session]);

  useEffect(() => {
    if (groups.length > 0 && !selectedGroup) {
      setSelectedGroup(groups[0].id);
    }
    if (recipientType !== 'group') {
      setSelectedGroup('');
    }
  }, [groups, selectedGroup, recipientType]);

  const handleSend = async () => {
    const targetId = recipientType === 'group' ? selectedGroup : recipient;
    if (!session || !targetId) return;
    setIsLoading(true);
    setResponse(null);

    const sessionObj = sessions.find(s => s.id === session);
    const sessionName = sessionObj?.name || targetId.substring(0, 12);

    try {
      // For a personal recipient, let the engine resolve the number to its canonical chat id rather
      // than hand-building an engine-specific JID here (#265) — also surfaces unregistered numbers.
      let chatId = targetId;
      if (recipientType !== 'group') {
        const resolved = await contactApi.checkNumber(session, targetId.replace(/[^0-9]/g, ''));
        if (!resolved.exists || !resolved.whatsappId) {
          const errResp: ApiResponse = {
            success: false,
            timestamp: new Date().toISOString(),
            error: t('messageTester.notOnWhatsApp'),
          };
          setResponse(errResp);
          addToHistory(sessionName, targetId, errResp);
          return;
        }
        chatId = resolved.whatsappId;
      }

      let result;
      if (messageType === 'text') {
        result = await messageApi.sendText(session, chatId, content);
      } else if (messageType === 'image') {
        result = await messageApi.sendImage(session, chatId, mediaUrl, content);
      } else if (messageType === 'video') {
        result = await messageApi.sendVideo(session, chatId, mediaUrl, content);
      } else if (messageType === 'audio') {
        result = await messageApi.sendAudio(session, chatId, mediaUrl);
      } else {
        result = await messageApi.sendDocument(session, chatId, mediaUrl, content);
      }

      const resp: ApiResponse = {
        success: !!result.messageId,
        messageId: result.messageId,
        timestamp: result.timestamp ? new Date(result.timestamp * 1000).toISOString() : new Date().toISOString(),
      };
      setResponse(resp);
      addToHistory(sessionName, chatId, resp);
    } catch (err) {
      const errResp: ApiResponse = {
        success: false,
        timestamp: new Date().toISOString(),
        error: err instanceof Error ? err.message : t('messageTester.sendFailed'),
      };
      setResponse(errResp);
      addToHistory(sessionName, targetId, errResp);
    } finally {
      setIsLoading(false);
    }
  };

  const addToHistory = useCallback(
    (sessionName: string, target: string, resp: ApiResponse) => {
      setHistory(prev => {
        const entry: HistoryEntry = {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          sessionName,
          recipient: recipientType === 'group' ? target : recipient,
          type: messageType,
          content: messageType === 'text' ? content : mediaUrl || content,
          response: resp,
          time: Date.now(),
        };
        return [entry, ...prev].slice(0, MAX_HISTORY);
      });
    },
    [recipientType, recipient, messageType, content, mediaUrl],
  );

  const clearHistory = () => setHistory([]);

  if (loadingSessions) {
    return (
      <div
        className="message-tester"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}
      >
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  return (
    <div className="message-tester">
      <PageHeader title={t('messageTester.title')} subtitle={t('messageTester.subtitle')} />

      <div className="tester-panels">
        <div className="compose-panel">
          <h2>{t('messageTester.compose')}</h2>

          <div className="form-group">
            <label>{t('messageTester.session')}</label>
            <select value={session} onChange={e => setSession(e.target.value)}>
              {sessions.length === 0 && <option value="">{t('messageTester.noReadySessions')}</option>}
              {sessions.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.phone || t('messageTester.sessionOptionPhoneNone')})
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>{t('messageTester.recipientType')}</label>
            <div className="toggle-group">
              <button
                className={recipientType === 'personal' ? 'active' : ''}
                onClick={() => setRecipientType('personal')}
              >
                {t('messageTester.personal')}
              </button>
              <button className={recipientType === 'group' ? 'active' : ''} onClick={() => setRecipientType('group')}>
                {t('messageTester.group')}
              </button>
            </div>
          </div>

          <div className="form-group">
            <label>{recipientType === 'group' ? t('messageTester.selectGroup') : t('messageTester.recipientPhone')}</label>
            {recipientType === 'group' ? (
              <>
                <select
                  value={selectedGroup}
                  onChange={e => setSelectedGroup(e.target.value)}
                  disabled={loadingGroups || groups.length === 0}
                >
                  {loadingGroups && <option value="">{t('messageTester.loadingGroups')}</option>}
                  {!loadingGroups && groups.length === 0 && <option value="">{t('messageTester.noGroupsFound')}</option>}
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
                <span className="hint">{t('messageTester.selectGroupHint')}</span>
              </>
            ) : (
              <>
                <input
                  type="text"
                  value={recipient}
                  onChange={e => setRecipient(e.target.value)}
                  placeholder="+62812345678"
                />
                <span className="hint">{t('messageTester.phoneHint')}</span>
              </>
            )}
          </div>

          <div className="form-group">
            <label>{t('messageTester.messageType')}</label>
            <div className="toggle-group">
              {messageTypes.map(type => (
                <button
                  key={type}
                  className={messageType === type ? 'active' : ''}
                  onClick={() => setMessageType(type)}
                >
                  {t(`messageTester.types.${type}`)}
                </button>
              ))}
            </div>
          </div>

          {messageType === 'text' ? (
            <div className="form-group">
              <label>{t('messageTester.messageContent')}</label>
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder={t('messageTester.messagePlaceholder')}
                rows={5}
              />
            </div>
          ) : (
            <>
              <div className="form-group">
                <label>{t('messageTester.mediaUrl')}</label>
                <input
                  type="text"
                  value={mediaUrl}
                  onChange={e => setMediaUrl(e.target.value)}
                  placeholder="https://example.com/file.jpg"
                />
              </div>
              {messageType !== 'audio' && (
                <div className="form-group">
                  <label>
                    {messageType === 'document' ? t('messageTester.filename') : t('messageTester.caption')} ({t('common.optional')})
                  </label>
                  <input
                    type="text"
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    placeholder={messageType === 'document' ? t('messageTester.filenamePlaceholder') : t('messageTester.captionPlaceholder')}
                  />
                </div>
              )}
            </>
          )}

          <button
            className="send-btn"
            onClick={handleSend}
            disabled={!canWrite || isLoading || !session || (recipientType === 'group' ? !selectedGroup : !recipient)}
          >
            {isLoading ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
            {isLoading ? t('messageTester.sending') : canWrite ? t('messageTester.send') : t('messageTester.viewOnly')}
          </button>
        </div>

        <div className="response-panel">
          <h2>{t('messageTester.responseTitle')}</h2>

          {response ? (
            <>
              <div className={`response-status ${response.success ? 'success' : 'error'}`}>
                {response.success ? (
                  <>
                    <CheckCircle size={20} />
                    <span>{t('messageTester.successLabel')}</span>
                  </>
                ) : (
                  <>
                    <XCircle size={20} />
                    <span>{t('messageTester.failedLabel')}</span>
                  </>
                )}
              </div>

              <div className="response-details">
                <div className="detail-row">
                  <span className="detail-label">{t('messageTester.response.timestamp')}</span>
                  <span className="detail-value">{response.timestamp}</span>
                </div>
                {response.messageId && (
                  <div className="detail-row">
                    <span className="detail-label">{t('messageTester.response.messageId')}</span>
                    <span className="detail-value mono">{response.messageId}</span>
                  </div>
                )}
                {response.error && (
                  <div className="detail-row">
                    <span className="detail-label">{t('messageTester.response.error')}</span>
                    <span className="detail-value" style={{ color: 'var(--error)' }}>
                      {response.error}
                    </span>
                  </div>
                )}
              </div>

              <div className="response-json">
                <pre>{JSON.stringify(response, null, 2)}</pre>
              </div>
            </>
          ) : (
            <div className="response-empty">
              <p>{t('messageTester.responseEmpty')}</p>
            </div>
          )}

          {/* Recent send history */}
          {history.length > 0 && (
            <div className="history-section">
              <div className="history-header">
                <h3>
                  <Clock size={16} />
                  {t('messageTester.history', { count: history.length })}
                </h3>
                <button className="btn-text danger" onClick={clearHistory} type="button" title={t('common.clear')}>
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="history-list">
                {history.map(entry => (
                  <div key={entry.id} className={`history-item ${entry.response.success ? 'success' : 'error'}`}>
                    <div className="history-item-top">
                      <span className={`history-status-dot ${entry.response.success ? 'ok' : 'fail'}`} />
                      <span className="history-type-badge">{entry.type}</span>
                      <span className="history-recipient">{entry.recipient}</span>
                      <span className="history-time">
                        {new Date(entry.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="history-item-body">
                      {entry.content && (
                        <span className="history-content">{entry.content.substring(0, 80)}{entry.content.length > 80 ? '…' : ''}</span>
                      )}
                      {entry.response.messageId && (
                        <code className="history-message-id">{entry.response.messageId.substring(0, 24)}</code>
                      )}
                    </div>
                    {entry.response.error && (
                      <div className="history-error">{entry.response.error}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
