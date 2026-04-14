/**
 * pipeline/run-from-geomcp-dsl.ts — Bridge: GeoMCP raw DSL → GeoRender SVG
 *
 * Accepts the raw JSON emitted by the LLM (GeoMCP snapshot format:
 * objects/constraints/constructions/targets), runs it through the full
 * GeoRender pipeline, and returns an SVG string.
 *
 * Flow:
 *   raw LLM JSON (GeoMCP format)
 *     ↓ normalizeRawDsl()
 *   RawDSL
 *     ↓ adaptDsl()
 *   CanonicalGeometryIR + freePoints
 *     ↓ runFromCanonical()
 *   { scene, svg }
 */
import { normalizeRawDsl }          from "../dsl/normalize.js";
import type { RawDSL }              from "../dsl/raw-schema.js";
import { adaptDsl }                 from "../dsl/adapter.js";
import type { CanonicalGeometryIR } from "../canonical/schema.js";
import { runFromCanonical }         from "./run-from-canonical.js";

export interface GeomcpDslResult {
  svg:        string;
  scene:      unknown;
  warnings:   string[];
  errors:     string[];
  /** Intermediate after normalizeRawDsl() — GeoRender RawDSL format */
  rawDsl:     RawDSL;
  /** Intermediate after adaptDsl() — GeoRender Canonical IR */
  canonical:  CanonicalGeometryIR;
  /** Free-point seed positions returned by adaptDsl() */
  freePoints: Record<string, { x: number; y: number }>;
}

/**
 * Run the full GeoRender pipeline from a raw GeoMCP DSL object.
 * Never throws — compiler/solver errors are returned in the `errors` array
 * so that `rawDsl` and `canonical` intermediates are always available.
 * @param rawInput  Raw LLM JSON (objects/constraints/constructions/targets)
 */
export function runFromGeomcpDsl(rawInput: unknown): GeomcpDslResult {
  const { dsl: rawDsl, warnings: normalizeWarnings } = normalizeRawDsl(rawInput);
  const { canonical, freePoints, warnings: adapterWarnings } = adaptDsl(rawDsl);
  const warnings = [
    ...normalizeWarnings.map(w => `[normalize:${w.code}] ${w.message}`),
    ...adapterWarnings,
  ];
  try {
    const { scene, svg, errors } = runFromCanonical(canonical, freePoints);
    return { svg, scene, warnings, errors: errors.map(e => e.message), rawDsl, canonical, freePoints };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { svg: "", scene: null, warnings, errors: [message], rawDsl, canonical, freePoints };
  }
}
