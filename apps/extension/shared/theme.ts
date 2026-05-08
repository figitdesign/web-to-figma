import { useEffect, useState } from "react";
import { storage } from "#imports";

export type ThemePreference = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

/**
 * Persisted theme preference. `"auto"` defers to host-page detection in the
 * content script and to the OS preference in the popup; `"light"` / `"dark"`
 * is a hard override that wins over both.
 */
export const themePreference = storage.defineItem<ThemePreference>(
  "local:theme-preference",
  { fallback: "auto" }
);

/**
 * Best-effort detection of the host page's theme. Layered to catch the
 * conventions used by Tailwind (a `.dark` class on `<html>` / `<body>`),
 * design systems like Radix / Mantine / MUI (`data-theme` / `data-mode`),
 * and modern sites that set `color-scheme` on the root. Falls back to the
 * OS preference if none of the above is conclusive.
 */
export function detectPageTheme(): ResolvedTheme {
  const html = document.documentElement;
  const body = document.body as HTMLElement | null;

  if (html.classList.contains("dark") || body?.classList.contains("dark")) {
    return "dark";
  }
  if (html.classList.contains("light") || body?.classList.contains("light")) {
    return "light";
  }

  for (const attr of ["data-theme", "data-mode"] as const) {
    const value = html.getAttribute(attr) ?? body?.getAttribute(attr) ?? null;
    if (value === "dark") {
      return "dark";
    }
    if (value === "light") {
      return "light";
    }
  }

  const colorScheme = getComputedStyle(html).colorScheme.trim();
  if (colorScheme === "dark") {
    return "dark";
  }
  if (colorScheme === "light") {
    return "light";
  }

  return detectSystemTheme();
}

export function detectSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function subscribePageTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  const observed = { attributes: true, attributeFilter: PAGE_THEME_ATTRS };
  observer.observe(document.documentElement, observed);
  if (document.body) {
    observer.observe(document.body, observed);
  }
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    mql.removeEventListener("change", onChange);
  };
}

export function subscribeSystemTheme(onChange: () => void): () => void {
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

const PAGE_THEME_ATTRS = ["class", "data-theme", "data-mode"];

/**
 * Resolves the user's theme preference into a concrete light/dark value.
 * `auto` defers to the supplied `detect` and re-evaluates whenever
 * `subscribe`'s callback fires; an explicit preference wins outright.
 */
export function useResolvedTheme(
  detect: () => ResolvedTheme,
  subscribe: (onChange: () => void) => () => void
): ResolvedTheme {
  const [preference, setPreference] = useState<ThemePreference>("auto");
  const [autoTheme, setAutoTheme] = useState<ResolvedTheme>(detect);

  useEffect(() => {
    themePreference.getValue().then(setPreference);
    return themePreference.watch(setPreference);
  }, []);

  useEffect(() => {
    if (preference !== "auto") {
      return;
    }
    const apply = () => setAutoTheme(detect());
    apply();
    return subscribe(apply);
  }, [preference, detect, subscribe]);

  return preference === "auto" ? autoTheme : preference;
}

/**
 * Reactive [preference, setter] tied to `themePreference`. The setter writes
 * to storage; any other context that's `watch`ing the same item picks up
 * the change automatically.
 */
export function useThemePreference(): [
  ThemePreference,
  (next: ThemePreference) => void,
] {
  const [preference, setPreference] = useState<ThemePreference>("auto");

  useEffect(() => {
    themePreference.getValue().then(setPreference);
    return themePreference.watch(setPreference);
  }, []);

  const update = (next: ThemePreference) => {
    setPreference(next);
    themePreference.setValue(next);
  };

  return [preference, update];
}
