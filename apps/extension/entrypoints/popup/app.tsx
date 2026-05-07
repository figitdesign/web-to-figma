import { Button } from "@sleekdesign/ui/components/button";
import { useCallback, useState } from "react";
import { browser } from "#imports";

import { toErrorMessage } from "../../shared/errors";
import type { TriggerAction } from "../../shared/triggers";
import { TRIGGER_GLOBAL } from "../../shared/triggers";

const RESTRICTED_PAGE_HINT =
  "This page can't be captured (browser-internal pages and the Chrome Web Store are restricted).";

const RESTRICTED_URL_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "edge://",
  "about:",
  "moz-extension://",
  "https://chromewebstore.google.com",
  "https://chrome.google.com/webstore",
];

export function App() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<TriggerAction | null>(null);

  const dispatch = useCallback(async (action: TriggerAction) => {
    setError(null);
    setBusy(action);
    try {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) {
        throw new Error("No active tab.");
      }
      if (isRestrictedUrl(tab.url)) {
        setError(RESTRICTED_PAGE_HINT);
        return;
      }

      // executeScript propagates the popup's user activation into the content
      // script's isolated world. That's what `navigator.clipboard.write` needs
      // for the figma-flavoured ClipboardItem; `tabs.sendMessage` would not.
      // Requires `scripting` + `activeTab` permissions.
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        args: [action, TRIGGER_GLOBAL],
        func: invokeTrigger,
      });

      // Picker mode needs the popup out of the way so the user can click the
      // page. Whole-page copy resolves quickly with a toast on the page.
      window.close();
    } catch (cause) {
      // biome-ignore lint/suspicious/noConsole: user-facing error is rendered below
      console.error("[copy-to-figma] popup dispatch failed", cause);
      setError(toErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  }, []);

  return (
    <main className="flex flex-col gap-3 p-4">
      <h1 className="font-heading font-medium text-base">Copy to Figma</h1>
      <p className="text-muted-foreground text-sm">
        Pick a section of the page or copy the whole thing into Figma.
      </p>
      <div className="flex flex-col gap-2">
        <Button
          disabled={busy !== null}
          onClick={() => dispatch("copy-whole-page")}
        >
          {busy === "copy-whole-page" ? "Copying…" : "Copy whole page"}
        </Button>
        <Button
          disabled={busy !== null}
          onClick={() => dispatch("start-picker")}
          variant="outline"
        >
          {busy === "start-picker" ? "Starting…" : "Pick element…"}
        </Button>
      </div>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </main>
  );
}

function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  return RESTRICTED_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

/**
 * Serialized via `Function#toString` and re-parsed inside the page's isolated
 * world by `executeScript`. Cannot reference imports — the args carry
 * everything it needs, including the global key the content script set.
 */
function invokeTrigger(action: string, key: string) {
  const trigger = (window as unknown as Record<string, unknown>)[key];
  if (typeof trigger === "function") {
    (trigger as (a: string) => void)(action);
  }
}
