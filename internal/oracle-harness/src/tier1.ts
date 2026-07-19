import type { Mismatch, OracleNode } from "@figit/fig-kiwi";
import {
  decodeFigmaData,
  diffFigmaTrees,
  parseClipboardHtml,
} from "@figit/fig-kiwi";
import type { Finding } from "./findings";
import { severityFromDelta } from "./findings";

const GEOMETRY_FIELD = /^(size|pos)\./;
// Non-geometry mismatches (a changed stack field, a renamed frame) get a fixed
// mid severity — they're categorical, not magnitude-based.
const CATEGORICAL_SEVERITY = 0.5;

function decodeNodes(html: string): Array<OracleNode> {
  return decodeFigmaData(parseClipboardHtml(html).fig).message
    .nodeChanges as Array<OracleNode>;
}

/** `kiwi.<field>` with the field made path-safe (spaces/punctuation → `-`). */
function classOf(field: string): `kiwi.${string}` {
  return `kiwi.${field.replace(/[^a-zA-Z0-9.]+/g, "-")}`;
}

function toFinding(sceneId: string, mismatch: Mismatch): Finding {
  const isGeometry = GEOMETRY_FIELD.test(mismatch.field);
  const deltaPx =
    isGeometry &&
    typeof mismatch.sent === "number" &&
    typeof mismatch.got === "number"
      ? Math.abs(mismatch.sent - mismatch.got)
      : undefined;
  return {
    sceneId,
    tier: 1,
    class: classOf(mismatch.field),
    severity:
      deltaPx === undefined ? CATEGORICAL_SEVERITY : severityFromDelta(deltaPx),
    // Figma re-ids nodes on paste, so the locator is a positional label.
    domPath: mismatch.node,
    field: mismatch.field,
    expected: mismatch.sent,
    actual: mismatch.got,
    deltaPx,
  };
}

/** Translate raw structural mismatches into tier-1 findings. Pure. */
export function mismatchesToFindings(
  sceneId: string,
  mismatches: ReadonlyArray<Mismatch>
): Array<Finding> {
  return mismatches.map((m) => toFinding(sceneId, m));
}

/**
 * Tier-1: compare what we sent to Figma against the payload Figma returns when
 * the rendered frame is copied back — both decoded kiwi. Each mismatch is a
 * field Figma reinterpreted on paste (auto-layout hug, font reflow, default
 * normalization).
 */
export function diffTier1(
  sceneId: string,
  sentHtml: string,
  capturedHtml: string
): Array<Finding> {
  return mismatchesToFindings(
    sceneId,
    diffFigmaTrees(decodeNodes(sentHtml), decodeNodes(capturedHtml))
  );
}
