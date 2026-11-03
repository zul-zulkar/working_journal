"use client";

import React, {
  CSSProperties,
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";

// ── Motion primitives ────────────────────────────────────────────────────────
// The keyframes / easing tokens live in app/globals.css ("Motion system"). These
// helpers add what CSS alone can't: keeping an overlay mounted while it animates
// out, a sliding segmented-control indicator, drag-to-dismiss sheets, and the
// theme-switch reveal.

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Keeps `children` mounted for `exitMs` after `show` turns false, rendering the
 * last shown tree inside `[data-closing]` so CSS can play the exit animation
 * (see `[data-closing] .jkk-…` rules). The last tree is reused because the
 * caller's state (e.g. the editor form) is already gone by then.
 */
export function Presence({
  show,
  exitMs = 340,
  children,
}: {
  show: boolean;
  exitMs?: number;
  children: ReactNode;
}) {
  const [prevShow, setPrevShow] = useState(show);
  const [exiting, setExiting] = useState(false);
  const last = useRef<ReactNode>(null);
  if (show) last.current = children;
  if (show !== prevShow) {
    setPrevShow(show);
    setExiting(!show);
  }
  useEffect(() => {
    if (!exiting) return;
    const t = setTimeout(() => setExiting(false), exitMs);
    return () => clearTimeout(t);
  }, [exiting, exitMs]);
  if (!show && !exiting) return null;
  return (
    <div className="jkk-presence" data-closing={show ? undefined : "true"}>
      {show ? children : last.current}
    </div>
  );
}

/** Height-animating reveal (grid-rows trick); hidden content can't take focus. */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className="jkk-collapse" data-open={open ? "true" : "false"} aria-hidden={!open}>
      <div className="jkk-collapse-inner">{children}</div>
    </div>
  );
}

/** Segmented control whose active "pill" glides between options. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
  buttonStyle,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  style?: CSSProperties;
  buttonStyle: (active: boolean) => CSSProperties;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ x: number; w: number; animate: boolean } | null>(null);
  const first = useRef(true);

  const measure = useCallback(() => {
    const el = wrap.current?.querySelector<HTMLElement>('[data-seg-active="true"]');
    if (!el) return;
    setInd((prev) =>
      prev && prev.x === el.offsetLeft && prev.w === el.offsetWidth
        ? prev
        : { x: el.offsetLeft, w: el.offsetWidth, animate: !!prev },
    );
  }, []);

  useIsoLayoutEffect(measure, [value, measure]);

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // Labels change width when their weight flips, and webfonts settle late.
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    Array.from(el.children).forEach((c) => ro.observe(c));
    return () => ro.disconnect();
  }, [measure, options.length]);

  // On narrow screens the strip scrolls — keep the chosen tab in view.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const box = wrap.current;
    const el = box?.querySelector<HTMLElement>('[data-seg-active="true"]');
    if (!box || !el || box.scrollWidth <= box.clientWidth) return;
    const left = el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2;
    box.scrollTo({ left: Math.max(0, left), behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [value]);

  return (
    <div ref={wrap} role="tablist" style={{ ...style, position: "relative" }}>
      {ind && (
        <span
          aria-hidden
          className="jkk-seg-ind"
          style={{
            width: ind.w,
            transform: `translateX(${ind.x}px)`,
            transition: ind.animate ? undefined : "none",
          }}
        />
      )}
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            data-seg-active={active ? "true" : undefined}
            onClick={() => onChange(o.value)}
            style={{
              ...buttonStyle(active),
              position: "relative",
              zIndex: 1,
              // The gliding indicator paints the active background.
              background: ind ? "transparent" : buttonStyle(active).background,
              boxShadow: ind ? "none" : buttonStyle(active).boxShadow,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Modal shell: dimmed backdrop + card. On mobile the card is a bottom sheet with
 * a grabber; dragging the grabber/header down past a threshold (or flicking)
 * dismisses it, otherwise it springs back. `onRequestClose` may return false to
 * veto (e.g. the user cancelled "buang perubahan?") — the sheet then settles.
 *
 * A tap on the backdrop closes the modal only when the press also *started* on
 * the backdrop, so selecting text inside the card and releasing outside it never
 * dismisses it. `dismissOnBackdrop={false}` ignores backdrop taps entirely (the
 * card gives a small nudge instead) — for panels that are easy to lose by accident.
 */
