import { useCallback, useEffect, useState } from "react";
import type { ContentScriptContext } from "#imports";

import { controller } from "../../shared/controller";
import { Picker } from "./picker";
import type { ToastEntry } from "./toast";
import { ToastViewport } from "./toast";

const DEFAULT_TOAST_DURATION_MS = 4000;

type AppProps = {
  ctx: ContentScriptContext;
  shadowHost: HTMLElement;
  onPickerConfirm: (element: HTMLElement) => void;
};

/**
 * Root React component mounted inside the shadow root. Subscribes to the
 * controller bus so the content-script entrypoint can imperatively request a
 * toast or toggle the picker.
 */
export function App({ ctx, shadowHost, onPickerConfirm }: AppProps) {
  const [pickerActive, setPickerActive] = useState(false);
  const [toasts, setToasts] = useState<ReadonlyArray<ToastEntry>>([]);

  useEffect(() => {
    let nextToastId = 1;
    return controller.subscribe((action) => {
      if (action.type === "start-picker") {
        setPickerActive(true);
        return;
      }
      if (action.type === "cancel-picker") {
        setPickerActive(false);
        return;
      }
      if (action.type === "show-toast") {
        const id = nextToastId++;
        setToasts((current) => [
          ...current,
          {
            id,
            kind: action.kind,
            message: action.message,
            durationMs: action.durationMs ?? DEFAULT_TOAST_DURATION_MS,
          },
        ]);
      }
    });
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const handleConfirm = useCallback(
    (element: HTMLElement) => {
      setPickerActive(false);
      onPickerConfirm(element);
    },
    [onPickerConfirm]
  );

  const handleCancel = useCallback(() => {
    setPickerActive(false);
  }, []);

  return (
    <>
      <Picker
        active={pickerActive}
        ctx={ctx}
        onCancel={handleCancel}
        onConfirm={handleConfirm}
        shadowHost={shadowHost}
      />
      <ToastViewport onDismiss={dismissToast} toasts={toasts} />
    </>
  );
}
