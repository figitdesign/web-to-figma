import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";
import { loadEnv } from "../env";
import {
  cleanCanvas,
  openFigma,
  pastePayload,
  waitForSettlement,
} from "./paste";
import type { SessionConfig } from "./session";

// The M2 canary: requires a real Figma session + file. Gated behind
// FIGMA_ORACLE_LIVE=1 so it never runs in default CI. Run locally with:
//   FIGMA_ORACLE_LIVE=1 pnpm --filter @figit/oracle-harness exec vitest run src/figma/paste.live.test.ts
const LIVE = process.env.FIGMA_ORACLE_LIVE === "1";
const REPO = resolve(import.meta.dirname, "../../../..");
const SENT = readFileSync(
  resolve(import.meta.dirname, "__fixtures__/two-boxes.sent.html"),
  "utf-8"
);
const SETTLE_TIMEOUT_MS = 90_000;
const TEST_TIMEOUT_MS = 150_000;

function liveConfig(): SessionConfig {
  const env = loadEnv();
  return {
    storageState: {
      kind: "path",
      path: resolve(
        REPO,
        env.FIGMA_STORAGE_STATE ?? ".figma-storage-state.json"
      ),
    },
    fileKey: env.FIGMA_FILE_KEY ?? "",
  };
}

describe.skipIf(!LIVE)("figma paste (live)", () => {
  it(
    "cleans, pastes 00-smoke, and settles to the expected frame",
    async () => {
      const session = await openFigma(liveConfig());
      try {
        await cleanCanvas(session.page);
        await pastePayload(session.page, SENT);
        const settlement = await waitForSettlement(
          session.page,
          ["Two Boxes"],
          SETTLE_TIMEOUT_MS
        );
        expect(settlement.ok).toBe(true);
        expect(settlement.frames).toContain("Two Boxes");
        expect(settlement.capturedHtml).toContain("(figma)");
      } finally {
        await session.browser.close();
      }
    },
    TEST_TIMEOUT_MS
  );
});
