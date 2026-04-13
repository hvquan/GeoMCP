/**
 * Constraint Solver — Layer 12 (Geometry Solver)
 *
 * Computes concrete (x, y) coordinates for every point in the model by applying
 * geometric constraints in dependency order.  This layer is **purely geometric**:
 * it never chooses aesthetics, viewport scale, or label placement.
 *
 * Entry point: solveConstraints(model, points, circles, diagnostics)
 * The caller is responsible for seeding the anchor point(s) (root placement) before
 * invoking this function.
 */

import { Circle, GeometryModel, Point, Segment } from "../model/types.js";
import { displayLabel } from "../model/normalize.js";

// ─── Math helpers (exported so layout.ts + scene-builder.ts can reuse them) ──

export function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function setPoint(map: Map<string, Point>, id: string, x: number, y: number): void {
  map.set(id, { id, x, y });
}

export function getPoint(map: Map<string, Point>, id: string): Point | undefined {
  return map.get(id);
}

export function projectPointToLine(p: Point, a: Point, b: Point): Point {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy || 1;
  const t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  return { id: "", x: a.x + t * vx, y: a.y + t * vy };
}

export function lineIntersection(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point
): Point | undefined {
  const den = (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x);
  if (Math.abs(den) < 1e-9) return undefined;
  const px =
    ((a1.x * a2.y - a1.y * a2.x) * (b1.x - b2.x) - (a1.x - a2.x) * (b1.x * b2.y - b1.y * b2.x)) / den;
  const py =
    ((a1.x * a2.y - a1.y * a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x * b2.y - b1.y * b2.x)) / den;
  return { id: "", x: px, y: py };
}

export function resolveCircleCenterId(
  circleId: string | undefined,
  centerHint: string | undefined,
  circles: Circle[],
  fallbackCenterId: string
): string {
  if (circleId) {
    const byId = circles.find((c) => c.id === circleId)?.center;
    if (byId) return byId;
  }
  if (centerHint) return centerHint;
  return fallbackCenterId;
}

/**
 * Derive the stable center-point id for a v2 diameterConstraint circle.
 * Both `applyDerivedCircles` and `buildSceneGraph` must use this same formula
 * so the circle is found consistently by `applyPointsOnCircles`.
 * Example: "cir:O" → "point:O",  "cir:K" → "point:K"
 */
