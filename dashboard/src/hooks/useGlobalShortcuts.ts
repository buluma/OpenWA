import { useEffect, type RefObject } from 'react';

interface ShortcutMap {
  /** Called when Escape is pressed while no input is focused */
  onEscape?: () => void;
  /** Called when Ctrl/Meta+K is pressed */
  onCommandPalette?: () => void;
  /** Called when Ctrl/Meta+N is pressed */
  onNewItem?: () => void;
  /** Called when Ctrl/Meta+, is pressed (quick settings) */
  onSettings?: () => void;
}

export type ShortcutAction = 'escape' | 'palette' | 'newItem' | 'settings' | null;

interface ShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  target: { tagName: string; isContentEditable?: boolean };
}

/**
 * Pure-function shortcut matcher — given a keyboard event shape, returns which action (if any)
 * should fire. Escape is never suppressed regardless of input focus; all other shortcuts are
 * suppressed when an input/textarea/select or contentEditable element is the target.
 *
 * Extracted from the hook for testability.
 */
export function matchShortcut(ev: ShortcutEvent): ShortcutAction {
  const tag = ev.target.tagName;
  const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

  // Escape — always works
  if (ev.key === 'Escape') return 'escape';

  // Other shortcuts suppressed when typing
  if (isInput || ev.target.isContentEditable) return null;

  const mod = ev.ctrlKey || ev.metaKey;

  if (mod && ev.key === 'k') return 'palette';
  if (mod && ev.key === 'n') return 'newItem';
  if (mod && ev.key === ',') return 'settings';

  return null;
}

/**
 * Registers global keyboard shortcuts scoped to the app.
 *
 * @example
 * useGlobalShortcuts({
 *   onEscape: () => setActiveModal(null),
 *   onCommandPalette: () => setShowPalette(true),
 * });
 */
export function useGlobalShortcuts(
  shortcuts: ShortcutMap,
  enabled = true,
  containerRef?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      const action = matchShortcut({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        target: {
          tagName: (e.target as HTMLElement)?.tagName ?? '',
          isContentEditable: !!(e.target as HTMLElement)?.isContentEditable,
        },
      });

      switch (action) {
        case 'escape':
          e.preventDefault();
          shortcuts.onEscape?.();
          break;
        case 'palette':
          e.preventDefault();
          shortcuts.onCommandPalette?.();
          break;
        case 'newItem':
          e.preventDefault();
          shortcuts.onNewItem?.();
          break;
        case 'settings':
          e.preventDefault();
          shortcuts.onSettings?.();
          break;
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [shortcuts, enabled, containerRef]);
}
