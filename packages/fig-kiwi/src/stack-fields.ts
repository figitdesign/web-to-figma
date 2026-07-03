/**
 * Auto-layout (`stack*`) field knowledge shared by the oracle verification
 * tooling and regression tests.
 *
 * Figma omits fields that hold their default value when serializing a copied
 * node (established empirically via paste round-trips — see
 * .context/auto-layout/PLAN.md). Comparing payloads therefore requires
 * normalizing absent fields to these defaults first.
 */
export const STACK_FIELD_DEFAULTS: Record<string, unknown> = {
  stackMode: "NONE",
  stackSpacing: 0,
  stackCounterSpacing: 0,
  stackPrimaryAlignItems: "MIN",
  stackCounterAlignItems: "MIN",
  stackHorizontalPadding: 0,
  stackVerticalPadding: 0,
  stackPaddingRight: 0,
  stackPaddingBottom: 0,
  stackChildPrimaryGrow: 0,
  stackWrap: "NO_WRAP",
  stackPositioning: "AUTO",
  stackPrimarySizing: "FIXED",
  stackCounterSizing: "FIXED",
};

/** All auto-layout fields the oracle workflow tracks, defaults or not. */
export const TRACKED_STACK_FIELDS: ReadonlySet<string> = new Set([
  ...Object.keys(STACK_FIELD_DEFAULTS),
  "stackChildAlignSelf",
  "stackPrimaryAlignContent",
  "stackCounterAlignContent",
]);
