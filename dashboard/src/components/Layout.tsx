import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  Smartphone,
  MessageSquare,
  Webhook,
  Key,
  FileText,
  ClipboardList,
  LogOut,
  Send,
  Server,
  Puzzle,
  Sun,
  Moon,
  Monitor,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  Languages,
  Ban,
  Grid3x3,
  Zap,
  CloudRain,
  Star,
  Waves,
  Flower2,
  Sparkles,
  Flame,
} from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { type UserRole } from '../hooks';
import { languageOptions, resolveSupportedLanguage, rtlLanguages, type SupportedLanguage } from '../i18n';
import { healthApi } from '../services/api';
import { AmbientBackground, BG_PATTERNS, type BgPattern } from './AmbientBackground';
import { CommandPalette } from './CommandPalette';
import { useGlobalShortcuts } from '../hooks/useGlobalShortcuts';
import { useWebSocket } from '../hooks/useWebSocket';
import './Layout.css';

const BG_PATTERN_ICONS: Record<BgPattern, typeof Ban> = {
  none: Ban,
  dots: Grid3x3,
  synapse: Zap,
  rain: CloudRain,
  constellations: Star,
  'perlin-flow': Waves,
  petals: Flower2,
  sparkles: Sparkles,
  embers: Flame,
};

interface LayoutProps {
  onLogout: () => void;
  userRole: UserRole | null;
}

const allNavItems = [
  { to: '/', icon: LayoutDashboard, key: 'dashboard' as const, adminOnly: false },
  { to: '/sessions', icon: Smartphone, key: 'sessions' as const, adminOnly: false },
  { to: '/chats', icon: MessageSquare, key: 'chats' as const, adminOnly: false },
  { to: '/webhooks', icon: Webhook, key: 'webhooks' as const, adminOnly: false },
  { to: '/templates', icon: ClipboardList, key: 'templates' as const, adminOnly: false },
  { to: '/api-keys', icon: Key, key: 'apiKeys' as const, adminOnly: true },
  { to: '/message-tester', icon: Send, key: 'messageTester' as const, adminOnly: false },
  // Backend /infra/* is ADMIN-only; hide the nav item from non-admins (UX + defense-in-depth).
  { to: '/infrastructure', icon: Server, key: 'infrastructure' as const, adminOnly: true },
  { to: '/plugins', icon: Puzzle, key: 'plugins' as const, adminOnly: true },
  { to: '/logs', icon: FileText, key: 'logs' as const, adminOnly: false },
];

const themeIcons = { light: Sun, dark: Moon, system: Monitor };

