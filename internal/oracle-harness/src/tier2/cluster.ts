export type Cluster = { x: number; y: number; width: number; height: number };

const GRID = 8;
const MIN_AREA_PX = 16;

/**
 * Group differing pixels into connected clusters. Pixels are bucketed into an
 * 8px grid, 8-connected components are found over the occupied cells, and each
 * component's pixel bounding box is returned. Clusters below the AA noise floor
 * (16px²) are dropped.
 */
export function clusterMask(
  mask: Uint8Array,
  width: number,
  height: number
): Array<Cluster> {
  const cols = Math.ceil(width / GRID);
  const rows = Math.ceil(height / GRID);
  const cell = new Uint8Array(cols * rows);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) {
        cell[Math.floor(y / GRID) * cols + Math.floor(x / GRID)] = 1;
      }
    }
  }

  const seen = new Uint8Array(cols * rows);
  const clusters: Array<Cluster> = [];
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const start = cy * cols + cx;
      if (!cell[start] || seen[start]) {
        continue;
      }
      const bbox = floodFill(cell, seen, cols, rows, cx, cy);
      const bx = bbox.minX * GRID;
      const by = bbox.minY * GRID;
      const bw = Math.min((bbox.maxX - bbox.minX + 1) * GRID, width - bx);
      const bh = Math.min((bbox.maxY - bbox.minY + 1) * GRID, height - by);
      if (bw * bh >= MIN_AREA_PX) {
        clusters.push({ x: bx, y: by, width: bw, height: bh });
      }
    }
  }
  return clusters;
}

type CellBBox = { minX: number; minY: number; maxX: number; maxY: number };

function floodFill(
  cell: Uint8Array,
  seen: Uint8Array,
  cols: number,
  rows: number,
  startX: number,
  startY: number
): CellBBox {
  const stack: Array<[number, number]> = [[startX, startY]];
  seen[startY * cols + startX] = 1;
  const bbox: CellBBox = {
    minX: startX,
    minY: startY,
    maxX: startX,
    maxY: startY,
  };
  while (stack.length > 0) {
    const point = stack.pop();
    if (!point) {
      break;
    }
    const [x, y] = point;
    bbox.minX = Math.min(bbox.minX, x);
    bbox.minY = Math.min(bbox.minY, y);
    bbox.maxX = Math.max(bbox.maxX, x);
    bbox.maxY = Math.max(bbox.maxY, y);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
          continue;
        }
        const ni = ny * cols + nx;
        if (cell[ni] && !seen[ni]) {
          seen[ni] = 1;
          stack.push([nx, ny]);
        }
      }
    }
  }
  return bbox;
}
