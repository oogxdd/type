import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

const MAX_EDITORS = 12;

/** Small viewport window, with the active editor pinned for selection/IME/dialogs. */
export function useEditorWindow(
  scrollRef: RefObject<HTMLDivElement | null>, paths: string[], activePath: string | null,
) {
  const [mounted, setMounted] = useState<Set<string>>(() => new Set());
  const current = useRef({ paths, activePath });
  current.current = { paths, activePath };
  const forced = useRef<string | null>(null);
  const schedule = useRef<() => void>(() => {});
  const ensure = useCallback((path: string) => { forced.current = current.current.activePath === path ? null : path; schedule.current(); }, []);
  const key = JSON.stringify(paths);
  const mountedRef = useRef(mounted);
  mountedRef.current = mounted;
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const sections = new Map(Array.from(root.querySelectorAll<HTMLElement>("[data-note-path]"))
      .map((element) => [element.dataset.notePath!, element]));
    const nearby = new Set<string>();
    let frame = 0;
    const update = () => {
      frame = 0;
      const { paths: ordered, activePath: active } = current.current;
      const viewport = root.getBoundingClientRect();
      const distance = (path: string) => {
        const rect = sections.get(path)?.getBoundingClientRect();
        return rect ? Math.max(viewport.top - rect.bottom, rect.top - viewport.bottom, 0) : Infinity;
      };
      const priority = [forced.current, active].filter((path): path is string => !!path && sections.has(path));
      const candidates = [...nearby].sort((a, b) => distance(a) - distance(b));
      // Include one neighbor on either side so j/k normally has a ready target.
      const desired = new Set(priority);
      for (const path of candidates.length ? candidates : ordered.slice(0, 2)) {
        if (desired.size >= MAX_EDITORS) break;
        desired.add(path);
      }
      for (const path of [...desired]) {
        const index = ordered.indexOf(path);
        for (const neighbor of [ordered[index - 1], ordered[index + 1]]) {
          if (neighbor && desired.size < MAX_EDITORS) desired.add(neighbor);
        }
      }
      const next = new Set([...mountedRef.current].filter((path) => desired.has(path)));
      const missing = [...desired].filter((path) => !next.has(path));
      // At most one new Tiptap view per frame. A render never builds 150 views.
      if (missing[0]) next.add(missing[0]);
      if (next.size !== mountedRef.current.size || [...next].some((path) => !mountedRef.current.has(path))) {
        mountedRef.current = next;
        setMounted(next);
      }
      if (missing.length > 1) frame = requestAnimationFrame(update);
    };
    const requestUpdate = () => { if (!frame) frame = requestAnimationFrame(update); };
    schedule.current = requestUpdate;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const path = (entry.target as HTMLElement).dataset.notePath!;
        if (entry.isIntersecting) nearby.add(path);
        else nearby.delete(path);
      }
      requestUpdate();
    }, { root, rootMargin: "400px 0px" });
    sections.forEach((section) => observer.observe(section));
    root.addEventListener("scroll", requestUpdate, { passive: true });
    requestUpdate();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      root.removeEventListener("scroll", requestUpdate);
      schedule.current = () => {};
    };
  }, [scrollRef, key]);
  useEffect(() => {
    if (forced.current === activePath) forced.current = null;
    schedule.current();
  }, [activePath]);
  return { mounted, ensure };
}
