/**
 * Regression tests against Figma-vetted oracle fixtures.
 *
 * Each fixture in `__fixtures__/oracle/` was produced by pasting converter
 * output into Figma, copying it back, verifying the round-trip was lossless
 * (`pnpm oracle:diff`), and distilling Figma's normalized node trees
 * (`pnpm oracle:distill`). These tests re-convert the same scenes and check
 * the output still matches what Figma accepted — no Figma required.
 */

import { STACK_FIELD_DEFAULTS, TRACKED_STACK_FIELDS } from "@figit/fig-kiwi";
import { describe, expect, it } from "vitest";
import alignCenterEnd from "../scripts/oracle-scenes/01-flex/align-center-end.html?raw";
import asymmetricPadding from "../scripts/oracle-scenes/01-flex/asymmetric-padding.html?raw";
import columnBasic from "../scripts/oracle-scenes/01-flex/column-basic.html?raw";
import justifyCenter from "../scripts/oracle-scenes/01-flex/justify-center.html?raw";
import justifyEnd from "../scripts/oracle-scenes/01-flex/justify-end.html?raw";
import marginSpacingBorder from "../scripts/oracle-scenes/01-flex/margin-spacing-border.html?raw";
import nested from "../scripts/oracle-scenes/01-flex/nested.html?raw";
import rowBasic from "../scripts/oracle-scenes/01-flex/row-basic.html?raw";
import spaceBetween from "../scripts/oracle-scenes/01-flex/space-between.html?raw";
import spaceEvenly from "../scripts/oracle-scenes/01-flex/space-evenly.html?raw";
import batch01 from "./__fixtures__/oracle/batch-01-flex.json";
import type { FigmaNodeChange } from "./converter/types";
import { createFigmaConverter } from "./figma";

const SCENE_HTML: Record<string, string> = {
  "Row Basic": rowBasic,
  "Column Basic": columnBasic,
  "Asymmetric Padding": asymmetricPadding,
  "Justify Center": justifyCenter,
  "Justify End": justifyEnd,
  "Space Between": spaceBetween,
  "Space Evenly": spaceEvenly,
  "Align Center End": alignCenterEnd,
  "Margin Spacing Border": marginSpacingBorder,
  Nested: nested,
};

type FixtureNode = {
  name: string;
  size: { x: number; y: number } | null;
  pos: { x: number; y: number } | null;
  stack: Record<string, unknown>;
};

const GEOMETRY_TOLERANCE = 0.6;

// The wrapper stands in for the capture's iframe body, so its fill-parent
// heuristics (grow/stretch against the harness, not the scene) are artifacts.
const HARNESS_ONLY_FIELDS = new Set([
  "stackChildPrimaryGrow",
  "stackChildAlignSelf",
]);

function stackOf(
  node: Record<string, unknown>,
  ignoreHarnessFields: boolean
): Record<string, unknown> {
  const stack: Record<string, unknown> = {};
  for (const field of TRACKED_STACK_FIELDS) {
    if (ignoreHarnessFields && HARNESS_ONLY_FIELDS.has(field)) {
      continue;
    }
    const value = node[field];
    if (value !== undefined && value !== STACK_FIELD_DEFAULTS[field]) {
      stack[field] = value;
    }
  }
  return stack;
}

function expectClose(
  actual: number | undefined,
  expected: number,
  tolerance: number,
  label: string
) {
  expect(
    actual !== undefined && Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`
  ).toBe(true);
}

describe("oracle fixtures (batch-01-flex, Figma-vetted)", () => {
  for (const scene of batch01.scenes) {
    it(`reproduces the accepted conversion of "${scene.name}"`, async () => {
      const html = SCENE_HTML[scene.name];
      expect(html, `scene html for "${scene.name}"`).toBeDefined();

      const wrapper = document.createElement("div");
      wrapper.style.width = `${scene.width}px`;
      wrapper.style.height = `${scene.height}px`;
      wrapper.innerHTML = html as string;
      document.body.appendChild(wrapper);

      try {
        const figma = createFigmaConverter({ layout: "auto" });
        const result = await figma.convert({
          element: wrapper,
          width: scene.width,
          height: scene.height,
          name: scene.name,
        });

        // Emission order is depth-first: root template frame (localID 2),
        // then the wrapper, then the scene tree — matching fixture order.
        const emitted = result.document.nodeChanges.filter(
          (change) => change.guid.localID >= 2
        ) as Array<FigmaNodeChange & Record<string, unknown>>;
        const fixtureNodes = scene.nodes as Array<FixtureNode>;

        expect(emitted).toHaveLength(fixtureNodes.length);

        fixtureNodes.forEach((expectedNode, i) => {
          const actual = emitted[i] as FigmaNodeChange &
            Record<string, unknown>;
          const label = `[${scene.name}] #${i} ${expectedNode.name}`;

          // The wrapper node (#1) stands in for the capture's iframe body;
          // its fill heuristics are harness artifacts, not scene semantics.
          const isWrapperNode = i === 1;
          expect(stackOf(actual, isWrapperNode)).toEqual(
            isWrapperNode
              ? Object.fromEntries(
                  Object.entries(expectedNode.stack).filter(
                    ([field]) => !HARNESS_ONLY_FIELDS.has(field)
                  )
                )
              : expectedNode.stack
          );

          if (expectedNode.size) {
            expectClose(
              actual.size?.x,
              expectedNode.size.x,
              GEOMETRY_TOLERANCE,
              `${label} size.x`
            );
            expectClose(
              actual.size?.y,
              expectedNode.size.y,
              GEOMETRY_TOLERANCE,
              `${label} size.y`
            );
          }
          if (expectedNode.pos && i > 0) {
            expectClose(
              actual.transform?.m02,
              expectedNode.pos.x,
              GEOMETRY_TOLERANCE,
              `${label} pos.x`
            );
            expectClose(
              actual.transform?.m12,
              expectedNode.pos.y,
              GEOMETRY_TOLERANCE,
              `${label} pos.y`
            );
          }
        });
      } finally {
        wrapper.remove();
      }
    });
  }
});
