import { Toaster } from "@sleekdesign/ui/components/sonner";
import { useCallback, useEffect, useState } from "react";
import type { ContentScriptContext } from "#imports";

import { controller } from "../../shared/controller";
import { Picker } from "./picker";

type AppProps = {
  ctx: ContentScriptContext;
  shadowHost: HTMLElement;
  onPickerConfirm: (element: HTMLElement) => void;
};

export function App({ ctx, shadowHost, onPickerConfirm }: AppProps) {
  const [pickerActive, setPickerActive] = useState(false);

  useEffect(
    () =>
      controller.subscribe((action) => {
        switch (action.type) {
          case "start-picker":
            setPickerActive(true);
            return;
          case "cancel-picker":
            setPickerActive(false);
            return;
          default:
            assertNever(action);
        }
      }),
    []
  );

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
      {/* The Sleek-themed Sonner toaster handles all transient feedback. */}
      <Toaster position="bottom-right" richColors theme="light" />
    </>
  );
}

function assertNever(value: never): never {
  throw new Error(`Unhandled UiAction: ${JSON.stringify(value)}`);
}
