/**
 * An SVG `stroke-dasharray`, cut into explicit dash geometry.
 *
 * SVG runs one continuously-phased pattern along each subpath, at the exact
 * lengths the author asked for. Figma's own `dashPattern` cannot follow that:
 * it re-fits the pattern to every *segment* it is handed, stretching the period
 * to the nearest whole number of repeats and centring a dash on each vertex.
 * A 12/8 dash on a 70×80 rect comes back as 10.5/7 along the 70px sides and
 * 12/8 along the 80px ones, every dash half a period out of phase.
 *
 * So the dashes are cut into the vector network instead — one open subpath per
 * dash, with the node's `dashPattern` cleared. Same idea as the CSS-border
 * `rounded-dash-border.ts`, one level down: pieces of the stroked path rather
 * than pieces of a filled band.
 */

import type {
  VectorNetwork,
  VectorSegment,
  VectorVertex,
} from "../vector-networks/types";

/** Two coordinates closer than this are the same point. */
const VERTEX_TOLERANCE = 0.001;

/** Samples per curve for the arc-length table. */
const ARC_SAMPLES = 64;

/** Below this a dash is invisible and its geometry is not worth a segment. */
const MIN_DASH_LENGTH = 0.01;

/**
 * Cap on emitted segments — a hairline dash on a long path would flood the
 * network. Past it the caller keeps Figma's own (re-fitted) `dashPattern`.
 */
const MAX_DASH_SEGMENTS = 512;

type Point = { x: number; y: number };

type Cubic = {
  p0: Point;
  c1: Point;
  c2: Point;
  p3: Point;
  isLine: boolean;
  length: number;
  /** Cumulative chord length at each of `ARC_SAMPLES + 1` even steps in t. */
  arcTable: Array<number>;
};

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function pointAt(curve: Cubic, t: number): Point {
  if (curve.isLine) {
    return lerp(curve.p0, curve.p3, t);
  }
  const a = lerp(curve.p0, curve.c1, t);
  const b = lerp(curve.c1, curve.c2, t);
  const c = lerp(curve.c2, curve.p3, t);
  return lerp(lerp(a, b, t), lerp(b, c, t), t);
}

function buildCurve(
  network: VectorNetwork,
  segment: VectorSegment
): Cubic | null {
  const start = network.vertices[segment.start.vertex];
  const end = network.vertices[segment.end.vertex];
  if (!(start && end)) {
    return null;
  }

  const p0 = { x: start.x, y: start.y };
  const p3 = { x: end.x, y: end.y };
  const c1 = { x: p0.x + segment.start.dx, y: p0.y + segment.start.dy };
  const c2 = { x: p3.x + segment.end.dx, y: p3.y + segment.end.dy };
  const isLine =
    Math.abs(segment.start.dx) < VERTEX_TOLERANCE &&
    Math.abs(segment.start.dy) < VERTEX_TOLERANCE &&
    Math.abs(segment.end.dx) < VERTEX_TOLERANCE &&
    Math.abs(segment.end.dy) < VERTEX_TOLERANCE;

  const curve: Cubic = { p0, c1, c2, p3, isLine, length: 0, arcTable: [] };

  if (isLine) {
    curve.length = distance(p0, p3);
    curve.arcTable = [0, curve.length];
    return curve;
  }

  const arcTable = [0];
  let previous = p0;
  let total = 0;
  for (let i = 1; i <= ARC_SAMPLES; i++) {
    const point = pointAt(curve, i / ARC_SAMPLES);
    total += distance(previous, point);
    arcTable.push(total);
    previous = point;
  }
  curve.arcTable = arcTable;
  curve.length = total;
  return curve;
}

