import { defineBackground } from "wxt/utils/define-background";

export default defineBackground(() => {
  // Background service worker entry. Feature handlers (e.g. CORS-bypass
  // fetch proxy for image/font loaders) will hang off this in a follow-up.
});
