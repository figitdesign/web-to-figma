type Rect = { x: number; y: number; width: number; height: number };

/** One DOM element's measured geometry and curated computed styles. Keyed by
 * the same `domPath` the converter trace uses (see converter/trace.ts). */
export type GroundTruthElement = {
  domPath: string;
  rect: Rect;
  styles: Record<string, string>;
  visible: boolean;
};

/** Everything captured from the browser render of one scene, independent of the
 * converter — the reference the tier-0 diff (WS-1.4) compares the payload to. */
export type GroundTruth = {
  sceneId: string;
  width: number;
  height: number;
  dpr: number;
  /** PNG path relative to the run root. */
  screenshotPath: string;
  elements: Array<GroundTruthElement>;
};

/**
 * Computed-style properties captured per element. Kept deliberately small and
 * in sync with the fields tier-0 compares (WS-1.4). Longhand only, so values
 * are stable across browsers.
 */
export const TRACKED_STYLES: ReadonlyArray<string> = [
  "display",
  "position",
  "opacity",
  "background-color",
  "background-image",
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
  "box-shadow",
  "overflow",
  "transform",
  "z-index",
  "gap",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "flex-direction",
  "justify-content",
  "align-items",
];
