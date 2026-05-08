import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Copy to Figma",
    description:
      "Copy any website to Figma. One click, paste in Figma. No plugin needed.",
    permissions: ["activeTab", "clipboardWrite", "scripting", "storage"],
    host_permissions: ["<all_urls>"],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
