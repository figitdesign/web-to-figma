import { createRoot } from "react-dom/client";
import { createShadowRootUi, defineContentScript } from "#imports";

import { controller } from "../../shared/controller";
import type { TriggerAction } from "../../shared/triggers";
import { TRIGGER_GLOBAL } from "../../shared/triggers";
import { App } from "./app";
import { copyElement, copyWholePage } from "./convert";

import "./style.css";

declare global {
  // biome-ignore lint/style/useConsistentTypeDefinitions: ambient global merging requires `interface`
  interface Window {
    [TRIGGER_GLOBAL]?: (action: TriggerAction) => void;
  }
}

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  cssInjectionMode: "ui",
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: "sleek-copy-figma-ui",
      position: "overlay",
      anchor: "html",
      // Stop hot keys (Esc, arrows, Enter) from leaking into the page while
      // the picker is active.
      isolateEvents: ["keydown", "keyup", "keypress"],
      onMount(container, _shadow, shadowHost) {
        const root = createRoot(container);
        root.render(
          <App
            ctx={ctx}
            onPickerConfirm={(element) => {
              copyElement(element).catch((error) => {
                // biome-ignore lint/suspicious/noConsole: surfaced via toast separately
                console.error("[copy-to-figma] copyElement failed", error);
              });
            }}
            shadowHost={shadowHost}
          />
        );
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.mount();

    // Hook the popup invokes via `chrome.scripting.executeScript`. The
    // injected function runs in the same isolated world as this content
    // script, so it sees this `window` and the activation flow is preserved.
    window[TRIGGER_GLOBAL] = (action) => {
      if (action === "copy-whole-page") {
        copyWholePage().catch((error) => {
          // biome-ignore lint/suspicious/noConsole: surfaced via toast separately
          console.error("[copy-to-figma] copyWholePage failed", error);
        });
        return;
      }
      if (action === "start-picker") {
        controller.dispatch({ type: "start-picker" });
      }
    };

    ctx.onInvalidated(() => {
      window[TRIGGER_GLOBAL] = undefined;
    });
  },
});