/** The curve parameter at a given distance along the curve. */
function parameterAt(curve: Cubic, target: number): number {
  if (curve.length <= 0) {
    return 0;
  }
  const clamped = Math.min(Math.max(target, 0), curve.length);
  if (curve.isLine) {
    return clamped / curve.length;
  }
  const { arcTable } = curve;
  let index = 1;
  while (index < arcTable.length - 1 && (arcTable[index] ?? 0) < clamped) {
    index += 1;
  }
  const before = arcTable[index - 1] ?? 0;
  const after = arcTable[index] ?? before;
  const span = after - before;
  const withinStep = span > 0 ? (clamped - before) / span : 0;
  return (index - 1 + withinStep) / ARC_SAMPLES;
}

/** The piece of `curve` between two parameters, as its own cubic. */
function sliceCurve(curve: Cubic, from: number, to: number): Cubic {
  if (curve.isLine) {
    const p0 = lerp(curve.p0, curve.p3, from);
    const p3 = lerp(curve.p0, curve.p3, to);
    return { ...curve, p0, c1: p0, c2: p3, p3 };
  }

  // de Casteljau twice: drop the head before `from`, then the tail after `to`.
  const dropHead = (c: Cubic, t: number): Cubic => {
    const a = lerp(c.p0, c.c1, t);
    const b = lerp(c.c1, c.c2, t);
    const d = lerp(c.c2, c.p3, t);
    const ab = lerp(a, b, t);
    const bd = lerp(b, d, t);
    return { ...c, p0: lerp(ab, bd, t), c1: bd, c2: d };
  };
  const dropTail = (c: Cubic, t: number): Cubic => {
    const a = lerp(c.p0, c.c1, t);
    const b = lerp(c.c1, c.c2, t);
    const d = lerp(c.c2, c.p3, t);
    const ab = lerp(a, b, t);
    const bd = lerp(b, d, t);
    return { ...c, c1: a, c2: ab, p3: lerp(ab, bd, t) };
  };

  const head = dropTail(curve, to);
  if (to <= 0) {
    return head;
  }
  return dropHead(head, from / to);
}

/**
 * Normalizes an SVG dash array: an odd-length pattern repeats doubled, and a
 * pattern that paints nothing has no dashes to cut.
 */
function normalizeDashPattern(
  pattern: ReadonlyArray<number>
): Array<number> | null {
  const values = pattern.filter(
    (value) => Number.isFinite(value) && value >= 0
  );
  if (values.length === 0) {
    return null;
  }
  const doubled = values.length % 2 === 1 ? [...values, ...values] : values;
  const total = doubled.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return null;
  }
  return doubled;
}

/**
 * The ordered segment indices of each subpath. The regions a path produces
 * already hold them in path order, one loop per subpath; anything that does not
 * account for every segment exactly once is left alone.
 */
function subpathsOf(network: VectorNetwork): Array<Array<number>> | null {
  const subpaths: Array<Array<number>> = [];
  const seen = new Set<number>();
  for (const region of network.regions) {
    for (const loop of region.loops) {
      for (const index of loop.segments) {
        if (seen.has(index) || !network.segments[index]) {
          return null;
        }
        seen.add(index);
      }
      if (loop.segments.length > 0) {
        subpaths.push([...loop.segments]);
      }
    }
  }
  return seen.size === network.segments.length ? subpaths : null;
}

type DashWalker = {
  /** True while the pattern is painting. */
  on: boolean;
  /** Distance left in the current dash or gap. */
  remaining: number;
  index: number;
};

function startWalker(pattern: Array<number>, offset: number): DashWalker {
  const period = pattern.reduce((sum, value) => sum + value, 0);
  // A negative dash offset walks backwards through the repeating pattern.
  let position = offset % period;
  if (position < 0) {
    position += period;
  }
  let index = 0;
  while (position >= (pattern[index] ?? 0)) {
    position -= pattern[index] ?? 0;
    index = (index + 1) % pattern.length;
  }
  return {
    on: index % 2 === 0,
    remaining: (pattern[index] ?? 0) - position,
    index,
  };
}

