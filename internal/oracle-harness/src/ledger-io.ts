import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import type { LedgerEntry } from "./ledger";
import { parseEntry, serializeEntry } from "./ledger";

const LEDGER_DIR = resolve(import.meta.dirname, "../known-findings");
const COUNTER_NAME = ".run-counter";

/** Read every `<class>.md` entry in a ledger dir, keyed by class. */
export function readLedger(dir: string = LEDGER_DIR): Map<string, LedgerEntry> {
  const entries = new Map<string, LedgerEntry>();
  if (!existsSync(dir)) {
    return entries;
  }
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md") || name === "README.md") {
      continue;
    }
    const entry = parseEntry(readFileSync(resolve(dir, name), "utf-8"));
    entries.set(entry.class, entry);
  }
  return entries;
}

/** Write all entries and delete the files of resolved classes. */
export function writeLedger(
  entries: ReadonlyMap<string, LedgerEntry>,
  resolved: ReadonlyArray<string>,
  dir: string = LEDGER_DIR
): void {
  mkdirSync(dir, { recursive: true });
  for (const entry of entries.values()) {
    writeFileSync(resolve(dir, `${entry.class}.md`), serializeEntry(entry));
  }
  for (const cls of resolved) {
    const path = resolve(dir, `${cls}.md`);
    if (existsSync(path)) {
      rmSync(path);
    }
  }
}

/** Current monotonic run counter (0 if unset). */
export function readRunCounter(dir: string = LEDGER_DIR): number {
  const path = resolve(dir, COUNTER_NAME);
  if (!existsSync(path)) {
    return 0;
  }
  return Number(readFileSync(path, "utf-8").trim()) || 0;
}

export function writeRunCounter(value: number, dir: string = LEDGER_DIR): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, COUNTER_NAME), `${value}\n`);
}
