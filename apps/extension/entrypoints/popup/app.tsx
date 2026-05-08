import { MonitorIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";
import { Button } from "@sleekdesign/ui/components/button";
import type { ComponentType } from "react";
import { useCallback, useEffect, useState } from "react";
import { browser } from "#imports";

import { toErrorMessage } from "../../shared/errors";
import type { ThemePreference } from "../../shared/theme";
import {
  detectSystemTheme,
  subscribeSystemTheme,
  useResolvedTheme,
  useThemePreference,
} from "../../shared/theme";
import type { TriggerAction } from "../../shared/triggers";
import { TRIGGER_EVENT_NAME } from "../../shared/triggers";

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

const THEME_OPTIONS: ReadonlyArray<{
  value: ThemePreference;
  label: string;
  Icon: ComponentType<{ className?: string }>;
}> = [
  { value: "auto", label: "Auto", Icon: MonitorIcon },
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
];

export function App() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<TriggerAction | null>(null);
  const theme = useResolvedTheme(detectSystemTheme, subscribeSystemTheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

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

      // executeScript propagates the popup's user activation into the page's
      // isolated world; the synchronous CustomEvent dispatch keeps it active
      // through the content-script listener, so the downstream
      // `navigator.clipboard.write` call is allowed.
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        args: [action, TRIGGER_EVENT_NAME],
        func: dispatchTriggerEvent,
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
      <header className="flex items-center justify-between gap-3">
        <h1 className="font-heading font-medium text-base">Copy to Figma</h1>
        <ThemePicker />
      </header>
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

function ThemePicker() {
  const [preference, setPreference] = useThemePreference();
  return (
    <div
      aria-label="Theme"
      className="flex items-center gap-0.5"
      role="radiogroup"
    >
      {THEME_OPTIONS.map(({ value, label, Icon }) => (
        <Button
          aria-checked={preference === value}
          aria-label={label}
          data-active={preference === value}
          key={value}
          onClick={() => setPreference(value)}
          role="radio"
          size="icon"
          variant="ghost"
        >
          <Icon className="size-4" />
        </Button>
      ))}
    </div>
  );
}

function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  return RESTRICTED_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

/**
 * Inlined into the active tab via `executeScript`. Cannot reference imports —
 * args carry the action name and the agreed-upon event name.
 */
function dispatchTriggerEvent(action: string, eventName: string) {
  window.dispatchEvent(new CustomEvent(eventName, { detail: action }));
}
