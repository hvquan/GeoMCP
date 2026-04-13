/**
 * Scene Builder — Layer 14 (Scene Graph Builder)
 *
 * Converts a solved geometry model (points with concrete coordinates) into the
 * final list of drawable segments.  This layer is responsible for:
 *
 *   1. Deciding WHICH edges to draw (triangle sides, altitude lines, etc.)
 *   2. Extending each segment so it spans all collinear declared points
 *   3. Removing sub-segments superseded by extended ones
 *   4. Adding dashed auxiliary segments (altitude feet ↔ base, vertex ↔ orthocenter)
 *
 * Keeping this separate from the constraint solver (Layer 12) and from the
 * beautification layer (Layer 13) makes each concern independently testable and
 * replaceable.
 */

import { Circle, GeometryModel, LineNode, CircleNode, SceneNode, Point, Segment } from "../model/types.js";
import { displayLabel } from "../model/normalize.js";
import { dist, setPoint, getPoint, projectPointToLine, lineIntersection, resolveCircleCenterId, diameterConstraintCenterId } from "../geometry/constraint-solver.js";

// ─── Internal helpers ─────────────────────────────────────────────────────────

export function addSegmentUnique(segments: Segment[], s: Segment): void {
  const exists = segments.some(
    (it) => (it.a === s.a && it.b === s.b) || (it.a === s.b && it.b === s.a)
  );
  if (!exists) segments.push(s);
}

/**
 * For each segment, build the set of ALL points that are declared to lie on the
 * line through that segment (via pointsOnSegments, lineIntersections, altitudes,
 * medians, angleBisectors, perpendicularThroughPointIntersections,
 * tangentIntersections).  Replace the segment's endpoints with the two extreme
 * points along the line so the drawn segment always covers every declared point.
 */
function extendSegmentsToContainCollinearPoints(
  segments: Segment[],
  model: GeometryModel,
  points: Map<string, Point>
): Segment[] {
  const collinear = new Map<string, Set<string>>();
  const lineKey = (a: string, b: string): string => [a, b].sort().join("|");
  const addToLine = (a: string, b: string, p: string): void => {
    if (!a || !b || a === b) return;
    const key = lineKey(a, b);
    if (!collinear.has(key)) collinear.set(key, new Set([a, b]));
    if (p) collinear.get(key)!.add(p);
  };

  // Altitude feet can land outside their base segment in an obtuse triangle.
  // Skip them here so the base segment endpoints are never replaced with the foot.
  const altitudeFootIds = new Set(model.altitudes.map((alt) => alt.foot));

  for (const rel of model.pointsOnSegments) {
    if (altitudeFootIds.has(rel.point)) continue;
    addToLine(rel.a, rel.b, rel.point);
  }
  for (const mp of model.midpoints) {
    addToLine(mp.a, mp.b, mp.point);
  }
  for (const alt of model.altitudes) {
    // Do NOT register alt.foot on the base segment — in an obtuse triangle the foot
    // falls outside, and doing so would replace a vertex with the foot, disconnecting it.
    addToLine(alt.from, alt.foot, alt.foot);
  }
  for (const md of model.medians) {
    addToLine(md.baseA, md.baseB, md.foot);
  }
  for (const bis of model.angleBisectors) {
    addToLine(bis.sideA, bis.sideB, bis.foot);
  }
  for (const c of model.perpendicularThroughPointIntersections) {
    addToLine(c.through, c.intersection, c.intersection);
    addToLine(c.toLine.a, c.toLine.b, c.intersection);
  }
  for (const c of model.tangentIntersections) {
    addToLine(c.at, c.intersection, c.intersection);
    addToLine(c.withLine.a, c.withLine.b, c.intersection);
  }

  const lineRefById = new Map<string, { a: string; b: string }>();
  for (const l of model.lines) {
    const a = l.a ?? l.point1Id;
    const b = l.b ?? l.point2Id;
    if (l.id && a && b) lineRefById.set(l.id, { a, b });
  }
  // Parse "line:XY" refs that aren't covered by explicit model.lines entries
  // (e.g. medians like "line:AD" where A is a vertex and D a midpoint)
  for (const li of model.lineIntersections) {
    for (const key of [li.line1, li.line2]) {
      if (lineRefById.has(key)) continue;
      const name = key.startsWith("line:") ? key.slice(5) : key;
      if (/^[A-Z]{2}$/.test(name)) {
        lineRefById.set(key, { a: `point:${name[0]}`, b: `point:${name[1]}` });
        lineRefById.set(name, { a: `point:${name[0]}`, b: `point:${name[1]}` });
      }
    }
  }
  for (const li of model.lineIntersections) {
    const l1 = lineRefById.get(li.line1);
    const l2 = lineRefById.get(li.line2);
    // Do NOT extend altitude segments (e.g. AD, BE, CF) by adding the orthocenter H
    // onto them.  The drawn segment is from the vertex to the foot — H lies on the
    // infinite line through those points but should not stretch the drawn segment.
    const isAltitudeLine = (ref: { a: string; b: string } | undefined) => {
      if (!ref) return false;
      return model.altitudes.some(
        (alt) => (alt.from === ref.a && alt.foot === ref.b) ||
                 (alt.from === ref.b && alt.foot === ref.a)
      );
    };
    if (l1 && !isAltitudeLine(l1)) addToLine(l1.a, l1.b, li.point);
    if (l2 && !isAltitudeLine(l2)) addToLine(l2.a, l2.b, li.point);
  }

  const EPS_COLLINEAR = 4;

  return segments.map((seg) => {
    const pA = points.get(seg.a);
    const pB = points.get(seg.b);
    if (!pA || !pB) return seg;
    const dx = pB.x - pA.x, dy = pB.y - pA.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) return seg;

    const key = lineKey(seg.a, seg.b);
    const candidates: Set<string> = collinear.get(key) ?? new Set([seg.a, seg.b]);

    let tMin = 0, tMax = 1;
    let minId = seg.a, maxId = seg.b;

    for (const id of candidates) {
      const p = points.get(id);
      if (!p) continue;
      const cross = Math.abs((p.x - pA.x) * dy - (p.y - pA.y) * dx) / Math.sqrt(len2);
      if (cross > EPS_COLLINEAR) continue;
      const t = ((p.x - pA.x) * dx + (p.y - pA.y) * dy) / len2;
      if (t < tMin) { tMin = t; minId = id; }
      if (t > tMax) { tMax = t; maxId = id; }
    }

    if (minId === seg.a && maxId === seg.b) return seg;
    return { a: minId, b: maxId, length: seg.length, dashed: seg.dashed };
  });
}

