import { Circle, GeometryModel, LayoutModel, Point } from "./types.js";

function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function projectPointToLine(p: Point, a: Point, b: Point): Point {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy || 1;
  const t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  return { id: "", x: a.x + t * vx, y: a.y + t * vy };
}

function lineIntersection(a1: Point, a2: Point, b1: Point, b2: Point): Point | undefined {
  const den = (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x);
  if (Math.abs(den) < 1e-9) {
    return undefined;
  }
  const px =
    ((a1.x * a2.y - a1.y * a2.x) * (b1.x - b2.x) - (a1.x - a2.x) * (b1.x * b2.y - b1.y * b2.x)) /
    den;
  const py =
    ((a1.x * a2.y - a1.y * a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x * b2.y - b1.y * b2.x)) /
    den;
  return { id: "", x: px, y: py };
}

function pointFromId(id: string): Point {
  const seed = id.charCodeAt(0) || 65;
  const angle = ((seed % 26) / 26) * Math.PI * 2;
  return { id, x: 4 * Math.cos(angle), y: 4 * Math.sin(angle) };
}

export type SolverOptions = {
  iterations?: number;
};

export function refineLayoutWithSolver(
  model: GeometryModel,
  base: LayoutModel,
  options: SolverOptions = {}
): LayoutModel {
  const iterations = Math.max(10, options.iterations ?? 120);
  const map = new Map<string, Point>(base.points.map((p) => [p.id, { ...p }]));
  const diagnostics = [...base.diagnostics];

  const getPoint = (id: string): Point => {
    let p = map.get(id);
    if (!p) {
      p = pointFromId(id);
      map.set(id, p);
    }
    return p;
  };

  const setPoint = (id: string, x: number, y: number): void => {
    map.set(id, { id, x, y });
  };

  const circleMap = new Map<string, Circle>();
  for (const c of base.circles) {
    circleMap.set(c.center, { ...c });
  }

  const diameterPoints = new Set<string>();
  for (const dc of model.circlesByDiameter) {
    diameterPoints.add(dc.a);
    diameterPoints.add(dc.b);
  }

  for (let i = 0; i < iterations; i += 1) {
    for (const dc of model.circlesByDiameter) {
      const a = getPoint(dc.a);
      const b = getPoint(dc.b);
      const centerId = dc.centerId ?? "O";
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      setPoint(centerId, cx, cy);
      circleMap.set(centerId, { center: centerId, radius: dist(a, b) / 2 });
    }

    for (const mp of model.midpoints) {
      const a = getPoint(mp.a);
      const b = getPoint(mp.b);
      setPoint(mp.point, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }

    for (const rel of model.pointsOnSegments) {
      const p = getPoint(rel.point);
      const a = getPoint(rel.a);
      const b = getPoint(rel.b);
      const pr = projectPointToLine(p, a, b);
      setPoint(rel.point, pr.x, pr.y);
    }

    for (const alt of model.altitudes) {
      const from = getPoint(alt.from);
      const a = getPoint(alt.baseA);
      const b = getPoint(alt.baseB);
      const foot = projectPointToLine(from, a, b);
      setPoint(alt.foot, foot.x, foot.y);
    }

    for (const md of model.medians) {
      const a = getPoint(md.baseA);
      const b = getPoint(md.baseB);
      setPoint(md.foot, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }

    for (const pc of model.pointsOnCircles) {
      const center = getPoint(pc.center);
      const p = getPoint(pc.point);
      const circle = circleMap.get(pc.center);
      if (!circle) {
        continue;
      }
      const vx = p.x - center.x;
      const vy = p.y - center.y;
      const len = Math.sqrt(vx * vx + vy * vy) || 1;
      setPoint(pc.point, center.x + (vx / len) * circle.radius, center.y + (vy / len) * circle.radius);
    }

    for (const rel of model.parallels) {
      if (
        diameterPoints.has(rel.line1.a) ||
        diameterPoints.has(rel.line1.b) ||
        diameterPoints.has(rel.line2.a) ||
        diameterPoints.has(rel.line2.b)
      ) {
        continue;
      }

      const a = getPoint(rel.line1.a);
      const b = getPoint(rel.line1.b);
      const c = getPoint(rel.line2.a);
      const d = getPoint(rel.line2.b);
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const vLen = Math.sqrt(vx * vx + vy * vy) || 1;
      const target = dist(c, d) || 2;
      setPoint(rel.line2.b, c.x + (vx / vLen) * target, c.y + (vy / vLen) * target);
    }

    for (const rel of model.perpendiculars) {
      const line2Protected = diameterPoints.has(rel.line2.a) || diameterPoints.has(rel.line2.b);
      if (line2Protected) {
        continue;
      }
      if (diameterPoints.has(rel.line1.a) || diameterPoints.has(rel.line1.b)) {
        continue;
      }

      const a = getPoint(rel.line1.a);
      const b = getPoint(rel.line1.b);
      const c = getPoint(rel.line2.a);
      const d = getPoint(rel.line2.b);
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const px = -vy;
      const py = vx;
      const pLen = Math.sqrt(px * px + py * py) || 1;
      const target = dist(c, d) || 2;
      setPoint(rel.line2.b, c.x + (px / pLen) * target, c.y + (py / pLen) * target);
    }

    for (const bis of model.angleBisectors) {
      const v = getPoint(bis.from);
      const a = getPoint(bis.sideA);
      const b = getPoint(bis.sideB);
      const foot = getPoint(bis.foot);

      const va = dist(v, a) || 1;
      const vb = dist(v, b) || 1;
      const ux = (a.x - v.x) / va + (b.x - v.x) / vb;
      const uy = (a.y - v.y) / va + (b.y - v.y) / vb;
      const uLen = Math.sqrt(ux * ux + uy * uy) || 1;
      const dirX = ux / uLen;
      const dirY = uy / uLen;
      const proj = (foot.x - v.x) * dirX + (foot.y - v.y) * dirY;
      const t = proj > 0 ? proj : 2.5;
      setPoint(bis.foot, v.x + dirX * t, v.y + dirY * t);
    }

    for (const nt of model.namedTangents) {
      const at = getPoint(nt.at);
      const centerId = nt.center ?? model.circlesByDiameter[0]?.centerId ?? "O";
      const center = getPoint(centerId);
      const vx = at.x - center.x;
      const vy = at.y - center.y;
      const tx = vy;
      const ty = -vx;
      const tLen = Math.sqrt(tx * tx + ty * ty) || 1;
      const len = dist(at, getPoint(nt.linePoint)) || 8;
      setPoint(nt.linePoint, at.x + (tx / tLen) * len, at.y + (ty / tLen) * len);
    }

    for (const c of model.perpendicularThroughPointIntersections) {
      const through = getPoint(c.through);
      const toA = getPoint(c.toLine.a);
      const toB = getPoint(c.toLine.b);
      const withA = getPoint(c.withLine.a);
      const withB = getPoint(c.withLine.b);
      const vx = toB.x - toA.x;
      const vy = toB.y - toA.y;
      const helper = { id: "", x: through.x - vy, y: through.y + vx };
      const inter = lineIntersection(through, helper, withA, withB);
      if (inter) {
        setPoint(c.intersection, inter.x, inter.y);
      }
    }

    for (const c of model.tangentIntersections) {
      const at = getPoint(c.at);
      const centerId = c.center ?? model.circlesByDiameter[0]?.centerId ?? "O";
      const center = getPoint(centerId);
      const withA = getPoint(c.withLine.a);
      const withB = getPoint(c.withLine.b);
      const vx = at.x - center.x;
      const vy = at.y - center.y;
      const tangentP = { id: "", x: at.x - vy, y: at.y + vx };
      const inter = lineIntersection(at, tangentP, withA, withB);
      if (inter) {
        setPoint(c.intersection, inter.x, inter.y);
      }
    }

    // Re-sync circles after all point updates in this iteration.
    for (const dc of model.circlesByDiameter) {
      const a = getPoint(dc.a);
      const b = getPoint(dc.b);
      const centerId = dc.centerId ?? "O";
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      setPoint(centerId, cx, cy);
      circleMap.set(centerId, { center: centerId, radius: dist(a, b) / 2 });
    }

    for (const pc of model.pointsOnCircles) {
      const center = getPoint(pc.center);
      const p = getPoint(pc.point);
      const circle = circleMap.get(pc.center);
      if (!circle) {
        continue;
      }
      const vx = p.x - center.x;
      const vy = p.y - center.y;
      const len = Math.sqrt(vx * vx + vy * vy) || 1;
      setPoint(pc.point, center.x + (vx / len) * circle.radius, center.y + (vy / len) * circle.radius);
    }
  }

  const refinedPoints = [...map.values()];
  const pointSet = new Set(refinedPoints.map((p) => p.id));

  const refinedCircles = [...circleMap.values()].filter((c) => pointSet.has(c.center));
  const segments = base.segments.filter((s) => pointSet.has(s.a) && pointSet.has(s.b));

  diagnostics.push(`V2 solver applied with ${iterations} iterations.`);

  return {
    points: refinedPoints,
    segments,
    circles: refinedCircles,
    diagnostics
  };
}
