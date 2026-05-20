/**
 * Font Primitives Module
 *
 * Exports all font-related primitive operations for text processing.
 * These primitives handle font loading, metrics extraction, and property parsing
 * without dependencies on higher-level components.
 *
 * @module FontPrimitives
 */

export type { LoadedFont } from "./loader";
export { extractFontMetrics, type FontMetrics } from "./metrics";