export function Layout({ onLogout, userRole }: LayoutProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const { theme, setTheme, palette, setPalette, paletteOptions, bgPattern, setBgPattern, bgIntensity, setBgIntensity } =
    useTheme();
  const ThemeIcon = themeIcons[theme];
  const themeLabel = t(`theme.${theme}`);
  const activePalette = paletteOptions.find(option => option.value === palette) ?? paletteOptions[0];

  // WebSocket connection status (no event handlers needed — just the indicator)
  // Use a stable ref so the useWebSocket hook's internal useEffect doesn't re-fire every render.
  const wsEventsRef = useRef<Record<string, never>>({});
  const { isConnected: isWsConnected, connectionFailed: isWsFailed } = useWebSocket(wsEventsRef.current);

  // Global keyboard shortcuts
  const handleEscape = useCallback(() => {
    // Close any open menus first
    setIsLanguageMenuOpen(false);
    setIsAppearanceMenuOpen(false);
    setShowCommandPalette(false);
  }, []);

  useGlobalShortcuts({
    onEscape: handleEscape,
    onCommandPalette: () => setShowCommandPalette(prev => !prev),
    onNewItem: () => navigate('/sessions'),
  });

  const navItems = allNavItems.filter(item => !item.adminOnly || userRole === 'admin');

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  // Show the build-time version immediately, then replace it with the live running version from the
  // backend so a stale-built bundle can't display the wrong number. Falls back silently on error.
  const [version, setVersion] = useState(__APP_VERSION__);
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
  const [isAppearanceMenuOpen, setIsAppearanceMenuOpen] = useState(false);
  const languageMenuRef = useRef<HTMLDivElement>(null);
  const appearanceMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) setIsMobileOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    let active = true;
    healthApi
      .check()
      .then(info => {
        if (active && info?.version) setVersion(info.version);
      })
      .catch(() => {
        /* keep the build-time fallback */
      });
    return () => {
      active = false;
    };
  }, []);

  const handleNavClick = () => {
    if (isMobile) setIsMobileOpen(false);
  };

  useEffect(() => {
    document.body.style.overflow = isMobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileOpen]);

  useEffect(() => {
    if (!isLanguageMenuOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!languageMenuRef.current?.contains(event.target as Node)) {
        setIsLanguageMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsLanguageMenuOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isLanguageMenuOpen]);

  useEffect(() => {
    if (!isAppearanceMenuOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!appearanceMenuRef.current?.contains(event.target as Node)) {
        setIsAppearanceMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsAppearanceMenuOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isAppearanceMenuOpen]);

  const toggleCollapse = () => setIsCollapsed(!isCollapsed);
  const toggleMobile = () => setIsMobileOpen(!isMobileOpen);

  const currentLang = resolveSupportedLanguage(i18n.resolvedLanguage || i18n.language);
  const languageLabel = languageOptions.find(option => option.value === currentLang)?.compactLabel ?? 'EN';
  const changeLanguage = (language: SupportedLanguage) => {
    setIsLanguageMenuOpen(false);
    void i18n.changeLanguage(language);
  };
  const isRtl = rtlLanguages.includes(currentLang);

  return (
    <div className={`layout ${bgPattern !== 'none' ? 'has-ambient-bg' : ''}`}>
      <AmbientBackground pattern={bgPattern} intensity={bgIntensity} />
      {isMobile && (
        <header className="mobile-header">
          <button className="mobile-menu-btn" onClick={toggleMobile} aria-label={t('common.expand')}>
            {isMobileOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
          <div className="mobile-brand">
            <img src="/openwa_logo.webp" alt="OpenWA" className="sidebar-logo" />
            <span className="brand-name">{t('common.appName')}</span>
          </div>
          <div style={{ width: 40 }} />
        </header>
      )}

      {isMobile && isMobileOpen && <div className="sidebar-overlay" onClick={() => setIsMobileOpen(false)} />}

      <aside
        className={`sidebar ${isCollapsed ? 'collapsed' : ''} ${isMobile ? 'mobile' : ''} ${isMobileOpen ? 'open' : ''}`}
      >
        <div className="sidebar-header">
          <img src="/openwa_logo.webp" alt="OpenWA" className="sidebar-logo" />
          {!isCollapsed && (
            <div className="sidebar-brand">
              <span className="brand-name">{t('common.appName')}</span>
              <span className="brand-version">v{version}</span>
            </div>
          )}
        </div>

        {!isMobile && (
          <button
            className="collapse-toggle"
            onClick={toggleCollapse}
            title={isCollapsed ? t('common.expand') : t('common.collapse')}
            aria-label={isCollapsed ? t('common.expand') : t('common.collapse')}
          >
            {isCollapsed ? (
              isRtl ? (
                <ChevronLeft size={16} />
              ) : (
                <ChevronRight size={16} />
              )
            ) : isRtl ? (
              <ChevronRight size={16} />
            ) : (
              <ChevronLeft size={16} />
            )}
          </button>
        )}

        <nav className="sidebar-nav">
          {navItems.map(({ to, icon: Icon, key }) => {
            const label = t(`nav.${key}`);
            return (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                end={to === '/'}
                onClick={handleNavClick}
                title={isCollapsed ? label : undefined}
              >
                <Icon size={20} />
                {!isCollapsed && <span>{label}</span>}
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="language-menu" ref={languageMenuRef}>
            <button
              className="theme-toggle-btn"
              onClick={() => setIsLanguageMenuOpen(open => !open)}
              title={t('common.language')}
              aria-label={t('common.language')}
              aria-haspopup="menu"
              aria-expanded={isLanguageMenuOpen}
            >
              <Languages size={18} />
              {!isCollapsed && <span>{languageLabel}</span>}
            </button>
            {isLanguageMenuOpen && (
              <div className="language-menu-list" role="menu" aria-label={t('common.language')}>
                {languageOptions.map(option => (
                  <button
                    key={option.value}
                    className={`language-menu-item ${option.value === currentLang ? 'active' : ''}`}
                    onClick={() => changeLanguage(option.value)}
                    role="menuitemradio"
                    aria-checked={option.value === currentLang}
                  >
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="appearance-menu" ref={appearanceMenuRef}>
            <button
              className="theme-toggle-btn"
              onClick={() => setIsAppearanceMenuOpen(open => !open)}
              title={t('theme.label', { value: themeLabel })}
              aria-label={t('theme.appearance')}
              aria-haspopup="menu"
              aria-expanded={isAppearanceMenuOpen}
            >
              <span
                className="appearance-button-cue"
                style={{ '--swatch-color': activePalette.color } as CSSProperties}
                aria-hidden="true"
              >
                <ThemeIcon size={14} />
              </span>
              {!isCollapsed && <span>{themeLabel}</span>}
            </button>
            {isAppearanceMenuOpen && (
              <div className="appearance-menu-list" role="menu" aria-label={t('theme.appearance')}>
                <div className="appearance-menu-header">
                  <div>
                    <strong>{t('theme.appearance')}</strong>
                    <span>{activePalette.label}</span>
                  </div>
                  <span
                    className="appearance-current-swatch"
                    style={{ '--swatch-color': activePalette.color } as CSSProperties}
                    aria-hidden="true"
                  />
                </div>
                <div className="appearance-section">
                  <span className="appearance-section-label">{t('theme.mode')}</span>
                  <div className="appearance-mode-grid">
                    {(['light', 'dark', 'system'] as const).map(mode => {
                      const ModeIcon = themeIcons[mode];
                      return (
                        <button
                          key={mode}
                          className={`appearance-mode ${theme === mode ? 'active' : ''}`}
                          onClick={() => setTheme(mode)}
                          type="button"
                          role="menuitemradio"
                          aria-checked={theme === mode}
                        >
                          <ModeIcon size={16} />
                          <span>{t(`theme.${mode}`)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="appearance-section">
                  <span className="appearance-section-label">{t('theme.palette')}</span>
                  <div className="palette-grid">
                    {paletteOptions.map(option => (
                      <button
                        key={option.value}
                        className={`palette-swatch ${palette === option.value ? 'active' : ''}`}
                        onClick={() => setPalette(option.value)}
                        type="button"
                        title={option.label}
                        role="menuitemradio"
                        aria-checked={palette === option.value}
                        style={{ '--swatch-color': option.color } as CSSProperties}
                      >
                        <span />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="appearance-section">
                  <span className="appearance-section-label">{t('theme.background')}</span>
                  <div className="bg-pattern-grid">
                    {BG_PATTERNS.map(p => {
                      const PatternIcon = BG_PATTERN_ICONS[p];
                      return (
                        <button
                          key={p}
                          className={`bg-pattern-swatch ${bgPattern === p ? 'active' : ''}`}
                          onClick={() => setBgPattern(p)}
                          type="button"
                          title={t(`theme.backgroundPatterns.${p}`)}
                          role="menuitemradio"
                          aria-checked={bgPattern === p}
                        >
                          <PatternIcon size={16} />
                        </button>
                      );
                    })}
                  </div>
                  {bgPattern !== 'none' && (
                    <label className="bg-intensity-control">
                      <span>{t('theme.intensity')}</span>
                      <input
                        type="range"
                        min={0.05}
                        max={1}
                        step={0.05}
                        value={bgIntensity}
                        onChange={e => setBgIntensity(Number(e.target.value))}
                      />
                    </label>
                  )}
                </div>
              </div>
            )}
          </div>
          {/* WebSocket connection indicator */}
          <button
            className={`ws-status-btn ${isWsConnected ? 'connected' : isWsFailed ? 'failed' : 'connecting'}`}
            title={isWsConnected ? t('common.connected') : isWsFailed ? t('common.disconnected') : t('common.connecting')}
            aria-label={isWsConnected ? t('common.connected') : isWsFailed ? t('common.disconnected') : t('common.connecting')}
          >
            <span className="ws-dot" />
            {!isCollapsed && (
              <span>{isWsConnected ? t('common.connected') : isWsFailed ? t('common.disconnected') : t('common.connecting')}</span>
            )}
          </button>
          <button className="logout-btn" onClick={onLogout} title={isCollapsed ? t('common.logout') : undefined}>
            <LogOut size={20} />
            {!isCollapsed && <span>{t('common.logout')}</span>}
          </button>
        </div>
      </aside>

      <main className={`main-content ${isCollapsed ? 'expanded' : ''} ${isMobile ? 'mobile' : ''}`}>
        <Outlet />
      </main>

      <CommandPalette isOpen={showCommandPalette} onClose={() => setShowCommandPalette(false)} />
    </div>
  );
}
