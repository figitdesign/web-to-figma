import { describe, expect, it } from "vitest";
import type { MontagePanel } from "./montage";
import { buildMontageHtml } from "./montage";

const PANELS: ReadonlyArray<MontagePanel> = [
  {
    label: "Target",
    sub: "browser",
    tone: "#334155",
    dataUri: "data:image/png;base64,AAAA",
  },
  {
    label: "Before",
    sub: "this PR",
    tone: "#b42318",
    dataUri: "data:image/png;base64,BBBB",
  },
  {
    label: "After",
    sub: "this PR",
    tone: "#0a7d33",
    dataUri: "data:image/png;base64,CCCC",
  },
];

describe("buildMontageHtml()", () => {
  it("embeds the title and all three panel labels", () => {
    const html = buildMontageHtml("00-smoke/two-boxes", PANELS);
    expect(html).toContain("<h1>00-smoke/two-boxes</h1>");
    for (const panel of PANELS) {
      expect(html).toContain(panel.label);
      expect(html).toContain(panel.sub);
    }
  });

  it("colors each caption with its panel tone", () => {
    const html = buildMontageHtml("t", PANELS);
    expect(html).toContain("color:#334155");
    expect(html).toContain("color:#b42318");
    expect(html).toContain("color:#0a7d33");
  });

  it("inlines every panel's data URI as an image source", () => {
    const html = buildMontageHtml("t", PANELS);
    for (const panel of PANELS) {
      expect(html).toContain(`src="${panel.dataUri}"`);
    }
  });

  it("honors a custom display width", () => {
    expect(buildMontageHtml("t", PANELS, 320)).toContain("width:320px");
  });
});
