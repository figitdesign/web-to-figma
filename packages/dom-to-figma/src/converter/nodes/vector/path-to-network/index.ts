import type { PathCommand } from "../path-parser";
import type {
  VectorNetwork,
  VectorRegion,
  WindingRule,
} from "../vector-networks/types";
import type { CurveBuilderState } from "./curve-builder";
import { createInitialState, processCommand } from "./curve-builder";

export type PathToVectorResult = {
  vectorNetwork: VectorNetwork;
  normalizationOffset?: { x: number; y: number };
};

export function convertPathToVectorNetwork(
  commands: Array<PathCommand>,
  params: { normalize: boolean; fillRule?: WindingRule } = { normalize: true }
): PathToVectorResult {
  const state = createInitialState();
  const fillRule = params.fillRule ?? "NONZERO";
  let normalizationOffset: { x: number; y: number } | undefined;

  // Collect each subpath as its own loop and emit a single region whose
  // windingRule matches the SVG fill-rule. With NONZERO, opposite winding
  // directions between loops cut holes (e.g. Phosphor outline icons whose
  // inner subpaths are wound counter to the outer outline). Splitting into
  // separate regions instead would render every subpath as a solid fill.
  const loops: Array<Array<number>> = [];
  let currentLoop: Array<number> = [];

  for (const cmd of commands) {
    if (cmd.type === "M" && currentLoop.length > 0) {
      loops.push(currentLoop);
      currentLoop = [];
    }

    processCommand(state, cmd);

    if (state.currentPath.length > currentLoop.length) {
      currentLoop.push(...state.currentPath.slice(currentLoop.length));
    }

    if (cmd.type === "Z") {
      if (currentLoop.length > 0) {
        loops.push(currentLoop);
        currentLoop = [];
      }
      state.currentPath = [];
    }
  }

  if (currentLoop.length > 0) {
    loops.push(currentLoop);
  }

  const regions: Array<VectorRegion> = [];
  if (loops.length > 0) {
    regions.push({
      styleID: 0,
      windingRule: fillRule,
      loops: loops.map((segments) => ({
        segments,
        windingRule: fillRule,
      })),
    });
  }

  if (params.normalize && state.vertices.length > 0) {
    normalizationOffset = normalizeVertices(state);
  }

  return {
    vectorNetwork: {
      vertices: state.vertices,
      segments: state.segments,
      regions,
    },
    normalizationOffset,
  };
}

function normalizeVertices(state: CurveBuilderState): { x: number; y: number } {
  // Find bounding box
  const firstVertex = state.vertices[0];
  if (!firstVertex) {
    return { x: 0, y: 0 };
  }

  let minX = firstVertex.x;
  let minY = firstVertex.y;
  let maxX = firstVertex.x;
  let maxY = firstVertex.y;

  for (const vertex of state.vertices) {
    minX = Math.min(minX, vertex.x);
    minY = Math.min(minY, vertex.y);
    maxX = Math.max(maxX, vertex.x);
    maxY = Math.max(maxY, vertex.y);
  }

  // Translate all vertices to start from (0,0)
  const offsetX = minX;
  const offsetY = minY;

  for (const vertex of state.vertices) {
    vertex.x -= offsetX;
    vertex.y -= offsetY;
  }

  // Return the offset that was applied
  return { x: offsetX, y: offsetY };
}
