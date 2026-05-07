import { useEffect, useState } from "react";
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

/**
 * Element-picker overlay. Renders a hover highlight box that follows the
 * pointer and intercepts the next click on the page. The visual layer is
 * pointer-events: none so the page still receives hover styling while the
 * user explores; selection happens via document-level capture-phase listeners.
 *
 * All listeners are bound through `ctx.addEventListener`, which auto-removes
 * them when the content script's context is invalidated (extension reload /
 * disable / update). Without this, zombie listeners would survive and start
 * throwing on dead extension API calls.
 *
 * Keyboard:
 *   Esc                 → cancel
 *   Enter               → confirm current target
 *   Arrow Up            → walk up to parent
 *   Arrow Down          → walk down to first child
 *   Arrow Left / Right  → walk to previous / next sibling
 */
export function Picker({
  active,
  ctx,
  shadowHost,
  onConfirm,
  onCancel,
}: PickerProps) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (!active) {
      setTarget(null);
      setRect(null);
      return;
    }

    const previousCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = "crosshair";

    const updateRect = (element: HTMLElement | null) => {
      if (!element) {
        setRect(null);
        return;
      }
      const r = element.getBoundingClientRect();
      setRect({
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
      });
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
      updateRect(candidate);
    };

    const onClick = (event: MouseEvent) => {
      if (isFromOurUi(event)) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      const picked = (event.target as HTMLElement | null) ?? target;
      if (picked) {
        onConfirm(picked);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCancel();
        return;
      }
      if (!target) {
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onConfirm(target);
        return;
      }
      const next = neighborForKey(target, event.key);
      if (next) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setTarget(next);
        updateRect(next);
      }
    };

    const onScrollOrResize = () => {
      updateRect(target);
    };

    // ctx.addEventListener auto-removes these when the extension context is
    // invalidated (reload / disable / update). The `capture: true` form runs
    // before page handlers so we can preventDefault clicks.
    ctx.addEventListener(document, "pointermove", onPointerMove, {
      capture: true,
    });
    ctx.addEventListener(document, "click", onClick, { capture: true });
    ctx.addEventListener(document, "keydown", onKeyDown, { capture: true });
    ctx.addEventListener(window, "scroll", onScrollOrResize, { capture: true });
    ctx.addEventListener(window, "resize", onScrollOrResize);

    return () => {
      document.documentElement.style.cursor = previousCursor;
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [active, ctx, shadowHost, target, onConfirm, onCancel]);

  if (!active) {
    return null;
  }

  return renderPicker(rect);
}

function renderPicker(rect: Rect | null) {
  return (
    <>
      {rect ? (
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
      ) : null}
      <div
        className="pointer-events-none fixed top-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-primary-foreground text-xs shadow-md"
        role="status"
      >
        <span>Click to copy this element to Figma</span>
        <span className="text-primary-foreground/70">·</span>
        <span className="text-primary-foreground/70">Esc to cancel</span>
      </div>
    </>
  );
}

function neighborForKey(target: HTMLElement, key: string): HTMLElement | null {
  if (key === "ArrowUp") {
    return target.parentElement;
  }
  if (key === "ArrowDown") {
    return target.firstElementChild as HTMLElement | null;
  }
  if (key === "ArrowLeft") {
    return target.previousElementSibling as HTMLElement | null;
  }
  if (key === "ArrowRight") {
    return target.nextElementSibling as HTMLElement | null;
  }
  return null;
}
