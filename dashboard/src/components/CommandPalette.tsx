import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Search,
  LayoutDashboard,
  Smartphone,
  MessageSquare,
  Webhook,
  Key,
  FileText,
  Send,
  Server,
  Puzzle,
  ClipboardList,
} from 'lucide-react';
import { useSessionsQuery, useWebhooksQuery } from '../hooks/queries';
import './CommandPalette.css';

interface PaletteItem {
  id: string;
  label: string;
  description: string;
  route?: string;
  action?: () => void;
  icon: typeof Search;
  badge?: string;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const resultsRef = useRef<HTMLDivElement>(null);

  const { data: sessions = [] } = useSessionsQuery();
  const { data: webhooks = [] } = useWebhooksQuery();

  const navItems: PaletteItem[] = useMemo(
    () => [
      { id: 'nav-dash', label: t('nav.dashboard'), description: t('dashboard.subtitle'), route: '/', icon: LayoutDashboard },
      { id: 'nav-sessions', label: t('nav.sessions'), description: t('sessions.subtitle'), route: '/sessions', icon: Smartphone },
      { id: 'nav-chats', label: t('nav.chats'), description: t('chats.subtitle'), route: '/chats', icon: MessageSquare },
      { id: 'nav-webhooks', label: t('nav.webhooks'), description: t('webhooks.subtitle'), route: '/webhooks', icon: Webhook },
      { id: 'nav-templates', label: t('nav.templates'), description: t('templates.subtitle'), route: '/templates', icon: ClipboardList },
      { id: 'nav-api-keys', label: t('nav.apiKeys'), description: t('apiKeys.subtitle'), route: '/api-keys', icon: Key },
      { id: 'nav-message-tester', label: t('nav.messageTester'), description: '', route: '/message-tester', icon: Send },
      { id: 'nav-infrastructure', label: t('nav.infrastructure'), description: '', route: '/infrastructure', icon: Server },
      { id: 'nav-plugins', label: t('nav.plugins'), description: '', route: '/plugins', icon: Puzzle },
      { id: 'nav-logs', label: t('nav.logs'), description: t('logs.subtitle'), route: '/logs', icon: FileText },
    ],
    [t],
  );

  const sessionItems: PaletteItem[] = useMemo(
    () =>
      sessions.slice(0, 5).map(s => ({
        id: `session-${s.id}`,
        label: s.name,
        description: s.phone || s.id.substring(0, 12),
        route: '/sessions',
        icon: Smartphone,
        badge: s.status,
      })),
    [sessions],
  );

  const webhookItems: PaletteItem[] = useMemo(
    () =>
      webhooks.slice(0, 5).map(w => ({
        id: `webhook-${w.id}`,
        label: w.url,
        description: w.events.slice(0, 3).join(', '),
        route: '/webhooks',
        icon: Webhook,
      })),
    [webhooks],
  );

  const allItems = useMemo(() => {
    const sections: { title: string; items: PaletteItem[] }[] = [
      { title: t('nav.dashboard'), items: navItems },
    ];
    if (sessionItems.length > 0) {
      sections.push({ title: t('nav.sessions'), items: sessionItems });
    }
    if (webhookItems.length > 0) {
      sections.push({ title: t('nav.webhooks'), items: webhookItems });
    }
    return sections;
  }, [navItems, sessionItems, webhookItems, t]);

  // Filter items by query
  const filtered = useMemo(() => {
    if (!query.trim()) return allItems;
    const q = query.toLowerCase();
    return allItems
      .map(section => ({
        ...section,
        items: section.items.filter(
          item =>
            item.label.toLowerCase().includes(q) ||
            item.description.toLowerCase().includes(q),
        ),
      }))
      .filter(s => s.items.length > 0);
  }, [allItems, query]);

  const filteredFlat = useMemo(() => filtered.flatMap(s => s.items), [filtered]);

  // Reset index when results change
  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIdx(0);
      // Delay focus so the DOM is ready
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  const executeItem = useCallback(
    (item: PaletteItem) => {
      if (item.route) {
        navigate(item.route);
      }
      item.action?.();
      onClose();
    },
    [navigate, onClose],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, filteredFlat.length - 1));
      // Scroll active item into view
      const el = resultsRef.current?.children[activeIdx + 1] as HTMLElement | undefined;
      el?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filteredFlat[activeIdx];
      if (item) executeItem(item);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={e => e.stopPropagation()} role="dialog" aria-label={t('common.search')}>
        <div className="command-palette-input-wrap">
          <Search size={20} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('common.search')}
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
          />
        </div>

        <div className="command-palette-hint">
          <span>
            <kbd>↑↓</kbd> {t('common.navigate')}
          </span>
          <span>
            <kbd>↵</kbd> {t('common.open')}
          </span>
          <span>
            <kbd>Esc</kbd> {t('common.close')}
          </span>
        </div>

        <div className="command-palette-results" ref={resultsRef}>
          {filtered.length === 0 ? (
            <div className="command-palette-empty">{t('common.noResults')}</div>
          ) : (
            filtered.map(section => (
              <div key={section.title}>
                <div className="command-palette-section-title">{section.title}</div>
                {section.items.map(item => {
                  const flatIdx = filteredFlat.indexOf(item);
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      className={`command-palette-item ${flatIdx === activeIdx ? 'active' : ''}`}
                      onClick={() => executeItem(item)}
                      onMouseEnter={() => setActiveIdx(flatIdx)}
                      type="button"
                      role="option"
                      aria-selected={flatIdx === activeIdx}
                    >
                      <Icon size={18} />
                      <div className="command-palette-item-info">
                        <span className="command-palette-item-title">{item.label}</span>
                        {item.description && (
                          <span className="command-palette-item-subtitle">{item.description}</span>
                        )}
                      </div>
                      {item.badge && <span className="command-palette-item-badge">{item.badge}</span>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
