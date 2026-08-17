/**
 * A `dashed` border on a **rounded** box, cut into explicit dash geometry.
 *
 * On a square box Chrome fits the dashes to each side independently, which
 * `border-decomposition.ts` reproduces by clipping a side's trapezoid. A rounded
 * box has no independent sides: Chrome runs one continuously-phased pattern
 * around the whole rounded-rect path, starting where the top-left corner's arc
 * ends and fitting it so a whole number of dashes closes the loop.
 *
 * Figma's own `dashPattern` cannot follow that. It re-fits whatever pattern it
 * is handed against its own measure of the path, and probing it with known
 * patterns produced dashes 4% long with no stable relation to the request. So
 * the dashes are painted as geometry instead: a band across each straight run,
 * an annular sector across each corner arc.
 */

/** Chrome draws a `dashed` dash at twice the border width. */
const DASH_LENGTH_RATIO = 2;

/** Cap on emitted nodes — a hairline dash on a long path would flood the scene. */
const MAX_DASHES = 96;

const HALF_PI = Math.PI / 2;

/** One painted piece: an SVG path plus its frame-local bounding box. */
export type BorderPathPiece = {
  path: string;
  minX: number;
  minY: number;
  spanX: number;
  spanY: number;
};

type Point = readonly [number, number];

/**
 * A run of the border path, measured along its centerline. `pieceFor` cuts out
 * the band between two distances into it.
 */
type PathRun = {
  length: number;
  pieceFor: (from: number, to: number) => BorderPathPiece | null;
};

function boundsOf(points: ReadonlyArray<Point>): {
  minX: number;
  minY: number;
  spanX: number;
  spanY: number;
} {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    minX,
    minY,
    spanX: Math.max(...xs) - minX,
    spanY: Math.max(...ys) - minY,
  };
}

function rectPiece(
  x0: number,
  y0: number,
  x1: number,
  y1: number
): BorderPathPiece | null {
  const points: Array<Point> = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const bounds = boundsOf(points);
  if (bounds.spanX <= 0 || bounds.spanY <= 0) {
    return null;
  }
  return {
    path: `M${x0} ${y0} L${x1} ${y0} L${x1} ${y1} L${x0} ${y1} Z`,
    ...bounds,
  };
}

/**
 * The slice of a corner's border band between two angles: out along the outer
 * radius, in across the band, back along the inner radius.
 *
 * Every arc here stays inside one quadrant, where both coordinates are monotone
 * in the angle, so the four corner points bound the sector exactly.
 */
function sectorPiece(params: {
  cx: number;
  cy: number;
  outer: number;
  inner: number;
  from: number;
  to: number;
}): BorderPathPiece | null {
  const { cx, cy, outer, inner, from, to } = params;
  const at = (radius: number, angle: number): Point => [
    cx + radius * Math.cos(angle),
    cy + radius * Math.sin(angle),
  ];
  const outerFrom = at(outer, from);
  const outerTo = at(outer, to);
  // Angles increase clockwise on screen (y grows downward), which is SVG's
  // positive sweep; the inner arc runs back the other way.
  const head = `M${outerFrom[0]} ${outerFrom[1]} A${outer} ${outer} 0 0 1 ${outerTo[0]} ${outerTo[1]}`;

  if (inner <= 0) {
    const points = [outerFrom, outerTo, [cx, cy] as Point];
    const bounds = boundsOf(points);
    if (bounds.spanX <= 0 || bounds.spanY <= 0) {
      return null;
    }
    return { path: `${head} L${cx} ${cy} Z`, ...bounds };
  }

  const innerFrom = at(inner, from);
  const innerTo = at(inner, to);
  const bounds = boundsOf([outerFrom, outerTo, innerFrom, innerTo]);
  if (bounds.spanX <= 0 || bounds.spanY <= 0) {
    return null;
  }
  return {
    path: `${head} L${innerTo[0]} ${innerTo[1]} A${inner} ${inner} 0 0 0 ${innerFrom[0]} ${innerFrom[1]} Z`,
    ...bounds,
  };
}

/**
 * The border path as eight runs, clockwise from where the top-left arc ends —
 * the point Chrome starts its dash phase at, measured off its raster.
 */
