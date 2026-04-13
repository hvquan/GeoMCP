/**
 * Layout / Beautification Layer — Layer 13
 *
 * Chooses visually appealing initial positions for the ROOT objects (triangle
 * vertices, rectangle corners, circle center …) that are not determined by
 * constraints alone.  Every other point is derived by the constraint solver
 * (Layer 12) after this initial placement.
 *
 * Responsibilities:
 *   - LayoutPolicy interface: separates beautification decisions from the solver
 *   - DEFAULT_LAYOUT_POLICY: canonical world-space anchor + radial spread
 *   - buildLayout: orchestrate all layers (13 → 12 → 13 → 14)
 *
 * NOT responsible for:
 *   - Computing constraint-derived positions (→ constraint-solver.ts)
 *   - Deciding which edges/circles to draw (→ scene-builder.ts)
 *   - Viewport scaling / label placement (→ viewport.ts)
 */

import { AngleMark, Circle, GeometryModel, LayoutModel, LineNode, CircleNode, Point, RightAngleMark, SegmentMark, Segment, Triangle } from "../model/types.js";
import { setPoint, getPoint, dist, solveConstraints, updateAngleParametersFromSolvedPositions } from "../geometry/constraint-solver.js";
import { buildSceneGraph } from "../render/scene-graph.js";

// ─── Layout Policy ────────────────────────────────────────────────────────────

/**
 * A layout policy separates beautification decisions from the geometry solver.
 *
 * `anchor`   — seed at least one anchor point before solveConstraints runs.
 *              Receives the full model and the (empty) points map. Should place
 *              root-shape vertices so every constraint-derived point has a base.
 *
 * `spreadFree` — called AFTER the solve to place any points that the solver left
 *              unpositioned (e.g. points that appear in the model but have no
 *              geometric relation to the solved set). Spread them so they don't
 *              all land at the origin.
 *
 * Implementing an alternative policy (e.g. force-directed, fixed-seed) only
 * requires providing a different object matching this interface — no changes
 * to the solver or scene-builder.
 */
export interface LayoutPolicy {
  anchor(model: GeometryModel, points: Map<string, Point>, diagnostics: string[]): void;
  spreadFree(allPointIds: string[], points: Map<string, Point>): void;
}

// ─── Shape-specific placement helpers ────────────────────────────────────────

function lengthOf(segments: Segment[], a: string, b: string): number | undefined {
  for (const s of segments) {
    if ((s.a === a && s.b === b) || (s.a === b && s.b === a)) return s.length;
  }
  return undefined;
}

function placeTriangle(
  triangle: Triangle,
  model: GeometryModel,
  points: Map<string, Point>,
  diagnostics: string[]
): void {
  const [a, b, c] = triangle.vertices;

  let ab = lengthOf(model.segments, a, b);
  let ac = lengthOf(model.segments, a, c);
  let bc = lengthOf(model.segments, b, c);

  if (triangle.equilateral) {
    const side = ab ?? ac ?? bc ?? 4;
    ab = ac = bc = side;
  }

  if (triangle.isoscelesAt === a) {
    if (ab == null && ac != null) ab = ac;
    if (ac == null && ab != null) ac = ab;
  }
  if (triangle.isoscelesAt === b) {
    if (ab == null && bc != null) ab = bc;
    if (bc == null && ab != null) bc = ab;
  }
  if (triangle.isoscelesAt === c) {
    if (ac == null && bc != null) ac = bc;
    if (bc == null && ac != null) bc = ac;
  }

  if (triangle.rightAt && [a, b, c].includes(triangle.rightAt)) {
    const r = triangle.rightAt;
    const p = [a, b, c].find((it) => it !== r) as string;
    const q = [a, b, c].find((it) => it !== r && it !== p) as string;
    setPoint(points, r, 0, 0);
    setPoint(points, p, lengthOf(model.segments, r, p) ?? 4, 0);
    setPoint(points, q, 0, lengthOf(model.segments, r, q) ?? 3);
    return;
  }

  const safeAB = ab ?? 5;
  const safeAC = ac ?? 4;

  if (bc != null) {
    setPoint(points, a, 0, 0);
    setPoint(points, b, safeAB, 0);
    const x = (safeAB * safeAB + safeAC * safeAC - bc * bc) / (2 * safeAB);
    const ySquared = safeAC * safeAC - x * x;
    if (ySquared < -1e-6) {
      diagnostics.push(`Do dai canh cua tam giac ${a}${b}${c} khong hop le (vi pham bat dang thuc tam giac).`);
      setPoint(points, c, safeAB / 2, safeAC * 0.8);
      return;
    }
    setPoint(points, c, x, Math.sqrt(Math.max(0, ySquared)));
    return;
  }

  setPoint(points, a, 0, 0);
  setPoint(points, b, safeAB, 0);
  setPoint(points, c, safeAB / 2, safeAC * 0.9);
}

function placeRectangle(vertices: [string, string, string, string], points: Map<string, Point>): void {
  const [a, b, c, d] = vertices;
  setPoint(points, a, 0, 0); setPoint(points, b, 6, 0);
  setPoint(points, c, 6, 4); setPoint(points, d, 0, 4);
}