export function ModalFrame({
  isMobile,
  onRequestClose,
  overlayStyle,
  cardStyle,
  dismissOnBackdrop = true,
  children,
}: {
  isMobile: boolean;
  onRequestClose: () => boolean | void;
  overlayStyle: CSSProperties;
  cardStyle: CSSProperties;
  dismissOnBackdrop?: boolean;
  children: ReactNode;
}) {
  const card = useRef<HTMLDivElement>(null);
  const pressedBackdrop = useRef(false);
  const drag = useRef<{
    id: number;
    y0: number;
    dy: number;
    active: boolean;
    lastY: number;
    lastT: number;
    v: number;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    const el = card.current;
    if (!isMobile || !el || (e.pointerType === "mouse" && e.button !== 0)) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select, label")) return;
    const zone = target.closest("header, .jkk-grabber");
    if (!zone || zone.parentElement !== el) return;
    drag.current = { id: e.pointerId, y0: e.clientY, dy: 0, active: false, lastY: e.clientY, lastT: performance.now(), v: 0 };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = card.current;
    if (!d || !el || e.pointerId !== d.id) return;
    const raw = e.clientY - d.y0;
    if (!d.active) {
      if (Math.abs(raw) < 6) return;
      d.active = true;
      el.style.transition = "none";
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    const now = performance.now();
    d.v = (e.clientY - d.lastY) / Math.max(1, now - d.lastT);
    d.lastY = e.clientY;
    d.lastT = now;
    // Free downward; upward meets rubber-band resistance.
    d.dy = raw >= 0 ? raw : -Math.sqrt(-raw) * 2.2;
    el.style.transform = `translateY(${d.dy}px)`;
  };

  const onPointerEnd = () => {
    const d = drag.current;
    const el = card.current;
    drag.current = null;
    if (!d || !el || !d.active) return;
    el.style.transition = "";
    const far = d.dy > Math.min(150, el.offsetHeight * 0.3);
    const flick = d.v > 0.6 && d.dy > 24;
    if ((far || flick) && onRequestClose() !== false) {
      // Leave the inline offset: the exit animation continues from here.
      return;
    }
    el.style.transition = "transform .5s var(--ease-spring-soft)";
    el.style.transform = "";
  };

  const onBackdropClick = (e: React.MouseEvent) => {
    const started = pressedBackdrop.current;
    pressedBackdrop.current = false;
    if (e.target !== e.currentTarget || !started) return;
    if (dismissOnBackdrop) {
      onRequestClose();
      return;
    }
    const el = card.current;
    if (el && el.animate && !prefersReducedMotion()) {
      el.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.018)" }, { transform: "scale(1)" }],
        { duration: 260, easing: "ease-out" },
      );
    }
  };

  return (
    <div
      className="jkk-scrim"
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={onBackdropClick}
      style={overlayStyle}
    >
      <div
        ref={card}
        className={isMobile ? "jkk-sheet" : "jkk-dialog"}
        style={{ ...cardStyle, position: "relative" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        {isMobile && <div className="jkk-grabber" aria-hidden />}
        {children}
      </div>
    </div>
  );
}

type ViewTransitionDoc = Document & {
  startViewTransition?: (cb: () => void) => { finished: Promise<void>; ready: Promise<void> };
};

/**
 * Theme switch with a circular reveal growing from the tapped control (View
 * Transitions API). Falls back to an instant switch where unsupported, when the
 * page isn't visible, or when the user prefers reduced motion. `apply` may run
 * a frame later, so it should derive the new theme from current state.
 */
export function runThemeTransition(
  origin: { clientX: number; clientY: number } | null | undefined,
  apply: () => void,
) {
  const doc = document as ViewTransitionDoc;
  if (!doc.startViewTransition || prefersReducedMotion() || doc.visibilityState !== "visible") {
    apply();
    return;
  }
  const w = window.innerWidth;
  const h = window.innerHeight;
  const x = origin && origin.clientX ? origin.clientX : w - 40;
  const y = origin && origin.clientY ? origin.clientY : 40;
  const r = Math.hypot(Math.max(x, w - x), Math.max(y, h - y));
  const root = document.documentElement;
  root.style.setProperty("--jkk-vt-x", `${x}px`);
  root.style.setProperty("--jkk-vt-y", `${y}px`);
  root.style.setProperty("--jkk-vt-r", `${Math.ceil(r)}px`);
  root.classList.add("jkk-vt-theme");
  try {
    const vt = doc.startViewTransition(() => {
      flushSync(apply);
    });
    // A rapid second tap skips this transition; its update still runs.
    vt.ready.catch(() => {});
    vt.finished.finally(() => root.classList.remove("jkk-vt-theme"));
  } catch {
    root.classList.remove("jkk-vt-theme");
    apply();
  }
}

/** Staggered entrance delay for the n-th item of a list (capped). */
export function stagger(i: number, step = 28, cap = 12): CSSProperties {
  return { animationDelay: `${Math.min(i, cap) * step}ms` };
}
