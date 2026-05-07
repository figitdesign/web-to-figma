import { cn } from "@sleekdesign/ui/lib/utils";
import { useEffect } from "react";

import type { ToastKind } from "../../shared/controller";

export type ToastEntry = {
  id: number;
  kind: ToastKind;
  message: string;
  durationMs: number;
};

type ToastViewportProps = {
  toasts: ReadonlyArray<ToastEntry>;
  onDismiss: (id: number) => void;
};

export function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 flex flex-col items-end gap-2">
      {toasts.map((toast) => (
        <Toast key={toast.id} onDismiss={onDismiss} toast={toast} />
      ))}
    </div>
  );
}

function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastEntry;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      onDismiss(toast.id);
    }, toast.durationMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [toast.id, toast.durationMs, onDismiss]);

  return (
    <div
      className={cn(
        "neu-raised pointer-events-auto flex max-w-sm items-start gap-2 rounded-md px-3 py-2 text-sm shadow-md",
        toast.kind === "success" &&
          "text-primary-foreground [--neu-base:var(--primary)]",
        toast.kind === "error" && "text-white [--neu-base:var(--destructive)]",
        toast.kind === "info" &&
          "text-secondary-foreground [--neu-base:var(--secondary)]"
      )}
      role={toast.kind === "error" ? "alert" : "status"}
    >
      {toast.message}
    </div>
  );
}