function placeSquare(vertices: [string, string, string, string], points: Map<string, Point>): void {
  const [a, b, c, d] = vertices;
  setPoint(points, a, 0, 0); setPoint(points, b, 5, 0);
  setPoint(points, c, 5, 5); setPoint(points, d, 0, 5);
}

function placeParallelogram(vertices: [string, string, string, string], points: Map<string, Point>): void {
  const [a, b, c, d] = vertices;
  setPoint(points, a, 0, 0); setPoint(points, b, 6, 0);
  setPoint(points, d, 2, 4); setPoint(points, c, 8, 4);
}

function placeTrapezoid(vertices: [string, string, string, string], points: Map<string, Point>): void {
  const [a, b, c, d] = vertices;
  setPoint(points, a, 0, 0); setPoint(points, b, 8, 0);
  setPoint(points, d, 2, 4); setPoint(points, c, 6, 4);
}

/**
 * Place the ROOT object at a canonical position so that all subsequent
 * constraint-solving steps have a fixed anchor to start from.
 *
 * Root selection priority: triangle → square → rectangle → parallelogram →
 * trapezoid → circle → circle-by-diameter → segment → line → point.
 */
function ensureBaseShape(model: GeometryModel, points: Map<string, Point>, diagnostics: string[]): void {
  const baseShapeCount =
    (model.triangles.length > 0 ? 1 : 0) +
    (model.squares.length > 0 ? 1 : 0) +
    (model.rectangles.length > 0 ? 1 : 0) +
    (model.parallelograms.length > 0 ? 1 : 0) +
    (model.trapezoids.length > 0 ? 1 : 0);

  if (baseShapeCount > 1) {
    diagnostics.push(
      "De bai co nhieu hinh nen doc lap; he thong uu tien dung hinh dau tien theo thu tu: tam giac -> vuong -> chu nhat -> binh hanh -> thang."
    );
  }

  if (model.triangles.length > 0) {
    placeTriangle(model.triangles[0], model, points, diagnostics);
    return;
  }
  if (model.squares.length > 0)        { placeSquare(model.squares[0].vertices, points); return; }
  if (model.rectangles.length > 0)     { placeRectangle(model.rectangles[0].vertices, points); return; }
  if (model.parallelograms.length > 0) { placeParallelogram(model.parallelograms[0].vertices, points); return; }
  if (model.trapezoids.length > 0)     { placeTrapezoid(model.trapezoids[0].vertices, points); return; }

  if (model.circles.length > 0) {
    setPoint(points, model.circles[0].center, 0, 0);
    return;
  }

  if (model.circlesByDiameter.length > 0) return; // handled by applySpecialCircles

  if (model.segments.length > 0) {
    const s = model.segments[0];
    const half = (s.length ?? 200) / 2;
    setPoint(points, s.a, -half, 0);
    setPoint(points, s.b,  half, 0);
    return;
  }

  if (model.lines.length > 0) {
    const l = model.lines[0];
    if (l.a && l.b) {
      setPoint(points, l.a, -100, 0);
      setPoint(points, l.b,  100, 0);
    }
    return;
  }

  if (model.points.length > 0) {
    setPoint(points, model.points[0], 0, 0);
  }
}

function placeUnusedPoints(all: string[], points: Map<string, Point>): void {
  const missing = all.filter((id) => !points.has(id));
  missing.forEach((id, i) => {
    const angle = (i / Math.max(1, missing.length)) * Math.PI * 2;
    setPoint(points, id, 3 * Math.cos(angle), 3 * Math.sin(angle));
  });
}

// ─── Default policy (canonical world-space seed) ──────────────────────────────

/**
 * The built-in layout policy used by `buildLayout`.
 *
 * `anchor`   — calls `ensureBaseShape`: places the first triangle/polygon/circle/
 *              segment at a fixed canonical world-space position.
 * `spreadFree` — calls `placeUnusedPoints`: spreads leftover unconstrained points
 *              evenly on a circle of radius 3 around the origin.
 *
 * Pass a different `LayoutPolicy` to `buildLayout` to override either behaviour.
 */
export const DEFAULT_LAYOUT_POLICY: LayoutPolicy = {
  anchor: ensureBaseShape,
  spreadFree: placeUnusedPoints,
};

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Full pipeline orchestrator:
 *
 *   Layer 13 (Beautification)  →  policy.anchor        (seed root positions)
 *   Layer 12 (Geometry Solver) →  solveConstraints
 *   Layer 13 (Beautification)  →  policy.spreadFree    (place leftover points)
 *   Layer 14 (Scene Graph)     →  buildSceneGraph
 *
 * @param policy  Beautification strategy. Defaults to DEFAULT_LAYOUT_POLICY.
 *                Provide an alternative to override seeding or spreading logic.
 */
