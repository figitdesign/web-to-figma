import { Toaster } from "@sleekdesign/ui/components/sonner";
import { useCallback, useEffect, useState } from "react";
import type { ContentScriptContext } from "#imports";

import {
  detectPageTheme,
  subscribePageTheme,
  useResolvedTheme,
} from "../../shared/theme";
import { onTriggerEvent } from "../../shared/triggers";
import { Picker } from "./picker";

type AppProps = {
  ctx: ContentScriptContext;
  shadowHost: HTMLElement;
  onPickerConfirm: (element: HTMLElement) => void;
};

export function App({ ctx, shadowHost, onPickerConfirm }: AppProps) {
  const [pickerActive, setPickerActive] = useState(false);
  const theme = useResolvedTheme(detectPageTheme, subscribePageTheme);

  useEffect(
    () =>
      onTriggerEvent((action) => {
        if (action === "start-picker") {
          setPickerActive(true);
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

  const handleCancel = useCallback(() => setPickerActive(false), []);

  return (
    <div className={theme}>
      <Picker
        active={pickerActive}
        ctx={ctx}
        onCancel={handleCancel}
        onConfirm={handleConfirm}
        shadowHost={shadowHost}
      />
      <Toaster position="bottom-right" richColors theme={theme} />
    </div>
  );
}
