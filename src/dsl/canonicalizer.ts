import type { GeometryModel } from '../model/types.js';

// ─── Display helpers ──────────────────────────────────────────────────────────

/**
 * Strip the type prefix from a namespaced ID so it can be shown as a label.
 *   "point:O"  → "O"
 *   "circle:O" → "O"
 *   "line:L1"  → "L1"
 *   "seg:L1"   → "L1"
 *   "len:R_O"  → "R_O"
 *   "O"        → "O"  (already raw, pass-through)
 */
export function displayLabel(id: string): string {
  const m = id.match(/^(?:point|circle|line|seg|ray|len):(.+)$/i);
  return m ? m[1] : id;
}

// ─── ID normalizers ───────────────────────────────────────────────────────────

/** Add "point:" prefix to a raw point ID; idempotent. */
function ptId(raw: string): string {
  if (!raw) return raw;
  if (raw.startsWith('point:')) return raw;
  return `point:${raw}`;
}

/** Add "circle:" prefix to a raw circle ID; idempotent. Returns undefined as-is. */
function circId(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  if (raw.startsWith('circle:')) return raw;
  return `circle:${raw}`;
}

/** Add "line:" prefix to a raw line ID; idempotent. Returns undefined as-is. */
function lineId(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  if (raw.startsWith('line:')) return raw;
  return `line:${raw}`;
}

function lr(a: string, b: string): { a: string; b: string } {
  return { a: ptId(a), b: ptId(b) };
}

// ─── Main normalize function ───────────────────────────────────────────────────

/**
 * Rewrite all IDs in a GeometryModel to use type prefixes:
 *   Points  → "point:X"
 *   Circles → "circle:X"
 *   Lines   → "line:X"
 *
 * This makes IDs globally unique across all object types — no more collision
 * between a point named "O" and a circle named "O".
 *
 * Must be called AFTER enrichModelForV2 (which is already called inside each
 * parser, so parsers return a fully normalised model).
 */
