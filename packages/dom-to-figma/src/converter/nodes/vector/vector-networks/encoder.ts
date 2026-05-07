import type { VectorNetwork } from "./types";

function writeFloat32(buffer: Array<number>, value: number): void {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value, true);
  for (let i = 0; i < 4; i += 1) {
    buffer.push(view.getUint8(i));
  }
}

function writeUint32(buffer: Array<number>, value: number): void {
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, value, true);
  for (let i = 0; i < 4; i += 1) {
    buffer.push(view.getUint8(i));
  }
}

export function vectorNetworkToBytes(vectorNetwork: VectorNetwork): Uint8Array {
  const { vertices, segments, regions } = vectorNetwork;
  const buffer: Array<number> = [];

  // Write header: counts of vertices, segments, regions
  writeUint32(buffer, vertices.length);
  writeUint32(buffer, segments.length);
  writeUint32(buffer, regions.length);

  // Write vertices
  for (const vertex of vertices) {
    writeUint32(buffer, vertex.styleID);
    writeFloat32(buffer, vertex.x);
    writeFloat32(buffer, vertex.y);
  }

  // Write segments
  for (const segment of segments) {
    writeUint32(buffer, segment.styleID);
    writeUint32(buffer, segment.start.vertex);
    writeFloat32(buffer, segment.start.dx);
    writeFloat32(buffer, segment.start.dy);
    writeUint32(buffer, segment.end.vertex);
    writeFloat32(buffer, segment.end.dx);
    writeFloat32(buffer, segment.end.dy);
  }

  // Write regions
  for (const region of regions) {
    // Combine styleID and winding rule into one uint32.
    // Figma packs bit 0 as 0 for ODD/EVENODD and 1 for NONZERO; bits 1-31 hold
    // the styleID shifted left by 1.
    let styleIDWithWindingRule = region.styleID << 1;
    if (region.windingRule === "NONZERO") {
      styleIDWithWindingRule |= 1;
    }
    writeUint32(buffer, styleIDWithWindingRule);

    // Write number of loops
    writeUint32(buffer, region.loops.length);

    // Write each loop
    for (const loop of region.loops) {
      writeUint32(buffer, loop.segments.length);
      for (const segmentIndex of loop.segments) {
        writeUint32(buffer, segmentIndex);
      }
    }
  }

  return new Uint8Array(buffer);
}
