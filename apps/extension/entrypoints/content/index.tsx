import { createRoot } from "react-dom/client";
import { createShadowRootUi, defineContentScript } from "#imports";

import { onTriggerEvent, SHADOW_HOST_NAME } from "../../shared/triggers";
import { App } from "./app";
import { copyElement, copyWholePage } from "./convert";

import "./style.css";
import "sonner/dist/styles.css";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  cssInjectionMode: "ui",
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: SHADOW_HOST_NAME,
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

    // The popup dispatches the trigger event via executeScript so its user
    // activation rides along into this isolated world. App listens for
    // "start-picker" separately to drive its UI state.
    onTriggerEvent(
      (action) => {
        if (action === "copy-whole-page") {
          copyWholePage();
        }
      },
      { signal: ctx.signal }
    );
  },
});