function borderRuns(params: {
  boxWidth: number;
  boxHeight: number;
  radius: number;
  width: number;
}): Array<PathRun> | null {
  const { boxWidth, boxHeight, radius, width } = params;
  const straightX = boxWidth - 2 * radius;
  const straightY = boxHeight - 2 * radius;
  const centerRadius = radius - width / 2;
  if (straightX < 0 || straightY < 0 || centerRadius <= 0) {
    return null;
  }
  const arcLength = HALF_PI * centerRadius;
  const inner = radius - width;

  const arc = (cx: number, cy: number, startAngle: number): PathRun => ({
    length: arcLength,
    pieceFor: (from, to) =>
      sectorPiece({
        cx,
        cy,
        outer: radius,
        inner,
        from: startAngle + from / centerRadius,
        to: startAngle + to / centerRadius,
      }),
  });

  return [
    {
      length: straightX,
      pieceFor: (from, to) => rectPiece(radius + from, 0, radius + to, width),
    },
    arc(boxWidth - radius, radius, -HALF_PI),
    {
      length: straightY,
      pieceFor: (from, to) =>
        rectPiece(boxWidth - width, radius + from, boxWidth, radius + to),
    },
    arc(boxWidth - radius, boxHeight - radius, 0),
    {
      length: straightX,
      pieceFor: (from, to) =>
        rectPiece(
          boxWidth - radius - to,
          boxHeight - width,
          boxWidth - radius - from,
          boxHeight
        ),
    },
    arc(radius, boxHeight - radius, HALF_PI),
    {
      length: straightY,
      pieceFor: (from, to) =>
        rectPiece(0, boxHeight - radius - to, width, boxHeight - radius - from),
    },
    arc(radius, radius, Math.PI),
  ];
}

/**
 * How many dashes close the loop. Same rule as the per-side fit in
 * `border-decomposition.ts`: the dash length is fixed and the count is the one
 * whose resulting gap comes closest to its nominal `width`.
 */
function fitDashCount(
  perimeter: number,
  dashLength: number,
  width: number
): number | null {
  const gapFor = (count: number) => perimeter / count - dashLength;
  const exact = perimeter / (dashLength + width);
  const dense = Math.ceil(exact);
  const sparse = Math.max(2, dense - 1);
  const count =
    Math.abs(gapFor(dense) - width) <= Math.abs(gapFor(sparse) - width)
      ? dense
      : sparse;
  if (count < 2 || count > MAX_DASHES || gapFor(count) <= 0) {
    return null;
  }
  return count;
}

/** The pieces of one dash, split wherever it crosses from one run to the next. */
function dashPieces(
  runs: ReadonlyArray<PathRun>,
  perimeter: number,
  start: number,
  end: number
): Array<BorderPathPiece> {
  const pieces: Array<BorderPathPiece> = [];
  let runStart = 0;
  for (const run of runs) {
    const runEnd = runStart + run.length;
    // The dash may wrap past the end of the path, so test it in both positions.
    for (const offset of [0, perimeter]) {
      const from = Math.max(start - offset, runStart);
      const to = Math.min(end - offset, runEnd);
      if (to - from > 0) {
        const piece = run.pieceFor(from - runStart, to - runStart);
        if (piece) {
          pieces.push(piece);
        }
      }
    }
    runStart = runEnd;
  }
  return pieces;
}

/**
 * The dash geometry for a uniform `dashed` border on a box with a uniform
 * corner radius, or `null` when the box cannot carry one (no radius to speak
 * of, a radius swallowed by the border width, or more dashes than the node
 * budget allows).
 */
export function roundedDashedBorderPieces(params: {
  boxWidth: number;
  boxHeight: number;
  radius: number;
  width: number;
}): Array<BorderPathPiece> | null {
  const { radius, width } = params;
  if (width <= 0 || radius <= 0) {
    return null;
  }
  const runs = borderRuns(params);
  if (!runs) {
    return null;
  }
  const perimeter = runs.reduce((total, run) => total + run.length, 0);
  const dashLength = width * DASH_LENGTH_RATIO;
  const count = fitDashCount(perimeter, dashLength, width);
  if (!count) {
    return null;
  }

  const period = perimeter / count;
  const pieces: Array<BorderPathPiece> = [];
  for (let i = 0; i < count; i++) {
    const start = i * period;
    pieces.push(...dashPieces(runs, perimeter, start, start + dashLength));
  }
  return pieces.length > 0 ? pieces : null;
}
