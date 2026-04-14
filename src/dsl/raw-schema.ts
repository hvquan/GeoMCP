/**
 * dsl/raw-schema.ts — Raw DSL schema for GeoMCP model output
 *
 * This matches the exact structure emitted by the LLM (geomcp-qwen and
 * compatible models). It is intentionally loose — the model may emit
 * ambiguous or slightly-wrong values, which `normalize.ts` fixes up
 * before `adapter.ts` converts to Canonical IR.
 */

export interface RawDSL {
  objects:       RawObject[];
  constraints:   RawConstraint[];
  constructions: RawConstraint[];
  targets:       unknown[];
}

// ── Objects ───────────────────────────────────────────────────────────────────

export type RawObject =
  | { type: "point";    name: string }
  | { type: "segment";  points: [string, string] }
  | { type: "triangle"; points: [string, string, string] }
  /** circle: center is a point name; radius may be a point name ("OA") or omitted */
  | { type: "circle";   center: string; radius?: string }
  | { type: "line";     name: string }
  | { type: "ray";      name: string }
  | { type: "arc";      name?: string; circle?: string; start_point?: string; end_point?: string; start?: string; end?: string }
  | { type: string;     [k: string]: unknown };

// ── Constraints / Constructions ───────────────────────────────────────────────
// Both `constraints` and `constructions` arrays use the same element types.

export type RawConstraint =
  /**
   * midpoint: point P is midpoint of [A, B].
   * NOTE: the model sometimes emits "of": ["A","BC"] where "BC" is a side name.
   * normalize.ts splits these into ["B","C"].
   */
  | { type: "midpoint";      point: string; of: [string, string] }
  /** Two lines are perpendicular. */
  | { type: "perpendicular"; line1: string; line2: string }
  /** Two lines are parallel. */
  | { type: "parallel";      line1: string; line2: string; through?: string }
  /**
   * Intersection point of two (or more) lines.
   * The model sometimes emits 3 items in `of` for a common point.
   */
  | { type: "intersection";  point: string; of: string[] }
  /** C and D are endpoints of a diameter of circle O. */
  | { type: "diameter";      circle: string; points: [string, string] }
  /** Point lies on circle. */
  | { type: "on_circle";     point: string; circle: string }
  /** Point lies on line. */
  | { type: "on_line";       point: string; line: string }
  /** Tangent line to circle at given point. */
  | { type: "tangent";       at: string; line: string; circle: string }
  /**
   * Two or more angles are equal.
   * Often used to encode an angle bisector:
   *   equal_angle [["A","B","K"],["K","B","C"]] → bisector from B, foot K.
   * NOTE: the model sometimes swaps vertex/arms. normalize.ts detects and repairs.
   */
  | { type: "equal_angle";   angles: [string, string, string][] }
  | { type: "equal_length";  segments: [string, string][] }
  /** Inline segment declaration inside constraints array. */
  | { type: "segment";       points: [string, string] }
  | { type: "arc";           start: string; end: string }
  | { type: string;          [k: string]: unknown };

// ── Type guard ────────────────────────────────────────────────────────────────

export function isRawDSL(v: unknown): v is RawDSL {
  return (
    typeof v === "object" && v !== null &&
    Array.isArray((v as Record<string, unknown>).objects) &&
    Array.isArray((v as Record<string, unknown>).constraints)
  );
}