export function diameterConstraintCenterId(circleId: string): string {
  return `point:${circleId.replace(/^cir:/, "")}`;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function angleOf(a: Point, b: Point, c: Point): number {
  const ux = a.x - b.x, uy = a.y - b.y;
  const vx = c.x - b.x, vy = c.y - b.y;
  const dot = ux * vx + uy * vy;
  const lu = Math.sqrt(ux * ux + uy * uy) || 1;
  const lv = Math.sqrt(vx * vx + vy * vy) || 1;
  return Math.acos(Math.max(-1, Math.min(1, dot / (lu * lv))));
}

function lengthOf(segments: Segment[], a: string, b: string): number | undefined {
  for (const s of segments) {
    if ((s.a === a && s.b === b) || (s.a === b && s.b === a)) return s.length;
  }
  return undefined;
}

function isPointConstrainedOnLine(
  model: GeometryModel,
  point: string,
  line: { a: string; b: string }
): boolean {
  return model.pointsOnSegments.some(
    (rel) =>
      rel.point === point &&
      ((rel.a === line.a && rel.b === line.b) || (rel.a === line.b && rel.b === line.a))
  );
}

/**
 * Build a map from line-id → {a, b} point-id pair.
 *
 * Sources, in priority order:
 *   1. `model.lines` explicit line objects (e.g. declared via the DSL `line()` API)
 *   2. `model.segments` indexed by their two-letter compact label (e.g. "AD")
 *
 * Used by both `applyLineIntersections` and `applyPerpendicularLines` so both
 * functions resolve line IDs identically.
 */
function buildLineRefById(model: GeometryModel): Map<string, { a: string; b: string }> {
  const lineRefById = new Map<string, { a: string; b: string }>();
  for (const l of model.lines) {
    const a = l.a ?? l.point1Id;
    const b = l.b ?? l.point2Id;
    if (l.id && a && b) lineRefById.set(l.id, { a, b });
  }
  for (const s of model.segments) {
    const aLabel = displayLabel(s.a).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
    const bLabel = displayLabel(s.b).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
    if (aLabel && bLabel) {
      const key = `${aLabel}${bLabel}`;
      if (!lineRefById.has(key)) lineRefById.set(key, { a: s.a, b: s.b });
      const rev = `${bLabel}${aLabel}`;
      if (!lineRefById.has(rev)) lineRefById.set(rev, { a: s.b, b: s.a });
    }
  }
  // Parse any "line:XY" keys from lineIntersections that weren't covered by
  // explicit lines or segments (e.g. median "line:AD" where A is a vertex and
  // D is a midpoint — "AD" is not a declared segment, but both points exist).
  for (const li of model.lineIntersections) {
    for (const lineKey of [li.line1, li.line2]) {
      if (lineRefById.has(lineKey)) continue;
      const name = lineKey.startsWith("line:") ? lineKey.slice(5) : lineKey;
      if (/^[A-Z]{2}$/.test(name)) {
        const entry = { a: `point:${name[0]}`, b: `point:${name[1]}` };
        lineRefById.set(lineKey, entry);
        if (!lineRefById.has(name)) lineRefById.set(name, entry);
      }
    }
  }
  return lineRefById;
}

function ensureLinePoint(line: { a: string; b: string }, points: Map<string, Point>): void {
  if (points.has(line.a) && points.has(line.b)) return;
  const anchor = getPoint(points, line.a) ?? getPoint(points, line.b);
  const missing = points.has(line.a) ? line.b : line.a;
  if (!anchor) return;
  setPoint(points, missing, anchor.x + 2, anchor.y + 1);
}

function deriveIncircle(tri: [string, string, string], points: Map<string, Point>): Circle | undefined {
  const a = getPoint(points, tri[0]);
  const b = getPoint(points, tri[1]);
  const c = getPoint(points, tri[2]);
  if (!a || !b || !c) return undefined;
  const sideA = dist(b, c), sideB = dist(a, c), sideC = dist(a, b);
  const p = sideA + sideB + sideC || 1;
  const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  return { center: "I", radius: Math.max(area2 / (2 * (p / 2) || 1), 0.2) };
}

function deriveCircumcircle(tri: [string, string, string], points: Map<string, Point>): Circle | undefined {
  const a = getPoint(points, tri[0]);
  const b = getPoint(points, tri[1]);
  const c = getPoint(points, tri[2]);
  if (!a || !b || !c) return undefined;
  const midAB = { id: "", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const midAC = { id: "", x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
  const nAB = { id: "", x: midAB.x - (b.y - a.y), y: midAB.y + (b.x - a.x) };
  const nAC = { id: "", x: midAC.x - (c.y - a.y), y: midAC.y + (c.x - a.x) };
  const o = lineIntersection(midAB, nAB, midAC, nAC);
  if (!o) return undefined;
  return { center: "O", radius: Math.max(dist(o, a), 0.2) };
}

// ─── Constraint appliers ──────────────────────────────────────────────────────

function applyMidpoints(model: GeometryModel, points: Map<string, Point>, diagnostics: string[]): void {
  for (const mp of model.midpoints) {
    const a = getPoint(points, mp.a);
    const b = getPoint(points, mp.b);
    if (!a || !b) {
      diagnostics.push(`Chua du diem de dat trung diem ${mp.point} cua ${mp.a}${mp.b}.`);
      continue;
    }
    setPoint(points, mp.point, (a.x + b.x) / 2, (a.y + b.y) / 2);
  }
}

/**
 * Place centroid points explicitly.
 *
 * Each `CentroidConstraint { point, a, b, c }` asserts that `point` is the
 * centroid of triangle ABC.  We compute `G = ((Ax+Bx+Cx)/3, (Ay+By+Cy)/3)`
 * directly rather than relying on the median-line intersection falling out of
 * `applyLineIntersections`.
 *
 * This makes the constraint self-sufficient: even when no median `Line` objects
 * are declared, `G` is correctly positioned as long as the three vertices are
 * known.  When the iterative solver runs the position converges identically to
 * the analytical formula.
 */
function applyCentroids(model: GeometryModel, points: Map<string, Point>, diagnostics: string[]): void {
  if (!model.centroids?.length) return;
  for (const c of model.centroids) {
    const a = getPoint(points, c.a);
    const b = getPoint(points, c.b);
    const g = getPoint(points, c.c);
    if (!a || !b || !g) {
      diagnostics.push(`Chua du diem de tinh trong tam ${c.point} cua tam giac ${c.a}${c.b}${c.c}.`);
      continue;
    }
    setPoint(points, c.point, (a.x + b.x + g.x) / 3, (a.y + b.y + g.y) / 3);
  }
}

/**
 * Enforce equal-length constraints.
 *
 * Each `EqualLengthConstraint { segment1, segment2 }` asserts that the two
 * segments have the same length.  We average the two current lengths and scale
 * each segment symmetrically around its own midpoint so that neither segment
 * is "the reference" — the result is stable under multiple solver passes.
 *
 * This mirrors the logic in `refineLayoutWithSolver` (solver.ts) so that the
 * constraint is effective on the initial one-pass `solveConstraints` call.
 */
function applyEqualLengths(model: GeometryModel, points: Map<string, Point>): void {
  if (!model.equalLengths.length) return;
  for (const rel of model.equalLengths) {
    const a = getPoint(points, rel.segment1.a), b = getPoint(points, rel.segment1.b);
    const c = getPoint(points, rel.segment2.a), d = getPoint(points, rel.segment2.b);
    if (!a || !b || !c || !d) continue;
    const len1 = dist(a, b) || 1;
    const len2 = dist(c, d) || 1;
    const target = (len1 + len2) / 2;
    const v1x = b.x - a.x, v1y = b.y - a.y;
    const n1 = Math.sqrt(v1x * v1x + v1y * v1y) || 1;
    const mid1x = (a.x + b.x) / 2, mid1y = (a.y + b.y) / 2;
    setPoint(points, rel.segment1.a, mid1x - (v1x / n1) * target / 2, mid1y - (v1y / n1) * target / 2);
    setPoint(points, rel.segment1.b, mid1x + (v1x / n1) * target / 2, mid1y + (v1y / n1) * target / 2);
    const v2x = d.x - c.x, v2y = d.y - c.y;
    const n2 = Math.sqrt(v2x * v2x + v2y * v2y) || 1;
    const mid2x = (c.x + d.x) / 2, mid2y = (c.y + d.y) / 2;
    setPoint(points, rel.segment2.a, mid2x - (v2x / n2) * target / 2, mid2y - (v2y / n2) * target / 2);
    setPoint(points, rel.segment2.b, mid2x + (v2x / n2) * target / 2, mid2y + (v2y / n2) * target / 2);
  }
}

/**
 * Enforce equal-angle constraints.
 *
 * Each `EqualAngleConstraint { angle1, angle2 }` asserts that the two angles
 * (each given as [vertex-ray-a, vertex, vertex-ray-b]) are equal.  We average
 * the two current angles and rotate the far ray-endpoint of each angle to
 * match the target, keeping the vertex and the first ray fixed.
 */
function applyEqualAngles(model: GeometryModel, points: Map<string, Point>): void {
  if (!model.equalAngles.length) return;
  for (const rel of model.equalAngles) {
    const a1 = getPoint(points, rel.angle1[0]), b1 = getPoint(points, rel.angle1[1]), c1 = getPoint(points, rel.angle1[2]);
    const a2 = getPoint(points, rel.angle2[0]), b2 = getPoint(points, rel.angle2[1]), c2 = getPoint(points, rel.angle2[2]);
    if (!a1 || !b1 || !c1 || !a2 || !b2 || !c2) continue;
    const angle1 = angleOf(a1, b1, c1);
    const angle2 = angleOf(a2, b2, c2);
    const target = (angle1 + angle2) / 2;
    const len1 = dist(b1, c1) || 1;
    const base1 = Math.atan2(a1.y - b1.y, a1.x - b1.x);
    setPoint(points, rel.angle1[2], b1.x + Math.cos(base1 + target) * len1, b1.y + Math.sin(base1 + target) * len1);
    const len2 = dist(b2, c2) || 1;
    const base2 = Math.atan2(a2.y - b2.y, a2.x - b2.x);
    setPoint(points, rel.angle2[2], b2.x + Math.cos(base2 + target) * len2, b2.y + Math.sin(base2 + target) * len2);
  }
}

function applyPointOnSegment(model: GeometryModel, points: Map<string, Point>, diagnostics: string[]): void {
  for (const rel of model.pointsOnSegments) {
    const a = getPoint(points, rel.a);
    const b = getPoint(points, rel.b);
    if (!a || !b) {
      diagnostics.push(`Chua du diem de dat diem ${rel.point} thuoc doan ${rel.a}${rel.b}.`);
      continue;
    }
    const existing = getPoint(points, rel.point);
    if (existing) {
      const pr = projectPointToLine(existing, a, b);
      setPoint(points, rel.point, pr.x, pr.y);
      continue;
    }
    const t = 0.35;
    setPoint(points, rel.point, a.x + t * (b.x - a.x), a.y + t * (b.y - a.y));
  }
}

function applyAltitudes(model: GeometryModel, points: Map<string, Point>, diagnostics: string[]): void {
  for (const alt of model.altitudes) {
    const from = getPoint(points, alt.from);
    const a = getPoint(points, alt.baseA);
    const b = getPoint(points, alt.baseB);
    if (!from || !a || !b) {
      diagnostics.push(`Chua du diem de dung duong cao tu ${alt.from} xuong ${alt.baseA}${alt.baseB}.`);
      continue;
    }
    const foot = projectPointToLine(from, a, b);
    setPoint(points, alt.foot, foot.x, foot.y);
  }
}

function applyMedians(model: GeometryModel, points: Map<string, Point>, diagnostics: string[]): void {
  for (const md of model.medians) {
    const a = getPoint(points, md.baseA);
    const b = getPoint(points, md.baseB);
    if (!a || !b) {
      diagnostics.push(`Chua du diem de dung trung tuyen ${md.from}${md.foot}.`);
      continue;
    }
    setPoint(points, md.foot, (a.x + b.x) / 2, (a.y + b.y) / 2);
  }
}

function applyAngleBisectors(model: GeometryModel, points: Map<string, Point>, diagnostics: string[]): void {
  for (const bis of model.angleBisectors) {
    const v = getPoint(points, bis.from);
    const a = getPoint(points, bis.sideA);
    const b = getPoint(points, bis.sideB);
    if (!v || !a || !b) {
      diagnostics.push(`Chua du diem de dung phan giac tu ${bis.from} den ${bis.foot}.`);
      continue;
    }
    const vaLen = dist(v, a) || 1;
    const vbLen = dist(v, b) || 1;
    // Bisector direction: normalize(unit_VA + unit_VB)
    const dx = (a.x - v.x) / vaLen + (b.x - v.x) / vbLen;
    const dy = (a.y - v.y) / vaLen + (b.y - v.y) / vbLen;
    // Intersect ray (v + t*dir) with line (a, b):
    //   den = dx*(b.y - a.y) - dy*(b.x - a.x)
    //   t   = [(a.x - v.x)*(b.y - a.y) - (a.y - v.y)*(b.x - a.x)] / den
    const den = dx * (b.y - a.y) - dy * (b.x - a.x);
    if (Math.abs(den) > 1e-9) {
      const t = ((a.x - v.x) * (b.y - a.y) - (a.y - v.y) * (b.x - a.x)) / den;
      setPoint(points, bis.foot, v.x + dx * t, v.y + dy * t);
    } else {
      // Degenerate (parallel / collinear): fall back to projection at distance 2.5
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      setPoint(points, bis.foot, v.x + (dx / len) * 2.5, v.y + (dy / len) * 2.5);
    }
  }
}

function applyLineIntersections(model: GeometryModel, points: Map<string, Point>, diagnostics: string[]): void {
  const lineRefById = buildLineRefById(model);

  // Group by intersection point: collect all fully-resolvable lines for each point.
  // This lets us handle cases where some lines reference undefined endpoints (e.g. E
  // not yet in the model) but other lines for the same point ARE resolvable.
  // e.g. G = AD∩BE (E undefined) + G = BF∩CE (E undefined) → collect AD and BF → G = AD∩BF.
  const validLinesFor = new Map<string, { a: Point; b: Point }[]>();
  for (const li of model.lineIntersections) {
    const l1 = lineRefById.get(li.line1);
    const l2 = lineRefById.get(li.line2);
    const group = validLinesFor.get(li.point) ?? [];
    for (const l of [l1, l2]) {
      if (!l) continue;
      const pa = getPoint(points, l.a), pb = getPoint(points, l.b);
      if (!pa || !pb) continue;
      if (!group.some(g => g.a === pa && g.b === pb)) group.push({ a: pa, b: pb });
    }
    validLinesFor.set(li.point, group);
  }

  for (const [pointId, lines] of validLinesFor) {
    if (lines.length < 2) {
      diagnostics.push(`Chua du duong de tinh giao diem ${pointId}.`);
      continue;
    }
    const { a: a1, b: a2 } = lines[0];
    const { a: b1, b: b2 } = lines[1];
    const den = (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x);
    if (Math.abs(den) < 1e-9) continue;
    const px = ((a1.x * a2.y - a1.y * a2.x) * (b1.x - b2.x) - (a1.x - a2.x) * (b1.x * b2.y - b1.y * b2.x)) / den;
    const py = ((a1.x * a2.y - a1.y * a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x * b2.y - b1.y * b2.x)) / den;
    setPoint(points, pointId, px, py);
  }
}

/**
 * Enforce line-ID perpendicularity constraints (`model.perpendicularLines`).
 *
 * Each entry `{ line1, line2 }` asserts that the two named lines are
 * perpendicular.  We resolve each line to a { a, b } point-id pair via
 * `buildLineRefById` and, when `line2` has a movable endpoint (not a
 * diameter endpoint), rotate its second point to be perpendicular to `line1`.
 *
 * This mirrors the inline logic in `applyParallelPerpendicular` for
 * `model.perpendiculars`, but operates on line IDs instead of direct
 * point-ref pairs — making it independently enforceable in the v2 canonical
 * pipeline where `model.perpendiculars` is empty.
 */
function applyPerpendicularLines(
  model: GeometryModel,
  points: Map<string, Point>
): void {
  if (!model.perpendicularLines.length) return;
  const lineRefById = buildLineRefById(model);
  const diameterPoints = new Set<string>();
  for (const dc of model.circlesByDiameter) {
    diameterPoints.add(dc.a);
    diameterPoints.add(dc.b);
  }
  for (const rel of model.perpendicularLines) {
    const ref1 = lineRefById.get(rel.line1);
    const ref2 = lineRefById.get(rel.line2);
    if (!ref1 || !ref2) continue;
    ensureLinePoint(ref1, points);
    ensureLinePoint(ref2, points);
    const a = getPoint(points, ref1.a), b = getPoint(points, ref1.b);
    const c = getPoint(points, ref2.a), d = getPoint(points, ref2.b);
    if (!a || !b || !c || !d) continue;
    if (diameterPoints.has(ref2.a) || diameterPoints.has(ref2.b)) continue;
    if (diameterPoints.has(ref1.a) || diameterPoints.has(ref1.b)) continue;
    const vx = b.x - a.x, vy = b.y - a.y;
    const pvx = -vy, pvy = vx;
    const plen = Math.sqrt(pvx * pvx + pvy * pvy) || 1;
    const target = dist(c, d) || 2;
    setPoint(points, ref2.b, c.x + (pvx / plen) * target, c.y + (pvy / plen) * target);
  }
}

function applyParallelPerpendicular(
  model: GeometryModel,
  points: Map<string, Point>,
  diagnostics: string[]
): void {
  const diameterPoints = new Set<string>();
  for (const dc of model.circlesByDiameter) {
    diameterPoints.add(dc.a);
    diameterPoints.add(dc.b);
  }

  for (const rel of model.parallels) {
    if (diameterPoints.has(rel.line1.a) || diameterPoints.has(rel.line1.b) ||
        diameterPoints.has(rel.line2.a) || diameterPoints.has(rel.line2.b)) {
      continue;
    }
    ensureLinePoint(rel.line1, points);
    ensureLinePoint(rel.line2, points);
    const a = getPoint(points, rel.line1.a), b = getPoint(points, rel.line1.b);
    const c = getPoint(points, rel.line2.a), d = getPoint(points, rel.line2.b);
    if (!a || !b || !c || !d) continue;
    const vx = b.x - a.x, vy = b.y - a.y;
    const len = Math.sqrt(vx * vx + vy * vy) || 1;
    const target = dist(c, d) || len;
    setPoint(points, rel.line2.b, c.x + (vx / len) * target, c.y + (vy / len) * target);
  }

  for (const rel of model.perpendiculars) {
    ensureLinePoint(rel.line1, points);
    ensureLinePoint(rel.line2, points);
    const a = getPoint(points, rel.line1.a), b = getPoint(points, rel.line1.b);
    const c = getPoint(points, rel.line2.a), d = getPoint(points, rel.line2.b);
    if (!a || !b || !c || !d) continue;
    const line2Protected = diameterPoints.has(rel.line2.a) || diameterPoints.has(rel.line2.b);
    if (line2Protected) {
      if (isPointConstrainedOnLine(model, rel.line1.a, rel.line2)) {
        const foot = projectPointToLine(b, c, d);
        setPoint(points, rel.line1.a, foot.x, foot.y);
      } else if (isPointConstrainedOnLine(model, rel.line1.b, rel.line2)) {
        const foot = projectPointToLine(a, c, d);
        setPoint(points, rel.line1.b, foot.x, foot.y);
      }
      continue;
    }
    if (diameterPoints.has(rel.line1.a) || diameterPoints.has(rel.line1.b)) continue;
    const vx = b.x - a.x, vy = b.y - a.y;
    const pvx = -vy, pvy = vx;
    const plen = Math.sqrt(pvx * pvx + pvy * pvy) || 1;
    const target = dist(c, d) || 2;
    setPoint(points, rel.line2.b, c.x + (pvx / plen) * target, c.y + (pvy / plen) * target);
  }
}

function applyNamedTangents(
  model: GeometryModel,
  points: Map<string, Point>,
  circles: Circle[],
  diagnostics: string[]
): void {
  const tangentIntersectionPoints = new Set(model.tangentIntersections.map((t) => t.intersection));

  for (const nt of model.namedTangents) {
    if (tangentIntersectionPoints.has(nt.linePoint)) continue;
    const at = getPoint(points, nt.at);
    const centerId = resolveCircleCenterId(
      nt.circleId, nt.center, circles,
      model.circlesByDiameter[0]?.centerId ?? "point:O"
    );
    const center = getPoint(points, centerId);
    if (!at || !center) {
      diagnostics.push(`Chua du diem de dung tiep tuyen dat ten qua ${nt.at}.`);
      continue;
    }
    const vx = at.x - center.x, vy = at.y - center.y;
    let pvx = vy, pvy = -vx;
    const plen = Math.sqrt(pvx * pvx + pvy * pvy) || 1;
    const relatedIntersection = model.perpendicularThroughPointIntersections.find((rel) => {
      const sameForward = rel.withLine.a === nt.at && rel.withLine.b === nt.linePoint;
      const sameReverse = rel.withLine.a === nt.linePoint && rel.withLine.b === nt.at;
      return sameForward || sameReverse;
    });
    if (relatedIntersection) {
      const through = getPoint(points, relatedIntersection.through);
      const toA = getPoint(points, relatedIntersection.toLine.a);
      const toB = getPoint(points, relatedIntersection.toLine.b);
      if (through && toA && toB) {
        const tvx = toB.x - toA.x, tvy = toB.y - toA.y;
        const perpPoint = { id: "", x: through.x - tvy, y: through.y + tvx };
        const tangentProbe = { id: "", x: at.x + pvx, y: at.y + pvy };
        const hit = lineIntersection(at, tangentProbe, through, perpPoint);
        if (hit) {
          const dot = (hit.x - at.x) * pvx + (hit.y - at.y) * pvy;
          if (dot < 0) { pvx = -pvx; pvy = -pvy; }
        }
      }
    }
    const len = Math.max(60, Math.sqrt((at.x - center.x) ** 2 + (at.y - center.y) ** 2) * 0.75);
    setPoint(points, nt.linePoint, at.x + (pvx / plen) * len, at.y + (pvy / plen) * len);
  }
}

function applyPerpendicularThroughPointIntersections(
  model: GeometryModel,
  points: Map<string, Point>,
  diagnostics: string[]
): void {
  for (const c of model.perpendicularThroughPointIntersections) {
    ensureLinePoint(c.toLine, points);
    ensureLinePoint(c.withLine, points);
    const through = getPoint(points, c.through);
    const toA = getPoint(points, c.toLine.a), toB = getPoint(points, c.toLine.b);
    const withA = getPoint(points, c.withLine.a), withB = getPoint(points, c.withLine.b);
    if (!through || !toA || !toB || !withA || !withB) {
      diagnostics.push(`Khong du du lieu de dung giao diem ${c.intersection}.`);
      continue;
    }
    const vx = toB.x - toA.x, vy = toB.y - toA.y;
    const perpPoint = { id: "", x: through.x - vy, y: through.y + vx };
    const inter = lineIntersection(through, perpPoint, withA, withB);
    if (!inter) {
      diagnostics.push(`Khong tinh duoc giao diem ${c.intersection} (2 duong song song).`);
      continue;
    }
    setPoint(points, c.intersection, inter.x, inter.y);
  }
}

function applyTangentIntersections(
  model: GeometryModel,
  points: Map<string, Point>,
  circles: Circle[],
  diagnostics: string[]
): void {
  for (const c of model.tangentIntersections) {
    ensureLinePoint(c.withLine, points);
    const at = getPoint(points, c.at);
    const centerId = resolveCircleCenterId(
      c.circleId, c.center, circles,
      model.circlesByDiameter[0]?.centerId ?? "point:O"
    );
    const center = getPoint(points, centerId);
    const withA = getPoint(points, c.withLine.a), withB = getPoint(points, c.withLine.b);
    if (!at || !center || !withA || !withB) {
      diagnostics.push(`Chua du du lieu de dung tiep tuyen qua ${c.at} cat ${c.withLine.a}${c.withLine.b}.`);
      continue;
    }
    const vx = at.x - center.x, vy = at.y - center.y;
    const tangentDir = { id: "", x: at.x - vy, y: at.y + vx };
    const inter = lineIntersection(at, tangentDir, withA, withB);
    if (!inter) {
      diagnostics.push(`Khong tinh duoc giao diem ${c.intersection} cho tiep tuyen qua ${c.at}.`);
      continue;
    }
    const circleRadius = circles.find(c2 => c2.id === (c.circleId ?? c.center))?.radius
      ?? circles[0]?.radius ?? 120;
    const di = dist(inter, at);
    if (!Number.isFinite(di) || di > circleRadius * 20) {
      const dx = tangentDir.x - at.x, dy = tangentDir.y - at.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      setPoint(points, c.intersection, at.x + (dx / len) * 10, at.y + (dy / len) * 10);
      diagnostics.push(`Giao diem ${c.intersection} duoc xap xi vi hai duong gan song song (tranh vo cuc so).`);
      continue;
    }
    setPoint(points, c.intersection, inter.x, inter.y);
  }
}

function extendTangentIntersectionRays(model: GeometryModel, points: Map<string, Point>): void {
  for (const item of model.tangentIntersections) {
    const at = getPoint(points, item.at);
    const intersection = getPoint(points, item.intersection);
    if (!at || !intersection) continue;
    const dx = intersection.x - at.x, dy = intersection.y - at.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const extra = Math.max(4, len * 4);
    const helperId = `_tan_${item.at}_${item.intersection}`;
    setPoint(points, helperId,
      at.x + (dx / len) * (len + extra),
      at.y + (dy / len) * (len + extra)
    );
  }
}

function applyPointsOnCircles(
  model: GeometryModel,
  points: Map<string, Point>,
  circles: Circle[],
  diagnostics: string[]
): void {
  let index = 0;
  for (const pc of model.pointsOnCircles) {
    // Resolve circle by circleId first (handles cases where the PointOnCircle
    // was declared with a circleId rather than an explicit center id).
    const circle = circles.find((c) =>
      (pc.circleId !== undefined && c.id === pc.circleId) || c.center === pc.center
    );
    const centerId = circle?.center ?? pc.center;
    const center = getPoint(points, centerId);
    if (!center || !circle) {
      diagnostics.push(`Khong xac dinh duoc duong tron tam ${pc.center} cho diem ${pc.point}.`);
      continue;
    }

    // Find the angle parameter for this point, if any
    const angleParam = model.angleParameters?.find(
      (ap) => ap.point === pc.point && ap.center === centerId
    ) ?? null;

    const current = getPoint(points, pc.point);
    if (current) {
      const vx = current.x - center.x, vy = current.y - center.y;
      const len = Math.sqrt(vx * vx + vy * vy);
      if (len > 1e-6) {
        if (angleParam !== null && angleParam.value !== null) {
          // Enforce stored angle: place at the parametric angle (not current direction)
          setPoint(points, pc.point,
            center.x + Math.cos(angleParam.value) * circle.radius,
            center.y + Math.sin(angleParam.value) * circle.radius
          );
        } else {
          // Project to circle surface and store the computed angle for next iterations
          const nx = vx / len, ny = vy / len;
          setPoint(points, pc.point,
            center.x + nx * circle.radius,
            center.y + ny * circle.radius
          );
          if (angleParam !== null) angleParam.value = Math.atan2(ny, nx);
        }
        continue;
      }
    }

    // No current position — place using stored angle or evenly-spaced heuristic
    const hasDiameterBase = model.circlesByDiameter.some(
      (dc) => (dc.centerId ?? "point:O") === pc.center
    );
    let angle: number;
    if (angleParam !== null && angleParam.value !== null) {
      angle = angleParam.value;
    } else {
      angle = hasDiameterBase
        ? Math.PI / 2 + index * ((2 * Math.PI) / 3)
        : (index / Math.max(1, model.pointsOnCircles.length)) * Math.PI * 2 + Math.PI / 8;
      if (angleParam !== null) angleParam.value = angle;
    }
    index += 1;
    setPoint(points, pc.point,
      center.x + Math.cos(angle) * circle.radius,
      center.y + Math.sin(angle) * circle.radius
    );
  }
}

/**
 * Upsert a circle into a live array: update `radius` in-place if the circle
 * already exists (matched by `id` or `center`), otherwise append a new entry.
 * Used by both `applySpecialCircles` and `applyDerivedCircles`.
 */
function upsertCircle(circles: Circle[], entry: Circle): void {
  const existing = circles.find(
    (c) => (entry.id !== undefined && c.id === entry.id) || c.center === entry.center
  );
  if (existing) {
    existing.radius = entry.radius;
  } else {
    circles.push(entry);
  }
}

/**
 * Re-derive circle centers and radii that are analytically determined by current
 * point positions.  Called on every solver iteration so that incircle /
 * circumcircle / diameter-circle centers track their defining vertices as they
 * converge.
 *
 * Does NOT touch `model.circles` (explicit fixed-radius circles — those are
 * seeded once by `applySpecialCircles`).
 */
export function applyDerivedCircles(
  model: GeometryModel,
  points: Map<string, Point>,
  circles: Circle[],
  diagnostics: string[]
): void {
  // circlesByDiameter: center = midpoint(a, b), radius = dist(a,b)/2
  let diameterIndex = 1;
  for (const dc of model.circlesByDiameter) {
    const centerId = dc.centerId ?? `point:Od${diameterIndex++}`;
    if (!points.has(dc.a) || !points.has(dc.b)) continue; // not yet seeded
    const a = getPoint(points, dc.a) as Point;
    const b = getPoint(points, dc.b) as Point;
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    setPoint(points, centerId, cx, cy);
    upsertCircle(circles, { id: dc.circleId, center: centerId, radius: dist(a, b) / 2 });
  }

  // incircles: center = incenter of triangle, radius = inradius
  for (const ic of model.incircles) {
    const tri = ic.triangle ?? model.triangles[0]?.vertices;
    if (!tri) { diagnostics.push("Khong xac dinh duoc tam giac de dung duong tron noi tiep."); continue; }
    const c = deriveIncircle(tri, points);
    if (!c) { diagnostics.push("Khong du du lieu de dung duong tron noi tiep."); continue; }
    const [pA, pB, pC] = tri.map((id) => getPoint(points, id));
    if (!pA || !pB || !pC) { diagnostics.push("Khong du du lieu de dung duong tron noi tiep."); continue; }
    const sA = dist(pB, pC), sB = dist(pA, pC), sC = dist(pA, pB);
    const p = sA + sB + sC || 1;
    const centerId = ic.center ?? "I";
    c.center = centerId;
    setPoint(points, centerId, (sA * pA.x + sB * pB.x + sC * pC.x) / p, (sA * pA.y + sB * pB.y + sC * pC.y) / p);
    upsertCircle(circles, c);
  }

  // circumcircles: center = circumcenter of triangle, radius = circumradius
  for (const oc of model.circumcircles) {
    const tri = oc.triangle ?? model.triangles[0]?.vertices;
    if (!tri) { diagnostics.push("Khong xac dinh duoc tam giac de dung duong tron ngoai tiep."); continue; }
    const c = deriveCircumcircle(tri, points);
    if (!c) { diagnostics.push("Khong du du lieu de dung duong tron ngoai tiep."); continue; }
    const [pA, pB, pC] = tri.map((id) => getPoint(points, id));
    if (!pA || !pB || !pC) { diagnostics.push("Khong du du lieu de dung duong tron ngoai tiep."); continue; }
    const midAB = { id: "", x: (pA.x + pB.x) / 2, y: (pA.y + pB.y) / 2 };
    const midAC = { id: "", x: (pA.x + pC.x) / 2, y: (pA.y + pC.y) / 2 };
    const nAB = { id: "", x: midAB.x - (pB.y - pA.y), y: midAB.y + (pB.x - pA.x) };
    const nAC = { id: "", x: midAC.x - (pC.y - pA.y), y: midAC.y + (pC.x - pA.x) };
    const o = lineIntersection(midAB, nAB, midAC, nAC);
    if (!o) { diagnostics.push("Khong tinh duoc tam duong tron ngoai tiep (tam giac suy bien)."); continue; }
    setPoint(points, "O", o.x, o.y);
    upsertCircle(circles, c);
  }

  // circleConstraints: radius = live dist(center, pointOnCircle)
  for (const cc of model.circleConstraints) {
    if (!points.has(cc.centerPointId) || !points.has(cc.pointOnCircleId)) continue;
    const center = getPoint(points, cc.centerPointId) as Point;
    const onCircle = getPoint(points, cc.pointOnCircleId) as Point;
    upsertCircle(circles, { id: cc.circleId, center: cc.centerPointId, radius: Math.max(dist(center, onCircle), 0.2) });
  }

  // diameterConstraints (v2): center = midpoint, radius = dist/2
  for (const dc of model.diameterConstraints) {
    if (!points.has(dc.point1Id) || !points.has(dc.point2Id)) continue;
    const p1 = getPoint(points, dc.point1Id) as Point;
    const p2 = getPoint(points, dc.point2Id) as Point;
    const centerId = diameterConstraintCenterId(dc.circleId);
    setPoint(points, centerId, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
    upsertCircle(circles, { id: dc.circleId, center: centerId, radius: Math.max(dist(p1, p2) / 2, 0.2) });
  }
}

export function applySpecialCircles(
  model: GeometryModel,
  points: Map<string, Point>,
  circles: Circle[],
  diagnostics: string[],
  seedMissingPoints = true
): void {
  if (seedMissingPoints) {
    // Seed explicit fixed-radius circles from the problem statement.
    for (const c of model.circles) {
      if (!points.has(c.center)) setPoint(points, c.center, 0, 0);
      upsertCircle(circles, c);
    }

    // Seed any diameter endpoint positions that don't exist yet.
    let diameterIndex = 1;
    for (const dc of model.circlesByDiameter) {
      const centerId = dc.centerId ?? `point:Od${diameterIndex++}`;
      const centerExists = points.has(centerId);
      const aExists = points.has(dc.a);
      const bExists = points.has(dc.b);

      if (centerExists && !aExists && !bExists) {
        const center = getPoint(points, centerId) as Point;
        const modelCircle = model.circles.find((c) => c.id === dc.circleId || c.center === centerId);
        const radius = modelCircle?.radius ?? 100;
        setPoint(points, dc.a, center.x - radius, center.y);
        setPoint(points, dc.b, center.x + radius, center.y);
      } else {
        if (!aExists) setPoint(points, dc.a, -100, 0);
        if (!bExists) setPoint(points, dc.b, 100, 0);
      }
    }

    // Seed missing endpoints for circleConstraints / diameterConstraints.
    for (const cc of model.circleConstraints) {
      if (!points.has(cc.centerPointId))   setPoint(points, cc.centerPointId, 0, 0);
      if (!points.has(cc.pointOnCircleId)) setPoint(points, cc.pointOnCircleId, 100, 0);
    }
    for (const dc of model.diameterConstraints) {
      if (!points.has(dc.point1Id)) setPoint(points, dc.point1Id, -100, 0);
      if (!points.has(dc.point2Id)) setPoint(points, dc.point2Id, 100, 0);
    }
  } else {
    // Even when not seeding positions, fixed-radius model.circles must be upserted
    // so the circles array stays accurate.
    for (const c of model.circles) upsertCircle(circles, c);
  }

  // Derive all analytically-determined circles from current point positions.
  applyDerivedCircles(model, points, circles, diagnostics);
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Apply all solving constraints (everything except circle seeding).
 *
 * Exported so `refineLayoutWithSolver` can call it on each iteration without
 * re-running the one-time `applySpecialCircles` setup.  This eliminates the
 * ~200-line duplicate constraint loop that previously lived in `solver.ts`.
 *
 * IMPORTANT: `circles` must already be populated (by `applySpecialCircles` or
 * equivalent) before calling this.  Mutates `points` and updates circle radii
 * in-place when defined by constraint (circleConstraints, diameterConstraints).
 */
export function applySolvingConstraints(
  model: GeometryModel,
  points: Map<string, Point>,
  circles: Circle[],
  diagnostics: string[]
): void {
  applyPointsOnCircles(model, points, circles, diagnostics);
  applyAltitudes(model, points, diagnostics);
  applyMedians(model, points, diagnostics);
  applyAngleBisectors(model, points, diagnostics);
  applyPointOnSegment(model, points, diagnostics);
  applyNamedTangents(model, points, circles, diagnostics);
  applyPerpendicularThroughPointIntersections(model, points, diagnostics);
  applyTangentIntersections(model, points, circles, diagnostics);
  extendTangentIntersectionRays(model, points);
  applyParallelPerpendicular(model, points, diagnostics);
  applyPerpendicularLines(model, points);
  applyEqualLengths(model, points);
  applyEqualAngles(model, points);
  applyMidpoints(model, points, diagnostics);
  applyCentroids(model, points, diagnostics);
  applyLineIntersections(model, points, diagnostics);
}

/**
 * Full initial solve: seed missing default positions, derive all circle entries,
 * then apply all positional / relational constraints.
 *
 * Call this ONCE for an initial layout (e.g. from `buildLayout`).
 * The `points` map must already contain at least the anchor point(s).
 * Use `reSolveConstraints` for subsequent re-solves when all points already exist.
 */
export function solveConstraints(
  model: GeometryModel,
  points: Map<string, Point>,
  circles: Circle[],
  diagnostics: string[]
): void {
  // seedMissingPoints = true (default): places default coordinates for any
  // points not yet in the map before computing circle/constraint positions.
  applySpecialCircles(model, points, circles, diagnostics); // initial layout
  applySolvingConstraints(model, points, circles, diagnostics);
}

/**
 * Re-solve constraints when all points already have known positions — for
 * example after a user drags a point in the interactive editor.
 *
 * Skips default-position seeding (`seedMissingPoints = false`) since every
 * point is already in the map.  Only re-derives analytically-determined circle
 * centers (incircle, circumcircle, diameter) and re-applies all positional /
 * relational constraints on top of the current positions.
 *
 * Callers should pass a fresh `circles` array (or a copy of the previous one)
 * and the `points` map with the dragged point already updated.
 */
export function reSolveConstraints(
  model: GeometryModel,
  points: Map<string, Point>,
  circles: Circle[],
  diagnostics: string[]
): void {
  // seedMissingPoints = false: skip seeding — all points are already placed.
  applySpecialCircles(model, points, circles, diagnostics, false);
  applySolvingConstraints(model, points, circles, diagnostics);
}

/**
 * After a full solve, read the final on-circle positions back into angleParameters.
 * Call this ONCE after the last solver iteration so angle parameters reflect the
 * converged positions.  This makes the angles available for serialization, debug,
 * and as stable input for any subsequent re-solve (e.g. after user drags another point).
 */
export function updateAngleParametersFromSolvedPositions(
  model: GeometryModel,
  points: Map<string, Point>,
  circles: Circle[]
): void {
  if (!model.angleParameters?.length) return;
  for (const ap of model.angleParameters) {
    const pt = getPoint(points, ap.point);
    const center = getPoint(points, ap.center);
    if (!pt || !center) continue;
    const circle = circles.find((c) => c.center === ap.center);
    if (!circle) continue;
    const vx = pt.x - center.x, vy = pt.y - center.y;
    const len = Math.sqrt(vx * vx + vy * vy);
    if (len > 1e-6) ap.value = Math.atan2(vy / len, vx / len);
  }
}
