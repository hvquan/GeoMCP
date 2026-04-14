import type { LineRef } from "../model/types.js";

type PointPair = [string, string];
type PointTriple = [string, string, string];
type PointQuad = [string, string, string, string];

export type DslObject =
  | { type: "point"; name: string }
  | { type: "line"; name: string; through?: string[] }
  | { type: "segment"; name?: string; points: PointPair }
  | { type: "ray"; name?: string; points: PointPair }
  | { type: "circle"; name?: string; center?: string; radius?: number; through?: string }
  | { type: "angle"; name?: string; points: PointTriple }
  | { type: "triangle"; name?: string; points: PointTriple }
  | { type: "polygon"; name?: string; points: string[] }
  | { type: "intersection"; point: string; of: [string, string] }
  | { type: "midpoint"; point: string; of: PointPair }
  | { type: "foot"; point: string; from: string; to: PointPair }
  | { type: "projection"; point: string; from: string; to_line: string }
  | { type: "perpendicular_line"; name?: string; through: string; to: string | PointPair }
  | { type: "parallel_line"; name?: string; through: string; to: string | PointPair }
  | { type: "tangent"; name?: string; circle: string; at: string }
  | { type: "secant"; line: string; circle: string }
  | { type: "distance"; points: PointPair }
  | { type: "length"; segment: PointPair }
  | { type: "angle_value"; points: PointTriple }
  | { type: "area"; polygon: string[] }
  | { type: "isosceles_triangle"; name?: string; points: PointTriple; at?: string }
  | { type: "equilateral_triangle"; name?: string; points: PointTriple }
  | { type: "right_triangle"; name?: string; points: PointTriple; rightAt?: string }
  | { type: "right_isosceles_triangle"; name?: string; points: PointTriple; at?: string }
  | { type: "rectangle"; name?: string; points: PointQuad }
  | { type: "square"; name?: string; points: PointQuad }
  | { type: "rhombus"; name?: string; points: PointQuad }
  | { type: "parallelogram"; name?: string; points: PointQuad }
  | { type: "trapezoid"; name?: string; points: PointQuad }
  | { type: "isosceles_trapezoid"; name?: string; points: PointQuad }
  | { type: "kite"; name?: string; points: PointQuad };

export type DslConstraint =
  | { type: "on_circle"; point: string; circle: string }
  | { type: "collinear"; points: string[] }
  | { type: "diameter"; circle: string; points: [string, string] }
  | { type: "tangent"; line: string; circle: string; at: string }
  | { type: "perpendicular"; line1: string; line2: string }
  | { type: "parallel"; line1: string; line2: string }
  | { type: "equal_length"; segments: [PointPair, PointPair] }
  | { type: "equal_angle"; angles: [PointTriple, PointTriple] }
  | { type: "passes_through"; line: string; point: string }
  | { type: "intersection"; point: string; of: [string, string] }
  | { type: "midpoint"; point: string; segment: string | PointPair }
  | { type: "point_on_line"; point: string; line: string }
  | { type: "on_line"; point: string; line: string | PointPair }
  | { type: "right_angle"; points: PointTriple };

export type DslConstruction =
  | { type: "intersection"; point: string; of: [string, string] }
  | { type: "draw_line"; line: string; through?: string[] }
  | { type: "draw_tangent"; line: string; circle: string; at: string }
  | { type: "draw_perpendicular"; line: string; to: string; through: string }
  | { type: "draw_parallel"; line: string; to: string; through: string }
  | { type: "perpendicular"; line1: string; line2: string };

export type DslTarget =
  | { type: "tangent"; line: string; circle: string; at: string }
  | { type: "equation"; expr: string }
  | { type: "right_angle"; at: string; triangle?: [string, string, string] }
  | { type: "midpoint"; point: string; segment: string | PointPair; where?: string }
  | { type: "parallel"; line1: string | PointPair; line2: string | PointPair }
  | { type: "perpendicular"; line1: string | PointPair; line2: string | PointPair }
  | { type: "statement"; text: string };

export interface GeometryDsl {
  objects: DslObject[];
  constraints: DslConstraint[];
  constructions: DslConstruction[];
  targets: DslTarget[];
}

export { expandDslMacros } from "./desugar.js";

export function asPointId(name: string): string {
  const t = String(name || "").trim().toUpperCase();
  return t.slice(0, 1);
}

export function parseLineRef(name: string): LineRef | null {
  const raw = String(name || "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(raw)) {
    return { a: raw[0], b: raw[1] };
  }
  return null;
}

export function parseSegmentName(name: string): [string, string] | null {
  const raw = String(name || "").trim();
  if (/^[A-Z]{2}$/.test(raw)) {
    return [raw[0], raw[1]];
  }
  return null;
}

export function toSegmentPair(value: string | PointPair): PointPair | null {
  if (Array.isArray(value) && value.length === 2) {
    return [asPointId(value[0]), asPointId(value[1])];
  }
  return parseSegmentName(value);
}

export function toLineRef(value: string | PointPair): LineRef | null {
  if (Array.isArray(value) && value.length === 2) {
    return { a: asPointId(value[0]), b: asPointId(value[1]) };
  }
  return parseLineRef(value);
}