export function buildLayout(model: GeometryModel, policy: LayoutPolicy = DEFAULT_LAYOUT_POLICY): LayoutModel {
  const points = new Map<string, Point>();
  const circles: Circle[] = [];
  const diagnostics: string[] = [];

  policy.anchor(model, points, diagnostics);             // Layer 13: choose root position
  solveConstraints(model, points, circles, diagnostics); // Layer 12: initial layout — seeds + derives + applies all constraints
  updateAngleParametersFromSolvedPositions(model, points, circles); // persist solved angles
  policy.spreadFree(model.points, points);               // Layer 13: spread free points nicely

  const nodes = buildSceneGraph(model, points, circles, diagnostics); // Layer 14: typed scene graph

  // Derive backward-compat shadow arrays from the typed node list.
  const segments: Segment[] = nodes
    .filter((n): n is LineNode => n.kind === "line")
    .map((n) => ({ a: n.a, b: n.b, ...(n.dashed && { dashed: true }) }));
  const circlesOut: CircleNode[] = nodes.filter((n): n is CircleNode => n.kind === "circle");

  // Angle-arc marks: one AngleMark per individual angle side of each equal-angle pair.
  // Each EqualAngleConstraint { angle1, angle2 } → 2 AngleMark objects sharing a group id.
  // Prefer displayEqualAngles if populated (incircle synthesis moves constraints there).
  const displayAngles = (model.displayEqualAngles?.length ? model.displayEqualAngles : model.equalAngles);
  const angleMarks: AngleMark[] = [];
  displayAngles?.forEach((ea, i) => {
    const group = `eq_angle_${i}`;
    angleMarks.push({ points: ea.angle1, group });
    angleMarks.push({ points: ea.angle2, group });
  });

  // Bisector half-angle marks: for each bisector (from, foot, sideA, sideB),
  // emit two AngleMark objects in the same group so adjacent arcs look equal.
  // Angle 1: sideA – from – foot   (left half)
  // Angle 2: foot – from – sideB   (right half)
  model.angleBisectors.forEach((bis, i) => {
    const group = `bisector_${i}`;
    angleMarks.push({ points: [bis.sideA, bis.from, bis.foot], group });
    angleMarks.push({ points: [bis.foot, bis.from, bis.sideB], group });
  });

  // Right-angle box marks: one per altitude foot + per perpendicular-through-point intersection.
  // Deduplicate by vertex so the same foot isn't marked twice.
  // Line IDs are canonical edge keys "A:B" (sorted point-pair), matching lineKey() in webapp.ts.
  const lk = (a: string, b: string) => [a, b].sort().join(":");
  const lineNodeKeys = new Set(
    nodes.filter((n): n is LineNode => n.kind === "line").map((n) => lk(n.a, n.b))
  );

  const rightAngleMarks: RightAngleMark[] = [];
  const markVertices = new Set<string>();
  for (const alt of model.altitudes) {
    if (!markVertices.has(alt.foot)) {
      markVertices.add(alt.foot);
      const k1 = lk(alt.from, alt.foot);
      const k2 = lk(alt.baseA, alt.baseB);
      if (lineNodeKeys.has(k1) && lineNodeKeys.has(k2)) {
        rightAngleMarks.push({ pointId: alt.foot, line1Id: k1, line2Id: k2 });
      }
    }
  }
  for (const p of model.perpendicularThroughPointIntersections) {
    if (!markVertices.has(p.intersection)) {
      markVertices.add(p.intersection);
      const k1 = lk(p.through, p.intersection);
      const k2 = lk(p.toLine.a, p.toLine.b);
      rightAngleMarks.push({ pointId: p.intersection, line1Id: k1, line2Id: k2 });
    }
  }

  // Segment equality tick marks.
  // Source 1: explicit equalLengths — each pair shares a group.
  // Source 2: midpoints — M on A–B gives A–M and M–B equal.
  // Source 3: medians — foot M on baseA–baseB gives baseA–foot and foot–baseB equal.
  // Source 4: isosceles triangles already emit equalLengths pairs via the compiler.
  const segmentMarks: SegmentMark[] = [];
  const seenSegMarkKey = new Set<string>();
  const addSegMark = (a: string, b: string, group: string) => {
    const key = lk(a, b) + "|" + group;
    if (!seenSegMarkKey.has(key)) {
      seenSegMarkKey.add(key);
      segmentMarks.push({ a, b, group });
    }
  };
  model.equalLengths.forEach((el, i) => {
    const group = `eq_len_${i}`;
    addSegMark(el.segment1.a, el.segment1.b, group);
    addSegMark(el.segment2.a, el.segment2.b, group);
  });
  model.midpoints.forEach((mp, i) => {
    const group = `midpoint_${i}`;
    addSegMark(mp.a, mp.point, group);
    addSegMark(mp.point, mp.b, group);
  });
  model.medians.forEach((med, i) => {
    const group = `median_${i}`;
    addSegMark(med.baseA, med.foot, group);
    addSegMark(med.foot, med.baseB, group);
  });

  return { points: [...points.values()], segments, circles: circlesOut.map((n) => ({ center: n.center, radius: n.radius, ...(n.id !== undefined && { id: n.id }) })), nodes, angleMarks, rightAngleMarks, segmentMarks, diagnostics };
}
