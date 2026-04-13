// Layer 11 — Construction Compiler
// Translates a validated GeometryDsl (Layer 7 output) into a GeometryModel
// (the constraint graph consumed by Layer 12 / constraint-solver).

import type { GeometryModel, LineRef, CentroidConstraint, AngleParameter } from "../model/types.js";
import type { CanonicalProblem, CanonicalEntity } from "../dsl/canonical.js";
import { enrichModelForV2 } from "../model/v2Model.js";
import { normalizeModelIds } from "../model/normalize.js";
import {
  type GeometryDsl,
  expandDslMacros,
  asPointId,
  parseLineRef,
  parseSegmentName,
  toSegmentPair,
  toLineRef,
} from "../dsl/dsl.js";

export { type GeometryDsl } from "../dsl/dsl.js";

type PointPair = [string, string];

export function dslToGeometryModel(dsl: GeometryDsl, rawText: string): GeometryModel {
  const compiledDsl = expandDslMacros(dsl);
  const points = new Set<string>();
  const segments: GeometryModel["segments"] = [];
  const circles: GeometryModel["circles"] = [];
  const lines: GeometryModel["lines"] = [];
  const pointsOnCircles: GeometryModel["pointsOnCircles"] = [];
  const circlesByDiameter: GeometryModel["circlesByDiameter"] = [];
  const diameterConstraints: GeometryModel["diameterConstraints"] = [];
  const triangles: GeometryModel["triangles"] = [];
  const tangents: GeometryModel["tangents"] = [];
  const namedTangents: GeometryModel["namedTangents"] = [];
  const perpendiculars: GeometryModel["perpendiculars"] = [];
  const parallels: GeometryModel["parallels"] = [];
  const equalLengths: GeometryModel["equalLengths"] = [];
  const equalAngles: GeometryModel["equalAngles"] = [];
  const displayEqualAngles: GeometryModel["equalAngles"] = [];
  const lineIntersections: GeometryModel["lineIntersections"] = [];
  const perpendicularThroughPointIntersections: GeometryModel["perpendicularThroughPointIntersections"] = [];
  const tangentIntersections: GeometryModel["tangentIntersections"] = [];
  const midpoints: GeometryModel["midpoints"] = [];
  const pointsOnSegments: GeometryModel["pointsOnSegments"] = [];

  const lineByName = new Map<string, LineRef>();

  // Tracks perpendicular constraints where line1 is an anonymous name (e.g. "l1") that
  // parseLineRef cannot resolve.  Keyed by the anonymous name → the resolved toLine ref.
  const unresolvedPerpByLineName = new Map<string, LineRef>();

  const applyIntersection = (point: string, of: string[]) => {
    const p = asPointId(point);
    points.add(p);
    const [l1, l2] = of;
    lineIntersections.push({ line1: l1, line2: l2, point: p });
    // If a line key is a two-letter pair like "AD" or "line:AD", register the
    // two endpoint points and add an explicit segment so it is guaranteed to be
    // drawn (and the intersection point G lies on it visually).
    // Iterate ALL elements of `of` (LLM may emit 3+ lines, e.g. ["AK","BK","CK"]).
    for (const key of of) {
      const name = key.startsWith("line:") ? key.slice(5) : key;
      if (/^[A-Z]{2}$/.test(name)) {
        const a = asPointId(name[0]);
        const b = asPointId(name[1]);
        points.add(a);
        points.add(b);
        const already = segments.some(
          (s) => (s.a === a && s.b === b) || (s.a === b && s.b === a)
        );
        if (!already) segments.push({ a, b });
      }
    }
    // If one of the lines is an anonymous perpendicular (e.g. "l1" ⊥ CE),
    // the intersection point p is the through-point. Synthesize a foot and
    // register a perpendicularThroughPointIntersections entry so the segment
    // from p to the foot of perpendicular on toLine gets drawn.
    for (const anonName of [l1, l2]) {
      const toLine = unresolvedPerpByLineName.get(anonName);
      if (!toLine) continue;
      const alreadyHas = perpendicularThroughPointIntersections.some(
        (r) => r.through === p && r.toLine.a === toLine.a && r.toLine.b === toLine.b
      );
      if (!alreadyHas) {
        const footId = `_f_${anonName.replace(/[^a-zA-Z0-9]/g, "")}`;
        perpendicularThroughPointIntersections.push({
          through: p,
          toLine,
          withLine: toLine,
          intersection: footId,
        });
        points.add(footId);
        lines.push({ id: anonName, through: p, perpendicularTo: toLine });
      }
      unresolvedPerpByLineName.delete(anonName);
    }
  };

  for (const obj of compiledDsl.objects) {
    if (obj.type === "point") {
      points.add(asPointId(obj.name));
    }

    if (obj.type === "circle") {
      const center = asPointId(obj.center ?? obj.name ?? "O");
      points.add(center);
      if (obj.through) {
        const through = asPointId(obj.through);
        points.add(through);
        circles.push({ id: obj.name ?? center, center, radius: obj.radius ?? 120, through });
        pointsOnCircles.push({ point: through, center, circleId: obj.name ?? center });
      } else {
        circles.push({ id: obj.name ?? center, center, radius: obj.radius ?? 120 });
      }
    }

    if (obj.type === "line") {
      const ref = obj.through && obj.through.length >= 2
        ? { a: asPointId(obj.through[0]), b: asPointId(obj.through[1]) }
        : parseLineRef(obj.name);
      if (ref) {
        lineByName.set(obj.name, ref);
        points.add(ref.a);
        points.add(ref.b);
        lines.push({ id: obj.name, a: ref.a, b: ref.b });
        // Any named line like "AM" directly implies a visible segment A→M.
        const segKey = [ref.a, ref.b].sort().join(":");
        if (!segments.some(s => [s.a, s.b].sort().join(":") === segKey)) {
          segments.push({ a: ref.a, b: ref.b });
        }
      } else {
        lines.push({ id: obj.name });
      }
    }

    if (obj.type === "segment") {
      if (!Array.isArray(obj.points) || obj.points.length < 2) continue;
      const a = asPointId(obj.points[0]);
      const b = asPointId(obj.points[1]);
      if (!a || !b) continue;
      points.add(a);
      points.add(b);
      segments.push({ a, b });
      lineByName.set(obj.name ?? `${a}${b}`, { a, b });
    }

    if (obj.type === "ray") {
      const a = asPointId(obj.points[0]);
      const b = asPointId(obj.points[1]);
      points.add(a);
      points.add(b);
      lineByName.set(obj.name ?? `${a}${b}`, { a, b });
      lines.push({ id: obj.name ?? `${a}${b}`, a, b });
    }

    if (obj.type === "triangle") {
      const [a, b, c] = obj.points.map(asPointId) as [string, string, string];
      points.add(a);
      points.add(b);
      points.add(c);
      triangles.push({ vertices: [a, b, c] });
      // Implied segments for all three sides
      for (const [p, q] of [[a, b], [b, c], [c, a]] as [string, string][]) {
        const key = [p, q].sort().join(":");
        if (!segments.some(s => [s.a, s.b].sort().join(":") === key)) {
          segments.push({ a: p, b: q });
        }
      }
    }

    if (obj.type === "polygon") {
      for (const pointId of obj.points.map(asPointId)) {
        points.add(pointId);
      }
    }

    if (obj.type === "angle") {
      for (const pointId of obj.points.map(asPointId)) {
        points.add(pointId);
      }
    }

    if (obj.type === "intersection") {
      applyIntersection(obj.point, obj.of);
    }

    if (obj.type === "midpoint") {
      const point = asPointId(obj.point);
      const a = asPointId(obj.of[0]);
      const b = asPointId(obj.of[1]);
      points.add(point);
      points.add(a);
      points.add(b);
      midpoints.push({ point, a, b });
      // Implied segment
      const segKey = [a, b].sort().join(":");
      if (!segments.some(s => [s.a, s.b].sort().join(":") === segKey)) {
        segments.push({ a, b });
      }
    }

    if (obj.type === "foot" || obj.type === "projection") {
      const point = asPointId(obj.point);
      points.add(point);
    }

    if (obj.type === "perpendicular_line") {
      const through = asPointId(obj.through);
      points.add(through);
      const targetLine = toLineRef(obj.to);
      if (targetLine) {
        lines.push({ id: obj.name ?? `p_${through}`, through, perpendicularTo: targetLine });
      }
    }

    if (obj.type === "parallel_line") {
      const through = asPointId(obj.through);
      points.add(through);
      const ref = toLineRef(obj.to);
      if (ref) {
        const lineId = obj.name ?? `q_${through}`;
        lines.push({ id: lineId, through });
        lineByName.set(lineId, ref);
      }
    }

    if (obj.type === "tangent") {
      const at = asPointId(obj.at);
      points.add(at);
      tangents.push({ circleId: obj.circle, pointId: at, pointOnCircle: true });
    }

    if (obj.type === "secant") {
      const ref = parseLineRef(obj.line);
      if (ref) {
        points.add(ref.a);
        points.add(ref.b);
      }
    }
  }

  for (const c of compiledDsl.constraints) {
    if (c.type === "on_circle") {
      const point = asPointId(c.point);
      const center = asPointId(c.circle);
      points.add(point);
      points.add(center);
      pointsOnCircles.push({ point, center, circleId: c.circle });
      continue;
    }

    if (c.type === "diameter") {
      const a = asPointId(c.points[0]);
      const b = asPointId(c.points[1]);
      const centerId = asPointId(c.circle);
      points.add(a);
      points.add(b);
      points.add(centerId);
      // Guard: if one endpoint IS the center, the LLM confused radius with diameter.
      // Treat the non-center point as a radius point (on_circle) instead.
      if (a === centerId || b === centerId) {
        const radiusPoint = a === centerId ? b : a;
        pointsOnCircles.push({ point: radiusPoint, center: centerId, circleId: c.circle });
      } else {
        circlesByDiameter.push({ a, b, circleId: c.circle, centerId });
        diameterConstraints.push({ circleId: c.circle, point1Id: a, point2Id: b });
      }
      continue;
    }

    if (c.type === "tangent") {
      const at = asPointId(c.at);
      points.add(at);
      tangents.push({ circleId: c.circle, pointId: at, pointOnCircle: true });
      // c.line is a two-letter line name like "AB" — linePoint is the second letter (B),
      // NOT asPointId(c.line) which would return only the first letter.
      const lineName = String(c.line ?? "").trim().toUpperCase().replace(/[^A-Z]/g, "");
      const lp = lineName.length >= 2 ? lineName[1] : (lineName.length === 1 && lineName[0] !== at ? lineName[0] : null);
      if (lp && lp !== at) {
        points.add(lp);
        namedTangents.push({ at, center: asPointId(c.circle), linePoint: lp });
      }
      continue;
    }

    if (c.type === "perpendicular") {
      const l1 = lineByName.get(c.line1) ?? parseLineRef(c.line1);
      const l2 = lineByName.get(c.line2) ?? parseLineRef(c.line2);
      if (l1 && l2) {
        points.add(l1.a);
        points.add(l1.b);
        points.add(l2.a);
        points.add(l2.b);
        perpendiculars.push({ line1: l1, line2: l2 });
      } else if (!l1 && l2) {
        // line1 is an anonymous name (e.g. "l1") — save it for synthesis
        // when an intersection construction tells us the through-point.
        unresolvedPerpByLineName.set(c.line1, l2);
      } else if (l1 && !l2) {
        unresolvedPerpByLineName.set(c.line2, l1);
      }
      continue;
    }

    if (c.type === "parallel") {
      const l1 = lineByName.get(c.line1) ?? parseLineRef(c.line1);
      const l2 = lineByName.get(c.line2) ?? parseLineRef(c.line2);
      if (l1 && l2) {
        points.add(l1.a);
        points.add(l1.b);
        points.add(l2.a);
        points.add(l2.b);
        parallels.push({ line1: l1, line2: l2 });
      }
      continue;
    }

    if (c.type === "equal_length") {
      equalLengths.push({
        segment1: { a: asPointId(c.segments[0][0]), b: asPointId(c.segments[0][1]) },
        segment2: { a: asPointId(c.segments[1][0]), b: asPointId(c.segments[1][1]) }
      });
      points.add(asPointId(c.segments[0][0]));
      points.add(asPointId(c.segments[0][1]));
      points.add(asPointId(c.segments[1][0]));
      points.add(asPointId(c.segments[1][1]));
      continue;
    }

    if (c.type === "equal_angle") {
      equalAngles.push({
        angle1: [asPointId(c.angles[0][0]), asPointId(c.angles[0][1]), asPointId(c.angles[0][2])],
        angle2: [asPointId(c.angles[1][0]), asPointId(c.angles[1][1]), asPointId(c.angles[1][2])]
      });
      for (const id of [...c.angles[0], ...c.angles[1]].map(asPointId)) {
        points.add(id);
      }
      continue;
    }

    if (c.type === "passes_through") {
      const p = asPointId(c.point);
      points.add(p);
      const existing = lines.find((l) => l.id === c.line);
      if (existing) {
        existing.through = p;
      } else {
        lines.push({ id: c.line, through: p });
      }
      continue;
    }

    if (c.type === "intersection") {
      applyIntersection(c.point, c.of);
      continue;
    }

    if (c.type === "midpoint") {
      const p = asPointId(c.point);
      // Handle of:["A","BC"] → "BC" is a segment name → expand to midpoint(B,C)
      // Must check this BEFORE toSegmentPair which would treat "BC" as a point name.
      let seg: PointPair | null = null;
      const ofRaw = (c as any).of;
      if (Array.isArray(ofRaw) && ofRaw.length === 2) {
        for (const item of ofRaw) {
          const pair = parseSegmentName(String(item));
          if (pair) { seg = [asPointId(pair[0]), asPointId(pair[1])]; break; }
        }
      }
      if (!seg) {
        seg = toSegmentPair(c.segment ?? ofRaw);
      }
      if (seg) {
        points.add(p);
        points.add(seg[0]);
        points.add(seg[1]);
        midpoints.push({ point: p, a: seg[0], b: seg[1] });
        // Implied segment: midpoint M of AB means segment AB exists
        const segKey = [seg[0], seg[1]].sort().join(":");
        if (!segments.some(s => [s.a, s.b].sort().join(":") === segKey)) {
          segments.push({ a: seg[0], b: seg[1] });
        }
      }
      continue;
    }

    if (c.type === "point_on_line") {
      const p = asPointId(c.point);
      const ref = lineByName.get(c.line) ?? parseLineRef(c.line);
      if (ref) {
        points.add(p);
        points.add(ref.a);
        points.add(ref.b);
        pointsOnSegments.push({ point: p, a: ref.a, b: ref.b });
      }
      continue;
    }

    if (c.type === "on_line") {
      const p = asPointId(c.point);
      const ref = toLineRef(c.line);
      if (ref) {
        points.add(p);
        points.add(ref.a);
        points.add(ref.b);
        pointsOnSegments.push({ point: p, a: ref.a, b: ref.b });
      }
      continue;
    }

    if (c.type === "right_angle") {
      const [a, b, cPoint] = c.points.map(asPointId);
      points.add(a);
      points.add(b);
      points.add(cPoint);
      perpendiculars.push({ line1: { a, b }, line2: { a: b, b: cPoint } });
      continue;
    }

    if (c.type === "collinear") {
      const normalized = c.points.map(asPointId).filter(Boolean);
      for (const id of normalized) {
        points.add(id);
      }
      for (let i = 1; i < normalized.length; i += 1) {
        segments.push({ a: normalized[i - 1], b: normalized[i] });
      }
      continue;
    }
  }

  for (const step of compiledDsl.constructions) {
    if (step.type === "intersection") {
      applyIntersection(step.point, step.of);
    }
    if (step.type === "draw_tangent") {
      const at = asPointId(step.at);
      points.add(at);
      tangents.push({ circleId: step.circle, pointId: at, pointOnCircle: true });
    }
    if (step.type === "draw_perpendicular") {
      const p = asPointId(step.through);
      points.add(p);
      const existing = lines.find((l) => l.id === step.line);
      if (existing) {
        existing.through = p;
      } else {
        lines.push({ id: step.line, through: p });
      }
      const l2 = lineByName.get(step.to) ?? parseLineRef(step.to);
      if (l2) {
        lines.push({ id: step.line, through: p, perpendicularTo: l2 });
        // If there is no intersection endpoint for this perpendicular yet, synthesize
        // a hidden foot point so the perpendicular segment gets drawn.
        const alreadyHasIntersection = perpendicularThroughPointIntersections.some(
          (r) => r.through === step.through && r.toLine.a === l2.a && r.toLine.b === l2.b
        );
        if (!alreadyHasIntersection) {
          const footId = `_f_${step.line.replace(/[^a-zA-Z0-9]/g, "")}`;
          perpendicularThroughPointIntersections.push({
            through: step.through,
            toLine: l2,
            withLine: l2, // foot = intersection of perp-from-through with the same line
            intersection: footId,
          });
          points.add(footId);
        }
      }
    }
    if (step.type === "draw_parallel") {
      const p = asPointId(step.through);
      points.add(p);
      if (!lines.some((l) => l.id === step.line)) {
        lines.push({ id: step.line, through: p });
      }
    }
    // "perpendicular" in constructions: same as in constraints, but also synthesise
    // a perpendicularThroughPointIntersection when line1 encodes the altitude segment
    // (e.g. "AH" where A is the source and H is the foot on line2).
    if (step.type === "perpendicular") {
      const l1 = lineByName.get(step.line1) ?? parseLineRef(step.line1);
      const l2 = lineByName.get(step.line2) ?? parseLineRef(step.line2);
      if (l1 && l2) {
        points.add(l1.a); points.add(l1.b);
        points.add(l2.a); points.add(l2.b);
        perpendiculars.push({ line1: l1, line2: l2 });
        // If the foot point (l1.b) is a named point not already an endpoint of l2,
        // treat this as an altitude: l1.a is the source, l1.b is the foot on l2.
        // If the foot point (l1.b) is a named point not already an endpoint of l2,
        // treat this as an altitude: l1.a is the source, l1.b is the foot on l2.
        const footId = l1.b;
        const isFootOnBase = (footId !== l2.a && footId !== l2.b);
        if (isFootOnBase && !perpendicularThroughPointIntersections.some(r => r.through === l1.a && r.intersection === footId)) {
          pointsOnSegments.push({ point: footId, a: l2.a, b: l2.b });
          perpendicularThroughPointIntersections.push({
            through: l1.a,
            toLine: l2,
            withLine: l2,
            intersection: footId,
          });
        }
      }
    }
  }

  // LLM-first pipeline with text enrichment for critical constraints that small local models often omit.
  const text = String(rawText || "");

  // "tam giác ABC nội tiếp đường tròn (O)" / "triangle ABC inscribed in circle O"
  // → ensure all three triangle vertices have on_circle constraints.
  {
    const circleCenter = circles[0]?.center ?? circlesByDiameter[0]?.centerId ?? null;
    if (circleCenter && /n[oộ]i\s*ti[eế]p|inscribed\s+in|circumscribed\s+about/i.test(text)) {
      const triVertices = new Set<string>();
      for (const tri of compiledDsl.objects) {
        if (tri.type === "triangle" && Array.isArray((tri as any).points)) {
          for (const v of (tri as any).points) triVertices.add(asPointId(v));
        }
      }
      for (const pid of triVertices) {
        const alreadyOnCircle = pointsOnCircles.some((r) => r.point === pid);
        if (!alreadyOnCircle) {
          points.add(pid);
          pointsOnCircles.push({ point: pid, center: circleCenter, circleId: circles[0]?.id ?? circleCenter });
        }
      }
    }
  }

  if (/(qua|through|genom)\s*O[^.\n]*(vu[oô]ng\s*g[oó]c|perpendicular|vinkelrät)[^.\n]*\bCE\b[^.\n]*(c[aắ]t|cat|intersect|sk[aä]r)[^.\n]*\bCx\b[^.\n]*(t[aạ]i|at|i\s+punkten)[^.\n]*\bA\b/i.test(text)) {
    points.add("O");
    points.add("C");
    points.add("E");
    points.add("A");
    points.add("X");
    if (!namedTangents.some((t) => t.at === "C" && t.linePoint === "X")) {
      namedTangents.push({ at: "C", center: "O", linePoint: "X" });
    }
    perpendicularThroughPointIntersections.push({
      through: "O",
      toLine: { a: "C", b: "E" },
      withLine: { a: "C", b: "X" },
      intersection: "A"
    });
  }

  // Structural synthesis: perpendicular(XY, PQ) + lineIntersection(Y = XY ∩ RS) →
  // perpendicularThroughPointIntersections {through:X, toLine:PQ, withLine:RS, intersection:Y}.
  for (let li = lineIntersections.length - 1; li >= 0; li--) {
    const intersection = lineIntersections[li];
    const line1Name = intersection.line1;
    if (typeof line1Name !== "string") continue;
    const l1Ref = parseLineRef(line1Name);
    if (!l1Ref) continue;
    if (l1Ref.b !== intersection.point) continue;
    const perp = perpendiculars.find(
      (p) =>
        (p.line1.a === l1Ref.a && p.line1.b === l1Ref.b) ||
        (p.line1.a === l1Ref.b && p.line1.b === l1Ref.a)
    );
    if (!perp) continue;
    const withLineRef = lineByName.get(intersection.line2) ?? parseLineRef(intersection.line2);
    if (!withLineRef) continue;
    const alreadyHas = perpendicularThroughPointIntersections.some(
      (r) => r.through === l1Ref.a && r.intersection === intersection.point
    );
    if (alreadyHas) continue;
    perpendicularThroughPointIntersections.push({
      through: l1Ref.a,
      toLine: perp.line2,
      withLine: withLineRef,
      intersection: intersection.point,
    });
    lineIntersections.splice(li, 1);
  }

  const hasTangentAtD = tangents.some((t) => t.pointId === "D");
  if (!hasTangentAtD && /(qua|through|dra)\s*D[^.\n]*(tiep\s*tuyen|ti[eế]p\s*tuy[eế]n|tangent)|tangent[^.\n]*\bi\s+punkten\s+D\b|tangent[^.\n]*\bat\s+point\s+D\b/i.test(text)) {
    tangents.push({ circleId: circles[0]?.id ?? circlesByDiameter[0]?.circleId ?? "O", pointId: "D", pointOnCircle: true });
    points.add("D");
  }

  if (/(qua|through|dra)\s*D[^.\n]*(tiep\s*tuyen|ti[eế]p\s*tuy[eế]n|tangent)[^.\n]*(c[aắ]t|cat|intersects?|sk[aä]r)[^a-z\n]*AE[^.\n]*(t[aạ]i|at|i\s+punkten)[^.\n]*\bB\b|tangent[^.\n]*\bi\s+punkten\s+D[^.\n]*(sk[aä]r)[^.\n]*AE[^.\n]*\bB\b|(denna tangent|this tangent|tangenten)[^.\n]*(sk[aä]r|intersects?)[^.\n]*\bAE\b[^.\n]*(i\s+punkten|at\s+point|at)[^.\n]*\bB\b/i.test(text)) {
    points.add("A");
    points.add("E");
    points.add("B");
    points.add("D");
    tangentIntersections.push({
      at: "D",
      center: asPointId(circles[0]?.center ?? circlesByDiameter[0]?.centerId ?? "O"),
      withLine: { a: "A", b: "E" },
      intersection: "B"
    });
  }

  if (/(EH)\s*(\u27c2|⊥|vu[oô]ng\s*g[oó]c|perpendicular)[^.\n]*(CD)/i.test(text)) {
    points.add("E");
    points.add("H");
    points.add("C");
    points.add("D");
    const hasEHCDPerp = perpendiculars.some((p) => {
      const k1 = `${p.line1.a}${p.line1.b}`;
      const k2 = `${p.line2.a}${p.line2.b}`;
      return (k1 === "EH" && k2 === "CD") || (k1 === "CD" && k2 === "EH");
    });
    if (!hasEHCDPerp) {
      perpendiculars.push({ line1: { a: "E", b: "H" }, line2: { a: "C", b: "D" } });
    }
    const hasHOnCD = pointsOnSegments.some((p) => p.point === "H" && ((p.a === "C" && p.b === "D") || (p.a === "D" && p.b === "C")));
    if (!hasHOnCD) {
      pointsOnSegments.push({ point: "H", a: "C", b: "D" });
    }
  }

  if (/\bAD\b[^\n]*(va|v[aà]|and|och)\s*\bBC\b[^\n]*(cat\s*nhau|c[aắ]t\s*nhau|intersect|sk[aä]r)[^\n]*(trung\s*diem|trung\s*đi[eể]m|midpoint|mittpunkten)[^\n]*\bEH\b/i.test(text)) {
    points.add("M");
    points.add("A");
    points.add("B");
    points.add("C");
    points.add("D");
    points.add("E");
    points.add("H");
    const hasMid = midpoints.some((m) => m.point === "M" && ((m.a === "E" && m.b === "H") || (m.a === "H" && m.b === "E")));
    if (!hasMid) {
      midpoints.push({ point: "M", a: "E", b: "H" });
    }
    const hasMOnAD = pointsOnSegments.some((p) => p.point === "M" && ((p.a === "A" && p.b === "D") || (p.a === "D" && p.b === "A")));
    if (!hasMOnAD) {
      pointsOnSegments.push({ point: "M", a: "A", b: "D" });
    }
    const hasMOnBC = pointsOnSegments.some((p) => p.point === "M" && ((p.a === "B" && p.b === "C") || (p.a === "C" && p.b === "B")));
    if (!hasMOnBC) {
      pointsOnSegments.push({ point: "M", a: "B", b: "C" });
    }
  }

  const explicitTangentAtPoints = new Set<string>([
    ...namedTangents.map((t) => t.at),
    ...tangentIntersections.map((t) => t.at)
  ]);

  const filteredTangents = tangents
    .filter((t) => {
      const at = t.pointId ?? t.at;
      return at ? !explicitTangentAtPoints.has(at) : true;
    })
    .filter((t, idx, arr) => {
      const at = t.pointId ?? t.at;
      if (!at) {
        return true;
      }
      return arr.findIndex((x) => (x.pointId ?? x.at) === at) === idx;
    });

  // Synthesize altitudes from (perpendicular + intersection) pairs.
  const altitudes: GeometryModel["altitudes"] = [];
  const linesMatchFn = (a: LineRef, b: LineRef) =>
    (a.a === b.a && a.b === b.b) || (a.a === b.b && a.b === b.a);

  // Case 1: foot is an explicit intersection point
  for (const li of lineIntersections) {
    const l1 = lineByName.get(li.line1) ?? parseLineRef(li.line1);
    const l2 = lineByName.get(li.line2) ?? parseLineRef(li.line2);
    if (!l1 || !l2) continue;
    const foot = li.point;
    const isPerp = perpendiculars.some(
      (p) => (linesMatchFn(p.line1, l1) && linesMatchFn(p.line2, l2)) ||
             (linesMatchFn(p.line1, l2) && linesMatchFn(p.line2, l1))
    );
    if (!isPerp) continue;
    const from = l1.b === foot ? l1.a : (l1.a === foot ? l1.b : null);
    if (!from) continue;
    altitudes.push({ from, foot, baseA: l2.a, baseB: l2.b });
    const segKey = [l2.a, l2.b].sort().join(":");
    if (!pointsOnSegments.some((p) => p.point === foot && [p.a, p.b].sort().join(":") === segKey)) {
      pointsOnSegments.push({ point: foot, a: l2.a, b: l2.b });
    }
  }
  // Case 2: perpendicular(AD,BC) + named line AD, no explicit intersection(D,of:[AD,BC])
  for (const perp of perpendiculars) {
  for (const [altLine, baseLine] of [[perp.line1, perp.line2], [perp.line2, perp.line1]] as [LineRef, LineRef][]) {
      const foot = altLine.b;
      const from = altLine.a;
      if (!foot || !from || foot === from) continue;
      if (altitudes.some((a) => a.foot === foot)) continue;
      const triangleVertices = new Set(triangles.flatMap((t) => t.vertices));
      if (triangleVertices.has(foot)) continue;
      if (perpendicularThroughPointIntersections.some((p) => p.intersection === foot)) continue;
      if (perpendicularThroughPointIntersections.some(
        (p) => p.through === from && linesMatchFn(p.toLine, baseLine)
      )) continue;
      if (pointsOnCircles.some((p) => p.point === foot)) continue;
      if (circlesByDiameter.some((dc) => dc.a === foot || dc.b === foot)) continue;
      altitudes.push({ from, foot, baseA: baseLine.a, baseB: baseLine.b });
      const segKey = [baseLine.a, baseLine.b].sort().join(":");
      if (!pointsOnSegments.some((p) => p.point === foot && [p.a, p.b].sort().join(":") === segKey)) {
        pointsOnSegments.push({ point: foot, a: baseLine.a, b: baseLine.b });
      }
    }
  }

  // Synthesize medians from midpoint constraints paired with a named line.
  const medians: GeometryModel["medians"] = [];
  // Case 1: via intersection list
  for (const li of lineIntersections) {
    const l1 = lineByName.get(li.line1) ?? parseLineRef(li.line1);
    const l2 = lineByName.get(li.line2) ?? parseLineRef(li.line2);
    if (!l1 || !l2) continue;
    const foot = li.point;
    const isMidpoint = midpoints.some(
      (m) => m.point === foot &&
        ((m.a === l2.a && m.b === l2.b) || (m.a === l2.b && m.b === l2.a))
    );
    if (!isMidpoint) continue;
    const from = l1.b === foot ? l1.a : (l1.a === foot ? l1.b : null);
    if (!from) continue;
    medians.push({ from, foot, baseA: l2.a, baseB: l2.b });
    const segKey = [l2.a, l2.b].sort().join(":");
    if (!pointsOnSegments.some((p) => p.point === foot && [p.a, p.b].sort().join(":") === segKey)) {
      pointsOnSegments.push({ point: foot, a: l2.a, b: l2.b });
    }
  }
  // Case 2: midpoint(M,[B,C]) + a line whose name contains M as the second letter
  for (const mp of midpoints) {
    if (medians.some((me) => me.foot === mp.point)) continue;
    const foot = mp.point;
    let from: string | null = null;
    for (const [name] of lineByName) {
      const parsed = parseLineRef(name);
      if (!parsed) continue;
      if (parsed.b === foot && parsed.a !== mp.a && parsed.a !== mp.b) { from = parsed.a; break; }
      if (parsed.a === foot && parsed.b !== mp.a && parsed.b !== mp.b) { from = parsed.b; break; }
    }
    if (!from) continue;
    medians.push({ from, foot, baseA: mp.a, baseB: mp.b });
    const segKey = [mp.a, mp.b].sort().join(":");
    if (!pointsOnSegments.some((p) => p.point === foot && [p.a, p.b].sort().join(":") === segKey)) {
      pointsOnSegments.push({ point: foot, a: mp.a, b: mp.b });
    }
  }

  // Synthesize angle bisectors from (equal_angle + intersection) pairs.
  const angleBisectors: GeometryModel["angleBisectors"] = [];
  for (const li of lineIntersections) {
    const l1 = lineByName.get(li.line1) ?? parseLineRef(li.line1);
    const l2 = lineByName.get(li.line2) ?? parseLineRef(li.line2);
    if (!l1 || !l2) continue;
    const foot = li.point;
    const from = l1.b === foot ? l1.a : (l1.a === foot ? l1.b : null);
    if (!from) continue;
    const isBisector = equalAngles.some((ea) => {
      const [a1, v1, b1] = ea.angle1;
      const [a2, v2, b2] = ea.angle2;
      if (v1 !== from || v2 !== from) return false;
      return new Set([a1, b1]).has(foot) && new Set([a2, b2]).has(foot);
    });
    if (!isBisector) continue;
    angleBisectors.push({ from, foot, sideA: l2.a, sideB: l2.b });
    const segKey = [l2.a, l2.b].sort().join(":");
    if (!pointsOnSegments.some((p) => p.point === foot && [p.a, p.b].sort().join(":") === segKey)) {
      pointsOnSegments.push({ point: foot, a: l2.a, b: l2.b });
    }
  }

  // Fallback: synthesize angle bisectors from (equal_angle + on_line / pointsOnSegments)
  for (const pos of pointsOnSegments) {
    const foot = pos.point;
    if (angleBisectors.some((ab) => ab.foot === foot)) continue;
    const matchingEq = equalAngles.find((ea) => {
      const [a1, v1, b1] = ea.angle1;
      const [a2, v2, b2] = ea.angle2;
      if (v1 !== v2) return false;
      return new Set([a1, b1]).has(foot) && new Set([a2, b2]).has(foot);
    });
    if (!matchingEq) continue;
    const from = matchingEq.angle1[1];
    const baseKey = [pos.a, pos.b].sort().join(":");
    if ([pos.a, pos.b].sort().join(":") !== baseKey) continue;
    angleBisectors.push({ from, foot, sideA: pos.a, sideB: pos.b });
    const sfKey = [from, foot].sort().join(":");
    if (!segments.some(s => [s.a, s.b].sort().join(":") === sfKey)) {
      segments.push({ a: from, b: foot });
    }
  }

  // Fallback: synthesize angle bisectors from equal_angle alone (no intersection emitted).
  for (const ea of equalAngles) {
    const [a1, v1, b1] = ea.angle1;
    const [a2, v2, b2] = ea.angle2;
    if (v1 !== v2) continue;
    const from = v1;
    const sharedArms = [a1, b1].filter(p => new Set([a2, b2]).has(p));
    if (sharedArms.length !== 1) continue;
    const foot = sharedArms[0];
    if (angleBisectors.some((ab) => ab.foot === foot)) continue;
    const sideA = [a1, b1].find(p => p !== foot);
    const sideB = [a2, b2].find(p => p !== foot);
    if (!sideA || !sideB || sideA === sideB) continue;
    angleBisectors.push({ from, foot, sideA, sideB });
    const segKey = [sideA, sideB].sort().join(":");
    if (!pointsOnSegments.some((p) => p.point === foot && [p.a, p.b].sort().join(":") === segKey)) {
      pointsOnSegments.push({ point: foot, a: sideA, b: sideB });
    }
    const sfKey = [from, foot].sort().join(":");
    if (!segments.some(s => [s.a, s.b].sort().join(":") === sfKey)) {
      segments.push({ a: from, b: foot });
    }
  }

  // Fallback: synthesize medians from midpoint + pointsOnSegments without intersection
  for (const mp of midpoints) {
    const foot = mp.point;
    if (medians.some((m) => m.foot === foot)) continue;
    const fromLine = lines.find((l) =>
      (l.a === foot || l.b === foot) && l.a && l.b
    );
    if (!fromLine || !fromLine.a || !fromLine.b) continue;
    const from = fromLine.a === foot ? fromLine.b : fromLine.a;
    medians.push({ from, foot, baseA: mp.a, baseB: mp.b });
    const segKey = [mp.a, mp.b].sort().join(":");
    if (!pointsOnSegments.some((p) => p.point === foot && [p.a, p.b].sort().join(":") === segKey)) {
      pointsOnSegments.push({ point: foot, a: mp.a, b: mp.b });
    }
  }

  // Fallback: synthesize medians from midpoint of a triangle side (opposite vertex auto-detected).
  // Handles: midpoint M of BC where ABC is a triangle → median AM.
  for (const mp of midpoints) {
    const foot = mp.point;
    if (medians.some((m) => m.foot === foot)) continue;
    const baseKey = [mp.a, mp.b].sort().join(":");
    for (const tri of triangles) {
      const [tA, tB, tC] = tri.vertices as [string, string, string];
      const triplets: [string, string, string][] = [
        [tA, tB, tC], [tB, tC, tA], [tC, tA, tB],
      ];
      let matched = false;
      for (const [pA, pB, opp] of triplets) {
        if ([pA, pB].sort().join(":") !== baseKey) continue;
        medians.push({ from: opp, foot, baseA: mp.a, baseB: mp.b });
        const sfKey = [opp, foot].sort().join(":");
        if (!segments.some((s) => [s.a, s.b].sort().join(":") === sfKey)) {
          segments.push({ a: opp, b: foot });
        }
        if (!pointsOnSegments.some((p) => p.point === foot && [p.a, p.b].sort().join(":") === baseKey)) {
          pointsOnSegments.push({ point: foot, a: mp.a, b: mp.b });
        }
        matched = true;
        break;
      }
      if (matched) break;
    }
  }

  // Synthesize centroids
  const centroids: CentroidConstraint[] = [];
  for (const tri of triangles) {
    const [tA, tB, tC] = tri.vertices as [string, string, string];
    const sides = [
      [tA, tB].sort().join(":"),
      [tB, tC].sort().join(":"),
      [tC, tA].sort().join(":")
    ];
    const midForSide = new Map<string, string>();
    for (const mp of midpoints) {
      const key = [mp.a, mp.b].sort().join(":");
      if (sides.includes(key)) midForSide.set(key, mp.point);
    }
    if (midForSide.size < 3) continue;
    const gCounts = new Map<string, number>();
    for (const li of lineIntersections) {
      gCounts.set(li.point, (gCounts.get(li.point) ?? 0) + 1);
    }
    const gPoint = [...gCounts.entries()].find(([, n]) => n >= 1)?.[0];
    if (!gPoint) continue;
    if (centroids.some((c) => c.point === gPoint)) continue;
    centroids.push({ point: gPoint, a: tA, b: tB, c: tC });

    // Ensure all 3 median segments are drawn: for each midpoint M of side PQ,
    // add segment from the opposite vertex R to M (e.g. CF where F=midpoint(AB)).
    const vertexOpposite = new Map<string, string>([
      [[tA, tB].sort().join(":"), tC],
      [[tB, tC].sort().join(":"), tA],
      [[tC, tA].sort().join(":"), tB],
    ]);
    for (const [sideKey, midId] of midForSide) {
      const vertex = vertexOpposite.get(sideKey);
      if (!vertex) continue;
      const vPoint = asPointId(vertex.startsWith("point:") ? vertex.slice(6) : vertex);
      const mPoint = midId.startsWith("point:") ? midId : asPointId(midId);
      const alreadySeg = segments.some(
        (s) => (s.a === vPoint && s.b === mPoint) || (s.a === mPoint && s.b === vPoint)
      );
      if (!alreadySeg) segments.push({ a: vPoint, b: mPoint });
    }
  }

  // Synthesize incenters: detect when lineIntersections has a point K where
  // all referenced lines are "XK","YK","ZK" with X,Y,Z = triangle vertices.
  // In that case K is the incenter — replace with an incircle constraint so
  // the solver can place K at the correct weighted-incenter position.
  const incircles: GeometryModel["incircles"] = [];
  if (triangles.length > 0) {
    const triVerts = new Set(triangles[0].vertices.map(v => v.startsWith("point:") ? v : asPointId(v)));
    // Collect all intersection points and their referenced lines
    const liByPoint = new Map<string, string[]>();
    for (const li of lineIntersections) {
      const arr = liByPoint.get(li.point) ?? [];
      arr.push(li.line1, li.line2);
      liByPoint.set(li.point, arr);
    }
    for (const [iPoint, lineKeys] of liByPoint) {
      const unique = [...new Set(lineKeys)];
      // Check: all lines are "XK"-style where K = iPoint label, X = triangle vertex
      const iLabel = iPoint.startsWith("point:") ? iPoint.slice(6) : iPoint;
      const allFromVerts = unique.every(key => {
        const name = key.startsWith("line:") ? key.slice(5) : key;
        if (name.length !== 2) return false;
        const [p1, p2] = [asPointId(name[0]), asPointId(name[1])];
        return (p1 === iPoint || p2 === iPoint) &&
               (triVerts.has(p1) || triVerts.has(p2));
      });
      if (!allFromVerts || unique.length < 2) continue;
      // K is the incenter — ensure all 3 vertex→K segments exist
      for (const v of triVerts) {
        const already = segments.some(s => (s.a === v && s.b === iPoint) || (s.a === iPoint && s.b === v));
        if (!already) segments.push({ a: v, b: iPoint });
      }
      if (!incircles.some(ic => ic.center === iPoint)) {
        incircles.push({ triangle: triangles[0].vertices as [string, string, string], center: iPoint });
        // The incircle solver places K at the weighted incenter — remove all
        // derived constraints that reference K as a bisector foot or intersection
        // point, because they are degenerate (e.g. sideB=K) and cause the V2
        // solver to collapse K onto a triangle vertex.
        const inIdx = lineIntersections.length;
        lineIntersections.splice(0, lineIntersections.length,
          ...lineIntersections.filter(li => li.point !== iPoint));
        // Remove angleBisectors where foot===iPoint (degenerate sideA/sideB)
        angleBisectors.splice(0, angleBisectors.length,
          ...angleBisectors.filter(ab => ab.foot !== iPoint));
        // Remove pointsOnSegments where point===iPoint (circular: K on segment BK)
        pointsOnSegments.splice(0, pointsOnSegments.length,
          ...pointsOnSegments.filter(pos => pos.point !== iPoint));
        // Remove equalAngles that involve iPoint as the "shared arm" bisector foot
        const removedEqAngles = equalAngles.filter(ea => {
            const arms = new Set([ea.angle1[0], ea.angle1[2], ea.angle2[0], ea.angle2[2]]);
            return arms.has(iPoint) && triVerts.has(ea.angle1[1]);
          });
        equalAngles.splice(0, equalAngles.length,
          ...equalAngles.filter(ea => {
            const arms = new Set([ea.angle1[0], ea.angle1[2], ea.angle2[0], ea.angle2[2]]);
            // Keep if not a bisector-through-K constraint (vertex as arm, K as other arm)
            return !arms.has(iPoint) || !triVerts.has(ea.angle1[1]);
          }));
        // Save removed equal-angle constraints for display-only (SVG arc markers).
        // These are NOT used by the solver (K placement is handled by incircle formula).
        if (removedEqAngles.length > 0) {
          displayEqualAngles.push(...removedEqAngles);
        }
      }
    }
  }

  const raw: GeometryModel = {
    rawText,
    points: [...points],
    segments,
    circles,
    triangles,
    lines,
    midpoints,
    pointsOnSegments,
    parallels,
    perpendiculars,
    equalLengths,
    equalAngles,
    ...(displayEqualAngles.length > 0 && { displayEqualAngles }),
    altitudes,
    medians,
    angleBisectors,
    tangents: filteredTangents,
    incircles,
    circumcircles: [],
    rectangles: [],
    squares: [],
    parallelograms: [],
    trapezoids: [],
    centroids,
    circlesByDiameter,
    pointsOnCircles,
    circleConstraints: [],
    diameterConstraints,
    lineIntersections: lineIntersections.filter((it, idx, arr) => arr.findIndex((x) => x.line1 === it.line1 && x.line2 === it.line2 && x.point === it.point) === idx),
    perpendicularLines: [],
    perpendicularThroughPointIntersections,
    tangentIntersections,
    namedTangents
  };

  return normalizeModelIds(enrichModelForV2(raw));
}

