import { useEffect } from 'react';

/**
 * iOS/Android don't resize the layout viewport when the on-screen keyboard
 * opens — only `visualViewport` shrinks — so there's no fixed keyboard
 * height to assume. Instead, whenever the visible viewport actually
 * changes, re-scroll whatever's focused back into view.
 */
export function useKeyboardAwareScroll(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
        active.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    };
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);
}