export function normalizeModelIds(model: GeometryModel): GeometryModel {
  return {
    rawText: model.rawText,

    points: model.points.map(ptId),

    segments: model.segments.map((s) => ({ ...s, a: ptId(s.a), b: ptId(s.b) })),

    circles: model.circles.map((c) => ({
      ...c,
      id:     circId(c.id),
      center: ptId(c.center),
      through: c.through ? ptId(c.through) : undefined,
    })),

    triangles: model.triangles.map((t) => ({
      ...t,
      vertices:    t.vertices.map(ptId) as [string, string, string],
      rightAt:     t.rightAt     ? ptId(t.rightAt)     : undefined,
      isoscelesAt: t.isoscelesAt ? ptId(t.isoscelesAt) : undefined,
    })),

    lines: model.lines.map((l) => ({
      ...l,
      id:               lineId(l.id)!,
      point1Id:         l.point1Id         ? ptId(l.point1Id)         : undefined,
      point2Id:         l.point2Id         ? ptId(l.point2Id)         : undefined,
      a:                l.a                ? ptId(l.a)                : undefined,
      b:                l.b                ? ptId(l.b)                : undefined,
      throughPointId:   l.throughPointId   ? ptId(l.throughPointId)   : undefined,
      through:          l.through          ? ptId(l.through)          : undefined,
      perpendicularToId: l.perpendicularToId ? lineId(l.perpendicularToId) : undefined,
      perpendicularTo:  l.perpendicularTo
        ? { a: ptId(l.perpendicularTo.a), b: ptId(l.perpendicularTo.b) }
        : undefined,
    })),

    midpoints: model.midpoints.map((m) => ({
      ...m, point: ptId(m.point), a: ptId(m.a), b: ptId(m.b),
    })),

    pointsOnSegments: model.pointsOnSegments.map((r) => ({
      ...r, point: ptId(r.point), a: ptId(r.a), b: ptId(r.b),
    })),

    parallels: model.parallels.map((r) => ({
      line1: lr(r.line1.a, r.line1.b),
      line2: lr(r.line2.a, r.line2.b),
    })),

    perpendiculars: model.perpendiculars.map((r) => ({
      line1: lr(r.line1.a, r.line1.b),
      line2: lr(r.line2.a, r.line2.b),
    })),

    equalLengths: model.equalLengths.map((r) => ({
      segment1: lr(r.segment1.a, r.segment1.b),
      segment2: lr(r.segment2.a, r.segment2.b),
    })),

    equalAngles: model.equalAngles.map((r) => ({
      angle1: r.angle1.map(ptId) as [string, string, string],
      angle2: r.angle2.map(ptId) as [string, string, string],
    })),

    ...(model.displayEqualAngles?.length && {
      displayEqualAngles: model.displayEqualAngles.map((r) => ({
        angle1: r.angle1.map(ptId) as [string, string, string],
        angle2: r.angle2.map(ptId) as [string, string, string],
      })),
    }),

    altitudes: model.altitudes.map((r) => ({
      ...r, from: ptId(r.from), foot: ptId(r.foot), baseA: ptId(r.baseA), baseB: ptId(r.baseB),
    })),

    medians: model.medians.map((r) => ({
      ...r, from: ptId(r.from), foot: ptId(r.foot), baseA: ptId(r.baseA), baseB: ptId(r.baseB),
    })),

    angleBisectors: model.angleBisectors.map((r) => ({
      ...r, from: ptId(r.from), foot: ptId(r.foot), sideA: ptId(r.sideA), sideB: ptId(r.sideB),
    })),

    tangents: model.tangents.map((t) => ({
      ...t,
      circleId:    circId(t.circleId) ?? t.circleId,
      pointId:     ptId(t.pointId),
      at:          t.at          ? ptId(t.at)           : undefined,
      circleCenter: t.circleCenter ? ptId(t.circleCenter) : undefined,
    })),

    incircles: model.incircles.map((r) => ({
      triangle: r.triangle ? (r.triangle.map(ptId) as [string, string, string]) : undefined,
      ...(r.center !== undefined && { center: ptId(r.center) }),
    })),

    circumcircles: model.circumcircles.map((r) => ({
      triangle: r.triangle ? (r.triangle.map(ptId) as [string, string, string]) : undefined,
    })),

    rectangles:    model.rectangles.map((r)    => ({ vertices: r.vertices.map(ptId)    as [string,string,string,string] })),
    squares:       model.squares.map((r)       => ({ vertices: r.vertices.map(ptId)    as [string,string,string,string] })),
    parallelograms: model.parallelograms.map((r) => ({ vertices: r.vertices.map(ptId) as [string,string,string,string] })),
    trapezoids:    model.trapezoids.map((r)    => ({ vertices: r.vertices.map(ptId)    as [string,string,string,string] })),
    centroids:     (model.centroids ?? []).map((r) => ({ point: ptId(r.point), a: ptId(r.a), b: ptId(r.b), c: ptId(r.c) })),

    circlesByDiameter: model.circlesByDiameter.map((r) => ({
      ...r,
      a:        ptId(r.a),
      b:        ptId(r.b),
      circleId: circId(r.circleId),
      centerId: r.centerId ? ptId(r.centerId) : undefined,
    })),

    pointsOnCircles: model.pointsOnCircles.map((r) => ({
      ...r,
      point:    ptId(r.point),
      circleId: circId(r.circleId),
      center:   ptId(r.center),
    })),

    circleConstraints: model.circleConstraints.map((r) => ({
      ...r,
      circleId:       circId(r.circleId) ?? r.circleId,
      centerPointId:  ptId(r.centerPointId),
      pointOnCircleId: ptId(r.pointOnCircleId),
    })),

    diameterConstraints: model.diameterConstraints.map((r) => ({
      ...r,
      circleId: circId(r.circleId) ?? r.circleId,
      point1Id: ptId(r.point1Id),
      point2Id: ptId(r.point2Id),
    })),

    namedTangents: model.namedTangents.map((r) => ({
      ...r,
      at:        ptId(r.at),
      circleId:  circId(r.circleId),
      center:    r.center ? ptId(r.center) : undefined,
      linePoint: ptId(r.linePoint),
    })),

    lineIntersections: model.lineIntersections.map((r) => ({
      ...r,
      line1: lineId(r.line1) ?? r.line1,
      line2: lineId(r.line2) ?? r.line2,
      point: ptId(r.point),
    })),

    perpendicularLines: model.perpendicularLines.map((r) => ({
      ...r,
      line1: lineId(r.line1) ?? r.line1,
      line2: lineId(r.line2) ?? r.line2,
    })),

    perpendicularThroughPointIntersections: model.perpendicularThroughPointIntersections.map((r) => ({
      ...r,
      through:      ptId(r.through),
      toLine:       { a: ptId(r.toLine.a),   b: ptId(r.toLine.b)   },
      withLine:     { a: ptId(r.withLine.a), b: ptId(r.withLine.b) },
      intersection: ptId(r.intersection),
    })),

    tangentIntersections: model.tangentIntersections.map((r) => ({
      ...r,
      at:           ptId(r.at),
      circleId:     circId(r.circleId),
      center:       r.center ? ptId(r.center) : undefined,
      withLine:     { a: ptId(r.withLine.a), b: ptId(r.withLine.b) },
      intersection: ptId(r.intersection),
    })),

    angleParameters: (model.angleParameters ?? []).map((ap) => ({
      ...ap,
      point:  ptId(ap.point),
      center: ptId(ap.center),
    })),
  };
}
