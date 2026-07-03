import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

// Clipboardy and `pbpaste` only read `text/plain`. Figma's payload lives in
// the `text/html` representation, so we have to ask the OS for that MIME type
// directly. macOS exposes it as the `public.html` pasteboard UTI; we reach it
// via JXA + AppKit since `pbpaste` has no flag for it. Linux uses xclip with
// `-t text/html`. Windows users pipe HTML on stdin or pass a file path.
function readClipboardHtml(): string {
  if (process.platform === "darwin") {
    return execSync(
      `osascript -l JavaScript -e 'ObjC.import("AppKit"); ` +
        `$.NSPasteboard.generalPasteboard.stringForType("public.html").js'`,
      { encoding: "utf-8" }
    );
  }
  if (process.platform === "linux") {
    return execSync("xclip -selection clipboard -t text/html -o", {
      encoding: "utf-8",
    });
  }
  throw new Error(
    `Clipboard read not supported on ${process.platform}. Pass an HTML file path or pipe HTML on stdin.`
  );
}

/**
 * Resolve the HTML input for a clipboard-consuming script: an explicit file
 * path argument, piped stdin (or an explicit `-`), or the system clipboard.
 */
export function readHtmlInput(fileArg: string | undefined): string {
  if (fileArg && fileArg !== "-") {
    return readFileSync(fileArg, "utf-8");
  }
  if (fileArg === "-" || !process.stdin.isTTY) {
    return readFileSync(0, "utf-8");
  }
  return readClipboardHtml();
}