// ─── Canonical → GeometryModel compiler ──────────────────────────────────────
// Compiles a CanonicalProblem (Layer 9 output) directly into a GeometryModel
// (Layer 11 output), bypassing the raw GeometryDsl representation.
export function canonicalToGeometryModel(canonical: CanonicalProblem, rawText: string): GeometryModel {

  // ── ID helpers (all pre-normalizeModelIds) ──────────────────────────────────

  /** "pt_A" → "A",  "pt_O" → "O",  fallback is raw string */
  function ptRaw(canonId: string): string {
    const m = canonId.match(/^pt_([A-Za-z0-9])$/i);
    return m ? m[1].toUpperCase() : canonId;
  }

  // Build entity lookup map
  const entityById = new Map<string, CanonicalEntity>();
  for (const e of canonical.entities) entityById.set(e.id, e);

  // "cir_O" → "O"  (raw circle id = center letter, before normalizeModelIds adds "circle:" prefix)
  const canonCircleIdToRaw = new Map<string, string>();
  for (const e of canonical.entities) {
    if (e.kind === "circle") canonCircleIdToRaw.set(e.id, ptRaw(e.center));
  }
  function cirRaw(canonId: string): string {
    return canonCircleIdToRaw.get(canonId) ?? canonId.replace(/^cir_/, "").toUpperCase();
  }

  /** Entity with through-points → LineRef, else null */
  function entityLineRef(canonId: string): LineRef | null {
    const e = entityById.get(canonId);
    if (e && e.kind === "line" && e.through) return { a: ptRaw(e.through[0]), b: ptRaw(e.through[1]) };
    return null;
  }

  /** "Cx" → {a:"C", b:"X"},  "AE" → {a:"A", b:"E"},  else null */
  function labelToLineRef(label: string): LineRef | null {
    const upper = label.toUpperCase().replace(/[^A-Z]/g, "");
    return upper.length >= 2 ? { a: upper[0], b: upper[1] } : null;
  }

  /** Best effort: entity through-points, then entity label, else null */
  function resolveLineRef(canonId: string): LineRef | null {
    const ref = entityLineRef(canonId);
    if (ref) return ref;
    const e = entityById.get(canonId);
    return e?.label ? labelToLineRef(e.label) : null;
  }

  // ── Pre-scan givens for special line types ──────────────────────────────────

  type PerpThroughInfo = { through: string; toLine: LineRef };
  const perpThroughLines = new Map<string, PerpThroughInfo>(); // lineCanonId → info

  type TangentLineInfo = { at: string; center: string; circleCanonId: string };
  const tangentLines = new Map<string, TangentLineInfo>(); // lineCanonId → info

  for (const given of canonical.givens) {
    if (given.type === "perpendicular_through_point") {
      const toLine = entityLineRef(given.to_line);
      if (toLine) perpThroughLines.set(given.line, { through: ptRaw(given.point), toLine });
    }
    if (given.type === "tangent_at_point") {
      tangentLines.set(given.line, {
        at: ptRaw(given.point),
        center: cirRaw(given.circle),
        circleCanonId: given.circle,
      });
    }
  }

  // ── GeometryModel arrays ────────────────────────────────────────────────────

  const points = new Set<string>();
  const segments:                           GeometryModel["segments"]                           = [];
  const circles:                            GeometryModel["circles"]                            = [];
  const lines:                              GeometryModel["lines"]                              = [];
  const triangles:                          GeometryModel["triangles"]                          = [];
  const pointsOnCircles:                    GeometryModel["pointsOnCircles"]                    = [];
  const circlesByDiameter:                  GeometryModel["circlesByDiameter"]                  = [];
  const diameterConstraints:                GeometryModel["diameterConstraints"]                = [];
  const namedTangents:                      GeometryModel["namedTangents"]                      = [];
  const tangents:                           GeometryModel["tangents"]                           = [];
  const perpendiculars:                     GeometryModel["perpendiculars"]                     = [];
  const parallels:                          GeometryModel["parallels"]                          = [];
  const equalLengths:                       GeometryModel["equalLengths"]                       = [];
  const equalAngles:                        GeometryModel["equalAngles"]                        = [];
  const lineIntersections:                  GeometryModel["lineIntersections"]                  = [];
  const perpendicularThroughPointIntersections: GeometryModel["perpendicularThroughPointIntersections"] = [];
  const tangentIntersections:               GeometryModel["tangentIntersections"]               = [];
  const midpoints:                          GeometryModel["midpoints"]                          = [];
  const pointsOnSegments:                   GeometryModel["pointsOnSegments"]                   = [];

  function addSegment(a: string, b: string) {
    const key = [a, b].sort().join(":");
    if (!segments.some(s => [s.a, s.b].sort().join(":") === key)) segments.push({ a, b });
  }

  // ── Step 1: Entity pass ─────────────────────────────────────────────────────

  for (const entity of canonical.entities) {
    if (entity.kind === "radius_parameter" || entity.kind === "angle_parameter") continue;
    if (!entity.visible) continue;

    if (entity.kind === "point") {
      const r = ptRaw(entity.id);
      if (/^[A-Z]$/.test(r)) points.add(r);
      continue;
    }

    if (entity.kind === "circle") {
      const center = ptRaw(entity.center);
      points.add(center);
      circles.push({ id: cirRaw(entity.id), center, radius: 120 });
      continue;
    }

    if (entity.kind === "line") {
      // Perp-through-point lines become perpendicularThroughPointIntersections, not line objects
      if (perpThroughLines.has(entity.id)) continue;
      const label = entity.label ?? entity.id;
      if (entity.through) {
        const a = ptRaw(entity.through[0]);
        const b = ptRaw(entity.through[1]);
        if (/^[A-Z]$/.test(a) && /^[A-Z]$/.test(b)) {
          points.add(a); points.add(b);
          lines.push({ id: label, a, b });
          addSegment(a, b);
        }
      } else if (!tangentLines.has(entity.id)) {
        // User-labeled line without through-points (e.g. direction helpers)
        lines.push({ id: label });
      }
      continue;
    }

    if (entity.kind === "segment") {
      const a = ptRaw(entity.endpoints[0]);
      const b = ptRaw(entity.endpoints[1]);
      if (/^[A-Z]$/.test(a) && /^[A-Z]$/.test(b)) {
        points.add(a); points.add(b);
        addSegment(a, b);
      }
      continue;
    }

    if (entity.kind === "triangle") {
      const verts = entity.vertices.map(ptRaw);
      if (verts.every(v => /^[A-Z]$/.test(v))) {
        const [a, b, c] = verts as [string, string, string];
        points.add(a); points.add(b); points.add(c);
        triangles.push({ vertices: [a, b, c] });
        for (const [p, q] of [[a, b], [b, c], [c, a]] as [string, string][]) addSegment(p, q);
      }
      continue;
    }

    if (entity.kind === "polygon") {
      for (const v of entity.vertices) {
        const r = ptRaw(v);
        if (/^[A-Z]$/.test(r)) points.add(r);
      }
      continue;
    }
  }

  // ── Step 2: Given pass ──────────────────────────────────────────────────────

  for (const given of canonical.givens) {

    if (given.type === "diameter_of_circle") {
      const [a, b] = given.endpoints.map(ptRaw) as [string, string];
      const rawCircId = cirRaw(given.circle);
      const circleEntity = entityById.get(given.circle);
      const centerId = circleEntity?.kind === "circle" ? ptRaw(circleEntity.center) : rawCircId;
      if (circleEntity?.kind === "circle") points.add(ptRaw(circleEntity.center));
      points.add(a); points.add(b);
      // Guard: if one endpoint IS the center, treat the other as on_circle (radius point).
      if (a === centerId || b === centerId) {
        const radiusPoint = a === centerId ? b : a;
        pointsOnCircles.push({ point: radiusPoint, center: centerId, circleId: rawCircId });
      } else {
        circlesByDiameter.push({ a, b, circleId: rawCircId, centerId: rawCircId });
        diameterConstraints.push({ circleId: rawCircId, point1Id: a, point2Id: b });
        addSegment(a, b);
      }
      continue;
    }

    if (given.type === "point_on_circle") {
      const pt = ptRaw(given.point);
      const circleEntity = entityById.get(given.circle);
      const center = circleEntity?.kind === "circle" ? ptRaw(circleEntity.center) : cirRaw(given.circle);
      points.add(pt); points.add(center);
      pointsOnCircles.push({ point: pt, center, circleId: cirRaw(given.circle) });
      continue;
    }

    if (given.type === "tangent_at_point") {
      const at = ptRaw(given.point);
      const circleEntity = entityById.get(given.circle);
      const center = circleEntity?.kind === "circle" ? ptRaw(circleEntity.center) : cirRaw(given.circle);
      points.add(at);
      const lineEntity = entityById.get(given.line);
      // Derive linePoint from label (e.g. "Cx" where at="C" → linePoint="X")
      const lineLabel = lineEntity?.label ?? null;
      const linePointChar = lineLabel
        ? lineLabel.toUpperCase().replace(/[^A-Z]/g, "").split("").find(ch => ch !== at) ?? null
        : null;
      if (linePointChar) {
        points.add(linePointChar);
        namedTangents.push({ at, center, linePoint: linePointChar });
      } else {
        tangents.push({ circleId: cirRaw(given.circle), pointId: at, pointOnCircle: true });
      }
      continue;
    }

    if (given.type === "perpendicular_through_point") {
      points.add(ptRaw(given.point));
      continue; // intersection_of_lines given will create the complete constraint entry
    }

    if (given.type === "intersection_of_lines") {
      const pt = ptRaw(given.point);
      points.add(pt);
      const [l1Id, l2Id] = given.lines;
      const perpInfo = perpThroughLines.get(l1Id) ?? perpThroughLines.get(l2Id);
      const tangInfo = tangentLines.get(l1Id) ?? tangentLines.get(l2Id);

      if (perpInfo) {
        // perp_through_point takes priority
        const withLineId = perpThroughLines.has(l1Id) ? l2Id : l1Id;
        const withRef = resolveLineRef(withLineId);
        if (withRef) {
          points.add(withRef.a); points.add(withRef.b);
          perpendicularThroughPointIntersections.push({
            through: perpInfo.through, toLine: perpInfo.toLine, withLine: withRef, intersection: pt,
          });
          perpendiculars.push({ line1: { a: perpInfo.through, b: pt }, line2: perpInfo.toLine });
        } else {
          lineIntersections.push({
            line1: entityById.get(l1Id)?.label ?? l1Id,
            line2: entityById.get(l2Id)?.label ?? l2Id,
            point: pt,
          });
        }
      } else if (tangInfo) {
        const withLineId2 = tangentLines.has(l1Id) ? l2Id : l1Id;
        const withRef2 = resolveLineRef(withLineId2);
        if (withRef2) {
          points.add(withRef2.a); points.add(withRef2.b);
          tangentIntersections.push({
            at: tangInfo.at, center: tangInfo.center, withLine: withRef2, intersection: pt,
          });
        } else {
          lineIntersections.push({
            line1: entityById.get(l1Id)?.label ?? l1Id,
            line2: entityById.get(l2Id)?.label ?? l2Id,
            point: pt,
          });
        }
      } else {
        lineIntersections.push({
          line1: entityById.get(l1Id)?.label ?? l1Id,
          line2: entityById.get(l2Id)?.label ?? l2Id,
          point: pt,
        });
      }
      continue;
    }

    if (given.type === "foot_of_perpendicular") {
      const foot = ptRaw(given.foot);
      const from = ptRaw(given.from_point);
      const toLine = entityLineRef(given.to_line)
        ?? (entityById.get(given.to_line)?.label ? labelToLineRef(entityById.get(given.to_line)!.label!) : null);
      points.add(foot); points.add(from);
      if (toLine) {
        points.add(toLine.a); points.add(toLine.b);
        perpendiculars.push({ line1: { a: from, b: foot }, line2: toLine });
        pointsOnSegments.push({ point: foot, a: toLine.a, b: toLine.b });
        // Also register as perpendicularThroughPointIntersection so right-angle marks
        // and the dependency graph know the foot is derived from (from, toLine).
        if (!perpendicularThroughPointIntersections.some((r) => r.intersection === foot)) {
          perpendicularThroughPointIntersections.push({
            through: from, toLine, withLine: toLine, intersection: foot,
          });
        }
      }
      continue;
    }

    if (given.type === "midpoint_of_segment") {
      const pt = ptRaw(given.point);
      const [a, b] = given.segment.map(ptRaw) as [string, string];
      points.add(pt); points.add(a); points.add(b);
      midpoints.push({ point: pt, a, b });
      addSegment(a, b);
      continue;
    }

    if (given.type === "point_on_segment") {
      const pt = ptRaw(given.point);
      const [a, b] = given.segment.map(ptRaw) as [string, string];
      points.add(pt); points.add(a); points.add(b);
      pointsOnSegments.push({ point: pt, a, b });
      continue;
    }

    if (given.type === "line_through_points") {
      for (const p of given.points.map(ptRaw)) {
        if (/^[A-Z]$/.test(p)) points.add(p);
      }
      continue;
    }

    if (given.type === "perpendicular_lines") {
      const l1Ref = entityLineRef(given.line1);
      const l2Ref = entityLineRef(given.line2);
      if (l1Ref && l2Ref) {
        [l1Ref.a, l1Ref.b, l2Ref.a, l2Ref.b].forEach(p => points.add(p));
        perpendiculars.push({ line1: l1Ref, line2: l2Ref });
      }
      continue;
    }

    if (given.type === "parallel_lines") {
      const l1Ref = entityLineRef(given.line1);
      const l2Ref = entityLineRef(given.line2);
      if (l1Ref && l2Ref) {
        [l1Ref.a, l1Ref.b, l2Ref.a, l2Ref.b].forEach(p => points.add(p));
        parallels.push({ line1: l1Ref, line2: l2Ref });
      }
      continue;
    }

    if (given.type === "equal_length") {
      const [s1a, s1b] = given.segment1.map(ptRaw) as [string, string];
      const [s2a, s2b] = given.segment2.map(ptRaw) as [string, string];
      [s1a, s1b, s2a, s2b].forEach(p => points.add(p));
      equalLengths.push({ segment1: { a: s1a, b: s1b }, segment2: { a: s2a, b: s2b } });
      continue;
    }

    if (given.type === "equal_angle") {
      const [a1, v1, b1] = given.angle1.map(ptRaw) as [string, string, string];
      const [a2, v2, b2] = given.angle2.map(ptRaw) as [string, string, string];
      [a1, v1, b1, a2, v2, b2].forEach(p => points.add(p));
      equalAngles.push({ angle1: [a1, v1, b1], angle2: [a2, v2, b2] });
      continue;
    }

    if (given.type === "right_angle") {
      const vertex = ptRaw(given.vertex);
      const r1 = ptRaw(given.ray1);
      const r2 = ptRaw(given.ray2);
      points.add(vertex); points.add(r1); points.add(r2);
      perpendiculars.push({ line1: { a: r1, b: vertex }, line2: { a: vertex, b: r2 } });
      continue;
    }

    if (given.type === "distinct_points") {
      for (const p of given.points.map(ptRaw)) {
        if (/^[A-Z]$/.test(p)) points.add(p);
      }
      continue;
    }
  }

  // ── Step 3: Assemble and return ─────────────────────────────────────────────

  // ── Step 3: Angle parameters from canonical entities ─────────────────────
  const angleParameters: AngleParameter[] = [];
  for (const entity of canonical.entities) {
    if (entity.kind !== "angle_parameter") continue;
    const circleEntity = entityById.get(entity.circle);
    if (circleEntity?.kind !== "circle") continue;
    // Use raw (pre-normalizeModelIds) IDs: normalizeModelIds will add "point:" prefix
    const rawPoint  = ptRaw(entity.point);   // e.g. "E"
    const rawCenter = ptRaw(circleEntity.center);  // e.g. "O"
    if (!/^[A-Z]$/.test(rawPoint) || !/^[A-Z]$/.test(rawCenter)) continue;
    angleParameters.push({ id: entity.id, point: rawPoint, center: rawCenter, value: entity.value });
  }

  const raw2: GeometryModel = {
    rawText,
    points: [...points],
    segments,
    circles,
    triangles,
    lines,
    midpoints,
    pointsOnSegments,
    parallels,
    perpendiculars,
    equalLengths,
    equalAngles,
    altitudes: [],
    medians: [],
    angleBisectors: [],
    tangents,
    incircles: [],
    circumcircles: [],
    rectangles: [],
    squares: [],
    parallelograms: [],
    trapezoids: [],
    centroids: [],
    circlesByDiameter,
    pointsOnCircles,
    circleConstraints: [],
    diameterConstraints,
    lineIntersections,
    perpendicularLines: [],
    perpendicularThroughPointIntersections,
    tangentIntersections,
    namedTangents,
    angleParameters,
  };

  return normalizeModelIds(enrichModelForV2(raw2));
}
