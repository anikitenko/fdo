import React, { useEffect, useRef, useState } from "react";
import { Button, Icon } from "@blueprintjs/core";
import * as styles from "./sidebar.module.css";

/**
 * SidebarSection
 * Collapsible sidebar container with animated height and persisted state.
 * Props:
 * - id: string (required) — unique key for persistence
 * - title: string | ReactNode (required) — section header text
 * - defaultCollapsed?: boolean — initial collapsed state if nothing persisted
 * - sticky?: ReactNode — optional node rendered inside a sticky bar at the top of the section body
 * - children: ReactNode — body content
 * Behavior:
 * - Reads compact mode from localStorage key `ui.compact.enabled` and from a custom window event `ui:compact-changed`.
 */
const SidebarSection = ({ id, title, defaultCollapsed = false, sticky = null, children }) => {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [compact, setCompact] = useState(false);
  const bodyRef = useRef(null);
  const [maxHeight, setMaxHeight] = useState("auto");

  // Load persisted state
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`ui.sidebar.section.${id}.collapsed`);
      if (raw === "true") setCollapsed(true);
      if (raw === "false") setCollapsed(false);
    } catch (_) {}
  }, [id]);

  // Persist on change
  useEffect(() => {
    try {
      localStorage.setItem(`ui.sidebar.section.${id}.collapsed`, collapsed ? "true" : "false");
    } catch (_) {}
  }, [id, collapsed]);

  // Compact mode initial + event listener
  useEffect(() => {
    const readCompact = () => {
      try {
        const raw = localStorage.getItem('ui.compact.enabled');
        setCompact(raw === 'true');
      } catch (_) {}
    };
    readCompact();
    const handler = () => readCompact();
    window.addEventListener('ui:compact-changed', handler);
    return () => window.removeEventListener('ui:compact-changed', handler);
  }, []);

  // Measure body content for animation
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const content = el.firstElementChild;
    if (!content) return;
    const h = content.scrollHeight;
    setMaxHeight(collapsed ? 0 : h);
  }, [collapsed, children]);

  // Recalculate on window resize
  useEffect(() => {
    const onResize = () => {
      const el = bodyRef.current;
      const content = el?.firstElementChild;
      if (!el || !content) return;
      setMaxHeight(collapsed ? 0 : content.scrollHeight);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [collapsed]);

  // Observe content size changes to adjust maxHeight when inner content grows/shrinks
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const content = el.firstElementChild;
    if (!content) return;

    if (typeof ResizeObserver === 'undefined') {
      // Fallback: poll occasionally; lightweight and only when expanded
      let rafId = 0;
      let last = content.scrollHeight;
      const tick = () => {
        if (!collapsed) {
          const h = content.scrollHeight;
          if (h !== last) {
            last = h;
            setMaxHeight(h);
          }
        }
        rafId = window.requestAnimationFrame(tick);
      };
      rafId = window.requestAnimationFrame(tick);
      return () => window.cancelAnimationFrame(rafId);
    }

    const ro = new ResizeObserver(() => {
      if (collapsed) return;
      // Using scrollHeight avoids issues with overflow content
      setMaxHeight(content.scrollHeight);
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [collapsed]);

  return (
    <section className={`${styles.sectionRoot} ${compact ? styles.compactRoot : ''}`} aria-expanded={!collapsed} aria-label={typeof title === 'string' ? title : undefined}>
      <div className={styles.sectionHeader} role="button" tabIndex={0}
           onClick={() => setCollapsed(c => !c)}
           onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapsed(c => !c); } }}
           aria-controls={`section-body-${id}`}
           aria-expanded={!collapsed}
      >
        <div className={styles.sectionTitle}>
          <Icon icon={collapsed ? "caret-right" : "caret-down"} />
          <span>{title}</span>
        </div>
        <Button variant={"minimal"} size={"small"} icon={collapsed ? "chevron-down" : "chevron-up"} aria-label={collapsed ? "Expand" : "Collapse"} />
      </div>
      <div id={`section-body-${id}`} ref={bodyRef} className={`${styles.sectionBody} ${collapsed ? styles.collapsed : ''}`} style={{ maxHeight }}>
        <div className={styles.sectionBodyInner}>
          {sticky ? (<div className={styles.stickyBar}>{sticky}</div>) : null}
          {children}
        </div>
      </div>
    </section>
  );
};

export default SidebarSection;
