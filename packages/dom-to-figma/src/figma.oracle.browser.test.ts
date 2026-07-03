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
import fillChild from "../scripts/oracle-scenes/02-sizing/fill-child.html?raw";
import fillTwo from "../scripts/oracle-scenes/02-sizing/fill-two.html?raw";
import growUnequal from "../scripts/oracle-scenes/02-sizing/grow-unequal.html?raw";
import hugColumn from "../scripts/oracle-scenes/02-sizing/hug-column.html?raw";
import hugRow from "../scripts/oracle-scenes/02-sizing/hug-row.html?raw";
import nestedMix from "../scripts/oracle-scenes/02-sizing/nested-mix.html?raw";
import stretchCross from "../scripts/oracle-scenes/02-sizing/stretch-cross.html?raw";
import absoluteBadge from "../scripts/oracle-scenes/03-flow/absolute-badge.html?raw";
import absoluteInBlock from "../scripts/oracle-scenes/03-flow/absolute-in-block.html?raw";
import blockCenter from "../scripts/oracle-scenes/03-flow/block-center.html?raw";
import blockColumn from "../scripts/oracle-scenes/03-flow/block-column.html?raw";
import blockHug from "../scripts/oracle-scenes/03-flow/block-hug.html?raw";
import blockStretch from "../scripts/oracle-scenes/03-flow/block-stretch.html?raw";
import cardMock from "../scripts/oracle-scenes/03-flow/card-mock.html?raw";
import columnReverse from "../scripts/oracle-scenes/04-wrap/column-reverse.html?raw";
import gridSingleCol from "../scripts/oracle-scenes/04-wrap/grid-single-col.html?raw";
import gridUniform from "../scripts/oracle-scenes/04-wrap/grid-uniform.html?raw";
import rowReverse from "../scripts/oracle-scenes/04-wrap/row-reverse.html?raw";
import wrapRows from "../scripts/oracle-scenes/04-wrap/wrap-rows.html?raw";
import wrapStretchGap from "../scripts/oracle-scenes/04-wrap/wrap-stretch-gap.html?raw";
import fixture from "./__fixtures__/oracle/batch-04-final.json";
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
  "Hug Row": hugRow,
  "Hug Column": hugColumn,
  "Fill Child": fillChild,
  "Fill Two": fillTwo,
  "Stretch Cross": stretchCross,
  "Grow Unequal": growUnequal,
  "Nested Mix": nestedMix,
  "Block Column": blockColumn,
  "Block Center": blockCenter,
  "Block Stretch": blockStretch,
  "Block Hug": blockHug,
  "Absolute Badge": absoluteBadge,
  "Absolute In Block": absoluteInBlock,
  "Card Mock": cardMock,
  "Wrap Rows": wrapRows,
  "Wrap Stretch Gap": wrapStretchGap,
  "Row Reverse": rowReverse,
  "Column Reverse": columnReverse,
  "Grid Uniform": gridUniform,
  "Grid Single Col": gridSingleCol,
};

type FixtureNode = {
  name: string;
  size: { x: number; y: number } | null;
  pos: { x: number; y: number } | null;
  stack: Record<string, unknown>;
  parentIsStack: boolean;
};

const GEOMETRY_TOLERANCE = 0.6;

// The wrapper stands in for the capture's iframe body, so its fill-parent
// heuristics (grow/stretch against the harness, not the scene) are
// artifacts. The wrapper's own sizing modes are too: the iframe body has
// auto height (hugs at equilibrium) while the test wrapper is explicitly
// sized (FIXED).
const HARNESS_ONLY_FIELDS = new Set([
  "stackChildPrimaryGrow",
  "stackChildAlignSelf",
]);
const WRAPPER_HARNESS_FIELDS = new Set([
  ...HARNESS_ONLY_FIELDS,
  "stackPrimarySizing",
  "stackCounterSizing",
  // Trailing leftover folds into the measured pad on the fixed-height test
  // wrapper but not on the auto-height iframe body.
  "stackPaddingBottom",
]);

function stackOf(
  node: Record<string, unknown>,
  skipFields: ReadonlySet<string> | null
): Record<string, unknown> {
  const stack: Record<string, unknown> = {};
  for (const field of TRACKED_STACK_FIELDS) {
    if (skipFields?.has(field)) {
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

describe(`oracle fixtures (${fixture.batch}, Figma-vetted)`, () => {
  // Fixture scenes without a local html mapping (e.g. corpus integration
  // pages with real text/fonts) are gate-vetted via the paste round-trip and
  // replayed in CI by the corpus sweep instead.
  for (const scene of fixture.scenes.filter((s) => SCENE_HTML[s.name])) {
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

          // Child fill/stretch fields are placebo when the parent isn't a
          // stack (legacy heuristics fire on harness geometry, e.g. the
          // wrapper standing in for the capture's iframe body) — skip them
          // there and compare them strictly inside real stacks. The wrapper
          // node additionally skips its own sizing modes (see above).
          let skipFields: ReadonlySet<string> | null = null;
          if (i === 1) {
            skipFields = WRAPPER_HARNESS_FIELDS;
          } else if (!expectedNode.parentIsStack) {
            skipFields = HARNESS_ONLY_FIELDS;
          }
          expect(stackOf(actual, skipFields)).toEqual(
            skipFields
              ? Object.fromEntries(
                  Object.entries(expectedNode.stack).filter(
                    ([field]) => !skipFields.has(field)
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
