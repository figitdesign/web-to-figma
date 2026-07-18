import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import type { ConvertTrace } from "@figit/dom-to-figma";
import type { Browser } from "playwright";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildConverterBundle } from "./bundle";
import type { GroundTruth } from "./ground-truth";
import { discoverScenes } from "./scenes";
import { runSnapshot } from "./snapshot";

const SMOKE_ID = "00-smoke/two-boxes";
const SMOKE_STEM = "00-smoke__two-boxes";
const BUILD_TIMEOUT = 120_000;
const CASE_TIMEOUT = 60_000;
const TEXT_ORDINAL_SUFFIX = /::text\[\d+]$/;

const smoke = discoverScenes().find((scene) => scene.id === SMOKE_ID);
if (!smoke) {
  throw new Error(`fixture scene ${SMOKE_ID} not found`);
}

function readGroundTruth(dir: string): GroundTruth {
  return JSON.parse(
    readFileSync(resolve(dir, "ground-truth", `${SMOKE_STEM}.json`), "utf-8")
  ) as GroundTruth;
}

function readTrace(dir: string): ConvertTrace {
  return JSON.parse(
    readFileSync(resolve(dir, "payloads", `${SMOKE_STEM}.trace.json`), "utf-8")
  ) as ConvertTrace;
}

// Launches Chromium + builds the converter bundle; excluded from the default
// `pnpm test` to avoid oversubscribing CI alongside the other browser suites.
// Run with `ORACLE_BROWSER=1`. Corpus coverage in CI comes from the parity job.
describe.skipIf(process.env.ORACLE_BROWSER !== "1")("runSnapshot()", () => {
  let browser: Browser;
  let bundle: string;
  const tmpDirs: Array<string> = [];

  beforeAll(async () => {
    bundle = await buildConverterBundle();
    browser = await chromium.launch();
  }, BUILD_TIMEOUT);

  afterAll(async () => {
    await browser?.close();
    for (const dir of tmpDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tmp(): string {
    const dir = mkdtempSync(join(tmpdir(), "oracle-snap-"));
    tmpDirs.push(dir);
    return dir;
  }

  it(
    "writes ground truth, payload, trace, and a scene-sized screenshot",
    async () => {
      const out = tmp();
      const [result] = await runSnapshot({
        scenes: [smoke],
        layout: "auto",
        outDir: out,
        browser,
        bundle,
      });

      expect(result?.nodeChanges ?? 0).toBeGreaterThan(0);
      for (const rel of [
        `ground-truth/${SMOKE_STEM}.json`,
        `ground-truth/${SMOKE_STEM}.png`,
        `payloads/${SMOKE_STEM}.html`,
        `payloads/${SMOKE_STEM}.trace.json`,
      ]) {
        expect(existsSync(resolve(out, rel))).toBe(true);
      }

      const groundTruth = readGroundTruth(out);
      expect(groundTruth.width).toBe(smoke.width);
      expect(groundTruth.height).toBe(smoke.height);
      expect(groundTruth.dpr).toBe(1);
    },
    CASE_TIMEOUT
  );

  it(
    "captures ground truth covering every traced element",
    async () => {
      const out = tmp();
      await runSnapshot({
        scenes: [smoke],
        layout: "auto",
        outDir: out,
        browser,
        bundle,
      });

      const paths = new Set(
        readGroundTruth(out).elements.map((element) => element.domPath)
      );
      const trace = readTrace(out);
      expect(trace.entries.length).toBeGreaterThan(0);
      for (const entry of trace.entries) {
        // Text entries carry a `::text[i]` suffix; strip it to the owner.
        const ownerPath = entry.domPath.replace(TEXT_ORDINAL_SUFFIX, "");
        expect(paths.has(ownerPath)).toBe(true);
      }
    },
    CASE_TIMEOUT
  );

  it(
    "is deterministic: two runs produce byte-identical ground truth and screenshot",
    async () => {
      const a = tmp();
      const b = tmp();
      const opts = {
        scenes: [smoke],
        layout: "auto" as const,
        browser,
        bundle,
      };
      await runSnapshot({ ...opts, outDir: a });
      await runSnapshot({ ...opts, outDir: b });

      const jsonA = readFileSync(
        resolve(a, "ground-truth", `${SMOKE_STEM}.json`),
        "utf-8"
      );
      const jsonB = readFileSync(
        resolve(b, "ground-truth", `${SMOKE_STEM}.json`),
        "utf-8"
      );
      expect(jsonA).toBe(jsonB);

      const pngA = readFileSync(
        resolve(a, "ground-truth", `${SMOKE_STEM}.png`)
      );
      const pngB = readFileSync(
        resolve(b, "ground-truth", `${SMOKE_STEM}.png`)
      );
      expect(pngA.equals(pngB)).toBe(true);
    },
    CASE_TIMEOUT
  );
});
