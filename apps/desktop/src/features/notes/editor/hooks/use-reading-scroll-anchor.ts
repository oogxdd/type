import { useLayoutEffect, type RefObject } from "react";

/** Keep the visible note in place when a preceding loading placeholder grows. */
export function useReadingScrollAnchor(scrollRef: RefObject<HTMLDivElement | null>, selectionKey: string) {
  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const sections = Array.from(root.querySelectorAll<HTMLElement>(".note-editor-section"));
    let anchor: { element: HTMLElement; top: number; scrollTop: number } | null = null;
    const remember = () => {
      const viewport = root.getBoundingClientRect();
      const element = sections.find((section) => section.getBoundingClientRect().bottom > viewport.top);
      anchor = element ? {
        element,
        top: element.getBoundingClientRect().top - viewport.top,
        scrollTop: root.scrollTop,
      } : null;
    };
    const observer = new ResizeObserver(() => {
      // A newer scroll (including keyboard navigation) wins even if its scroll
      // event has not fired yet. At the top, keep the first date in view.
      if (anchor && anchor.scrollTop > 0 && root.contains(anchor.element) &&
          Math.abs(root.scrollTop - anchor.scrollTop) < 1) {
        const top = anchor.element.getBoundingClientRect().top - root.getBoundingClientRect().top;
        const shift = top - anchor.top;
        if (Math.abs(shift) > 0.5) root.scrollTop += shift;
      }
      remember();
    });
    remember();
    sections.forEach((section) => observer.observe(section));
    observer.observe(root);
    root.addEventListener("scroll", remember, { passive: true });
    return () => {
      observer.disconnect();
      root.removeEventListener("scroll", remember);
    };
  }, [scrollRef, selectionKey]);
}
