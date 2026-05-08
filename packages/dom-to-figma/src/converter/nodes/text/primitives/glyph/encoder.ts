/**
 * Glyph Encoding Primitives
 *
 * Converts fontkit `Path.commands` into Figma's binary glyph blob format.
 * Glyphs are normalized against the em-square so all glyphs in a font share
 * the same coordinate system.
 *
 * @module GlyphEncodingPrimitives
 */

import type { Path } from "fontkit";

/**
 * Glyph encoding configuration
 */
export type EncodingOptions = {
  /** Units per EM for normalizing coordinates (defaults to 2048). */
  unitsPerEm?: number;
};

/** Figma command opcodes for the glyph blob format. */
const COMMAND_OPCODES: Record<string, number> = {
  closePath: 0,
  moveTo: 1,
  lineTo: 2,
  quadraticCurveTo: 3,
  bezierCurveTo: 4,
};

/**
 * Encode a fontkit path command stream as Figma glyph bytes.
 *
 * Coordinates are emitted in normalized em-square units (`value / unitsPerEm`).
 * fontkit produces font-natural Y (positive = up); Figma stores it the same
 * way, so no flip is applied here.
 */
export function pathCommandsToGlyphBytes(
  commands: Path["commands"],
  options: EncodingOptions = {}
): Array<number> {
  if (commands.length === 0) {
    return [0]; // empty path → close command only
  }

  const { unitsPerEm = 2048 } = options;
  const bytes: Array<number> = [];

  const writeFloat = (value: number): void => {
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setFloat32(0, value, true);
    const u = new Uint8Array(buffer);
    bytes.push(u[0] ?? 0, u[1] ?? 0, u[2] ?? 0, u[3] ?? 0);
  };

  for (const { command, args } of commands) {
    const opcode = COMMAND_OPCODES[command];
    if (opcode === undefined) {
      throw new Error(`Unknown path command: ${command}`);
    }
    bytes.push(opcode);
    for (let i = 0; i < args.length; i += 2) {
      writeFloat((args[i] ?? 0) / unitsPerEm);
      writeFloat((args[i + 1] ?? 0) / unitsPerEm);
    }
  }

  return bytes;
}
