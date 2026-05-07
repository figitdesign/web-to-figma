import { useEffect, useRef, useState } from "react";
import type { ContentScriptContext } from "#imports";

const HIGHLIGHT_INSET = 2;

type Rect = { top: number; left: number; width: number; height: number };

type PickerProps = {
  active: boolean;
  ctx: ContentScriptContext;
  shadowHost: HTMLElement;
  onConfirm: (element: HTMLElement) => void;
  onCancel: () => void;
};

const KEY_TO_NEIGHBOR: Record<string, (el: HTMLElement) => Element | null> = {
  ArrowUp: (el) => el.parentElement,
  ArrowDown: (el) => el.firstElementChild,
  ArrowLeft: (el) => el.previousElementSibling,
  ArrowRight: (el) => el.nextElementSibling,
};

/**
 * Element-picker overlay. The visual layer is `pointer-events: none` so the
 * page still receives hover styling while the user explores; selection happens
 * via document-level capture-phase listeners.
 *
 * Listeners are bound through a single `AbortController` — one signal aborts
 * all of them on cleanup. The controller is also chained to `ctx.signal` so
 * extension invalidation tears them down too.
 *
 * Keyboard: Esc cancels · Enter confirms · Arrow keys walk parent / child /
 * siblings.
 */
export function Picker({
  active,
  ctx,
  shadowHost,
  onConfirm,
  onCancel,
}: PickerProps) {
  // `targetRef` holds the latest hovered element so listeners can read it
  // without forcing the effect to re-bind on every pointer move.
  const targetRef = useRef<HTMLElement | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (!active) {
      targetRef.current = null;
      setRect(null);
      return;
    }

    const ac = new AbortController();
    const onAbort = () => ac.abort();
    ctx.signal.addEventListener("abort", onAbort, { once: true });

    const previousCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = "crosshair";

    const setTarget = (next: HTMLElement | null) => {
      if (next === targetRef.current) {
        return;
      }
      targetRef.current = next;
      setRect(next ? rectOf(next) : null);
    };

    const isFromOurUi = (event: Event): boolean =>
      event.composedPath().includes(shadowHost);

    const onPointerMove = (event: PointerEvent) => {
      if (isFromOurUi(event)) {
        return;
      }
      const candidate = event.target as HTMLElement | null;
      if (!candidate || candidate === document.documentElement) {
        return;
      }
      setTarget(candidate);
    };

    const onClick = (event: MouseEvent) => {
      if (isFromOurUi(event)) {
        return;
      }
      const picked = event.target as HTMLElement | null;
      if (!picked) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      onConfirm(picked);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCancel();
        return;
      }
      const current = targetRef.current;
      if (!current) {
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onConfirm(current);
        return;
      }
      const next = KEY_TO_NEIGHBOR[event.key]?.(current) ?? null;
      if (next instanceof HTMLElement) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setTarget(next);
      }
    };

    // Coalesce scroll/resize storms — getBoundingClientRect every frame
    // (instead of every event) is cheap and looks identical to the eye.
    let rafId: number | null = null;
    const onScrollOrResize = () => {
      if (rafId !== null) {
        return;
      }
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const current = targetRef.current;
        setRect(current ? rectOf(current) : null);
      });
    };

    const opts = { capture: true, signal: ac.signal };
    document.addEventListener("pointermove", onPointerMove, opts);
    document.addEventListener("click", onClick, opts);
    document.addEventListener("keydown", onKeyDown, opts);
    window.addEventListener("scroll", onScrollOrResize, opts);
    window.addEventListener("resize", onScrollOrResize, { signal: ac.signal });

    return () => {
      ac.abort();
      ctx.signal.removeEventListener("abort", onAbort);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      document.documentElement.style.cursor = previousCursor;
    };
  }, [active, ctx, shadowHost, onConfirm, onCancel]);

  if (!active) {
    return null;
  }

  return (
    <>
      {rect ? <Highlight rect={rect} /> : null}
      <Hint />
    </>
  );
}

function Highlight({ rect }: { rect: Rect }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed rounded-md border-2 border-primary bg-primary/10 transition-[top,left,width,height] duration-75 ease-out"
      style={{
        top: rect.top - HIGHLIGHT_INSET,
        left: rect.left - HIGHLIGHT_INSET,
        width: rect.width + HIGHLIGHT_INSET * 2,
        height: rect.height + HIGHLIGHT_INSET * 2,
      }}
    />
  );
}

function Hint() {
  return (
    <div
      className="pointer-events-none fixed top-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-primary-foreground text-xs shadow-md"
      role="status"
    >
      <span>Click to copy this element to Figma</span>
      <span className="text-primary-foreground/70">·</span>
      <span className="text-primary-foreground/70">Esc to cancel</span>
    </div>
  );
}

function rectOf(element: HTMLElement): Rect {
  const r = element.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}