function advanceWalker(walker: DashWalker, pattern: Array<number>): void {
  // Zero-length entries would spin here, but `normalizeDashPattern` guarantees
  // the period is positive, so at most `pattern.length` steps land on one.
  let index = walker.index;
  let remaining = 0;
  let steps = 0;
  while (remaining <= 0 && steps < pattern.length) {
    index = (index + 1) % pattern.length;
    remaining = pattern[index] ?? 0;
    steps += 1;
  }
  walker.index = index;
  walker.remaining = remaining;
  walker.on = index % 2 === 0;
}

/** Accumulates dash pieces into a fresh vector network. */
function createNetworkBuilder() {
  const vertices: Array<VectorVertex> = [];
  const segments: Array<VectorSegment> = [];

  const vertexFor = (point: Point): number => {
    const existing = vertices.findIndex(
      (vertex) =>
        Math.abs(vertex.x - point.x) < VERTEX_TOLERANCE &&
        Math.abs(vertex.y - point.y) < VERTEX_TOLERANCE
    );
    if (existing !== -1) {
      return existing;
    }
    vertices.push({ styleID: 0, x: point.x, y: point.y });
    return vertices.length - 1;
  };

  return {
    vertices,
    segments,
    add(piece: Cubic): void {
      const startIndex = vertexFor(piece.p0);
      const endIndex = vertexFor(piece.p3);
      if (startIndex === endIndex) {
        return;
      }
      segments.push({
        styleID: 0,
        start: {
          vertex: startIndex,
          dx: piece.isLine ? 0 : piece.c1.x - piece.p0.x,
          dy: piece.isLine ? 0 : piece.c1.y - piece.p0.y,
        },
        end: {
          vertex: endIndex,
          dx: piece.isLine ? 0 : piece.c2.x - piece.p3.x,
          dy: piece.isLine ? 0 : piece.c2.y - piece.p3.y,
        },
      });
    },
  };
}

/**
 * Cuts `network`'s stroke into the dashes `pattern` describes, returning a
 * network of just the painted pieces and no fill regions.
 *
 * Returns `null` when the pattern paints nothing, when the network's subpath
 * order cannot be recovered, or when the result would exceed the segment
 * budget — the caller then falls back to Figma's own `dashPattern`.
 */
export function bakeDashesIntoNetwork(
  network: VectorNetwork,
  pattern: ReadonlyArray<number>,
  dashOffset = 0
): VectorNetwork | null {
  const dashes = normalizeDashPattern(pattern);
  if (!dashes) {
    return null;
  }
  const subpathIndices = subpathsOf(network);
  if (!subpathIndices) {
    return null;
  }

  const subpaths = subpathIndices.map((indices) =>
    indices
      .map((index) => {
        const segment = network.segments[index];
        return segment ? buildCurve(network, segment) : null;
      })
      .filter((curve): curve is Cubic => curve !== null && curve.length > 0)
  );

  // Bail before walking when the pattern is fine enough to blow the budget.
  const period = dashes.reduce((sum, value) => sum + value, 0);
  const totalLength = subpaths.reduce(
    (sum, curves) => sum + curves.reduce((run, curve) => run + curve.length, 0),
    0
  );
  if ((totalLength / period) * (dashes.length / 2) > MAX_DASH_SEGMENTS) {
    return null;
  }

  const builder = createNetworkBuilder();

  for (const curves of subpaths) {
    const walker = startWalker(dashes, dashOffset);

    for (const curve of curves) {
      let travelled = 0;
      while (travelled < curve.length) {
        const step = Math.min(walker.remaining, curve.length - travelled);
        if (walker.on && step > MIN_DASH_LENGTH) {
          const from = parameterAt(curve, travelled);
          const to = parameterAt(curve, travelled + step);
          builder.add(sliceCurve(curve, from, to));
          if (builder.segments.length > MAX_DASH_SEGMENTS) {
            return null;
          }
        }
        travelled += step;
        walker.remaining -= step;
        if (walker.remaining <= 0) {
          advanceWalker(walker, dashes);
        }
      }
    }
  }

  if (builder.segments.length === 0) {
    return null;
  }

  return {
    vertices: builder.vertices,
    segments: builder.segments,
    regions: [],
  };
}