/**
 * Place implicit tangent direction helper points and add the corresponding
 * visual segments.  This is separate from applyNamedTangents in the constraint
 * solver because here we are merely deciding how to draw tangents that were not
 * given explicit line names.
 */
function applyTangentSegments(
  model: GeometryModel,
  points: Map<string, Point>,
  circles: Circle[],
  segments: Segment[],
  diagnostics: string[]
): void {
  let tangentIndex = 1;
  const explicitTangentAt = new Set<string>([
    ...model.namedTangents.map((t) => t.at),
    ...model.tangentIntersections.map((t) => t.at),
  ]);

  for (const tg of model.tangents) {
    const at = tg.pointId ?? tg.at;
    if (!at || explicitTangentAt.has(at)) continue;

    const centerFromCircleId = tg.circleId
      ? (model.circles.find((c) => c.id === tg.circleId)?.center
          ?? circles.find((c) => c.id === tg.circleId)?.center)
      : undefined;
    const centerId = resolveCircleCenterId(
      tg.circleId,
      tg.circleCenter ?? centerFromCircleId,
      circles,
      model.circles[0]?.center ?? "I"
    );
    const p = getPoint(points, at);
    const center = getPoint(points, centerId);
    if (!p || !center) {
      diagnostics.push(`Chua du diem de dung tiep tuyen tai ${at}.`);
      continue;
    }
    const vx = p.x - center.x, vy = p.y - center.y;
    const perp = { x: -vy, y: vx };
    const plen = Math.sqrt(perp.x * perp.x + perp.y * perp.y) || 1;
    const tid = `T${tangentIndex++}`;
    setPoint(points, tid, p.x + (perp.x / plen) * 2.5, p.y + (perp.y / plen) * 2.5);
    addSegmentUnique(segments, { a: at, b: tid });
  }
}

// ─── Dashed auxiliary segments ────────────────────────────────────────────────

