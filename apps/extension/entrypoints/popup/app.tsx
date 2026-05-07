import { Button } from "@sleekdesign/ui/components/button";
import { useCallback, useState } from "react";
import { browser } from "#imports";
import type { TriggerAction } from "../../shared/triggers";
import { TRIGGER_GLOBAL } from "../../shared/triggers";

const RESTRICTED_PAGE_HINT =
  "This page can't be captured (browser-internal pages and the Chrome Web Store are restricted).";

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

      // executeScript propagates the popup's user activation into the content
      // script's isolated world. That activation is what
      // `navigator.clipboard.write` requires for the figma-flavoured
      // ClipboardItem. Requires `scripting` + `activeTab` permissions.
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        args: [action, TRIGGER_GLOBAL],
        func: (a: string, key: string) => {
          const w = window as unknown as Record<string, unknown>;
          const trigger = w[key];
          if (typeof trigger === "function") {
            (trigger as (action: string) => void)(a);
          }
        },
      });

      // Picker mode needs the popup out of the way so the user can click the
      // page. Whole-page copy resolves quickly with a toast on the page itself.
      window.close();
    } catch (cause) {
      // biome-ignore lint/suspicious/noConsole: dev diagnostic — user-facing error is rendered below
      console.error("[copy-to-figma] popup dispatch failed", cause);
      const message =
        cause instanceof Error ? cause.message : "Something went wrong.";
      setError(
        message.includes("Cannot access") || message.includes("chrome://")
          ? RESTRICTED_PAGE_HINT
          : message
      );
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
