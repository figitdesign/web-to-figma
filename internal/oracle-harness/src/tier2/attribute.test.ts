import { describe, expect, it } from "vitest";
import type { GroundTruthElement } from "../ground-truth";
import { attributeCluster } from "./attribute";
import type { Cluster } from "./cluster";

function el(
  domPath: string,
  rect: { x: number; y: number; width: number; height: number },
  visible = true
): GroundTruthElement {
  return { domPath, rect, styles: {}, visible };
}

const CLUSTER: Cluster = { x: 40, y: 40, width: 20, height: 20 };

describe("attributeCluster()", () => {
  it("attributes a cluster to the element that covers it", () => {
    const el1 = el(":scope > div:nth-child(1)", {
      x: 30,
      y: 30,
      width: 60,
      height: 60,
    });
    expect(attributeCluster(CLUSTER, [el1])).toBe(el1);
  });

  it("prefers the deepest covering element", () => {
    const outer = el(":scope", { x: 0, y: 0, width: 100, height: 100 });
    const inner = el(":scope > div:nth-child(1) > span:nth-child(1)", {
      x: 30,
      y: 30,
      width: 60,
      height: 60,
    });
    expect(attributeCluster(CLUSTER, [outer, inner])).toBe(inner);
  });

  it("returns null when no element covers 60% of the cluster", () => {
    const grazing = el(":scope > div", { x: 55, y: 55, width: 60, height: 60 });
    expect(attributeCluster(CLUSTER, [grazing])).toBeNull();
  });

  it("ignores invisible elements", () => {
    const hidden = el(
      ":scope > div",
      { x: 30, y: 30, width: 60, height: 60 },
      false
    );
    expect(attributeCluster(CLUSTER, [hidden])).toBeNull();
  });
});
