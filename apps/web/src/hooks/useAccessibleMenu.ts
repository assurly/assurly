'use client';

import { useEffect, useEffectEvent, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const isMenuInteractiveTarget = (target: Node, menu: HTMLElement): boolean => {
  if (!(target instanceof Element)) return false;
  const control = target.closest(FOCUSABLE_SELECTOR);
  return Boolean(control && menu.contains(control));
};

interface AccessibleMenuOptions {
  open: boolean;
  onClose: () => void;
  trapAt?: string;
}

interface AccessibleMenuResult<TMenu extends HTMLElement> {
  menuRef: React.RefObject<TMenu | null>;
  rememberTrigger: (trigger: HTMLButtonElement) => void;
}

/**
 * Adds the keyboard and pointer contract expected from an overlay menu:
 * Escape closes it, outside taps close it, Tab stays inside it, and focus
 * returns to the button that opened it.
 */
export function useAccessibleMenu<TMenu extends HTMLElement>({
  open,
  onClose,
  trapAt,
}: AccessibleMenuOptions): AccessibleMenuResult<TMenu> {
  const menuRef = useRef<TMenu>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeMenu = useEffectEvent(onClose);

  const rememberTrigger = (trigger: HTMLButtonElement): void => {
    triggerRef.current = trigger;
  };

  useEffect(() => {
    if (!open) return;

    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!menu) return;

    const shouldTrap =
      !trapAt || (typeof window.matchMedia === 'function' && window.matchMedia(trapAt).matches);
    const getFocusable = (): HTMLElement[] =>
      Array.from(menu.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
        const style = window.getComputedStyle(element);
        return (
          !element.hasAttribute('hidden') &&
          style.display !== 'none' &&
          style.visibility !== 'hidden'
        );
      });

    // The overlay nav starts at `visibility: hidden` and only becomes visible
    // once the `.open` class lands, so focusing synchronously here is a no-op
    // (a still-hidden element is filtered out / cannot be focused). Defer with a
    // macrotask so the browser has resolved the open styles first, then move
    // focus into the menu. setTimeout is used over requestAnimationFrame because
    // rAF is throttled/suppressed in headless and background tabs.
    let focusTimer: ReturnType<typeof setTimeout> | undefined;
    if (shouldTrap) {
      focusTimer = setTimeout(() => {
        const target =
          getFocusable()[0] ?? menu.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? null;
        target?.focus();
      }, 0);
    }

    const handlePointerDown = (event: PointerEvent): void => {
      if (!shouldTrap) return;

      const target = event.target;
      if (!(target instanceof Node)) return;

      if (trigger?.contains(target)) return;

      if (menu.contains(target)) {
        if (target instanceof Element && !isMenuInteractiveTarget(target, menu)) {
          closeMenu();
        }
        return;
      }

      closeMenu();
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
        return;
      }

      const focusable = getFocusable();
      if (!shouldTrap || event.key !== 'Tab' || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      if (focusTimer) clearTimeout(focusTimer);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
      trigger?.focus();
    };
  }, [open, trapAt]);

  return { menuRef, rememberTrigger };
}
