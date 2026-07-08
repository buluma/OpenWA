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

/**
 * Registers global keyboard shortcuts scoped to the app. Shortcuts are suppressed when an input,
 * textarea, or select element is focused to avoid interfering with typing.
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
      // Suppress shortcuts when typing in inputs (except Escape which should always work)
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      // Escape — always works, including inside inputs (closes modals/popovers)
      if (e.key === 'Escape' && shortcuts.onEscape) {
        e.preventDefault();
        shortcuts.onEscape();
        return;
      }

      // Don't handle other shortcuts when typing
      if (isInput || (e.target as HTMLElement)?.isContentEditable) return;

      // Respect container scoping
      if (containerRef?.current) {
        const target = e.target as Node;
        if (!containerRef.current.contains(target)) return;
      }

      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key === 'k') {
        e.preventDefault();
        shortcuts.onCommandPalette?.();
      } else if (mod && e.key === 'n') {
        e.preventDefault();
        shortcuts.onNewItem?.();
      } else if (mod && e.key === ',') {
        e.preventDefault();
        shortcuts.onSettings?.();
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [shortcuts, enabled, containerRef]);
}
