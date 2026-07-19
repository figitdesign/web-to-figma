import { execFileSync } from "node:child_process";
import type { ChangedFile, FileStatus, GuardLabel, LedgerFlip } from "./guard";
import { parseEntry } from "./ledger";

const KNOWN_FINDINGS = "internal/oracle-harness/known-findings/";
const MD_SUFFIX = /\.md$/;

/** Run git in `cwd`, returning stdout; empty string when git exits non-zero
 * (e.g. `git show` of a path that didn't exist at the base ref). */
function git(cwd: string, args: ReadonlyArray<string>): string {
  try {
    return execFileSync("git", [...args], { cwd, encoding: "utf-8" });
  } catch {
    return "";
  }
}

/** Parse `git diff --name-status` output into changed files. Renames (`R100`)
 * collapse to the destination path with status `R`. */
export function parseNameStatus(raw: string): Array<ChangedFile> {
  const files: Array<ChangedFile> = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const parts = line.split("\t");
    const letter = (parts[0] ?? "")[0];
    if (!letter) {
      continue;
    }
    // Rename/copy lines carry old and new paths; the new path is last.
    const path = parts.at(-1) ?? "";
    const status: FileStatus =
      letter === "A" || letter === "M" || letter === "D" ? letter : "R";
    files.push({ path, status });
  }
  return files;
}

/** A ledger `.md`'s status, or null if absent/unparseable. */
function statusOf(markdown: string): string | null {
  if (markdown.trim() === "") {
    return null;
  }
  try {
    return parseEntry(markdown).status;
  } catch {
    return null;
  }
}

/** Status transitions for every changed ledger entry between `base` and HEAD.
 * Newly-added entries (no prior status) yield no flip. */
function ledgerFlips(
  repoRoot: string,
  base: string,
  changed: ReadonlyArray<ChangedFile>
): Array<LedgerFlip> {
  const flips: Array<LedgerFlip> = [];
  for (const file of changed) {
    if (
      !(file.path.startsWith(KNOWN_FINDINGS) && file.path.endsWith(".md")) ||
      file.path.endsWith("README.md")
    ) {
      continue;
    }
    const from = statusOf(git(repoRoot, ["show", `${base}:${file.path}`]));
    if (from === null) {
      continue;
    }
    const to =
      statusOf(git(repoRoot, ["show", `HEAD:${file.path}`])) ?? "deleted";
    const cls = file.path.slice(KNOWN_FINDINGS.length).replace(MD_SUFFIX, "");
    flips.push({ class: cls, from, to });
  }
  return flips;
}

/** Gather everything `checkGuard` needs from git for a PR branch. */
export function collectGuardInput(opts: {
  label: GuardLabel;
  base: string;
  repoRoot: string;
}): {
  label: GuardLabel;
  changedFiles: Array<ChangedFile>;
  ledgerFlips: Array<LedgerFlip>;
} {
  const changedFiles = parseNameStatus(
    git(opts.repoRoot, ["diff", "--name-status", `${opts.base}...HEAD`])
  );
  return {
    label: opts.label,
    changedFiles,
    ledgerFlips: ledgerFlips(opts.repoRoot, opts.base, changedFiles),
  };
}
