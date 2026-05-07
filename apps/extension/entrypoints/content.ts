import { defineContentScript } from "wxt/utils/define-content-script";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  cssInjectionMode: "ui",
  main(_ctx) {
    // Picker overlay + dom-to-figma conversion will mount here in a follow-up.
  },
});