function buildAltitudeDashedSegments(
  model: GeometryModel,
  points: Map<string, Point>
): Segment[] {
  if (model.altitudes.length === 0) return [];

  const dashed: Segment[] = [];

  // 1. Foot ↔ base endpoints (shows where foot sits on / outside the base)
  for (const alt of model.altitudes) {
    if (points.has(alt.foot) && points.has(alt.baseA))
      dashed.push({ a: alt.foot, b: alt.baseA, dashed: true });
    if (points.has(alt.foot) && points.has(alt.baseB))
      dashed.push({ a: alt.foot, b: alt.baseB, dashed: true });
  }

  // 2. Vertex ↔ orthocenter (makes H visible when it's outside the triangle)
  const altLineKeys = new Set<string>();
  for (const alt of model.altitudes) {
    const a = displayLabel(alt.from).toUpperCase().slice(0, 1);
    const f = displayLabel(alt.foot).toUpperCase().slice(0, 1);
    altLineKeys.add(`${a}${f}`);
    altLineKeys.add(`${f}${a}`);
  }
  const seenH = new Set<string>();
  for (const li of model.lineIntersections) {
    // li.line1 may be "line:AD" — strip the "line:" prefix before matching altLineKeys
    const key1 = li.line1.replace(/^line:/, "");
    const key2 = li.line2.replace(/^line:/, "");
    if (altLineKeys.has(key1) && altLineKeys.has(key2) && !seenH.has(li.point)) {
      seenH.add(li.point);
      for (const alt of model.altitudes) {
        if (points.has(alt.from) && points.has(li.point))
          dashed.push({ a: alt.from, b: li.point, dashed: true });
      }
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return dashed.filter((s) => {
    const k = [s.a, s.b].sort().join("|");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Build the complete list of drawable scene nodes from a solved geometry model.
 * Returns typed `SceneNode` variants for lines and circles.
 */
export function buildSceneGraph(
  model: GeometryModel,
  points: Map<string, Point>,
  circles: Circle[],
  diagnostics: string[]
): SceneNode[] {
  const pointSet = new Set([...points.keys()]);

  // ── Constraint label tracking ─────────────────────────────────────────────
  // For each unique edge, record which geometric relationship produced it.
  // First writer wins (e.g. "triangle-side" beats "segment" if the user also
  // declared the same edge explicitly).
  const constraintMap = new Map<string, string>();
  const edgeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

  const segments: Segment[] = [];
  const addEdge = (a: string, b: string, constraint: string): void => {
    addSegmentUnique(segments, { a, b });
    const k = edgeKey(a, b);
    if (!constraintMap.has(k)) constraintMap.set(k, constraint);
  };

  // ── User-declared segments ────────────────────────────────────────────────
  for (const s of model.segments) {
    if (!pointSet.has(s.a) || !pointSet.has(s.b)) continue;
    addEdge(s.a, s.b, "segment");
  }

  // ── Triangle sides ────────────────────────────────────────────────────────
  if (model.triangles.length > 0) {
    const [a, b, c] = model.triangles[0].vertices;
    addEdge(a, b, "triangle-side");
    addEdge(a, c, "triangle-side");
    addEdge(b, c, "triangle-side");
  }

  // ── Midpoint sub-segments ─────────────────────────────────────────────────
  for (const mp of model.midpoints) {
    const hasParent = segments.some(
      (s) => (s.a === mp.a && s.b === mp.b) || (s.a === mp.b && s.b === mp.a)
    );
    if (!hasParent) {
      addEdge(mp.a, mp.point, "midpoint");
      addEdge(mp.point, mp.b, "midpoint");
    }
  }

  // ── Point-on-segment sub-segments ─────────────────────────────────────────
  for (const rel of model.pointsOnSegments) {
    if (model.midpoints.some((mp) => mp.point === rel.point)) continue;
    const hasParent = segments.some(
      (s) => (s.a === rel.a && s.b === rel.b) || (s.a === rel.b && s.b === rel.a)
    );
    if (!hasParent) {
      addEdge(rel.a, rel.point, "point-on-segment");
      addEdge(rel.point, rel.b, "point-on-segment");
    }
  }

  // ── Altitude / median / bisector ──────────────────────────────────────────
  for (const alt of model.altitudes) addEdge(alt.from, alt.foot, "altitude");
  for (const md  of model.medians)   addEdge(md.from,  md.foot,  "median");
  for (const bis of model.angleBisectors) addEdge(bis.from, bis.foot, "angle-bisector");

  // ── Parallel / perpendicular helper lines ─────────────────────────────────
  for (const rel of model.parallels) {
    addEdge(rel.line1.a, rel.line1.b, "parallel");
    addEdge(rel.line2.a, rel.line2.b, "parallel");
  }
  for (const rel of model.perpendiculars) {
    if (!displayLabel(rel.line2.b).startsWith("t_")) {
      addEdge(rel.line1.a, rel.line1.b, "perpendicular");
      addEdge(rel.line2.a, rel.line2.b, "perpendicular");
    }
  }

  // ── Polygon sides ─────────────────────────────────────────────────────────
  for (const item of model.rectangles) {
    const [a, b, c, d] = item.vertices;
    addEdge(a, b, "rectangle-side"); addEdge(b, c, "rectangle-side");
    addEdge(c, d, "rectangle-side"); addEdge(d, a, "rectangle-side");
  }
  for (const item of model.squares) {
    const [a, b, c, d] = item.vertices;
    addEdge(a, b, "square-side"); addEdge(b, c, "square-side");
    addEdge(c, d, "square-side"); addEdge(d, a, "square-side");
  }
  for (const item of model.parallelograms) {
    const [a, b, c, d] = item.vertices;
    addEdge(a, b, "parallelogram-side"); addEdge(b, c, "parallelogram-side");
    addEdge(c, d, "parallelogram-side"); addEdge(d, a, "parallelogram-side");
  }
  for (const item of model.trapezoids) {
    const [a, b, c, d] = item.vertices;
    addEdge(a, b, "trapezoid-side"); addEdge(b, c, "trapezoid-side");
    addEdge(c, d, "trapezoid-side"); addEdge(d, a, "trapezoid-side");
  }

  // ── Named tangent lines ───────────────────────────────────────────────────
  for (const nt of model.namedTangents) addEdge(nt.at, nt.linePoint, "tangent");

  // ── Diameter radii (draw O→C and O→D, not the chord CD) ──────────────────
  for (const dc of model.circlesByDiameter) {
    if (!dc.centerId) continue;
    addEdge(dc.centerId, dc.a, "diameter-radius");
    addEdge(dc.centerId, dc.b, "diameter-radius");
  }

  // ── Radius anchor (circle defined via "through" point) ────────────────────
  for (const poc of model.pointsOnCircles) {
    const isDiameterEndpoint = model.circlesByDiameter.some(
      (dc) => dc.a === poc.point || dc.b === poc.point
    );
    if (isDiameterEndpoint) continue;
    const definesRadius = model.circles.some(
      (c) => c.center === poc.center && c.through === poc.point
    );
    if (!definesRadius) continue;
    addEdge(poc.center, poc.point, "radius");
  }

  // ── Perpendicular-through-point construction ──────────────────────────────
  for (const c of model.perpendicularThroughPointIntersections)
    addEdge(c.through, c.intersection, "perpendicular-construction");

  // ── Tangent-intersection lines ────────────────────────────────────────────
  for (const c of model.tangentIntersections) {
    addEdge(c.at,          c.intersection, "tangent-intersection");
    addEdge(c.withLine.a,  c.intersection, "tangent-intersection");
    addEdge(c.withLine.b,  c.intersection, "tangent-intersection");
  }

  // ── Explicit declared lines (model.lines) ─────────────────────────────────
  // These are lines given an id (e.g. "BC", "d1") used as inputs to
  // lineIntersections or perpendicularLines.  The solver places their
  // intersection point; here we draw the underlying edge so it is visible.
  // extendSegmentsToContainCollinearPoints will automatically stretch each
  // edge to pass through every declared intersection point on that line.
  for (const l of model.lines) {
    const a = l.a ?? l.point1Id;
    const b = l.b ?? l.point2Id;
    if (a && b && pointSet.has(a) && pointSet.has(b)) {
      addEdge(a, b, "line");
    }
  }

  // ── Implicit lines from lineIntersections ("line:XY" format) ─────────────
  // When the compiler stores a line reference as "line:AD" (two capital letters),
  // the endpoints are implicit: A="point:A", D="point:D".  Draw the edge so
  // median/cevian lines are visible even without an explicit model.lines entry.
  for (const li of model.lineIntersections) {
    for (const key of [li.line1, li.line2]) {
      const name = key.startsWith("line:") ? key.slice(5) : key;
      if (!/^[A-Z]{2}$/.test(name)) continue;
      const a = `point:${name[0]}`;
      const b = `point:${name[1]}`;
      if (pointSet.has(a) && pointSet.has(b)) addEdge(a, b, "line-intersection");
    }
  }

  // ── Implicit tangent direction segments ───────────────────────────────────
  const beforeTangent = segments.length;
  applyTangentSegments(model, points, circles, segments, diagnostics);
  for (let i = beforeTangent; i < segments.length; i++) {
    const s = segments[i];
    const k = edgeKey(s.a, s.b);
    if (!constraintMap.has(k)) constraintMap.set(k, "tangent");
  }

  // ── Extend each segment to span all collinear declared points ────────────
  const extended = extendSegmentsToContainCollinearPoints(segments, model, points);
  segments.length = 0;
  segments.push(...extended);

  // ── Remove sub-segments that were merged into extended ones ───────────────
  const keep = new Set(segments.map((s) => `${s.a}|${s.b}`));

  for (const mp of model.midpoints) {
    const hasParent = segments.some(
      (s) => (s.a === mp.a && s.b === mp.b) || (s.a === mp.b && s.b === mp.a)
    );
    if (!hasParent) continue;
    keep.delete(`${mp.a}|${mp.point}`); keep.delete(`${mp.point}|${mp.a}`);
    keep.delete(`${mp.point}|${mp.b}`); keep.delete(`${mp.b}|${mp.point}`);
  }

  for (const rel of model.pointsOnSegments) {
    if (model.midpoints.some((mp) => mp.point === rel.point)) continue;
    const hasParent = segments.some(
      (s) => (s.a === rel.a && s.b === rel.b) || (s.a === rel.b && s.b === rel.a)
    );
    if (!hasParent) continue;
    keep.delete(`${rel.a}|${rel.point}`); keep.delete(`${rel.point}|${rel.a}`);
    keep.delete(`${rel.point}|${rel.b}`); keep.delete(`${rel.b}|${rel.point}`);
  }

  const solidSegments = segments.filter((s) => keep.has(`${s.a}|${s.b}`));
  const dashedSegments = buildAltitudeDashedSegments(model, points);

  // ── Circle constraint labels from model ───────────────────────────────────
  const circleConstraintByCenter = new Map<string, string>();
  for (const c of model.circles) circleConstraintByCenter.set(c.center, "circle");
  for (const dc of model.circlesByDiameter) {
    if (dc.centerId) circleConstraintByCenter.set(dc.centerId, "circle-by-diameter");
  }
  // Only label synthesized incircles that use the canonical center name "I" (user-declared).
  // Synthesized incircles with a custom center (e.g. K = incenter) are used only for
  // placement — the circle itself should not be drawn unless the problem mentions it.
  for (const ic of model.incircles) {
    const center = ic.center ?? "I";
    // Render only if the center is the default "I", or if the user explicitly declared
    // a circle at that center (e.g. model.circles has an entry for it).
    if (center === "point:I" || center === "I" || model.circles.some(c => c.center === center)) {
      circleConstraintByCenter.set(center, "incircle");
    }
  }
  if (model.circumcircles.length > 0) circleConstraintByCenter.set("O", "circumcircle");
  // v2 circle sources — must mirror the centerId derivation in applyDerivedCircles
  for (const cc of model.circleConstraints) {
    circleConstraintByCenter.set(cc.centerPointId, "circle");
  }
  for (const dc of model.diameterConstraints) {
    const centerId = diameterConstraintCenterId(dc.circleId);
    circleConstraintByCenter.set(centerId, "circle-by-diameter");
  }

  // ── Assemble typed SceneNode list ─────────────────────────────────────────
  const lineNodes: SceneNode[] = [
    ...solidSegments.map((s): LineNode => {
      const constraint = constraintMap.get(edgeKey(s.a, s.b));
      return { kind: "line", a: s.a, b: s.b, ...(constraint && { constraint }) };
    }),
    ...dashedSegments.map((s): LineNode => ({
      kind: "line", a: s.a, b: s.b, dashed: true, constraint: "altitude-dashed",
    })),
  ];

  // Build set of synthesized (non-drawable) incircle centers.
  // These are incircles created by the compiler to place an incenter point K,
  // but no circle is requested in the problem statement.
  const syntheticIncenterCenters = new Set<string>();
  for (const ic of model.incircles) {
    const center = ic.center ?? "I";
    const isDefault = center === "I" || center === "point:I";
    const isExplicit = model.circles.some(c => c.center === center);
    if (!isDefault && !isExplicit) syntheticIncenterCenters.add(center);
  }

  const circleNodes: SceneNode[] = circles
    .filter(c => !syntheticIncenterCenters.has(c.center))
    .map((c): CircleNode => {
      const constraint = circleConstraintByCenter.get(c.center);
      return {
        kind: "circle",
        center: c.center,
        radius: c.radius,
        ...(c.id !== undefined && { id: c.id }),
        ...(constraint && { constraint }),
      };
    });

  return [...lineNodes, ...circleNodes];
}
