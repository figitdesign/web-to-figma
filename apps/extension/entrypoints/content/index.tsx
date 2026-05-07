import { createRoot } from "react-dom/client";
import { createShadowRootUi, defineContentScript } from "#imports";

import { controller } from "../../shared/controller";
import type { TriggerAction } from "../../shared/triggers";
import { TRIGGER_GLOBAL } from "../../shared/triggers";
import { App } from "./app";
import { copyElement, copyWholePage } from "./convert";

import "./style.css";
import "sonner/dist/styles.css";

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
      // Picker hot keys must not leak into the page underneath.
      isolateEvents: ["keydown", "keyup", "keypress"],
      onMount(container, _shadow, shadowHost) {
        const root = createRoot(container);
        root.render(
          <App
            ctx={ctx}
            onPickerConfirm={copyElement}
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

    // The popup invokes this via `executeScript` in the isolated world, which
    // is the same world as this script — so user activation rides along.
    window[TRIGGER_GLOBAL] = (action) => {
      if (action === "copy-whole-page") {
        copyWholePage();
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
